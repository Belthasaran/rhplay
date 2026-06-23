/**
 * provision-reconcile.js - Pre-patch reconciliation for manifest bundle updates
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { scanPatchConflicts, DECLARATION_SPECS } = require('./provision-conflict-checker');

const GV_MIGRATIONS_CSV = 'gv_migrations.csv';
const CSV_HEADER = 'old_gvuuid,old_gameid,old_version,result_sha224,pat_sha224,patchblob1_name,rhpakuuid,reconciled_at_utc,migration_done,new_gameid,new_gvuuid,new_version\n';

function getBackupSessionDir(userDataDir, sessionTimestamp = null) {
  const ts = sessionTimestamp || new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join(userDataDir, 'provision-backup', ts);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function appendGvMigration(userDataDir, row) {
  const csvPath = path.join(userDataDir, GV_MIGRATIONS_CSV);
  if (!fs.existsSync(csvPath)) {
    fs.writeFileSync(csvPath, CSV_HEADER, 'utf8');
  }
  const line = [
    row.old_gvuuid || '',
    row.old_gameid || '',
    row.old_version ?? '',
    row.result_sha224 || '',
    row.pat_sha224 || '',
    row.patchblob1_name || '',
    row.rhpakuuid || '',
    row.reconciled_at_utc || Math.floor(Date.now() / 1000),
    row.migration_done === true ? 'true' : 'false',
    row.new_gameid || '',
    row.new_gvuuid || '',
    row.new_version ?? ''
  ].map((v) => String(v).replace(/,/g, ';')).join(',');
  fs.appendFileSync(csvPath, `${line}\n`, 'utf8');
}

function writeConflictsJson(userDataDir, dbName, payload) {
  const filePath = path.join(userDataDir, `conflicts-${dbName}.json`);
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return filePath;
}

function archiveRowText(backupDir, dbName, table, pk, row) {
  const filePath = path.join(backupDir, 'rows', dbName, table, `${pk}.txt`);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(row, null, 2), 'utf8');
}

function appendGamestagesCsv(backupDir, rows) {
  if (!rows.length) return;
  const csvPath = path.join(backupDir, 'gamestages-conflicts.csv');
  const header = 'stage_uuid,gameid,levelnumber,levelname\n';
  if (!fs.existsSync(csvPath)) fs.writeFileSync(csvPath, header, 'utf8');
  for (const row of rows) {
    fs.appendFileSync(csvPath, [
      row.stage_uuid, row.gameid, row.levelnumber, row.levelname || ''
    ].map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',') + '\n', 'utf8');
  }
}

async function uninstallRhpak({ userDataDir, rhpakuuid, backupDir, onLog }) {
  const newgame = require('../jstools/newgame');
  const paths = {
    rhdataPath: path.join(userDataDir, 'rhdata.db'),
    patchbinPath: path.join(userDataDir, 'patchbin.db'),
    resourcePath: path.join(userDataDir, 'resource.db'),
    screenshotPath: path.join(userDataDir, 'screenshot.db'),
    userDataDir,
    uninstallUuid: rhpakuuid,
    mode: 'uninstall'
  };
  const archiveDir = path.join(backupDir, 'rhpak', rhpakuuid);
  fs.mkdirSync(archiveDir, { recursive: true });
  fs.writeFileSync(path.join(archiveDir, 'uninstall-meta.json'), JSON.stringify({ rhpakuuid, at: new Date().toISOString() }, null, 2));
  if (onLog) onLog(`[reconcile] uninstalling rhpak ${rhpakuuid}`);
  await newgame.handleUninstall(paths, null);
}

function deleteRow(db, table, idCol, idVal) {
  db.prepare(`DELETE FROM ${table} WHERE ${idCol} = ?`).run(idVal);
}

async function reconcileBeforePatch({
  dbPath,
  dbName,
  patchArchivePath,
  patchSpec,
  userDataDir,
  stagingDir = null,
  backupDir = null,
  onLog = console.log
}) {
  const backup = backupDir || getBackupSessionDir(userDataDir);
  const rhdataPath = path.join(userDataDir, 'rhdata.db');
  const clientdataPath = path.join(userDataDir, 'clientdata.db');

  const scan = await scanPatchConflicts({
    dbPath,
    dbName,
    patchArchivePath,
    patchSpec,
    rhdataPath,
    clientdataPath,
    stagingDir: stagingDir ? path.join(stagingDir, 'conflict-scan') : null
  });

  if (scan.allEquivalent) {
    onLog(`[reconcile] ${dbName}: all declared rows equivalent (feed-preinstalled), skip destructive reconcile`);
    return { backupDir: backup, scan, skipped: true };
  }

  const db = new Database(dbPath);
  const residualConflicts = [];

  try {
    for (const mismatch of scan.gameMismatches) {
      if (mismatch.rhpakuuid) {
        appendGvMigration({
          old_gvuuid: mismatch.old_gvuuid,
          old_gameid: mismatch.old_gameid,
          old_version: mismatch.old_version,
          result_sha224: mismatch.result_sha224,
          rhpakuuid: mismatch.rhpakuuid,
          migration_done: false
        });
        try {
          await uninstallRhpak({
            userDataDir,
            rhpakuuid: mismatch.rhpakuuid,
            backupDir: backup,
            onLog
          });
        } catch (err) {
          onLog(`[reconcile] warn: rhpak uninstall ${mismatch.rhpakuuid}: ${err.message}`);
          residualConflicts.push({ kind: 'gameid_mismatch', ...mismatch, error: err.message });
        }
      }
    }

    for (const c of scan.rowConflicts) {
      if (c.conflict_kind === 'equivalent' || c.conflict_kind === 'gamestage_level_equivalent' || c.conflict_kind === 'none') {
        continue;
      }
      if (c.conflict_kind === 'gamestage_level_collision' && c.local) {
        archiveRowText(backup, dbName, 'gamestages', c.local.stage_uuid, c.local);
        appendGamestagesCsv(backup, [c.local]);
        deleteRow(db, 'gamestages', 'stage_uuid', c.local.stage_uuid);
        onLog(`[reconcile] removed gamestage collision ${c.local.gameid}/${c.local.levelnumber}`);
        continue;
      }
      if (c.conflict_kind === 'content_mismatch' && c.local && c.spec) {
        const pk = c.local[c.spec.idCol];
        archiveRowText(backup, dbName, c.spec.table, pk, c.local);
        deleteRow(db, c.spec.table, c.spec.idCol, pk);
        onLog(`[reconcile] removed conflicting ${c.spec.table} ${pk}`);
        continue;
      }
      residualConflicts.push(c);
    }
  } finally {
    db.close();
  }

  if (residualConflicts.length) {
    writeConflictsJson(userDataDir, dbName, {
      dbName,
      patch: patchSpec?.file_name || null,
      at: new Date().toISOString(),
      conflicts: residualConflicts
    });
    onLog(`[reconcile] ${dbName}: wrote conflicts-${dbName}.json (${residualConflicts.length} residual)`);
  }

  onLog(`[reconcile] ${dbName}: equivalent=${scan.equivalentCount} true=${scan.trueConflictCount}`);
  return { backupDir: backup, scan, skipped: false, residualConflicts };
}

module.exports = {
  GV_MIGRATIONS_CSV,
  getBackupSessionDir,
  appendGvMigration,
  writeConflictsJson,
  reconcileBeforePatch
};
