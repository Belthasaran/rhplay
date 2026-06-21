/**
 * rhpak-conflict-checker.js
 *
 * Detect and resolve RHPAK ownership conflicts for updategames import folders.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const rhpakOwnership = require('./rhpak-ownership');

const GUARDED_TABLES = [
  {
    qualified: 'rhdata.gameversions',
    dbKey: 'rhdata',
    table: 'gameversions',
    pk: ['gameid', 'version'],
    lookupFromSkeleton(skeleton) {
      const gv = skeleton.gameversion || {};
      if (!gv.gameid || gv.version === undefined || gv.version === null) {
        return null;
      }
      return { gameid: String(gv.gameid), version: gv.version };
    },
    labelFromRow(row) {
      return `gameid ${row.gameid} v${row.version}`;
    },
  },
  {
    qualified: 'rhdata.gameversion_stats',
    dbKey: 'rhdata',
    table: 'gameversion_stats',
    pk: ['gameid'],
    lookupFromSkeleton(skeleton) {
      const gameid = skeleton.gameversion?.gameid;
      return gameid ? { gameid: String(gameid) } : null;
    },
    labelFromRow(row) {
      return `gameid ${row.gameid} stats`;
    },
  },
  {
    qualified: 'rhdata.patchblobs',
    dbKey: 'rhdata',
    table: 'patchblobs',
    pk: ['patchblob1_name'],
    lookupFromSkeleton(skeleton) {
      const name = skeleton.patchblob?.patchblob1_name;
      return name ? { patchblob1_name: name } : null;
    },
    labelFromRow(row) {
      return row.patchblob1_name || 'patchblob';
    },
  },
  {
    qualified: 'rhdata.patchblobs_extended',
    dbKey: 'rhdata',
    table: 'patchblobs_extended',
    pk: ['pbuuid'],
    lookupFromSkeleton(skeleton) {
      const pbuuid = skeleton.patchblob?.pbuuid;
      return pbuuid ? { pbuuid } : null;
    },
    labelFromRow(row) {
      return row.pbuuid || 'patchblobs_extended';
    },
  },
  {
    qualified: 'rhdata.rhpatches',
    dbKey: 'rhdata',
    table: 'rhpatches',
    pk: ['patch_name'],
    lookupFromSkeleton(skeleton) {
      const patchName = skeleton.artifacts?.patch?.patch_relative_path;
      return patchName ? { patch_name: patchName } : null;
    },
    labelFromRow(row) {
      return row.patch_name || 'patch record';
    },
  },
  {
    qualified: 'patchbin.attachments',
    dbKey: 'patchbin',
    table: 'attachments',
    pk: ['file_name'],
    lookupFromSkeleton(skeleton) {
      const fileName = skeleton.patchblob?.patchblob1_name;
      return fileName ? { file_name: fileName } : null;
    },
    labelFromRow(row) {
      return row.file_name || 'attachment';
    },
  },
];

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function resolveGameFolder(inputPath) {
  const abs = path.resolve(inputPath);
  if (!fs.existsSync(abs)) {
    throw new Error(`Game folder not found: ${abs}`);
  }
  const gameid = path.basename(abs);
  const skeletonPath = path.join(abs, `${gameid}.json`);
  if (!fs.existsSync(skeletonPath)) {
    throw new Error(`Skeleton not found: ${skeletonPath}`);
  }
  return { gameFolder: abs, gameid, skeletonPath, baseDir: abs };
}

function resolveIncomingRhpak(skeleton) {
  return (skeleton.metadata && skeleton.metadata.rhpakuuid) || skeleton.gameversion?.rhpakuuid || null;
}

function ensurePrepared(skeletonPath, jstoolsDir) {
  const skeleton = loadJson(skeletonPath);
  if (skeleton.metadata && skeleton.metadata.prepared) {
    return skeleton;
  }
  const prepareCmd = `enode.sh ${path.join(jstoolsDir, 'newgame.js')} "${skeletonPath}" --prepare`;
  execSync(prepareCmd, { stdio: 'inherit', cwd: jstoolsDir });
  return loadJson(skeletonPath);
}

function loadImportSkeleton(gameFolder) {
  const resolved = resolveGameFolder(gameFolder);
  const jstoolsDir = path.join(__dirname, '..', 'jstools');
  const skeleton = ensurePrepared(resolved.skeletonPath, jstoolsDir);
  return {
    ...resolved,
    skeleton,
    incomingSource: resolved.skeletonPath,
  };
}

function buildSelectSql(table, pk, key) {
  const where = Object.keys(key).map((col) => `${col} = @${col}`).join(' AND ');
  return {
    sql: `SELECT * FROM ${table} WHERE ${where} LIMIT 1`,
    params: key,
  };
}

function lookupRhpakMeta(rhdataDb, uuid) {
  if (!uuid || !rhdataDb) {
    return { name: null, is_system: null };
  }
  try {
    const row = rhdataDb.prepare('SELECT name, is_system FROM rhpaks WHERE rhpakuuid = ?').get(uuid);
    return row ? { name: row.name, is_system: row.is_system } : { name: null, is_system: null };
  } catch (_) {
    const row = rhdataDb.prepare('SELECT name FROM rhpaks WHERE rhpakuuid = ?').get(uuid);
    return row ? { name: row.name, is_system: null } : { name: null, is_system: null };
  }
}

function makeConflictReport({
  gameid,
  qualified,
  naturalKey,
  rowId,
  fileName,
  dbOwner,
  dbOwnerName,
  dbOwnerIsSystem,
  incomingOwner,
  incomingOwnerName,
  incomingSource,
  conflictType,
}) {
  return {
    gameid,
    table: qualified.split('.')[1],
    qualified,
    naturalKey,
    rowId,
    fileName: fileName || null,
    dbOwner,
    dbOwnerName,
    dbOwnerIsSystem,
    incomingOwner,
    incomingOwnerName,
    incomingSource,
    conflictType,
    wouldBlockAdd: true,
  };
}

function tableExists(db, table) {
  try {
    return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
  } catch (_) {
    return false;
  }
}

function checkRowConflict({
  gameid,
  spec,
  db,
  rhdataDb,
  skeleton,
  incomingOwner,
  incomingSource,
  incomingOwnerName,
}) {
  const key = spec.lookupFromSkeleton(skeleton);
  if (!key || !db || !tableExists(db, spec.table)) {
    return null;
  }
  const { sql, params } = buildSelectSql(spec.table, spec.pk, key);
  const existing = db.prepare(sql).get(params);
  if (!existing) {
    return null;
  }
  const owners = rhpakOwnership.parseRhpakuuid2(existing.rhpakuuid2, existing.rhpakuuid);
  if (rhpakOwnership.ownersInclude(owners, incomingOwner)) {
    return null;
  }
  const label = spec.labelFromRow(existing);
  const reason = rhpakOwnership.getOwnershipBlockReason(existing, incomingOwner, label);
  if (!reason) {
    return null;
  }
  const dbOwner = existing.rhpakuuid || owners[0] || null;
  const dbMeta = lookupRhpakMeta(rhdataDb, dbOwner);
  const rowId = {};
  for (const pkCol of spec.pk) {
    rowId[pkCol] = existing[pkCol];
  }
  return makeConflictReport({
    gameid,
    qualified: spec.qualified,
    naturalKey: key,
    rowId,
    fileName: label,
    dbOwner,
    dbOwnerName: dbMeta.name,
    dbOwnerIsSystem: dbMeta.is_system,
    incomingOwner,
    incomingOwnerName,
    incomingSource,
    conflictType: owners.length === 0 && !existing.rhpakuuid ? 'legacy_null_owner' : 'cross_rhpak',
  });
}

function collectResourceConflicts(dbs, skeleton, context) {
  const conflicts = [];
  const incomingOwner = context.incomingOwner;
  if (!dbs.resource || !tableExists(dbs.resource, 'res_attachments')) {
    return conflicts;
  }
  const resources = skeleton.resources || [];
  for (const entry of resources) {
    if (!entry || !entry.fernet_key || !entry.encrypted_data_path) {
      continue;
    }
    const sha256 = entry.file_sha256 || entry.decoded_sha256;
    if (!sha256 || !dbs.resource) {
      continue;
    }
    const existing = dbs.resource.prepare(
      'SELECT * FROM res_attachments WHERE file_sha256 = ? LIMIT 1'
    ).get(sha256);
    if (!existing) {
      continue;
    }
    const owners = rhpakOwnership.parseRhpakuuid2(existing.rhpakuuid2, existing.rhpakuuid);
    if (rhpakOwnership.ownersInclude(owners, incomingOwner)) {
      continue;
    }
    const label = entry.file_name || sha256;
    const reason = rhpakOwnership.getOwnershipBlockReason(existing, incomingOwner, `Resource file ${label}`);
    if (!reason) {
      continue;
    }
    const dbOwner = existing.rhpakuuid || owners[0] || null;
    const dbMeta = lookupRhpakMeta(dbs.rhdata, dbOwner);
    conflicts.push(makeConflictReport({
      gameid: context.gameid,
      qualified: 'resource.res_attachments',
      naturalKey: { file_sha256: sha256 },
      rowId: { rauuid: existing.rauuid },
      fileName: label,
      dbOwner,
      dbOwnerName: dbMeta.name,
      dbOwnerIsSystem: dbMeta.is_system,
      incomingOwner,
      incomingOwnerName: context.incomingOwnerName,
      incomingSource: context.incomingSource,
      conflictType: owners.length === 0 && !existing.rhpakuuid ? 'legacy_null_owner' : 'cross_rhpak',
    }));
  }
  return conflicts;
}

function collectScreenshotConflicts(dbs, skeleton, context) {
  const conflicts = [];
  const incomingOwner = context.incomingOwner;
  if (!dbs.screenshot || !tableExists(dbs.screenshot, 'res_screenshots')) {
    return conflicts;
  }
  for (const entry of skeleton.screenshots || []) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    if (entry.file_sha256 && dbs.screenshot) {
      const existing = dbs.screenshot.prepare(
        'SELECT * FROM res_screenshots WHERE file_sha256 = ? LIMIT 1'
      ).get(entry.file_sha256);
      if (existing) {
        const owners = rhpakOwnership.parseRhpakuuid2(existing.rhpakuuid2, existing.rhpakuuid);
        if (!rhpakOwnership.ownersInclude(owners, incomingOwner)) {
          const label = entry.file_name || entry.file_sha256;
          const reason = rhpakOwnership.getOwnershipBlockReason(existing, incomingOwner, `Screenshot ${label}`);
          if (reason) {
            const dbOwner = existing.rhpakuuid || owners[0] || null;
            const dbMeta = lookupRhpakMeta(dbs.rhdata, dbOwner);
            conflicts.push(makeConflictReport({
              gameid: context.gameid,
              qualified: 'screenshot.res_screenshots',
              naturalKey: { file_sha256: entry.file_sha256 },
              rowId: { rsuuid: existing.rsuuid },
              fileName: label,
              dbOwner,
              dbOwnerName: dbMeta.name,
              dbOwnerIsSystem: dbMeta.is_system,
              incomingOwner,
              incomingOwnerName: context.incomingOwnerName,
              incomingSource: context.incomingSource,
              conflictType: owners.length === 0 && !existing.rhpakuuid ? 'legacy_null_owner' : 'cross_rhpak',
            }));
          }
        }
      }
    }
    if (entry.source_url && dbs.screenshot) {
      const existingUrl = dbs.screenshot.prepare(
        'SELECT * FROM res_screenshots WHERE source_url = ? LIMIT 1'
      ).get(entry.source_url);
      if (existingUrl) {
        const owners = rhpakOwnership.parseRhpakuuid2(existingUrl.rhpakuuid2, existingUrl.rhpakuuid);
        if (!rhpakOwnership.ownersInclude(owners, incomingOwner)) {
          const reason = rhpakOwnership.getOwnershipBlockReason(existingUrl, incomingOwner, `Screenshot URL ${entry.source_url}`);
          if (reason) {
            const dbOwner = existingUrl.rhpakuuid || owners[0] || null;
            const dbMeta = lookupRhpakMeta(dbs.rhdata, dbOwner);
            conflicts.push(makeConflictReport({
              gameid: context.gameid,
              qualified: 'screenshot.res_screenshots',
              naturalKey: { source_url: entry.source_url },
              rowId: { rsuuid: existingUrl.rsuuid },
              fileName: entry.source_url,
              dbOwner,
              dbOwnerName: dbMeta.name,
              dbOwnerIsSystem: dbMeta.is_system,
              incomingOwner,
              incomingOwnerName: context.incomingOwnerName,
              incomingSource: context.incomingSource,
              conflictType: owners.length === 0 && !existingUrl.rhpakuuid ? 'legacy_null_owner' : 'cross_rhpak',
            }));
          }
        }
      }
    }
  }
  return conflicts;
}

function detectConflicts(dbs, skeleton, context) {
  const incomingOwner = resolveIncomingRhpak(skeleton);
  if (!incomingOwner) {
    throw new Error('Prepared skeleton is missing rhpakuuid metadata.');
  }
  const incomingMeta = lookupRhpakMeta(dbs.rhdata, incomingOwner);
  const incomingOwnerName = skeleton.metadata?.rhpakname || incomingMeta.name || incomingOwner;
  const gameid = String(skeleton.gameversion?.gameid || context.gameid || '');
  const sharedContext = {
    gameid,
    incomingOwner,
    incomingOwnerName,
    incomingSource: context.incomingSource || context.skeletonPath || '',
  };

  const conflicts = [];
  for (const spec of GUARDED_TABLES) {
    const db = dbs[spec.dbKey];
    const report = checkRowConflict({
      gameid,
      spec,
      db,
      rhdataDb: dbs.rhdata,
      skeleton,
      incomingOwner,
      incomingSource: sharedContext.incomingSource,
      incomingOwnerName,
    });
    if (report) {
      conflicts.push(report);
    }
  }
  conflicts.push(...collectResourceConflicts(dbs, skeleton, sharedContext));
  conflicts.push(...collectScreenshotConflicts(dbs, skeleton, sharedContext));
  return {
    gameid,
    incomingOwner,
    incomingOwnerName,
    incomingIsSystem: skeleton.metadata?.is_system ?? null,
    dbGameversionRhpak: dbs.rhdata && gameid && tableExists(dbs.rhdata, 'gameversions')
      ? dbs.rhdata.prepare('SELECT rhpakuuid, rhpakuuid2 FROM gameversions WHERE gameid = ? ORDER BY version DESC LIMIT 1').get(gameid)
      : null,
    conflicts,
  };
}

const TABLE_SPECS_BY_QUALIFIED = Object.fromEntries([
  ...GUARDED_TABLES.map((spec) => [spec.qualified, spec]),
  ['resource.res_attachments', { dbKey: 'resource', table: 'res_attachments', pk: ['rauuid'] }],
  ['screenshot.res_screenshots', { dbKey: 'screenshot', table: 'res_screenshots', pk: ['rsuuid'] }],
]);

function ensureRhpakRegistry(db, uuid, name, isSystem) {
  if (!db || !uuid) {
    return;
  }
  const existing = db.prepare('SELECT rhpakuuid FROM rhpaks WHERE rhpakuuid = ?').get(uuid);
  if (existing) {
    return;
  }
  const hasIsSystem = db.prepare('PRAGMA table_info(rhpaks)').all().some((col) => col.name === 'is_system');
  if (hasIsSystem) {
    db.prepare(
      'INSERT INTO rhpaks (rhpakuuid, jsfilename, name, is_system) VALUES (?, ?, ?, ?)'
    ).run(uuid, `${uuid}.json`, name || uuid, isSystem ? 1 : 0);
  } else {
    db.prepare(
      'INSERT INTO rhpaks (rhpakuuid, jsfilename, name) VALUES (?, ?, ?)'
    ).run(uuid, `${uuid}.json`, name || uuid);
  }
}

function applyOwnershipChange(dbs, conflict, options = {}) {
  const spec = TABLE_SPECS_BY_QUALIFIED[conflict.qualified];
  if (!spec) {
    throw new Error(`Unknown conflict table: ${conflict.qualified}`);
  }
  const db = dbs[spec.dbKey];
  if (!db) {
    throw new Error(`Database not open for ${conflict.qualified}`);
  }

  const where = Object.keys(conflict.rowId).map((col) => `${col} = @${col}`).join(' AND ');
  const existing = db.prepare(`SELECT * FROM ${spec.table} WHERE ${where} LIMIT 1`).get(conflict.rowId);
  if (!existing) {
    return { applied: false, reason: 'row not found' };
  }

  const next = rhpakOwnership.setPrimaryOwner(existing, conflict.incomingOwner, { linkPrevious: true });
  if (options.dryRun) {
    return { applied: true, dryRun: true, before: existing, after: { ...existing, ...next } };
  }

  db.prepare(`UPDATE ${spec.table} SET rhpakuuid = @rhpakuuid, rhpakuuid2 = @rhpakuuid2 WHERE ${where}`).run({
    ...conflict.rowId,
    rhpakuuid: next.rhpakuuid,
    rhpakuuid2: next.rhpakuuid2,
  });

  if (dbs.rhdata) {
    ensureRhpakRegistry(
      dbs.rhdata,
      conflict.incomingOwner,
      conflict.incomingOwnerName,
      conflict.incomingIsSystem === 1 || conflict.incomingIsSystem === true
    );
    if (conflict.dbOwner) {
      const dbMeta = lookupRhpakMeta(dbs.rhdata, conflict.dbOwner);
      ensureRhpakRegistry(dbs.rhdata, conflict.dbOwner, dbMeta.name, dbMeta.is_system === 1);
    }
  }

  return { applied: true, before: existing, after: next };
}

function formatConflictReport(report) {
  const lines = [];
  lines.push(`[${report.gameid}] RHPAK conflict report`);
  lines.push(`  Incoming rhpak: ${report.incomingOwner}  (${report.incomingOwnerName || 'unnamed'})`);
  if (report.dbGameversionRhpak) {
    const dbOwners = rhpakOwnership.parseRhpakuuid2(
      report.dbGameversionRhpak.rhpakuuid2,
      report.dbGameversionRhpak.rhpakuuid
    );
    const match = rhpakOwnership.ownersInclude(dbOwners, report.incomingOwner) ? 'match' : 'DIFFER';
    lines.push(`  DB gameversion rhpak: ${report.dbGameversionRhpak.rhpakuuid || dbOwners[0] || '(none)'}  (${match})`);
  } else {
    lines.push('  DB gameversion: (not present)');
  }
  lines.push('');
  if (report.conflicts.length === 0) {
    lines.push('  No blocking conflicts detected.');
  } else {
    lines.push('  CONFLICTS (would block updategames --add):');
    report.conflicts.forEach((conflict, index) => {
      lines.push(`  ${index + 1}. ${conflict.qualified}`);
      lines.push(`     item: ${conflict.fileName || JSON.stringify(conflict.naturalKey)}`);
      lines.push(`     key:  ${Object.entries(conflict.naturalKey).map(([k, v]) => `${k}=${v}`).join(', ')}`);
      lines.push(`     db owner:       ${conflict.dbOwner}  (${conflict.dbOwnerName || 'unknown rhpak'})`);
      lines.push(`     incoming owner: ${conflict.incomingOwner}  (${conflict.incomingOwnerName || 'unnamed'})`);
    });
  }
  lines.push('');
  lines.push(`  Summary: ${report.conflicts.length} blocking conflict(s)`);
  return lines.join('\n');
}

module.exports = {
  GUARDED_TABLES,
  loadImportSkeleton,
  resolveIncomingRhpak,
  detectConflicts,
  applyOwnershipChange,
  formatConflictReport,
  ensureRhpakRegistry,
  lookupRhpakMeta,
};
