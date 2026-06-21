-- resource: multi-owner RHPAK tracking on res_attachments

ALTER TABLE res_attachments ADD COLUMN rhpakuuid2 TEXT;

UPDATE res_attachments
SET rhpakuuid2 = json_array(rhpakuuid)
WHERE rhpakuuid IS NOT NULL
  AND (rhpakuuid2 IS NULL OR trim(rhpakuuid2) = '');
