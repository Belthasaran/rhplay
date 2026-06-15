#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
  normalizePredictionsTemplate,
  mergePredictionsTemplate,
  getDefaultPredictionsTemplate,
} = require('../electron/shared/twitch-predictions-template');

function testDefaultsIncludeAllModes() {
  const t = getDefaultPredictionsTemplate();
  assert.strictEqual(t.type, 'whole_challenge');
  assert.ok(t.wholeChallenge);
  assert.ok(t.individualItem.yesNo);
  assert.ok(t.individualItem.timeRange);
}

function testNormalizeFillsMissingSections() {
  const t = normalizePredictionsTemplate({ type: 'individual_item' });
  assert.strictEqual(t.type, 'individual_item');
  assert.strictEqual(t.wholeChallenge.outcomeCount, 5);
  assert.strictEqual(t.individualItem.yesNo.windowSeconds, 30);
  assert.strictEqual(t.individualItem.timeRange.outcomeCount, 5);
}

function testMergePreservesInactiveModeSettings() {
  const existing = mergePredictionsTemplate(null, {
    type: 'whole_challenge',
    wholeChallenge: {
      outcomeCount: 7,
      customTitle: 'Whole run title',
    },
    individualItem: {
      predictionType: 'time_range',
      timeRange: {
        customTitle: 'Time range title',
        outcomeCount: 6,
      },
    },
  });

  const switched = mergePredictionsTemplate(existing, {
    type: 'individual_item',
    individualItem: {
      predictionType: 'yes_no',
      yesNo: {
        customTitle: 'Win lose title',
        windowSeconds: 45,
      },
    },
  });

  assert.strictEqual(switched.type, 'individual_item');
  assert.strictEqual(switched.wholeChallenge.outcomeCount, 7);
  assert.strictEqual(switched.wholeChallenge.customTitle, 'Whole run title');
  assert.strictEqual(switched.individualItem.timeRange.customTitle, 'Time range title');
  assert.strictEqual(switched.individualItem.timeRange.outcomeCount, 6);
  assert.strictEqual(switched.individualItem.yesNo.customTitle, 'Win lose title');
  assert.strictEqual(switched.individualItem.yesNo.windowSeconds, 45);
}

function testCustomTitlesAreSeparate() {
  const t = mergePredictionsTemplate(null, {
    type: 'individual_item',
    wholeChallenge: { customTitle: 'A' },
    individualItem: {
      yesNo: { customTitle: 'B' },
      timeRange: { customTitle: 'C' },
    },
  });
  assert.strictEqual(t.wholeChallenge.customTitle, 'A');
  assert.strictEqual(t.individualItem.yesNo.customTitle, 'B');
  assert.strictEqual(t.individualItem.timeRange.customTitle, 'C');
}

function main() {
  testDefaultsIncludeAllModes();
  testNormalizeFillsMissingSections();
  testMergePreservesInactiveModeSettings();
  testCustomTitlesAreSeparate();
  console.log('test_twitch_predictions_template: ok');
}

main();
