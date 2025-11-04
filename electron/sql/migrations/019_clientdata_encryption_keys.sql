-- =============================================================================
-- Encryption Keys Table
-- Purpose: Store symmetric encryption keys (AES256/AES128) for various use cases
-- Added: January 2025
-- =============================================================================

CREATE TABLE IF NOT EXISTS encryption_keys (
    key_uuid VARCHAR(255) PRIMARY KEY,
    name VARCHAR(255),
    label VARCHAR(255),
    algorithm VARCHAR(20) NOT NULL DEFAULT 'AES256', -- AES256 or AES128
    key_type VARCHAR(50) NOT NULL, -- Shared Preinstalled, Shared General, Shared Selective, Group, Individual
    encrypted INTEGER DEFAULT 0, -- 0 = No, 1 = Yes (encrypted with Profile Guard key)
    keyguard_hash TEXT, -- SHA256 hash of profile guard key (if encrypted = 1)
    hash_algorithm VARCHAR(20) DEFAULT 'SHA-256', -- Hash algorithm for hash_value
    hash_value TEXT, -- Hash of raw unencrypted key value (for protocol identification)
    keydata TEXT NOT NULL, -- The actual key (encrypted or unencrypted)
    selection_identifier TEXT, -- JSON text indicating where the key applies
    description TEXT, -- Optional text description
    start_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    end_date TIMESTAMP, -- Nullable validity end date
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_encryption_keys_type ON encryption_keys(key_type);
CREATE INDEX idx_encryption_keys_algorithm ON encryption_keys(algorithm);
CREATE INDEX idx_encryption_keys_encrypted ON encryption_keys(encrypted);
CREATE INDEX idx_encryption_keys_hash_value ON encryption_keys(hash_value);

CREATE TRIGGER trigger_encryption_keys_updated 
AFTER UPDATE ON encryption_keys
BEGIN
    UPDATE encryption_keys 
    SET updated_at = CURRENT_TIMESTAMP 
    WHERE key_uuid = NEW.key_uuid;
END;

