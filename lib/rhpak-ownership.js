/**
 * rhpak-ownership.js
 *
 * Helpers for multi-owner RHPAK tracking via rhpakuuid (primary) and rhpakuuid2 (JSON array).
 * First element of rhpakuuid2 must match rhpakuuid when both are set.
 */

'use strict';

function parseRhpakuuid2(text, fallbackRhpakuuid) {
  if (text !== null && text !== undefined && String(text).trim()) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        return parsed.filter((entry) => entry && typeof entry === 'string');
      }
    } catch (_) {
      // fall through to fallback
    }
  }
  if (fallbackRhpakuuid) {
    return [fallbackRhpakuuid];
  }
  return [];
}

function formatRhpakuuid2(uuids) {
  const list = Array.isArray(uuids)
    ? uuids.filter((entry) => entry && typeof entry === 'string')
    : [];
  const deduped = [];
  for (const uuid of list) {
    if (!deduped.includes(uuid)) {
      deduped.push(uuid);
    }
  }
  return deduped.length > 0 ? JSON.stringify(deduped) : null;
}

function ownersInclude(owners, uuid) {
  if (!uuid) {
    return false;
  }
  return Array.isArray(owners) && owners.includes(uuid);
}

function ownersConflict(existingOwners, incomingUuid) {
  if (!incomingUuid) {
    return false;
  }
  const owners = Array.isArray(existingOwners) ? existingOwners : [];
  if (owners.length === 0) {
    return true;
  }
  return !owners.includes(incomingUuid);
}

function singleOwnerFields(rhpakuuid) {
  if (!rhpakuuid) {
    return { rhpakuuid: null, rhpakuuid2: null };
  }
  return {
    rhpakuuid,
    rhpakuuid2: formatRhpakuuid2([rhpakuuid]),
  };
}

function setPrimaryOwner(current, newPrimary, options = {}) {
  const linkPrevious = options.linkPrevious !== false;
  if (!newPrimary) {
    throw new Error('setPrimaryOwner requires newPrimary rhpakuuid.');
  }
  let owners = parseRhpakuuid2(current?.rhpakuuid2, current?.rhpakuuid);
  if (!linkPrevious) {
    owners = [newPrimary];
  } else if (owners.includes(newPrimary)) {
    owners = [newPrimary, ...owners.filter((uuid) => uuid !== newPrimary)];
  } else {
    owners = [newPrimary, ...owners];
  }
  return {
    rhpakuuid: newPrimary,
    rhpakuuid2: formatRhpakuuid2(owners),
  };
}

function addSecondaryOwner(current, uuid) {
  if (!uuid) {
    throw new Error('addSecondaryOwner requires uuid.');
  }
  const owners = parseRhpakuuid2(current?.rhpakuuid2, current?.rhpakuuid);
  if (owners.includes(uuid)) {
    return {
      rhpakuuid: current?.rhpakuuid || owners[0] || uuid,
      rhpakuuid2: formatRhpakuuid2(owners),
    };
  }
  const primary = current?.rhpakuuid || owners[0] || uuid;
  const next = primary === uuid ? [uuid, ...owners.filter((entry) => entry !== uuid)] : [...owners, uuid];
  if (!next.includes(primary)) {
    next.unshift(primary);
  }
  return {
    rhpakuuid: primary,
    rhpakuuid2: formatRhpakuuid2(next),
  };
}

function removeOwner(current, uuidToRemove) {
  let owners = parseRhpakuuid2(current?.rhpakuuid2, current?.rhpakuuid);
  if (owners.length === 0 && current?.rhpakuuid) {
    owners = [current.rhpakuuid];
  }
  if (!uuidToRemove) {
    return { rhpakuuid: current?.rhpakuuid || null, rhpakuuid2: current?.rhpakuuid2 || null, shouldDeleteRow: false };
  }
  if (!owners.includes(uuidToRemove) && current?.rhpakuuid !== uuidToRemove) {
    return {
      rhpakuuid: current?.rhpakuuid || null,
      rhpakuuid2: current?.rhpakuuid2 || null,
      shouldDeleteRow: false,
    };
  }
  const remaining = owners.filter((uuid) => uuid !== uuidToRemove);
  if (remaining.length === 0) {
    return { rhpakuuid: null, rhpakuuid2: null, shouldDeleteRow: true };
  }
  return {
    rhpakuuid: remaining[0],
    rhpakuuid2: formatRhpakuuid2(remaining),
    shouldDeleteRow: false,
  };
}

/**
 * Returns null when upsert is allowed; otherwise an error message matching newgame.js semantics.
 */
function getOwnershipBlockReason(existing, incomingRhpak, resourceLabel, options = {}) {
  if (!existing) {
    return null;
  }
  const owners = parseRhpakuuid2(existing.rhpakuuid2, existing.rhpakuuid);
  if (ownersInclude(owners, incomingRhpak)) {
    return null;
  }
  if (options.allowLink || options.forceOwnership) {
    return null;
  }
  if (owners.length === 0 && !existing.rhpakuuid) {
    return `${resourceLabel} was not installed via an rhpak and cannot be replaced.`;
  }
  const blockingOwner = existing.rhpakuuid || owners[0];
  return `${resourceLabel} belongs to rhpak ${blockingOwner} and cannot be replaced by ${incomingRhpak}.`;
}

function assertCanUpsertRhpakRow(existing, incomingRhpak, resourceLabel, options = {}) {
  const reason = getOwnershipBlockReason(existing, incomingRhpak, resourceLabel, options);
  if (reason) {
    throw new Error(reason);
  }
}

function mergeOwnerFieldsForUpsert(existing, incomingRhpak, options = {}) {
  if (!incomingRhpak) {
    throw new Error('mergeOwnerFieldsForUpsert requires incomingRhpak.');
  }
  if (!existing) {
    return singleOwnerFields(incomingRhpak);
  }
  const owners = parseRhpakuuid2(existing.rhpakuuid2, existing.rhpakuuid);
  if (ownersInclude(owners, incomingRhpak)) {
    const primary = existing.rhpakuuid || incomingRhpak;
    const normalized = primary === incomingRhpak
      ? [incomingRhpak, ...owners.filter((uuid) => uuid !== incomingRhpak)]
      : owners;
    return {
      rhpakuuid: primary,
      rhpakuuid2: formatRhpakuuid2(normalized.length ? normalized : [incomingRhpak]),
    };
  }
  if (options.allowLink || options.forceOwnership) {
    return addSecondaryOwner(existing, incomingRhpak);
  }
  assertCanUpsertRhpakRow(existing, incomingRhpak, 'Resource', options);
  return singleOwnerFields(incomingRhpak);
}

module.exports = {
  parseRhpakuuid2,
  formatRhpakuuid2,
  ownersInclude,
  ownersConflict,
  singleOwnerFields,
  setPrimaryOwner,
  addSecondaryOwner,
  removeOwner,
  getOwnershipBlockReason,
  assertCanUpsertRhpakRow,
  mergeOwnerFieldsForUpsert,
};
