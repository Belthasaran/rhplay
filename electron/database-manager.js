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
      console.log(`Checking migrations for ${dbName}...`);
      console.log(`Database path: ${dbPath}`);
      
      // Try to require the migration module directly (works from ASAR too)
      let migrateDbModule;
      try {
        // Try unpacked location first
        const unpackedPath = path.join(__dirname, '..', 'jsutils', 'migratedb.js');
        if (fs.existsSync(unpackedPath)) {
          migrateDbModule = require(unpackedPath);
        } else {
          // Try from resources path (packaged)
          const resourcesPath = process.resourcesPath || path.join(path.dirname(process.execPath), 'resources');
          const asarPath = path.join(resourcesPath, 'app.asar', 'jsutils', 'migratedb.js');
          const unpackedResourcesPath = path.join(resourcesPath, 'app.asar.unpacked', 'jsutils', 'migratedb.js');
          
          // Try unpacked first, then ASAR
          if (fs.existsSync(unpackedResourcesPath)) {
            migrateDbModule = require(unpackedResourcesPath);
          } else if (fs.existsSync(asarPath)) {
            // Can't require from ASAR directly, need to use require.resolve
            // Actually, we can require from ASAR! Node.js handles it
            migrateDbModule = require(path.relative(__dirname, asarPath).replace(/\\/g, '/'));
          } else {
            // Fallback: try requiring as a module
            migrateDbModule = require('../jsutils/migratedb.js');
          }
        }
      } catch (requireError) {
        console.warn(`Could not require migratedb.js: ${requireError.message}`);
        // Fallback to spawn method
        this.runMigrationViaSpawn(dbName, dbPath);
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

      // Import the migration functions directly from the module
      // The migratedb.js module exports functions, but we need to call its main logic
      // Let's check what it exports or call it programmatically
      this.applyMigrationsDirectly(dbName, dbPath, dbType);
      
    } catch (error) {
      console.error(`Error checking/applying migrations for ${dbName}:`, error.message);
      console.error(`Error stack: ${error.stack}`);
      // Don't throw - allow app to continue even if migrations fail
    }
  }

  /**
   * Apply migrations directly using the migratedb module
   * @param {string} dbName - Database name
   * @param {string} dbPath - Database path
   * @param {string} dbType - Database type for migration config
   */
  applyMigrationsDirectly(dbName, dbPath, dbType) {
    try {
      // Import the migration logic directly
      const migrateDb = require(path.join(__dirname, '..', 'jsutils', 'migratedb.js'));
      
      // The module should export a function we can call
      // But since it's a CLI script, we need to extract its logic
      // For now, let's use the spawn method as fallback but with better error handling
      this.runMigrationViaSpawn(dbName, dbPath);
    } catch (error) {
      console.error(`Error in applyMigrationsDirectly: ${error.message}`);
      this.runMigrationViaSpawn(dbName, dbPath);
    }
  }

  /**
   * Run migration via direct module require (preferred method)
   * @param {string} dbName - Database name
   * @param {string} dbPath - Database path
   */
  runMigrationViaSpawn(dbName, dbPath) {
    try {
      // Instead of spawning, require the migration module directly
      // This avoids the infinite recursion issue with process.execPath
      let migrateDb;
      try {
        // Try to require the module - works from ASAR too
        const migratedbPath = path.join(__dirname, '..', 'jsutils', 'migratedb.js');
        migrateDb = require(migratedbPath);
      } catch (requireError) {
        // Try alternative paths
        const resourcesPath = process.resourcesPath || path.join(path.dirname(process.execPath), 'resources');
        const possiblePaths = [
          path.join(resourcesPath, 'app.asar.unpacked', 'jsutils', 'migratedb.js'),
          path.join(resourcesPath, 'app.asar', 'jsutils', 'migratedb.js'),
        ];
        
        let found = false;
        for (const possiblePath of possiblePaths) {
          try {
            if (fs.existsSync(possiblePath)) {
              migrateDb = require(possiblePath);
              found = true;
              break;
            }
          } catch (e) {
            // Continue to next path
          }
        }
        
        if (!found) {
          throw new Error(`Could not require migratedb.js: ${requireError.message}`);
        }
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

      // Get the MIGRATIONS object from the module
      // The module exports MIGRATIONS, but we need to access it
      // Since it's not exported, we'll need to call applyMigrations directly
      // Let's use a workaround: temporarily modify process.argv to simulate CLI args
      const originalArgv = process.argv.slice();
      const originalEnv = { ...process.env };
      
      try {
        // Set up environment for migrations
        if (process.resourcesPath) {
          process.env.RESOURCES_PATH = process.resourcesPath;
        }
        process.env.ELECTRON_IS_PACKAGED = process.env.ELECTRON_IS_PACKAGED || (process.resourcesPath ? '1' : '0');
        
        // Call the migration logic directly
        // We need to access the internal functions - let's use a different approach
        // Actually, we can't easily access internal functions, so let's use fork instead
        // But fork also has the same issue...
        
        // Best solution: directly require and call the applyMigrations function
        // Since it's not exported, we need to refactor or use eval (not recommended)
        // Let's use a safer approach: spawn with 'node' from PATH as fallback
        // But first check if we're in Electron - if so, don't spawn at all
        
        // Actually, the safest is to directly evaluate the migration logic
        // But that's complex. Let's use a simpler approach: check if we can find node
        // and only spawn if we're not in a packaged Electron app
        
        if (process.versions.electron) {
          // We're in Electron - call migration logic directly
          // The module now exports applyMigrations
          const migrations = migrateDb.MIGRATIONS[dbType];
          if (migrations) {
            console.log(`Applying migrations directly for ${dbName}...`);
            migrateDb.applyMigrations(dbPath, migrations, { verbose: true });
            console.log(`Migrations completed for ${dbName}`);
          } else {
            console.warn(`No migrations found for ${dbType}`);
          }
        } else {
          // Not in Electron - safe to spawn
          const result = spawnSync('node', [require.resolve('../jsutils/migratedb.js'), `--${dbType}db=${dbPath}`, '--verbose'], {
            stdio: 'pipe',
            encoding: 'utf8'
          });
          
          const stdout = result.stdout ? result.stdout.toString() : '';
          const stderr = result.stderr ? result.stderr.toString() : '';
          
          if (result.status === 0) {
            console.log(`Migrations applied for ${dbName}`);
            if (stdout) {
              console.log(`Migration output: ${stdout.substring(0, 500)}`);
            }
          } else {
            console.error(`Migration check for ${dbName} failed`);
            if (stderr) console.error(`Migration stderr: ${stderr}`);
          }
        }
      } finally {
        // Restore original argv and env
        process.argv = originalArgv;
        Object.keys(process.env).forEach(key => {
          if (!(key in originalEnv)) {
            delete process.env[key];
          } else {
            process.env[key] = originalEnv[key];
          }
        });
      }
    } catch (error) {
      console.error(`Error in runMigrationViaSpawn: ${error.message}`);
      console.error(`Error stack: ${error.stack}`);
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

