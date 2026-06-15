'use strict';

/**
 * Stable plan fingerprint for Prepare Run dirty-state detection.
 * Keep in sync with electron/renderer/src/utils/run-plan-snapshot.ts
 */

const PLAN_ENTRY_SNAPSHOT_FIELDS = [
  'key',
  'id',
  'count',
  'seed',
  'conditions',
  'stageNumber',
  'stageName',
  'transLevel',
  'filterDifficulty',
  'filterType',
  'filterPattern',
  'gameFilterMinDifficulty',
  'gameFilterMaxDifficulty',
  'stageFilterMinDifficulty',
  'stageFilterMaxDifficulty',
  'stageFilterIncludeFlags',
  'stageFilterExcludeFlags',
  'stageFilterIncludeAnyOfFlags',
  'stageFilterExcludeOnlyFlags',
  'stageFilterHasTags',
  'stageFilterExcludeTags',
  'stageFilterIncludeUntested',
  'stageFilterUntestedOnly',
];

function serializePlanEntry(entry) {
  const entryType = entry.entryType || entry.entry_type || 'game';
  const snap = { entryType };

  for (const field of PLAN_ENTRY_SNAPSHOT_FIELDS) {
    let value = entry[field];
    if (field === 'key' && !value && entry.entry_uuid) {
      value = entry.entry_uuid;
    }
    if (value === undefined) {
      continue;
    }
    snap[field] = value;
  }

  return snap;
}

/**
 * @param {{ runEntries: object[], globalRunConditions?: unknown[], globalRunPatchCodes?: string[] }} params
 * @returns {string}
 */
function serializePlanSnapshot({ runEntries, globalRunConditions = [], globalRunPatchCodes = [] }) {
  const payload = {
    entries: (runEntries || []).map(serializePlanEntry),
    globalRunConditions: globalRunConditions || [],
    globalRunPatchCodes: globalRunPatchCodes || [],
  };
  return JSON.stringify(payload);
}

/**
 * @param {string|null|undefined} winRulesJson
 * @returns {string|null}
 */
function normalizeWinRulesJson(winRulesJson) {
  if (winRulesJson == null || winRulesJson === '') {
    return null;
  }
  try {
    const parsed = typeof winRulesJson === 'string' ? JSON.parse(winRulesJson) : winRulesJson;
    return JSON.stringify(parsed);
  } catch {
    return String(winRulesJson);
  }
}

module.exports = {
  serializePlanEntry,
  serializePlanSnapshot,
  normalizeWinRulesJson,
};
