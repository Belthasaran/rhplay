/**
 * RHServer connection manager for Electron (token storage in clientdata).
 */

const crypto = require('crypto');
const { RHServerClient } = require('../../lib/rhserver-client');
const {
  getApiBaseUrl: resolveApiBaseUrl,
  getWebBaseUrl,
  getConnectUrl
} = require('../../lib/rhserver-endpoints');

const SETTING_TEST_MODE = 'rhserver_testmode';

function getVaultKey() {
  return process.env.RHTCLIENT_VAULT_KEY;
}

function encrypt(text) {
  const key = getVaultKey();
  if (!key || key.length !== 64) throw new Error('RHTCLIENT_VAULT_KEY not configured');
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(key, 'hex'), iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

function decrypt(text) {
  const key = getVaultKey();
  if (!key || key.length !== 64) throw new Error('RHTCLIENT_VAULT_KEY not configured');
  const parts = text.split(':');
  const iv = Buffer.from(parts[0], 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(key, 'hex'), iv);
  let decrypted = decipher.update(parts[1], 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

class RHServerManager {
  constructor(dbManager) {
    this.dbManager = dbManager;
    this._client = null;
  }

  getDb() {
    return this.dbManager.getConnection('clientdata');
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

    const newApiBase = this.getApiBaseUrl();
    if (this._client) {
      this._client.apiBaseUrl = newApiBase;
    }
    this.invalidateTokensForOtherApiBase(newApiBase);
    this._client = null;
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

  loadClient() {
    const db = this.getDb();
    const apiBase = this.getApiBaseUrl();
    const row = db.prepare(`
      SELECT * FROM rhserver_tokens WHERE is_active = 1 ORDER BY connected_at DESC LIMIT 1
    `).get();
    if (!row) {
      this._client = new RHServerClient({ apiBaseUrl: apiBase });
      return this._client;
    }
    const rowApi = (row.api_base_url || '').replace(/\/$/, '');
    if (rowApi && rowApi !== apiBase) {
      db.prepare(`UPDATE rhserver_tokens SET is_active = 0 WHERE token_uuid = ?`).run(row.token_uuid);
      this._client = new RHServerClient({ apiBaseUrl: apiBase });
      return this._client;
    }
    this._client = new RHServerClient({
      apiBaseUrl: row.api_base_url || apiBase,
      accessToken: row.encrypted_access_token ? decrypt(row.encrypted_access_token) : null,
      refreshToken: row.encrypted_refresh_token ? decrypt(row.encrypted_refresh_token) : null,
      profileUuid: row.profile_uuid
    });
    return this._client;
  }

  getClient() {
    if (!this._client) return this.loadClient();
    const expected = this.getApiBaseUrl();
    if (this._client.apiBaseUrl.replace(/\/$/, '') !== expected) {
      this._client = null;
      return this.loadClient();
    }
    return this._client;
  }

  saveTokens(client) {
    const db = this.getDb();
    db.prepare(`UPDATE rhserver_tokens SET is_active = 0`).run();
    const tokenUuid = crypto.randomUUID();
    db.prepare(`
      INSERT INTO rhserver_tokens (
        token_uuid, api_base_url, encrypted_access_token, encrypted_refresh_token,
        profile_uuid, expires_at, connected_at, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, strftime('%s','now'), 1)
    `).run(
      tokenUuid,
      client.apiBaseUrl,
      client.accessToken ? encrypt(client.accessToken) : null,
      client.refreshToken ? encrypt(client.refreshToken) : null,
      client.profileUuid,
      Math.floor(Date.now() / 1000) + 3600
    );
    this._client = client;
  }

  async connect({ profileUuid, signNostrMessage }) {
    const client = this.getClient();
    await client.obtainToken({ profileUuid, signNostrMessage });
    this.saveTokens(client);
    return { connected: true, profileUuid: client.profileUuid };
  }

  getStatus() {
    const client = this.getClient();
    return {
      connected: client.isConnected(),
      profileUuid: client.profileUuid,
      apiBaseUrl: client.apiBaseUrl,
      testMode: this.getTestMode()
    };
  }

  async queueStageFeedback(feedback) {
    if (!this.getClient().isConnected()) return { queued: false, reason: 'not-connected' };
    try {
      await this.getClient().submitStageFeedback(feedback);
      return { synced: true };
    } catch (err) {
      console.warn('[RHServer] stage feedback sync failed:', err.message);
      return { synced: false, error: err.message };
    }
  }

  async queueReview(annotation) {
    if (!this.getClient().isConnected()) return { queued: false, reason: 'not-connected' };
    try {
      await this.getClient().submitReview(annotation);
      return { synced: true };
    } catch (err) {
      console.warn('[RHServer] review sync failed:', err.message);
      return { synced: false, error: err.message };
    }
  }

  async fetchHostedProfile() {
    if (!this.getClient().isConnected()) {
      return { success: false, error: 'not-connected' };
    }
    try {
      const data = await this.getClient().getProfileMe();
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
