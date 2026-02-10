/**
 * smwc_world_extras.js - Shared logic for "extras" from game ZIPs
 *
 * Extras = text files, READMEs, images from zips/(GAMEID).zip.
 * Excludes executables and ROM files.
 * Used by smwcw_waiting_fetchmissing.js, smwcw_waiting_build7z.js, intake_pack_and_index.js.
 */

const path = require('path');
const fs = require('fs');

const EXCLUDED_EXTENSIONS = new Set([
  '.exe', '.bat', '.cmd', '.com', '.msi', '.scr', '.dll',
  '.sfc', '.smc', '.bin', '.rom', '.nes', '.gb', '.gbc', '.gba', '.nds',
  '.zip', '.7z', '.rar', '.bps'
]);

const ALLOWED_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.rtf', '.nfo', '.pdf',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.svg'
]);

function isExtraFile(entryName) {
  if (!entryName || entryName.endsWith('/')) return false;
  const base = path.basename(entryName);
  const ext = path.extname(base).toLowerCase();
  if (EXCLUDED_EXTENSIONS.has(ext)) return false;
  if (ALLOWED_EXTENSIONS.has(ext)) return true;
  if (/^readme$/i.test(base) || /^readme\./i.test(base)) return true;
  return false;
}

function getExtrasFromZip(zip, basePath = '') {
  const entries = zip.getEntries ? zip.getEntries() : [];
  const out = [];
  for (const entry of entries) {
    if (entry.isDirectory) continue;
    let name = entry.entryName.replace(/\\/g, '/');
    if (basePath && !name.startsWith(basePath)) continue;
    if (basePath) name = name.slice(basePath.length).replace(/^\//, '');
    if (!name) continue;
    if (isExtraFile(name)) out.push({ entry, relativeName: name, baseName: path.basename(name) });
  }
  return out;
}

/**
 * Extract extra files from zip to extrasDir: extras/<gameid>/ and extras/<hash2>/<bpsHash>/ for each hash.
 * zip: AdmZip instance, gameid: string, bpsHashes: string[], extrasDir: path.
 */
function extractExtrasToDir(zip, gameid, bpsHashes, extrasDir) {
  const gameDir = path.join(extrasDir, gameid);
  const written = [];
  const entries = zip.getEntries ? zip.getEntries() : [];
  for (const entry of entries) {
    if (entry.isDirectory) continue;
    const name = entry.entryName.replace(/\\/g, '/');
    if (!isExtraFile(name)) continue;
    const baseName = path.basename(name);
    const data = zip.readFile(entry);
    if (!data) continue;
    const dirs = [gameDir];
    for (const bpsHash of bpsHashes) {
      const hash2 = bpsHash.slice(0, 2);
      dirs.push(path.join(extrasDir, hash2, bpsHash));
    }
    for (const dir of dirs) {
      fs.mkdirSync(dir, { recursive: true });
      const dest = path.join(dir, baseName);
      fs.writeFileSync(dest, data);
      written.push(dest);
    }
  }
  return written;
}

function listExtrasUnder(extrasDir, gameidOrHashPath) {
  const dir = path.join(extrasDir, gameidOrHashPath);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return [];
  const out = [];
  const walk = (d, rel) => {
    const names = fs.readdirSync(d);
    for (const n of names) {
      const full = path.join(d, n);
      const relPath = rel ? path.join(rel, n) : n;
      if (fs.statSync(full).isDirectory()) walk(full, relPath);
      else out.push(relPath);
    }
  };
  walk(dir, '');
  return out.sort();
}

module.exports = {
  isExtraFile,
  getExtrasFromZip,
  extractExtrasToDir,
  listExtrasUnder,
  EXCLUDED_EXTENSIONS,
  ALLOWED_EXTENSIONS
};
