/**
 * provision-conflict-checker.js - Detect provisioning patch conflicts vs local DB
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { rowsEquivalent, computeRowFingerprint } = require('./provision-row-equivalence');
const provisionBundle = require('./provision-bundle');

const DECLARATION_SPECS = [
  { listKey: 'added_gameversions', table: 'gameversions', idCol: 'gvuuid', db: 'rhdata.db' },
  { listKey: 'added_patchblobs', table: 'patchblobs', idCol: 'pbuuid', db: 'rhdata.db' },
  { listKey: 'added_gamestages', table: 'gamestages', idCol: 'stage_uuid', db: 'rhdata.db' },
  { listKey: 'added_gameversion_stats', table: 'gameversion_stats', idCol: 'gameid', db: 'rhdata.db' },
  { listKey: 'added_patchblobs_extended', table: 'patchblobs_extended', idCol: 'pbuuid', db: 'rhdata.db' },
  { listKey: 'added_rhpatches', table: 'rhpatches', idCol: 'patch_name', db: 'rhdata.db' },
  { listKey: 'added_extrapatches', table: 'extrapatches', idCol: 'patchcode', db: 'rhdata.db' },
  { listKey: 'added_rhpaks', table: 'rhpaks', idCol: 'rhpakuuid', db: 'rhdata.db' },
  { listKey: 'added_attachments', table: 'attachments', idCol: 'auuid', db: 'patchbin.db' },
  { listKey: 'added_res_attachments', table: 'res_attachments', idCol: 'rauuid', db: 'resource.db' },
  { listKey: 'added_res_screenshots', table: 'res_screenshots', idCol: 'rsuuid', db: 'screenshot.db' }
];

function tableExists(db, name) {
  return Boolean(db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(name));
}

function loadDeclaredRows(patchDeclarations, dbName) {
  const rows = [];
  for (const spec of DECLARATION_SPECS) {
    if (spec.db !== dbName) continue;
    const list = patchDeclarations?.[spec.listKey];
    if (!Array.isArray(list)) continue;
    for (const declared of list) {
      rows.push({ ...spec, declared });
    }
  }
  return rows;
}

function findGameidMismatches(rhdataDb, declaredGames) {
  const conflicts = [];
  if (!rhdataDb || !fs.existsSync(rhdataDb)) return conflicts;
  const db = new Database(rhdataDb, { readonly: true });
  try {
    if (!tableExists(db, 'patchblobs') || !tableExists(db, 'gameversions')) return conflicts;
    for (const declared of declaredGames) {
      const officialGameid = String(declared.gameid || '');
      const hash = declared.result_sha224 || declared.pat_sha224;
      if (!hash) continue;
      const matches = db.prepare(`
        SELECT gv.gameid, gv.version, gv.gvuuid, gv.rhpakuuid, pb.result_sha224, pb.pat_sha224
        FROM patchblobs pb
        JOIN gameversions gv ON gv.gvuuid = pb.gvuuid
        WHERE pb.result_sha224 = ? OR pb.pat_sha224 = ?
      `).all(hash, hash);
      for (const local of matches) {
        if (String(local.gameid) !== officialGameid) {
          conflicts.push({
            conflict_kind: 'gameid_mismatch',
            old_gameid: local.gameid,
            old_version: local.version,
            old_gvuuid: local.gvuuid,
            official_gameid: officialGameid,
            official_version: declared.version,
            result_sha224: local.result_sha224 || declared.result_sha224,
            rhpakuuid: local.rhpakuuid
          });
        }
      }
    }
  } finally {
    db.close();
  }
  return conflicts;
}

function classifyDeclaredRow(db, spec, declared) {
  if (!tableExists(db, spec.table)) {
    return { conflict_kind: 'none', declared, spec };
  }
  const local = db.prepare(`SELECT * FROM ${spec.table} WHERE ${spec.idCol} = ?`).get(declared[spec.idCol]);
  if (!local) {
    return { conflict_kind: 'none', declared, spec };
  }
  if (rowsEquivalent(local, declared, spec.table)) {
    return { conflict_kind: 'equivalent', declared, spec, local };
  }
  return { conflict_kind: 'content_mismatch', declared, spec, local };
}

function findGamestageLevelCollisions(db, declaredStages) {
  const conflicts = [];
  if (!tableExists(db, 'gamestages')) return conflicts;
  for (const declared of declaredStages) {
    const locals = db.prepare(`
      SELECT * FROM gamestages WHERE gameid = ? AND levelnumber = ?
    `).all(declared.gameid, declared.levelnumber);
    for (const local of locals) {
      if (local.stage_uuid === declared.stage_uuid) {
        if (rowsEquivalent(local, declared, 'gamestages')) {
          conflicts.push({ conflict_kind: 'gamestage_level_equivalent', declared, local });
        } else {
          conflicts.push({ conflict_kind: 'gamestage_level_collision', declared, local });
        }
      } else if (!rowsEquivalent(local, declared, 'gamestages')) {
        conflicts.push({ conflict_kind: 'gamestage_level_collision', declared, local });
      }
    }
  }
  return conflicts;
}

function countClientdataRefs(clientdataPath, gameids) {
  const counts = {};
  if (!clientdataPath || !fs.existsSync(clientdataPath) || !gameids.length) return counts;
  const db = new Database(clientdataPath, { readonly: true });
  const idSet = new Set(gameids.map(String));
  try {
    const tables = [
      { table: 'run_results', col: 'gameid' },
      { table: 'run_plan_entries', col: 'gameid' },
      { table: 'stage_feedback', col: 'gameid' },
      { table: 'user_game_annotations', col: 'gameid' },
      { table: 'user_game_version_annotations', col: 'gameid' }
    ];
    for (const { table, col } of tables) {
      if (!tableExists(db, table)) continue;
      for (const gid of idSet) {
        const row = db.prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE ${col} = ?`).get(gid);
        if (row.c > 0) {
          counts[gid] = counts[gid] || {};
          counts[gid][table] = row.c;
        }
      }
    }
  } finally {
    db.close();
  }
  return counts;
}

async function scanPatchConflicts({
  dbPath,
  dbName,
  patchArchivePath,
  patchSpec,
  rhdataPath = null,
  clientdataPath = null,
  stagingDir = null
}) {
  let patchDeclarations = {};
  if (provisionBundle.isBundleSpec(patchSpec) && patchArchivePath && fs.existsSync(patchArchivePath)) {
    const loaded = await provisionBundle.loadProvindexFromArchive(
      patchArchivePath,
      patchSpec.format,
      stagingDir
    );
    patchDeclarations = loaded.patch_declarations || {};
  }

  const db = new Database(dbPath, { readonly: true });
  const rowConflicts = [];
  try {
    for (const item of loadDeclaredRows(patchDeclarations, dbName)) {
      rowConflicts.push(classifyDeclaredRow(db, item, item.declared));
    }
    if (dbName === 'rhdata.db') {
      const stages = (patchDeclarations.added_gamestages || []);
      rowConflicts.push(...findGamestageLevelCollisions(db, stages));
    }
  } finally {
    db.close();
  }

  const gameMismatches = dbName === 'rhdata.db'
    ? findGameidMismatches(rhdataPath || dbPath, patchDeclarations.added_gameversions || [])
    : [];

  const equivalentCount = rowConflicts.filter((c) =>
    c.conflict_kind === 'equivalent' || c.conflict_kind === 'gamestage_level_equivalent'
  ).length;

  const trueConflicts = rowConflicts.filter((c) =>
    c.conflict_kind !== 'equivalent' && c.conflict_kind !== 'gamestage_level_equivalent' && c.conflict_kind !== 'none'
  );

  const rhpakuuids = new Set();
  for (const c of [...trueConflicts, ...gameMismatches]) {
    const uuid = c.local?.rhpakuuid || c.rhpakuuid;
    if (uuid) rhpakuuids.add(uuid);
  }

  const clientdataImpact = countClientdataRefs(
    clientdataPath,
    gameMismatches.map((g) => g.old_gameid)
  );

  return {
    dbName,
    patchDeclarations,
    rowConflicts,
    gameMismatches,
    equivalentCount,
    trueConflictCount: trueConflicts.length + gameMismatches.length,
    affectedRhpakuuids: [...rhpakuuids],
    clientdataImpact,
    allEquivalent: trueConflicts.length === 0 && gameMismatches.length === 0
  };
}

module.exports = {
  DECLARATION_SPECS,
  scanPatchConflicts,
  findGameidMismatches,
  classifyDeclaredRow,
  loadDeclaredRows
};
