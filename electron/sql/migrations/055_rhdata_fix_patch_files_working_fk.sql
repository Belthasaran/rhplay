-- Migration: Fix patch_files_working foreign key constraint
-- Date: 2025-01-XX
-- Database: rhdata.db
-- Description: Add ON DELETE CASCADE to patch_files_working.queueuuid foreign key
--              and clean up existing orphaned records
-- 
-- Issue: patch_files_working.queueuuid references game_fetch_queue(queueuuid),
--        but when game_fetch_queue records are deleted, patch_files_working records
--        remain as orphans, causing foreign key constraint violations.
--
-- Solution: 
-- 1. Clean up existing orphaned records
-- 2. Recreate table with ON DELETE CASCADE to automatically delete related records

-- Step 1: Clean up existing orphaned records (records with invalid queueuuid references)
DELETE FROM patch_files_working 
WHERE queueuuid NOT IN (SELECT queueuuid FROM game_fetch_queue);

-- Step 2: Create new table with ON DELETE CASCADE
CREATE TABLE IF NOT EXISTS patch_files_working_new (
  pfuuid varchar(255) PRIMARY KEY DEFAULT (uuid()),
  queueuuid varchar(255) REFERENCES game_fetch_queue(queueuuid) ON DELETE CASCADE,
  gameid varchar(255) NOT NULL,
  zip_path varchar(500),
  patch_filename varchar(500),
  patch_type varchar(10),
  is_primary BOOLEAN DEFAULT 0,
  priority_score INTEGER,
  
  -- Hash calculations
  pat_sha1 varchar(255),
  pat_sha224 varchar(255),
  pat_shake_128 varchar(255),
  
  -- Result of applying patch
  result_sha1 varchar(255),
  result_sha224 varchar(255),
  result_shake1 varchar(255),
  
  -- File paths
  patch_file_path varchar(500),
  result_file_path varchar(500),
  
  -- Blob data (stored temporarily until records created)
  blob_data text,
  
  -- Processing status
  status varchar(50) DEFAULT 'pending',
  test_result varchar(50),
  error_message text,
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  processed_at TIMESTAMP
);

-- Step 3: Copy data from old table (only valid records with existing queueuuid)
INSERT INTO patch_files_working_new (
  pfuuid, queueuuid, gameid, zip_path, patch_filename, patch_type,
  is_primary, priority_score,
  pat_sha1, pat_sha224, pat_shake_128,
  result_sha1, result_sha224, result_shake1,
  patch_file_path, result_file_path,
  blob_data,
  status, test_result, error_message,
  created_at, processed_at
)
SELECT 
  pfuuid, queueuuid, gameid, zip_path, patch_filename, patch_type,
  is_primary, priority_score,
  pat_sha1, pat_sha224, pat_shake_128,
  result_sha1, result_sha224, result_shake1,
  patch_file_path, result_file_path,
  blob_data,
  status, test_result, error_message,
  created_at, processed_at
FROM patch_files_working
WHERE queueuuid IN (SELECT queueuuid FROM game_fetch_queue);

-- Step 4: Drop old table
DROP TABLE patch_files_working;

-- Step 5: Rename new table to original name
ALTER TABLE patch_files_working_new RENAME TO patch_files_working;

-- Step 6: Recreate indexes
CREATE INDEX IF NOT EXISTS idx_patchwork_queue ON patch_files_working(queueuuid);
CREATE INDEX IF NOT EXISTS idx_patchwork_gameid ON patch_files_working(gameid);
CREATE INDEX IF NOT EXISTS idx_patchwork_status ON patch_files_working(status);
CREATE INDEX IF NOT EXISTS idx_patchwork_primary ON patch_files_working(is_primary);

