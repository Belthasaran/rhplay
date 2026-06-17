/**
 * Build SMWResource /connect/rhplay query parameters from a profile object.
 */

const crypto = require('crypto');

function buildConnectMessage({ profile_uuid, nostr_pubkey, mldsa_pubkey_sha256, connect_ts }) {
  const nostr = String(nostr_pubkey).toLowerCase();
  const mldsa = String(mldsa_pubkey_sha256).toLowerCase();
  return `rhplay-connect:${profile_uuid}:${nostr}:${mldsa}:${connect_ts}`;
}

/**
 * Merge authoritative keypairs from profile_keypairs when profile_json is incomplete.
 */
function resolveProfileConnectKeypairs(profile, profileUuid, profileManager) {
  if (!profileManager || !profileUuid) {
    return profile;
  }

  const keypairs = profileManager.getProfileKeypairs(profileUuid);
  const resolved = { ...profile };

  const primaryFromDb = keypairs.find((kp) => kp.keyUsage === 'primary' && kp.type === 'Nostr');
  if (primaryFromDb?.publicKeyHex) {
    resolved.primaryKeypair = {
      ...(resolved.primaryKeypair || {}),
      type: 'Nostr',
      publicKey: primaryFromDb.publicKey || resolved.primaryKeypair?.publicKey,
      publicKeyHex: primaryFromDb.publicKeyHex,
      fingerprint: primaryFromDb.fingerprint || resolved.primaryKeypair?.fingerprint
    };
  } else if (!resolved.primaryKeypair?.publicKeyHex && primaryFromDb) {
    resolved.primaryKeypair = primaryFromDb;
  }

  const additional = Array.isArray(resolved.additionalKeypairs)
    ? [...resolved.additionalKeypairs]
    : [];
  const mldsaFromDb = keypairs.find(
    (kp) => kp.keyUsage === 'additional' && kp.type === 'ML-DSA-44' && kp.publicKeyHex
  );
  if (mldsaFromDb && !additional.some((kp) => kp && kp.type === 'ML-DSA-44' && kp.publicKeyHex)) {
    additional.push(mldsaFromDb);
  }
  resolved.additionalKeypairs = additional;

  return resolved;
}

function buildProfileConnectParams(profile, profileUuid, options = {}) {
  if (!profile) {
    throw new Error('Profile not found');
  }

  const uuid = profileUuid || profile.profileId;
  if (!uuid) {
    throw new Error('Profile UUID is required');
  }

  const resolvedProfile = resolveProfileConnectKeypairs(
    profile,
    uuid,
    options.profileManager || null
  );

  const username = typeof resolvedProfile.username === 'string'
    ? resolvedProfile.username.trim().toLowerCase()
    : '';
  if (!username) {
    throw new Error('Profile username is required');
  }

  const primary = resolvedProfile.primaryKeypair;
  if (!primary || primary.type !== 'Nostr' || !primary.publicKeyHex) {
    throw new Error('Nostr primary keypair is required');
  }

  const additional = Array.isArray(resolvedProfile.additionalKeypairs)
    ? resolvedProfile.additionalKeypairs
    : [];
  const mldsa = additional.find((kp) => kp && kp.type === 'ML-DSA-44' && kp.publicKeyHex);
  if (!mldsa) {
    throw new Error('ML-DSA-44 additional keypair is required');
  }

  const mldsaPubkeySha256 = crypto.createHash('sha256')
    .update(Buffer.from(mldsa.publicKeyHex, 'hex'))
    .digest('hex');

  return {
    profile_uuid: uuid,
    username,
    nostr_pubkey: primary.publicKeyHex,
    mldsa_pubkey_sha256: mldsaPubkeySha256
  };
}

/**
 * Build signed connect params for /connect/rhplay (requires Nostr signing callback).
 * @param {Function} signNostrMessage - async (message) => nostr event
 */
async function buildSignedProfileConnectParams(profile, profileUuid, options = {}) {
  const params = buildProfileConnectParams(profile, profileUuid, options);
  const signNostrMessage = options.signNostrMessage;
  if (typeof signNostrMessage !== 'function') {
    throw new Error('signNostrMessage callback is required for signed connect');
  }

  if (options.signingPubkeyHex) {
    params.nostr_pubkey = String(options.signingPubkeyHex).toLowerCase();
  }

  const connect_ts = Math.floor(Date.now() / 1000);
  const message = buildConnectMessage({ ...params, connect_ts });
  const connect_event = await signNostrMessage(message);
  const connect_event_b64 = Buffer.from(JSON.stringify(connect_event)).toString('base64url');

  return {
    ...params,
    connect_ts,
    connect_event: connect_event_b64
  };
}

module.exports = {
  buildConnectMessage,
  buildProfileConnectParams,
  buildSignedProfileConnectParams,
  resolveProfileConnectKeypairs
};
