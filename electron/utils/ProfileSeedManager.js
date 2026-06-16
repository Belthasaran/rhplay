/**
 * ProfileSeedManager
 * 
 * Utilities for managing master seeds and did:pkh generation for user profiles.
 * Implements the spec from devdocs/profile_extension_spec_v0.1.md
 */

const crypto = require('crypto');
const secp256k1 = require('@noble/secp256k1'); // For Ethereum wallet derivation

/**
 * Generate a 256-bit (32-byte) master seed
 * @returns {Buffer} 32-byte random seed
 */
function generateMasterSeed() {
  return crypto.randomBytes(32);
}

/**
 * Encrypt master seed using Profile Guard key
 * @param {Buffer} masterSeed - 32-byte master seed
 * @param {Buffer} keyguardKey - Profile Guard key (32-byte)
 * @returns {string} Encrypted seed in IV:HEX format
 */
function encryptMasterSeed(masterSeed, keyguardKey) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', keyguardKey, iv);
  let encrypted = cipher.update(masterSeed);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

/**
 * Decrypt master seed using Profile Guard key
 * @param {string} encryptedSeed - Encrypted seed in IV:HEX format
 * @param {Buffer} keyguardKey - Profile Guard key (32-byte)
 * @returns {Buffer} 32-byte master seed
 */
function decryptMasterSeed(encryptedSeed, keyguardKey) {
  const parts = encryptedSeed.split(':');
  if (parts.length !== 2) {
    throw new Error('Invalid encrypted seed format');
  }
  const iv = Buffer.from(parts[0], 'hex');
  const encrypted = Buffer.from(parts[1], 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cbc', keyguardKey, iv);
  let decrypted = decipher.update(encrypted);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted;
}

/**
 * Derive Ethereum wallet private key from master seed
 * Uses derivation path: m/identity/ethereum/0
 * @param {Buffer} masterSeed - 32-byte master seed
 * @returns {Object} { privateKey: Buffer, publicKey: Buffer, address: string }
 */
function deriveEthereumWallet(masterSeed) {
  // For Ethereum, we use secp256k1 curve with BIP44 path m/44'/60'/0'/0/0
  // But per spec, we use m/identity/ethereum/0
  // We'll use a simpler approach: derive from master seed directly for now
  // TODO: Implement proper BIP32/BIP44 derivation for secp256k1
  
  // For now, use HKDF to derive a deterministic key from the seed
  // In production, use proper BIP32 derivation: m/identity/ethereum/0
  const derivationPath = 'm/identity/ethereum/0';
  
  // Use HKDF to derive a key from master seed + derivation path
  const salt = Buffer.from('profile-seed-ethereum', 'utf8');
  const info = Buffer.from(derivationPath, 'utf8');
  const derivedKey = crypto.createHmac('sha256', salt)
    .update(masterSeed)
    .update(info)
    .digest();
  
  // Ensure the private key is valid for secp256k1 (must be < secp256k1 order)
  const secp256k1Order = Buffer.from('FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141', 'hex');
  let privateKey = derivedKey;
  
  // If derived key is >= order, reduce it
  while (privateKey.compare(secp256k1Order) >= 0) {
    privateKey = crypto.createHash('sha256').update(privateKey).digest();
  }
  
  // Get public key from private key (uncompressed, 65 bytes: 0x04 + 64 bytes)
  const publicKey = secp256k1.getPublicKey(privateKey, false); // false = uncompressed
  
  // Derive Ethereum address from public key (last 20 bytes of keccak256 hash)
  // Ethereum uses keccak256 (SHA-3 variant)
  const keccak = require('keccak');
  // Convert to Buffer if it's a Uint8Array (secp256k1 returns Uint8Array)
  const publicKeyBuffer = Buffer.isBuffer(publicKey) ? publicKey : Buffer.from(publicKey);
  const publicKeyWithoutPrefix = publicKeyBuffer.slice(1); // Remove 0x04 prefix (first byte)
  const hash = keccak('keccak256').update(publicKeyWithoutPrefix).digest();
  const address = '0x' + hash.slice(-20).toString('hex');
  
  return {
    privateKey,
    publicKey,
    address
  };
}

/**
 * Derive a deterministic 32-byte seed for an identity purpose/path.
 * This uses the same HMAC-SHA256 approach as deriveEthereumWallet (HKDF-like).
 *
 * @param {Buffer} masterSeed - 32-byte master seed
 * @param {string} derivationPath - e.g. "m/identity/nostr/0"
 * @param {string} saltLabel - e.g. "profile-seed-nostr"
 * @returns {Buffer} 32-byte derived seed
 */
function deriveIdentitySeed(masterSeed, derivationPath, saltLabel) {
  const salt = Buffer.from(saltLabel, 'utf8');
  const info = Buffer.from(derivationPath, 'utf8');
  return crypto.createHmac('sha256', salt).update(masterSeed).update(info).digest();
}

/**
 * Derive Nostr private key bytes from master seed.
 * Path: m/identity/nostr/0 (per devdocs/profile_extension_spec_v0.1.md).
 *
 * @param {Buffer} masterSeed - 32-byte master seed
 * @returns {Uint8Array} 32-byte private key bytes
 */
function deriveNostrKeyFromSeed(masterSeed) {
  const derivationPath = 'm/identity/nostr/0';
  const seed = deriveIdentitySeed(masterSeed, derivationPath, 'profile-seed-nostr');
  return new Uint8Array(seed);
}

/**
 * Derive ML-DSA-44 seed (32 bytes) from master seed.
 * Path: m/identity/mldsa/0.
 *
 * @param {Buffer} masterSeed - 32-byte master seed
 * @returns {Uint8Array} 32-byte seed
 */
function deriveMldsa44SeedFromMasterSeed(masterSeed) {
  const derivationPath = 'm/identity/mldsa/0';
  const seed = deriveIdentitySeed(masterSeed, derivationPath, 'profile-seed-mldsa44');
  return new Uint8Array(seed);
}

/**
 * Generate did:pkh from Ethereum address
 * Format: did:pkh:eip155:1:<EthereumAddress>
 * @param {string} ethereumAddress - Ethereum address (0x... format)
 * @returns {string} did:pkh identifier
 */
function generateDidPkh(ethereumAddress) {
  // Remove 0x prefix if present
  const address = ethereumAddress.startsWith('0x') ? ethereumAddress.slice(2) : ethereumAddress;
  // Ensure lowercase
  const lowerAddress = address.toLowerCase();
  return `did:pkh:eip155:1:0x${lowerAddress}`;
}

/**
 * Encrypt Ethereum private key using Profile Guard key
 * @param {Buffer} ethereumPrivateKey - 32-byte Ethereum private key
 * @param {Buffer} keyguardKey - Profile Guard key (32-byte)
 * @returns {string} Encrypted private key in IV:HEX format
 */
function encryptEthereumPrivateKey(ethereumPrivateKey, keyguardKey) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', keyguardKey, iv);
  let encrypted = cipher.update(ethereumPrivateKey);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

/**
 * Generate master seed, derive Ethereum wallet, and create did:pkh
 * 
 * PRIVATE (must be encrypted):
 * - master_seed: Stored encrypted in database column encrypted_master_seed
 * - ethereum_privkey: Stored encrypted in profile JSON blob
 * 
 * PUBLIC (can be stored in plaintext):
 * - ethereum_address: Stored in profile JSON blob
 * - did_pkh: Stored in database column did_pkh and can be in profile JSON
 * 
 * @param {Buffer} keyguardKey - Profile Guard key (32-byte)
 * @returns {Object} { encryptedSeed, encryptedEthereumPrivateKey, ethereumAddress, didPkh, seedGeneratedAt }
 */
function generateProfileSeedAndDidPkh(keyguardKey) {
  // Generate master seed
  const masterSeed = generateMasterSeed();
  
  // Encrypt master seed (PRIVATE - stored in database column)
  const encryptedSeed = encryptMasterSeed(masterSeed, keyguardKey);
  
  // Derive Ethereum wallet from master seed
  const ethereumWallet = deriveEthereumWallet(masterSeed);
  
  // Encrypt Ethereum private key (PRIVATE - stored in encrypted profile JSON)
  const encryptedEthereumPrivateKey = encryptEthereumPrivateKey(ethereumWallet.privateKey, keyguardKey);
  
  // Ethereum address (PUBLIC - stored in profile JSON)
  const ethereumAddress = ethereumWallet.address;
  
  // Generate did:pkh (PUBLIC - stored in database column and can be in profile JSON)
  const didPkh = generateDidPkh(ethereumAddress);
  
  return {
    encryptedSeed, // PRIVATE - encrypted master seed for database column
    encryptedEthereumPrivateKey, // PRIVATE - encrypted Ethereum private key for profile JSON
    ethereumAddress, // PUBLIC - Ethereum address for profile JSON
    didPkh, // PUBLIC - did:pkh identifier for database column and profile JSON
    seedGeneratedAt: new Date().toISOString()
  };
}

/**
 * Check if profile needs master seed generation
 * @param {Database} db - Database connection
 * @param {string} profileUuid - Profile UUID
 * @returns {boolean} True if profile needs seed generation
 */
function needsSeedGeneration(db, profileUuid) {
  const row = db.prepare(`
    SELECT encrypted_master_seed FROM user_profiles WHERE profile_uuid = ?
  `).get(profileUuid);
  
  return !row || !row.encrypted_master_seed;
}

module.exports = {
  generateMasterSeed,
  encryptMasterSeed,
  decryptMasterSeed,
  deriveEthereumWallet,
  encryptEthereumPrivateKey,
  generateDidPkh,
  generateProfileSeedAndDidPkh,
  needsSeedGeneration,
  deriveIdentitySeed,
  deriveNostrKeyFromSeed,
  deriveMldsa44SeedFromMasterSeed
};

