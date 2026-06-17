/**
 * RHServer connection manager for Electron (token storage in clientdata).
 */

const crypto = require('crypto');
const { RHServerClient, REFRESH_TTL_SEC } = require('../../lib/rhserver-client');
const { decodeJwtExp } = require('../../lib/jwt-exp');
const {
  getApiBaseUrl: resolveApiBaseUrl,
  getWebBaseUrl,
  getConnectUrl
} = require('../../lib/rhserver-endpoints');
const OnlineProfileManager = require('./OnlineProfileManager');
const {
  encryptWithKeyguard,
  decryptWithKeyguard
} = require('./KeyguardReencryption');

const SETTING_TEST_MODE = 'rhserver_testmode';

function getVaultKey() {
  return process.env.RHTCLIENT_VAULT_KEY;
}

function decryptVaultToken(text) {
  const key = getVaultKey();
  if (!key || key.length !== 64) throw new Error('RHTCLIENT_VAULT_KEY not configured');
  const parts = text.split(':');
  const iv = Buffer.from(parts[0], 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(key, 'hex'), iv);
  let decrypted = decipher.update(parts[1], 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

function encryptVaultToken(text) {
  const key = getVaultKey();
  if (!key || key.length !== 64) throw new Error('RHTCLIENT_VAULT_KEY not configured');
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(key, 'hex'), iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

function encryptToken(text, keyguardKey, method = 'keyguard') {
  if (!text) return null;
  if (method === 'vault') return encryptVaultToken(text);
  if (!keyguardKey) throw new Error('Profile Guard must be unlocked');
  return encryptWithKeyguard(Buffer.from(text, 'utf8'), keyguardKey);
}

function decryptToken(encrypted, keyguardKey, method = 'keyguard') {
  if (!encrypted) return null;
  if (method === 'vault') return decryptVaultToken(encrypted);
  if (!keyguardKey) throw new Error('Profile Guard must be unlocked');
  return decryptWithKeyguard(encrypted, keyguardKey).toString('utf8');
}

class RHServerManager {
  constructor(dbManager) {
    this.dbManager = dbManager;
    this._client = null;
    this._loadedProfileUuid = null;
  }

  getDb() {
    return this.dbManager.getConnection('clientdata');
  }

  getCurrentProfileId(keyguardKey = null) {
    const profileManager = new OnlineProfileManager(this.dbManager, keyguardKey);
    return profileManager.getCurrentProfileId();
  }

  invalidateClient() {
    this._client = null;
    this._loadedProfileUuid = null;
  }

  getTestMode() {
    const db = this.getDb();
    const row = db.prepare(`SELECT csetting_value FROM csettings WHERE csetting_name = ?`).get(SETTING_TEST_MODE);
    const mode = row?.csetting_value || 'Off';
    if (mode === 'On' || mode === 'Off' || mode === 'Disabled') return mode;
    return 'Off';
  }

  setTestMode(mode) {
    if (mode !== 'On' && mode !== 'Off') {
      throw new Error('Invalid test mode; use On or Off');
    }
    const current = this.getTestMode();
    if (current === 'Disabled') {
      throw new Error('RHServer test mode is disabled for this build');
    }
    const db = this.getDb();
    db.prepare(`
      INSERT INTO csettings (csettinguid, csetting_name, csetting_value)
      VALUES (?, ?, ?)
      ON CONFLICT(csetting_name) DO UPDATE SET csetting_value = excluded.csetting_value
    `).run(crypto.randomUUID(), SETTING_TEST_MODE, mode);

    this.invalidateTokensForOtherApiBase(this.getApiBaseUrl());
    this.invalidateClient();
    return { mode };
  }

  invalidateTokensForOtherApiBase(apiBaseUrl) {
    const db = this.getDb();
    const normalized = apiBaseUrl.replace(/\/$/, '');
    db.prepare(`
      UPDATE rhserver_tokens SET is_active = 0
      WHERE is_active = 1 AND api_base_url IS NOT NULL AND api_base_url != ?
    `).run(normalized);
  }

  getApiBaseUrl() {
    return resolveApiBaseUrl(this.getTestMode());
  }

  getWebBaseUrl() {
    return getWebBaseUrl(this.getTestMode());
  }

  getConnectUrl(queryString = '') {
    return getConnectUrl(this.getTestMode(), queryString);
  }

  getTestModePolicy() {
    const mode = this.getTestMode();
    return {
      mode,
      toggleEnabled: mode !== 'Disabled',
      testModeOn: mode === 'On',
      apiBaseUrl: this.getApiBaseUrl(),
      webBaseUrl: this.getWebBaseUrl(),
      connectUrl: this.getConnectUrl()
    };
  }

  _resolveAccessExpiresAt(accessToken, storedExp) {
    const jwtExp = decodeJwtExp(accessToken);
    if (jwtExp) {
      if (storedExp && storedExp !== jwtExp) {
        console.warn('[RHServer] access_expires_at mismatch; trusting JWT exp');
      }
      return jwtExp;
    }
    return storedExp || null;
  }

  loadClient(keyguardKey) {
    const db = this.getDb();
    const apiBase = this.getApiBaseUrl();
    const profileUuid = this.getCurrentProfileId(keyguardKey);

    if (!profileUuid) {
      this._client = new RHServerClient({ apiBaseUrl: apiBase });
      this._loadedProfileUuid = null;
      return this._client;
    }

    const row = db.prepare(`
      SELECT * FROM rhserver_tokens
      WHERE is_active = 1 AND profile_uuid = ? AND api_base_url = ?
      ORDER BY connected_at DESC LIMIT 1
    `).get(profileUuid, apiBase);

    if (!row) {
      this._client = new RHServerClient({ apiBaseUrl: apiBase, profileUuid });
      this._loadedProfileUuid = profileUuid;
      return this._client;
    }

    const encMethod = row.encryption_method || 'keyguard';
    let accessToken = null;
    let refreshToken = null;
    try {
      accessToken = row.encrypted_access_token
        ? decryptToken(row.encrypted_access_token, keyguardKey, encMethod)
        : null;
      refreshToken = row.encrypted_refresh_token
        ? decryptToken(row.encrypted_refresh_token, keyguardKey, encMethod)
        : null;
    } catch (err) {
      if (encMethod === 'keyguard' && row.encrypted_access_token) {
        try {
          accessToken = decryptVaultToken(row.encrypted_access_token);
          refreshToken = row.encrypted_refresh_token
            ? decryptVaultToken(row.encrypted_refresh_token)
            : null;
        } catch (_) {
          throw err;
        }
      } else {
        throw err;
      }
    }

    const accessExpiresAt = accessToken
      ? this._resolveAccessExpiresAt(accessToken, row.access_expires_at || row.expires_at)
      : null;

    this._client = new RHServerClient({
      apiBaseUrl: row.api_base_url || apiBase,
      accessToken,
      refreshToken,
      profileUuid: row.profile_uuid,
      accessExpiresAt,
      refreshExpiresAt: row.refresh_expires_at,
      obtainmentTimestamp: row.obtainment_timestamp,
      expiresIn: row.expires_in,
      onTokensUpdated: (client) => this.saveTokens(client, keyguardKey)
    });
    this._loadedProfileUuid = profileUuid;
    return this._client;
  }

  getClient(keyguardKey = null) {
    const key = keyguardKey || global.keyguardKey || null;
    const profileUuid = this.getCurrentProfileId(key);
    const expectedApi = this.getApiBaseUrl();

    if (
      this._client
      && this._loadedProfileUuid === profileUuid
      && this._client.apiBaseUrl.replace(/\/$/, '') === expectedApi
    ) {
      return this._client;
    }
    return this.loadClient(key);
  }

  saveTokens(client, keyguardKey) {
    if (!keyguardKey) throw new Error('Profile Guard must be unlocked to save RHServer tokens');
    if (!client.profileUuid) throw new Error('profileUuid required to save tokens');

    const db = this.getDb();
    const apiBase = (client.apiBaseUrl || this.getApiBaseUrl()).replace(/\/$/, '');
    const now = Math.floor(Date.now() / 1000);
    const accessExpiresAt = client.accessExpiresAt
      || (client.accessToken ? this._resolveAccessExpiresAt(client.accessToken, null) : null)
      || (now + (client.expiresIn || 3600));
    const refreshExpiresAt = client.refreshExpiresAt || (now + REFRESH_TTL_SEC);

    db.prepare(`
      UPDATE rhserver_tokens SET is_active = 0
      WHERE profile_uuid = ? AND api_base_url = ?
    `).run(client.profileUuid, apiBase);

    const tokenUuid = crypto.randomUUID();
    db.prepare(`
      INSERT INTO rhserver_tokens (
        token_uuid, api_base_url, encrypted_access_token, encrypted_refresh_token,
        profile_uuid, expires_at, access_expires_at, refresh_expires_at,
        obtainment_timestamp, expires_in, encryption_method, connected_at, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'keyguard', strftime('%s','now'), 1)
    `).run(
      tokenUuid,
      apiBase,
      client.accessToken ? encryptToken(client.accessToken, keyguardKey, 'keyguard') : null,
      client.refreshToken ? encryptToken(client.refreshToken, keyguardKey, 'keyguard') : null,
      client.profileUuid,
      accessExpiresAt,
      accessExpiresAt,
      refreshExpiresAt,
      client.obtainmentTimestamp || now,
      client.expiresIn || 3600
    );
    this._client = client;
    this._loadedProfileUuid = client.profileUuid;
  }

  async ensureAccessToken(keyguardKey) {
    if (!keyguardKey) {
      return { ok: false, reason: 'keyguard-locked' };
    }

    const client = this.loadClient(keyguardKey);
    if (!client.isConnected()) {
      return { ok: false, reason: 'not-connected' };
    }

    if (!client.isAccessExpired()) {
      return { ok: true, client };
    }

    if (client.isRefreshExpired()) {
      return { ok: false, reason: 'needs-reauth' };
    }

    try {
      await client.refreshAccessToken();
      this.saveTokens(client, keyguardKey);
      return { ok: true, client, refreshed: true };
    } catch (err) {
      return { ok: false, reason: 'refresh-failed', error: err.message };
    }
  }

  disconnect(profileUuid = null, keyguardKey = null) {
    const pid = profileUuid || this.getCurrentProfileId(keyguardKey);
    const apiBase = this.getApiBaseUrl();
    if (pid) {
      const db = this.getDb();
      db.prepare(`
        UPDATE rhserver_tokens SET is_active = 0
        WHERE profile_uuid = ? AND api_base_url = ?
      `).run(pid, apiBase);
    }
    this.invalidateClient();
    return { success: true };
  }

  async connect({ profileUuid, signNostrMessage, keyguardKey }) {
    if (!keyguardKey) throw new Error('Profile Guard must be unlocked');
    const client = this.getClient(keyguardKey);
    await client.obtainToken({ profileUuid, signNostrMessage });
    this.saveTokens(client, keyguardKey);
    return { connected: true, profileUuid: client.profileUuid };
  }

  getStatus(keyguardKey = null) {
    const key = keyguardKey || global.keyguardKey || null;
    let client;
    try {
      client = key ? this.getClient(key) : new RHServerClient({ apiBaseUrl: this.getApiBaseUrl() });
    } catch {
      client = new RHServerClient({ apiBaseUrl: this.getApiBaseUrl() });
    }

    const now = Math.floor(Date.now() / 1000);
    const connected = client.isConnected() && !client.isAccessExpired(now);
    const needsReauth = client.isConnected() && client.isAccessExpired(now) && client.isRefreshExpired(now);

    return {
      connected,
      needsReauth,
      profileUuid: client.profileUuid,
      apiBaseUrl: client.apiBaseUrl,
      testMode: this.getTestMode(),
      accessExpiresAt: client.accessExpiresAt,
      refreshExpiresAt: client.refreshExpiresAt
    };
  }

  async _withValidClient(keyguardKey, fn) {
    const ensured = await this.ensureAccessToken(keyguardKey);
    if (!ensured.ok) {
      return { success: false, error: ensured.reason, ...ensured };
    }
    return fn(ensured.client);
  }

  async queueStageFeedback(feedback, keyguardKey = null) {
    const key = keyguardKey || global.keyguardKey || null;
    const ensured = await this.ensureAccessToken(key);
    if (!ensured.ok) return { queued: false, reason: ensured.reason };
    try {
      await ensured.client.submitStageFeedback(feedback);
      return { synced: true };
    } catch (err) {
      console.warn('[RHServer] stage feedback sync failed:', err.message);
      return { synced: false, error: err.message };
    }
  }

  async queueReview(annotation, keyguardKey = null) {
    const key = keyguardKey || global.keyguardKey || null;
    const ensured = await this.ensureAccessToken(key);
    if (!ensured.ok) return { queued: false, reason: ensured.reason };
    try {
      await ensured.client.submitReview(annotation);
      return { synced: true };
    } catch (err) {
      console.warn('[RHServer] review sync failed:', err.message);
      return { synced: false, error: err.message };
    }
  }

  async fetchHostedProfile(keyguardKey = null) {
    const key = keyguardKey || global.keyguardKey || null;
    const ensured = await this.ensureAccessToken(key);
    if (!ensured.ok) {
      return { success: false, error: ensured.reason };
    }
    try {
      const data = await ensured.client.getProfileMe();
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
}

/**
 * Seed default test mode and apply build-time disabled policy.
 */
function applyRhserverTestBuildPolicy(dbManager) {
  const db = dbManager.getConnection('clientdata');
  const existing = db.prepare(`SELECT csetting_value FROM csettings WHERE csetting_name = ?`).get(SETTING_TEST_MODE);
  if (!existing) {
    db.prepare(`
      INSERT INTO csettings (csettinguid, csetting_name, csetting_value)
      VALUES (?, ?, ?)
      ON CONFLICT(csetting_name) DO NOTHING
    `).run(crypto.randomUUID(), SETTING_TEST_MODE, 'Off');
  }

  let buildStatus = null;
  try {
    const { getRhplayTestStatus } = require('../rhserver-test-config');
    buildStatus = getRhplayTestStatus();
  } catch (err) {
    console.warn('[RHServer] Could not read test build policy:', err.message);
  }

  if (buildStatus === 'disabled') {
    db.prepare(`
      INSERT INTO csettings (csettinguid, csetting_name, csetting_value)
      VALUES (?, ?, ?)
      ON CONFLICT(csetting_name) DO UPDATE SET csetting_value = excluded.csetting_value
    `).run(crypto.randomUUID(), SETTING_TEST_MODE, 'Disabled');
  }
}

module.exports = { RHServerManager, applyRhserverTestBuildPolicy };
