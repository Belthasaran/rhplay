#!/usr/bin/env node

/**
 * smwcw_waiting_upload.js - Upload waiting 7z packages to IPFS and Pixeldrain
 *
 * For each waiting_<GAMEID>.7z in upload/, runs ipfs add and Pixeldrain PUT.
 * After verification, moves to upload/done/ and appends GameID to persistent
 * completed registry (waiting_packages_completed.json).
 *
 * Usage:
 *   enode.sh ~/rhplay/jstools/smwcw_waiting_upload.js [options]
 *
 * Options:
 *   --dry-run     List files that would be uploaded, do not upload
 *   --skip-ipfs   Skip IPFS add
 *   --skip-pd     Skip Pixeldrain upload
 *   --help        Show this help message
 *
 * Environment:
 *   PIXELDRAIN_API_KEY - Required for Pixeldrain upload (Basic auth, empty user)
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { loadCompletedRegistry } = require('./smwcw_waiting_build7z');
const { appendUpdate, copyToUpload } = require('./update_waiting_index');

const CONFIG = {
  OUTPUT_DIR: path.join(__dirname, 'smwc_world'),
  UPLOAD_DIR: path.join(__dirname, 'smwc_world', 'upload'),
  DONE_DIR: path.join(__dirname, 'smwc_world', 'upload', 'done'),
  STATE_PATH: path.join(__dirname, 'smwc_world', 'upload', 'upload_state.json'),
  COMPLETED_REGISTRY_PATH: path.join(__dirname, 'smwc_world', 'waiting_packages_completed.json')
};

function loadUploadState() {
  if (!fs.existsSync(CONFIG.STATE_PATH)) {
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(CONFIG.STATE_PATH, 'utf8'));
  } catch (e) {
    return {};
  }
}

function saveUploadState(state) {
  fs.mkdirSync(path.dirname(CONFIG.STATE_PATH), { recursive: true });
  fs.writeFileSync(CONFIG.STATE_PATH, JSON.stringify(state, null, 2));
}

function appendToCompletedRegistry(gameid) {
  let list = [];
  if (fs.existsSync(CONFIG.COMPLETED_REGISTRY_PATH)) {
    try {
      const raw = fs.readFileSync(CONFIG.COMPLETED_REGISTRY_PATH, 'utf8');
      const data = JSON.parse(raw);
      list = Array.isArray(data) ? data : (data.gameids || []);
    } catch (e) {
      list = [];
    }
  }
  if (!list.includes(gameid)) {
    list.push(gameid);
    list.sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
    fs.writeFileSync(CONFIG.COMPLETED_REGISTRY_PATH, JSON.stringify(list, null, 2));
  }
}

function getUploadFiles() {
  if (!fs.existsSync(CONFIG.UPLOAD_DIR)) return [];
  const files = fs.readdirSync(CONFIG.UPLOAD_DIR);
  return files
    .filter(f => f.startsWith('waiting_') && f.endsWith('.7z'))
    .map(f => ({
      filename: f,
      gameid: f.replace(/^waiting_(\d+)\.7z$/, '$1'),
      path: path.join(CONFIG.UPLOAD_DIR, f)
    }))
    .filter(o => /^\d+$/.test(o.gameid));
}

function runIpfsAdd(filePath) {
  const result = spawnSync('ipfs', ['add', '--cid-version', '1', '--quiet', filePath], {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe']
  });
  if (result.status !== 0) {
    throw new Error(`ipfs add failed: ${result.stderr || result.stdout || 'unknown'}`);
  }
  const cid = (result.stdout || '').trim().split(/\s+/)[0];
  if (!cid) throw new Error('ipfs add produced no CID');
  return cid;
}

async function uploadToPixeldrain(filePath, filename) {
  const apiKey = process.env.PIXELDRAIN_API_KEY;
  if (!apiKey) {
    return { skipped: true, reason: 'PIXELDRAIN_API_KEY not set' };
  }
  const url = `https://pixeldrain.com/api/file/${encodeURIComponent(filename)}`;
  const auth = Buffer.from(':' + apiKey).toString('base64');
  const fileData = fs.readFileSync(filePath);
  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': 'Basic ' + auth,
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(fileData.length)
    },
    body: fileData
  });
  if (response.status !== 201) {
    const errBody = await response.text();
    throw new Error(`Pixeldrain upload failed ${response.status}: ${errBody}`);
  }
  const json = await response.json();
  return { id: json.id };
}

async function processFile(entry, state, options) {
  const { filename, gameid, path: filePath } = entry;
  const existing = state[filename] || {};
  let ipfsCid = existing.ipfs_cid || null;
  let pixeldrainId = existing.pixeldrain_id || null;

  if (!options.skipIpfs && !ipfsCid) {
    ipfsCid = runIpfsAdd(filePath);
    state[filename] = state[filename] || {};
    state[filename].ipfs_cid = ipfsCid;
  }
  if (!options.skipPd && !pixeldrainId) {
    const pdResult = await uploadToPixeldrain(filePath, filename);
    if (pdResult.skipped) {
      // No API key - skip without error
    } else {
      pixeldrainId = pdResult.id;
      state[filename] = state[filename] || {};
      state[filename].pixeldrain_id = pixeldrainId;
    }
  }

  const ipfsOk = options.skipIpfs || ipfsCid;
  const pdOk = options.skipPd || pixeldrainId || !process.env.PIXELDRAIN_API_KEY;
  const verified = ipfsOk && pdOk;

  return { ipfsCid, pixeldrainId, verified };
}

async function main() {
  const argv = process.argv.slice(2);
  const options = {
    dryRun: false,
    skipIpfs: false,
    skipPd: false
  };

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dry-run') options.dryRun = true;
    else if (argv[i] === '--skip-ipfs') options.skipIpfs = true;
    else if (argv[i] === '--skip-pd') options.skipPd = true;
    else if (argv[i] === '--help' || argv[i] === '-h') {
      console.log(`
Usage: enode.sh smwcw_waiting_upload.js [options]

Upload waiting 7z packages to IPFS and Pixeldrain. After verification, moves to
upload/done/ and appends GameID to persistent completed registry.

Options:
  --dry-run     List files that would be uploaded, do not upload
  --skip-ipfs   Skip IPFS add
  --skip-pd     Skip Pixeldrain upload
  --help        Show this help message

Environment:
  PIXELDRAIN_API_KEY - Required for Pixeldrain upload
`);
      process.exit(0);
    }
  }

  const completed = new Set(loadCompletedRegistry());
  const files = getUploadFiles();
  const toProcess = files.filter(f => !completed.has(f.gameid));

  try {
    appendUpdate();
    copyToUpload();
  } catch (e) {
    console.warn(`Warning: update_waiting_index failed: ${e.message}`);
  }

  if (toProcess.length === 0) {
    console.log('No files to upload (all in completed registry or no waiting_*.7z in upload/)');
    process.exit(0);
  }

  if (options.dryRun) {
    console.log('DRY RUN - would upload:');
    for (const f of toProcess) {
      console.log(`  ${f.filename}`);
    }
    process.exit(0);
  }

  const state = loadUploadState();
  let moved = 0;
  let failed = 0;

  for (const entry of toProcess) {
    try {
      const { verified } = await processFile(entry, state, options);
      saveUploadState(state);

      if (verified) {
        const donePath = path.join(CONFIG.DONE_DIR, entry.filename);
        fs.mkdirSync(CONFIG.DONE_DIR, { recursive: true });
        fs.renameSync(entry.path, donePath);
        appendToCompletedRegistry(entry.gameid);
        delete state[entry.filename];
        saveUploadState(state);
        console.log(`Uploaded and moved to done: ${entry.filename}`);
        moved++;
      } else {
        console.log(`Uploaded (verification pending): ${entry.filename}`);
      }
    } catch (e) {
      console.error(`Failed ${entry.filename}: ${e.message}`);
      failed++;
    }
  }

  console.log(`\nMoved to done: ${moved}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

if (require.main === module) {
  main().catch(e => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = { main, getUploadFiles, runIpfsAdd, uploadToPixeldrain, CONFIG };
