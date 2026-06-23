#!/usr/bin/env node

/**
 * provision-conflicts.js - Dry-run scan for manifest patch conflicts
 *
 * Usage:
 *   ./enode.sh jstools/provision-conflicts.js --help
 *   RHDATA_DB_PATH=... PATCHBIN_DB_PATH=... ./enode.sh jstools/provision-conflicts.js \
 *     --bundle /path/to/patch.7z --db-name rhdata.db
 */

const fs = require('fs');
const path = require('path');
const { scanPatchConflicts } = require('../lib/provision-conflict-checker');

function printHelp() {
  console.log(`Usage: provision-conflicts.js [options]

Options:
  --bundle <path>     Path to bundle patch (.7z/.zip)
  --db-name <name>    Database name (rhdata.db, patchbin.db, ...)
  --db-path <path>    Local database path (default: userData/db-name)
  --user-data-dir <p> User data directory for rhdata/clientdata paths
  --format <fmt>      Bundle format (7z|zip)
  --help              Show help

Environment:
  RHDATA_DB_PATH, PATCHBIN_DB_PATH, CLIENTDATA_DB_PATH
`);
}

function parseArgs(argv) {
  const opts = { format: '7z' };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--bundle') opts.bundle = argv[++i];
    else if (a === '--db-name') opts.dbName = argv[++i];
    else if (a === '--db-path') opts.dbPath = argv[++i];
    else if (a === '--user-data-dir') opts.userDataDir = argv[++i];
    else if (a === '--format') opts.format = argv[++i];
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || !opts.bundle) {
    printHelp();
    process.exit(opts.help ? 0 : 1);
  }

  const dbName = opts.dbName || 'rhdata.db';
  const userDataDir = opts.userDataDir || path.dirname(process.env.RHDATA_DB_PATH || '.');
  const dbPath = opts.dbPath || path.join(userDataDir, dbName);

  if (!fs.existsSync(dbPath)) {
    console.error(`Database not found: ${dbPath}`);
    process.exit(1);
  }
  if (!fs.existsSync(opts.bundle)) {
    console.error(`Bundle not found: ${opts.bundle}`);
    process.exit(1);
  }

  const scan = await scanPatchConflicts({
    dbPath,
    dbName,
    patchArchivePath: opts.bundle,
    patchSpec: { type: 'bundle', format: opts.format, file_name: path.basename(opts.bundle) },
    rhdataPath: process.env.RHDATA_DB_PATH || path.join(userDataDir, 'rhdata.db'),
    clientdataPath: process.env.CLIENTDATA_DB_PATH || path.join(userDataDir, 'clientdata.db')
  });

  console.log(JSON.stringify({
    dbName,
    equivalentCount: scan.equivalentCount,
    trueConflictCount: scan.trueConflictCount,
    allEquivalent: scan.allEquivalent,
    affectedRhpakuuids: scan.affectedRhpakuuids,
    gameMismatches: scan.gameMismatches,
    clientdataImpact: scan.clientdataImpact
  }, null, 2));

  process.exit(scan.trueConflictCount > 0 ? 2 : 0);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { main };
