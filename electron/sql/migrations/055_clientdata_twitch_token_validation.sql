-- Migration 055: Add token validation tracking
-- Date: 2025-01-XX
-- Purpose: Add last_validated_at field to track token validation for proactive re-authentication
-- Database: clientdata.db

-- Add last_validated_at column to twitch_integration table
ALTER TABLE twitch_integration ADD COLUMN last_validated_at INTEGER DEFAULT 0;

-- Update existing records to set last_validated_at to obtainment_timestamp if available
UPDATE twitch_integration 
SET last_validated_at = obtainment_timestamp 
WHERE last_validated_at = 0 AND obtainment_timestamp > 0;

