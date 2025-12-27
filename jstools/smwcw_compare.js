#!/usr/bin/env node

/**
 * smwc_compare.js - Compare SMWC World ROMs list with our database
 * 
 * Scans https://smwc.world/roms/ and compares with our gameversions table
 * to identify games we have vs games we need.
 * 
 * Usage:
 *   enode.sh ~/rhplay/jstools/smwc_compare.js
 * 
 * Output:
 *   smwc_world/log.txt - Log file with info and warnings
 *   smwc_world/alreadyhave.json - Games we already have
 *   smwc_world/needed.json - Games we are missing
 * 
 * Features:
 * - Respectful HTTP requests with throttling (2 second delay between requests)
 * - Case-insensitive comparison of names and authors
 * - Warns if gameid exists but name/author differs
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

// HTML entity decoder
function decodeHTMLEntities(text) {
  if (!text) return text;
  return text
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x2F;/g, '/')
    .replace(/&#47;/g, '/');
}

// Configuration
const CONFIG = {
  SMWC_WORLD_URL: 'https://smwc.world/roms/',
  REQUEST_DELAY: 2000, // 2 seconds between requests
  USER_AGENT: 'rhtools-smwc-compare/1.0',
  DB_PATH: process.env.RHDATA_DB_PATH || path.join(__dirname, '..', 'electron', 'rhdata.db'),
  OUTPUT_DIR: path.join(__dirname, 'smwc_world')
};

// Simple HTML table parser
function parseHTMLTable(html, logCallback) {
  const games = [];
  
  // First, try to find the table element
  const tableMatch = html.match(/<table[^>]*>(.*?)<\/table>/s);
  if (!tableMatch) {
    logCallback('⚠ Could not find <table> element in HTML');
    return games;
  }
  
  const tableHtml = tableMatch[1];
  
  // Extract table rows (including header)
  const rowRegex = /<tr[^>]*>(.*?)<\/tr>/gs;
  let match;
  let rowIndex = 0;
  let rowsFound = 0;
  
  while ((match = rowRegex.exec(tableHtml)) !== null) {
    rowsFound++;
    rowIndex++;
    if (rowIndex === 1) continue; // Skip header row
    
    const rowHtml = match[1];
    
    // Extract all links in this row first (before processing cells)
    const rowLinks = [];
    const linkRegex = /<a[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gs;
    let linkMatch;
    while ((linkMatch = linkRegex.exec(rowHtml)) !== null) {
      const linkText = linkMatch[2].replace(/<[^>]+>/g, '').trim();
      // Decode HTML entities in the href URL
      const decodedHref = decodeHTMLEntities(linkMatch[1]);
      rowLinks.push({
        href: decodedHref,
        text: linkText
      });
    }
    
    // Extract table cells
    const cells = [];
    const cellRegex = /<td[^>]*>(.*?)<\/td>/gs;
    let cellMatch;
    
    while ((cellMatch = cellRegex.exec(rowHtml)) !== null) {
      let cellContent = cellMatch[1];
      // Remove HTML tags but preserve text
      cellContent = cellContent.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      cells.push(cellContent);
    }
    
    if (cells.length < 5) {
      // Skip rows with too few cells
      continue;
    }
    
    try {
      // Column 0: ID - Look for link to smwcentral.net
      let gameidStr = null;
      let url = null;
      const idLink = rowLinks.find(l => l.href && l.href.includes('smwcentral.net'));
      
      if (idLink) {
        // Extract ID from link text or href
        const idFromText = idLink.text.match(/(\d+)/);
        const idFromHref = idLink.href.match(/[?&]id=(\d+)/);
        gameidStr = (idFromText ? idFromText[1] : null) || (idFromHref ? idFromHref[1] : null);
        url = idLink.href;
      }
      
      // Fallback: try to extract ID from first cell
      if (!gameidStr && cells[0]) {
        const idMatch = cells[0].match(/(\d+)/);
        gameidStr = idMatch ? idMatch[1] : null;
      }
      
      // Column 1: Name and download URL - Look for link to roms.smwc.world
      let name = null;
      let download_url = null;
      const nameLink = rowLinks.find(l => l.href && l.href.includes('roms.smwc.world'));
      
      if (nameLink) {
        // Name is the link text (may have brackets or not)
        name = nameLink.text.replace(/^\[|\]$/g, '').trim();
        download_url = nameLink.href;
      }
      
      // Fallback: use cell text
      if (!name && cells[1]) {
        name = cells[1].replace(/^\[|\]$/g, '').trim();
      }
      
      // Decode HTML entities in name
      name = decodeHTMLEntities(name);
      
      // Column 2: Difficulty
      const difficulty = cells[2] ? decodeHTMLEntities(cells[2].trim()) : null;
      
      // Column 3: Length (skip)
      
      // Column 4: Author(s)
      let authors = cells[4] ? decodeHTMLEntities(cells[4].trim()) : null;
      // Handle empty authors
      if (authors === '' || authors === null || authors === undefined) {
        authors = null;
      }
      
      // Column 5: Date
      const date = cells[5] ? decodeHTMLEntities(cells[5].trim()) : null;
      
      if (gameidStr && name) {
        games.push({
          gameid: gameidStr,
          name: name,
          difficulty: difficulty,
          authors: authors,
          date: date,
          url: url,
          download_url: download_url
        });
      }
    } catch (error) {
      // Skip rows that fail to parse
    }
  }
  
  logCallback(`  Parsed ${rowsFound} table rows, extracted ${games.length} games`);
  
  return games;
}

/**
 * Fetch HTML page with throttling
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
  
  return await response.text();
}

/**
 * Normalize string for case-insensitive comparison
 */
function normalizeString(str) {
  if (!str) return '';
  return str.trim().toLowerCase();
}

/**
 * Compare two strings case-insensitively
 */
function stringsMatch(str1, str2) {
  return normalizeString(str1) === normalizeString(str2);
}

/**
 * Main function
 */
async function main() {
  console.log('==================================================');
  console.log('  smwc_compare.js - SMWC World ROMs Comparison  ');
  console.log('==================================================\n');
  
  // Create output directory
  if (!fs.existsSync(CONFIG.OUTPUT_DIR)) {
    fs.mkdirSync(CONFIG.OUTPUT_DIR, { recursive: true });
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
  
  function logWarning(message) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] WARNING: ${message}`;
    console.warn(`⚠  ${message}`);
    logStream.write(logMessage + '\n');
  }
  
  try {
    // Open database
    log('Opening database...');
    const db = new Database(CONFIG.DB_PATH);
    
    // Get existing game IDs with their names and authors
    log('Querying existing games from database...');
    const existingGames = db.prepare(`
      SELECT DISTINCT gameid, name, author, authors
      FROM gameversions
      ORDER BY gameid
    `).all();
    
    const existingGameMap = new Map();
    for (const game of existingGames) {
      // Normalize author fields - prefer authors over author, and decode HTML entities
      let authorStr = game.authors || game.author || '';
      authorStr = decodeHTMLEntities(authorStr);
      
      existingGameMap.set(String(game.gameid), {
        name: decodeHTMLEntities(game.name || ''),
        author: authorStr,
        authors: authorStr
      });
    }
    
    log(`  Found ${existingGameMap.size} unique game IDs in database\n`);
    
    // Fetch SMWC World ROMs page
    log(`Fetching ROMs list from ${CONFIG.SMWC_WORLD_URL}...`);
    log(`  Using ${CONFIG.REQUEST_DELAY/1000} second delay between requests\n`);
    
    let lastRequestTime = 0;
    const html = await fetchWithThrottle(CONFIG.SMWC_WORLD_URL, lastRequestTime);
    lastRequestTime = Date.now();
    
    log('Parsing HTML table...');
    const smwcGames = parseHTMLTable(html, (msg) => log(msg));
    
    if (smwcGames.length === 0) {
      logWarning('No games found in HTML! Debugging...');
      // Try to save a sample of the HTML for debugging
      const debugPath = path.join(CONFIG.OUTPUT_DIR, 'debug_html_sample.txt');
      const sampleSize = Math.min(5000, html.length);
      fs.writeFileSync(debugPath, html.substring(0, sampleSize), 'utf8');
      log(`  Saved HTML sample (first ${sampleSize} chars) to ${debugPath}`);
      
      // Look for table indicators
      if (html.includes('<table')) {
        log('  HTML contains <table> tag');
      } else {
        logWarning('  HTML does NOT contain <table> tag - page structure may be different');
      }
      
      if (html.includes('smwcentral.net')) {
        log('  HTML contains smwcentral.net links');
      }
      
      if (html.includes('roms.smwc.world')) {
        log('  HTML contains roms.smwc.world links');
      }
    }
    
    log(`\n`);
    
    // Compare with database
    log('Comparing with database...\n');
    
    const alreadyHave = [];
    const needed = [];
    let warnings = 0;
    
    for (const smwcGame of smwcGames) {
      const gameid = String(smwcGame.gameid);
      const existing = existingGameMap.get(gameid);
      
      if (existing) {
        // We have this game - check for mismatches
        let hasWarning = false;
        const warningsList = [];
        
        // Check name (both should already be HTML entity decoded)
        if (!stringsMatch(smwcGame.name, existing.name)) {
          warningsList.push(`name: "${existing.name}" vs "${smwcGame.name}"`);
          hasWarning = true;
        }
        
        // Check author/authors
        const smwcAuthor = smwcGame.authors || '';
        const existingAuthor = existing.authors || existing.author || '';
        
        // Normalize empty/null/None values for comparison
        const normalizedSmwcAuthor = (!smwcAuthor || smwcAuthor === 'None' || smwcAuthor === 'none' || smwcAuthor.trim() === '') ? '' : smwcAuthor.trim();
        const normalizedExistingAuthor = (!existingAuthor || existingAuthor === 'None' || existingAuthor === 'none' || existingAuthor.trim() === '') ? '' : existingAuthor.trim();
        
        // Only warn if both have non-empty values and they don't match
        if (normalizedSmwcAuthor && normalizedExistingAuthor && !stringsMatch(normalizedSmwcAuthor, normalizedExistingAuthor)) {
          warningsList.push(`author: "${existingAuthor}" vs "${smwcAuthor}"`);
          hasWarning = true;
        } else if (normalizedSmwcAuthor && !normalizedExistingAuthor) {
          // SMWC has author but we don't - this is informational, not necessarily a warning
          // Only warn if it's a significant difference (not just missing data)
          warningsList.push(`author: missing in our DB vs "${smwcAuthor}"`);
          hasWarning = true;
        } else if (!normalizedSmwcAuthor && normalizedExistingAuthor) {
          // We have author but SMWC doesn't - less concerning, but still note it
          warningsList.push(`author: "${existingAuthor}" vs missing in SMWC`);
          hasWarning = true;
        }
        
        if (hasWarning) {
          warnings++;
          logWarning(`Game ${gameid}: Mismatch detected - ${warningsList.join(', ')}`);
        }
        
        alreadyHave.push({
          ...smwcGame,
          our_name: existing.name,
          our_author: existingAuthor,
          warning: hasWarning ? warningsList : null
        });
      } else {
        // We don't have this game
        needed.push(smwcGame);
      }
    }
    
    // Write output files
    log('\nWriting output files...');
    
    const alreadyHavePath = path.join(CONFIG.OUTPUT_DIR, 'alreadyhave.json');
    fs.writeFileSync(alreadyHavePath, JSON.stringify(alreadyHave, null, 2), 'utf8');
    log(`  ✓ ${alreadyHave.length} games we already have -> ${alreadyHavePath}`);
    
    const neededPath = path.join(CONFIG.OUTPUT_DIR, 'needed.json');
    fs.writeFileSync(neededPath, JSON.stringify(needed, null, 2), 'utf8');
    log(`  ✓ ${needed.length} games we need -> ${neededPath}`);
    
    // Summary
    log('\n==================================================');
    log('              Comparison Complete!                ');
    log('==================================================\n');
    log(`  Total SMWC World games: ${smwcGames.length}`);
    log(`  Games we already have:  ${alreadyHave.length}`);
    log(`  Games we need:          ${needed.length}`);
    log(`  Warnings (mismatches):  ${warnings}\n`);
    
    if (warnings > 0) {
      logWarning(`Found ${warnings} game(s) with mismatched name/author data`);
      logWarning('Please review the warnings above and in the log file');
    }
    
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

