-- patchbin: multi-owner RHPAK tracking on attachments

ALTER TABLE attachments ADD COLUMN rhpakuuid2 TEXT;

UPDATE attachments
SET rhpakuuid2 = json_array(rhpakuuid)
WHERE rhpakuuid IS NOT NULL
  AND (rhpakuuid2 IS NULL OR trim(rhpakuuid2) = '');
