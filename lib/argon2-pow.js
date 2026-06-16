/**
 * Argon2D proof-of-work solver (matches RHServer challenge parameters).
 */

let argon2;
try {
  argon2 = require('argon2');
} catch (_) {
  argon2 = null;
}

async function solvePow(payload, difficulty, maxAttempts = 500000) {
  if (!argon2) {
    throw new Error('argon2 package required for RHServer PoW (npm install argon2)');
  }
  const prefix = '0'.repeat(Math.floor(difficulty / 4));
  for (let nonce = 0; nonce < maxAttempts; nonce++) {
    const input = `${payload}:${nonce}`;
    const hash = await argon2.hash(input, {
      type: argon2.argon2d,
      hashLength: 32,
      timeCost: 2,
      memoryCost: 65536,
      parallelism: 1,
      raw: true
    });
    const hex = hash.toString('hex');
    if (hex.startsWith(prefix)) {
      return String(nonce);
    }
  }
  throw new Error('PoW solve failed within attempt limit');
}

module.exports = { solvePow };
