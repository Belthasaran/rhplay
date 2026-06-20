#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
  expandedResultsToPlanEntries,
  buildReprepareSnapshotFromActiveRun,
} = require('../electron/shared/cancel-run-reprepare');

function testRandomGameExpandedRow() {
  const rows = [{
    key: 'result-uuid-1',
    entryType: 'random_game',
    id: '(random)',
    name: '???',
    count: 1,
    isLocked: true,
    seed: 'abc123',
    filterType: 'kaizo',
    matchCount: 50,
    conditions: [{ type: 'no_savestates' }],
  }];
  const dbResults = [{
    result_uuid: 'result-uuid-1',
    gameid: '23415',
    game_name: 'Storks Level',
  }];

  const entries = expandedResultsToPlanEntries(rows, dbResults);
  assert.strictEqual(entries.length, 1);
  assert.strictEqual(entries[0].entryType, 'game');
  assert.strictEqual(entries[0].id, '23415');
  assert.strictEqual(entries[0].name, 'Storks Level');
  assert.strictEqual(entries[0].count, 1);
  assert.strictEqual(entries[0].isLocked, false);
  assert.strictEqual(entries[0].seed, undefined);
  assert.strictEqual(entries[0].matchCount, undefined);
  assert.strictEqual(entries[0].filterType, undefined);
  assert.deepStrictEqual(entries[0].conditions, [{ type: 'no_savestates' }]);
  assert.notStrictEqual(entries[0].key, 'result-uuid-1');
}

function testRandomStageExpandedRow() {
  const rows = [{
    key: 'result-uuid-2',
    entryType: 'random_stage',
    id: '(random)',
    name: '???',
    levelnumber: '00D',
    translevel: '13',
    levelname: 'LEVEL13-VERTICAL BLOCKS',
    count: 1,
    stageFilterMinDifficulty: 3,
    matchCount: 20,
    conditions: [],
  }];
  const dbResults = [{
    result_uuid: 'result-uuid-2',
    gameid: '17819',
    game_name: 'Storks',
    levelnumber: '00D',
    translevel: '13',
    levelname: 'LEVEL13-VERTICAL BLOCKS',
  }];

  const entries = expandedResultsToPlanEntries(rows, dbResults);
  assert.strictEqual(entries[0].entryType, 'stage');
  assert.strictEqual(entries[0].id, '17819');
  assert.strictEqual(entries[0].name, 'Storks');
  assert.strictEqual(entries[0].stageNumber, '00D');
  assert.strictEqual(entries[0].transLevel, '13');
  assert.strictEqual(entries[0].stageName, 'LEVEL13-VERTICAL BLOCKS');
  assert.strictEqual(entries[0].stageFilterMinDifficulty, undefined);
}

function testMultipleExpandedRows() {
  const rows = [
    { key: 'a', entryType: 'random_game', id: '(random)', name: '???', count: 1 },
    { key: 'b', entryType: 'random_game', id: '(random)', name: '???', count: 1 },
  ];
  const dbResults = [
    { result_uuid: 'a', gameid: '100', game_name: 'Game A' },
    { result_uuid: 'b', gameid: '200', game_name: 'Game B' },
  ];
  const entries = expandedResultsToPlanEntries(rows, dbResults);
  assert.strictEqual(entries.length, 2);
  assert.strictEqual(entries[0].id, '100');
  assert.strictEqual(entries[1].id, '200');
  assert.notStrictEqual(entries[0].key, entries[1].key);
}

function testRevealedRowWithoutDbFallback() {
  const rows = [{
    key: 'c',
    entryType: 'game',
    id: '999',
    name: 'Already Revealed',
    count: 1,
    conditions: [{ type: 'timer', seconds: 600 }],
  }];
  const entries = expandedResultsToPlanEntries(rows, null);
  assert.strictEqual(entries[0].id, '999');
  assert.strictEqual(entries[0].name, 'Already Revealed');
  assert.deepStrictEqual(entries[0].conditions, [{ type: 'timer', seconds: 600 }]);
}

function testBuildReprepareSnapshot() {
  const snapshot = buildReprepareSnapshotFromActiveRun({
    runEntries: [{ key: 'x', entryType: 'game', id: '1', name: 'One', count: 1 }],
    cancelledRunUuid: 'run-old-uuid',
  });
  assert.strictEqual(snapshot.cancelledFromRunUuid, 'run-old-uuid');
  assert.strictEqual(snapshot.entries.length, 1);
}

function main() {
  testRandomGameExpandedRow();
  testRandomStageExpandedRow();
  testMultipleExpandedRows();
  testRevealedRowWithoutDbFallback();
  testBuildReprepareSnapshot();
  console.log('test_cancel_run_reprepare: all passed');
}

main();
