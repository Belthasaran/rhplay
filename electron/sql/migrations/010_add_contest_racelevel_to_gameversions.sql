-- Migration: Add contest and racelevel columns to gameversions table
-- Date: 2025-01-XX
-- Description: Add contest and racelevel columns for game categorization
-- Database: rhdata.db

-- Add contest column to store contest information
ALTER TABLE gameversions ADD COLUMN contest VARCHAR(255);

-- Add racelevel column to store race level information
ALTER TABLE gameversions ADD COLUMN racelevel VARCHAR(255);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_gameversions_contest ON gameversions(contest);
CREATE INDEX IF NOT EXISTS idx_gameversions_racelevel ON gameversions(racelevel);

