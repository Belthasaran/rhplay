#!/usr/bin/env node

/**
 * migratedb.js
 *
 * Consolidated migration runner for rhdata.db, patchbin.db, and clientdata.db.
 * Ensures each database has a schema_migrations table, checks which migrations
 * have already been applied, and applies any outstanding migrations exactly once.
 *
 * Usage examples:
 *   ./enode.sh jsutils/migratedb.js
 *   ./enode.sh jsutils/migratedb.js --rhdatadb=/path/to/rhdata.db
 *   ./enode.sh jsutils/migratedb.js --clientdata=/path/to/clientdata.db --verbose
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const Database = require('better-sqlite3');

// Determine ROOT directory - handle both development and packaged environments
function getProjectRoot() {
  // In packaged environment, use RESOURCES_PATH if available
  const resourcesPath = process.env.RESOURCES_PATH || process.resourcesPath;
  
  // In packaged environment, we might be in app.asar or app.asar.unpacked
  // Look for electron/sql/migrations to determine the root
  const possibleRoots = [
    path.resolve(__dirname, '..'), // Development: parent of jsutils
    path.resolve(__dirname, '../..'), // Alternative structure
    resourcesPath ? path.join(resourcesPath, 'app.asar') : null,
    resourcesPath ? path.join(resourcesPath, 'app.asar.unpacked') : null,
  ].filter(p => p !== null);
  
  for (const root of possibleRoots) {
    const testPath = path.join(root, 'electron', 'sql', 'migrations');
    if (fs.existsSync(testPath)) {
      return root;
    }
  }
  
  // Fallback to parent of jsutils
  return path.resolve(__dirname, '..');
}

const ROOT = getProjectRoot();

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const trimmed = arg.slice(2);
    if (trimmed === 'help' || trimmed === 'h') {
      args.help = true;
      continue;
    }
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex >= 0) {
      const key = trimmed.slice(0, eqIndex);
      const value = trimmed.slice(eqIndex + 1);
      args[key] = value;
    } else {
      const key = trimmed;
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        args[key] = next;
        i += 1;
      } else {
        args[key] = true;
      }
    }
  }
  return args;
}

function printUsage() {
  console.log(`Usage: migratedb.js [options]\n\n` +
    `Options:\n` +
    `  --rhdatadb=PATH     Path to rhdata.db (default: electron/rhdata.db)\n` +
    `  --patchbindb=PATH   Path to patchbin.db (default: electron/patchbin.db)\n` +
    `  --clientdata=PATH   Path to clientdata.db (default: electron/clientdata.db)\n` +
    `  --resourcedb=PATH   Path to resource.db (default: electron/resource.db)\n` +
    `  --screenshotdb=PATH Path to screenshot.db (default: electron/screenshot.db)\n` +
    `  --verbose           Print detailed progress\n` +
    `  --help              Show this help text\n`);
}

function resolveRelativeAppData(...segments) {
  const resolved = path.resolve(process.env("APPDATA"), ...segments);
  // In packaged environment, try both asar and unpacked locations
  if (!fs.existsSync(resolved) && process.resourcesPath) {
    // Try unpacked location
    const unpackedPath = path.join(process.resourcesPath, 'app.asar.unpacked', ...segments);
    if (fs.existsSync(unpackedPath)) {
      return unpackedPath;
    }
    // Try asar location
    const asarPath = path.join(process.resourcesPath, 'app.asar', ...segments);
    if (fs.existsSync(asarPath)) {
      return asarPath;
    }
  }
  return resolved;
}


function resolveRelative(...segments) {
  const resolved = path.resolve(ROOT, ...segments);
  // In packaged environment, try both asar and unpacked locations
  if (!fs.existsSync(resolved) && process.resourcesPath) {
    // Try unpacked location
    const unpackedPath = path.join(process.resourcesPath, 'app.asar.unpacked', ...segments);
    if (fs.existsSync(unpackedPath)) {
      return unpackedPath;
    }
    // Try asar location
    const asarPath = path.join(process.resourcesPath, 'app.asar', ...segments);
    if (fs.existsSync(asarPath)) {
      return asarPath;
    }
  }
  return resolved;
}

function fileExists(p) {
  try {
    fs.accessSync(p, fs.constants.F_OK);
    return true;
  } catch (err) {
    return false;
  }
}

function ensureDatabaseFile(dbPath) {
  if (!dbPath) {
    return;
  }
  const dir = path.dirname(dbPath);
  if (!fileExists(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fileExists(dbPath)) {
    const db = new Database(dbPath);
    db.close();
  }
}

function ensureMigrationTable(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id TEXT PRIMARY KEY,
    description TEXT,
    applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );`);
}

function hasMigration(db, id) {
  const row = db.prepare('SELECT 1 FROM schema_migrations WHERE id = ?').get(id);
  return !!row;
}

function recordMigration(db, id, description) {
  db.prepare('INSERT INTO schema_migrations(id, description) VALUES (?, ?)').run(id, description || null);
}

function tableExists(db, table) {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
  return !!row;
}

function columnExists(db, table, column) {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all();
  return rows.some((row) => row.name.toLowerCase() === column.toLowerCase());
}

function getColumn(db, table, column) {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all();
  return rows.find((row) => row.name.toLowerCase() === column.toLowerCase()) || null;
}

function ensureColumn(db, table, column, definition) {
  if (!columnExists(db, table, column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function ensureTranslevelsStructures(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS gameversions_translevels (
    gvtuuid varchar(255) primary key DEFAULT (lower(hex(randomblob(16)))),
    gvuuid varchar(255) NOT NULL REFERENCES gameversions(gvuuid) ON DELETE CASCADE,
    translevel TEXT NOT NULL,
    level_number TEXT,
    locations TEXT,
    events TEXT,
    created_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(gvuuid, translevel)
  );`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_gameversions_translevels_gvuuid
    ON gameversions_translevels(gvuuid);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_gameversions_translevels_translevel
    ON gameversions_translevels(translevel);`);
  db.exec(`CREATE TRIGGER IF NOT EXISTS trg_gameversions_translevels_updated
    AFTER UPDATE ON gameversions_translevels
  BEGIN
    UPDATE gameversions_translevels
    SET updated_time = CURRENT_TIMESTAMP
    WHERE gvtuuid = NEW.gvtuuid;
  END;`);
}

function ensureRhpakagesStructures(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS rhpaks (
    rhpakuuid TEXT PRIMARY KEY,
    jsfilename VARCHAR(255) NOT NULL,
    name TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );`);
  db.exec(`CREATE TRIGGER IF NOT EXISTS trg_rhpaks_updated
    AFTER UPDATE ON rhpaks
  BEGIN
    UPDATE rhpaks
    SET updated_at = CURRENT_TIMESTAMP
    WHERE rhpakuuid = NEW.rhpakuuid;
  END;`);
}

// Export applyMigrations for use by Electron app
function applyMigrationsForDatabase(dbPath, migrations, options = {}) {
  return applyMigrations(dbPath, migrations, options);
}

const MIGRATIONS = {
  rhdata: [
    {
      id: 'rhdata_001_add_fields_type_raw_difficulty',
      description: 'Add fields_type/raw_difficulty columns',
      type: 'sql',
      file: resolveRelative('electron/sql/migrations/001_add_fields_type_raw_difficulty.sql'),
      skipIf(db) {
        return columnExists(db, 'gameversions', 'fields_type') && columnExists(db, 'gameversions', 'raw_difficulty');
      },
    },
    {
      id: 'rhdata_002_add_combinedtype',
      description: 'Add combinedtype column',
      type: 'sql',
      file: resolveRelative('electron/sql/migrations/002_add_combinedtype.sql'),
      skipIf(db) {
        return columnExists(db, 'gameversions', 'combinedtype');
      },
    },
    {
      id: 'rhdata_003_backfill_combinedtype',
      description: 'Backfill combinedtype values',
      type: 'js',
      file: resolveRelative('electron/sql/migrations/003_backfill_combinedtype.js'),
    },
    {
      id: 'rhdata_004_add_local_resource_tracking',
      description: 'Add local resource tracking columns',
      type: 'sql',
      file: resolveRelative('electron/sql/migrations/004_add_local_resource_tracking.sql'),
      skipIf(db) {
        return columnExists(db, 'gameversions', 'local_resource_etag')
          && columnExists(db, 'gameversions', 'local_resource_lastmodified')
          && columnExists(db, 'gameversions', 'local_resource_filename');
      },
    },
    {
      id: 'rhdata_005_add_local_runexcluded',
      description: 'Add local_runexcluded column',
      type: 'sql',
      file: resolveRelative('electron/sql/migrations/005_add_local_runexcluded.sql'),
      skipIf(db) {
        return columnExists(db, 'gameversions', 'local_runexcluded');
      },
    },
    {
      id: 'rhdata_009_add_levelnames_tables',
      description: 'Create levelnames + gameversion_levelnames tables',
      type: 'sql',
      file: resolveRelative('electron/sql/migrations/009_add_levelnames_tables.sql'),
      skipIf(db) {
        return tableExists(db, 'levelnames');
      },
    },
    {
      id: 'rhdata_010_add_level_metadata_columns',
      description: 'Add lmlevels/detectedlevels columns and translevels table',
      type: 'function',
      apply(db) {
        ensureColumn(db, 'gameversions', 'lmlevels', 'TEXT');
        ensureColumn(db, 'gameversions', 'detectedlevels', 'TEXT');
        ensureTranslevelsStructures(db);
      },
    },
    {
      id: 'rhdata_011_add_contest_racelevel',
      description: 'Add contest and racelevel columns to gameversions',
      type: 'sql',
      file: resolveRelative('electron/sql/migrations/010_add_contest_racelevel_to_gameversions.sql'),
      skipIf(db) {
        return columnExists(db, 'gameversions', 'contest')
          && columnExists(db, 'gameversions', 'racelevel');
      },
    },
    {
      id: 'rhdata_012_populate_contest_racelevel',
      description: 'Populate contest and racelevel from gvjsondata JSON',
      type: 'js',
      file: resolveRelative('electron/sql/migrations/011_populate_contest_racelevel_from_json.js'),
    },
    {
      id: 'rhdata_013_add_rhpakuuid_support',
      description: 'Add rhpakuuid columns and rhpaks table',
      type: 'function',
      apply(db) {
        ensureColumn(db, 'gameversions', 'rhpakuuid', 'TEXT');
        ensureColumn(db, 'gameversion_stats', 'rhpakuuid', 'TEXT');
        ensureColumn(db, 'patchblobs', 'rhpakuuid', 'TEXT');
        ensureColumn(db, 'patchblobs_extended', 'rhpakuuid', 'TEXT');
        ensureColumn(db, 'rhpatches', 'rhpakuuid', 'TEXT');
        ensureRhpakagesStructures(db);
      },
    },
  ],
  clientdata: [
    {
      id: 'clientdata_001_user_annotations',
      description: 'Create user annotations tables',
      type: 'sql',
      file: resolveRelative('electron/sql/migrations/001_clientdata_user_annotations.sql'),
    },
    {
      id: 'clientdata_002_enhanced_ratings_runs',
      description: 'Enhance ratings and run tracking tables',
      type: 'sql',
      file: resolveRelative('electron/sql/migrations/002_clientdata_enhanced_ratings_and_runs.sql'),
      skipIf(db) {
        return columnExists(db, 'user_game_annotations', 'user_difficulty_rating')
          && columnExists(db, 'user_game_annotations', 'user_review_rating')
          && columnExists(db, 'user_game_annotations', 'exclude_from_random')
          && tableExists(db, 'user_game_version_annotations');
      },
    },
    {
      id: 'clientdata_003_skill_rating_conditions',
      description: 'Add skill rating + conditions support',
      type: 'sql',
      file: resolveRelative('electron/sql/migrations/003_clientdata_skill_rating_and_conditions.sql'),
      skipIf(db) {
        return columnExists(db, 'user_game_annotations', 'user_skill_rating')
          && columnExists(db, 'user_game_version_annotations', 'user_skill_rating')
          && columnExists(db, 'user_stage_annotations', 'user_skill_rating')
          && columnExists(db, 'runs', 'global_conditions')
          && columnExists(db, 'run_plan_entries', 'conditions')
          && columnExists(db, 'run_results', 'conditions');
      },
    },
    {
      id: 'clientdata_004_fix_run_results_gameid',
      description: 'Fix run_results gameid nullable constraint',
      type: 'sql',
      file: resolveRelative('electron/sql/migrations/004_clientdata_fix_run_results_gameid.sql'),
      skipIf(db) {
        const column = getColumn(db, 'run_results', 'gameid');
        return column && column.notnull === 0;
      },
    },
    {
      id: 'clientdata_005_add_sfcpath_to_run_results',
      description: 'Add sfcpath to run_results',
      type: 'sql',
      file: resolveRelative('electron/sql/migrations/005_add_sfcpath_to_run_results.sql'),
      skipIf(db) {
        return columnExists(db, 'run_results', 'sfcpath');
      },
    },
    {
      id: 'clientdata_006_seed_mappings',
      description: 'Seed mapping support tables',
      type: 'sql',
      file: resolveRelative('electron/sql/migrations/006_clientdata_seed_mappings.sql'),
    },
    {
      id: 'clientdata_007_pause_and_staging',
      description: 'Pause/staging workflow support',
      type: 'sql',
      file: resolveRelative('electron/sql/migrations/007_clientdata_pause_and_staging.sql'),
      skipIf(db) {
        const runsHas = columnExists(db, 'runs', 'pause_seconds')
          && columnExists(db, 'runs', 'pause_start')
          && columnExists(db, 'runs', 'pause_end')
          && columnExists(db, 'runs', 'staging_folder');
        const resultsHas = columnExists(db, 'run_results', 'pause_seconds')
          && columnExists(db, 'run_results', 'pause_start')
          && columnExists(db, 'run_results', 'pause_end');
        return runsHas && resultsHas;
      },
    },
    {
      id: 'clientdata_008_snes_contents_cache',
      description: 'SNES contents cache tables',
      type: 'sql',
      file: resolveRelative('electron/sql/migrations/008_clientdata_snes_contents_cache.sql'),
    },
    {
      id: 'clientdata_012_extended_ratings',
      description: 'Add extended rating columns for detailed reviews',
      type: 'sql',
      file: resolveRelative('electron/sql/migrations/012_add_extended_ratings_to_clientdata.sql'),
      skipIf(db) {
        return columnExists(db, 'user_game_annotations', 'user_recommendation_rating')
          && columnExists(db, 'user_game_annotations', 'user_importance_rating')
          && columnExists(db, 'user_game_annotations', 'user_technical_quality_rating')
          && columnExists(db, 'user_game_annotations', 'user_gameplay_design_rating')
          && columnExists(db, 'user_game_annotations', 'user_originality_rating')
          && columnExists(db, 'user_game_annotations', 'user_visual_aesthetics_rating')
          && columnExists(db, 'user_game_annotations', 'user_story_rating')
          && columnExists(db, 'user_game_annotations', 'user_soundtrack_graphics_rating');
      },
    },
    {
      id: 'clientdata_013_skill_rating_when_beat',
      description: 'Add skill rating when beat column',
      type: 'sql',
      file: resolveRelative('electron/sql/migrations/013_add_skill_rating_when_beat.sql'),
      skipIf(db) {
        return columnExists(db, 'user_game_annotations', 'user_skill_rating_when_beat')
          && columnExists(db, 'user_game_version_annotations', 'user_skill_rating_when_beat');
      },
    },
    {
      id: 'clientdata_014_rating_comments',
      description: 'Add rating comment columns',
      type: 'sql',
      file: resolveRelative('electron/sql/migrations/014_add_rating_comments_to_clientdata.sql'),
      skipIf(db) {
        return columnExists(db, 'user_game_annotations', 'user_review_comment')
          && columnExists(db, 'user_game_annotations', 'user_recommendation_comment')
          && columnExists(db, 'user_game_version_annotations', 'user_review_comment');
      },
    },
    {
      id: 'clientdata_015_admin_keypairs',
      description: 'Add admin keypairs table',
      type: 'sql',
      file: resolveRelative('electron/sql/migrations/015_clientdata_admin_keypairs.sql'),
      skipIf(db) {
        return tableExists(db, 'admin_keypairs');
      },
    },
    {
      id: 'clientdata_016_admindeclarations',
      description: 'Add admin declarations table',
      type: 'sql',
      file: resolveRelative('electron/sql/migrations/016_clientdata_admindeclarations.sql'),
      skipIf(db) {
        return tableExists(db, 'admindeclarations');
      },
    },
    {
      id: 'clientdata_017_admin_keypair_name_label_comments',
      description: 'Add name, label, and comments columns to admin_keypairs',
      type: 'sql',
      file: resolveRelative('electron/sql/migrations/017_add_admin_keypair_name_label_comments.sql'),
      skipIf(db) {
        return columnExists(db, 'admin_keypairs', 'name')
          && columnExists(db, 'admin_keypairs', 'label')
          && columnExists(db, 'admin_keypairs', 'comments');
      },
    },
    {
      id: 'clientdata_018_admin_keypair_profile_uuid',
      description: 'Add profile_uuid column to admin_keypairs to distinguish User Op keys from global admin keypairs',
      type: 'sql',
      file: resolveRelative('electron/sql/migrations/018_add_admin_keypair_profile_uuid.sql'),
      skipIf(db) {
        return columnExists(db, 'admin_keypairs', 'profile_uuid');
      },
    },
    {
      id: 'clientdata_019_encryption_keys',
      description: 'Add encryption_keys table for symmetric encryption keys (AES256/AES128)',
      type: 'sql',
      file: resolveRelative('electron/sql/migrations/019_clientdata_encryption_keys.sql'),
      skipIf(db) {
        return tableExists(db, 'encryption_keys');
      },
    },
    {
      id: 'clientdata_020_trust_declarations',
      description: 'Add trust_declarations table for managing trust declarations for public keys',
      type: 'sql',
      file: resolveRelative('electron/sql/migrations/020_clientdata_trust_declarations.sql'),
      skipIf(db) {
        return tableExists(db, 'trust_declarations');
      },
    },
    {
      id: 'clientdata_021_admindeclarations_updates',
      description: 'Add status, Nostr publishing, update tracking, and schema versioning to admindeclarations table',
      type: 'sql',
      file: resolveRelative('electron/sql/migrations/021_clientdata_admindeclarations_updates.sql'),
      skipIf(db) {
        return columnExists(db, 'admindeclarations', 'status')
          && columnExists(db, 'admindeclarations', 'schema_version')
          && columnExists(db, 'admindeclarations', 'nostr_event_id')
          && columnExists(db, 'admindeclarations', 'original_declaration_uuid');
      },
    },
    {
      id: 'clientdata_022_admindeclarations_signing_fields',
      description: 'Add signed_data, signed_data_sha256, signing_timestamp, and canonical_name fields to admindeclarations table',
      type: 'sql',
      file: resolveRelative('electron/sql/migrations/022_clientdata_admindeclarations_signing_fields.sql'),
      skipIf(db) {
        return columnExists(db, 'admindeclarations', 'signed_data')
          && columnExists(db, 'admindeclarations', 'signed_data_sha256')
          && columnExists(db, 'admindeclarations', 'signing_timestamp')
          && columnExists(db, 'admindeclarations', 'signing_keypair_canonical_name');
      },
    },
    {
      id: 'clientdata_023_admindeclarations_nostr_event_fields',
      description: 'Add Nostr event serialization fields (public_key, created_at, content) to admindeclarations table',
      type: 'sql',
      file: resolveRelative('electron/sql/migrations/023_clientdata_admindeclarations_nostr_event_fields.sql'),
      skipIf(db) {
        return columnExists(db, 'admindeclarations', 'nostr_public_key')
          && columnExists(db, 'admindeclarations', 'nostr_created_at')
          && columnExists(db, 'admindeclarations', 'nostr_content');
      },
    },
    {
      id: 'clientdata_024_admin_keypairs_nostr_fields',
      description: 'Add nostr_event_id and nostr_status columns to admin_keypairs table for Nostr publishing',
      type: 'sql',
      file: resolveRelative('electron/sql/migrations/024_clientdata_admin_keypairs_nostr_fields.sql'),
      skipIf(db) {
        return columnExists(db, 'admin_keypairs', 'nostr_event_id')
          && columnExists(db, 'admin_keypairs', 'nostr_status');
      },
    },
    /*{  PLEASEFIX: This migration should be called from somewhere else, since   nostr_raw_events is not a table in clientsettings.db
     *   nostraw_raw_events tables are in various databases created dynamically.
     *    nostr_cache_in.db  nostr_cache_out.db  nostr_store_in.db  nostr_store_out.db
     *    nostr_archive_01.db nostr_archive_02.db ... nostr_archive_xx.db  etc.
     *    Therefore, nostr_raw_events migrations   need special handling.
     *
      id: 'clientdata_025_nostr_raw_events_table_metadata',
      description: 'Add table_name, record_uuid, and user_profile_uuid columns to nostr_raw_events table',
      type: 'sql',
      file: resolveRelative('electron/sql/migrations/025_nostr_raw_events_table_metadata.sql'),
      skipIf(db) {
        return columnExists(db, 'nostr_raw_events', 'table_name')
          && columnExists(db, 'nostr_raw_events', 'record_uuid')
          && columnExists(db, 'nostr_raw_events', 'user_profile_uuid');
      },
    },*/
    {
      id: 'clientdata_026_add_difficulty_skill_comments',
      description: 'Add user_difficulty_comment, user_skill_comment, and user_skill_comment_when_beat columns to user_game_annotations and user_game_version_annotations',
      type: 'sql',
      file: resolveRelative('electron/sql/migrations/026_add_difficulty_skill_comments.sql'),
      skipIf(db) {
        return columnExists(db, 'user_game_annotations', 'user_difficulty_comment')
          && columnExists(db, 'user_game_annotations', 'user_skill_comment')
          && columnExists(db, 'user_game_annotations', 'user_skill_comment_when_beat');
      },
    },
    {
      id: 'clientdata_027_allow_zero_stars_for_difficulty_review',
      description: 'Update CHECK constraints to allow 0 stars for user_difficulty_rating and user_review_rating (0-5 instead of 1-5)',
      type: 'sql',
      file: resolveRelative('electron/sql/migrations/027_allow_zero_stars_for_difficulty_review.sql'),
      skipIf(db) {
        // CRITICAL: Check if constraints already allow 0 to avoid unnecessary table recreation
        // This is important because:
        // 1. Large tables would take a long time to recreate
        // 2. Users may have custom columns not in the migration
        // 3. Table recreation is risky and should be avoided if possible
        
        try {
          // Test if we can insert a 0 value into user_difficulty_rating
          // This will fail if the constraint doesn't allow 0
          const testGameId = '__migration_test_027';
          
          // Check if test row already exists (from previous failed migration attempt)
          const existingTest = db.prepare('SELECT gameid FROM user_game_annotations WHERE gameid = ?').get(testGameId);
          if (existingTest) {
            // Clean up any leftover test row
            db.prepare('DELETE FROM user_game_annotations WHERE gameid = ?').run(testGameId);
          }
          
          // Try to insert a row with 0 rating - this will fail if constraint doesn't allow 0
          const insertStmt = db.prepare(`
            INSERT INTO user_game_annotations (gameid, user_difficulty_rating, user_review_rating)
            VALUES (?, 0, 0)
          `);
          
          insertStmt.run(testGameId);
          
          // If we get here, the constraint allows 0 - migration already applied
          // Clean up test row
          db.prepare('DELETE FROM user_game_annotations WHERE gameid = ?').run(testGameId);
          
          // Also test user_game_version_annotations if it exists
          if (tableExists(db, 'user_game_version_annotations')) {
            const existingTestVersion = db.prepare('SELECT gameid, version FROM user_game_version_annotations WHERE gameid = ? AND version = ?').get(testGameId, 999);
            if (existingTestVersion) {
              db.prepare('DELETE FROM user_game_version_annotations WHERE gameid = ? AND version = ?').run(testGameId, 999);
            }
            
            const insertVersionStmt = db.prepare(`
              INSERT INTO user_game_version_annotations (gameid, version, user_difficulty_rating, user_review_rating)
              VALUES (?, 999, 0, 0)
            `);
            
            insertVersionStmt.run(testGameId);
            db.prepare('DELETE FROM user_game_version_annotations WHERE gameid = ? AND version = ?').run(testGameId, 999);
          }
          
          // Constraints already allow 0 - skip migration
          return true;
        } catch (err) {
          // If insert fails, constraint doesn't allow 0 - migration needed
          // Clean up any partial test row just in case
          try {
            db.prepare('DELETE FROM user_game_annotations WHERE gameid = ?').run('__migration_test_027');
            db.prepare('DELETE FROM user_game_version_annotations WHERE gameid = ? AND version = ?').run('__migration_test_027', 999);
          } catch (cleanupErr) {
            // Ignore cleanup errors
          }
          return false;
        }
      },
    },
    {
      id: 'clientdata_028_user_profiles',
      description: 'Create user_profiles table for storing profile JSON and Nostr version',
      type: 'sql',
      file: resolveRelative('electron/sql/migrations/028_clientdata_user_profiles.sql'),
      skipIf(db) {
        return tableExists(db, 'user_profiles');
      },
    },
    {
      id: 'clientdata_029_profile_keypairs',
      description: 'Create profile_keypairs table (mirrors admin_keypairs structure)',
      type: 'sql',
      file: resolveRelative('electron/sql/migrations/029_clientdata_profile_keypairs.sql'),
      skipIf(db) {
        return tableExists(db, 'profile_keypairs');
      },
    },
    {
      id: 'clientdata_030_nostr_relays',
      description: 'Create nostr_relays table for relay catalog and metadata',
      type: 'sql',
      file: resolveRelative('electron/sql/migrations/030_clientdata_nostr_relays.sql'),
      skipIf(db) {
        return tableExists(db, 'nostr_relays');
      },
    },
    {
      id: 'clientdata_031_admindeclarations_target_hex',
      description: 'Add target_keypair_public_hex column to admindeclarations',
      type: 'sql',
      file: resolveRelative('electron/sql/migrations/031_clientdata_admindeclarations_target_hex.sql'),
      skipIf(db) {
        return columnExists(db, 'admindeclarations', 'target_keypair_public_hex');
      },
    },
  ],
  patchbin: [
    {
      id: 'patchbin_001_add_rhpakuuid',
      description: 'Add rhpakuuid column to attachments table',
      type: 'function',
      apply(db) {
        ensureColumn(db, 'attachments', 'rhpakuuid', 'TEXT');
      },
    },
  ],
  resource: [
    {
      id: 'resource_001_create_res_attachments',
      description: 'Create res_attachments table for prepared resources',
      type: 'sql',
      file: resolveRelative('electron/sql/migrations/resource_001_create_res_attachments.sql')
    },
    {
      id: 'resource_002_add_rhpakuuid',
      description: 'Add rhpakuuid column to res_attachments',
      type: 'function',
      apply(db) {
        ensureColumn(db, 'res_attachments', 'rhpakuuid', 'TEXT');
      },
    }
  ],
  screenshot: [
    {
      id: 'screenshot_001_create_res_screenshots',
      description: 'Create res_screenshots table for prepared screenshots',
      type: 'sql',
      file: resolveRelative('electron/sql/migrations/screenshot_001_create_res_screenshots.sql')
    },
    {
      id: 'screenshot_002_add_rhpakuuid',
      description: 'Add rhpakuuid column to res_screenshots',
      type: 'function',
      apply(db) {
        ensureColumn(db, 'res_screenshots', 'rhpakuuid', 'TEXT');
      },
    }
  ],
};

function runSqlMigration(db, file) {
  const sqlPath = path.resolve(file);
  if (!fileExists(sqlPath)) {
    throw new Error(`SQL migration file not found: ${sqlPath}`);
  }
  const sql = fs.readFileSync(sqlPath, 'utf8');
  db.exec('BEGIN');
  try {
    db.exec(sql);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function runJsMigration(dbPath, file) {
  const scriptPath = path.resolve(file);
  if (!fileExists(scriptPath)) {
    throw new Error(`JS migration file not found: ${scriptPath}`);
  }
  
  // In Electron, process.execPath is the Electron executable, not Node.js
  // This causes infinite recursion. We need to require the module directly instead.
  if (process.versions.electron) {
    // We're in Electron - require the module directly instead of spawning
    console.log(`Running JS migration directly: ${scriptPath}`);
    
    // Set up environment variables for the migration script
    const originalRhd = process.env.RHDATA_DB_PATH;
    const originalDb = process.env.DB_PATH;
    try {
      if (dbPath.includes('rhdata.db')) {
        process.env.RHDATA_DB_PATH = dbPath;
        delete process.env.DB_PATH; // Clear DB_PATH if it exists
      } else {
        process.env.DB_PATH = dbPath;
        delete process.env.RHDATA_DB_PATH; // Clear RHDATA_DB_PATH if it exists
      }
      
      // Require and execute the migration script
      delete require.cache[require.resolve(scriptPath)]; // Clear cache to allow re-running
      require(scriptPath);
      
      console.log(`JS migration completed: ${scriptPath}`);
    } finally {
      // Restore original environment
      if (originalRhd !== undefined) {
        process.env.RHDATA_DB_PATH = originalRhd;
      } else {
        delete process.env.RHDATA_DB_PATH;
      }
      if (originalDb !== undefined) {
        process.env.DB_PATH = originalDb;
      } else {
        delete process.env.DB_PATH;
      }
    }
  } else {
    // Not in Electron - safe to spawn
    const env = { ...process.env };
    if (dbPath.includes('rhdata.db')) {
      env.RHDATA_DB_PATH = dbPath;
    } else {
      env.DB_PATH = dbPath;
    }
    const result = spawnSync(process.execPath, [scriptPath], { env, stdio: 'inherit' });
    if (result.status !== 0) {
      throw new Error(`JS migration ${scriptPath} failed with exit code ${result.status}`);
    }
  }
}

function applyMigrations(dbPath, migrations, options = {}) {
  if (!migrations || migrations.length === 0) {
    if (options.verbose) {
      console.log(`No migrations registered for ${dbPath}`);
    }
    return;
  }

  if (!fileExists(dbPath)) {
    console.warn(`⚠️  Database not found, skipping: ${dbPath}`);
    return;
  }

  let db = new Database(dbPath);
  ensureMigrationTable(db);

  for (const migration of migrations) {
    if (hasMigration(db, migration.id)) {
      if (options.verbose) {
        console.log(`▶︎ ${path.basename(dbPath)} — ${migration.id} already applied`);
      }
      continue;
    }

    if (migration.skipIf && migration.skipIf(db)) {
      if (options.verbose) {
        console.log(`▶︎ ${path.basename(dbPath)} — ${migration.id} already satisfied`);
      }
      recordMigration(db, migration.id, migration.description);
      continue;
    }

    const label = `${path.basename(dbPath)} — ${migration.id}`;
    console.log(`
Applying migration: ${label}`);
    if (migration.description) {
      console.log(`  ${migration.description}`);
    }

    try {
      if (migration.type === 'sql') {
        runSqlMigration(db, migration.file);
      } else if (migration.type === 'js') {
        db.close();
        runJsMigration(dbPath, migration.file);
        db = new Database(dbPath);
        ensureMigrationTable(db);
      } else if (migration.type === 'function' && typeof migration.apply === 'function') {
        db.exec('BEGIN');
        try {
          migration.apply(db);
          db.exec('COMMIT');
        } catch (err) {
          db.exec('ROLLBACK');
          throw err;
        }
      } else {
        throw new Error(`Unsupported migration type: ${migration.type}`);
      }

      recordMigration(db, migration.id, migration.description);
      console.log(`✅ Completed migration: ${migration.id}`);
    } catch (err) {
      console.error(`❌ Migration failed: ${migration.id}`);
      console.error(err.message);
      db.close();
      throw err;
    }
  }

  db.close();
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return 0;
  }

  const verbose = !!args.verbose;

  const defaults = (process.platform !== 'win32') ? {  
    rhdatadb: resolveRelative('electron', 'rhdata.db'),
    patchbindb: resolveRelative('electron', 'patchbin.db'),
    clientdata: resolveRelative('electron', 'clientdata.db'),
    resourcedb: resolveRelative('electron', 'resource.db'),
    screenshotdb: resolveRelative('electron', 'screenshot.db'),
  } : {
    rhdatadb: resolveRelativeAppData('electron', 'rhdata.db'),
    patchbindb: resolveRelativeAppData('electron', 'patchbin.db'),
    clientdata: resolveRelativeAppData('electron', 'clientdata.db'),
    resourcedb: resolveRelativeAppData('electron', 'resource.db'),
    screenshotdb: resolveRelativeAppData('electron', 'screenshot.db'),
  };

  const targets = {
    rhdata: args.rhdatadb || defaults.rhdatadb,
    patchbin: args.patchbindb || defaults.patchbindb,
    clientdata: args.clientdata || defaults.clientdata,
    resource: args.resourcedb || defaults.resourcedb,
    screenshot: args.screenshotdb || defaults.screenshotdb,
  };

  try {
    if (verbose) {
      console.log('Migration targets:', targets);
    }

    ensureDatabaseFile(targets.resource);
    ensureDatabaseFile(targets.screenshot);

    if (targets.rhdata) {
      applyMigrations(targets.rhdata, MIGRATIONS.rhdata, { verbose });
    }

    if (targets.clientdata) {
      applyMigrations(targets.clientdata, MIGRATIONS.clientdata, { verbose });
    }

    if (targets.patchbin) {
      applyMigrations(targets.patchbin, MIGRATIONS.patchbin, { verbose });
    }

    if (targets.resource) {
      applyMigrations(targets.resource, MIGRATIONS.resource, { verbose });
    }

    if (targets.screenshot) {
      applyMigrations(targets.screenshot, MIGRATIONS.screenshot, { verbose });
    }

    console.log('\nAll done!');
    return 0;
  } catch (err) {
    console.error('\nMigration process aborted.');
    if (!verbose) {
      console.error('Use --verbose for additional details.');
    }
    process.exitCode = 1;
    return 1;
  }
}

if (require.main === module) {
  main();
}

// Export for programmatic use
module.exports = {
  MIGRATIONS,
  applyMigrations: applyMigrationsForDatabase,
  applyMigrationsForDatabase
};
