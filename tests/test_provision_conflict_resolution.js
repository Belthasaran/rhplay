#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { computeRowFingerprint, rowsEquivalent } = require('../lib/provision-row-equivalence');
const { rewriteInsertToReplace } = require('../../rhserver/src/lib/db-packager/sql-patch-postprocess');

function testFingerprintStable() {
  const row = { gvuuid: 'a', gameid: '1', version: 1, updated_at: 'x' };
  const fp1 = computeRowFingerprint(row, 'gameversions');
  const fp2 = computeRowFingerprint({ ...row, updated_at: 'y' }, 'gameversions');
  assert.strictEqual(fp1, fp2);
  console.log('✓ fingerprint ignores updated_at');
}

function testRowsEquivalent() {
  const local = { stage_uuid: 's1', gameid: '1', levelnumber: '106', levelname: 'A' };
  const declared = { stage_uuid: 's1', gameid: '1', levelnumber: '106', levelname: 'A', content_fingerprint: computeRowFingerprint(local, 'gamestages') };
  assert.ok(rowsEquivalent(local, declared, 'gamestages'));
  console.log('✓ rowsEquivalent with fingerprint');
}

function testRewriteInsert() {
  const sql = 'INSERT INTO gameversions (gvuuid) VALUES (\'x\');\nUPDATE gameversions SET x=1;';
  const out = rewriteInsertToReplace(sql);
  assert.match(out, /REPLACE INTO gameversions/);
  assert.match(out, /UPDATE gameversions/);
  console.log('✓ rewriteInsertToReplace');
}

function testPatchDeclarationsLocal() {
  const { scanPatchConflicts } = require('../lib/provision-conflict-checker');
  assert.ok(typeof scanPatchConflicts === 'function');
  console.log('✓ provision-conflict-checker loaded');
}

function run() {
  testFingerprintStable();
  testRowsEquivalent();
  testRewriteInsert();
  testPatchDeclarationsLocal();
  console.log('✓ provision conflict tests passed');
}

run();
