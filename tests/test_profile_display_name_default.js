#!/usr/bin/env node

const assert = require('assert');

function defaultDisplayNameFromUsername(username) {
  if (!username) return '';
  if (/^[a-zA-Z]/.test(username)) return username.charAt(0).toUpperCase() + username.slice(1);
  return username;
}

function run() {
  assert.strictEqual(defaultDisplayNameFromUsername(''), '');
  assert.strictEqual(defaultDisplayNameFromUsername('myuser'), 'Myuser');
  assert.strictEqual(defaultDisplayNameFromUsername('Myuser'), 'Myuser');
  assert.strictEqual(defaultDisplayNameFromUsername('_user'), '_user');
  assert.strictEqual(defaultDisplayNameFromUsername('1user'), '1user');
  console.log('✓ test_profile_display_name_default passed');
}

run();

