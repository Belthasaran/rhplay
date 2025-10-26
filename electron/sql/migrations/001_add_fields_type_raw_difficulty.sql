-- Migration: Add fields_type and raw_difficulty columns to gameversions table
-- Date: 2025-01-10
-- Description: Support new JSON schema with fields.type and raw_fields.difficulty

-- Add fields_type column to store the type from fields.type (e.g., "Kaizo", "Standard")
ALTER TABLE gameversions ADD COLUMN fields_type VARCHAR(255);

-- Add raw_difficulty column to store the difficulty code from raw_fields.difficulty (e.g., "diff_4", "diff_2")
ALTER TABLE gameversions ADD COLUMN raw_difficulty VARCHAR(255);

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_gameversions_fields_type ON gameversions(fields_type);
CREATE INDEX IF NOT EXISTS idx_gameversions_raw_difficulty ON gameversions(raw_difficulty);

