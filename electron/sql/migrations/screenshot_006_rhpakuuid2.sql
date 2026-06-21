-- screenshot: multi-owner RHPAK tracking on res_screenshots

ALTER TABLE res_screenshots ADD COLUMN rhpakuuid2 TEXT;

UPDATE res_screenshots
SET rhpakuuid2 = json_array(rhpakuuid)
WHERE rhpakuuid IS NOT NULL
  AND (rhpakuuid2 IS NULL OR trim(rhpakuuid2) = '');
