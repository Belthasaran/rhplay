#!/usr/bin/env node

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const { RHServerManager, applyRhserverTestBuildPolicy } = require('../electron/utils/RHServerManager');

const tmpDir = path.join(__dirname, 'test_data');
if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

function makeDbManager(dbPath) {
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE csettings (
      csettinguid TEXT PRIMARY KEY,
      csetting_name TEXT UNIQUE,
      csetting_value TEXT,
      csetting_binary BLOB
    );
    CREATE TABLE rhserver_tokens (
      token_uuid TEXT PRIMARY KEY,
      api_base_url TEXT,
      encrypted_access_token TEXT,
      encrypted_refresh_token TEXT,
      profile_uuid TEXT,
      expires_at INTEGER,
      connected_at INTEGER,
      is_active INTEGER DEFAULT 1
    );
  `);
  db.close();
  return {
    getConnection() {
      return new Database(dbPath);
    }
  };
}

function run() {
  const dbPath = path.join(tmpDir, `rhserver_testmode_${Date.now()}.db`);
  const dbManager = makeDbManager(dbPath);

  applyRhserverTestBuildPolicy(dbManager);
  const manager = new RHServerManager(dbManager);
  assert.strictEqual(manager.getTestMode(), 'Off');
  assert.strictEqual(manager.getApiBaseUrl(), 'https://api.smwresource.net');

  manager.setTestMode('On');
  assert.strictEqual(manager.getTestMode(), 'On');
  assert.strictEqual(manager.getApiBaseUrl(), 'http://localhost:3000');
  assert.strictEqual(
    manager.getConnectUrl('x=1'),
    'http://localhost:3000/connect/rhplay?x=1'
  );

  const policy = manager.getTestModePolicy();
  assert.strictEqual(policy.toggleEnabled, true);
  assert.strictEqual(policy.testModeOn, true);

  manager.setTestMode('Off');
  assert.strictEqual(manager.getTestMode(), 'Off');
  assert.strictEqual(manager.getApiBaseUrl(), 'https://api.smwresource.net');

  // Force Disabled and verify setTestMode rejects
  const db = dbManager.getConnection();
  db.prepare(`
    INSERT INTO csettings (csettinguid, csetting_name, csetting_value)
    VALUES (?, ?, ?)
    ON CONFLICT(csetting_name) DO UPDATE SET csetting_value = excluded.csetting_value
  `).run(crypto.randomUUID(), 'rhserver_testmode', 'Disabled');
  db.close();

  const manager2 = new RHServerManager(dbManager);
  assert.strictEqual(manager2.getTestMode(), 'Disabled');
  assert.strictEqual(manager2.getTestModePolicy().toggleEnabled, false);

  let threw = false;
  try {
    manager2.setTestMode('On');
  } catch (err) {
    threw = true;
    assert.match(err.message, /disabled/i);
  }
  assert.ok(threw, 'setTestMode should reject when Disabled');

  // Build policy forces Disabled when env set
  const dbPath2 = path.join(tmpDir, `rhserver_policy_${Date.now()}.db`);
  const dbManager2 = makeDbManager(dbPath2);
  const prev = process.env.RHPLAY_TEST_STATUS;
  process.env.RHPLAY_TEST_STATUS = 'disabled';
  try {
    applyRhserverTestBuildPolicy(dbManager2);
    const m = new RHServerManager(dbManager2);
    assert.strictEqual(m.getTestMode(), 'Disabled');
  } finally {
    if (prev === undefined) delete process.env.RHPLAY_TEST_STATUS;
    else process.env.RHPLAY_TEST_STATUS = prev;
  }

  fs.unlinkSync(dbPath);
  fs.unlinkSync(dbPath2);
  console.log('✓ test_rhserver_testmode passed');
}

run();
