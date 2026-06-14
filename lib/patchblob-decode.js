/**
 * patchblob-decode.js - Canonical patchblob decode (LZMA → Fernet → LZMA)
 */

const fernet = require('fernet');
const lzma = require('lzma-native');

/**
 * Decode encrypted patchblob bytes to raw BPS patch data.
 * @param {Buffer} encryptedData
 * @param {string} keyBase64 - patchblob1_key from patchblobs table
 * @returns {Promise<Buffer>}
 */
async function decodeBlob(encryptedData, keyBase64) {
  const decompressed1 = await new Promise((resolve, reject) => {
    lzma.decompress(encryptedData, (result, error) => {
      if (error) reject(error);
      else resolve(Buffer.from(result));
    });
  });

  let fernetKey;
  try {
    const decoded = Buffer.from(keyBase64, 'base64').toString('utf8');
    if (/^[A-Za-z0-9+/\-_]+=*$/.test(decoded) && decoded.length >= 40) {
      fernetKey = decoded;
    } else {
      fernetKey = keyBase64;
    }
  } catch (error) {
    fernetKey = keyBase64;
  }

  const frnsecret = new fernet.Secret(fernetKey);
  let tokenStr;
  try {
    tokenStr = decompressed1.toString('utf8');
  } catch (error) {
    tokenStr = decompressed1.toString('latin1');
  }
  const token = new fernet.Token({
    secret: frnsecret,
    ttl: 0,
    token: tokenStr
  });
  const decrypted = token.decode();

  let lzmaData;
  const hasNonAscii = /[^\x00-\x7F]/.test(decrypted);

  if (hasNonAscii) {
    lzmaData = Buffer.from(decrypted, 'latin1');
  } else {
    lzmaData = Buffer.from(decrypted, 'base64');
    if (lzmaData[0] !== 0xfd && lzmaData[0] !== 0x5d) {
      try {
        const decoded1Str = lzmaData.toString('utf8');
        lzmaData = Buffer.from(decoded1Str, 'base64');
      } catch (e) {
        try {
          const decoded1Str = lzmaData.toString('latin1');
          lzmaData = Buffer.from(decoded1Str, 'base64');
        } catch (e2) {
          // keep original lzmaData
        }
      }
    }
  }

  const decompressed2 = await new Promise((resolve, reject) => {
    lzma.decompress(lzmaData, (result, error) => {
      if (error) reject(error);
      else resolve(Buffer.from(result));
    });
  });

  return decompressed2;
}

module.exports = {
  decodeBlob
};
