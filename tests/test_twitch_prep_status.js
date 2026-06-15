#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
  getTwitchPrepStatusLabel,
  prepModeFromPredictionState,
  predictionStateFromPrepMode,
  templateTypeForPrepMode,
} = require('../electron/shared/twitch-prep-status');

function testStatusLabels() {
  assert.strictEqual(
    getTwitchPrepStatusLabel({ predictionsConfigured: false, twitchTokenValid: true, prepPredictionsMode: 'none' }),
    '(Off)'
  );
  assert.strictEqual(
    getTwitchPrepStatusLabel({ predictionsConfigured: true, twitchTokenValid: false, prepPredictionsMode: 'same_item' }),
    '(Off)'
  );
  assert.strictEqual(
    getTwitchPrepStatusLabel({ predictionsConfigured: true, twitchTokenValid: true, prepPredictionsMode: 'none' }),
    '(Ready)'
  );
  assert.strictEqual(
    getTwitchPrepStatusLabel({ predictionsConfigured: true, twitchTokenValid: true, prepPredictionsMode: 'same_item' }),
    '(On, Per-Item)'
  );
  assert.strictEqual(
    getTwitchPrepStatusLabel({ predictionsConfigured: true, twitchTokenValid: true, prepPredictionsMode: 'whole_challenge' }),
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

function main() {
  testStatusLabels();
  testModeMapping();
  console.log('test_twitch_prep_status: ok');
}

main();
