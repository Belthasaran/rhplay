#!/usr/bin/env node

/**
 * test-help-doc-resolver.js - Tests for electron/utils/help-doc-resolver.js
 * Run: node tests/test-help-doc-resolver.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  HELP_DOC_IDS,
  resolveHelpDocPath,
  getHelpDocFilename,
} = require('../electron/utils/help-doc-resolver');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) {
    failed += 1;
    console.error(`✗ ${message}`);
    return false;
  }
  passed += 1;
  console.log(`✓ ${message}`);
  return true;
}

assert(getHelpDocFilename('retroarch') === 'RETROARCH_SETUP.html', 'retroarch doc filename');
assert(getHelpDocFilename('bizhawk') === 'BIZHAWK_SETUP.html', 'bizhawk doc filename');
assert(HELP_DOC_IDS.retroarch === 'RETROARCH_SETUP.html', 'HELP_DOC_IDS retroarch');

const devPath = resolveHelpDocPath('retroarch');
assert(devPath && fs.existsSync(devPath), 'resolveHelpDocPath finds RETROARCH_SETUP.html in dev tree');

const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'help-doc-test-'));
const fakeResources = path.join(tmpBase, 'resources');
const helpDir = path.join(fakeResources, 'help');
fs.mkdirSync(helpDir, { recursive: true });
const fakeHtml = path.join(helpDir, 'BIZHAWK_SETUP.html');
fs.writeFileSync(fakeHtml, '<html><body>test</body></html>');

const savedResourcesPath = process.resourcesPath;
process.resourcesPath = fakeResources;
const packagedPath = resolveHelpDocPath('bizhawk');
process.resourcesPath = savedResourcesPath;

assert(packagedPath === fakeHtml, 'resolveHelpDocPath finds packaged help under resources/help');

try {
  fs.rmSync(tmpBase, { recursive: true, force: true });
} catch (_) {}

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
