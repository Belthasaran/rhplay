-- Migration 072: Distinguish system (SMWC/updategames) RHPAKs from user-installed packages

ALTER TABLE rhpaks ADD COLUMN is_system INTEGER NOT NULL DEFAULT 0;

UPDATE rhpaks SET is_system = 0 WHERE is_system IS NULL;
