-- Migration 071: Multi-owner RHPAK tracking (rhpakuuid2) on rhdata tables
-- rhpakuuid2 stores a JSON array of RHPAK UUIDs; first element matches rhpakuuid (primary owner).

ALTER TABLE gameversions ADD COLUMN rhpakuuid2 TEXT;
ALTER TABLE gameversion_stats ADD COLUMN rhpakuuid2 TEXT;
ALTER TABLE patchblobs ADD COLUMN rhpakuuid2 TEXT;
ALTER TABLE patchblobs_extended ADD COLUMN rhpakuuid2 TEXT;
ALTER TABLE rhpatches ADD COLUMN rhpakuuid2 TEXT;
ALTER TABLE gamestages ADD COLUMN rhpakuuid2 TEXT;

UPDATE gameversions
SET rhpakuuid2 = json_array(rhpakuuid)
WHERE rhpakuuid IS NOT NULL
  AND (rhpakuuid2 IS NULL OR trim(rhpakuuid2) = '');

UPDATE gameversion_stats
SET rhpakuuid2 = json_array(rhpakuuid)
WHERE rhpakuuid IS NOT NULL
  AND (rhpakuuid2 IS NULL OR trim(rhpakuuid2) = '');

UPDATE patchblobs
SET rhpakuuid2 = json_array(rhpakuuid)
WHERE rhpakuuid IS NOT NULL
  AND (rhpakuuid2 IS NULL OR trim(rhpakuuid2) = '');

UPDATE patchblobs_extended
SET rhpakuuid2 = json_array(rhpakuuid)
WHERE rhpakuuid IS NOT NULL
  AND (rhpakuuid2 IS NULL OR trim(rhpakuuid2) = '');

UPDATE rhpatches
SET rhpakuuid2 = json_array(rhpakuuid)
WHERE rhpakuuid IS NOT NULL
  AND (rhpakuuid2 IS NULL OR trim(rhpakuuid2) = '');

UPDATE gamestages
SET rhpakuuid2 = json_array(rhpakuuid)
WHERE rhpakuuid IS NOT NULL
  AND (rhpakuuid2 IS NULL OR trim(rhpakuuid2) = '');
