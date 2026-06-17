#!/usr/bin/env node

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const { RHServerManager, applyRhserverTestBuildPolicy } = require('../electron/utils/RHServerManager');

const tmpDir = path.join(__dirname, 'test_data');
if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

const keyguardKey = crypto.randomBytes(32);

function makeJwt(exp) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ exp, sub: 'p1' })).toString('base64url');
  return `${header}.${payload}.sig`;
}

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
    CREATE TABLE user_profiles (
      profile_uuid TEXT PRIMARY KEY,
      profile_json TEXT,
      is_current_profile INTEGER DEFAULT 0
    );
    CREATE TABLE rhserver_tokens (
      token_uuid TEXT PRIMARY KEY,
      api_base_url TEXT NOT NULL,
      encrypted_access_token TEXT,
      encrypted_refresh_token TEXT,
      profile_uuid TEXT,
      expires_at INTEGER,
      access_expires_at INTEGER,
      refresh_expires_at INTEGER,
      obtainment_timestamp INTEGER,
      expires_in INTEGER,
      encryption_method TEXT DEFAULT 'keyguard',
      connected_at INTEGER DEFAULT (strftime('%s','now')),
      is_active INTEGER DEFAULT 1
    );
  `);
  db.prepare(`INSERT INTO csettings (csettinguid, csetting_name, csetting_value) VALUES (?, ?, ?)`)
    .run(crypto.randomUUID(), 'online_current_profile_id', 'profile-a');
  db.prepare(`INSERT INTO user_profiles (profile_uuid, profile_json, is_current_profile) VALUES (?, '{}', 1)`)
    .run('profile-a');
  db.close();
  return {
    getConnection() {
      return new Database(dbPath);
    }
  };
}

async function run() {
  const dbPath = path.join(tmpDir, `rhserver_tokens_${Date.now()}.db`);
  const dbManager = makeDbManager(dbPath);
  applyRhserverTestBuildPolicy(dbManager);
  const manager = new RHServerManager(dbManager);

  const exp = Math.floor(Date.now() / 1000) + 3600;
  const client = manager.getClient(keyguardKey);
  client.profileUuid = 'profile-a';
  client.apiBaseUrl = 'https://api.smwresource.net';
  client._applyTokenResponse({
    access_token: makeJwt(exp),
    refresh_token: 'abc123refresh',
    expires_in: 3600
  }, 'profile-a');

  manager.saveTokens(client, keyguardKey);
  manager.invalidateClient();

  const loaded = manager.getClient(keyguardKey);
  assert.strictEqual(loaded.profileUuid, 'profile-a');
  assert.strictEqual(loaded.accessToken, client.accessToken);
  assert.strictEqual(loaded.accessExpiresAt, exp);

  const ensured = await manager.ensureAccessToken(keyguardKey);
  assert.strictEqual(ensured.ok, true);

  manager.disconnect('profile-a', keyguardKey);
  const after = manager.getStatus(keyguardKey);
  assert.strictEqual(after.connected, false);

  fs.unlinkSync(dbPath);
  console.log('✓ test_rhserver_token_manager passed');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
