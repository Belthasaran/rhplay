#!/usr/bin/env node

/**
 * smwcw_waiting_compare.js - Compare SMWC Waiting ROMs with our database
 * 
 * Compares SMWC Waiting ROMs list with our gameversions table
 * to identify games we have vs games we need vs games we've already processed.
 * 
 * Usage:
 *   enode.sh ~/rhplay/jstools/smwcw_waiting_compare.js
 * 
 * Environment Variables:
 *   SMWC_QUERY_A_WAITING - Base64 encoded URL for the first page of waiting ROMs
 *   RHDATA_DB_PATH - Optional path to rhdata.db (defaults to electron/rhdata.db)
 * 
 * Output:
 *   smwc_world/log.txt - Log file with info and warnings
 *   smwc_world/waiting.json - Full waiting ROMs data (all pages)
 *   smwc_world/waiting_alreadyhave.json - Games we already have in database
 *   smwc_world/waiting_needed.json - Games we need (not in DB, not processed)
 *   smwc_world/waiting_processed.json - Games we've processed but not in DB
 *   smwc_world/waiting_queue.json - Normalized version of waiting_needed.json
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

// Configuration
const CONFIG = {
  REQUEST_DELAY: 2000, // 2 seconds between requests
  USER_AGENT: 'rhtools-smwc-waiting-compare/1.0',
  DB_PATH: process.env.RHDATA_DB_PATH || path.join(__dirname, '..', 'electron', 'rhdata.db'),
  OUTPUT_DIR: path.join(__dirname, 'smwc_world'),
  GAMES_DIR: path.join(__dirname, 'smwc_world', 'games')
};

/**
 * Decode Base64 string
 */
function decodeBase64(str) {
  try {
    return Buffer.from(str, 'base64').toString('utf8');
  } catch (error) {
    throw new Error(`Failed to decode Base64: ${error.message}`);
  }
}

/**
 * Fetch JSON page with throttling
 */
async function fetchWithThrottle(url, lastRequestTime) {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  const waitTime = CONFIG.REQUEST_DELAY - elapsed;
  
  if (waitTime > 0) {
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }
  
  const response = await fetch(url, {
    headers: {
      'User-Agent': CONFIG.USER_AGENT
    }
  });
  
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  
  return await response.json();
}

/**
 * Compute combinedtype using the same logic as migration 003
 * Format: [fields_type]: [difficulty] (raw_difficulty) (raw_fields.type)
 */
function computeCombinedType(normalized) {
  const fieldsType = normalized.fields_type || null;
  const difficulty = normalized.difficulty || null;
  const rawDifficulty = normalized.raw_difficulty || null;
  const rawFieldsType = (normalized.raw_fields && normalized.raw_fields.type) || null;
  
  let result = '';
  
  // Add fields_type with colon if present
  if (fieldsType) {
    result += fieldsType + ': ';
  }
  
  // Add main difficulty
  if (difficulty) {
    result += difficulty;
  }
  
  // Add raw_difficulty in parentheses if present
  if (rawDifficulty) {
    result += ' (' + rawDifficulty + ')';
  }
  
  // Add raw_fields.type in parentheses if present
  if (rawFieldsType) {
    const typeStr = Array.isArray(rawFieldsType) ? rawFieldsType.join(', ') : rawFieldsType;
    result += ' (' + typeStr + ')';
  }
  
  // Trim the result
  result = result.trim();
  
  // If result is empty, fall back to type/gametype field
  if (!result) {
    const fallbackType = normalized.gametype || normalized.type;
    if (fallbackType) {
      result = fallbackType;
    }
  }
  
  return result || null;
}

/**
 * Normalize game data to match gameversions table format
 */
function normalizeGame(game) {
  const normalized = {};
  
  // gameid: Convert id (integer) to gameid (string)
  normalized.gameid = String(game.id);
  
  // authors: Convert array to comma-separated string
  if (game.authors && Array.isArray(game.authors)) {
    normalized.authors_json = game.authors; // Preserve original structure
    const authorNames = game.authors.map(a => a.name || '').filter(n => n);
    normalized.authors = authorNames.join(', ');
    normalized.author = authorNames[0] || null; // First author
  } else {
    normalized.authors = null;
    normalized.author = null;
  }
  
  // submitter: Convert object to string name
  if (game.submitter) {
    normalized.submitter_json = game.submitter; // Preserve original structure
    normalized.submitter = game.submitter.name || null;
  } else {
    normalized.submitter = null;
  }
  
  // Extract from fields and raw_fields
  if (game.fields) {
    normalized.length = game.fields.length || null;
    normalized.difficulty = game.fields.difficulty || null;
    normalized.fields_type = game.fields.type || null;
    normalized.gametype = game.fields.type || null; // Same as fields_type
    normalized.demo = game.fields.demo || null;
    normalized.sa1 = game.fields.sa1 || null;
    normalized.collab = game.fields.collab || null;
  } else {
    normalized.length = null;
    normalized.difficulty = null;
    normalized.fields_type = null;
    normalized.gametype = null;
    normalized.demo = null;
    normalized.sa1 = null;
    normalized.collab = null;
  }
  
  if (game.raw_fields) {
    normalized.description = game.raw_fields.description || null;
    normalized.raw_difficulty = game.raw_fields.difficulty || null;
    
    // warnings: Convert array to comma-separated string
    if (game.raw_fields.warnings && Array.isArray(game.raw_fields.warnings)) {
      normalized.warnings = game.raw_fields.warnings.join(', ');
    } else {
      normalized.warnings = null;
    }
    
    // Preserve raw_fields for combinedtype computation
    normalized.raw_fields = game.raw_fields;
  } else {
    normalized.description = null;
    normalized.raw_difficulty = null;
    normalized.warnings = null;
    normalized.raw_fields = null;
  }
  
  // combinedtype: Compute using migration 003 logic
  normalized.combinedtype = computeCombinedType(normalized);
  
  // url: Construct from gameid
  normalized.url = `https://www.smwcentral.net/?p=section&a=details&id=${normalized.gameid}`;
  
  // Preserve other fields that might be useful
  normalized.name = game.name || null;
  normalized.section = game.section || null;
  normalized.time = game.time || null;
  normalized.moderated = game.moderated || null;
  normalized.tags = game.tags || null;
  normalized.images = game.images || null;
  normalized.rating = game.rating || null;
  normalized.size = game.size || null;
  normalized.downloads = game.downloads || null;
  normalized.download_url = game.download_url || null;
  normalized.obsoleted_by = game.obsoleted_by || null;
  
  return normalized;
}

/**
 * Fetch all pages of waiting ROMs
 */
async function fetchAllWaitingPages(startUrl, logCallback) {
  const allData = [];
  let currentUrl = startUrl;
  let pageNum = 1;
  let lastRequestTime = 0;
  
  while (currentUrl) {
    logCallback(`Fetching page ${pageNum} from ${currentUrl}...`);
    const response = await fetchWithThrottle(currentUrl, lastRequestTime);
    lastRequestTime = Date.now();
    
    if (!response.data || !Array.isArray(response.data)) {
      throw new Error(`Invalid response format: missing or invalid 'data' array`);
    }
    
    // Add games from this page to our collection
    allData.push(...response.data);
    logCallback(`  Fetched ${response.data.length} games from page ${pageNum} (total: ${response.total || 'unknown'})`);
    
    // Check for next page
    if (response.next_page_url) {
      currentUrl = response.next_page_url;
      pageNum++;
      logCallback(`  More pages available, continuing...`);
    } else {
      logCallback(`  No more pages (next_page_url is null)`);
      currentUrl = null;
    }
  }
  
  return allData;
}

/**
 * Main function
 */
async function main() {
  console.log('==================================================');
  console.log('  smwcw_waiting_compare.js - SMWC Waiting Compare');
  console.log('==================================================\n');
  
  // Check for required environment variable
  const encodedUrl = process.env.SMWC_QUERY_A_WAITING;
  if (!encodedUrl) {
    console.error('Error: SMWC_QUERY_A_WAITING environment variable is not set');
    console.error('Please set it to a Base64 encoded URL for the waiting ROMs API');
    process.exit(1);
  }
  
  // Decode the URL
  let startUrl;
  try {
    startUrl = decodeBase64(encodedUrl);
    console.log(`Decoded start URL: ${startUrl}\n`);
  } catch (error) {
    console.error(`Error decoding SMWC_QUERY_A_WAITING: ${error.message}`);
    process.exit(1);
  }
  
  // Create output directory
  if (!fs.existsSync(CONFIG.OUTPUT_DIR)) {
    fs.mkdirSync(CONFIG.OUTPUT_DIR, { recursive: true });
  }
  
  // Ensure games directory exists
  if (!fs.existsSync(CONFIG.GAMES_DIR)) {
    fs.mkdirSync(CONFIG.GAMES_DIR, { recursive: true });
  }
  
  // Open log file
  const logPath = path.join(CONFIG.OUTPUT_DIR, 'log.txt');
  const logStream = fs.createWriteStream(logPath, { flags: 'w' });
  
  function log(message) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}`;
    console.log(message);
    logStream.write(logMessage + '\n');
  }
  
  try {
    // Open database
    log('Opening database...');
    const db = new Database(CONFIG.DB_PATH);
    
    // Get existing game IDs from database
    log('Querying existing games from database...');
    const existingGames = db.prepare(`
      SELECT DISTINCT gameid, name, author, authors
      FROM gameversions
      ORDER BY gameid
    `).all();
    
    const existingGameSet = new Set();
    for (const game of existingGames) {
      existingGameSet.add(String(game.gameid));
    }
    
    log(`  Found ${existingGameSet.size} unique game IDs in database\n`);
    
    // Fetch all waiting ROMs pages
    log(`Fetching waiting ROMs from SMWC...`);
    log(`  Using ${CONFIG.REQUEST_DELAY/1000} second delay between requests\n`);
    
    const waitingGames = await fetchAllWaitingPages(startUrl, (msg) => log(msg));
    
    log(`\nFetched ${waitingGames.length} total waiting games\n`);
    
    // Save full waiting data
    const waitingJsonPath = path.join(CONFIG.OUTPUT_DIR, 'waiting.json');
    fs.writeFileSync(waitingJsonPath, JSON.stringify(waitingGames, null, 2), 'utf8');
    log(`Saved full waiting data to ${waitingJsonPath}\n`);
    
    // Compare with database and processed games
    log('Comparing with database and processed games...\n');
    
    const alreadyHave = [];
    const needed = [];
    const processed = [];
    
    for (const game of waitingGames) {
      const gameid = String(game.id); // Note: API uses 'id' not 'gameid'
      
      // Check if game exists in database
      if (existingGameSet.has(gameid)) {
        alreadyHave.push(game);
        continue;
      }
      
      // Check if we've already processed this game (games/(GAMEID).json exists)
      const gameJsonPath = path.join(CONFIG.GAMES_DIR, `${gameid}.json`);
      if (fs.existsSync(gameJsonPath)) {
        processed.push(game);
      } else {
        needed.push(game);
      }
    }
    
    // Write output files
    log('\nWriting output files...');
    
    const alreadyHavePath = path.join(CONFIG.OUTPUT_DIR, 'waiting_alreadyhave.json');
    fs.writeFileSync(alreadyHavePath, JSON.stringify(alreadyHave, null, 2), 'utf8');
    log(`  ✓ ${alreadyHave.length} games we already have -> ${alreadyHavePath}`);
    
    const neededPath = path.join(CONFIG.OUTPUT_DIR, 'waiting_needed.json');
    fs.writeFileSync(neededPath, JSON.stringify(needed, null, 2), 'utf8');
    log(`  ✓ ${needed.length} games we need -> ${neededPath}`);
    
    const processedPath = path.join(CONFIG.OUTPUT_DIR, 'waiting_processed.json');
    fs.writeFileSync(processedPath, JSON.stringify(processed, null, 2), 'utf8');
    log(`  ✓ ${processed.length} games we've processed -> ${processedPath}`);
    
    // Normalize and create waiting_queue.json (same as needed but normalized)
    log('\nNormalizing data for waiting_queue.json...');
    const queueGames = needed.map(game => normalizeGame(game));
    const queuePath = path.join(CONFIG.OUTPUT_DIR, 'waiting_queue.json');
    fs.writeFileSync(queuePath, JSON.stringify(queueGames, null, 2), 'utf8');
    log(`  ✓ ${queueGames.length} normalized games -> ${queuePath}`);
    
    // Summary
    log('\n==================================================');
    log('              Comparison Complete!                ');
    log('==================================================\n');
    log(`  Total waiting games:     ${waitingGames.length}`);
    log(`  Games we already have:   ${alreadyHave.length}`);
    log(`  Games we need:           ${needed.length}`);
    log(`  Games we've processed:   ${processed.length}`);
    log(`  Games in queue:          ${needed.length} (normalized)\n`);
    
    db.close();
    logStream.end();
    
    console.log(`\n✓ Results saved to ${CONFIG.OUTPUT_DIR}/`);
    
  } catch (error) {
    console.error('\n✗ Fatal error:', error.message);
    console.error(error.stack);
    logStream.write(`\nFATAL ERROR: ${error.message}\n${error.stack}\n`);
    logStream.end();
    process.exit(1);
  }
}

// Execute main
if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { main, CONFIG };
