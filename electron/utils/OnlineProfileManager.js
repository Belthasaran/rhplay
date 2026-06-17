/**
 * OnlineProfileManager Class
 * 
 * Manages user profiles and profile keypairs storage in the database.
 * Handles:
 * - Loading/saving profiles from/to database tables
 * - Managing profile_keypairs
 * - Handling Nostr publication
 * - Managing the current profile
 * - Tracking unpublished edits
 * - Syncing with csettings for backward compatibility
 * 
 * Usage:
 *   const manager = new OnlineProfileManager(dbManager, keyguardKey);
 *   const profile = await manager.getCurrentProfile();
 *   await manager.saveProfile(profileData);
 *   await manager.publishProfileToNostr(profileUuid);
 */

const crypto = require('crypto');

class OnlineProfileManager {
  /**
   * Constructor
   * @param {DatabaseManager} dbManager - Database manager instance
   * @param {Buffer|null} keyguardKey - Profile Guard key for encryption (null if not unlocked)
   */
  constructor(dbManager, keyguardKey = null) {
    this.dbManager = dbManager;
    this.keyguardKey = keyguardKey;
    this.db = null;
  }
  
  /**
   * Get database connection
   * @returns {Database} Database connection
   */
  getDb() {
    if (!this.db) {
      this.db = this.dbManager.getConnection('clientdata');
    }
    return this.db;
  }
  
  /**
   * Get current profile UUID from csettings
   * @returns {string|null} Current profile UUID or null
   */
  getCurrentProfileId() {
    const db = this.getDb();
    const row = db.prepare(`
      SELECT csetting_value FROM csettings WHERE csetting_name = ?
    `).get('online_current_profile_id');
    return row?.csetting_value || null;
  }
  
  /**
   * Set current profile UUID in csettings
   * @param {string} profileUuid - Profile UUID to set as current
   */
  setCurrentProfileId(profileUuid) {
    const db = this.getDb();
    const uuid = crypto.randomUUID();
    db.prepare(`
      INSERT INTO csettings (csettinguid, csetting_name, csetting_value)
      VALUES (?, ?, ?)
      ON CONFLICT(csetting_name) DO UPDATE SET csetting_value = excluded.csetting_value
    `).run(uuid, 'online_current_profile_id', profileUuid);
    
    // Also update is_current_profile flag in user_profiles table
    db.prepare(`
      UPDATE user_profiles SET is_current_profile = 0
    `).run();
    db.prepare(`
      UPDATE user_profiles SET is_current_profile = 1 WHERE profile_uuid = ?
    `).run(profileUuid);
  }
  
  /**
   * Load profile from database by UUID
   * @param {string} profileUuid - Profile UUID
   * @returns {Object|null} Profile object or null if not found
   */
  getProfile(profileUuid) {
    const db = this.getDb();
    const row = db.prepare(`
      SELECT * FROM user_profiles WHERE profile_uuid = ?
    `).get(profileUuid);
    
    if (!row) {
      return null;
    }
    
    // Parse profile JSON
    const profile = JSON.parse(row.profile_json);
    
    // CRITICAL: Ensure profile_json does not contain private/secret keys
    // Public keypair data (publicKey, publicKeyHex, canonicalName, fingerprint) is allowed
    // Private/secret keys (privateKey, encrypted private keys) must be removed if present
    
    // Remove private keys from keypairs if they exist (they shouldn't, but clean up just in case)
    if (profile.primaryKeypair) {
      delete profile.primaryKeypair.privateKey;
      delete profile.primaryKeypair.encrypted;
      delete profile.primaryKeypair.privateKeyRaw;
    }
    
    if (profile.additionalKeypairs) {
      profile.additionalKeypairs.forEach(kp => {
        delete kp.privateKey;
        delete kp.encrypted;
        delete kp.privateKeyRaw;
      });
    }
    
    if (profile.adminKeypairs) {
      profile.adminKeypairs.forEach(kp => {
        delete kp.privateKey;
        delete kp.encrypted;
        delete kp.privateKeyRaw;
      });
    }
    
    // Remove private Ethereum key if present (must not be in profile_json)
    delete profile.ethereum_privkey;
    delete profile.primaryKeyPair; // Alternative spelling (also clean private keys if present)
    
    // Add metadata
    profile._metadata = {
      profileUuid: row.profile_uuid,
      publicNostrVersion: row.public_nostr_version ? JSON.parse(row.public_nostr_version) : null,
      hasUnpublishedEdits: row.has_unpublished_edits === 1,
      isCurrentProfile: row.is_current_profile === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastPublishedAt: row.last_published_at
    };
    
    return profile;
  }
  
  /**
   * Get current profile
   * @returns {Object|null} Current profile or null if not found
   */
  getCurrentProfile() {
    const profileUuid = this.getCurrentProfileId();
    if (!profileUuid) {
      return null;
    }
    return this.getProfile(profileUuid);
  }
  
  /**
   * List all profiles
   * @returns {Array} Array of profile objects with metadata
   */
  listProfiles() {
    const db = this.getDb();
    const rows = db.prepare(`
      SELECT * FROM user_profiles ORDER BY created_at DESC
    `).all();
    
    return rows.map(row => {
      const profile = JSON.parse(row.profile_json);
      
      // CRITICAL: Ensure profile_json does not contain private/secret keys
      // Public keypair data (publicKey, publicKeyHex, canonicalName, fingerprint) is allowed
      // Private/secret keys (privateKey, encrypted private keys) must be removed if present
      
      // Remove private keys from keypairs if they exist (they shouldn't, but clean up just in case)
      if (profile.primaryKeypair) {
        delete profile.primaryKeypair.privateKey;
        delete profile.primaryKeypair.encrypted;
        delete profile.primaryKeypair.privateKeyRaw;
      }
      
      if (profile.additionalKeypairs) {
        profile.additionalKeypairs.forEach(kp => {
          delete kp.privateKey;
          delete kp.encrypted;
          delete kp.privateKeyRaw;
        });
      }
      
      if (profile.adminKeypairs) {
        profile.adminKeypairs.forEach(kp => {
          delete kp.privateKey;
          delete kp.encrypted;
          delete kp.privateKeyRaw;
        });
      }
      
      // Remove private Ethereum key if present (must not be in profile_json)
      delete profile.ethereum_privkey;
      delete profile.primaryKeyPair; // Alternative spelling (also clean private keys if present)
      
      return {
        ...profile,
        _metadata: {
          profileUuid: row.profile_uuid,
          publicNostrVersion: row.public_nostr_version ? JSON.parse(row.public_nostr_version) : null,
          hasUnpublishedEdits: row.has_unpublished_edits === 1,
          isCurrentProfile: row.is_current_profile === 1,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          lastPublishedAt: row.last_published_at
        }
      };
    });
  }
  
  /**
   * Save profile to database
   * @param {Object} profileData - Profile data object
   * @param {boolean} markAsUnpublished - Mark profile as having unpublished edits (default: true)
   * @returns {Object} Result object with success and profileUuid
   */
  saveProfile(profileData, markAsUnpublished = true) {
    if (!this.keyguardKey) {
      throw new Error('Profile Guard must be unlocked to save profiles');
    }
    
    if (!profileData.profileId) {
      throw new Error('Profile must have a profileId');
    }
    
    const db = this.getDb();
    const profileUuid = profileData.profileId;
    
    // Check if profile exists
    const existing = db.prepare(`
      SELECT profile_uuid FROM user_profiles WHERE profile_uuid = ?
    `).get(profileUuid);
    
    // CRITICAL: profile_json is published to Nostr - it must NOT contain private/secret keys
    // Public keypair data (publicKey, publicKeyHex, canonicalName, fingerprint, type) CAN be in profile_json
    // Private/secret keys (privateKey, encrypted private keys) MUST be stored only in profile_keypairs table
    
    // Create a copy of profileData and remove private/secret key fields
    const profileForJson = { ...profileData };
    
    // Remove private/secret keys from keypairs, but keep public key data
    if (profileForJson.primaryKeypair) {
      const primaryKp = { ...profileForJson.primaryKeypair };
      delete primaryKp.privateKey; // Remove private key
      delete primaryKp.encrypted; // Remove encryption flag
      delete primaryKp.privateKeyRaw; // Remove raw private key
      // Keep: type, publicKey, publicKeyHex, fingerprint, canonicalName, localName, etc.
      profileForJson.primaryKeypair = primaryKp;
    }
    
    if (profileForJson.additionalKeypairs) {
      profileForJson.additionalKeypairs = profileForJson.additionalKeypairs.map(kp => {
        const cleanedKp = { ...kp };
        delete cleanedKp.privateKey; // Remove private key
        delete cleanedKp.encrypted; // Remove encryption flag
        delete cleanedKp.privateKeyRaw; // Remove raw private key
        // Keep: type, publicKey, publicKeyHex, fingerprint, canonicalName, localName, etc.
        return cleanedKp;
      });
    }
    
    if (profileForJson.adminKeypairs) {
      profileForJson.adminKeypairs = profileForJson.adminKeypairs.map(kp => {
        const cleanedKp = { ...kp };
        delete cleanedKp.privateKey; // Remove private key
        delete cleanedKp.encrypted; // Remove encryption flag
        delete cleanedKp.privateKeyRaw; // Remove raw private key
        // Keep: type, publicKey, publicKeyHex, fingerprint, canonicalName, localName, etc.
        return cleanedKp;
      });
    }
    
    // Remove private Ethereum key (must not be in profile_json)
    delete profileForJson.ethereum_privkey;
    
    // Remove internal metadata (not for publishing)
    delete profileForJson._metadata;
    
    const profileJson = JSON.stringify(profileForJson);
    const isCurrent = this.getCurrentProfileId() === profileUuid;
    
    if (existing) {
      // Update existing profile
      db.prepare(`
        UPDATE user_profiles 
        SET profile_json = ?,
            has_unpublished_edits = ?,
            is_current_profile = ?
        WHERE profile_uuid = ?
      `).run(
        profileJson,
        markAsUnpublished ? 1 : 0,
        isCurrent ? 1 : 0,
        profileUuid
      );
    } else {
      // Insert new profile
      db.prepare(`
        INSERT INTO user_profiles (
          profile_uuid, profile_json, has_unpublished_edits, is_current_profile
        ) VALUES (?, ?, ?, ?)
      `).run(
        profileUuid,
        profileJson,
        markAsUnpublished ? 1 : 0,
        isCurrent ? 1 : 0
      );
    }
    
    // Sync to csettings for backward compatibility
    this.syncProfileToCsettings(profileUuid);
    
    return { success: true, profileUuid };
  }
  
  /**
   * Delete profile from database
   * @param {string} profileUuid - Profile UUID to delete
   * @returns {Object} Result object with success
   */
  deleteProfile(profileUuid) {
    const db = this.getDb();
    
    // Delete profile (cascade will delete keypairs)
    db.prepare(`
      DELETE FROM user_profiles WHERE profile_uuid = ?
    `).run(profileUuid);
    
    // If this was the current profile, clear current profile ID
    if (this.getCurrentProfileId() === profileUuid) {
      const uuid = crypto.randomUUID();
      db.prepare(`
        INSERT INTO csettings (csettinguid, csetting_name, csetting_value)
        VALUES (?, ?, ?)
        ON CONFLICT(csetting_name) DO UPDATE SET csetting_value = excluded.csetting_value
      `).run(uuid, 'online_current_profile_id', '');
    }
    
    return { success: true };
  }
  
  /**
   * Sync profile to csettings for backward compatibility
   * @param {string} profileUuid - Profile UUID to sync
   */
  syncProfileToCsettings(profileUuid) {
    const profile = this.getProfile(profileUuid);
    if (!profile) {
      return;
    }
    
    const db = this.getDb();
    
    // Create a copy without private keys for csettings
    const profileToSave = JSON.parse(JSON.stringify(profile));
    if (profileToSave.primaryKeypair?.privateKey) {
      delete profileToSave.primaryKeypair.privateKey;
    }
    if (profileToSave.additionalKeypairs) {
      profileToSave.additionalKeypairs.forEach((kp) => {
        if (kp.privateKey) delete kp.privateKey;
      });
    }
    if (profileToSave.adminKeypairs) {
      profileToSave.adminKeypairs.forEach((kp) => {
        if (kp.privateKey) delete kp.privateKey;
      });
    }
    
    // Remove metadata
    delete profileToSave._metadata;
    
    const uuid = crypto.randomUUID();
    db.prepare(`
      INSERT INTO csettings (csettinguid, csetting_name, csetting_value)
      VALUES (?, ?, ?)
      ON CONFLICT(csetting_name) DO UPDATE SET csetting_value = excluded.csetting_value
    `).run(uuid, 'online_profile', JSON.stringify(profileToSave));
  }
  
  /**
   * Mark profile as published (clears unpublished edits flag)
   * @param {string} profileUuid - Profile UUID
   * @param {string} nostrEventJson - Nostr event JSON (kind 0)
   */
  markProfileAsPublished(profileUuid, nostrEventJson) {
    const db = this.getDb();
    const now = new Date().toISOString();
    
    db.prepare(`
      UPDATE user_profiles 
      SET public_nostr_version = ?,
          has_unpublished_edits = 0,
          last_published_at = ?
      WHERE profile_uuid = ?
    `).run(nostrEventJson, now, profileUuid);
  }
  
  /**
   * Get profile keypairs
   * @param {string} profileUuid - Profile UUID
   * @returns {Array} Array of keypair objects
   */
  getProfileKeypairs(profileUuid) {
    const db = this.getDb();
    const rows = db.prepare(`
      SELECT * FROM profile_keypairs WHERE profile_uuid = ? ORDER BY created_at ASC
    `).all(profileUuid);
    
    return rows.map(row => ({
      uuid: row.keypair_uuid,
      profileUuid: row.profile_uuid,
      type: row.keypair_type,
      keyUsage: row.key_usage,
      storageStatus: row.storage_status,
      publicKey: row.public_key,
      publicKeyHex: row.public_key_hex,
      fingerprint: row.fingerprint,
      encryptedPrivateKey: row.encrypted_private_key,
      privateKeyFormat: row.private_key_format,
      trustLevel: row.trust_level,
      localName: row.local_name,
      canonicalName: row.canonical_name,
      name: row.name,
      label: row.label,
      comments: row.comments,
      nostrEventId: row.nostr_event_id,
      nostrStatus: row.nostr_status,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }
  
  /**
   * Save profile keypair
   * @param {string} profileUuid - Profile UUID
   * @param {Object} keypairData - Keypair data object
   * @returns {Object} Result object with success and keypairUuid
   */
  saveProfileKeypair(profileUuid, keypairData) {
    if (!this.keyguardKey && keypairData.encryptedPrivateKey) {
      throw new Error('Profile Guard must be unlocked to save keypairs with private keys');
    }
    
    const db = this.getDb();
    const keypairUuid = keypairData.uuid || crypto.randomUUID();
    const keyUsage = keypairData.keyUsage || null;
    
    // CRITICAL: Check for duplicates by profile_uuid + key_usage + public_key_hex
    // This prevents the same keypair from being saved multiple times
    // For primary keypairs, there should be only one per profile
    // For additional keypairs, check by public key to avoid duplicates
    
    let existing = null;
    if (keyUsage === 'primary') {
      // For primary keypairs, check by profile_uuid + key_usage (only one primary per profile)
      existing = db.prepare(`
        SELECT keypair_uuid FROM profile_keypairs 
        WHERE profile_uuid = ? AND key_usage = 'primary'
        LIMIT 1
      `).get(profileUuid);
    } else if (keypairData.publicKeyHex) {
      // For additional keypairs, check by profile_uuid + public_key_hex (same key should not be duplicated)
      existing = db.prepare(`
        SELECT keypair_uuid FROM profile_keypairs 
        WHERE profile_uuid = ? AND public_key_hex = ?
        LIMIT 1
      `).get(profileUuid, keypairData.publicKeyHex);
    } else {
      // Fallback: check by UUID if provided
      existing = db.prepare(`
        SELECT keypair_uuid FROM profile_keypairs WHERE keypair_uuid = ?
      `).get(keypairUuid);
    }
    
    // If found existing, use its UUID instead of potentially creating a new one
    const existingUuid = existing ? existing.keypair_uuid : null;
    const finalUuid = existingUuid || keypairUuid;
    
    if (existing) {
      // Update existing keypair (prevent duplicates)
      db.prepare(`
        UPDATE profile_keypairs 
        SET profile_uuid = ?,
            keypair_type = ?,
            key_usage = ?,
            storage_status = ?,
            public_key = ?,
            public_key_hex = ?,
            fingerprint = ?,
            encrypted_private_key = ?,
            private_key_format = ?,
            trust_level = ?,
            local_name = ?,
            canonical_name = ?,
            is_seed_based = ?,
            derivation_path = ?,
            name = ?,
            label = ?,
            comments = ?,
            nostr_event_id = ?,
            nostr_status = ?
        WHERE keypair_uuid = ?
      `).run(
        profileUuid,
        keypairData.type,
        keypairData.keyUsage || null,
        keypairData.storageStatus || 'public-only',
        keypairData.publicKey,
        keypairData.publicKeyHex || null,
        keypairData.fingerprint || null,
        keypairData.encryptedPrivateKey || null,
        keypairData.privateKeyFormat || null,
        keypairData.trustLevel || null,
        keypairData.localName || null,
        keypairData.canonicalName || null,
        keypairData.isSeedBased ? 1 : 0,
        keypairData.derivationPath || null,
        keypairData.name || null,
        keypairData.label || null,
        keypairData.comments || null,
        keypairData.nostrEventId || null,
        keypairData.nostrStatus || null,
        finalUuid
      );
    } else {
      // Insert new keypair
      db.prepare(`
        INSERT INTO profile_keypairs (
          keypair_uuid, profile_uuid, keypair_type, key_usage, storage_status,
          public_key, public_key_hex, fingerprint, encrypted_private_key, private_key_format,
          trust_level, local_name, canonical_name, is_seed_based, derivation_path, name, label, comments,
          nostr_event_id, nostr_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        finalUuid,
        profileUuid,
        keypairData.type,
        keypairData.keyUsage || null,
        keypairData.storageStatus || 'public-only',
        keypairData.publicKey,
        keypairData.publicKeyHex || null,
        keypairData.fingerprint || null,
        keypairData.encryptedPrivateKey || null,
        keypairData.privateKeyFormat || null,
        keypairData.trustLevel || null,
        keypairData.localName || null,
        keypairData.canonicalName || null,
        keypairData.isSeedBased ? 1 : 0,
        keypairData.derivationPath || null,
        keypairData.name || null,
        keypairData.label || null,
        keypairData.comments || null,
        keypairData.nostrEventId || null,
        keypairData.nostrStatus || null
      );
    }
    
    return { success: true, keypairUuid: finalUuid };
  }
  
  /**
   * Delete profile keypair
   * @param {string} keypairUuid - Keypair UUID
   * @returns {Object} Result object with success
   */
  deleteProfileKeypair(keypairUuid) {
    const db = this.getDb();
    db.prepare(`
      DELETE FROM profile_keypairs WHERE keypair_uuid = ?
    `).run(keypairUuid);
    return { success: true };
  }
  
  /**
   * Publish profile to Nostr (creates kind 0 event and queues it)
   * @param {string} profileUuid - Profile UUID to publish
   * @returns {Promise<Object>} Result object with success and eventId
   */
  async publishProfileToNostr(profileUuid, options = {}) {
    if (!this.keyguardKey) {
      throw new Error('Profile Guard must be unlocked to publish profiles');
    }
    
    const profile = this.getProfile(profileUuid);
    if (!profile) {
      throw new Error('Profile not found');
    }
    
    // CRITICAL: Keypairs are NOT stored in profile_json - they are in profile_keypairs table
    // Get primary keypair from database table, not from profile JSON
    const primaryKeypair = this.getDecryptedPrimaryKeypair(profileUuid);
    if (!primaryKeypair) {
      throw new Error('Profile has no primary keypair');
    }
    
    if (!primaryKeypair.type || !primaryKeypair.type.toLowerCase().includes('nostr')) {
      throw new Error('Primary keypair must be Nostr type to publish profile');
    }
    
    // Private key should already be decrypted by getDecryptedPrimaryKeypair
    let privateKeyHex = primaryKeypair.privateKey;
    if (typeof privateKeyHex !== 'string') {
      throw new Error('Private key must be a hex string');
    }
    
    // Build NIP-01 profile metadata content
    const includePicture = options?.includePicture !== false;
    const includeBanner = options?.includeBanner !== false;
    const profileContent = {
      name: profile.displayName || profile.username || '',
      about: profile.bio || '',
      ...(includePicture ? { picture: profile.pictureUrl || '' } : {}),
      ...(includeBanner ? { banner: profile.bannerUrl || '' } : {})
    };
    
    // Remove empty fields
    Object.keys(profileContent).forEach(key => {
      if (profileContent[key] === '' || profileContent[key] === null || profileContent[key] === undefined) {
        delete profileContent[key];
      }
    });
    
    // Create kind 0 event template
    const { finalizeEvent } = require('nostr-tools');
    const eventTemplate = {
      kind: 0,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['d', profileUuid]
      ],
      content: JSON.stringify(profileContent)
    };
    
    // Sign the event
    const privateKeyBytes = new Uint8Array(Buffer.from(privateKeyHex, 'hex'));
    const signedEvent = finalizeEvent(eventTemplate, privateKeyBytes);
    
    // Add to NostrLocalDBManager cache_out
    const { NostrLocalDBManager } = require('./NostrLocalDBManager');
    const nostrDBManager = new NostrLocalDBManager();
    await nostrDBManager.initialize();
    
    const success = nostrDBManager.addEvent(
      'cache_out',
      signedEvent,
      0, // proc_status: pending
      null, // keep_for
      'user_profiles', // table_name
      profileUuid, // record_uuid
      profileUuid // user_profile_uuid
    );
    
    nostrDBManager.closeAll();
    
    if (!success) {
      throw new Error('Failed to add event to outgoing cache');
    }
    
    // Mark profile as published
    this.markProfileAsPublished(profileUuid, JSON.stringify(signedEvent));
    
    return { success: true, eventId: signedEvent.id };
  }
  
  /**
   * Check if profile has unpublished edits
   * @param {string} profileUuid - Profile UUID
   * @returns {boolean} True if profile has unpublished edits
   */
  hasUnpublishedEdits(profileUuid) {
    const db = this.getDb();
    const row = db.prepare(`
      SELECT has_unpublished_edits FROM user_profiles WHERE profile_uuid = ?
    `).get(profileUuid);
    return row?.has_unpublished_edits === 1;
  }
  
  /**
   * Migrate profile from csettings to database table
   * This is a one-time migration helper for existing profiles
   * @param {string} profileUuid - Profile UUID to migrate
   * @returns {Object} Result object with success
   */
  migrateProfileFromCsettings(profileUuid) {
    if (!this.keyguardKey) {
      throw new Error('Profile Guard must be unlocked to migrate profiles');
    }
    
    const db = this.getDb();
    
    // Check if profile already exists in database
    const existing = db.prepare(`
      SELECT profile_uuid FROM user_profiles WHERE profile_uuid = ?
    `).get(profileUuid);
    
    if (existing) {
      // Already migrated
      return { success: true, alreadyMigrated: true };
    }
    
    // Try to load from standby profiles (which has full data with private keys)
    const standbyProfilesRow = db.prepare(`
      SELECT csetting_value FROM csettings WHERE csetting_name = ?
    `).get('online_standby_profiles');
    
    let profile = null;
    if (standbyProfilesRow) {
      try {
        const encryptedData = JSON.parse(standbyProfilesRow.csetting_value);
        const iv = Buffer.from(encryptedData.iv, 'hex');
        const encrypted = Buffer.from(encryptedData.data, 'hex');
        
        const decipher = crypto.createDecipheriv('aes-256-cbc', this.keyguardKey, iv);
        let decrypted = decipher.update(encrypted);
        decrypted = Buffer.concat([decrypted, decipher.final()]);
        
        const standbyProfiles = JSON.parse(decrypted.toString('utf8'));
        profile = standbyProfiles.find((p) => p.profileId === profileUuid);
      } catch (error) {
        console.error('Error decrypting standby profiles during migration:', error);
      }
    }
    
    if (!profile) {
      // Try to load from online_profile (may not have private keys)
      const profileJson = db.prepare(`
        SELECT csetting_value FROM csettings WHERE csetting_name = ?
      `).get('online_profile');
      
      if (profileJson) {
        profile = JSON.parse(profileJson.csetting_value);
      }
    }
    
    if (!profile) {
      throw new Error('Profile not found in csettings');
    }
    
    // Save to database
    this.saveProfile(profile, false); // Don't mark as unpublished during migration
    
    // Migrate keypairs if they exist
    if (profile.primaryKeypair) {
      this.migrateKeypairToDatabase(profileUuid, profile.primaryKeypair, 'primary');
    }
    
    if (profile.additionalKeypairs) {
      profile.additionalKeypairs.forEach((kp) => {
        this.migrateKeypairToDatabase(profileUuid, kp, 'additional');
      });
    }
    
    return { success: true, alreadyMigrated: false };
  }
  
  /**
   * Migrate keypair from profile JSON to database table
   * @param {string} profileUuid - Profile UUID
   * @param {Object} keypair - Keypair object from profile JSON
   * @param {string} keyUsage - Key usage ('primary', 'additional', 'admin')
   */
  migrateKeypairToDatabase(profileUuid, keypair, keyUsage) {
    const keypairData = {
      uuid: keypair.uuid || crypto.randomUUID(),
      type: keypair.type,
      keyUsage: keyUsage,
      storageStatus: keypair.encrypted ? 'full' : 'public-only',
      publicKey: keypair.publicKey,
      publicKeyHex: keypair.publicKeyHex || null,
      fingerprint: keypair.fingerprint || null,
      encryptedPrivateKey: keypair.privateKey || null,
      privateKeyFormat: keypair.privateKeyFormat || (keypair.type === 'Nostr' ? 'hex' : 'pem'),
      trustLevel: keypair.trustLevel || null,
      localName: keypair.localName || null,
      canonicalName: keypair.canonicalName || null,
      name: keypair.name || null,
      label: keypair.label || null,
      comments: keypair.comments || null,
      nostrEventId: keypair.nostrEventId || null,
      nostrStatus: keypair.nostrStatus || null,
      isSeedBased: keypair.isSeedBased === true || keypair.isSeedBased === 1,
      derivationPath: keypair.derivationPath || null
    };
    
    this.saveProfileKeypair(profileUuid, keypairData);
  }
  
  /**
   * Get decrypted primary keypair for a profile
   * @param {string} profileUuid - Profile UUID
   * @returns {Object|null} Keypair object with decrypted privateKey, or null if not found
   */
  getDecryptedPrimaryKeypair(profileUuid) {
    if (!this.keyguardKey) {
      throw new Error('Profile Guard must be unlocked to decrypt keypairs');
    }
    
    const db = this.getDb();
    const row = db.prepare(`
      SELECT * FROM profile_keypairs 
      WHERE profile_uuid = ? AND key_usage = 'primary'
      ORDER BY created_at ASC
      LIMIT 1
    `).get(profileUuid);
    
    if (!row) {
      return null;
    }
    
    const keypair = {
      uuid: row.keypair_uuid,
      profileUuid: row.profile_uuid,
      type: row.keypair_type,
      keyUsage: row.key_usage,
      storageStatus: row.storage_status,
      publicKey: row.public_key,
      publicKeyHex: row.public_key_hex,
      fingerprint: row.fingerprint,
      privateKeyFormat: row.private_key_format,
      localName: row.local_name,
      canonicalName: row.canonical_name,
      name: row.name,
      label: row.label,
      comments: row.comments,
      privateKey: null // Will be decrypted below
    };
    
    // Decrypt private key if available
    if (row.encrypted_private_key && this.keyguardKey) {
      try {
        const parts = row.encrypted_private_key.split(':');
        if (parts.length !== 2) {
          throw new Error('Invalid encrypted private key format');
        }
        
        const iv = Buffer.from(parts[0], 'hex');
        const encrypted = Buffer.from(parts[1], 'hex');
        
        // Debug: log encrypted data size
        console.log(`[getDecryptedPrimaryKeypair] Encrypted data length: ${encrypted.length} bytes`);
        console.log(`[getDecryptedPrimaryKeypair] IV length: ${iv.length} bytes`);
        
        const decipher = crypto.createDecipheriv('aes-256-cbc', this.keyguardKey, iv);
        let decrypted = decipher.update(encrypted);
        decrypted = Buffer.concat([decrypted, decipher.final()]);
        
        // Debug: log decrypted data size
        console.log(`[getDecryptedPrimaryKeypair] Decrypted data length: ${decrypted.length} bytes`);
        console.log(`[getDecryptedPrimaryKeypair] Decrypted data (first 20 bytes as hex): ${decrypted.toString('hex').substring(0, 40)}`);
        
        // For Nostr keys, private key is stored as hex
        if (row.keypair_type === 'Nostr' || row.keypair_type.toLowerCase().includes('nostr')) {
          // For Nostr, the private key should be 32 bytes (64 hex chars)
          // The decrypted buffer should already be the raw bytes
          keypair.privateKey = decrypted.toString('hex');
          console.log(`[getDecryptedPrimaryKeypair] Private key hex length: ${keypair.privateKey.length} characters`);
        } else {
          keypair.privateKey = decrypted.toString('utf8');
        }
      } catch (error) {
        console.error(`Error decrypting primary keypair for profile ${profileUuid}:`, error);
        throw new Error(`Cannot decrypt primary keypair: ${error.message}`);
      }
    }
    
    return keypair;
  }
  
  /**
   * Publish game ratings to Nostr (creates kind 31001 event and queues it)
   * @param {string} profileUuid - Profile UUID
   * @param {Object} ratingData - Rating data object
   * @returns {Promise<Object>} Result object with success and eventId
   */
  async publishRatingsToNostr(profileUuid, ratingData) {
    if (!this.keyguardKey) {
      throw new Error('Profile Guard must be unlocked to publish ratings');
    }
    
    const {
      gameId,
      gameName,
      gvUuid,
      version,
      status,
      ratings,
      comments,
      user_notes
    } = ratingData;
    
    // Get decrypted primary keypair
    const primaryKeypair = this.getDecryptedPrimaryKeypair(profileUuid);
    
    if (!primaryKeypair) {
      throw new Error('Profile has no primary keypair');
    }
    
    if (!primaryKeypair.type || !primaryKeypair.type.toLowerCase().includes('nostr')) {
      throw new Error('Primary keypair must be Nostr type to publish ratings');
    }
    
    if (!primaryKeypair.privateKey) {
      throw new Error('Private key not available or not decrypted');
    }
    
    // Debug: log the type of privateKey
    console.log('[publishRatingsToNostr] Private key type:', typeof primaryKeypair.privateKey);
    console.log('[publishRatingsToNostr] Private key value (first 20 chars):', 
      typeof primaryKeypair.privateKey === 'string' ? primaryKeypair.privateKey.substring(0, 20) : 'not a string');
    
    // Get public key
    const publicKeyHex = primaryKeypair.publicKeyHex || primaryKeypair.publicKey;
    if (!publicKeyHex) {
      throw new Error('Public key not available');
    }
    
    // Build NIP-33 event content (kind 31001 - User Game Rating)
    const now = Math.floor(Date.now() / 1000);
    
    // Create the content JSON object
    const contentJson = {
      gameid: gameId,
      gvuuid: gvUuid || null,
      version: version || 1,
      game_title: gameName || '',
      status: status || 'Default',
      rating: {
        user_difficulty_rating: ratings.user_difficulty_rating ?? null,
        user_review_rating: ratings.user_review_rating ?? null,
        user_skill_rating: ratings.user_skill_rating ?? null,
        user_skill_rating_when_beat: ratings.user_skill_rating_when_beat ?? null,
        user_recommendation_rating: ratings.user_recommendation_rating ?? null,
        user_importance_rating: ratings.user_importance_rating ?? null,
        user_technical_quality_rating: ratings.user_technical_quality_rating ?? null,
        user_gameplay_design_rating: ratings.user_gameplay_design_rating ?? null,
        user_originality_rating: ratings.user_originality_rating ?? null,
        user_visual_aesthetics_rating: ratings.user_visual_aesthetics_rating ?? null,
        user_story_rating: ratings.user_story_rating ?? null,
        user_soundtrack_graphics_rating: ratings.user_soundtrack_graphics_rating ?? null,
        user_accessibility_rating: ratings.user_accessibility_rating ?? null,
        user_length_pacing: ratings.user_length_pacing ?? null,
        user_progression_rating: ratings.user_progression_rating ?? null,
        user_consistency_rating: ratings.user_consistency_rating ?? null,
        user_overworld_rating: ratings.user_overworld_rating ?? null,
        user_education_rating: ratings.user_education_rating ?? null,
        user_custom_rating: ratings.user_custom_rating ?? null,
        user_puzzle_rating: ratings.user_puzzle_rating ?? null,
        user_polish_rating: ratings.user_polish_rating ?? null,
        user_boss_rating: ratings.user_boss_rating ?? null,
        user_difficulty_comment: comments.user_difficulty_comment || null,
        user_skill_comment: comments.user_skill_comment || null,
        user_skill_comment_when_beat: comments.user_skill_comment_when_beat || null,
        user_review_comment: comments.user_review_comment || null,
        user_recommendation_comment: comments.user_recommendation_comment || null,
        user_importance_comment: comments.user_importance_comment || null,
        user_technical_quality_comment: comments.user_technical_quality_comment || null,
        user_gameplay_design_comment: comments.user_gameplay_design_comment || null,
        user_originality_comment: comments.user_originality_comment || null,
        user_visual_aesthetics_comment: comments.user_visual_aesthetics_comment || null,
        user_story_comment: comments.user_story_comment || null,
        user_soundtrack_graphics_comment: comments.user_soundtrack_graphics_comment || null,
        user_accessibility_comment: comments.user_accessibility_comment || null,
        user_length_pacing_comment: comments.user_length_pacing_comment || null,
        user_progression_comment: comments.user_progression_comment || null,
        user_consistency_comment: comments.user_consistency_comment || null,
        user_overworld_comment: comments.user_overworld_comment || null,
        user_education_comment: comments.user_education_comment || null,
        user_custom_comment: comments.user_custom_comment || null,
        user_puzzle_comment: comments.user_puzzle_comment || null,
        user_polish_comment: comments.user_polish_comment || null,
        user_boss_comment: comments.user_boss_comment || null,
        updated_at_ts: now,
        created_at_ts: now
      },
      user_notes: user_notes || null
    };
    
    // Create NIP-33 event template (kind 31001, parameterized replaceable)
    const { finalizeEvent } = require('nostr-tools');
    const eventTemplate = {
      kind: 31001,
      created_at: now,
      tags: [
        ['d', `game:${gameId}:v1:rating`], // NIP-33 replaceable event identifier
        ['gameid', gameId],
        ['version', '1'],
        ['app', 'rhplay-gameratings'],
        ['verified', 'true'],
        ['v', '1.0']
      ],
      content: JSON.stringify(contentJson)
    };
    
    // Add gvuuid tag if available
    if (gvUuid) {
      eventTemplate.tags.push(['gvuuid', gvUuid]);
    }
    
    // Sign the event using Nostr finalizeEvent
    // Ensure privateKey is a hex string
    let privateKeyHex = primaryKeypair.privateKey;
    if (typeof privateKeyHex !== 'string') {
      // If it's a Buffer, convert to hex
      if (Buffer.isBuffer(privateKeyHex)) {
        privateKeyHex = privateKeyHex.toString('hex');
      } else {
        throw new Error(`Private key must be a hex string, got ${typeof privateKeyHex}`);
      }
    }
    
    // Validate it's a valid hex string
    if (!/^[0-9a-fA-F]{64}$/.test(privateKeyHex)) {
      throw new Error(`Invalid private key format: expected 64 hex characters, got ${privateKeyHex.length} characters`);
    }
    
    const privateKeyBytes = new Uint8Array(Buffer.from(privateKeyHex, 'hex'));
    const signedEvent = finalizeEvent(eventTemplate, privateKeyBytes);
    
    // Add to NostrLocalDBManager cache_out
    const { NostrLocalDBManager } = require('./NostrLocalDBManager');
    const nostrDBManager = new NostrLocalDBManager();
    await nostrDBManager.initialize();
    
    const success = nostrDBManager.addEvent(
      'cache_out',
      signedEvent,
      0, // proc_status: pending
      null, // keep_for
      'user_game_annotations', // table_name
      gameId, // record_uuid (using gameId as identifier)
      profileUuid // user_profile_uuid
    );
    
    nostrDBManager.closeAll();
    
    if (!success) {
      throw new Error('Failed to add event to outgoing cache');
    }
    
    return { success: true, eventId: signedEvent.id };
  }

  /**
   * Publish a game submission to Nostr and enqueue it in cache_out with table_name 'game_submissions'.
   * @param {string} profileUuid
   * @param {object} submissionData - Built by UI (files + meta)
   * @returns {Promise<{success: boolean, eventId?: string, error?: string}>}
   */
  async publishGameSubmission(profileUuid, submissionData) {
    if (!this.keyguardKey) {
      throw new Error('Profile Guard must be unlocked to publish submissions');
    }

    const primaryKeypair = this.getDecryptedPrimaryKeypair(profileUuid);
    if (!primaryKeypair) {
      throw new Error('Profile has no primary keypair');
    }
    if (!primaryKeypair.type || !primaryKeypair.type.toLowerCase().includes('nostr')) {
      throw new Error('Primary keypair must be Nostr type to publish submissions');
    }
    if (!primaryKeypair.privateKey) {
      throw new Error('Private key not available or not decrypted');
    }

    const now = Math.floor(Date.now() / 1000);
    // Build submission content (metadata only; large assets are referenced by path/size for now)
    // Include RHPAK download information if provided
    const rhpak = submissionData?.rhpak || {};
    const contentJson = {
      submission: submissionData || {},
      created_at_ts: now,
      app: 'rhplay-submission',
      version: '1.0',
      rhpak: {
        sha256: rhpak.sha256 || '',
        size_bytes: rhpak.size_bytes || 0,
        ipfs_cid: rhpak.ipfs_cid || undefined,
        download_url: rhpak.download_url || undefined,
        ardrive_file_id: rhpak.ardrive_file_id || undefined,
        ardrive_file_path: rhpak.ardrive_file_path || undefined,
        verified: rhpak.verified || false,
        verified_at: rhpak.verified_at || undefined
      }
    };

    const { finalizeEvent } = require('nostr-tools');
    const eventTemplate = {
      kind: 31110, // provisional kind for Game Submission (TBD)
      created_at: now,
      tags: [
        ['d', `submission:${profileUuid}:${now}`],
        ['app', 'rhplay-submission'],
        ['v', '1.0']
      ],
      content: JSON.stringify(contentJson)
    };

    let privateKeyHex = primaryKeypair.privateKey;
    if (Buffer.isBuffer(privateKeyHex)) {
      privateKeyHex = privateKeyHex.toString('hex');
    }
    if (typeof privateKeyHex !== 'string' || !/^[0-9a-fA-F]{64}$/.test(privateKeyHex)) {
      throw new Error('Invalid private key for signing submission');
    }
    const privateKeyBytes = new Uint8Array(Buffer.from(privateKeyHex, 'hex'));
    const signedEvent = finalizeEvent(eventTemplate, privateKeyBytes);

    const { NostrLocalDBManager } = require('./NostrLocalDBManager');
    const nostrDBManager = new NostrLocalDBManager();
    await nostrDBManager.initialize();

    const success = nostrDBManager.addEvent(
      'cache_out',
      signedEvent,
      0,
      null,
      'game_submissions',
      submissionData?.meta?.name || `submission-${now}`,
      profileUuid
    );

    nostrDBManager.closeAll();

    if (!success) {
      return { success: false, error: 'Failed to add submission event to outgoing cache' };
    }
    return { success: true, eventId: signedEvent.id };
  }
}

module.exports = OnlineProfileManager;

