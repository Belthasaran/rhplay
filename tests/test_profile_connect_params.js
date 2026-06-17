#!/usr/bin/env node

const assert = require('assert');
const crypto = require('crypto');
const { finalizeEvent, generateSecretKey } = require('nostr-tools');
const {
  buildProfileConnectParams,
  buildSignedProfileConnectParams,
  buildConnectMessage
} = require('../lib/profile-connect-params');

async function run() {
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

  const sk = generateSecretKey();
  const signNostrMessage = async (message) => finalizeEvent({
    kind: 1,
    created_at: Math.floor(Date.now() / 1000),
    tags: [],
    content: message
  }, sk);

  const signed = await buildSignedProfileConnectParams(profile, null, { signNostrMessage });
  assert.ok(signed.connect_ts);
  assert.ok(signed.connect_event);
  const event = JSON.parse(Buffer.from(signed.connect_event, 'base64url').toString('utf8'));
  const expected = buildConnectMessage({
    profile_uuid: signed.profile_uuid,
    nostr_pubkey: signed.nostr_pubkey,
    mldsa_pubkey_sha256: signed.mldsa_pubkey_sha256,
    connect_ts: signed.connect_ts
  });
  assert.strictEqual(event.content, expected);

  assert.throws(() => buildProfileConnectParams(null), /Profile not found/);
  console.log('✓ test_profile_connect_params passed');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
