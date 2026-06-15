#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
  TWITCH_VALIDATION_CACHE_MS,
  shouldContactTwitchForValidation,
  isTwitchIntegrationRowConnected,
  deriveTwitchConnectionState,
} = require('../electron/shared/twitch-token-validation');

function testCachePolicy() {
  const now = 1_700_000_000_000;

  assert.strictEqual(TWITCH_VALIDATION_CACHE_MS, 10 * 60 * 1000);

  assert.strictEqual(
    shouldContactTwitchForValidation({ force: true, validatedThisSession: true, lastValidatedAt: now, now }),
    true
  );

  assert.strictEqual(
    shouldContactTwitchForValidation({ validatedThisSession: false, lastValidatedAt: now, now }),
    true
  );

  assert.strictEqual(
    shouldContactTwitchForValidation({ validatedThisSession: true, lastValidatedAt: 0, now }),
    true
  );

  assert.strictEqual(
    shouldContactTwitchForValidation({
      validatedThisSession: true,
      lastValidatedAt: now - TWITCH_VALIDATION_CACHE_MS - 1,
      now,
    }),
    true
  );

  assert.strictEqual(
    shouldContactTwitchForValidation({
      validatedThisSession: true,
      lastValidatedAt: now - 60_000,
      now,
    }),
    false
  );
}

function testRowConnected() {
  assert.strictEqual(isTwitchIntegrationRowConnected(null), false);
  assert.strictEqual(isTwitchIntegrationRowConnected({}), false);
  assert.strictEqual(
    isTwitchIntegrationRowConnected({ twitch_username: 'streamer', is_active: false }),
    true
  );
}

function testDeriveState() {
  assert.deepStrictEqual(
    deriveTwitchConnectionState({ statusRow: null }),
    { connected: false, valid: false, needsRefresh: false }
  );

  assert.deepStrictEqual(
    deriveTwitchConnectionState({
      statusRow: { twitch_username: 'streamer', is_active: true },
      validationResult: { valid: true },
    }),
    { connected: true, valid: true, needsRefresh: false }
  );

  assert.deepStrictEqual(
    deriveTwitchConnectionState({
      statusRow: { twitch_username: 'streamer', is_active: false },
      validationResult: { valid: false, needsReauth: true },
    }),
    { connected: true, valid: false, needsRefresh: true }
  );

  assert.deepStrictEqual(
    deriveTwitchConnectionState({
      statusRow: { twitch_username: 'streamer', is_active: true },
      validationResult: { valid: false },
      isActive: false,
    }),
    { connected: true, valid: false, needsRefresh: true }
  );
}

function main() {
  testCachePolicy();
  testRowConnected();
  testDeriveState();
  console.log('test_twitch_token_validation: ok');
}

main();
