-- Migration 006: Add seed mappings table for deterministic random selection
-- Date: 2025-10-12
-- Purpose: Enable reproducible random game selection across different installations

CREATE TABLE IF NOT EXISTS seedmappings (
    mapid VARCHAR(20) PRIMARY KEY,  -- First characters of seed (e.g., "A7K9M")
    
    -- Mapping data: JSON object mapping gameid -> version for all candidates
    -- Example: {"11374": 1, "12345": 2, "54321": 3, ...}
    mappingdata TEXT NOT NULL,
    
    -- Metadata
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    game_count INTEGER NOT NULL,  -- Number of games in this mapping
    
    -- Description (optional)
    description TEXT,
    
    -- Hash of mappingdata for verification during import/export
    mapping_hash VARCHAR(64)
);

CREATE INDEX IF NOT EXISTS idx_seedmappings_count ON seedmappings(game_count DESC);
CREATE INDEX IF NOT EXISTS idx_seedmappings_created ON seedmappings(created_at DESC);

-- Create initial default mapping with all current candidate games
-- This will be populated by the application on first use

