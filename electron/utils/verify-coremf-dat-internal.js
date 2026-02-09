/**
 * verify-coremf-dat-internal.js
 *
 * Internal verification function for coremanifest.dat (works with Buffer, not file paths)
 * Used by coremanifest-updater.js
 */

const crypto = require('crypto');
const lzma = require('lzma-native');
const manifestResolver = require('./manifest-resolver');

// Hardcoded public key for verification
const EXPECTED_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAg2OfoECrhroIOmtHhn2mPMtXBN9NspqN8VNO1v3lBxg=
-----END PUBLIC KEY-----`;

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
 * Verify coremanifest.dat from Buffer
 * 
 * @param {Buffer} fileData - coremanifest.dat file data
 * @returns {Promise<Object>} { valid: boolean, manifest?: object, lastupdated?: number, versionid?: number, error?: string }
 */
async function verifyCoreManifestDat(fileData) {
  const fileSize = fileData.length;

  // Minimum size: 20 (header) + 64 (SHA512) + 64 (signature) = 148 bytes
  if (fileSize < 148) {
    return {
      valid: false,
      error: `File too small: ${fileSize} bytes (minimum 148 bytes)`
    };
  }

  // Parse header
  const lastupdated = Number(readUInt64BE(fileData, 0));
  const versionid = Number(readUInt64BE(fileData, 8));
  const compressedSize = readUInt32BE(fileData, 16);

  // Validate lastupdated
  const now = Math.floor(Date.now() / 1000);
  if (lastupdated > now) {
    return {
      valid: false,
      error: `lastupdated is in the future: ${lastupdated} > ${now}`
    };
  }

  // Validate compressed size
  const expectedMinSize = 20 + compressedSize + 64 + 64;
  if (fileSize < expectedMinSize) {
    return {
      valid: false,
      error: `File size mismatch: expected at least ${expectedMinSize} bytes, got ${fileSize}`
    };
  }

  // Extract payload (header + compressed data)
  const payload = fileData.slice(0, 20 + compressedSize);

  // Extract SHA512 digest (64 bytes)
  const storedSha512 = fileData.slice(20 + compressedSize, 20 + compressedSize + 64);

  // Extract signature (64 bytes)
  const signature = fileData.slice(20 + compressedSize + 64, 20 + compressedSize + 64 + 64);

  // Verify SHA512
  const computedSha512 = crypto.createHash('sha512').update(payload).digest();

  if (!computedSha512.equals(storedSha512)) {
    return {
      valid: false,
      error: 'SHA512 mismatch! File may be corrupted or tampered with.'
    };
  }

  // Verify Ed25519 signature
  const publicKey = crypto.createPublicKey(EXPECTED_PUBLIC_KEY_PEM);
  
  // Verify signature over the SHA512 digest (not the payload)
  const verified = crypto.verify(null, computedSha512, publicKey, signature);
  
  if (!verified) {
    return {
      valid: false,
      error: 'Ed25519 signature verification failed! File may be tampered with or signed with wrong key.'
    };
  }

  // Extract compressed data
  const compressedData = fileData.slice(20, 20 + compressedSize);

  // Decompress
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
    return {
      valid: false,
      error: `Failed to parse decompressed JSON: ${err.message}`
    };
  }

  // Validate lastupdated in JSON matches header
  const jsonLastupdated = manifestResolver.normalizeLastUpdated(manifest.lastupdated);
  if (jsonLastupdated === null) {
    console.warn('[verify-coremf-dat-internal] Warning: JSON missing or invalid lastupdated');
  } else if (jsonLastupdated !== lastupdated) {
    console.warn(`[verify-coremf-dat-internal] Warning: JSON lastupdated (${jsonLastupdated}) differs from header (${lastupdated})`);
  }

  return {
    valid: true,
    manifest,
    lastupdated,
    versionid
  };
}

module.exports = {
  verifyCoreManifestDat
};
