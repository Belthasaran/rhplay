/**
 * Resolve effective test state for a gamestage (user feedback overrides gamestages).
 */

const { normalizeRequisitesForKey } = require('./utils/stage-feedback-log');

/** Stages created after this date require explicit test status unless grandfathered. */
const STAGE_TEST_CUTOFF_DATE = '2026-06-13';

function defaultPlaylevelPatchCode(code) {
  return code && String(code).trim() ? String(code).trim() : '2lvno';
}

function stageTestStatusIsCurrent(stage) {
  if (!stage?.test_status) return false;
  const playlevel = defaultPlaylevelPatchCode(stage.playlevel_patch_code);
  if ((stage.test_verified_levelnumber || null) !== (stage.levelnumber || null)) return false;
  if ((stage.test_verified_playlevel_patch_code || null) !== playlevel) return false;
  if (
    normalizeRequisitesForKey(stage.test_verified_requisites)
    !== normalizeRequisitesForKey(stage.requisites)
  ) {
    return false;
  }
  return true;
}

function parseStageCreatedDate(createdAt) {
  if (!createdAt) return null;
  const s = String(createdAt).trim();
  const datePart = s.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return null;
  return datePart;
}

function isCreatedAfterCutoff(stage) {
  const created = parseStageCreatedDate(stage?.created_at);
  if (!created) return false;
  return created > STAGE_TEST_CUTOFF_DATE;
}

function isGrandfatherPassed(stage) {
  if (isCreatedAfterCutoff(stage)) return false;
  const diff = stage?.difficulty ?? 0;
  return (stage?.playable ?? 0) === 1 && diff > 1 && diff < 8;
}

function feedbackMatchesTriplet(feedbackRow, stage) {
  if (!feedbackRow) return false;
  const stagePlaylevel = defaultPlaylevelPatchCode(stage?.playlevel_patch_code);
  const fbPlaylevel = defaultPlaylevelPatchCode(feedbackRow.playlevel_patchcode);
  return (
    String(feedbackRow.gameid) === String(stage?.gameid)
    && String(feedbackRow.levelnumber) === String(stage?.levelnumber)
    && fbPlaylevel === stagePlaylevel
  );
}

/**
 * @param {object} stage - gamestages row
 * @param {object|null} userFeedbackRow - stage_feedback row for same triplet
 * @returns {{ status: 'passed'|'failed'|'untested', source: string|null }}
 */
function resolveStageTestState(stage, userFeedbackRow = null) {
  const feedback = userFeedbackRow && feedbackMatchesTriplet(userFeedbackRow, stage)
    ? userFeedbackRow
    : null;

  if (feedback?.test_result === 'reject') {
    return { status: 'failed', source: 'user_feedback' };
  }
  if (feedback?.test_result === 'accept') {
    return { status: 'passed', source: 'user_feedback' };
  }

  if (stage?.test_status === 'reject' && stageTestStatusIsCurrent(stage)) {
    return { status: 'failed', source: 'gamestages' };
  }
  if (stage?.test_status === 'accept' && stageTestStatusIsCurrent(stage)) {
    return { status: 'passed', source: 'gamestages' };
  }

  if (isGrandfatherPassed(stage)) {
    return { status: 'passed', source: 'grandfather' };
  }

  return { status: 'untested', source: null };
}

/**
 * @param {object} stage
 * @param {object|null} userFeedbackRow
 * @param {{ includeUntestedStages?: boolean, untestedStagesOnly?: boolean }} filterOpts
 */
function stagePassesTestFilter(stage, userFeedbackRow, filterOpts = {}) {
  const includeUntested = filterOpts.includeUntestedStages !== false;
  const untestedOnly = filterOpts.untestedStagesOnly === true;
  const { status } = resolveStageTestState(stage, userFeedbackRow);

  if (status === 'failed') return false;
  if (untestedOnly) return status === 'untested';
  if (!includeUntested && status === 'untested') return false;
  return true;
}

/**
 * Build map keyed by "gameid|levelnumber|playlevel" from feedback rows.
 */
function buildFeedbackTripletMap(feedbackRows) {
  const map = new Map();
  for (const row of feedbackRows || []) {
    const key = [
      String(row.gameid),
      String(row.levelnumber),
      defaultPlaylevelPatchCode(row.playlevel_patchcode),
    ].join('|');
    map.set(key, row);
  }
  return map;
}

function feedbackKeyForStage(stage) {
  return [
    String(stage.gameid),
    String(stage.levelnumber),
    defaultPlaylevelPatchCode(stage.playlevel_patch_code),
  ].join('|');
}

function lookupFeedbackForStage(stage, feedbackMap) {
  if (!feedbackMap) return null;
  return feedbackMap.get(feedbackKeyForStage(stage)) || null;
}

/**
 * Filter stages by test state for random selection.
 */
function filterStagesByTestState(stages, feedbackMap, filterOpts) {
  return stages.filter((stage) => {
    const fb = lookupFeedbackForStage(stage, feedbackMap);
    return stagePassesTestFilter(stage, fb, filterOpts);
  });
}

module.exports = {
  STAGE_TEST_CUTOFF_DATE,
  defaultPlaylevelPatchCode,
  stageTestStatusIsCurrent,
  isCreatedAfterCutoff,
  isGrandfatherPassed,
  resolveStageTestState,
  stagePassesTestFilter,
  buildFeedbackTripletMap,
  feedbackKeyForStage,
  lookupFeedbackForStage,
  filterStagesByTestState,
};
