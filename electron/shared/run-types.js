'use strict';

/** @typedef {'standard' | 'free_play'} RunType */

const RUN_TYPE_STANDARD = 'standard';
const RUN_TYPE_FREE_PLAY = 'free_play';

const RUN_TYPE_OPTIONS = [
  { value: RUN_TYPE_STANDARD, label: 'Standard Run' },
  { value: RUN_TYPE_FREE_PLAY, label: 'Free Play' },
];

const VALID_RUN_TYPES = new Set([RUN_TYPE_STANDARD, RUN_TYPE_FREE_PLAY]);

/**
 * @param {string|null|undefined} value
 * @returns {RunType}
 */
function normalizeRunType(value) {
  if (value && VALID_RUN_TYPES.has(value)) {
    return /** @type {RunType} */ (value);
  }
  return RUN_TYPE_STANDARD;
}

/**
 * @param {RunType} runType
 * @returns {boolean}
 */
function isFreePlayRunType(runType) {
  return normalizeRunType(runType) === RUN_TYPE_FREE_PLAY;
}

module.exports = {
  RUN_TYPE_STANDARD,
  RUN_TYPE_FREE_PLAY,
  RUN_TYPE_OPTIONS,
  VALID_RUN_TYPES,
  normalizeRunType,
  isFreePlayRunType,
};
