/**
 * KeyguardReencryption
 * 
 * Utility for atomically re-encrypting all secrets protected by Profile Guard key
 * when the master password is changed.
 * 
 * This ensures that ALL encrypted data is re-encrypted with the new key in a
 * single atomic transaction, preventing partial updates.
 */

const crypto = require('crypto');
const { decryptMasterSeed, encryptMasterSeed } = require('./ProfileSeedManager');

/**
 * Generic decrypt function for IV:HEX format
 * @param {string} encryptedData - Encrypted data in IV:HEX format
 * @param {Buffer} oldKey - Old keyguard key
 * @returns {Buffer} Decrypted data
 */
function decryptWithKeyguard(encryptedData, oldKey) {
  if (!encryptedData) {
    return null;
  }
  
  const parts = encryptedData.split(':');
  if (parts.length !== 2) {
    throw new Error('Invalid encrypted data format (expected IV:HEX)');
  }
  
  const iv = Buffer.from(parts[0], 'hex');
  const encrypted = Buffer.from(parts[1], 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cbc', oldKey, iv);
  let decrypted = decipher.update(encrypted);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted;
}

/**
 * Generic encrypt function for IV:HEX format
 * @param {Buffer} data - Data to encrypt
 * @param {Buffer} newKey - New keyguard key
 * @returns {string} Encrypted data in IV:HEX format
 */
function encryptWithKeyguard(data, newKey) {
  if (!data) {
    return null;
  }
  
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', newKey, iv);
  let encrypted = cipher.update(data);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

/**
 * Re-encrypt all secrets protected by Keyguard key
 * 
 * This function performs an atomic transaction that:
 * 1. Decrypts all secrets with the old key
 * 2. Re-encrypts all secrets with the new key
 * 3. Updates all database records
 * 4. Updates Keyguard settings
 * 
 * If ANY step fails, the entire transaction is rolled back.
 * 
 * @param {Database} db - SQLite database connection (clientdata.db)
 * @param {Buffer} oldKeyguardKey - Current keyguard key (from old password)
 * @param {Buffer} newKeyguardKey - New keyguard key (from new password)
 * @param {string} newSalt - New salt (hex string)
 * @param {string} newKeyHash - New key hash (hex string)
 * @param {boolean} highSecurityMode - New high security mode setting
 * @param {string|null} newEncryptedKey - New encrypted key for safeStorage (if not high security mode)
 * @returns {Object} { success: boolean, error?: string, reencryptedCount: number }
 */
function reencryptAllSecrets(
  db,
  oldKeyguardKey,
  newKeyguardKey,
  newSalt,
  newKeyHash,
  highSecurityMode,
  newEncryptedKey
) {
  let reencryptedCount = 0;
  
  // Start transaction
  db.exec('BEGIN IMMEDIATE TRANSACTION');
  
  try {
    // ========================================================================
    // 1. USER PROFILES: encrypted_master_seed
    // ========================================================================
    const userProfilesWithSeeds = db.prepare(`
      SELECT profile_uuid, encrypted_master_seed 
      FROM user_profiles 
      WHERE encrypted_master_seed IS NOT NULL
    `).all();
    
    for (const profile of userProfilesWithSeeds) {
      try {
        const masterSeed = decryptMasterSeed(profile.encrypted_master_seed, oldKeyguardKey);
        const reencryptedSeed = encryptMasterSeed(masterSeed, newKeyguardKey);
        
        db.prepare(`
          UPDATE user_profiles 
          SET encrypted_master_seed = ? 
          WHERE profile_uuid = ?
        `).run(reencryptedSeed, profile.profile_uuid);
        
        reencryptedCount++;
      } catch (error) {
        throw new Error(`Failed to re-encrypt master seed for profile ${profile.profile_uuid}: ${error.message}`);
      }
    }
    
    // ========================================================================
    // 2. USER PROFILES: encrypted_ethereum_private_key
    // ========================================================================
    const userProfilesWithEthereum = db.prepare(`
      SELECT profile_uuid, encrypted_ethereum_private_key 
      FROM user_profiles 
      WHERE encrypted_ethereum_private_key IS NOT NULL
    `).all();
    
    for (const profile of userProfilesWithEthereum) {
      try {
        const ethereumKey = decryptWithKeyguard(profile.encrypted_ethereum_private_key, oldKeyguardKey);
        const reencryptedEthereumKey = encryptWithKeyguard(ethereumKey, newKeyguardKey);
        
        db.prepare(`
          UPDATE user_profiles 
          SET encrypted_ethereum_private_key = ? 
          WHERE profile_uuid = ?
        `).run(reencryptedEthereumKey, profile.profile_uuid);
        
        reencryptedCount++;
      } catch (error) {
        throw new Error(`Failed to re-encrypt Ethereum key for profile ${profile.profile_uuid}: ${error.message}`);
      }
    }
    
    // ========================================================================
    // 3. PROFILE KEYPAIRS: encrypted_private_key
    // ========================================================================
    const profileKeypairs = db.prepare(`
      SELECT keypair_uuid, encrypted_private_key 
      FROM profile_keypairs 
      WHERE encrypted_private_key IS NOT NULL
    `).all();
    
    for (const keypair of profileKeypairs) {
      try {
        const privateKey = decryptWithKeyguard(keypair.encrypted_private_key, oldKeyguardKey);
        const reencryptedPrivateKey = encryptWithKeyguard(privateKey, newKeyguardKey);
        
        db.prepare(`
          UPDATE profile_keypairs 
          SET encrypted_private_key = ? 
          WHERE keypair_uuid = ?
        `).run(reencryptedPrivateKey, keypair.keypair_uuid);
        
        reencryptedCount++;
      } catch (error) {
        throw new Error(`Failed to re-encrypt private key for profile keypair ${keypair.keypair_uuid}: ${error.message}`);
      }
    }
    
    // ========================================================================
    // 4. ADMIN KEYPAIRS: encrypted_private_key
    // ========================================================================
    const adminKeypairs = db.prepare(`
      SELECT keypair_uuid, encrypted_private_key 
      FROM admin_keypairs 
      WHERE encrypted_private_key IS NOT NULL
    `).all();
    
    for (const keypair of adminKeypairs) {
      try {
        const privateKey = decryptWithKeyguard(keypair.encrypted_private_key, oldKeyguardKey);
        const reencryptedPrivateKey = encryptWithKeyguard(privateKey, newKeyguardKey);
        
        db.prepare(`
          UPDATE admin_keypairs 
          SET encrypted_private_key = ? 
          WHERE keypair_uuid = ?
        `).run(reencryptedPrivateKey, keypair.keypair_uuid);
        
        reencryptedCount++;
      } catch (error) {
        throw new Error(`Failed to re-encrypt private key for admin keypair ${keypair.keypair_uuid}: ${error.message}`);
      }
    }
    
    // ========================================================================
    // 5. ADMIN SEEDS: encrypted_master_seed
    // ========================================================================
    const adminSeeds = db.prepare(`
      SELECT seed_id, encrypted_master_seed 
      FROM admin_seeds
    `).all();
    
    for (const seed of adminSeeds) {
      try {
        const masterSeed = decryptMasterSeed(seed.encrypted_master_seed, oldKeyguardKey);
        const reencryptedSeed = encryptMasterSeed(masterSeed, newKeyguardKey);
        
        db.prepare(`
          UPDATE admin_seeds 
          SET encrypted_master_seed = ? 
          WHERE seed_id = ?
        `).run(reencryptedSeed, seed.seed_id);
        
        reencryptedCount++;
      } catch (error) {
        throw new Error(`Failed to re-encrypt master seed for admin seed ${seed.seed_id}: ${error.message}`);
      }
    }
    
    // ========================================================================
    // 6. TWITCH INTEGRATION: encrypted_access_token and encrypted_refresh_token
    // ========================================================================
    const twitchIntegrations = db.prepare(`
      SELECT integration_uuid, encrypted_access_token, encrypted_refresh_token 
      FROM twitch_integration
    `).all();
    
    for (const integration of twitchIntegrations) {
      try {
        // Re-encrypt access token
        const accessToken = decryptWithKeyguard(integration.encrypted_access_token, oldKeyguardKey);
        const reencryptedAccessToken = encryptWithKeyguard(accessToken, newKeyguardKey);
        
        // Re-encrypt refresh token
        let reencryptedRefreshToken = null;
        if (integration.encrypted_refresh_token) {
          const refreshToken = decryptWithKeyguard(integration.encrypted_refresh_token, oldKeyguardKey);
          reencryptedRefreshToken = encryptWithKeyguard(refreshToken, newKeyguardKey);
        }
        
        db.prepare(`
          UPDATE twitch_integration 
          SET encrypted_access_token = ?, encrypted_refresh_token = ?
          WHERE integration_uuid = ?
        `).run(
          reencryptedAccessToken,
          reencryptedRefreshToken || integration.encrypted_refresh_token,
          integration.integration_uuid
        );
        
        reencryptedCount += integration.encrypted_refresh_token ? 2 : 1;
      } catch (error) {
        throw new Error(`Failed to re-encrypt Twitch tokens for integration ${integration.integration_uuid}: ${error.message}`);
      }
    }
    
    // ========================================================================
    // 6b. RHSERVER TOKENS: encrypted_access_token and encrypted_refresh_token
    // ========================================================================
    const rhserverTokens = db.prepare(`
      SELECT token_uuid, encrypted_access_token, encrypted_refresh_token, encryption_method
      FROM rhserver_tokens
      WHERE encryption_method IS NULL OR encryption_method = 'keyguard'
    `).all();

    for (const row of rhserverTokens) {
      try {
        let accessToken;
        let refreshToken = null;
        if (row.encryption_method === 'vault') {
          continue;
        }
        try {
          accessToken = decryptWithKeyguard(row.encrypted_access_token, oldKeyguardKey);
        } catch (e) {
          continue;
        }
        const reencryptedAccess = encryptWithKeyguard(accessToken, newKeyguardKey);
        let reencryptedRefresh = row.encrypted_refresh_token;
        if (row.encrypted_refresh_token) {
          refreshToken = decryptWithKeyguard(row.encrypted_refresh_token, oldKeyguardKey);
          reencryptedRefresh = encryptWithKeyguard(refreshToken, newKeyguardKey);
        }
        db.prepare(`
          UPDATE rhserver_tokens
          SET encrypted_access_token = ?, encrypted_refresh_token = ?
          WHERE token_uuid = ?
        `).run(reencryptedAccess, reencryptedRefresh, row.token_uuid);
        reencryptedCount += row.encrypted_refresh_token ? 2 : 1;
      } catch (error) {
        throw new Error(`Failed to re-encrypt RHServer tokens for ${row.token_uuid}: ${error.message}`);
      }
    }

    // ========================================================================
    // 7. ENCRYPTION KEYS: keydata (only where encrypted = 1)
    // ========================================================================
    const encryptionKeys = db.prepare(`
      SELECT key_uuid, keydata 
      FROM encryption_keys 
      WHERE encrypted = 1 AND keydata IS NOT NULL
    `).all();
    
    for (const key of encryptionKeys) {
      try {
        const keyData = decryptWithKeyguard(key.keydata, oldKeyguardKey);
        const reencryptedKeyData = encryptWithKeyguard(keyData, newKeyguardKey);
        
        db.prepare(`
          UPDATE encryption_keys 
          SET keydata = ? 
          WHERE key_uuid = ?
        `).run(reencryptedKeyData, key.key_uuid);
        
        reencryptedCount++;
      } catch (error) {
        throw new Error(`Failed to re-encrypt keydata for encryption key ${key.key_uuid}: ${error.message}`);
      }
    }
    
    // ========================================================================
    // 8. UPDATE KEYGUARD SETTINGS (salt, hash, security mode, safeStorage key)
    // ========================================================================
    const uuid1 = crypto.randomUUID();
    db.prepare(`
      INSERT INTO csettings (csettinguid, csetting_name, csetting_value)
      VALUES (?, ?, ?)
      ON CONFLICT(csetting_name) DO UPDATE SET csetting_value = excluded.csetting_value
    `).run(uuid1, 'keyguardsalt', newSalt);
    
    const uuid2 = crypto.randomUUID();
    db.prepare(`
      INSERT INTO csettings (csettinguid, csetting_name, csetting_value)
      VALUES (?, ?, ?)
      ON CONFLICT(csetting_name) DO UPDATE SET csetting_value = excluded.csetting_value
    `).run(uuid2, 'keyguard_key_hash', newKeyHash);
    
    const uuid3 = crypto.randomUUID();
    db.prepare(`
      INSERT INTO csettings (csettinguid, csetting_name, csetting_value)
      VALUES (?, ?, ?)
      ON CONFLICT(csetting_name) DO UPDATE SET csetting_value = excluded.csetting_value
    `).run(uuid3, 'keyguard_high_security_mode', highSecurityMode ? 'true' : 'false');
    
    // Update safeStorage key if not in high security mode
    if (!highSecurityMode && newEncryptedKey) {
      const uuid4 = crypto.randomUUID();
      db.prepare(`
        INSERT INTO csettings (csettinguid, csetting_name, csetting_value)
        VALUES (?, ?, ?)
        ON CONFLICT(csetting_name) DO UPDATE SET csetting_value = excluded.csetting_value
      `).run(uuid4, 'keyguard_key_encrypted', newEncryptedKey);
      
      const uuid5 = crypto.randomUUID();
      db.prepare(`
        INSERT INTO csettings (csettinguid, csetting_name, csetting_value)
        VALUES (?, ?, ?)
        ON CONFLICT(csetting_name) DO UPDATE SET csetting_value = excluded.csetting_value
      `).run(uuid5, 'keyguard_key_stored', 'true');
    } else {
      // Remove safeStorage key if switching to high security mode
      db.prepare(`DELETE FROM csettings WHERE csetting_name = ?`).run('keyguard_key_encrypted');
      db.prepare(`DELETE FROM csettings WHERE csetting_name = ?`).run('keyguard_key_stored');
    }
    
    // Commit transaction
    db.exec('COMMIT');
    
    return {
      success: true,
      reencryptedCount: reencryptedCount
    };
    
  } catch (error) {
    // Rollback transaction on any error
    db.exec('ROLLBACK');
    console.error('[KeyguardReencryption] Transaction rolled back due to error:', error);
    return {
      success: false,
      error: error.message,
      reencryptedCount: 0
    };
  }
}

/**
 * Verify that all encrypted fields can be decrypted with the new keyguard key
 * This is a safety check to ensure re-encryption was successful
 * 
 * @param {Database} db - SQLite database connection (clientdata.db)
 * @param {Buffer} keyguardKey - Keyguard key to test decryption with
 * @returns {Object} { success: boolean, verifiedCount: number, errors: string[] }
 */
function verifyReencryption(db, keyguardKey) {
  const errors = [];
  let verifiedCount = 0;
  
  try {
    // Verify user_profiles.encrypted_master_seed
    const userProfilesWithSeeds = db.prepare(`
      SELECT profile_uuid, encrypted_master_seed 
      FROM user_profiles 
      WHERE encrypted_master_seed IS NOT NULL
    `).all();
    
    for (const profile of userProfilesWithSeeds) {
      try {
        decryptMasterSeed(profile.encrypted_master_seed, keyguardKey);
        verifiedCount++;
      } catch (error) {
        errors.push(`user_profiles.encrypted_master_seed (profile ${profile.profile_uuid}): ${error.message}`);
      }
    }
    
    // Verify user_profiles.encrypted_ethereum_private_key
    const userProfilesWithEthereum = db.prepare(`
      SELECT profile_uuid, encrypted_ethereum_private_key 
      FROM user_profiles 
      WHERE encrypted_ethereum_private_key IS NOT NULL
    `).all();
    
    for (const profile of userProfilesWithEthereum) {
      try {
        decryptWithKeyguard(profile.encrypted_ethereum_private_key, keyguardKey);
        verifiedCount++;
      } catch (error) {
        errors.push(`user_profiles.encrypted_ethereum_private_key (profile ${profile.profile_uuid}): ${error.message}`);
      }
    }
    
    // Verify profile_keypairs.encrypted_private_key
    const profileKeypairs = db.prepare(`
      SELECT keypair_uuid, encrypted_private_key 
      FROM profile_keypairs 
      WHERE encrypted_private_key IS NOT NULL
    `).all();
    
    for (const keypair of profileKeypairs) {
      try {
        decryptWithKeyguard(keypair.encrypted_private_key, keyguardKey);
        verifiedCount++;
      } catch (error) {
        errors.push(`profile_keypairs.encrypted_private_key (keypair ${keypair.keypair_uuid}): ${error.message}`);
      }
    }
    
    // Verify admin_keypairs.encrypted_private_key
    const adminKeypairs = db.prepare(`
      SELECT keypair_uuid, encrypted_private_key 
      FROM admin_keypairs 
      WHERE encrypted_private_key IS NOT NULL
    `).all();
    
    for (const keypair of adminKeypairs) {
      try {
        decryptWithKeyguard(keypair.encrypted_private_key, keyguardKey);
        verifiedCount++;
      } catch (error) {
        errors.push(`admin_keypairs.encrypted_private_key (keypair ${keypair.keypair_uuid}): ${error.message}`);
      }
    }
    
    // Verify admin_seeds.encrypted_master_seed
    const adminSeeds = db.prepare(`
      SELECT seed_id, encrypted_master_seed 
      FROM admin_seeds
    `).all();
    
    for (const seed of adminSeeds) {
      try {
        decryptMasterSeed(seed.encrypted_master_seed, keyguardKey);
        verifiedCount++;
      } catch (error) {
        errors.push(`admin_seeds.encrypted_master_seed (seed ${seed.seed_id}): ${error.message}`);
      }
    }
    
    // Verify twitch_integration.encrypted_access_token and encrypted_refresh_token
    const twitchIntegrations = db.prepare(`
      SELECT integration_uuid, encrypted_access_token, encrypted_refresh_token 
      FROM twitch_integration
    `).all();
    
    for (const integration of twitchIntegrations) {
      try {
        decryptWithKeyguard(integration.encrypted_access_token, keyguardKey);
        verifiedCount++;
        if (integration.encrypted_refresh_token) {
          decryptWithKeyguard(integration.encrypted_refresh_token, keyguardKey);
          verifiedCount++;
        }
      } catch (error) {
        errors.push(`twitch_integration tokens (integration ${integration.integration_uuid}): ${error.message}`);
      }
    }
    
    // Verify rhserver_tokens (keyguard-encrypted only)
    const rhserverTokenRows = db.prepare(`
      SELECT token_uuid, encrypted_access_token, encrypted_refresh_token, encryption_method
      FROM rhserver_tokens
      WHERE is_active = 1 AND (encryption_method IS NULL OR encryption_method = 'keyguard')
    `).all();

    for (const row of rhserverTokenRows) {
      try {
        if (row.encrypted_access_token) {
          decryptWithKeyguard(row.encrypted_access_token, keyguardKey);
          verifiedCount++;
        }
        if (row.encrypted_refresh_token) {
          decryptWithKeyguard(row.encrypted_refresh_token, keyguardKey);
          verifiedCount++;
        }
      } catch (error) {
        errors.push(`rhserver_tokens (token ${row.token_uuid}): ${error.message}`);
      }
    }

    // Verify encryption_keys.keydata (where encrypted = 1)
    const encryptionKeys = db.prepare(`
      SELECT key_uuid, keydata 
      FROM encryption_keys 
      WHERE encrypted = 1 AND keydata IS NOT NULL
    `).all();
    
    for (const key of encryptionKeys) {
      try {
        decryptWithKeyguard(key.keydata, keyguardKey);
        verifiedCount++;
      } catch (error) {
        errors.push(`encryption_keys.keydata (key ${key.key_uuid}): ${error.message}`);
      }
    }
    
    return {
      success: errors.length === 0,
      verifiedCount: verifiedCount,
      errors: errors
    };
  } catch (error) {
    return {
      success: false,
      verifiedCount: verifiedCount,
      errors: [`Verification failed: ${error.message}`]
    };
  }
}

module.exports = {
  reencryptAllSecrets,
  verifyReencryption,
  encryptWithKeyguard,
  decryptWithKeyguard
};

