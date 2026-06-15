'use strict';

const https = require('https');
const {
  shouldContactTwitchForValidation,
  deriveTwitchConnectionState,
} = require('../shared/twitch-token-validation');

/** @type {Set<string>} */
const validatedThisSessionByProfile = new Set();

function clearTwitchValidationSessionCache() {
  validatedThisSessionByProfile.clear();
}

/**
 * @param {string} url
 * @param {{ method?: string, headers?: Record<string, string>, body?: string }} options
 * @returns {Promise<{ statusCode: number, body: string }>}
 */
function httpsRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: options.method || 'GET',
      headers: options.headers || {},
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({ statusCode: res.statusCode || 0, body: data });
      });
    });
    req.on('error', reject);
    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

/**
 * @param {string} accessToken
 * @returns {Promise<object>}
 */
async function validateAccessTokenWithTwitch(accessToken) {
  const { statusCode, body } = await httpsRequest('https://id.twitch.tv/oauth2/validate', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken.trim()}`,
    },
  });

  if (statusCode !== 200) {
    throw new Error(`Token validation failed: ${statusCode}`);
  }

  try {
    return JSON.parse(body);
  } catch (error) {
    throw new Error('Failed to parse validation response');
  }
}

/**
 * Best-effort OAuth refresh when a refresh token is stored.
 * @param {{ clientId: string, refreshToken: string }} params
 * @returns {Promise<{ access_token: string, refresh_token?: string, expires_in?: number }|null>}
 */
async function tryRefreshAccessToken({ clientId, refreshToken }) {
  if (!clientId || !refreshToken || !refreshToken.trim()) {
    return null;
  }

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken.trim(),
    client_id: clientId,
  }).toString();

  const { statusCode, body: responseBody } = await httpsRequest('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(body),
    },
    body,
  });

  if (statusCode !== 200) {
    return null;
  }

  try {
    return JSON.parse(responseBody);
  } catch (error) {
    return null;
  }
}

/**
 * @param {object} params
 * @param {import('better-sqlite3').Database} params.db
 * @param {string} params.profileId
 * @param {Buffer|null} params.keyguardKey
 * @param {boolean} [params.force]
 * @param {(encrypted: string, key: Buffer) => string} params.decryptTwitchToken
 * @param {() => string|null} [params.getTwitchClientId]
 * @param {(accessToken: string, tokenType: string, profileUuid: string, keyguardKey: Buffer) => Promise<object>} [params.storeRefreshedToken]
 * @returns {Promise<object>}
 */
async function assessTwitchToken({
  db,
  profileId,
  keyguardKey,
  force = false,
  decryptTwitchToken,
  getTwitchClientId,
  storeRefreshedToken,
}) {
  if (!keyguardKey) {
    return {
      connected: false,
      valid: false,
      needsRefresh: false,
      needsReauth: true,
      cached: true,
      reason: 'Profile Guard not unlocked',
    };
  }

  if (!profileId) {
    return {
      connected: false,
      valid: false,
      needsRefresh: false,
      needsReauth: false,
      cached: true,
      reason: 'No active profile',
    };
  }

  const integration = db.prepare(`
    SELECT
      twitch_user_id,
      twitch_username,
      encrypted_access_token,
      encrypted_refresh_token,
      expires_in,
      obtainment_timestamp,
      last_validated_at,
      is_active
    FROM twitch_integration
    WHERE profile_uuid = ?
  `).get(profileId);

  if (!integration) {
    return {
      connected: false,
      valid: false,
      needsRefresh: false,
      needsReauth: false,
      cached: true,
      reason: 'No Twitch integration found',
    };
  }

  const statusRow = {
    twitch_user_id: integration.twitch_user_id,
    twitch_username: integration.twitch_username,
    is_active: Boolean(integration.is_active),
  };

  const now = Date.now();
  const lastValidated = integration.last_validated_at || 0;
  const validatedThisSession = validatedThisSessionByProfile.has(profileId);
  const obtainmentTime = integration.obtainment_timestamp || 0;
  const expiresIn = integration.expires_in || 0;

  let tokenExpired = false;
  if (expiresIn > 0 && obtainmentTime > 0) {
    tokenExpired = now >= obtainmentTime + (expiresIn * 1000);
  }

  const needsNetwork = shouldContactTwitchForValidation({
    force,
    validatedThisSession,
    lastValidatedAt: lastValidated,
    now,
  }) || tokenExpired;

  const baseResult = {
    twitch_user_id: integration.twitch_user_id,
    twitch_username: integration.twitch_username,
    lastValidatedAt: lastValidated,
    expiresAt: expiresIn > 0 && obtainmentTime > 0 ? obtainmentTime + (expiresIn * 1000) : null,
  };

  if (!needsNetwork) {
    const cachedValidation = { valid: Boolean(integration.is_active) };
    const state = deriveTwitchConnectionState({
      statusRow,
      validationResult: cachedValidation,
      isActive: Boolean(integration.is_active),
    });
    return {
      ...baseResult,
      ...state,
      needsReauth: state.needsRefresh,
      cached: true,
      reason: state.needsRefresh ? 'Token needs refresh' : undefined,
    };
  }

  try {
    let accessToken = decryptTwitchToken(integration.encrypted_access_token, keyguardKey);
    let refreshToken = integration.encrypted_refresh_token
      ? decryptTwitchToken(integration.encrypted_refresh_token, keyguardKey)
      : '';

    if (tokenExpired && getTwitchClientId && storeRefreshedToken && refreshToken.trim()) {
      const clientId = getTwitchClientId();
      const refreshed = await tryRefreshAccessToken({ clientId, refreshToken });
      if (refreshed?.access_token) {
        await storeRefreshedToken(refreshed.access_token, 'bearer', profileId, keyguardKey);
        accessToken = refreshed.access_token;
        if (refreshed.refresh_token) {
          refreshToken = refreshed.refresh_token;
        }
      }
    }

    await validateAccessTokenWithTwitch(accessToken);

    db.prepare(`
      UPDATE twitch_integration
      SET last_validated_at = ?, is_active = 1, last_used_at = CURRENT_TIMESTAMP
      WHERE profile_uuid = ?
    `).run(now, profileId);

    validatedThisSessionByProfile.add(profileId);

    const state = deriveTwitchConnectionState({
      statusRow,
      validationResult: { valid: true },
      isActive: true,
    });

    return {
      ...baseResult,
      ...state,
      needsReauth: false,
      cached: false,
      lastValidatedAt: now,
    };
  } catch (error) {
    console.error('[assessTwitchToken] Token validation failed:', error);

    db.prepare(`
      UPDATE twitch_integration
      SET is_active = 0, last_used_at = CURRENT_TIMESTAMP
      WHERE profile_uuid = ?
    `).run(profileId);

    const state = deriveTwitchConnectionState({
      statusRow,
      validationResult: { valid: false, needsReauth: true },
      isActive: false,
    });

    return {
      ...baseResult,
      ...state,
      needsReauth: true,
      cached: false,
      reason: error.message || 'Token validation failed',
      lastValidatedAt: lastValidated,
    };
  }
}

function markTwitchProfileValidatedThisSession(profileId) {
  if (profileId) {
    validatedThisSessionByProfile.add(profileId);
  }
}

module.exports = {
  assessTwitchToken,
  clearTwitchValidationSessionCache,
  markTwitchProfileValidatedThisSession,
  validatedThisSessionByProfile,
  shouldContactTwitchForValidation,
  validateAccessTokenWithTwitch,
  tryRefreshAccessToken,
};
