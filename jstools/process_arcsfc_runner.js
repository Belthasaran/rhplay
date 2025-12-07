#!/usr/bin/env node

/**
 * process_arcsfc_runner.js - Batch runner for process_arcsfc.js
 * 
 * Usage:
 *   node process_arcsfc_runner.js
 *   node process_arcsfc_runner.js --help
 * 
 * This script scans the current working directory for .sfc files that have
 * matching .7z archive files (same name, different extension) and runs
 * process_arcsfc.js for each pair sequentially.
 * 
 * All output (stdout and stderr) is captured and appended to output/log2.txt
 */

const fs = require('fs').promises;
const path = require('path');
const { spawnSync } = require('child_process');

const PROCESS_ARCSFC_SCRIPT = path.join(__dirname, 'process_arcsfc.js');
const LOG_FILE = 'output/log2.txt';

// Helper function to ensure output directory exists
async function ensureOutputDir() {
  try {
    await fs.mkdir('output', { recursive: true });
  } catch (error) {
    if (error.code !== 'EEXIST') {
      throw error;
    }
  }
}

// Helper function to append to log file
async function appendLog(message) {
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] ${message}\n`;
  await fs.appendFile(LOG_FILE, logEntry);
}

// Helper function to find matching .sfc and .7z files
async function findMatchingPairs() {
  try {
    const files = await fs.readdir('.');
    const sfcFiles = files.filter(f => /\.sfc$/i.test(f));
    const pairs = [];
    
    for (const sfcFile of sfcFiles) {
      // Get base name without extension
      const baseName = path.basename(sfcFile, path.extname(sfcFile));
      // Look for matching .7z file
      const archiveFile = files.find(f => {
        const fBase = path.basename(f, path.extname(f));
        return fBase === baseName && /\.7z$/i.test(f);
      });
      
      if (archiveFile) {
        pairs.push({
          sfc: sfcFile,
          archive: archiveFile
        });
      }
    }
    
    return pairs;
  } catch (error) {
    throw new Error(`Failed to scan directory: ${error.message}`);
  }
}

// Helper function to run process_arcsfc.js for a file pair
async function runProcessArcsfc(sfcFile, archiveFile) {
  await appendLog(`\n=== Processing pair: ${sfcFile} + ${archiveFile} ===\n`);
  
  // Use spawnSync with array of arguments to avoid shell expansion
  // This ensures special characters in filenames are handled correctly
  const result = spawnSync('node', [PROCESS_ARCSFC_SCRIPT, sfcFile, archiveFile], {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd: process.cwd()
  });
  
  // Log the command that was run
  await appendLog(`Command: node ${PROCESS_ARCSFC_SCRIPT} "${sfcFile}" "${archiveFile}"`);
  await appendLog(`Exit code: ${result.status || 0}\n`);
  
  // Log stdout if present
  if (result.stdout) {
    await appendLog('--- STDOUT ---');
    await appendLog(result.stdout);
    await appendLog('--- END STDOUT ---\n');
  }
  
  // Log stderr if present
  if (result.stderr) {
    await appendLog('--- STDERR ---');
    await appendLog(result.stderr);
    await appendLog('--- END STDERR ---\n');
  }
  
  // Log output if present (combined)
  if (result.output) {
    const output = result.output.filter(Boolean).join('\n');
    if (output && output !== result.stdout && output !== result.stderr) {
      await appendLog('--- OUTPUT ---');
      await appendLog(output);
      await appendLog('--- END OUTPUT ---\n');
    }
  }
  
  await appendLog(`=== Finished processing: ${sfcFile} + ${archiveFile} (exit code: ${result.status || 0}) ===\n`);
  
  return result.status || 0;
}

// Main function
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length > 0 && (args[0] === '--help' || args[0] === '-h')) {
    console.log(`
Usage: node process_arcsfc_runner.js

Scans the current working directory for .sfc files that have matching .7z
archive files (same base name, different extension) and runs process_arcsfc.js
for each pair sequentially.

All output (stdout and stderr) from each run is captured and appended to
output/log2.txt with timestamps.

The script processes files in the order they are found, one pair at a time.
Special characters in filenames are handled correctly by passing arguments
directly to Node.js without shell expansion.

Examples:
  cd /path/to/roms
  node ~/rhplay/jstools/process_arcsfc_runner.js
`);
    process.exit(0);
  }
  
  try {
    // Ensure output directory exists
    await ensureOutputDir();
    
    // Log start
    await appendLog('='.repeat(80));
    await appendLog(`process_arcsfc_runner.js started`);
    await appendLog(`Working directory: ${process.cwd()}`);
    await appendLog(`Script path: ${PROCESS_ARCSFC_SCRIPT}`);
    await appendLog('='.repeat(80) + '\n');
    
    // Find matching pairs
    console.log('Scanning for matching .sfc and .7z file pairs...');
    const pairs = await findMatchingPairs();
    
    if (pairs.length === 0) {
      await appendLog('No matching .sfc/.7z file pairs found in current directory.\n');
      console.log('No matching file pairs found.');
      process.exit(0);
    }
    
    await appendLog(`Found ${pairs.length} matching file pair(s):\n`);
    pairs.forEach((pair, index) => {
      console.log(`  ${index + 1}. ${pair.sfc} + ${pair.archive}`);
      appendLog(`  ${index + 1}. ${pair.sfc} + ${pair.archive}`);
    });
    await appendLog('\n');
    
    // Process each pair sequentially
    let successCount = 0;
    let failureCount = 0;
    
    for (let i = 0; i < pairs.length; i++) {
      const pair = pairs[i];
      console.log(`\n[${i + 1}/${pairs.length}] Processing: ${pair.sfc} + ${pair.archive}`);
      
      const exitCode = await runProcessArcsfc(pair.sfc, pair.archive);
      
      if (exitCode === 0) {
        successCount++;
        console.log(`  ✓ Success (exit code: ${exitCode})`);
      } else {
        failureCount++;
        console.log(`  ✗ Failed (exit code: ${exitCode})`);
      }
    }
    
    // Log summary
    await appendLog('\n' + '='.repeat(80));
    await appendLog(`Summary: ${pairs.length} pair(s) processed`);
    await appendLog(`  Success: ${successCount}`);
    await appendLog(`  Failed: ${failureCount}`);
    await appendLog('='.repeat(80) + '\n');
    
    console.log(`\nCompleted: ${successCount} succeeded, ${failureCount} failed`);
    
    // Exit with non-zero if any failed
    process.exit(failureCount > 0 ? 1 : 0);
    
  } catch (error) {
    const errorMsg = `Fatal error: ${error.message}`;
    console.error(errorMsg);
    await appendLog(`\nFATAL ERROR: ${errorMsg}\n`);
    await appendLog(`Stack: ${error.stack || 'N/A'}\n`);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(`Fatal error: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { findMatchingPairs, runProcessArcsfc };
