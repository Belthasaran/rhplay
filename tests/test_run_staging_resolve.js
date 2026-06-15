#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
  isRunStagedSfcFilename,
  sortRunStagedSfcFilenames,
  resolveRunStagedSfcFilename,
} = require('../electron/run-staging-resolve');

function testIsRunStagedSfcFilename() {
  assert.strictEqual(isRunStagedSfcFilename('01_1781492846.sfc'), true);
  assert.strictEqual(isRunStagedSfcFilename('03_1781492846_1lvno01.sfc'), true);
  assert.strictEqual(isRunStagedSfcFilename('02.sfc'), true);
  assert.strictEqual(isRunStagedSfcFilename('runinfo.json'), false);
  assert.strictEqual(isRunStagedSfcFilename('sm12345.sfc'), false);
}

function testResolveRunStagedSfcFilename() {
  const files = [
    'runinfo.json',
    '04_1781492852_1lvno01.sfc',
    '01_1781492846.sfc',
    '03_1781492846_1lvno01.sfc',
    '02_1781492846.sfc',
  ];

  assert.strictEqual(resolveRunStagedSfcFilename(files, 0), '01_1781492846.sfc');
  assert.strictEqual(resolveRunStagedSfcFilename(files, 1), '02_1781492846.sfc');
  assert.strictEqual(resolveRunStagedSfcFilename(files, 2), '03_1781492846_1lvno01.sfc');
  assert.strictEqual(resolveRunStagedSfcFilename(files, 3), '04_1781492852_1lvno01.sfc');
  assert.strictEqual(resolveRunStagedSfcFilename(files, 4), null);
}

function testLegacyFilenames() {
  const files = ['01.sfc', '02.sfc', '03.sfc'];
  assert.strictEqual(resolveRunStagedSfcFilename(files, 1), '02.sfc');
}

function main() {
  testIsRunStagedSfcFilename();
  testResolveRunStagedSfcFilename();
  testLegacyFilenames();
  console.log('test_run_staging_resolve: ok');
}

main();
