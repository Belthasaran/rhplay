#!/usr/bin/env node

/**
 * Manage API Server Credentials
 * 
 * Store and retrieve encrypted API server credentials in clientdata.db
 * Credentials are encrypted using AES-256-CBC with RHTCLIENT_VAULT_KEY
 * 
 * Usage:
 *   node manage_apiserver.js add
 *   node manage_apiserver.js list
 *   node manage_apiserver.js remove <uuid>
 *   node manage_apiserver.js test <uuid>
 * 
 * Environment:
 *   RHTCLIENT_VAULT_KEY - 64-character hex string (256-bit key)
 *   CLIENTDATA_DB       - Path to clientdata.db (optional)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');
const Database = require('better-sqlite3');

const DEFAULT_DB_PATH = path.join(__dirname, '..', 'clientdata.db');
const CLIENTDATA_DB = process.env.CLIENTDATA_DB || DEFAULT_DB_PATH;
const VAULT_KEY = process.env.RHTCLIENT_VAULT_KEY;

// TODO: Move to OS-specific secure keychain
// - Windows: Windows Credential Manager
// - macOS: Keychain Access
// - Linux: Secret Service API (libsecret)

/**
 * Encrypt data using RHTCLIENT_VAULT_KEY
 */
function encrypt(text) {
  if (!VAULT_KEY || VAULT_KEY.length !== 64) {
    throw new Error('RHTCLIENT_VAULT_KEY must be a 64-character hex string (256 bits)');
  }
  
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(VAULT_KEY, 'hex'), iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

/**
 * Decrypt data using RHTCLIENT_VAULT_KEY
 */
function decrypt(text) {
  if (!VAULT_KEY || VAULT_KEY.length !== 64) {
    throw new Error('RHTCLIENT_VAULT_KEY must be a 64-character hex string (256 bits)');
  }
  
  const parts = text.split(':');
  if (parts.length !== 2) {
    throw new Error('Invalid encrypted data format');
  }
  
  const iv = Buffer.from(parts[0], 'hex');
  const encrypted = parts[1];
  const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(VAULT_KEY, 'hex'), iv);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

/**
 * Prompt user for input
 */
function prompt(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer);
    });
  });
}

/**
 * Prompt for password (hidden input)
 */
function promptSecret(question) {
  return new Promise(resolve => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    process.stdout.write(question);
    
    // Hide input
    process.stdin.setRawMode(true);
    let password = '';
    
    process.stdin.on('data', chunk => {
      const char = chunk.toString('utf8');
      
      if (char === '\r' || char === '\n') {
        process.stdin.setRawMode(false);
        process.stdout.write('\n');
        rl.close();
        process.stdin.removeAllListeners('data');
        resolve(password);
      } else if (char === '\u0003' || char === '\u0004') {
        // Ctrl+C or Ctrl+D
        process.stdin.setRawMode(false);
        console.log('\nCancelled');
        process.exit(0);
      } else if (char === '\u007f') {
        // Backspace
        if (password.length > 0) {
          password = password.slice(0, -1);
          process.stdout.write('\b \b');
        }
      } else {
        password += char;
        process.stdout.write('*');
      }
    });
  });
}

/**
 * Add new API server
 */
async function addServer() {
  console.log('='.repeat(70));
  console.log('Add API Server');
  console.log('='.repeat(70));
  console.log();
  
  const serverName = await prompt('Server name (e.g., "Production", "Test"): ');
  const apiUrl = await prompt('API URL (e.g., "https://api.example.com"): ');
  const clientId = await prompt('Client ID (UUID): ');
  const clientSecret = await promptSecret('Client Secret: ');
  const notes = await prompt('Notes (optional): ');
  
  console.log();
  console.log('Encrypting credentials...');
  
  try {
    const encryptedClientId = encrypt(clientId);
    const encryptedSecret = encrypt(clientSecret);
    
    const db = new Database(CLIENTDATA_DB);
    const serverUuid = crypto.randomUUID();
    
    db.prepare(`
      INSERT INTO apiservers (
        apiserveruuid, server_name, api_url, 
        encrypted_clientid, encrypted_clientsecret, notes
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      serverUuid,
      serverName,
      apiUrl,
      encryptedClientId,
      encryptedSecret,
      notes || null
    );
    
    db.close();
    
    console.log('✓ API server added successfully!');
    console.log();
    console.log('  UUID:', serverUuid);
    console.log('  Name:', serverName);
    console.log('  URL:', apiUrl);
    console.log();
    
  } catch (error) {
    console.error('✗ Error:', error.message);
    process.exit(1);
  }
}

/**
 * List API servers
 */
function listServers() {
  console.log('='.repeat(70));
  console.log('API Servers');
  console.log('='.repeat(70));
  console.log();
  
  try {
    const db = new Database(CLIENTDATA_DB, { readonly: true });
    const servers = db.prepare(`
      SELECT apiserveruuid, server_name, api_url, is_active, 
             last_used, created_at, notes
      FROM apiservers
      ORDER BY is_active DESC, server_name ASC
    `).all();
    
    db.close();
    
    if (servers.length === 0) {
      console.log('No API servers configured.');
      console.log();
      console.log('Add one with: node manage_apiserver.js add');
      console.log();
      return;
    }
    
    servers.forEach((server, i) => {
      console.log(`[${i + 1}] ${server.server_name || 'Unnamed'}`);
      console.log(`    UUID:   ${server.apiserveruuid}`);
      console.log(`    URL:    ${server.api_url}`);
      console.log(`    Active: ${server.is_active ? 'Yes' : 'No'}`);
      if (server.last_used) {
        console.log(`    Last:   ${server.last_used}`);
      }
      if (server.notes) {
        console.log(`    Notes:  ${server.notes}`);
      }
      console.log();
    });
    
    console.log(`Total: ${servers.length} server(s)`);
    console.log();
    
  } catch (error) {
    console.error('✗ Error:', error.message);
    process.exit(1);
  }
}

/**
 * Remove API server
 */
async function removeServer(uuid) {
  if (!uuid) {
    console.error('Usage: node manage_apiserver.js remove <uuid>');
    process.exit(1);
  }
  
  console.log('='.repeat(70));
  console.log('Remove API Server');
  console.log('='.repeat(70));
  console.log();
  
  try {
    const db = new Database(CLIENTDATA_DB);
    
    const server = db.prepare(`
      SELECT server_name, api_url FROM apiservers WHERE apiserveruuid = ?
    `).get(uuid);
    
    if (!server) {
      console.error(`✗ Server not found: ${uuid}`);
      db.close();
      process.exit(1);
    }
    
    console.log('Server to remove:');
    console.log(`  Name: ${server.server_name}`);
    console.log(`  URL:  ${server.api_url}`);
    console.log();
    
    const confirm = await prompt('Are you sure? (yes/no): ');
    
    if (confirm.toLowerCase() === 'yes') {
      db.prepare(`DELETE FROM apiservers WHERE apiserveruuid = ?`).run(uuid);
      console.log('✓ Server removed');
    } else {
      console.log('Cancelled');
    }
    
    db.close();
    console.log();
    
  } catch (error) {
    console.error('✗ Error:', error.message);
    process.exit(1);
  }
}

/**
 * Test API server connection
 */
async function testServer(uuid) {
  if (!uuid) {
    console.error('Usage: node manage_apiserver.js test <uuid>');
    process.exit(1);
  }
  
  console.log('='.repeat(70));
  console.log('Test API Server Connection');
  console.log('='.repeat(70));
  console.log();
  
  try {
    const db = new Database(CLIENTDATA_DB);
    
    const server = db.prepare(`
      SELECT server_name, api_url, encrypted_clientid, encrypted_clientsecret
      FROM apiservers WHERE apiserveruuid = ?
    `).get(uuid);
    
    db.close();
    
    if (!server) {
      console.error(`✗ Server not found: ${uuid}`);
      process.exit(1);
    }
    
    console.log('Server:', server.server_name);
    console.log('URL:', server.api_url);
    console.log();
    console.log('Decrypting credentials...');
    
    const clientId = decrypt(server.encrypted_clientid);
    const clientSecret = decrypt(server.encrypted_clientsecret);
    
    console.log('✓ Credentials decrypted');
    console.log();
    console.log('Testing connection...');
    
    // Test health endpoint
    const healthUrl = new URL('/health', server.api_url).toString();
    const response = await fetch(healthUrl);
    
    if (response.ok) {
      console.log('✓ Health check passed');
    } else {
      console.log(`⚠ Health check: HTTP ${response.status}`);
    }
    
    // Test authenticated endpoint
    console.log();
    console.log('Testing authentication...');
    
    const apiUrl = new URL('/api/attachments', server.api_url).toString();
    const authResponse = await fetch(apiUrl, {
      headers: {
        'X-Client-Id': clientId,
        'X-Client-Secret': clientSecret
      }
    });
    
    if (authResponse.ok) {
      console.log('✓ Authentication successful');
      console.log(`✓ Server connection working!`);
    } else if (authResponse.status === 401) {
      console.log('✗ Authentication failed (check credentials)');
    } else {
      console.log(`⚠ Unexpected response: HTTP ${authResponse.status}`);
    }
    
    console.log();
    
  } catch (error) {
    console.error('✗ Error:', error.message);
    process.exit(1);
  }
}

/**
 * Show help
 */
function showHelp() {
  console.log('Manage API Server Credentials');
  console.log();
  console.log('Usage:');
  console.log('  node manage_apiserver.js add              # Add new server');
  console.log('  node manage_apiserver.js list             # List all servers');
  console.log('  node manage_apiserver.js remove <uuid>    # Remove server');
  console.log('  node manage_apiserver.js test <uuid>      # Test connection');
  console.log();
  console.log('Environment Variables:');
  console.log('  RHTCLIENT_VAULT_KEY   64-char hex string (256-bit encryption key)');
  console.log('  CLIENTDATA_DB         Path to clientdata.db (optional)');
  console.log();
  console.log('Examples:');
  console.log('  # Generate encryption key');
  console.log('  export RHTCLIENT_VAULT_KEY=$(openssl rand -hex 32)');
  console.log();
  console.log('  # Add server');
  console.log('  node manage_apiserver.js add');
  console.log();
  console.log('  # List servers');
  console.log('  node manage_apiserver.js list');
  console.log();
  console.log('Security Note:');
  console.log('  Credentials are encrypted with AES-256-CBC using RHTCLIENT_VAULT_KEY.');
  console.log('  TODO: Move key storage to OS-specific secure keychain.');
  console.log();
}

/**
 * Main
 */
async function main() {
  const command = process.argv[2];
  const arg = process.argv[3];
  
  // Check database exists
  if (command && command !== 'help' && !fs.existsSync(CLIENTDATA_DB)) {
    console.error(`✗ Database not found: ${CLIENTDATA_DB}`);
    console.error('\nRun migration first:');
    console.error('  node electron/migrate_apiservers.js');
    process.exit(1);
  }
  
  // Check VAULT_KEY for operations that need it
  if (['add', 'test'].includes(command)) {
    if (!VAULT_KEY) {
      console.error('✗ RHTCLIENT_VAULT_KEY environment variable not set');
      console.error('\nGenerate one with:');
      console.error('  export RHTCLIENT_VAULT_KEY=$(openssl rand -hex 32)');
      console.error('\nOr on Windows:');
      console.error('  set RHTCLIENT_VAULT_KEY=<64-char-hex-string>');
      process.exit(1);
    }
    
    if (VAULT_KEY.length !== 64) {
      console.error('✗ RHTCLIENT_VAULT_KEY must be 64 characters (32 bytes hex)');
      process.exit(1);
    }
  }
  
  switch (command) {
    case 'add':
      await addServer();
      break;
    
    case 'list':
      listServers();
      break;
    
    case 'remove':
      await removeServer(arg);
      break;
    
    case 'test':
      await testServer(arg);
      break;
    
    case 'help':
    default:
      showHelp();
      break;
  }
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

