#!/usr/bin/env node

/**
 * process_arcsfc.js - Process SNES ROM files and create BPS patches
 * 
 * Usage:
 *   node process_arcsfc.js <sfcsource_filename> [sfcarchive_filename]
 *   node process_arcsfc.js --help
 * 
 * This script is designed to be run from a subdirectory of /home/me/smwdb/
 * It processes SNES ROM files, detects headers, creates standardized versions,
 * calculates hashes, and generates BPS patches.
 * 
 * Requirements:
 * - Linux platform
 * - Wine installed
 * - K:\snesheader.exe available via wine
 * - flips utility available
 * - 7z utility available
 */

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const crypto = require('crypto');
const { lock, unlock } = require('os-lock');
const { spawnSync, execSync, spawn } = require('child_process');

// Constants
const SMW_BASE_ROM = process.env.PATH_BASE_ROM || '/home/me/smwdb/smw.sfc';
const SNESHEADER_EXE = "K:\\snesheader.exe";
const LOCK_FILE = 'temp/lock.txt';

// Helper function to calculate SHA1 hash
async function calculateSHA1(filePath) {
  const buffer = await fs.readFile(filePath);
  return crypto.createHash('sha1').update(buffer).digest('hex');
}

// Helper function to calculate SHA256 hash
async function calculateSHA256(filePath) {
  const buffer = await fs.readFile(filePath);
  return crypto.createHash('sha256').update(buffer).digest('hex');
}


async function calculateFileSize(filePath) {
  const buffer = await fs.readFile(filePath);
  return buffer.length;
}


// Helper function to ensure directory exists
async function ensureDir(dirPath) {
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch (error) {
    if (error.code !== 'EEXIST') {
      throw error;
    }
  }
}

// Helper function to acquire exclusive lock with retry
async function acquireLock(lockPath, maxRetries = 10, retryDelay = 500) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const fd = await fs.open(lockPath, 'w+');

      await lock(fd.fd, { exclusive: true });
      // Keep the file descriptor open to maintain the lock
      return fd;
    } catch (error) {
      if (error.code === 'EEXIST') {
        if (attempt < maxRetries - 1) {
          // Lock file exists, wait and retry
          console.log(`Lock file exists, waiting ${retryDelay}ms before retry ${attempt + 1}/${maxRetries}...`);
          await new Promise(resolve => setTimeout(resolve, retryDelay));
          continue;
        } else {
          // Final attempt failed
          throw new Error(`Lock file exists: ${lockPath}. Another process may be running. Failed after ${maxRetries} attempts.`);
        }
      }
      throw error;
    }
  }
}

// Helper function to release lock
async function releaseLock(lockFd, lockPath) {
  if (lockFd) {
    try {
      await unlock(lockFd.fd);
      await lockFd.close();
      console.log(`lock Released ${lockPath}`)
    } catch (e) {
      // Ignore close errors
    }
  }
  try {
    await fs.unlink(lockPath);
  } catch (e) {
    // Ignore if already removed
  }
}

// Helper function to check if a number is a power of 2 in kilobytes
function isPowerOf2KB(size) {
  const sizeKB = size / 1024;
  // Check if sizeKB is a power of 2 (1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096, 8192)
  return sizeKB > 0 && (sizeKB & (sizeKB - 1)) === 0;
}

// Helper function to determine ROM type
async function determineROMType(filePath) {
  const stats = await fs.stat(filePath);
  const size = stats.size;
  const sizeMod1024 = size % 1024;

  
	//
	//The power of 2 thing is just a suggestion, apparently.
	//We have a lot of exceptions.
	//
	//Still i'm just looking to pare them down to a small enough number, so the rest of the files can be looked at manually.
	//
	//
	// these 1081344-byte files  might be headered despite not being a power of 2.. it does have  n mod 1024==512., hmm.
	////  What is this 786432 size?
	//
	//
  if (sizeMod1024==0 && size >= 683263)
	return 'unheadered';

  if (size >= 529966 && process.env["FORCEROM"]) {
	  return process.env["FORCEROM"]
  }

  if (sizeMod1024==0 && ((isPowerOf2KB(size) && sizeMod1024 === 0) || (size === 3145728) || (size === 2097152) || (size === 4194304) || (size === 2621440) || (size === 1048576) || (size === 1179648) || (size === 2097152) || (size === 4194304) || (size === 6291456)  || (size == 1310720) || (size === 3145728) || (size === 1572864) || (size === 3276800) || (size === 2621440) || (size === 655360) || (size === 589824) ))  {
    return 'unheadered';
  } else if (sizeMod1024 === 512 && (isPowerOf2KB(size - 512) || (size === 6291968 || size === 3146240 || 0)  )) {
    return 'headered';
  } else {
    return 'exception';
  }
}

/**
 * Execute a command with spawn and timeout, ensuring the process is killed if it hangs
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
    
    const child = spawn(command, args, {
      ...options,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    // Collect stdout
    if (child.stdout) {
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (data) => {
        stdout += data;
      });
    }
    
    // Collect stderr
    if (child.stderr) {
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (data) => {
        stderr += data;
      });
    }
    
    // Set up timeout
    timeoutId = setTimeout(() => {
      if (!killed && !child.killed) {
        killed = true;
        console.warn(`[spawnWithTimeout] Process ${command} exceeded timeout of ${timeoutMs}ms, killing...`);
        
        // Try to kill the process
        try {
          // First, try graceful termination
          child.kill('SIGTERM');
          
          // If it doesn't die quickly, force kill
          const forceKillTimeout = setTimeout(() => {
            if (!child.killed) {
              console.warn(`[spawnWithTimeout] Process ${command} did not respond to SIGTERM, force killing with SIGKILL...`);
              try {
                child.kill('SIGKILL');
              } catch (forceKillError) {
                console.error(`[spawnWithTimeout] Error force killing process: ${forceKillError.message}`);
              }
            }
          }, 2000);
          
          // Clear the force kill timeout if process exits
          child.once('exit', () => {
            clearTimeout(forceKillTimeout);
          });
        } catch (killError) {
          console.error(`[spawnWithTimeout] Error killing process: ${killError.message}`);
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
      if (!killed) {
        reject(error);
      }
    });
  });
}

// Helper function to execute wine command
function executeWine(command, args, cwd) {
  const result = spawnSync('wine64', [command, ...args], {
    cwd: cwd || process.cwd(),
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe']
  });
  
  return {
    exitCode: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    output: result.output
  };
}

// Helper function to execute flips command
function executeFlips(args) {
  const result = spawnSync('flips', args, {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe']
  });
  
  return {
    exitCode: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    output: result.output
  };
}

// Helper function to append to log file
async function appendLog(message) {
  const logPath = 'output/log.txt';
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] ${message}\n`;
  await fs.appendFile(logPath, logEntry);
}

// Helper function to parse filename for metadata
function parseFilenameMetadata(filename) {
  const metadata = {
    title: null,
    author: null,
    series_name: null,
    entry_name: null,
    sequence_number: null,
    versioninfo: null,
    additional_version_info: null,
    date: null,
    language: null
  };
  
  if (!filename) return metadata;
  
  // Remove file extension
  let cleanName = filename.replace(/\.(sfc|7z|smc)$/i, '');
  
  // Extract date in brackets [YYYY-MM-DD] or [YYYY-YYYY] - remove it from processing
  const dateMatch = cleanName.match(/\[(\d{4}(?:-\d{2}-\d{2})?)\]/);
  if (dateMatch) {
    metadata.date = dateMatch[1];
    cleanName = cleanName.replace(/\[\d{4}(?:-\d{2}-\d{2})?\]/, '').trim();
  }
  
  // Remove (SMW Hack) or [BAD-emu] or [BAD] tags - these are not part of the title
  cleanName = cleanName.replace(/\(SMW\s+Hack\)/gi, '').trim();
  cleanName = cleanName.replace(/\[BAD(?:-emu)?\]/gi, '').trim();
  
  // Extract language in parentheses (English), (French), etc. - but not if it's part of version info
  // Language usually appears before "by" and after version info
  const languagePattern = /\(([A-Z][a-z]+)\)/g;
  const languageMatches = [];
  let match;
  while ((match = languagePattern.exec(cleanName)) !== null) {
    languageMatches.push(match);
  }
  // Find language that appears before "by" keyword
  for (const match of languageMatches) {
    const beforeBy = cleanName.substring(0, cleanName.indexOf(' by '));
    if (beforeBy.includes(match[0])) {
      // Check if it's not part of version info
      const commonLanguages = ['English', 'French', 'Spanish', 'German', 'Italian', 'Japanese', 'Portuguese'];
      if (commonLanguages.includes(match[1])) {
        metadata.language = match[1];
        cleanName = cleanName.replace(match[0], '').trim();
        break;
      }
    }
  }
  
  // Extract author - look for "by AuthorName" pattern
  // The author comes after "by" and before the date bracket or end
  const byIndex = cleanName.indexOf(' by ');
  if (byIndex !== -1) {
    const authorPart = cleanName.substring(byIndex + 4).trim();
    // Author ends at date bracket, or at end, or at another parenthetical that's not version info
    let authorStr = authorPart;
    
    // Remove date if present
    authorStr = authorStr.replace(/\[\d{4}(?:-\d{2}-\d{2})?\]/, '').trim();
    
    // Extract author - handle cases like "Author (Alias)" or "Author1 + Author2"
    // Take everything up to the first space followed by + or end
    const authorMatch = authorStr.match(/^([^+]+?)(?:\s*\+\s*|$)/);
    if (authorMatch) {
      authorStr = authorMatch[1].trim();
      // Extract alias if present: "Author (Alias)" -> prefer alias, otherwise use author
      const aliasMatch = authorStr.match(/^(.+?)\s*\(([^)]+)\)$/);
      if (aliasMatch) {
        // If alias looks like a name (not version info), use it
        const alias = aliasMatch[2];
        if (!/^(alt|Debug|God Mode|Fixed|New|Demo|Beta|Release|V\d)/i.test(alias)) {
          metadata.author = alias;
        } else {
          metadata.author = aliasMatch[1].trim();
        }
      } else {
        metadata.author = authorStr;
      }
    }
    
    // Title is everything before " by "
    const titlePart = cleanName.substring(0, byIndex).trim();
    
    // Extract version info from title part - look for patterns in parentheses
    const versionPatterns = [
      /\(Demo\s+(\d+)\)/i,  // (Demo 1), (Demo 2)
      /\(Demo(?:\s+V?\d+\.?\d*)?\)/i,  // (Demo), (Demo V1.0)
      /\(V\d+\.\d+\)/,  // (V1.0), (V1.3)
      /\(C3\s+(?:Demo|Release)\)/i,  // (C3 Demo), (C3 Release)
      /\(SoEN\s+Early\s+Beta\)/i,  // (SoEN Early Beta)
      /\(Early\s+Beta\)/i,  // (Early Beta)
      /\(Beta\)/i,  // (Beta)
      /\(Release\)/i,  // (Release)
      /\(World\s+\d+\s+Demo\)/i  // (World 1 Demo)
    ];
    
    for (const pattern of versionPatterns) {
      const match = titlePart.match(pattern);
      if (match) {
        metadata.versioninfo = match[0].replace(/[()]/g, '');
        break;
      }
    }
    
    // Extract additional version info - look for "(alt)", "(Debug)", "(God Mode)", "(Fixed)", "(New)"
    const additionalPatterns = [
      /\(alt\)/i,
      /\(Debug\)/i,
      /\(God\s+Mode\)/i,
      /\(Fixed\)/i,
      /\(New\)/i,
      /\(Canceled\)/i,
      /\(Pre-Beta\)/i,
      /\(Tech\s+Demo\)/i
    ];
    
    for (const pattern of additionalPatterns) {
      const match = titlePart.match(pattern);
      if (match) {
        metadata.additional_version_info = match[0].replace(/[()]/g, '');
        break;
      }
    }
    
    // Remove version info from title for processing
    let title = titlePart;
    if (metadata.versioninfo) {
      title = title.replace(`(${metadata.versioninfo})`, '').trim();
    }
    if (metadata.additional_version_info) {
      title = title.replace(`(${metadata.additional_version_info})`, '').trim();
    }
    if (metadata.language) {
      title = title.replace(`(${metadata.language})`, '').trim();
    }
    
    // Check for series pattern: "Series Name - Entry Name"
    const seriesMatch = title.match(/^(.+?)\s+-\s+(.+)$/);
    if (seriesMatch) {
      metadata.series_name = seriesMatch[1].trim();
      metadata.entry_name = seriesMatch[2].trim();
      metadata.title = title; // Full title
    } else {
      metadata.title = title;
    }
    
    // Extract sequence number - look for patterns like "#2", "#6", "Quest #2", or "Adventurer Mario 1"
    const sequencePatterns = [
      /#(\d+)/,  // #2, #6
      /\s+(\d+)\s*$/,  // "Adventurer Mario 1", "Adventurer Mario 2"
      /\s+(\d+)\s+-\s+/  // "Adventurer Mario 2 - The Time Travel"
    ];
    
    for (const pattern of sequencePatterns) {
      const match = title.match(pattern);
      if (match) {
        metadata.sequence_number = parseInt(match[1], 10);
        break;
      }
    }
  } else {
    // No "by" found - just extract what we can
    metadata.title = cleanName;
  }
  
  return metadata;
}

// Helper function to get 7z file metadata
async function get7zMetadata(archivePath, logCallback = null) {
  try {
    const result = execSync(`7z l -slt "${archivePath}"`, { encoding: 'utf8' });
    const lines = result.split('\n');
    
    if (logCallback) {
      logCallback(`7z l -slt output (full, ${lines.length} lines):\n${result}`);
    }
    
    const metadata = {
      content_filename: null,
      content_timestamp: null,
      content_attr: null,
      file_count: 0
    };
    
    const files = [];
    let currentFile = null;
    let inFileBlock = false;
    let isArchiveEntry = false;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      
      // Look for file block start - "Path = " indicates start of an entry
      if (trimmed.startsWith('Path = ')) {
        // If we had a previous file, save it (but only if it's not the archive entry)
        if (currentFile && currentFile.path && !isArchiveEntry) {
          files.push(currentFile);
          if (logCallback) {
            logCallback(`Saving file entry: ${currentFile.path}`);
          }
        }
        // Start new entry
        const pathValue = trimmed.replace('Path = ', '').trim();
        currentFile = {
          path: pathValue
        };
        inFileBlock = true;
        isArchiveEntry = false; // Reset flag, will be set if Type = 7z
        if (logCallback) {
          logCallback(`Found entry: Path = ${pathValue}`);
        }
        continue;
      }
      
      // If we're in a file block, collect metadata
      if (inFileBlock && currentFile) {
        if (trimmed.startsWith('Type = ')) {
          const typeValue = trimmed.replace('Type = ', '').trim();
          currentFile.type = typeValue;
          // If this is the archive itself (Type = 7z), mark it to skip
          if (typeValue === '7z') {
            isArchiveEntry = true;
            if (logCallback) {
              logCallback(`  Entry is archive itself (Type = 7z), will skip: ${currentFile.path}`);
            }
          }
        } else if (trimmed.startsWith('Modified = ')) {
          currentFile.modified = trimmed.replace('Modified = ', '').trim();
          if (logCallback) {
            logCallback(`  Modified = ${currentFile.modified}`);
          }
        } else if (trimmed.startsWith('Attributes = ')) {
          currentFile.attributes = trimmed.replace('Attributes = ', '').trim();
          if (logCallback) {
            logCallback(`  Attributes = ${currentFile.attributes}`);
          }
        } else if (trimmed.startsWith('Size = ')) {
          currentFile.size = trimmed.replace('Size = ', '').trim();
        } else if (trimmed.startsWith('----------')) {
          // Separator line - entry block is complete
          // Save the file if it's not the archive entry itself
          if (currentFile && currentFile.path && !isArchiveEntry) {
            files.push(currentFile);
            if (logCallback) {
              logCallback(`Entry block complete (saved): ${currentFile.path}`);
            }
          } else if (logCallback && isArchiveEntry) {
            logCallback(`Entry block complete (skipped archive entry): ${currentFile.path}`);
          }
          currentFile = null;
          inFileBlock = false;
          isArchiveEntry = false;
        } else if (trimmed === '') {
          // Empty line - might indicate end of block, but continue collecting
          // until we see separator or next Path
        }
      }
    }
    
    // Save the last file if we have one (and it's not the archive entry)
    if (currentFile && currentFile.path && !isArchiveEntry) {
      files.push(currentFile);
      if (logCallback) {
        logCallback(`Final entry (saved): ${currentFile.path}`);
      }
    } else if (logCallback && currentFile && isArchiveEntry) {
      logCallback(`Final entry (skipped archive entry): ${currentFile.path}`);
    }
    
    // Filter out directories (files with path ending in /) and archive entries
    const actualFiles = files.filter(f => {
      if (!f.path) return false;
      if (f.path.endsWith('/')) return false; // Directory
      if (f.type === '7z') return false; // Archive entry itself
      return true;
    });
    
    metadata.file_count = actualFiles.length;
    
    if (actualFiles.length > 0) {
      metadata.content_filename = actualFiles[0].path;
      metadata.content_timestamp = actualFiles[0].modified || null;
      metadata.content_attr = actualFiles[0].attributes || null;
    }
    
    if (logCallback) {
      logCallback(`Parsed 7z metadata: total_entries=${files.length}, actual_files=${actualFiles.length}, file_count=${metadata.file_count}`);
      logCallback(`First file: filename=${metadata.content_filename}, timestamp=${metadata.content_timestamp}, attr=${metadata.content_attr}`);
      if (files.length > 0) {
        logCallback(`All file paths: ${files.map(f => f.path).join(', ')}`);
      }
    }
    
    return metadata;
  } catch (error) {
    const errorMsg = `Failed to extract 7z metadata: ${error.message}`;
    if (logCallback) {
      logCallback(`ERROR: ${errorMsg}`);
      logCallback(`ERROR Stack: ${error.stack || 'N/A'}`);
    }
    throw new Error(errorMsg);
  }
}

// Helper function to extract and hash file from 7z
async function extractAndHash7zFile(archivePath) {
  try {
    // Extract to temp location
    const tempExtract = 'temp/extract_temp';
    await ensureDir(tempExtract);
    
    execSync(`7z x -y -o"${tempExtract}" "${archivePath}"`, { stdio: 'pipe' });
    
    // Find the extracted file
    const files = await fs.readdir(tempExtract);
    if (files.length !== 1) {
      throw new Error(`Expected 1 file in archive, found ${files.length}`);
    }
    
    const extractedFile = path.join(tempExtract, files[0]);
    const hash = await calculateSHA256(extractedFile);
    
    // Cleanup
    await fs.unlink(extractedFile);
    await fs.rmdir(tempExtract);
    
    return hash;
  } catch (error) {
    throw new Error(`Failed to extract and hash 7z file: ${error.message}`);
  }
}

// Main processing function
async function processROM(sfcsourceFilename, sfcarchiveFilename) {
  let lockFd = null;
  let lockAcquired = false;
  
  // Set up exit handlers to ensure lock is released
  const cleanup = async () => {
    if (lockAcquired && lockFd) {
      try {
        await releaseLock(lockFd, LOCK_FILE);
        lockAcquired = false;
      } catch (e) {
        // Ignore cleanup errors
      }
    }
  };
  
  // Synchronous cleanup for exit handler (exit doesn't support async)
  const cleanupSync = () => {
    if (lockAcquired && lockFd) {
      try {
        lockFd.closeSync();
        fsSync.unlinkSync(LOCK_FILE);
        lockAcquired = false;
      } catch (e) {
        // Ignore cleanup errors
      }
    }
  };
  
  process.on('SIGINT', async () => {
    await cleanup();
    process.exit(130); // Standard exit code for SIGINT
  });
  
  process.on('SIGTERM', async () => {
    await cleanup();
    process.exit(143); // Standard exit code for SIGTERM
  });
  
  process.on('exit', () => {
    cleanupSync();
  });
  
  process.on('uncaughtException', async (error) => {
    await cleanup();
    console.error('Uncaught Exception:', error);
    process.exit(1);
  });
  
  process.on('unhandledRejection', async (reason, promise) => {
    await cleanup();
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
  });
  
  try {
    // Step 1: Ensure directories exist
    console.log('Step 1: Creating directories...');
    await ensureDir('done');
    await ensureDir('output');
    await ensureDir('error');
    await ensureDir('temp');
    
    // Step 2: Copy source to temp and acquire lock
    console.log('Step 2: Copying source and acquiring lock...');
    //await fs.copyFile(sfcsourceFilename, 'temp/source.sfc');
    lockFd = await acquireLock(LOCK_FILE);
    lockAcquired = true;
    console.log('Lock acquired');
    await fs.copyFile(sfcsourceFilename, 'temp/source.sfc');
    
    // Step 3: Clean up existing temp files
    console.log('Step 3: Cleaning up temp files...');
    try {
      await fs.unlink('temp/source.sfc');
    } catch (e) {
      // Ignore if doesn't exist
    }
    try {
      await fs.unlink('temp/source.7z');
    } catch (e) {
      // Ignore if doesn't exist
    }
    
    // Step 4: Copy archive if specified
    if (sfcarchiveFilename) {
      console.log('Step 4: Copying archive...');
      await fs.copyFile(sfcarchiveFilename, 'temp/source.7z');
    }
    
    // Step 5: Copy source
    console.log('Step 5: Copying source file...');
    await fs.copyFile(sfcsourceFilename, 'temp/source.sfc');
    
    // Step 6: Check ROM type
    console.log('Step 6: Determining ROM type...');
    const romType = await determineROMType('temp/source.sfc');
    
    if (romType === 'exception') {
      const stats = await fs.stat('temp/source.sfc');
      const errorMsg = `ROM file size exception: ${stats.size} bytes (not a valid SNES ROM size)`;
      await appendLog(errorMsg);
      console.error(errorMsg);
      cleanupSync();
      process.exit(1);
    }
    
    console.log(`ROM type: ${romType}`);
    
    // Step 7: Process ROM header
    console.log('Step 7: Processing ROM header...');
    let sourceUnhPath = 'temp/source_unh.sfc';
    let sourceHdrPath = 'temp/source_hdr.smc';
    let sourceRehdrPath = null;
    
    if (romType === 'unheadered') {
      // 7.A: Unheadered ROM - add header
      console.log('  Adding header to unheadered ROM...');
      await fs.copyFile('temp/source.sfc', './source_temp_hdr.smc');
      
      const wineResult = executeWine(SNESHEADER_EXE, ['source_temp_hdr.smc', '1'], process.cwd());
      
      if (wineResult.exitCode === 1) {
        await fs.unlink('./source_temp_hdr.smc');
        const errorMsg = `snesheader.exe failed to add header: ${wineResult.stderr}`;
        await appendLog(errorMsg);
        console.error(errorMsg);
        cleanupSync();
        process.exit(1);
      }
      
      await fs.rename('temp/source.sfc', 'temp/source_unh.sfc');
      await fs.rename('./source_temp_hdr.smc', 'temp/source_hdr.smc');
      
    } else if (romType === 'headered') {
      // 7.B: Headered ROM - remove header, then re-add
      console.log('  Removing header from headered ROM...');
      await fs.copyFile('temp/source.sfc', './source_temp_unhdr.sfc');
      
      const wineResult1 = executeWine(SNESHEADER_EXE, ['source_temp_unhdr.sfc', '0'], process.cwd());
      
      if (wineResult1.exitCode === 1) {
        await fs.unlink('./source_temp_unhdr.sfc');
        const errorMsg = `snesheader.exe failed to remove header: ${wineResult1.stderr}`;
        await appendLog(errorMsg);
        console.error(errorMsg);
         cleanupSync();
        process.exit(1);
      }
      
      await fs.rename('temp/source.sfc', 'temp/source_hdr.smc');
      await fs.rename('./source_temp_unhdr.sfc', 'temp/source_unh.sfc');
      
      // Now re-add header to create standardized version
      console.log('  Re-adding header to create standardized version...');
      await fs.copyFile('temp/source_unh.sfc', './source_temp_hdr2.smc');
      
      const wineResult2 = executeWine(SNESHEADER_EXE, ['source_temp_hdr2.smc', '1'], process.cwd());
      
      if (wineResult2.exitCode === 1) {
        await fs.unlink('./source_temp_hdr2.smc');
        const errorMsg = `snesheader.exe failed to re-add header: ${wineResult2.stderr}`;
        await appendLog(errorMsg);
        console.error(errorMsg);
         cleanupSync();
        process.exit(1);
      }
      
      await fs.rename('./source_temp_hdr2.smc', 'temp/source_rehdr.smc');
      sourceRehdrPath = 'temp/source_rehdr.smc';
    }
    
    // Step 8: Calculate hashes
    console.log('Step 8: Calculating hashes...');
    const sfc_rom_sha1_hash = await calculateSHA1('temp/source_unh.sfc');
    const smc_rom_sha1_hash = await calculateSHA1('temp/source_hdr.smc');
    const sfc_rom_sha256_hash = await calculateSHA256('temp/source_unh.sfc');
    const sfc_rom_size = await calculateFileSize('temp/source_unh.sfc');
    
    let smc2_rom_sha1_hash;
    let smc2_rom_sha256_hash;
    
    if (sourceRehdrPath) {
      try {
        await fs.access(sourceRehdrPath);
        smc2_rom_sha1_hash = await calculateSHA1(sourceRehdrPath);
        smc2_rom_sha256_hash = await calculateSHA256(sourceRehdrPath);
      } catch (e) {
        smc2_rom_sha1_hash = await calculateSHA1('temp/source_hdr.smc');
        smc2_rom_sha256_hash = await calculateSHA256('temp/source_hdr.smc');
      }
    } else {
      smc2_rom_sha1_hash = await calculateSHA1('temp/source_hdr.smc');
      smc2_rom_sha256_hash = await calculateSHA256('temp/source_hdr.smc');
    }
    
    console.log(`  SFC SIZE: ${sfc_rom_size}`);
    console.log(`  SFC SHA1: ${sfc_rom_sha1_hash}`);
    console.log(`  SMC SHA1: ${smc_rom_sha1_hash}`);
    console.log(`  SMC2 SHA1: ${smc2_rom_sha1_hash}`);
    
    // Step 9: Create BPS patch
    console.log('Step 9: Creating BPS patch...');
    const bpsPath = `temp/${sfc_rom_sha1_hash}.bps`;
    const flipsResult = executeFlips(['--create', '--bps', SMW_BASE_ROM, 'temp/source_unh.sfc', bpsPath]);
    
    if (flipsResult.exitCode === 1) {
      const errorMsg = `flips failed to create BPS patch: ${flipsResult.stderr}`;
      await appendLog(errorMsg);
      console.error(errorMsg);
      cleanupSync();
      process.exit(1);
    }
    
    const bpsFilename = path.basename(bpsPath);
    console.log(`  BPS patch created: ${bpsFilename}`);

    var bps_sha1_hash = await calculateSHA1(bpsPath);
    var bps_sha256_hash = await calculateSHA256(bpsPath);


    
    // Step 10: Run level_reader program
    console.log('Step 10: Running level_reader...');
    const levelreadOutputPath = `temp/${sfc_rom_sha1_hash}_levelread.json`;
    try {
      const levelReaderPath =  process.env.LEVEL_READER || path.join(process.env.HOME || '/home/me', 'smwdb', 'level_reader');
      await appendLog(`[Step 10] Running: ${levelReaderPath} temp/source_unh.sfc > ${levelreadOutputPath}`);
      const levelreadResult = spawnSync(levelReaderPath, ['temp/source_unh.sfc'], {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe']
      });
      
      if (levelreadResult.status === 0) {
        await fs.writeFile(levelreadOutputPath, levelreadResult.stdout);
        await fs.rename(levelreadOutputPath, `output/${path.basename(levelreadOutputPath)}`);
        await appendLog(`[Step 10] SUCCESS: level_reader completed, output saved to output/${path.basename(levelreadOutputPath)}`);
        console.log(`  level_reader output saved: ${path.basename(levelreadOutputPath)}`);
      } else {
        await appendLog(`[Step 10] WARNING: level_reader exited with status ${levelreadResult.status}: ${levelreadResult.stderr || levelreadResult.stdout}`);
        console.warn(`  level_reader exited with status ${levelreadResult.status}`);
      }
    } catch (error) {
      await appendLog(`[Step 10] ERROR: level_reader failed: ${error.message}`);
      console.warn(`  Warning: level_reader failed: ${error.message}`);
    }
    
    // Step 10.5: Run try_lmfilter.py
    console.log('Step 10.5: Running try_lmfilter.py...');
    try {
      const env = {
        ...process.env,
        GAMETAG: sfc_rom_sha1_hash,
        GAMEVER: '1',
        ROMFILE: 'temp/source_unh.sfc'
      };
      
      await appendLog(`[Step 10.5] Running: python3 try_lmfilter.py (GAMETAG=${sfc_rom_sha1_hash}, GAMEVER=1, ROMFILE=temp/source_unh.sfc)`);
      
      // Use spawnWithTimeout to prevent hanging - 20 second timeout with 2 second kill grace period
      const lmfilterResult = await spawnWithTimeout(
        '/usr/bin/python3',
        ['try_lmfilter.py'],
        {
          env: env,
          cwd: process.cwd()
        },
        20000 // 20 second timeout
      );
      
      await appendLog('finish spawnWithTimeout:');
      await appendLog(lmfilterResult.stdout || '');
      await appendLog(lmfilterResult.stderr || '');
      
      if (lmfilterResult.status === 0) {
        const lmfilterOutputPath = `output/${sfc_rom_sha1_hash}_lmfilter.json`;
        try {
          await fs.copyFile('temp/temp.json', lmfilterOutputPath);
          await appendLog(`[Step 10.5] SUCCESS: try_lmfilter.py completed, output saved to ${lmfilterOutputPath}`);
          console.log(`  try_lmfilter.py output saved: ${path.basename(lmfilterOutputPath)}`);
          await fs.unlink('temp/temp.json');
        } catch (copyError) {
          await appendLog(`[Step 10.5] WARNING: Could not copy temp/temp.json: ${copyError.message}`);
          console.warn(`  Warning: Could not copy temp/temp.json: ${copyError.message}`);
        }
      } else {
        await appendLog(`[Step 10.5] WARNING: try_lmfilter.py exited with status ${lmfilterResult.status}: ${lmfilterResult.stderr || lmfilterResult.stdout}`);
        console.warn(`  try_lmfilter.py exited with status ${lmfilterResult.status}`);
      }
    } catch (error) {
      // Handle timeout and other errors
      const errorMsg = error.message || String(error);
      await appendLog(`[Step 10.5] ERROR: try_lmfilter.py failed: ${errorMsg}`);
      console.warn(`  Warning: try_lmfilter.py failed: ${errorMsg}`);
      
      // If it was a timeout, log additional info
      if (errorMsg.includes('exceeded timeout')) {
        await appendLog(`[Step 10.5] The process was killed due to timeout. This may indicate a hang in try_lmfilter.py.`);
        console.warn(`  try_lmfilter.py was killed due to timeout - process may have hung`);
      }
    }
    
    // Step 10.6: Run find_translevels.py
    console.log('Step 10.6: Running find_translevels.py...');
    try {
      const translevelsOutputPath = `temp/${sfc_rom_sha1_hash}_translevel.json`;
      const translevelsFinalPath = `output/${sfc_rom_sha1_hash}_translevel.json`;
      await appendLog(`[Step 10.6] Running: python3 findtranslevels/find_translevels.py --romfile=temp/source_unh.sfc --output=${translevelsOutputPath}`);
      const translevelsResult = spawnSync('python3', ['findtranslevels/find_translevels.py', '--romfile=temp/source_unh.sfc', `--output=${translevelsOutputPath}`], {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: process.cwd()
      });
      
      if (translevelsResult.status === 0) {
        await fs.rename(translevelsOutputPath, translevelsFinalPath);
        await appendLog(`[Step 10.6] SUCCESS: find_translevels.py completed, output saved to ${translevelsFinalPath}`);
        console.log(`  find_translevels.py output saved: ${path.basename(translevelsFinalPath)}`);
      } else {
        await appendLog(`[Step 10.6] WARNING: find_translevels.py exited with status ${translevelsResult.status}: ${translevelsResult.stderr || translevelsResult.stdout}`);
        console.warn(`  find_translevels.py exited with status ${translevelsResult.status}`);
      }
    } catch (error) {
      await appendLog(`[Step 10.6] ERROR: find_translevels.py failed: ${error.message}`);
      console.warn(`  Warning: find_translevels.py failed: ${error.message}`);
    }
    
    // Step 11: Create metadata JSON
    console.log('Step 11: Creating metadata JSON...');
    const metadata = {
      sfcsource_filename: path.basename(sfcsourceFilename),
      sfcarchive_filename: sfcarchiveFilename ? path.basename(sfcarchiveFilename) : null,
      sfc_rom_sha1_hash,
      smc_rom_sha1_hash,
      sfc_rom_sha256_hash,
      smc2_rom_sha1_hash,
      smc2_rom_sha256_hash,
      bps_filename: bpsFilename,
      bps_sha1_hash,
      bps_sha256_hash,
      sfc_rom_size: sfc_rom_size
    };
    
    // Parse filename metadata
    const sfcMetadata = parseFilenameMetadata(path.basename(sfcsourceFilename));
    const archiveMetadata = sfcarchiveFilename ? parseFilenameMetadata(path.basename(sfcarchiveFilename)) : null;
    
    // Add SFC filename attributes
    for (const [key, value] of Object.entries(sfcMetadata)) {
      if (value !== null) {
        metadata[`sfc_filename_${key}`] = value;
      }
    }
    
    // Add 7z filename attributes
    if (archiveMetadata) {
      for (const [key, value] of Object.entries(archiveMetadata)) {
        if (value !== null) {
          metadata[`7z_filename_${key}`] = value;
        }
      }
    }
    
    // Get file timestamps and parent directory name
    const sfcStats = await fs.stat(sfcsourceFilename);
    metadata.sfc_upload_estimate = sfcStats.mtime.toISOString();
    
    const sfcDir = path.dirname(path.resolve(sfcsourceFilename));
    const dirStats = await fs.stat(sfcDir);
    metadata.dir_upload_estimate = dirStats.mtime.toISOString();
    metadata.sfc_parent_directory = path.basename(sfcDir);
    
    // Add parent directory for archive if specified
    if (sfcarchiveFilename) {
      const archiveDir = path.dirname(path.resolve(sfcarchiveFilename));
      metadata['7z_parent_directory'] = path.basename(archiveDir);
    }
    
    // Get 7z metadata if archive specified
    if (sfcarchiveFilename) {
      const archiveStats = await fs.stat(sfcarchiveFilename);
      metadata['7z_upload_estimate'] = archiveStats.mtime.toISOString();
      
      try {
        const archiveMetadata = await get7zMetadata('temp/source.7z');
        if (archiveMetadata.content_filename) {
          metadata['7z_content_filename'] = archiveMetadata.content_filename;
        }
        if (archiveMetadata.content_timestamp) {
          metadata['7z_content_timestamp'] = archiveMetadata.content_timestamp;
        }
        if (archiveMetadata.content_attr) {
          metadata['7z_content_attr'] = archiveMetadata.content_attr;
        }
      } catch (error) {
        console.warn(`Warning: Could not extract 7z metadata: ${error.message}`);
      }
    }
    
    // Write metadata JSON
    const metadataPath = `temp/${sfc_rom_sha1_hash}.json`;
    await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
    console.log(`  Metadata JSON created: ${path.basename(metadataPath)}`);
    
    // Step 12: Verify and move archive if specified
    if (sfcarchiveFilename) {
      console.log('Step 12: Verifying archive...');
      await appendLog(`[Step 12] Starting archive verification for: ${path.basename(sfcarchiveFilename)}`);
      try {
        // Create log callback for 7z debugging
        const log7zDebug = async (message) => {
          await appendLog(`[7z Debug] ${message}`);
        };
        
        await appendLog(`[Step 12] Running: 7z l -slt on temp/source.7z`);
        const archiveMetadata = await get7zMetadata('temp/source.7z', log7zDebug);
        
        await appendLog(`[Step 12] Archive verification result: file_count=${archiveMetadata.file_count}, content_filename=${archiveMetadata.content_filename || 'null'}`);
        await appendLog(`[Step 12] Archive metadata: timestamp=${archiveMetadata.content_timestamp || 'null'}, attr=${archiveMetadata.content_attr || 'null'}`);
        
        if (archiveMetadata.file_count !== 1) {
          const errorMsg = `Archive contains ${archiveMetadata.file_count} files (expected 1), moving to error/`;
          console.log(`  ${errorMsg}`);
          await appendLog(`[Step 12] ERROR: ${errorMsg}`);
          await fs.rename(sfcarchiveFilename, `error/${path.basename(sfcarchiveFilename)}`);
        } else {
          await appendLog('[Step 12] Archive file count verified (1 file), proceeding with hash verification...');
          await appendLog('[Step 12] Extracting and hashing file from archive...');
          const archiveHash = await extractAndHash7zFile('temp/source.7z');
          await appendLog(`[Step 12] Archive file SHA256: ${archiveHash}`);
          await appendLog(`[Step 12] Expected SHA256 (sfc_unh): ${sfc_rom_sha256_hash}`);
          await appendLog(`[Step 12] Expected SHA256 (smc2): ${smc2_rom_sha256_hash}`);
          
          if (archiveHash === sfc_rom_sha256_hash || archiveHash === smc2_rom_sha256_hash) {
            console.log('  Archive verified, moving to done/');
            await appendLog('[Step 12] SUCCESS: Archive hash verified successfully, moving to done/');
            await fs.rename(sfcarchiveFilename, `done/${path.basename(sfcarchiveFilename)}`);
          } else {
            const errorMsg = `Archive hash mismatch (got ${archiveHash}, expected ${sfc_rom_sha256_hash} or ${smc2_rom_sha256_hash}), moving to error/`;
            console.log(`  ${errorMsg}`);
            await appendLog(`[Step 12] ERROR: ${errorMsg}`);
            await fs.rename(sfcarchiveFilename, `error/${path.basename(sfcarchiveFilename)}`);
          }
        }
      } catch (error) {
        const errorMsg = `Could not verify archive: ${error.message}, moving to error/`;
        console.warn(`Warning: ${errorMsg}`);
        await appendLog(`[Step 12] EXCEPTION: ${errorMsg}`);
        await appendLog(`[Step 12] Exception Stack: ${error.stack || 'N/A'}`);
        try {
          await fs.rename(sfcarchiveFilename, `error/${path.basename(sfcarchiveFilename)}`);
        } catch (renameError) {
          await appendLog(`[Step 12] Failed to move archive to error/: ${renameError.message}`);
        }
      }
    }
    
    // Step 13: Move output files
    console.log('Step 13: Moving output files...');
    await fs.rename(bpsPath, `output/${bpsFilename}`);
    await fs.rename(metadataPath, `output/${path.basename(metadataPath)}`);
    
    // Step 14: Move source to done and log success
    console.log('Step 14: Finalizing...');
    await fs.rename(sfcsourceFilename, `done/${path.basename(sfcsourceFilename)}`);
    
    const successMsg = `Successfully processed: ${path.basename(sfcsourceFilename)} -> ${bpsFilename}`;
    await appendLog(successMsg);
    console.log(successMsg);
    
    // Cleanup lock
    await releaseLock(lockFd, LOCK_FILE);
    lockAcquired = false;
    
    process.exit(0);
    
  } catch (error) {
    console.error(`Error: ${error.message}`);
    
    // Cleanup lock on error
    await releaseLock(lockFd, LOCK_FILE);
    lockAcquired = false;
    
    await appendLog(`Error: ${error.message}`);
    process.exit(1);
  }
}

// Main entry point
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log(`
Usage: node process_arcsfc.js <sfcsource_filename> [sfcarchive_filename]

Process SNES ROM files and create BPS patches.

Arguments:
  sfcsource_filename    Required. Path to the source .sfc ROM file
  sfcarchive_filename   Optional. Path to the .7z archive file

This script:
  - Detects whether ROM is headered or unheadered
  - Standardizes ROM headers using snesheader.exe via wine
  - Calculates SHA1 and SHA256 hashes
  - Creates BPS patches against /home/me/smwdb/smw.sfc
  - Extracts metadata from filenames
  - Verifies archive contents if archive is provided
  - Moves processed files to done/ directory
  - Moves output files (BPS and JSON) to output/ directory

Requirements:
  - Linux platform
  - Wine installed
  - K:\\snesheader.exe available via wine
  - flips utility in PATH
  - 7z utility in PATH

The script must be run from a subdirectory of /home/me/smwdb/

Examples:
  node process_arcsfc.js example.sfc example.7z
  node process_arcsfc.js game.sfc
`);
    process.exit(0);
  }
  
  const sfcsourceFilename = args[0];
  const sfcarchiveFilename = args[1] || null;
  
  // Validate source file exists
  try {
    await fs.access(sfcsourceFilename);
  } catch (e) {
    console.error(`Error: Source file not found: ${sfcsourceFilename}`);
    process.exit(1);
  }
  
  // Validate archive file if specified
  if (sfcarchiveFilename) {
    try {
      await fs.access(sfcarchiveFilename);
    } catch (e) {
      console.error(`Error: Archive file not found: ${sfcarchiveFilename}`);
      process.exit(1);
    }
  }
  
  // Run processing
  try {
    await processROM(sfcsourceFilename, sfcarchiveFilename);
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

module.exports = { processROM, parseFilenameMetadata };
