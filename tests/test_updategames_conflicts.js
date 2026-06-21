#!/usr/bin/env node

/**
 * test_updategames_conflicts.js
 *
 * Tests RHPAK conflict detection and ownership reassignment.
 * Uses isolated temp databases via environment variables.
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { spawnSync } = require('child_process');
const conflictChecker = require('../lib/rhpak-conflict-checker');

const TEST_DIR = path.join(__dirname, 'test_data', 'updategames_conflicts');
const RHPAK_A = '11111111-1111-1111-1111-111111111111';
const RHPAK_B = '22222222-2222-2222-2222-222222222222';
const FILE_SHA = 'abc123def456abc123def456abc123def456abc123def456abc123def456abcd';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function setupDatabases() {
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEST_DIR, { recursive: true });

  const rhdataPath = path.join(TEST_DIR, 'rhdata.db');
  const patchbinPath = path.join(TEST_DIR, 'patchbin.db');
  const resourcePath = path.join(TEST_DIR, 'resource.db');
  const screenshotPath = path.join(TEST_DIR, 'screenshot.db');

  const rhDb = new Database(rhdataPath);
  rhDb.exec(`
    CREATE TABLE rhpaks (
      rhpakuuid TEXT PRIMARY KEY,
      jsfilename TEXT NOT NULL,
      name TEXT NOT NULL,
      is_system INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE gameversions (
      gameid TEXT,
      version INTEGER,
      rhpakuuid TEXT,
      rhpakuuid2 TEXT,
      PRIMARY KEY (gameid, version)
    );
  `);
  rhDb.close();

  const resourceDb = new Database(resourcePath);
  resourceDb.exec(`
    CREATE TABLE res_attachments (
      rauuid TEXT PRIMARY KEY,
      file_name TEXT NOT NULL,
      file_sha256 TEXT,
      encrypted_data BLOB NOT NULL,
      fernet_key TEXT NOT NULL,
      rhpakuuid TEXT,
      rhpakuuid2 TEXT
    );
  `);
  resourceDb.close();

  fs.writeFileSync(patchbinPath, '');
  fs.writeFileSync(screenshotPath, '');

  return { rhdataPath, patchbinPath, resourcePath, screenshotPath };
}

function openDbs(paths) {
  return {
    rhdata: new Database(paths.rhdataPath),
    patchbin: new Database(paths.patchbinPath),
    resource: new Database(paths.resourcePath),
    screenshot: new Database(paths.screenshotPath),
  };
}

function writeSkeleton(gameFolder, rhpakuuid) {
  const gameid = path.basename(gameFolder);
  fs.mkdirSync(path.join(gameFolder, 'resources'), { recursive: true });
  const skeleton = {
    metadata: {
      prepared: true,
      rhpakuuid,
      rhpakname: `${gameid} test`,
      is_system: true,
    },
    gameversion: {
      gvuuid: 'gv-test-001',
      gameid,
      version: 1,
      rhpakuuid,
    },
    patchblob: {
      pbuuid: 'pb-test-001',
      patchblob1_name: `pblob_${gameid}`,
    },
    artifacts: {
      patch: {
        patch_relative_path: `patch/${gameid}.bps`,
      },
    },
    resources: [
      {
        resource_uuid: 'res-test-001',
        rhpakuuid,
        file_name: `${gameid}.bps`,
        file_sha256: FILE_SHA,
        fernet_key: 'test-key-placeholder',
        encrypted_data_path: 'resources/test.fernet',
      },
    ],
    screenshots: [],
  };
  fs.writeFileSync(path.join(gameFolder, `${gameid}.json`), JSON.stringify(skeleton, null, 2));
  fs.writeFileSync(path.join(gameFolder, 'resources', 'test.fernet'), Buffer.from('test'));
  return skeleton;
}

function seedMatchingResource(dbs, rhpakuuid) {
  dbs.rhdata.prepare('INSERT INTO rhpaks (rhpakuuid, jsfilename, name, is_system) VALUES (?, ?, ?, ?)').run(
    rhpakuuid, 'test.json', 'test rhpak', rhpakuuid === RHPAK_B ? 0 : 1
  );
  dbs.resource.prepare(`
    INSERT INTO res_attachments (
      rauuid, file_name, file_sha256, encrypted_data, fernet_key, rhpakuuid, rhpakuuid2
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    'rauuid-existing',
    '40631.bps',
    FILE_SHA,
    Buffer.from('cipher'),
    'key',
    rhpakuuid,
    JSON.stringify([rhpakuuid])
  );
}

function testNoConflictWhenSameOwner() {
  const paths = setupDatabases();
  const dbs = openDbs(paths);
  const gameFolder = path.join(TEST_DIR, 'game99999');
  fs.mkdirSync(gameFolder, { recursive: true });
  const skeleton = writeSkeleton(gameFolder, RHPAK_A);
  seedMatchingResource(dbs, RHPAK_A);
  const report = conflictChecker.detectConflicts(dbs, skeleton, { incomingSource: gameFolder });
  assert(report.conflicts.length === 0, 'Expected no conflicts when rhpak matches');
  dbs.rhdata.close();
  dbs.patchbin.close();
  dbs.resource.close();
  dbs.screenshot.close();
}

function testCrossRhpakConflict() {
  const paths = setupDatabases();
  const dbs = openDbs(paths);
  const gameFolder = path.join(TEST_DIR, '40631');
  fs.mkdirSync(gameFolder, { recursive: true });
  const skeleton = writeSkeleton(gameFolder, RHPAK_A);
  seedMatchingResource(dbs, RHPAK_B);
  const report = conflictChecker.detectConflicts(dbs, skeleton, { incomingSource: gameFolder });
  assert(report.conflicts.length === 1, 'Expected one resource conflict');
  assert(report.conflicts[0].dbOwner === RHPAK_B, 'Expected DB owner RHPAK_B');
  dbs.rhdata.close();
  dbs.patchbin.close();
  dbs.resource.close();
  dbs.screenshot.close();
}

function testEditOwnershipClearsConflict() {
  const paths = setupDatabases();
  const dbs = openDbs(paths);
  const gameFolder = path.join(TEST_DIR, '40632');
  fs.mkdirSync(gameFolder, { recursive: true });
  const skeleton = writeSkeleton(gameFolder, RHPAK_A);
  seedMatchingResource(dbs, RHPAK_B);
  const report = conflictChecker.detectConflicts(dbs, skeleton, { incomingSource: gameFolder });
  assert(report.conflicts.length === 1, 'Expected initial conflict');
  const result = conflictChecker.applyOwnershipChange(dbs, report.conflicts[0], { dryRun: false });
  assert(result.applied, 'Expected ownership change to apply');
  const after = conflictChecker.detectConflicts(dbs, skeleton, { incomingSource: gameFolder });
  assert(after.conflicts.length === 0, 'Expected conflict cleared after ownership edit');
  const row = dbs.resource.prepare('SELECT rhpakuuid, rhpakuuid2 FROM res_attachments WHERE rauuid = ?').get('rauuid-existing');
  assert(row.rhpakuuid === RHPAK_A, 'Expected primary owner RHPAK_A after edit');
  assert(JSON.stringify(JSON.parse(row.rhpakuuid2)) === JSON.stringify([RHPAK_A, RHPAK_B]), 'Expected linked owner list');
  dbs.rhdata.close();
  dbs.patchbin.close();
  dbs.resource.close();
  dbs.screenshot.close();
}

function testCliReviewExitCode() {
  const paths = setupDatabases();
  const gameFolder = path.join(TEST_DIR, 'cli40631');
  fs.mkdirSync(gameFolder, { recursive: true });
  writeSkeleton(gameFolder, RHPAK_A);

  const dbs = openDbs(paths);
  seedMatchingResource(dbs, RHPAK_B);
  dbs.rhdata.close();
  dbs.patchbin.close();
  dbs.resource.close();
  dbs.screenshot.close();

  const script = path.join(__dirname, '..', 'jstools', 'updategames_conflicts.js');
  const enode = path.join(__dirname, '..', 'enode.sh');
  const env = {
    ...process.env,
    RHDATA_DB_PATH: paths.rhdataPath,
    PATCHBIN_DB_PATH: paths.patchbinPath,
    RESOURCE_DB_PATH: paths.resourcePath,
    SCREENSHOT_DB_PATH: paths.screenshotPath,
  };
  const result = spawnSync('bash', [enode, script, `--game-folder=${gameFolder}`], { env, encoding: 'utf8' });
  assert(result.status === 1, 'CLI should exit 1 when conflicts exist');
}

function main() {
  testNoConflictWhenSameOwner();
  testCrossRhpakConflict();
  testEditOwnershipClearsConflict();
  testCliReviewExitCode();
  console.log('✅ test_updategames_conflicts passed');
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`❌ test_updategames_conflicts failed: ${error.message}`);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

module.exports = { main };
