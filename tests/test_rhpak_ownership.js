#!/usr/bin/env node

/**
 * test_rhpak_ownership.js - Unit tests for lib/rhpak-ownership.js
 */

const assert = require('assert');
const rhpakOwnership = require('../lib/rhpak-ownership');

function testSingleOwnerFields() {
  const fields = rhpakOwnership.singleOwnerFields('uuid-a');
  assert.strictEqual(fields.rhpakuuid, 'uuid-a');
  assert.strictEqual(fields.rhpakuuid2, '["uuid-a"]');
}

function testSetPrimaryOwnerLinksPrevious() {
  const current = { rhpakuuid: 'old', rhpakuuid2: '["old"]' };
  const next = rhpakOwnership.setPrimaryOwner(current, 'new');
  assert.strictEqual(next.rhpakuuid, 'new');
  assert.deepStrictEqual(JSON.parse(next.rhpakuuid2), ['new', 'old']);
}

function testRemoveOwnerPromotesPrimary() {
  const current = { rhpakuuid: 'a', rhpakuuid2: '["a","b"]' };
  const next = rhpakOwnership.removeOwner(current, 'a');
  assert.strictEqual(next.shouldDeleteRow, false);
  assert.strictEqual(next.rhpakuuid, 'b');
  assert.deepStrictEqual(JSON.parse(next.rhpakuuid2), ['b']);
}

function testRemoveOwnerDeletesWhenEmpty() {
  const current = { rhpakuuid: 'a', rhpakuuid2: '["a"]' };
  const next = rhpakOwnership.removeOwner(current, 'a');
  assert.strictEqual(next.shouldDeleteRow, true);
}

function testOwnershipBlockReason() {
  const existing = { rhpakuuid: 'owner-a', rhpakuuid2: '["owner-a"]' };
  const reason = rhpakOwnership.getOwnershipBlockReason(existing, 'owner-b', 'Resource file test.bps');
  assert.ok(reason.includes('owner-a'));
  assert.ok(reason.includes('owner-b'));
}

function main() {
  testSingleOwnerFields();
  testSetPrimaryOwnerLinksPrevious();
  testRemoveOwnerPromotesPrimary();
  testRemoveOwnerDeletesWhenEmpty();
  testOwnershipBlockReason();
  console.log('✅ test_rhpak_ownership passed');
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`❌ test_rhpak_ownership failed: ${error.message}`);
    process.exit(1);
  }
}

module.exports = { main };
