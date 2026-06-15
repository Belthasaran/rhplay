'use strict';

/**
 * Twitch token validation cache policy and connection state derivation.
 * Keep in sync with electron/renderer/src/utils/twitch-token-status.ts
 */

const TWITCH_VALIDATION_CACHE_MS = 10 * 60 * 1000;

/**
 * @param {{ force?: boolean, validatedThisSession?: boolean, lastValidatedAt?: number, now?: number }} params
 * @returns {boolean}
 */
function shouldContactTwitchForValidation({
  force = false,
  validatedThisSession = false,
  lastValidatedAt = 0,
  now = Date.now(),
}) {
  if (force) {
    return true;
  }
  if (!validatedThisSession) {
    return true;
  }
  if (!lastValidatedAt || lastValidatedAt <= 0) {
    return true;
  }
  return now - lastValidatedAt > TWITCH_VALIDATION_CACHE_MS;
}

/**
 * @param {object|null|undefined} statusRow
 * @returns {boolean}
 */
function isTwitchIntegrationRowConnected(statusRow) {
  if (!statusRow || typeof statusRow !== 'object') {
    return false;
  }
  return !!(statusRow.twitch_user_id || statusRow.twitch_username);
}

/**
 * @param {{ statusRow?: object|null, validationResult?: { valid?: boolean, needsReauth?: boolean }|null, isActive?: boolean }} params
 * @returns {{ connected: boolean, valid: boolean, needsRefresh: boolean }}
 */
function deriveTwitchConnectionState({ statusRow, validationResult, isActive }) {
  const connected = isTwitchIntegrationRowConnected(statusRow);
  if (!connected) {
    return { connected: false, valid: false, needsRefresh: false };
  }

  const active = isActive === undefined
    ? Boolean(statusRow && statusRow.is_active)
    : Boolean(isActive);

  const validationValid = validationResult?.valid === true;
  const valid = validationValid && active;
  const needsRefresh = connected && !valid;

  return { connected, valid, needsRefresh };
}

module.exports = {
  TWITCH_VALIDATION_CACHE_MS,
  shouldContactTwitchForValidation,
  isTwitchIntegrationRowConnected,
  deriveTwitchConnectionState,
};
