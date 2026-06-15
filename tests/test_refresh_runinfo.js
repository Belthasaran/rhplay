#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { refreshRunInfoJson } = require('../electron/game-stager');

function createMinimalClientDb(dbPath) {
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
      staging_folder TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
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
      stage_filter_untested_only INTEGER DEFAULT 0
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
      levelname TEXT
    );
  `);
  return db;
}

function testRefreshRunInfoJson() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rh-refresh-runinfo-'));
  const dbPath = path.join(tmpDir, 'clientdata.db');
  const stagingFolder = path.join(tmpDir, 'staging');
  fs.mkdirSync(stagingFolder);

  const db = createMinimalClientDb(dbPath);
  const runUuid = '11111111-1111-1111-1111-111111111111';
  const entryUuid = '22222222-2222-2222-2222-222222222222';

  db.prepare(`
    INSERT INTO runs (run_uuid, run_name, status, win_rules_json, staging_folder)
    VALUES (?, ?, 'preparing', ?, ?)
  `).run(runUuid, 'Test Run', '{"challengeTime":{"enabled":true}}', stagingFolder);

  db.prepare(`
    INSERT INTO run_plan_entries (
      entry_uuid, run_uuid, sequence_number, entry_type, gameid, count
    ) VALUES (?, ?, 1, 'game', '10000', 1)
  `).run(entryUuid, runUuid);

  db.prepare(`
    INSERT INTO run_results (
      result_uuid, run_uuid, plan_entry_uuid, sequence_number, gameid, game_name
    ) VALUES (?, ?, ?, 1, '10000', 'Test Game')
  `).run('33333333-3333-3333-3333-333333333333', runUuid, entryUuid);

  const dbManager = {
    getConnection: () => db,
  };

  const missingFolder = refreshRunInfoJson(dbManager, 'missing-uuid');
  assert.strictEqual(missingFolder.success, false);

  const result = refreshRunInfoJson(dbManager, runUuid);
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.folderPath, stagingFolder);

  const runInfoPath = path.join(stagingFolder, 'runinfo.json');
  assert.ok(fs.existsSync(runInfoPath), 'runinfo.json should exist');

  const runInfo = JSON.parse(fs.readFileSync(runInfoPath, 'utf8'));
  assert.strictEqual(runInfo.run.run_uuid, runUuid);
  assert.strictEqual(runInfo.run.run_name, 'Test Run');
  assert.ok(Array.isArray(runInfo.planEntries));
  assert.ok(Array.isArray(runInfo.expandedEntries));

  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

function main() {
  testRefreshRunInfoJson();
  console.log('test_refresh_runinfo: ok');
}

main();
