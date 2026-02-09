#!/usr/bin/env node

/**
 * verify_coremf_dat.js
 *
 * Verifies coremanifest.dat binary file
 * Format: [8-byte lastupdated][8-byte versionid][4-byte compressed_size][LZMA(JSON)][64-byte SHA512][64-byte Ed25519 signature of SHA512]
 *
 * Usage:
 *   verify_coremf_dat.js --input <path> [--extract <path>] [--verify-only]
 *
 * Options:
 *   --input <path>       Path to coremanifest.dat
 *   --extract <path>     Optional: Extract decompressed JSON to this path
 *   --verify-only        Only verify, do not extract (default if --extract not specified)
 *   --help               Show this help message
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const lzma = require('lzma-native');

const HELP_TEXT = `
Usage:
  verify_coremf_dat.js --input <path> [options]

Options:
  --input <path>       Path to coremanifest.dat
  --extract <path>     Optional: Extract decompressed JSON to this path
  --verify-only        Only verify, do not extract (default if --extract not specified)
  --help               Show this help message

Example:
  verify_coremf_dat.js --input coremanifest.dat --extract coremanifest_verified.json
`.trim();

// Hardcoded public key for verification
const EXPECTED_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAg2OfoECrhroIOmtHhn2mPMtXBN9NspqN8VNO1v3lBxg=
-----END PUBLIC KEY-----`;

function exitWithError(message) {
  console.error(`[verify_coremf_dat] ${message}`);
  process.exit(1);
}

function parseArguments(argv) {
  const options = {
    inputPath: null,
    extractPath: null,
    verifyOnly: true
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--help' || arg === '-h') {
      console.log(HELP_TEXT);
      process.exit(0);
    } else if (arg === '--input') {
      if (i + 1 >= argv.length) {
        exitWithError('Expected value after --input');
      }
      options.inputPath = argv[i + 1];
      i += 1;
    } else if (arg.startsWith('--input=')) {
      options.inputPath = arg.substring('--input='.length);
    } else if (arg === '--extract') {
      if (i + 1 >= argv.length) {
        exitWithError('Expected value after --extract');
      }
      options.extractPath = argv[i + 1];
      options.verifyOnly = false;
      i += 1;
    } else if (arg.startsWith('--extract=')) {
      options.extractPath = arg.substring('--extract='.length);
      options.verifyOnly = false;
    } else if (arg === '--verify-only') {
      options.verifyOnly = true;
    } else if (arg.startsWith('--')) {
      exitWithError(`Unrecognized option "${arg}". Use --help for usage information.`);
    }
  }

  if (!options.inputPath) {
    exitWithError('Missing required option --input');
  }

  return options;
}

/**
 * Read 64-bit big-endian integer
 */
function readUInt64BE(buffer, offset) {
  const high = buffer.readUInt32BE(offset);
  const low = buffer.readUInt32BE(offset + 4);
  return (BigInt(high) << 32n) + BigInt(low);
}

/**
 * Read 32-bit big-endian integer
 */
function readUInt32BE(buffer, offset) {
  return buffer.readUInt32BE(offset);
}

/**
 * Normalize lastupdated to integer
 */
function normalizeLastUpdated(value) {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'number') {
    return Math.floor(value);
  }
  if (typeof value === 'string') {
    const parsed = parseInt(value.trim(), 10);
    if (isNaN(parsed)) {
      return null;
    }
    return parsed;
  }
  return null;
}

async function run(argv) {
  const opts = parseArguments(argv);

  // Read file
  if (!fs.existsSync(opts.inputPath)) {
    exitWithError(`File not found: ${opts.inputPath}`);
  }

  const fileData = fs.readFileSync(opts.inputPath);
  const fileSize = fileData.length;

  console.log(`[verify_coremf_dat] Reading ${fileSize} bytes from ${opts.inputPath}...`);

  // Minimum size: 20 (header) + 64 (SHA512) + 64 (signature) = 148 bytes
  if (fileSize < 148) {
    exitWithError(`File too small: ${fileSize} bytes (minimum 148 bytes)`);
  }

  // Parse header
  const lastupdated = Number(readUInt64BE(fileData, 0));
  const versionid = Number(readUInt64BE(fileData, 8));
  const compressedSize = readUInt32BE(fileData, 16);

  console.log(`[verify_coremf_dat] Header:`);
  console.log(`  lastupdated: ${lastupdated}`);
  console.log(`  versionid: ${versionid}`);
  console.log(`  compressed_size: ${compressedSize} bytes`);

  // Validate lastupdated
  const now = Math.floor(Date.now() / 1000);
  if (lastupdated > now) {
    exitWithError(`lastupdated is in the future: ${lastupdated} > ${now}`);
  }

  // Validate compressed size
  const expectedMinSize = 20 + compressedSize + 64 + 64;
  if (fileSize < expectedMinSize) {
    exitWithError(`File size mismatch: expected at least ${expectedMinSize} bytes, got ${fileSize}`);
  }

  // Extract payload (header + compressed data)
  const payload = fileData.slice(0, 20 + compressedSize);

  // Extract SHA512 digest (64 bytes)
  const storedSha512 = fileData.slice(20 + compressedSize, 20 + compressedSize + 64);

  // Extract signature (64 bytes)
  const signature = fileData.slice(20 + compressedSize + 64, 20 + compressedSize + 64 + 64);

  // Verify SHA512
  console.log('[verify_coremf_dat] Computing SHA512 of payload...');
  const computedSha512 = crypto.createHash('sha512').update(payload).digest();

  if (!computedSha512.equals(storedSha512)) {
    exitWithError('SHA512 mismatch! File may be corrupted or tampered with.');
  }
  console.log('[verify_coremf_dat] ✓ SHA512 verified');

  // Verify Ed25519 signature
  console.log('[verify_coremf_dat] Verifying Ed25519 signature...');
  const publicKey = crypto.createPublicKey(EXPECTED_PUBLIC_KEY_PEM);
  
  // Verify signature over the SHA512 digest (not the payload)
  const verified = crypto.verify(null, computedSha512, publicKey, signature);
  
  if (!verified) {
    exitWithError('Ed25519 signature verification failed! File may be tampered with or signed with wrong key.');
  }
  console.log('[verify_coremf_dat] ✓ Ed25519 signature verified');

  // Extract compressed data
  const compressedData = fileData.slice(20, 20 + compressedSize);

  // Decompress
  console.log('[verify_coremf_dat] Decompressing LZMA data...');
  const decompressed = await new Promise((resolve, reject) => {
    lzma.decompress(compressedData, (result, error) => {
      if (error) {
        reject(error);
      } else {
        resolve(Buffer.from(result));
      }
    });
  });

  // Parse JSON
  let manifest;
  try {
    const jsonText = decompressed.toString('utf8');
    manifest = JSON.parse(jsonText);
  } catch (err) {
    exitWithError(`Failed to parse decompressed JSON: ${err.message}`);
  }

  // Validate lastupdated in JSON matches header
  const jsonLastupdated = normalizeLastUpdated(manifest.lastupdated);
  if (jsonLastupdated === null) {
    console.warn('[verify_coremf_dat] Warning: JSON missing or invalid lastupdated');
  } else if (jsonLastupdated !== lastupdated) {
    console.warn(`[verify_coremf_dat] Warning: JSON lastupdated (${jsonLastupdated}) differs from header (${lastupdated})`);
  }

  console.log('[verify_coremf_dat] ✓ All verifications passed!');
  console.log(`  Decompressed size: ${decompressed.length} bytes`);
  console.log(`  JSON keys: ${Object.keys(manifest).length}`);

  // Extract if requested
  if (opts.extractPath) {
    console.log(`[verify_coremf_dat] Extracting JSON to ${opts.extractPath}...`);
    fs.writeFileSync(opts.extractPath, JSON.stringify(manifest, null, 2), 'utf8');
    console.log('[verify_coremf_dat] ✓ Extraction complete');
  }

  return {
    valid: true,
    manifest,
    lastupdated,
    versionid
  };
}

if (require.main === module) {
  run(process.argv.slice(2)).catch((err) => {
    console.error('[verify_coremf_dat] Fatal error:', err);
    process.exit(1);
  });
}

module.exports = { run };
