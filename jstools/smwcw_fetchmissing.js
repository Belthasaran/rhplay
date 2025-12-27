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
const { execSync, spawnSync, spawn } = require('child_process');
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
  // Order matters - check more specific patterns first
  // Note: Patterns need to be flexible to catch common typos like "Portguese" instead of "Portuguese"
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
  
  // Priority 1: Check for language in parentheses first (strongest indicator)
  const parenMatch = lowerFilename.match(/\(([^)]+)\)/);
  if (parenMatch) {
    const parenContent = parenMatch[1];
    for (const { lang, pattern } of languagePatterns) {
      if (pattern.test(parenContent) && lang !== 'English') {
        return lang; // Language in parentheses is a strong indicator
      }
    }
  }
  
  // Priority 2: Check the full filename
  for (const { lang, pattern } of languagePatterns) {
    if (pattern.test(lowerFilename)) {
      if (lang !== 'English') {
        return lang; // Non-English languages take priority
      }
    }
  }
  
  // Priority 3: Check directory path parts
  for (const part of pathParts.slice(0, -1)) {
    const partLower = part.toLowerCase();
    for (const { lang, pattern } of languagePatterns) {
      if (pattern.test(partLower) && lang !== 'English') {
        return lang; // Non-English languages take priority
      }
    }
  }
  
  // Priority 4: Check for common English patterns (avoid false positives)
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
    return ''; // Don't tag English by default (only when multiple languages exist)
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
  // Format: "Name [Lang XX] by Author [YYYY-MM-DD] (SMW Hack).sfc"
  const cleanName = name || 'Unknown';
  const cleanAuthor = author || 'Unknown';
  
  // Ensure date is in YYYY-MM-DD format
  let dateStr = date || new Date().toISOString().split('T')[0];
  if (dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
    // Already correct format
  } else if (dateStr.match(/^\d{4}-\d{2}$/)) {
    dateStr = `${dateStr}-01`; // Add day
  } else {
    dateStr = new Date().toISOString().split('T')[0];
  }
  
  // Add language tag to name if provided
  const nameWithLang = languageTag ? `${cleanName} ${languageTag}` : cleanName;
  
  return `${nameWithLang} by ${cleanAuthor} [${dateStr}] (SMW Hack).sfc`;
}

// Extract date from URL path
function extractDateFromUrl(url) {
  // URL format: https://roms.smwc.world/2019/March/escape-from-the-sewer-19248.zip
  // Extract year/month and convert to YYYY-MM-01 format
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
  
  // Extract primary type (first one if comma-separated)
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
        try {
          const data = JSON.parse(result.stdout);
          console.log(`      [level_reader] SUCCESS: Parsed JSON data`);
          return data;
        } catch (parseError) {
          console.error(`      [level_reader] ERROR: Failed to parse JSON output: ${parseError.message}`);
          console.log(`      [level_reader] stdout preview: ${result.stdout.substring(0, 200)}`);
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
 * Spawn a process with timeout support (prevents deadlocks)
 * @param {string} command - Command to execute
 * @param {string[]} args - Command arguments
 * @param {Object} options - spawn options (cwd, env, stdio, etc.)
 * @param {number} timeoutMs - Timeout in milliseconds (default: 20000)
 * @returns {Promise<{status: number, stdout: string, stderr: string}>}
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
    
    // Collect stdout with logging
    if (child.stdout) {
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (data) => {
        stdout += data;
        // Log all output in real-time (each line)
        const output = data.toString();
        const lines = output.split('\n');
        for (const line of lines) {
          if (line.trim()) {
            console.log(`      [lmfilter] stdout: ${line}`);
          }
        }
      });
    }
    
    // Collect stderr with logging
    if (child.stderr) {
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (data) => {
        stderr += data;
        // Log all output in real-time (each line)
        const output = data.toString();
        const lines = output.split('\n');
        for (const line of lines) {
          if (line.trim()) {
            console.log(`      [lmfilter] stderr: ${line}`);
          }
        }
      });
    }
    
    // Set up timeout
    timeoutId = setTimeout(() => {
      if (!killed && !child.killed) {
        killed = true;
        console.warn(`      [lmfilter] WARNING: Process exceeded timeout of ${timeoutMs}ms, killing...`);
        
        // Try to kill the process
        try {
          // First, try graceful termination
          child.kill('SIGTERM');
          
          // If it doesn't die quickly, force kill
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
          
          // Clear the force kill timeout if process exits
          child.once('exit', () => {
            clearTimeout(forceKillTimeout);
          });
        } catch (killError) {
          console.error(`      [lmfilter] ERROR: Error killing process: ${killError.message}`);
        }
        
        reject(new Error(`Process ${command} exceeded timeout of ${timeoutMs}ms and was killed`));
      }
    }, timeoutMs);
    
    // Handle process exit
    child.on('exit', (code, signal) => {
      clearTimeout(timeoutId);
      
      if (killed) {
        // Already handled by timeout
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
    
    // Handle process errors
    child.on('error', (error) => {
      clearTimeout(timeoutId);
      console.error(`      [lmfilter] ERROR: Process spawn failed: ${error.message}`);
      if (!killed) {
        reject(error);
      }
    });
  });
}

// Run try_lmfilter.py (Step 10.5) - returns data or null
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
    
    // Use spawnWithTimeout to prevent deadlocks - 20 second timeout with 2 second kill grace period
    const result = await spawnWithTimeout(
      'python3',
      ['try_lmfilter.py'],
      {
        env: env,
        cwd: process.cwd()
      },
      20000 // 20 second timeout
    );
    
    console.log(`      [lmfilter] Process completed with status ${result.status}`);
    
    // Always log full stdout/stderr for visibility
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
        
        // Read the file content
        const fileContent = fs.readFileSync(tempJsonPath, 'utf8').trim();
        
        // lmfilter outputs a JSON snippet (key-value pair) like: "levels": ["106", "1F0", ...]
        // We need to extract the array value and return it as a list of strings
        let lmfilterArray = null;
        try {
          // The output is a JSON snippet like: "levels": ["106", "1F0", "121", ...]
          // We need to wrap it in braces to make it a valid JSON object, then extract the array value
          let wrappedContent = fileContent;
          
          // Check if it already starts with { (full JSON object)
          if (!fileContent.startsWith('{')) {
            // It's a JSON snippet, wrap it in braces
            wrappedContent = `{${fileContent}}`;
            console.log(`      [lmfilter] Wrapped JSON snippet in object braces`);
          }
          
          // Parse the JSON object
          const jsonData = JSON.parse(wrappedContent);
          
          // Extract the array value - it should have a "levels" key
          // (or we take the first array value found in the object)
          if (jsonData.levels && Array.isArray(jsonData.levels)) {
            lmfilterArray = jsonData.levels;
            console.log(`      [lmfilter] Successfully extracted levels array (${lmfilterArray.length} items)`);
          } else {
            // Try to find any array value in the object
            const keys = Object.keys(jsonData);
            for (const key of keys) {
              if (Array.isArray(jsonData[key])) {
                lmfilterArray = jsonData[key];
                console.log(`      [lmfilter] Extracted array from key "${key}" (${lmfilterArray.length} items)`);
                break;
              }
            }
          }
          
          if (!lmfilterArray) {
            console.error(`      [lmfilter] ERROR: No array found in JSON data`);
            console.log(`      [lmfilter] JSON data keys: ${Object.keys(jsonData).join(', ')}`);
            fs.unlinkSync(tempJsonPath);
            return null;
          }
        } catch (parseError) {
          console.error(`      [lmfilter] ERROR: Failed to parse JSON from file: ${parseError.message}`);
          console.log(`      [lmfilter] File content preview (first 500 chars): ${fileContent.substring(0, 500)}`);
          fs.unlinkSync(tempJsonPath);
          return null;
        }
        
        // Clean up temp file
        fs.unlinkSync(tempJsonPath);
        
        // Return the array of strings (matches the format in index files)
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
    
    // If it was a timeout, log additional info
    if (errorMsg.includes('exceeded timeout')) {
      console.error(`      [lmfilter] The process was killed due to timeout. This may indicate a hang in try_lmfilter.py.`);
    }
    
    return null;
  }
}

// Run find_translevels.py (Step 10.6) - returns data or null
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
      // Download ZIP file (atomic save) and get Last-Modified header
      console.log(`  Downloading from ${game.download_url}...`);
      console.log(`  Waiting 10 seconds before download...`);
      await new Promise(resolve => setTimeout(resolve, 10000));
      const response = await fetch(game.download_url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      // Get Last-Modified header for upload estimate
      const lastModified = response.headers.get('last-modified');
      const uploadEstimate = lastModified ? new Date(lastModified).toISOString() : new Date().toISOString();
      
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
          
          // Save BPS file temporarily for testing (use temporary name)
          const tempBpsPath = path.join(CONFIG.TEMP_DIR, `test_${Date.now()}_${Math.random().toString(36).substring(7)}.bps`);
          fs.writeFileSync(tempBpsPath, bpsData);
          
          // Test patch with flips (use temporary name)
          const tempResultPath = path.join(CONFIG.TEMP_DIR, `result_${Date.now()}_${Math.random().toString(36).substring(7)}.sfc`);
          const patchResult = testPatchBps(tempBpsPath, tempResultPath);
          
          if (!patchResult.success) {
            console.log(`      ✗ Patching failed: ${patchResult.error}`);
            gameResults.errors.push(`BPS ${bpsFile.filename}: ${patchResult.error}`);
            fs.unlinkSync(tempBpsPath);
            continue;
          }
          
          // Calculate result hash (SFC ROM hash after patching) - this is what we use for filenames
          const resultData = fs.readFileSync(tempResultPath);
          const resultHash = calculateHash(resultData, false); // Always SHA1 for result
          const resultSha256 = crypto.createHash('sha256').update(resultData).digest('hex');
          const resultDataLength = resultData.length;
          
          console.log(`      ✓ Patch successful, result hash: ${resultHash}`);
          
          // BPS filename should be based on the SFC ROM hash (resultHash), not the BPS file hash
          const bpsFilename = `${resultHash}.bps`;
          const bpsPath = path.join(CONFIG.BPS_DIR, bpsFilename);
          
          // Check if BPS already exists (now using resultHash)
          if (fs.existsSync(bpsPath)) {
            console.log(`      ⚠ BPS file already exists: ${bpsFilename}`);
            console.log(`      ⚠ Skipping Step 10 processing (level_reader, lmfilter, find_translevels) for existing BPS file`);
            processedBps.push({
              hash: resultHash, // Use resultHash as the hash identifier
              filename: bpsFilename,
              source_filename: bpsFile.filename,
              already_existed: true
            });
            fs.unlinkSync(tempBpsPath);
            fs.unlinkSync(tempResultPath);
            continue;
          }
          
          // Create headered version for smc_rom_sha1_hash and smc2_rom_sha256_hash
          const hasHeader = detectHeader(resultData);
          let unheaderedData = hasHeader ? removeHeader(resultData) : resultData;
          let headeredData = hasHeader ? resultData : addHeader(resultData);
          
          const smcRomSha1 = calculateHash(headeredData, false);
          const smc2RomSha256 = calculateHash(headeredData, true);
          
          // Get ZIP entry timestamp
          const zipEntry = bpsFile.entry;
          const zipEntryTime = zipEntry.header.time;
          const zipContentTimestamp = zipEntryTime ? new Date(zipEntryTime.getTime()).toISOString().replace(/\.\d{3}Z$/, '') : null;
          
          // Step 10: Run level_reader, try_lmfilter.py, find_translevels.py
          console.log(`      Running Step 10 processing (level_reader, lmfilter, find_translevels)...`);
          console.log(`      Step 10.1: Running level_reader...`);
          const levelReadData = runLevelReader(tempResultPath, resultHash);
          console.log(`      Step 10.2: Running try_lmfilter.py...`);
          const lmFilterData = await runLmFilter(tempResultPath, resultHash);
          console.log(`      Step 10.3: Running find_translevels.py...`);
          const translevelData = runFindTranslevels(tempResultPath, resultHash);
          console.log(`      Step 10 processing complete.`);
          
          // Save BPS file (atomic)
          const tempBpsFinalPath = `${bpsPath}.tmp`;
          fs.writeFileSync(tempBpsFinalPath, bpsData);
          fs.renameSync(tempBpsFinalPath, bpsPath);
          
          // Clean up temp BPS file
          fs.unlinkSync(tempBpsPath);
          
          // Create index JSON
          const typeMapping = mapTypeAndDifficulty(game);
          const firstAuthor = extractFirstAuthor(game.authors);
          const bpsSha1 = calculateHash(bpsData, false);
          const bpsSha256 = calculateHash(bpsData, true);
          
          // Extract date from URL
          const urlDate = extractDateFromUrl(game.download_url);
          const syntheticDate = urlDate || game.date || new Date().toISOString().split('T')[0];
          
          // Detect language for this BPS file
          const detectedLanguage = detectLanguageFromFilename(bpsFile.filename);
          
          // Determine language tag - if multiple languages exist, tag all (including English)
          let languageTag = '';
          if (detectedLanguages.size > 1) {
            // Multiple languages detected - tag all files
            if (detectedLanguage === 'English') {
              languageTag = '[Lang EN]';
            } else if (detectedLanguage) {
              languageTag = getLanguageTag(detectedLanguage);
            } else {
              languageTag = '[Lang Non-EN]'; // Uncertain language
            }
          } else {
            // Single language - only tag if non-English
            languageTag = getLanguageTag(detectedLanguage);
          }
          
          // Determine estimated_language attribute - use the detected language directly
          let estimatedLanguage = detectedLanguage;
          if (!estimatedLanguage) {
            // Fallback to English only if detection completely failed
            estimatedLanguage = 'English';
          }
          
          // Create synthetic filename with language tag
          const syntheticSfcFilename = createSyntheticFilename(game.name, firstAuthor || game.authors, syntheticDate, languageTag);
          
          // Create title with language tag
          const titleWithLang = languageTag ? `${game.name} ${languageTag}` : game.name;
          
          // Get parent directory name
          const parentDirName = getParentDirectoryName(typeMapping.fields_type);
          
          // Extract levelnames from levelReadData if available
          let levelnames = null;
          if (levelReadData && levelReadData.names_decimal) {
            levelnames = levelReadData.names_decimal;
          }
          
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
            
            // Filename metadata (synthetic based on game data)
            sfc_filename_title: titleWithLang,
            sfc_filename_author: firstAuthor || game.authors,
            sfc_filename_date: syntheticDate,
            '7z_filename_title': titleWithLang,
            '7z_filename_author': firstAuthor || game.authors,
            '7z_filename_date': syntheticDate,
            
            // Language information
            estimated_language: estimatedLanguage,
            
            // Upload estimates (from HTTP Last-Modified header)
            sfc_upload_estimate: uploadEstimate,
            dir_upload_estimate: uploadEstimate,
            '7z_upload_estimate': uploadEstimate,
            
            // Parent directories (synthetic based on type)
            sfc_parent_directory: parentDirName,
            '7z_parent_directory': parentDirName,
            zip_parent_directory: parentDirName,
            
            // ZIP/7z content info
            zip_content_filename: bpsFile.filename,
            zip_content_timestamp: zipContentTimestamp,
            '7z_content_filename': bpsFile.filename,
            '7z_content_timestamp': zipContentTimestamp,
            
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
            
            // Level data from Step 10 processing
            levelnames: levelnames,
            translevel_data: translevelData
          };
          
          // Add lmfilter data if available (Step 10.5)
          // lmFilterData should be an array of strings (list of level codes)
          if (lmFilterData && Array.isArray(lmFilterData)) {
            indexJson.lmfilter = lmFilterData;
          }
          
          // Save index JSON - use resultHash (SFC ROM hash) for filename, not BPS hash
          const indexJsonPath = path.join(CONFIG.BPSINDEX_DIR, `${resultHash}.json`);
          fs.writeFileSync(indexJsonPath, JSON.stringify(indexJson, null, 2));
          console.log(`      ✓ Created index JSON: ${indexJsonPath}`);
          
          processedBps.push({
            hash: resultHash, // Use resultHash (SFC ROM hash) as the hash identifier
            filename: bpsFilename,
            source_filename: bpsFile.filename,
            index_json: `${resultHash}.json`, // Use SFC ROM hash for JSON filename
            result_sha1: resultHash
          });
          
          gameResults.bps_files.push(bpsFilename);
          gameResults.json_files.push(`${resultHash}.json`); // Use SFC ROM hash for JSON filename
          
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

