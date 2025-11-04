-- =============================================================================
-- Trust Declarations Table
-- Purpose: Store trust declarations for public keys (preconfigured or learned from network)
-- Added: January 2025
-- =============================================================================

CREATE TABLE IF NOT EXISTS trust_declarations (
    declaration_uuid VARCHAR(255) PRIMARY KEY,
    issuing_canonical_name VARCHAR(255) NOT NULL,
    issuing_fingerprint VARCHAR(255) NOT NULL,
    issued_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    subject_canonical_name VARCHAR(255) NOT NULL,
    subject_fingerprint VARCHAR(255) NOT NULL,
    valid_starting TIMESTAMP NOT NULL,
    valid_ending TIMESTAMP,
    subject_trust_level VARCHAR(255),
    subject_usagetypes TEXT, -- JSON text
    subject_scopes TEXT, -- JSON text
    scope_permissions TEXT, -- JSON text
    signature_hash_algorithm VARCHAR(255),
    signature_hash_value VARCHAR(255),
    signature TEXT, -- JSON text
    countersignatures TEXT, -- JSON text (array of signatures)
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_trust_declarations_issuing_fingerprint ON trust_declarations(issuing_fingerprint);
CREATE INDEX idx_trust_declarations_subject_fingerprint ON trust_declarations(subject_fingerprint);
CREATE INDEX idx_trust_declarations_issued_at ON trust_declarations(issued_at);
CREATE INDEX idx_trust_declarations_valid_starting ON trust_declarations(valid_starting);
CREATE INDEX idx_trust_declarations_valid_ending ON trust_declarations(valid_ending);

CREATE TRIGGER trigger_trust_declarations_updated 
AFTER UPDATE ON trust_declarations
BEGIN
    UPDATE trust_declarations 
    SET updated_at = CURRENT_TIMESTAMP 
    WHERE declaration_uuid = NEW.declaration_uuid;
END;

