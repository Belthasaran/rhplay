/**
 * Migration 069: stage_feedback patch-hash key + RHServer sync tracking
 *
 * - Add applied_patches_hash and content_hash
 * - Add rhserver_sync_pending/last_submitted tracking
 * - Add rhserver_review_state mirror fields
 * - Rebuild unique key to include applied_patches_hash
 */

const crypto = require('crypto');

function stableJson(obj) {
  if (obj === null || obj === undefined) return 'null';
  if (typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return `[${obj.map((v) => stableJson(v)).join(',')}]`;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableJson(obj[k])}`).join(',')}}`;
}

function sha256Hex(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex');
}

function canonicalizeAppliedPatches(appliedPatches) {
  if (!appliedPatches) return '';
  const raw = String(appliedPatches).trim();
  if (!raw) return '';
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map((s) => String(s || '').trim()).filter(Boolean).sort().join('\n');
    }
  } catch (_) {}
  return raw.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean).sort().join('\n');
}

function computeHashes(row) {
  const appliedCanonical = canonicalizeAppliedPatches(row.applied_patches || '');
  const appliedHash = sha256Hex(appliedCanonical);
  const content = {
    translevel: row.translevel || null,
    levelname: row.levelname || null,
    difficulty_feedback: row.difficulty_feedback ?? null,
    comment: row.comment || null,
    current_difficulty: row.current_difficulty ?? null,
    flag_values: row.flag_values || null,
    global_conditions: row.global_conditions || null,
    tag_feedback: row.tag_feedback || null,
    test_result: row.test_result || null,
    stage_uuid: row.stage_uuid || null
  };
  const contentHash = sha256Hex(stableJson(content));
  return { appliedHash, contentHash };
}

module.exports = function apply(db) {
  const hasTable = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='stage_feedback'`).get();
  if (!hasTable) return;

  const legacy = db.prepare(`SELECT * FROM stage_feedback`).all();

  db.exec(`
    CREATE TABLE stage_feedback_new (
      feedback_uuid TEXT PRIMARY KEY,
      gameid TEXT NOT NULL,
      levelnumber TEXT NOT NULL,
      translevel TEXT,
      levelname TEXT,
      difficulty_feedback INTEGER,
      comment TEXT,
      current_difficulty INTEGER,
      flag_values TEXT,
      global_conditions TEXT,
      applied_patches TEXT,
      applied_patches_hash TEXT NOT NULL DEFAULT '',
      playlevel_patchcode TEXT NOT NULL DEFAULT '2lvno',
      feedback_source TEXT,
      test_result TEXT CHECK (test_result IS NULL OR test_result IN ('no_action', 'reject', 'accept')),
      tag_feedback TEXT,
      stage_uuid TEXT,
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      updated_at INTEGER DEFAULT (strftime('%s', 'now')),
      content_hash TEXT,
      rhserver_sync_pending INTEGER DEFAULT 0,
      rhserver_last_submitted_at INTEGER,
      rhserver_last_submitted_hash TEXT,
      rhserver_review_state TEXT,
      rhserver_review_state_set_at INTEGER,
      UNIQUE(gameid, levelnumber, playlevel_patchcode, applied_patches_hash)
    );
  `);

  const insert = db.prepare(`
    INSERT INTO stage_feedback_new (
      feedback_uuid, gameid, levelnumber, translevel, levelname,
      difficulty_feedback, comment, current_difficulty, flag_values,
      global_conditions, applied_patches, applied_patches_hash, playlevel_patchcode,
      feedback_source, test_result, tag_feedback, stage_uuid,
      created_at, updated_at,
      content_hash, rhserver_sync_pending, rhserver_last_submitted_at, rhserver_last_submitted_hash,
      rhserver_review_state, rhserver_review_state_set_at
    ) VALUES (
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?,
      ?, ?, ?, ?,
      ?, ?
    )
  `);

  for (const row of legacy) {
    const { appliedHash, contentHash } = computeHashes(row);
    insert.run(
      row.feedback_uuid || crypto.randomUUID(),
      row.gameid,
      row.levelnumber,
      row.translevel || null,
      row.levelname || null,
      row.difficulty_feedback ?? null,
      row.comment || null,
      row.current_difficulty ?? null,
      row.flag_values || null,
      row.global_conditions || null,
      row.applied_patches || null,
      row.applied_patches_hash || appliedHash,
      row.playlevel_patchcode || '2lvno',
      row.feedback_source || null,
      row.test_result || null,
      row.tag_feedback || null,
      row.stage_uuid || null,
      row.created_at || Math.floor(Date.now() / 1000),
      row.updated_at || Math.floor(Date.now() / 1000),
      row.content_hash || contentHash,
      1, // pending resync after migration
      null,
      null,
      null,
      null
    );
  }

  db.exec(`DROP TABLE stage_feedback;`);
  db.exec(`ALTER TABLE stage_feedback_new RENAME TO stage_feedback;`);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_stage_feedback_gameid ON stage_feedback(gameid);
    CREATE INDEX IF NOT EXISTS idx_stage_feedback_levelnumber ON stage_feedback(levelnumber);
    CREATE INDEX IF NOT EXISTS idx_stage_feedback_playlevel ON stage_feedback(playlevel_patchcode);
    CREATE INDEX IF NOT EXISTS idx_stage_feedback_created_at ON stage_feedback(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_stage_feedback_source ON stage_feedback(feedback_source);
    CREATE INDEX IF NOT EXISTS idx_stage_feedback_stage_uuid ON stage_feedback(stage_uuid);
    CREATE INDEX IF NOT EXISTS idx_stage_feedback_sync_pending ON stage_feedback(rhserver_sync_pending, updated_at);
  `);
};

