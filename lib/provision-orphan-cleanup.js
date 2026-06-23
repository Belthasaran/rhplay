/**
 * provision-orphan-cleanup.js - Post-provision orphan detection and conflict archive
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { getBackupSessionDir } = require('./provision-reconcile');

const TEST_GAMEID_ALLOWLIST = new Set(['0', '1', '99999', '__migration_test_027']);

function archiveOrphan(backupDir, dbName, table, pk, row) {
  const filePath = path.join(backupDir, 'orphans', dbName, table, `${pk}.txt`);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(row, null, 2), 'utf8');
}

function tableExists(db, name) {
  return Boolean(db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(name));
}

function cleanupRhdataOrphans({ rhdataPath, patchbinPath, backupDir, onLog }) {
  const rh = new Database(rhdataPath);
  const orphans = [];
  try {
    if (tableExists(rh, 'gameversions') && tableExists(rh, 'patchblobs')) {
      const rows = rh.prepare(`
        SELECT gv.* FROM gameversions gv
        LEFT JOIN patchblobs pb ON pb.gvuuid = gv.gvuuid
        WHERE pb.gvuuid IS NULL
      `).all();
      for (const row of rows) {
        if (TEST_GAMEID_ALLOWLIST.has(String(row.gameid))) continue;
        orphans.push({ db: 'rhdata.db', table: 'gameversions', pk: row.gvuuid, row });
        rh.prepare('DELETE FROM gameversions WHERE gvuuid = ?').run(row.gvuuid);
      }
    }
    if (tableExists(rh, 'gamestages') && tableExists(rh, 'gameversions')) {
      const rows = rh.prepare(`
        SELECT gs.* FROM gamestages gs
        LEFT JOIN gameversions gv ON gv.gameid = gs.gameid
        WHERE gv.gameid IS NULL
      `).all();
      for (const row of rows) {
        orphans.push({ db: 'rhdata.db', table: 'gamestages', pk: row.stage_uuid, row });
        rh.prepare('DELETE FROM gamestages WHERE stage_uuid = ?').run(row.stage_uuid);
      }
    }
  } finally {
    rh.close();
  }

  if (patchbinPath && fs.existsSync(patchbinPath) && fs.existsSync(rhdataPath)) {
    const pb = new Database(patchbinPath);
    const rhRead = new Database(rhdataPath, { readonly: true });
    try {
      if (tableExists(rhRead, 'patchblobs') && tableExists(pb, 'attachments')) {
        const blobs = rhRead.prepare('SELECT patchblob1_name, pbuuid FROM patchblobs').all();
        const names = new Set(blobs.map((b) => b.patchblob1_name).filter(Boolean));
        for (const att of pb.prepare('SELECT * FROM attachments').all()) {
          const linked = names.has(att.file_name);
          if (!linked) {
            orphans.push({ db: 'patchbin.db', table: 'attachments', pk: att.auuid, row: att });
            pb.prepare('DELETE FROM attachments WHERE auuid = ?').run(att.auuid);
          }
        }
      }
    } finally {
      pb.close();
      rhRead.close();
    }
  }

  for (const o of orphans) {
    archiveOrphan(backupDir, o.db, o.table, o.pk, o.row);
  }
  if (onLog) onLog(`[orphan-cleanup] removed ${orphans.length} orphan row(s)`);
  return orphans;
}

function archiveConflictJsonFiles(userDataDir, backupDir) {
  const archived = [];
  for (const name of fs.readdirSync(userDataDir)) {
    if (!name.startsWith('conflicts-') || !name.endsWith('.json')) continue;
    const src = path.join(userDataDir, name);
    const destDir = path.join(backupDir, 'conflicts');
    fs.mkdirSync(destDir, { recursive: true });
    const dest = path.join(destDir, name);
    fs.copyFileSync(src, dest);
    fs.unlinkSync(src);
    archived.push(dest);
  }
  return archived;
}

function runProvisionOrphanCleanup({ userDataDir, backupDir = null, onLog = console.log } = {}) {
  const backup = backupDir || getBackupSessionDir(userDataDir);
  const rhdataPath = path.join(userDataDir, 'rhdata.db');
  const patchbinPath = path.join(userDataDir, 'patchbin.db');

  const archivedConflicts = archiveConflictJsonFiles(userDataDir, backup);
  const orphans = cleanupRhdataOrphans({ rhdataPath, patchbinPath, backupDir: backup, onLog });

  const reportPath = path.join(backup, 'final-check-report.txt');
  fs.writeFileSync(reportPath, [
    `orphan_cleanup_at=${new Date().toISOString()}`,
    `orphans_removed=${orphans.length}`,
    `conflicts_archived=${archivedConflicts.length}`,
    `orphan_ok=${orphans.length === 0}`
  ].join('\n') + '\n', 'utf8');

  return {
    backupDir: backup,
    orphansRemoved: orphans.length,
    conflictsArchived: archivedConflicts.length,
    reportPath,
    ok: true
  };
}

module.exports = {
  runProvisionOrphanCleanup,
  cleanupRhdataOrphans,
  archiveConflictJsonFiles,
  TEST_GAMEID_ALLOWLIST
};
