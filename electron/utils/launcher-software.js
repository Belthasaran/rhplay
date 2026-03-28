/**
 * Launcher-specific paths and trust checks (verified downloads under userData/releases).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const manifestResolver = require('./manifest-resolver');
const softwareUpdateManager = require('./software-update-manager');
const { compareVersions, findManifestEntryForApp } = require('./software-update-check');

const RELEASES_DIR = 'releases';

function getReleasesRoot(userDataDir) {
  return path.join(userDataDir, RELEASES_DIR);
}

function getReleaseDirForVersion(userDataDir, appId, version) {
  const safeApp = String(appId).replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeVer = String(version).replace(/[^a-zA-Z0-9_.-]/g, '_');
  return path.join(getReleasesRoot(userDataDir), safeApp, safeVer);
}

/**
 * Download manifest entry to userData/releases/<AppId>/<version>/<filename> after same verification as main updater.
 */
async function performDownloadToReleases(entry, appId, userDataDir, progressCallback) {
  if (!entry || !entry.sha256) {
    throw new Error('Invalid entry or missing SHA256');
  }
  const version = entry.version || 'unknown';
  const filename = entry.target_filename || entry.source_filename;
  if (!filename) {
    throw new Error('Entry missing filename');
  }

  const destDir = getReleaseDirForVersion(userDataDir, appId, version);
  manifestResolver.ensureDirectory(destDir);

  const downloadedPath = await softwareUpdateManager.downloadUpdate(entry, progressCallback);
  const targetPath = path.join(destDir, filename);
  const movedPath = softwareUpdateManager.moveUpdateToTarget(downloadedPath, targetPath);

  const sigVerify2 = await softwareUpdateManager.verifyCoreManifestSignature();
  if (!sigVerify2.valid) {
    throw new Error(`Final coremanifest.dat signature verification failed: ${sigVerify2.error}`);
  }

  const manifest = manifestResolver.loadCoreManifest();
  if (!manifest) {
    throw new Error('Failed to reload core manifest for final verification');
  }

  const finalHashVerify = softwareUpdateManager.verifyLocalVersionSHA256(movedPath, entry.sha256);
  if (!finalHashVerify.matches) {
    throw new Error(`Final SHA256 verification failed: ${finalHashVerify.error}`);
  }

  return { success: true, path: movedPath, version, filename };
}

function sha256File(filePath) {
  try {
    const buffer = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(buffer).digest('hex');
  } catch (err) {
    return null;
  }
}

/**
 * Collect allowed SHA256 set: launcher_allowlist + optional entry.sha256 for a specific target.
 */
function buildAllowedSha256Set(manifest, entryForCurrentTarget) {
  const allowed = new Set();
  if (entryForCurrentTarget && entryForCurrentTarget.sha256) {
    allowed.add(String(entryForCurrentTarget.sha256).toLowerCase());
  }
  const list = manifest && manifest.launcher_allowlist;
  if (Array.isArray(list)) {
    for (const pair of list) {
      if (Array.isArray(pair) && pair.length >= 2 && pair[1]) {
        allowed.add(String(pair[1]).toLowerCase());
      }
    }
  }
  return allowed;
}

/**
 * Returns { ok: true } or { ok: false, error }.
 */
function isExecutableAllowedToRun(filePath, manifest, entryForTarget) {
  if (!filePath || !fs.existsSync(filePath)) {
    return { ok: false, error: 'File does not exist' };
  }
  const hash = sha256File(filePath);
  if (!hash) {
    return { ok: false, error: 'Could not hash file' };
  }
  const allowed = buildAllowedSha256Set(manifest, entryForTarget);
  if (allowed.has(hash.toLowerCase())) {
    return { ok: true, sha256: hash };
  }
  return { ok: false, error: 'SHA256 not in manifest entry or launcher_allowlist', sha256: hash };
}

/**
 * Scan releases folder for an app: returns [{ version, path, filename, sha256 }] sorted newest first by version string compare.
 */
function listInstalledReleases(userDataDir, appId) {
  const root = path.join(getReleasesRoot(userDataDir), String(appId).replace(/[^a-zA-Z0-9_-]/g, '_'));
  if (!fs.existsSync(root)) {
    return [];
  }
  const out = [];
  const vers = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory());
  for (const v of vers) {
    const vdir = path.join(root, v.name);
    const files = fs.readdirSync(vdir).filter((f) => !f.startsWith('.'));
    for (const f of files) {
      const fp = path.join(vdir, f);
      const st = fs.statSync(fp);
      if (st.isFile()) {
        const h = sha256File(fp);
        out.push({
          version: v.name,
          path: fp,
          filename: f,
          sha256: h
        });
      }
    }
  }
  out.sort((a, b) => compareVersions(b.version, a.version));
  return out;
}

/**
 * Newest installed RHPlay build whose version is >= manifest version and passes SHA256 allowlist.
 * Installed list is sorted newest-first; returns first matching row.
 */
function findBestLaunchCandidate(userDataDir, manifest, channel, platform, format) {
  if (!manifest) {
    return null;
  }
  const found = findManifestEntryForApp(manifest, channel, 'RHPLAY', platform, format);
  if (!found || !found.entry) {
    return null;
  }
  const manifestVersion = found.entry.version != null ? String(found.entry.version).trim() : '';
  if (!manifestVersion) {
    return null;
  }
  const installed = listInstalledReleases(userDataDir, 'RHPLAY');
  for (const item of installed) {
    if (compareVersions(item.version, manifestVersion) < 0) {
      continue;
    }
    const gate = isExecutableAllowedToRun(item.path, manifest, found.entry);
    if (gate.ok) {
      return {
        path: item.path,
        version: item.version,
        filename: item.filename
      };
    }
  }
  return null;
}

module.exports = {
  RELEASES_DIR,
  getReleasesRoot,
  getReleaseDirForVersion,
  performDownloadToReleases,
  isExecutableAllowedToRun,
  buildAllowedSha256Set,
  listInstalledReleases,
  findBestLaunchCandidate,
  sha256File
};
