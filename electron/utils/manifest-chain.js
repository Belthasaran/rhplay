/**
 * Dual-chain manifest resolution for dbmanifest.json targets.
 *
 * Chain storage in provisioned.json:
 * - (missing) — full chain implicit (legacy installs)
 * - "full"    — full chain chosen explicitly at provision time
 * - "light"   — light chain (metadata only; blobs via patch resolver / chunks)
 */

const CHAIN_LIGHT = 'light';
const CHAIN_FULL = 'full';
const CHAIN_FULL_IMPLICIT = 'full-implicit';

const CHAIN_KEYS = {
  [CHAIN_FULL]: { version: 'version', base: 'base', patches: 'sqlpatches' },
  [CHAIN_LIGHT]: { version: 'version:light', base: 'base:light', patches: 'sqlpatches:light' }
};

function parseDbChainArg(value) {
  if (value == null || value === '') return null;
  const v = String(value).trim().toLowerCase();
  if (v === 'light' || v === 'lightdb' || v === 'true') return CHAIN_LIGHT;
  if (v === 'full' || v === 'thick' || v === 'original' || v === 'false') return CHAIN_FULL;
  throw new Error(`Invalid db chain "${value}" (expected full or light)`);
}

function getEffectiveChain(provisionedEntry) {
  if (!provisionedEntry) return CHAIN_FULL_IMPLICIT;
  const c = provisionedEntry.chain;
  if (c === CHAIN_LIGHT) return CHAIN_LIGHT;
  if (c === CHAIN_FULL) return CHAIN_FULL;
  return CHAIN_FULL_IMPLICIT;
}

function chainUsesLightManifest(effectiveChain) {
  return effectiveChain === CHAIN_LIGHT;
}

function hasConfiguredLightBase(manifestEntry) {
  const base = manifestEntry?.['base:light'];
  if (!base || typeof base !== 'object') return false;
  return Boolean(base.file_name || base.sha256);
}

function hasLightChainInManifest(manifestEntry) {
  if (!manifestEntry) return false;
  if (manifestEntry['version:light'] != null) return true;
  if (hasConfiguredLightBase(manifestEntry)) return true;
  const patches = manifestEntry['sqlpatches:light'];
  return Array.isArray(patches) && patches.length > 0;
}

function resolveChainEntry(manifestEntry, chain) {
  const useLight = chain === CHAIN_LIGHT;
  const keys = useLight ? CHAIN_KEYS[CHAIN_LIGHT] : CHAIN_KEYS[CHAIN_FULL];
  const base = manifestEntry?.[keys.base];
  const sqlpatches = Array.isArray(manifestEntry?.[keys.patches])
    ? manifestEntry[keys.patches]
    : [];
  const versionRaw = manifestEntry?.[keys.version] ?? manifestEntry?.version ?? '0';

  if (useLight && (!base || !base.file_name) && sqlpatches.length === 0) {
    throw new Error(
      'Light chain requested but manifest has no base:light or sqlpatches:light for this target. '
      + 'Use full chain or update dbmanifest.json.'
    );
  }

  return {
    chain: useLight ? CHAIN_LIGHT : CHAIN_FULL,
    version: String(versionRaw),
    base: base || null,
    sqlpatches,
    versionKey: keys.version,
    baseKey: keys.base,
    patchesKey: keys.patches
  };
}

/**
 * Resolve which manifest slice to use for provision/update.
 * @param {object} manifestEntry
 * @param {object} options
 * @param {'full'|'light'|null} options.requestedChain - CLI/UI selection for new provision
 * @param {object|null} options.provisionedEntry - existing provisioned.json target row
 */
function resolveChainView(manifestEntry, { requestedChain = null, provisionedEntry = null } = {}) {
  let effective;
  if (requestedChain === CHAIN_LIGHT || requestedChain === CHAIN_FULL) {
    effective = requestedChain;
  } else {
    const stored = getEffectiveChain(provisionedEntry);
    effective = stored === CHAIN_LIGHT ? CHAIN_LIGHT : CHAIN_FULL;
  }

  const resolved = resolveChainEntry(manifestEntry, effective);

  let storeChain;
  if (requestedChain === CHAIN_LIGHT) {
    storeChain = CHAIN_LIGHT;
  } else if (requestedChain === CHAIN_FULL) {
    storeChain = CHAIN_FULL;
  } else if (provisionedEntry?.chain === CHAIN_LIGHT || provisionedEntry?.chain === CHAIN_FULL) {
    storeChain = provisionedEntry.chain;
  } else {
    storeChain = null;
  }

  return { ...resolved, effectiveChain: effective, storeChain };
}

function chainToStoreValue(requestedChain, existingEntry) {
  if (requestedChain === CHAIN_LIGHT) return CHAIN_LIGHT;
  if (requestedChain === CHAIN_FULL) return CHAIN_FULL;
  if (existingEntry?.chain === CHAIN_LIGHT || existingEntry?.chain === CHAIN_FULL) {
    return existingEntry.chain;
  }
  return null;
}

function formatChainLabel(effectiveChain) {
  switch (effectiveChain) {
    case CHAIN_LIGHT:
      return 'light';
    case CHAIN_FULL:
      return 'full (explicit)';
    default:
      return 'full (legacy)';
  }
}

function appendDbChainCliArgs(args, dbChain) {
  if (dbChain === CHAIN_LIGHT) {
    args.push('--db-chain', 'light');
  } else if (dbChain === CHAIN_FULL) {
    args.push('--db-chain', 'full');
  }
  return args;
}

/**
 * Pick a single chain flag for bulk reprovision (all light, else full).
 */
function detectDominantProvisionChain(provisioned, dbNames = []) {
  let sawLight = false;
  let sawFull = false;
  for (const dbName of dbNames) {
    const chain = getEffectiveChain(provisioned?.targets?.[dbName]);
    if (chain === CHAIN_LIGHT) sawLight = true;
    else sawFull = true;
  }
  if (sawLight && !sawFull) return CHAIN_LIGHT;
  return CHAIN_FULL;
}

module.exports = {
  CHAIN_LIGHT,
  CHAIN_FULL,
  CHAIN_FULL_IMPLICIT,
  CHAIN_KEYS,
  parseDbChainArg,
  getEffectiveChain,
  chainUsesLightManifest,
  hasConfiguredLightBase,
  hasLightChainInManifest,
  resolveChainEntry,
  resolveChainView,
  chainToStoreValue,
  formatChainLabel,
  appendDbChainCliArgs,
  detectDominantProvisionChain
};
