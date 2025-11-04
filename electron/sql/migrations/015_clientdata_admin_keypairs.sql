-- =============================================================================
-- Admin Keypairs Table
-- Purpose: Store admin keypairs with public keys (public) and encrypted secret keys (private)
-- Added: January 2025
-- =============================================================================

CREATE TABLE IF NOT EXISTS admin_keypairs (
    keypair_uuid VARCHAR(255) PRIMARY KEY,
    keypair_type VARCHAR(50) NOT NULL, -- ML-DSA-44, ML-DSA-87, ED25519, RSA-2048
    key_usage VARCHAR(50), -- master-admin-signing, operating-admin-signing, authorized-admin
    storage_status VARCHAR(20) DEFAULT 'public-only', -- public-only, full, full-offline
    public_key TEXT NOT NULL, -- Public key (PEM format or hex)
    public_key_hex TEXT, -- Public key in hex format
    fingerprint TEXT, -- SHA256 fingerprint of public key
    encrypted_private_key TEXT, -- Encrypted private key (encrypted with Profile Guard key)
    private_key_format VARCHAR(20), -- hex or pem
    trust_level VARCHAR(50), -- Standard, High, etc.
    local_name TEXT, -- Local name: username_type_digits
    canonical_name TEXT, -- Canonical remote name: type_fingerprint or type_publickey
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_admin_keypairs_type ON admin_keypairs(keypair_type);
CREATE INDEX idx_admin_keypairs_usage ON admin_keypairs(key_usage);
CREATE INDEX idx_admin_keypairs_storage_status ON admin_keypairs(storage_status);
CREATE INDEX idx_admin_keypairs_fingerprint ON admin_keypairs(fingerprint);

CREATE TRIGGER trigger_admin_keypairs_updated 
AFTER UPDATE ON admin_keypairs
BEGIN
    UPDATE admin_keypairs 
    SET updated_at = CURRENT_TIMESTAMP 
    WHERE keypair_uuid = NEW.keypair_uuid;
END;

