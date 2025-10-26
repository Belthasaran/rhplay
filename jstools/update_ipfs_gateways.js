#!/usr/bin/env node

/**
 * Update existing IPFS gateways with priorities and %CID% placeholders
 * 
 * Usage:
 *   node update_ipfs_gateways.js
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const PATCHBIN_DB_PATH = path.join(__dirname, 'electron', 'patchbin.db');

function main() {
  console.log('='.repeat(70));
  console.log('Updating IPFS Gateway URLs and Priorities');
  console.log('='.repeat(70));
  console.log();
  
  if (!fs.existsSync(PATCHBIN_DB_PATH)) {
    console.error(`Error: patchbin.db not found at ${PATCHBIN_DB_PATH}`);
    process.exit(1);
  }
  
  const db = new Database(PATCHBIN_DB_PATH);
  
  try {
    const gateways = db.prepare('SELECT gwuuid, url, priority FROM ipfsgateways').all();
    
    console.log(`Found ${gateways.length} gateway(s) to update\n`);
    
    const updateStmt = db.prepare(`
      UPDATE ipfsgateways 
      SET url = ?, priority = ?, notes = ?
      WHERE gwuuid = ?
    `);
    
    // Gateway configurations
    const updates = [
      { 
        pattern: 'ipfs.io',
        url: 'https://ipfs.io/ipfs/%CID%',
        priority: 10,
        notes: 'Official IPFS gateway'
      },
      { 
        pattern: 'pinata',
        url: 'https://gateway.pinata.cloud/ipfs/%CID%',
        priority: 20,
        notes: 'Pinata IPFS gateway'
      },
      { 
        pattern: 'cloudflare',
        url: 'https://cloudflare-ipfs.com/ipfs/%CID%',
        priority: 30,
        notes: 'Cloudflare IPFS gateway'
      },
      { 
        pattern: 'dweb.link',
        url: 'https://dweb.link/ipfs/%CID%',
        priority: 40,
        notes: 'Protocol Labs gateway'
      },
      { 
        pattern: '4everland',
        url: 'https://ipfs.4everland.io/ipfs/%CID%',
        priority: 50,
        notes: '4everland IPFS gateway'
      },
      { 
        pattern: 'filebase',
        url: 'https://ipfs.filebase.io/ipfs/%CID%',
        priority: 60,
        notes: 'Filebase IPFS gateway'
      },
      { 
        pattern: 'storry',
        url: 'https://storry.tv/ipfs/%CID%',
        priority: 70,
        notes: 'Storry IPFS gateway'
      }
    ];
    
    let updated = 0;
    
    for (const gateway of gateways) {
      // Find matching update
      const update = updates.find(u => gateway.url.includes(u.pattern));
      
      if (update) {
        console.log(`Updating: ${gateway.url}`);
        console.log(`  New URL: ${update.url}`);
        console.log(`  Priority: ${update.priority}`);
        console.log(`  Notes: ${update.notes}`);
        
        updateStmt.run(update.url, update.priority, update.notes, gateway.gwuuid);
        console.log('  ✓ Updated\n');
        updated++;
      } else {
        console.log(`Skipping (no match): ${gateway.url}`);
        
        // Add %CID% to URL if not present
        let newUrl = gateway.url;
        if (!newUrl.includes('%CID%')) {
          // Ensure URL ends with /
          if (!newUrl.endsWith('/')) {
            newUrl += '/';
          }
          newUrl += 'ipfs/%CID%';
          
          console.log(`  Adding %CID% pattern: ${newUrl}`);
          updateStmt.run(newUrl, gateway.priority || 100, null, gateway.gwuuid);
          console.log('  ✓ Updated\n');
          updated++;
        } else {
          console.log();
        }
      }
    }
    
    console.log('='.repeat(70));
    console.log(`\n✓ Updated ${updated} gateway(s)`);
    
    // Show final state
    console.log('\nFinal gateway list:\n');
    const finalGateways = db.prepare(`
      SELECT gwuuid, url, priority, notes 
      FROM ipfsgateways 
      ORDER BY priority ASC
    `).all();
    
    finalGateways.forEach((gw, idx) => {
      console.log(`${idx+1}. [Priority ${gw.priority}] ${gw.url}`);
      if (gw.notes) {
        console.log(`   ${gw.notes}`);
      }
    });
    
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

