#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { exportRun } = require('../electron/seed-manager');

const SAMPLE_PREREQ = {
  version: 1,
  rules: [{ kind: 'expanded_entry_win', expandedSequenceNumber: 2 }],
  accessConditionText: 'Win stage 2 first',
};

function createClientDb(dbPath) {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE runs (
      run_uuid TEXT PRIMARY KEY,
      run_name TEXT,
      status TEXT,
      global_conditions TEXT,
      config_json TEXT,
      run_type TEXT NOT NULL DEFAULT 'standard'
    );
    CREATE TABLE run_plan_entries (
      entry_uuid TEXT PRIMARY KEY,
      run_uuid TEXT NOT NULL,
      sequence_number INTEGER NOT NULL,
      entry_type TEXT NOT NULL,
      gameid TEXT,
      count INTEGER DEFAULT 1,
      prerequisites_json TEXT
    );
    CREATE TABLE run_results (
      result_uuid TEXT PRIMARY KEY,
      run_uuid TEXT NOT NULL,
      plan_entry_uuid TEXT,
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

function testPrerequisitesInExport() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rh-run-prereq-'));
  const dbPath = path.join(tmpDir, 'clientdata.db');
  const db = createClientDb(dbPath);
  const runUuid = '11111111-1111-1111-1111-111111111111';
  const entryUuid = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const prereqJson = JSON.stringify(SAMPLE_PREREQ);

  db.prepare(`
    INSERT INTO runs (run_uuid, run_name, status, global_conditions, config_json)
    VALUES (?, 'Prereq Run', 'preparing', '[]', '{}')
  `).run(runUuid);

  db.prepare(`
    INSERT INTO run_plan_entries (
      entry_uuid, run_uuid, sequence_number, entry_type, gameid, count, prerequisites_json
    ) VALUES (?, ?, 1, 'stage', '10000', 1, ?)
  `).run(entryUuid, runUuid, prereqJson);

  db.prepare(`
    INSERT INTO run_results (
      result_uuid, run_uuid, plan_entry_uuid, sequence_number, gameid, game_name, prerequisites_json
    ) VALUES (?, ?, ?, 1, '10000', 'Game', ?)
  `).run('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', runUuid, entryUuid, prereqJson);

  const dbManager = { getConnection: () => db };
  const exported = exportRun(dbManager, runUuid);

  assert.strictEqual(exported.planEntries[0].prerequisites_json, prereqJson);
  assert.strictEqual(exported.expandedEntries[0].prerequisites_json, prereqJson);

  db.close();
}

function main() {
  testPrerequisitesInExport();
  console.log('test_run_prerequisites_json: ok');
}

main();
