-- Migration 004: Add Local Resource Tracking Fields
-- Date: October 12, 2025
-- Purpose: Track downloaded ZIP files with ETag and Last-Modified headers for efficient update detection

-- Add local resource tracking columns to gameversions table
ALTER TABLE gameversions ADD COLUMN local_resource_etag VARCHAR(255);
ALTER TABLE gameversions ADD COLUMN local_resource_lastmodified TIMESTAMP;
ALTER TABLE gameversions ADD COLUMN local_resource_filename VARCHAR(500);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_gameversions_local_filename ON gameversions(local_resource_filename);
CREATE INDEX IF NOT EXISTS idx_gameversions_local_etag ON gameversions(local_resource_etag);

-- Note: These are COMPUTED COLUMNS - they are managed by the update scripts
-- and should NOT be updated from external JSON data imports.
-- 
-- local_resource_etag: HTTP ETag header from download response
-- local_resource_lastmodified: HTTP Last-Modified header from download response  
-- local_resource_filename: Local path where ZIP was saved (e.g., zips/12345_2.zip)
--
-- These fields enable:
-- 1. Efficient change detection (HEAD request before download)
-- 2. Versioned ZIP storage (preserve old versions)
-- 3. Duplicate download prevention

