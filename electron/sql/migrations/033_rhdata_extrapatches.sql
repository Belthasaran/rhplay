-- Migration: 033_rhdata_extrapatches
-- Description: Create extrapatches table for storing extra patch templates that can be applied after initial patching
-- Date: 2025-01-XX

CREATE TABLE IF NOT EXISTS extrapatches (
  epuuid TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  patch_code TEXT NOT NULL UNIQUE, -- Short code like "cc" or "blu1"
  name TEXT NOT NULL,
  description TEXT,
  patch_type TEXT NOT NULL CHECK(patch_type IN ('ips', 'bps', 'asar', 'uberasmtree')),
  
  -- File data storage (binary data for IPS/BPS patches, 7z for UberASMTree, template text for ASAR)
  file_data BLOB,
  
  -- Template text for ASAR patches
  template_text TEXT,
  
  -- Parameter mappings: JSON object mapping input parameter names to template output parameter names
  -- Example: {"local5v1": {"output": "${myonoff1}", "description": "Red"}}
  parameter_mappings TEXT, -- JSON object
  
  -- Filtering/restrictions: JSON object
  -- Example: {"allowed_games": ["gameid1", "gameid2"], "required_tags": ["tag1"], "excluded_tags": ["tag2"]}
  restrictions TEXT, -- JSON object
  
  -- Conflicts: JSON array of patch codes that conflict with this patch
  -- Example: ["conflict1", "conflict2"]
  conflicts TEXT, -- JSON array
  
  -- Dependencies: JSON array of patch codes that must be applied before this one
  -- Example: ["dep1", "dep2"]
  dependencies TEXT, -- JSON array
  
  -- Priority/sequence: Lower numbers are applied first
  priority INTEGER DEFAULT 100,
  
  -- Whether this patch requires parameters
  requires_parameters INTEGER DEFAULT 0, -- 0 = false, 1 = true
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_extrapatches_code ON extrapatches(patch_code);
CREATE INDEX IF NOT EXISTS idx_extrapatches_type ON extrapatches(patch_type);
CREATE INDEX IF NOT EXISTS idx_extrapatches_priority ON extrapatches(priority);

-- Trigger to update updated_at timestamp
CREATE TRIGGER IF NOT EXISTS trg_extrapatches_updated 
  AFTER UPDATE ON extrapatches
  FOR EACH ROW
BEGIN
  UPDATE extrapatches SET updated_at = CURRENT_TIMESTAMP WHERE epuuid = NEW.epuuid;
END;

