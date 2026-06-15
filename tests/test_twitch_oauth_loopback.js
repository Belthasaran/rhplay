#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
  buildTwitchImplicitAuthUrl,
  parseImplicitGrantFragment,
} = require('../electron/utils/twitch-oauth-loopback');
const {
  TWITCH_OAUTH_LOOPBACK_PORT,
  TWITCH_OAUTH_LOOPBACK_PORTS,
  getTwitchLoopbackRedirectUri,
} = require('../electron/twitch-config');

function testLoopbackConfig() {
  assert.deepStrictEqual(TWITCH_OAUTH_LOOPBACK_PORTS, [47832, 56218, 51158]);
  assert.strictEqual(TWITCH_OAUTH_LOOPBACK_PORT, 47832);
  assert.strictEqual(getTwitchLoopbackRedirectUri(), 'http://localhost:47832/');
  assert.strictEqual(getTwitchLoopbackRedirectUri(56218), 'http://localhost:56218/');
  assert.strictEqual(getTwitchLoopbackRedirectUri(51158), 'http://localhost:51158/');
}

function testBuildAuthUrl() {
  const url = buildTwitchImplicitAuthUrl({
    clientId: 'test-client',
    redirectUri: 'http://localhost:56218/',
    state: 'state-123',
  });
  assert.ok(url.startsWith('https://id.twitch.tv/oauth2/authorize?'));
  assert.ok(url.includes(encodeURIComponent('http://localhost:56218/')));
}

function testParseFragment() {
  const hash = 'access_token=abc123&token_type=bearer&state=state-123';
  const parsed = parseImplicitGrantFragment(hash, 'state-123');
  assert.strictEqual(parsed.accessToken, 'abc123');

  assert.throws(
    () => parseImplicitGrantFragment(hash, 'wrong-state'),
    /state mismatch/
  );

  const fromUrl = parseImplicitGrantFragment(
    'http://localhost:47832/#access_token=xyz&token_type=bearer&state=state-123',
    'state-123'
  );
  assert.strictEqual(fromUrl.accessToken, 'xyz');
}

function main() {
  testLoopbackConfig();
  testBuildAuthUrl();
  testParseFragment();
  console.log('test_twitch_oauth_loopback: ok');
}

main();
