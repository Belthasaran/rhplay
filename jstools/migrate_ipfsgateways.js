#!/usr/bin/env node

/**
 * Migration script to add priority and notes columns to ipfsgateways table
 * 
 * Usage:
 *   node migrate_ipfsgateways.js
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const crypto = require('crypto');

const PATCHBIN_DB_PATH = path.join(__dirname, 'electron', 'patchbin.db');

function generateUUID() {
  return crypto.randomUUID();
}

function main() {
  console.log('='.repeat(70));
  console.log('Migrating ipfsgateways table');
  console.log('='.repeat(70));
  console.log();
  
  if (!fs.existsSync(PATCHBIN_DB_PATH)) {
    console.error(`Error: patchbin.db not found at ${PATCHBIN_DB_PATH}`);
    process.exit(1);
  }
  
  const db = new Database(PATCHBIN_DB_PATH);
  
  try {
    // Check if ipfsgateways table exists
    const tableExists = db.prepare(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name='ipfsgateways'
    `).get();
    
    if (!tableExists) {
      console.log('Creating ipfsgateways table...');
      db.exec(`
        CREATE TABLE ipfsgateways (
          gwuuid varchar(255),
          url varchar(255),
          priority INTEGER DEFAULT 100,
          notworking_timestamp TIMESTAMP,
          lastsuccess_timesteamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          error text,
          notes text,
          PRIMARY KEY(gwuuid),
          UNIQUE(url)
        );
      `);
      console.log('✓ Created ipfsgateways table');
      
      // Insert default gateways
      console.log('\nInserting default IPFS gateways...');
      const insertStmt = db.prepare(`
        INSERT INTO ipfsgateways (gwuuid, url, priority, notes)
        VALUES (?, ?, ?, ?)
      `);
      
      insertStmt.run(generateUUID(), 'https://ipfs.io/ipfs/%CID%', 10, 'Official IPFS gateway');
      insertStmt.run(generateUUID(), 'https://gateway.pinata.cloud/ipfs/%CID%', 20, 'Pinata IPFS gateway');
      insertStmt.run(generateUUID(), 'https://cloudflare-ipfs.com/ipfs/%CID%', 30, 'Cloudflare IPFS gateway');
      insertStmt.run(generateUUID(), 'https://dweb.link/ipfs/%CID%', 40, 'Protocol Labs gateway');
      
      console.log('✓ Inserted 4 default gateways');
      
    } else {
      // Table exists - check for priority column
      const columns = db.prepare("PRAGMA table_info(ipfsgateways)").all();
      const hasPriority = columns.some(col => col.name === 'priority');
      const hasNotes = columns.some(col => col.name === 'notes');
      
      console.log('ipfsgateways table exists');
      console.log(`  priority column: ${hasPriority ? 'exists' : 'missing'}`);
      console.log(`  notes column: ${hasNotes ? 'exists' : 'missing'}`);
      
      // Add priority column if missing
      if (!hasPriority) {
        console.log('\nAdding priority column...');
        db.exec(`ALTER TABLE ipfsgateways ADD COLUMN priority INTEGER DEFAULT 100;`);
        console.log('✓ Added priority column');
      }
      
      // Add notes column if missing
      if (!hasNotes) {
        console.log('\nAdding notes column...');
        db.exec(`ALTER TABLE ipfsgateways ADD COLUMN notes TEXT;`);
        console.log('✓ Added notes column');
      }
      
      // Check for existing gateways
      const existingGateways = db.prepare('SELECT * FROM ipfsgateways').all();
      console.log(`\nFound ${existingGateways.length} existing gateway(s)`);
      
      if (existingGateways.length > 0) {
        existingGateways.forEach(gw => {
          console.log(`  - ${gw.url} (priority: ${gw.priority || 'not set'})`);
        });
      } else {
        // No existing gateways, insert defaults
        console.log('\nInserting default IPFS gateways...');
        const insertStmt = db.prepare(`
          INSERT INTO ipfsgateways (gwuuid, url, priority, notes)
          VALUES (?, ?, ?, ?)
        `);
        
        insertStmt.run(generateUUID(), 'https://ipfs.io/ipfs/%CID%', 10, 'Official IPFS gateway');
        insertStmt.run(generateUUID(), 'https://gateway.pinata.cloud/ipfs/%CID%', 20, 'Pinata IPFS gateway');
        insertStmt.run(generateUUID(), 'https://cloudflare-ipfs.com/ipfs/%CID%', 30, 'Cloudflare IPFS gateway');
        insertStmt.run(generateUUID(), 'https://dweb.link/ipfs/%CID%', 40, 'Protocol Labs gateway');
        
        console.log('✓ Inserted 4 default gateways');
      }
    }
    
    // Show final state
    console.log('\n' + '='.repeat(70));
    console.log('Final state:');
    const finalGateways = db.prepare('SELECT gwuuid, url, priority, notes FROM ipfsgateways ORDER BY priority ASC').all();
    console.log(`Total gateways: ${finalGateways.length}\n`);
    
    if (finalGateways.length > 0) {
      console.log('Gateway List:');
      finalGateways.forEach((gw, idx) => {
        console.log(`  ${idx+1}. [Priority ${gw.priority || 100}] ${gw.url}`);
        if (gw.notes) {
          console.log(`     Notes: ${gw.notes}`);
        }
      });
    }
    
    console.log('\n✓ Migration complete!');
    
  } catch (error) {
    console.error('\nError during migration:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    db.close();
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };

