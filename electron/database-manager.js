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
const { spawnSync } = require('child_process');

class DatabaseManager {
  constructor(options = {}) {
    this.connections = {};
    this.paths = this.getDatabasePaths();
    // Option to auto-apply migrations (disabled by default)
    // Set to true for GUI mode, false for external scripts
    this.autoApplyMigrations = options.autoApplyMigrations || false;
    this.migrationsApplied = new Set(); // Track which DBs have had migrations applied
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
      // Load migration runner from jsutils
      const migratedbPath = this.getMigratedbPath();
      if (!migratedbPath || !fs.existsSync(migratedbPath)) {
        console.warn(`Migration runner not found at ${migratedbPath}, skipping migrations`);
        return;
      }

      console.log(`Checking migrations for ${dbName}...`);
      
      // Determine which database type to migrate
      const dbArgMap = {
        'rhdata': '--rhdatadb',
        'patchbin': '--patchbindb',
        'clientdata': '--clientdata'
      };
      
      const dbArg = dbArgMap[dbName];
      if (!dbArg) {
        console.warn(`Unknown database type: ${dbName}, skipping migrations`);
        return;
      }

      // Set up environment for migration script
      // Migration script needs to find migration files in the correct location
      const env = { 
        ...process.env, 
        NODE_ENV: process.env.NODE_ENV || 'production',
        // Ensure migration script can find migration files
        ELECTRON_IS_PACKAGED: process.env.ELECTRON_IS_PACKAGED || (process.resourcesPath ? '1' : '0'),
      };
      
      // If we're in a packaged environment, set resourcesPath so migratedb can find files
      if (process.resourcesPath) {
        env.RESOURCES_PATH = process.resourcesPath;
      }

      // Run migration script with specific database
      // Use the directory containing migratedb.js as cwd, or fallback to project root
      const cwd = path.dirname(migratedbPath);
      const result = spawnSync(process.execPath, [migratedbPath, `${dbArg}=${dbPath}`, '--verbose'], {
        cwd: fs.existsSync(cwd) ? cwd : path.dirname(__dirname),
        env: env,
        stdio: 'pipe',
        encoding: 'utf8'
      });

      if (result.status === 0) {
        const output = result.stdout.toString();
        if (output.includes('already applied') || output.includes('already satisfied') || output.includes('Completed migration')) {
          console.log(`Migrations check completed for ${dbName}`);
        } else {
          console.log(`Migrations applied for ${dbName}`);
        }
      } else {
        const error = result.stderr.toString();
        console.warn(`Migration check for ${dbName} had issues:`, error || result.stdout.toString());
      }
    } catch (error) {
      console.error(`Error checking/applying migrations for ${dbName}:`, error.message);
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
      // Packaged paths
      process.resourcesPath ? path.join(process.resourcesPath, 'app.asar', 'jsutils', 'migratedb.js') : null,
      process.resourcesPath ? path.join(process.resourcesPath, 'app.asar.unpacked', 'jsutils', 'migratedb.js') : null,
      // Fallback paths
      path.join(__dirname, '..', '..', 'jsutils', 'migratedb.js'),
      // Absolute paths if resourcesPath is available
      process.resourcesPath ? path.join(process.resourcesPath, 'jsutils', 'migratedb.js') : null,
    ].filter(p => p !== null);

    for (const possiblePath of possiblePaths) {
      if (fs.existsSync(possiblePath)) {
        return possiblePath;
      }
    }

    console.warn('migratedb.js not found in any of these locations:', possiblePaths);
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

