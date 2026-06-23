/**
 * gv-migration-remapper.js - Remap clientdata gameid after canonicalization
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { GV_MIGRATIONS_CSV } = require('./provision-reconcile');

const CLIENTDATA_TABLES = [
  { table: 'run_results', col: 'gameid' },
  { table: 'run_plan_entries', col: 'gameid' },
  { table: 'stage_feedback', col: 'gameid' },
  { table: 'user_game_annotations', col: 'gameid' },
  { table: 'user_game_version_annotations', col: 'gameid', versionCol: 'version' },
  { table: 'recentboots', col: 'gameid' }
];

function parseCsvLine(line) {
  return line.split(',').map((c) => c.trim());
}

function loadPendingMigrations(userDataDir) {
  const csvPath = path.join(userDataDir, GV_MIGRATIONS_CSV);
  if (!fs.existsSync(csvPath)) return [];
  const lines = fs.readFileSync(csvPath, 'utf8').split('\n').filter(Boolean);
  const rows = [];
  for (const line of lines.slice(1)) {
    const cells = parseCsvLine(line);
    if (cells.length < 9) continue;
    if (cells[8] === 'true') continue;
    rows.push({
      old_gvuuid: cells[0],
      old_gameid: cells[1],
      old_version: cells[2],
      result_sha224: cells[3],
      pat_sha224: cells[4],
      line
    });
  }
  return rows;
}

function resolveOfficialGame(rhdataDb, migration) {
  const hash = migration.result_sha224 || migration.pat_sha224;
  if (!hash) return null;
  return rhdataDb.prepare(`
    SELECT gv.gameid, gv.version, gv.gvuuid
    FROM patchblobs pb
    JOIN gameversions gv ON gv.gvuuid = pb.gvuuid
    WHERE pb.result_sha224 = ? OR pb.pat_sha224 = ?
    LIMIT 1
  `).get(hash, hash);
}

function runGvMigrationRemap({ userDataDir, onLog = console.log } = {}) {
  const pending = loadPendingMigrations(userDataDir);
  if (!pending.length) return { migrated: 0, pending: 0 };

  const rhdataPath = path.join(userDataDir, 'rhdata.db');
  const clientdataPath = path.join(userDataDir, 'clientdata.db');
  if (!fs.existsSync(rhdataPath) || !fs.existsSync(clientdataPath)) {
    return { migrated: 0, pending: pending.length, error: 'missing db' };
  }

  const rhdata = new Database(rhdataPath, { readonly: true });
  const client = new Database(clientdataPath);
  let migrated = 0;

  try {
    for (const mig of pending) {
      const official = resolveOfficialGame(rhdata, mig);
      if (!official) {
        onLog(`[gv-migrate] no official row for old gameid ${mig.old_gameid}`);
        continue;
      }
      for (const spec of CLIENTDATA_TABLES) {
        const hasTable = client.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(spec.table);
        if (!hasTable) continue;
        if (spec.versionCol) {
          client.prepare(`UPDATE ${spec.table} SET ${spec.col} = ?, ${spec.versionCol} = ? WHERE ${spec.col} = ?`)
            .run(official.gameid, official.version, mig.old_gameid);
        } else {
          client.prepare(`UPDATE ${spec.table} SET ${spec.col} = ? WHERE ${spec.col} = ?`)
            .run(official.gameid, mig.old_gameid);
        }
      }
      migrated += 1;
      onLog(`[gv-migrate] ${mig.old_gameid} -> ${official.gameid} v${official.version}`);
    }
  } finally {
    rhdata.close();
    client.close();
  }

  if (migrated > 0) {
    markMigrationsDone(userDataDir, pending);
  }
  return { migrated, pending: pending.length - migrated };
}

function markMigrationsDone(userDataDir, migratedRows) {
  const csvPath = path.join(userDataDir, GV_MIGRATIONS_CSV);
  if (!fs.existsSync(csvPath)) return;
  const oldIds = new Set(migratedRows.map((r) => r.old_gameid));
  const lines = fs.readFileSync(csvPath, 'utf8').split('\n');
  const out = lines.map((line, idx) => {
    if (idx === 0 || !line.trim()) return line;
    const cells = parseCsvLine(line);
    if (oldIds.has(cells[1])) {
      cells[8] = 'true';
    }
    return cells.join(',');
  });
  fs.writeFileSync(csvPath, out.join('\n'), 'utf8');
}

module.exports = {
  loadPendingMigrations,
  runGvMigrationRemap,
  resolveOfficialGame
};
