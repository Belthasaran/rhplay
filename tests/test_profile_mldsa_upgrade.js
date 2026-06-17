#!/usr/bin/env node

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const OnlineProfileManager = require('../electron/utils/OnlineProfileManager');
const {
  encryptMasterSeed,
  generateMasterSeed,
  needsMldsa44Keypair,
  generateMldsa44KeypairFromMasterSeed,
  upgradeMldsa44KeypairIfNeeded
} = require('../electron/utils/ProfileSeedManager');
const { buildProfileConnectParams } = require('../lib/profile-connect-params');

const tmpDir = path.join(__dirname, 'test_data');
if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

const keyguardKey = crypto.randomBytes(32);
const profileUuid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

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
      profile_json TEXT NOT NULL,
      is_current_profile INTEGER DEFAULT 0,
      has_unpublished_edits INTEGER DEFAULT 0,
      encrypted_master_seed TEXT,
      encrypted_ethereum_private_key TEXT,
      ethereum_address TEXT,
      did_pkh TEXT,
      seed_generated_at TEXT
    );
    CREATE TABLE profile_keypairs (
      keypair_uuid TEXT PRIMARY KEY,
      profile_uuid TEXT NOT NULL,
      keypair_type TEXT NOT NULL,
      key_usage TEXT,
      storage_status TEXT DEFAULT 'public-only',
      public_key TEXT NOT NULL,
      public_key_hex TEXT,
      fingerprint TEXT,
      encrypted_private_key TEXT,
      private_key_format TEXT,
      trust_level TEXT,
      local_name TEXT,
      canonical_name TEXT,
      name TEXT,
      label TEXT,
      comments TEXT,
      nostr_event_id TEXT,
      nostr_status TEXT,
      is_seed_based INTEGER DEFAULT 0,
      derivation_path TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const masterSeed = generateMasterSeed();
  const encryptedSeed = encryptMasterSeed(masterSeed, keyguardKey);
  const profileJson = JSON.stringify({
    profileId: profileUuid,
    username: 'legacyuser',
    displayName: 'Legacy User',
    primaryKeypair: {
      type: 'Nostr',
      publicKeyHex: 'b'.repeat(64)
    },
    additionalKeypairs: []
  });

  db.prepare(`
    INSERT INTO user_profiles (profile_uuid, profile_json, is_current_profile, encrypted_master_seed)
    VALUES (?, ?, 1, ?)
  `).run(profileUuid, profileJson, encryptedSeed);

  db.prepare(`INSERT INTO csettings (csettinguid, csetting_name, csetting_value) VALUES (?, ?, ?)`)
    .run(crypto.randomUUID(), 'online_current_profile_id', profileUuid);

  db.prepare(`
    INSERT INTO profile_keypairs (
      keypair_uuid, profile_uuid, keypair_type, key_usage, storage_status,
      public_key, public_key_hex, fingerprint, encrypted_private_key, private_key_format
    ) VALUES (?, ?, 'Nostr', 'primary', 'full', 'npub1test', ?, ?, ?, 'hex')
  `).run(
    crypto.randomUUID(),
    profileUuid,
    'b'.repeat(64),
    'f'.repeat(64),
    `${crypto.randomBytes(16).toString('hex')}:${crypto.randomBytes(32).toString('hex')}`
  );

  db.close();

  return {
    getConnection() {
      return new Database(dbPath);
    }
  };
}

async function run() {
  const dbPath = path.join(tmpDir, `profile_mldsa_upgrade_${Date.now()}.db`);
  const dbManager = makeDbManager(dbPath);
  const db = dbManager.getConnection('clientdata');
  const profileManager = new OnlineProfileManager(dbManager, keyguardKey);

  assert.strictEqual(needsMldsa44Keypair(db, profileUuid), true);

  const masterSeed = generateMasterSeed();
  const kp1 = await generateMldsa44KeypairFromMasterSeed(masterSeed);
  const kp2 = await generateMldsa44KeypairFromMasterSeed(masterSeed);
  assert.strictEqual(kp1.publicKeyHex, kp2.publicKeyHex);
  assert.strictEqual(kp1.derivationPath, 'm/identity/mldsa/0');

  const upgradeResult = await upgradeMldsa44KeypairIfNeeded({
    db,
    profileManager,
    profileUuid,
    keyguardKey
  });
  assert.strictEqual(upgradeResult.upgraded, true);
  assert.strictEqual(needsMldsa44Keypair(db, profileUuid), false);

  const noOp = await upgradeMldsa44KeypairIfNeeded({
    db,
    profileManager,
    profileUuid,
    keyguardKey
  });
  assert.strictEqual(noOp.upgraded, false);

  const profile = profileManager.getProfile(profileUuid);
  const connectParams = buildProfileConnectParams(profile, profileUuid, { profileManager });
  assert.strictEqual(connectParams.profile_uuid, profileUuid);
  assert.strictEqual(connectParams.username, 'legacyuser');
  assert.strictEqual(connectParams.nostr_pubkey, 'b'.repeat(64));
  assert.ok(connectParams.mldsa_pubkey_sha256);

  const mldsaRow = db.prepare(`
    SELECT is_seed_based, derivation_path FROM profile_keypairs
    WHERE profile_uuid = ? AND keypair_type = 'ML-DSA-44'
  `).get(profileUuid);
  assert.strictEqual(mldsaRow.is_seed_based, 1);
  assert.strictEqual(mldsaRow.derivation_path, 'm/identity/mldsa/0');

  db.close();
  fs.unlinkSync(dbPath);
  console.log('✓ test_profile_mldsa_upgrade passed');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
