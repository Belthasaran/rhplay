/**
 * Merge social ID arrays from local RHPlay profile and RHServer hosted profile.
 * One entry per type; verified wins; addedAt / attestation recency tie-breaks.
 */

const VERIFIED_STATUSES = new Set(['verified_unconfirmed', 'confirmed', 'accepted']);

function normalizeType(type) {
  return String(type || '').trim().toLowerCase();
}

function isVerified(entry) {
  if (!entry) return false;
  if (entry.verified === true) return true;
  const status = entry.clientVerificationStatus;
  return VERIFIED_STATUSES.has(status);
}

function getAddedAt(entry) {
  const n = Number(entry?.addedAt);
  return Number.isFinite(n) ? n : 0;
}

function getAttestedAt(entry) {
  const n = Number(entry?.smwresourceAttestation?.attestedAt);
  return Number.isFinite(n) ? n : 0;
}

function mergeMetadata(winner, loser) {
  const merged = { ...loser, ...winner };
  if (!merged.smwresourceAttestation && loser.smwresourceAttestation) {
    merged.smwresourceAttestation = loser.smwresourceAttestation;
  }
  if (!merged.providerUserId && loser.providerUserId) {
    merged.providerUserId = loser.providerUserId;
  }
  if (!merged.idpLinkedAt && loser.idpLinkedAt) {
    merged.idpLinkedAt = loser.idpLinkedAt;
  }
  if (merged.clientVerificationStatus === undefined && loser.clientVerificationStatus) {
    merged.clientVerificationStatus = loser.clientVerificationStatus;
  }
  return merged;
}

function pickWinner(a, b, indexA, indexB) {
  const va = isVerified(a);
  const vb = isVerified(b);
  if (va && !vb) return { winner: a, loser: b };
  if (vb && !va) return { winner: b, loser: a };

  const aa = getAttestedAt(a);
  const ab = getAttestedAt(b);
  if (aa && ab && aa !== ab) {
    return aa > ab ? { winner: a, loser: b } : { winner: b, loser: a };
  }
  if (aa && !ab) return { winner: a, loser: b };
  if (ab && !aa) return { winner: b, loser: a };

  const da = getAddedAt(a);
  const db = getAddedAt(b);
  if (da !== db) {
    return da > db ? { winner: a, loser: b } : { winner: b, loser: a };
  }

  return indexB > indexA ? { winner: b, loser: a } : { winner: a, loser: b };
}

/**
 * @param {Array} localIds
 * @param {Array} remoteIds
 * @param {{ smwresourceValue?: string, smwresourceSource?: string }} [opts]
 */
function mergeSocialIds(localIds = [], remoteIds = [], opts = {}) {
  const byType = new Map();
  const order = [];

  const all = [
    ...(Array.isArray(localIds) ? localIds : []),
    ...(Array.isArray(remoteIds) ? remoteIds : [])
  ];

  all.forEach((raw, idx) => {
    if (!raw || !raw.type) return;
    const type = normalizeType(raw.type);
    const entry = { ...raw, type };

    if (!byType.has(type)) {
      byType.set(type, { entry, index: idx });
      order.push(type);
      return;
    }

    const prev = byType.get(type);
    const { winner, loser } = pickWinner(prev.entry, entry, prev.index, idx);
    byType.set(type, { entry: mergeMetadata(winner, loser), index: Math.max(prev.index, idx) });
  });

  const result = order.map((t) => byType.get(t).entry);

  const smwVal = opts.smwresourceValue;
  if (smwVal) {
    const smwType = 'smwresource';
    const existing = result.find((s) => normalizeType(s.type) === smwType);
    if (!existing) {
      result.unshift({
        type: smwType,
        value: String(smwVal),
        tier: 1,
        verified: true,
        source: opts.smwresourceSource || 'rhplay_bind'
      });
    } else if (!existing.verified) {
      existing.verified = true;
      existing.tier = existing.tier || 1;
    }
  }

  return result;
}

module.exports = {
  mergeSocialIds,
  normalizeType,
  isVerified,
  getAddedAt,
  getAttestedAt
};
