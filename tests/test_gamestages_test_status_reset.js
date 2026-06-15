#!/usr/bin/env node

/**
 * test_gamestages_test_status_reset.js
 *
 * Verifies test_status invalidation when patch config changes and preservation when unchanged.
 */

const { computeGamestageTestStatusFields } = require('../electron/gamestages-test-status');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const baseExisting = {
  stage_uuid: 'abc',
  levelnumber: '105',
  playlevel_patch_code: '2lvno',
  requisites: 'foo,bar',
  test_status: 'accept',
  test_status_at: 1000,
  test_verified_levelnumber: '105',
  test_verified_playlevel_patch_code: '2lvno',
  test_verified_requisites: 'bar,foo',
};

function testLevelnumberChangeClearsStatus() {
  const result = computeGamestageTestStatusFields({
    existing: baseExisting,
    normalizedLevelnumber: '106',
    playlevel_patch_code: '2lvno',
    requisites: 'foo,bar',
    test_status: undefined,
  });
  assert(result.patchChanged === true, 'Expected patchChanged');
  assert(result.test_status === null, 'Expected test_status cleared');
  assert(result.test_verified_levelnumber === null, 'Expected verified level cleared');
}

function testPlaylevelPatchChangeClearsStatus() {
  const result = computeGamestageTestStatusFields({
    existing: baseExisting,
    normalizedLevelnumber: '105',
    playlevel_patch_code: '3lvno',
    requisites: 'foo,bar',
    test_status: undefined,
  });
  assert(result.patchChanged === true, 'Expected patchChanged');
  assert(result.test_status === null, 'Expected test_status cleared');
}

function testRequisitesChangeClearsStatus() {
  const result = computeGamestageTestStatusFields({
    existing: baseExisting,
    normalizedLevelnumber: '105',
    playlevel_patch_code: '2lvno',
    requisites: 'foo,baz',
    test_status: undefined,
  });
  assert(result.patchChanged === true, 'Expected patchChanged');
  assert(result.test_status === null, 'Expected test_status cleared');
}

function testUnchangedSavePreservesStatus() {
  const result = computeGamestageTestStatusFields({
    existing: baseExisting,
    normalizedLevelnumber: '105',
    playlevel_patch_code: '2lvno',
    requisites: 'bar,foo',
    test_status: undefined,
  });
  assert(result.patchChanged === false, 'Expected no patch change');
  assert(result.test_status === 'accept', 'Expected status preserved');
  assert(result.test_verified_levelnumber === '105', 'Expected verified level preserved');
}

function testAcceptSetsSnapshots() {
  const result = computeGamestageTestStatusFields({
    existing: { ...baseExisting, test_status: null },
    normalizedLevelnumber: '105',
    playlevel_patch_code: '2lvno',
    requisites: 'foo,bar',
    test_status: 'accept',
  });
  assert(result.test_status === 'accept', 'Expected accept');
  assert(result.test_verified_levelnumber === '105', 'Expected snapshot level');
  assert(result.test_verified_playlevel_patch_code === '2lvno', 'Expected snapshot playlevel');
  assert(result.test_verified_requisites === 'bar,foo', 'Expected normalized requisites snapshot');
  assert(typeof result.test_status_at === 'number', 'Expected timestamp');
}

function main() {
  testLevelnumberChangeClearsStatus();
  testPlaylevelPatchChangeClearsStatus();
  testRequisitesChangeClearsStatus();
  testUnchangedSavePreservesStatus();
  testAcceptSetsSnapshots();
  console.log('✅ test_gamestages_test_status_reset passed');
}

main();
