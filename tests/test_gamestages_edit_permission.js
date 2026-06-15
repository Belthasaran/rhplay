#!/usr/bin/env node

/**
 * test_gamestages_edit_permission.js
 *
 * Unit tests for permissive game stages edit permission logic.
 */

const {
  getStagesEditPermission,
} = require('../electron/gamestages-edit-permission');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function testNoStagesAllowsEdit() {
  const result = getStagesEditPermission({
    isDevAdmin: false,
    stagesSealed: null,
    hasDbStages: false,
    localEditAt: null,
  });
  assert(result.canEdit === true, 'Expected edit allowed when no DB stages exist');
  assert(result.reason === 'no_stages', `Expected reason no_stages, got ${result.reason}`);
}

function testAuthorStagesBlockedWithoutLocalEdit() {
  const result = getStagesEditPermission({
    isDevAdmin: false,
    stagesSealed: null,
    hasDbStages: true,
    localEditAt: null,
  });
  assert(result.canEdit === false, 'Expected edit blocked for author-defined stages');
  assert(result.reason === 'author_stages', `Expected reason author_stages, got ${result.reason}`);
}

function testLocalEditPermanentlyUnlocks() {
  const result = getStagesEditPermission({
    isDevAdmin: false,
    stagesSealed: null,
    hasDbStages: true,
    localEditAt: '2026-01-01 00:00:00',
  });
  assert(result.canEdit === true, 'Expected edit allowed after local edit');
  assert(result.reason === 'local_edit', `Expected reason local_edit, got ${result.reason}`);
}

function testStagesSealedZeroAllowsAll() {
  const result = getStagesEditPermission({
    isDevAdmin: false,
    stagesSealed: 0,
    hasDbStages: true,
    localEditAt: null,
  });
  assert(result.canEdit === true, 'Expected edit allowed when stages_sealed=0');
  assert(result.reason === 'sealed_open', `Expected reason sealed_open, got ${result.reason}`);
}

function testStagesSealedTwoBlocksNonAdmin() {
  const result = getStagesEditPermission({
    isDevAdmin: false,
    stagesSealed: 2,
    hasDbStages: false,
    localEditAt: null,
  });
  assert(result.canEdit === false, 'Expected edit blocked when stages_sealed=2');
  assert(result.reason === 'sealed_strict', `Expected reason sealed_strict, got ${result.reason}`);
}

function testStagesSealedOneGrandfathersEarlierLocalEdit() {
  const allowed = getStagesEditPermission({
    isDevAdmin: false,
    stagesSealed: 1,
    stagesSealedAt: '2026-06-01 00:00:00',
    hasDbStages: true,
    localEditAt: '2026-05-01 00:00:00',
  });
  assert(allowed.canEdit === true, 'Expected grandfathered local edit before seal date');
  assert(allowed.reason === 'sealed_grandfather', `Expected sealed_grandfather, got ${allowed.reason}`);

  const blocked = getStagesEditPermission({
    isDevAdmin: false,
    stagesSealed: 1,
    stagesSealedAt: '2026-06-01 00:00:00',
    hasDbStages: true,
    localEditAt: '2026-07-01 00:00:00',
  });
  assert(blocked.canEdit === false, 'Expected edit blocked for local edit after seal date');
  assert(blocked.reason === 'sealed_partial', `Expected sealed_partial, got ${blocked.reason}`);
}

function main() {
  testNoStagesAllowsEdit();
  testAuthorStagesBlockedWithoutLocalEdit();
  testLocalEditPermanentlyUnlocks();
  testStagesSealedZeroAllowsAll();
  testStagesSealedTwoBlocksNonAdmin();
  testStagesSealedOneGrandfathersEarlierLocalEdit();
  console.log('✅ gamestages edit permission tests passed');
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`❌ gamestages edit permission tests failed: ${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  testNoStagesAllowsEdit,
  testAuthorStagesBlockedWithoutLocalEdit,
  testLocalEditPermanentlyUnlocks,
  testStagesSealedZeroAllowsAll,
  testStagesSealedTwoBlocksNonAdmin,
  testStagesSealedOneGrandfathersEarlierLocalEdit,
};
