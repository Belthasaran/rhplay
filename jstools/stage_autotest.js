#!/usr/bin/env node
'use strict';

/**
 * stage_autotest.js — CLI entry for stage automated testing.
 *
 * Usage:
 *   ./enode.sh jstools/stage_autotest.js --gameid 12345 --levelnumber 106 [--headless] [--help]
 *
 * Environment:
 *   RHDATA_DB_PATH, CLIENTDATA_DB_PATH (or defaults from app data)
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { runStageAutoTest } = require('../lib/stage-autotest/runner');
const { loadConfig } = require('../lib/stage-autotest/config');

function printHelp() {
  console.log(`Usage: stage_autotest.js --gameid ID --levelnumber HEX [options]

Options:
  --gameid=ID         Game id (required)
  --levelnumber=HEX   Stage level number hex, e.g. 106 (required)
  --version=N         Game version (default 1)
  --headless          Run with headless RetroArch flags
  --help              Show help

Environment:
  RHDATA_DB_PATH      Path to rhdata.db
  CLIENTDATA_DB_PATH  Path to clientdata.db
`);
}

function parseArgs(argv) {
  const args = { help: false, headless: false, version: 1 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--headless') args.headless = true;
    else if (a.startsWith('--gameid=')) args.gameid = a.slice(9);
    else if (a === '--gameid') args.gameid = argv[++i];
    else if (a.startsWith('--levelnumber=')) args.levelnumber = a.slice(14);
    else if (a === '--levelnumber') args.levelnumber = argv[++i];
    else if (a.startsWith('--version=')) args.version = parseInt(a.slice(10), 10);
    else if (a === '--version') args.version = parseInt(argv[++i], 10);
  }
  return args;
}

function openDb(envVar, fallbackName) {
  const p = process.env[envVar];
  if (p && fs.existsSync(p)) return new Database(p);
  throw new Error(`Set ${envVar} to a valid database path (${fallbackName})`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    process.exit(0);
  }
  if (!args.gameid || !args.levelnumber) {
    printHelp();
    process.exit(1);
  }

  const rhdataDb = openDb('RHDATA_DB_PATH', 'rhdata.db');
  const clientDb = openDb('CLIENTDATA_DB_PATH', 'clientdata.db');
  const dbManager = {
    getConnection(name) {
      if (name === 'rhdata') return rhdataDb;
      if (name === 'clientdata') return clientDb;
      throw new Error(`Unknown db ${name}`);
    },
  };

  const stage = rhdataDb.prepare(`
    SELECT * FROM gamestages WHERE gameid = ? AND levelnumber = ? LIMIT 1
  `).get(args.gameid, args.levelnumber.toUpperCase().padStart(3, '0'));

  if (!stage) {
    console.error(`Stage not found: gameid=${args.gameid} levelnumber=${args.levelnumber}`);
    process.exit(1);
  }

  let userDataDir = process.env.RHPLAY_USERDATA || path.join(process.env.HOME || '.', '.config', 'Electron');
  try {
    const manifestResolver = require('../electron/utils/manifest-resolver');
    userDataDir = manifestResolver.getUserDataDir();
  } catch (_e) {
    /* fallback */
  }

  const gameStager = require('../electron/game-stager');
  const sniManager = require('../electron/main/usb2snes/sniManager');
  const { SNESWrapper } = require('../electron/main/usb2snes/SNESWrapper');
  const launchProcessManager = require('../electron/utils/launch-process-manager');
  const launchProcessSessions = new Map();
  const snesWrapper = new SNESWrapper();

  function isLaunchRunning(sessionId) {
    const s = launchProcessSessions.get(sessionId);
    if (!s?.pid) return false;
    try {
      process.kill(s.pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  const { createStageAutoTestService } = require('../electron/stage-autotest-service');
  const service = createStageAutoTestService({
    dbManager,
    getSnesWrapper: () => snesWrapper,
    sniManager,
    launchProcessSessions,
    isLaunchProcessRunning: isLaunchRunning,
    launchProcessManager,
    userDataDir,
    gameStager,
  });

  console.log(`Starting stage auto-test gameid=${args.gameid} level=${stage.levelnumber}...`);
  const result = await service.run({
    gameId: args.gameid,
    gameVersion: args.version,
    stage,
    headless: args.headless,
  });

  console.log(`Result: ${result.success ? 'PASS' : 'FAIL'}`);
  if (result.logPath) console.log(`Log: ${result.logPath}`);
  if (result.error) console.error(result.error);
  process.exit(result.success ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
