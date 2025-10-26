#!/usr/bin/env node

/**
 * Create Test Signers for e2e testing
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const TEST_DIR = path.join(__dirname, 'test_data');
const TEST_PATCHBIN_DB = path.join(TEST_DIR, 'test_patchbin.db');
const TEST_ENV_FILE = path.join(TEST_DIR, 'test_environment');

console.log('======================================================================');
console.log('Creating Test Signers');
console.log('======================================================================\n');

if (!fs.existsSync(TEST_PATCHBIN_DB)) {
  console.error('Error: Test database not found. Run setup_test_env.js first.');
  process.exit(1);
}

const db = new Database(TEST_PATCHBIN_DB);

// Create test metadata signer (ED25519)
console.log('--- Creating test metadata signer (ED25519) ---');

const metadataKeyPair = crypto.generateKeyPairSync('ed25519', {
  publicKeyEncoding: { type: 'spki', format: 'der' },
  privateKeyEncoding: { type: 'pkcs8', format: 'der' }
});

const metadataSignerUuid = crypto.randomUUID();
const metadataPublicKey = metadataKeyPair.publicKey.toString('hex');
const metadataPrivateKey = metadataKeyPair.privateKey.toString('hex');

db.prepare(`
  INSERT INTO signers (signeruuid, signer_type, signer_name, publickey, publickey_type)
  VALUES (?, ?, ?, ?, ?)
`).run(
  metadataSignerUuid,
  'metadata',
  'Test Metadata Signer',
  metadataPublicKey,
  'ED25519'
);

const metadataKeyFile = path.join(TEST_DIR, `test_metadata_signer_${metadataSignerUuid}.key`);
fs.writeFileSync(metadataKeyFile, metadataPrivateKey, 'utf8');
fs.chmodSync(metadataKeyFile, 0o600);

console.log(`✓ Created test metadata signer`);
console.log(`  UUID: ${metadataSignerUuid}`);
console.log(`  Private key saved to: ${metadataKeyFile}`);

// Create test server signer (ED25519)
console.log('\n--- Creating test server signer (ED25519) ---');

const serverKeyPair = crypto.generateKeyPairSync('ed25519', {
  publicKeyEncoding: { type: 'spki', format: 'der' },
  privateKeyEncoding: { type: 'pkcs8', format: 'der' }
});

const serverSignerUuid = crypto.randomUUID();
const serverPublicKey = serverKeyPair.publicKey.toString('hex');
const serverPrivateKey = serverKeyPair.privateKey.toString('hex');

db.prepare(`
  INSERT INTO signers (signeruuid, signer_type, signer_name, publickey, publickey_type)
  VALUES (?, ?, ?, ?, ?)
`).run(
  serverSignerUuid,
  'server',
  'Test Server Signer',
  serverPublicKey,
  'ED25519'
);

console.log(`✓ Created test server signer`);
console.log(`  UUID: ${serverSignerUuid}`);

db.close();

// Create test environment file for server
console.log('\n--- Creating test environment file ---');

const testEnvContent = `# Test Environment for mdserver
VAULT_KEY=${crypto.randomBytes(32).toString('hex')}
SERVER_SIGNER_UUID=${serverSignerUuid}
SERVER_SIGNER_ALGORITHM=ED25519
SERVER_PRIVATE_KEY_HEX=${serverPrivateKey}
PORT=3001
`;

fs.writeFileSync(TEST_ENV_FILE, testEnvContent);
console.log(`✓ Created test environment file: ${TEST_ENV_FILE}`);

// Save signer configuration
const signerConfig = {
  metadata: {
    uuid: metadataSignerUuid,
    algorithm: 'ED25519',
    privateKeyFile: metadataKeyFile
  },
  server: {
    uuid: serverSignerUuid,
    algorithm: 'ED25519'
  }
};

fs.writeFileSync(
  path.join(TEST_DIR, 'test_signers.json'),
  JSON.stringify(signerConfig, null, 2)
);

console.log('✓ Created test_signers.json');

console.log('\n======================================================================');
console.log('Test signers created successfully!');
console.log('======================================================================');
console.log('\nSigner UUIDs:');
console.log(`  Metadata: ${metadataSignerUuid}`);
console.log(`  Server:   ${serverSignerUuid}`);
console.log('\nConfiguration saved to:');
console.log(`  ${path.join(TEST_DIR, 'test_signers.json')}`);
console.log(`  ${TEST_ENV_FILE}`);
console.log();

