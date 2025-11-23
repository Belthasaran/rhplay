-- Migration 043: Extend stage_feedback table with patch and condition tracking
-- Date: 2025-01-XX
-- Description: Adds columns to track global conditions, applied patches, and playlevel patchcode

ALTER TABLE stage_feedback ADD COLUMN global_conditions TEXT;  -- JSON array of global patch codes
ALTER TABLE stage_feedback ADD COLUMN applied_patches TEXT;  -- JSON array of applied patch codes
ALTER TABLE stage_feedback ADD COLUMN playlevel_patchcode TEXT;  -- Patch code used for playlevel

