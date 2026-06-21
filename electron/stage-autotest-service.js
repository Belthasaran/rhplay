'use strict';

/**
 * Stage auto-test service — wires runner to Electron main-process dependencies.
 */

const path = require('path');
const { spawn } = require('child_process');
const { runStageAutoTest } = require('../lib/stage-autotest/runner');
const { loadConfig, saveConfig, getConfigPath } = require('../lib/stage-autotest/config');

let activeCancelRef = null;

function createStageAutoTestService(deps) {
  const {
    dbManager,
    getSnesWrapper,
    sniManager,
    launchProcessSessions,
    isLaunchProcessRunning,
    launchProcessManager,
    userDataDir,
    gameStager,
  } = deps;

  function rhdataDb() {
    return dbManager.getConnection('rhdata');
  }

  function clientDb() {
    return dbManager.getConnection('clientdata');
  }

  async function launchProgram(program, args, filePath) {
    const retroarchAppendConfig = require('./utils/retroarch-append-config');
    let launchArgs = args;
    if (launchArgs && !launchArgs.includes('--appendconfig') && program && /retroarch/i.test(program)) {
      try {
        const appendPath = retroarchAppendConfig.ensureAppendConfig();
        const quoted = appendPath.includes(' ') ? `"${appendPath}"` : appendPath;
        launchArgs = `--appendconfig ${quoted} ${launchArgs}`;
      } catch (_e) {
        /* continue */
      }
    }

    if (program) {
      await launchProcessManager.ensureLaunchProgramStopped(launchProcessSessions, program);
    }

    const quotedPath = filePath.includes(' ') ? `"${filePath}"` : filePath;
    const processedArgs = launchArgs.replace(/%file/g, quotedPath);
    const argArray = [];
    let currentArg = '';
    let inQuotes = false;
    for (let i = 0; i < processedArgs.length; i++) {
      const char = processedArgs[i];
      if (char === '"') inQuotes = !inQuotes;
      else if (char === ' ' && !inQuotes) {
        if (currentArg) { argArray.push(currentArg); currentArg = ''; }
      } else currentArg += char;
    }
    if (currentArg) argArray.push(currentArg);

    return new Promise((resolve, reject) => {
      const child = spawn(program, argArray, { detached: true, stdio: 'ignore' });
      const sessionId = `autotest-${Date.now()}`;
      launchProcessSessions.set(sessionId, {
        pid: child.pid,
        program,
        filePath,
        startedAt: Date.now(),
      });
      child.on('exit', () => launchProcessSessions.delete(sessionId));
      child.on('error', (err) => {
        launchProcessSessions.delete(sessionId);
        reject(err);
      });
      child.unref();
      resolve({ sessionId, pid: child.pid });
    });
  }

  async function run(params, event) {
    if (activeCancelRef) {
      return { success: false, error: 'Another auto-test is already running' };
    }
    activeCancelRef = { cancelled: false };

    const onProgress = (payload) => {
      if (event?.sender && !event.sender.isDestroyed()) {
        event.sender.send('stage-autotest:progress', payload);
      }
    };

    try {
      const result = await runStageAutoTest(params, {
        userDataDir,
        clientDb: clientDb(),
        dbManager,
        gameStager,
        getSnesWrapper,
        sniManager,
        launchProcessSessions,
        launchProgram,
        isLaunchRunning: (sessionId) => isLaunchProcessRunning(sessionId),
        stopProgram: (program) => launchProcessManager.ensureLaunchProgramStopped(launchProcessSessions, program),
        cancelRef: activeCancelRef,
        onProgress,
      });
      return result;
    } finally {
      activeCancelRef = null;
    }
  }

  function cancel() {
    if (activeCancelRef) activeCancelRef.cancelled = true;
    return { success: true };
  }

  return {
    run,
    cancel,
    getConfig: () => loadConfig(userDataDir),
    saveConfig: (cfg) => saveConfig(userDataDir, cfg),
    getConfigPath: () => getConfigPath(userDataDir),
  };
}

module.exports = { createStageAutoTestService };
