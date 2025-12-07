/**
 * record-creator.js - Database Record Creation
 * 
 * Creates gameversions, patchblobs, and attachments records
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const crc32 = require('crc-32');
const { crc16 } = require('crc');
const { CID } = require('multiformats/cid');
const { sha256 } = require('multiformats/hashes/sha2');
const fernet = require('fernet');
const lzma = require('lzma-native');
const StatsManager = require('./stats-manager');

// Locked attributes that should be preserved across versions
const LOCKED_ATTRIBUTES = [
  'legacy_type'  // User-curated type classification that persists across versions
];

// Local processing fields that should NOT be overwritten by SMWC metadata
// These are computed/stored locally and should be preserved during updates
const LOCAL_PROCESSING_FIELDS = [
  'patchblob1_name',
  'patchblob1_key',
  'patchblob1_sha224',
  'pat_sha224',
  'pat_sha1',
  'pat_shake_128',
  'patch',
  'result_sha1',
  'result_sha224',
  'result_shake1'
];

/**
 * Get list of fields that come from SMWC metadata
 * These are the fields that SMWC API provides, excluding computed/local fields
 */
function getSMWCFields(metadata) {
  // Fields that come directly from SMWC API response
  // This is based on what normalizeGameEntry/normalizeMetadata processes
  const smwcFields = new Set([
    'id',
    'name',
    'author',
    'authors',
    'submitter',
    'description',
    'difficulty',
    'type',
    'gametype',
    'length',
    'size',
    'demo',
    'featured',
    'moderated',
    'removed',
    'obsoleted',
    'obsoleted_by',
    'tags',
    'url',
    'download_url',
    'name_href',
    'author_href',
    'tags_href',
    'description_href',
    'comments_href',
    'time',
    'added',
    'section',
    'fields',
    'raw_fields',
    'images',
    'screenshots',
    'download_count',
    'downloads',
    'views',
    'comments',
    'comment_count',
    'rating',
    'rating_count',
    'favorites',
    'hof'
  ]);
  
  // Also include any fields that are actually present in the metadata
  // This handles dynamic fields that might be added by SMWC
  if (metadata && typeof metadata === 'object') {
    Object.keys(metadata).forEach(key => {
      smwcFields.add(key);
    });
  }
  
  return smwcFields;
}

/**
 * Get list of local fields (not from SMWC) that should be preserved
 * These are database columns that are computed/stored locally
 */
function getLocalFields() {
  return new Set([
    // Database primary keys and UUIDs
    'gvuuid',
    'gameid',
    'version',
    'rhpakuuid',
    
    // Local processing fields
    ...LOCAL_PROCESSING_FIELDS,
    
    // Computed fields
    'fields_type',
    'raw_difficulty',
    'combinedtype',
    'legacy_type',
    
    // Resource tracking (local)
    'local_resource_etag',
    'local_resource_lastmodified',
    'local_resource_filename',
    
    // JSON storage (contains SMWC data but is a local structure)
    'gvjsondata',
    'gvchange_attributes',
    'gvchanges',
    
    // Timestamps (local)
    'gvimport_time',
    
    // Other local fields
    'siglistuuid'
  ]);
}

/**
 * Preserve local fields from existing record that are not in SMWC metadata
 * Returns an object with fields to preserve
 * 
 * Rules:
 * 1. If field is known local field (not from SMWC), always preserve it
 * 2. If field exists in existing record but is MISSING from SMWC metadata (omitted),
 *    preserve it (SMWC must explicitly provide empty/null to clear it)
 * 3. If SMWC explicitly provides the field (even if empty/null), use SMWC value
 */
function preserveLocalFields(existingRecord, smwcMetadata) {
  const preserved = {};
  const smwcFieldsSet = getSMWCFields(smwcMetadata);
  const localFields = getLocalFields();
  
  // Get actual fields present in SMWC metadata (not just the known list)
  const smwcMetadataFields = new Set();
  if (smwcMetadata && typeof smwcMetadata === 'object') {
    Object.keys(smwcMetadata).forEach(key => {
      smwcMetadataFields.add(key);
    });
  }
  
  // Get all column names from existing record
  const existingFields = Object.keys(existingRecord || {});
  
  for (const field of existingFields) {
    // Always preserve known local fields (not from SMWC)
    if (localFields.has(field)) {
      if (existingRecord[field] !== undefined && existingRecord[field] !== null) {
        preserved[field] = existingRecord[field];
      }
      continue;
    }
    
    // For SMWC fields:
    // - If SMWC metadata OMITS the field (missing), preserve existing value
    // - If SMWC metadata EXPLICITLY provides the field (even if null/empty), use SMWC value (don't preserve)
    if (smwcFieldsSet.has(field)) {
      // Field is a known SMWC field
      if (!smwcMetadataFields.has(field)) {
        // SMWC omitted this field - preserve existing value
        if (existingRecord[field] !== undefined && existingRecord[field] !== null) {
          preserved[field] = existingRecord[field];
        }
      }
      // If smwcMetadataFields.has(field), SMWC explicitly provided it, so we'll use SMWC value (don't preserve)
      continue;
    }
    
    // Unknown field - preserve if it has a value (could be custom local field)
    if (existingRecord[field] !== undefined && existingRecord[field] !== null && !smwcMetadataFields.has(field)) {
      preserved[field] = existingRecord[field];
    }
  }
  
  return preserved;
}

/**
 * Normalize a value for SQLite binding
 * SQLite3 can only bind: numbers, strings, bigints, buffers, and null
 */
function normalizeValueForSQLite(value) {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'boolean') {
    // Convert boolean to string representation of integer for consistent storage
    return (value ? 1 : 0).toString();
  }
  if (Array.isArray(value)) {
    return JSON.stringify(value);
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return value;
}

/**
 * Compute combined type string from multiple type/difficulty fields
 * Format: [fields_type]: [difficulty] (raw_difficulty) (raw_fields.type)
 * Example: "Kaizo: Advanced (diff_4) (kaizo)"
 * 
 * If none of the preferred fields exist, falls back to type/gametype field.
 * 
 * @param {Object} record - The JSON record
 * @returns {string|null} - Combined type string or null
 */
function computeCombinedType(record) {
  const parts = [];
  
  // 1. fields.type (optional, followed by ": ")
  const fieldsType = record.fields && record.fields.type ? record.fields.type : null;
  
  // 2. difficulty (main difficulty field)
  const difficulty = record.difficulty;
  
  // 3. raw_fields.difficulty
  const rawDifficulty = record.raw_fields && record.raw_fields.difficulty ? record.raw_fields.difficulty : null;
  
  // 4. raw_fields.type (can be array or string)
  let rawFieldsType = null;
  if (record.raw_fields && record.raw_fields.type) {
    if (Array.isArray(record.raw_fields.type)) {
      rawFieldsType = record.raw_fields.type.join(', ');
    } else {
      rawFieldsType = record.raw_fields.type;
    }
  }
  
  // Build the combined string
  let result = '';
  
  // Add fields.type with colon if present
  if (fieldsType) {
    result += fieldsType + ': ';
  }
  
  // Add main difficulty
  if (difficulty) {
    result += difficulty;
  }
  
  // Add raw_difficulty in parentheses if present
  if (rawDifficulty) {
    result += ' (' + rawDifficulty + ')';
  }
  
  // Add raw_fields.type in parentheses if present
  if (rawFieldsType) {
    result += ' (' + rawFieldsType + ')';
  }
  
  // Trim the result
  result = result.trim();
  
  // If result is empty, fall back to type/gametype field if present
  if (!result) {
    const fallbackType = record.type || record.gametype;
    if (fallbackType) {
      result = fallbackType;
    }
  }
  
  // Return result or null if still empty
  return result || null;
}

class RecordCreator {
  constructor(dbManager, patchbinDbPath, config) {
    this.dbManager = dbManager;
    this.config = config;
    
    // Open patchbin database
    this.patchbinDb = new Database(patchbinDbPath);
    this.patchbinDb.pragma('foreign_keys = OFF');
  }
  
  /**
   * Create complete set of records for a processed game
   * resourceTracking: { etag, lastModified, filename } from download
   */
  async createGameRecords(queueItem, patchFiles, resourceTracking = null) {
    const gameid = queueItem.gameid;
    console.log(`  Creating records for game ${gameid}...`);
    
    // Parse metadata
    const metadata = typeof queueItem.game_metadata === 'string'
      ? JSON.parse(queueItem.game_metadata)
      : queueItem.game_metadata;
    
    // Filter successful patches
    const successfulPatches = patchFiles.filter(p => p.status === 'completed' && p.blob_data);
    
    if (successfulPatches.length === 0) {
      console.log(`    ⚠ No successful patches with blobs, skipping`);
      return null;
    }
    
    // Find primary patch
    const primaryPatch = successfulPatches.find(p => p.is_primary === 1) || successfulPatches[0];
    const primaryBlobData = JSON.parse(primaryPatch.blob_data);
    
    this.dbManager.beginTransaction();
    
    try {
      // 1. Create gameversion record
      const gvuuid = await this.createGameVersionRecord(
        gameid,
        metadata,
        primaryPatch,
        primaryBlobData,
        resourceTracking
      );
      
      console.log(`    ✓ Gameversion created: ${gvuuid}`);
      
      // 2. Create patchblob records (one per patch)
      const patchblobRecords = [];
      for (const patchFile of successfulPatches) {
        const blobData = JSON.parse(patchFile.blob_data);
        
        const pbuuid = await this.createPatchBlobRecord(
          gvuuid,
          gameid,
          patchFile,
          blobData
        );
        
        patchblobRecords.push({ pbuuid, patchFile, blobData });
        console.log(`    ✓ Patchblob created: ${pbuuid}`);
      }
      
      // 3. Create attachment records
      for (const pbRecord of patchblobRecords) {
        await this.createAttachmentRecord(
          pbRecord.pbuuid,
          gvuuid,
          pbRecord.blobData
        );
        console.log(`    ✓ Attachment created for ${pbRecord.blobData.patchblob1_name}`);
      }
      
      this.dbManager.commit();
      
      console.log(`    ✓ All records created successfully`);
      
      return { gvuuid, patchblobRecords };
      
    } catch (error) {
      this.dbManager.rollback();
      console.error(`    ✗ Error creating records: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Create gameversion record
   * resourceTracking: { etag, lastModified, filename } from download (optional)
   */
  createGameVersionRecord(gameid, metadata, primaryPatch, primaryBlobData, resourceTracking = null) {
    // Get previous version to check for changes and locked attributes
    const previousVersion = this.dbManager.getLatestVersionForGame(gameid);
    const nextVersion = previousVersion ? (previousVersion.version || 0) + 1 : 1;
    
    // Find changed attributes
    let changedAttributes = null;
    if (previousVersion) {
      changedAttributes = this.findChangedFields(previousVersion, metadata);
    }
    
    // Copy locked attributes from previous version if they exist
    // Locked attributes are preserved and not overwritten by new JSON data
    const lockedValues = {};
    if (previousVersion) {
      LOCKED_ATTRIBUTES.forEach(attr => {
        if (previousVersion[attr] !== undefined && previousVersion[attr] !== null) {
          lockedValues[attr] = previousVersion[attr];
          console.log(`    ℹ️  Preserving locked attribute: ${attr} = "${previousVersion[attr]}"`);
        }
      });
    }
    
    // Preserve ALL local fields from previous version that are not in SMWC metadata
    // This ensures any custom/local attributes (like "Xyz") are preserved
    const preservedLocalFields = previousVersion ? preserveLocalFields(previousVersion, metadata) : {};
    if (Object.keys(preservedLocalFields).length > 0) {
      console.log(`    ℹ️  Preserving ${Object.keys(preservedLocalFields).length} local field(s) from previous version`);
      // Log which fields are being preserved (but not all values to avoid spam)
      const preservedFieldNames = Object.keys(preservedLocalFields).filter(f => 
        !LOCKED_ATTRIBUTES.includes(f) && !LOCAL_PROCESSING_FIELDS.includes(f)
      );
      if (preservedFieldNames.length > 0) {
        console.log(`      Preserved fields: ${preservedFieldNames.join(', ')}`);
      }
    }
    
    // Extract new schema fields
    // fields.type from nested fields object (e.g., "Kaizo", "Standard")
    const fieldsType = metadata.fields && metadata.fields.type ? metadata.fields.type : null;
    
    // raw_fields.difficulty from nested raw_fields object (e.g., "diff_4", "diff_2")
    const rawDifficulty = metadata.raw_fields && metadata.raw_fields.difficulty ? metadata.raw_fields.difficulty : null;
    
    // Compute combined type string
    const combinedType = computeCombinedType(metadata);
    
    const data = {
      gvuuid: this.generateUUID(),
      gameid: gameid,
      version: nextVersion,
      section: metadata.section || null,
      gametype: metadata.type || metadata.gametype || metadata.difficulty || null,
      name: metadata.name || null,
      time: metadata.time || null,
      added: metadata.added || null,
      moderated: normalizeValueForSQLite(metadata.moderated),
      author: metadata.author || null,
      authors: metadata.authors || null,
      submitter: metadata.submitter || null,
      demo: metadata.demo || null,
      featured: normalizeValueForSQLite(metadata.featured),
      length: metadata.length || null,
      difficulty: metadata.difficulty || null,
      url: metadata.url || null,
      download_url: metadata.download_url || null,
      name_href: metadata.name_href || null,
      author_href: metadata.author_href || null,
      obsoleted_by: metadata.obsoleted_by || null,
      size: metadata.size || null,
      description: metadata.description || null,
      tags: Array.isArray(metadata.tags) ? JSON.stringify(metadata.tags) : metadata.tags,
      tags_href: metadata.tags_href || null,
      gvjsondata: JSON.stringify(metadata),
      gvchange_attributes: changedAttributes ? JSON.stringify(changedAttributes) : null,
      
      // New schema fields
      fields_type: fieldsType,
      raw_difficulty: rawDifficulty,
      combinedtype: combinedType,
      
      // Primary patch information
      patchblob1_name: primaryBlobData.patchblob1_name || null,
      pat_sha224: primaryPatch.pat_sha224 || null,
      
      removed: metadata.removed || 0,
      obsoleted: metadata.obsoleted || 0,
      
      // Resource tracking fields (if available)
      local_resource_etag: resourceTracking?.etag || null,
      local_resource_lastmodified: resourceTracking?.lastModified || null,
      local_resource_filename: resourceTracking?.filename || (nextVersion === 1 ? `zips/${gameid}.zip` : `zips/${gameid}_${nextVersion}.zip`),
      
      // Apply locked attributes from previous version (overrides JSON data)
      ...lockedValues,
      
      // Preserve all local fields from previous version that are not in SMWC metadata
      // This ensures any custom/local attributes are preserved across versions
      ...preservedLocalFields
    };
    
    this.dbManager.createGameVersion(data);
    
    return data.gvuuid;
  }
  
  /**
   * Update gameversion record in-place (same version number)
   * Preserves local fields that are not in SMWC metadata
   */
  async updateGameRecordsInPlace(gameid, gvuuid, queueItem, patchFiles, existingRecord) {
    console.log(`  Updating gameversion record in-place for ${gameid}...`);
    
    // Parse metadata
    const metadata = typeof queueItem.game_metadata === 'string'
      ? JSON.parse(queueItem.game_metadata)
      : queueItem.game_metadata;
    
    // Filter successful patches
    const successfulPatches = patchFiles.filter(p => p.status === 'completed' && p.blob_data);
    
    if (successfulPatches.length === 0) {
      console.log(`    ⚠ No successful patches with blobs, skipping`);
      return null;
    }
    
    // Find primary patch
    const primaryPatch = successfulPatches.find(p => p.is_primary === 1) || successfulPatches[0];
    const primaryBlobData = JSON.parse(primaryPatch.blob_data);
    
    this.dbManager.beginTransaction();
    
    try {
      // 1. Update gameversion record in-place
      const updatedGvuuid = await this.updateGameVersionRecordInPlace(
        gameid,
        gvuuid,
        metadata,
        primaryPatch,
        primaryBlobData,
        existingRecord
      );
      
      console.log(`    ✓ Gameversion updated: ${updatedGvuuid}`);
      
      // 2. Update or create patchblob records
      const patchblobRecords = [];
      for (const patchFile of successfulPatches) {
        const blobData = JSON.parse(patchFile.blob_data);
        
        // Check if patchblob already exists for this gvuuid
        const existingPatchblob = this.dbManager.db.prepare(`
          SELECT pbuuid FROM patchblobs WHERE gvuuid = ? AND pat_sha224 = ?
        `).get(gvuuid, patchFile.pat_sha224);
        
        let pbuuid;
        if (existingPatchblob) {
          // Update existing patchblob
          pbuuid = await this.updatePatchBlobRecord(
            existingPatchblob.pbuuid,
            gvuuid,
            gameid,
            patchFile,
            blobData
          );
          console.log(`    ✓ Patchblob updated: ${pbuuid}`);
        } else {
          // Create new patchblob
          pbuuid = await this.createPatchBlobRecord(
            gvuuid,
            gameid,
            patchFile,
            blobData
          );
          console.log(`    ✓ Patchblob created: ${pbuuid}`);
        }
        
        patchblobRecords.push({ pbuuid, patchFile, blobData });
      }
      
      // 3. Update or create attachment records
      // Note: attachments table is in patchbin.db, not rhdata.db
      for (const pbRecord of patchblobRecords) {
        // Check if attachment exists (in patchbin.db)
        // Use the same check logic as createAttachmentRecord (by file_name and file_hash_sha224)
        const existingAttachment = this.patchbinDb.prepare(`
          SELECT auuid FROM attachments 
          WHERE file_name = ? AND file_hash_sha224 = ?
        `).get(pbRecord.blobData.patchblob1_name, pbRecord.blobData.patchblob1_sha224);
        
        if (!existingAttachment) {
          await this.createAttachmentRecord(
            pbRecord.pbuuid,
            gvuuid,
            pbRecord.blobData
          );
          console.log(`    ✓ Attachment created for ${pbRecord.blobData.patchblob1_name}`);
        } else {
          // Attachment exists - update parents if needed
          const existing = this.patchbinDb.prepare(`
            SELECT auuid, parents FROM attachments 
            WHERE file_name = ? AND file_hash_sha224 = ?
          `).get(pbRecord.blobData.patchblob1_name, pbRecord.blobData.patchblob1_sha224);
          
          if (existing) {
            const parents = JSON.parse(existing.parents || '[]');
            if (!parents.includes(pbRecord.pbuuid)) {
              parents.push(pbRecord.pbuuid);
              this.patchbinDb.prepare(`
                UPDATE attachments 
                SET parents = ?
                WHERE auuid = ?
              `).run(JSON.stringify(parents), existing.auuid);
            }
          }
          console.log(`    ✓ Attachment already exists for ${pbRecord.blobData.patchblob1_name}`);
        }
      }
      
      this.dbManager.commit();
      
      console.log(`    ✓ All records updated successfully`);
      
      return { gvuuid: updatedGvuuid, patchblobRecords };
      
    } catch (error) {
      this.dbManager.rollback();
      console.error(`    ✗ Error updating records: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Update gameversion record in-place
   */
  async updateGameVersionRecordInPlace(gameid, gvuuid, metadata, primaryPatch, primaryBlobData, existingRecord) {
    // Get previous version to preserve local fields
    const previousVersion = existingRecord;
    
    // Find changed attributes
    const changedAttributes = this.findChangedFields(previousVersion, metadata);
    
    // Copy locked attributes from previous version
    const lockedValues = {};
    if (previousVersion) {
      LOCKED_ATTRIBUTES.forEach(attr => {
        if (previousVersion[attr] !== undefined && previousVersion[attr] !== null) {
          lockedValues[attr] = previousVersion[attr];
        }
      });
    }
    
    // Preserve ALL local fields from previous version that are not in SMWC metadata
    const preservedLocalFields = preserveLocalFields(previousVersion, metadata);
    
    // Remove patch/blob processing fields from preservedLocalFields since we're updating with new patches
    // These fields should come from the newly processed patch/blob, not be preserved
    // Note: gameversions table only has patchblob1_name and pat_sha224
    // Other fields (patchblob1_key, patchblob1_sha224, pat_sha1, etc.) are in patchblobs table
    // Also remove gvjsondata - it MUST be updated with latest SMWC metadata
    const fieldsToUpdate = ['patchblob1_name', 'pat_sha224', 'gvjsondata'];
    const preservedFieldsWithoutPatchBlob = {};
    Object.keys(preservedLocalFields).forEach(key => {
      if (!fieldsToUpdate.includes(key)) {
        preservedFieldsWithoutPatchBlob[key] = preservedLocalFields[key];
      }
    });
    
    // Extract new schema fields
    const fieldsType = metadata.fields && metadata.fields.type ? metadata.fields.type : null;
    const rawDifficulty = metadata.raw_fields && metadata.raw_fields.difficulty ? metadata.raw_fields.difficulty : null;
    const combinedType = computeCombinedType(metadata);
    
    // Build update data (only fields that come from SMWC metadata or are computed from it)
    const updateData = {
      section: metadata.section || null,
      gametype: metadata.type || metadata.gametype || metadata.difficulty || null,
      name: metadata.name || null,
      time: metadata.time || null,
      added: metadata.added || null,
      moderated: normalizeValueForSQLite(metadata.moderated),
      author: metadata.author || null,
      authors: metadata.authors || null,
      submitter: metadata.submitter || null,
      demo: metadata.demo || null,
      featured: normalizeValueForSQLite(metadata.featured),
      length: metadata.length || null,
      difficulty: metadata.difficulty || null,
      url: metadata.url || null,
      download_url: metadata.download_url || null,
      name_href: metadata.name_href || null,
      author_href: metadata.author_href || null,
      obsoleted_by: metadata.obsoleted_by || null,
      size: metadata.size || null,
      description: metadata.description || null,
      tags: Array.isArray(metadata.tags) ? JSON.stringify(metadata.tags) : metadata.tags,
      tags_href: metadata.tags_href || null,
      gvjsondata: JSON.stringify(metadata),
      gvchange_attributes: changedAttributes ? JSON.stringify(changedAttributes) : null,
      
      // New schema fields
      fields_type: fieldsType,
      raw_difficulty: rawDifficulty,
      combinedtype: combinedType,
      
      // Primary patch information (from newly processed patch/blob)
      // These MUST come from the newly processed patch/blob, not be preserved from old record
      // Note: gameversions table only has patchblob1_name and pat_sha224, not patchblob1_key or patchblob1_sha224
      patchblob1_name: primaryBlobData.patchblob1_name || null,
      pat_sha224: primaryPatch.pat_sha224 || null,
      
      removed: metadata.removed || 0,
      obsoleted: metadata.obsoleted || 0,
      
      // Apply locked attributes (overrides)
      ...lockedValues,
      
      // Preserve local fields (but NOT patch/blob fields which are updated above)
      ...preservedFieldsWithoutPatchBlob
    };
    
    // Remove undefined values and immutable fields (gvuuid, gameid, version cannot be updated)
    const immutableFields = ['gvuuid', 'gameid', 'version'];
    Object.keys(updateData).forEach(key => {
      if (updateData[key] === undefined || immutableFields.includes(key)) {
        delete updateData[key];
      }
    });
    
    // Build UPDATE query
    const fields = Object.keys(updateData);
    if (fields.length === 0) {
      console.log(`    ⚠ No fields to update (all fields preserved from existing record)`);
      return gvuuid;
    }
    
    const setClause = fields.map(f => `${f} = @${f}`).join(', ');
    
    this.dbManager.db.prepare(`
      UPDATE gameversions 
      SET ${setClause}
      WHERE gvuuid = @gvuuid
    `).run({ ...updateData, gvuuid });
    
    // Also update gameversion_stats table with latest metadata
    // This ensures gvjsondata in stats table is also updated with latest SMWC metadata
    const statsManager = new StatsManager(this.dbManager);
    statsManager.updateGameStats(gameid, gvuuid, metadata, true); // true = major update (new patches)
    
    return gvuuid;
  }
  
  /**
   * Update metadata only (no patch/blob changes)
   * Preserves all patch/blob information from existing record
   */
  async updateMetadataOnly(gameid, gvuuid, metadata, existingRecord) {
    // Get previous version to preserve local fields
    const previousVersion = existingRecord;
    
    // Find changed attributes
    const changedAttributes = this.findChangedFields(previousVersion, metadata);
    
    // Copy locked attributes from previous version
    const lockedValues = {};
    if (previousVersion) {
      LOCKED_ATTRIBUTES.forEach(attr => {
        if (previousVersion[attr] !== undefined && previousVersion[attr] !== null) {
          lockedValues[attr] = previousVersion[attr];
        }
      });
    }
    
    // Preserve ALL local fields from previous version that are not in SMWC metadata
    // This includes patch/blob fields since we're NOT updating them
    const preservedLocalFields = preserveLocalFields(previousVersion, metadata);
    
    // Remove gvjsondata from preserved fields - it MUST be updated with latest SMWC metadata
    // gvjsondata is critical for administrative visibility into current SMWC record features
    const preservedFieldsWithoutJson = {};
    Object.keys(preservedLocalFields).forEach(key => {
      if (key !== 'gvjsondata') {
        preservedFieldsWithoutJson[key] = preservedLocalFields[key];
      }
    });
    
    // Extract new schema fields
    const fieldsType = metadata.fields && metadata.fields.type ? metadata.fields.type : null;
    const rawDifficulty = metadata.raw_fields && metadata.raw_fields.difficulty ? metadata.raw_fields.difficulty : null;
    const combinedType = computeCombinedType(metadata);
    
    // Build update data (only fields that come from SMWC metadata or are computed from it)
    // NOTE: Do NOT update patch/blob fields - preserve them from existing record
    // NOTE: gvjsondata MUST be updated with latest SMWC metadata
    const updateData = {
      section: metadata.section || null,
      gametype: metadata.type || metadata.gametype || metadata.difficulty || null,
      name: metadata.name || null,
      time: metadata.time || null,
      added: metadata.added || null,
      moderated: normalizeValueForSQLite(metadata.moderated),
      author: metadata.author || null,
      authors: metadata.authors || null,
      submitter: metadata.submitter || null,
      demo: metadata.demo || null,
      featured: normalizeValueForSQLite(metadata.featured),
      length: metadata.length || null,
      difficulty: metadata.difficulty || null,
      url: metadata.url || null,
      download_url: metadata.download_url || null,
      name_href: metadata.name_href || null,
      author_href: metadata.author_href || null,
      obsoleted_by: metadata.obsoleted_by || null,
      size: metadata.size || null,
      description: metadata.description || null,
      tags: Array.isArray(metadata.tags) ? JSON.stringify(metadata.tags) : metadata.tags,
      tags_href: metadata.tags_href || null,
      gvjsondata: JSON.stringify(metadata),  // Always update with latest SMWC metadata
      gvchange_attributes: changedAttributes ? JSON.stringify(changedAttributes) : null,
      
      // New schema fields
      fields_type: fieldsType,
      raw_difficulty: rawDifficulty,
      combinedtype: combinedType,
      
      removed: metadata.removed || 0,
      obsoleted: metadata.obsoleted || 0,
      
      // Apply locked attributes (overrides)
      ...lockedValues,
      
      // Preserve local fields (but NOT gvjsondata which is updated above)
      ...preservedFieldsWithoutJson
    };
    
    // Remove undefined values and immutable fields (gvuuid, gameid, version cannot be updated)
    const immutableFields = ['gvuuid', 'gameid', 'version'];
    Object.keys(updateData).forEach(key => {
      if (updateData[key] === undefined || immutableFields.includes(key)) {
        delete updateData[key];
      }
    });
    
    // Build UPDATE query
    const fields = Object.keys(updateData);
    if (fields.length === 0) {
      console.log(`    ⚠ No fields to update (all fields preserved from existing record)`);
      return gvuuid;
    }
    
    const setClause = fields.map(f => `${f} = @${f}`).join(', ');
    
    this.dbManager.db.prepare(`
      UPDATE gameversions 
      SET ${setClause}
      WHERE gvuuid = @gvuuid
    `).run({ ...updateData, gvuuid });
    
    // Also update gameversion_stats table with latest metadata
    // This ensures gvjsondata in stats table is also updated
    const statsManager = new StatsManager(this.dbManager);
    statsManager.updateGameStats(gameid, gvuuid, metadata, false);
    
    return gvuuid;
  }
  
  /**
   * Update patchblob record
   */
  async updatePatchBlobRecord(pbuuid, gvuuid, gameid, patchFile, blobData) {
    // Note: patchblobs table does NOT have a gameid column - it's linked via gvuuid
    // Match the structure used in createPatchBlobRecord
    
    // Update core patchblobs table
    const patchblobData = {
      gvuuid,
      patch_name: patchFile.patch_filename || null,
      pat_sha1: patchFile.pat_sha1 || null,
      pat_sha224: patchFile.pat_sha224 || null,
      pat_shake_128: patchFile.pat_shake_128 || null,
      patchblob1_key: blobData.patchblob1_key || null,
      patchblob1_name: blobData.patchblob1_name || null,
      patchblob1_sha224: blobData.patchblob1_sha224 || null,
      result_sha1: patchFile.result_sha1 || null,
      result_sha224: patchFile.result_sha224 || null,
      result_shake1: patchFile.result_shake1 || null,
      pbjsondata: JSON.stringify({
        ...patchFile,
        ...blobData
      })
    };
    
    // Remove undefined values
    Object.keys(patchblobData).forEach(key => {
      if (patchblobData[key] === undefined) {
        delete patchblobData[key];
      }
    });
    
    const coreFields = Object.keys(patchblobData);
    const coreSetClause = coreFields.map(f => `${f} = @${f}`).join(', ');
    
    this.dbManager.db.prepare(`
      UPDATE patchblobs 
      SET ${coreSetClause}
      WHERE pbuuid = @pbuuid
    `).run({ ...patchblobData, pbuuid });
    
    // Update or create extended record
    const extendedData = {
      pbuuid,
      patch_filename: patchFile.patch_filename || null,
      patch_type: patchFile.patch_type || null,
      is_primary: patchFile.is_primary || 0,
      zip_source: patchFile.zip_path || patchFile.zip_source || null
    };
    
    // Remove undefined values
    Object.keys(extendedData).forEach(key => {
      if (extendedData[key] === undefined) {
        delete extendedData[key];
      }
    });
    
    const existingExtended = this.dbManager.db.prepare(`
      SELECT pbuuid FROM patchblobs_extended WHERE pbuuid = ?
    `).get(pbuuid);
    
    if (existingExtended) {
      const extFields = Object.keys(extendedData).filter(k => k !== 'pbuuid');
      if (extFields.length > 0) {
        const extSetClause = extFields.map(f => `${f} = @${f}`).join(', ');
        this.dbManager.db.prepare(`
          UPDATE patchblobs_extended 
          SET ${extSetClause}
          WHERE pbuuid = @pbuuid
        `).run(extendedData);
      }
    } else {
      const extFields = Object.keys(extendedData);
      if (extFields.length > 0) {
        const extPlaceholders = extFields.map(f => `@${f}`).join(', ');
        this.dbManager.db.prepare(`
          INSERT INTO patchblobs_extended (${extFields.join(', ')})
          VALUES (${extPlaceholders})
        `).run(extendedData);
      }
    }
    
    return pbuuid;
  }
  
  /**
   * Find changed fields between old and new record
   */
  findChangedFields(oldRecord, newMetadata) {
    const compareFields = [
      'name', 'author', 'authors', 'description', 'difficulty',
      'length', 'demo', 'featured', 'url', 'download_url', 
      'gametype', 'type', 'size'
    ];
    
    const changed = [];
    
    // Parse old JSON data
    let oldData = {};
    if (oldRecord.gvjsondata) {
      try {
        oldData = JSON.parse(oldRecord.gvjsondata);
      } catch (error) {
        // Use record fields directly
        oldData = oldRecord;
      }
    } else {
      oldData = oldRecord;
    }
    
    for (const field of compareFields) {
      const oldVal = oldData[field];
      const newVal = newMetadata[field];
      
      // Normalize for comparison
      const oldNorm = this.normalizeValue(oldVal);
      const newNorm = this.normalizeValue(newVal);
      
      if (JSON.stringify(oldNorm) !== JSON.stringify(newNorm)) {
        changed.push(field);
      }
    }
    
    return changed.length > 0 ? changed : null;
  }
  
  /**
   * Normalize value for comparison
   */
  normalizeValue(val) {
    if (val === null || val === undefined || val === '') {
      return null;
    }
    return val;
  }
  
  /**
   * Create patchblob record
   */
  async createPatchBlobRecord(gvuuid, gameid, patchFile, blobData) {
    // Validate that blob can be decoded BEFORE creating any records
    await this.validateBlobDecoding(blobData, patchFile.pat_sha224);
    
    // Check if identical patchblob already exists
    const existing = this.dbManager.getPatchBlobByHashes(
      patchFile.pat_sha224,
      patchFile.result_sha224
    );
    
    if (existing) {
      console.log(`      ⓘ Patchblob already exists (${existing.pbuuid}), reusing`);
      
      // Link to this gameversion
      this.dbManager.linkPatchBlobToGameVersion(existing.pbuuid, gvuuid);
      
      return existing.pbuuid;
    }
    
    // Create new patchblob
    // Note: Extended fields (patch_filename, patch_type, is_primary, zip_source) 
    // are automatically handled by createPatchBlob and stored in patchblobs_extended table
    const data = {
      pbuuid: this.generateUUID(),
      gvuuid: gvuuid,
      patch_name: patchFile.patch_filename || null,
      pat_sha1: patchFile.pat_sha1 || null,
      pat_sha224: patchFile.pat_sha224 || null,
      pat_shake_128: patchFile.pat_shake_128 || null,
      result_sha1: patchFile.result_sha1 || null,
      result_sha224: patchFile.result_sha224 || null,
      result_shake1: patchFile.result_shake1 || null,
      patchblob1_key: blobData.patchblob1_key || null,
      patchblob1_name: blobData.patchblob1_name || null,
      patchblob1_sha224: blobData.patchblob1_sha224 || null,
      pbjsondata: JSON.stringify({
        ...patchFile,
        ...blobData
      }),
      
      // Extended fields (for patchblobs_extended table)
      patch_filename: patchFile.patch_filename || null,
      patch_type: patchFile.patch_type || null,
      is_primary: patchFile.is_primary || 0,
      zip_source: patchFile.zip_path || null
    };
    
    // createPatchBlob will separate the extended fields automatically
    this.dbManager.createPatchBlob(data);
    
    return data.pbuuid;
  }
  
  /**
   * Create attachment record (in patchbin.db)
   */
  async createAttachmentRecord(pbuuid, gvuuid, blobData) {
    // Check if attachment with same hash already exists
    const existing = this.patchbinDb.prepare(`
      SELECT auuid, parents FROM attachments 
      WHERE file_name = ? AND file_hash_sha224 = ?
    `).get(blobData.patchblob1_name, blobData.patchblob1_sha224);
    
    if (existing) {
      console.log(`      ⓘ Attachment already exists (${existing.auuid})`);
      
      // Update parents array to include this pbuuid
      const parents = JSON.parse(existing.parents || '[]');
      if (!parents.includes(pbuuid)) {
        parents.push(pbuuid);
        this.patchbinDb.prepare(`
          UPDATE attachments 
          SET parents = ?
          WHERE auuid = ?
        `).run(JSON.stringify(parents), existing.auuid);
      }
      
      return existing.auuid;
    }
    
    // Read blob file
    const blobPath = path.join(this.config.BLOBS_DIR, blobData.patchblob1_name);
    
    if (!fs.existsSync(blobPath)) {
      throw new Error(`Blob file not found: ${blobPath}`);
    }
    
    const fileData = fs.readFileSync(blobPath);
    
    // Calculate all hashes and checksums
    const fileSha1 = crypto.createHash('sha1').update(fileData).digest('hex');
    const fileSha224 = crypto.createHash('sha224').update(fileData).digest('hex');
    const fileSha256 = crypto.createHash('sha256').update(fileData).digest('hex');
    const fileMd5 = crypto.createHash('md5').update(fileData).digest('hex');
    const fileCrc16 = this.calculateCRC16(fileData);
    const fileCrc32 = this.calculateCRC32(fileData);
    
    // Calculate IPFS CIDs
    const { cidv0, cidv1 } = await this.calculateIPFSCIDs(fileData);
    
    // Decode and calculate decoded hashes
    // CRITICAL: Decoding must succeed before we insert any attachment records
    let decodedData = null;
    let decodedSha1 = '';
    let decodedSha224 = '';
    let decodedSha256 = '';
    let decodedMd5 = '';
    let decodedCidv0 = '';
    let decodedCidv1 = '';
    
    if (blobData.patchblob1_key) {
      try {
        decodedData = await this.decodeBlob(fileData, blobData.patchblob1_key);
        
        decodedSha1 = crypto.createHash('sha1').update(decodedData).digest('hex');
        decodedSha224 = crypto.createHash('sha224').update(decodedData).digest('hex');
        decodedSha256 = crypto.createHash('sha256').update(decodedData).digest('hex');
        decodedMd5 = crypto.createHash('md5').update(decodedData).digest('hex');
        
        const decodedCids = await this.calculateIPFSCIDs(decodedData);
        decodedCidv0 = decodedCids.cidv0;
        decodedCidv1 = decodedCids.cidv1;
      } catch (error) {
        // CRITICAL: We must NOT insert attachments that cannot be decoded
        throw new Error(`Failed to decode blob ${blobData.patchblob1_name}: ${error.message}`);
      }
    }
    
    const data = {
      auuid: this.generateUUID(),
      pbuuid: pbuuid,
      gvuuid: gvuuid,
      file_crc16: fileCrc16,
      file_crc32: fileCrc32,
      file_size: fileData.length,
      locators: JSON.stringify([]),
      parents: JSON.stringify([pbuuid]),
      file_ipfs_cidv0: cidv0,
      file_ipfs_cidv1: cidv1,
      file_hash_sha224: fileSha224,
      file_hash_sha1: fileSha1,
      file_hash_md5: fileMd5,
      file_hash_sha256: fileSha256,
      file_name: blobData.patchblob1_name,
      filekey: blobData.patchblob1_key || '',
      decoded_ipfs_cidv0: decodedCidv0,
      decoded_ipfs_cidv1: decodedCidv1,
      decoded_hash_sha224: decodedSha224,
      decoded_hash_sha1: decodedSha1,
      decoded_hash_md5: decodedMd5,
      decoded_hash_sha256: decodedSha256,
      file_data: fileData
    };
    
    const fields = Object.keys(data);
    const placeholders = fields.map(f => `@${f}`);
    
    this.patchbinDb.prepare(`
      INSERT INTO attachments (${fields.join(', ')})
      VALUES (${placeholders.join(', ')})
    `).run(data);
    
    return data.auuid;
  }
  
  /**
   * Calculate CRC16
   */
  calculateCRC16(buffer) {
    return crc16(buffer).toString(16).padStart(4, '0');
  }
  
  /**
   * Calculate CRC32
   */
  calculateCRC32(buffer) {
    const result = crc32.buf(buffer);
    return (result >>> 0).toString(16).padStart(8, '0');
  }
  
  /**
   * Calculate IPFS CIDs
   */
  async calculateIPFSCIDs(buffer) {
    const hash = await sha256.digest(buffer);
    const cidV0 = CID.createV0(hash);
    const cidV1 = CID.createV1(0x70, hash);
    
    return {
      cidv0: cidV0.toString(),
      cidv1: cidV1.toString()
    };
  }
  
  /**
   * Decode encrypted blob
   */
  async decodeBlob(encryptedData, keyBase64) {
    // Step 1: Decompress LZMA
    const decompressed1 = await new Promise((resolve, reject) => {
      lzma.decompress(encryptedData, (result, error) => {
        if (error) reject(error);
        else resolve(Buffer.from(result));
      });
    });
    
    // Step 2: Decrypt Fernet
    // The key might be in different formats:
    // 1. Double-base64-encoded (60 chars) - older format
    // 2. Single base64-encoded (44 chars) - newer format
    let fernetKey;
    try {
      // Try double-decoded first (for old format)
      const decoded = Buffer.from(keyBase64, 'base64').toString('utf8');
      // Check if it looks like base64 (including URL-safe chars: - and _)
      // Standard base64: A-Za-z0-9+/=
      // URL-safe base64: A-Za-z0-9-_=
      if (/^[A-Za-z0-9+/\-_]+=*$/.test(decoded) && decoded.length >= 40) {
        fernetKey = decoded;
      } else {
        // Not double-encoded, use the original
        fernetKey = keyBase64;
      }
    } catch (error) {
      // If decoding fails, use the original
      fernetKey = keyBase64;
    }
    
    const frnsecret = new fernet.Secret(fernetKey);
    let tokenStr;
    try {
      tokenStr = decompressed1.toString('utf8');
    } catch (error) {
      // Fallback to latin1 if UTF-8 fails
      tokenStr = decompressed1.toString('latin1');
    }
    const token = new fernet.Token({ 
      secret: frnsecret, 
      ttl: 0, 
      token: tokenStr
    });
    const decrypted = token.decode();
    
    // Step 3: Decompress again
    // JavaScript Fernet library behavior:
    // - encode() base64-encodes the message internally
    // - decode() returns the original message (which blob-creator passed as base64)
    // Since blob-creator passes base64(compressed_patch), decode() returns that base64 string
    // We then decode THAT base64 to get another base64 string (because Fernet encoded it)
    // This creates DOUBLE base64 encoding - unavoidable with JavaScript Fernet library
    
    // The `decrypted` string may contain:
    // 1. Base64 string (normal case - "gAAAAA...")
    // 2. Latin1-encoded binary (when UTF-8 conversion failed - contains chars > 0x7F)
    
    let lzmaData;
    
    // Detect if decrypted contains non-ASCII characters (Latin1-encoded binary)
    const hasNonAscii = /[^\x00-\x7F]/.test(decrypted);
    
    if (hasNonAscii) {
      // Decrypted is Latin1-encoded binary data (UTF-8 conversion failed in crypto-js)
      // Convert directly from Latin1 string to Buffer
      lzmaData = Buffer.from(decrypted, 'latin1');
    } else {
      // Decrypted is a base64 string (normal case)
      lzmaData = Buffer.from(decrypted, 'base64');
      
      // Check if it starts with LZMA/XZ magic bytes (0xFD or 0x5D)
      if (lzmaData[0] !== 0xfd && lzmaData[0] !== 0x5d) {
        // Not LZMA magic - might be double-encoded base64 (JavaScript blobs)
        // Try decoding one more layer
        try {
          const decoded1Str = lzmaData.toString('utf8');
          lzmaData = Buffer.from(decoded1Str, 'base64');
        } catch (e) {
          // If UTF-8 fails, try latin1
          try {
            const decoded1Str = lzmaData.toString('latin1');
            lzmaData = Buffer.from(decoded1Str, 'base64');
          } catch (e2) {
            // Keep original lzmaData
          }
        }
      }
    }
    
    const decompressed2 = await new Promise((resolve, reject) => {
      lzma.decompress(lzmaData, (result, error) => {
        if (error) reject(error);
        else resolve(Buffer.from(result));
      });
    });
    
    return decompressed2;
  }
  
  /**
   * Validate that a blob can be properly decoded and matches expected hash
   */
  async validateBlobDecoding(blobData, expectedPatSha224) {
    const blobPath = path.join(this.config.BLOBS_DIR, blobData.patchblob1_name);
    
    if (!fs.existsSync(blobPath)) {
      throw new Error(`Blob file not found: ${blobPath}`);
    }
    
    const fileData = fs.readFileSync(blobPath);
    
    if (!blobData.patchblob1_key) {
      throw new Error(`No encryption key provided for blob: ${blobData.patchblob1_name}`);
    }
    
    try {
      // Attempt to decode the blob
      const decodedData = await this.decodeBlob(fileData, blobData.patchblob1_key);
      
      // Verify the decoded data matches the expected patch hash
      const decodedSha224 = crypto.createHash('sha224').update(decodedData).digest('hex');
      
      if (decodedSha224 !== expectedPatSha224) {
        throw new Error(
          `Decoded blob hash mismatch! Expected: ${expectedPatSha224}, Got: ${decodedSha224}`
        );
      }
      
      console.log(`      ✓ Blob validation passed (${blobData.patchblob1_name})`);
      return true;
    } catch (error) {
      throw new Error(
        `Blob validation failed for ${blobData.patchblob1_name}: ${error.message}`
      );
    }
  }
  
  /**
   * Generate UUID
   */
  generateUUID() {
    return crypto.randomUUID();
  }
  
  /**
   * Close databases
   */
  close() {
    this.patchbinDb.close();
  }
}

module.exports = RecordCreator;

