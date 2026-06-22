#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  checkForDatabaseUpdates,
  getDatabaseProvisionStatus,
  resolveUpdateContext
} = require('../electron/utils/database-update-check');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'db-chain-check-'));
const userDataDir = path.join(tmp, 'userdata');
fs.mkdirSync(userDataDir, { recursive: true });

const manifest = {
  lastupdated: '1',
  'patchbin.db': {
    version: '14',
    'version:light': '3',
    base: { file_name: 'full.tar.xz', sha256: 'fullhash' },
    'base:light': { file_name: 'light.xz', sha256: 'lighthash' },
    sqlpatches: [{ file_name: 'pbin13_to_14.sql.xz', version_before: '13' }],
    'sqlpatches:light': [{ file_name: 'pbinL2_to_3.sql.xz', version_before: '2' }]
  },
  'rhdata.db': {
    version: '14',
    base: { file_name: 'rhdata.tar.xz', sha256: 'rhdatahash' },
    sqlpatches: []
  },
  'resource.db': { version: '14', base: { file_name: 'res.xz', sha256: 'reshash' }, sqlpatches: [] },
  'screenshot.db': { version: '14', base: { file_name: 'ss.xz', sha256: 'sshash' }, sqlpatches: [] }
};

fs.writeFileSync(path.join(tmp, 'dbmanifest.json'), JSON.stringify(manifest, null, 2));
fs.writeFileSync(
  path.join(userDataDir, 'provisioned.json'),
  JSON.stringify({
    targets: {
      'patchbin.db': { version: '13', chain: 'full', timestamp: '1' },
      'rhdata.db': { version: '13', chain: 'light', timestamp: '1' }
    },
    hashdata: { sha256: null }
  }),
  'utf8'
);

process.env.RHDATA_DB_PATH = path.join(userDataDir, 'rhdata.db');
process.env.PATCHBIN_DB_PATH = path.join(userDataDir, 'patchbin.db');

const manifestResolver = require('../electron/utils/manifest-resolver');
const origGetUserData = manifestResolver.getUserDataDir;
const origLoad = manifestResolver.loadDbmanifest;
manifestResolver.getUserDataDir = () => userDataDir;
manifestResolver.loadDbmanifest = () => manifest;

const fullCtx = resolveUpdateContext(manifest['patchbin.db'], { version: '13', chain: 'full' });
assert.strictEqual(fullCtx.targetVersion, '14');
assert.strictEqual(fullCtx.sqlpatches[0].file_name, 'pbin13_to_14.sql.xz');
assert.ok(!fullCtx.error);

const lightCtx = resolveUpdateContext(manifest['patchbin.db'], { version: '2', chain: 'light' });
assert.strictEqual(lightCtx.targetVersion, '3');
assert.ok(!lightCtx.error);

// rhdata-style shared shortcut with chain: light in provisioned.json
const rhdataCtx = resolveUpdateContext(manifest['rhdata.db'], { version: '13', chain: 'light' });
assert.ok(!rhdataCtx.error);
assert.strictEqual(rhdataCtx.targetVersion, '14');
assert.strictEqual(rhdataCtx.chainView.sharedChainShortcut, true);
assert.strictEqual(rhdataCtx.sqlpatches.length, 0);

const updates = checkForDatabaseUpdates();
assert.ok(updates.updatesAvailable);
const pbinUpdate = updates.updates.find((u) => u.dbName === 'patchbin.db');
assert.ok(pbinUpdate);
assert.strictEqual(pbinUpdate.chain, 'full');

const rhdataUpdate = updates.updates.find((u) => u.dbName === 'rhdata.db');
assert.ok(rhdataUpdate);
assert.strictEqual(rhdataUpdate.chain, 'light');

const status = getDatabaseProvisionStatus();
const row = status.rows.find((r) => r.dbName === 'patchbin.db');
assert.strictEqual(row.chain, 'full');
assert.strictEqual(row.chainLabel, 'full (explicit)');

const rhdataRow = status.rows.find((r) => r.dbName === 'rhdata.db');
assert.strictEqual(rhdataRow.chain, 'light');
assert.strictEqual(rhdataRow.status, 'update-available');

manifestResolver.getUserDataDir = origGetUserData;
manifestResolver.loadDbmanifest = origLoad;
fs.rmSync(tmp, { recursive: true, force: true });
console.log('✓ database-update-check chain awareness');
