-- Migration 009: Add levelnames and gameversion_levelnames tables
-- Date: 2025-01-21
-- Purpose: Add support for level name extraction and linking to game versions

-- Create levelnames table
CREATE TABLE IF NOT EXISTS levelnames (
  lvluuid varchar(255) primary key DEFAULT (lower(hex(randomblob(16)))),
  gameid varchar(255) NOT NULL,
  levelid varchar(10) NOT NULL,  -- e.g., "0x001", "0x100"
  levelname varchar(255) NOT NULL,
  created_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(gameid, levelid)
);

-- Create junction table for many-to-many relationship between gameversions and levelnames
CREATE TABLE IF NOT EXISTS gameversion_levelnames (
  gvlvuuid varchar(255) primary key DEFAULT (lower(hex(randomblob(16)))),
  gvuuid varchar(255) NOT NULL REFERENCES gameversions(gvuuid) ON DELETE CASCADE,
  lvluuid varchar(255) NOT NULL REFERENCES levelnames(lvluuid) ON DELETE CASCADE,
  created_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(gvuuid, lvluuid)
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_levelnames_gameid ON levelnames(gameid);
CREATE INDEX IF NOT EXISTS idx_levelnames_levelid ON levelnames(levelid);
CREATE INDEX IF NOT EXISTS idx_gameversion_levelnames_gvuuid ON gameversion_levelnames(gvuuid);
CREATE INDEX IF NOT EXISTS idx_gameversion_levelnames_lvluuid ON gameversion_levelnames(lvluuid);

-- Add trigger to update updated_time when levelnames are modified
CREATE TRIGGER IF NOT EXISTS levelnames_updated_time 
  AFTER UPDATE ON levelnames
BEGIN
  UPDATE levelnames SET updated_time = CURRENT_TIMESTAMP WHERE lvluuid = NEW.lvluuid;
END;
