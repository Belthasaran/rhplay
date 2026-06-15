#!/usr/bin/env node

/**
 * test_stage_test_resolution.js
 */

const {
  resolveStageTestState,
  stagePassesTestFilter,
  isGrandfatherPassed,
  isCreatedAfterCutoff,
} = require('../electron/stage-test-resolution');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const baseStage = {
  gameid: '100',
  levelnumber: '105',
  playlevel_patch_code: '2lvno',
  requisites: 'foo,bar',
  playable: 1,
  difficulty: 4,
  created_at: '2025-01-01 00:00:00',
};

function testGrandfatherPassed() {
  assert(isGrandfatherPassed(baseStage), 'Expected grandfather pass');
  assert(resolveStageTestState(baseStage).status === 'passed', 'Expected passed via grandfather');
}

function testPostCutoffUntested() {
  const stage = { ...baseStage, created_at: '2026-06-14 00:00:00', test_status: null };
  assert(isCreatedAfterCutoff(stage), 'Expected post-cutoff');
  assert(resolveStageTestState(stage).status === 'untested', 'Expected untested');
}

function testUserRejectOverridesGamestagesAccept() {
  const stage = {
    ...baseStage,
    created_at: '2026-06-14 00:00:00',
    test_status: 'accept',
    test_verified_levelnumber: '105',
    test_verified_playlevel_patch_code: '2lvno',
    test_verified_requisites: 'bar,foo',
  };
  const fb = {
    gameid: '100',
    levelnumber: '105',
    playlevel_patchcode: '2lvno',
    test_result: 'reject',
  };
  assert(resolveStageTestState(stage, fb).status === 'failed', 'User reject should win');
}

function testGamestagesReject() {
  const stage = {
    ...baseStage,
    test_status: 'reject',
    test_verified_levelnumber: '105',
    test_verified_playlevel_patch_code: '2lvno',
    test_verified_requisites: 'bar,foo',
  };
  assert(resolveStageTestState(stage).status === 'failed', 'Expected failed from gamestages');
}

function testStaleRejectIgnored() {
  const stage = {
    ...baseStage,
    test_status: 'reject',
    test_verified_levelnumber: '106',
    test_verified_playlevel_patch_code: '2lvno',
    test_verified_requisites: 'bar,foo',
  };
  assert(resolveStageTestState(stage).status === 'passed', 'Stale reject should not count (grandfather)');
}

function testFilterExcludesFailed() {
  const stage = {
    ...baseStage,
    test_status: 'reject',
    test_verified_levelnumber: '105',
    test_verified_playlevel_patch_code: '2lvno',
    test_verified_requisites: 'bar,foo',
  };
  assert(!stagePassesTestFilter(stage, null, { includeUntestedStages: true }), 'Failed excluded');
}

function testFilterIncludeUntestedFalse() {
  const stage = { ...baseStage, created_at: '2026-06-14 00:00:00' };
  assert(!stagePassesTestFilter(stage, null, { includeUntestedStages: false }), 'Untested excluded');
}

function testFilterUntestedOnly() {
  const untested = { ...baseStage, created_at: '2026-06-14 00:00:00' };
  const passed = { ...baseStage };
  assert(stagePassesTestFilter(untested, null, { untestedStagesOnly: true }), 'Untested included');
  assert(!stagePassesTestFilter(passed, null, { untestedStagesOnly: true }), 'Passed excluded when untested only');
}

function main() {
  testGrandfatherPassed();
  testPostCutoffUntested();
  testUserRejectOverridesGamestagesAccept();
  testGamestagesReject();
  testStaleRejectIgnored();
  testFilterExcludesFailed();
  testFilterIncludeUntestedFalse();
  testFilterUntestedOnly();
  console.log('✅ test_stage_test_resolution passed');
}

main();
