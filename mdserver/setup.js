#!/usr/bin/env node

/**
 * Setup script for Metadata API Server
 * 
 * - Copies databases from electron/ to mdserver/
 * - Creates mdserverdata.db
 * - Creates initial admin client
 * 
 * Usage:
 *   node setup.js
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const crypto = require('crypto');
require('dotenv').config({ path: path.join(__dirname, 'environment') });

const VAULT_KEY = process.env.VAULT_KEY;

const SOURCE_RHDATA = path.join(__dirname, '..', 'electron', 'rhdata.db');
const SOURCE_PATCHBIN = path.join(__dirname, '..', 'electron', 'patchbin.db');

const DEST_RHDATA = path.join(__dirname, 'rhdata.db');
const DEST_PATCHBIN = path.join(__dirname, 'patchbin.db');
const SERVER_DATA_DB = path.join(__dirname, 'mdserverdata.db');

/**
 * Encrypt data using VAULT_KEY
 */
function encrypt(text) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(VAULT_KEY, 'hex'), iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

/**
 * Generate UUID
 */
function generateUUID() {
  return crypto.randomUUID();
}

function main() {
  console.log('='.repeat(70));
  console.log('Metadata API Server Setup');
  console.log('='.repeat(70));
  console.log();
  
  // Check VAULT_KEY
  if (!VAULT_KEY || VAULT_KEY.length !== 64) {
    console.error('Error: VAULT_KEY must be a 64-character hex string (256 bits)');
    console.error('Set in mdserver/environment file');
    process.exit(1);
  }
  
  console.log('✓ VAULT_KEY loaded from environment\n');
  
  // Step 1: Create symbolic links to databases (saves disk space)
  console.log('Step 1: Creating symbolic links to databases...');
  
  if (fs.existsSync(SOURCE_RHDATA)) {
    // Remove existing link/file if present
    if (fs.existsSync(DEST_RHDATA)) {
      fs.unlinkSync(DEST_RHDATA);
    }
    fs.symlinkSync(SOURCE_RHDATA, DEST_RHDATA);
    console.log(`  ✓ Linked rhdata.db → ../electron/rhdata.db`);
  } else {
    console.log(`  ⚠ Source rhdata.db not found at ${SOURCE_RHDATA}`);
  }
  
  if (fs.existsSync(SOURCE_PATCHBIN)) {
    // Remove existing link/file if present
    if (fs.existsSync(DEST_PATCHBIN)) {
      fs.unlinkSync(DEST_PATCHBIN);
    }
    fs.symlinkSync(SOURCE_PATCHBIN, DEST_PATCHBIN);
    console.log(`  ✓ Linked patchbin.db → ../electron/patchbin.db`);
  } else {
    console.log(`  ⚠ Source patchbin.db not found at ${SOURCE_PATCHBIN}`);
  }
  
  console.log();
  
  // Step 2: Initialize server database
  console.log('Step 2: Initializing server database...');
  
  const db = new Database(SERVER_DATA_DB);
  const schema = fs.readFileSync(path.join(__dirname, 'serverdata.sql'), 'utf8');
  db.exec(schema);
  
  console.log('  ✓ Created mdserverdata.db');
  console.log();
  
  // Step 3: Create default admin client
  console.log('Step 3: Creating default admin client...');
  
  const clientId = generateUUID();
  const clientSecret = crypto.randomBytes(32).toString('hex');
  const clientUuid = generateUUID();
  
  const encryptedClientId = encrypt(clientId);
  const encryptedSecret = encrypt(clientSecret);
  
  db.prepare(`
    INSERT INTO apiclients (clientuuid, encrypted_clientid, encrypted_secret, admin_client, client_name)
    VALUES (?, ?, ?, ?, ?)
  `).run(clientUuid, encryptedClientId, encryptedSecret, 1, 'Default Admin Client');
  
  console.log('  ✓ Created default admin client\n');
  
  db.close();
  
  // Step 4: Display credentials
  console.log('='.repeat(70));
  console.log('Setup Complete!');
  console.log('='.repeat(70));
  console.log();
  console.log('Default Admin Client Credentials:');
  console.log('='.repeat(70));
  console.log();
  console.log(`Client ID:     ${clientId}`);
  console.log(`Client Secret: ${clientSecret}`);
  console.log();
  console.log('⚠ SAVE THESE CREDENTIALS! They cannot be retrieved later.');
  console.log();
  console.log('Save to a file:');
  console.log(`  echo "CLIENT_ID=${clientId}" > mdserver/admin_credentials.txt`);
  console.log(`  echo "CLIENT_SECRET=${clientSecret}" >> mdserver/admin_credentials.txt`);
  console.log();
  console.log('='.repeat(70));
  console.log('Next Steps:');
  console.log('='.repeat(70));
  console.log();
  console.log('1. Start the server:');
  console.log('   npm run mdserver:start');
  console.log();
  console.log('2. Test the API:');
  console.log(`   curl -H "X-Client-Id: ${clientId}" \\`);
  console.log(`        -H "X-Client-Secret: ${clientSecret}" \\`);
  console.log(`        http://localhost:3000/health`);
  console.log();
  console.log('3. Create additional clients:');
  console.log('   npm run mdserver:create-client "Client Name"');
  console.log('   npm run mdserver:create-client "Admin Name" admin');
  console.log();
}

if (require.main === module) {
  main();
}

module.exports = { main };

