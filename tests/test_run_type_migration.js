#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');

function createBaseClientDb(dbPath) {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE runs (
      run_uuid TEXT PRIMARY KEY,
      run_name TEXT,
      status TEXT DEFAULT 'preparing'
    );
    CREATE TABLE run_plan_entries (
      entry_uuid TEXT PRIMARY KEY,
      run_uuid TEXT NOT NULL,
      sequence_number INTEGER NOT NULL,
      entry_type TEXT NOT NULL
    );
    CREATE TABLE run_results (
      result_uuid TEXT PRIMARY KEY,
      run_uuid TEXT NOT NULL,
      sequence_number INTEGER NOT NULL,
      status TEXT DEFAULT 'pending'
    );
  `);
  return db;
}

function testMigrationAddsColumns() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rh-run-type-mig-'));
  const dbPath = path.join(tmpDir, 'clientdata.db');
  const db = createBaseClientDb(dbPath);

  const sqlPath = path.join(__dirname, '../electron/sql/migrations/075_clientdata_run_type_and_prerequisites.sql');
  db.exec(fs.readFileSync(sqlPath, 'utf8'));

  const runCols = db.prepare(`PRAGMA table_info(runs)`).all().map((c) => c.name);
  const planCols = db.prepare(`PRAGMA table_info(run_plan_entries)`).all().map((c) => c.name);
  const resultCols = db.prepare(`PRAGMA table_info(run_results)`).all().map((c) => c.name);

  assert.ok(runCols.includes('run_type'), 'runs.run_type should exist');
  assert.ok(planCols.includes('prerequisites_json'), 'run_plan_entries.prerequisites_json should exist');
  assert.ok(resultCols.includes('prerequisites_json'), 'run_results.prerequisites_json should exist');

  db.prepare(`INSERT INTO runs (run_uuid, run_name) VALUES (?, ?)`).run('uuid-1', 'Default Run');
  const row = db.prepare(`SELECT run_type FROM runs WHERE run_uuid = ?`).get('uuid-1');
  assert.strictEqual(row.run_type, 'standard');

  db.close();
}

function main() {
  testMigrationAddsColumns();
  console.log('test_run_type_migration: ok');
}

main();
