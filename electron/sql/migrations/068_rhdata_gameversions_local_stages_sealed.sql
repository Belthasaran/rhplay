-- Migration: Add gameversions_local table and stages_sealed columns
-- Date: 2026-06-14
-- Description: Track per-user local stage edits and author sealing policy on gameversions
-- Database: rhdata.db

CREATE TABLE IF NOT EXISTS gameversions_local (
  gameid TEXT NOT NULL PRIMARY KEY,
  stages_edited_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_gameversions_local_edited_at
  ON gameversions_local(stages_edited_at);

ALTER TABLE gameversions ADD COLUMN stages_sealed INTEGER;
ALTER TABLE gameversions ADD COLUMN stages_sealed_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_gameversions_stages_sealed
  ON gameversions(stages_sealed);
