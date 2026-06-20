'use strict';

/**
 * Convert expanded active-run rows back into a concrete Prepare Run plan.
 * Keep in sync with electron/renderer/src/utils/cancel-run-reprepare.ts
 */

const crypto = require('crypto');
const { resolveChallengeIdentity } = require('./run-launch-boot-record');

const RANDOM_ONLY_FIELDS = [
  'seed',
  'filterType',
  'filterPattern',
  'filterDifficulty',
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
  'matchCount',
  'sfcpath',
  'levelnumber',
  'translevel',
  'levelname',
  'rawLevelCode',
  'planStageName',
];

/**
 * @param {string} entryType
 * @returns {'game'|'stage'}
 */
function normalizePlanEntryType(entryType) {
  if (entryType === 'random_game' || entryType === 'game') {
    return 'game';
  }
  return 'stage';
}

/**
 * @param {object} row
 * @param {object|null|undefined} dbResult
 * @returns {object}
 */
function expandedRowToPlanEntry(row, dbResult = null) {
  const sourceType = row.entryType || row.entry_type || 'game';
  const entryType = normalizePlanEntryType(sourceType);
  const identity = resolveChallengeIdentity(row, dbResult);

  /** @type {Record<string, unknown>} */
  const entry = {
    key: crypto.randomUUID(),
    id: identity.gameid || '',
    entryType,
    name: identity.name || '',
    count: 1,
    isLocked: false,
    conditions: Array.isArray(row.conditions) ? row.conditions : [],
  };

  if (row.prerequisites && typeof row.prerequisites === 'object') {
    entry.prerequisites = row.prerequisites;
  }

  if (entryType === 'stage') {
    entry.stageNumber = row.stageNumber || row.levelnumber || dbResult?.levelnumber || dbResult?.exit_number || '';
    entry.transLevel = row.transLevel || row.translevel || dbResult?.translevel || '';
    entry.stageName =
      row.stageName ||
      row.levelname ||
      dbResult?.levelname ||
      dbResult?.stage_description ||
      null;
  }

  return entry;
}

/**
 * @param {object[]} expandedRows
 * @param {Record<string, object>|object[]|null|undefined} [dbResultsByKeyOrList]
 * @returns {object[]}
 */
function expandedResultsToPlanEntries(expandedRows, dbResultsByKeyOrList = null) {
  const rows = expandedRows || [];
  /** @type {Record<string, object>|null} */
  let dbByKey = null;
  /** @type {object[]|null} */
  let dbList = null;

  if (Array.isArray(dbResultsByKeyOrList)) {
    dbList = dbResultsByKeyOrList;
  } else if (dbResultsByKeyOrList && typeof dbResultsByKeyOrList === 'object') {
    dbByKey = /** @type {Record<string, object>} */ (dbResultsByKeyOrList);
  }

  return rows.map((row, index) => {
    const dbResult =
      (dbByKey && (dbByKey[row.key] || dbByKey[row.result_uuid])) ||
      (dbList && dbList[index]) ||
      null;
    const entry = expandedRowToPlanEntry(row, dbResult);
    for (const field of RANDOM_ONLY_FIELDS) {
      delete entry[field];
    }
    return entry;
  });
}

/**
 * @param {{ runEntries?: object[], cancelledRunUuid?: string|null, dbResults?: object[]|Record<string, object>|null }} state
 * @returns {{ entries: object[], cancelledFromRunUuid: string|null }}
 */
function buildReprepareSnapshotFromActiveRun(state = {}) {
  const entries = expandedResultsToPlanEntries(state.runEntries || [], state.dbResults || null);
  return {
    entries,
    cancelledFromRunUuid: state.cancelledRunUuid || null,
  };
}

module.exports = {
  expandedResultsToPlanEntries,
  buildReprepareSnapshotFromActiveRun,
  normalizePlanEntryType,
};
