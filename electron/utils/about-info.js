/**
 * about-info.js
 *
 * Aggregates data for the About dialog: version info, core manifest,
 * dbmanifest, and bpsarchives details.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const manifestResolver = require('./manifest-resolver');
const { checkForSoftwareUpdate, getCurrentAppVersion } = require('./software-update-check');
const { getCurrentChannel, getCurrentPlatform } = require('./software-update-check');

function formatTimestamp(ts) {
  if (ts == null) return '—';
  const t = typeof ts === 'number' ? ts : parseInt(ts, 10);
  if (isNaN(t)) return String(ts);
  const d = new Date(t * 1000);
  return d.toLocaleString();
}

function sha256File(filePath) {
  try {
    const buffer = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(buffer).digest('hex');
  } catch {
    return null;
  }
}

/**
 * Get about info for the About dialog
 */
function getAboutInfo() {
  const result = {
    currentVersion: getCurrentAppVersion(),
    availableVersion: null,
    channelPlatformKey: null,
    coremanifest: null,
    dbmanifest: null,
    bpsarchives: null,
    error: null
  };

  try {
    const channel = getCurrentChannel();
    const plat = getCurrentPlatform();
    const platform = plat?.platform;
    const format = plat?.format;
    if (platform && format) {
      result.channelPlatformKey = `${channel}/RHPLAY/${platform}/${format}`;
    }

    const updateCheck = checkForSoftwareUpdate();
    result.availableVersion = updateCheck.availableVersion ?? null;

    const coreResolved = manifestResolver.getCoreManifestPath();
    const core = coreResolved.manifest;
    if (!core) {
      result.error = 'Could not load core manifest';
      return result;
    }

    const platEntry = core[result.channelPlatformKey] || null;
    const pointer = platEntry?.pointer || null;
    const lastupdated = manifestResolver.normalizeLastUpdated(core.lastupdated);

    let coremanifestDatSha256 = null;
    try {
      const userDataDir = manifestResolver.getUserDataDir();
      const datPath = path.join(userDataDir, 'coremanifest_latest.dat');
      if (fs.existsSync(datPath)) {
        coremanifestDatSha256 = sha256File(datPath);
      }
    } catch {
      /* ignore */
    }

    result.coremanifest = {
      versionid: core.versionid ?? null,
      lastupdated,
      lastupdatedHuman: formatTimestamp(lastupdated),
      version_string: core.version_string ?? null,
      pointer,
      coremanifestDatSha256
    };

    const dbEntry = core['beta/dbmanifest.json'] || null;
    const dbVersion = dbEntry?.version ?? null;
    const dbUpdated = manifestResolver.normalizeLastUpdated(dbEntry?.updated ?? null);

    let dbResolved = null;
    let dbActiveSha256 = null;
    try {
      dbResolved = manifestResolver.getDbmanifestPath();
      if (dbResolved?.path && fs.existsSync(dbResolved.path)) {
        dbActiveSha256 = sha256File(dbResolved.path);
      }
    } catch {
      /* use null */
    }

    const dbManifest = dbResolved?.manifest;
    const dbFiles = [];
    if (dbManifest && typeof dbManifest === 'object') {
      const skipKeys = ['lastupdated', 'greetings'];
      for (const key of Object.keys(dbManifest)) {
        if (skipKeys.includes(key)) continue;
        const entry = dbManifest[key];
        let ver = '—';
        if (entry?.version != null) ver = String(entry.version);
        else if (entry?.type === 'appfiles' && entry?.version != null) ver = String(entry.version);
        else if (entry?.base && !entry?.version) ver = '-';
        dbFiles.push({ name: key, version: ver });
      }
    }

    result.dbmanifest = {
      coreEntry: {
        key: 'beta/dbmanifest.json',
        version: dbVersion,
        updated: dbUpdated,
        updatedHuman: formatTimestamp(dbUpdated)
      },
      active: dbResolved ? {
        path: dbResolved.path,
        source: dbResolved.source,
        sha256: dbActiveSha256,
        lastupdated: dbResolved.lastupdated,
        lastupdatedHuman: formatTimestamp(dbResolved.lastupdated),
        files: dbFiles
      } : null
    };

    const bpsEntry = core['beta/bpsarchives.json'] || null;
    const bpsVersion = bpsEntry?.version ?? null;
    const bpsUpdated = manifestResolver.normalizeLastUpdated(bpsEntry?.updated ?? null);

    let bpsResolved = null;
    let bpsActiveSha256 = null;
    try {
      bpsResolved = manifestResolver.getBpsarchivesManifestPath();
      if (bpsResolved?.path && fs.existsSync(bpsResolved.path)) {
        bpsActiveSha256 = sha256File(bpsResolved.path);
      }
    } catch {
      /* use null */
    }

    const bpsManifest = bpsResolved?.manifest;
    const bpsFiles = [];
    if (bpsManifest && typeof bpsManifest === 'object') {
      const skipKeys = ['lastupdated'];
      for (const key of Object.keys(bpsManifest)) {
        if (skipKeys.includes(key)) continue;
        const entry = bpsManifest[key];
        const ver = entry?.version != null ? String(entry.version) : '—';
        bpsFiles.push({ name: key, version: ver });
      }
    }

    result.bpsarchives = {
      coreEntry: {
        key: 'beta/bpsarchives.json',
        version: bpsVersion,
        updated: bpsUpdated,
        updatedHuman: formatTimestamp(bpsUpdated)
      },
      active: bpsResolved ? {
        path: bpsResolved.path,
        source: bpsResolved.source,
        sha256: bpsActiveSha256,
        lastupdated: bpsResolved.lastupdated,
        lastupdatedHuman: formatTimestamp(bpsResolved.lastupdated),
        files: bpsFiles
      } : null
    };

    return result;
  } catch (err) {
    result.error = err.message;
    return result;
  }
}

module.exports = { getAboutInfo };
