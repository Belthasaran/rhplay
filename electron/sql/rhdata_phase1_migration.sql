-- Phase 1 Migration: Update Script Support Tables
-- Run this after initial rhdata.sql schema is created
-- This adds tables needed for the updategames.js script

-- Table: update_status
-- Tracks overall update process state and metadata fetch history
CREATE TABLE IF NOT EXISTS update_status (
  uuuid varchar(255) primary key DEFAULT (uuid()),
  operation_type varchar(50) NOT NULL,  -- 'metadata_fetch', 'game_update', 'patch_process'
  status varchar(50) NOT NULL,          -- 'pending', 'in_progress', 'completed', 'failed', 'paused'
  metadata text,                        -- Store additional operational metadata as JSON
  started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP,
  last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  error_message text,
  retry_count INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_upstatus_type ON update_status(operation_type);
CREATE INDEX IF NOT EXISTS idx_upstatus_status ON update_status(status);
CREATE INDEX IF NOT EXISTS idx_upstatus_started ON update_status(started_at);

-- Table: game_fetch_queue
-- Queue for games pending download and processing
CREATE TABLE IF NOT EXISTS game_fetch_queue (
  queueuuid varchar(255) primary key DEFAULT (uuid()),
  gameid varchar(255) NOT NULL,
  status varchar(50) NOT NULL DEFAULT 'pending',  -- 'pending', 'downloading', 'processing', 'completed', 'failed'
  priority INTEGER DEFAULT 100,
  game_metadata text,               -- Store raw metadata from SMWC as JSON
  download_url varchar(500),
  zip_path varchar(500),            -- Path to downloaded ZIP
  error_message text,
  retry_count INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  UNIQUE(gameid)
);

CREATE INDEX IF NOT EXISTS idx_queue_gameid ON game_fetch_queue(gameid);
CREATE INDEX IF NOT EXISTS idx_queue_status ON game_fetch_queue(status);
CREATE INDEX IF NOT EXISTS idx_queue_priority ON game_fetch_queue(priority DESC, created_at ASC);

-- Table: patch_files_working
-- Temporary working table for tracking individual patch files during processing
CREATE TABLE IF NOT EXISTS patch_files_working (
  pfuuid varchar(255) primary key DEFAULT (uuid()),
  queueuuid varchar(255) REFERENCES game_fetch_queue(queueuuid),
  gameid varchar(255) NOT NULL,
  zip_path varchar(500),
  patch_filename varchar(500),      -- Filename inside ZIP
  patch_type varchar(10),           -- 'bps' or 'ips'
  is_primary BOOLEAN DEFAULT 0,     -- Primary patch flag
  priority_score INTEGER,           -- Heuristic score for primary selection
  
  -- Hash calculations
  pat_sha1 varchar(255),
  pat_sha224 varchar(255),
  pat_shake_128 varchar(255),
  
  -- Result of applying patch
  result_sha1 varchar(255),
  result_sha224 varchar(255),
  result_shake1 varchar(255),
  
  -- File paths
  patch_file_path varchar(500),     -- Extracted patch location
  result_file_path varchar(500),    -- Patched ROM location
  
  -- Blob data (stored temporarily until records created)
  blob_data text,                   -- JSON with patchblob1_name, key, etc.
  
  -- Processing status
  status varchar(50) DEFAULT 'pending',  -- 'pending', 'extracted', 'tested', 'failed', 'completed'
  test_result varchar(50),          -- 'success', 'failed', 'not_tested'
  error_message text,
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  processed_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_patchwork_queue ON patch_files_working(queueuuid);
CREATE INDEX IF NOT EXISTS idx_patchwork_gameid ON patch_files_working(gameid);
CREATE INDEX IF NOT EXISTS idx_patchwork_status ON patch_files_working(status);
CREATE INDEX IF NOT EXISTS idx_patchwork_primary ON patch_files_working(is_primary);

-- Table: smwc_metadata_cache
-- Cache for SMWC server responses to minimize repeated fetches
CREATE TABLE IF NOT EXISTS smwc_metadata_cache (
  cacheuuid varchar(255) primary key DEFAULT (uuid()),
  fetch_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  page_number INTEGER,
  response_data text,               -- Full JSON response from server
  next_page_url varchar(500),
  record_count INTEGER,
  cache_expires TIMESTAMP,
  UNIQUE(page_number, fetch_date)
);

CREATE INDEX IF NOT EXISTS idx_cache_page ON smwc_metadata_cache(page_number);
CREATE INDEX IF NOT EXISTS idx_cache_expires ON smwc_metadata_cache(cache_expires);

-- Add columns to existing patchblobs table if they don't exist
-- Note: ALTER TABLE ADD COLUMN IF NOT EXISTS is not standard SQLite
-- These will be handled in the migration script

-- We'll track these in a separate table for now to avoid altering patchblobs
CREATE TABLE IF NOT EXISTS patchblobs_extended (
  pbuuid varchar(255) primary key REFERENCES patchblobs(pbuuid),
  patch_filename varchar(500),
  patch_type varchar(10),           -- 'bps' or 'ips'
  is_primary BOOLEAN DEFAULT 0,
  zip_source varchar(500),          -- Source ZIP file
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_pbext_type ON patchblobs_extended(patch_type);
CREATE INDEX IF NOT EXISTS idx_pbext_primary ON patchblobs_extended(is_primary);

