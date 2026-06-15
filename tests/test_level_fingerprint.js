#!/usr/bin/env node

/**
 * test_level_fingerprint.js — JIT.Score fingerprint utilities
 */

const {
  fingerprintScreenV1,
  compareFingerprintsV1,
  scoreCompleteness,
  loadFingerprintCorpus,
} = require('../lib/jit-levels/jit-score');
const fs = require('fs');
const path = require('path');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function testFingerprintFormat() {
  const fp = fingerprintScreenV1([1, 2, 3, 0], 4);
  assert(fp.startsWith('v1:'), 'fingerprint must use v1 prefix');
}

function testCompareIdentical() {
  const fp = fingerprintScreenV1([1, 2, 3], 3);
  assert(compareFingerprintsV1(fp, fp) === 0);
}

function testCompareDifferent() {
  const a = fingerprintScreenV1([1, 2, 3], 3);
  const b = fingerprintScreenV1([9, 9, 9], 3);
  assert(compareFingerprintsV1(a, b) > 50);
}

function testCompletenessHeuristic() {
  const score = scoreCompleteness({
    layer1: {
      primary_level_header: { length_in_screens: 4 },
      objects: new Array(20).fill({ kind: 'standard' }),
      sprites: new Array(10).fill({}),
    },
  });
  assert(score > 0 && score <= 100);
}

function testLoadCorpus() {
  const corpusPath = path.join(__dirname, '..', 'electron', 'data', 'level_fingerprints.txt');
  const corpus = loadFingerprintCorpus(corpusPath, fs);
  assert(Array.isArray(corpus));
}

function main() {
  testFingerprintFormat();
  testCompareIdentical();
  testCompareDifferent();
  testCompletenessHeuristic();
  testLoadCorpus();
  console.log('✅ test_level_fingerprint passed');
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(`❌ test_level_fingerprint failed: ${err.message}`);
    process.exit(1);
  }
}

module.exports = { main };
