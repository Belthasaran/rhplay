/**
 * Read JWT exp claim for client-side scheduling (not cryptographic verification).
 */

function decodeJwtPayload(accessToken) {
  if (!accessToken || typeof accessToken !== 'string') return null;
  const parts = accessToken.split('.');
  if (parts.length < 2) return null;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

function decodeJwtExp(accessToken) {
  const payload = decodeJwtPayload(accessToken);
  if (!payload || typeof payload.exp !== 'number') return null;
  return payload.exp;
}

module.exports = {
  decodeJwtPayload,
  decodeJwtExp
};
