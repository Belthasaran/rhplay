-- Migration: 053_rhdata_fix_change_detection_config
-- Description: Fix change detection config to ignore local processing fields
-- Date: 2025-01-XX
-- 
-- Local processing fields (pat_sha224, patchblob1_name, etc.) are computed/stored locally
-- and should not be compared against SMWC data. They should be marked as 'ignored'.
-- 
-- Also, URL additions (when we didn't have a URL before) should not require downloads.

-- Mark local processing fields as ignored
UPDATE change_detection_config 
SET classification = 'ignored', 
    weight = 0,
    notes = 'Local processing field - not from SMWC',
    updated_at = CURRENT_TIMESTAMP
WHERE field_name IN (
  'pat_sha224',
  'pat_sha1',
  'pat_shake_128',
  'patch',
  'patchblob1_name',
  'patchblob1_key',
  'patchblob1_sha224',
  'result_sha1',
  'result_sha224',
  'result_shake1'
)
AND classification != 'ignored';

-- Insert ignored entries if they don't exist
INSERT OR IGNORE INTO change_detection_config (field_name, classification, weight, notes) VALUES
  ('pat_sha224', 'ignored', 0, 'Local processing field - not from SMWC'),
  ('pat_sha1', 'ignored', 0, 'Local processing field - not from SMWC'),
  ('pat_shake_128', 'ignored', 0, 'Local processing field - not from SMWC'),
  ('patch', 'ignored', 0, 'Local processing field - not from SMWC'),
  ('patchblob1_name', 'ignored', 0, 'Local processing field - not from SMWC'),
  ('patchblob1_key', 'ignored', 0, 'Local processing field - not from SMWC'),
  ('patchblob1_sha224', 'ignored', 0, 'Local processing field - not from SMWC'),
  ('result_sha1', 'ignored', 0, 'Local processing field - not from SMWC'),
  ('result_sha224', 'ignored', 0, 'Local processing field - not from SMWC'),
  ('result_shake1', 'ignored', 0, 'Local processing field - not from SMWC');

-- Mark SMWC metadata fields that don't come from SMWC API as ignored
INSERT OR IGNORE INTO change_detection_config (field_name, classification, weight, notes) VALUES
  ('author_href', 'ignored', 0, 'SMWC metadata field - not in API response'),
  ('comments_href', 'ignored', 0, 'SMWC metadata field - not in API response'),
  ('description_href', 'ignored', 0, 'SMWC metadata field - not in API response'),
  ('tags_href', 'ignored', 0, 'SMWC metadata field - not in API response'),
  ('url', 'ignored', 0, 'SMWC metadata field - use download_url instead');
--  ('section', 'ignored', 0, 'SMWC metadata field - not in API response'),
--  ('fields', 'ignored', 0, 'SMWC metadata field - not in API response');
 -- ('raw_fields', 'ignored', 0, 'SMWC metadata field - not in API response');

INSERT OR IGNORE INTO change_detection_config (field_name, classification, weight, notes) VALUES
  ('section', 'minor', 1, 'SMWC metadata field'),
  ('fields', 'minor', 1, 'SMWC metadata field'),
  ('raw_fields', 'minor', 1, 'SMWC metadata field');



-- Update download_url to be more lenient about URL additions
-- URL additions (when old URL was null/empty) should be minor, not major
-- This will be handled in code, but we can note it here
UPDATE change_detection_config 
SET notes = 'Download URL (path/filename only). URL additions are minor changes.',
    updated_at = CURRENT_TIMESTAMP
WHERE field_name = 'download_url';

