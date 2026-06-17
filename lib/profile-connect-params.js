/**
 * Build SMWResource /connect/rhplay query parameters from a profile object.
 */

const crypto = require('crypto');

/**
 * Merge authoritative keypairs from profile_keypairs when profile_json is incomplete.
 * @param {Object} profile
 * @param {string} profileUuid
 * @param {Object|null} profileManager - OnlineProfileManager instance
 * @returns {Object}
 */
function resolveProfileConnectKeypairs(profile, profileUuid, profileManager) {
  if (!profileManager || !profileUuid) {
    return profile;
  }

  const keypairs = profileManager.getProfileKeypairs(profileUuid);
  const resolved = { ...profile };

  if (!resolved.primaryKeypair?.publicKeyHex) {
    const primaryFromDb = keypairs.find((kp) => kp.keyUsage === 'primary' && kp.type === 'Nostr');
    if (primaryFromDb) {
      resolved.primaryKeypair = primaryFromDb;
    }
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

module.exports = {
  buildProfileConnectParams,
  resolveProfileConnectKeypairs
};
