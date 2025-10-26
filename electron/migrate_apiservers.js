#!/usr/bin/env node

/**
 * Migration: Add apiservers table to clientdata.db
 * 
 * This migration adds the apiservers table for storing encrypted
 * API server credentials.
 * 
 * Usage:
 *   node electron/migrate_apiservers.js [path/to/clientdata.db]
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DEFAULT_DB_PATH = path.join(__dirname, '..', 'clientdata.db');
const dbPath = process.argv[2] || DEFAULT_DB_PATH;

console.log('='.repeat(70));
console.log('Migration: Add apiservers table to clientdata.db');
console.log('='.repeat(70));
console.log();

if (!fs.existsSync(dbPath)) {
  console.error(`✗ Database not found: ${dbPath}`);
  console.error('\nCreate the database first or specify the correct path:');
  console.error(`  node ${path.basename(__filename)} path/to/clientdata.db`);
  process.exit(1);
}

console.log(`Database: ${dbPath}`);
console.log();

const db = new Database(dbPath);

try {
  // Check if table already exists
  const tableExists = db.prepare(`
    SELECT name FROM sqlite_master 
    WHERE type='table' AND name='apiservers'
  `).get();
  
  if (tableExists) {
    console.log('⓿ apiservers table already exists');
    console.log('✓ No migration needed');
  } else {
    console.log('Creating apiservers table...');
    
    db.exec(`
      CREATE TABLE apiservers (
        apiserveruuid VARCHAR(255) PRIMARY KEY,
        server_name VARCHAR(255),
        api_url TEXT NOT NULL,
        encrypted_clientid TEXT,
        encrypted_clientsecret TEXT,
        is_active INTEGER DEFAULT 1,
        last_used TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        notes TEXT
      )
    `);
    
    console.log('✓ Created apiservers table');
    
    // Verify table was created
    const columns = db.prepare("PRAGMA table_info(apiservers)").all();
    console.log(`✓ Table has ${columns.length} columns:`);
    columns.forEach(col => {
      console.log(`    - ${col.name} (${col.type})`);
    });
  }
  
  console.log();
  console.log('='.repeat(70));
  console.log('Migration completed successfully!');
  console.log('='.repeat(70));
  console.log();
  console.log('Next steps:');
  console.log('  1. Set RHTCLIENT_VAULT_KEY environment variable');
  console.log('  2. Add API servers using: node electron/manage_apiserver.js add');
  console.log();
  
} catch (error) {
  console.error('✗ Migration failed:', error.message);
  process.exit(1);
} finally {
  db.close();
}

