#!/usr/bin/env node

/**
 * create_coremf_dat.js
 *
 * Creates coremanifest.dat binary file from coremanifest.json
 * Format: [8-byte lastupdated][8-byte versionid][4-byte compressed_size][LZMA(JSON)][64-byte SHA512][64-byte Ed25519 signature of SHA512]
 *
 * Usage:
 *   create_coremf_dat.js --coremanifest <path> --key <pem_path> [--output <path>] [--passphrase-env VAR]
 *
 * Options:
 *   --coremanifest <path>    Path to coremanifest.json
 *   --key <pem_path>         Path to PEM-encoded AES-256-encrypted Ed25519 private key
 *   --output <path>          Output path for coremanifest.dat (default: coremanifest.dat in same dir as input)
 *   --passphrase-env VAR     Environment variable name containing passphrase for encrypted key
 *   --help                   Show this help message
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const lzma = require('lzma-native');
const readline = require('readline');

const HELP_TEXT = `
Usage:
  create_coremf_dat.js --coremanifest <path> --key <pem_path> [options]

Options:
  --coremanifest <path>    Path to coremanifest.json
  --key <pem_path>         Path to PEM-encoded AES-256-encrypted Ed25519 private key
  --output <path>          Output path for coremanifest.dat (default: coremanifest.dat in same dir as input)
  --passphrase-env VAR     Environment variable name containing passphrase for encrypted key
  --help                   Show this help message

Example:
  create_coremf_dat.js --coremanifest electron/coremanifest.json --key keys/coremanifest_key.pem --passphrase-env COREMF_KEY_PASSPHRASE
`.trim();

// Hardcoded public key for verification reference
const EXPECTED_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAg2OfoECrhroIOmtHhn2mPMtXBN9NspqN8VNO1v3lBxg=
-----END PUBLIC KEY-----`;

function exitWithError(message) {
  console.error(`[create_coremf_dat] ${message}`);
  process.exit(1);
}

function parseArguments(argv) {
  const options = {
    coremanifestPath: null,
    keyPath: null,
    outputPath: null,
    passphraseEnv: null
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--help' || arg === '-h') {
      console.log(HELP_TEXT);
      process.exit(0);
    } else if (arg === '--coremanifest') {
      if (i + 1 >= argv.length) {
        exitWithError('Expected value after --coremanifest');
      }
      options.coremanifestPath = argv[i + 1];
      i += 1;
    } else if (arg.startsWith('--coremanifest=')) {
      options.coremanifestPath = arg.substring('--coremanifest='.length);
    } else if (arg === '--key') {
      if (i + 1 >= argv.length) {
        exitWithError('Expected value after --key');
      }
      options.keyPath = argv[i + 1];
      i += 1;
    } else if (arg.startsWith('--key=')) {
      options.keyPath = arg.substring('--key='.length);
    } else if (arg === '--output') {
      if (i + 1 >= argv.length) {
        exitWithError('Expected value after --output');
      }
      options.outputPath = argv[i + 1];
      i += 1;
    } else if (arg.startsWith('--output=')) {
      options.outputPath = arg.substring('--output='.length);
    } else if (arg === '--passphrase-env') {
      if (i + 1 >= argv.length) {
        exitWithError('Expected value after --passphrase-env');
      }
      options.passphraseEnv = argv[i + 1];
      i += 1;
    } else if (arg.startsWith('--passphrase-env=')) {
      options.passphraseEnv = arg.substring('--passphrase-env='.length);
    } else if (arg.startsWith('--')) {
      exitWithError(`Unrecognized option "${arg}". Use --help for usage information.`);
    }
  }

  if (!options.coremanifestPath) {
    exitWithError('Missing required option --coremanifest');
  }
  if (!options.keyPath) {
    exitWithError('Missing required option --key');
  }

  return options;
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

/**
 * Prompt for passphrase
 */
function promptPassphrase() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    rl.question('Enter passphrase for encrypted private key: ', (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

/**
 * Load and decrypt Ed25519 private key from PEM file
 */
function loadPrivateKey(keyPath, passphrase) {
  try {
    const keyData = fs.readFileSync(keyPath, 'utf8');
    // Node.js crypto can import encrypted Ed25519 keys
    const privateKey = crypto.createPrivateKey({
      key: keyData,
      format: 'pem',
      passphrase: passphrase || undefined
    });
    
    // Verify it's Ed25519
    if (privateKey.asymmetricKeyType !== 'ed25519') {
      throw new Error('Key is not Ed25519');
    }
    
    return privateKey;
  } catch (err) {
    if (err.message.includes('bad decrypt') || err.message.includes('incorrect passphrase')) {
      throw new Error('Incorrect passphrase or key format');
    }
    throw new Error(`Failed to load private key: ${err.message}`);
  }
}

/**
 * Write 64-bit big-endian integer
 */
function writeUInt64BE(buffer, value, offset) {
  // Write high 32 bits
  buffer.writeUInt32BE(Math.floor(value / 0x100000000), offset);
  // Write low 32 bits
  buffer.writeUInt32BE(value & 0xffffffff, offset + 4);
}

/**
 * Write 32-bit big-endian integer
 */
function writeUInt32BE(buffer, value, offset) {
  buffer.writeUInt32BE(value, offset);
}

async function run(argv) {
  const opts = parseArguments(argv);

  // Read and validate coremanifest.json
  if (!fs.existsSync(opts.coremanifestPath)) {
    exitWithError(`coremanifest.json not found: ${opts.coremanifestPath}`);
  }

  let manifest;
  try {
    const raw = fs.readFileSync(opts.coremanifestPath, 'utf8');
    manifest = JSON.parse(raw);
  } catch (err) {
    exitWithError(`Failed to parse coremanifest.json: ${err.message}`);
  }

  // Validate lastupdated
  const lastupdated = normalizeLastUpdated(manifest.lastupdated);
  if (lastupdated === null) {
    exitWithError('coremanifest.json missing or invalid lastupdated field');
  }

  const now = Math.floor(Date.now() / 1000);
  if (lastupdated > now) {
    exitWithError(`lastupdated is in the future: ${lastupdated} > ${now}`);
  }

  const versionid = manifest.versionid || 0;
  if (typeof versionid !== 'number') {
    exitWithError('versionid must be a number');
  }

  // Serialize JSON deterministically (no extra whitespace)
  const jsonBytes = Buffer.from(JSON.stringify(manifest), 'utf8');

  // Compress with LZMA
  console.log('[create_coremf_dat] Compressing JSON with LZMA...');
  const compressed = await new Promise((resolve, reject) => {
    lzma.compress(jsonBytes, { preset: 6 }, (result, error) => {
      if (error) {
        reject(error);
      } else {
        resolve(Buffer.from(result));
      }
    });
  });

  console.log(`[create_coremf_dat] Compressed ${jsonBytes.length} bytes to ${compressed.length} bytes`);

  // Build header: lastupdated (8), versionid (8), compressed_size (4)
  const headerSize = 8 + 8 + 4; // 20 bytes
  const header = Buffer.alloc(headerSize);
  writeUInt64BE(header, lastupdated, 0);
  writeUInt64BE(header, versionid, 8);
  writeUInt32BE(header, compressed.length, 16);

  // Combine header + compressed data
  const payload = Buffer.concat([header, compressed]);

  // Compute SHA512 of payload
  console.log('[create_coremf_dat] Computing SHA512...');
  const sha512 = crypto.createHash('sha512').update(payload).digest();

  // Get passphrase
  let passphrase = null;
  if (opts.passphraseEnv) {
    passphrase = process.env[opts.passphraseEnv];
    if (!passphrase) {
      exitWithError(`Environment variable ${opts.passphraseEnv} not set`);
    }
  } else {
    passphrase = await promptPassphrase();
  }

  // Load and decrypt private key
  console.log('[create_coremf_dat] Loading private key...');
  const privateKey = loadPrivateKey(opts.keyPath, passphrase);

  // Sign the SHA512 digest (64 bytes)
  console.log('[create_coremf_dat] Signing SHA512 digest with Ed25519...');
  const signature = crypto.sign(null, sha512, privateKey);

  if (signature.length !== 64) {
    exitWithError(`Expected 64-byte Ed25519 signature, got ${signature.length} bytes`);
  }

  // Build final file: payload + SHA512 + signature
  const final = Buffer.concat([payload, sha512, signature]);

  // Determine output path
  const outputPath = opts.outputPath || path.join(path.dirname(opts.coremanifestPath), 'coremanifest.dat');

  // Write file
  console.log(`[create_coremf_dat] Writing ${final.length} bytes to ${outputPath}...`);
  fs.writeFileSync(outputPath, final);

  console.log('[create_coremf_dat] Success!');
  console.log(`  File: ${outputPath}`);
  console.log(`  Size: ${final.length} bytes`);
  console.log(`  Header: ${headerSize} bytes`);
  console.log(`  Compressed: ${compressed.length} bytes`);
  console.log(`  SHA512: ${sha512.length} bytes`);
  console.log(`  Signature: ${signature.length} bytes`);
}

if (require.main === module) {
  run(process.argv.slice(2)).catch((err) => {
    console.error('[create_coremf_dat] Fatal error:', err);
    process.exit(1);
  });
}

module.exports = { run };
