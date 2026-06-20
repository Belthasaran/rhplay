-- Migration 070: Add ignore_warnings flag to extrapatches
-- Date: 2026-06-20
-- Description: Adds ignore_warnings boolean flag to extrapatches table for ASAR patches
-- that should treat ASAR stderr warnings as non-fatal during build/staging.

ALTER TABLE extrapatches ADD COLUMN ignore_warnings INTEGER DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_extrapatches_ignore_warnings ON extrapatches(ignore_warnings);
