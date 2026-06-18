const crypto = require('crypto');

const RHServer_TRUST_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA6C4ZJko9QzpuLuO+ChL446DtcBG398DGa0fnixQ+81c=
-----END PUBLIC KEY-----`;

const RHServer_SIGNER_PUBLIC_KEY_HEX = '302a300506032b6570032100e82e19264a3d433a6e2ee3be0a12f8e3a0ed7011b7f7c0c66b47e78b143ef357';

const DEFAULT_ALGORITHM = 'ED25519';
const MAX_TIMESTAMP_SKEW_SEC = 86400;

function verifyServerSignature(responseData, serverSignature, options = {}) {
  try {
    if (!responseData?.response_timestamp) {
      return { ok: false, reason: 'missing_timestamp' };
    }

    const serverTime = new Date(responseData.response_timestamp).getTime();
    const clientTime = Date.now();
    const timeDiffSeconds = Math.abs(clientTime - serverTime) / 1000;
    const maxSkew = options.maxSkewSec || MAX_TIMESTAMP_SKEW_SEC;
    if (timeDiffSeconds > maxSkew) {
      return { ok: false, reason: 'timestamp_skew', timeDiffSeconds };
    }

    if (!serverSignature?.signature || !serverSignature?.hash) {
      return { ok: false, reason: 'missing_signature' };
    }

    const dataWithoutSignature = { ...responseData };
    delete dataWithoutSignature.server_signature;

    const dataString = JSON.stringify(dataWithoutSignature);
    const hash = crypto.createHash('sha256').update(dataString).digest();

    if (hash.toString('hex') !== serverSignature.hash) {
      return { ok: false, reason: 'hash_mismatch' };
    }

    const algorithm = serverSignature.algorithm || options.algorithm || DEFAULT_ALGORITHM;
    const publicKeyHex = options.publicKeyHex || RHServer_SIGNER_PUBLIC_KEY_HEX;
    const publicKey = crypto.createPublicKey({
      key: Buffer.from(publicKeyHex, 'hex'),
      format: 'der',
      type: 'spki'
    });

    let isValid;
    if (algorithm === 'ED25519') {
      isValid = crypto.verify(
        null,
        hash,
        publicKey,
        Buffer.from(serverSignature.signature, 'hex')
      );
    } else if (algorithm === 'RSA') {
      isValid = crypto.verify(
        'sha256',
        hash,
        { key: publicKey, padding: crypto.constants.RSA_PKCS1_PSS_PADDING },
        Buffer.from(serverSignature.signature, 'hex')
      );
    } else {
      return { ok: false, reason: 'unsupported_algorithm' };
    }

    return isValid ? { ok: true } : { ok: false, reason: 'invalid_signature' };
  } catch (error) {
    return { ok: false, reason: error.message };
  }
}

module.exports = {
  RHServer_TRUST_PEM,
  RHServer_SIGNER_PUBLIC_KEY_HEX,
  DEFAULT_ALGORITHM,
  verifyServerSignature
};
