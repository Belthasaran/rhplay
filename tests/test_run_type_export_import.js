#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { exportRun, importRun } = require('../electron/seed-manager');
const { normalizeRunType } = require('../electron/shared/run-types');

function createClientDb(dbPath) {
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE runs (
      run_uuid TEXT PRIMARY KEY,
      run_name TEXT,
      run_description TEXT,
      status TEXT,
      global_conditions TEXT,
      config_json TEXT,
      win_rules_json TEXT,
      run_type TEXT NOT NULL DEFAULT 'standard'
    );
    CREATE TABLE run_plan_entries (
      entry_uuid TEXT PRIMARY KEY,
      run_uuid TEXT NOT NULL REFERENCES runs(run_uuid) ON DELETE CASCADE,
      sequence_number INTEGER NOT NULL,
      entry_type TEXT NOT NULL,
      gameid TEXT,
      exit_number TEXT,
      count INTEGER DEFAULT 1,
      filter_difficulty TEXT,
      filter_type TEXT,
      filter_pattern TEXT,
      filter_seed TEXT,
      conditions TEXT,
      entry_notes TEXT,
      trans_level TEXT,
      stage_filter_min_difficulty INTEGER,
      stage_filter_max_difficulty INTEGER,
      stage_filter_include_flags TEXT,
      stage_filter_exclude_flags TEXT,
      stage_filter_include_any_of_flags TEXT,
      stage_filter_exclude_only_flags TEXT,
      stage_filter_has_tags TEXT,
      stage_filter_exclude_tags TEXT,
      game_filter_min_difficulty INTEGER,
      game_filter_max_difficulty INTEGER,
      stage_filter_include_untested INTEGER DEFAULT 0,
      stage_filter_untested_only INTEGER DEFAULT 0,
      prerequisites_json TEXT
    );
    CREATE TABLE run_results (
      result_uuid TEXT PRIMARY KEY,
      run_uuid TEXT NOT NULL REFERENCES runs(run_uuid) ON DELETE CASCADE,
      plan_entry_uuid TEXT REFERENCES run_plan_entries(entry_uuid),
      sequence_number INTEGER NOT NULL,
      gameid TEXT NOT NULL,
      game_name TEXT,
      exit_number TEXT,
      stage_description TEXT,
      was_random INTEGER DEFAULT 0,
      revealed_early INTEGER DEFAULT 0,
      status TEXT DEFAULT 'pending',
      conditions TEXT,
      sfcpath TEXT,
      levelnumber TEXT,
      translevel TEXT,
      levelname TEXT,
      prerequisites_json TEXT
    );
    CREATE TABLE seedmappings (
      mapid TEXT PRIMARY KEY,
      mappingdata TEXT,
      game_count INTEGER,
      mapping_hash TEXT,
      created_at TEXT,
      description TEXT
    );
  `);
  return db;
}

function testExportImportRunType() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rh-run-type-exp-'));
  const dbPath = path.join(tmpDir, 'clientdata.db');
  const db = createClientDb(dbPath);
  const runUuid = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const entryUuid = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

  db.prepare(`
    INSERT INTO runs (run_uuid, run_name, run_description, status, global_conditions, config_json, run_type)
    VALUES (?, 'Free Run', '', 'preparing', '[]', '{"globalPatchCodes":[]}', 'free_play')
  `).run(runUuid);

  db.prepare(`
    INSERT INTO run_plan_entries (
      entry_uuid, run_uuid, sequence_number, entry_type, gameid, count
    ) VALUES (?, ?, 1, 'game', '10000', 1)
  `).run(entryUuid, runUuid);

  db.prepare(`
    INSERT INTO run_results (
      result_uuid, run_uuid, plan_entry_uuid, sequence_number, gameid, game_name
    ) VALUES (?, ?, ?, 1, '10000', 'Test Game')
  `).run('cccccccc-cccc-cccc-cccc-cccccccccccc', runUuid, entryUuid);

  const dbManager = { getConnection: (name) => (name === 'clientdata' ? db : null) };
  const exported = exportRun(dbManager, runUuid);
  assert.strictEqual(exported.run.run_type, 'free_play');

  const imported = importRun(dbManager, exported);
  if (!imported.success) {
    throw new Error(`import failed: ${imported.error}`);
  }
  assert.strictEqual(imported.success, true);

  const importedRun = db.prepare(`SELECT run_type, run_name FROM runs WHERE run_uuid = ?`).get(imported.runUuid);
  assert.strictEqual(importedRun.run_type, 'free_play');
  assert.ok(importedRun.run_name.includes('(Imported)'));

  db.close();
}

function testNormalizeMissingRunType() {
  assert.strictEqual(normalizeRunType(undefined), 'standard');
  assert.strictEqual(normalizeRunType(null), 'standard');
  assert.strictEqual(normalizeRunType('free_play'), 'free_play');
  assert.strictEqual(normalizeRunType('invalid'), 'standard');
}

function main() {
  testNormalizeMissingRunType();
  testExportImportRunType();
  console.log('test_run_type_export_import: ok');
}

main();
