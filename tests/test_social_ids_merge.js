#!/usr/bin/env node

const assert = require('assert');
const { mergeSocialIds, isVerified } = require('../lib/social-ids-merge');

function testVerifiedWins() {
  const local = [{ type: 'github', value: 'local', verified: false, addedAt: 100 }];
  const remote = [{ type: 'github', value: 'remote', verified: true, addedAt: 50 }];
  const merged = mergeSocialIds(local, remote);
  assert.strictEqual(merged.length, 1);
  assert.strictEqual(merged[0].value, 'remote');
}

function testAddedAtRecency() {
  const local = [{ type: 'github', value: 'old', verified: false, addedAt: 100 }];
  const remote = [{ type: 'github', value: 'new', verified: false, addedAt: 200 }];
  const merged = mergeSocialIds(local, remote);
  assert.strictEqual(merged[0].value, 'new');
}

function testAttestationRecency() {
  const local = [{
    type: 'twitch',
    value: 'a',
    smwresourceAttestation: { attestedAt: 100 }
  }];
  const remote = [{
    type: 'twitch',
    value: 'b',
    smwresourceAttestation: { attestedAt: 200 }
  }];
  const merged = mergeSocialIds(local, remote);
  assert.strictEqual(merged[0].value, 'b');
}

function testSmwresourceEnsured() {
  const merged = mergeSocialIds([{ type: 'github', value: 'x' }], [], {
    smwresourceValue: 'profile-uuid-1'
  });
  assert.ok(merged.some((s) => s.type === 'smwresource' && s.value === 'profile-uuid-1'));
}

function testPreservesAttestation() {
  const local = [{ type: 'discord', value: 'u1', smwresourceAttestation: { attestedAt: 50 } }];
  const remote = [{ type: 'discord', value: 'u2', verified: true, addedAt: 1 }];
  const merged = mergeSocialIds(local, remote);
  assert.strictEqual(merged[0].value, 'u2');
  assert.ok(merged[0].smwresourceAttestation);
}

assert.strictEqual(isVerified({ verified: true }), true);
assert.strictEqual(isVerified({ clientVerificationStatus: 'confirmed' }), true);

testVerifiedWins();
testAddedAtRecency();
testAttestationRecency();
testSmwresourceEnsured();
testPreservesAttestation();

console.log('test_social_ids_merge (rhplay): ok');
