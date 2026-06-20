/**
 * Convert expanded active-run rows back into a concrete Prepare Run plan.
 * Keep in sync with electron/shared/cancel-run-reprepare.js
 */

import { resolveChallengeIdentity } from './run-launch-boot-record';

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
] as const;

export function normalizePlanEntryType(entryType: string): 'game' | 'stage' {
  if (entryType === 'random_game' || entryType === 'game') {
    return 'game';
  }
  return 'stage';
}

export function expandedResultsToPlanEntries(
  expandedRows: readonly Record<string, unknown>[],
  dbResultsByKeyOrList: Record<string, Record<string, unknown>> | readonly Record<string, unknown>[] | null = null
): Record<string, unknown>[] {
  const dbList = Array.isArray(dbResultsByKeyOrList) ? dbResultsByKeyOrList : null;
  const dbByKey = !Array.isArray(dbResultsByKeyOrList) ? dbResultsByKeyOrList : null;

  return (expandedRows || []).map((row, index) => {
    const dbResult =
      (dbByKey && (dbByKey[String(row.key)] || dbByKey[String(row.result_uuid)])) ||
      (dbList && dbList[index]) ||
      null;
    const sourceType = String(row.entryType || row.entry_type || 'game');
    const entryType = normalizePlanEntryType(sourceType);
    const identity = resolveChallengeIdentity(row, dbResult);

    const entry: Record<string, unknown> = {
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
      entry.stageNumber =
        row.stageNumber || row.levelnumber || dbResult?.levelnumber || dbResult?.exit_number || '';
      entry.transLevel = row.transLevel || row.translevel || dbResult?.translevel || '';
      entry.stageName =
        row.stageName ||
        row.levelname ||
        dbResult?.levelname ||
        dbResult?.stage_description ||
        null;
    }

    for (const field of RANDOM_ONLY_FIELDS) {
      delete entry[field];
    }

    return entry;
  });
}

export function buildReprepareSnapshotFromActiveRun(state: {
  runEntries?: readonly Record<string, unknown>[];
  cancelledRunUuid?: string | null;
  dbResults?: readonly Record<string, unknown>[] | Record<string, Record<string, unknown>> | null;
}): { entries: Record<string, unknown>[]; cancelledFromRunUuid: string | null } {
  return {
    entries: expandedResultsToPlanEntries(state.runEntries || [], state.dbResults || null),
    cancelledFromRunUuid: state.cancelledRunUuid || null,
  };
}
