#!/usr/bin/env node

/**
 * Create API client credentials
 * 
 * Usage:
 *   node create_client.js <client_name> [admin]
 *   node create_client.js "Test Client"
 *   node create_client.js "Admin Client" admin
 */

const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
require('dotenv').config({ path: path.join(__dirname, 'environment') });

const SERVER_DATA_DB = path.join(__dirname, 'mdserverdata.db');
const VAULT_KEY = process.env.VAULT_KEY;

if (!VAULT_KEY || VAULT_KEY.length !== 64) {
  console.error('Error: VAULT_KEY must be a 64-character hex string (256 bits)');
  process.exit(1);
}

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
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('Create API Client Credentials\n');
    console.log('Usage:');
    console.log('  node create_client.js <client_name> [admin]');
    console.log();
    console.log('Examples:');
    console.log('  node create_client.js "Test Client"');
    console.log('  node create_client.js "Admin Client" admin');
    console.log();
    process.exit(0);
  }
  
  const clientName = args[0];
  const isAdmin = args[1] === 'admin' ? 1 : 0;
  
  console.log('='.repeat(70));
  console.log('Creating API Client');
  console.log('='.repeat(70));
  console.log();
  
  // Initialize database if needed
  if (!fs.existsSync(SERVER_DATA_DB)) {
    console.log('Initializing server database...');
    const db = new Database(SERVER_DATA_DB);
    const schema = fs.readFileSync(path.join(__dirname, 'serverdata.sql'), 'utf8');
    db.exec(schema);
    db.close();
    console.log('✓ Database created\n');
  }
  
  const db = new Database(SERVER_DATA_DB);
  
  try {
    // Generate credentials
    const clientId = generateUUID();
    const clientSecret = crypto.randomBytes(32).toString('hex'); // 256-bit secret
    const clientUuid = generateUUID();
    
    // Encrypt credentials
    const encryptedClientId = encrypt(clientId);
    const encryptedSecret = encrypt(clientSecret);
    
    // Insert into database
    db.prepare(`
      INSERT INTO apiclients (clientuuid, encrypted_clientid, encrypted_secret, admin_client, client_name)
      VALUES (?, ?, ?, ?, ?)
    `).run(clientUuid, encryptedClientId, encryptedSecret, isAdmin, clientName);
    
    console.log('✓ Client created successfully\n');
    console.log('='.repeat(70));
    console.log('Client Credentials');
    console.log('='.repeat(70));
    console.log();
    console.log(`Client Name:   ${clientName}`);
    console.log(`Client ID:     ${clientId}`);
    console.log(`Client Secret: ${clientSecret}`);
    console.log(`Admin Access:  ${isAdmin ? 'Yes' : 'No (Read-only)'}`);
    console.log();
    console.log('⚠ IMPORTANT: Save these credentials securely!');
    console.log('   They cannot be retrieved later.');
    console.log();
    console.log('='.repeat(70));
    console.log('Usage with API:');
    console.log('='.repeat(70));
    console.log();
    console.log('Headers:');
    console.log(`  X-Client-Id: ${clientId}`);
    console.log(`  X-Client-Secret: ${clientSecret}`);
    console.log();
    console.log('Example curl command:');
    console.log(`  curl -H "X-Client-Id: ${clientId}" \\`);
    console.log(`       -H "X-Client-Secret: ${clientSecret}" \\`);
    console.log(`       http://localhost:3000/api/attachments`);
    console.log();
    console.log('Example with fetchpatches.js:');
    console.log(`  node fetchpatches.js mode2 --apisearch \\`);
    console.log(`       --apiurl=http://localhost:3000/api/search \\`);
    console.log(`       --apiclient=${clientId} \\`);
    console.log(`       --apisecret=${clientSecret}`);
    console.log();
    
  } catch (error) {
    console.error('Error creating client:', error.message);
    process.exit(1);
  } finally {
    db.close();
  }
}

if (require.main === module) {
  main();
}

module.exports = { encrypt, generateUUID };

