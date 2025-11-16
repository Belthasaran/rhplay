-- Migration: 032_clientdata_game_submission_drafts
-- Description: Create game_submission_drafts table for storing draft game submissions
-- Date: 2025-01-XX

CREATE TABLE IF NOT EXISTS game_submission_drafts (
  draft_uuid TEXT PRIMARY KEY,
  submitter_pubkey_npub TEXT,
  draft_name TEXT,
  draft_data_json TEXT NOT NULL,
  created_at_utc INTEGER NOT NULL,
  updated_at_utc INTEGER NOT NULL,
  prepared_at_utc INTEGER NULL,
  packaged_at_utc INTEGER NULL,
  rhpak_path TEXT NULL,
  state TEXT NOT NULL DEFAULT 'draft' -- 'draft', 'prepared', 'packaged', 'submitted'
);

CREATE INDEX IF NOT EXISTS idx_game_submission_drafts_submitter ON game_submission_drafts(submitter_pubkey_npub);
CREATE INDEX IF NOT EXISTS idx_game_submission_drafts_state ON game_submission_drafts(state);
CREATE INDEX IF NOT EXISTS idx_game_submission_drafts_updated ON game_submission_drafts(updated_at_utc DESC);

