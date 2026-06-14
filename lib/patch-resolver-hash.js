/**
 * patch-resolver-hash.js - Integrity verification for patch resolution
 */

const crypto = require('crypto');

function sha224(buffer) {
  return crypto.createHash('sha224').update(buffer).digest('hex');
}

function sha1(buffer) {
  return crypto.createHash('sha1').update(buffer).digest('hex');
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function verifyPatchBuffer(buffer, patchblob, attachmentMeta) {
  const verified = { pat_sha224: false, pat_sha1: false };
  const errors = [];

  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) {
    return { ok: false, verified, errors: ['Empty patch buffer'] };
  }

  const computed224 = sha224(buffer);
  if (patchblob.pat_sha224) {
    if (computed224 !== patchblob.pat_sha224) {
      errors.push(`pat_sha224 mismatch: expected ${patchblob.pat_sha224}, got ${computed224}`);
    } else {
      verified.pat_sha224 = true;
    }
  } else {
    verified.pat_sha224 = true;
  }

  if (patchblob.pat_sha1) {
    const computed1 = sha1(buffer);
    if (computed1 !== patchblob.pat_sha1) {
      errors.push(`pat_sha1 mismatch: expected ${patchblob.pat_sha1}, got ${computed1}`);
    } else {
      verified.pat_sha1 = true;
    }
  } else {
    verified.pat_sha1 = true;
  }

  if (attachmentMeta && attachmentMeta.decoded_hash_sha224) {
    if (computed224 !== attachmentMeta.decoded_hash_sha224) {
      errors.push(`attachments.decoded_hash_sha224 mismatch`);
    }
  }

  return { ok: errors.length === 0, verified, errors };
}

function verifyPatchblobBuffer(buffer, patchblob, attachmentMeta) {
  const errors = [];
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) {
    return { ok: false, errors: ['Empty patchblob buffer'] };
  }

  const computed224 = sha224(buffer);
  if (patchblob.patchblob1_sha224 && computed224 !== patchblob.patchblob1_sha224) {
    errors.push(`patchblob1_sha224 mismatch: expected ${patchblob.patchblob1_sha224}, got ${computed224}`);
  }

  if (attachmentMeta && attachmentMeta.file_hash_sha224) {
    if (computed224 !== attachmentMeta.file_hash_sha224) {
      errors.push('attachments.file_hash_sha224 mismatch');
    }
  }

  return { ok: errors.length === 0, errors };
}

module.exports = {
  sha224,
  sha1,
  sha256,
  verifyPatchBuffer,
  verifyPatchblobBuffer
};
