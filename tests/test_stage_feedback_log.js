#!/usr/bin/env node

/**
 * test_stage_feedback_log.js
 *
 * Verifies JSONL append to stage_feedback.txt.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { appendStageFeedbackLog } = require('../electron/utils/stage-feedback-log');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function testAppendWritesValidJson() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stage-fb-log-'));
  const feedbackRow = {
    feedback_uuid: 'uuid-1',
    gameid: '12345',
    levelnumber: '105',
    playlevel_patchcode: '2lvno',
    difficulty_feedback: 5,
    feedback_source: 'stage_test',
    test_result: 'accept',
  };
  const gamestageRow = {
    stage_uuid: 'stage-1',
    gameid: '12345',
    levelnumber: '105',
    requisites: 'foo,bar',
  };

  const r1 = appendStageFeedbackLog({ userDataPath: tmpDir, feedbackRow, gamestageRow });
  assert(r1.success === true, `First append failed: ${r1.error}`);

  const logPath = path.join(tmpDir, 'stage_feedback.txt');
  const content = fs.readFileSync(logPath, 'utf8');
  const lines = content.trim().split('\n');
  assert(lines.length === 1, 'Expected one line');

  const entry = JSON.parse(lines[0]);
  assert(entry.gameid === '12345', 'Expected gameid');
  assert(entry.levelnumber === '105', 'Expected levelnumber');
  assert(entry.playlevel_patchcode === '2lvno', 'Expected playlevel');
  assert(entry.stage_feedback.feedback_uuid === 'uuid-1', 'Expected feedback row');
  assert(entry.gamestage.stage_uuid === 'stage-1', 'Expected gamestage snapshot');
  assert(entry.logged_at, 'Expected logged_at');
}

function testFileGrowsOnMultipleSaves() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stage-fb-log-'));
  const base = { gameid: '1', levelnumber: '001', playlevel_patchcode: '2lvno' };

  appendStageFeedbackLog({
    userDataPath: tmpDir,
    feedbackRow: { ...base, feedback_uuid: 'a' },
    gamestageRow: null,
  });
  appendStageFeedbackLog({
    userDataPath: tmpDir,
    feedbackRow: { ...base, feedback_uuid: 'b' },
    gamestageRow: null,
  });

  const lines = fs.readFileSync(path.join(tmpDir, 'stage_feedback.txt'), 'utf8').trim().split('\n');
  assert(lines.length === 2, 'Expected two lines');
  const second = JSON.parse(lines[1]);
  assert(second.stage_feedback.feedback_uuid === 'b', 'Expected second entry');
}

function main() {
  testAppendWritesValidJson();
  testFileGrowsOnMultipleSaves();
  console.log('✅ test_stage_feedback_log passed');
}

main();
