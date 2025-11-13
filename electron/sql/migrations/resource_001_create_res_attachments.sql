CREATE TABLE IF NOT EXISTS res_attachments (
  rauuid TEXT PRIMARY KEY DEFAULT (uuid()),
  resource_scope TEXT,
  linked_type TEXT,
  linked_uuid TEXT,
  gameid TEXT,
  gvuuid TEXT,
  description TEXT,
  file_name TEXT NOT NULL,
  file_ext TEXT,
  file_size INTEGER,
  file_sha224 TEXT,
  file_sha256 TEXT,
  file_sha1 TEXT,
  file_md5 TEXT,
  file_crc16 TEXT,
  file_crc32 TEXT,
  encoded_sha256 TEXT,
  decoded_sha256 TEXT,
  encrypted_data BLOB NOT NULL,
  fernet_key TEXT NOT NULL,
  download_url TEXT,
  ipfs_cid_v1 TEXT,
  ipfs_cid_v0 TEXT,
  arweave_file_id TEXT,
  arweave_file_url TEXT,
  ardrive_file_name TEXT,
  ardrive_file_id TEXT,
  ardrive_file_path TEXT,
  storage_path TEXT,
  blob_storage_path TEXT,
  source_path TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_res_attachments_sha_unique
  ON res_attachments(file_sha256)
  WHERE file_sha256 IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_res_attachments_gameid
  ON res_attachments(gameid);

CREATE INDEX IF NOT EXISTS idx_res_attachments_gvuuid
  ON res_attachments(gvuuid);

CREATE TRIGGER IF NOT EXISTS trg_res_attachments_updated
AFTER UPDATE ON res_attachments
BEGIN
  UPDATE res_attachments
  SET updated_at = CURRENT_TIMESTAMP
  WHERE rauuid = NEW.rauuid;
END;

