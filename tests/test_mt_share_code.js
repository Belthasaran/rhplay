#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
  parseShareCode,
  parseLegacyPayload,
  parseModernEntries,
  parseFlags,
  encodeIk1ShareCode,
  formatShareCodeError,
} = require('../electron/shared/mt-share-code');

const TEST_SHA1 = 'a'.repeat(40);

function testIk1Legacy() {
  const code = encodeIk1ShareCode(`${TEST_SHA1}:105,13B|${'b'.repeat(40)}:201`);
  const result = parseShareCode(code);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.format, 'ik1');
  assert.strictEqual(result.entries.length, 2);
  assert.strictEqual(result.entries[0].sha1, TEST_SHA1);
  assert.deepStrictEqual(result.entries[0].levels, ['105', '13B']);
}

function testIk4DEntry() {
  const payload = `d${TEST_SHA1}:105,13B`;
  const plaintext = `ik4|My%20Run|s|${payload}`;
  const code = Buffer.from(plaintext, 'utf8').toString('base64');
  const result = parseShareCode(code);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.format, 'ik4');
  assert.strictEqual(result.name, 'My Run');
  assert.strictEqual(result.flags.switchPalaces, true);
  assert.strictEqual(result.entries[0].source, 'smwdb');
  assert.strictEqual(result.entries[0].sha1, TEST_SHA1);
}

function testIk5FreePlay() {
  const payload = `d${TEST_SHA1}:105`;
  const plaintext = `ik5|Run|o|${payload}`;
  const code = Buffer.from(plaintext, 'utf8').toString('base64');
  const result = parseShareCode(code);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.flags.freePlay, true);
}

function testIk6Options() {
  const opts = Buffer.from(JSON.stringify({
    openGraph: { edges: [[0, 1]], locks: [] },
    goal: 'hundred',
  }), 'utf8').toString('base64');
  const payload = `d${TEST_SHA1}:105`;
  const plaintext = `ik4|x|s|${payload}`;
  const ik6 = `ik6|Marathon|so|${opts}|${payload}`;
  const code = Buffer.from(ik6, 'utf8').toString('base64');
  const result = parseShareCode(code);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.format, 'ik6');
  assert.strictEqual(result.flags.switchPalaces, true);
  assert.strictEqual(result.flags.freePlay, true);
  assert.ok(result.options.openGraph);
  assert.strictEqual(result.options.goal, 'hundred');
}

function testSmwcEntry() {
  const entries = parseModernEntries('c42550:105,13B');
  assert.strictEqual(entries.length, 1);
  assert.strictEqual(entries[0].source, 'smwc');
  assert.strictEqual(entries[0].fileId, 42550);
}

function testInvalidBase64() {
  const result = parseShareCode('not!!!base64');
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.error.kind, 'invalid-base64');
}

function testEmptyPayload() {
  const code = encodeIk1ShareCode('');
  const result = parseShareCode(code);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.error.kind, 'no-hacks');
}

function testUnsupportedFormat() {
  const code = Buffer.from('legacy|foo', 'utf8').toString('base64');
  const result = parseShareCode(code);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.error.kind, 'unsupported-format');
}

function testLegacyParserRejectsBadSha1() {
  const entries = parseLegacyPayload('notasha1:105');
  assert.strictEqual(entries.length, 0);
}

function testFormatShareCodeError() {
  assert.ok(formatShareCodeError({ kind: 'invalid-base64' }).includes('base64'));
}

function main() {
  testIk1Legacy();
  testIk4DEntry();
  testIk5FreePlay();
  testIk6Options();
  testSmwcEntry();
  testInvalidBase64();
  testEmptyPayload();
  testUnsupportedFormat();
  testLegacyParserRejectsBadSha1();
  testFormatShareCodeError();
  console.log('test_mt_share_code: ok');
}

main();
