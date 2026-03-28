/**
 * In-process database update / provision using prepare_databases.run (no child process).
 * Mirrors argv building in database-update-executor.js.
 * Sets RHPLAY_PREPARE_DB_THROW=1 so prepare_databases throws instead of process.exit.
 */

const fs = require('fs');
const path = require('path');
const { run } = require('../installer/prepare_databases');
const { UPDATEABLE_DATABASES } = require('./database-update-check');
const { computeAffectedDbs } = require('./database-update-executor');

async function runPrepareThrow(argv) {
  const prev = process.env.RHPLAY_PREPARE_DB_THROW;
  process.env.RHPLAY_PREPARE_DB_THROW = '1';
  try {
    return await run(argv);
  } finally {
    if (prev === undefined) {
      delete process.env.RHPLAY_PREPARE_DB_THROW;
    } else {
      process.env.RHPLAY_PREPARE_DB_THROW = prev;
    }
  }
}

/**
 * @param {Array} updates - from checkForDatabaseUpdates
 * @param {Object} options - manifestPath, userDataDir, workingDir
 */
async function executeDatabaseUpdateInProcess(updates, options) {
  const { manifestPath, userDataDir, workingDir } = options;

  if (!manifestPath || !userDataDir || !workingDir) {
    return { success: false, error: 'Missing required paths (manifestPath, userDataDir, workingDir)' };
  }

  const ensureDir = (p) => {
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
  };
  ensureDir(workingDir);

  const progressLogPath = path.join(workingDir, 'db-update-progress-launcher.log');
  const progressDonePath = path.join(workingDir, 'db-update-progress-launcher.done.json');

  const patchable = updates.filter((u) => u.canPatch && u.patchesToApply && u.patchesToApply.length > 0);
  const nonPatchable = updates.filter((u) => !u.canPatch);

  let patchResults = [];
  let failedPatchable = [];

  if (patchable.length > 0) {
    const updatePlanPath = path.join(workingDir, 'db-update-plan-launcher.json');
    const updateResultPath = path.join(workingDir, 'db-update-result-launcher.json');
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

    const argv = [
      '--manifest',
      manifestPath,
      '--user-data-dir',
      userDataDir,
      '--working-dir',
      workingDir,
      '--ensure-dirs',
      '--progress-log',
      progressLogPath,
      '--progress-done',
      progressDonePath,
      '--update-mode',
      '--update-plan',
      updatePlanPath,
      '--update-result-path',
      updateResultPath
    ];

    let updateResult;
    try {
      updateResult = await runPrepareThrow(argv);
    } catch (err) {
      return {
        success: false,
        partialSuccess: false,
        results: [],
        failedDbs: patchable.map((u) => u.dbName),
        affectedDbs: computeAffectedDbs(patchable.map((u) => u.dbName)),
        error: err.message || String(err)
      };
    }

    patchResults = (updateResult && updateResult.results) || [];
    if (fs.existsSync(updateResultPath)) {
      try {
        const resultJson = fs.readFileSync(updateResultPath, 'utf8');
        patchResults = JSON.parse(resultJson).results || patchResults;
      } catch (err) {
        console.warn('[database-update-inprocess] Failed to parse result file:', err.message);
      }
    }

    failedPatchable = patchResults.filter((r) => !r.success).map((r) => r.dbName);
    const anyPatchSucceeded = patchResults.some((r) => r.success);

    if (!anyPatchSucceeded && patchable.length > 0) {
      return {
        success: false,
        partialSuccess: false,
        results: patchResults,
        failedDbs: failedPatchable,
        affectedDbs: computeAffectedDbs(failedPatchable),
        error: 'Patch update failed'
      };
    }
  }

  if (nonPatchable.length > 0) {
    const overwriteList = nonPatchable.map((u) => u.dbName).join(',');
    const argv = [
      '--manifest',
      manifestPath,
      '--user-data-dir',
      userDataDir,
      '--working-dir',
      workingDir,
      '--ensure-dirs',
      '--overwrite',
      overwriteList,
      '--provision',
      '--progress-log',
      progressLogPath,
      '--progress-done',
      progressDonePath
    ];

    let plan;
    try {
      plan = await runPrepareThrow(argv);
    } catch (err) {
      const failedNonPatchable = nonPatchable.map((u) => u.dbName);
      const allFailed = failedPatchable.concat(failedNonPatchable);
      return {
        success: false,
        partialSuccess: patchResults.some((r) => r.success),
        results: patchResults.concat(failedNonPatchable.map((db) => ({ dbName: db, success: false }))),
        failedDbs: allFailed,
        affectedDbs: computeAffectedDbs(allFailed),
        error: err.message || String(err)
      };
    }

    const provErr =
      plan &&
      plan.provisionResult &&
      Array.isArray(plan.provisionResult.errors) &&
      plan.provisionResult.errors.length > 0;
    if (provErr) {
      const failedNonPatchable = nonPatchable.map((u) => u.dbName);
      const allFailed = failedPatchable.concat(failedNonPatchable);
      return {
        success: false,
        partialSuccess: patchResults.some((r) => r.success),
        results: patchResults.concat(failedNonPatchable.map((db) => ({ dbName: db, success: false }))),
        failedDbs: allFailed,
        affectedDbs: computeAffectedDbs(allFailed),
        error: plan.provisionResult.errors
          .map((e) => (typeof e === 'string' ? e : e.message || JSON.stringify(e)))
          .join('; ')
      };
    }

    patchResults = patchResults.concat(nonPatchable.map((u) => ({ dbName: u.dbName, success: true })));
  }

  failedPatchable = patchResults.filter((r) => !r.success).map((r) => r.dbName);
  if (failedPatchable.length > 0) {
    return {
      success: false,
      partialSuccess: true,
      results: patchResults,
      failedDbs: failedPatchable,
      affectedDbs: computeAffectedDbs(failedPatchable),
      error: `Some databases failed to update: ${failedPatchable.join(', ')}`
    };
  }

  return {
    success: true,
    partialSuccess: false,
    results: patchResults,
    failedDbs: [],
    affectedDbs: []
  };
}

async function executeReProvisionInProcess(options) {
  const { manifestPath, userDataDir, workingDir } = options;

  if (!manifestPath || !userDataDir || !workingDir) {
    return { success: false, error: 'Missing required paths' };
  }

  const ensureDir = (p) => {
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
  };
  ensureDir(workingDir);

  const progressLogPath = path.join(workingDir, 'db-reprovision-launcher.log');
  const progressDonePath = path.join(workingDir, 'db-reprovision-launcher.done.json');
  const overwriteList = UPDATEABLE_DATABASES.join(',');

  const argv = [
    '--manifest',
    manifestPath,
    '--user-data-dir',
    userDataDir,
    '--working-dir',
    workingDir,
    '--ensure-dirs',
    '--overwrite',
    overwriteList,
    '--provision',
    '--progress-log',
    progressLogPath,
    '--progress-done',
    progressDonePath
  ];

  try {
    const plan = await runPrepareThrow(argv);
    if (
      plan &&
      plan.provisionResult &&
      Array.isArray(plan.provisionResult.errors) &&
      plan.provisionResult.errors.length > 0
    ) {
      return {
        success: false,
        error: plan.provisionResult.errors
          .map((e) => (typeof e === 'string' ? e : e.message || JSON.stringify(e)))
          .join('; ')
      };
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message || String(err) };
  }
}

async function executeProvisionFullInProcess(options) {
  const { manifestPath, userDataDir, workingDir, overwrite } = options;
  if (!manifestPath || !userDataDir || !workingDir) {
    return { success: false, error: 'Missing required paths' };
  }

  const ensureDir = (p) => {
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
  };
  ensureDir(workingDir);

  const progressLogPath = path.join(workingDir, 'db-provision-launcher.log');
  const progressDonePath = path.join(workingDir, 'db-provision-launcher.done.json');

  const argv = [
    '--manifest',
    manifestPath,
    '--user-data-dir',
    userDataDir,
    '--working-dir',
    workingDir,
    '--ensure-dirs',
    '--provision',
    '--progress-log',
    progressLogPath,
    '--progress-done',
    progressDonePath
  ];

  if (overwrite && overwrite.length) {
    argv.push('--overwrite', Array.isArray(overwrite) ? overwrite.join(',') : overwrite);
  }

  try {
    const plan = await runPrepareThrow(argv);
    if (
      plan &&
      plan.provisionResult &&
      Array.isArray(plan.provisionResult.errors) &&
      plan.provisionResult.errors.length > 0
    ) {
      return {
        success: false,
        error: plan.provisionResult.errors
          .map((e) => (typeof e === 'string' ? e : e.message || JSON.stringify(e)))
          .join('; ')
      };
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message || String(err) };
  }
}

module.exports = {
  executeDatabaseUpdateInProcess,
  executeReProvisionInProcess,
  executeProvisionFullInProcess,
  runPrepareThrow
};
