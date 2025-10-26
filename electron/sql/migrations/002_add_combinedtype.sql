-- Migration: Add combinedtype column to gameversions table
-- Date: 2025-01-10
-- Description: Computed column combining type and difficulty fields

-- Add combinedtype column to store combined type/difficulty string
ALTER TABLE gameversions ADD COLUMN combinedtype VARCHAR(255);

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_gameversions_combinedtype ON gameversions(combinedtype);

-- Note: Values will be computed and populated by loaddata.js
-- Format: [fields_type]: [difficulty] (raw_difficulty) (raw_fields.type)
-- Example: "Kaizo: Advanced (diff_4) (kaizo)"

