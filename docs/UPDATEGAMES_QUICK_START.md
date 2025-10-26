# Updategames.js - Quick Start Guide

## ⚡ Quick Commands

```bash
# Standard update (most common)
npm run updategames

# Process all patches (not just primary)
npm run updategames:all

# Test run (no DB changes, 5 games)
npm run updategames:test

# Resume interrupted run
npm run updategames:resume
```

## 🚀 First Time Setup (One-Time)

```bash
# 1. Install dependencies
npm install

# 2. Apply database migrations
sqlite3 electron/rhdata.db < electron/sql/rhdata_phase1_migration.sql

# 3. Add schema columns (if not already present)
sqlite3 electron/rhdata.db << 'EOF'
ALTER TABLE gameversions ADD COLUMN fields_type VARCHAR(255);
ALTER TABLE gameversions ADD COLUMN raw_difficulty VARCHAR(255);
ALTER TABLE gameversions ADD COLUMN combinedtype VARCHAR(255);
ALTER TABLE gameversions ADD COLUMN legacy_type VARCHAR(255);
CREATE INDEX IF NOT EXISTS idx_gameversions_fields_type ON gameversions(fields_type);
CREATE INDEX IF NOT EXISTS idx_gameversions_raw_difficulty ON gameversions(raw_difficulty);
CREATE INDEX IF NOT EXISTS idx_gameversions_combinedtype ON gameversions(combinedtype);
EOF

# 4. Verify setup with test
node tests/test_updategames.js
# Expected: 8/8 tests pass

# 5. Dry run test
npm run updategames:test
```

## 📋 Prerequisites

- ✅ Node.js v16+
- ✅ `smw.sfc` file in project root (SHA-224: `fdc4c00e09a8e08d395003e9c8a747f45a9e5e94cbfedc508458eb08`)
- ✅ `flips` utility installed (https://github.com/Alcaro/Flips)
- ✅ `electron/rhdata.db` exists

## 🎯 Common Operations

### Process New Games
```bash
# Fetch and process all new games
npm run updategames

# Limit to 10 games
node updategames.js --limit=10

# Specific games only
node updategames.js --game-ids=12345,12346,12347
```

### Resume Interrupted Run
```bash
# If Ctrl+C was pressed or network failed
npm run updategames:resume
```

### Test Without Changes
```bash
# Dry run (no database changes)
npm run updategames:test
# Or: node updategames.js --dry-run --limit=5
```

### Process All Patches
```bash
# By default, only primary patch is processed
# Use --all-patches to process all .bps and .ips files
npm run updategames:all
# Or: node updategames.js --all-patches
```

## 🔍 Checking Results

### View Imported Games
```sql
sqlite3 electron/rhdata.db
> SELECT gameid, name, combinedtype FROM gameversions ORDER BY gvimport_time DESC LIMIT 10;
```

### Check New Schema Fields
```sql
> SELECT gameid, name, fields_type, raw_difficulty, combinedtype 
  FROM gameversions 
  WHERE fields_type IS NOT NULL 
  LIMIT 10;
```

### Verify Locked Attributes
```sql
> SELECT gameid, name, legacy_type 
  FROM gameversions 
  WHERE legacy_type IS NOT NULL;
```

## 🔒 Setting Locked Attributes (Curators)

### Set Custom Classification
```sql
-- Set legacy_type for a game
sqlite3 electron/rhdata.db
> UPDATE gameversions 
  SET legacy_type = 'Competition Winner 2024'
  WHERE gameid = '38660' 
    AND version = (SELECT MAX(version) FROM gameversions WHERE gameid = '38660');

-- Verify it's set
> SELECT gameid, version, legacy_type FROM gameversions WHERE gameid = '38660';
```

### Test Preservation
```bash
# Re-run updategames with same game (will create version 2)
node updategames.js --game-ids=38660

# Check console output for:
# "ℹ️  Preserving locked attribute: legacy_type = 'Competition Winner 2024'"

# Verify in database
sqlite3 electron/rhdata.db
> SELECT version, legacy_type FROM gameversions WHERE gameid = '38660';
# Expected: Both versions have same legacy_type
```

## 🛠️ Troubleshooting

### "Base ROM not found"
```bash
# Place smw.sfc in project root
ls -lh smw.sfc
# Should exist and be ~512KB
```

### "Flips utility not found"
```bash
# Download from: https://github.com/Alcaro/Flips
# Place in project root or PATH
which flips
# Or: ls -lh ./flips
```

### "SQLite3 can only bind numbers..."
```bash
# This should be fixed - run tests to verify
node tests/test_updategames.js
# Test 2 should pass
```

### Network errors
```bash
# Use resume to continue after network restored
npm run updategames:resume
```

## 📊 What Gets Created

### Files
```
zips/12345.zip              # Downloaded ZIP
patch/abc123hash            # Extracted patch
rom/12345_def456.sfc        # Patched ROM
blobs/pblob_12345_xyz       # Encrypted patchblob
hacks/12345                 # Metadata JSON
```

### Database Records
```
gameversions:    1 per game (with all new fields)
patchblobs:      1+ per game (one per patch file)
attachments:     1+ per game (in patchbin.db)
```

## ⚙️ Advanced Options

### All Command-Line Options
```bash
node updategames.js [options]

Options:
  --help, -h              Show help
  --all-patches           Process all patches
  --dry-run               No database changes
  --resume                Resume interrupted run
  --no-fetch-metadata     Skip metadata fetch
  --no-process-new        Skip processing
  --game-ids=<ids>        Specific games (comma-separated)
  --limit=<n>             Limit game count
```

### Examples
```bash
# Dry run with all patches, first 3 games
node updategames.js --dry-run --all-patches --limit=3

# Skip fetch, just process queue
node updategames.js --no-fetch-metadata

# Specific games with all patches
node updategames.js --game-ids=12345,12346 --all-patches
```

## 📈 Expected Runtime

| Games | Metadata Fetch | Download | Processing | Total |
|-------|----------------|----------|------------|-------|
| 1     | ~1 min         | ~0.5 min | ~1 min     | ~2.5 min |
| 10    | ~10 min        | ~5 min   | ~10 min    | ~25 min |
| 100   | ~120 min       | ~30 min  | ~45 min    | ~3.5 hrs |

Note: Metadata fetch includes 60+ second delays between requests (SMWC requirement)

## 🎓 Learning Path

### Beginner
1. Read this quick start
2. Run `npm run updategames:test`
3. Check results in database
4. Try `npm run updategames --limit=1`

### Intermediate
1. Read `docs/UPDATEGAMES_README.md`
2. Understand workflow steps
3. Try different command-line options
4. Set locked attributes manually

### Advanced
1. Review `docs/NEW_UPDATE_SCRIPT_SPEC.md`
2. Read module source code
3. Understand blob encryption
4. Extend with custom features

## 📚 Documentation Quick Links

| Level | Document | Purpose |
|-------|----------|---------|
| **Quick** | UPDATEGAMES_QUICK_START.md | This guide |
| **User** | UPDATEGAMES_README.md | Complete user guide |
| **Schema** | GAMEVERSIONS_TABLE_SCHEMA.md | Schema reference |
| **Spec** | NEW_UPDATE_SCRIPT_SPEC.md | Full specification |
| **Tests** | README_UPDATEGAMES_TESTS.md | Test documentation |

## ✅ Verification

### Quick Health Check
```bash
# 1. Test suite
node tests/test_updategames.js
# Expected: 8/8 pass

# 2. Schema check
sqlite3 electron/rhdata.db "PRAGMA table_info(gameversions);" | grep combinedtype
# Expected: combinedtype column shown

# 3. Dry run
npm run updategames:test
# Expected: Completes without errors
```

## 🆘 Getting Help

### Error Messages
- Check `docs/UPDATEGAMES_README.md` troubleshooting section
- Review test results: `node tests/test_updategames.js`
- Check database status with SQL queries above

### Feature Questions
- Schema: `docs/GAMEVERSIONS_TABLE_SCHEMA.md`
- Locked attributes: `docs/LOCKED_ATTRIBUTES.md`
- Workflow: `docs/NEW_UPDATE_SCRIPT_SPEC.md`

---

## 🎉 You're Ready!

If all verification steps above pass, you're ready to use `updategames.js` in production!

```bash
# Start with a small batch
node updategames.js --limit=10

# Then run full updates regularly
npm run updategames
```

---

*Quick Start Guide - v1.0*  
*October 12, 2025*

