/**
 * patch-resolver.js - Multi-source integrity-verified patch and patchblob retrieval
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const http = require('http');
const AdmZip = require('adm-zip');
const Database = require('better-sqlite3');
const { decodeBlob } = require('./patchblob-decode');
const {
  ensureDirectory,
  getPatchDir,
  getPblobsDir,
  getPatchCacheDir,
  getPblobCacheDir,
  getPatchArchivesDirs,
  getRhsearchCatDbPath,
  getResolverTempDir,
  listSearchRoots,
  patchFileCandidates
} = require('./patch-resolver-paths');
const { verifyPatchBuffer, verifyPatchblobBuffer } = require('./patch-resolver-hash');
const catalogExtract = require('./catalog-patch-extract');
const { findInstalledRhpakPath } = require('./rhpak-storage');

const METHOD_LABELS = {
  1: 'database-file_data',
  2: 'local-patch-file',
  3: 'local-patchblob-file',
  4: 'catalog-bps7z',
  5: 'installed-rhpak',
  6: 'patch-archives',
  7: 'server-urls',
  8: 'download-url',
  9: 'auto-catalog'
};

function noopProgress() {}

function emitProgress(options, payload) {
  const fn = (options && options.onProgress) || noopProgress;
  try {
    fn(payload);
  } catch (err) {
    console.warn('[patch-resolver] onProgress error:', err.message);
  }
}

function loadPatchRecord(ctx, patchRef) {
  if (!ctx || !ctx.dbManager) {
    throw new Error('ctx.dbManager is required');
  }
  const rhdb = ctx.dbManager.getConnection('rhdata');

  if (patchRef && patchRef.pbuuid) {
    const patchblob = rhdb.prepare('SELECT * FROM patchblobs WHERE pbuuid = ?').get(patchRef.pbuuid);
    if (!patchblob) throw new Error(`patchblobs row not found for pbuuid ${patchRef.pbuuid}`);
    return { patchblob, gameVersion: null };
  }

  if (patchRef && patchRef.patchblob1_name) {
    const patchblob = rhdb.prepare('SELECT * FROM patchblobs WHERE patchblob1_name = ?').get(patchRef.patchblob1_name);
    if (!patchblob) throw new Error(`patchblobs row not found for ${patchRef.patchblob1_name}`);
    return { patchblob, gameVersion: null };
  }

  if (patchRef && patchRef.gameid != null && patchRef.version != null) {
    const gameVersion = rhdb.prepare(`
      SELECT gv.*, pb.*
      FROM gameversions gv
      LEFT JOIN patchblobs pb ON gv.patchblob1_name = pb.patchblob1_name
      WHERE gv.gameid = ? AND gv.version = ?
    `).get(patchRef.gameid, patchRef.version);
    if (!gameVersion) {
      throw new Error(`Game ${patchRef.gameid} version ${patchRef.version} not found`);
    }
    const patchblob = {
      pbuuid: gameVersion.pbuuid,
      gvuuid: gameVersion.gvuuid,
      patch_name: gameVersion.patch_name,
      pat_sha1: gameVersion.pat_sha1,
      pat_sha224: gameVersion.pat_sha224,
      pat_shake_128: gameVersion.pat_shake_128,
      patchblob1_key: gameVersion.patchblob1_key,
      patchblob1_name: gameVersion.patchblob1_name,
      patchblob1_sha224: gameVersion.patchblob1_sha224,
      result_sha1: gameVersion.result_sha1,
      result_sha224: gameVersion.result_sha224,
      result_sha256: gameVersion.result_sha256,
      result_shake1: gameVersion.result_shake1,
      rhpakuuid: gameVersion.rhpakuuid,
      pbjsondata: gameVersion.pbjsondata
    };
    return { patchblob, gameVersion };
  }

  if (patchRef && patchRef.patchblob1_name !== undefined) {
    return { patchblob: patchRef, gameVersion: patchRef._gameVersion || null };
  }

  if (patchRef && patchRef.pat_sha224) {
    return { patchblob: patchRef, gameVersion: null };
  }

  throw new Error('patchRef must include pbuuid, patchblob1_name, gameid+version, or a patchblobs row');
}

function getAttachment(ctx, patchblobName) {
  if (!patchblobName) return null;
  try {
    const patchbinDb = ctx.dbManager.getConnection('patchbin');
    return patchbinDb.prepare(`
      SELECT file_data, file_hash_sha224, decoded_hash_sha224, download_urls
      FROM attachments WHERE file_name = ?
    `).get(patchblobName);
  } catch (err) {
    return null;
  }
}

function readIfExists(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    return fs.readFileSync(filePath);
  } catch (err) {
    return null;
  }
}

function tryLocalPatchFiles(ctx, patchblob) {
  const roots = [
    ...listSearchRoots(getPatchDir, ctx),
    ...listSearchRoots(getPatchCacheDir, ctx)
  ];
  const candidates = patchFileCandidates(patchblob);
  for (const root of roots) {
    for (const name of candidates) {
      const direct = path.join(root, name);
      const base = path.join(root, path.basename(name));
      for (const candidate of [direct, base]) {
        const data = readIfExists(candidate);
        if (data) {
          const check = verifyPatchBuffer(data, patchblob);
          if (check.ok) {
            return { data, path: candidate };
          }
        }
      }
    }
  }
  return null;
}

function tryLocalPatchblobFiles(ctx, patchblob) {
  const name = patchblob.patchblob1_name;
  if (!name) return null;
  const roots = [
    ...listSearchRoots(getPblobsDir, ctx),
    ...listSearchRoots(getPblobCacheDir, ctx)
  ];
  for (const root of roots) {
    const candidate = path.join(root, name);
    const data = readIfExists(candidate);
    if (data) {
      const check = verifyPatchblobBuffer(data, patchblob);
      if (check.ok) {
        return { data, path: candidate };
      }
    }
  }
  return null;
}

function getSevenZip() {
  try {
    return require('7zip-min');
  } catch (err) {
    return null;
  }
}

async function tryCatalogBps7z(ctx, patchblob, options, allowDownload) {
  const catDbPath = getRhsearchCatDbPath(ctx);
  if (!catDbPath || !fs.existsSync(catDbPath)) {
    return null;
  }

  emitProgress(options, { phase: 'resolve', method: 4, message: 'Searching global catalog index...' });

  let catDb;
  try {
    catDb = new Database(catDbPath, { readonly: true });
    const item = catalogExtract.lookupCatalogItem(catDb, patchblob);
    if (!item || !item.index7z_name || !item.indexbps_name) {
      return null;
    }

    const searchPaths = catalogExtract.buildCatalogSearchPaths(ctx);
    let sevenZPath = catalogExtract.findSevenZLocally(item.index7z_name, searchPaths);

    if (!sevenZPath && allowDownload && ctx.ensureCatalogArtifact) {
      emitProgress(options, {
        phase: 'resolve',
        method: 4,
        message: `Downloading catalog archive ${item.index7z_name}...`
      });
      sevenZPath = await ctx.ensureCatalogArtifact(item.index7z_name, options);
    }

    if (!sevenZPath) {
      return null;
    }

    const sevenZip = getSevenZip();
    if (!sevenZip) {
      throw new Error('7zip-min not available for catalog extraction');
    }

    const tempDir = catalogExtract.makeExtractTempDir('patch-resolver-cat');
    emitProgress(options, {
      phase: 'resolve',
      method: 4,
      message: `Extracting ${item.indexbps_name} from ${path.basename(sevenZPath)}...`
    });
    const bpsPath = await catalogExtract.extractBpsFromSevenZ(
      sevenZip,
      sevenZPath,
      item.indexbps_name,
      tempDir
    );
    const data = fs.readFileSync(bpsPath);
    const check = verifyPatchBuffer(data, patchblob);
    if (!check.ok) {
      return null;
    }
    return { data, path: bpsPath, index7zName: item.index7z_name, sevenZPath };
  } finally {
    if (catDb) catDb.close();
  }
}

async function extractFromRhpakPackage(rhpakPath, wantEncoded) {
  const sevenZip = getSevenZip();
  if (!sevenZip) {
    throw new Error('7zip-min not available for RHPAK extraction');
  }
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rhpak-resolve-'));
  try {
    await new Promise((resolve, reject) => {
      sevenZip.unpack(rhpakPath, tempDir, (err) => (err ? reject(err) : resolve()));
    });
    await new Promise((resolve) => setTimeout(resolve, 300));

    let skeletonPath = path.join(tempDir, 'skeleton.json');
    if (!fs.existsSync(skeletonPath)) {
      const jsonFiles = fs.readdirSync(tempDir).filter((n) => n.endsWith('.json'));
      if (jsonFiles.length === 0) throw new Error('RHPAK missing skeleton JSON');
      skeletonPath = path.join(tempDir, jsonFiles[0]);
    }
    const skeleton = JSON.parse(fs.readFileSync(skeletonPath, 'utf8'));
    const patchInfo = skeleton.artifacts && skeleton.artifacts.patch;
    if (!patchInfo) throw new Error('RHPAK skeleton missing patch artifacts');

    const resolveRel = (rel) => {
      if (!rel) return null;
      const abs = path.join(tempDir, rel);
      return fs.existsSync(abs) ? abs : null;
    };

    if (wantEncoded) {
      const blobPath = resolveRel(patchInfo.patchblob_stored_path);
      if (blobPath) {
        return { type: 'blob', data: fs.readFileSync(blobPath), path: blobPath, skeleton };
      }
      return null;
    }

    const patchPath = resolveRel(patchInfo.patch_stored_path);
    if (patchPath) {
      return { type: 'patch', data: fs.readFileSync(patchPath), path: patchPath, skeleton };
    }

    const blobPath = resolveRel(patchInfo.patchblob_stored_path);
    if (blobPath && skeleton.patchblob && skeleton.patchblob.patchblob1_key) {
      const encoded = fs.readFileSync(blobPath);
      const decoded = await decodeBlob(encoded, skeleton.patchblob.patchblob1_key);
      return { type: 'patch-from-blob', data: decoded, path: blobPath, skeleton };
    }
    return null;
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (err) {
      // ignore cleanup errors
    }
  }
}

async function tryInstalledRhpak(ctx, patchblob, options, wantEncoded) {
  const rhpakuuid = patchblob.rhpakuuid;
  if (!rhpakuuid) return null;

  const rhpakPath = findInstalledRhpakPath(ctx, rhpakuuid);
  if (!rhpakPath) return null;

  emitProgress(options, {
    phase: 'resolve',
    method: 5,
    message: `Reading patch data from installed RHPAK ${rhpakuuid}...`
  });

  const extracted = await extractFromRhpakPackage(rhpakPath, wantEncoded);
  if (!extracted) return null;

  if (wantEncoded) {
    const check = verifyPatchblobBuffer(extracted.data, patchblob);
    if (!check.ok) return null;
    return { data: extracted.data, path: rhpakPath };
  }

  const check = verifyPatchBuffer(extracted.data, patchblob);
  if (!check.ok) return null;
  return { data: extracted.data, path: rhpakPath };
}

function scanArchiveForBps(archivePath, targetName) {
  const lower = archivePath.toLowerCase();
  if (lower.endsWith('.zip')) {
    const zip = new AdmZip(archivePath);
    const entry = zip.getEntry(targetName) || zip.getEntries().find((e) => path.basename(e.entryName) === targetName);
    if (!entry) return null;
    return entry.getData();
  }
  return null;
}

async function tryPatchArchives(ctx, patchblob, options) {
  if (!patchblob.result_sha1) return null;
  const targetName = `${patchblob.result_sha1}.bps`;
  const dirs = getPatchArchivesDirs(ctx);

  emitProgress(options, { phase: 'resolve', method: 6, message: `Scanning archives for ${targetName}...` });

  for (const dir of dirs) {
    if (!dir || !fs.existsSync(dir)) continue;

    const loose = path.join(dir, targetName);
    const looseData = readIfExists(loose);
    if (looseData) {
      const check = verifyPatchBuffer(looseData, patchblob);
      if (check.ok) return { data: looseData, path: loose };
    }

    let entries;
    try {
      entries = fs.readdirSync(dir);
    } catch (err) {
      continue;
    }

    for (const entry of entries) {
      const full = path.join(dir, entry);
      let stat;
      try {
        stat = fs.statSync(full);
      } catch (err) {
        continue;
      }
      if (!stat.isFile()) continue;
      const ext = path.extname(entry).toLowerCase();
      if (ext === '.zip') {
        const data = scanArchiveForBps(full, targetName);
        if (data) {
          const check = verifyPatchBuffer(data, patchblob);
          if (check.ok) return { data, path: full };
        }
      }
      if (ext === '.7z') {
        const sevenZip = getSevenZip();
        if (!sevenZip) continue;
        try {
          const tempDir = catalogExtract.makeExtractTempDir('patch-archives');
          const bpsPath = await catalogExtract.extractBpsFromSevenZ(sevenZip, full, targetName, tempDir);
          const data = fs.readFileSync(bpsPath);
          const check = verifyPatchBuffer(data, patchblob);
          if (check.ok) return { data, path: bpsPath };
        } catch (err) {
          // try next archive
        }
      }
    }
  }
  return null;
}

function downloadUrlBuffer(url, redirectLimit = 5) {
  return new Promise((resolve, reject) => {
    const fetchOnce = (currentUrl, remaining) => {
      const lib = currentUrl.startsWith('https:') ? https : http;
      const req = lib.get(currentUrl, { timeout: 120000 }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          if (remaining <= 0) {
            reject(new Error('Too many redirects'));
            return;
          }
          fetchOnce(res.headers.location, remaining - 1);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${currentUrl}`));
          return;
        }
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      });
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy(new Error('Download timeout'));
      });
    };
    fetchOnce(url, redirectLimit);
  });
}

function extractBpsFromZipBuffer(buffer, patchblob) {
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries().filter((e) => !e.isDirectory);
  const bpsEntries = entries.filter((e) => e.entryName.toLowerCase().endsWith('.bps'));
  if (bpsEntries.length === 0) {
    throw new Error('No BPS files found in downloaded ZIP');
  }
  for (const entry of bpsEntries) {
    const data = entry.getData();
    const check = verifyPatchBuffer(data, patchblob);
    if (check.ok) return data;
  }
  throw new Error('No BPS in ZIP matched pat_sha224');
}

async function tryDownloadUrl(ctx, patchblob, gameVersion, options) {
  let url = gameVersion && gameVersion.download_url;
  if (!url && gameVersion && gameVersion.gvuuid) {
    try {
      const rhdb = ctx.dbManager.getConnection('rhdata');
      const row = rhdb.prepare('SELECT download_url FROM gameversions WHERE gvuuid = ?').get(gameVersion.gvuuid);
      url = row && row.download_url;
    } catch (err) {
      // ignore
    }
  }
  if (!url) {
    const attachment = getAttachment(ctx, patchblob.patchblob1_name);
    if (attachment && attachment.download_urls) {
      try {
        const parsed = JSON.parse(attachment.download_urls);
        if (Array.isArray(parsed) && parsed.length > 0) url = parsed[0];
        else if (typeof parsed === 'string') url = parsed;
      } catch (err) {
        url = attachment.download_urls;
      }
    }
  }
  if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
    return null;
  }

  emitProgress(options, { phase: 'resolve', method: 8, message: `Downloading patch from ${url}...` });
  const buffer = await downloadUrlBuffer(url);
  let patchData = buffer;
  if (url.toLowerCase().includes('.zip') || buffer.slice(0, 2).toString('hex') === '504b') {
    patchData = extractBpsFromZipBuffer(buffer, patchblob);
  } else {
    const check = verifyPatchBuffer(patchData, patchblob);
    if (!check.ok) {
      throw new Error(check.errors.join('; '));
    }
  }
  return { data: patchData, path: url };
}

async function tryServerUrls(ctx, patchblob, options) {
  const client = ctx.rhserverClient;
  if (!client || !client.isConnected?.()) {
    emitProgress(options, { phase: 'resolve', method: 7, message: 'RHServer not connected (skipped)' });
    return null;
  }
  const attachment = getAttachment(ctx, patchblob.patchblob1_name);
  if (!attachment) return null;
  emitProgress(options, { phase: 'resolve', method: 7, message: 'Searching RHServer for patch...' });
  try {
    const result = await client.searchAttachment(attachment);
    if (!result?.data) return null;
    const check = verifyPatchBuffer(result.data, patchblob, attachment);
    if (!check.ok) return null;
    return { data: result.data, path: result.source || 'rhserver' };
  } catch (err) {
    emitProgress(options, { phase: 'resolve', method: 7, message: `RHServer error: ${err.message}` });
    return null;
  }
}

async function tryAutoCatalog(ctx, patchblob, options) {
  emitProgress(options, { phase: 'resolve', method: 9, message: 'Ensuring catalog is installed...' });
  if (ctx.ensureCatalogBase) {
    await ctx.ensureCatalogBase(options);
  }
  return tryCatalogBps7z(ctx, patchblob, options, true);
}

function cachePatch(ctx, patchblob, data) {
  const cacheWritten = [];
  const patchDir = getPatchDir(ctx);
  if (!patchDir || !data) return cacheWritten;
  ensureDirectory(patchDir);
  const names = patchFileCandidates(patchblob);
  const primary = patchblob.pat_shake_128 || path.basename(patchblob.patch_name || '') || patchblob.result_sha1;
  if (primary) {
    const dest = path.join(patchDir, primary.includes('/') ? path.basename(primary) : primary);
    try {
      fs.writeFileSync(dest, data);
      cacheWritten.push(dest);
    } catch (err) {
      console.warn('[patch-resolver] failed to cache patch:', err.message);
    }
  }
  return cacheWritten;
}

function cachePatchblob(ctx, patchblob, data) {
  const cacheWritten = [];
  const pblobsDir = getPblobsDir(ctx);
  if (!pblobsDir || !data || !patchblob.patchblob1_name) return cacheWritten;
  ensureDirectory(pblobsDir);
  const dest = path.join(pblobsDir, patchblob.patchblob1_name);
  try {
    fs.writeFileSync(dest, data);
    cacheWritten.push(dest);
  } catch (err) {
    console.warn('[patch-resolver] failed to cache patchblob:', err.message);
  }
  return cacheWritten;
}

async function methodFromDatabase(ctx, patchblob, options, wantEncoded) {
  const attachment = getAttachment(ctx, patchblob.patchblob1_name);
  if (!attachment || !attachment.file_data) {
    return null;
  }
  emitProgress(options, { phase: 'resolve', method: 1, message: 'Loading patch from database...' });
  const blobCheck = verifyPatchblobBuffer(attachment.file_data, patchblob, attachment);
  if (!blobCheck.ok) {
    return null;
  }
  if (wantEncoded) {
    return { data: attachment.file_data, path: `patchbin:${patchblob.patchblob1_name}` };
  }
  if (!patchblob.patchblob1_key) {
    throw new Error(`No decryption key for ${patchblob.patchblob1_name}`);
  }
  const decoded = await decodeBlob(attachment.file_data, patchblob.patchblob1_key);
  const check = verifyPatchBuffer(decoded, patchblob, attachment);
  if (!check.ok) return null;
  return { data: decoded, path: `patchbin:${patchblob.patchblob1_name}`, verified: check.verified };
}

async function runPatchblobMethods(ctx, patchblob, gameVersion, options) {
  const attempts = [];
  const chain = [
    () => methodFromDatabase(ctx, patchblob, options, true),
    () => {
      const local = tryLocalPatchblobFiles(ctx, patchblob);
      if (local) {
        emitProgress(options, { phase: 'resolve', method: 3, message: `Found local patchblob ${path.basename(local.path)}` });
        return local;
      }
      return null;
    },
    () => tryInstalledRhpak(ctx, patchblob, options, true),
    () => tryServerUrls(ctx, patchblob, options),
    async () => {
      const dl = await tryDownloadUrl(ctx, patchblob, gameVersion, options);
      if (dl) {
        const blobCheck = verifyPatchblobBuffer(dl.data, patchblob);
        if (blobCheck.ok) return dl;
      }
      return null;
    }
  ];

  for (let i = 0; i < chain.length; i++) {
    const methodNum = [1, 3, 5, 7, 8][i];
    try {
      const result = await chain[i]();
      if (result && result.data) {
        return {
          success: true,
          data: result.data,
          source: { method: methodNum, label: METHOD_LABELS[methodNum], path: result.path },
          attempts
        };
      }
      if (result && result.skipped) {
        attempts.push({ method: methodNum, skipped: result.reason });
      }
    } catch (err) {
      attempts.push({ method: methodNum, error: err.message });
    }
  }

  return {
    success: false,
    error: `Could not resolve patchblob ${patchblob.patchblob1_name}`,
    attempts
  };
}

async function runPatchMethods(ctx, patchblob, gameVersion, options) {
  const attempts = [];
  const shouldCache = (methodNum) => methodNum >= 4;

  const tryMethod = async (methodNum, fn) => {
    try {
      const result = await fn();
      if (result && result.skipped) {
        attempts.push({ method: methodNum, skipped: result.reason });
        return null;
      }
      if (result && result.data) {
        const check = verifyPatchBuffer(result.data, patchblob);
        if (!check.ok) {
          attempts.push({ method: methodNum, error: check.errors.join('; ') });
          return null;
        }
        let cacheWritten = [];
        if (shouldCache(methodNum)) {
          cacheWritten = cachePatch(ctx, patchblob, result.data);
        }
        return {
          success: true,
          data: result.data,
          source: { method: methodNum, label: METHOD_LABELS[methodNum], path: result.path },
          verified: check.verified,
          cacheWritten,
          attempts
        };
      }
    } catch (err) {
      attempts.push({ method: methodNum, error: err.message });
    }
    return null;
  };

  let resolved = await tryMethod(1, () => methodFromDatabase(ctx, patchblob, options, false));
  if (resolved) return resolved;

  resolved = await tryMethod(2, async () => {
    const local = tryLocalPatchFiles(ctx, patchblob);
    if (local) {
      emitProgress(options, { phase: 'resolve', method: 2, message: `Found local patch ${path.basename(local.path)}` });
      return local;
    }
    return null;
  });
  if (resolved) return resolved;

  resolved = await tryMethod(3, async () => {
    const localBlob = tryLocalPatchblobFiles(ctx, patchblob);
    if (!localBlob || !patchblob.patchblob1_key) return null;
    emitProgress(options, { phase: 'resolve', method: 3, message: 'Decoding local patchblob...' });
    const decoded = await decodeBlob(localBlob.data, patchblob.patchblob1_key);
    return { data: decoded, path: localBlob.path };
  });
  if (resolved) return resolved;

  resolved = await tryMethod(4, () => tryCatalogBps7z(ctx, patchblob, options, !!ctx.ensureCatalogArtifact));
  if (resolved) {
    resolved.cacheWritten = cachePatch(ctx, patchblob, resolved.data);
    return resolved;
  }

  resolved = await tryMethod(5, () => tryInstalledRhpak(ctx, patchblob, options, false));
  if (resolved) return resolved;

  resolved = await tryMethod(6, () => tryPatchArchives(ctx, patchblob, options));
  if (resolved) return resolved;

  resolved = await tryMethod(7, () => tryServerUrls(ctx, patchblob, options));

  resolved = await tryMethod(8, async () => {
    const dl = await tryDownloadUrl(ctx, patchblob, gameVersion, options);
    if (dl) {
      dl.cacheWritten = cachePatch(ctx, patchblob, dl.data);
    }
    return dl;
  });
  if (resolved) return resolved;

  resolved = await tryMethod(9, () => tryAutoCatalog(ctx, patchblob, options));
  if (resolved) {
    resolved.cacheWritten = cachePatch(ctx, patchblob, resolved.data);
    return resolved;
  }

  return {
    success: false,
    error: `Could not resolve patch for ${patchblob.patchblob1_name || patchblob.pbuuid}`,
    attempts
  };
}

async function runPrefetch(ctx, prefetchList, primaryResult, options) {
  if (!prefetchList || !Array.isArray(prefetchList) || prefetchList.length === 0) {
    return;
  }
  const seen = new Set();
  emitProgress(options, { phase: 'prefetch', message: `Prefetching ${prefetchList.length} related patch(es)...` });

  for (let i = 0; i < prefetchList.length; i++) {
    const ref = prefetchList[i];
    const key = JSON.stringify(ref);
    if (seen.has(key)) continue;
    seen.add(key);
    emitProgress(options, {
      phase: 'prefetch',
      message: `Prefetch ${i + 1}/${prefetchList.length}`,
      current: i + 1,
      total: prefetchList.length
    });
    try {
      await resolvePatch(ctx, ref, {
        ...options,
        onProgress: (payload) => emitProgress(options, { ...payload, phase: 'prefetch' }),
        skipPrefetch: true
      });
    } catch (err) {
      console.warn('[patch-resolver] prefetch failed:', err.message);
    }
  }
}

async function resolvePatch(ctx, patchRef, options = {}) {
  const { patchblob, gameVersion } = loadPatchRecord(ctx, patchRef);
  if (!patchblob.patchblob1_name && !patchblob.pat_sha224) {
    return { success: false, error: 'Patch record missing patchblob1_name' };
  }

  const result = await runPatchMethods(ctx, patchblob, gameVersion, options);
  if (result.success && !options.skipPrefetch && options.prefetchList) {
    runPrefetch(ctx, options.prefetchList, result, options).catch((err) => {
      console.warn('[patch-resolver] prefetch error:', err.message);
    });
  }
  return result;
}

async function resolvePatchblob(ctx, patchRef, options = {}) {
  const { patchblob, gameVersion } = loadPatchRecord(ctx, patchRef);
  if (!patchblob.patchblob1_name) {
    return { success: false, error: 'Patch record missing patchblob1_name' };
  }

  const result = await runPatchblobMethods(ctx, patchblob, gameVersion, options);
  if (result.success && result.source && result.source.method >= 4) {
    result.cacheWritten = cachePatchblob(ctx, patchblob, result.data);
  }
  if (result.success && !options.skipPrefetch && options.prefetchList) {
    runPrefetch(ctx, options.prefetchList, result, options).catch((err) => {
      console.warn('[patch-resolver] prefetch error:', err.message);
    });
  }
  return result;
}

async function canResolvePatch(ctx, patchRef, options = {}) {
  const verifyOptions = { ...options, onProgress: options.onProgress || noopProgress };
  const result = await resolvePatch(ctx, patchRef, { ...verifyOptions, skipPrefetch: true });
  return {
    resolvable: !!result.success,
    source: result.source || null,
    error: result.error || null,
    attempts: result.attempts || []
  };
}

module.exports = {
  METHOD_LABELS,
  loadPatchRecord,
  resolvePatch,
  resolvePatchblob,
  canResolvePatch,
  cachePatch,
  cachePatchblob,
  verifyPatchBuffer,
  verifyPatchblobBuffer
};
