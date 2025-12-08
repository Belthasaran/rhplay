-- Migration: Fix rhpatches foreign key constraint
-- Date: 2025-01-XX
-- Database: rhdata.db
-- Description: Remove invalid foreign key constraint from rhpatches.gameid
-- 
-- Issue: rhpatches.gameid references gameversions(gameid), but gameid alone
-- is not unique in gameversions. The unique keys are (gameid, version) or gvuuid.
-- SQLite requires foreign keys to reference unique columns or primary keys.
--
-- Solution: Remove the invalid foreign key constraint. Since rhpatches only
-- has gameid (not version), it cannot reference the composite unique key.
-- Referential integrity will be maintained at the application level.

-- Step 1: Create new table without the invalid foreign key
-- Preserve all existing columns (including row_version and rhpakuuid if they exist)
CREATE TABLE rhpatches_new (
    rhpuuid varchar(255) PRIMARY KEY DEFAULT (uuid()),
    gameid varchar(255) NOT NULL,
    patch_name varchar(255) NOT NULL,
    siglistuuid varchar(255),
    row_version INTEGER DEFAULT 1,
    rhpakuuid TEXT,
    UNIQUE(patch_name)
);

-- Step 2: Copy data from old table (preserve all columns)
INSERT INTO rhpatches_new (rhpuuid, gameid, patch_name, siglistuuid, row_version, rhpakuuid)
SELECT 
    rhpuuid, 
    gameid, 
    patch_name, 
    siglistuuid,
    COALESCE(row_version, 1) as row_version,
    rhpakuuid
FROM rhpatches;

-- Step 3: Drop old table
DROP TABLE rhpatches;

-- Step 4: Rename new table to original name
ALTER TABLE rhpatches_new RENAME TO rhpatches;

-- Step 5: Recreate indexes (if any were dropped)
CREATE INDEX IF NOT EXISTS idx_rhpatches_gameid ON rhpatches(gameid);
CREATE INDEX IF NOT EXISTS idx_rhpatches_patch_name ON rhpatches(patch_name);

