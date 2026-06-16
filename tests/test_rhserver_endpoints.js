#!/usr/bin/env node

const assert = require('assert');
const {
  resolveEndpoints,
  getApiBaseUrl,
  getWebBaseUrl,
  getConnectUrl
} = require('../lib/rhserver-endpoints');

function run() {
  const release = resolveEndpoints('Off');
  assert.strictEqual(release.api, 'https://api.smwresource.net');
  assert.strictEqual(release.web, 'https://smwresource.net');
  assert.strictEqual(release.admin, 'https://admin.smwresource.net');

  const disabled = resolveEndpoints('Disabled');
  assert.deepStrictEqual(disabled, release);

  const testing = resolveEndpoints('On');
  assert.strictEqual(testing.api, 'http://localhost:3000');
  assert.strictEqual(testing.web, 'http://localhost:3000');
  assert.strictEqual(testing.admin, 'http://localhost:3000/admin');

  assert.strictEqual(getApiBaseUrl('On'), 'http://localhost:3000');
  assert.strictEqual(getApiBaseUrl('Off'), 'https://api.smwresource.net');
  assert.strictEqual(getWebBaseUrl('On'), 'http://localhost:3000');

  const connectOn = getConnectUrl('On', 'profile_uuid=abc&username=u');
  assert.strictEqual(connectOn, 'http://localhost:3000/connect/rhplay?profile_uuid=abc&username=u');

  const connectOff = getConnectUrl('Off', 'profile_uuid=abc');
  assert.strictEqual(connectOff, 'https://smwresource.net/connect/rhplay?profile_uuid=abc');

  console.log('✓ test_rhserver_endpoints passed');
}

run();
