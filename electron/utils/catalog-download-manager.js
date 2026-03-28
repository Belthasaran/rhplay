#!/usr/bin/env node

/**
 * catalog-download-manager.js
 *
 * Utility to download bps7z archives and search catalog files based on
 * bpsarchives.json manifest. Supports IPFS, ArDrive, URL (addr), and
 * base64-encoded URL (baddr) downloads.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');
const { Readable, Transform } = require('stream');
const ipfsFetchConfig = require('./ipfs-fetch-config');
const arweaveFetchConfig = require('./arweave-fetch-config');

const DEFAULT_BPS_DRIVE_ID = 'd3338fab-d24c-4d75-9e78-d3024befc225';
const DEFAULT_BPS_FOLDER_ID = 'a6130936-d92e-45ac-a004-273d96e9ec9d';

function sha256File(filePath) {
  try {
    const buffer = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(buffer).digest('hex');
  } catch (err) {
    return null;
  }
}

function normalizeSha256Hex(hex) {
  if (hex == null) return '';
  return String(hex).trim().toLowerCase();
}

/** Compare manifest / on-disk SHA256 hex (case-insensitive; avoids false "mismatch" then fallback to IPFS). */
function sha256MatchesExpected(filePath, expectedHex) {
  if (!expectedHex) return true;
  const actual = sha256File(filePath);
  if (!actual) return false;
  return normalizeSha256Hex(actual) === normalizeSha256Hex(expectedHex);
}

function decodeBaddr(b64) {
  try {
    const decoded = Buffer.from(b64, 'base64').toString('utf8');
    if (decoded.startsWith('http://') || decoded.startsWith('https://')) {
      return decoded.trim();
    }
    return null;
  } catch (err) {
    return null;
  }
}

function getUrlsFromSpec(spec) {
  const urls = [];
  let index = 0;
  if (spec.url) {
    const urlArray = Array.isArray(spec.url) ? spec.url : [spec.url];
    urlArray.forEach((url) => {
      urls.push({ url, type: 'url', index: index++ });
    });
  }
  if (spec.baddr) {
    const baddrArray = Array.isArray(spec.baddr) ? spec.baddr : [spec.baddr];
    baddrArray.forEach((b64) => {
      const decoded = decodeBaddr(b64);
      if (decoded) {
        urls.push({ url: decoded, type: 'baddr', index: index++ });
      }
    });
  }
  return urls;
}

function parsePriority(priority, spec) {
  const urlArray = getUrlsFromSpec(spec);
  const hasUrls = urlArray.length > 0;
  
  if (!priority) {
    const sources = [];
    if (spec.ipfs_cidv1) {
      sources.push({ type: 'ipfs', cid: spec.ipfs_cidv1 });
    }
    if (hasUrls) {
      urlArray.forEach((urlObj) => {
        sources.push({ type: 'url', url: urlObj.url, urlType: urlObj.type, index: urlObj.index });
      });
    }
    if (spec.data_txid || spec.ardrive_file_path || spec.ardrive_file_id) {
      sources.push({ 
        type: 'ardrive', 
        txid: spec.data_txid, 
        path: spec.ardrive_file_path,
        fileId: spec.ardrive_file_id,
        driveId: spec.ardrive_drive_id || DEFAULT_BPS_DRIVE_ID,
        folderId: spec.ardrive_folder_id || DEFAULT_BPS_FOLDER_ID
      });
    }
    return sources;
  }

  const sources = [];
  for (const token of priority) {
    if (token === 'ipfs' && spec.ipfs_cidv1) {
      sources.push({ type: 'ipfs', cid: spec.ipfs_cidv1 });
    } else if (token === 'ardrive' && (spec.data_txid || spec.ardrive_file_path || spec.ardrive_file_id)) {
      sources.push({ 
        type: 'ardrive', 
        txid: spec.data_txid, 
        path: spec.ardrive_file_path,
        fileId: spec.ardrive_file_id,
        driveId: spec.ardrive_drive_id || DEFAULT_BPS_DRIVE_ID,
        folderId: spec.ardrive_folder_id || DEFAULT_BPS_FOLDER_ID
      });
    } else if (token === 'url' || token === 'baddr') {
      urlArray.forEach((urlObj) => {
        sources.push({ type: 'url', url: urlObj.url, urlType: urlObj.type, index: urlObj.index });
      });
    } else if (token.startsWith('url.') || token.startsWith('baddr.')) {
      const idx = parseInt(token.substring(token.indexOf('.') + 1), 10);
      if (!isNaN(idx) && idx >= 0) {
        const urlObj = urlArray.find((u) => u.index === idx);
        if (urlObj) {
          sources.push({ type: 'url', url: urlObj.url, urlType: urlObj.type, index: urlObj.index });
        }
      }
    }
  }
  return sources;
}

async function downloadFromUrl(url, destPath, expectedSha256, spec, downloadTracker, sourceLabel, timeoutMs = 4 * 60 * 1000) {
  console.log(`[download-attempt] ${spec.file_name} via ${sourceLabel || url}`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(url, { signal: controller.signal });
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
  clearTimeout(timeout);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  const totalBytes = Number(response.headers.get('content-length')) || 0;
  if (downloadTracker) {
    downloadTracker.start(spec, totalBytes);
  }

  const tempPath = `${destPath}.download`;
  const writeStream = fs.createWriteStream(tempPath);
  const bodyStream = Readable.fromWeb(response.body);
  let downloadedBytes = 0;
  const tracker = new Transform({
    transform(chunk, encoding, callback) {
      downloadedBytes += chunk.length;
      if (downloadTracker) {
        downloadTracker.progress(spec, downloadedBytes, totalBytes);
      }
      callback(null, chunk);
    },
  });

  await pipeline(bodyStream, tracker, writeStream);
  writeStream.close();

  if (expectedSha256) {
    const actualSha = sha256File(tempPath);
    if (normalizeSha256Hex(actualSha) !== normalizeSha256Hex(expectedSha256)) {
      fs.unlinkSync(tempPath);
      throw new Error(`SHA-256 mismatch (expected ${expectedSha256}, got ${actualSha})`);
    }
  }

  await fs.promises.rename(tempPath, destPath);

  if (downloadTracker) {
    downloadTracker.complete(spec);
  }
}

async function downloadFromArDrive(spec, destPath, downloadTracker, userDataDir) {
  const opts = { destPath, expectedSha256: spec.sha256, spec, downloadTracker, userDataDir };
  if (spec.data_txid) {
    try {
      await arweaveFetchConfig.fetchFromArweave({ ...opts, txid: spec.data_txid, sourceLabel: 'arweave:data_txid' });
      return;
    } catch (err) {
      console.error(`[download-error] ${spec.file_name} via arweave:data_txid -> ${err.message}`);
    }
  }
  
  if (spec.ardrive_file_path) {
    try {
      await arweaveFetchConfig.fetchFromArweave({ ...opts, path: spec.ardrive_file_path, sourceLabel: 'arweave:ardrive_path' });
      return;
    } catch (err) {
      console.error(`[download-error] ${spec.file_name} via arweave:ardrive_path -> ${err.message}`);
    }
  }
  
  // Try ardrive_file_id (fallback to Arweave URL if file_id is available)
  // Note: Full ArDrive API implementation would require ardrive-core-js
  // For now, we use the data_txid if available, or construct URL from file_id metadata
  if (spec.ardrive_file_id) {
    let lastErr = null;
    if (spec.data_txid) {
      try {
        await arweaveFetchConfig.fetchFromArweave({ ...opts, txid: spec.data_txid, sourceLabel: 'arweave:file_id' });
        return;
      } catch (err) {
        lastErr = err;
        console.error(`[download-error] ${spec.file_name} via arweave:file_id -> ${err.message}`);
      }
    }
    if (spec.ardrive_file_path) {
      try {
        await arweaveFetchConfig.fetchFromArweave({ ...opts, path: spec.ardrive_file_path, sourceLabel: 'arweave:file_id_path' });
        return;
      } catch (err) {
        lastErr = err;
        console.error(`[download-error] ${spec.file_name} via arweave:file_id_path -> ${err.message}`);
      }
    }
    if (lastErr) {
      throw lastErr;
    }
    throw new Error(`ArDrive file_id download requires data_txid or ardrive_file_path (file_id: ${spec.ardrive_file_id})`);
  }
  
  throw new Error('No ArDrive download source available');
}

async function ensureArtifact(spec, workingDir, downloadTracker, userDataDir, ipfsTimeout = 20, finalDestinationDir = null) {
  // If finalDestinationDir is provided, download directly there; otherwise use workingDir
  const destPath = finalDestinationDir 
    ? path.join(finalDestinationDir, spec.file_name)
    : path.join(workingDir, spec.file_name);
  
  // Ensure destination directory exists
  const destDir = path.dirname(destPath);
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }
  
  if (downloadTracker) {
    downloadTracker.register(spec);
  }
  if (fs.existsSync(destPath) && (!spec.sha256 || sha256MatchesExpected(destPath, spec.sha256))) {
    console.log(`[download-cached] ${spec.file_name} already present with matching hash.`);
    if (downloadTracker) {
      downloadTracker.skip(spec);
    }
    return destPath;
  }

  if (fs.existsSync(destPath)) {
    console.warn(`[download-retry] ${spec.file_name} present but hash mismatch, re-downloading.`);
  }

  // Search local paths first
  if (spec.sha256) {
    const downloadsDir = path.join(userDataDir, 'downloads');
    const searchPaths = [
      workingDir,
      downloadsDir, // Program data downloads directory
      path.join(os.homedir(), 'Downloads'),
    ];
    
    for (const searchDir of searchPaths) {
      if (!fs.existsSync(searchDir)) continue;
      
      const findFile = (dir) => {
        try {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              const found = findFile(fullPath);
              if (found) return found;
            } else if (entry.name === spec.file_name || (spec.sha256 && sha256MatchesExpected(fullPath, spec.sha256))) {
              return fullPath;
            }
          }
        } catch (err) {
          // Skip unreadable directories
        }
        return null;
      };
      
      const localFile = findFile(searchDir);
      if (localFile) {
        console.log(`[download-local] Found ${spec.file_name} at ${localFile}`);
        // Ensure destination directory exists before copying
        const destDir = path.dirname(destPath);
        if (!fs.existsSync(destDir)) {
          fs.mkdirSync(destDir, { recursive: true });
        }
        fs.copyFileSync(localFile, destPath);
        if (spec.sha256 && !sha256MatchesExpected(destPath, spec.sha256)) {
          fs.unlinkSync(destPath);
          throw new Error(`Local file hash mismatch for ${spec.file_name}`);
        }
        if (downloadTracker) {
          downloadTracker.skip(spec);
        }
        return destPath;
      }
    }
  }

  // Parse priority and attempt downloads
  const urlArray = getUrlsFromSpec(spec);
  const hasUrls = urlArray.length > 0;
  // Prefer HTTP(S) before IPFS when both exist — only try the next method if the previous one failed.
  const priority = spec.priority || (hasUrls ? ['url', 'ipfs', 'ardrive'] : ['ipfs', 'ardrive']);
  const sources = parsePriority(priority, spec);

  let lastError = null;

  for (const source of sources) {
    if (fs.existsSync(destPath) && spec.sha256 && sha256MatchesExpected(destPath, spec.sha256)) {
      return destPath;
    }
    try {
      if (source.type === 'ipfs') {
        let ipfsProgressCallback = spec._ipfsProgressCallback;
        if (!ipfsProgressCallback && downloadTracker && downloadTracker.register) {
          ipfsProgressCallback = (message) => {
            downloadTracker.register({
              file_name: spec.file_name || 'unknown',
              _progressMessage: message,
            });
          };
        }
        await ipfsFetchConfig.fetchFromIpfs({
          cid: source.cid,
          destPath,
          expectedSha256: spec.sha256,
          spec,
          downloadTracker,
          ipfsTimeout,
          progressCallback: ipfsProgressCallback,
          userDataDir,
        });
        return destPath;
      } else if (source.type === 'url') {
        try {
          await downloadFromUrl(source.url, destPath, spec.sha256, spec, downloadTracker, `url:${source.index}`);
          return destPath;
        } catch (err) {
          lastError = err;
          console.error(`[download-error] ${spec.file_name} via url.${source.index} -> ${err.message}`);
        }
      } else if (source.type === 'ardrive') {
        try {
          await downloadFromArDrive(spec, destPath, downloadTracker, userDataDir);
          return destPath;
        } catch (err) {
          lastError = err;
          console.error(`[download-error] ${spec.file_name} via ardrive -> ${err.message}`);
        }
      }
    } catch (err) {
      lastError = err;
    }
  }

  if (sources.length === 0) {
    console.error(`[download-fail] ${spec.file_name}: no download sources available in manifest.`);
  } else {
    console.error(
      `[download-fail] ${spec.file_name}: exhausted ${sources.length} source(s). Last error was: ${
        lastError ? lastError.message : 'unknown'
      }`
    );
  }

  throw new Error(
    `Failed to download ${spec.file_name}: ${lastError ? lastError.message : 'no sources available'}`
  );
}

function createDownloadTracker() {
  const state = {
    total: 0,
    completed: 0,
  };

  return {
    register(spec) {
      if (spec.__downloadOrder) {
        return;
      }
      spec.__downloadOrder = ++state.total;
    },
    start(spec, totalBytes) {
      spec.__downloadBytesTotal = totalBytes || 0;
      spec.__downloadLastPercent = -1;
      spec.__downloadLastBytes = 0;
      console.log(
        `[download-start] ${spec.__downloadOrder}/${state.total} ${spec.file_name} size=${formatBytes(totalBytes)}`
      );
    },
    progress(spec, downloaded, totalBytes) {
      if (totalBytes > 0) {
        const percent = Math.floor((downloaded / totalBytes) * 100);
        if (percent >= (spec.__downloadLastPercent ?? -1) + 5) {
          spec.__downloadLastPercent = percent;
          console.log(
            `[download-progress] ${spec.file_name} ${percent}% (${formatBytes(downloaded)}/${formatBytes(totalBytes)})`
          );
        }
      } else {
        if (downloaded - (spec.__downloadLastBytes ?? 0) >= 5 * 1024 * 1024) {
          spec.__downloadLastBytes = downloaded;
          console.log(
            `[download-progress] ${spec.file_name} downloaded ${formatBytes(downloaded)} (total unknown)`
          );
        }
      }
    },
    complete(spec) {
      state.completed += 1;
      console.log(
        `[download-complete] ${spec.__downloadOrder}/${state.total} ${spec.file_name}`
      );
    },
    skip(spec) {
      console.log(`[download-skip] ${spec.file_name} already present`);
      state.completed += 1;
    },
  };
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return 'unknown';
  }
  const units = ['B', 'KB', 'MB', 'GB'];
  let idx = 0;
  let value = bytes;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  return `${value.toFixed(idx === 0 ? 0 : 1)}${units[idx]}`;
}

/**
 * Download a single target from manifest
 */
async function downloadTarget(manifestEntry, targetName, workingDir, userDataDir, ipfsTimeout, finalDestinationDir = null) {
  const downloadTracker = createDownloadTracker();
  
  if (manifestEntry.base) {
    const basePath = await ensureArtifact(manifestEntry.base, workingDir, downloadTracker, userDataDir, ipfsTimeout, finalDestinationDir);
    return { base: basePath };
  }
  
  throw new Error(`Manifest entry "${targetName}" has no base file specified`);
}

module.exports = { 
  run: async () => {}, 
  ensureArtifact, 
  downloadTarget,
  createDownloadTracker,
  DEFAULT_BPS_DRIVE_ID,
  DEFAULT_BPS_FOLDER_ID
};
