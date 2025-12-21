#!/usr/bin/env node

/**
 * search_rebuild_fts5.js - Quick FTS5 index rebuild
 * 
 * Usage:
 *   enode.sh search_rebuild_fts5.js [--rhsearchdb=path/to/rhsearch_cat.db]
 * 
 * Quickly rebuilds the FTS5 search index without running the full Stage 2.
 * This is useful when the FTS5 index gets out of sync with the items table.
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

// Helper function to find database file
function findSearchDatabase(rhsearchdb) {
  if (rhsearchdb) {
    return rhsearchdb;
  }
  
  // Try common locations
  const possiblePaths = [
    path.join(__dirname, '..', 'electron', 'rhsearch_cat.db'),
    path.join(__dirname, '..', 'refmaterial', 'rhsearch_cat.db'),
    path.join(process.env.HOME, '.config', 'rhplay', 'rhsearch_cat.db')
  ];
  
  for (const dbPath of possiblePaths) {
    if (fs.existsSync(dbPath)) {
      return dbPath;
    }
  }
  
  throw new Error('Database not found. Please specify --rhsearchdb=path/to/rhsearch_cat.db');
}

// Main function
function rebuildFTS5(options) {
  const { rhsearchdb } = options;
  
  console.log('='.repeat(70));
  console.log('FTS5 Index Rebuild');
  console.log('='.repeat(70));
  console.log();
  
  // Find database
  const dbPath = findSearchDatabase(rhsearchdb);
  console.log(`Database: ${dbPath}`);
  console.log();
  
  if (!fs.existsSync(dbPath)) {
    throw new Error(`Database not found: ${dbPath}`);
  }
  
  // Open database
  const db = new Database(dbPath);
  
  try {
    // Check if items table exists
    const itemsExists = db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='items'
    `).get();
    
    if (!itemsExists) {
      throw new Error('Items table not found. Run Stage 1 (search_build1.js) first.');
    }
    
    // Get item count
    const itemCount = db.prepare(`SELECT COUNT(*) as count FROM items`).get().count;
    console.log(`Found ${itemCount} item(s) in items table`);
    console.log();
    
    // Drop old triggers
    console.log('Dropping old FTS5 triggers...');
    db.exec(`
      DROP TRIGGER IF EXISTS items_fts_insert;
      DROP TRIGGER IF EXISTS items_fts_update;
      DROP TRIGGER IF EXISTS items_fts_delete;
    `);
    console.log('  ✓ Triggers dropped');
    console.log();
    
    // Drop and recreate FTS5 table
    console.log('Rebuilding FTS5 index...');
    db.exec(`
      DROP TABLE IF EXISTS items_fts;
      CREATE VIRTUAL TABLE items_fts USING fts5(
        item_id UNINDEXED,
        title,
        author,
        versioninfo,
        tags,
        brief,
        levelnames_keywords,
        content='items',
        content_rowid='rowid'
      );
    `);
    console.log('  ✓ FTS5 table created');
    
    // Rebuild the index
    try {
      db.exec(`INSERT INTO items_fts(items_fts) VALUES('rebuild')`);
      console.log('  ✓ FTS5 index rebuilt using rebuild command');
    } catch (error) {
      // If rebuild fails, fall back to manual population
      console.log('  ⚠ Rebuild command failed, using manual population...');
      const rebuildStmt = db.prepare(`
        INSERT INTO items_fts (rowid, item_id, title, author, versioninfo, tags, brief, levelnames_keywords)
        SELECT 
          rowid,
          item_id,
          COALESCE(title, ''),
          COALESCE(author, ''),
          COALESCE(versioninfo, ''),
          COALESCE(tags, ''),
          COALESCE(brief, ''),
          COALESCE(levelnames_keywords, '')
        FROM items
      `);
      rebuildStmt.run();
      console.log('  ✓ FTS5 index populated manually');
    }
    console.log();
    
    // Recreate triggers
    console.log('Recreating FTS5 triggers...');
    db.exec(`
      CREATE TRIGGER items_fts_insert AFTER INSERT ON items BEGIN
        INSERT INTO items_fts (item_id, title, author, versioninfo, tags, brief, levelnames_keywords)
        VALUES (
          NEW.item_id,
          COALESCE(NEW.title, ''),
          COALESCE(NEW.author, ''),
          COALESCE(NEW.versioninfo, ''),
          COALESCE(NEW.tags, ''),
          COALESCE(NEW.brief, ''),
          COALESCE(NEW.levelnames_keywords, '')
        );
      END;
      
      CREATE TRIGGER items_fts_update AFTER UPDATE ON items BEGIN
        UPDATE items_fts SET
          title = COALESCE(NEW.title, ''),
          author = COALESCE(NEW.author, ''),
          versioninfo = COALESCE(NEW.versioninfo, ''),
          tags = COALESCE(NEW.tags, ''),
          brief = COALESCE(NEW.brief, ''),
          levelnames_keywords = COALESCE(NEW.levelnames_keywords, '')
        WHERE item_id = NEW.item_id;
      END;
      
      CREATE TRIGGER items_fts_delete AFTER DELETE ON items BEGIN
        DELETE FROM items_fts WHERE item_id = OLD.item_id;
      END;
    `);
    console.log('  ✓ Triggers recreated');
    console.log();
    
    // Verify the index
    const ftsCount = db.prepare(`SELECT COUNT(*) as count FROM items_fts`).get().count;
    console.log(`✓ FTS5 index rebuilt successfully`);
    console.log(`  Items in index: ${ftsCount}`);
    console.log(`  Items in table: ${itemCount}`);
    
    if (ftsCount !== itemCount) {
      console.warn(`  ⚠ Warning: Index count (${ftsCount}) doesn't match table count (${itemCount})`);
    } else {
      console.log(`  ✓ Index is in sync with items table`);
    }
    
  } finally {
    db.close();
  }
}

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    rhsearchdb: null
  };
  
  for (const arg of args) {
    if (arg === '--help' || arg === '-h') {
      console.log(`
Usage: enode.sh search_rebuild_fts5.js [options]

Options:
  --rhsearchdb=PATH    Path to rhsearch_cat.db (default: auto-detect)
  --help, -h           Show this help message

This script quickly rebuilds the FTS5 search index without running
the full Stage 2 grouping logic. Use this when the FTS5 index gets
out of sync with the items table.
      `);
      process.exit(0);
    } else if (arg.startsWith('--rhsearchdb=')) {
      options.rhsearchdb = arg.substring('--rhsearchdb='.length);
    }
  }
  
  return options;
}

// Main
if (require.main === module) {
  try {
    const options = parseArgs();
    rebuildFTS5(options);
    console.log();
    console.log('Done!');
  } catch (error) {
    console.error();
    console.error(`Fatal error: ${error.message}`);
    process.exit(1);
  }
}

module.exports = { rebuildFTS5 };
