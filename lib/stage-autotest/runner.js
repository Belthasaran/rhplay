'use strict';

const { loadConfig } = require('./config');
const { StageAutoTestLogWriter } = require('./log-writer');
const { buildStageTestRom, loadAppSettings, defaultPlaylevelPatchCode, defaultRequisiteTags, defaultFormatLevelNumberHex } = require('./build-stage-rom');
const { buildExpectedFlags, compareEstToExpected, flagsFromGamestage, flagsFromJitRom } = require('./expected-flags');
const { translevelMatches, snapshotToEstFlags } = require('./smw-ram-snapshot');
const { RetroArchBackend, RETROPAD } = require('./backends/retroarch');
const { BizHawkBackend } = require('./backends/bizhawk');
const { sleep, resolveExpectedTranslevel, formatHexByte } = require('./utils');

function createBackend(name, deps, config) {
  if (typeof deps.createBackend === 'function') {
    return deps.createBackend(name, deps, config);
  }
  if (name === 'bizhawk') return new BizHawkBackend();
  return new RetroArchBackend({ ...deps, config });
}

async function runStageAutoTest(params, deps) {
  const cancelRef = deps.cancelRef || { cancelled: false };
  const onProgress = deps.onProgress || (() => {});

  const userDataDir = deps.userDataDir;
  const config = loadConfig(userDataDir, params.configOverrides || {});
  if (params.headless !== undefined) config.headless = !!params.headless;

  const stage = params.stage;
  const gameId = params.gameId;
  const gameVersion = params.gameVersion || 1;

  const expectedTranslevel = resolveExpectedTranslevel(stage);
  const log = new StageAutoTestLogWriter({
    logDir: config.logging?.logDir,
    meta: {
      gameid: gameId,
      version: gameVersion,
      levelnumber: stage?.levelnumber,
      translevel_13bf: expectedTranslevel !== null ? formatHexByte(expectedTranslevel) : 'unknown',
      backend: config.backend,
      headless: config.headless,
    },
  });
  log.header();

  const report = (phase, msg) => onProgress({ phase, message: msg });

  try {
    if (cancelRef.cancelled) throw new Error('Cancelled');

    report('build', 'Building patched ROM...');
    const settings = loadAppSettings(deps.clientDb);
    const build = await buildStageTestRom(deps, {
      gameId,
      gameVersion,
      stage,
      settings,
      getPlaylevelPatchCode: params.getPlaylevelPatchCode || defaultPlaylevelPatchCode,
      getRequisiteTags: params.getRequisiteTags || defaultRequisiteTags,
      formatLevelNumberHex: params.formatLevelNumberHex || defaultFormatLevelNumberHex,
    });
    if (!build.success) {
      log.addFailure(build.error || 'Build failed');
      log.phase('build', { status: 'FAIL', error: build.error });
      log.setResult('FAIL');
      log.finalize();
      const out = log.write();
      return { success: false, error: build.error, ...out };
    }
    log.phase('build', { status: 'PASS', rom: build.outputPath, level_hex: build.levelHex });

    const backend = createBackend(config.backend, { ...deps, settings, config }, config);

    report('launch', 'Launching emulator...');
    const launchStart = Date.now();
    await backend.launchRom(build.outputPath);
    log.phase('launch', { status: 'PASS', elapsed_ms: Date.now() - launchStart });

    // Phase 2: boot detection
    report('boot', 'Waiting for boot...');
    const bootTimeout = (config.timeoutsSec?.boot || 60) * 1000;
    const bootStart = Date.now();
    let bootSnap = null;
    let bootPassed = false;
    while (Date.now() - bootStart < bootTimeout) {
      if (cancelRef.cancelled) throw new Error('Cancelled');
      if (!(await backend.isRunning())) {
        log.addFailure('Emulator exited during boot wait');
        break;
      }
      try {
        bootSnap = await backend.readRamSnapshot();
        if (!bootSnap.isTitle || bootSnap.onOverworld || bootSnap.inLevel) {
          bootPassed = true;
          break;
        }
      } catch (_e) {
        /* retry RAM */
      }
      await sleep(500);
    }
    if (!bootPassed) {
      log.addFailure('Boot timeout: did not leave title screen');
      log.phase('boot', { status: 'FAIL', elapsed_ms: Date.now() - bootStart, game_mode: bootSnap ? formatHexByte(bootSnap.gameMode) : 'unknown' });
    } else {
      log.phase('boot', { status: 'PASS', elapsed_ms: Date.now() - bootStart, game_mode: formatHexByte(bootSnap.gameMode) });
    }

    // Phase 3: navigation
    report('navigate', 'Sending navigation inputs...');
    const navWindow = config.inputPlan?.navigateWindowMs || 30000;
    const btnInterval = config.inputPlan?.buttonIntervalMs || 500;
    const navStart = Date.now();
    let inputsSent = 0;
    let overworldSeen = false;
    let levelEnteredEarly = false;

    const titleStarts = config.inputPlan?.titleSkipStartMs || [2000, 4000];
    const enterStarts = config.inputPlan?.enterGameStartMs || [6000, 8000];
    const scheduledStarts = [...titleStarts, ...enterStarts];

    while (Date.now() - navStart < navWindow) {
      if (cancelRef.cancelled) throw new Error('Cancelled');
      if (!(await backend.isRunning())) {
        log.addFailure('Emulator exited during navigation');
        break;
      }

      const elapsed = Date.now() - navStart;
      for (const t of scheduledStarts) {
        if (Math.abs(elapsed - t) < btnInterval) {
          await backend.pressButtons(RETROPAD.START, 120);
          inputsSent++;
        }
      }

      await backend.pressButtons(RETROPAD.A, 80);
      inputsSent++;

      try {
        const snap = await backend.readRamSnapshot();
        if (snap.onOverworld) overworldSeen = true;
        if (snap.inLevel && translevelMatches(snap, expectedTranslevel)) {
          levelEnteredEarly = true;
        }
        if (overworldSeen && !config.skipOverworldNavigation) {
          await backend.pressButtons(RETROPAD.START | RETROPAD.RIGHT, 120);
          inputsSent++;
        }
        if (levelEnteredEarly && snap.inLevel) break;
      } catch (_e) {
        /* retry */
      }
      await sleep(btnInterval);
    }
    log.phase('navigate', {
      status: 'DONE',
      inputs_sent: inputsSent,
      overworld_seen: overworldSeen,
      level_entered: levelEnteredEarly,
      elapsed_ms: Date.now() - navStart,
    });

    // Phase 4: verify level
    report('verify', 'Verifying level entry...');
    let verifySnap = null;
    try {
      verifySnap = await backend.readRamSnapshot();
    } catch (e) {
      log.addFailure(`RAM read failed during verify: ${e.message}`);
    }
    const verifyPass = verifySnap
      && verifySnap.inLevel
      && translevelMatches(verifySnap, expectedTranslevel);
    if (!verifyPass) {
      log.addFailure(
        `Level verify failed: expected translevel ${formatHexByte(expectedTranslevel)}, `
        + `got ${verifySnap ? formatHexByte(verifySnap.translevel_13bf) : 'unknown'}, `
        + `mode=${verifySnap ? formatHexByte(verifySnap.gameMode) : 'unknown'}`
      );
    }
    log.phase('verify_level', {
      status: verifyPass ? 'PASS' : 'FAIL',
      expected_translevel: formatHexByte(expectedTranslevel),
      actual_translevel: verifySnap ? formatHexByte(verifySnap.translevel_13bf) : 'unknown',
      game_mode: verifySnap ? formatHexByte(verifySnap.gameMode) : 'unknown',
    });

    // Phase 5: flags
    report('flags', 'Comparing level flags...');
    const expected = buildExpectedFlags(stage, build.outputPath);
    const est = verifySnap ? snapshotToEstFlags(verifySnap) : {};
    log.section('EST LEVEL FLAGS FROM TEST', est);
    if (expected.gamestages) log.section('LEVEL FLAGS (gamestages)', expected.gamestages);
    if (expected.jitlevels) log.section('LEVEL FLAGS (jitlevels)', expected.jitlevels);
    const flagWarnings = compareEstToExpected(est, expected);
    for (const w of flagWarnings) log.addWarning(w);

    // Phase 6: fail + retry
    report('retry', 'Testing death/retry stability...');
    let retryStable = false;
    let retryLevel = null;
    const retryWindow = config.inputPlan?.retryPressWindowMs || 15000;
    const retryStart = Date.now();

    if (verifySnap && verifyPass) {
      try {
        const yFail = (verifySnap.marioY + 0x80) & 0xffff;
        const yLo = yFail & 0xff;
        const yHi = (yFail >> 8) & 0xff;
        await backend.writeRamByte(0x7e0096, yLo);
        await backend.writeRamByte(0x7e0097, yHi);
        log.line(`mario_y_written=${formatHexByte(yLo)} (fail test)`);
      } catch (e) {
        log.addFailure(`Failed to write Mario Y for death test: ${e.message}`);
      }

      while (Date.now() - retryStart < retryWindow) {
        if (cancelRef.cancelled) throw new Error('Cancelled');
        await backend.pressButtons(RETROPAD.A, 80);
        await sleep(btnInterval);
        try {
          const snap = await backend.readRamSnapshot();
          if (snap.inLevel && translevelMatches(snap, expectedTranslevel)) {
            retryStable = true;
            retryLevel = snap.translevel_13bf;
            break;
          }
          if (snap.gameOver) {
            log.addFailure('Game over screen detected during retry test');
            break;
          }
        } catch (_e) {
          /* continue */
        }
      }
    } else {
      log.addFailure('Skipped retry test because level verify failed');
    }

    if (verifyPass && !retryStable) {
      log.addFailure('Retry stability failed: did not re-enter same level after death');
    }
    log.phase('fail_retry', {
      status: retryStable ? 'PASS' : 'FAIL',
      retry_level_13bf: retryLevel !== null ? formatHexByte(retryLevel) : 'unknown',
      stable: retryStable,
      elapsed_ms: Date.now() - retryStart,
    });

    const passed = bootPassed && verifyPass && retryStable && log.failures.length === 0;
    log.setResult(passed ? 'PASS' : 'FAIL');
    log.finalize();
    const out = log.write();

    await backend.shutdown();

    return {
      success: passed,
      result: log.result,
      logPath: out.logPath,
      jsonPath: out.jsonPath,
      summary: out.summary,
      build,
      patchIdentity: build.patchIdentity,
    };
  } catch (error) {
    log.addFailure(error.message || String(error));
    log.setResult('FAIL');
    log.finalize();
    const out = log.write();
    try {
      const backend = createBackend(config.backend, deps, config);
      await backend.shutdown();
    } catch (_e) {
      /* ignore */
    }
    return { success: false, error: error.message, logPath: out.logPath, jsonPath: out.jsonPath };
  }
}

module.exports = { runStageAutoTest, createBackend };
