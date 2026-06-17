#!/usr/bin/env node

const assert = require('assert');
const crypto = require('crypto');
const { solvePow, sha256Hex } = require('../lib/argon2-pow');

async function run() {
  const payload = 'rhplay:testnonce:1234567890';
  const difficulty = 4;
  const nonce = await solvePow(payload, difficulty);
  assert.ok(/^\d+$/.test(nonce));
  const hash = sha256Hex(`${payload}:${nonce}`);
  assert.ok(hash.startsWith('0'), 'difficulty 4 => 1 leading zero nibble');

  console.log('✓ test_argon2_pow passed');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
