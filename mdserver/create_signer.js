#!/usr/bin/env node

/**
 * Create Digital Signature Signer
 * 
 * Generates keypair and creates signer record in database
 * Supports RSA and ED25519 algorithms
 * 
 * Usage:
 *   node create_signer.js
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const readline = require('readline');

const PATCHBIN_DB = path.join(__dirname, 'patchbin.db');

// Promisify readline
function question(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  return new Promise(resolve => {
    rl.question(query, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

/**
 * Generate ED25519 keypair
 */
function generateED25519Keypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: {
      type: 'spki',
      format: 'pem'
    },
    privateKeyEncoding: {
      type: 'pkcs8',
      format: 'pem'
    }
  });
  
  return {
    algorithm: 'ED25519',
    publicKey,
    privateKey,
    publicKeyHex: crypto.createPublicKey(publicKey).export({ type: 'spki', format: 'der' }).toString('hex'),
    privateKeyHex: crypto.createPrivateKey(privateKey).export({ type: 'pkcs8', format: 'der' }).toString('hex')
  };
}

/**
 * Generate RSA keypair
 */
function generateRSAKeypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 4096,
    publicKeyEncoding: {
      type: 'spki',
      format: 'pem'
    },
    privateKeyEncoding: {
      type: 'pkcs8',
      format: 'pem'
    }
  });
  
  return {
    algorithm: 'RSA',
    publicKey,
    privateKey,
    publicKeyHex: crypto.createPublicKey(publicKey).export({ type: 'spki', format: 'der' }).toString('hex'),
    privateKeyHex: crypto.createPrivateKey(privateKey).export({ type: 'pkcs8', format: 'der' }).toString('hex')
  };
}

/**
 * Save keypair to file
 */
function saveKeypair(signerUuid, signerName, signerType, keypair) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `signer_${signerType}_${signerUuid.substring(0, 8)}_${timestamp}.txt`;
  const filepath = path.join(__dirname, filename);
  
  const content = `# Digital Signature Signer Credentials
# Created: ${new Date().toISOString()}
# Type: ${signerType}

SIGNER_UUID=${signerUuid}
SIGNER_NAME=${signerName}
SIGNER_TYPE=${signerType}
ALGORITHM=${keypair.algorithm}

# Public Key (PEM format) - Can be shared
PUBLIC_KEY_PEM<<EOF
${keypair.publicKey}
EOF

# Public Key (Hex format) - Stored in database
PUBLIC_KEY_HEX=${keypair.publicKeyHex}

# Private Key (PEM format) - KEEP SECRET!
PRIVATE_KEY_PEM<<EOF
${keypair.privateKey}
EOF

# Private Key (Hex format) - KEEP SECRET!
PRIVATE_KEY_HEX=${keypair.privateKeyHex}

# WARNING: This file contains SECRET KEYS!
# Store securely and do not commit to version control!
# For server signers, add to mdserver/environment:
#   SERVER_SIGNER_UUID=${signerUuid}
#   SERVER_PRIVATE_KEY_PEM<<EOF
#   ${keypair.privateKey}
#   EOF
`;
  
  fs.writeFileSync(filepath, content, { mode: 0o600 }); // Restrict to owner only
  
  return { filename, filepath };
}

/**
 * Create signer record in database
 */
function createSignerRecord(db, signerUuid, signerName, signerType, publicKeyHex, algorithm) {
  db.prepare(`
    INSERT INTO signers (signeruuid, signer_name, publickey_type, hashtype, publickey)
    VALUES (?, ?, ?, ?, ?)
  `).run(signerUuid, signerName, algorithm, 'SHA256', publicKeyHex);
}

async function main() {
  console.log('='.repeat(70));
  console.log('Digital Signature Signer Creation');
  console.log('='.repeat(70));
  console.log();
  
  // Check if patchbin.db exists
  if (!fs.existsSync(PATCHBIN_DB)) {
    console.error(`Error: patchbin.db not found at ${PATCHBIN_DB}`);
    console.error('  Make sure you have set up the mdserver directory');
    process.exit(1);
  }
  
  // Prompt for signer details
  console.log('Signer Type:');
  console.log('  1. metadata - For signing gameversions, patchblobs, attachments, etc.');
  console.log('  2. server   - For signing server API responses');
  console.log();
  
  const typeChoice = await question('Select signer type (1 or 2): ');
  const signerType = typeChoice === '1' ? 'metadata' : 'server';
  
  console.log();
  const signerName = await question('Enter signer name: ');
  
  console.log();
  console.log('Signature Algorithm:');
  console.log('  1. ED25519 - Faster, smaller signatures (recommended)');
  console.log('  2. RSA     - Widely supported, larger keys');
  console.log();
  
  const algoChoice = await question('Select algorithm (1 or 2): ');
  const useED25519 = algoChoice !== '2';
  
  console.log();
  console.log('='.repeat(70));
  console.log('Generating Keypair...');
  console.log('='.repeat(70));
  console.log();
  
  // Generate keypair
  const keypair = useED25519 ? generateED25519Keypair() : generateRSAKeypair();
  const signerUuid = crypto.randomUUID();
  
  console.log(`✓ Generated ${keypair.algorithm} keypair`);
  console.log(`  Signer UUID: ${signerUuid}`);
  console.log(`  Signer Name: ${signerName}`);
  console.log(`  Signer Type: ${signerType}`);
  console.log();
  
  // Save keypair to file
  const { filename, filepath } = saveKeypair(signerUuid, signerName, signerType, keypair);
  console.log(`✓ Saved keypair to: ${filename}`);
  console.log(`  Location: ${filepath}`);
  console.log(`  Permissions: 600 (owner read/write only)`);
  console.log();
  
  // Create signer record in database
  const db = new Database(PATCHBIN_DB);
  
  try {
    createSignerRecord(db, signerUuid, signerName, signerType, keypair.publicKeyHex, keypair.algorithm);
    console.log('✓ Created signer record in patchbin.db');
    console.log();
  } catch (error) {
    console.error(`Error creating signer record: ${error.message}`);
    console.error('The keypair file was created but database insert failed.');
    process.exit(1);
  } finally {
    db.close();
  }
  
  // Display instructions
  console.log('='.repeat(70));
  console.log('Signer Created Successfully!');
  console.log('='.repeat(70));
  console.log();
  console.log('Public Key (safe to share):');
  console.log(keypair.publicKey);
  console.log();
  console.log('⚠️  IMPORTANT: Private key saved to file');
  console.log('   Keep the file secure and do NOT commit to version control!');
  console.log();
  
  if (signerType === 'server') {
    console.log('='.repeat(70));
    console.log('Server Signer Configuration');
    console.log('='.repeat(70));
    console.log();
    console.log('Add these to mdserver/environment file:');
    console.log();
    console.log(`SERVER_SIGNER_UUID=${signerUuid}`);
    console.log(`SERVER_SIGNER_ALGORITHM=${keypair.algorithm}`);
    console.log('SERVER_PRIVATE_KEY_PEM<<EOF');
    console.log(keypair.privateKey.trim());
    console.log('EOF');
    console.log();
    console.log('Or for single-line format:');
    console.log(`SERVER_PRIVATE_KEY_HEX=${keypair.privateKeyHex}`);
    console.log();
  } else {
    console.log('='.repeat(70));
    console.log('Metadata Signing');
    console.log('='.repeat(70));
    console.log();
    console.log('Use the signing tool to sign metadata records:');
    console.log(`  node sign_metadata.js --signer=${signerUuid} --table=attachments --record=RECORD_UUID`);
    console.log();
  }
  
  console.log('='.repeat(70));
  console.log('Signer Information');
  console.log('='.repeat(70));
  console.log();
  console.log(`Signer UUID:   ${signerUuid}`);
  console.log(`Signer Name:   ${signerName}`);
  console.log(`Signer Type:   ${signerType}`);
  console.log(`Algorithm:     ${keypair.algorithm}`);
  console.log(`Key File:      ${filename}`);
  console.log();
}

if (require.main === module) {
  main().catch(error => {
    console.error('Error:', error.message);
    process.exit(1);
  });
}

module.exports = { generateED25519Keypair, generateRSAKeypair, saveKeypair };

