/**
 * AdminDeclaration Class
 * 
 * Manages admin declarations and provides methods for JSON export in various formats:
 * 1. Content JSON only
 * 2. Signed data (content + fields to be signed, before signing)
 * 3. Signed data with signature (for countersigning)
 * 4. Complete export (all non-signed fields for import/export)
 * 
 * Usage:
 *   const declaration = await AdminDeclaration.loadFromDatabase(declarationUuid);
 *   const contentJson = declaration.getContentJson();
 *   const signedData = declaration.getSignedData();
 */

class AdminDeclaration {
  /**
   * Constructor - creates instance from database record
   * @param {Object} dbRecord - Database record from admindeclarations table
   */
  constructor(dbRecord) {
    if (!dbRecord) {
      throw new Error('Database record is required');
    }
    
    // Store the raw database record
    this._dbRecord = dbRecord;
    
    // Parse content_json if it's a string
    this._contentJson = typeof dbRecord.content_json === 'string' 
      ? JSON.parse(dbRecord.content_json) 
      : dbRecord.content_json;
  }
  
  /**
   * Load a declaration from the database
   * @param {string} declarationUuid - UUID of the declaration
   * @param {Function} getDeclarationFn - Function to get declaration (for Electron IPC or direct DB access)
   * @returns {Promise<AdminDeclaration>}
   */
  static async loadFromDatabase(declarationUuid, getDeclarationFn = null) {
    if (!declarationUuid) {
      throw new Error('Declaration UUID is required');
    }
    
    // If getDeclarationFn is provided, use it (for Electron IPC)
    if (getDeclarationFn) {
      const result = await getDeclarationFn(declarationUuid);
      if (!result.success) {
        throw new Error(result.error || 'Failed to load declaration');
      }
      return new AdminDeclaration(result.declaration);
    }
    
    // For direct database access (e.g., in main process)
    // This would require database manager to be passed in
    throw new Error('getDeclarationFn is required for loading from database');
  }
  
  /**
   * Get the database record
   * @returns {Object} Raw database record
   */
  getDbRecord() {
    return this._dbRecord;
  }
  
  /**
   * Format 1: Get content JSON only
   * Returns just the content_json field as a JSON object
   * @returns {Object} Content JSON object
   */
  getContentJson() {
    return this._contentJson;
  }
  
  /**
   * Format 2: Get signed data (content + fields to be signed)
   * This is the JSON text that the issuer will hash and sign.
   * Includes:
   * - declaration_uuid
   * - declaration_type
   * - content_hash_sha256 (SHA256 hash of content_json)
   * - signing_keypair_canonical_name
   * - signing_keypair_fingerprint (SHA256 hash of signing public key)
   * - target_keypair_uuid (if applicable)
   * - target_keypair_canonical_name (if applicable)
   * - target_keypair_fingerprint (if applicable)
   * - valid_from
   * - valid_until
   * - signing_timestamp (timestamp when signing occurs)
   * 
   * @param {string} signingTimestamp - ISO timestamp when signing occurs (defaults to now)
   * @param {Object} signingKeypair - Keypair object with canonical_name and fingerprint
   * @returns {Object} Signed data object
   */
  getSignedData(signingTimestamp = null, signingKeypair = null) {
    const record = this._dbRecord;
    const now = signingTimestamp || new Date().toISOString();
    
    // Get signing keypair info from parameter or database record
    // Note: canonical_name may not be in DB, may need to look up from keypair table
    const signingCanonicalName = signingKeypair?.canonical_name || record.signing_keypair_canonical_name || null;
    const signingFingerprint = signingKeypair?.fingerprint || record.signing_keypair_fingerprint || null;
    
    // Get target keypair info
    const targetKeypairUuid = record.target_keypair_uuid || null;
    const targetKeypairCanonicalName = record.target_keypair_canonical_name || null;
    const targetKeypairFingerprint = record.target_keypair_fingerprint || null;
    
    return {
      declaration_uuid: record.declaration_uuid,
      declaration_type: record.declaration_type,
      content_hash_sha256: record.content_hash_sha256,
      signing_keypair_canonical_name: signingCanonicalName,
      signing_keypair_fingerprint: signingFingerprint,
      target_keypair_uuid: targetKeypairUuid,
      target_keypair_canonical_name: targetKeypairCanonicalName,
      target_keypair_fingerprint: targetKeypairFingerprint,
      valid_from: record.valid_from || null,
      valid_until: record.valid_until || null,
      signing_timestamp: now
    };
  }
  
  /**
   * Format 3: Get signed data with signature
   * This is Format 2 + the issuer's signature information.
   * This is what countersigners will sign (they sign the hash of this JSON).
   * This value is saved to signed_data and hashed to signed_data_sha256 in the database.
   * 
   * @param {string} signingTimestamp - ISO timestamp when signing occurs (defaults to now)
   * @param {Object} signingKeypair - Keypair object with canonical_name and fingerprint
   * @returns {Object} Signed data with signature object
   */
  getSignedDataWithSignature(signingTimestamp = null, signingKeypair = null) {
    const signedData = this.getSignedData(signingTimestamp, signingKeypair);
    const record = this._dbRecord;
    
    // Add signature information (if already signed)
    if (record.digital_signature) {
      signedData.signature = {
        canonical_name: signedData.signing_keypair_canonical_name,
        fingerprint: signedData.signing_keypair_fingerprint,
        signature_hash_algorithm: 'SHA-256',
        signature_hash_value: record.content_hash_sha256, // Hash of Format 2 (what was signed)
        digital_signature: record.digital_signature,
        signed_at: record.signing_timestamp || signedData.signing_timestamp
      };
    }
    
    return signedData;
  }
  
  /**
   * Format 4: Get complete export (all non-signed fields)
   * Used by utilities to extract from or import to the declarations database.
   * Contains all fields except the signature-related fields.
   * 
   * @returns {Object} Complete export object
   */
  getCompleteExport() {
    const record = this._dbRecord;
    
    return {
      declaration_uuid: record.declaration_uuid,
      declaration_type: record.declaration_type,
      content_json: record.content_json,
      content_hash_sha256: record.content_hash_sha256,
      status: record.status || 'Draft',
      schema_version: record.schema_version || '1.0',
      content_version: record.content_version || 1,
      signing_keypair_uuid: record.signing_keypair_uuid || null,
      signing_keypair_canonical_name: record.signing_keypair_canonical_name || null,
      signing_keypair_fingerprint: record.signing_keypair_fingerprint || null,
      target_keypair_uuid: record.target_keypair_uuid || null,
      target_keypair_canonical_name: record.target_keypair_canonical_name || null,
      target_keypair_fingerprint: record.target_keypair_fingerprint || null,
      target_user_profile_id: record.target_user_profile_id || null,
      valid_from: record.valid_from || null,
      valid_until: record.valid_until || null,
      required_countersignatures: record.required_countersignatures || 0,
      current_countersignatures: record.current_countersignatures || 0,
      countersignatures_json: record.countersignatures_json || null,
      original_declaration_uuid: record.original_declaration_uuid || null,
      is_update: record.is_update || false,
      update_chain_uuid: record.update_chain_uuid || null,
      update_history_json: record.update_history_json || null,
      is_revoked: record.is_revoked || false,
      revoked_at: record.revoked_at || null,
      revoked_by_declaration_uuid: record.revoked_by_declaration_uuid || null,
      retroactive_effect_enabled: record.retroactive_effect_enabled || false,
      retroactive_effective_from: record.retroactive_effective_from || null,
      nostr_event_id: record.nostr_event_id || null,
      nostr_published_at: record.nostr_published_at || null,
      nostr_published_to_relays: record.nostr_published_to_relays || null,
      nostr_publish_status: record.nostr_publish_status || 'pending',
      nostr_kind: record.nostr_kind || 31106,
      nostr_tags: record.nostr_tags || null,
      discovered_from_relay: record.discovered_from_relay || null,
      discovered_at: record.discovered_at || null,
      is_local: record.is_local !== undefined ? record.is_local : true,
      verification_status: record.verification_status || 'pending',
      created_at: record.created_at || null,
      updated_at: record.updated_at || null
      // Note: Excludes digital_signature, signed_data, signed_data_sha256, signing_timestamp
      // as these are signature-related and should not be exported/imported
    };
  }
  
  /**
   * Get signed data as JSON string (for hashing)
   * @param {string} signingTimestamp - ISO timestamp when signing occurs
   * @param {Object} signingKeypair - Keypair object with canonical_name and fingerprint
   * @returns {string} JSON string of signed data
   */
  getSignedDataJsonString(signingTimestamp = null, signingKeypair = null) {
    return JSON.stringify(this.getSignedData(signingTimestamp, signingKeypair), null, 0);
  }
  
  /**
   * Get signed data with signature as JSON string (for countersigning)
   * @param {string} signingTimestamp - ISO timestamp when signing occurs
   * @param {Object} signingKeypair - Keypair object with canonical_name and fingerprint
   * @returns {string} JSON string of signed data with signature
   */
  getSignedDataWithSignatureJsonString(signingTimestamp = null, signingKeypair = null) {
    return JSON.stringify(this.getSignedDataWithSignature(signingTimestamp, signingKeypair), null, 0);
  }
  
  /**
   * Get content JSON as string
   * @returns {string} JSON string of content
   */
  getContentJsonString() {
    return JSON.stringify(this._contentJson, null, 2);
  }
  
  /**
   * Get complete export as JSON string
   * @returns {string} JSON string of complete export
   */
  getCompleteExportJsonString() {
    return JSON.stringify(this.getCompleteExport(), null, 2);
  }
  
  /**
   * Sign the declaration with a keypair
   * This method creates the signed data, hashes it, and signs the hash.
   * 
   * @param {Object} signingKeypair - Keypair object with:
   *   - canonical_name: Canonical name of the keypair
   *   - fingerprint: SHA256 hash of the public key
   *   - privateKey: Private key in hex or PEM format
   *   - type: Keypair type (ED25519, RSA-2048, ML-DSA-44, Nostr, etc.)
   * @param {string} signingTimestamp - ISO timestamp when signing occurs (defaults to now)
   * @returns {Object} Signed declaration data with:
   *   - signed_data: The JSON string of signed data (Format 3)
   *   - signed_data_sha256: SHA256 hash of signed_data (what countersigners will sign)
   *   - digital_signature: The actual signature
   *   - signing_timestamp: When signing occurred
   */
  static async signDeclaration(declarationRecord, signingKeypair, signingTimestamp = null) {
    const crypto = require('crypto');
    
    const declaration = new AdminDeclaration(declarationRecord);
    const now = signingTimestamp || new Date().toISOString();
    
    // Get signed data (Format 2)
    const signedData = declaration.getSignedData(now, signingKeypair);
    
    // Get signed data (Format 2) - this is what gets hashed and signed
    const signedDataJson = declaration.getSignedDataJsonString(now, signingKeypair);
    
    // Check if this is a Nostr key - Nostr keys require special handling
    const isNostrKey = (signingKeypair.type === 'Nostr' || 
                        signingKeypair.type?.toLowerCase().includes('nostr') ||
                        signingKeypair.algorithm === 'Nostr' ||
                        signingKeypair.algorithm?.toLowerCase().includes('nostr'));
    
    // Hash the signed data JSON (Format 2)
    const signedDataHash = crypto.createHash('sha256')
      .update(signedDataJson)
      .digest('hex');
    
    // Handle Nostr keys separately - they require creating a proper Nostr event
    if (isNostrKey) {
      // Nostr signing requires creating a proper Nostr event and using finalizeEvent()
      const { finalizeEvent } = require('nostr-tools');
      
      // Convert private key from hex to Uint8Array
      const privateKeyBytes = new Uint8Array(Buffer.from(signingKeypair.privateKey, 'hex'));
      
      // Create Nostr event template for the declaration
      // Kind 31106 is for admin declarations (as defined in the schema plan)
      const eventTemplate = {
        kind: 31106, // Admin declarations event kind
        created_at: Math.floor(Date.now() / 1000), // Unix timestamp
        tags: [
          ['d', declarationRecord.declaration_uuid], // Declaration UUID tag
          ['t', declarationRecord.declaration_type || 'trust-declaration'], // Declaration type tag
        ],
        content: signedDataJson // Use Format 2 signed data as content
      };
      
      // Finalize the event (signs it)
      const signedEvent = finalizeEvent(eventTemplate, privateKeyBytes);
      
      // Extract signature and event ID from the signed event
      const signature = signedEvent.sig;
      
      // Extract all Nostr event fields for database storage
      const nostrPublicKey = signedEvent.pubkey; // Public key as hex string
      const nostrCreatedAt = signedEvent.created_at; // Unix timestamp as number
      const nostrKind = signedEvent.kind; // Event kind as number
      const nostrTags = JSON.stringify(signedEvent.tags); // Tags as JSON string (array of arrays)
      const nostrContent = signedEvent.content; // Content as string
      
      // Create Format 3 with signature for countersigners
      const signedDataWithSignature = {
        ...signedData,
        signature: {
          canonical_name: signingKeypair.canonical_name,
          fingerprint: signingKeypair.fingerprint,
          signature_hash_algorithm: 'SHA-256',
          signature_hash_value: signedDataHash, // Hash of Format 2 (what was signed)
          digital_signature: signature,
          signed_at: now
        },
        nostr_event_id: signedEvent.id,
        nostr_event: signedEvent // Include full Nostr event
      };
      const signedDataJsonWithSignature = JSON.stringify(signedDataWithSignature, null, 0);
      
      // Hash the signed data with signature (Format 3) - this is what countersigners will sign
      const signedDataWithSignatureHash = crypto.createHash('sha256')
        .update(signedDataJsonWithSignature)
        .digest('hex');
      
      // Return the full Nostr event for storage with all serialization fields
      return {
        signed_data: signedDataJsonWithSignature, // Format 3 with signature and Nostr event
        signed_data_sha256: signedDataWithSignatureHash, // Hash of Format 3 (for countersigners)
        digital_signature: signature, // Nostr event signature
        nostr_event_id: signedEvent.id, // Nostr event ID
        nostr_event: JSON.stringify(signedEvent), // Full signed Nostr event
        nostr_public_key: nostrPublicKey, // Public key as hex string
        nostr_created_at: nostrCreatedAt, // Unix timestamp as number
        nostr_kind: nostrKind, // Event kind as number
        nostr_tags: nostrTags, // Tags as JSON string (array of arrays)
        nostr_content: nostrContent, // Content as string
        signing_timestamp: now,
        signing_keypair_canonical_name: signingKeypair.canonical_name,
        signing_keypair_fingerprint: signingKeypair.fingerprint
      };
    }
    
    // For non-Nostr keys, use standard signing approach
    // Sign the hash based on keypair type
    let signature = null;
    const keyType = signingKeypair.type || signingKeypair.algorithm || 'ED25519';
    
    try {
      if (keyType === 'ED25519' || keyType.toLowerCase().includes('ed25519')) {
        // ED25519 signing
        const privateKey = signingKeypair.privateKey.startsWith('-----')
          ? crypto.createPrivateKey({ key: signingKeypair.privateKey, format: 'pem' })
          : crypto.createPrivateKey({ key: Buffer.from(signingKeypair.privateKey, 'hex'), format: 'der', type: 'pkcs8' });
        
        const hashBuffer = Buffer.from(signedDataHash, 'hex');
        signature = crypto.sign(null, hashBuffer, privateKey);
        signature = signature.toString('hex');
      } else if (keyType.includes('RSA')) {
        // RSA signing
        const privateKey = signingKeypair.privateKey.startsWith('-----')
          ? crypto.createPrivateKey({ key: signingKeypair.privateKey, format: 'pem' })
          : crypto.createPrivateKey({ key: Buffer.from(signingKeypair.privateKey, 'hex'), format: 'der', type: 'pkcs8' });
        
        const hashBuffer = Buffer.from(signedDataHash, 'hex');
        signature = crypto.sign('sha256', hashBuffer, {
          key: privateKey,
          padding: crypto.constants.RSA_PKCS1_PSS_PADDING
        });
        signature = signature.toString('hex');
      } else if (keyType.includes('ML-DSA')) {
        // ML-DSA signing (post-quantum)
        // Note: ML-DSA implementation may vary, this is a placeholder
        throw new Error('ML-DSA signing not yet implemented');
      } else {
        throw new Error(`Unsupported keypair type for signing: ${keyType}`);
      }
    } catch (error) {
      throw new Error(`Failed to sign declaration: ${error.message}`);
    }
    
    // Now create Format 3 (signed data with signature) after signing
    // Note: For Nostr keys, this was already returned above
    const signedDataWithSignature = {
      ...signedData,
      signature: {
        canonical_name: signingKeypair.canonical_name,
        fingerprint: signingKeypair.fingerprint,
        signature_hash_algorithm: 'SHA-256',
        signature_hash_value: signedDataHash, // Hash of Format 2 (what was signed)
        digital_signature: signature,
        signed_at: now
      }
    };
    const signedDataJsonWithSignature = JSON.stringify(signedDataWithSignature, null, 0);
    
    // Hash the signed data with signature (Format 3) - this is what countersigners will sign
    const signedDataWithSignatureHash = crypto.createHash('sha256')
      .update(signedDataJsonWithSignature)
      .digest('hex');
    
    return {
      signed_data: signedDataJsonWithSignature, // Format 3 with signature
      signed_data_sha256: signedDataWithSignatureHash, // Hash of Format 3 (for countersigners)
      digital_signature: signature, // Signature of Format 2 hash
      signing_timestamp: now,
      signing_keypair_canonical_name: signingKeypair.canonical_name,
      signing_keypair_fingerprint: signingKeypair.fingerprint
    };
  }
}

// Export for CommonJS (Node.js)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = AdminDeclaration;
}

// Export for ES modules
if (typeof window !== 'undefined') {
  window.AdminDeclaration = AdminDeclaration;
}

