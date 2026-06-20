'use strict';

/**
 * Resolve challenge identity and build cur_booted payloads for run launches.
 * Keep in sync with electron/renderer/src/utils/run-launch-boot-record.ts
 */

/**
 * @param {object|null|undefined} entry
 * @returns {boolean}
 */
function isChallengeMasked(entry) {
  if (!entry) return false;
  return entry.id === '(random)' || entry.name === '???';
}

/**
 * @param {object|null|undefined} entry
 * @param {object|null|undefined} [dbResult]
 * @returns {{ gameid: string|null, name: string|null }}
 */
function resolveChallengeIdentity(entry, dbResult = null) {
  const entryId = entry?.id != null ? String(entry.id) : null;
  const entryName = entry?.name != null ? String(entry.name) : null;

  let gameid = null;
  if (entryId && entryId !== '(random)') {
    gameid = entryId;
  } else if (entry?.gameid != null && String(entry.gameid) !== '(random)') {
    gameid = String(entry.gameid);
  } else if (dbResult?.gameid != null) {
    gameid = String(dbResult.gameid);
  }

  let name = null;
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

/**
 * @param {string} entryType
 * @returns {boolean}
 */
function isStageEntryType(entryType) {
  return entryType === 'stage' || entryType === 'random_stage' || entryType === 'raw_code';
}

/**
 * @param {object|null|undefined} challenge
 * @param {object} [options]
 * @param {object|null|undefined} [options.dbResult]
 * @param {string} [options.sfcBasename]
 * @param {string} [options.sfcPath]
 * @param {string} [options.launchMode]
 * @param {string} [options.launchMethod]
 * @param {{ difficulty?: number|null, levelname?: string|null }|null} [options.stageInfo]
 * @returns {Record<string, unknown>}
 */
function buildRunCurBootedPayload(challenge, options = {}) {
  const {
    dbResult = null,
    sfcBasename = '',
    sfcPath = '',
    launchMode = 'run',
    launchMethod,
    stageInfo = null,
  } = options;

  const identity = resolveChallengeIdentity(challenge, dbResult);
  /** @type {Record<string, unknown>} */
  const payload = {
    launch_mode: launchMode,
    gameid: identity.gameid,
    name: identity.name,
    sfc_basename: sfcBasename,
    sfc_path: sfcPath,
  };

  if (launchMethod) {
    payload.launch_method = launchMethod;
  }

  const entryType = challenge?.entryType || challenge?.entry_type || '';
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
    /** @type {Record<string, unknown>} */
    const stage = {};
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

module.exports = {
  isChallengeMasked,
  resolveChallengeIdentity,
  isStageEntryType,
  buildRunCurBootedPayload,
};
