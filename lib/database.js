/**
 * database.js - Database Manager for updategames.js
 * 
 * Encapsulates all database operations for the update script
 */

const Database = require('better-sqlite3');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

class DatabaseManager {
  constructor(dbPath, options = {}) {
    this.dbPath = dbPath;
    this.db = new Database(dbPath);
    this.db.pragma('foreign_keys = OFF');
    
    // Connection pool for potential future use
    this.readOnly = options.readOnly || false;
    
    // Ensure schema is up to date
    if (!this.readOnly) {
      this.ensureSchema();
    }
  }
  
  /**
   * Ensure database schema is up to date
   */
  ensureSchema() {
    // Check if Phase 1 tables exist
    const tables = this.db.prepare(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name IN ('update_status', 'game_fetch_queue', 'patch_files_working', 'smwc_metadata_cache')
    `).all();
    
    if (tables.length < 4) {
      console.log('  ⓘ Phase 1 tables not found, running migration...');
      const migrationPath = path.join(__dirname, '..', 'electron', 'sql', 'rhdata_phase1_migration.sql');
      
      if (fs.existsSync(migrationPath)) {
        const migration = fs.readFileSync(migrationPath, 'utf8');
        this.db.exec(migration);
        console.log('  ✓ Phase 1 migration applied');
      } else {
        console.warn('  ⚠ Migration file not found, tables may be missing');
      }
    }
  }
  
  /**
   * Check if a table exists
   */
  tableExists(tableName) {
    const result = this.db.prepare(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name = ?
    `).get(tableName);
    return !!result;
  }
  
  // ============================================================
  // UPDATE STATUS METHODS
  // ============================================================
  
  /**
   * Create update status record
   */
  createUpdateStatus(operationType, metadata = {}) {
    const uuuid = this.generateUUID();
    
    this.db.prepare(`
      INSERT INTO update_status (uuuid, operation_type, status, metadata)
      VALUES (?, ?, 'in_progress', ?)
    `).run(uuuid, operationType, JSON.stringify(metadata));
    
    return uuuid;
  }
  
  /**
   * Update update status
   */
  updateUpdateStatus(uuuid, status, errorMessage = null) {
    const updates = { status };
    
    if (status === 'completed' || status === 'failed') {
      updates.completed_at = new Date().toISOString();
    }
    
    if (errorMessage) {
      updates.error_message = errorMessage;
    }
    
    const fields = Object.keys(updates);
    const setClause = fields.map(f => `${f} = ?`).join(', ');
    const values = fields.map(f => updates[f]);
    
    this.db.prepare(`
      UPDATE update_status 
      SET ${setClause}, last_updated = CURRENT_TIMESTAMP
      WHERE uuuid = ?
    `).run(...values, uuuid);
  }
  
  /**
   * Get active update status
   */
  getActiveUpdateStatus(operationType) {
    return this.db.prepare(`
      SELECT * FROM update_status 
      WHERE operation_type = ? 
        AND status IN ('in_progress', 'pending')
      ORDER BY started_at DESC 
      LIMIT 1
    `).get(operationType);
  }
  
  // ============================================================
  // GAME FETCH QUEUE METHODS
  // ============================================================
  
  /**
   * Add game to fetch queue
   */
  addToFetchQueue(gameid, metadata, downloadUrl) {
    const queueuuid = this.generateUUID();
    
    try {
      this.db.prepare(`
        INSERT INTO game_fetch_queue (queueuuid, gameid, game_metadata, download_url)
        VALUES (?, ?, ?, ?)
      `).run(queueuuid, gameid, JSON.stringify(metadata), downloadUrl);
      
      return queueuuid;
    } catch (error) {
      // Handle duplicate
      if (error.message.includes('UNIQUE')) {
        const existing = this.db.prepare(`
          SELECT queueuuid FROM game_fetch_queue WHERE gameid = ?
        `).get(gameid);
        return existing.queueuuid;
      }
      throw error;
    }
  }
  
  /**
   * Get next queue item
   */
  getNextQueueItem() {
    return this.db.prepare(`
      SELECT * FROM game_fetch_queue 
      WHERE status = 'pending'
      ORDER BY priority DESC, created_at ASC
      LIMIT 1
    `).get();
  }
  
  /**
   * Get queue item by UUID
   */
  getQueueItem(queueuuid) {
    return this.db.prepare(`
      SELECT * FROM game_fetch_queue WHERE queueuuid = ?
    `).get(queueuuid);
  }
  
  /**
   * Get queue item by gameid
   */
  getQueueItemByGameId(gameid) {
    return this.db.prepare(`
      SELECT * FROM game_fetch_queue WHERE gameid = ?
    `).get(gameid);
  }
  
  /**
   * Update queue item status
   */
  updateQueueStatus(queueuuid, status, errorMessage = null) {
    const params = { status, queueuuid };
    let setClause = 'status = @status';
    
    if (status === 'downloading' || status === 'processing') {
      setClause += ', started_at = CURRENT_TIMESTAMP';
    }
    
    if (status === 'completed' || status === 'failed') {
      setClause += ', completed_at = CURRENT_TIMESTAMP';
    }
    
    if (errorMessage) {
      setClause += ', error_message = @error_message';
      params.error_message = errorMessage;
    }
    
    this.db.prepare(`
      UPDATE game_fetch_queue 
      SET ${setClause}
      WHERE queueuuid = @queueuuid
    `).run(params);
  }
  
  /**
   * Update queue item zip path
   */
  updateQueueZipPath(queueuuid, zipPath) {
    this.db.prepare(`
      UPDATE game_fetch_queue 
      SET zip_path = ?
      WHERE queueuuid = ?
    `).run(zipPath, queueuuid);
  }
  
  /**
   * Get completed queue items without blobs
   */
  getCompletedQueueItemsWithoutBlobs() {
    return this.db.prepare(`
      SELECT gfq.* 
      FROM game_fetch_queue gfq
      WHERE gfq.status = 'completed'
        AND EXISTS (
          SELECT 1 FROM patch_files_working pfw 
          WHERE pfw.queueuuid = gfq.queueuuid 
            AND pfw.status = 'completed'
            AND pfw.blob_data IS NULL
        )
    `).all();
  }
  
  /**
   * Get completed queue items ready for record creation
   */
  getCompletedQueueItemsReadyForRecords() {
    return this.db.prepare(`
      SELECT DISTINCT gfq.* 
      FROM game_fetch_queue gfq
      WHERE gfq.status = 'completed'
        AND EXISTS (
          SELECT 1 FROM patch_files_working pfw 
          WHERE pfw.queueuuid = gfq.queueuuid 
            AND pfw.status = 'completed'
            AND pfw.blob_data IS NOT NULL
        )
        AND NOT EXISTS (
          SELECT 1 FROM gameversions gv 
          WHERE gv.gameid = gfq.gameid
        )
    `).all();
  }
  
  // ============================================================
  // PATCH FILES WORKING METHODS
  // ============================================================
  
  /**
   * Add patch file to working table
   */
  addPatchFile(queueuuid, gameid, zipPath, patchFilename, patchType, priorityScore = 0, isPrimary = false) {
    const pfuuid = this.generateUUID();
    
    this.db.prepare(`
      INSERT INTO patch_files_working (
        pfuuid, queueuuid, gameid, zip_path, 
        patch_filename, patch_type, priority_score, is_primary
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(pfuuid, queueuuid, gameid, zipPath, patchFilename, patchType, priorityScore, isPrimary ? 1 : 0);
    
    return pfuuid;
  }
  
  /**
   * Update patch file hashes
   */
  updatePatchFileHashes(pfuuid, hashes) {
    const fields = [];
    const values = [];
    
    const hashFields = [
      'pat_sha1', 'pat_sha224', 'pat_shake_128',
      'result_sha1', 'result_sha224', 'result_shake1',
      'patch_file_path', 'result_file_path',
      'test_result', 'error_message', 'status'
    ];
    
    for (const field of hashFields) {
      if (hashes[field] !== undefined) {
        fields.push(`${field} = ?`);
        values.push(hashes[field]);
      }
    }
    
    if (fields.length > 0) {
      fields.push('processed_at = CURRENT_TIMESTAMP');
      
      this.db.prepare(`
        UPDATE patch_files_working 
        SET ${fields.join(', ')}
        WHERE pfuuid = ?
      `).run(...values, pfuuid);
    }
  }
  
  /**
   * Mark patch as primary
   */
  markPatchPrimary(pfuuid) {
    // First, unmark any other primary patches for same gameid
    const patch = this.db.prepare(`
      SELECT gameid FROM patch_files_working WHERE pfuuid = ?
    `).get(pfuuid);
    
    if (patch) {
      this.db.prepare(`
        UPDATE patch_files_working 
        SET is_primary = 0 
        WHERE gameid = ? AND pfuuid != ?
      `).run(patch.gameid, pfuuid);
      
      this.db.prepare(`
        UPDATE patch_files_working 
        SET is_primary = 1 
        WHERE pfuuid = ?
      `).run(pfuuid);
    }
  }
  
  /**
   * Get patch files by queue UUID
   */
  getPatchFilesByQueue(queueuuid) {
    return this.db.prepare(`
      SELECT * FROM patch_files_working 
      WHERE queueuuid = ?
      ORDER BY priority_score DESC, is_primary DESC
    `).all(queueuuid);
  }
  
  /**
   * Update patch file blob data
   */
  updatePatchFileBlobData(pfuuid, blobData) {
    this.db.prepare(`
      UPDATE patch_files_working 
      SET blob_data = ?
      WHERE pfuuid = ?
    `).run(JSON.stringify(blobData), pfuuid);
  }
  
  /**
   * Get patch file blob data
   */
  getPatchFileBlobData(pfuuid) {
    const result = this.db.prepare(`
      SELECT blob_data FROM patch_files_working WHERE pfuuid = ?
    `).get(pfuuid);
    
    if (result && result.blob_data) {
      return JSON.parse(result.blob_data);
    }
    return null;
  }
  
  // ============================================================
  // METADATA CACHE METHODS
  // ============================================================
  
  /**
   * Cache metadata page
   */
  cacheMetadataPage(pageNumber, responseData, nextPageUrl) {
    const cacheuuid = this.generateUUID();
    const cacheExpires = new Date();
    cacheExpires.setDate(cacheExpires.getDate() + 1); // 24 hour cache
    
    const recordCount = Array.isArray(responseData) ? responseData.length : 0;
    
    this.db.prepare(`
      INSERT INTO smwc_metadata_cache (
        cacheuuid, page_number, response_data, next_page_url, 
        record_count, cache_expires
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      cacheuuid, 
      pageNumber, 
      JSON.stringify(responseData), 
      nextPageUrl, 
      recordCount, 
      cacheExpires.toISOString()
    );
  }
  
  /**
   * Get cached metadata
   */
  getCachedMetadata(pageNumber, maxAge = 86400000) { // 24 hours default
    const result = this.db.prepare(`
      SELECT * FROM smwc_metadata_cache 
      WHERE page_number = ? 
        AND cache_expires > datetime('now')
      ORDER BY fetch_date DESC
      LIMIT 1
    `).get(pageNumber);
    
    if (result) {
      return {
        games: JSON.parse(result.response_data),
        nextPageUrl: result.next_page_url
      };
    }
    
    return null;
  }
  
  /**
   * Clear expired cache
   */
  clearExpiredCache() {
    const result = this.db.prepare(`
      DELETE FROM smwc_metadata_cache 
      WHERE cache_expires < datetime('now')
    `).run();
    
    return result.changes;
  }
  
  // ============================================================
  // GAMEVERSIONS METHODS
  // ============================================================
  
  /**
   * Get existing game IDs
   */
  getExistingGameIds() {
    const rows = this.db.prepare(`
      SELECT DISTINCT gameid FROM gameversions
    `).all();
    
    return rows.map(r => r.gameid);
  }
  
  /**
   * Get latest version for game
   */
  getLatestVersionForGame(gameid) {
    return this.db.prepare(`
      SELECT * FROM gameversions 
      WHERE gameid = ?
      ORDER BY version DESC
      LIMIT 1
    `).get(gameid);
  }
  
  /**
   * Check if game version exists
   */
  gameVersionExists(gameid) {
    const result = this.db.prepare(`
      SELECT COUNT(*) as count FROM gameversions WHERE gameid = ?
    `).get(gameid);
    
    return result.count > 0;
  }
  
  /**
   * Create game version
   */
  createGameVersion(data) {
    const fields = Object.keys(data);
    const placeholders = fields.map(f => `@${f}`);
    
    this.db.prepare(`
      INSERT INTO gameversions (${fields.join(', ')})
      VALUES (${placeholders.join(', ')})
    `).run(data);
    
    return data.gvuuid;
  }
  
  // ============================================================
  // PATCHBLOBS METHODS
  // ============================================================
  
  /**
   * Create patchblob
   */
  createPatchBlob(data) {
    // Separate extended fields from core patchblobs fields
    const extendedFields = ['patch_filename', 'patch_type', 'is_primary', 'zip_source'];
    const coreData = {};
    const extendedData = {};
    
    for (const [key, value] of Object.entries(data)) {
      if (extendedFields.includes(key)) {
        extendedData[key] = value;
      } else {
        coreData[key] = value;
      }
    }
    
    // Insert core fields into patchblobs table
    const fields = Object.keys(coreData);
    const placeholders = fields.map(f => `@${f}`);
    
    this.db.prepare(`
      INSERT INTO patchblobs (${fields.join(', ')})
      VALUES (${placeholders.join(', ')})
    `).run(coreData);
    
    // Create extended record if we have extra fields
    if (extendedData.patch_filename || extendedData.patch_type || extendedData.zip_source) {
      this.db.prepare(`
        INSERT OR REPLACE INTO patchblobs_extended (
          pbuuid, patch_filename, patch_type, is_primary, zip_source
        )
        VALUES (?, ?, ?, ?, ?)
      `).run(
        data.pbuuid,
        extendedData.patch_filename || null,
        extendedData.patch_type || null,
        extendedData.is_primary || 0,
        extendedData.zip_source || null
      );
    }
    
    return data.pbuuid;
  }
  
  /**
   * Get patchblob by hashes
   */
  getPatchBlobByHashes(patSha224, resultSha224) {
    if (!resultSha224) {
      // If no result hash, just match on patch hash
      return this.db.prepare(`
        SELECT * FROM patchblobs 
        WHERE pat_sha224 = ?
        LIMIT 1
      `).get(patSha224);
    }
    
    return this.db.prepare(`
      SELECT * FROM patchblobs 
      WHERE pat_sha224 = ? AND result_sha224 = ?
      LIMIT 1
    `).get(patSha224, resultSha224);
  }
  
  /**
   * Link patchblob to gameversion (update gvuuid)
   */
  linkPatchBlobToGameVersion(pbuuid, gvuuid) {
    // Note: patchblobs can have multiple gvuuids theoretically
    // For now we just update the gvuuid field
    // In a more complex system, we'd have a junction table
    this.db.prepare(`
      UPDATE patchblobs 
      SET gvuuid = ?
      WHERE pbuuid = ?
    `).run(gvuuid, pbuuid);
  }
  
  // ============================================================
  // GAMEVERSION_STATS METHODS (Phase 2)
  // ============================================================
  
  /**
   * Get stats for a game
   */
  getGameStats(gameid) {
    if (!this.tableExists('gameversion_stats')) {
      return null;
    }
    return this.db.prepare(`
      SELECT * FROM gameversion_stats WHERE gameid = ?
    `).get(gameid);
  }
  
  /**
   * Create or update game stats
   */
  upsertGameStats(data) {
    if (!this.tableExists('gameversion_stats')) {
      return;
    }
    
    const fields = Object.keys(data);
    const placeholders = fields.map(f => `@${f}`).join(', ');
    
    this.db.prepare(`
      INSERT OR REPLACE INTO gameversion_stats (${fields.join(', ')})
      VALUES (${placeholders})
    `).run(data);
  }
  
  // ============================================================
  // CHANGE DETECTION METHODS (Phase 2)
  // ============================================================
  
  /**
   * Log change detection
   */
  logChangeDetection(data) {
    if (!this.tableExists('change_detection_log')) {
      return;
    }
    
    const fields = Object.keys(data);
    const placeholders = fields.map(f => `@${f}`).join(', ');
    
    this.db.prepare(`
      INSERT INTO change_detection_log (${fields.join(', ')})
      VALUES (${placeholders})
    `).run(data);
  }
  
  /**
   * Get change detection config
   */
  getChangeDetectionConfig() {
    if (!this.tableExists('change_detection_config')) {
      return [];
    }
    return this.db.prepare(`
      SELECT * FROM change_detection_config WHERE active = 1
    `).all();
  }
  
  // ============================================================
  // TRANSACTION METHODS
  // ============================================================
  
  beginTransaction() {
    this.db.prepare('BEGIN TRANSACTION').run();
  }
  
  commit() {
    this.db.prepare('COMMIT').run();
  }
  
  rollback() {
    this.db.prepare('ROLLBACK').run();
  }
  
  // ============================================================
  // UTILITY METHODS
  // ============================================================
  
  generateUUID() {
    return crypto.randomUUID();
  }
  
  close() {
    this.db.close();
  }
  
  /**
   * Execute raw SQL (for advanced use)
   */
  exec(sql) {
    return this.db.exec(sql);
  }
  
  /**
   * Prepare statement (for advanced use)
   */
  prepare(sql) {
    return this.db.prepare(sql);
  }
}

module.exports = DatabaseManager;

