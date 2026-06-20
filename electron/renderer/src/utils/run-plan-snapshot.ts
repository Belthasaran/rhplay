/**
 * Stable plan fingerprint for Prepare Run dirty-state detection.
 * Keep in sync with electron/shared/run-plan-snapshot.js
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
  'prerequisites',
] as const;

type SnapshotEntry = Record<string, unknown> & { entryType: string };

function serializePlanEntry(entry: Record<string, unknown>): SnapshotEntry {
  const entryType = (entry.entryType || entry.entry_type || 'game') as string;
  const snap: SnapshotEntry = { entryType };

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

export function serializePlanSnapshot(params: {
  runEntries: readonly Record<string, unknown>[];
  globalRunConditions?: unknown[];
  globalRunPatchCodes?: string[];
  runType?: string;
}): string {
  const payload = {
    entries: (params.runEntries || []).map((entry) => serializePlanEntry(entry as Record<string, unknown>)),
    globalRunConditions: params.globalRunConditions || [],
    globalRunPatchCodes: params.globalRunPatchCodes || [],
    runType: params.runType || 'standard',
  };
  return JSON.stringify(payload);
}

export function normalizeWinRulesJson(winRulesJson: string | null | undefined): string | null {
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
