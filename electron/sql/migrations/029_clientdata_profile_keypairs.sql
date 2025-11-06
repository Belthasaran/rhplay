-- =============================================================================
-- Profile Keypairs Table
-- Purpose: Store keypairs for user profiles (mirrors admin_keypairs structure)
-- Added: January 2025
-- =============================================================================

CREATE TABLE IF NOT EXISTS profile_keypairs (
    keypair_uuid VARCHAR(255) PRIMARY KEY,
    profile_uuid VARCHAR(255) NOT NULL, -- Foreign key to user_profiles
    keypair_type VARCHAR(50) NOT NULL, -- ML-DSA-44, ML-DSA-87, ED25519, RSA-2048, Nostr
    key_usage VARCHAR(50), -- primary, additional, admin
    storage_status VARCHAR(20) DEFAULT 'public-only', -- public-only, full, full-offline
    public_key TEXT NOT NULL, -- Public key (PEM format or hex)
    public_key_hex TEXT, -- Public key in hex format
    fingerprint TEXT, -- SHA256 fingerprint of public key
    encrypted_private_key TEXT, -- Encrypted private key (encrypted with Profile Guard key)
    private_key_format VARCHAR(20), -- hex or pem
    trust_level VARCHAR(50), -- Standard, High, etc.
    local_name TEXT, -- Local name: username_type_digits
    canonical_name TEXT, -- Canonical remote name: type_fingerprint or type_publickey
    name TEXT, -- User-friendly name
    label TEXT, -- User-friendly label
    comments TEXT, -- User comments
    nostr_event_id VARCHAR(64), -- Nostr event ID if published
    nostr_status VARCHAR(20), -- draft, published, archived
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (profile_uuid) REFERENCES user_profiles(profile_uuid) ON DELETE CASCADE
);

CREATE INDEX idx_profile_keypairs_profile ON profile_keypairs(profile_uuid);
CREATE INDEX idx_profile_keypairs_type ON profile_keypairs(keypair_type);
CREATE INDEX idx_profile_keypairs_usage ON profile_keypairs(key_usage);
CREATE INDEX idx_profile_keypairs_storage_status ON profile_keypairs(storage_status);
CREATE INDEX idx_profile_keypairs_fingerprint ON profile_keypairs(fingerprint);
CREATE INDEX idx_profile_keypairs_nostr_status ON profile_keypairs(nostr_status);

CREATE TRIGGER trigger_profile_keypairs_updated 
AFTER UPDATE ON profile_keypairs
BEGIN
    UPDATE profile_keypairs 
    SET updated_at = CURRENT_TIMESTAMP 
    WHERE keypair_uuid = NEW.keypair_uuid;
END;

