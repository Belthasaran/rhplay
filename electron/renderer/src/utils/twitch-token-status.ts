/**
 * Twitch token validation types and helpers.
 * Keep in sync with electron/shared/twitch-token-validation.js
 */

export const TWITCH_VALIDATION_CACHE_MS = 10 * 60 * 1000;

export interface TwitchTokenAssessment {
  connected: boolean;
  valid: boolean;
  needsRefresh: boolean;
  needsReauth?: boolean;
  cached?: boolean;
  reason?: string;
  twitch_username?: string;
  twitch_user_id?: string;
  lastValidatedAt?: number;
  expiresAt?: number | null;
}

export function shouldContactTwitchForValidation(params: {
  force?: boolean;
  validatedThisSession?: boolean;
  lastValidatedAt?: number;
  now?: number;
}): boolean {
  const {
    force = false,
    validatedThisSession = false,
    lastValidatedAt = 0,
    now = Date.now(),
  } = params;

  if (force) return true;
  if (!validatedThisSession) return true;
  if (!lastValidatedAt || lastValidatedAt <= 0) return true;
  return now - lastValidatedAt > TWITCH_VALIDATION_CACHE_MS;
}

export function isTwitchIntegrationRowConnected(statusRow: unknown): boolean {
  if (!statusRow || typeof statusRow !== 'object') {
    return false;
  }
  const row = statusRow as { twitch_user_id?: string; twitch_username?: string };
  return !!(row.twitch_user_id || row.twitch_username);
}

export function deriveTwitchConnectionState(params: {
  statusRow?: unknown;
  validationResult?: { valid?: boolean; needsReauth?: boolean } | null;
  isActive?: boolean;
}): { connected: boolean; valid: boolean; needsRefresh: boolean } {
  const { statusRow, validationResult, isActive } = params;
  const connected = isTwitchIntegrationRowConnected(statusRow);
  if (!connected) {
    return { connected: false, valid: false, needsRefresh: false };
  }

  const row = statusRow as { is_active?: boolean };
  const active = isActive === undefined ? Boolean(row.is_active) : Boolean(isActive);
  const validationValid = validationResult?.valid === true;
  const valid = validationValid && active;
  return { connected, valid, needsRefresh: connected && !valid };
}
