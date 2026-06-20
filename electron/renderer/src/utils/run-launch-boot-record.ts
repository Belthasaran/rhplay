/**
 * Resolve challenge identity and build cur_booted payloads for run launches.
 * Keep in sync with electron/shared/run-launch-boot-record.js
 */

export function isChallengeMasked(entry: Record<string, unknown> | null | undefined): boolean {
  if (!entry) return false;
  return entry.id === '(random)' || entry.name === '???';
}

export function resolveChallengeIdentity(
  entry: Record<string, unknown> | null | undefined,
  dbResult: Record<string, unknown> | null = null
): { gameid: string | null; name: string | null } {
  const entryId = entry?.id != null ? String(entry.id) : null;
  const entryName = entry?.name != null ? String(entry.name) : null;

  let gameid: string | null = null;
  if (entryId && entryId !== '(random)') {
    gameid = entryId;
  } else if (entry?.gameid != null && String(entry.gameid) !== '(random)') {
    gameid = String(entry.gameid);
  } else if (dbResult?.gameid != null) {
    gameid = String(dbResult.gameid);
  }

  let name: string | null = null;
  if (entryName && entryName !== '???') {
    name = entryName;
  } else if (entry?.game_name) {
    name = String(entry.game_name);
  } else if (dbResult?.game_name) {
    name = String(dbResult.game_name);
  } else if (dbResult?.gameName) {
    name = String(dbResult.gameName);
  }

  return { gameid, name };
}

export function isStageEntryType(entryType: string): boolean {
  return entryType === 'stage' || entryType === 'random_stage' || entryType === 'raw_code';
}

export function buildRunCurBootedPayload(
  challenge: Record<string, unknown> | null | undefined,
  options: {
    dbResult?: Record<string, unknown> | null;
    sfcBasename?: string;
    sfcPath?: string;
    launchMode?: string;
    launchMethod?: string;
    stageInfo?: { difficulty?: number | null; levelname?: string | null } | null;
  } = {}
): Record<string, unknown> {
  const {
    dbResult = null,
    sfcBasename = '',
    sfcPath = '',
    launchMode = 'run',
    launchMethod,
    stageInfo = null,
  } = options;

  const identity = resolveChallengeIdentity(challenge, dbResult);
  const payload: Record<string, unknown> = {
    launch_mode: launchMode,
    gameid: identity.gameid,
    name: identity.name,
    sfc_basename: sfcBasename,
    sfc_path: sfcPath,
  };

  if (launchMethod) {
    payload.launch_method = launchMethod;
  }

  const entryType = String(challenge?.entryType || challenge?.entry_type || '');
  const levelnumber =
    challenge?.levelnumber ||
    challenge?.stageNumber ||
    challenge?.exit_number ||
    dbResult?.levelnumber ||
    dbResult?.exit_number ||
    null;
  const levelname =
    stageInfo?.levelname ||
    challenge?.levelname ||
    challenge?.stageName ||
    dbResult?.levelname ||
    dbResult?.stage_description ||
    null;

  if (isStageEntryType(entryType) || levelnumber) {
    const stage: Record<string, unknown> = {};
    if (levelnumber != null && levelnumber !== '') {
      stage.levelnumber = levelnumber;
    }
    if (levelname) {
      stage.levelname = levelname;
    }
    const difficulty = stageInfo?.difficulty ?? challenge?.difficulty ?? dbResult?.difficulty;
    if (difficulty !== undefined && difficulty !== null && difficulty !== '') {
      stage.difficulty = difficulty;
    }
    if (Object.keys(stage).length > 0) {
      payload.stage = stage;
    }
  }

  return payload;
}
