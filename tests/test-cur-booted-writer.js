/**
 * test-cur-booted-writer.js - Tests for lib/cur-booted-writer.js
 * Run: node tests/test-cur-booted-writer.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { writeCurBooted, buildCurBootedHtmlLine } = require('../lib/cur-booted-writer');

function testHtmlWithLevel() {
  const line = buildCurBootedHtmlLine({
    gameid: 27094,
    name: 'Akogare 2',
    authors: 'Author A',
    stage: { levelnumber: '004', difficulty: 5 }
  });
  assert.strictEqual(line, '27094 - 004 - Akogare 2 - Author A - (5 Xpert)');
}

function testHtmlGameOnly() {
  const line = buildCurBootedHtmlLine({
    gameid: 123,
    name: 'Test Game',
    authors: 'A, B'
  });
  assert.strictEqual(line, '123 - Test Game - A, B');
}

function testHtmlFilenameOnly() {
  const line = buildCurBootedHtmlLine({
    sfc_basename: 'smw27094_1.sfc'
  });
  assert.strictEqual(line, 'smw27094_1.sfc');
}

function testWriteFiles() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cur-booted-test-'));
  const result = writeCurBooted(tmpDir, {
    gameid: 99,
    name: 'Sample',
    authors: 'Dev',
    sfc_basename: 'smw99_1.sfc',
    launch_mode: 'auto'
  });
  assert.strictEqual(result.success, true);
  assert.ok(fs.existsSync(result.jsonPath));
  assert.ok(fs.existsSync(result.htmlPath));
  const json = JSON.parse(fs.readFileSync(result.jsonPath, 'utf8'));
  assert.strictEqual(json.gameid, 99);
  assert.strictEqual(json.launch_mode, 'auto');
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

const tests = [
  ['html with level', testHtmlWithLevel],
  ['html game only', testHtmlGameOnly],
  ['html filename only', testHtmlFilenameOnly],
  ['write files', testWriteFiles]
];

let passed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    passed += 1;
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}:`, error.message);
    process.exitCode = 1;
  }
}

console.log(`${passed}/${tests.length} tests passed`);
