#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
  serializePlanSnapshot,
  normalizeWinRulesJson,
} = require('../electron/shared/run-plan-snapshot');

function baseEntry(overrides = {}) {
  return {
    key: 'entry-1',
    entryType: 'game',
    id: '12345',
    count: 1,
    seed: '',
    conditions: [],
    ...overrides,
  };
}

function testStableSnapshot() {
  const entries = [baseEntry()];
  const a = serializePlanSnapshot({
    runEntries: entries,
    globalRunConditions: [],
    globalRunPatchCodes: [],
  });
  const b = serializePlanSnapshot({
    runEntries: entries,
    globalRunConditions: [],
    globalRunPatchCodes: [],
  });
  assert.strictEqual(a, b);
}

function testIgnoresUiOnlyFields() {
  const withUi = serializePlanSnapshot({
    runEntries: [{
      ...baseEntry(),
      name: 'Display Name',
      matchCount: 99,
      isLocked: true,
    }],
    globalRunConditions: [],
    globalRunPatchCodes: [],
  });
  const withoutUi = serializePlanSnapshot({
    runEntries: [baseEntry()],
    globalRunConditions: [],
    globalRunPatchCodes: [],
  });
  assert.strictEqual(withUi, withoutUi);
}

function testDetectsReorder() {
  const e1 = baseEntry({ key: 'a', id: '1' });
  const e2 = baseEntry({ key: 'b', id: '2' });
  const forward = serializePlanSnapshot({ runEntries: [e1, e2], globalRunConditions: [], globalRunPatchCodes: [] });
  const reversed = serializePlanSnapshot({ runEntries: [e2, e1], globalRunConditions: [], globalRunPatchCodes: [] });
  assert.notStrictEqual(forward, reversed);
}

function testDetectsCountSeedConditions() {
  const base = serializePlanSnapshot({
    runEntries: [baseEntry()],
    globalRunConditions: [],
    globalRunPatchCodes: ['A'],
  });
  const countChanged = serializePlanSnapshot({
    runEntries: [baseEntry({ count: 3 })],
    globalRunConditions: [],
    globalRunPatchCodes: ['A'],
  });
  const seedChanged = serializePlanSnapshot({
    runEntries: [baseEntry({ seed: 'abc' })],
    globalRunConditions: [],
    globalRunPatchCodes: ['A'],
  });
  const conditionsChanged = serializePlanSnapshot({
    runEntries: [baseEntry({ conditions: ['Hitless'] })],
    globalRunConditions: [],
    globalRunPatchCodes: ['A'],
  });
  const globalsChanged = serializePlanSnapshot({
    runEntries: [baseEntry()],
    globalRunConditions: ['Deathless'],
    globalRunPatchCodes: ['A'],
  });
  const patchesChanged = serializePlanSnapshot({
    runEntries: [baseEntry()],
    globalRunConditions: [],
    globalRunPatchCodes: ['B'],
  });

  assert.notStrictEqual(base, countChanged);
  assert.notStrictEqual(base, seedChanged);
  assert.notStrictEqual(base, conditionsChanged);
  assert.notStrictEqual(base, globalsChanged);
  assert.notStrictEqual(base, patchesChanged);
}

function testDetectsRunType() {
  const standard = serializePlanSnapshot({
    runEntries: [baseEntry()],
    globalRunConditions: [],
    globalRunPatchCodes: [],
    runType: 'standard',
  });
  const freePlay = serializePlanSnapshot({
    runEntries: [baseEntry()],
    globalRunConditions: [],
    globalRunPatchCodes: [],
    runType: 'free_play',
  });
  assert.notStrictEqual(standard, freePlay);
}

function testNormalizeWinRulesJson() {
  assert.strictEqual(normalizeWinRulesJson(null), null);
  assert.strictEqual(normalizeWinRulesJson(''), null);
  const a = normalizeWinRulesJson('{"challengeTime":{"enabled":true}}');
  const b = normalizeWinRulesJson({ challengeTime: { enabled: true } });
  assert.strictEqual(a, b);
}

function main() {
  testStableSnapshot();
  testIgnoresUiOnlyFields();
  testDetectsReorder();
  testDetectsCountSeedConditions();
  testDetectsRunType();
  testNormalizeWinRulesJson();
  console.log('test_run_plan_snapshot: ok');
}

main();
