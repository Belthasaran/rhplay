/**
 * Database Manager for RHTools Electron App
 * 
 * Manages connections to SQLite databases (rhdata.db, patchbin.db, clientdata.db)
 * Handles cross-platform paths and connection pooling
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { app } = require('electron');

class DatabaseManager {
  constructor(options = {}) {
    this.connections = {};
    this.paths = this.getDatabasePaths();
    // Option to auto-apply migrations (disabled by default)
    // Set to true for GUI mode, false for external scripts
    this.autoApplyMigrations = options.autoApplyMigrations || false;
    this.migrationsApplied = new Set(); // Track which DBs have had migrations applied
    this.trustDeclarationsImported = false;
    this.adminPublicKeysImported = false;
    this.tableColumnCache = {};
    console.log('Database paths:', this.paths);
    if (this.autoApplyMigrations) {
      console.log('Auto-apply migrations: ENABLED');
    }
  }

  /**
   * Get database file paths (cross-platform)
   * Supports environment variable overrides
   */
  getDatabasePaths() {
    const isDev = process.env.ELECTRON_START_URL || process.env.NODE_ENV === 'development';
    const isPackaged = process.env.ELECTRON_IS_PACKAGED || process.env.APPIMAGE;
    
    // Default paths
    let basePath;
    
    try {
      if (isDev || !app || !app.getPath) {
        // Development or testing: Use electron/ directory
        basePath = path.join(__dirname);
      } else {
        // Production: Use app user data directory
        // Windows: C:\Users\<User>\AppData\Roaming\rhtools\
        // Linux: ~/.config/rhtools/
        // macOS: ~/Library/Application Support/rhtools/
        basePath = app.getPath('userData');
        
        // Ensure directory exists
        if (!fs.existsSync(basePath)) {
          fs.mkdirSync(basePath, { recursive: true });
        }
      }
    } catch (error) {
      // Fallback for testing
      basePath = path.join(__dirname);
    }
    
    const paths = {
      rhdata: process.env.RHDATA_DB_PATH || path.join(basePath, 'rhdata.db'),
      patchbin: process.env.PATCHBIN_DB_PATH || path.join(basePath, 'patchbin.db'),
      clientdata: process.env.CLIENTDATA_DB_PATH || path.join(basePath, 'clientdata.db'),
      ratings: process.env.RATINGS_DB_PATH || path.join(basePath, 'ratings.db'),
      moderation: process.env.MODERATION_DB_PATH || path.join(basePath, 'moderation.db'),
    };
    
    // In packaged environment, handle external databases
    if (isPackaged && app && app.getPath) {
      this.handleExternalDatabases(paths);
    }
    
    return paths;
  }

  /**
   * Handle external databases in packaged environment
   * @param {Object} paths - Database paths object
   */
  handleExternalDatabases(paths) {
    // Check if external databases exist in user data directory
    const externalDbs = ['rhdata.db', 'patchbin.db'];
    const userDataDir = app.getPath('userData');
    
    for (const dbName of externalDbs) {
      const externalPath = path.join(userDataDir, dbName);
      if (fs.existsSync(externalPath)) {
        console.log(`Using external ${dbName} from user data directory`);
        paths[dbName.replace('.db', '')] = externalPath;
      } else {
        console.log(`External ${dbName} not found, will create empty database`);
        // Create empty database if external one doesn't exist
        this.createEmptyDatabase(paths[dbName.replace('.db', '')], dbName);
      }
    }
    
    // Always ensure clientdata.db exists (user-specific)
    if (!fs.existsSync(paths.clientdata)) {
      this.createEmptyDatabase(paths.clientdata, 'clientdata.db');
    }

    // Ensure ratings.db exists (user-specific)
    if (!fs.existsSync(paths.ratings)) {
      this.createEmptyDatabase(paths.ratings, 'ratings.db');
    }

    // Ensure moderation.db exists
    if (!fs.existsSync(paths.moderation)) {
      this.createEmptyDatabase(paths.moderation, 'moderation.db');
    }
  }

  /**
   * Create empty database file
   * @param {string} dbPath - Path to create database
   * @param {string} dbName - Name of database for logging
   */
  createEmptyDatabase(dbPath, dbName) {
    try {
      const db = new Database(dbPath);
      
      // Create basic tables based on database type
      if (dbName === 'clientdata.db') {
        db.exec(`
          CREATE TABLE IF NOT EXISTS csettings (
            csettinguid TEXT PRIMARY KEY,
            csetting_name TEXT UNIQUE,
            csetting_value TEXT
          );
        `);
        console.log(`Created empty ${dbName} with basic schema`);
      } else {
        // For rhdata.db and patchbin.db, create minimal schema
        db.exec(`
          CREATE TABLE IF NOT EXISTS info (
            key TEXT PRIMARY KEY,
            value TEXT
          );
          INSERT OR IGNORE INTO info (key, value) VALUES ('version', '1.0.0');
          INSERT OR IGNORE INTO info (key, value) VALUES ('created', '${new Date().toISOString()}');
        `);
        console.log(`Created empty ${dbName} with minimal schema`);
      }
      
      db.close();
    } catch (error) {
      console.error(`Failed to create empty ${dbName}:`, error);
    }
  }

  /**
   * Ensure packaged databases are copied to user data directory
   * @param {Object} paths - Database paths object
   */
  ensurePackagedDatabases(paths) {
    // Try multiple possible locations for packaged databases
    const possiblePaths = [
      path.join(process.resourcesPath, 'app.asar.unpacked', 'electron'),
      path.join(__dirname), // Fallback to current directory
      path.join(process.resourcesPath, 'electron')
    ];
    
    for (const [dbName, dbPath] of Object.entries(paths)) {
      if (!fs.existsSync(dbPath)) {
        let sourcePath = null;
        
        // Find the source database file
        for (const possiblePath of possiblePaths) {
          const testPath = path.join(possiblePath, `${dbName}.db`);
          if (fs.existsSync(testPath)) {
            sourcePath = testPath;
            break;
          }
        }
        
        if (sourcePath) {
          try {
            fs.copyFileSync(sourcePath, dbPath);
            console.log(`Copied ${dbName}.db from ${sourcePath} to ${dbPath}`);
          } catch (error) {
            console.error(`Failed to copy ${dbName}.db:`, error);
          }
        } else {
          console.warn(`Source database ${dbName}.db not found in packaged resources`);
        }
      }
    }
  }

  /**
   * Get or create database connection
   * @param {string} dbName - Database name (rhdata, patchbin, or clientdata)
   * @returns {Database} SQLite database connection
   */
  getConnection(dbName) {
    if (!this.connections[dbName]) {
      const dbPath = this.paths[dbName];
      
      // Ensure database exists
      this.ensureDatabaseExists(dbName, dbPath);
      
      // Auto-apply migrations if enabled and not already applied
      if (this.autoApplyMigrations && !this.migrationsApplied.has(dbName)) {
        this.checkAndApplyMigrations(dbName, dbPath);
        this.migrationsApplied.add(dbName);
      }
      
      // Create connection
      console.log(`Opening database: ${dbName} at ${dbPath}`);
      this.connections[dbName] = new Database(dbPath);
      
      // Enable WAL mode for better concurrency
      this.connections[dbName].pragma('journal_mode = WAL');
      
      // Store path for reference
      this.connections[dbName].dbPath = dbPath;

      if (dbName === 'clientdata') {
        if (!this.trustDeclarationsImported) {
          this.trustDeclarationsImported = true;
          this.autoImportTrustDeclarations(this.connections[dbName]);
        }
        if (!this.adminPublicKeysImported) {
          this.adminPublicKeysImported = true;
          this.autoImportAdminPublicKeys(this.connections[dbName]);
        }
      }

      // Additional database-specific initialization could go here
    }
    
    return this.connections[dbName];
  }

  /**
   * Check if migrations are needed and apply them
   * @param {string} dbName - Database name (rhdata, patchbin, or clientdata)
   * @param {string} dbPath - Path to database file
   */
  checkAndApplyMigrations(dbName, dbPath) {
    if (!fs.existsSync(dbPath)) {
      console.log(`Database ${dbName} does not exist, skipping migration check`);
      return;
    }

    try {
      console.log(`Checking migrations for ${dbName}...`);
      console.log(`Database path: ${dbPath}`);
      
      // Try to require the migration module directly (works from ASAR too)
      let migrateDb;
      try {
        // Try unpacked location first
        const unpackedPath = path.join(__dirname, '..', 'jsutils', 'migratedb.js');
        if (fs.existsSync(unpackedPath)) {
          migrateDb = require(unpackedPath);
        } else {
          // Try from resources path (packaged)
          const resourcesPath = process.resourcesPath || path.join(path.dirname(process.execPath), 'resources');
          const asarPath = path.join(resourcesPath, 'app.asar', 'jsutils', 'migratedb.js');
          const unpackedResourcesPath = path.join(resourcesPath, 'app.asar.unpacked', 'jsutils', 'migratedb.js');
          
          // Try unpacked first, then ASAR
          if (fs.existsSync(unpackedResourcesPath)) {
            migrateDb = require(unpackedResourcesPath);
          } else if (fs.existsSync(asarPath)) {
            // Can require from ASAR! Node.js handles it
            // Use require.resolve to get the proper path
            try {
              migrateDb = require(asarPath);
            } catch (e) {
              // If direct require fails, try relative path
              const relativePath = path.relative(__dirname, asarPath);
              migrateDb = require(relativePath.replace(/\\/g, '/'));
            }
          } else {
            // Fallback: try requiring as a module
            migrateDb = require('../jsutils/migratedb.js');
          }
        }
      } catch (requireError) {
        console.error(`Could not require migratedb.js: ${requireError.message}`);
        console.error(`Skipping migrations for ${dbName}`);
        return;
      }

      // Determine which database type to migrate
      const dbTypeMap = {
        'rhdata': 'rhdata',
        'patchbin': 'patchbin',
        'clientdata': 'clientdata'
      };
      
      const dbType = dbTypeMap[dbName];
      if (!dbType) {
        console.warn(`Unknown database type: ${dbName}, skipping migrations`);
        return;
      }

      // Set up environment for migrations
      if (process.resourcesPath) {
        process.env.RESOURCES_PATH = process.resourcesPath;
      }
      process.env.ELECTRON_IS_PACKAGED = process.env.ELECTRON_IS_PACKAGED || (process.resourcesPath ? '1' : '0');
      
      // Call migrations directly - NO SPAWNING
      const migrations = migrateDb.MIGRATIONS[dbType];
      if (migrations) {
        console.log(`Applying migrations directly for ${dbName}...`);
        migrateDb.applyMigrations(dbPath, migrations, { verbose: true });
        console.log(`Migrations completed for ${dbName}`);
      } else {
        console.warn(`No migrations found for ${dbType}`);
      }
      
    } catch (error) {
      console.error(`Error checking/applying migrations for ${dbName}:`, error.message);
      console.error(`Error stack: ${error.stack}`);
      // Don't throw - allow app to continue even if migrations fail
    }
  }

  /**
   * Get path to migratedb.js script
   * Handles both development and packaged environments
   * @returns {string|null} Path to migratedb.js or null if not found
   */
  getMigratedbPath() {
    // Try multiple possible locations
    const possiblePaths = [
      // Development path (relative to electron/)
      path.join(__dirname, '..', 'jsutils', 'migratedb.js'),
      // Packaged paths - Windows portable executable structure
      process.resourcesPath ? path.join(process.resourcesPath, 'app.asar.unpacked', 'jsutils', 'migratedb.js') : null,
      process.resourcesPath ? path.join(process.resourcesPath, 'jsutils', 'migratedb.js') : null,
      // Packaged paths - ASAR archive (if not unpacked)
      process.resourcesPath ? path.join(process.resourcesPath, 'app.asar', 'jsutils', 'migratedb.js') : null,
      // Windows portable executable might be in same dir as exe
      process.execPath ? path.join(path.dirname(process.execPath), 'resources', 'app.asar.unpacked', 'jsutils', 'migratedb.js') : null,
      process.execPath ? path.join(path.dirname(process.execPath), 'jsutils', 'migratedb.js') : null,
      // Fallback paths
      path.join(__dirname, '..', '..', 'jsutils', 'migratedb.js'),
      // Additional Windows paths
      process.execPath ? path.join(path.dirname(process.execPath), '..', 'app.asar.unpacked', 'jsutils', 'migratedb.js') : null,
    ].filter(p => p !== null);

    for (const possiblePath of possiblePaths) {
      try {
        if (fs.existsSync(possiblePath)) {
          console.log(`Found migratedb.js at: ${possiblePath}`);
          return possiblePath;
        }
      } catch (error) {
        // Continue to next path if this one fails
        continue;
      }
    }

    console.warn('migratedb.js not found in any of these locations:');
    possiblePaths.forEach(p => console.warn(`  - ${p}`));
    return null;
  }

  /**
   * Ensure database file exists, create with schema if needed
   * @param {string} dbName - Database name
   * @param {string} dbPath - Database file path
   */
  ensureDatabaseExists(dbName, dbPath) {
    if (fs.existsSync(dbPath)) {
      console.log(`Database ${dbName} exists at ${dbPath}`);
      return;
    }
    
    console.log(`Creating ${dbName} at ${dbPath}`);
    
    // Ensure directory exists
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    // Create empty database
    const db = new Database(dbPath);
    
    // Apply schema if available
    const schemaPath = path.join(__dirname, 'sql', `${dbName}.sql`);
    if (fs.existsSync(schemaPath)) {
      console.log(`Applying schema from ${schemaPath}`);
      const schema = fs.readFileSync(schemaPath, 'utf8');
      try {
        db.exec(schema);
        console.log(`Schema applied successfully for ${dbName}`);
      } catch (error) {
        console.error(`Error applying schema for ${dbName}:`, error);
      }
    } else {
      console.warn(`Schema file not found: ${schemaPath}`);
    }
    
    db.close();
  }

  /**
   * Close all database connections
   */
  closeAll() {
    console.log('Closing all database connections');
    Object.entries(this.connections).forEach(([name, db]) => {
      if (db) {
        console.log(`Closing ${name}`);
        db.close();
      }
    });
    this.connections = {};
  }

  /**
   * Attach clientdata.db to another database for JOIN queries
   * @param {Database} db - Database to attach to
   */
  attachClientData(db) {
    const clientDataPath = this.paths.clientdata;
    db.exec(`ATTACH DATABASE '${clientDataPath}' AS clientdata`);
  }

  /**
   * Detach clientdata.db
   * @param {Database} db - Database to detach from
   */
  detachClientData(db) {
    db.exec('DETACH DATABASE clientdata');
  }

  getTableColumns(db, tableName) {
    if (!this.tableColumnCache[tableName]) {
      try {
        const rows = db.prepare(`PRAGMA table_info(${tableName})`).all();
        this.tableColumnCache[tableName] = rows.map((row) => row.name);
      } catch (error) {
        console.warn(`Failed to fetch columns for table ${tableName}:`, error.message);
        this.tableColumnCache[tableName] = [];
      }
    }
    return this.tableColumnCache[tableName];
  }

  importTrustDeclarationsFromData(data, options = {}) {
    if (!data) {
      return { adminDeclarationsImported: 0, trustDeclarationsImported: 0 };
    }
    const db = options.db || this.getConnection('clientdata');
    const adminEntries = [];
    const legacyEntries = [];

    const addEntries = (entries, target) => {
      if (Array.isArray(entries)) {
        entries.forEach((entry) => {
          if (entry && typeof entry === 'object') {
            target.push(entry);
          }
        });
      }
    };

    if (Array.isArray(data)) {
      addEntries(data, adminEntries);
    } else if (typeof data === 'object') {
      addEntries(data.admindeclarations, adminEntries);
      addEntries(data.adminDeclarations, adminEntries);
      addEntries(data.declarations, adminEntries);
      addEntries(data.trust_declarations, legacyEntries);
      addEntries(data.trustDeclarations, legacyEntries);
      if (!adminEntries.length && Array.isArray(data.entries)) {
        addEntries(data.entries, adminEntries);
      }
    }

    const results = { adminDeclarationsImported: 0, trustDeclarationsImported: 0 };

    const sanitizeEntry = (entry, tableColumns) => {
      const sanitized = {};
      tableColumns.forEach((col) => {
        if (entry[col] !== undefined) {
          let value = entry[col];
          if (value && typeof value === 'object' && !Buffer.isBuffer(value)) {
            value = JSON.stringify(value);
          }
          sanitized[col] = value;
        }
      });
      return sanitized;
    };

    const insertEntries = (entries, tableName, keyField, counterKey) => {
      if (!entries.length) {
        return;
      }
      const columns = this.getTableColumns(db, tableName);
      if (!columns || !columns.length || !columns.includes(keyField)) {
        return;
      }
      const insertTransaction = db.transaction(() => {
        entries.forEach((entry) => {
          if (!entry || typeof entry !== 'object') {
            return;
          }
          const keyValue = entry[keyField];
          if (!keyValue) {
            return;
          }
          const existing = db.prepare(`SELECT 1 FROM ${tableName} WHERE ${keyField} = ?`).get(keyValue);
          if (existing) {
            return;
          }
          const sanitized = sanitizeEntry(entry, columns);
          if (!sanitized[keyField]) {
            return;
          }
          const cols = Object.keys(sanitized);
          if (!cols.length) {
            return;
          }
          const placeholders = cols.map(() => '?').join(', ');
          const values = cols.map((col) => sanitized[col]);
          const sql = `INSERT INTO ${tableName} (${cols.join(', ')}) VALUES (${placeholders})`;
          db.prepare(sql).run(values);
          results[counterKey] = (results[counterKey] || 0) + 1;
        });
      });
      insertTransaction();
    };

    insertEntries(adminEntries, 'admindeclarations', 'declaration_uuid', 'adminDeclarationsImported');
    insertEntries(legacyEntries, 'trust_declarations', 'declaration_uuid', 'trustDeclarationsImported');

    return results;
  }

  getTrustDeclarationFileCandidates(dbPath) {
    const candidates = [];
    const dbDir = dbPath ? path.dirname(dbPath) : null;
    if (dbDir) {
      candidates.push(path.join(dbDir, 'trustdecl.json'));
    }
    candidates.push(path.join(__dirname, 'trustdecl.json'));
    if (process.resourcesPath) {
      candidates.push(path.join(process.resourcesPath, 'trustdecl.json'));
      candidates.push(path.join(process.resourcesPath, 'app.asar.unpacked', 'trustdecl.json'));
      candidates.push(path.join(process.resourcesPath, 'electron', 'trustdecl.json'));
    }
    if (process.execPath) {
      candidates.push(path.join(path.dirname(process.execPath), 'trustdecl.json'));
    }
    return [...new Set(candidates)];
  }

  autoImportTrustDeclarations(db) {
    try {
      const candidates = this.getTrustDeclarationFileCandidates(db ? db.dbPath : this.paths.clientdata);
      const fs = require('fs');
      for (const candidate of candidates) {
        if (!candidate) {
          continue;
        }
        try {
          if (fs.existsSync(candidate)) {
            console.log(`Auto-importing trust declarations from ${candidate}`);
            const content = fs.readFileSync(candidate, 'utf8');
            const data = JSON.parse(content);
            const result = this.importTrustDeclarationsFromData(data, { db, source: candidate });
            console.log(`Trust declarations import summary: admindeclarations=${result.adminDeclarationsImported || 0}, legacy=${result.trustDeclarationsImported || 0}`);
            break;
          }
        } catch (fileError) {
          console.warn(`Failed to import trust declarations from ${candidate}:`, fileError.message);
          continue;
        }
      }
    } catch (error) {
      console.error('Error during automatic trust declarations import:', error);
    }
  }

  importAdminPublicKeysFromData(data, options = {}) {
    if (!data) {
      return { masterKeysImported: 0, adminKeysImported: 0, userOpKeysImported: 0, encryptionKeysImported: 0 };
    }

    const db = options.db || this.getConnection('clientdata');

    const normalizeArray = (value) => {
      if (!value) return [];
      if (Array.isArray(value)) return value;
      if (typeof value === 'object') return [value];
      return [];
    };

    const adminMasterEntries = [
      ...normalizeArray(data.admin_master_keys),
      ...normalizeArray(data.masterAdminKeys),
      ...normalizeArray(data.master_keys)
    ];

    const adminEntries = [
      ...normalizeArray(data.admin_keypairs),
      ...normalizeArray(data.adminKeypairs),
      ...normalizeArray(data.admin_keys)
    ];

    const userOpEntries = [
      ...normalizeArray(data.user_op_keypairs),
      ...normalizeArray(data.userOpKeypairs),
      ...normalizeArray(data.user_op_keys)
    ];

    const encryptionEntries = [
      ...normalizeArray(data.encryption_keys),
      ...normalizeArray(data.shared_preinstalled_keys)
    ];

    const results = {
      masterKeysImported: 0,
      adminKeysImported: 0,
      userOpKeysImported: 0,
      encryptionKeysImported: 0
    };

    const sanitizeEntry = (entry, tableColumns) => {
      const sanitized = {};
      tableColumns.forEach((col) => {
        if (entry[col] !== undefined) {
          let value = entry[col];
          if (value && typeof value === 'object' && !Buffer.isBuffer(value)) {
            value = JSON.stringify(value);
          }
          sanitized[col] = value;
        }
      });
      return sanitized;
    };

    const insertAdminKeypairs = (entries, counterKey, defaults = {}) => {
      if (!entries.length) {
        return;
      }
      const columns = this.getTableColumns(db, 'admin_keypairs');
      if (!columns.length || !columns.includes('keypair_uuid')) {
        return;
      }
      const insertTransaction = db.transaction((rows) => {
        rows.forEach((entry) => {
          if (!entry || typeof entry !== 'object') {
            return;
          }
          const keypairUuid = entry.keypair_uuid || entry.uuid;
          if (!keypairUuid) {
            return;
          }
          const existing = db.prepare(`SELECT 1 FROM admin_keypairs WHERE keypair_uuid = ?`).get(keypairUuid);
          if (existing) {
            return;
          }
          const sanitized = sanitizeEntry({ ...entry, keypair_uuid: keypairUuid }, columns);
          sanitized.key_usage = defaults.key_usage || sanitized.key_usage || null;
          sanitized.storage_status = 'public-only';
          sanitized.encrypted_private_key = null;
          sanitized.private_key_format = null;
          sanitized.profile_uuid = null;
          sanitized.created_at = sanitized.created_at || new Date().toISOString();
          sanitized.updated_at = sanitized.updated_at || new Date().toISOString();

          const cols = Object.keys(sanitized);
          if (!cols.length) {
            return;
          }
          const placeholders = cols.map(() => '?').join(', ');
          const values = cols.map((col) => sanitized[col]);
          const sql = `INSERT INTO admin_keypairs (${cols.join(', ')}) VALUES (${placeholders})`;
          db.prepare(sql).run(values);
          results[counterKey] = (results[counterKey] || 0) + 1;
        });
      });
      insertTransaction(entries);
    };

    const insertUserOpKeypairs = (entries) => {
      if (!entries.length) {
        return;
      }
      const columns = this.getTableColumns(db, 'profile_keypairs');
      if (!columns.length || !columns.includes('keypair_uuid')) {
        return;
      }
      const profileExistsStmt = db.prepare(`SELECT 1 FROM user_profiles WHERE profile_uuid = ?`);
      const insertTransaction = db.transaction((rows) => {
        rows.forEach((entry) => {
          if (!entry || typeof entry !== 'object') {
            return;
          }
          const keypairUuid = entry.keypair_uuid || entry.uuid;
          const profileUuid = entry.profile_uuid;
          if (!keypairUuid || !profileUuid) {
            return;
          }
          const existing = db.prepare(`SELECT 1 FROM profile_keypairs WHERE keypair_uuid = ?`).get(keypairUuid);
          if (existing) {
            return;
          }
          const profileExists = profileExistsStmt.get(profileUuid);
          if (!profileExists) {
            return;
          }
          const sanitized = sanitizeEntry({ ...entry, keypair_uuid: keypairUuid, profile_uuid: profileUuid }, columns);
          sanitized.storage_status = 'public-only';
          sanitized.encrypted_private_key = null;
          sanitized.private_key_format = null;
          sanitized.created_at = sanitized.created_at || new Date().toISOString();
          sanitized.updated_at = sanitized.updated_at || new Date().toISOString();

          const cols = Object.keys(sanitized);
          if (!cols.length) {
            return;
          }
          const placeholders = cols.map(() => '?').join(', ');
          const values = cols.map((col) => sanitized[col]);
          const sql = `INSERT INTO profile_keypairs (${cols.join(', ')}) VALUES (${placeholders})`;
          db.prepare(sql).run(values);
          results.userOpKeysImported += 1;
        });
      });
      insertTransaction(entries);
    };

    const insertEncryptionKeys = (entries) => {
      if (!entries.length) {
        return;
      }
      const columns = this.getTableColumns(db, 'encryption_keys');
      if (!columns.length || !columns.includes('key_uuid')) {
        return;
      }
      const insertTransaction = db.transaction((rows) => {
        rows.forEach((entry) => {
          if (!entry || typeof entry !== 'object') {
            return;
          }
          const keyUuid = entry.key_uuid || entry.uuid;
          if (!keyUuid) {
            return;
          }
          const keyType = entry.key_type || entry.keyType;
          if (keyType !== 'Shared Preinstalled') {
            return;
          }
          const existing = db.prepare(`SELECT 1 FROM encryption_keys WHERE key_uuid = ?`).get(keyUuid);
          if (existing) {
            return;
          }
          const sanitized = sanitizeEntry({ ...entry, key_uuid: keyUuid, key_type: 'Shared Preinstalled' }, columns);
          sanitized.key_type = 'Shared Preinstalled';
          sanitized.encrypted = sanitized.encrypted ? 1 : 0;
          sanitized.created_at = sanitized.created_at || new Date().toISOString();
          sanitized.updated_at = sanitized.updated_at || new Date().toISOString();

          const cols = Object.keys(sanitized);
          if (!cols.length) {
            return;
          }
          const placeholders = cols.map(() => '?').join(', ');
          const values = cols.map((col) => sanitized[col]);
          const sql = `INSERT INTO encryption_keys (${cols.join(', ')}) VALUES (${placeholders})`;
          db.prepare(sql).run(values);
          results.encryptionKeysImported += 1;
        });
      });
      insertTransaction(entries);
    };

    insertAdminKeypairs(adminMasterEntries, 'masterKeysImported', { key_usage: 'master-admin-signing' });
    insertAdminKeypairs(adminEntries, 'adminKeysImported');
    insertUserOpKeypairs(userOpEntries);
    insertEncryptionKeys(encryptionEntries);

    return results;
  }

  getAdminPublicKeysFileCandidates(dbPath) {
    const candidates = [];
    const dbDir = dbPath ? path.dirname(dbPath) : null;
    if (dbDir) {
      candidates.push(path.join(dbDir, 'adminkp_trust.json'));
    }
    candidates.push(path.join(__dirname, 'adminkp_trust.json'));
    if (process.resourcesPath) {
      candidates.push(path.join(process.resourcesPath, 'adminkp_trust.json'));
      candidates.push(path.join(process.resourcesPath, 'app.asar.unpacked', 'adminkp_trust.json'));
      candidates.push(path.join(process.resourcesPath, 'electron', 'adminkp_trust.json'));
    }
    if (process.execPath) {
      candidates.push(path.join(path.dirname(process.execPath), 'adminkp_trust.json'));
    }
    return [...new Set(candidates)];
  }

  autoImportAdminPublicKeys(db) {
    try {
      const candidates = this.getAdminPublicKeysFileCandidates(db ? db.dbPath : this.paths.clientdata);
      const fs = require('fs');
      for (const candidate of candidates) {
        if (!candidate) {
          continue;
        }
        try {
          if (fs.existsSync(candidate)) {
            console.log(`Auto-importing admin public keys from ${candidate}`);
            const content = fs.readFileSync(candidate, 'utf8');
            const data = JSON.parse(content);
            const result = this.importAdminPublicKeysFromData(data, { db, source: candidate });
            console.log(`Admin public keys import summary: master=${result.masterKeysImported || 0}, admin=${result.adminKeysImported || 0}, userOp=${result.userOpKeysImported || 0}, encryption=${result.encryptionKeysImported || 0}`);
            break;
          }
        } catch (fileError) {
          console.warn(`Failed to import admin public keys from ${candidate}:`, fileError.message);
          continue;
        }
      }
    } catch (error) {
      console.error('Error during automatic admin public keys import:', error);
    }
  }

  /**
   * Execute query with automatic clientdata attachment
   * @param {string} dbName - Primary database name
   * @param {Function} callback - Callback receives (db) and returns result
   * @returns {*} Result from callback
   */
  withClientData(dbName, callback) {
    const db = this.getConnection(dbName);
    try {
      this.attachClientData(db);
      const result = callback(db);
      return result;
    } finally {
      this.detachClientData(db);
    }
  }
}

module.exports = { DatabaseManager };

