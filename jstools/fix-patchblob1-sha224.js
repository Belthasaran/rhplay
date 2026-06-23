#!/usr/bin/env node

/**
 * fix-patchblob1-sha224.js - Backfill patchblobs.patchblob1_sha224 from attachments
 *
 * patchblob1_sha224 must be the encoded outer patchblob SHA-224 (same as
 * attachments.file_hash_sha224), not the decoded BPS pat_sha224.
 *
 * Usage:
 *   enode.sh jstools/fix-patchblob1-sha224.js [--dry-run] [--help]
 *
 * Environment:
 *   RHDATA_DB_PATH    - rhdata.db path (default: electron/rhdata.db)
 *   PATCHBIN_DB_PATH  - patchbin.db path (default: electron/patchbin.db)
 */

const path = require('path');
const Database = require('better-sqlite3');

const DEFAULT_RHDATA = path.join(__dirname, '..', 'electron', 'rhdata.db');
const DEFAULT_PATCHBIN = path.join(__dirname, '..', 'electron', 'patchbin.db');

function printHelp() {
  console.log(`Usage: enode.sh jstools/fix-patchblob1-sha224.js [options]

Options:
  --dry-run   Report mismatches without updating rhdata.db
  --help      Show this help

Environment:
  RHDATA_DB_PATH    Override rhdata.db location
  PATCHBIN_DB_PATH  Override patchbin.db location
`);
}

function parseArgs(argv) {
  const options = { dryRun: false, help: false };
  for (const arg of argv) {
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function findMismatches(rhdataDb, patchbinDb) {
  const patchblobs = rhdataDb.prepare(`
    SELECT pbuuid, patchblob1_name, patchblob1_sha224, pat_sha224
    FROM patchblobs
    WHERE patchblob1_name IS NOT NULL
  `).all();

  const attachmentRows = patchbinDb.prepare(`
    SELECT pbuuid, file_name, file_hash_sha224
    FROM attachments
    WHERE file_hash_sha224 IS NOT NULL AND file_hash_sha224 != ''
  `).all();

  const byName = new Map();
  const byPbuuid = new Map();
  for (const row of attachmentRows) {
    if (row.file_name) {
      byName.set(row.file_name, row);
    }
    if (!byPbuuid.has(row.pbuuid)) {
      byPbuuid.set(row.pbuuid, []);
    }
    byPbuuid.get(row.pbuuid).push(row);
  }

  const mismatches = [];
  let missingAttachment = 0;

  for (const pb of patchblobs) {
    let att = byName.get(pb.patchblob1_name);
    if (!att) {
      const pbuuidRows = byPbuuid.get(pb.pbuuid) || [];
      if (pbuuidRows.length === 1) {
        att = pbuuidRows[0];
      } else if (pbuuidRows.length > 1) {
        att = pbuuidRows.find((row) => row.file_name === pb.patchblob1_name) || null;
      }
    }
    if (!att) {
      missingAttachment++;
      continue;
    }
    if (pb.patchblob1_sha224 === att.file_hash_sha224) {
      continue;
    }
    mismatches.push({
      pbuuid: pb.pbuuid,
      patchblob1_name: pb.patchblob1_name,
      current: pb.patchblob1_sha224,
      expected: att.file_hash_sha224,
      pat_sha224: pb.pat_sha224,
      wrongLooksLikePat: pb.patchblob1_sha224 === pb.pat_sha224,
      matchedBy: att.file_name === pb.patchblob1_name ? 'file_name' : 'pbuuid'
    });
  }

  return { mismatches, missingAttachment, total: patchblobs.length };
}

function applyFixes(rhdataDb, mismatches) {
  const update = rhdataDb.prepare(`
    UPDATE patchblobs
    SET patchblob1_sha224 = @expected
    WHERE pbuuid = @pbuuid
  `);
  let updated = 0;
  const runBatch = rhdataDb.transaction((rows) => {
    for (const row of rows) {
      update.run({ pbuuid: row.pbuuid, expected: row.expected });
      updated++;
    }
  });
  runBatch(mismatches);
  return updated;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    process.exit(0);
  }

  const rhdataPath = process.env.RHDATA_DB_PATH || DEFAULT_RHDATA;
  const patchbinPath = process.env.PATCHBIN_DB_PATH || DEFAULT_PATCHBIN;

  const rhdataDb = new Database(rhdataPath);
  const patchbinDb = new Database(patchbinPath, { readonly: true });

  try {
    const { mismatches, missingAttachment, total } = findMismatches(rhdataDb, patchbinDb);
    const wrongPatCount = mismatches.filter((row) => row.wrongLooksLikePat).length;

    console.log(`Scanned ${total} patchblobs`);
    console.log(`Mismatched patchblob1_sha224: ${mismatches.length} (${wrongPatCount} equal pat_sha224)`);
    console.log(`No attachment match: ${missingAttachment}`);

    if (mismatches.length === 0) {
      console.log('Nothing to fix.');
      return;
    }

    if (options.dryRun) {
      console.log('\nDry run — first 10 mismatches:');
      for (const row of mismatches.slice(0, 10)) {
        console.log(`  ${row.patchblob1_name}`);
        console.log(`    current:  ${row.current}`);
        console.log(`    expected: ${row.expected}`);
      }
      if (mismatches.length > 10) {
        console.log(`  ... and ${mismatches.length - 10} more`);
      }
      return;
    }

    const updated = applyFixes(rhdataDb, mismatches);
    console.log(`Updated ${updated} patchblobs.patchblob1_sha224 values`);
  } finally {
    patchbinDb.close();
    rhdataDb.close();
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(2);
  }
}

module.exports = {
  findMismatches,
  applyFixes,
  parseArgs
};
