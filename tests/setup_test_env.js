#!/usr/bin/env node

/**
 * Setup Test Environment for fetchpatches and mdserver testing
 * 
 * Creates isolated test databases with sample data
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const TEST_DIR = path.join(__dirname, 'test_data');
const TEST_PATCHBIN_DB = path.join(TEST_DIR, 'test_patchbin.db');
const TEST_RHDATA_DB = path.join(TEST_DIR, 'test_rhdata.db');
const TEST_SERVERDATA_DB = path.join(TEST_DIR, 'test_mdserverdata.db');

console.log('======================================================================');
console.log('Setting up test environment for fetchpatches.js and mdserver');
console.log('======================================================================\n');

// Create test directory
if (!fs.existsSync(TEST_DIR)) {
  fs.mkdirSync(TEST_DIR, { recursive: true });
  console.log('✓ Created test_data directory');
} else {
  console.log('⓿ test_data directory exists');
}

// Remove old test databases
for (const db of [TEST_PATCHBIN_DB, TEST_RHDATA_DB, TEST_SERVERDATA_DB]) {
  if (fs.existsSync(db)) {
    fs.unlinkSync(db);
    console.log(`✓ Removed old ${path.basename(db)}`);
  }
}

console.log('\n--- Creating test_patchbin.db ---');

// Create test patchbin database
const patchbinDb = new Database(TEST_PATCHBIN_DB);

// Create signers table
patchbinDb.exec(`
  CREATE TABLE IF NOT EXISTS signers (
    signeruuid VARCHAR(255) PRIMARY KEY,
    signer_type VARCHAR(50),
    signer_name VARCHAR(255),
    publickey VARCHAR(2048),
    publickey_type VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    siglistuuid VARCHAR(255),
    row_version INTEGER DEFAULT 1
  );
`);

// Create signaturelists table
patchbinDb.exec(`
  CREATE TABLE IF NOT EXISTS signaturelists (
    siglistuuid VARCHAR(255) PRIMARY KEY,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    signlist_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    record_type VARCHAR(255),
    record_uuid VARCHAR(255),
    signed_row_version INTEGER DEFAULT 1,
    signed_action VARCHAR(255) DEFAULT 'upsert'
  );
`);

// Create signaturelistentries table
patchbinDb.exec(`
  CREATE TABLE IF NOT EXISTS signaturelistentries (
    sentryuuid VARCHAR(255) PRIMARY KEY,
    siglistuuid VARCHAR(255),
    signeruuid VARCHAR(255),
    signature VARCHAR(2048),
    signature_algorithm VARCHAR(50)
  );
`);

// Create attachments table
patchbinDb.exec(`
  CREATE TABLE attachments (
    auuid VARCHAR(255) PRIMARY KEY,
    pbuuid VARCHAR(255),
    gvuuid VARCHAR(255),
    resuuid VARCHAR(255),
    file_name VARCHAR(255),
    file_size INTEGER,
    file_hash_sha256 VARCHAR(64),
    file_hash_sha224 VARCHAR(56),
    file_ipfs_cidv0 VARCHAR(255),
    file_ipfs_cidv1 VARCHAR(255),
    file_data BLOB,
    last_search TIMESTAMP,
    updated_time TIMESTAMP,
    arweave_file_id VARCHAR(255),
    arweave_file_name VARCHAR(255),
    arweave_file_path VARCHAR(255),
    download_urls TEXT,
    siglistuuid VARCHAR(255),
    row_version INTEGER DEFAULT 1
  );
`);

// Create donotsearch table
patchbinDb.exec(`
  CREATE TABLE IF NOT EXISTS donotsearch (
    entryuuid VARCHAR(255) PRIMARY KEY,
    url VARCHAR(255) NOT NULL UNIQUE,
    server_response TEXT,
    since TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    stop_time INTEGER DEFAULT 17200
  );
`);

// Create ipfsgateways table
patchbinDb.exec(`
  CREATE TABLE IF NOT EXISTS ipfsgateways (
    gatewayuuid VARCHAR(255) PRIMARY KEY,
    url TEXT NOT NULL UNIQUE,
    notworking_timestamp TIMESTAMP,
    error TEXT,
    priority INTEGER DEFAULT 100,
    notes TEXT
  );
`);

// Create patchblobs table
patchbinDb.exec(`
  CREATE TABLE IF NOT EXISTS patchblobs (
    pbuuid VARCHAR(255) PRIMARY KEY,
    auuid VARCHAR(255),
    gvuuid VARCHAR(255),
    pbkey VARCHAR(64),
    pbiv VARCHAR(32),
    decoded_hash_sha256 VARCHAR(64),
    decoded_hash_sha224 VARCHAR(56),
    pblobdata BLOB,
    siglistuuid VARCHAR(255),
    row_version INTEGER DEFAULT 1
  );
`);

console.log('✓ Created patchbin schema');

// Insert test attachment records
const testAttachments = [
  {
    auuid: crypto.randomUUID(),
    file_name: 'test_file_1.bin',
    file_size: 1024,
    file_hash_sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', // SHA256 of empty string
    file_hash_sha224: 'd14a028c2a3a2bc9476102bb288234c415a2b01f828ea62ac5b3e42f',
    file_ipfs_cidv0: null,
    file_ipfs_cidv1: null,
    file_data: null,
    last_search: null,
    arweave_file_id: null,
    arweave_file_name: null,
    arweave_file_path: null,
    download_urls: null
  },
  {
    auuid: crypto.randomUUID(),
    file_name: 'test_file_2.bin',
    file_size: 2048,
    file_hash_sha256: '5feceb66ffc86f38d952786c6d696c79c2dbc239dd4e91b46729d73a27fb57e9', // SHA256 of '0'
    file_hash_sha224: '9b71d224bd62f3785d96d46ad3ea3d73319bfbc2890caadae2dff72519673ca72323c3d99ba5c11d7c7acc6e14b8c5da0c4663475c2e5c3adef46f73bcdec043',
    file_ipfs_cidv0: null,
    file_ipfs_cidv1: null,
    file_data: null,
    last_search: null,
    arweave_file_id: 'test-arweave-id-123',
    arweave_file_name: 'test_file_2.bin',
    arweave_file_path: '/test/path/test_file_2.bin',
    download_urls: 'https://example.com/test_file_2.bin'
  },
  {
    auuid: crypto.randomUUID(),
    file_name: 'test_file_with_data.bin',
    file_size: 11,
    file_hash_sha256: '5eb63bbbe01eeed093cb22bb8f5acdc3298caa2a6d0f3d1f6f3b0f5f8c5f9b3a', // SHA256 of 'test data\n\n'
    file_hash_sha224: null,
    file_ipfs_cidv0: null,
    file_ipfs_cidv1: null,
    file_data: Buffer.from('test data\n\n'),
    last_search: new Date().toISOString(),
    arweave_file_id: null,
    arweave_file_name: null,
    arweave_file_path: null,
    download_urls: null
  }
];

const insertAttachment = patchbinDb.prepare(`
  INSERT INTO attachments (
    auuid, pbuuid, gvuuid, resuuid,
    file_name, file_size, file_hash_sha256, file_hash_sha224,
    file_ipfs_cidv0, file_ipfs_cidv1, file_data, last_search,
    arweave_file_id, arweave_file_name, arweave_file_path, download_urls
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

for (const attachment of testAttachments) {
  insertAttachment.run(
    attachment.auuid,
    attachment.pbuuid || null,
    attachment.gvuuid || null,
    attachment.resuuid || null,
    attachment.file_name,
    attachment.file_size,
    attachment.file_hash_sha256,
    attachment.file_hash_sha224,
    attachment.file_ipfs_cidv0,
    attachment.file_ipfs_cidv1,
    attachment.file_data,
    attachment.last_search,
    attachment.arweave_file_id,
    attachment.arweave_file_name,
    attachment.arweave_file_path,
    attachment.download_urls
  );
}

console.log(`✓ Inserted ${testAttachments.length} test attachment records`);

// Insert test IPFS gateways
const testGateways = [
  { url: 'https://ipfs.io/ipfs/%CID%', priority: 1 },
  { url: 'https://dweb.link/ipfs/%CID%', priority: 2 }
];

const insertGateway = patchbinDb.prepare(`
  INSERT INTO ipfsgateways (gatewayuuid, url, priority)
  VALUES (?, ?, ?)
`);

for (const gateway of testGateways) {
  insertGateway.run(crypto.randomUUID(), gateway.url, gateway.priority);
}

console.log(`✓ Inserted ${testGateways.length} test IPFS gateways`);

patchbinDb.close();

console.log('\n--- Creating test_rhdata.db ---');

// Create test rhdata database (minimal for now)
const rhdataDb = new Database(TEST_RHDATA_DB);

rhdataDb.exec(`
  CREATE TABLE IF NOT EXISTS gameversions (
    gvuuid VARCHAR(255) PRIMARY KEY,
    gameid VARCHAR(255),
    name VARCHAR(255),
    version INTEGER,
    pbuuid VARCHAR(255),
    siglistuuid VARCHAR(255),
    row_version INTEGER DEFAULT 1
  );
`);

console.log('✓ Created rhdata schema');
rhdataDb.close();

console.log('\n--- Creating test_mdserverdata.db ---');

// Create test server data database
const serverdataDb = new Database(TEST_SERVERDATA_DB);

const serverSchema = fs.readFileSync(path.join(__dirname, '..', 'mdserver', 'serverdata.sql'), 'utf8');
serverdataDb.exec(serverSchema);

console.log('✓ Created mdserverdata schema');
serverdataDb.close();

// Write test configuration file
const testConfig = {
  testDir: TEST_DIR,
  databases: {
    patchbin: TEST_PATCHBIN_DB,
    rhdata: TEST_RHDATA_DB,
    serverdata: TEST_SERVERDATA_DB
  },
  testAttachments: testAttachments.map(a => ({
    auuid: a.auuid,
    file_name: a.file_name,
    file_hash_sha256: a.file_hash_sha256
  })),
  created: new Date().toISOString()
};

fs.writeFileSync(
  path.join(TEST_DIR, 'test_config.json'),
  JSON.stringify(testConfig, null, 2)
);

console.log('✓ Created test_config.json');

console.log('\n======================================================================');
console.log('Test environment setup complete!');
console.log('======================================================================');
console.log('\nTest databases created:');
console.log(`  ${TEST_PATCHBIN_DB}`);
console.log(`  ${TEST_RHDATA_DB}`);
console.log(`  ${TEST_SERVERDATA_DB}`);
console.log('\nConfiguration saved to:');
console.log(`  ${path.join(TEST_DIR, 'test_config.json')}`);
console.log('\nNext steps:');
console.log('  1. Create test signers: npm run test:create-signers');
console.log('  2. Launch test server: npm run test:server');
console.log('  3. Run end-to-end tests: npm run test:e2e');
console.log();

