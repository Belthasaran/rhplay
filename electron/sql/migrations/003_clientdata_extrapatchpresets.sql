-- Migration: 003_clientdata_extrapatchpresets
-- Description: Create extrapatchpresets table for storing user-defined and system presets
-- Date: 2025-01-XX

CREATE TABLE IF NOT EXISTS extrapatchpresets (
  preset_uuid TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  preset_name TEXT NOT NULL,
  is_system INTEGER DEFAULT 0, -- 0 = user preset, 1 = system preset (read-only)
  
  -- Selected patches: JSON array of epuuid values
  selected_patches TEXT NOT NULL, -- JSON array
  
  -- Global on/off switches: JSON array of bit indices (0-7)
  global_onoffv TEXT, -- JSON array of integers (0-7)
  
  -- Patch-specific variables: JSON object mapping epuuid to parameter values
  -- Example: {"epuuid1": {"local1": "FF", "local5": [0,1,2]}, "epuuid2": {"local2": "AA"}}
  patch_variables TEXT, -- JSON object
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_extrapatchpresets_is_system ON extrapatchpresets(is_system);
CREATE INDEX IF NOT EXISTS idx_extrapatchpresets_name ON extrapatchpresets(preset_name);

-- Trigger to update updated_at timestamp
CREATE TRIGGER IF NOT EXISTS trg_extrapatchpresets_updated 
  AFTER UPDATE ON extrapatchpresets
  FOR EACH ROW
BEGIN
  UPDATE extrapatchpresets SET updated_at = CURRENT_TIMESTAMP WHERE preset_uuid = NEW.preset_uuid;
END;

