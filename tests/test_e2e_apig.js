#!/usr/bin/env node

/**
 * End-to-End Test for Option G (API Search)
 * 
 * Tests the full flow:
 * 1. Start test server
 * 2. Create test client
 * 3. Sign test attachment metadata
 * 4. Run fetchpatches with --apisearch
 * 5. Verify server signatures and metadata signatures
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const Database = require('better-sqlite3');

const TEST_DIR = path.join(__dirname, 'test_data');
const TEST_CONFIG_FILE = path.join(TEST_DIR, 'test_config.json');
const TEST_SIGNERS_FILE = path.join(TEST_DIR, 'test_signers.json');
const TEST_ENV_FILE = path.join(TEST_DIR, 'test_environment');

let serverProcess = null;
let testClientId = null;
let testClientSecret = null;

console.log('======================================================================');
console.log('End-to-End Test: Option G (API Search)');
console.log('======================================================================\n');

// Check test environment
if (!fs.existsSync(TEST_CONFIG_FILE) || !fs.existsSync(TEST_SIGNERS_FILE) || !fs.existsSync(TEST_ENV_FILE)) {
  console.error('Error: Test environment not complete.');
  console.error('Run these scripts first:');
  console.error('  1. npm run test:setup');
  console.error('  2. npm run test:create-signers');
  process.exit(1);
}

const testConfig = JSON.parse(fs.readFileSync(TEST_CONFIG_FILE, 'utf8'));
const testSigners = JSON.parse(fs.readFileSync(TEST_SIGNERS_FILE, 'utf8'));
const testEnv = require('dotenv').config({ path: TEST_ENV_FILE }).parsed;

console.log('--- Step 1: Starting test server ---');

// Start test server
serverProcess = spawn('node', [
  path.join(__dirname, 'test_server.js')
], {
  stdio: ['ignore', 'pipe', 'pipe']
});

serverProcess.stdout.on('data', (data) => {
  process.stdout.write(`[SERVER] ${data}`);
});

serverProcess.stderr.on('data', (data) => {
  process.stderr.write(`[SERVER] ${data}`);
});

// Wait for server to start
async function waitForServer(maxRetries = 10) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch('http://localhost:3001/health');
      if (response.ok) {
        console.log('✓ Test server is ready\n');
        return true;
      }
    } catch (e) {
      // Server not ready yet
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  return false;
}

async function runTest() {
  const serverReady = await waitForServer();
  
  if (!serverReady) {
    console.error('✗ Test server failed to start');
    process.exit(1);
  }
  
  console.log('--- Step 2: Creating test client ---');
  
  // Create test client directly in database
  const serverDb = new Database(testConfig.databases.serverdata);
  
  const clientUuid = crypto.randomUUID();
  testClientId = crypto.randomUUID();
  testClientSecret = crypto.randomBytes(32).toString('hex');
  
  // Encrypt credentials
  function encrypt(text) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(testEnv.VAULT_KEY, 'hex'), iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
  }
  
  serverDb.prepare(`
    INSERT INTO apiclients (clientuuid, encrypted_clientid, encrypted_secret, admin_client, client_name)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    clientUuid,
    encrypt(testClientId),
    encrypt(testClientSecret),
    0, // Read-only client
    'Test Client'
  );
  
  console.log('✓ Created test client');
  console.log(`  UUID: ${clientUuid}`);
  console.log(`  Client ID: ${testClientId}`);
  
  serverDb.close();
  
  console.log('\n--- Step 3: Signing test attachment metadata ---');
  
  // Sign test attachments using metadata signer
  const patchbinDb = new Database(testConfig.databases.patchbin);
  
  const testAttachment = testConfig.testAttachments[0];
  
  // Load private key
  const privateKeyHex = fs.readFileSync(testSigners.metadata.privateKeyFile, 'utf8');
  const privateKey = crypto.createPrivateKey({
    key: Buffer.from(privateKeyHex, 'hex'),
    format: 'der',
    type: 'pkcs8'
  });
  
  // Create signature
  function createCanonicalString(record) {
    const entries = Object.entries(record)
      .filter(([key]) => {
        if (key === 'siglistuuid') return false;
        if (key.includes('signature')) return false;
        if (key === 'file_data') return false;
        if (key.includes('_time')) return false;
        return true;
      })
      .sort(([a], [b]) => a.localeCompare(b));
    
    const parts = entries.map(([key, value]) => {
      if (value === null) return `${key}=null`;
      return `${key}=${value}`;
    });
    
    return parts.join('&');
  }
  
  const attachment = patchbinDb.prepare(`SELECT * FROM attachments WHERE auuid = ?`).get(testAttachment.auuid);
  const canonical = createCanonicalString(attachment);
  const hash = crypto.createHash('sha256').update(canonical).digest();
  const signature = crypto.sign(null, hash, privateKey);
  
  // Create signature list
  const siglistUuid = crypto.randomUUID();
  patchbinDb.prepare(`
    INSERT INTO signaturelists (siglistuuid, record_type, record_uuid, signed_row_version)
    VALUES (?, ?, ?, ?)
  `).run(siglistUuid, 'attachments', testAttachment.auuid, 1);
  
  // Add signature entry
  const sentryUuid = crypto.randomUUID();
  patchbinDb.prepare(`
    INSERT INTO signaturelistentries (sentryuuid, siglistuuid, signeruuid, signature, signature_algorithm)
    VALUES (?, ?, ?, ?, ?)
  `).run(sentryUuid, siglistUuid, testSigners.metadata.uuid, signature.toString('hex'), 'ED25519');
  
  // Update attachment with siglistuuid
  patchbinDb.prepare(`UPDATE attachments SET siglistuuid = ? WHERE auuid = ?`).run(siglistUuid, testAttachment.auuid);
  
  console.log('✓ Signed test attachment');
  console.log(`  auuid: ${testAttachment.auuid}`);
  console.log(`  siglistuuid: ${siglistUuid}`);
  
  patchbinDb.close();
  
  console.log('\n--- Step 4: Testing API search endpoint ---');
  
  // Test direct API call
  try {
    const searchResponse = await fetch('http://localhost:3001/api/search', {
      method: 'POST',
      headers: {
        'X-Client-Id': testClientId,
        'X-Client-Secret': testClientSecret,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        auuid: testAttachment.auuid,
        file_hash_sha256: testAttachment.file_hash_sha256
      })
    });
    
    if (searchResponse.ok) {
      const contentType = searchResponse.headers.get('content-type');
      
      if (contentType === 'application/json') {
        const result = await searchResponse.json();
        
        console.log('✓ Received JSON response from API');
        console.log(`  Server signature present: ${!!result.server_signature}`);
        console.log(`  Response timestamp present: ${!!result.data?.response_timestamp}`);
        console.log(`  Metadata signatures present: ${!!result.data?.mdsignatures}`);
        
        // Verify response timestamp
        if (result.data?.response_timestamp) {
          const serverTime = new Date(result.data.response_timestamp);
          const clientTime = new Date();
          const timeDiffSeconds = Math.abs(clientTime - serverTime) / 1000;
          console.log(`  Response timestamp: ${result.data.response_timestamp}`);
          console.log(`  Time difference: ${Math.floor(timeDiffSeconds)} seconds`);
          
          if (timeDiffSeconds > 86400) {
            console.error(`  ✗ Timestamp too old! (>24 hours)`);
          } else {
            console.log('  ✓ Timestamp within valid range');
          }
        } else {
          console.error('  ✗ Response timestamp missing!');
        }
        
        // Verify server signature
        if (result.server_signature) {
          const serverSigner = result.server_signature.signeruuid;
          console.log(`  Server signer UUID: ${serverSigner}`);
          
          if (serverSigner !== testSigners.server.uuid) {
            console.error(`  ✗ Server signer mismatch! Expected ${testSigners.server.uuid}`);
          } else {
            console.log('  ✓ Server signer verified');
          }
        }
        
        // Verify metadata signatures
        if (result.data?.mdsignatures && result.data.mdsignatures.length > 0) {
          console.log(`  Found ${result.data.mdsignatures.length} metadata signature(s)`);
          const metadataSig = result.data.mdsignatures[0];
          console.log(`    Signer: ${metadataSig.signeruuid}`);
          console.log(`    Algorithm: ${metadataSig.algorithm}`);
        }
      } else {
        console.log('✓ Received binary response from API');
        const fileData = Buffer.from(await searchResponse.arrayBuffer());
        console.log(`  File size: ${fileData.length} bytes`);
      }
    } else {
      console.error(`✗ API search failed: HTTP ${searchResponse.status}`);
    }
  } catch (error) {
    console.error(`✗ API test error: ${error.message}`);
  }
  
  console.log('\n--- Step 5: Testing fetchpatches.js with API search ---');
  
  // Test fetchpatches with --apisearch option
  const fetchpatchesProcess = spawn('node', [
    path.join(__dirname, '..', 'fetchpatches.js'),
    'mode2',
    `--patchbindb=${testConfig.databases.patchbin}`,
    `--rhdatadb=${testConfig.databases.rhdata}`,
    '--searchmax=1',
    '--apisearch',
    '--apiurl=http://localhost:3001/api/search',
    `--apiclient=${testClientId}`,
    `--apisecret=${testClientSecret}`
  ], {
    stdio: 'inherit'
  });
  
  fetchpatchesProcess.on('close', (code) => {
    console.log(`\n✓ fetchpatches.js completed with exit code ${code}`);
    
    console.log('\n======================================================================');
    console.log('End-to-End Test Complete!');
    console.log('======================================================================\n');
    
    // Cleanup
    if (serverProcess) {
      serverProcess.kill('SIGTERM');
    }
    
    process.exit(code);
  });
}

// Run the test
runTest().catch(error => {
  console.error('Test failed:', error);
  if (serverProcess) {
    serverProcess.kill('SIGTERM');
  }
  process.exit(1);
});

// Handle Ctrl+C
process.on('SIGINT', () => {
  console.log('\n\nStopping test...');
  if (serverProcess) {
    serverProcess.kill('SIGINT');
  }
  process.exit(0);
});

