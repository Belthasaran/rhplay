-- Migration 069: gamestages test status columns
-- Date: 2026-06-14
-- Description: Track stage test accept/reject with patch-config snapshots for invalidation

ALTER TABLE gamestages ADD COLUMN test_status TEXT
  CHECK (test_status IS NULL OR test_status IN ('accept', 'reject'));
ALTER TABLE gamestages ADD COLUMN test_status_at INTEGER;
ALTER TABLE gamestages ADD COLUMN test_verified_levelnumber TEXT;
ALTER TABLE gamestages ADD COLUMN test_verified_playlevel_patch_code TEXT;
ALTER TABLE gamestages ADD COLUMN test_verified_requisites TEXT;

CREATE INDEX IF NOT EXISTS idx_gamestages_test_status ON gamestages(test_status);
