/**
 * Load Manual - utilities for inspecting archives (7z, ZIP) and RHPAK, and creating temp RHPAKs.
 * Used by Load Manual dialog to pre-check archives and build RHPAKs from BPS/7z/ZIP.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execSync } = require('child_process');
const AdmZip = require('adm-zip');
const { path7za } = require('7zip-bin');

/**
 * Return 7za binary path valid in packaged Electron (uses unpacked path when inside app.asar).
 * Load game-stager so 7zip-min is configured for packaged apps, then use its binary path.
 */
function get7zaPath() {
  require('../game-stager'); // ensures 7zip-min is configured for packaged app
  const sevenZip = require('7zip-min');
  const cfg = sevenZip.getConfig();
  return (cfg && cfg.binaryPath) ? cfg.binaryPath : path7za;
}

/**
 * List contents of a 7z archive. Returns array of { path, baseName, type }.
 */
function list7zContents(archivePath) {
  const bin = get7zaPath();
  const result = execSync(`"${bin}" l -slt "${archivePath}"`, { encoding: 'utf8' });
  const lines = result.split('\n');
  const files = [];
  let currentFile = null;
  let inFileBlock = false;
  let isArchiveEntry = false;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('Path = ')) {
      if (currentFile && currentFile.path && !isArchiveEntry) files.push(currentFile);
      currentFile = { path: trimmed.replace('Path = ', '').trim() };
      inFileBlock = true;
      isArchiveEntry = false;
      continue;
    }
    if (inFileBlock && currentFile) {
      if (trimmed.startsWith('Type = ')) {
        currentFile.type = trimmed.replace('Type = ', '').trim();
        if (currentFile.type === '7z') isArchiveEntry = true;
      } else if (trimmed.startsWith('----------')) {
        if (currentFile && currentFile.path && !isArchiveEntry) files.push(currentFile);
        currentFile = null;
        inFileBlock = false;
        isArchiveEntry = false;
      }
    }
  }
  if (currentFile && currentFile.path && !isArchiveEntry) files.push(currentFile);

  return files
    .filter(f => f.path && !f.path.endsWith('/') && f.type !== '7z')
    .map(f => ({ ...f, baseName: path.basename(f.path).replace(/\.[^.]+$/, '') }));
}

/**
 * Extract a single file from 7z to outputDir. Returns path to extracted file.
 */
function extractFileFrom7z(archivePath, entryPath, outputDir) {
  fs.mkdirSync(outputDir, { recursive: true });
  const bin = get7zaPath();
  execSync(`"${bin}" x -y -o"${outputDir}" "${archivePath}" "${entryPath}"`, { stdio: 'pipe' });
  const fileName = path.basename(entryPath);
  const candidates = [
    path.join(outputDir, entryPath),
    path.join(outputDir, path.basename(entryPath)),
    path.join(outputDir, ...entryPath.split(/[/\\]/))
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error(`Extracted file not found: ${entryPath}`);
}

/**
 * Extract all files from 7z to outputDir using 7zip-min for compatibility.
 * Load game-stager first so 7zip-min is configured for Electron packaged apps.
 */
function extractAllFrom7z(archivePath, outputDir) {
  require('../game-stager');
  const sevenZip = require('7zip-min');
  return new Promise((resolve, reject) => {
    sevenZip.unpack(archivePath, outputDir, err => (err ? reject(err) : resolve()));
  });
}

/**
 * Get base name (without extension) from a path.
 */
function getBaseName(filePath) {
  return path.basename(filePath).replace(/\.[^.]+$/, '');
}

/**
 * Parse gameversion from bpsindex-style or games/*.json into { gameid, name, author, difficulty, type }.
 */
function extractMetadataFromJson(jsonObj) {
  const gv = jsonObj?.gameversion || jsonObj;
  if (!gv || typeof gv !== 'object') return null;
  return {
    gameid: gv.gameid != null ? String(gv.gameid) : undefined,
    name: gv.name != null ? String(gv.name) : undefined,
    author: (gv.author || gv.authors || '') && String(gv.author || gv.authors).trim() ? String(gv.author || gv.authors).trim() : undefined,
    difficulty: gv.difficulty != null ? String(gv.difficulty) : undefined,
    type: (gv.gametype || gv.fields_type || gv.type) != null ? String(gv.gametype || gv.fields_type || gv.type) : undefined
  };
}

/**
 * Inspect a 7z or ZIP archive: list BPS and JSON, parse matching JSON for metadata.
 * Returns { bpsEntries, jsonEntries, metadataByBps }.
 */
async function inspectArchive(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const bpsEntries = [];
  const jsonEntries = [];
  const metadataByBps = {};
  let allEntries = [];
  let getJsonContent = null;

  if (ext === '.zip') {
    const zip = new AdmZip(filePath);
    const entries = zip.getEntries().filter(e => !e.isDirectory);
    allEntries = entries.map(e => ({
      path: e.entryName.replace(/\\/g, '/'),
      baseName: getBaseName(e.entryName),
      getData: () => e.getData().toString('utf8')
    }));
    getJsonContent = (entry) => entry.getData ? entry.getData() : null;
  } else if (ext === '.7z') {
    const listed = list7zContents(filePath);
    allEntries = listed.map(f => ({
      path: f.path.replace(/\\/g, '/'),
      baseName: f.baseName,
      pathOnly: true
    }));
    getJsonContent = null;
  } else {
    throw new Error(`Unsupported archive type: ${ext}`);
  }

  for (const e of allEntries) {
    const p = e.path.toLowerCase();
    if (p.endsWith('.bps')) {
      bpsEntries.push({ path: e.path, baseName: e.baseName });
    } else if (p.endsWith('.json')) {
      jsonEntries.push({ path: e.path, baseName: e.baseName, entry: e });
    }
  }

  if (ext === '.zip') {
    for (const bps of bpsEntries) {
      for (const j of jsonEntries) {
        if (j.baseName === bps.baseName) {
          try {
            const raw = j.entry.getData();
            const data = JSON.parse(raw.toString('utf8'));
            const meta = extractMetadataFromJson(data);
            if (meta) metadataByBps[bps.path] = meta;
          } catch (_) { /* ignore parse errors */ }
        }
      }
      const gamesMatch = jsonEntries.find(j => {
        try {
          const raw = j.entry.getData();
          const data = JSON.parse(raw.toString('utf8'));
          const idx = data.indexbps_name || data.indexBpsName;
          const bpsFileName = path.basename(bps.path);
          return idx && (idx === bpsFileName || idx === bps.path);
        } catch (_) { return false; }
      });
      if (gamesMatch && !metadataByBps[bps.path]) {
        try {
          const data = JSON.parse(gamesMatch.entry.getData().toString('utf8'));
          const meta = extractMetadataFromJson(data);
          if (meta) metadataByBps[bps.path] = meta;
        } catch (_) { /* ignore */ }
      }
    }
  } else {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'load-manual-inspect-'));
    try {
      await extractAllFrom7z(filePath, tempDir);
      const readJsonAt = (relPath) => {
        const full = path.join(tempDir, relPath);
        if (fs.existsSync(full)) {
          try {
            return JSON.parse(fs.readFileSync(full, 'utf8'));
          } catch (_) { return null; }
        }
        const norm = relPath.replace(/\\/g, '/');
        const alt = path.join(tempDir, path.basename(norm));
        if (fs.existsSync(alt)) {
          try {
            return JSON.parse(fs.readFileSync(alt, 'utf8'));
          } catch (_) { return null; }
        }
        return null;
      };
      for (const bps of bpsEntries) {
        const bpsFileName = path.basename(bps.path);
        const candidates = [`bpsindex/${bps.baseName}.json`];
        const gamesDir = path.join(tempDir, 'games');
        if (fs.existsSync(gamesDir)) {
          for (const name of fs.readdirSync(gamesDir)) {
            if (name.endsWith('.json')) candidates.push(`games/${name}`);
          }
        }
        for (const c of candidates) {
          const data = readJsonAt(c);
          if (data) {
            const idx = data.indexbps_name || data.indexBpsName;
            const baseMatch = path.basename(c).replace(/\.json$/i, '') === bps.baseName;
            const idxMatch = idx && (idx === bpsFileName || idx === bps.path);
            if (baseMatch || idxMatch) {
              const meta = extractMetadataFromJson(data);
              if (meta) { metadataByBps[bps.path] = meta; break; }
            }
          }
        }
      }
    } finally {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch (_) { /* ignore */ }
    }
  }

  return { bpsEntries, jsonEntries, metadataByBps };
}

/**
 * Inspect RHPAK file: extract metadata from skeleton.json for pre-population.
 */
function inspectRhpak(filePath) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'load-manual-rhpak-'));
  try {
    extractAllFrom7z(filePath, tempDir);
    const skeletonPath = path.join(tempDir, 'skeleton.json');
    if (!fs.existsSync(skeletonPath)) {
      const candidates = fs.readdirSync(tempDir).filter(n => n.endsWith('.json'));
      const first = candidates[0];
      if (!first) return null;
      const data = JSON.parse(fs.readFileSync(path.join(tempDir, first), 'utf8'));
      return extractMetadataFromJson(data);
    }
    const data = JSON.parse(fs.readFileSync(skeletonPath, 'utf8'));
    return extractMetadataFromJson(data);
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (_) { /* ignore */ }
  }
}

/**
 * Create temporary RHPAK from BPS path and manual metadata (itemJson).
 * Returns { success, rhpakPath, gameid } or { success: false, error }.
 */
async function createTempRhpakFromBps(bpsPath, itemJson, options = {}) {
  const path = require('path');
  const fs = require('fs');
  const os = require('os');
  const crypto = require('crypto');
  const { app } = require('electron');

  const tempDir = path.join(os.tmpdir(), `load-manual-rhpak-${Date.now()}`);
  fs.mkdirSync(tempDir, { recursive: true });

  const bpsFileName = path.basename(bpsPath);
  const bpsDestPath = path.join(tempDir, bpsFileName);
  fs.copyFileSync(bpsPath, bpsDestPath);

  const sfcSha256 = itemJson.sfc_rom_sha256_hash || crypto.createHash('sha256').update(itemJson.gameversion?.gameid || 'manual').digest('hex');
  const uuidFromSha256 = (sha256) => {
    const hex = sha256.substring(0, 32);
    return `${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20, 32)}`;
  };
  const deterministicUuid = uuidFromSha256(sfcSha256);
  const deterministicGvuuid = crypto.randomUUID();

  const gv = itemJson.gameversion || {};
  const gameName = gv.name || path.basename(bpsPath).replace(/\.bps$/i, '');
  const author = gv.author || 'Unknown';

  const skeleton = {
    metadata: {
      rhpakuuid: deterministicUuid,
      rhpakname: `${gameName} - ${author}`,
      version: '0.1.1',
      gameids: gv.gameid ? [gv.gameid] : [deterministicUuid.substring(0, 8)]
    },
    gameversion: {
      ...gv,
      gvuuid: deterministicGvuuid,
      gameid: gv.gameid || `manual_${Date.now().toString(36)}`,
      name: gameName,
      author,
      difficulty: gv.difficulty || 'Intermediate',
      gametype: gv.gametype || gv.type || 'Standard',
      type: gv.type || gv.gametype || 'Standard',
      fields_type: gv.fields_type || gv.type || 'Standard',
      patch: bpsFileName,
      patch_relative_path: bpsFileName,
      patch_filename: bpsFileName,
      patch_local_path: bpsFileName
    },
    patchblob: itemJson.patchblob || {},
    attachments: itemJson.attachments || [],
    screenshots: itemJson.screenshots || [],
    res_attachments: itemJson.res_attachments || []
  };

  const skeletonPath = path.join(tempDir, 'skeleton.json');
  fs.writeFileSync(skeletonPath, JSON.stringify(skeleton, null, 2));

  const newgame = require(path.join(__dirname, '..', '..', 'jstools', 'newgame.js'));
  const clientDbPath = path.join(app.getPath('userData'), 'clientdata.db');

  try {
    await newgame.handlePrepare(skeletonPath, {
      baseDir: tempDir,
      clientDbPath,
      NO_PYTHON: options.NO_PYTHON !== false
    });
  } catch (err) {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
    throw new Error(`Failed to prepare RHPAK: ${err.message}`);
  }

  let prepared = JSON.parse(fs.readFileSync(skeletonPath, 'utf8'));
  if (prepared.gameversion) {
    prepared.gameversion.name = gameName;
    prepared.gameversion.author = author;
    prepared.gameversion.gvuuid = deterministicGvuuid;
  }
  fs.writeFileSync(skeletonPath, JSON.stringify(prepared, null, 2));

  const rhpakPath = path.join(tempDir, `${deterministicUuid}.rhpak`);
  await newgame.handlePackage(skeletonPath, rhpakPath);

  if (!fs.existsSync(rhpakPath)) {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
    throw new Error('RHPAK file was not created');
  }

  return {
    success: true,
    rhpakPath,
    gameid: gv.gameid || deterministicUuid.substring(0, 8)
  };
}

module.exports = {
  list7zContents,
  extractFileFrom7z,
  extractAllFrom7z,
  inspectArchive,
  inspectRhpak,
  extractMetadataFromJson,
  getBaseName,
  createTempRhpakFromBps
};
