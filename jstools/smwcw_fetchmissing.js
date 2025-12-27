#!/usr/bin/env node

/**
 * smwcw_fetchmissing.js - Download and process missing games from SMWC World
 * 
 * This script processes the needed.json file from smwc_compare.js and:
 * - Downloads ZIP files from SMWC World
 * - Extracts BPS files from ZIPs
 * - Test patches them with flips
 * - Creates BPS index JSON files
 * - Creates wrap-up JSON files for logging
 * 
 * Usage:
 *   enode.sh ~/rhplay/jstools/smwcw_fetchmissing.js [--sha256]
 * 
 * Options:
 *   --sha256    Use SHA256 instead of SHA1 for BPS filenames
 *   --help      Show this help message
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync, spawnSync } = require('child_process');
const AdmZip = require('adm-zip');
const { getFlipsPath, getSmwRomPath } = require('../lib/binary-finder');

// Configuration
const CONFIG = {
  NEEDED_JSON_PATH: path.join(__dirname, 'smwc_world', 'needed.json'),
  OUTPUT_DIR: path.join(__dirname, 'smwc_world'),
  ZIPS_DIR: path.join(__dirname, 'smwc_world', 'zips'),
  BPS_DIR: path.join(__dirname, 'smwc_world', 'bps'),
  BPSINDEX_DIR: path.join(__dirname, 'smwc_world', 'bpsindex'),
  GAMES_DIR: path.join(__dirname, 'smwc_world', 'games'),
  TEMP_DIR: path.join(__dirname, 'temp'),
  
  // Will be set during initialization
  FLIPS_PATH: null,
  BASE_ROM_PATH: null,
  
  // Options
  USE_SHA256: false
};

// Parse command line arguments
function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--sha256') {
      CONFIG.USE_SHA256 = true;
    } else if (argv[i] === '--help' || argv[i] === '-h') {
      console.log(`
Usage: enode.sh ~/rhplay/jstools/smwcw_fetchmissing.js [options]

Options:
  --sha256    Use SHA256 hash instead of SHA1 for BPS filenames
  --help      Show this help message
`);
      process.exit(0);
    }
  }
  return args;
}

// Initialize configuration
function initConfig() {
  // Find flips
  CONFIG.FLIPS_PATH = getFlipsPath({ projectRoot: __dirname, throwOnError: true });
  console.log(`Using flips: ${CONFIG.FLIPS_PATH}`);
  
  // Find base ROM
  CONFIG.BASE_ROM_PATH = getSmwRomPath({ projectRoot: __dirname, throwOnError: true });
  console.log(`Using base ROM: ${CONFIG.BASE_ROM_PATH}`);
  
  // Create output directories
  for (const dir of [CONFIG.OUTPUT_DIR, CONFIG.ZIPS_DIR, CONFIG.BPS_DIR, CONFIG.BPSINDEX_DIR, CONFIG.GAMES_DIR, CONFIG.TEMP_DIR]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`Created directory: ${dir}`);
    }
  }
}

// Extract BPS files from ZIP (prioritize English versions)
function extractBpsFiles(zipPath) {
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();
  
  const bpsFiles = [];
  
  for (const entry of entries) {
    if (entry.isDirectory) continue;
    
    const filename = entry.entryName;
    
    // Skip Spanish versions
    //if (filename.match(/^Espa/i)) {
    //  continue;
    //}
    
    // Check for .bps files
    if (filename.match(/\.bps$/i)) {
      const nameLower = filename.toLowerCase();
      
      // Determine if this is an English version
      const isEnglish = !nameLower.match(/(spanish|espa|french|franc|german|deutsch|italian|italia|japanese|japan|chinese|korean)/i);
      
      bpsFiles.push({
        filename: filename,
        entry: entry,
        isEnglish: isEnglish,
        size: entry.header.size || 0
      });
    }
  }
  
  // Sort: English first, then by filename
  bpsFiles.sort((a, b) => {
    if (a.isEnglish && !b.isEnglish) return -1;
    if (!a.isEnglish && b.isEnglish) return 1;
    return a.filename.localeCompare(b.filename);
  });
  
  return bpsFiles;
}

// Test patch BPS file with flips
function testPatchBps(bpsPath, outputPath) {
  try {
    const cmd = `"${CONFIG.FLIPS_PATH}" --apply "${bpsPath}" "${CONFIG.BASE_ROM_PATH}" "${outputPath}"`;
    execSync(cmd, { stdio: 'pipe' });
    
    // Check if output file was created
    if (!fs.existsSync(outputPath)) {
      return { success: false, error: 'Output file not created' };
    }
    
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Calculate hash (SHA1 or SHA256)
function calculateHash(data, useSha256 = false) {
  if (useSha256) {
    return crypto.createHash('sha256').update(data).digest('hex');
  } else {
    return crypto.createHash('sha1').update(data).digest('hex');
  }
}

// Map legacy type/difficulty to new schema
function mapTypeAndDifficulty(smwcData) {
  const difficulty = smwcData.difficulty || '';
  const difficultyLower = difficulty.toLowerCase();
  
  // Valid fields_type values
  const validFieldsTypes = [
    'Joke', 'Misc.',
    'Kaizo',
    'Kaizo, Puzzle',
    'Kaizo, Puzzle, Tool-Assisted',
    'Kaizo, Tool-Assisted',
    'Puzzle',
    'Standard',
    'Standard, Kaizo',
    'Standard, Kaizo, Puzzle',
    'Standard, Puzzle',
    'Standard, Puzzle, Tool-Assisted',
    'Tool-Assisted, Pit'
  ];
  
  // Valid difficulty values
  const validDifficulties = [
    'Newcomer',
    'Casual',
    'Skilled',
    'Intermediate',
    'Advanced',
    'Hard',
    'Expert',
    'Master',
    'Grandmaster'
  ];
  
  // Extract types from difficulty string
  const typesFound = [];
  if (difficultyLower.includes('kaizo')) typesFound.push('Kaizo');
  if (difficultyLower.includes('puzzle')) typesFound.push('Puzzle');
  if (difficultyLower.includes('standard')) typesFound.push('Standard');
  if (difficultyLower.includes('tool-assisted')) typesFound.push('Tool-Assisted');
  if (difficultyLower.includes('pit')) typesFound.push('Pit');
  if (difficultyLower.includes('joke')) typesFound.push('Joke');
  if (difficultyLower.includes('misc')) typesFound.push('Misc.');
  
  // Determine fields_type (prioritize combinations - check longer combinations first)
  let fields_type = null;
  
  // Check for multi-type combinations first (more specific)
  if (typesFound.includes('Standard') && typesFound.includes('Kaizo') && typesFound.includes('Puzzle')) {
    fields_type = 'Standard, Kaizo, Puzzle';
  } else if (typesFound.includes('Kaizo') && typesFound.includes('Puzzle') && typesFound.includes('Tool-Assisted')) {
    fields_type = 'Kaizo, Puzzle, Tool-Assisted';
  } else if (typesFound.includes('Standard') && typesFound.includes('Puzzle') && typesFound.includes('Tool-Assisted')) {
    fields_type = 'Standard, Puzzle, Tool-Assisted';
  } else if (typesFound.includes('Standard') && typesFound.includes('Kaizo')) {
    fields_type = 'Standard, Kaizo';
  } else if (typesFound.includes('Standard') && typesFound.includes('Puzzle')) {
    fields_type = 'Standard, Puzzle';
  } else if (typesFound.includes('Kaizo') && typesFound.includes('Tool-Assisted')) {
    fields_type = 'Kaizo, Tool-Assisted';
  } else if (typesFound.includes('Kaizo') && typesFound.includes('Puzzle')) {
    fields_type = 'Kaizo, Puzzle';
  } else if (typesFound.includes('Tool-Assisted') && typesFound.includes('Pit')) {
    fields_type = 'Tool-Assisted, Pit';
  } else if (typesFound.includes('Joke')) {
    fields_type = 'Joke';
  } else if (typesFound.includes('Misc.')) {
    fields_type = 'Misc.';
  } else if (typesFound.includes('Kaizo')) {
    fields_type = 'Kaizo';
  } else if (typesFound.includes('Puzzle')) {
    fields_type = 'Puzzle';
  } else if (typesFound.includes('Standard')) {
    fields_type = 'Standard';
  }
  
  // Determine difficulty
  let mappedDifficulty = null;
  if (difficultyLower.includes('newcomer')) {
    mappedDifficulty = 'Newcomer';
  } else if (difficultyLower.includes('casual')) {
    mappedDifficulty = 'Casual';
  } else if (difficultyLower.includes('skilled')) {
    mappedDifficulty = 'Skilled';
  } else if (difficultyLower.includes('intermediate')) {
    mappedDifficulty = 'Intermediate';
  } else if (difficultyLower.includes('advanced')) {
    mappedDifficulty = 'Advanced';
  } else if (difficultyLower.includes('hard')) {
    mappedDifficulty = 'Hard';
  } else if (difficultyLower.includes('expert')) {
    mappedDifficulty = 'Expert';
  } else if (difficultyLower.includes('master')) {
    mappedDifficulty = 'Master';
  } else if (difficultyLower.includes('grandmaster')) {
    mappedDifficulty = 'Grandmaster';
  }
  
  return {
    fields_type: fields_type,
    difficulty: mappedDifficulty,
    legacy_type: difficulty // Keep original as legacy_type
  };
}

// Extract first author from authors string
function extractFirstAuthor(authors) {
  if (!authors || authors === 'None' || authors.trim() === '') {
    return null;
  }
  
  // Split by comma and take first
  const parts = authors.split(',').map(s => s.trim());
  return parts[0] || null;
}

// Main processing function
async function main() {
  parseArgs(process.argv.slice(2));
  
  console.log('==================================================');
  console.log('  smwcw_fetchmissing.js - Download Missing Games ');
  console.log('==================================================\n');
  
  // Initialize
  initConfig();
  
  // Read needed.json
  if (!fs.existsSync(CONFIG.NEEDED_JSON_PATH)) {
    console.error(`Error: ${CONFIG.NEEDED_JSON_PATH} not found`);
    console.error('Please run smwc_compare.js first to generate needed.json');
    process.exit(1);
  }
  
  const neededGames = JSON.parse(fs.readFileSync(CONFIG.NEEDED_JSON_PATH, 'utf8'));
  console.log(`Found ${neededGames.length} games in needed.json\n`);
  
  // Process each game
  let processed = 0;
  let skipped = 0;
  let failed = 0;
  
  for (const game of neededGames) {
    const gameid = game.gameid;
    console.log(`\n[${processed + skipped + failed + 1}/${neededGames.length}] Processing game ${gameid}: ${game.name}`);
    
    // Skip if no download_url
    if (!game.download_url) {
      console.log(`  ⚠ Skipping: No download_url`);
      skipped++;
      continue;
    }
    
    // Check if ZIP already exists
    const zipPath = path.join(CONFIG.ZIPS_DIR, `${gameid}.zip`);
    if (fs.existsSync(zipPath)) {
      console.log(`  ⚠ Skipping: ZIP already exists at ${zipPath}`);
      skipped++;
      continue;
    }
    
    try {
      // Download ZIP file (atomic save)
      console.log(`  Downloading from ${game.download_url}...`);
      const response = await fetch(game.download_url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const zipData = Buffer.from(await response.arrayBuffer());
      const tempZipPath = `${zipPath}.tmp`;
      fs.writeFileSync(tempZipPath, zipData);
      fs.renameSync(tempZipPath, zipPath);
      console.log(`  ✓ Downloaded and saved to ${zipPath}`);
      
      // Extract original filename from download_url
      const urlParts = game.download_url.split('/');
      const originalFilename = urlParts[urlParts.length - 1];
      
      // Extract BPS files
      const bpsFiles = extractBpsFiles(zipPath);
      if (bpsFiles.length === 0) {
        console.log(`  ⚠ No BPS files found in ZIP`);
        skipped++;
        continue;
      }
      
      console.log(`  Found ${bpsFiles.length} BPS file(s)`);
      
      // Process each BPS file
      const processedBps = [];
      const gameResults = {
        ...game,
        original_download_filename: originalFilename,
        bps_files: [],
        json_files: [],
        errors: []
      };
      
      for (const bpsFile of bpsFiles) {
        try {
          console.log(`    Processing BPS: ${bpsFile.filename}`);
          
          // Extract BPS from ZIP
          const zip = new AdmZip(zipPath);
          const bpsData = zip.readFile(bpsFile.entry);
          if (!bpsData) {
            throw new Error('Failed to extract BPS from ZIP');
          }
          
          // Calculate hash for filename
          const hash = calculateHash(bpsData, CONFIG.USE_SHA256);
          const bpsFilename = `${hash}.bps`;
          const bpsPath = path.join(CONFIG.BPS_DIR, bpsFilename);
          
          // Check if BPS already exists
          if (fs.existsSync(bpsPath)) {
            console.log(`      ⚠ BPS file already exists: ${bpsFilename}`);
            processedBps.push({
              hash: hash,
              filename: bpsFilename,
              source_filename: bpsFile.filename,
              already_existed: true
            });
            continue;
          }
          
          // Save BPS file temporarily for testing
          const tempBpsPath = path.join(CONFIG.TEMP_DIR, `test_${hash}.bps`);
          fs.writeFileSync(tempBpsPath, bpsData);
          
          // Test patch with flips
          const tempResultPath = path.join(CONFIG.TEMP_DIR, `result_${hash}.sfc`);
          const patchResult = testPatchBps(tempBpsPath, tempResultPath);
          
          if (!patchResult.success) {
            console.log(`      ✗ Patching failed: ${patchResult.error}`);
            gameResults.errors.push(`BPS ${bpsFile.filename}: ${patchResult.error}`);
            fs.unlinkSync(tempBpsPath);
            continue;
          }
          
          // Calculate result hash and metadata (before cleanup)
          const resultData = fs.readFileSync(tempResultPath);
          const resultHash = calculateHash(resultData, false); // Always SHA1 for result
          const resultSha256 = crypto.createHash('sha256').update(resultData).digest('hex');
          const resultDataLength = resultData.length;
          
          console.log(`      ✓ Patch successful, result hash: ${resultHash}`);
          
          // Save BPS file (atomic)
          const tempBpsFinalPath = `${bpsPath}.tmp`;
          fs.writeFileSync(tempBpsFinalPath, bpsData);
          fs.renameSync(tempBpsFinalPath, bpsPath);
          
          // Clean up temp files
          fs.unlinkSync(tempBpsPath);
          fs.unlinkSync(tempResultPath);
          
          // Create index JSON
          const typeMapping = mapTypeAndDifficulty(game);
          const firstAuthor = extractFirstAuthor(game.authors);
          const bpsSha1 = calculateHash(bpsData, false);
          const bpsSha256 = calculateHash(bpsData, true);
          
          const indexJson = {
            // SMWC World data (keep original for reference)
            smwc_world: {
              gameid: game.gameid,
              name: game.name,
              difficulty: game.difficulty,
              authors: game.authors,
              date: game.date,
              url: game.url,
              download_url: game.download_url
            },
            
            // BPS file info
            bps_filename: bpsFilename,
            bps_sha1_hash: bpsSha1,
            bps_sha256_hash: bpsSha256,
            original_download_filename: originalFilename,
            source_bps_filename: bpsFile.filename,
            
            // Result ROM info
            sfc_rom_sha1_hash: resultHash,
            sfc_rom_sha256_hash: resultSha256,
            sfc_rom_size: resultDataLength,
            
            // Gameversion data (for database compatibility)
            gameversion: {
              gameid: gameid,
              name: game.name,
              authors: game.authors,
              author: firstAuthor,
              date: game.date,
              url: game.url,
              download_url: game.download_url,
              legacy_type: typeMapping.legacy_type,
              combinedtype: typeMapping.legacy_type, // Use legacy_type as combinedtype for now
              fields_type: typeMapping.fields_type,
              difficulty: typeMapping.difficulty
            },
            
            // Placeholders for search indexing (not set yet - will be populated by archive scripts)
            index7z_name: null,
            index7z_ipfs_cidv1: null,
            indexbps_name: bpsFilename,
            
            // Level names (optional - will be populated if process_arcsfc.js integration is added)
            levelnames: null,
            translevel_data: null
          };
          
          // Save index JSON
          const indexJsonPath = path.join(CONFIG.BPSINDEX_DIR, `${hash}.json`);
          fs.writeFileSync(indexJsonPath, JSON.stringify(indexJson, null, 2));
          console.log(`      ✓ Created index JSON: ${indexJsonPath}`);
          
          processedBps.push({
            hash: hash,
            filename: bpsFilename,
            source_filename: bpsFile.filename,
            index_json: `${hash}.json`,
            result_sha1: resultHash
          });
          
          gameResults.bps_files.push(bpsFilename);
          gameResults.json_files.push(`${hash}.json`);
          
        } catch (error) {
          console.log(`      ✗ Error processing BPS ${bpsFile.filename}: ${error.message}`);
          gameResults.errors.push(`BPS ${bpsFile.filename}: ${error.message}`);
        }
      }
      
      // Create wrap-up JSON
      if (processedBps.length > 0 || gameResults.errors.length > 0) {
        const wrapupPath = path.join(CONFIG.GAMES_DIR, `${gameid}.json`);
        fs.writeFileSync(wrapupPath, JSON.stringify(gameResults, null, 2));
        console.log(`  ✓ Created wrap-up JSON: ${wrapupPath}`);
      }
      
      if (processedBps.length > 0) {
        processed++;
        console.log(`  ✓ Successfully processed ${processedBps.length} BPS file(s)`);
      } else {
        failed++;
        console.log(`  ✗ No BPS files were successfully processed`);
      }
      
    } catch (error) {
      console.log(`  ✗ Error processing game: ${error.message}`);
      failed++;
    }
  }
  
  // Summary
  console.log('\n==================================================');
  console.log('              Processing Complete!                ');
  console.log('==================================================\n');
  console.log(`  Total games:     ${neededGames.length}`);
  console.log(`  Processed:       ${processed}`);
  console.log(`  Skipped:         ${skipped}`);
  console.log(`  Failed:          ${failed}\n`);
}

// Execute
if (require.main === module) {
  main().catch(error => {
    console.error('\nFatal error:', error);
    console.error(error.stack);
    process.exit(1);
  });
}

module.exports = { main, CONFIG };

