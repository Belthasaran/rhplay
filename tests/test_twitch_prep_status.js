#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
  isTwitchIntegrationConnected,
  getTwitchPrepStatusLabel,
  prepModeFromPredictionState,
  predictionStateFromPrepMode,
  templateTypeForPrepMode,
  canEnableTwitchPredictions,
  restrictedPrepPredictionsMode,
} = require('../electron/shared/twitch-prep-status');

function testIntegrationConnected() {
  assert.strictEqual(isTwitchIntegrationConnected(null), false);
  assert.strictEqual(isTwitchIntegrationConnected({}), false);
  assert.strictEqual(isTwitchIntegrationConnected({ is_active: false }), false);
  assert.strictEqual(
    isTwitchIntegrationConnected({ twitch_username: 'streamer', is_active: false }),
    true
  );
  assert.strictEqual(
    isTwitchIntegrationConnected({ twitch_user_id: '123', is_active: true }),
    true
  );
}

function testStatusLabels() {
  assert.strictEqual(
    getTwitchPrepStatusLabel({ twitchIntegrationConnected: false, twitchTokenValid: false, prepPredictionsMode: 'none' }),
    '(Off)'
  );
  assert.strictEqual(
    getTwitchPrepStatusLabel({ twitchIntegrationConnected: false, twitchTokenValid: true, prepPredictionsMode: 'same_item' }),
    '(Off)'
  );
  assert.strictEqual(
    getTwitchPrepStatusLabel({ twitchIntegrationConnected: true, twitchTokenValid: false, prepPredictionsMode: 'none' }),
    '(Needs refresh)'
  );
  assert.strictEqual(
    getTwitchPrepStatusLabel({ twitchIntegrationConnected: true, twitchTokenValid: false, prepPredictionsMode: 'same_item' }),
    '(Needs refresh)'
  );
  assert.strictEqual(
    getTwitchPrepStatusLabel({ twitchIntegrationConnected: true, twitchTokenValid: true, prepPredictionsMode: 'none' }),
    '(Ready)'
  );
  assert.strictEqual(
    getTwitchPrepStatusLabel({ twitchIntegrationConnected: true, twitchTokenValid: true, prepPredictionsMode: 'same_item' }),
    '(On, Per-Item)'
  );
  assert.strictEqual(
    getTwitchPrepStatusLabel({ twitchIntegrationConnected: true, twitchTokenValid: true, prepPredictionsMode: 'whole_challenge' }),
    '(On, Per-Run)'
  );
}

function testModeMapping() {
  assert.strictEqual(prepModeFromPredictionState(false, 'same_item'), 'none');
  assert.strictEqual(prepModeFromPredictionState(true, 'same_item'), 'same_item');
  assert.strictEqual(prepModeFromPredictionState(true, 'next_item'), 'none');

  assert.deepStrictEqual(predictionStateFromPrepMode('none'), { enabled: false, operationalMode: null });
  assert.deepStrictEqual(predictionStateFromPrepMode('same_item'), { enabled: true, operationalMode: 'same_item' });
  assert.deepStrictEqual(predictionStateFromPrepMode('whole_challenge'), { enabled: true, operationalMode: 'whole_challenge' });

  assert.strictEqual(templateTypeForPrepMode('same_item'), 'individual_item');
  assert.strictEqual(templateTypeForPrepMode('whole_challenge'), 'whole_challenge');
  assert.strictEqual(templateTypeForPrepMode('none'), null);
}

function testPredictionRestriction() {
  assert.strictEqual(
    canEnableTwitchPredictions({ connected: false, tokenValid: false }),
    false
  );
  assert.strictEqual(
    canEnableTwitchPredictions({ connected: true, tokenValid: false }),
    false
  );
  assert.strictEqual(
    canEnableTwitchPredictions({ connected: false, tokenValid: true }),
    false
  );
  assert.strictEqual(
    canEnableTwitchPredictions({ connected: true, tokenValid: true }),
    true
  );

  assert.strictEqual(restrictedPrepPredictionsMode('same_item', false), 'none');
  assert.strictEqual(restrictedPrepPredictionsMode('whole_challenge', false), 'none');
  assert.strictEqual(restrictedPrepPredictionsMode('none', false), 'none');
  assert.strictEqual(restrictedPrepPredictionsMode('same_item', true), 'same_item');
  assert.strictEqual(restrictedPrepPredictionsMode('whole_challenge', true), 'whole_challenge');
}

function main() {
  testIntegrationConnected();
  testStatusLabels();
  testModeMapping();
  testPredictionRestriction();
  console.log('test_twitch_prep_status: ok');
}

main();
