/**
 * Nostr Local Database Manager
 * 
 * Manages Nostr event feed databases for incoming and outgoing events.
 * Provides separate databases for cache, store, and archive operations.
 * 
 * Databases:
 * - nostr_cache_in.db - Incoming event cache (received events)
 * - nostr_cache_out.db - Outgoing event cache (events to publish)
 * - nostr_store_in.db - Processed incoming events (persistent storage)
 * - nostr_store_out.db - Processed outgoing events (persistent storage)
 * - nostr_archive_01.db, nostr_archive_02.db, etc. - Archived events
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { app } = require('electron');
const { HostFP } = require('../main/HostFP');

const DEFAULT_RELAY_CATEGORIES = ['trusted-core', 'profiles', 'ratings'];
const DEFAULT_RESOURCE_LIMITS = Object.freeze({
  incomingBacklogMax: 5000,
  messageRateUnits: 100,
  messageRateWindowSeconds: 120,
  cpuPercentMax: 35,
  outgoingPerMinute: 60
});
const MESSAGE_UNIT_BYTES = 32 * 1024; // 32 KiB per weighting unit

class NostrLocalDBManager {
  constructor(options = {}) {
    this.connections = {};
    this.basePath = this.getBasePath(options);
    this.hostFP = new HostFP();
    this.initialized = false;
    this.initializing = false;
    this.dbManager = options.dbManager || null;
    this.clientDb = null;
    this.logger = options.logger || console;
    this.cachedResourceLimits = null;
    this.cachedOperatingMode = null;
    // Initialize databases lazily on first use
    // Call initialize() explicitly if you need to await initialization
  }

  /**
   * Explicitly initialize all databases (call this if you need to await initialization)
   * @returns {Promise<void>}
   */
  async initialize() {
    if (this.initialized || this.initializing) {
      return;
    }
    this.initializing = true;
    try {
      await this.initializeDatabases();
      this.initialized = true;
    } finally {
      this.initializing = false;
    }
  }

  /**
   * Get base path for Nostr databases
   * @param {Object} options - Options object
   * @returns {string} Base directory path
   */
  getBasePath(options = {}) {
    // Allow override via environment variable
    if (process.env.NOSTR_DB_PATH) {
      return process.env.NOSTR_DB_PATH;
    }

    const isDev = process.env.ELECTRON_START_URL || process.env.NODE_ENV === 'development';
    const isPackaged = process.env.ELECTRON_IS_PACKAGED || process.env.APPIMAGE;
    
    let basePath;
    
    try {
      if (isDev || !app || !app.getPath) {
        // Development: Use electron/ directory
        basePath = path.join(__dirname, '..');
      } else {
        // Production: Use app user data directory
        basePath = app.getPath('userData');
      }
    } catch (error) {
      // Fallback
      basePath = path.join(__dirname, '..');
    }
    
    // Ensure directory exists
    if (!fs.existsSync(basePath)) {
      fs.mkdirSync(basePath, { recursive: true });
    }
    
    return basePath;
  }

  /**
   * Initialize all Nostr databases
   */
  async initializeDatabases() {
    // Cache databases
    await this.initializeDatabase('cache_in');
    await this.initializeDatabase('cache_out');
    
    // Store databases
    await this.initializeDatabase('store_in');
    await this.initializeDatabase('store_out');
    
    // Archive databases (start with 01)
    await this.initializeArchiveDatabase(1);
    
    // Update host fingerprints for all databases
    await this.updateAllHostFingerprints();
  }

  /**
   * Attach a DatabaseManager for clientdata access after construction
   * @param {DatabaseManager} dbManager - Database manager instance
   */
  setDatabaseManager(dbManager) {
    this.dbManager = dbManager;
    this.clientDb = null;
  }

  /**
   * Get clientdata database connection via DatabaseManager
   * @returns {Database}
   */
  getClientDb() {
    if (!this.dbManager || typeof this.dbManager.getConnection !== 'function') {
      throw new Error('NostrLocalDBManager requires a DatabaseManager instance for relay/config operations');
    }
    if (!this.clientDb) {
      this.clientDb = this.dbManager.getConnection('clientdata');
    }
    return this.clientDb;
  }

  /**
   * Convenience helper to fetch a csetting value
   * @param {string} name
   * @returns {string|null}
   */
  getCsetting(name) {
    const db = this.getClientDb();
    const row = db.prepare('SELECT csetting_value FROM csettings WHERE csetting_name = ?').get(name);
    return row ? row.csetting_value : null;
  }

  /**
   * Upsert a csetting value
   * @param {string} name
   * @param {string} value
   */
  setCsetting(name, value) {
    const db = this.getClientDb();
    const existing = db.prepare('SELECT csettinguid FROM csettings WHERE csetting_name = ?').get(name);
    if (existing) {
      db.prepare('UPDATE csettings SET csetting_value = ? WHERE csetting_name = ?').run(value, name);
    } else {
      db.prepare(`
        INSERT INTO csettings (csettinguid, csetting_name, csetting_value)
        VALUES (?, ?, ?)
      `).run(crypto.randomUUID(), name, value);
    }
  }

  /**
   * Get persisted operating mode (online/offline)
   * @returns {string}
   */
  getOperatingMode() {
    if (this.cachedOperatingMode) {
      return this.cachedOperatingMode;
    }
    try {
      const stored = this.getCsetting('nostr_operating_mode');
      this.cachedOperatingMode = stored === 'online' ? 'online' : 'offline';
    } catch (error) {
      this.logger.warn('[NostrLocalDBManager] Unable to read operating mode:', error.message);
      this.cachedOperatingMode = 'offline';
    }
    return this.cachedOperatingMode;
  }

  /**
   * Persist operating mode
   * @param {string} mode - 'online' or 'offline'
   */
  setOperatingMode(mode) {
    const normalized = mode === 'online' ? 'online' : 'offline';
    try {
      this.setCsetting('nostr_operating_mode', normalized);
      this.cachedOperatingMode = normalized;
    } catch (error) {
      this.logger.error('[NostrLocalDBManager] Failed to persist operating mode:', error.message);
      throw error;
    }
  }

  /**
   * Get persisted resource limit configuration merged with defaults
   * @returns {Object}
   */
  getResourceLimits() {
    if (this.cachedResourceLimits) {
      return { ...this.cachedResourceLimits };
    }
    let parsed = {};
    try {
      const raw = this.getCsetting('nostr_resource_limits');
      parsed = raw ? JSON.parse(raw) : {};
    } catch (error) {
      this.logger.warn('[NostrLocalDBManager] Failed to parse resource limits, using defaults:', error.message);
    }
    this.cachedResourceLimits = {
      ...DEFAULT_RESOURCE_LIMITS,
      ...parsed
    };
    return { ...this.cachedResourceLimits };
  }

  /**
   * Update resource limit configuration values
   * @param {Object} updates
   * @returns {Object} Updated limits
   */
  setResourceLimits(updates = {}) {
    const merged = {
      ...this.getResourceLimits(),
      ...updates
    };
    try {
      this.setCsetting('nostr_resource_limits', JSON.stringify(merged));
      this.cachedResourceLimits = { ...merged };
      return { ...merged };
    } catch (error) {
      this.logger.error('[NostrLocalDBManager] Failed to persist resource limits:', error.message);
      throw error;
    }
  }

  /**
   * Retrieve preferred relay categories
   * @returns {Array<string>}
   */
  getRelayCategoryPreference() {
    try {
      const raw = this.getCsetting('nostr_relay_categories');
      if (!raw) {
        return [...DEFAULT_RELAY_CATEGORIES];
      }
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map(String);
      }
    } catch (error) {
      this.logger.warn('[NostrLocalDBManager] Failed to load relay category preference:', error.message);
    }
    return [...DEFAULT_RELAY_CATEGORIES];
  }

  /**
   * Persist relay category preference
   * @param {Array<string>} categories
   */
  setRelayCategoryPreference(categories = []) {
    const uniqueCategories = Array.from(new Set((categories || []).map((c) => String(c).trim()).filter(Boolean)));
    try {
      this.setCsetting('nostr_relay_categories', JSON.stringify(uniqueCategories));
    } catch (error) {
      this.logger.error('[NostrLocalDBManager] Failed to persist relay category preference:', error.message);
      throw error;
    }
  }

  /**
   * Get database path for a specific database type
   * @param {string} dbType - Database type (cache_in, cache_out, store_in, store_out)
   * @param {number} archiveNum - Archive number (for archive databases)
   * @returns {string} Full path to database file
   */
  getDatabasePath(dbType, archiveNum = null) {
    if (archiveNum !== null) {
      return path.join(this.basePath, `nostr_archive_${String(archiveNum).padStart(2, '0')}.db`);
    }
    
    const dbNames = {
      'cache_in': 'nostr_cache_in.db',
      'cache_out': 'nostr_cache_out.db',
      'store_in': 'nostr_store_in.db',
      'store_out': 'nostr_store_out.db'
    };
    
    if (!dbNames[dbType]) {
      throw new Error(`Unknown database type: ${dbType}`);
    }
    
    return path.join(this.basePath, dbNames[dbType]);
  }

  /**
   * Initialize a specific database (create tables if needed)
   * @param {string} dbType - Database type
   * @param {number} archiveNum - Archive number (for archive databases)
   */
  async initializeDatabase(dbType, archiveNum = null) {
    const dbPath = this.getDatabasePath(dbType, archiveNum);
    const key = archiveNum !== null ? `archive_${archiveNum}` : dbType;
    
    // Create connection if not exists
    if (!this.connections[key]) {
      console.log(`Initializing Nostr database: ${path.basename(dbPath)}`);
      this.connections[key] = new Database(dbPath);
      this.connections[key].pragma('journal_mode = WAL');
    }
    
    const db = this.connections[key];
    
    // Create nostr_raw_events table
    db.exec(`
      CREATE TABLE IF NOT EXISTS nostr_raw_events (
        nostr_event_id VARCHAR(64) PRIMARY KEY,
        nostr_reserved INTEGER DEFAULT 0,
        nostr_publickey VARCHAR(64) NOT NULL,
        nostr_createdat INTEGER NOT NULL,
        nostr_kind INTEGER NOT NULL,
        nostr_tags TEXT NOT NULL,
        content TEXT NOT NULL,
        proc_status INTEGER DEFAULT 0,
        proc_at INTEGER,
        keep_for INTEGER,
        table_name TEXT,
        record_uuid TEXT,
        user_profile_uuid TEXT
      );
      
      CREATE INDEX IF NOT EXISTS idx_nostr_raw_events_publickey ON nostr_raw_events(nostr_publickey);
      CREATE INDEX IF NOT EXISTS idx_nostr_raw_events_createdat ON nostr_raw_events(nostr_createdat);
      CREATE INDEX IF NOT EXISTS idx_nostr_raw_events_kind ON nostr_raw_events(nostr_kind);
      CREATE INDEX IF NOT EXISTS idx_nostr_raw_events_proc_status ON nostr_raw_events(proc_status);
      CREATE INDEX IF NOT EXISTS idx_nostr_raw_events_proc_at ON nostr_raw_events(proc_at);
      CREATE INDEX IF NOT EXISTS idx_nostr_raw_events_table_name ON nostr_raw_events(table_name);
      CREATE INDEX IF NOT EXISTS idx_nostr_raw_events_record_uuid ON nostr_raw_events(record_uuid);
      CREATE INDEX IF NOT EXISTS idx_nostr_raw_events_user_profile_uuid ON nostr_raw_events(user_profile_uuid);
    `);
    
    // Create feed_database table
    db.exec(`
      CREATE TABLE IF NOT EXISTS feed_database (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        last_processed INTEGER,
        processed_on_0 TEXT,
        processed_on_1 TEXT
      );
      
      -- Insert default row if not exists
      INSERT OR IGNORE INTO feed_database (id, last_processed, processed_on_0, processed_on_1)
      VALUES (1, 0, '', '');
    `);
    
    // Initialize host fingerprint if not set
    await this.updateHostFingerprint(key);
  }

  /**
   * Initialize archive database
   * @param {number} archiveNum - Archive number
   */
  async initializeArchiveDatabase(archiveNum) {
    await this.initializeDatabase('archive', archiveNum);
  }

  /**
   * Update host fingerprint in feed_database table
   * @param {string} dbKey - Database connection key
   */
  async updateHostFingerprint(dbKey) {
    const db = this.connections[dbKey];
    if (!db) return;
    
    try {
      // Get current fingerprint values
      const row = db.prepare('SELECT processed_on_0, processed_on_1 FROM feed_database WHERE id = 1').get();
      
      // Update if empty
      if (!row || !row.processed_on_0 || !row.processed_on_1) {
        const fp0 = await this.hostFP.getv('', '');
        const fp1Values = await this.hostFP.getUnderlyingValues('', '');
        const fp1 = JSON.stringify(fp1Values);
        
        db.prepare(`
          UPDATE feed_database 
          SET processed_on_0 = ?, processed_on_1 = ?
          WHERE id = 1
        `).run(fp0, fp1);
      }
    } catch (error) {
      console.error(`Error updating host fingerprint for ${dbKey}:`, error);
    }
  }

  /**
   * Update host fingerprints for all databases
   */
  async updateAllHostFingerprints() {
    const dbKeys = Object.keys(this.connections);
    for (const dbKey of dbKeys) {
      await this.updateHostFingerprint(dbKey);
    }
  }

  /**
   * Get database connection
   * @param {string} dbType - Database type
   * @param {number} archiveNum - Archive number (optional)
   * @returns {Database} Database connection
   */
  getConnection(dbType, archiveNum = null) {
    const key = archiveNum !== null ? `archive_${archiveNum}` : dbType;
    
    if (!this.connections[key]) {
      // Initialize if not already done (synchronous initialization for immediate use)
      // Note: This will not await host fingerprint updates, but database will be usable
      this.initializeDatabaseSync(dbType, archiveNum);
    }
    
    return this.connections[key];
  }

  /**
   * Synchronous database initialization (for immediate use)
   * @param {string} dbType - Database type
   * @param {number} archiveNum - Archive number (optional)
   */
  initializeDatabaseSync(dbType, archiveNum = null) {
    const dbPath = this.getDatabasePath(dbType, archiveNum);
    const key = archiveNum !== null ? `archive_${archiveNum}` : dbType;
    
    if (this.connections[key]) {
      return; // Already initialized
    }
    
    console.log(`Initializing Nostr database: ${path.basename(dbPath)}`);
    this.connections[key] = new Database(dbPath);
    this.connections[key].pragma('journal_mode = WAL');
    
    const db = this.connections[key];
    
    // Create nostr_raw_events table
    db.exec(`
      CREATE TABLE IF NOT EXISTS nostr_raw_events (
        nostr_event_id VARCHAR(64) PRIMARY KEY,
        nostr_reserved INTEGER DEFAULT 0,
        nostr_publickey VARCHAR(64) NOT NULL,
        nostr_createdat INTEGER NOT NULL,
        nostr_kind INTEGER NOT NULL,
        nostr_tags TEXT NOT NULL,
        content TEXT NOT NULL,
        proc_status INTEGER DEFAULT 0,
        proc_at INTEGER,
        keep_for INTEGER,
        table_name TEXT,
        record_uuid TEXT,
        user_profile_uuid TEXT
      );
      
      CREATE INDEX IF NOT EXISTS idx_nostr_raw_events_publickey ON nostr_raw_events(nostr_publickey);
      CREATE INDEX IF NOT EXISTS idx_nostr_raw_events_createdat ON nostr_raw_events(nostr_createdat);
      CREATE INDEX IF NOT EXISTS idx_nostr_raw_events_kind ON nostr_raw_events(nostr_kind);
      CREATE INDEX IF NOT EXISTS idx_nostr_raw_events_proc_status ON nostr_raw_events(proc_status);
      CREATE INDEX IF NOT EXISTS idx_nostr_raw_events_proc_at ON nostr_raw_events(proc_at);
      CREATE INDEX IF NOT EXISTS idx_nostr_raw_events_table_name ON nostr_raw_events(table_name);
      CREATE INDEX IF NOT EXISTS idx_nostr_raw_events_record_uuid ON nostr_raw_events(record_uuid);
      CREATE INDEX IF NOT EXISTS idx_nostr_raw_events_user_profile_uuid ON nostr_raw_events(user_profile_uuid);
    `);
    
    // Create feed_database table
    db.exec(`
      CREATE TABLE IF NOT EXISTS feed_database (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        last_processed INTEGER,
        processed_on_0 TEXT,
        processed_on_1 TEXT
      );
      
      -- Insert default row if not exists
      INSERT OR IGNORE INTO feed_database (id, last_processed, processed_on_0, processed_on_1)
      VALUES (1, 0, '', '');
    `);
    
    // Update host fingerprint asynchronously (non-blocking)
    this.updateHostFingerprint(key).catch(err => {
      console.error(`Error updating host fingerprint for ${key}:`, err);
    });
  }

  /**
   * Add event to database
   * @param {string} dbType - Database type
   * @param {Object} event - Nostr event object
   * @param {number} procStatus - Processing status (default: 0)
   * @param {number} keepFor - Seconds to keep in store (optional)
   * @param {string} tableName - Table name (e.g., 'admin_keypairs') (optional)
   * @param {string} recordUuid - Record UUID (optional)
   * @param {string} userProfileUuid - User profile UUID (optional)
   * @returns {boolean} Success
   */
  addEvent(dbType, event, procStatus = 0, keepFor = null, tableName = null, recordUuid = null, userProfileUuid = null) {
    const db = this.getConnection(dbType);
    
    try {
      db.prepare(`
        INSERT OR REPLACE INTO nostr_raw_events (
          nostr_event_id,
          nostr_reserved,
          nostr_publickey,
          nostr_createdat,
          nostr_kind,
          nostr_tags,
          content,
          proc_status,
          proc_at,
          keep_for,
          table_name,
          record_uuid,
          user_profile_uuid
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        event.id,
        0, // reserved (always 0)
        event.pubkey,
        event.created_at,
        event.kind,
        JSON.stringify(event.tags),
        event.content,
        procStatus,
        procStatus > 0 ? Math.floor(Date.now() / 1000) : null,
        keepFor,
        tableName,
        recordUuid,
        userProfileUuid
      );
      
      return true;
    } catch (error) {
      console.error(`Error adding event to ${dbType}:`, error);
      return false;
    }
  }

  /**
   * Update event processing status
   * @param {string} dbType - Database type
   * @param {string} eventId - Event ID
   * @param {number} procStatus - New processing status
   * @param {number} keepFor - Seconds to keep in store (optional)
   * @returns {boolean} Success
   */
  updateEventStatus(dbType, eventId, procStatus, keepFor = null) {
    const db = this.getConnection(dbType);
    
    try {
      db.prepare(`
        UPDATE nostr_raw_events
        SET proc_status = ?,
            proc_at = ?,
            keep_for = COALESCE(?, keep_for)
        WHERE nostr_event_id = ?
      `).run(
        procStatus,
        Math.floor(Date.now() / 1000),
        keepFor,
        eventId
      );
      
      return true;
    } catch (error) {
      console.error(`Error updating event status in ${dbType}:`, error);
      return false;
    }
  }

  /**
   * Get event by ID
   * @param {string} dbType - Database type
   * @param {string} eventId - Event ID
   * @returns {Object|null} Event object or null
   */
  getEvent(dbType, eventId) {
    const db = this.getConnection(dbType);
    
    try {
      const row = db.prepare('SELECT * FROM nostr_raw_events WHERE nostr_event_id = ?').get(eventId);
      
      if (!row) return null;
      
      return {
        id: row.nostr_event_id,
        pubkey: row.nostr_publickey,
        created_at: row.nostr_createdat,
        kind: row.nostr_kind,
        tags: JSON.parse(row.nostr_tags),
        content: row.content,
        sig: null, // Not stored in raw_events table
        proc_status: row.proc_status,
        proc_at: row.proc_at,
        keep_for: row.keep_for
      };
    } catch (error) {
      console.error(`Error getting event from ${dbType}:`, error);
      return null;
    }
  }

  /**
   * Get events by status
   * @param {string} dbType - Database type
   * @param {number} procStatus - Processing status
   * @param {number} limit - Maximum number of events (optional)
   * @returns {Array} Array of event objects
   */
  getEventsByStatus(dbType, procStatus, limit = null) {
    const db = this.getConnection(dbType);
    
    try {
      let query = 'SELECT * FROM nostr_raw_events WHERE proc_status = ? ORDER BY nostr_createdat ASC';
      if (limit) {
        query += ` LIMIT ${limit}`;
      }
      
      const rows = db.prepare(query).all(procStatus);
      
      return rows.map(row => ({
        id: row.nostr_event_id,
        pubkey: row.nostr_publickey,
        created_at: row.nostr_createdat,
        kind: row.nostr_kind,
        tags: JSON.parse(row.nostr_tags),
        content: row.content,
        sig: null,
        proc_status: row.proc_status,
        proc_at: row.proc_at,
        keep_for: row.keep_for
      }));
    } catch (error) {
      console.error(`Error getting events by status from ${dbType}:`, error);
      return [];
    }
  }

  /**
   * Move event from cache to store
   * @param {string} fromType - Source database type (cache_in or cache_out)
   * @param {string} toType - Destination database type (store_in or store_out)
   * @param {string} eventId - Event ID
   * @returns {boolean} Success
   */
  moveEventToStore(fromType, toType, eventId) {
    const fromDb = this.getConnection(fromType);
    const toDb = this.getConnection(toType);
    
    try {
      // Get event from source
      const row = fromDb.prepare('SELECT * FROM nostr_raw_events WHERE nostr_event_id = ?').get(eventId);
      
      if (!row) {
        console.warn(`Event ${eventId} not found in ${fromType}`);
        return false;
      }
      
      // Insert into destination
      toDb.prepare(`
        INSERT OR REPLACE INTO nostr_raw_events (
          nostr_event_id,
          nostr_reserved,
          nostr_publickey,
          nostr_createdat,
          nostr_kind,
          nostr_tags,
          content,
          proc_status,
          proc_at,
          keep_for,
          table_name,
          record_uuid,
          user_profile_uuid
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        row.nostr_event_id,
        row.nostr_reserved,
        row.nostr_publickey,
        row.nostr_createdat,
        row.nostr_kind,
        row.nostr_tags,
        row.content,
        row.proc_status,
        row.proc_at,
        row.keep_for,
        row.table_name || null,
        row.record_uuid || null,
        row.user_profile_uuid || null
      );
      
      // Delete from source
      fromDb.prepare('DELETE FROM nostr_raw_events WHERE nostr_event_id = ?').run(eventId);
      
      return true;
    } catch (error) {
      console.error(`Error moving event from ${fromType} to ${toType}:`, error);
      return false;
    }
  }

  /**
   * Archive events to archive database
   * @param {string} fromType - Source database type (store_in or store_out)
   * @param {number} archiveNum - Archive database number
   * @param {Array<string>} eventIds - Array of event IDs to archive
   * @returns {number} Number of events archived
   */
  archiveEvents(fromType, archiveNum, eventIds) {
    const fromDb = this.getConnection(fromType);
    
    // Initialize archive database if needed
    this.initializeArchiveDatabase(archiveNum);
    const archiveDb = this.getConnection('archive', archiveNum);
    
    let archived = 0;
    
    try {
      for (const eventId of eventIds) {
        const row = fromDb.prepare('SELECT * FROM nostr_raw_events WHERE nostr_event_id = ?').get(eventId);
        
        if (!row) continue;
        
        // Insert into archive
        archiveDb.prepare(`
          INSERT OR REPLACE INTO nostr_raw_events (
            nostr_event_id,
            nostr_reserved,
            nostr_publickey,
            nostr_createdat,
            nostr_kind,
            nostr_tags,
            content,
            proc_status,
            proc_at,
            keep_for,
            table_name,
            record_uuid,
            user_profile_uuid
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          row.nostr_event_id,
          row.nostr_reserved,
          row.nostr_publickey,
          row.nostr_createdat,
          row.nostr_kind,
          row.nostr_tags,
          row.content,
          row.proc_status,
          row.proc_at,
          row.keep_for,
          row.table_name || null,
          row.record_uuid || null,
          row.user_profile_uuid || null
        );
        
        // Delete from source
        fromDb.prepare('DELETE FROM nostr_raw_events WHERE nostr_event_id = ?').run(eventId);
        
        archived++;
      }
      
      return archived;
    } catch (error) {
      console.error(`Error archiving events:`, error);
      return archived;
    }
  }

  /**
   * Update last processed timestamp
   * @param {string} dbType - Database type
   * @returns {boolean} Success
   */
  updateLastProcessed(dbType) {
    const db = this.getConnection(dbType);
    
    try {
      db.prepare(`
        UPDATE feed_database
        SET last_processed = ?
        WHERE id = 1
      `).run(Math.floor(Date.now() / 1000));
      
      return true;
    } catch (error) {
      console.error(`Error updating last_processed for ${dbType}:`, error);
      return false;
    }
  }

  /**
   * Get last processed timestamp
   * @param {string} dbType - Database type
   * @returns {number} Timestamp or 0
   */
  getLastProcessed(dbType) {
    const db = this.getConnection(dbType);
    
    try {
      const row = db.prepare('SELECT last_processed FROM feed_database WHERE id = 1').get();
      return row ? row.last_processed : 0;
    } catch (error) {
      console.error(`Error getting last_processed for ${dbType}:`, error);
      return 0;
    }
  }

  /**
   * Clean up expired events from store databases
   * @param {string} dbType - Database type (store_in or store_out)
   * @returns {number} Number of events removed
   */
  cleanupExpiredEvents(dbType) {
    const db = this.getConnection(dbType);
    const now = Math.floor(Date.now() / 1000);
    
    try {
      const result = db.prepare(`
        DELETE FROM nostr_raw_events
        WHERE proc_status = 2
          AND keep_for IS NOT NULL
          AND (proc_at + keep_for) < ?
      `).run(now);
      
      return result.changes || 0;
    } catch (error) {
      console.error(`Error cleaning up expired events from ${dbType}:`, error);
      return 0;
    }
  }

  /**
   * Get statistics for a database
   * @param {string} dbType - Database type
   * @returns {Object} Statistics object
   */
  getStatistics(dbType) {
    const db = this.getConnection(dbType);
    
    try {
      const total = db.prepare('SELECT COUNT(*) as count FROM nostr_raw_events').get();
      const byStatus = db.prepare(`
        SELECT proc_status, COUNT(*) as count
        FROM nostr_raw_events
        GROUP BY proc_status
      `).all();
      
      const lastProcessed = this.getLastProcessed(dbType);
      
      return {
        total: total.count,
        byStatus: byStatus.reduce((acc, row) => {
          acc[row.proc_status] = row.count;
          return acc;
        }, {}),
        lastProcessed
      };
    } catch (error) {
      console.error(`Error getting statistics for ${dbType}:`, error);
      return { total: 0, byStatus: {}, lastProcessed: 0 };
    }
  }

  /**
   * Close all database connections
   */
  closeAll() {
    for (const [key, db] of Object.entries(this.connections)) {
      try {
        db.close();
      } catch (error) {
        console.error(`Error closing database ${key}:`, error);
      }
    }
    this.connections = {};
  }
}

module.exports = { NostrLocalDBManager };

