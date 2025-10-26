-- IPFS Gateways Table
-- Stores IPFS gateway URLs for Mode 2 IPFS searches

CREATE TABLE IF NOT EXISTS ipfsgateways (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url VARCHAR(255) NOT NULL UNIQUE,
  priority INTEGER DEFAULT 100,
  notworking_timestamp TIMESTAMP,
  error TEXT,
  last_successful TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  notes TEXT
);

-- Insert default IPFS gateways
INSERT OR IGNORE INTO ipfsgateways (url, priority, notes) VALUES
  ('https://ipfs.io/ipfs/%CID%', 10, 'Official IPFS gateway'),
  ('https://gateway.pinata.cloud/ipfs/%CID%', 20, 'Pinata gateway'),
  ('https://cloudflare-ipfs.com/ipfs/%CID%', 30, 'Cloudflare gateway'),
  ('https://dweb.link/ipfs/%CID%', 40, 'Protocol Labs gateway');

-- Index for faster queries
CREATE INDEX IF NOT EXISTS idx_ipfsgateways_priority ON ipfsgateways(priority);
CREATE INDEX IF NOT EXISTS idx_ipfsgateways_notworking ON ipfsgateways(notworking_timestamp);

