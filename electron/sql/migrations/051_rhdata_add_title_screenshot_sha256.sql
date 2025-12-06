-- Migration: rhdata_051_add_title_screenshot_sha256
-- Description: Add title_screenshot_sha256 column to gameversions table
-- Date: 2025-01-XX
-- 
-- The title_screenshot_sha256 column allows manual override of the title screenshot.
-- The SHA256 value should match the decoded_sha256 column of the correct title screenshot
-- in the res_screenshots table. If set, this overrides the default behavior of using
-- the screenshot with the lowest sequence_no for a gameid.

ALTER TABLE gameversions ADD COLUMN title_screenshot_sha256 TEXT;

-- Create index for efficient lookups
CREATE INDEX IF NOT EXISTS idx_gameversions_title_screenshot_sha256
  ON gameversions(title_screenshot_sha256);

