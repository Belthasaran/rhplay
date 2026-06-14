/**
 * Write cur_booted.json and cur_booted.html to the program data directory.
 */

const fs = require('fs');
const path = require('path');

function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatStageDifficultyText(diff) {
  if (diff === null || diff === undefined || diff === '') return '';
  const num = typeof diff === 'number' ? diff : parseInt(String(diff), 10);
  const map = {
    0: 'Trivial',
    1: 'Newcomer',
    2: 'Casual',
    3: 'Intermediate',
    4: 'Advanced',
    5: 'Xpert',
    6: 'Master',
    7: 'GM',
    8: 'GM+',
    9: 'Tool-Only',
    10: 'Bugged'
  };
  if (Number.isFinite(num) && map[num] !== undefined) {
    return `${num} ${map[num]}`;
  }
  return String(diff);
}

/**
 * Build one-line HTML summary for overlay / OBS use.
 * @param {Object} payload
 * @returns {string}
 */
function buildCurBootedHtmlLine(payload) {
  const stage = payload.stage || {};
  const levelnumber = stage.levelnumber ?? payload.levelnumber;
  const gameid = payload.gameid;
  const name = payload.name || '';
  const authors = payload.authors || payload.author || '';
  const sfcBasename = payload.sfc_basename || payload.sfcBasename || '';

  if (gameid && levelnumber !== undefined && levelnumber !== null && levelnumber !== '') {
    const stageDiff = formatStageDifficultyText(stage.difficulty ?? payload.stage_difficulty);
    const diffPart = stageDiff ? ` - (${stageDiff})` : '';
    return `${gameid} - ${levelnumber} - ${name} - ${authors}${diffPart}`;
  }
  if (gameid) {
    return `${gameid} - ${name} - ${authors}`;
  }
  if (sfcBasename) {
    return sfcBasename;
  }
  return '';
}

/**
 * Write cur_booted files under userDataDir.
 * @param {string} userDataDir
 * @param {Object} payload
 * @returns {{ success: boolean, jsonPath?: string, htmlPath?: string, error?: string }}
 */
function writeCurBooted(userDataDir, payload) {
  try {
    if (!userDataDir) {
      return { success: false, error: 'userDataDir is required' };
    }
    const record = {
      recorded_at: new Date().toISOString(),
      ...payload
    };
    const jsonPath = path.join(userDataDir, 'cur_booted.json');
    const htmlPath = path.join(userDataDir, 'cur_booted.html');
    const htmlLine = buildCurBootedHtmlLine(record);
    fs.writeFileSync(jsonPath, JSON.stringify(record, null, 2), 'utf8');
    fs.writeFileSync(htmlPath, `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Current Boot</title></head><body>${escapeHtml(htmlLine)}</body></html>`, 'utf8');
    return { success: true, jsonPath, htmlPath, htmlLine };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

module.exports = {
  writeCurBooted,
  buildCurBootedHtmlLine,
  formatStageDifficultyText,
  escapeHtml
};
