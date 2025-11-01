#!/usr/bin/env node

/**
 * seed_sample_data.js
 *
 * Generates trimmed copies of the packed databases containing a manageable
 * subset of games for testing. The script copies the packed DBs into an
 * output directory and removes rows that are not associated with the
 * randomly selected sample of game IDs.
 *
 * Default behaviour selects 100 random game IDs that have associated
 * patchblobs, keeps every version for those games, and prunes related
 * records in both rhdata.db and patchbin.db.  Results are written to
 * tests/fixtures/generated/ along with a metadata.json file describing the
 * chosen sample.
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const trimmed = arg.slice(2);
    const eq = trimmed.indexOf('=');
    if (eq >= 0) {
      args[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
    } else {
      const key = trimmed;
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        args[key] = next;
        i += 1;
      } else {
        args[key] = true;
      }
    }
  }
  return args;
}

function ensureDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

function fileExists(file) {
  try {
    fs.accessSync(file, fs.constants.F_OK);
    return true;
  } catch (err) {
    return false;
  }
}

function tableExists(db, table) {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
  return !!row;
}

function findSourceFile(sourceDir, candidates, prefixFallback) {
  for (const candidate of candidates) {
    const candidatePath = path.join(sourceDir, candidate);
    if (fileExists(candidatePath)) {
      return candidatePath;
    }
  }
  if (prefixFallback) {
    const entries = fs.readdirSync(sourceDir);
    const match = entries.find((entry) => entry.startsWith(prefixFallback));
    if (match) {
      const fallbackPath = path.join(sourceDir, match);
      if (fileExists(fallbackPath)) {
        return fallbackPath;
      }
    }
  }
  return null;
}

function copyDbFiles(sourceDir, outputDir, verbose) {
  const mappings = [
    { target: 'rhdata.db', candidates: ['rhdata.db', 'rhdata.db.initial'], fallbackPrefix: 'rhdata' },
    { target: 'patchbin.db', candidates: ['patchbin.db', 'patchbin.db.initial'], fallbackPrefix: 'patchbin' },
    { target: 'clientdata.db', candidates: ['clientdata.db', 'clientdata.db.initial'], fallbackPrefix: 'clientdata' },
  ];

  for (const mapping of mappings) {
    const sourcePath = findSourceFile(sourceDir, mapping.candidates, mapping.fallbackPrefix);
    if (!sourcePath) {
      throw new Error(`Source database not found for ${mapping.target} in ${sourceDir}`);
    }
    const dest = path.join(outputDir, mapping.target);
    fs.copyFileSync(sourcePath, dest);
    if (verbose) {
      console.log(`Copied ${sourcePath} -> ${dest}`);
    }
  }
}

function pruneRhdata(db, sampleGameIds, verbose) {
  if (sampleGameIds.length === 0) {
    throw new Error('No game IDs selected for sample data.');
  }

  db.exec('PRAGMA foreign_keys = OFF;');

  const placeholders = sampleGameIds.map(() => '?').join(',');
  const deleteGames = db.prepare(`DELETE FROM gameversions WHERE gameid NOT IN (${placeholders})`);
  deleteGames.run(...sampleGameIds);

  if (tableExists(db, 'rhpatches')) {
    db.prepare(`DELETE FROM rhpatches WHERE gameid NOT IN (${placeholders})`).run(...sampleGameIds);
  }

  const selectedGvRows = db.prepare('SELECT DISTINCT gvuuid FROM gameversions').all();
  const gvuuidList = selectedGvRows.map((row) => row.gvuuid).filter(Boolean);

  if (gvuuidList.length > 0 && tableExists(db, 'patchblobs')) {
    const gvPlaceholders = gvuuidList.map(() => '?').join(',');
    db.prepare(`DELETE FROM patchblobs WHERE gvuuid NOT IN (${gvPlaceholders})`).run(...gvuuidList);
  }

  const pbRows = tableExists(db, 'patchblobs')
    ? db.prepare('SELECT DISTINCT pbuuid FROM patchblobs WHERE pbuuid IS NOT NULL').all()
    : [];
  const pbuuidList = pbRows.map((row) => row.pbuuid).filter(Boolean);

  if (pbuuidList.length > 0 && tableExists(db, 'patchblobs_extended')) {
    const pbPlaceholders = pbuuidList.map(() => '?').join(',');
    db.prepare(`DELETE FROM patchblobs_extended WHERE pbuuid NOT IN (${pbPlaceholders})`).run(...pbuuidList);
  }

  db.exec('PRAGMA foreign_keys = ON;');

  if (verbose) {
    const remaining = db.prepare('SELECT COUNT(*) as count FROM gameversions').get();
    console.log(`rhdata.db sample now contains ${remaining.count} gameversion rows.`);
  }

  return { gvuuidList, pbuuidList };
}

function prunePatchbin(db, gvuuidList, pbuuidList, verbose) {
  if (!tableExists(db, 'attachments')) {
    if (verbose) console.log('patchbin.db does not contain attachments table; skipping prune.');
    return;
  }

  const keepGv = new Set(gvuuidList);
  const keepPb = new Set(pbuuidList);
  const attachments = db.prepare('SELECT auuid, gvuuid, pbuuid FROM attachments').all();
  const deleteStmt = db.prepare('DELETE FROM attachments WHERE auuid = ?');
  let removed = 0;
  for (const row of attachments) {
    const hasGv = row.gvuuid && keepGv.has(row.gvuuid);
    const hasPb = row.pbuuid && keepPb.has(row.pbuuid);
    if (!hasGv && !hasPb) {
      deleteStmt.run(row.auuid);
      removed += 1;
    }
  }
  if (verbose) {
    const remaining = db.prepare('SELECT COUNT(*) as count FROM attachments').get();
    console.log(`patchbin.db pruned attachments. Removed ${removed}, remaining ${remaining.count}.`);
  }
}

function createMetadataFile(outputDir, sampleGameIds, options) {
  const metadata = {
    generatedAt: new Date().toISOString(),
    requestedCount: options.requestedCount,
    actualCount: sampleGameIds.length,
    gameids: sampleGameIds,
  };
  const metaPath = path.join(outputDir, 'metadata.json');
  fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const count = args.count ? Math.max(1, Number.parseInt(args.count, 10) || 0) : 100;
  const verbose = !!args.verbose;

  const sourceDir = path.resolve(args.source || path.join(__dirname, '..', 'electron', 'packed_db'));
  const outputDir = path.resolve(args.output || path.join(__dirname, '..', 'tests', 'fixtures', 'generated'));

  if (verbose) {
    console.log(`Source directory: ${sourceDir}`);
    console.log(`Output directory: ${outputDir}`);
    console.log(`Requested game count: ${count}`);
  }

  ensureDir(outputDir);
  copyDbFiles(sourceDir, outputDir, verbose);

  const rhdataPath = path.join(outputDir, 'rhdata.db');
  const patchbinPath = path.join(outputDir, 'patchbin.db');

  let rhDb;
  let patchDb;

  try {
    rhDb = new Database(rhdataPath);
    const candidateRows = rhDb.prepare(`
      SELECT DISTINCT gameid
      FROM gameversions gv
      WHERE EXISTS (
        SELECT 1 FROM patchblobs pb WHERE pb.gvuuid = gv.gvuuid
      )
      ORDER BY RANDOM()
      LIMIT ?
    `).all(count);

    if (candidateRows.length === 0) {
      throw new Error('No candidate games found with associated patchblobs.');
    }

    const sampleGameIds = candidateRows.map((row) => row.gameid);
    const uniqueIds = Array.from(new Set(sampleGameIds));

    if (uniqueIds.length < count && verbose) {
      console.log(`Only ${uniqueIds.length} unique game IDs available; proceeding with smaller sample.`);
    }

    const { gvuuidList, pbuuidList } = pruneRhdata(rhDb, uniqueIds, verbose);
    rhDb.prepare('VACUUM').run();
    rhDb.close();
    rhDb = null;

    patchDb = new Database(patchbinPath);
    prunePatchbin(patchDb, gvuuidList, pbuuidList, verbose);
    patchDb.prepare('VACUUM').run();
    patchDb.close();
    patchDb = null;

    createMetadataFile(outputDir, uniqueIds, { requestedCount: count });

    if (verbose) {
      console.log('Sample data generation complete.');
    }
  } catch (error) {
    if (rhDb) {
      try { rhDb.close(); } catch (closeErr) { /* ignore */ }
    }
    if (patchDb) {
      try { patchDb.close(); } catch (closeErr) { /* ignore */ }
    }
    throw error;
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`seed_sample_data.js failed: ${error.message}`);
    process.exit(1);
  }
}
