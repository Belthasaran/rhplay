#!/usr/bin/env node

/**
 * test_migrations.js
 *
 * Integration test that exercises the database seeding helper and the
 * consolidated migration runner.  It generates fresh sample databases,
 * applies all migrations, and asserts that expected schema elements are
 * present afterwards.
 */

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const Database = require('better-sqlite3');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function runNodeScript(scriptPath, args = []) {
  // Use enode.sh if available (when running via enode.sh or in Electron)
  // Otherwise use system node
  const root = path.resolve(__dirname, '..');
  const enodeScript = path.join(root, 'enode.sh');
  
  let command;
  let execArgs;
  
  // Check if we're running in Electron OR if enode.sh exists (meaning we were called via enode.sh)
  if ((process.versions.electron || process.env.ELECTRON_RUN_AS_NODE) && fs.existsSync(enodeScript)) {
    // Running in Electron or via enode.sh - use enode.sh for child scripts too
    command = 'bash';
    execArgs = [enodeScript, scriptPath, ...args];
  } else {
    // Running in system Node.js - use process.execPath
    command = process.execPath;
    execArgs = [scriptPath, ...args];
  }
  
  const result = spawnSync(command, execArgs, { stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error(`${path.basename(scriptPath)} exited with status ${result.status}`);
  }
}

function columnExists(db, table, column) {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all();
  return rows.some((row) => row.name.toLowerCase() === column.toLowerCase());
}

function tableExists(db, table) {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
  return !!row;
}

function main() {
  const root = path.resolve(__dirname, '..');
  const seedScript = path.join(root, 'jsutils', 'seed_sample_data.js');
  const migrateScript = path.join(root, 'jsutils', 'migratedb.js');
  const generatedDir = path.join(root, 'tests', 'fixtures', 'generated');

  fs.rmSync(generatedDir, { recursive: true, force: true });

  console.log('🔧 Generating sample databases...');
  runNodeScript(seedScript, ['--count=100', '--verbose']);

  const rhdataPath = path.join(generatedDir, 'rhdata.db');
  const patchbinPath = path.join(generatedDir, 'patchbin.db');
  const clientdataPath = path.join(generatedDir, 'clientdata.db');

  assert(fs.existsSync(rhdataPath), 'Sample rhdata.db not found.');
  assert(fs.existsSync(patchbinPath), 'Sample patchbin.db not found.');
  assert(fs.existsSync(clientdataPath), 'Sample clientdata.db not found.');

  console.log('🚀 Applying consolidated migrations...');
  runNodeScript(migrateScript, [
    `--rhdatadb=${rhdataPath}`,
    `--patchbindb=${patchbinPath}`,
    `--clientdata=${clientdataPath}`,
    '--verbose',
  ]);

  const metadataPath = path.join(generatedDir, 'metadata.json');
  assert(fs.existsSync(metadataPath), 'metadata.json was not generated.');
  const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));

  const rhDb = new Database(rhdataPath);
  const patchDb = new Database(patchbinPath);

  try {
    console.log('🔍 Verifying rhdata schema...');
    assert(columnExists(rhDb, 'gameversions', 'lmlevels'), 'lmlevels column missing in gameversions.');
    assert(columnExists(rhDb, 'gameversions', 'detectedlevels'), 'detectedlevels column missing in gameversions.');
    assert(tableExists(rhDb, 'gameversions_translevels'), 'gameversions_translevels table missing.');

    const remainingGames = rhDb.prepare('SELECT COUNT(DISTINCT gameid) AS count FROM gameversions').get().count;
    assert(remainingGames === metadata.actualCount, 'Sample game count does not match metadata.');
    assert(remainingGames > 0, 'No gameversions remain after pruning.');

    console.log('🔍 Verifying patchbin data...');
    const attachmentCount = patchDb.prepare('SELECT COUNT(*) AS count FROM attachments').get().count;
    assert(attachmentCount > 0, 'No attachments remain in patchbin sample.');

    console.log('✅ Migration verification succeeded.');
  } finally {
    rhDb.close();
    patchDb.close();
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`❌ Migration test failed: ${error.message}`);
    process.exit(1);
  }
}
