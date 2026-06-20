#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
  isChallengeMasked,
  resolveChallengeIdentity,
  buildRunCurBootedPayload,
} = require('../electron/shared/run-launch-boot-record');

function testIsChallengeMasked() {
  assert.strictEqual(isChallengeMasked({ id: '(random)', name: '???' }), true);
  assert.strictEqual(isChallengeMasked({ id: '123', name: '???' }), true);
  assert.strictEqual(isChallengeMasked({ id: '(random)', name: 'Game' }), true);
  assert.strictEqual(isChallengeMasked({ id: '123', name: 'Game' }), false);
}

function testResolveFromDbFallback() {
  const entry = { id: '(random)', name: '???', levelnumber: '00D', levelname: 'LEVEL13' };
  const dbResult = { gameid: '17819', game_name: 'Storks' };
  const identity = resolveChallengeIdentity(entry, dbResult);
  assert.strictEqual(identity.gameid, '17819');
  assert.strictEqual(identity.name, 'Storks');
}

function testBuildPayloadMaskedWithDbFallback() {
  const challenge = {
    entryType: 'random_stage',
    id: '(random)',
    name: '???',
    levelnumber: '00D',
    levelname: 'LEVEL13-VERTICAL BLOCKS',
  };
  const payload = buildRunCurBootedPayload(challenge, {
    dbResult: { gameid: '17819', game_name: 'Storks' },
    sfcBasename: '06_1781975983_storkslv00.sfc',
    sfcPath: '/tmp/run/06_1781975983_storkslv00.sfc',
    launchMode: 'run',
    launchMethod: 'program',
  });

  assert.strictEqual(payload.gameid, '17819');
  assert.strictEqual(payload.name, 'Storks');
  assert.strictEqual(payload.sfc_basename, '06_1781975983_storkslv00.sfc');
  assert.strictEqual(payload.launch_mode, 'run');
  assert.strictEqual(payload.launch_method, 'program');
  assert.deepStrictEqual(payload.stage, {
    levelnumber: '00D',
    levelname: 'LEVEL13-VERTICAL BLOCKS',
  });
}

function testBuildPayloadAlreadyRevealed() {
  const challenge = {
    entryType: 'game',
    id: '23415',
    name: 'Cool Hack',
  };
  const payload = buildRunCurBootedPayload(challenge, {
    sfcBasename: '01.sfc',
    sfcPath: '/tmp/01.sfc',
  });
  assert.strictEqual(payload.gameid, '23415');
  assert.strictEqual(payload.name, 'Cool Hack');
  assert.strictEqual(payload.stage, undefined);
}

function testBuildPayloadStageWithDifficulty() {
  const challenge = {
    entryType: 'stage',
    id: '100',
    name: 'Game',
    stageNumber: '005',
    stageName: 'Pipe Land',
  };
  const payload = buildRunCurBootedPayload(challenge, {
    sfcBasename: '02.sfc',
    sfcPath: '/tmp/02.sfc',
    stageInfo: { difficulty: 4, levelname: 'Pipe Land' },
  });
  assert.strictEqual(payload.stage.levelnumber, '005');
  assert.strictEqual(payload.stage.levelname, 'Pipe Land');
  assert.strictEqual(payload.stage.difficulty, 4);
}

function main() {
  testIsChallengeMasked();
  testResolveFromDbFallback();
  testBuildPayloadMaskedWithDbFallback();
  testBuildPayloadAlreadyRevealed();
  testBuildPayloadStageWithDifficulty();
  console.log('test_run_launch_boot_record: all passed');
}

main();
