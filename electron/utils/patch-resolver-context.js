/**
 * patch-resolver-context.js - Build patch resolver ctx for Electron main process
 */

const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const manifestResolver = require('./manifest-resolver');

function buildPatchResolverContext(dbManager, overrides = {}) {
  const userDataPath = overrides.userDataPath || (app && app.getPath ? app.getPath('userData') : null);
  const catalogManifestUtils = require('./catalog-manifest-utils');
  const catalogDownloadManager = require('./catalog-download-manager');

  async function downloadManifestFile(fileName, options, methodNum) {
    const manifest = catalogManifestUtils.loadBpsArchivesManifest();
    if (!manifest || !manifest[fileName] || !manifest[fileName].base) {
      throw new Error(`Catalog manifest entry not found for ${fileName}`);
    }
    const downloadsDir = userDataPath ? path.join(userDataPath, 'downloads') : null;
    if (!downloadsDir) {
      throw new Error('userDataPath required for catalog download');
    }
    fs.mkdirSync(downloadsDir, { recursive: true });
    const workingDir = path.join(userDataPath, 'CatalogTemp');
    fs.mkdirSync(workingDir, { recursive: true });
    const downloadTracker = catalogDownloadManager.createDownloadTracker();
    if (options && options.onProgress) {
      const originalProgress = downloadTracker.progress.bind(downloadTracker);
      downloadTracker.progress = (spec, downloaded, total) => {
        originalProgress(spec, downloaded, total);
        options.onProgress({
          phase: 'resolve',
          method: methodNum,
          message: `Downloading ${spec.file_name}: ${total > 0 ? Math.floor((downloaded / total) * 100) : 0}%`,
          bytesLoaded: downloaded,
          bytesTotal: total
        });
      };
    }
    return catalogDownloadManager.ensureArtifact(
      manifest[fileName].base,
      workingDir,
      downloadTracker,
      userDataPath,
      20,
      downloadsDir
    );
  }

  return {
    dbManager,
    userDataPath,
    tempBase: manifestResolver.getUserSpecificTempBase(),
    rhsearchCatDbPath: overrides.rhsearchCatDbPath || (userDataPath ? path.join(userDataPath, 'rhsearch_cat.db') : null),
    flipsPath: overrides.flipsPath || null,
    vanillaRomPath: overrides.vanillaRomPath || null,
    ensureCatalogArtifact: (index7zName, options) => downloadManifestFile(index7zName, options, 4),
    ensureCatalogBase: async (options) => {
      if (!userDataPath) return;
      const catDb = path.join(userDataPath, 'rhsearch_cat.db');
      if (fs.existsSync(catDb)) return;
      for (const fileName of ['rhsearch_cat.db', 'rhsearch.zip']) {
        try {
          await downloadManifestFile(fileName, options, 9);
        } catch (err) {
          console.warn(`[patch-resolver] catalog base download failed for ${fileName}:`, err.message);
        }
      }
    },
    ...overrides
  };
}

module.exports = {
  buildPatchResolverContext
};
