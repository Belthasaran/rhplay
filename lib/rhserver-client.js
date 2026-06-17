/**
 * RHServer HTTP API client (shared by Electron and jstools).
 */

const crypto = require('crypto');
const { solvePow } = require('./argon2-pow');
const { DEFAULT_API_BASE } = require('./rhserver-endpoints');
const { decodeJwtExp } = require('./jwt-exp');

const CLIENT_ID = 'rhplay';
const REFRESH_TTL_SEC = 86400 * 30;
const ACCESS_TOKEN_SKEW_SEC = 60;

class RHServerClient {
  constructor(options = {}) {
    this.apiBaseUrl = (options.apiBaseUrl || DEFAULT_API_BASE).replace(/\/$/, '');
    this.clientId = options.clientId || CLIENT_ID;
    this.accessToken = options.accessToken || null;
    this.refreshToken = options.refreshToken || null;
    this.profileUuid = options.profileUuid || null;
    this.serverProfileUuid = options.serverProfileUuid || null;
    this.rhplayProfileUuid = options.rhplayProfileUuid || null;
    this.accessExpiresAt = options.accessExpiresAt || null;
    this.refreshExpiresAt = options.refreshExpiresAt || null;
    this.obtainmentTimestamp = options.obtainmentTimestamp || null;
    this.expiresIn = options.expiresIn || null;
    this.fetchFn = options.fetch || globalThis.fetch;
    this.onTokensUpdated = options.onTokensUpdated || null;
  }

  isConnected() {
    return Boolean(this.accessToken && this.profileUuid);
  }

  isAccessExpired(nowSec = Math.floor(Date.now() / 1000)) {
    if (!this.accessExpiresAt) return true;
    return nowSec >= (this.accessExpiresAt - ACCESS_TOKEN_SKEW_SEC);
  }

  isRefreshExpired(nowSec = Math.floor(Date.now() / 1000)) {
    if (!this.refreshExpiresAt) return !this.refreshToken;
    return nowSec >= this.refreshExpiresAt;
  }

  _applyTokenResponse(tokens, profileUuid) {
    this.accessToken = tokens.access_token;
    this.refreshToken = tokens.refresh_token;
    if (tokens.server_profile_uuid) {
      this.serverProfileUuid = tokens.server_profile_uuid;
      this.profileUuid = tokens.server_profile_uuid;
    } else if (profileUuid) {
      this.profileUuid = profileUuid;
    }
    if (tokens.rhplay_profile_uuid) {
      this.rhplayProfileUuid = tokens.rhplay_profile_uuid;
    }
    const now = Math.floor(Date.now() / 1000);
    this.obtainmentTimestamp = now;
    this.expiresIn = tokens.expires_in || 3600;
    const jwtExp = decodeJwtExp(this.accessToken);
    this.accessExpiresAt = jwtExp || (now + this.expiresIn);
    this.refreshExpiresAt = now + REFRESH_TTL_SEC;
    if (typeof this.onTokensUpdated === 'function') {
      this.onTokensUpdated(this);
    }
    return tokens;
  }

  _v1(path) {
    const base = this.apiBaseUrl.endsWith('/v1api') ? this.apiBaseUrl : `${this.apiBaseUrl}/v1api`;
    return `${base}${path.startsWith('/') ? path : `/${path}`}`;
  }

  _stableJson(obj) {
    if (obj === null || obj === undefined) return 'null';
    if (typeof obj !== 'object') return JSON.stringify(obj);
    if (Array.isArray(obj)) return `[${obj.map((v) => this._stableJson(v)).join(',')}]`;
    const keys = Object.keys(obj).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${this._stableJson(obj[k])}`).join(',')}}`;
  }

  _sha256Hex(s) {
    return crypto.createHash('sha256').update(String(s)).digest('hex');
  }

  _buildPowPayload({ powTs, nostrPubkey, rechallengeBlob }) {
    return {
      v: 1,
      client_id: this.clientId,
      pow_ts: Number(powTs),
      nostr_pubkey: nostrPubkey ? String(nostrPubkey).toLowerCase() : '',
      rechallenge_blob: rechallengeBlob ? String(rechallengeBlob) : ''
    };
  }

  _computePowHash(payloadObj, powNonce) {
    const base = this._stableJson(payloadObj);
    return this._sha256Hex(`${base}:${powNonce}`);
  }

  async obtainToken({ profileUuid, signNostrMessage, kindeSub }) {
    const tokenProfileUuid = this.serverProfileUuid || profileUuid;
    let rechallengeBlob = null;
    let powDifficulty = 6;

    // If we're doing RHPlay/Nostr auth, we must include nostr_pubkey in the PoW payload.
    // We derive it once from a cheap local signature to keep payload/hash deterministic.
    let signerPubkey = '';
    if (typeof signNostrMessage === 'function') {
      const pkEvent = await signNostrMessage('rhserver-pubkey');
      signerPubkey = String(pkEvent?.pubkey || '').toLowerCase();
    }

    for (let attempt = 0; attempt < 3; attempt++) {
      const powTs = Math.floor(Date.now() / 1000);
      const payload = this._buildPowPayload({
        powTs,
        nostrPubkey: signerPubkey,
        rechallengeBlob
      });

      // Find a nonce such that pow_hash meets difficulty.
      // We solve on `payload_string:nonce` by using solvePow against a deterministic string,
      // then compute pow_hash from stable payload JSON + nonce (server recomputes the same).
      const payloadString = this._stableJson(payload);
      const powNonce = await solvePow(payloadString, powDifficulty);
      const powHash = this._computePowHash(payload, powNonce);

      const body = {
        client_id: this.clientId,
        profile_uuid: tokenProfileUuid,
        pow_ts: powTs,
        pow_nonce: powNonce,
        pow_difficulty: powDifficulty,
        pow_hash: powHash,
        nostr_pubkey: signerPubkey
      };

      if (rechallengeBlob) body.rechallenge_blob = rechallengeBlob;

      if (typeof signNostrMessage === 'function') {
        const powSigMessage = `rhserver-pow:${this.clientId}:${powHash}:${powDifficulty}:${powTs}`;
        const powSigEvent = await signNostrMessage(powSigMessage);
        body.pow_sig = Buffer.from(JSON.stringify(powSigEvent)).toString('base64url');
        // Keep nostr_pubkey stable: it must match the PoW payload hash too.
        if (String(powSigEvent.pubkey || '').toLowerCase() !== signerPubkey) {
          throw new Error('Token failed: signing pubkey changed while computing PoW');
        }
        // Token-auth event uses the same shape but different content.
        const authMessage = `rhserver-auth:${this.clientId}:${powHash}:${powDifficulty}:${powTs}`;
        body.nostr_event = await signNostrMessage(authMessage);
      } else if (kindeSub) {
        body.kinde_sub = kindeSub;
      }

      const res = await this.fetchFn(this._v1('/auth/token'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-RH-Client-Id': this.clientId },
        body: JSON.stringify(body)
      });

      if (res.ok) {
        const tokens = await res.json();
        return this._applyTokenResponse(tokens, tokenProfileUuid);
      }

      let parsed = null;
      const txt = await res.text();
      try { parsed = JSON.parse(txt); } catch { parsed = null; }

      if (res.status === 429 && parsed?.error === 'pow_rechallenge') {
        powDifficulty = Math.max(powDifficulty, parseInt(parsed.min_difficulty || powDifficulty, 10));
        rechallengeBlob = parsed.rechallenge_blob || rechallengeBlob;
        const wait = parseInt(parsed.retry_after_sec || '0', 10);
        if (wait > 0) {
          await new Promise((r) => setTimeout(r, wait * 1000));
        }
        continue;
      }

      throw new Error(`Token failed: ${txt}`);
    }

    throw new Error('Token failed: pow_rechallenge loop exceeded');
  }

  async refreshAccessToken() {
    if (!this.refreshToken) throw new Error('No refresh token');
    const res = await this.fetchFn(this._v1('/auth/refresh'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: this.refreshToken })
    });
    if (!res.ok) throw new Error(`Refresh failed: HTTP ${res.status}`);
    const tokens = await res.json();
    return this._applyTokenResponse(tokens);
  }

  _authHeaders(extra = {}) {
    const headers = {
      'X-RH-Client-Id': this.clientId,
      ...extra
    };
    if (this.accessToken) {
      headers.Authorization = `Bearer ${this.accessToken}`;
    }
    return headers;
  }

  async apiRequest(method, path, body = null, extraHeaders = {}) {
    const url = path.startsWith('http') ? path : this._v1(path);
    const opts = {
      method,
      headers: this._authHeaders(extraHeaders)
    };
    if (body != null) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    let res = await this.fetchFn(url, opts);
    if (res.status === 401 && this.refreshToken && !this.isRefreshExpired()) {
      await this.refreshAccessToken();
      opts.headers = this._authHeaders(extraHeaders);
      if (body != null) opts.body = JSON.stringify(body);
      res = await this.fetchFn(url, opts);
    }
    return res;
  }

  async searchAttachment(attachment, legacyOptions = null) {
    const searchUrl = legacyOptions?.apiUrl || this._v1('/search');
    const headers = { 'Content-Type': 'application/json', 'X-RH-Client-Id': this.clientId };

    if (this.accessToken) {
      headers.Authorization = `Bearer ${this.accessToken}`;
    } else if (legacyOptions?.apiClient && legacyOptions?.apiSecret) {
      headers['X-Client-Id'] = legacyOptions.apiClient;
      headers['X-Client-Secret'] = legacyOptions.apiSecret;
    } else {
      throw new Error('RHServer auth not configured');
    }

    const searchData = {
      auuid: attachment.auuid,
      file_name: attachment.file_name,
      file_hash_sha256: attachment.file_hash_sha256,
      file_hash_sha224: attachment.file_hash_sha224,
      file_ipfs_cidv1: attachment.file_ipfs_cidv1
    };

    const res = await this.fetchFn(searchUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(searchData)
    });

    if (!res.ok) return null;
    const ct = res.headers.get('content-type');
    if (ct === 'application/octet-stream') {
      const data = Buffer.from(await res.arrayBuffer());
      return { data, source: `rhserver:${searchUrl}` };
    }
    return { json: await res.json(), source: `rhserver:${searchUrl}` };
  }

  async submitStageFeedback(feedback) {
    const res = await this.apiRequest('PUT', '/stage_feedback', feedback);
    if (!res.ok) throw new Error(`stage_feedback failed: HTTP ${res.status}`);
    return res.json();
  }

  async submitReview(annotation) {
    const res = await this.apiRequest('PUT', '/reviews', annotation);
    if (!res.ok) throw new Error(`reviews failed: HTTP ${res.status}`);
    return res.json();
  }

  async getProfileMe() {
    const res = await this.apiRequest('GET', '/profile/me');
    if (!res.ok) throw new Error(`profile/me failed: HTTP ${res.status}`);
    return res.json();
  }
}

module.exports = {
  RHServerClient,
  DEFAULT_API_BASE,
  CLIENT_ID,
  REFRESH_TTL_SEC,
  ACCESS_TOKEN_SKEW_SEC
};
