#!/usr/bin/env node
'use strict';

const { translevelMatches, snapshotToEstFlags } = require('../lib/stage-autotest/smw-ram-snapshot');
const { resolveExpectedTranslevel } = require('../lib/stage-autotest/utils');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function testTranslevelMatch() {
  const snap = { translevel_13bf: 0x06, inLevel: true, gameMode: 0x14 };
  assert(translevelMatches(snap, 0x06), 'match expected');
  assert(!translevelMatches(snap, 0x07), 'reject wrong');
}

function testResolveExpectedTranslevel() {
  assert(resolveExpectedTranslevel({ translevel_13bf: '06' }) === 0x06, 'direct');
  assert(resolveExpectedTranslevel({ levelnumber: '106' }) === 0x2a, 'computed from level');
}

function testSnapshotToEstFlags() {
  const est = snapshotToEstFlags({
    water: true,
    slippery: 3,
    inLevel: true,
    vertical: false,
    screens: 4,
    translevel_13bf: 0x10,
    gameMode: 0x14,
  });
  assert(est.water === 1, 'water flag');
  assert(est.in_level === 1, 'in level');
  assert(est.screens === 4, 'screens');
}

function main() {
  testTranslevelMatch();
  testResolveExpectedTranslevel();
  testSnapshotToEstFlags();
  console.log('✅ test_smw_ram_snapshot passed');
}

main();
