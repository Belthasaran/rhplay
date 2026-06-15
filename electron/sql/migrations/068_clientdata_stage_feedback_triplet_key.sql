-- Migration 068: stage_feedback triplet unique key
-- Date: 2026-06-14
-- Description: Key stage_feedback by (gameid, levelnumber, playlevel_patchcode)

UPDATE stage_feedback SET playlevel_patchcode = '2lvno'
WHERE playlevel_patchcode IS NULL OR TRIM(playlevel_patchcode) = '';

CREATE TABLE IF NOT EXISTS stage_feedback_triplet (
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
  playlevel_patchcode TEXT NOT NULL DEFAULT '2lvno',
  feedback_source TEXT,
  test_result TEXT CHECK (test_result IS NULL OR test_result IN ('no_action', 'reject', 'accept')),
  tag_feedback TEXT,
  stage_uuid TEXT,
  created_at INTEGER DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER DEFAULT (strftime('%s', 'now')),
  UNIQUE(gameid, levelnumber, playlevel_patchcode)
);

INSERT INTO stage_feedback_triplet (
  feedback_uuid, gameid, levelnumber, translevel, levelname,
  difficulty_feedback, comment, current_difficulty, flag_values,
  global_conditions, applied_patches, playlevel_patchcode,
  feedback_source, test_result, tag_feedback, stage_uuid,
  created_at, updated_at
)
SELECT
  feedback_uuid, gameid, levelnumber, translevel, levelname,
  difficulty_feedback, comment, current_difficulty, flag_values,
  global_conditions, applied_patches, COALESCE(NULLIF(TRIM(playlevel_patchcode), ''), '2lvno'),
  feedback_source, test_result, tag_feedback, stage_uuid,
  created_at, updated_at
FROM stage_feedback sf1
WHERE feedback_uuid = (
  SELECT feedback_uuid FROM stage_feedback sf2
  WHERE sf2.gameid = sf1.gameid
    AND sf2.levelnumber = sf1.levelnumber
    AND COALESCE(NULLIF(TRIM(sf2.playlevel_patchcode), ''), '2lvno')
      = COALESCE(NULLIF(TRIM(sf1.playlevel_patchcode), ''), '2lvno')
  ORDER BY updated_at DESC, created_at DESC
  LIMIT 1
);

DROP TABLE stage_feedback;
ALTER TABLE stage_feedback_triplet RENAME TO stage_feedback;

CREATE INDEX IF NOT EXISTS idx_stage_feedback_gameid ON stage_feedback(gameid);
CREATE INDEX IF NOT EXISTS idx_stage_feedback_levelnumber ON stage_feedback(levelnumber);
CREATE INDEX IF NOT EXISTS idx_stage_feedback_playlevel ON stage_feedback(playlevel_patchcode);
CREATE INDEX IF NOT EXISTS idx_stage_feedback_created_at ON stage_feedback(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stage_feedback_source ON stage_feedback(feedback_source);
CREATE INDEX IF NOT EXISTS idx_stage_feedback_stage_uuid ON stage_feedback(stage_uuid);

CREATE TRIGGER IF NOT EXISTS trg_stage_feedback_updated
  AFTER UPDATE ON stage_feedback
  FOR EACH ROW
BEGIN
  UPDATE stage_feedback SET updated_at = strftime('%s', 'now') WHERE feedback_uuid = NEW.feedback_uuid;
END;
