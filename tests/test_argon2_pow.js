#!/usr/bin/env node

const assert = require('assert');
const path = require('path');
const { solvePow } = require('../lib/argon2-pow');

async function run() {
  const payload = 'rhplay:testnonce:1234567890';
  const difficulty = 4;
  const nonce = await solvePow(payload, difficulty);
  assert.ok(/^\d+$/.test(nonce));

  const { verifyPowSolution } = require(path.join(__dirname, '../../rhserver/src/lib/pow'));
  assert.ok(await verifyPowSolution(payload, nonce, difficulty), 'server verifies rhplay PoW');

  console.log('✓ test_argon2_pow passed');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
