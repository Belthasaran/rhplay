#!/usr/bin/env node

/**
 * search_build2.js - Stage 2: Entity resolution and grouping
 * 
 * Usage:
 *   enode.sh search_build2.js <index7z folder> <bps7z folder> [options]
 *   enode.sh search_build2.js --help
 * 
 * Stage 2: Resolve entities and generate groups clustering related items
 * - Deterministic grouping (IDs/hashes)
 * - Probabilistic merge pass (title/author similarity)
 * - Build groups and relationships
 * - Create FTS5 search index
 */

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const crypto = require('crypto');

// Helper function to normalize string for comparison
function normalizeForComparison(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ');
}

// Helper function to calculate string similarity (simple token-based)
function calculateSimilarity(str1, str2) {
  const norm1 = normalizeForComparison(str1);
  const norm2 = normalizeForComparison(str2);
  
  if (norm1 === norm2) return 1.0;
  if (norm1.length === 0 || norm2.length === 0) return 0.0;
  
  // Token-based similarity
  const tokens1 = new Set(norm1.split(/\s+/));
  const tokens2 = new Set(norm2.split(/\s+/));
  
  const intersection = new Set([...tokens1].filter(x => tokens2.has(x)));
  const union = new Set([...tokens1, ...tokens2]);
  
  return intersection.size / union.size;
}

// Helper function to check levelname overlap
function calculateLevelnameOverlap(levelnames1, levelnames2) {
  if (!levelnames1 || !levelnames2) return 0.0;
  
  const keys1 = new Set(Object.keys(levelnames1));
  const keys2 = new Set(Object.keys(levelnames2));
  
  // Check for unique non-vanilla level names
  const intersection = new Set([...keys1].filter(k => keys2.has(k)));
  const union = new Set([...keys1, ...keys2]);
  
  if (union.size === 0) return 0.0;
  
  // Also check if values match
  let matchingValues = 0;
  for (const key of intersection) {
    if (levelnames1[key] === levelnames2[key] && 
        levelnames1[key] && 
        !levelnames1[key].toUpperCase().includes('VANILLA')) {
      matchingValues++;
    }
  }
  
  return matchingValues / Math.max(keys1.size, keys2.size);
}

// Helper function to check lmfilter overlap
function calculateLmfilterOverlap(lmfilter1, lmfilter2) {
  if (!lmfilter1 || !lmfilter2 || !Array.isArray(lmfilter1) || !Array.isArray(lmfilter2)) {
    return 0.0;
  }
  
  const set1 = new Set(lmfilter1.map(l => String(l).padStart(3, '0')));
  const set2 = new Set(lmfilter2.map(l => String(l).padStart(3, '0')));
  
  const intersection = new Set([...set1].filter(x => set2.has(x)));
  const union = new Set([...set1, ...set2]);
  
  if (union.size === 0) return 0.0;
  
  return intersection.size / union.size;
}

// Main processing function
async function buildSearchCatalog2(index7zFolder, bps7zFolder, options) {
  const { rhsearchdb, rhsearchzip } = options;
  
  console.log('='.repeat(70));
  console.log('Stage 2: Entity Resolution and Grouping');
  console.log('='.repeat(70));
  console.log();
  
  // Determine database path
  const dbPath = rhsearchdb || path.join(path.dirname(index7zFolder), 'rhsearch_cat.db');
  
  if (!fsSync.existsSync(dbPath)) {
    throw new Error(`Database not found: ${dbPath}. Run Stage 1 first.`);
  }
  
  console.log(`Database: ${dbPath}`);
  console.log();
  
  // Open database
  const db = new Database(dbPath);
  
  // Create groups and edges tables
  console.log('Creating groups and edges schema...');
  db.exec(`
    CREATE TABLE IF NOT EXISTS groups (
      group_id TEXT PRIMARY KEY,
      canonical_title TEXT,
      canonical_author TEXT,
      canonical_source TEXT,
      confidence REAL DEFAULT 1.0,
      version_count INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    
    CREATE TABLE IF NOT EXISTS items_groups (
      item_id TEXT,
      group_id TEXT,
      version_label TEXT,
      version_sort_key TEXT,
      PRIMARY KEY (item_id, group_id),
      FOREIGN KEY (item_id) REFERENCES items(item_id),
      FOREIGN KEY (group_id) REFERENCES groups(group_id)
    );
    
    CREATE TABLE IF NOT EXISTS edges (
      src_id TEXT,
      dst_id TEXT,
      edge_type TEXT,
      weight REAL DEFAULT 1.0,
      evidence_json TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (src_id, dst_id, edge_type),
      FOREIGN KEY (src_id) REFERENCES groups(group_id),
      FOREIGN KEY (dst_id) REFERENCES groups(group_id)
    );
    
    CREATE INDEX IF NOT EXISTS idx_items_groups_group ON items_groups(group_id);
    CREATE INDEX IF NOT EXISTS idx_items_groups_item ON items_groups(item_id);
    CREATE INDEX IF NOT EXISTS idx_edges_src ON edges(src_id);
    CREATE INDEX IF NOT EXISTS idx_edges_dst ON edges(dst_id);
  `);
  
  // Load all items from database
  console.log('Loading items from database...');
  const items = db.prepare(`
    SELECT * FROM items
  `).all();
  
  console.log(`Loaded ${items.length} item(s)`);
  console.log();
  
  // Load JSON data for items (we'll need it for grouping)
  console.log('Loading JSON data from ZIP archive...');
  const zipPath = rhsearchzip || path.join(path.dirname(index7zFolder), 'rhsearch.zip');
  
  if (!fsSync.existsSync(zipPath)) {
    throw new Error(`ZIP archive not found: ${zipPath}. Run Stage 1 first.`);
  }
  
  const AdmZip = require('adm-zip');
  const zip = new AdmZip(zipPath);
  const zipEntries = zip.getEntries();
  
  const jsonDataMap = new Map();
  for (const entry of zipEntries) {
    if (entry.entryName.endsWith('.json')) {
      try {
        const content = entry.getData().toString('utf8');
        const json = JSON.parse(content);
        const itemId = path.basename(entry.entryName, '.json');
        jsonDataMap.set(itemId.toLowerCase(), json);
      } catch (error) {
        // Skip invalid JSON
      }
    }
  }
  
  console.log(`Loaded ${jsonDataMap.size} JSON file(s) from ZIP`);
  console.log();
  
  // Pass 1: Deterministic grouping
  console.log('Pass 1: Deterministic grouping...');
  const groupMap = new Map(); // group_id -> { items: [], ... }
  const itemToGroup = new Map(); // item_id -> group_id
  
  for (const item of items) {
    const json = jsonDataMap.get(item.item_id.toLowerCase());
    if (!json) continue;
    
    let groupId = null;
    let groupSource = null;
    let confidence = 1.0;
    
    // Strong key: gameid from gameversion
    if (json.gameversion && json.gameversion.gameid) {
      groupId = `smwcentral_${json.gameversion.gameid}`;
      groupSource = 'smwcentral';
      confidence = 1.0;
    }
    // Medium key: title + author from filename
    else if (item.title && item.author) {
      const normalizedTitle = normalizeForComparison(item.title);
      const normalizedAuthor = normalizeForComparison(item.author);
      if (normalizedTitle.length > 0 && normalizedAuthor.length > 0) {
        groupId = `title_author_${crypto.createHash('sha256')
          .update(`${normalizedTitle}|${normalizedAuthor}`)
          .digest('hex')
          .substring(0, 16)}`;
        groupSource = 'filename';
        confidence = 0.8;
      }
    }
    // Weak key: title tokens + folder hint
    else if (item.title) {
      const normalizedTitle = normalizeForComparison(item.title);
      if (normalizedTitle.length > 0) {
        const folderHint = item.folder_categories ? 
          JSON.parse(item.folder_categories)[0] || '' : '';
        groupId = `title_${crypto.createHash('sha256')
          .update(`${normalizedTitle}|${folderHint}`)
          .digest('hex')
          .substring(0, 16)}`;
        groupSource = 'title';
        confidence = 0.5;
      }
    }
    
    if (groupId) {
      if (!groupMap.has(groupId)) {
        groupMap.set(groupId, {
          group_id: groupId,
          canonical_title: item.title || null,
          canonical_author: item.author || null,
          canonical_source: groupSource,
          confidence: confidence,
          items: []
        });
      }
      
      const group = groupMap.get(groupId);
      group.items.push(item);
      itemToGroup.set(item.item_id, groupId);
      
      // Update canonical title/author if we have better data
      if (groupSource === 'smwcentral' && json.gameversion) {
        if (json.gameversion.name && !group.canonical_title) {
          group.canonical_title = json.gameversion.name;
        }
        if (json.gameversion.author && !group.canonical_author) {
          group.canonical_author = json.gameversion.author;
        }
      }
    }
  }
  
  console.log(`Created ${groupMap.size} group(s)`);
  console.log();
  
  // Insert groups into database
  console.log('Inserting groups into database...');
  const insertGroup = db.prepare(`
    INSERT OR REPLACE INTO groups (group_id, canonical_title, canonical_author, canonical_source, confidence, version_count)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  
  const insertItemGroup = db.prepare(`
    INSERT OR REPLACE INTO items_groups (item_id, group_id, version_label, version_sort_key)
    VALUES (?, ?, ?, ?)
  `);
  
  for (const [groupId, group] of groupMap.entries()) {
    insertGroup.run(
      group.group_id,
      group.canonical_title,
      group.canonical_author,
      group.canonical_source,
      group.confidence,
      group.items.length
    );
    
    // Insert item-group relationships
    for (const item of group.items) {
      const json = jsonDataMap.get(item.item_id.toLowerCase());
      const versionLabel = item.versioninfo || 
                          (json?.gameversion?.version ? `v${json.gameversion.version}` : null) ||
                          'unknown';
      
      // Create sort key for version ordering
      let sortKey = '9999';
      if (json && json.gameversion && json.gameversion.version !== undefined) {
        sortKey = String(json.gameversion.version).padStart(4, '0');
      } else if (item.versioninfo) {
        const versionMatch = item.versioninfo.match(/v?(\d+)\.(\d+)/i);
        if (versionMatch) {
          sortKey = `${versionMatch[1].padStart(2, '0')}.${versionMatch[2].padStart(2, '0')}`;
        }
      }
      
      insertItemGroup.run(item.item_id, groupId, versionLabel, sortKey);
    }
  }
  
  console.log(`Inserted ${groupMap.size} group(s) and ${itemToGroup.size} item-group relationship(s)`);
  console.log();
  
  // Pass 2: Probabilistic merges
  console.log('Pass 2: Probabilistic merge pass...');
  const groupsArray = Array.from(groupMap.values());
  const edges = [];
  let mergeCount = 0;
  
  for (let i = 0; i < groupsArray.length; i++) {
    const group1 = groupsArray[i];
    if (!group1) continue;
    
    for (let j = i + 1; j < groupsArray.length; j++) {
      const group2 = groupsArray[j];
      if (!group2) continue;
      
      // Skip if already merged
      if (!groupMap.has(group1.group_id) || !groupMap.has(group2.group_id)) {
        continue;
      }
      
      // Calculate similarity scores
      const titleSim = calculateSimilarity(
        group1.canonical_title || '',
        group2.canonical_title || ''
      );
      
      const authorSim = calculateSimilarity(
        group1.canonical_author || '',
        group2.canonical_author || ''
      );
      
      // Check levelname and lmfilter overlap
      let levelnameOverlap = 0.0;
      let lmfilterOverlap = 0.0;
      
      for (const item1 of group1.items) {
        const json1 = jsonDataMap.get(item1.item_id.toLowerCase());
        if (!json1) continue;
        
        for (const item2 of group2.items) {
          const json2 = jsonDataMap.get(item2.item_id.toLowerCase());
          if (!json2) continue;
          
          if (json1.levelnames && json2.levelnames) {
            const overlap = calculateLevelnameOverlap(json1.levelnames, json2.levelnames);
            levelnameOverlap = Math.max(levelnameOverlap, overlap);
          }
          
          if (json1.lmfilter && json2.lmfilter) {
            const overlap = calculateLmfilterOverlap(json1.lmfilter, json2.lmfilter);
            lmfilterOverlap = Math.max(lmfilterOverlap, overlap);
          }
        }
      }
      
      // Calculate combined similarity score
      const combinedScore = (
        titleSim * 0.4 +
        authorSim * 0.3 +
        levelnameOverlap * 0.2 +
        lmfilterOverlap * 0.1
      );
      
      // Merge if similarity is high enough
      if (combinedScore >= 0.7) {
        // Merge group2 into group1
        const mergedGroup = group1;
        mergedGroup.items.push(...group2.items);
        mergedGroup.version_count = mergedGroup.items.length;
        
        // Update canonical fields if group1 has better data
        if (!mergedGroup.canonical_title && group2.canonical_title) {
          mergedGroup.canonical_title = group2.canonical_title;
        }
        if (!mergedGroup.canonical_author && group2.canonical_author) {
          mergedGroup.canonical_author = group2.canonical_author;
        }
        
        // Update confidence
        mergedGroup.confidence = Math.min(mergedGroup.confidence, group2.confidence);
        
        // Move all items from group2 to group1
        for (const item of group2.items) {
          itemToGroup.set(item.item_id, group1.group_id);
          insertItemGroup.run(
            item.item_id,
            group1.group_id,
            item.versioninfo || 'unknown',
            '9999'
          );
        }
        
        // Remove group2
        groupMap.delete(group2.group_id);
        groupsArray[j] = null; // Mark as merged
        
        // Create edge
        edges.push({
          src_id: group2.group_id,
          dst_id: group1.group_id,
          edge_type: 'merged_into',
          weight: combinedScore,
          evidence_json: JSON.stringify({
            title_similarity: titleSim,
            author_similarity: authorSim,
            levelname_overlap: levelnameOverlap,
            lmfilter_overlap: lmfilterOverlap
          })
        });
        
        mergeCount++;
      } else if (combinedScore >= 0.4) {
        // Create relationship edge (not merged, but related)
        edges.push({
          src_id: group1.group_id,
          dst_id: group2.group_id,
          edge_type: 'related_to',
          weight: combinedScore,
          evidence_json: JSON.stringify({
            title_similarity: titleSim,
            author_similarity: authorSim,
            levelname_overlap: levelnameOverlap,
            lmfilter_overlap: lmfilterOverlap
          })
        });
      }
    }
  }
  
  console.log(`Merged ${mergeCount} group(s)`);
  console.log(`Created ${edges.length} edge(s)`);
  console.log();
  
  // Update groups in database
  console.log('Updating groups in database...');
  const updateGroup = db.prepare(`
    UPDATE groups SET canonical_title = ?, canonical_author = ?, confidence = ?, version_count = ?, updated_at = CURRENT_TIMESTAMP
    WHERE group_id = ?
  `);
  
  for (const [groupId, group] of groupMap.entries()) {
    updateGroup.run(
      group.canonical_title,
      group.canonical_author,
      group.confidence,
      group.version_count,
      groupId
    );
  }
  
  // Insert edges
  console.log('Inserting edges into database...');
  const insertEdge = db.prepare(`
    INSERT OR REPLACE INTO edges (src_id, dst_id, edge_type, weight, evidence_json)
    VALUES (?, ?, ?, ?, ?)
  `);
  
  for (const edge of edges) {
    insertEdge.run(
      edge.src_id,
      edge.dst_id,
      edge.edge_type,
      edge.weight,
      edge.evidence_json
    );
  }
  
  // Create FTS5 virtual table for search
  console.log('Creating FTS5 search index...');
  
  // Drop old triggers first (they might reference old schema)
  db.exec(`
    DROP TRIGGER IF EXISTS items_fts_insert;
    DROP TRIGGER IF EXISTS items_fts_update;
    DROP TRIGGER IF EXISTS items_fts_delete;
  `);
  
  // Drop and recreate FTS5 table
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
  
  // When using content='items', SQLite automatically syncs, but we need to rebuild
  // the index to ensure it's in sync. Use the rebuild command.
  console.log('Rebuilding FTS5 index from items table...');
  const itemCount = db.prepare(`SELECT COUNT(*) as count FROM items`).get().count;
  console.log(`  Found ${itemCount} item(s) to index`);
  
  // Rebuild the FTS5 index using the rebuild command
  // This ensures the index is properly synced with the items table
  try {
    db.exec(`INSERT INTO items_fts(items_fts) VALUES('rebuild')`);
    console.log('  FTS5 index rebuilt successfully');
  } catch (error) {
    // If rebuild fails, fall back to manual population
    console.log('  Rebuild command failed, using manual population...');
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
    console.log('  FTS5 index populated manually');
  }
  
  // Create triggers to keep FTS5 in sync
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
  
  // Close database
  db.close();
  
  console.log();
  console.log('='.repeat(70));
  console.log('Stage 2 Complete');
  console.log('='.repeat(70));
  console.log(`Groups: ${groupMap.size}`);
  console.log(`Edges: ${edges.length}`);
  console.log(`Merges: ${mergeCount}`);
  console.log(`Database: ${dbPath}`);
  console.log();
}

// Main entry point
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log(`
Usage: enode.sh search_build2.js <index7z folder> <bps7z folder> [options]

Stage 2: Entity resolution and grouping

Arguments:
  index7z folder    Directory containing master JSON index files
  bps7z folder      Directory containing 7z archives (for reference, not used in Stage 2)

Options:
  --rhsearchdb=FILE    Path to search catalog database (default: rhsearch_cat.db in index7z parent)
  --rhsearchzip=FILE   Path to JSON ZIP archive (default: rhsearch.zip in index7z parent)
  --help, -h           Show this help message

This script:
  - Reads items from Stage 1 database
  - Performs deterministic grouping (by gameid, title+author, etc.)
  - Performs probabilistic merge pass (similarity-based)
  - Creates groups and edges tables
  - Builds FTS5 search index

Examples:
  enode.sh search_build2.js ~/rhplay/refmaterial/index7z ~/rhplay/refmaterial/bps7z/
`);
    process.exit(0);
  }
  
  if (args.length < 2) {
    console.error('Error: Missing required arguments');
    console.error('Usage: enode.sh search_build2.js <index7z folder> <bps7z folder> [options]');
    console.error('Run with --help for more information');
    process.exit(1);
  }
  
  const index7zFolder = args[0];
  const bps7zFolder = args[1];
  
  // Parse options
  const options = {
    rhsearchdb: null,
    rhsearchzip: null
  };
  
  for (const arg of args.slice(2)) {
    if (arg.startsWith('--rhsearchdb=')) {
      options.rhsearchdb = arg.substring('--rhsearchdb='.length);
    } else if (arg.startsWith('--rhsearchzip=')) {
      options.rhsearchzip = arg.substring('--rhsearchzip='.length);
    } else if (arg === '--help' || arg === '-h') {
      // Already handled above
    } else {
      console.error(`Error: Unknown option: ${arg}`);
      console.error('Run with --help for usage information');
      process.exit(1);
    }
  }
  
  // Run processing
  try {
    await buildSearchCatalog2(index7zFolder, bps7zFolder, options);
  } catch (error) {
    console.error(`Fatal error: ${error.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(`Fatal error: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { buildSearchCatalog2 };
