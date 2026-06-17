#!/usr/bin/env node

const assert = require('assert');
const crypto = require('crypto');
const { buildProfileConnectParams } = require('../lib/profile-connect-params');

function run() {
  const mldsaHex = 'a'.repeat(64);
  const expectedSha = crypto.createHash('sha256').update(Buffer.from(mldsaHex, 'hex')).digest('hex');

  const profile = {
    profileId: '11111111-1111-4111-8111-111111111111',
    username: 'TestUser',
    primaryKeypair: {
      type: 'Nostr',
      publicKeyHex: 'b'.repeat(64)
    },
    additionalKeypairs: [
      {
        type: 'ML-DSA-44',
        publicKeyHex: mldsaHex
      }
    ]
  };

  const params = buildProfileConnectParams(profile);
  assert.strictEqual(params.profile_uuid, profile.profileId);
  assert.strictEqual(params.username, 'testuser');
  assert.strictEqual(params.nostr_pubkey, profile.primaryKeypair.publicKeyHex);
  assert.strictEqual(params.mldsa_pubkey_sha256, expectedSha);

  assert.throws(() => buildProfileConnectParams(null), /Profile not found/);
  assert.throws(() => buildProfileConnectParams({ profileId: 'x', username: 'u' }), /Nostr primary keypair/);
  assert.throws(() => buildProfileConnectParams({
    profileId: 'x',
    username: 'user',
    primaryKeypair: { type: 'Nostr', publicKeyHex: 'aa' }
  }), /ML-DSA-44/);

  console.log('✓ test_profile_connect_params passed');
}

run();
