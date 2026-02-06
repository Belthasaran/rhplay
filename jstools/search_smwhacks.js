#!/usr/bin/env node

/*
 *
 * Search: https://app.ardrive.io/#/drives/d3338fab-d24c-4d75-9e78-d3024befc225?name=MWDB
 *
 */

/**
 * search_smwhacks.js - Command-line search tool for SMW hacks
 * 
 * Usage:
 *   enode.sh search_smwhacks.js <search phrases...> [options]
 *   enode.sh search_smwhacks.js --help
 * 
 * Searches the SMW hack catalog using FTS5 full-text search.
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const AdmZip = require('adm-zip');

// Helper function to find database and ZIP files (similar to database-manager.js)
function findSearchFiles() {
  const isDev = process.env.ELECTRON_START_URL || process.env.NODE_ENV === 'development';
  
  let basePath;
  
  try {
    // Try to use electron app path detection
    const { app } = require('electron');
    if (app && app.getPath) {
      basePath = app.getPath('userData');
    } else {
      // Fallback to electron directory
      basePath = path.join(__dirname, '..', 'electron');
    }
  } catch (error) {
    // Not in Electron context, use electron directory
    basePath = path.join(__dirname, '..', 'electron');
  }
  
  // Check for environment variable overrides
  const dbPath = process.env.RHSEARCH_DB_PATH || path.join(basePath, 'rhsearch_cat.db');
  const zipPath = process.env.RHSEARCH_ZIP_PATH || path.join(basePath, 'rhsearch.zip');
  
  return { dbPath, zipPath };
}

// Helper function to format search results
function formatSearchResult(result, index, total) {
  const lines = [];
  lines.push(`${'='.repeat(70)}`);
  lines.push(`Result ${index + 1} of ${total}`);
  lines.push(`${'='.repeat(70)}`);
  
  if (result.title) {
    lines.push(`Title: ${result.title}`);
  }
  
  if (result.author) {
    lines.push(`Author: ${result.author}`);
  }
  
  if (result.versioninfo) {
    lines.push(`Version: ${result.versioninfo}`);
  }
  
  if (result.group_id) {
    lines.push(`Group ID: ${result.group_id}`);
  }
  
  if (result.brief) {
    const brief = result.brief.length > 200 ? result.brief.substring(0, 200) + '...' : result.brief;
    lines.push(`Description: ${brief}`);
  }
  
  if (result.tags) {
    try {
      const tags = JSON.parse(result.tags);
      if (Array.isArray(tags) && tags.length > 0) {
        lines.push(`Tags: ${tags.join(', ')}`);
      }
    } catch (e) {
      // Ignore parse errors
    }
  }
  
  lines.push(`Item ID: ${result.item_id}`);
  lines.push(`SHA1: ${result.sfc_rom_sha1_hash || result.item_id}`);
  
  if (result.has_screenshots) {
    lines.push(`Screenshots: ${result.screenshot_count}`);
  }
  
  if (result.has_levelnames) {
    lines.push(`Has level names: Yes`);
  }
  
  if (result.has_lmfilter) {
    lines.push(`Has level filter: Yes`);
  }
  
  lines.push('');
  
  return lines.join('\n');
}

// Main search function
async function searchSMWHacks(searchPhrases, options) {
  const { rhsearchdb, rhsearchzip } = options;
  
  // Find database and ZIP files
  let dbPath, zipPath;
  
  if (rhsearchdb && rhsearchzip) {
    dbPath = rhsearchdb;
    zipPath = rhsearchzip;
  } else {
    const files = findSearchFiles();
    dbPath = files.dbPath;
    zipPath = files.zipPath;
  }
  
  console.log(`Database: ${dbPath}`);
  console.log(`ZIP archive: ${zipPath}`);
  console.log();
  
  if (!fs.existsSync(dbPath)) {
    throw new Error(`Database not found: ${dbPath}`);
  }
  
  if (!fs.existsSync(zipPath)) {
    throw new Error(`ZIP archive not found: ${zipPath}`);
  }
  
  // Open database
  const db = new Database(dbPath, { readonly: true });
  
  // Build FTS5 query
  // FTS5 supports: "phrase" for exact phrase, term* for prefix, term OR term for OR
  const queryTerms = searchPhrases.map(phrase => {
    // If phrase contains spaces, quote it; otherwise allow prefix match
    if (phrase.includes(' ')) {
      return `"${phrase}"`;
    } else {
      return `${phrase}*`;
    }
  }).join(' AND ');
  
  const ftsQuery = queryTerms;
  
  console.log(`Search query: ${ftsQuery}`);
  console.log();
  
  // Execute search
  // Check if FTS5 table exists
  const ftsExists = db.prepare(`
    SELECT name FROM sqlite_master WHERE type='table' AND name='items_fts'
  `).get();
  
  if (!ftsExists) {
    throw new Error('FTS5 index not found. Run Stage 2 (search_build2.js) first.');
  }
  
  // Check if items table exists
  const itemsExists = db.prepare(`
    SELECT name FROM sqlite_master WHERE type='table' AND name='items'
  `).get();
  
  if (!itemsExists) {
    throw new Error('Items table not found. Run Stage 1 (search_build1.js) first.');
  }
  
  // Execute search - get group_id from join, not from FTS5 table
  let results;
  try {
    results = db.prepare(`
      SELECT 
        i.item_id,
        i.title,
        i.author,
        i.versioninfo,
        i.brief,
        i.tags,
        i.sfc_rom_sha1_hash,
        i.has_screenshots,
        i.screenshot_count,
        i.has_levelnames,
        i.has_lmfilter,
        ig.group_id,
        g.canonical_title,
        g.canonical_author,
        g.version_count
      FROM items_fts
      JOIN items i ON items_fts.item_id = i.item_id
      LEFT JOIN items_groups ig ON i.item_id = ig.item_id
      LEFT JOIN groups g ON ig.group_id = g.group_id
      WHERE items_fts MATCH ?
      ORDER BY i.title
      LIMIT 50
    `).all(ftsQuery);
  } catch (error) {
    // If error is about group_id column, the FTS5 table might have old schema
    if (error.message.includes('group_id')) {
      throw new Error('FTS5 table has old schema. Please re-run Stage 2 (search_build2.js) to recreate the index.');
    }
    throw error;
  }
  
  console.log(`Found ${results.length} result(s)`);
  console.log();
  
  if (results.length === 0) {
    console.log('No results found. Try different search terms.');
    db.close();
    return;
  }
  
  // Display results
  for (let i = 0; i < results.length; i++) {
    console.log(formatSearchResult(results[i], i, results.length));
  }
  
  // Show group information if available
  const groups = new Map();
  for (const result of results) {
    if (result.group_id && !groups.has(result.group_id)) {
      groups.set(result.group_id, {
        group_id: result.group_id,
        canonical_title: result.canonical_title,
        canonical_author: result.canonical_author,
        version_count: result.version_count
      });
    }
  }
  
  if (groups.size > 0) {
    console.log(`${'='.repeat(70)}`);
    console.log('Related Groups:');
    console.log(`${'='.repeat(70)}`);
    for (const [groupId, group] of groups.entries()) {
      console.log(`Group: ${group.canonical_title || groupId}`);
      if (group.canonical_author) {
        console.log(`  Author: ${group.canonical_author}`);
      }
      if (group.version_count) {
        console.log(`  Versions: ${group.version_count}`);
      }
      console.log();
    }
  }
  
  db.close();
}

// Main entry point
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log(`
Usage: enode.sh search_smwhacks.js <search phrases...> [options]

Search SMW hack catalog using full-text search.

Arguments:
  search phrases    One or more search phrases (searched in title, author, description, tags)

Options:
  --rhsearchdb=FILE    Path to search catalog database
  --rhsearchzip=FILE   Path to JSON ZIP archive
  --help, -h           Show this help message

If --rhsearchdb and --rhsearchzip are not specified, the script will look for:
  - electron/rhsearch_cat.db
  - electron/rhsearch.zip

Or use environment variables:
  RHSEARCH_DB_PATH     Path to search catalog database
  RHSEARCH_ZIP_PATH    Path to JSON ZIP archive

Examples:
  enode.sh search_smwhacks.js invictus
  enode.sh search_smwhacks.js kaizo intermediate
  enode.sh search_smwhacks.js "super mario" author:juzcook
  enode.sh search_smwhacks.js --rhsearchdb=search.db --rhsearchzip=search.zip invictus
`);
    process.exit(0);
  }
  
  // Parse arguments
  const searchPhrases = [];
  const options = {
    rhsearchdb: null,
    rhsearchzip: null
  };
  
  for (const arg of args) {
    if (arg.startsWith('--rhsearchdb=')) {
      options.rhsearchdb = arg.substring('--rhsearchdb='.length);
    } else if (arg.startsWith('--rhsearchzip=')) {
      options.rhsearchzip = arg.substring('--rhsearchzip='.length);
    } else if (arg === '--help' || arg === '-h') {
      // Already handled above
    } else {
      searchPhrases.push(arg);
    }
  }
  
  if (searchPhrases.length === 0) {
    console.error('Error: No search phrases provided');
    console.error('Usage: enode.sh search_smwhacks.js <search phrases...> [options]');
    console.error('Run with --help for more information');
    process.exit(1);
  }
  
  // Run search
  try {
    await searchSMWHacks(searchPhrases, options);
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

module.exports = { searchSMWHacks };
