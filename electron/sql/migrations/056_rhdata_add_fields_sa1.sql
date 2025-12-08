-- Migration: Add sa1 column to gameversions table
-- Date: 2025-01-XX
-- Description: Add sa1 column for SA1 chip requirement tracking
-- Database: rhdata.db

-- Add sa1 column to store SA1 chip requirement information
ALTER TABLE gameversions ADD COLUMN sa1 VARCHAR(255);

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_gameversions_sa1 ON gameversions(sa1);

