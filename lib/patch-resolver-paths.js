/**
 * patch-resolver-paths.js - App-data directories for patch resolution
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

function ensureDirectory(dirPath) {
  if (!dirPath) return;
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function getUserDataRoot(ctx) {
  if (ctx && ctx.userDataPath) {
    return ctx.userDataPath;
  }
  if (process.env.PATCH_RESOLVER_USER_DATA) {
    return process.env.PATCH_RESOLVER_USER_DATA;
  }
  return null;
}

function getPatchDir(ctx) {
  if (process.env.PATCH_RESOLVER_PATCH_DIR) {
    return process.env.PATCH_RESOLVER_PATCH_DIR;
  }
  const root = getUserDataRoot(ctx);
  return root ? path.join(root, 'patch') : null;
}

function getPblobsDir(ctx) {
  if (process.env.PATCH_RESOLVER_PBLOBS_DIR) {
    return process.env.PATCH_RESOLVER_PBLOBS_DIR;
  }
  const root = getUserDataRoot(ctx);
  return root ? path.join(root, 'pblobs') : null;
}

function getPatchCacheDir(ctx) {
  const root = getUserDataRoot(ctx);
  return root ? path.join(root, 'cache', 'patch') : null;
}

function getPblobCacheDir(ctx) {
  const root = getUserDataRoot(ctx);
  return root ? path.join(root, 'cache', 'pblobs') : null;
}

function getArtifactStoreDir(ctx) {
  if (process.env.ARTIFACT_STORE_DIR) {
    return process.env.ARTIFACT_STORE_DIR;
  }
  const root = getUserDataRoot(ctx);
  return root ? path.join(root, 'artifacts') : null;
}

function getRhpakInstalledDir(ctx) {
  const root = getUserDataRoot(ctx);
  return root ? path.join(root, 'rhpak-installed') : null;
}

function getRhpakRemovedDir(ctx) {
  const root = getUserDataRoot(ctx);
  return root ? path.join(root, 'rhpak-removed') : null;
}

function getPatchArchivesDirs(ctx) {
  const root = getUserDataRoot(ctx);
  if (!root) return [];
  return [
    path.join(root, 'patch-archives'),
    path.join(root, 'downloads'),
    path.join(os.homedir(), 'Downloads')
  ];
}

function getCatalogDownloadsDir(ctx) {
  const root = getUserDataRoot(ctx);
  return root ? path.join(root, 'downloads') : null;
}

function getRhsearchCatDbPath(ctx) {
  if (process.env.RHSEARCH_CAT_DB_PATH) {
    return process.env.RHSEARCH_CAT_DB_PATH;
  }
  if (ctx && ctx.rhsearchCatDbPath) {
    return ctx.rhsearchCatDbPath;
  }
  const root = getUserDataRoot(ctx);
  return root ? path.join(root, 'rhsearch_cat.db') : null;
}

function getResolverTempDir(ctx) {
  if (ctx && ctx.tempBase) {
    const dir = path.join(ctx.tempBase, 'patch-resolver');
    ensureDirectory(dir);
    return dir;
  }
  return fs.mkdtempSync(path.join(os.tmpdir(), 'patch-resolver-'));
}

function listSearchRoots(getterFn, ctx) {
  const dir = getterFn(ctx);
  if (!dir) return [];
  ensureDirectory(dir);
  return [dir];
}

function patchFileCandidates(patchblob) {
  const names = new Set();
  if (patchblob.patch_name) {
    names.add(patchblob.patch_name);
    names.add(path.basename(patchblob.patch_name));
  }
  if (patchblob.pat_shake_128) {
    names.add(`patch/${patchblob.pat_shake_128}`);
    names.add(patchblob.pat_shake_128);
  }
  if (patchblob.result_sha1) {
    names.add(`${patchblob.result_sha1}.bps`);
  }
  return Array.from(names);
}

module.exports = {
  ensureDirectory,
  getUserDataRoot,
  getPatchDir,
  getPblobsDir,
  getPatchCacheDir,
  getPblobCacheDir,
  getArtifactStoreDir,
  getRhpakInstalledDir,
  getRhpakRemovedDir,
  getPatchArchivesDirs,
  getCatalogDownloadsDir,
  getRhsearchCatDbPath,
  getResolverTempDir,
  listSearchRoots,
  patchFileCandidates
};
