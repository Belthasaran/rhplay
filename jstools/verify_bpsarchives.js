#!/usr/bin/env node

/**
 * verify_bpsarchives.js - Verify bpsarchives.json manifest
 * 
 * This script provides verification capabilities for the bpsarchives.json manifest,
 * similar to prepare_databases.js verification for dbmanifest.json.
 * 
 * Usage:
 *   enode.sh ~/rhplay/jstools/verify_bpsarchives.js [options]
 * 
 * Options:
 *   --verify-links      Verify all download links and SHA256 hashes
 *   --verify-build      Verify build process (can build catalogs from manifest)
 *   --verify-all-json   (with --verify-build) Also extract and verify BPS files from 7z archives
 *   --manifest <path>   Path to bpsarchives.json (default: electron/bpsarchives.json)
 *   --target <name>     Limit verification to specific target (e.g., bps_00.7z, rhsearch.zip)
 *   --ipfs-timeout <s>  Timeout for IPFS downloads in seconds (default: 20)
 *   --help              Show this help message
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');
const { Readable, Transform } = require('stream');
const AdmZip = require('adm-zip');
const sevenZip = require('7zip-min');
const { path7za } = require('7zip-bin');

const HELP_TEXT = `
Usage:
  verify_bpsarchives.js [options]

Options:
  --verify-links      Verify all download links are valid and return files with correct SHA256 hashes
  --verify-build      Verify build process (verify catalogs can be built from manifest)
  --verify-all-json   (with --verify-build) Also extract and verify BPS files from 7z archives
  --manifest <path>   Path to bpsarchives.json (default: electron/bpsarchives.json)
  --target <name>     Limit verification to specific target (e.g., bps_00.7z, rhsearch.zip)
  --ipfs-timeout <s>  Timeout for IPFS downloads in seconds (default: 20)
  --help              Show this help message

Examples:
  verify_bpsarchives.js --verify-links
  verify_bpsarchives.js --verify-build
  verify_bpsarchives.js --verify-build --verify-all-json
  verify_bpsarchives.js --verify-links --target=bps_00.7z
`.trim();

// IPFS gateways (same as prepare_databases.js)
const IPFS_GATEWAYS = [
  'https://ipfs.4everland.io/ipfs/',
  'https://w3s.link/ipfs/',
  'https://cloudflare-ipfs.com/ipfs/',
  'https://ipfs.io/ipfs/',
  'https://gateway.pinata.cloud/ipfs/',
];

function exitWithError(message) {
  console.error(`[verify_bpsarchives] ${message}`);
  process.exit(1);
}

function sha256File(filePath) {
  try {
    const buffer = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(buffer).digest('hex');
  } catch (err) {
    return null;
  }
}

function decodeBaddr(b64) {
  try {
    const decoded = Buffer.from(b64, 'base64').toString('utf8');
    if (decoded.startsWith('http://') || decoded.startsWith('https://')) {
      return decoded.trim();
    }
    return null;
  } catch (err) {
    return null;
  }
}

function getUrlsFromSpec(spec) {
  const urls = [];
  let index = 0;
  if (spec.url) {
    const urlArray = Array.isArray(spec.url) ? spec.url : [spec.url];
    urlArray.forEach((url) => {
      urls.push({ url, type: 'url', index: index++ });
    });
  }
  if (spec.baddr) {
    const baddrArray = Array.isArray(spec.baddr) ? spec.baddr : [spec.baddr];
    baddrArray.forEach((b64) => {
      const decoded = decodeBaddr(b64);
      if (decoded) {
        urls.push({ url: decoded, type: 'baddr', index: index++ });
      }
    });
  }
  return urls;
}

function parsePriority(priority, spec) {
  const urlArray = getUrlsFromSpec(spec);
  const hasUrls = urlArray.length > 0;
  
  if (!priority) {
    const sources = [];
    if (spec.ipfs_cidv1) {
      sources.push({ type: 'ipfs', cid: spec.ipfs_cidv1 });
    }
    if (hasUrls) {
      urlArray.forEach((urlObj) => {
        sources.push({ type: 'url', url: urlObj.url, urlType: urlObj.type, index: urlObj.index });
      });
    }
    if (spec.data_txid || spec.ardrive_file_path) {
      sources.push({ type: 'ardrive', txid: spec.data_txid, path: spec.ardrive_file_path });
    }
    return sources;
  }

  const sources = [];
  for (const token of priority) {
    if (token === 'ipfs' && spec.ipfs_cidv1) {
      sources.push({ type: 'ipfs', cid: spec.ipfs_cidv1 });
    } else if (token === 'ardrive' && (spec.data_txid || spec.ardrive_file_path)) {
      sources.push({ type: 'ardrive', txid: spec.data_txid, path: spec.ardrive_file_path });
    } else if (token === 'url' || token === 'baddr') {
      urlArray.forEach((urlObj) => {
        sources.push({ type: 'url', url: urlObj.url, urlType: urlObj.type, index: urlObj.index });
      });
    } else if (token.startsWith('url.') || token.startsWith('baddr.')) {
      const idx = parseInt(token.substring(token.indexOf('.') + 1), 10);
      if (!isNaN(idx) && idx >= 0) {
        const urlObj = urlArray.find((u) => u.index === idx);
        if (urlObj) {
          sources.push({ type: 'url', url: urlObj.url, urlType: urlObj.type, index: urlObj.index });
        }
      }
    }
  }
  return sources;
}

async function downloadFromUrl(url, destPath, expectedSha256, spec, sourceLabel, timeoutMs = 20 * 1000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(url, { signal: controller.signal });
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
  clearTimeout(timeout);
  
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  const tempPath = `${destPath}.download`;
  const writeStream = fs.createWriteStream(tempPath);
  const bodyStream = Readable.fromWeb(response.body);

  await pipeline(bodyStream, writeStream);
  writeStream.close();

  if (expectedSha256) {
    const actualSha = sha256File(tempPath);
    if (actualSha !== expectedSha256) {
      try {
        fs.unlinkSync(tempPath);
      } catch {
        // Ignore cleanup errors
      }
      throw new Error(`SHA-256 mismatch (expected ${expectedSha256}, got ${actualSha})`);
    }
  }

  await fs.promises.rename(tempPath, destPath);
}

/**
 * Download a file from manifest spec (tries all sources in priority order)
 * Returns the path to the downloaded file
 */
async function downloadFileFromSpec(spec, destPath, ipfsTimeout) {
  const priority = spec.priority || ['ipfs', 'url', 'ardrive'];
  const sources = parsePriority(priority, spec);
  
  let lastError = null;
  for (const source of sources) {
    try {
      if (source.type === 'ipfs') {
        // Try IPFS gateways - success if ANY gateway works
        for (const gateway of IPFS_GATEWAYS) {
          try {
            const gatewayUrl = `${gateway}${source.cid}`;
            await downloadFromUrl(gatewayUrl, destPath, spec.sha256, spec, `ipfs:${gateway}`, ipfsTimeout * 1000);
            return destPath;
          } catch (err) {
            lastError = err;
            // Try next gateway
          }
        }
      } else if (source.type === 'url') {
        await downloadFromUrl(source.url, destPath, spec.sha256, spec, `url:${source.index}`);
        return destPath;
      } else if (source.type === 'ardrive') {
        const url = source.txid ? `https://arweave.net/${source.txid}` : `https://arweave.net${source.path}`;
        await downloadFromUrl(url, destPath, spec.sha256, spec, 'ardrive');
        return destPath;
      }
    } catch (err) {
      lastError = err;
      // Try next source
    }
  }
  
  throw new Error(`All download sources failed. Last error: ${lastError ? lastError.message : 'unknown'}`);
}

function parseArguments(argv) {
  const opts = {
    verifyLinks: false,
    verifyBuild: false,
    verifyAllJson: false,
    manifestPath: path.join(__dirname, '..', 'electron', 'bpsarchives.json'),
    target: null,
    ipfsTimeout: 20,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--help' || arg === '-h') {
      console.log(HELP_TEXT);
      process.exit(0);
    } else if (arg === '--verify-links') {
      opts.verifyLinks = true;
    } else if (arg === '--verify-build') {
      opts.verifyBuild = true;
    } else if (arg === '--verify-all-json') {
      opts.verifyAllJson = true;
    } else if (arg === '--manifest') {
      if (i + 1 >= argv.length) exitWithError('Missing value after --manifest');
      opts.manifestPath = path.resolve(argv[++i]);
    } else if (arg.startsWith('--manifest=')) {
      opts.manifestPath = path.resolve(arg.substring('--manifest='.length));
    } else if (arg === '--target') {
      if (i + 1 >= argv.length) exitWithError('Missing value after --target');
      opts.target = argv[++i];
    } else if (arg.startsWith('--target=')) {
      opts.target = arg.substring('--target='.length);
    } else if (arg === '--ipfs-timeout') {
      if (i + 1 >= argv.length) exitWithError('Missing value after --ipfs-timeout');
      const timeoutValue = parseInt(argv[++i], 10);
      if (isNaN(timeoutValue) || timeoutValue <= 0) {
        exitWithError('--ipfs-timeout must be a positive number (seconds)');
      }
      opts.ipfsTimeout = timeoutValue;
    } else if (arg.startsWith('--ipfs-timeout=')) {
      const timeoutValue = parseInt(arg.substring('--ipfs-timeout='.length), 10);
      if (isNaN(timeoutValue) || timeoutValue <= 0) {
        exitWithError('--ipfs-timeout must be a positive number (seconds)');
      }
      opts.ipfsTimeout = timeoutValue;
    } else if (arg.startsWith('--')) {
      exitWithError(`Unknown option "${arg}". Use --help for usage details.`);
    } else {
      exitWithError(`Unexpected positional argument "${arg}". Use --help for usage.`);
    }
  }

  if (!opts.verifyLinks && !opts.verifyBuild) {
    exitWithError('Must specify at least one of --verify-links or --verify-build');
  }

  return opts;
}

function loadManifest(manifestPath) {
  if (!fs.existsSync(manifestPath)) {
    exitWithError(`Manifest not found at "${manifestPath}".`);
  }
  try {
    const raw = fs.readFileSync(manifestPath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    exitWithError(`Failed to parse manifest JSON: ${err.message}`);
  }
}

/**
 * Verify a single file specification (download and hash check)
 * Returns success if file can be downloaded from ANY source and hash matches
 */
async function verifyFileSpec(spec, context, ipfsTimeout) {
  const tempDir = path.join(os.tmpdir(), 'rhtools-verify-bpsarchives-' + Date.now());
  fs.mkdirSync(tempDir, { recursive: true });
  const tempPath = path.join(tempDir, spec.file_name);

  try {
    // Get all available download sources
    const priority = spec.priority || ['ipfs', 'url', 'ardrive'];
    const sources = parsePriority(priority, spec);

    let downloaded = false;
    let downloadedFromSource = null;
    let lastError = null;
    const sourceResults = [];

    // Try each source - for IPFS, success if ANY gateway works
    for (const source of sources) {
      let sourceLabel = '';
      let url = '';
      const tempPathForSource = path.join(tempDir, `${spec.file_name}.${sourceResults.length}`);

      try {
        if (source.type === 'ipfs') {
          // Try IPFS gateways - success if ANY gateway works
          console.log(`    Trying IPFS gateways (${IPFS_GATEWAYS.length} total)...`);
          
          let ipfsSuccess = false;
          for (const gateway of IPFS_GATEWAYS) {
            const gatewayUrl = `${gateway}${source.cid}`;
            const gatewayLabel = `ipfs:${gateway}`;
            const gatewayTempPath = path.join(tempDir, `${spec.file_name}.ipfs.${IPFS_GATEWAYS.indexOf(gateway)}`);
            
            try {
              await downloadFromUrl(
                gatewayUrl,
                gatewayTempPath,
                null, // Don't verify hash during download, do it after
                spec,
                gatewayLabel,
                ipfsTimeout * 1000
              );
              
              sourceResults.push({ source: gatewayLabel, success: true });
              if (!downloaded) {
                fs.copyFileSync(gatewayTempPath, tempPath);
                downloaded = true;
                downloadedFromSource = gatewayLabel;
                ipfsSuccess = true;
              }
              
              // Clean up temp file
              if (fs.existsSync(gatewayTempPath) && gatewayTempPath !== tempPath) {
                fs.unlinkSync(gatewayTempPath);
              }
              break; // Found working gateway, stop trying
            } catch (err) {
              sourceResults.push({ source: gatewayLabel, success: false, error: err.message });
              // Clean up temp file on error
              if (fs.existsSync(gatewayTempPath)) {
                try {
                  fs.unlinkSync(gatewayTempPath);
                } catch {
                  // Ignore cleanup errors
                }
              }
            }
          }
          
          if (!ipfsSuccess) {
            lastError = new Error('All IPFS gateways failed');
          }
        } else if (source.type === 'url') {
          url = source.url;
          const urlType = source.urlType || 'url';
          sourceLabel = `${urlType}:${source.index}`;
          console.log(`    Trying ${sourceLabel}...`);
          await downloadFromUrl(url, tempPathForSource, null, spec, sourceLabel);
          sourceResults.push({ source: sourceLabel, success: true });
          if (!downloaded) {
            fs.copyFileSync(tempPathForSource, tempPath);
            downloaded = true;
            downloadedFromSource = sourceLabel;
          }
        } else if (source.type === 'ardrive') {
          if (source.txid) {
            url = `https://arweave.net/${source.txid}`;
            sourceLabel = 'arweave:data_txid';
          } else if (source.path) {
            url = `https://arweave.net${source.path}`;
            sourceLabel = 'arweave:ardrive_path';
          }
          if (url) {
            console.log(`    Trying ${sourceLabel}...`);
            await downloadFromUrl(url, tempPathForSource, null, spec, sourceLabel);
            sourceResults.push({ source: sourceLabel, success: true });
            if (!downloaded) {
              fs.copyFileSync(tempPathForSource, tempPath);
              downloaded = true;
              downloadedFromSource = sourceLabel;
            }
          }
        }

        // Clean up temp file for this source
        if (fs.existsSync(tempPathForSource) && tempPathForSource !== tempPath) {
          fs.unlinkSync(tempPathForSource);
        }
      } catch (err) {
        lastError = err;
        if (sourceLabel) {
          sourceResults.push({ source: sourceLabel, success: false, error: err.message });
        }
        // Clean up temp file on error
        if (fs.existsSync(tempPathForSource)) {
          try {
            fs.unlinkSync(tempPathForSource);
          } catch {
            // Ignore cleanup errors
          }
        }
      }
    }

    // Report on all sources tried
    const successfulSources = sourceResults.filter((r) => r.success);
    const failedSources = sourceResults.filter((r) => !r.success);

    if (successfulSources.length > 0) {
      console.log(`    ✓ ${successfulSources.length} source(s) succeeded: ${successfulSources.map((s) => s.source).join(', ')}`);
    }
    if (failedSources.length > 0) {
      console.log(`    ✗ ${failedSources.length} source(s) failed: ${failedSources.map((s) => s.source).join(', ')}`);
    }

    if (!downloaded) {
      return {
        success: false,
        error: `All download sources failed. Last error: ${lastError ? lastError.message : 'unknown'}`,
        sourceResults,
      };
    }

    // Verify hash using the downloaded file
    if (!spec.sha256) {
      return {
        success: false,
        error: 'No SHA256 hash specified in manifest',
        warning: 'File downloaded but cannot verify hash',
        sourceResults,
        downloadedFrom: downloadedFromSource,
      };
    }

    const actualHash = sha256File(tempPath);
    if (actualHash !== spec.sha256) {
      return {
        success: false,
        error: `Hash mismatch: expected ${spec.sha256}, got ${actualHash}`,
        sourceResults,
        downloadedFrom: downloadedFromSource,
      };
    }

    return {
      success: true,
      sourceResults,
      downloadedFrom: downloadedFromSource,
    };
  } catch (err) {
    return { success: false, error: err.message };
  } finally {
    // Cleanup
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Verify all download links in manifest
 */
async function verifyLinks(manifest, opts) {
  console.log('='.repeat(70));
  console.log('BPS Archives Manifest Link Verification');
  console.log('='.repeat(70));
  console.log();

  const targets = opts.target ? [opts.target] : Object.keys(manifest);
  const results = {
    passed: [],
    failed: [],
    warnings: [],
  };

  for (const targetKey of targets) {
    const target = manifest[targetKey];
    if (!target || typeof target !== 'object' || !target.base) continue;

    console.log(`\n[${targetKey}]`);
    console.log('-'.repeat(70));

    // Verify base file
    if (target.base) {
      console.log(`  Base: ${target.base.file_name}`);
      const baseResult = await verifyFileSpec(target.base, `base for ${targetKey}`, opts.ipfsTimeout);
      if (baseResult.success) {
        results.passed.push({ target: targetKey, type: 'base', file: target.base.file_name });
      } else {
        results.failed.push({ target: targetKey, type: 'base', file: target.base.file_name, error: baseResult.error });
      }
      if (baseResult.warning) {
        results.warnings.push({ target: targetKey, type: 'base', file: target.base.file_name, warning: baseResult.warning });
      }
    }
  }

  // Summary
  console.log('\n' + '='.repeat(70));
  console.log('Verification Summary');
  console.log('='.repeat(70));
  console.log(`Passed: ${results.passed.length}`);
  console.log(`Failed: ${results.failed.length}`);
  console.log(`Warnings: ${results.warnings.length}`);

  if (results.failed.length > 0) {
    console.log('\nFailed Downloads:');
    results.failed.forEach((f) => {
      console.log(`  [${f.target}] ${f.type}: ${f.file}`);
      console.log(`    Error: ${f.error}`);
    });
  }

  if (results.warnings.length > 0) {
    console.log('\nWarnings:');
    results.warnings.forEach((w) => {
      console.log(`  [${w.target}] ${w.type}: ${w.file}`);
      console.log(`    Warning: ${w.warning}`);
    });
  }

  return results.failed.length === 0;
}

/**
 * Extract JSON files from ZIP archive
 */
function extractJsonFilesFromZip(zipPath) {
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();
  const jsonFiles = [];
  
  for (const entry of entries) {
    if (entry.isDirectory) continue;
    if (entry.entryName.endsWith('.json')) {
      try {
        const content = entry.getData().toString('utf8');
        const json = JSON.parse(content);
        jsonFiles.push({
          filename: entry.entryName,
          content: json,
        });
      } catch (err) {
        console.warn(`    ⚠ Failed to parse JSON file ${entry.entryName}: ${err.message}`);
      }
    }
  }
  
  return jsonFiles;
}

/**
 * Extract BPS file from 7z archive
 * Returns path to extracted file
 */
function extractBpsFrom7z(archivePath, bpsFilename, destDir) {
  return new Promise((resolve, reject) => {
    // Use 7zip-min to extract entire archive (it doesn't support extracting specific files)
    sevenZip.unpack(archivePath, destDir, (err) => {
      if (err) {
        reject(err);
        return;
      }
      
      // Find the file (it might be in the root or a subdirectory)
      function findFile(dir, filename) {
        try {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isFile() && entry.name === filename) {
              return fullPath;
            } else if (entry.isDirectory()) {
              const found = findFile(fullPath, filename);
              if (found) return found;
            }
          }
        } catch (err) {
          // Ignore read errors
        }
        return null;
      }
      
      const foundPath = findFile(destDir, bpsFilename);
      if (foundPath) {
        resolve(foundPath);
      } else {
        reject(new Error(`BPS file ${bpsFilename} not found in archive`));
      }
    });
  });
}

/**
 * List files in 7z archive
 * Returns array of file paths (as strings)
 */
function listFilesIn7z(archivePath) {
  return new Promise((resolve, reject) => {
    sevenZip.list(archivePath, (err, files) => {
      if (err) {
        reject(err);
      } else {
        // Normalize file list - files might be objects with .name or just strings
        const fileList = (files || []).map((file) => {
          if (typeof file === 'string') {
            return file;
          } else if (file && file.name) {
            return file.name;
          } else if (file && file.path) {
            return file.path;
          } else {
            return String(file);
          }
        });
        resolve(fileList);
      }
    });
  });
}

/**
 * Verify build process
 */
async function verifyBuild(manifest, opts) {
  console.log('='.repeat(70));
  console.log('BPS Archives Manifest Build Verification');
  console.log('='.repeat(70));
  console.log();

  const tempDir = path.join(os.tmpdir(), 'rhtools-verify-build-bpsarchives-' + Date.now());
  fs.mkdirSync(tempDir, { recursive: true });

  const targets = opts.target ? [opts.target] : Object.keys(manifest);
  const results = {
    passed: [],
    failed: [],
    warnings: [],
  };

  try {
    // Find rhsearch.zip in manifest
    const rhsearchEntry = manifest['rhsearch.zip'];
    if (!rhsearchEntry || !rhsearchEntry.base) {
      console.log('⚠ rhsearch.zip not found in manifest, skipping JSON file verification');
    } else {
      console.log('\n[rhsearch.zip]');
      console.log('-'.repeat(70));
      
      // Download rhsearch.zip
      console.log('  Downloading rhsearch.zip...');
      const rhsearchPath = path.join(tempDir, 'rhsearch.zip');
      
      try {
        await downloadFileFromSpec(rhsearchEntry.base, rhsearchPath, opts.ipfsTimeout);
        console.log('  ✓ Downloaded rhsearch.zip');
      } catch (err) {
        results.failed.push({ target: 'rhsearch.zip', type: 'download', error: err.message });
        console.log(`  ✗ Failed to download rhsearch.zip: ${err.message}`);
      }
      
      if (fs.existsSync(rhsearchPath)) {
        // Extract JSON files from rhsearch.zip
        console.log('  Extracting JSON files from rhsearch.zip...');
        const jsonFiles = extractJsonFilesFromZip(rhsearchPath);
        console.log(`  Found ${jsonFiles.length} JSON file(s)`);
        
        // Build set of archive names referenced in JSON files
        const archiveNames = new Set();
        for (const jsonFile of jsonFiles) {
          const json = jsonFile.content;
          if (json.index7z_name) {
            archiveNames.add(json.index7z_name);
          }
        }
        
        console.log(`  JSON files reference ${archiveNames.size} archive(s): ${Array.from(archiveNames).join(', ')}`);
        
        // Verify each referenced archive exists in manifest
        for (const archiveName of archiveNames) {
          if (!manifest[archiveName]) {
            results.failed.push({
              target: 'rhsearch.zip',
              type: 'json-archive-missing',
              archive: archiveName,
              error: `Archive ${archiveName} referenced in JSON files but not found in manifest`,
            });
            console.log(`  ✗ Archive ${archiveName} referenced but not in manifest`);
          } else {
            results.passed.push({
              target: 'rhsearch.zip',
              type: 'json-archive-found',
              archive: archiveName,
            });
            console.log(`  ✓ Archive ${archiveName} found in manifest`);
          }
        }
        
        // If --verify-all-json, also verify BPS files exist in archives
        if (opts.verifyAllJson) {
          console.log('\n  Verifying BPS files in archives (--verify-all-json)...');
          
          for (const jsonFile of jsonFiles) {
            const json = jsonFile.content;
            const archiveName = json.index7z_name;
            const bpsName = json.indexbps_name;
            const expectedBpsSha256 = json.bps_sha256_hash;
            
            if (!archiveName || !bpsName) {
              results.warnings.push({
                target: 'rhsearch.zip',
                type: 'json-missing-fields',
                json: jsonFile.filename,
                warning: 'Missing index7z_name or indexbps_name',
              });
              continue;
            }
            
            if (!manifest[archiveName]) {
              // Already reported above
              continue;
            }
            
            const archiveEntry = manifest[archiveName];
            if (!archiveEntry.base) {
              results.failed.push({
                target: archiveName,
                type: 'archive-no-base',
                error: 'Archive entry has no base file',
              });
              continue;
            }
            
            // Download archive
            console.log(`    Downloading ${archiveName}...`);
            const archivePath = path.join(tempDir, archiveName);
            
            try {
              await downloadFileFromSpec(archiveEntry.base, archivePath, opts.ipfsTimeout);
              console.log(`    ✓ Downloaded ${archiveName}`);
            } catch (err) {
              results.failed.push({
                target: archiveName,
                type: 'archive-download-failed',
                error: err.message,
              });
              console.log(`    ✗ Failed to download ${archiveName}: ${err.message}`);
              continue;
            }
            
            // Verify file exists in archive
            console.log(`    Checking for ${bpsName} in ${archiveName}...`);
            try {
              // First try to list files to check existence
              let bpsFound = false;
              try {
                const filesInArchive = await listFilesIn7z(archivePath);
                bpsFound = filesInArchive.some((filePath) => {
                  const fileName = path.basename(filePath);
                  return fileName === bpsName;
                });
              } catch (listErr) {
                // If listing fails, we'll try extraction instead
                console.log(`    ⚠ Could not list archive files, will try extraction: ${listErr.message}`);
              }
              
              // If SHA256 specified, extract and verify
              if (expectedBpsSha256) {
                console.log(`    Extracting and verifying SHA256 hash for ${bpsName}...`);
                const extractDir = path.join(tempDir, `extract_${archiveName}_${Date.now()}`);
                fs.mkdirSync(extractDir, { recursive: true });
                
                try {
                  const extractedPath = await extractBpsFrom7z(archivePath, bpsName, extractDir);
                  bpsFound = true; // File was found if extraction succeeded
                  
                  const actualSha256 = sha256File(extractedPath);
                  
                  if (actualSha256 !== expectedBpsSha256) {
                    results.failed.push({
                      target: archiveName,
                      type: 'bps-hash-mismatch',
                      bps: bpsName,
                      error: `SHA256 mismatch: expected ${expectedBpsSha256}, got ${actualSha256}`,
                    });
                    console.log(`    ✗ SHA256 mismatch for ${bpsName}`);
                  } else {
                    results.passed.push({
                      target: archiveName,
                      type: 'bps-hash-match',
                      bps: bpsName,
                    });
                    console.log(`    ✓ BPS file ${bpsName} found and SHA256 hash matches`);
                  }
                  
                  // Cleanup extracted directory
                  try {
                    fs.rmSync(extractDir, { recursive: true, force: true });
                  } catch {
                    // Ignore cleanup errors
                  }
                } catch (extractErr) {
                  if (!bpsFound) {
                    results.failed.push({
                      target: archiveName,
                      type: 'bps-not-found',
                      bps: bpsName,
                      error: `BPS file ${bpsName} not found in archive: ${extractErr.message}`,
                    });
                    console.log(`    ✗ BPS file ${bpsName} not found in archive`);
                  } else {
                    results.failed.push({
                      target: archiveName,
                      type: 'bps-extract-failed',
                      bps: bpsName,
                      error: `Failed to extract BPS file: ${extractErr.message}`,
                    });
                    console.log(`    ✗ Failed to extract ${bpsName}: ${extractErr.message}`);
                  }
                }
              } else {
                // No hash specified, just check if file exists
                if (!bpsFound) {
                  // Try extraction to verify existence
                  const extractDir = path.join(tempDir, `extract_${archiveName}_${Date.now()}`);
                  fs.mkdirSync(extractDir, { recursive: true });
                  try {
                    await extractBpsFrom7z(archivePath, bpsName, extractDir);
                    bpsFound = true;
                    // Cleanup
                    try {
                      fs.rmSync(extractDir, { recursive: true, force: true });
                    } catch {
                      // Ignore cleanup errors
                    }
                  } catch (extractErr) {
                    // File doesn't exist
                  }
                }
                
                if (bpsFound) {
                  results.passed.push({
                    target: archiveName,
                    type: 'bps-found',
                    bps: bpsName,
                  });
                  console.log(`    ✓ BPS file ${bpsName} found in archive`);
                } else {
                  results.failed.push({
                    target: archiveName,
                    type: 'bps-not-found',
                    bps: bpsName,
                    error: `BPS file ${bpsName} not found in archive`,
                  });
                  console.log(`    ✗ BPS file ${bpsName} not found in archive`);
                }
                
                results.warnings.push({
                  target: archiveName,
                  type: 'bps-no-hash',
                  bps: bpsName,
                  warning: 'No bps_sha256_hash specified in JSON, skipping hash verification',
                });
                console.log(`    ⚠ No SHA256 hash specified for ${bpsName}, skipping verification`);
              }
            } catch (err) {
              results.failed.push({
                target: archiveName,
                type: 'archive-check-failed',
                error: `Failed to check archive: ${err.message}`,
              });
              console.log(`    ✗ Failed to check archive: ${err.message}`);
            }
          }
        } else {
          // Without --verify-all-json, just verify attributes exist
          for (const jsonFile of jsonFiles) {
            const json = jsonFile.content;
            if (!json.index7z_name || !json.indexbps_name) {
              results.warnings.push({
                target: 'rhsearch.zip',
                type: 'json-missing-fields',
                json: jsonFile.filename,
                warning: 'Missing index7z_name or indexbps_name',
              });
            }
          }
        }
      }
    }

    // Summary
    console.log('\n' + '='.repeat(70));
    console.log('Build Verification Summary');
    console.log('='.repeat(70));
    console.log(`Passed: ${results.passed.length}`);
    console.log(`Failed: ${results.failed.length}`);
    console.log(`Warnings: ${results.warnings.length}`);

    if (results.failed.length > 0) {
      console.log('\nFailed Checks:');
      results.failed.forEach((f) => {
        console.log(`  [${f.target}] ${f.type}: ${f.error || f.archive || f.bps || ''}`);
      });
    }

    if (results.warnings.length > 0) {
      console.log('\nWarnings:');
      results.warnings.forEach((w) => {
        console.log(`  [${w.target}] ${w.type}: ${w.warning || ''}`);
      });
    }

    return results.failed.length === 0;
  } finally {
    // Cleanup
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch {
      // Ignore cleanup errors
    }
  }
}

// Main function
async function main() {
  const opts = parseArguments(process.argv.slice(2));
  const manifest = loadManifest(opts.manifestPath);

  console.log('==================================================');
  console.log('  verify_bpsarchives.js - BPS Archives Verification');
  console.log('==================================================\n');
  console.log(`Manifest: ${opts.manifestPath}`);
  console.log(`Entries: ${Object.keys(manifest).length}\n`);

  let allPassed = true;

  if (opts.verifyLinks) {
    const linksPassed = await verifyLinks(manifest, opts);
    allPassed = allPassed && linksPassed;
  }

  if (opts.verifyBuild) {
    const buildPassed = await verifyBuild(manifest, opts);
    allPassed = allPassed && buildPassed;
  }

  console.log('\n' + '='.repeat(70));
  if (allPassed) {
    console.log('✓ All verifications passed!');
    process.exit(0);
  } else {
    console.log('✗ Some verifications failed');
    process.exit(1);
  }
}

// Execute
if (require.main === module) {
  main().catch((error) => {
    console.error('\nFatal error:', error);
    process.exit(1);
  });
}

module.exports = { verifyLinks, verifyBuild };

