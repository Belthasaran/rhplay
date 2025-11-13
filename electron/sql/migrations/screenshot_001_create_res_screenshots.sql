CREATE TABLE IF NOT EXISTS res_screenshots (
  rsuuid TEXT PRIMARY KEY DEFAULT (uuid()),
  screenshot_type TEXT,
  kind TEXT,
  gameid TEXT,
  gvuuid TEXT,
  source_url TEXT,
  file_name TEXT,
  file_ext TEXT,
  file_size INTEGER,
  file_sha256 TEXT,
  encoded_sha256 TEXT,
  decoded_sha256 TEXT,
  encrypted_data BLOB,
  fernet_key TEXT,
  download_url TEXT,
  ipfs_cid_v1 TEXT,
  ipfs_cid_v0 TEXT,
  arweave_file_id TEXT,
  arweave_file_url TEXT,
  ardrive_file_name TEXT,
  ardrive_file_id TEXT,
  ardrive_file_path TEXT,
  storage_path TEXT,
  source_path TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_res_screenshots_sha_unique
  ON res_screenshots(file_sha256)
  WHERE file_sha256 IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_res_screenshots_url_unique
  ON res_screenshots(source_url)
  WHERE source_url IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_res_screenshots_gameid
  ON res_screenshots(gameid);

CREATE INDEX IF NOT EXISTS idx_res_screenshots_gvuuid
  ON res_screenshots(gvuuid);

CREATE TRIGGER IF NOT EXISTS trg_res_screenshots_updated
AFTER UPDATE ON res_screenshots
BEGIN
  UPDATE res_screenshots
  SET updated_at = CURRENT_TIMESTAMP
  WHERE rsuuid = NEW.rsuuid;
END;

