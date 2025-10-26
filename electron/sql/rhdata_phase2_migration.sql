-- Phase 2 Migration: Change Detection and Statistics Tracking
-- Run this to enable Phase 2 functionality (change detection for existing games)
-- Prerequisite: Phase 1 migration and migration 004 must be applied first

-- Table: gameversion_stats
-- Maintains current statistics for each game (one record per gameid)
CREATE TABLE IF NOT EXISTS gameversion_stats (
  gvstatuuid varchar(255) primary key DEFAULT (lower(hex(randomblob(16)))),
  gameid varchar(255) NOT NULL UNIQUE,
  gvuuid varchar(255) REFERENCES gameversions(gvuuid),  -- Latest version
  
  -- Statistics (extracted from gvjsondata for quick access)
  download_count INTEGER,
  view_count INTEGER,
  comment_count INTEGER,
  rating_value REAL,
  rating_count INTEGER,
  favorite_count INTEGER,
  
  -- HOF/Featured tracking
  hof_status varchar(50),
  featured_status varchar(50),
  
  -- Full current JSON data
  gvjsondata text NOT NULL,
  
  -- Change tracking
  previous_gvjsondata text,         -- Previous state for comparison
  last_major_change TIMESTAMP,      -- When last version was created
  last_minor_change TIMESTAMP,      -- When stats were last updated
  change_count INTEGER DEFAULT 0,   -- Number of minor updates
  
  -- Metadata
  first_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  UNIQUE(gameid)
);

CREATE INDEX IF NOT EXISTS idx_gvstats_gameid ON gameversion_stats(gameid);
CREATE INDEX IF NOT EXISTS idx_gvstats_gvuuid ON gameversion_stats(gvuuid);
CREATE INDEX IF NOT EXISTS idx_gvstats_last_updated ON gameversion_stats(last_updated);

-- Table: change_detection_log
-- Audit log of detected changes
CREATE TABLE IF NOT EXISTS change_detection_log (
  loguuid varchar(255) primary key DEFAULT (lower(hex(randomblob(16)))),
  gameid varchar(255) NOT NULL,
  gvuuid varchar(255) REFERENCES gameversions(gvuuid),
  
  change_type varchar(50) NOT NULL,  -- 'major', 'minor', 'none'
  detection_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  -- What changed
  changed_fields text,               -- JSON array of field names
  field_changes text,                -- JSON object with old/new values
  
  -- Action taken
  action_taken varchar(100),         -- 'created_version', 'updated_stats', 'ignored'
  new_gvuuid varchar(255),          -- If version created, its UUID
  
  -- Metadata
  metadata text                      -- Additional context as JSON
);

CREATE INDEX IF NOT EXISTS idx_cdlog_gameid ON change_detection_log(gameid);
CREATE INDEX IF NOT EXISTS idx_cdlog_type ON change_detection_log(change_type);
CREATE INDEX IF NOT EXISTS idx_cdlog_time ON change_detection_log(detection_time);

-- Table: change_detection_config
-- Configurable classification of fields
CREATE TABLE IF NOT EXISTS change_detection_config (
  cfguuid varchar(255) primary key DEFAULT (lower(hex(randomblob(16)))),
  field_name varchar(255) NOT NULL UNIQUE,
  classification varchar(50) NOT NULL,  -- 'major', 'minor', 'ignored'
  weight INTEGER DEFAULT 1,             -- For threshold-based detection
  notes text,
  active BOOLEAN DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Initial configuration data for field classifications
-- Note: cfguuid is omitted to use DEFAULT auto-generation
INSERT OR IGNORE INTO change_detection_config (field_name, classification, weight, notes) VALUES
  ('name', 'major', 10, 'Game title'),
  ('author', 'major', 8, 'Primary author'),
  ('authors', 'major', 8, 'Author list'),
  ('description', 'major', 7, 'Game description'),
  ('difficulty', 'major', 6, 'Difficulty classification'),
  ('length', 'major', 6, 'Length classification'),
  ('gametype', 'major', 6, 'Game type'),
  ('type', 'major', 6, 'Game type (alternate)'),
  ('download_url', 'major', 9, 'Download URL (path/filename only)'),
  ('name_href', 'major', 9, 'Download URL alternate'),
  ('patchblob1_name', 'major', 10, 'Patch blob identifier'),
  ('pat_sha224', 'major', 10, 'Patch hash'),
  ('size', 'major', 5, 'File size (>5% change)'),
  ('removed', 'major', 8, 'Removal status'),
  ('obsoleted', 'major', 8, 'Obsolescence status'),
  ('obsoleted_by', 'major', 7, 'Obsoleting game'),
  ('moderated', 'major', 6, 'Moderation status'),
  ('demo', 'major', 5, 'Demo status'),
  ('featured', 'major', 4, 'Featured status'),
  ('tags', 'major', 5, 'Tag list'),
  ('download_count', 'minor', 1, 'Download statistics'),
  ('downloads', 'minor', 1, 'Download statistics (alternate)'),
  ('views', 'minor', 1, 'View statistics'),
  ('comments', 'minor', 1, 'Comment data'),
  ('comment_count', 'minor', 1, 'Comment count'),
  ('rating', 'minor', 1, 'Rating value'),
  ('rating_count', 'minor', 1, 'Rating count'),
  ('favorites', 'minor', 1, 'Favorite count'),
  ('hof', 'minor', 1, 'Hall of Fame status'),
  ('images', 'minor', 1, 'Image URLs'),
  ('screenshots', 'minor', 1, 'Screenshot data'),
  ('rom', 'ignored', 0, 'Internal ROM path'),
  ('romblob_name', 'ignored', 0, 'Internal ROM blob'),
  ('romblob_salt', 'ignored', 0, 'Internal ROM salt'),
  ('time', 'ignored', 0, 'Timestamp field'),
  ('added', 'ignored', 0, 'Added timestamp'),
  ('local_resource_etag', 'ignored', 0, 'Computed column'),
  ('local_resource_lastmodified', 'ignored', 0, 'Computed column'),
  ('local_resource_filename', 'ignored', 0, 'Computed column'),
  ('combinedtype', 'ignored', 0, 'Computed column'),
  ('gvimport_time', 'ignored', 0, 'Computed column'),
  ('version', 'ignored', 0, 'Computed column'),
  ('gvuuid', 'ignored', 0, 'Computed column');

