'use strict';

/**
 * Prepare Run Twitch prediction status labels and mode mapping.
 * Keep in sync with electron/renderer/src/utils/twitch-prep-status.ts
 */

/** @typedef {'none' | 'same_item' | 'whole_challenge'} PrepPredictionsMode */

/**
 * Matches Twitch Integration Setup: connected when an integration row exists.
 * @param {object|null|undefined} status
 * @returns {boolean}
 */
function isTwitchIntegrationConnected(status) {
  return !!(status && (status.twitch_user_id || status.twitch_username));
}

/**
 * @param {{ twitchIntegrationValid: boolean, prepPredictionsMode: PrepPredictionsMode }} params
 * @returns {string}
 */
function getTwitchPrepStatusLabel({ twitchIntegrationValid, prepPredictionsMode }) {
  if (!twitchIntegrationValid) {
    return '(Off)';
  }
  if (prepPredictionsMode === 'same_item') {
    return '(On, Per-Item)';
  }
  if (prepPredictionsMode === 'whole_challenge') {
    return '(On, Per-Run)';
  }
  return '(Ready)';
}

/**
 * @param {boolean} enabled
 * @param {string|null|undefined} operationalMode
 * @returns {PrepPredictionsMode}
 */
function prepModeFromPredictionState(enabled, operationalMode) {
  if (!enabled || !operationalMode) {
    return 'none';
  }
  if (operationalMode === 'same_item' || operationalMode === 'whole_challenge') {
    return operationalMode;
  }
  return 'none';
}

/**
 * @param {PrepPredictionsMode} prepMode
 * @returns {{ enabled: boolean, operationalMode: 'whole_challenge' | 'same_item' | null }}
 */
function predictionStateFromPrepMode(prepMode) {
  if (prepMode === 'same_item') {
    return { enabled: true, operationalMode: 'same_item' };
  }
  if (prepMode === 'whole_challenge') {
    return { enabled: true, operationalMode: 'whole_challenge' };
  }
  return { enabled: false, operationalMode: null };
}

/**
 * @param {PrepPredictionsMode} prepMode
 * @returns {'individual_item' | 'whole_challenge' | null}
 */
function templateTypeForPrepMode(prepMode) {
  if (prepMode === 'same_item') return 'individual_item';
  if (prepMode === 'whole_challenge') return 'whole_challenge';
  return null;
}

module.exports = {
  isTwitchIntegrationConnected,
  getTwitchPrepStatusLabel,
  prepModeFromPredictionState,
  predictionStateFromPrepMode,
  templateTypeForPrepMode,
};
