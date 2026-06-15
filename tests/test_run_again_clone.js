#!/usr/bin/env node
'use strict';

/**
 * test_run_again_clone.js
 *
 * Tests runAgainFromPastRun and expand skip logic using temp clientdata.db.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const {
  runAgainFromPastRun,
  expectedResultCountFromPlan,
  shouldSkipExpandIfResultsExist,
  generateSeedWithMap,
} = require('../electron/seed-manager');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

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
      levelnumber TEXT,
      translevel TEXT,
      levelname TEXT
    );
    CREATE TABLE seedmappings (
      mapid TEXT PRIMARY KEY,
      mappingdata TEXT NOT NULL,
      game_count INTEGER,
      mapping_hash TEXT,
      created_at TEXT,
      description TEXT
    );
  `);
  db.close();
}

function createMinimalRhdataDb(dbPath) {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE gameversions (
      gameid TEXT,
      version INTEGER,
      name TEXT,
      PRIMARY KEY (gameid, version)
    );
  `);
  db.close();
}

function makeDbManager(clientPath, rhPath) {
  const clientDb = new Database(clientPath);
  const rhDb = new Database(rhPath);
  clientDb.pragma('foreign_keys = ON');
  return {
    getConnection(name) {
      if (name === 'clientdata') return clientDb;
      if (name === 'rhdata') return rhDb;
      throw new Error(`Unknown db: ${name}`);
    },
  };
}

function seedCompletedRun(dbManager) {
  const db = dbManager.getConnection('clientdata');
  const runUuid = crypto.randomUUID();
  const fixedEntryUuid = crypto.randomUUID();
  const randomEntryUuid = crypto.randomUUID();
  const oldSeed = 'ABCDE-old01';

  db.prepare(`
    INSERT INTO runs (run_uuid, run_name, status, global_conditions, config_json, win_rules_json)
    VALUES (?, 'Test Run', 'completed', '[]', '{"globalPatchCodes":[]}', NULL)
  `).run(runUuid);

  db.prepare(`
    INSERT INTO run_plan_entries
      (entry_uuid, run_uuid, sequence_number, entry_type, gameid, count, filter_seed)
    VALUES (?, ?, 1, 'game', '100', 1, NULL)
  `).run(fixedEntryUuid, runUuid);

  db.prepare(`
    INSERT INTO run_plan_entries
      (entry_uuid, run_uuid, sequence_number, entry_type, count, filter_seed, filter_type)
    VALUES (?, ?, 2, 'random_game', 1, ?, 'kaizo')
  `).run(randomEntryUuid, runUuid, oldSeed);

  db.prepare(`
    INSERT INTO run_results
      (result_uuid, run_uuid, plan_entry_uuid, sequence_number, gameid, game_name, was_random, status, conditions)
    VALUES (?, ?, ?, 1, '100', 'Fixed Game', 0, 'success', '[]')
  `).run(crypto.randomUUID(), runUuid, fixedEntryUuid);

  db.prepare(`
    INSERT INTO run_results
      (result_uuid, run_uuid, plan_entry_uuid, sequence_number, gameid, game_name, was_random, status, conditions)
    VALUES (?, ?, ?, 2, '200', 'Random Game', 1, 'success', '[]')
  `).run(crypto.randomUUID(), runUuid, randomEntryUuid);

  return { runUuid, fixedEntryUuid, randomEntryUuid, oldSeed };
}

function testKeepModeCopiesResults() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'run-again-'));
  const clientPath = path.join(tmp, 'clientdata.db');
  const rhPath = path.join(tmp, 'rhdata.db');
  createMinimalClientDb(clientPath);
  createMinimalRhdataDb(rhPath);

  const dbManager = makeDbManager(clientPath, rhPath);
  const { runUuid } = seedCompletedRun(dbManager);

  const result = runAgainFromPastRun(dbManager, runUuid, 'keep');
  assert(result.success, `keep clone failed: ${result.error}`);
  assert(result.runUuid !== runUuid, 'expected new run uuid');

  const db = dbManager.getConnection('clientdata');
  const newResults = db.prepare(`
    SELECT gameid, sequence_number, status FROM run_results WHERE run_uuid = ? ORDER BY sequence_number
  `).all(result.runUuid);
  assert(newResults.length === 2, 'expected 2 copied results');
  assert(newResults[0].gameid === '100', 'fixed game mismatch');
  assert(newResults[1].gameid === '200', 'random game mismatch');
  assert(newResults.every((r) => r.status === 'pending'), 'results should reset to pending');

  const randomPlan = db.prepare(`
    SELECT filter_seed FROM run_plan_entries
    WHERE run_uuid = ? AND entry_type = 'random_game'
  `).get(result.runUuid);
  assert(randomPlan.filter_seed === 'ABCDE-old01', 'keep mode should preserve seed');
}

function testReseedModeNewSeedsNoResults() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'run-again-'));
  const clientPath = path.join(tmp, 'clientdata.db');
  const rhPath = path.join(tmp, 'rhdata.db');
  createMinimalClientDb(clientPath);
  createMinimalRhdataDb(rhPath);

  const dbManager = makeDbManager(clientPath, rhPath);
  const setupDb = dbManager.getConnection('clientdata');
  setupDb.prepare(`
    INSERT INTO seedmappings (mapid, mappingdata, game_count, mapping_hash, created_at, description)
    VALUES ('ABCDE', '{"100":1}', 1, 'hash', datetime('now'), 'test')
  `).run();

  const { runUuid } = seedCompletedRun(dbManager);
  const result = runAgainFromPastRun(dbManager, runUuid, 'reseed');
  assert(result.success, `reseed clone failed: ${result.error}`);

  const db = dbManager.getConnection('clientdata');
  const resultCount = db.prepare(`SELECT COUNT(*) as c FROM run_results WHERE run_uuid = ?`).get(result.runUuid).c;
  assert(resultCount === 0, 'reseed mode should not copy run_results');

  const randomPlan = db.prepare(`
    SELECT filter_seed FROM run_plan_entries
    WHERE run_uuid = ? AND entry_type = 'random_game'
  `).get(result.runUuid);
  assert(randomPlan.filter_seed !== 'ABCDE-old01', 'reseed mode should change seed');
}

function testExpectedResultCount() {
  const entries = [{ count: 2 }, { count: 1 }, { count: null }];
  assert(expectedResultCountFromPlan(entries) === 4, 'expected count 4');
}

function testSkipExpandIfResultsExist() {
  const entries = [{ count: 2 }, { count: 1 }];
  assert(shouldSkipExpandIfResultsExist(entries, 3), 'should skip when counts match');
  assert(!shouldSkipExpandIfResultsExist(entries, 2), 'should not skip when counts differ');
  assert(!shouldSkipExpandIfResultsExist(entries, 0), 'should not skip when no results');
}

function testKeepModeSavePlanPreservesResultLinks() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'run-again-'));
  const clientPath = path.join(tmp, 'clientdata.db');
  const rhPath = path.join(tmp, 'rhdata.db');
  createMinimalClientDb(clientPath);
  createMinimalRhdataDb(rhPath);

  const dbManager = makeDbManager(clientPath, rhPath);
  const { runUuid } = seedCompletedRun(dbManager);
  const result = runAgainFromPastRun(dbManager, runUuid, 'keep');
  assert(result.success, `keep clone failed: ${result.error}`);

  const db = dbManager.getConnection('clientdata');
  const planEntries = db.prepare(`
    SELECT entry_uuid, entry_type, gameid, count, filter_seed
    FROM run_plan_entries WHERE run_uuid = ? ORDER BY sequence_number
  `).all(result.runUuid);

  const linkedBefore = db.prepare(`
    SELECT COUNT(*) as c FROM run_results
    WHERE run_uuid = ? AND plan_entry_uuid IS NOT NULL
  `).get(result.runUuid).c;
  assert(linkedBefore === 2, 'expected linked run_results before save');

  let deleteFailed = false;
  try {
    db.prepare(`DELETE FROM run_plan_entries WHERE run_uuid = ?`).run(result.runUuid);
  } catch (error) {
    deleteFailed = error.code === 'SQLITE_CONSTRAINT_FOREIGNKEY';
  }
  assert(deleteFailed, 'bulk delete should fail when run_results reference plan entries');

  const updateStmt = db.prepare(`
    UPDATE run_plan_entries SET sequence_number = ?, entry_type = ?, gameid = ?, exit_number = ?,
      count = ?, filter_difficulty = ?, filter_type = ?, filter_pattern = ?, filter_seed = ?, conditions = ?,
      trans_level = ?, stage_filter_min_difficulty = ?, stage_filter_max_difficulty = ?,
      stage_filter_include_flags = ?, stage_filter_exclude_flags = ?,
      stage_filter_include_any_of_flags = ?, stage_filter_exclude_only_flags = ?,
      stage_filter_has_tags = ?, stage_filter_exclude_tags = ?,
      game_filter_min_difficulty = ?, game_filter_max_difficulty = ?,
      stage_filter_include_untested = ?, stage_filter_untested_only = ?
    WHERE entry_uuid = ? AND run_uuid = ?
  `);

  planEntries.forEach((entry, idx) => {
    updateStmt.run(
      idx + 1,
      entry.entry_type,
      entry.gameid,
      null,
      entry.count || 1,
      null,
      entry.entry_type === 'random_game' ? 'kaizo' : null,
      null,
      entry.filter_seed,
      '[]',
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      0,
      0,
      entry.entry_uuid,
      result.runUuid
    );
  });

  const linkedAfter = db.prepare(`
    SELECT COUNT(*) as c FROM run_results
    WHERE run_uuid = ? AND plan_entry_uuid IS NOT NULL
  `).get(result.runUuid).c;
  assert(linkedAfter === 2, 'upsert-style save should preserve run_results links');
}

function main() {
  testExpectedResultCount();
  testSkipExpandIfResultsExist();
  testKeepModeCopiesResults();
  testReseedModeNewSeedsNoResults();
  testKeepModeSavePlanPreservesResultLinks();
  console.log('test_run_again_clone: ok');
}

main();
