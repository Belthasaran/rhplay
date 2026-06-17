/**
 * Stateless SHA-256 proof-of-work solver (matches rhserver/src/lib/pow-stateless.js).
 *
 * Target: sha256(payloadString + ':' + nonce) has N leading zero nibbles (difficulty/4).
 */

const crypto = require('crypto');

function sha256Hex(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex');
}

function meetsDifficulty(hexHash, difficulty) {
  const n = Math.floor(Number(difficulty || 0) / 4);
  if (n <= 0) return true;
  return String(hexHash || '').startsWith('0'.repeat(n));
}

async function solvePow(payloadString, difficulty, maxAttempts = 2_000_000) {
  const prefix = '0'.repeat(Math.floor(Number(difficulty || 0) / 4));
  for (let nonce = 0; nonce < maxAttempts; nonce++) {
    const hex = sha256Hex(`${payloadString}:${nonce}`);
    if (hex.startsWith(prefix)) {
      return String(nonce);
    }
  }
  throw new Error('PoW solve failed within attempt limit');
}

module.exports = { solvePow, sha256Hex, meetsDifficulty };
