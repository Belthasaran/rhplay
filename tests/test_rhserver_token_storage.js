#!/usr/bin/env node

const assert = require('assert');
const crypto = require('crypto');
const { decodeJwtExp } = require('../lib/jwt-exp');
const { RHServerClient, ACCESS_TOKEN_SKEW_SEC } = require('../lib/rhserver-client');

function makeJwt(exp) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ exp, sub: 'profile-1' })).toString('base64url');
  return `${header}.${payload}.sig`;
}

function run() {
  const exp = Math.floor(Date.now() / 1000) + 7200;
  const token = makeJwt(exp);
  assert.strictEqual(decodeJwtExp(token), exp);
  assert.strictEqual(decodeJwtExp('not-a-jwt'), null);

  const client = new RHServerClient({ apiBaseUrl: 'http://localhost:3000' });
  client._applyTokenResponse({
    access_token: token,
    refresh_token: 'refresh-hex',
    expires_in: 3600
  }, 'profile-uuid-1');

  assert.strictEqual(client.accessExpiresAt, exp);
  assert.strictEqual(client.profileUuid, 'profile-uuid-1');
  assert.strictEqual(client.isAccessExpired(exp - 100), false);
  assert.strictEqual(client.isAccessExpired(exp + ACCESS_TOKEN_SKEW_SEC + 1), true);

  let updated = false;
  client.onTokensUpdated = () => { updated = true; };
  client._applyTokenResponse({
    access_token: makeJwt(exp + 5000),
    refresh_token: 'refresh-2',
    expires_in: 3600
  });
  assert.strictEqual(updated, true);

  console.log('✓ test_rhserver_token_storage passed');
}

run();
