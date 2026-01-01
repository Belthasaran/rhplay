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

// Reuse download functions from prepare_databases.js
const IPFS_GATEWAYS = [
  'https://ipfs.4everland.io/ipfs/',
  'https://w3s.link/ipfs/',
  'https://cloudflare-ipfs.com/ipfs/',
  'https://ipfs.io/ipfs/',
  'https://gateway.pinata.cloud/ipfs/',
  'https://rhtools.4everland.link/ipfs/'
];

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

  if (downloadTracker) {
    downloadTracker.complete(spec);
  }

  if (expectedSha256) {
    const actualSha = sha256File(tempPath);
    if (actualSha !== expectedSha256) {
      fs.unlinkSync(tempPath);
      throw new Error(`SHA-256 mismatch (expected ${expectedSha256}, got ${actualSha})`);
    }
  }

  await fs.promises.rename(tempPath, destPath);
}

async function downloadFromIpfsParallel(cid, destPath, expectedSha256, spec, downloadTracker, ipfsTimeout = 20, progressCallback = null) {
  const tempDir = path.dirname(destPath);
  const batchSize = 5;
  const abortControllers = [];
  let successfulDownload = null;
  let lastError = null;

  console.log(`[download-ipfs-parallel] ${spec.file_name}: testing ${IPFS_GATEWAYS.length} gateways (5 in parallel)`);

  for (let i = 0; i < IPFS_GATEWAYS.length; i += batchSize) {
    const batch = IPFS_GATEWAYS.slice(i, i + batchSize);
    const batchPromises = batch.map((gateway, batchIdx) => {
      const gatewayUrl = `${gateway}${cid}`;
      const gatewayLabel = `ipfs:${gateway}`;
      const controller = new AbortController();
      abortControllers.push(controller);
      const tempPath = path.join(tempDir, `${spec.file_name}.ipfs.${i + batchIdx}`);

      const timeout = setTimeout(() => {
        controller.abort();
      }, ipfsTimeout * 1000);

      return fetch(gatewayUrl, { signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) {
            throw new Error(`HTTP ${response.status} ${response.statusText}`);
          }

          const totalBytes = Number(response.headers.get('content-length')) || 0;
          if (downloadTracker && !successfulDownload) {
            downloadTracker.start(spec, totalBytes);
          }

          const writeStream = fs.createWriteStream(tempPath);
          const bodyStream = Readable.fromWeb(response.body);
          let downloadedBytes = 0;
          const tracker = new Transform({
            transform(chunk, encoding, callback) {
              downloadedBytes += chunk.length;
              if (downloadTracker && !successfulDownload) {
                downloadTracker.progress(spec, downloadedBytes, totalBytes);
              }
              callback(null, chunk);
            },
          });

          await pipeline(bodyStream, tracker, writeStream);
          writeStream.close();

          if (expectedSha256) {
            const actualSha = sha256File(tempPath);
            if (actualSha !== expectedSha256) {
              fs.unlinkSync(tempPath);
              throw new Error(`SHA-256 mismatch (expected ${expectedSha256}, got ${actualSha})`);
            }
          }

          clearTimeout(timeout);
          return { success: true, path: tempPath, label: gatewayLabel };
        })
        .catch((err) => {
          clearTimeout(timeout);
          if (fs.existsSync(tempPath)) {
            try {
              fs.unlinkSync(tempPath);
            } catch {
              // Ignore cleanup errors
            }
          }
          const errorMsg = err.name === 'AbortError' ? `Timeout after ${ipfsTimeout}s` : err.message;
          return { success: false, error: errorMsg, label: gatewayLabel };
        });
    });

    // Send progress message about testing gateways
    if (progressCallback) {
      progressCallback(`Testing ${IPFS_GATEWAYS.length} IPFS gateways (in parallel)...`);
    }
    
    const batchResults = await Promise.allSettled(batchPromises);

    for (const result of batchResults) {
      if (result.status === 'fulfilled' && result.value.success && !successfulDownload) {
        successfulDownload = result.value;
        console.log(`[download-success] ${spec.file_name} via ${successfulDownload.label}`);

        abortControllers.forEach((controller) => {
          try {
            controller.abort();
          } catch {
            // Ignore abort errors
          }
        });

        fs.copyFileSync(successfulDownload.path, destPath);
        fs.unlinkSync(successfulDownload.path);

        if (downloadTracker) {
          downloadTracker.complete(spec);
        }

        return;
      } else if (result.status === 'fulfilled' && !result.value.success) {
        lastError = new Error(result.value.error);
        console.error(`[download-error] ${spec.file_name} via ${result.value.label} -> ${result.value.error}`);
      }
    }

    if (successfulDownload) {
      break;
    }
  }

  for (let i = 0; i < IPFS_GATEWAYS.length; i++) {
    const tempPath = path.join(tempDir, `${spec.file_name}.ipfs.${i}`);
    if (fs.existsSync(tempPath)) {
      try {
        fs.unlinkSync(tempPath);
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  if (!successfulDownload) {
    throw new Error(
      `All IPFS gateways failed. Last error: ${lastError ? lastError.message : 'unknown'}`
    );
  }
}

async function downloadFromArDrive(spec, destPath, downloadTracker) {
  // Try data_txid first (direct Arweave transaction)
  if (spec.data_txid) {
    const url = `https://arweave.net/${spec.data_txid}`;
    try {
      await downloadFromUrl(url, destPath, spec.sha256, spec, downloadTracker, 'arweave:data_txid');
      return;
    } catch (err) {
      console.error(`[download-error] ${spec.file_name} via arweave:data_txid -> ${err.message}`);
    }
  }
  
  // Try ardrive_file_path (ArDrive path-based download)
  if (spec.ardrive_file_path) {
    const url = `https://arweave.net${spec.ardrive_file_path}`;
    try {
      await downloadFromUrl(url, destPath, spec.sha256, spec, downloadTracker, 'arweave:ardrive_path');
      return;
    } catch (err) {
      console.error(`[download-error] ${spec.file_name} via arweave:ardrive_path -> ${err.message}`);
    }
  }
  
  // Try ardrive_file_id (fallback to Arweave URL if file_id is available)
  // Note: Full ArDrive API implementation would require ardrive-core-js
  // For now, we use the data_txid if available, or construct URL from file_id metadata
  if (spec.ardrive_file_id) {
    // If we have a data_txid, use it (most reliable)
    if (spec.data_txid) {
      const url = `https://arweave.net/${spec.data_txid}`;
      try {
        await downloadFromUrl(url, destPath, spec.sha256, spec, downloadTracker, 'arweave:file_id');
        return;
      } catch (err) {
        console.error(`[download-error] ${spec.file_name} via arweave:file_id -> ${err.message}`);
      }
    }
    
    // If we have ardrive_file_path, use it
    if (spec.ardrive_file_path) {
      const url = `https://arweave.net${spec.ardrive_file_path}`;
      try {
        await downloadFromUrl(url, destPath, spec.sha256, spec, downloadTracker, 'arweave:file_id_path');
        return;
      } catch (err) {
        console.error(`[download-error] ${spec.file_name} via arweave:file_id_path -> ${err.message}`);
      }
    }
    
    // TODO: Full ArDrive API implementation using ardrive-core-js
    // This would require:
    // 1. ArDrive authentication (if needed)
    // 2. File metadata lookup by file_id
    // 3. Download using ArDrive API
    // For now, throw error if no fallback available
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
  if (fs.existsSync(destPath) && (!spec.sha256 || sha256File(destPath) === spec.sha256)) {
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
            } else if (entry.name === spec.file_name || (spec.sha256 && sha256File(fullPath) === spec.sha256)) {
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
        if (spec.sha256 && sha256File(destPath) !== spec.sha256) {
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
  const priority = spec.priority || (hasUrls ? ['ipfs', 'url', 'ardrive'] : ['ipfs', 'ardrive']);
  const sources = parsePriority(priority, spec);

  let lastError = null;

  for (const source of sources) {
    try {
      if (source.type === 'ipfs') {
        const fileSizeMB = spec.size ? parseInt(spec.size, 10) / (1024 * 1024) : null;
        const useParallel = fileSizeMB !== null && fileSizeMB < 180;

        if (useParallel && spec.sha256) {
          // Use the progress callback attached to spec, or create one from downloadTracker
          let ipfsProgressCallback = spec._ipfsProgressCallback;
          if (!ipfsProgressCallback && downloadTracker && downloadTracker.register) {
            ipfsProgressCallback = (message) => {
              // Use register to send status messages by passing a spec with _progressMessage
              downloadTracker.register({ 
                file_name: spec.file_name || 'unknown',
                _progressMessage: message 
              });
            };
          }
          await downloadFromIpfsParallel(source.cid, destPath, spec.sha256, spec, downloadTracker, ipfsTimeout, ipfsProgressCallback);
          return destPath;
        } else {
          for (const gateway of IPFS_GATEWAYS) {
            const url = `${gateway}${source.cid}`;
            try {
              await downloadFromUrl(url, destPath, spec.sha256, spec, downloadTracker, `ipfs:${gateway}`, ipfsTimeout * 1000);
              return destPath;
            } catch (err) {
              lastError = err;
              console.error(`[download-error] ${spec.file_name} via ipfs:${gateway} -> ${err.message}`);
            }
          }
        }
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
          await downloadFromArDrive(spec, destPath, downloadTracker);
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
