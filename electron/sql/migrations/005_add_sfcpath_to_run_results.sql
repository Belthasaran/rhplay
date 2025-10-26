-- Migration 005: Add sfcpath column to run_results table
-- Date: 2025-10-26
-- Purpose: Track USB2SNES file paths for run games to enable launch buttons

-- Add sfcpath column (safe to run multiple times)
ALTER TABLE run_results ADD COLUMN sfcpath TEXT NULL;

-- Note: Column stores relative path like "run251025_2307/02.sfc"
-- NULL means the run hasn't been uploaded to USB2SNES yet

