#!/usr/bin/env node

/**
 * updategames_conflicts.js - Review and resolve RHPAK ownership conflicts before updategames import.
 *
 * Usage:
 *   enode.sh jstools/updategames_conflicts.js --game-folder=games20260618/40631
 *   enode.sh jstools/updategames_conflicts.js --source-folder=games20260618 --subfolders=40631,42356
 *   enode.sh jstools/updategames_conflicts.js --game-folder=games20260618/40631 --edit-ownership
 */

'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const Database = require('better-sqlite3');
const conflictChecker = require('../lib/rhpak-conflict-checker');

const DEFAULT_PATHS = {
  rhdata: path.join(__dirname, '..', 'electron', 'rhdata.db'),
  patchbin: path.join(__dirname, '..', 'electron', 'patchbin.db'),
  resource: path.join(__dirname, '..', 'electron', 'resource.db'),
  screenshot: path.join(__dirname, '..', 'electron', 'screenshot.db'),
};

function printHelp() {
  console.log(`updategames_conflicts.js - RHPAK conflict review for updategames import

Usage:
  enode.sh jstools/updategames_conflicts.js [options]

Options:
  --source-folder=<path>   Parent folder with per-game subfolders
  --subfolders=<list|all>  Comma-separated gameids or "all" (with --source-folder)
  --game-folder=<path>     Single game folder (e.g. games20260618/40631)
  --edit-ownership         Prompt to reassign primary owner for each conflict
  --dry-run                With --edit-ownership: show changes without writing DB
  --yes-all                Approve all ownership changes without prompting
  --help                   Show this help

Environment:
  RHDATA_DB_PATH, PATCHBIN_DB_PATH, RESOURCE_DB_PATH, SCREENSHOT_DB_PATH
`);
}

function parseArgs(argv) {
  const parsed = {
    sourceFolder: null,
    subfolders: null,
    gameFolder: null,
    editOwnership: false,
    dryRun: false,
    yesAll: false,
    help: false,
  };
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
    } else if (arg === '--edit-ownership') {
      parsed.editOwnership = true;
    } else if (arg === '--dry-run') {
      parsed.dryRun = true;
    } else if (arg === '--yes-all') {
      parsed.yesAll = true;
    } else if (arg.startsWith('--source-folder=')) {
      parsed.sourceFolder = arg.split('=').slice(1).join('=');
    } else if (arg.startsWith('--subfolders=')) {
      parsed.subfolders = arg.split('=').slice(1).join('=');
    } else if (arg.startsWith('--game-folder=')) {
      parsed.gameFolder = arg.split('=').slice(1).join('=');
    }
  }
  return parsed;
}

function resolveDbPaths() {
  return {
    rhdata: process.env.RHDATA_DB_PATH || DEFAULT_PATHS.rhdata,
    patchbin: process.env.PATCHBIN_DB_PATH || DEFAULT_PATHS.patchbin,
    resource: process.env.RESOURCE_DB_PATH || DEFAULT_PATHS.resource,
    screenshot: process.env.SCREENSHOT_DB_PATH || DEFAULT_PATHS.screenshot,
  };
}

function openDatabases(dbPaths) {
  const dbs = {
    rhdata: new Database(dbPaths.rhdata),
    patchbin: new Database(dbPaths.patchbin),
  };
  if (fs.existsSync(dbPaths.resource)) {
    dbs.resource = new Database(dbPaths.resource);
  }
  if (fs.existsSync(dbPaths.screenshot)) {
    dbs.screenshot = new Database(dbPaths.screenshot);
  }
  return dbs;
}

function closeDatabases(dbs) {
  for (const db of Object.values(dbs)) {
    if (db) {
      db.close();
    }
  }
}

function resolveGameFolders(argv) {
  if (argv.gameFolder) {
    return [path.resolve(argv.gameFolder)];
  }
  if (!argv.sourceFolder) {
    throw new Error('Provide --game-folder or --source-folder with --subfolders.');
  }
  const sourceAbs = path.resolve(argv.sourceFolder);
  if (!fs.existsSync(sourceAbs)) {
    throw new Error(`Source folder not found: ${sourceAbs}`);
  }
  if (!argv.subfolders) {
    throw new Error('--source-folder requires --subfolders.');
  }
  if (argv.subfolders === 'all') {
    return fs.readdirSync(sourceAbs)
      .map((name) => path.join(sourceAbs, name))
      .filter((entry) => fs.statSync(entry).isDirectory());
  }
  return argv.subfolders.split(',').map((gameid) => path.join(sourceAbs, gameid.trim()));
}

function promptUser(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve((answer || '').trim().toLowerCase());
    });
  });
}

async function handleEditOwnership(dbs, report, options) {
  if (report.conflicts.length === 0) {
    return { applied: 0, skipped: 0, quit: false };
  }
  let approveAll = options.yesAll;
  let applied = 0;
  let skipped = 0;

  for (let i = 0; i < report.conflicts.length; i += 1) {
    const conflict = report.conflicts[i];
    conflict.incomingIsSystem = report.incomingIsSystem;
    if (!approveAll) {
      console.log('');
      console.log(`Conflict ${i + 1}/${report.conflicts.length}: ${conflict.qualified}  ${conflict.fileName || ''}`);
      console.log(`  DB owner:       ${conflict.dbOwner}`);
      console.log(`  Incoming owner: ${conflict.incomingOwner}`);
      if (options.dryRun) {
        console.log('  (dry-run mode)');
      }
      const answer = await promptUser('Change primary owner to incoming rhpak? [y/N/a/q] (a=all, q=quit): ');
      if (answer === 'q' || answer === 'quit') {
        return { applied, skipped, quit: true };
      }
      if (answer === 'a' || answer === 'all') {
        approveAll = true;
      } else if (answer !== 'y' && answer !== 'yes') {
        skipped += 1;
        continue;
      }
    }

    const dbKey = conflict.qualified.startsWith('rhdata.') ? 'rhdata'
      : conflict.qualified.startsWith('patchbin.') ? 'patchbin'
        : conflict.qualified.startsWith('resource.') ? 'resource' : 'screenshot';
    const db = dbs[dbKey];
    const applyChange = () => conflictChecker.applyOwnershipChange(dbs, conflict, { dryRun: options.dryRun });
    const result = options.dryRun ? applyChange() : db.transaction(applyChange)();
    if (result.applied) {
      applied += 1;
      if (options.dryRun) {
        console.log(`  Would update ${conflict.qualified}: rhpakuuid=${result.after.rhpakuuid}`);
        console.log(`    rhpakuuid2=${result.after.rhpakuuid2}`);
      } else {
        console.log(`  Updated ${conflict.qualified}: primary owner -> ${conflict.incomingOwner}`);
      }
    }
  }
  return { applied, skipped, quit: false };
}

async function main() {
  const argv = parseArgs(process.argv.slice(2));
  if (argv.help) {
    printHelp();
    process.exit(0);
  }

  const gameFolders = resolveGameFolders(argv);
  if (gameFolders.length === 0) {
    console.log('No game folders to process.');
    process.exit(0);
  }

  const dbPaths = resolveDbPaths();
  const dbs = openDatabases(dbPaths);

  let totalConflicts = 0;
  let gamesWithConflicts = 0;
  let exitCode = 0;

  try {
    for (const gameFolder of gameFolders) {
      const loaded = conflictChecker.loadImportSkeleton(gameFolder);
      const report = conflictChecker.detectConflicts(dbs, loaded.skeleton, {
        gameid: loaded.gameid,
        incomingSource: loaded.incomingSource,
      });
      console.log(conflictChecker.formatConflictReport(report));
      console.log('');

      if (report.conflicts.length > 0) {
        gamesWithConflicts += 1;
        totalConflicts += report.conflicts.length;
        if (argv.editOwnership) {
          const editResult = await handleEditOwnership(dbs, report, {
            dryRun: argv.dryRun,
            yesAll: argv.yesAll,
          });
          console.log(`  Edit summary: ${editResult.applied} applied, ${editResult.skipped} skipped`);
          if (editResult.quit) {
            break;
          }
        }
      }
    }

    console.log('==================================================');
    console.log(`Processed ${gameFolders.length} game folder(s), ${gamesWithConflicts} with conflicts, ${totalConflicts} total blocking conflict(s)`);
    if (totalConflicts > 0 && !argv.editOwnership) {
      console.log('Run with --edit-ownership to interactively reassign primary RHPAK owner.');
    }
    exitCode = totalConflicts > 0 && !argv.editOwnership ? 1 : 0;
  } catch (error) {
    console.error(`Fatal error: ${error.message}`);
    exitCode = 2;
  } finally {
    closeDatabases(dbs);
  }

  process.exit(exitCode);
}

if (require.main === module) {
  main();
}

module.exports = { main, parseArgs };
