#!/usr/bin/env node

/**
 * test_retroarch_append_config.js - Tests for electron/utils/retroarch-append-config.js
 * Run: node tests/test_retroarch_append_config.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const tempUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'rhtools-append-test-'));
process.env.RHTOOLS_USER_DATA_OVERRIDE = tempUserData;

const manifestResolver = require('../electron/utils/manifest-resolver');
const originalGetUserDataDir = manifestResolver.getUserDataDir;
manifestResolver.getUserDataDir = () => tempUserData;

const appendConfig = require('../electron/utils/retroarch-append-config');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) {
    failed += 1;
    console.error(`FAIL: ${message}`);
    return false;
  }
  passed += 1;
  console.log(`PASS: ${message}`);
  return true;
}

const ensuredPath = appendConfig.ensureAppendConfig();
assert(fs.existsSync(ensuredPath), 'ensureAppendConfig creates append.cfg');
assert(ensuredPath === appendConfig.getAppendConfigPath(), 'ensureAppendConfig path matches getAppendConfigPath');

const readResult = appendConfig.readAppendConfig();
assert(typeof readResult.content === 'string' && readResult.content.length > 0, 'readAppendConfig returns content');
assert(readResult.content.includes('network_cmd_enable'), 'default content includes network_cmd_enable');

appendConfig.writeAppendConfig('custom_test_value = "true"\n');
const afterWrite = appendConfig.readAppendConfig();
assert(afterWrite.content.includes('custom_test_value'), 'writeAppendConfig persists changes');

const restoredPath = appendConfig.restoreAppendConfigDefault();
const afterRestore = appendConfig.readAppendConfig();
assert(restoredPath === ensuredPath, 'restoreAppendConfigDefault returns same path');
assert(!afterRestore.content.includes('custom_test_value'), 'restoreAppendConfigDefault resets content');
assert(afterRestore.content.includes('network_cmd_enable'), 'restored content matches template');

const templatePath = appendConfig.resolveTemplatePath();
assert(templatePath && fs.existsSync(templatePath), 'resolveTemplatePath finds bundled template');

fs.writeFileSync(ensuredPath, '');
const afterEmptyEnsure = appendConfig.ensureAppendConfig();
const afterEmptyRead = appendConfig.readAppendConfig();
assert(afterEmptyEnsure === ensuredPath, 'ensureAppendConfig re-seeds empty file');
assert(afterEmptyRead.content.includes('network_cmd_enable'), 'ensureAppendConfig restores template when file empty');

console.log(`\nDone: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
