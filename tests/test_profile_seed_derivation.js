#!/usr/bin/env node

const assert = require('assert');
const crypto = require('crypto');

const {
  deriveNostrKeyFromSeed,
  deriveMldsa44SeedFromMasterSeed,
} = require('../electron/utils/ProfileSeedManager');

async function run() {
  const masterSeed = crypto.randomBytes(32);

  const nostr1 = deriveNostrKeyFromSeed(masterSeed);
  const nostr2 = deriveNostrKeyFromSeed(masterSeed);
  assert.strictEqual(Buffer.from(nostr1).toString('hex'), Buffer.from(nostr2).toString('hex'));
  assert.strictEqual(nostr1.length, 32);

  const m1 = deriveMldsa44SeedFromMasterSeed(masterSeed);
  const m2 = deriveMldsa44SeedFromMasterSeed(masterSeed);
  assert.strictEqual(Buffer.from(m1).toString('hex'), Buffer.from(m2).toString('hex'));
  assert.strictEqual(m1.length, 32);

  console.log('✓ test_profile_seed_derivation passed');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});

