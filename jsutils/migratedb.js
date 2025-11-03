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
    `  --verbose           Print detailed progress\n` +
    `  --help              Show this help text\n`);
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
  ],
  patchbin: [],
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
  // For rhdata migrations, use RHDATA_DB_PATH; for others, use DB_PATH
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

  const defaults = {
    rhdatadb: resolveRelative('electron', 'rhdata.db'),
    patchbindb: resolveRelative('electron', 'patchbin.db'),
    clientdata: resolveRelative('electron', 'clientdata.db'),
  };

  const targets = {
    rhdata: args.rhdatadb || defaults.rhdatadb,
    patchbin: args.patchbindb || defaults.patchbindb,
    clientdata: args.clientdata || defaults.clientdata,
  };

  try {
    if (verbose) {
      console.log('Migration targets:', targets);
    }

    if (targets.rhdata) {
      applyMigrations(targets.rhdata, MIGRATIONS.rhdata, { verbose });
    }

    if (targets.clientdata) {
      applyMigrations(targets.clientdata, MIGRATIONS.clientdata, { verbose });
    }

    if (targets.patchbin) {
      applyMigrations(targets.patchbin, MIGRATIONS.patchbin, { verbose });
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
