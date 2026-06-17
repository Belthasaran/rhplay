/**
 * RHServer HTTP API client (shared by Electron and jstools).
 */

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
    if (profileUuid) this.profileUuid = profileUuid;
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

  async getChallenge() {
    const res = await this.fetchFn(this._v1('/auth/challenge'), {
      headers: { 'X-RH-Client-Id': this.clientId }
    });
    if (!res.ok) throw new Error(`Challenge failed: HTTP ${res.status}`);
    return res.json();
  }

  async obtainToken({ profileUuid, signNostrMessage, kindeSub }) {
    const challenge = await this.getChallenge();
    const powNonce = await solvePow(challenge.payload, challenge.difficulty);

    const body = {
      client_id: this.clientId,
      challenge_id: challenge.challenge_id,
      pow_nonce: powNonce,
      profile_uuid: profileUuid
    };

    if (signNostrMessage && challenge.nostr_message) {
      body.nostr_event = await signNostrMessage(challenge.nostr_message);
    } else if (kindeSub) {
      body.kinde_sub = kindeSub;
    }

    const res = await this.fetchFn(this._v1('/auth/token'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-RH-Client-Id': this.clientId },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Token failed: ${err}`);
    }
    const tokens = await res.json();
    return this._applyTokenResponse(tokens, profileUuid);
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
