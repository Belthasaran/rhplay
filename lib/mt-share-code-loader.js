'use strict';

const fs = require('fs');
const path = require('path');
const { parseShareCode, formatShareCodeError } = require('../electron/shared/mt-share-code');
const { buildPlanFromShareCode } = require('./mt-share-code-resolver');
const { installGameFromCatalogSha1 } = require('./catalog-game-from-sha1');
const { extractJitNames2 } = require('./jit-levels/jit-names2');
const { runJitLevelDetection } = require('./jit-levels/orchestrator');
const { normalizeLevelHex } = require('./mt-share-code-resolver');

/**
 * Build dependencies for share-code resolution in the Electron main process.
 * @param {object} ctx
 */
function createShareCodeLoaderContext(ctx) {
  const {
    dbManager,
    gameStager,
    userDataPath,
    clientDbPath,
    getClientSetting,
    manifestResolver,
    onProgress,
    ensureCatalogBase,
    downloadSevenZ,
    createRhpak,
    importRhpak,
  } = ctx;

  const rhdataDb = dbManager.getConnection('rhdata');

  async function runJitDetection(gameid, version) {
    const vanilla = getClientSetting('vanillaRomPath') || '';
    const flips = getClientSetting('flipsPath') || '';
    if (!vanilla || !fs.existsSync(vanilla) || !flips || !fs.existsSync(flips)) {
      throw new Error('Vanilla ROM or FLIPS not configured');
    }

    const tempBase = path.join(
      manifestResolver.getUserSpecificTempBase(),
      'share-code-jit',
      `${gameid}-${Date.now()}`
    );
    fs.mkdirSync(tempBase, { recursive: true });
    const patchedRomPath = path.join(tempBase, 'patched.sfc');

    const patchResult = await gameStager.createPatchedSFC({
      dbManager,
      gameid,
      version,
      vanillaRomPath: vanilla,
      flipsPath: flips,
      outputPath: patchedRomPath,
      userDataPath,
    });
    if (!patchResult.success) {
      throw new Error(patchResult.error || 'Failed to build patched ROM');
    }

    const projectRoot = path.resolve(__dirname, '..');
    return runJitLevelDetection({
      db: rhdataDb,
      gameid,
      version,
      patchedRomPath,
      tempBase,
      projectRoot,
      includeDbSources: true,
      runCalisto: false,
      jitlevelsZipPath: path.join(projectRoot, 'refmaterial', 'jitlevels.zip'),
      vanillaRomPath: vanilla,
      catalogIndexDir: path.join(projectRoot, 'jstools', 'smwc_world', 'bpsindex'),
      patchedRomSha1: patchResult.patchedRomSha1 || null,
      patchBpsSha256: patchResult.patchBpsSha256 || patchResult.patchSha256 || null,
      onProgress: (p) => onProgress?.(p.message || p.phase),
    });
  }

  async function lookupJitLevelName(gameid, version, levelHex) {
    const vanilla = getClientSetting('vanillaRomPath') || '';
    const flips = getClientSetting('flipsPath') || '';
    if (!vanilla || !fs.existsSync(vanilla) || !flips || !fs.existsSync(flips)) {
      return null;
    }
    const tempBase = path.join(
      manifestResolver.getUserSpecificTempBase(),
      'share-code-names',
      `${gameid}-${Date.now()}`
    );
    fs.mkdirSync(tempBase, { recursive: true });
    const patchedRomPath = path.join(tempBase, 'patched.sfc');
    const patchResult = await gameStager.createPatchedSFC({
      dbManager,
      gameid,
      version,
      vanillaRomPath: vanilla,
      flipsPath: flips,
      outputPath: patchedRomPath,
      userDataPath,
    });
    if (!patchResult.success) return null;
    const romBuffer = fs.readFileSync(patchedRomPath);
    const { levels } = extractJitNames2(romBuffer);
    const target = normalizeLevelHex(levelHex);
    const match = levels.find((l) => normalizeLevelHex(l.levelnumber) === target);
    return match?.levelname || null;
  }

  return {
    rhdataDb,
    onProgress,
    installFromCatalog: async (sha1) => installGameFromCatalogSha1({
      sha1,
      userDataPath,
      clientDbPath,
      rhdataDb,
      onProgress,
      downloadSevenZ: ctx.downloadSevenZ,
      createRhpak: ctx.createRhpak,
      importRhpak: ctx.importRhpak,
    }),
    resolveSmwcFileId: async (fileId) => {
      const { resolveSmwcFileIdToSha1 } = require('./mt-share-code-resolver');
      return resolveSmwcFileIdToSha1(rhdataDb, fileId);
    },
    runJitDetection,
    lookupJitLevelName,
  };
}

/**
 * @param {string} shareCode
 * @param {object} ctx — same as createShareCodeLoaderContext
 */
async function loadShareCodePlan(shareCode, ctx) {
  const parsed = parseShareCode(shareCode);
  if (!parsed.ok) {
    return { success: false, error: formatShareCodeError(parsed.error) };
  }

  const deps = createShareCodeLoaderContext(ctx);
  const result = await buildPlanFromShareCode(parsed, deps);

  if (!result.plan?.entries?.length) {
    return {
      success: false,
      error: result.warnings
        ? 'Could not resolve all games in the share code.'
        : formatShareCodeError({ kind: 'no-hacks' }),
      warnings: result.warnings,
    };
  }

  return {
    success: true,
    warnings: result.warnings,
    partial: result.partial,
    plan: result.plan,
  };
}

module.exports = {
  createShareCodeLoaderContext,
  loadShareCodePlan,
};
