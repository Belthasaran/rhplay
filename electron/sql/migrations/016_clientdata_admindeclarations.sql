-- =============================================================================
-- Admin Declarations Table
-- Purpose: Store admin declarations (trust declarations, privilege grants/revocations)
-- Added: January 2025
-- =============================================================================

CREATE TABLE IF NOT EXISTS admindeclarations (
    declaration_uuid VARCHAR(255) PRIMARY KEY,
    declaration_type VARCHAR(50) NOT NULL, -- trust-declaration, privilege-grant, privilege-revoke
    content_json TEXT NOT NULL, -- JSON content of the declaration
    content_hash_sha256 VARCHAR(64) NOT NULL, -- SHA256 hash of the declaration content
    digital_signature TEXT NOT NULL, -- Digital signature of the hash
    signing_keypair_uuid VARCHAR(255), -- UUID of the keypair that signed this declaration
    signing_keypair_fingerprint TEXT, -- Fingerprint of the signing keypair
    target_keypair_uuid VARCHAR(255), -- UUID of target keypair (for trust declarations)
    target_keypair_fingerprint TEXT, -- Fingerprint of target keypair (for trust declarations)
    target_user_profile_id VARCHAR(255), -- Profile ID of target user (for privilege grants/revocations)
    valid_from TIMESTAMP, -- Declaration validity start date
    valid_until TIMESTAMP, -- Declaration validity end date
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_admindeclarations_type ON admindeclarations(declaration_type);
CREATE INDEX idx_admindeclarations_hash ON admindeclarations(content_hash_sha256);
CREATE INDEX idx_admindeclarations_signing_keypair ON admindeclarations(signing_keypair_uuid);
CREATE INDEX idx_admindeclarations_target_keypair ON admindeclarations(target_keypair_uuid);
CREATE INDEX idx_admindeclarations_target_user ON admindeclarations(target_user_profile_id);
CREATE INDEX idx_admindeclarations_validity ON admindeclarations(valid_from, valid_until);

CREATE TRIGGER trigger_admindeclarations_updated 
AFTER UPDATE ON admindeclarations
BEGIN
    UPDATE admindeclarations 
    SET updated_at = CURRENT_TIMESTAMP 
    WHERE declaration_uuid = NEW.declaration_uuid;
END;

