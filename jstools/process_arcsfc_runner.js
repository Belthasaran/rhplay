#!/usr/bin/env node

/**
 * process_arcsfc_runner.js - Batch runner for process_arcsfc.js
 * 
 * Usage:
 *   node process_arcsfc_runner.js
 *   node process_arcsfc_runner.js --help
 * 
 * This script scans the current working directory for .sfc files that have
 * matching .7z archives (same base name) and processes them sequentially using
 * process_arcsfc.js.
 * 
 * Features:
 * - Handles special characters in filenames correctly (no shell expansion)
 * - Sequential processing to avoid file lock conflicts
 * - Comprehensive logging of all operations
 * - Summary report at the end
 */

const fs = require('fs').promises;
const path = require('path');
const { spawnSync } = require('child_process');

const PROCESS_SCRIPT = path.join(__dirname, 'process_arcsfc.js');
const LOG_FILE = 'output/log2.txt';

// Helper function to append to log file
async function appendLog(message) {
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] ${message}\n`;
  try {
    await fs.appendFile(LOG_FILE, logEntry);
  } catch (error) {
    // If log file doesn't exist, try to create directory first
    try {
      await fs.mkdir('output', { recursive: true });
      await fs.appendFile(LOG_FILE, logEntry);
    } catch (e) {
      console.error(`Failed to write to log file: ${e.message}`);
      console.log(message); // Fallback to console
    }
  }
}

// Helper function to get base name without extension
function getBaseName(filename) {
  const ext = path.extname(filename);
  return filename.slice(0, -(ext.length));
}

// Helper function to find matching file pairs
async function findMatchingPairs() {
  try {
    const files = await fs.readdir('.');
    const sfcFiles = files.filter(f => /\.sfc$/i.test(f));
    const archiveFiles = new Set(files.filter(f => /\.7z$/i.test(f)).map(f => getBaseName(f)));
    
    const pairs = [];
    
    for (const sfcFile of sfcFiles) {
      const baseName = getBaseName(sfcFile);
      if (archiveFiles.has(baseName)) {
        // Find the matching .7z file
        const archiveFile = files.find(f => 
          /\.7z$/i.test(f) && getBaseName(f) === baseName
        );
        if (archiveFile) {
          pairs.push({
            sfc: sfcFile,
            archive: archiveFile
          });
        }
      }
    }
    
    return pairs;
  } catch (error) {
    throw new Error(`Failed to scan directory: ${error.message}`);
  }
}

// Helper function to execute process_arcsfc.js
async function processPair(sfcFile, archiveFile) {
  await appendLog(`\n${'='.repeat(80)}`);
  await appendLog(`Processing pair: ${sfcFile} + ${archiveFile}`);
  await appendLog(`${'='.repeat(80)}`);
  
  const command = 'node';
  const args = [PROCESS_SCRIPT, sfcFile, archiveFile];
  
  await appendLog(`Command: ${command} ${args.join(' ')}`);
  
  // Use spawnSync to avoid shell expansion - this handles special characters correctly
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd: process.cwd(),
    maxBuffer: 1024 * 1024 * 100
  });
  
  // Log stdout
  if (result.stdout) {
    await appendLog(`\n--- STDOUT ---`);
    await appendLog(result.stdout);
  }
  
  // Log stderr
  if (result.stderr) {
    await appendLog(`\n--- STDERR ---`);
    await appendLog(result.stderr);
  }
  
  // Log exit code
  const exitCode = result.status !== null ? result.status : -1;
  await appendLog(`\n--- EXIT CODE: ${exitCode} ---`);
  
  return {
    sfcFile,
    archiveFile,
    exitCode,
    stdout: result.stdout || '',
    stderr: result.stderr || ''
  };
}

// Main function
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length > 0 && (args[0] === '--help' || args[0] === '-h')) {
    console.log(`
Usage: node process_arcsfc_runner.js

Batch runner for process_arcsfc.js that processes matching .sfc/.7z file pairs.

This script:
  - Scans the current working directory for .sfc files
  - For each .sfc file, looks for a matching .7z archive (same base name)
  - Runs process_arcsfc.js for each matching pair sequentially
  - Captures all stdout and stderr from each run
  - Appends all output to output/log2.txt with timestamps
  - Processes files one at a time to avoid conflicts

Features:
  - Handles special characters in filenames correctly (no shell expansion)
  - Sequential processing to avoid file lock conflicts
  - Comprehensive logging of all operations
  - Summary report at the end

Output:
  - All processing results appended to output/log2.txt
  - Each run includes command, exit code, stdout, and stderr
  - Summary statistics at the end

Examples:
  # Run from a directory containing .sfc and .7z files
  cd /path/to/roms
  node ~/rhplay/jstools/process_arcsfc_runner.js

Note: This script is designed to work with process_arcsfc.js and must be run
from a directory where both .sfc and .7z files are present.
`);
    process.exit(0);
  }
  
  try {
    // Ensure output directory exists
    await fs.mkdir('output', { recursive: true });
    
    await appendLog(`\n${'='.repeat(80)}`);
    await appendLog(`process_arcsfc_runner.js started`);
    await appendLog(`Working directory: ${process.cwd()}`);
    await appendLog(`Process script: ${PROCESS_SCRIPT}`);
    await appendLog(`${'='.repeat(80)}\n`);
    
    // Find matching pairs
    console.log('Scanning for matching .sfc/.7z file pairs...');
    const pairs = await findMatchingPairs();
    
    if (pairs.length === 0) {
      await appendLog('No matching .sfc/.7z file pairs found.');
      console.log('No matching .sfc/.7z file pairs found.');
      process.exit(0);
    }
    
    await appendLog(`Found ${pairs.length} matching file pair(s):`);
    for (let i = 0; i < pairs.length; i++) {
      const pair = pairs[i];
      console.log(`  ${i + 1}. ${pair.sfc} + ${pair.archive}`);
      await appendLog(`  ${i + 1}. ${pair.sfc} + ${pair.archive}`);
    }
    await appendLog('');
    
    // Process each pair sequentially
    const results = [];
    for (let i = 0; i < pairs.length; i++) {
      const pair = pairs[i];
      console.log(`\n[${i + 1}/${pairs.length}] Processing: ${pair.sfc} + ${pair.archive}`);
      
      const result = await processPair(pair.sfc, pair.archive);
      results.push(result);
      
      if (result.exitCode === 0) {
        console.log(`  ✓ Success`);
      } else {
        console.log(`  ✗ Failed with exit code ${result.exitCode}`);
      }
    }
    
    // Generate summary
    await appendLog(`\n${'='.repeat(80)}`);
    await appendLog('SUMMARY');
    await appendLog(`${'='.repeat(80)}`);
    
    const successful = results.filter(r => r.exitCode === 0).length;
    const failed = results.filter(r => r.exitCode !== 0).length;
    
    await appendLog(`Total pairs processed: ${results.length}`);
    await appendLog(`Successful: ${successful}`);
    await appendLog(`Failed: ${failed}`);
    
    console.log(`\n${'='.repeat(80)}`);
    console.log('SUMMARY');
    console.log(`${'='.repeat(80)}`);
    console.log(`Total pairs processed: ${results.length}`);
    console.log(`Successful: ${successful}`);
    console.log(`Failed: ${failed}`);
    
    if (failed > 0) {
      await appendLog('\nFailed pairs:');
      const failedResults = results.filter(r => r.exitCode !== 0);
      for (const r of failedResults) {
        console.log(`  - ${r.sfc} + ${r.archive} (exit code: ${r.exitCode})`);
        await appendLog(`  - ${r.sfc} + ${r.archive} (exit code: ${r.exitCode})`);
      }
    }
    
    await appendLog(`\n${'='.repeat(80)}`);
    await appendLog(`process_arcsfc_runner.js completed`);
    await appendLog(`${'='.repeat(80)}\n`);
    
    // Exit with non-zero if any failed
    process.exit(failed > 0 ? 1 : 0);
    
  } catch (error) {
    const errorMsg = `Fatal error: ${error.message}`;
    console.error(errorMsg);
    await appendLog(`\n${'='.repeat(80)}`);
    await appendLog(`FATAL ERROR: ${errorMsg}`);
    await appendLog(`Stack: ${error.stack || 'N/A'}`);
    await appendLog(`${'='.repeat(80)}\n`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { findMatchingPairs, processPair };
