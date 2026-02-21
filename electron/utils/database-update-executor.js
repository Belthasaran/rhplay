/**
 * database-update-executor.js
 *
 * Executes database updates: in-place patch application or full re-provision.
 * Spawns prepare_databases.js with appropriate arguments.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const { UPDATEABLE_DATABASES } = require('./database-update-check');

/**
 * Parse a line of stdout for progress info
 * Returns { message, filename, current, total, percent } or null
 */
function parseProgressLine(line) {
  if (!line || typeof line !== 'string') return null;

  const trimmed = line.trim();
  if (!trimmed) return null;

  // [download-start] 1/3 resource.db.initial.xz size=35.7 MB
  const downloadStart = /\[download-start\] (\d+)\/(\d+) (.+?) size=(.+)/.exec(trimmed);
  if (downloadStart) {
    return {
      message: `Downloading ${downloadStart[3]}...`,
      filename: downloadStart[3],
      current: 0,
      total: 0,
      percent: 0
    };
  }

  // [download-progress] res13_to_14.sql.xz 45% (15.2 MB/33.8 MB)
  const downloadProgress = /\[download-progress\] (.+?) (\d+)%/.exec(trimmed);
  if (downloadProgress) {
    return {
      message: `Downloading ${downloadProgress[1]}...`,
      filename: downloadProgress[1],
      current: 0,
      total: 0,
      percent: parseInt(downloadProgress[2], 10)
    };
  }

  // [download-complete] 2/3 res13_to_14.sql.xz
  const downloadComplete = /\[download-complete\] (\d+)\/(\d+) (.+)/.exec(trimmed);
  if (downloadComplete) {
    const n = parseInt(downloadComplete[1], 10);
    const total = parseInt(downloadComplete[2], 10);
    return {
      message: `Downloaded ${downloadComplete[3]}`,
      filename: downloadComplete[3],
      current: n,
      total,
      percent: total > 0 ? Math.floor((n / total) * 100) : 100
    };
  }

  // [patch-start] resource.db: applying res13_to_14.sql.xz
  const patchStart = /\[patch-start\] (.+?): applying (.+)/.exec(trimmed);
  if (patchStart) {
    return {
      message: `Applying patch to ${patchStart[1]}...`,
      filename: patchStart[2],
      current: 0,
      total: 0,
      percent: 0
    };
  }

  // [patch-complete] resource.db: applied res13_to_14.sql.xz
  const patchComplete = /\[patch-complete\] (.+?): applied (.+)/.exec(trimmed);
  if (patchComplete) {
    return {
      message: `Applied patch to ${patchComplete[1]}`,
      filename: patchComplete[2],
      current: 0,
      total: 0,
      percent: 0
    };
  }

  // [update] resource.db: finalized at ...
  const updateFinal = /\[update\] (.+?): finalized/.exec(trimmed);
  if (updateFinal) {
    return {
      message: `Updated ${updateFinal[1]}`,
      filename: updateFinal[1],
      current: 0,
      total: 0,
      percent: 0
    };
  }

  // [provision] resource.db: action=...
  const provisionAction = /\[provision\] (.+?): action=/.exec(trimmed);
  if (provisionAction) {
    return {
      message: `Provisioning ${provisionAction[1]}...`,
      filename: provisionAction[1],
      current: 0,
      total: 0,
      percent: 0
    };
  }

  return null;
}

/**
 * Spawn prepare_databases and stream stdout/stderr, calling progressCallback for progress lines
 */
function spawnPrepareDatabases(args, progressCallback) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let lastProgress = null;

    const processLine = (line) => {
      const progress = parseProgressLine(line);
      if (progress && progressCallback) {
        lastProgress = progress;
        progressCallback(progress);
      }
    };

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    child.stdout.on('data', (chunk) => {
      chunk
        .split(/\r?\n/)
        .filter(Boolean)
        .forEach(processLine);
    });

    child.stderr.on('data', (chunk) => {
      chunk
        .split(/\r?\n/)
        .filter(Boolean)
        .forEach((line) => {
          processLine(line);
          console.warn('[prepare_databases]', line);
        });
    });

    child.on('error', (err) => {
      reject(err);
    });

    child.on('close', (code, signal) => {
      if (code === 0) {
        resolve({ success: true });
      } else {
        resolve({ success: false, exitCode: code, signal });
      }
    });
  });
}

/**
 * Execute database update: patch where possible, re-provision where not
 *
 * @param {Array} updates - From checkForDatabaseUpdates (dbName, canPatch, patchesToApply, manifestEntry, etc.)
 * @param {Object} options - { manifestPath, userDataDir, provisionerScriptPath, workingDir, progressCallback }
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
async function executeDatabaseUpdate(updates, options) {
  const {
    manifestPath,
    userDataDir,
    provisionerScriptPath,
    workingDir,
    progressCallback
  } = options;

  if (!manifestPath || !userDataDir || !provisionerScriptPath) {
    return { success: false, error: 'Missing required paths (manifestPath, userDataDir, provisionerScriptPath)' };
  }

  const ensureDir = (p) => {
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
  };
  ensureDir(workingDir);

  const progressLogPath = path.join(workingDir, 'db-update-progress.log');
  const progressDonePath = path.join(workingDir, 'db-update-progress.done.json');

  const patchable = updates.filter((u) => u.canPatch && u.patchesToApply && u.patchesToApply.length > 0);
  const nonPatchable = updates.filter((u) => !u.canPatch);

  // 1. Run update mode for patchable databases
  if (patchable.length > 0) {
    const updatePlanPath = path.join(workingDir, 'db-update-plan.json');
    const plan = {
      updates: patchable.map((u) => ({
        dbName: u.dbName,
        currentVersion: u.currentVersion,
        targetVersion: u.targetVersion,
        patchesToApply: u.patchesToApply,
        manifestEntry: u.manifestEntry
      }))
    };
    fs.writeFileSync(updatePlanPath, JSON.stringify(plan, null, 2), 'utf8');

    const args = [
      provisionerScriptPath,
      '--manifest', manifestPath,
      '--user-data-dir', userDataDir,
      '--working-dir', workingDir,
      '--ensure-dirs',
      '--progress-log', progressLogPath,
      '--progress-done', progressDonePath,
      '--update-mode',
      '--update-plan', updatePlanPath
    ];

    const cb = (p) => {
      if (progressCallback) progressCallback({ ...p, phase: 'patch' });
    };

    const result = await spawnPrepareDatabases(args, cb);
    if (!result.success) {
      return {
        success: false,
        error: `Patch update failed with exit code ${result.exitCode || result.signal}`
      };
    }
  }

  // 2. Re-provision non-patchable databases
  if (nonPatchable.length > 0) {
    const overwriteList = nonPatchable.map((u) => u.dbName).join(',');
    const args = [
      provisionerScriptPath,
      '--manifest', manifestPath,
      '--user-data-dir', userDataDir,
      '--working-dir', workingDir,
      '--ensure-dirs',
      '--overwrite', overwriteList,
      '--provision',
      '--progress-log', progressLogPath,
      '--progress-done', progressDonePath
    ];

    const cb = (p) => {
      if (progressCallback) progressCallback({ ...p, phase: 'reprovision' });
    };

    const result = await spawnPrepareDatabases(args, cb);
    if (!result.success) {
      return {
        success: false,
        error: `Re-provision failed with exit code ${result.exitCode || result.signal}`
      };
    }
  }

  return { success: true };
}

/**
 * Execute full re-provision of updateable databases (excludes clientdata.db)
 *
 * @param {Object} options - { manifestPath, userDataDir, provisionerScriptPath, workingDir, progressCallback }
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
async function executeReProvision(options) {
  const {
    manifestPath,
    userDataDir,
    provisionerScriptPath,
    workingDir,
    progressCallback
  } = options;

  if (!manifestPath || !userDataDir || !provisionerScriptPath) {
    return { success: false, error: 'Missing required paths (manifestPath, userDataDir, provisionerScriptPath)' };
  }

  const ensureDir = (p) => {
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
  };
  ensureDir(workingDir);

  const overwriteList = UPDATEABLE_DATABASES.join(',');
  const progressLogPath = path.join(workingDir, 'db-reprovision-progress.log');
  const progressDonePath = path.join(workingDir, 'db-reprovision-progress.done.json');

  const args = [
    provisionerScriptPath,
    '--manifest', manifestPath,
    '--user-data-dir', userDataDir,
    '--working-dir', workingDir,
    '--ensure-dirs',
    '--overwrite', overwriteList,
    '--provision',
    '--progress-log', progressLogPath,
    '--progress-done', progressDonePath
  ];

  const result = await spawnPrepareDatabases(args, progressCallback);
  if (!result.success) {
    return {
      success: false,
      error: `Re-provision failed with exit code ${result.exitCode || result.signal}`
    };
  }

  return { success: true };
}

module.exports = {
  executeDatabaseUpdate,
  executeReProvision,
  parseProgressLine
};
