'use strict';

const crypto = require('crypto');
const { recordLocalStagesEdit } = require('../electron/gamestages-edit-permission');
const { RUN_TYPE_FREE_PLAY, RUN_TYPE_STANDARD } = require('../electron/shared/run-types');

const SHA1_RE = /^[0-9a-f]{40}$/;

/**
 * Normalize MT level hex to uppercase without leading-zero padding (e.g. 105, 13B).
 * @param {string} level
 */
function normalizeLevelHex(level) {
  const trimmed = String(level || '').trim();
  if (!trimmed) return '';
  const parsed = parseInt(trimmed, 16);
  if (Number.isNaN(parsed)) return trimmed.toUpperCase();
  return parsed.toString(16).toUpperCase();
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} sha1
 */
function resolveSha1ToGame(db, sha1) {
  if (!db || !sha1 || !SHA1_RE.test(sha1)) {
    return null;
  }
  const rows = db.prepare(`
    SELECT gv.gameid, gv.version, gv.patchblob1_name, LOWER(pb.result_sha1) AS result_sha1
    FROM patchblobs pb
    JOIN gameversions gv ON gv.patchblob1_name = pb.patchblob1_name
    WHERE LOWER(pb.result_sha1) = LOWER(?)
    ORDER BY gv.gameid, gv.version DESC
  `).all(sha1);

  if (!rows.length) {
    return null;
  }

  const byGame = new Map();
  for (const row of rows) {
    if (!byGame.has(row.gameid)) {
      byGame.set(row.gameid, row);
    }
  }

  if (byGame.size === 1) {
    const pick = [...byGame.values()][0];
    return { gameid: pick.gameid, version: pick.version };
  }

  let best = null;
  for (const row of rows) {
    const latest = db.prepare(`
      SELECT patchblob1_name FROM gameversions
      WHERE gameid = ?
      ORDER BY version DESC LIMIT 1
    `).get(row.gameid);
    if (latest && latest.patchblob1_name === row.patchblob1_name) {
      if (!best || row.version > best.version) {
        best = row;
      }
    }
  }
  if (best) {
    return { gameid: best.gameid, version: best.version };
  }

  const fallback = rows[0];
  return { gameid: fallback.gameid, version: fallback.version };
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {number} fileId
 */
function resolveSmwcFileIdToSha1(db, fileId) {
  if (!db || !fileId) return null;
  const idStr = String(fileId);
  const patterns = [
    `%/dl.smwcentral.net/${idStr}/%`,
    `%id=${idStr}%`,
    `%smwcentral.net/?p=section&a=details&id=${idStr}%`,
  ];
  const row = db.prepare(`
    SELECT gv.patchblob1_name
    FROM gameversions gv
    WHERE gv.download_url LIKE ? OR gv.download_url LIKE ?
       OR gv.url LIKE ? OR gv.url LIKE ?
    ORDER BY gv.version DESC
    LIMIT 1
  `).get(patterns[0], patterns[1], patterns[2], patterns[2]);
  if (!row?.patchblob1_name) {
    return null;
  }
  const pb = db.prepare(`
    SELECT LOWER(result_sha1) AS result_sha1 FROM patchblobs
    WHERE patchblob1_name = ? LIMIT 1
  `).get(row.patchblob1_name);
  return pb?.result_sha1 || null;
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} gameid
 */
function lookupGameName(db, gameid) {
  const row = db.prepare(`
    SELECT name FROM gameversions
    WHERE gameid = ?
    ORDER BY version DESC LIMIT 1
  `).get(gameid);
  return row?.name || gameid;
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} gameid
 */
function countGameStages(db, gameid) {
  const row = db.prepare(`SELECT COUNT(*) AS c FROM gamestages WHERE gameid = ?`).get(gameid);
  return row?.c || 0;
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} gameid
 * @param {string} levelHex
 */
function findStageRow(db, gameid, levelHex) {
  const normalized = normalizeLevelHex(levelHex);
  const padded = normalized.padStart(3, '0');
  return db.prepare(`
    SELECT levelnumber, levelname, translevel_13bf
    FROM gamestages
    WHERE gameid = ? AND (
      levelnumber = ? OR levelnumber = ? OR UPPER(levelnumber) = UPPER(?)
    )
    LIMIT 1
  `).get(gameid, normalized, padded, normalized);
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} gameid
 * @param {Array<{ levelnumber: string, levelname?: string }>} levels
 */
function persistJitStages(db, gameid, levels) {
  if (!levels?.length) return;
  const insert = db.prepare(`
    INSERT INTO gamestages (
      stage_uuid, gameid, levelnumber, levelname, playable, difficulty
    ) VALUES (?, ?, ?, ?, 1, 0)
  `);
  const existing = new Set(
    db.prepare(`SELECT levelnumber FROM gamestages WHERE gameid = ?`).all(gameid)
      .map((r) => normalizeLevelHex(r.levelnumber))
  );
  for (const level of levels) {
    const hex = normalizeLevelHex(level.levelnumber);
    if (!hex || existing.has(hex)) continue;
    insert.run(crypto.randomUUID(), gameid, hex, level.levelname || `Level ${hex}`,);
    existing.add(hex);
  }
  recordLocalStagesEdit(db, gameid);
}

/**
 * @param {object} parsed — parseShareCode result (ok: true)
 * @param {object} deps
 * @param {import('better-sqlite3').Database} deps.rhdataDb
 * @param {(sha1: string) => Promise<{ gameid: string, version: number }|null>} [deps.installFromCatalog]
 * @param {(fileId: number) => Promise<string|null>} [deps.resolveSmwcFileId]
 * @param {(gameid: string, version: number) => Promise<{ levels: object[] }|null>} [deps.runJitDetection]
 * @param {(gameid: string, version: number, levelHex: string) => Promise<string|null>} [deps.lookupJitLevelName]
 * @param {(message: string) => void} [deps.onProgress]
 */
async function buildPlanFromShareCode(parsed, deps) {
  const {
    rhdataDb,
    installFromCatalog,
    resolveSmwcFileId,
    runJitDetection,
    lookupJitLevelName,
    onProgress,
  } = deps;

  const warnings = {
    missingSha1s: [],
    failedCatalog: [],
    missingFileIds: [],
  };

  const globalPatchCodes = [];
  if (parsed.flags?.switchPalaces) {
    globalPatchCodes.push('pall');
  }
  const runType = parsed.flags?.freePlay ? RUN_TYPE_FREE_PLAY : RUN_TYPE_STANDARD;

  /** @type {Map<string, { gameid: string, version: number }>} */
  const sha1Games = new Map();

  async function ensureSha1Game(sha1) {
    const key = sha1.toLowerCase();
    if (sha1Games.has(key)) {
      return sha1Games.get(key);
    }
    let game = resolveSha1ToGame(rhdataDb, key);
    if (!game && installFromCatalog) {
      onProgress?.(`Installing game for SHA1 ${key.slice(0, 8)}…`);
      try {
        game = await installFromCatalog(key);
      } catch (err) {
        warnings.failedCatalog.push(key);
        onProgress?.(`Catalog install failed: ${err.message}`);
      }
    }
    if (game) {
      sha1Games.set(key, game);
      return game;
    }
    warnings.missingSha1s.push(key);
    return null;
  }

  async function resolveEntrySha1(entry) {
    if (entry.sha1) {
      return entry.sha1.toLowerCase();
    }
    if (entry.source === 'smwc' && entry.fileId) {
      let sha1 = resolveSmwcFileIdToSha1(rhdataDb, entry.fileId);
      if (!sha1 && resolveSmwcFileId) {
        sha1 = await resolveSmwcFileId(entry.fileId);
      }
      if (!sha1) {
        warnings.missingFileIds.push(entry.fileId);
        return null;
      }
      return sha1.toLowerCase();
    }
    return null;
  }

  const jitRan = new Set();
  const planEntries = [];

  for (const entry of parsed.entries) {
    const sha1 = await resolveEntrySha1(entry);
    if (!sha1) continue;

    const game = await ensureSha1Game(sha1);
    if (!game) continue;

    const { gameid, version } = game;
    let stageCount = countGameStages(rhdataDb, gameid);

    if (stageCount === 0 && runJitDetection && !jitRan.has(gameid)) {
      onProgress?.(`Detecting stages for ${gameid}…`);
      jitRan.add(gameid);
      try {
        const jitResult = await runJitDetection(gameid, version);
        if (jitResult?.levels?.length) {
          persistJitStages(rhdataDb, gameid, jitResult.levels);
          stageCount = countGameStages(rhdataDb, gameid);
        }
      } catch (err) {
        onProgress?.(`JIT detection failed for ${gameid}: ${err.message}`);
      }
    }

    const gameName = lookupGameName(rhdataDb, gameid);

    for (const level of entry.levels) {
      const levelHex = normalizeLevelHex(level);
      const stage = findStageRow(rhdataDb, gameid, levelHex);

      if (stage) {
        planEntries.push({
          key: crypto.randomUUID(),
          id: gameid,
          entryType: 'stage',
          name: gameName,
          stageNumber: normalizeLevelHex(stage.levelnumber),
          stageName: stage.levelname || '',
          transLevel: stage.translevel_13bf || '',
          count: 1,
          conditions: [],
        });
      } else if (stageCount > 0) {
        let planStageName = 'Unknown';
        if (lookupJitLevelName) {
          try {
            const jitName = await lookupJitLevelName(gameid, version, levelHex);
            if (jitName) planStageName = jitName;
          } catch { /* ignore */ }
        }
        planEntries.push({
          key: crypto.randomUUID(),
          id: gameid,
          entryType: 'raw_code',
          name: gameName,
          stageNumber: levelHex,
          stageName: planStageName,
          rawLevelCode: levelHex,
          planStageName,
          count: 1,
          conditions: [],
        });
      } else {
        let planStageName = 'Unknown';
        if (lookupJitLevelName) {
          try {
            const jitName = await lookupJitLevelName(gameid, version, levelHex);
            if (jitName) planStageName = jitName;
          } catch { /* ignore */ }
        }
        planEntries.push({
          key: crypto.randomUUID(),
          id: gameid,
          entryType: 'raw_code',
          name: gameName,
          stageNumber: levelHex,
          stageName: planStageName,
          rawLevelCode: levelHex,
          planStageName,
          count: 1,
          conditions: [],
        });
      }
    }
  }

  const hasUnresolved = warnings.missingSha1s.length > 0
    || warnings.failedCatalog.length > 0
    || warnings.missingFileIds.length > 0;

  return {
    success: planEntries.length > 0 || !hasUnresolved,
    warnings: hasUnresolved ? warnings : undefined,
    plan: planEntries.length > 0 ? {
      runName: parsed.name || undefined,
      runType,
      globalPatchCodes,
      entries: planEntries,
    } : undefined,
    partial: hasUnresolved && planEntries.length > 0,
  };
}

module.exports = {
  normalizeLevelHex,
  resolveSha1ToGame,
  resolveSmwcFileIdToSha1,
  lookupGameName,
  findStageRow,
  persistJitStages,
  buildPlanFromShareCode,
};
