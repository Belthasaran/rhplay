-- Migration 005: Add local_runexcluded field to gameversions
-- Date: October 12, 2025
-- Database: rhdata.db
-- Purpose: Add curator-controlled flag to exclude games from random selection

-- Add local_runexcluded column to gameversions table
-- This is a COMPUTED COLUMN managed by curators, not imported from external JSON
ALTER TABLE gameversions ADD COLUMN local_runexcluded INTEGER DEFAULT 0;

-- Add index for efficient filtering
CREATE INDEX IF NOT EXISTS idx_gameversions_runexcluded ON gameversions(local_runexcluded);

-- Add comment about this being a computed column
-- This field should be excluded from JSON imports along with:
-- - combinedtype
-- - gvimport_time
-- - version
-- - gvuuid
-- - local_resource_etag
-- - local_resource_lastmodified
-- - local_resource_filename

SELECT 'Migration 005 completed successfully.' as message;
SELECT 'Added local_runexcluded INTEGER DEFAULT 0 to gameversions' as change;
SELECT 'This is a COMPUTED COLUMN - do not import from JSON' as warning;

