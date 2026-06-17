/**
 * Argon2D proof-of-work solver (matches RHServer challenge parameters).
 */

const crypto = require('crypto');

let argon2;
try {
  argon2 = require('argon2');
} catch (_) {
  argon2 = null;
}

/** Deterministic 16-byte salt (must match rhserver/src/lib/pow.js). */
function powSaltFromPayload(payload) {
  return crypto.createHash('sha256').update(String(payload)).digest().subarray(0, 16);
}

function powHashOptions(payload) {
  return {
    type: argon2.argon2d,
    hashLength: 32,
    timeCost: 2,
    memoryCost: 65536,
    parallelism: 1,
    salt: powSaltFromPayload(payload),
    raw: true
  };
}

async function solvePow(payload, difficulty, maxAttempts = 500000) {
  if (!argon2) {
    throw new Error('argon2 package required for RHServer PoW (npm install argon2)');
  }
  const prefix = '0'.repeat(Math.floor(difficulty / 4));
  for (let nonce = 0; nonce < maxAttempts; nonce++) {
    const input = `${payload}:${nonce}`;
    const hash = await argon2.hash(input, powHashOptions(payload));
    const hex = hash.toString('hex');
    if (hex.startsWith(prefix)) {
      return String(nonce);
    }
  }
  throw new Error('PoW solve failed within attempt limit');
}

module.exports = { solvePow, powSaltFromPayload, powHashOptions };
