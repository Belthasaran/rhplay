#!/usr/bin/env node

/**
 * smwcw_waiting_fetchmissing.js - Download and process missing games from SMWC Waiting
 * 
 * This script processes the waiting_queue.json file from smwcw_waiting_compare.js and:
 * - Downloads ZIP files from SMWC
 * - Downloads images/screenshots to images/(GAMEID)/
 * - Extracts BPS files from ZIPs
 * - Test patches them with flips
 * - Creates BPS index JSON files
 * - Creates wrap-up JSON files for logging
 * 
 * Usage:
 *   enode.sh ~/rhplay/jstools/smwcw_waiting_fetchmissing.js [options]
 * 
 * Options:
 *   --sha256                Use SHA256 instead of SHA1 for BPS filenames
 *   --process-existing-zips Process games whose ZIP files already exist
 *                           (by default, these are skipped)
 *   --help                  Show this help message
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync, spawnSync, spawn } = require('child_process');
const AdmZip = require('adm-zip');
const { getFlipsPath, getSmwRomPath } = require('../lib/binary-finder');

// Configuration
const CONFIG = {
  QUEUE_JSON_PATH: path.join(__dirname, 'smwc_world', 'waiting_queue.json'),
  OUTPUT_DIR: path.join(__dirname, 'smwc_world'),
  ZIPS_DIR: path.join(__dirname, 'smwc_world', 'zips'),
  BPS_DIR: path.join(__dirname, 'smwc_world', 'bps'),
  BPSINDEX_DIR: path.join(__dirname, 'smwc_world', 'bpsindex'),
  GAMES_DIR: path.join(__dirname, 'smwc_world', 'games'),
  IMAGES_DIR: path.join(__dirname, 'smwc_world', 'images'),
  TEMP_DIR: path.join(__dirname, 'temp'),
  
  // Will be set during initialization
  FLIPS_PATH: null,
  BASE_ROM_PATH: null,
  
  // Options
  USE_SHA256: false,
  PROCESS_EXISTING_ZIPS: false,
  IMAGE_DOWNLOAD_DELAY: 2000 // 2 seconds between image downloads
};

// Parse command line arguments
function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--sha256') {
      CONFIG.USE_SHA256 = true;
    } else if (argv[i] === '--process-existing-zips') {
      CONFIG.PROCESS_EXISTING_ZIPS = true;
    } else if (argv[i] === '--help' || argv[i] === '-h') {
      console.log(`
Usage: enode.sh ~/rhplay/jstools/smwcw_waiting_fetchmissing.js [options]

Options:
  --sha256                Use SHA256 hash instead of SHA1 for BPS filenames
  --process-existing-zips Process games whose ZIP files already exist
                          (by default, these are skipped)
  --help                  Show this help message
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
  for (const dir of [CONFIG.OUTPUT_DIR, CONFIG.ZIPS_DIR, CONFIG.BPS_DIR, CONFIG.BPSINDEX_DIR, CONFIG.GAMES_DIR, CONFIG.IMAGES_DIR, CONFIG.TEMP_DIR]) {
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
function mapTypeAndDifficulty(gameData) {
  // Use fields_type and difficulty from normalized waiting_queue.json if available
  const difficulty = gameData.difficulty || '';
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
  
  // If fields_type is already set and valid, use it
  let fields_type = gameData.fields_type;
  if (fields_type && validFieldsTypes.includes(fields_type)) {
    // Already valid, use as-is
  } else {
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
    fields_type = null;
    
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
  }
  
  // Determine difficulty - use existing if valid, otherwise map from string
  let mappedDifficulty = gameData.difficulty;
  if (!mappedDifficulty || !validDifficulties.includes(mappedDifficulty)) {
    mappedDifficulty = null;
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
  }
  
  return {
    fields_type: fields_type,
    difficulty: mappedDifficulty,
    legacy_type: gameData.fields_type || difficulty // Use fields_type as legacy_type if available
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

// Detect if ROM has a 512-byte header
function detectHeader(romData) {
  return (romData.length % 1024) === 512;
}

// Add 512-byte header to unheadered ROM
function addHeader(romData) {
  const header = Buffer.alloc(512, 0);
  return Buffer.concat([header, romData]);
}

// Remove 512-byte header from headered ROM
function removeHeader(romData) {
  if (detectHeader(romData)) {
    return romData.slice(512);
  }
  return romData;
}

// Detect language from filename/path
function detectLanguageFromFilename(filename) {
  if (!filename) return null;
  
  const lowerFilename = filename.toLowerCase();
  const pathParts = filename.split('/');
  
  // Check for language indicators in filename and path (check non-English first)
  const languagePatterns = [
    { lang: 'Portuguese', pattern: /(ptbr|portug[uú][êe]s[e]?|portguese|portugese|brazil|brasil)/i },
    { lang: 'Spanish', pattern: /(spanish|espa[ñn]ol|espanol)/i },
    { lang: 'French', pattern: /(french|fran[çc]ais|francais)/i },
    { lang: 'German', pattern: /(german|deutsch)/i },
    { lang: 'Italian', pattern: /(italian|italiano)/i },
    { lang: 'Japanese', pattern: /(japanese|japan)/i },
    { lang: 'Chinese', pattern: /(chinese|china)/i },
    { lang: 'Korean', pattern: /(korean|korea)/i },
    { lang: 'English', pattern: /(english)/i }
  ];
  
  // Priority 1: Check for language in parentheses first
  const parenMatch = lowerFilename.match(/\(([^)]+)\)/);
  if (parenMatch) {
    const parenContent = parenMatch[1];
    for (const { lang, pattern } of languagePatterns) {
      if (pattern.test(parenContent) && lang !== 'English') {
        return lang;
      }
    }
  }
  
  // Priority 2: Check the full filename
  for (const { lang, pattern } of languagePatterns) {
    if (pattern.test(lowerFilename)) {
      if (lang !== 'English') {
        return lang;
      }
    }
  }
  
  // Priority 3: Check directory path parts
  for (const part of pathParts.slice(0, -1)) {
    const partLower = part.toLowerCase();
    for (const { lang, pattern } of languagePatterns) {
      if (pattern.test(partLower) && lang !== 'English') {
        return lang;
      }
    }
  }
  
  // Priority 4: Check for common English patterns
  const englishIndicators = /^(smw|super mario|princess|rescue|mario)/i;
  if (englishIndicators.test(lowerFilename.split('/').pop())) {
    return 'English';
  }
  
  // If no language indicators found, assume English
  return 'English';
}

// Get language tag for filename (e.g., "[Lang EN]", "[Lang ES]")
function getLanguageTag(language) {
  if (!language || language === 'English') {
    return '';
  }
  
  const tagMap = {
    'Portuguese': '[Lang PT]',
    'Spanish': '[Lang ES]',
    'French': '[Lang FR]',
    'German': '[Lang DE]',
    'Italian': '[Lang IT]',
    'Japanese': '[Lang JP]',
    'Chinese': '[Lang CN]',
    'Korean': '[Lang KR]'
  };
  
  return tagMap[language] || '[Lang Non-EN]';
}

// Create synthetic SFC filename with optional language tag
function createSyntheticFilename(name, author, date, languageTag = '') {
  const cleanName = name || 'Unknown';
  const cleanAuthor = author || 'Unknown';
  
  // Ensure date is in YYYY-MM-DD format
  let dateStr = date || new Date().toISOString().split('T')[0];
  if (dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
    // Already correct format
  } else if (dateStr.match(/^\d{4}-\d{2}$/)) {
    dateStr = `${dateStr}-01`;
  } else {
    dateStr = new Date().toISOString().split('T')[0];
  }
  
  const nameWithLang = languageTag ? `${cleanName} ${languageTag}` : cleanName;
  
  return `${nameWithLang} by ${cleanAuthor} [${dateStr}] (SMW Hack).sfc`;
}

// Extract date from URL path or use time field
function extractDateFromUrl(url) {
  // URL format: https://roms.smwc.world/2019/March/escape-from-the-sewer-19248.zip
  const urlMatch = url.match(/\/(\d{4})\/(\w+)\//);
  if (urlMatch) {
    const year = urlMatch[1];
    const monthName = urlMatch[2];
    
    const monthMap = {
      'January': '01', 'February': '02', 'March': '03', 'April': '04',
      'May': '05', 'June': '06', 'July': '07', 'August': '08',
      'September': '09', 'October': '10', 'November': '11', 'December': '12'
    };
    
    const month = monthMap[monthName] || '01';
    return `${year}-${month}-01`;
  }
  return null;
}

// Get parent directory name based on fields_type
function getParentDirectoryName(fieldsType) {
  if (!fieldsType) {
    return '[Super Mario World Hacks] SMW-General';
  }
  
  const primaryType = fieldsType.split(',')[0].trim();
  
  const typeMap = {
    'Kaizo': 'SMW-Kaizo',
    'Standard': 'SMW-Standard',
    'Puzzle': 'SMW-Puzzle',
    'Joke': 'SMW-General',
    'Misc.': 'SMW-General',
    'Tool-Assisted': 'SMW-General'
  };
  
  const dirName = typeMap[primaryType] || 'SMW-General';
  return `[Super Mario World Hacks] ${dirName}`;
}

// Download image with throttling
async function downloadImage(imageUrl, imagePath, lastRequestTime) {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  const waitTime = CONFIG.IMAGE_DOWNLOAD_DELAY - elapsed;
  
  if (waitTime > 0) {
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }
  
  try {
    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const imageData = Buffer.from(await response.arrayBuffer());
    const tempPath = `${imagePath}.tmp`;
    fs.writeFileSync(tempPath, imageData);
    fs.renameSync(tempPath, imagePath);
    
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Download all images for a game
async function downloadGameImages(game, gameid) {
  const screenshotFiles = [];
  
  // Create images directory for this game
  const gameImagesDir = path.join(CONFIG.IMAGES_DIR, gameid);
  if (!fs.existsSync(gameImagesDir)) {
    fs.mkdirSync(gameImagesDir, { recursive: true });
  }
  
  // Get images array - can be from 'images' field or from original data structure
  let images = game.images;
  if (!images || !Array.isArray(images)) {
    // No images to download
    return screenshotFiles;
  }
  
  console.log(`  Downloading ${images.length} image(s)...`);
  let lastImageRequestTime = 0;
  
  for (const imageUrl of images) {
    if (!imageUrl || typeof imageUrl !== 'string') {
      continue;
    }
    
    // Extract filename from URL (e.g., "https://dl.smwcentral.net/image/118201.png" -> "118201.png")
    const urlParts = imageUrl.split('/');
    const filename = urlParts[urlParts.length - 1];
    
    if (!filename) {
      console.log(`    ⚠ Skipping image with invalid filename: ${imageUrl}`);
      continue;
    }
    
    const imagePath = path.join(gameImagesDir, filename);
    
    // Skip if already downloaded
    if (fs.existsSync(imagePath)) {
      console.log(`    ⚠ Image already exists: ${filename}`);
      screenshotFiles.push(filename);
      continue;
    }
    
    console.log(`    Downloading ${filename}...`);
    const result = await downloadImage(imageUrl, imagePath, lastImageRequestTime);
    lastImageRequestTime = Date.now();
    
    if (result.success) {
      console.log(`      ✓ Downloaded: ${filename}`);
      screenshotFiles.push(filename);
    } else {
      console.log(`      ✗ Failed to download ${filename}: ${result.error}`);
    }
  }
  
  return screenshotFiles;
}

// Get existing screenshot files for a game
function getExistingScreenshotFiles(gameid) {
  const gameImagesDir = path.join(CONFIG.IMAGES_DIR, gameid);
  if (!fs.existsSync(gameImagesDir)) {
    return [];
  }
  
  try {
    const files = fs.readdirSync(gameImagesDir);
    return files.filter(f => {
      const filePath = path.join(gameImagesDir, f);
      return fs.statSync(filePath).isFile();
    }).sort();
  } catch (error) {
    return [];
  }
}

// Run level_reader (Step 10)
function runLevelReader(resultSfcPath, resultSha1) {
  try {
    const levelReaderPath = process.env.LEVEL_READER || path.join(process.env.HOME || '/home/me', 'smwdb', 'level_reader');
    if (!fs.existsSync(levelReaderPath)) {
      console.log(`      [level_reader] WARNING: level_reader not found at ${levelReaderPath}`);
      return null;
    }
    
    console.log(`      [level_reader] Running: ${levelReaderPath} ${resultSfcPath}`);
    const result = spawnSync(levelReaderPath, [resultSfcPath], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    if (result.status === 0) {
      if (result.stdout && result.stdout.trim()) {
        const trimmed = result.stdout.trim();
        
        try {
          if (trimmed.startsWith('"levelnames"')) {
            const wrapped = `{${trimmed}}`;
            const parsed = JSON.parse(wrapped);
            
            if (parsed.levelnames && typeof parsed.levelnames === 'object') {
              console.log(`      [level_reader] SUCCESS: Extracted levelnames (${Object.keys(parsed.levelnames).length} entries)`);
              return parsed.levelnames;
            } else {
              console.warn(`      [level_reader] WARNING: Parsed object does not contain levelnames`);
              return null;
            }
          } else if (trimmed.startsWith('{')) {
            const parsed = JSON.parse(trimmed);
            if (parsed.levelnames && typeof parsed.levelnames === 'object') {
              console.log(`      [level_reader] SUCCESS: Extracted levelnames from complete JSON (${Object.keys(parsed.levelnames).length} entries)`);
              return parsed.levelnames;
            } else {
              return parsed;
            }
          } else {
            console.error(`      [level_reader] ERROR: Output doesn't start with "levelnames" or "{"`);
            console.log(`      [level_reader] stdout preview: ${trimmed.substring(0, 200)}`);
            return null;
          }
        } catch (parseError) {
          console.log(`      [level_reader] Initial parse failed, attempting to extract levelnames object...`);
          
          let braceCount = 0;
          let startIdx = -1;
          let endIdx = -1;
          
          const levelnamesMatch = trimmed.match(/"levelnames"\s*:\s*\{/);
          if (levelnamesMatch) {
            startIdx = levelnamesMatch.index + levelnamesMatch[0].length - 1;
            
            for (let i = startIdx; i < trimmed.length; i++) {
              if (trimmed[i] === '{') {
                braceCount++;
              } else if (trimmed[i] === '}') {
                braceCount--;
                if (braceCount === 0) {
                  endIdx = i;
                  break;
                }
              }
            }
            
            if (startIdx !== -1 && endIdx !== -1) {
              const levelnamesStr = trimmed.substring(startIdx, endIdx + 1);
              try {
                const levelnames = JSON.parse(levelnamesStr);
                console.log(`      [level_reader] SUCCESS: Extracted levelnames object (${Object.keys(levelnames).length} entries)`);
                return levelnames;
              } catch (e4) {
                console.error(`      [level_reader] ERROR: Failed to parse extracted levelnames object: ${e4.message}`);
              }
            }
          }
          
          console.error(`      [level_reader] ERROR: Failed to parse JSON output: ${parseError.message}`);
          console.log(`      [level_reader] stdout preview: ${trimmed.substring(0, 500)}`);
          return null;
        }
      } else {
        console.warn(`      [level_reader] WARNING: Process exited with code 0 but no output`);
        return null;
      }
    } else {
      console.warn(`      [level_reader] WARNING: Process exited with status ${result.status}`);
      if (result.stderr) {
        console.warn(`      [level_reader] stderr: ${result.stderr.substring(0, 500)}`);
      }
      return null;
    }
  } catch (error) {
    console.error(`      [level_reader] ERROR: ${error.message}`);
    return null;
  }
}

/**
 * Spawn a process with timeout support
 */
function spawnWithTimeout(command, args, options = {}, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    let timeoutId;
    let killed = false;
    let stdout = '';
    let stderr = '';
    
    console.log(`      [lmfilter] Starting: ${command} ${args.join(' ')}`);
    
    const child = spawn(command, args, {
      ...options,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    if (child.stdout) {
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (data) => {
        stdout += data;
        const output = data.toString();
        const lines = output.split('\n');
        for (const line of lines) {
          if (line.trim()) {
            console.log(`      [lmfilter] stdout: ${line}`);
          }
        }
      });
    }
    
    if (child.stderr) {
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (data) => {
        stderr += data;
        const output = data.toString();
        const lines = output.split('\n');
        for (const line of lines) {
          if (line.trim()) {
            console.log(`      [lmfilter] stderr: ${line}`);
          }
        }
      });
    }
    
    timeoutId = setTimeout(() => {
      if (!killed && !child.killed) {
        killed = true;
        console.warn(`      [lmfilter] WARNING: Process exceeded timeout of ${timeoutMs}ms, killing...`);
        
        try {
          child.kill('SIGTERM');
          
          const forceKillTimeout = setTimeout(() => {
            if (!child.killed) {
              console.warn(`      [lmfilter] WARNING: Process did not respond to SIGTERM, force killing with SIGKILL...`);
              try {
                child.kill('SIGKILL');
              } catch (forceKillError) {
                console.error(`      [lmfilter] ERROR: Error force killing process: ${forceKillError.message}`);
              }
            }
          }, 2000);
          
          child.once('exit', () => {
            clearTimeout(forceKillTimeout);
          });
        } catch (killError) {
          console.error(`      [lmfilter] ERROR: Error killing process: ${killError.message}`);
        }
        
        reject(new Error(`Process ${command} exceeded timeout of ${timeoutMs}ms and was killed`));
      }
    }, timeoutMs);
    
    child.on('exit', (code, signal) => {
      clearTimeout(timeoutId);
      
      if (killed) {
        return;
      }
      
      console.log(`      [lmfilter] Process exited with code ${code}${signal ? ` (signal: ${signal})` : ''}`);
      
      if (signal) {
        reject(new Error(`Process ${command} was killed by signal: ${signal}`));
      } else {
        resolve({
          status: code,
          stdout: stdout,
          stderr: stderr
        });
      }
    });
    
    child.on('error', (error) => {
      clearTimeout(timeoutId);
      console.error(`      [lmfilter] ERROR: Process spawn failed: ${error.message}`);
      if (!killed) {
        reject(error);
      }
    });
  });
}

// Run try_lmfilter.py (Step 10.5)
async function runLmFilter(resultSfcPath, resultSha1) {
  try {
    console.log(`      [lmfilter] Starting try_lmfilter.py for ${resultSha1}...`);
    
    const env = {
      ...process.env,
      GAMETAG: resultSha1,
      GAMEVER: '1',
      ROMFILE: resultSfcPath
    };
    
    console.log(`      [lmfilter] Environment: GAMETAG=${resultSha1}, GAMEVER=1, ROMFILE=${resultSfcPath}`);
    
    const result = await spawnWithTimeout(
      'python3',
      ['try_lmfilter.py'],
      {
        env: env,
        cwd: process.cwd()
      },
      20000
    );
    
    console.log(`      [lmfilter] Process completed with status ${result.status}`);
    
    if (result.stdout && result.stdout.trim()) {
      console.log(`      [lmfilter] Full stdout output:`);
      const stdoutLines = result.stdout.split('\n');
      for (const line of stdoutLines) {
        if (line.trim()) {
          console.log(`      [lmfilter]   ${line}`);
        }
      }
    }
    
    if (result.stderr && result.stderr.trim()) {
      console.log(`      [lmfilter] Full stderr output:`);
      const stderrLines = result.stderr.split('\n');
      for (const line of stderrLines) {
        if (line.trim()) {
          console.log(`      [lmfilter]   ${line}`);
        }
      }
    }
    
    if (result.status === 0) {
      const tempJsonPath = 'temp/temp.json';
      if (fs.existsSync(tempJsonPath)) {
        console.log(`      [lmfilter] SUCCESS: Found output file ${tempJsonPath}`);
        
        const fileContent = fs.readFileSync(tempJsonPath, 'utf8').trim();
        
        let lmfilterArray = null;
        try {
          try {
            const parsed = JSON.parse(fileContent);
            if (parsed.levels && Array.isArray(parsed.levels)) {
              lmfilterArray = parsed.levels;
            } else if (Array.isArray(parsed)) {
              lmfilterArray = parsed;
            }
          } catch (e) {
            const trimmed = fileContent.trim();
            
            const levelsIndex = trimmed.indexOf('"levels"');
            if (levelsIndex === -1) {
              throw new Error('Could not find "levels" key in output');
            }
            
            const colonIndex = trimmed.indexOf(':', levelsIndex);
            if (colonIndex === -1) {
              throw new Error('Could not find colon after "levels"');
            }
            
            let bracketIndex = -1;
            for (let i = colonIndex; i < trimmed.length; i++) {
              if (trimmed[i] === '[') {
                bracketIndex = i;
                break;
              }
            }
            if (bracketIndex === -1) {
              throw new Error('Could not find opening bracket after "levels":');
            }
            
            let braceCount = 0;
            let endBracketIndex = -1;
            for (let i = bracketIndex; i < trimmed.length; i++) {
              if (trimmed[i] === '[') {
                braceCount++;
              } else if (trimmed[i] === ']') {
                braceCount--;
                if (braceCount === 0) {
                  endBracketIndex = i;
                  break;
                }
              }
            }
            if (endBracketIndex === -1) {
              throw new Error('Could not find matching closing bracket');
            }
            
            const arrayStr = trimmed.substring(bracketIndex, endBracketIndex + 1);
            lmfilterArray = JSON.parse(arrayStr);
          }
          
          if (!lmfilterArray || !Array.isArray(lmfilterArray)) {
            console.error(`      [lmfilter] ERROR: Could not extract valid array from output`);
            console.log(`      [lmfilter] File content preview (first 500 chars): ${fileContent.substring(0, 500)}`);
            fs.unlinkSync(tempJsonPath);
            return null;
          }
          
          console.log(`      [lmfilter] Successfully extracted levels array (${lmfilterArray.length} items)`);
        } catch (parseError) {
          console.error(`      [lmfilter] ERROR: Failed to extract array from file: ${parseError.message}`);
          console.log(`      [lmfilter] File content preview (first 500 chars): ${fileContent.substring(0, 500)}`);
          fs.unlinkSync(tempJsonPath);
          return null;
        }
        
        fs.unlinkSync(tempJsonPath);
        
        return lmfilterArray;
      } else {
        console.warn(`      [lmfilter] WARNING: Process exited with code 0 but temp/temp.json not found`);
      }
    } else {
      console.warn(`      [lmfilter] WARNING: Process exited with status ${result.status}`);
    }
    
    return null;
  } catch (error) {
    const errorMsg = error.message || String(error);
    console.error(`      [lmfilter] ERROR: ${errorMsg}`);
    
    if (errorMsg.includes('exceeded timeout')) {
      console.error(`      [lmfilter] The process was killed due to timeout. This may indicate a hang in try_lmfilter.py.`);
    }
    
    return null;
  }
}

// Run find_translevels.py (Step 10.6)
function runFindTranslevels(resultSfcPath, resultSha1) {
  try {
    const translevelsOutputPath = path.join(CONFIG.TEMP_DIR, `${resultSha1}_translevel.json`);
    
    const result = spawnSync('python3', ['findtranslevels/find_translevels.py', `--romfile=${resultSfcPath}`, `--output=${translevelsOutputPath}`], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: process.cwd()
    });
    
    if (result.status === 0 && fs.existsSync(translevelsOutputPath)) {
      const data = JSON.parse(fs.readFileSync(translevelsOutputPath, 'utf8'));
      return data;
    }
    return null;
  } catch (error) {
    return null;
  }
}

// Main processing function
async function main() {
  parseArgs(process.argv.slice(2));
  
  console.log('==================================================');
  console.log('  smwcw_waiting_fetchmissing.js - Download Waiting Games');
  console.log('==================================================\n');
  
  // Initialize
  initConfig();
  
  // Read waiting_queue.json
  if (!fs.existsSync(CONFIG.QUEUE_JSON_PATH)) {
    console.error(`Error: ${CONFIG.QUEUE_JSON_PATH} not found`);
    console.error('Please run smwcw_waiting_compare.js first to generate waiting_queue.json');
    process.exit(1);
  }
  
  const queueGames = JSON.parse(fs.readFileSync(CONFIG.QUEUE_JSON_PATH, 'utf8'));
  console.log(`Found ${queueGames.length} games in waiting_queue.json\n`);
  
  // Process each game
  let processed = 0;
  let skipped = 0;
  let failed = 0;
  
  for (const game of queueGames) {
    const gameid = game.gameid;
    console.log(`\n[${processed + skipped + failed + 1}/${queueGames.length}] Processing game ${gameid}: ${game.name}`);
    
    // Skip if no download_url
    if (!game.download_url) {
      console.log(`  ⚠ Skipping: No download_url`);
      skipped++;
      continue;
    }
    
    // Check if ZIP already exists
    const zipPath = path.join(CONFIG.ZIPS_DIR, `${gameid}.zip`);
    const zipAlreadyExists = fs.existsSync(zipPath);
    
    // Skip if ZIP exists and we're not processing existing ZIPs
    if (zipAlreadyExists && !CONFIG.PROCESS_EXISTING_ZIPS) {
      console.log(`  ⚠ Skipping: ZIP already exists at ${zipPath}`);
      skipped++;
      continue;
    }
    
    let uploadEstimate = null;
    let originalFilename = null;
    
    if (zipAlreadyExists) {
      console.log(`  ⚠ ZIP already exists at ${zipPath}, processing existing file...`);
      const urlParts = game.download_url.split('/');
      originalFilename = urlParts[urlParts.length - 1];
      const stats = fs.statSync(zipPath);
      uploadEstimate = stats.mtime.toISOString();
    }
    
    try {
      // Download images first
      const screenshotFiles = await downloadGameImages(game, gameid);
      const existingScreenshots = getExistingScreenshotFiles(gameid);
      const allScreenshots = [...new Set([...screenshotFiles, ...existingScreenshots])].sort();
      
      if (!zipAlreadyExists) {
        // Download ZIP file
        console.log(`  Downloading from ${game.download_url}...`);
        console.log(`  Waiting 10 seconds before download...`);
        await new Promise(resolve => setTimeout(resolve, 10000));
        const response = await fetch(game.download_url);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const lastModified = response.headers.get('last-modified');
        uploadEstimate = lastModified ? new Date(lastModified).toISOString() : new Date().toISOString();
        
        const zipData = Buffer.from(await response.arrayBuffer());
        const tempZipPath = `${zipPath}.tmp`;
        fs.writeFileSync(tempZipPath, zipData);
        fs.renameSync(tempZipPath, zipPath);
        console.log(`  ✓ Downloaded and saved to ${zipPath}`);
        
        const urlParts = game.download_url.split('/');
        originalFilename = urlParts[urlParts.length - 1];
      }
      
      // Extract BPS files
      const bpsFiles = extractBpsFiles(zipPath);
      if (bpsFiles.length === 0) {
        console.log(`  ⚠ No BPS files found in ZIP`);
        skipped++;
        continue;
      }
      
      console.log(`  Found ${bpsFiles.length} BPS file(s)`);
      
      // Detect languages from all BPS files
      const detectedLanguages = new Set();
      for (const bpsFile of bpsFiles) {
        const lang = detectLanguageFromFilename(bpsFile.filename);
        if (lang) {
          detectedLanguages.add(lang);
        }
      }
      
      // Process each BPS file
      const processedBps = [];
      const gameResults = {
        ...game, // Include ALL fields from waiting_queue.json
        original_download_filename: originalFilename,
        screenshot_files: allScreenshots, // Add screenshot files list
        bps_files: [],
        json_files: [],
        errors: []
      };
      
      const hasAuthoritativeData = !zipAlreadyExists;
      
      for (const bpsFile of bpsFiles) {
        try {
          console.log(`    Processing BPS: ${bpsFile.filename}`);
          
          const zip = new AdmZip(zipPath);
          const bpsData = zip.readFile(bpsFile.entry);
          if (!bpsData) {
            throw new Error('Failed to extract BPS from ZIP');
          }
          
          const tempBpsPath = path.join(CONFIG.TEMP_DIR, `test_${Date.now()}_${Math.random().toString(36).substring(7)}.bps`);
          fs.writeFileSync(tempBpsPath, bpsData);
          
          const tempResultPath = path.join(CONFIG.TEMP_DIR, `result_${Date.now()}_${Math.random().toString(36).substring(7)}.sfc`);
          const patchResult = testPatchBps(tempBpsPath, tempResultPath);
          
          if (!patchResult.success) {
            console.log(`      ✗ Patching failed: ${patchResult.error}`);
            gameResults.errors.push(`BPS ${bpsFile.filename}: ${patchResult.error}`);
            fs.unlinkSync(tempBpsPath);
            continue;
          }
          
          const resultData = fs.readFileSync(tempResultPath);
          const resultHash = calculateHash(resultData, false);
          const resultSha256 = crypto.createHash('sha256').update(resultData).digest('hex');
          const resultDataLength = resultData.length;
          
          console.log(`      ✓ Patch successful, result hash: ${resultHash}`);
          
          const bpsFilename = `${resultHash}.bps`;
          const bpsPath = path.join(CONFIG.BPS_DIR, bpsFilename);
          const indexJsonFilename = `${resultHash}.json`;
          
          const bpsAlreadyExists = fs.existsSync(bpsPath);
          if (bpsAlreadyExists) {
            console.log(`      ⚠ BPS file already exists: ${bpsFilename}`);
            console.log(`      ⚠ Skipping Step 10 processing (level_reader, lmfilter, find_translevels) for existing BPS file`);
          }
          
          const hasHeader = detectHeader(resultData);
          let unheaderedData = hasHeader ? removeHeader(resultData) : resultData;
          let headeredData = hasHeader ? resultData : addHeader(resultData);
          
          const smcRomSha1 = calculateHash(headeredData, false);
          const smc2RomSha256 = calculateHash(headeredData, true);
          
          const zipEntry = bpsFile.entry;
          const zipEntryTime = zipEntry.header.time;
          const zipContentTimestamp = zipEntryTime ? new Date(zipEntryTime.getTime()).toISOString().replace(/\.\d{3}Z$/, '') : null;
          
          let levelReadData = null;
          let lmFilterData = null;
          let translevelData = null;
          
          if (!bpsAlreadyExists) {
            console.log(`      Running Step 10 processing (level_reader, lmfilter, find_translevels)...`);
            console.log(`      Step 10.1: Running level_reader...`);
            levelReadData = runLevelReader(tempResultPath, resultHash);
            console.log(`      Step 10.2: Running try_lmfilter.py...`);
            lmFilterData = await runLmFilter(tempResultPath, resultHash);
            console.log(`      Step 10.3: Running find_translevels.py...`);
            translevelData = runFindTranslevels(tempResultPath, resultHash);
            console.log(`      Step 10 processing complete.`);
          }
          
          if (!bpsAlreadyExists) {
            const tempBpsFinalPath = `${bpsPath}.tmp`;
            fs.writeFileSync(tempBpsFinalPath, bpsData);
            fs.renameSync(tempBpsFinalPath, bpsPath);
          }
          
          const typeMapping = mapTypeAndDifficulty(game);
          const firstAuthor = extractFirstAuthor(game.authors);
          const bpsSha1 = calculateHash(bpsData, false);
          const bpsSha256 = calculateHash(bpsData, true);
          
          // Extract date - prefer time field converted to date, then URL, then other fields
          let syntheticDate = null;
          if (game.time) {
            // Convert Unix timestamp to YYYY-MM-DD
            const dateObj = new Date(game.time * 1000);
            syntheticDate = dateObj.toISOString().split('T')[0];
          } else {
            const urlDate = extractDateFromUrl(game.download_url);
            syntheticDate = urlDate || game.date || new Date().toISOString().split('T')[0];
          }
          
          const detectedLanguage = detectLanguageFromFilename(bpsFile.filename);
          
          let languageTag = '';
          if (detectedLanguages.size > 1) {
            if (detectedLanguage === 'English') {
              languageTag = '[Lang EN]';
            } else if (detectedLanguage) {
              languageTag = getLanguageTag(detectedLanguage);
            } else {
              languageTag = '[Lang Non-EN]';
            }
          } else {
            languageTag = getLanguageTag(detectedLanguage);
          }
          
          let estimatedLanguage = detectedLanguage;
          if (!estimatedLanguage) {
            estimatedLanguage = 'English';
          }
          
          const syntheticSfcFilename = createSyntheticFilename(game.name, firstAuthor || game.authors, syntheticDate, languageTag);
          const titleWithLang = languageTag ? `${game.name} ${languageTag}` : game.name;
          const parentDirName = getParentDirectoryName(typeMapping.fields_type);
          
          let levelnames = null;
          if (levelReadData && typeof levelReadData === 'object' && !Array.isArray(levelReadData)) {
            levelnames = levelReadData;
          }
          
          // Create gameversion object with ALL fields from waiting_queue.json
          // Start with all fields from the game object (waiting_queue.json has normalized data)
          const gameversion = {
            ...game, // Include ALL fields from waiting_queue.json
            // Ensure required fields are set, using typeMapping for type/difficulty fields
            legacy_type: typeMapping.legacy_type || game.fields_type || game.difficulty,
            combinedtype: game.combinedtype || typeMapping.legacy_type || game.fields_type || game.difficulty,
            fields_type: typeMapping.fields_type || game.fields_type || null,
            difficulty: typeMapping.difficulty || game.difficulty || null,
            author: firstAuthor || game.author || null,
            authors: game.authors || null
          };
          
          const indexJson = {
            // SMWC Waiting data (keep original for reference)
            smwc_waiting: {
              gameid: game.gameid,
              name: game.name,
              url: game.url,
              download_url: game.download_url
            },
            
            // Synthetic filename
            sfcsource_filename: syntheticSfcFilename,
            
            // BPS file info
            bps_filename: bpsFilename,
            bps_sha1_hash: bpsSha1,
            bps_sha256_hash: bpsSha256,
            original_download_filename: originalFilename,
            source_bps_filename: bpsFile.filename,
            
            // Result ROM info (unheadered - SFC format)
            sfc_rom_sha1_hash: resultHash,
            sfc_rom_sha256_hash: resultSha256,
            sfc_rom_size: resultDataLength,
            
            // Headered ROM info (SMC format)
            smc_rom_sha1_hash: smcRomSha1,
            smc2_rom_sha256_hash: smc2RomSha256,
            
            // Filename metadata
            sfc_filename_title: titleWithLang,
            sfc_filename_author: firstAuthor || game.authors,
            sfc_filename_date: syntheticDate,
            '7z_filename_title': titleWithLang,
            '7z_filename_author': firstAuthor || game.authors,
            '7z_filename_date': syntheticDate,
            
            // Language information
            estimated_language: estimatedLanguage,
            
            // Upload estimates
            sfc_upload_estimate: uploadEstimate || new Date().toISOString(),
            dir_upload_estimate: uploadEstimate || new Date().toISOString(),
            '7z_upload_estimate': uploadEstimate || new Date().toISOString(),
            
            // Parent directories
            sfc_parent_directory: parentDirName,
            '7z_parent_directory': parentDirName,
            zip_parent_directory: parentDirName,
            
            // ZIP/7z content info
            zip_content_filename: bpsFile.filename,
            zip_content_timestamp: zipContentTimestamp,
            '7z_content_filename': bpsFile.filename,
            '7z_content_timestamp': zipContentTimestamp,
            
            // Gameversion data - includes ALL fields from waiting_queue.json
            gameversion: gameversion,
            
            // Placeholders for search indexing
            index7z_name: null,
            index7z_ipfs_cidv1: null,
            indexbps_name: bpsFilename,
            
            // Level data from Step 10 processing
            levelnames: levelnames,
            translevel_data: translevelData
          };
          
          if (lmFilterData && Array.isArray(lmFilterData)) {
            indexJson.lmfilter = lmFilterData;
          }
          
          const indexJsonPath = path.join(CONFIG.BPSINDEX_DIR, indexJsonFilename);
          const indexJsonExists = fs.existsSync(indexJsonPath);
          
          if (!bpsAlreadyExists) {
            fs.writeFileSync(indexJsonPath, JSON.stringify(indexJson, null, 2));
            console.log(`      ✓ Created index JSON: ${indexJsonPath}`);
          } else if (indexJsonExists && !hasAuthoritativeData) {
            console.log(`      ⚠ Index JSON already exists: ${indexJsonFilename}`);
            console.log(`      ⚠ Preserving existing index JSON (no authoritative data - ZIP was not downloaded)`);
          } else if (indexJsonExists && hasAuthoritativeData) {
            fs.writeFileSync(indexJsonPath, JSON.stringify(indexJson, null, 2));
            console.log(`      ✓ Updated index JSON with authoritative data: ${indexJsonPath}`);
          } else if (!indexJsonExists && hasAuthoritativeData) {
            console.log(`      ⚠ WARNING: BPS exists but index JSON missing: ${indexJsonFilename}`);
            console.log(`      ⚠ Cannot create complete index JSON without Step 10 data (level_reader, lmfilter, find_translevels)`);
            console.log(`      ⚠ Skipping index JSON creation - BPS exists but index JSON is missing`);
          } else {
            console.log(`      ⚠ WARNING: BPS exists but index JSON missing: ${indexJsonFilename}`);
            console.log(`      ⚠ Cannot create complete index JSON without Step 10 data (level_reader, lmfilter, find_translevels)`);
            console.log(`      ⚠ Skipping index JSON creation - BPS exists but index JSON is missing`);
          }
          
          processedBps.push({
            hash: resultHash,
            filename: bpsFilename,
            source_filename: bpsFile.filename,
            index_json: indexJsonFilename,
            result_sha1: resultHash,
            already_existed: bpsAlreadyExists
          });
          
          gameResults.bps_files.push(bpsFilename);
          gameResults.json_files.push(indexJsonFilename);
          
          if (bpsAlreadyExists) {
            fs.unlinkSync(tempBpsPath);
            fs.unlinkSync(tempResultPath);
          } else {
            fs.unlinkSync(tempBpsPath);
          }
          
        } catch (error) {
          console.log(`      ✗ Error processing BPS ${bpsFile.filename}: ${error.message}`);
          gameResults.errors.push(`BPS ${bpsFile.filename}: ${error.message}`);
        }
      }
      
      // Create wrap-up JSON with screenshot_files included
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
  console.log(`  Total games:     ${queueGames.length}`);
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
