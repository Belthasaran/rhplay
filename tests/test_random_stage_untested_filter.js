#!/usr/bin/env node

/**
 * test_random_stage_untested_filter.js
 */

const {
  filterStagesByTestState,
  buildFeedbackTripletMap,
  resolveStageTestState,
} = require('../electron/stage-test-resolution');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const passedOld = {
  gameid: '1',
  levelnumber: '001',
  playlevel_patch_code: '2lvno',
  playable: 1,
  difficulty: 4,
  created_at: '2025-01-01',
};

const untestedNew = {
  gameid: '1',
  levelnumber: '002',
  playlevel_patch_code: '2lvno',
  playable: 1,
  difficulty: 4,
  created_at: '2026-06-14',
};

const rejected = {
  gameid: '1',
  levelnumber: '003',
  playlevel_patch_code: '2lvno',
  playable: 1,
  difficulty: 4,
  created_at: '2026-06-14',
  test_status: 'reject',
  test_verified_levelnumber: '003',
  test_verified_playlevel_patch_code: '2lvno',
  test_verified_requisites: '',
};

const stages = [passedOld, untestedNew, rejected];

function testExcludesFailed() {
  const map = buildFeedbackTripletMap([]);
  const out = filterStagesByTestState(stages, map, { includeUntestedStages: true });
  assert(!out.find((s) => s.levelnumber === '003'), 'Rejected stage excluded');
  assert(out.length === 2, 'Expected 2 stages after excluding failed');
}

function testIncludeUntestedFalse() {
  const map = buildFeedbackTripletMap([]);
  const out = filterStagesByTestState(stages, map, { includeUntestedStages: false });
  assert(!out.find((s) => s.levelnumber === '002'), 'Untested new excluded');
  assert(out.find((s) => s.levelnumber === '001'), 'Grandfathered stage kept');
}

function testUntestedOnly() {
  const map = buildFeedbackTripletMap([]);
  const out = filterStagesByTestState(stages, map, { untestedStagesOnly: true });
  assert(out.length === 1 && out[0].levelnumber === '002', 'Only untested stage');
}

function testUserFeedbackReject() {
  const fb = [{
    gameid: '1',
    levelnumber: '002',
    playlevel_patchcode: '2lvno',
    test_result: 'reject',
  }];
  const map = buildFeedbackTripletMap(fb);
  assert(resolveStageTestState(untestedNew, map.get('1|002|2lvno')).status === 'failed', 'User reject marks failed');
  const out = filterStagesByTestState([untestedNew], map, { includeUntestedStages: true });
  assert(out.length === 0, 'User-rejected untested excluded from pool');
}

function main() {
  testExcludesFailed();
  testIncludeUntestedFalse();
  testUntestedOnly();
  testUserFeedbackReject();
  console.log('✅ test_random_stage_untested_filter passed');
}

main();
