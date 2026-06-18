const crypto = require('crypto');
const { nip19 } = require('nostr-tools');
const { verifyServerSignature } = require('./server-response-verify');

const AUTO_TRUST_SOURCE = 'rhserver-auto-trust';
const AUTO_TRUST_DECLARATION_PREFIX = 'rhserver-notary-auto-';

function expandPubkeyVariants(pubkey) {
  const variants = new Set();
  if (!pubkey) return [];
  const trimmed = String(pubkey).trim();
  if (!trimmed) return [];
  variants.add(trimmed.toLowerCase());
  if (trimmed.startsWith('npub')) {
    try {
      const decoded = nip19.decode(trimmed);
      if (decoded?.type === 'npub' && decoded.data) {
        variants.add(Buffer.from(decoded.data).toString('hex'));
      }
    } catch (_) {}
  } else if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    try {
      variants.add(nip19.npubEncode(trimmed).toLowerCase());
    } catch (_) {}
  }
  return Array.from(variants);
}

function notaryTrustDeclarationExists(db, notaryPubkeyHex) {
  const variants = expandPubkeyVariants(notaryPubkeyHex);
  if (!variants.length) return true;

  const rows = db.prepare(`
    SELECT target_keypair_fingerprint, target_keypair_public_hex, content_json
    FROM admindeclarations
    WHERE declaration_type = 'trust-declaration'
      AND status IN ('Published', 'Active', 'Signed')
      AND is_revoked = 0
  `).all();

  return rows.some((row) => {
    if (row.target_keypair_public_hex && variants.includes(row.target_keypair_public_hex.toLowerCase())) {
      return true;
    }
    if (row.target_keypair_fingerprint) {
      const fpVariants = expandPubkeyVariants(row.target_keypair_fingerprint);
      if (fpVariants.some((v) => variants.includes(v))) return true;
    }
  });
}

function ensureRhserverNotaryTrust(dbManager, notaryPubkeyHex) {
  if (!notaryPubkeyHex) return { created: false, reason: 'no_notary_pubkey' };

  const db = dbManager.getConnection('clientdata');
  if (notaryTrustDeclarationExists(db, notaryPubkeyHex)) {
    return { created: false, reason: 'already_trusted' };
  }

  const pubkeyHex = String(notaryPubkeyHex).toLowerCase();
  let npub;
  try {
    npub = nip19.npubEncode(pubkeyHex);
  } catch (_) {
    npub = pubkeyHex;
  }

  const now = Math.floor(Date.now() / 1000);
  const declarationUuid = `${AUTO_TRUST_DECLARATION_PREFIX}${crypto.createHash('sha256').update(pubkeyHex).digest('hex').slice(0, 32)}`;

  const content = {
    schema_version: '1.0',
    declaration_type: 'trust-declaration',
    issuer: {
      type: 'rhserver-api',
      canonical_name: 'smwresource.net RHServer',
      source: AUTO_TRUST_SOURCE
    },
    subject: {
      type: 'nostr',
      canonical_name: npub,
      fingerprint: npub,
      pubkey: pubkeyHex
    },
    content: {
      trust_level: 'operating-admin',
      usage_types: ['signing', 'moderation', 'metadata-updates', 'user-attestations'],
      scopes: [{ type: 'global', targets: ['*'], exclude: [] }],
      permissions: {
        can_sign_user_attestations: true,
        can_moderate: true,
        can_update_metadata: true,
        can_sign_trust_declarations: false,
        can_sign_operational_admins: false,
        can_delegate_moderators: false,
        can_delegate_updaters: false
      }
    },
    metadata: {
      reason: 'Auto-trusted RHServer notary after verified API connection',
      source: AUTO_TRUST_SOURCE
    }
  };

  const contentJson = JSON.stringify(content);
  const contentHash = crypto.createHash('sha256').update(contentJson).digest('hex');

  db.prepare(`
    INSERT INTO admindeclarations (
      declaration_uuid, declaration_type, content_json, content_hash_sha256,
      digital_signature, status, schema_version, content_version,
      signing_keypair_uuid, signing_keypair_fingerprint,
      target_keypair_uuid, target_keypair_fingerprint,
      target_keypair_canonical_name, target_keypair_public_hex,
      target_user_profile_id, valid_from, valid_until,
      required_countersignatures, current_countersignatures,
      retroactive_effect_enabled, retroactive_effective_from,
      is_local, is_revoked, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    declarationUuid,
    'trust-declaration',
    contentJson,
    contentHash,
    '',
    'Published',
    '1.0',
    1,
    null,
    null,
    null,
    npub,
    npub,
    pubkeyHex,
    null,
    now,
    null,
    0,
    0,
    0,
    null,
    1,
    0,
    now,
    now
  );

  return { created: true, declarationUuid, npub };
}

function verifyAndTrustRhserverResponse(dbManager, responseData) {
  if (!responseData?.server_signature) {
    return { verified: false, trusted: false, reason: 'no_server_signature' };
  }

  const result = verifyServerSignature(responseData, responseData.server_signature);
  if (!result.ok) {
    return { verified: false, trusted: false, reason: result.reason };
  }

  const notaryPubkey = responseData.rhserver_notary_pubkey || null;
  let trustResult = { created: false };
  if (notaryPubkey && dbManager) {
    trustResult = ensureRhserverNotaryTrust(dbManager, notaryPubkey);
  }

  return { verified: true, trusted: trustResult.created, trustResult };
}

module.exports = {
  AUTO_TRUST_SOURCE,
  ensureRhserverNotaryTrust,
  verifyAndTrustRhserverResponse,
  expandPubkeyVariants,
  notaryTrustDeclarationExists
};
