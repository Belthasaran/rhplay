/**
 * Append stage feedback records to JSONL backup log in program data directory.
 */

const fs = require('fs');
const path = require('path');

function normalizeRequisitesForKey(requisites) {
  if (!requisites || String(requisites).trim() === '') return '';
  return String(requisites)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .sort()
    .join(',');
}

function buildPatchKey(levelnumber, playlevelPatchCode, requisites) {
  return [
    levelnumber || '',
    playlevelPatchCode || '',
    normalizeRequisitesForKey(requisites),
  ].join('|');
}

/**
 * Append one JSON line to stage_feedback.txt under userData.
 * @param {object} params
 * @param {string} params.userDataPath
 * @param {object} params.feedbackRow - full stage_feedback row after save
 * @param {object|null} params.gamestageRow - rhdata gamestages row snapshot
 */
function appendStageFeedbackLog({ userDataPath, feedbackRow, gamestageRow }) {
  if (!userDataPath || !feedbackRow) return { success: false, error: 'Missing userDataPath or feedbackRow' };

  const logPath = path.join(userDataPath, 'stage_feedback.txt');
  const entry = {
    logged_at: new Date().toISOString(),
    gameid: feedbackRow.gameid,
    levelnumber: feedbackRow.levelnumber,
    playlevel_patchcode: feedbackRow.playlevel_patchcode || null,
    stage_feedback: feedbackRow,
    gamestage: gamestageRow || null,
    patch_key: buildPatchKey(
      feedbackRow.levelnumber,
      feedbackRow.playlevel_patchcode,
      gamestageRow?.requisites
    ),
  };

  try {
    fs.mkdirSync(userDataPath, { recursive: true });
    fs.appendFileSync(logPath, `${JSON.stringify(entry)}\n`, 'utf8');
    return { success: true, path: logPath };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

module.exports = {
  appendStageFeedbackLog,
  normalizeRequisitesForKey,
  buildPatchKey,
};
