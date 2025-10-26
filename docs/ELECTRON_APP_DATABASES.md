# Electron App Database Architecture

## Overview

The RHTools Electron application uses a three-database architecture to separate concerns and maintain data integrity:

```
┌─────────────────────────────────────────────────────────────┐
│                    Electron Application                     │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │  rhdata.db  │  │ patchbin.db  │  │  clientdata.db   │  │
│  │             │  │              │  │                  │  │
│  │  Public     │  │   Binary     │  │  User-Specific   │  │
│  │  Game       │  │   Patch      │  │  Private         │  │
│  │  Metadata   │  │   Data       │  │  Preferences     │  │
│  └─────────────┘  └──────────────┘  └──────────────────┘  │
│       │                  │                    │            │
│       │                  │                    │            │
│       └──────────────────┴────────────────────┘            │
│                     Read/Write                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Database 1: rhdata.db (Public Game Metadata)

### Purpose
Public, shareable game version data and metadata.

### Key Tables
- **gameversions** - Game versions with metadata
- **patchblobs** - Patch metadata and references
- **rhpatches** - Patch name registry
- **update_status** - Update tracking (Phase 1)
- **game_fetch_queue** - Update queue management
- **smwc_metadata_cache** - SMWC API cache

### Characteristics
- ✅ Shareable between users
- ✅ Can be synced/distributed
- ✅ Contains public game information
- ❌ No user-specific data

### Environment Variable
```bash
RHDATA_DB_PATH=/path/to/rhdata.db
```

### Schema Files
- Base: `electron/sql/rhdata.sql`
- Phase 1: `electron/sql/rhdata_phase1_migration.sql`
- Phase 2: `electron/sql/rhdata_phase2_migration.sql`
- Migrations: `electron/sql/migrations/001-004_*.sql`

### Documentation
- `docs/SCHEMACHANGES.md` - Schema changelog
- `docs/GAMEVERSIONS_TABLE_SCHEMA.md` - Complete field reference
- `docs/LOCAL_RESOURCE_TRACKING.md` - Resource tracking features

---

## Database 2: patchbin.db (Binary Patch Data)

### Purpose
Actual binary patch file data and related metadata.

### Key Tables
- **attachments** - Blob files with hashes and encryption
- **patchblobs** - Patch metadata (linked to rhdata.db)
- **upload_status** - Upload tracking for cloud storage

### Characteristics
- ✅ Can be synced/distributed
- ✅ Contains binary data (BLOBs)
- ✅ Encrypted patch files
- ✅ IPFS/Arweave metadata
- ❌ No user-specific data

### Environment Variable
```bash
PATCHBIN_DB_PATH=/path/to/patchbin.db
```

### Schema Files
- Base: `electron/sql/patchbin.sql`
- IPFSGateways: `electron/sql/ipfsgateways.sql`

### Documentation
- `docs/DATA_SCRIPTS.md` - Data loading and processing
- `docs/UPLOAD_TRACKING.md` - Upload status tracking

---

## Database 3: clientdata.db (User-Specific Data)

### Purpose
User-specific, private preferences and annotations. **NOT shareable**.

### Key Tables
- **csettings** - General settings (key-value pairs)
- **apiservers** - API server credentials (encrypted)
- **user_game_annotations** - User ratings, status, notes, hidden flag
- **game_stages** - Stage metadata for games
- **user_stage_annotations** - User stage ratings and notes

### Characteristics
- ❌ NOT shareable (private user data)
- ❌ Should NOT be synced
- ✅ One per user installation
- ✅ Contains personal opinions/progress
- ✅ Contains encrypted credentials

### Environment Variable
```bash
CLIENTDATA_DB_PATH=/path/to/clientdata.db
```

### Schema Files
- Base: `electron/sql/clientdata.sql`
- Migration: `electron/sql/migrations/001_clientdata_user_annotations.sql`

### Documentation
- **`docs/CLIENTDATA_USER_ANNOTATIONS.md`** - Complete user annotations guide
- `docs/SCHEMACHANGES.md` - Schema changelog

---

## Data Flow

### Game Installation/Update Flow

```
1. Download game metadata (JSON) → rhdata.db (gameversions)
2. Download patch files (ZIP) → filesystem (electron/zips/)
3. Extract patches → Process → patchbin.db (attachments)
4. User views game → Loads from rhdata.db + clientdata.db
5. User rates/annotates → Save to clientdata.db only
```

### User Interaction Flow

```
┌─────────────────┐
│  User opens UI  │
└────────┬────────┘
         │
         ▼
┌────────────────────────────────────────┐
│  Load games from rhdata.db             │
│  - gameversions table                  │
│  - name, author, difficulty, etc.      │
└────────┬───────────────────────────────┘
         │
         ▼
┌────────────────────────────────────────┐
│  Join with clientdata.db               │
│  - user_game_annotations               │
│  - status, user_rating, hidden, notes  │
└────────┬───────────────────────────────┘
         │
         ▼
┌────────────────────────────────────────┐
│  Display combined data                 │
│  - Public info + User annotations      │
└────────┬───────────────────────────────┘
         │
         ▼
┌────────────────────────────────────────┐
│  User modifies (rate, status, notes)   │
└────────┬───────────────────────────────┘
         │
         ▼
┌────────────────────────────────────────┐
│  Save to clientdata.db ONLY            │
│  - INSERT OR REPLACE                   │
│  - Never modify rhdata.db              │
└────────────────────────────────────────┘
```

---

## Cross-Database Queries

### Attaching Databases

SQLite allows attaching multiple databases:

```sql
-- Attach both rhdata and clientdata
ATTACH DATABASE 'electron/rhdata.db' AS rhdata;
ATTACH DATABASE 'electron/clientdata.db' AS clientdata;

-- Query across databases
SELECT 
  gv.gameid,
  gv.name,
  gv.author,
  gv.difficulty AS public_difficulty,
  uga.status,
  uga.user_rating,
  uga.hidden,
  uga.user_notes
FROM rhdata.gameversions gv
LEFT JOIN clientdata.user_game_annotations uga ON gv.gameid = uga.gameid
WHERE uga.hidden = 0 OR uga.hidden IS NULL
ORDER BY gv.name;

DETACH DATABASE rhdata;
DETACH DATABASE clientdata;
```

### Node.js Example

```javascript
const Database = require('better-sqlite3');
const path = require('path');

// Environment variable support
const RHDATA_DB = process.env.RHDATA_DB_PATH || 
  path.join(__dirname, 'electron', 'rhdata.db');
const CLIENTDATA_DB = process.env.CLIENTDATA_DB_PATH || 
  path.join(__dirname, 'electron', 'clientdata.db');

// Open main database
const db = new Database(RHDATA_DB, { readonly: false });

// Attach clientdata
db.exec(`ATTACH DATABASE '${CLIENTDATA_DB}' AS clientdata`);

// Query across databases
const games = db.prepare(`
  SELECT 
    gv.gameid,
    gv.name,
    gv.author,
    uga.status,
    uga.user_rating,
    uga.user_notes
  FROM gameversions gv
  LEFT JOIN clientdata.user_game_annotations uga ON gv.gameid = uga.gameid
  WHERE gv.removed = 0
  ORDER BY gv.name
`).all();

// Detach when done
db.exec('DETACH DATABASE clientdata');
db.close();
```

---

## Environment Variables

All databases support environment variable overrides:

```bash
# Override database locations
export RHDATA_DB_PATH=/path/to/rhdata.db
export PATCHBIN_DB_PATH=/path/to/patchbin.db
export CLIENTDATA_DB_PATH=/path/to/clientdata.db

# Run script with custom paths
node electron/loaddata.js example-rhmd/12345
```

This allows:
- Testing with separate databases
- Multiple user profiles
- Alternative storage locations
- CI/CD environments

---

## Multi-User Setup

### Scenario: Multiple users on same machine

Each user should have their own `clientdata.db`:

```bash
# User 1
export CLIENTDATA_DB_PATH=~/rhtools/user1_clientdata.db

# User 2
export CLIENTDATA_DB_PATH=~/rhtools/user2_clientdata.db

# Shared databases (read-only for users)
export RHDATA_DB_PATH=/opt/rhtools/rhdata.db
export PATCHBIN_DB_PATH=/opt/rhtools/patchbin.db
```

### Directory Structure

```
/opt/rhtools/              # System-wide installation
├── rhdata.db              # Shared game metadata
├── patchbin.db            # Shared patch files
├── electron/
│   └── sql/
│       └── clientdata.sql
└── zips/                  # Shared ZIP files

~/rhtools/                 # User-specific data
├── user1_clientdata.db    # User 1's private data
└── user2_clientdata.db    # User 2's private data
```

---

## Backup Strategy

### What to Backup

| Database | Frequency | Shareable? | Critical? |
|----------|-----------|------------|-----------|
| rhdata.db | Weekly | ✅ Yes | ⭐⭐⭐ High |
| patchbin.db | Monthly | ✅ Yes | ⭐⭐ Medium |
| clientdata.db | Daily | ❌ No | ⭐ Low (user-specific) |

### Backup Commands

```bash
# Backup all databases with timestamp
DATE=$(date +%Y%m%d-%H%M%S)

# System/shared databases
cp electron/rhdata.db "backups/rhdata-${DATE}.db"
cp electron/patchbin.db "backups/patchbin-${DATE}.db"

# User-specific database
cp electron/clientdata.db "backups/clientdata-${DATE}.db"

# Compress backups
gzip backups/*-${DATE}.db
```

### Restore

```bash
# Restore from backup
cp backups/rhdata-20251012-120000.db.gz .
gunzip rhdata-20251012-120000.db.gz
mv rhdata-20251012-120000.db electron/rhdata.db
```

---

## Migration Workflow

### For rhdata.db

```bash
# Apply schema migrations
sqlite3 electron/rhdata.db < electron/sql/migrations/001_add_fields_type_raw_difficulty.sql
sqlite3 electron/rhdata.db < electron/sql/migrations/002_add_combinedtype.sql
sqlite3 electron/rhdata.db < electron/sql/migrations/004_add_local_resource_tracking.sql

# Apply Phase 1 tables
sqlite3 electron/rhdata.db < electron/sql/rhdata_phase1_migration.sql

# (Optional) Backfill data
node electron/sql/migrations/003_backfill_combinedtype.js
```

### For clientdata.db

```bash
# Apply user annotations migration
sqlite3 electron/clientdata.db < electron/sql/migrations/001_clientdata_user_annotations.sql
```

### For patchbin.db

```bash
# Upload status table is auto-created by scripts
# Or manually:
sqlite3 electron/patchbin.db < electron/sql/patchbin.sql
```

See `docs/DBMIGRATE.md` for complete migration guide.

---

## Testing

### Test Individual Databases

```bash
# Test rhdata.db operations
node tests/test_updategames.js

# Test patchbin.db operations
node tests/test_attachblobs.js

# Test clientdata.db user annotations
node electron/tests/test_clientdata_annotations.js

# Test mode 3 enhanced search (uses both rhdata + patchbin)
node tests/test_mode3_enhanced_search.js
```

### Test Cross-Database Integration

Create an integration test that:
1. Loads data into rhdata.db
2. Attaches patchbin.db and clientdata.db
3. Queries across all three
4. Verifies data integrity

---

## Security Considerations

### clientdata.db Security

**Important**: `clientdata.db` contains sensitive data:
- API credentials (encrypted in `apiservers` table)
- Personal notes and opinions
- User preferences

**Best Practices**:
1. Never commit clientdata.db to version control
2. Don't share clientdata.db between users
3. Use OS-specific credential storage (future enhancement)
4. Set proper file permissions (600 on Unix systems)

```bash
# Set restrictive permissions
chmod 600 electron/clientdata.db
```

### API Credentials

API server credentials in `apiservers` table are encrypted with AES-256-CBC using `RHTCLIENT_VAULT_KEY` environment variable.

**TODO**: Migrate to OS-specific secure storage:
- Windows: Credential Manager
- macOS: Keychain
- Linux: Secret Service API

---

## Performance Optimization

### Indexes

All databases include indexes for common query patterns:

- **rhdata.db**: Indexed on gameid, version, status, type fields
- **patchbin.db**: Indexed on file_name, hashes
- **clientdata.db**: Indexed on gameid, status, rating, hidden

### Query Tips

```sql
-- Good: Uses index
SELECT * FROM user_game_annotations WHERE gameid = '12345';

-- Good: Uses index
SELECT * FROM user_game_annotations WHERE hidden = 0 AND user_rating >= 4;

-- Bad: Full table scan (LIKE with leading wildcard)
SELECT * FROM gameversions WHERE name LIKE '%kaizo%';

-- Better: Use FTS (Full-Text Search) if needed
-- Create FTS virtual table for gameversions.name
```

### Database Maintenance

```sql
-- Analyze query plans
EXPLAIN QUERY PLAN SELECT * FROM user_game_annotations WHERE hidden = 0;

-- Update statistics
ANALYZE;

-- Reclaim space after deletions
VACUUM;

-- Check integrity
PRAGMA integrity_check;
```

---

## Troubleshooting

### Database Locked

If you see "database is locked" errors:

1. Close other connections
2. Check for long-running queries
3. Use WAL mode:

```sql
PRAGMA journal_mode=WAL;
```

### Schema Version Mismatch

If migrations fail or schema is inconsistent:

```bash
# Check current schema
sqlite3 electron/rhdata.db ".schema gameversions"

# Compare with expected schema
diff <(sqlite3 electron/rhdata.db ".schema gameversions") \
     <(cat electron/sql/rhdata.sql)

# Re-apply migrations if needed
```

### Missing Tables

```bash
# Check what tables exist
sqlite3 electron/clientdata.db "SELECT name FROM sqlite_master WHERE type='table';"

# If user_game_annotations is missing:
sqlite3 electron/clientdata.db < electron/sql/migrations/001_clientdata_user_annotations.sql
```

---

## Related Documentation

- **Schema Changes**: `docs/SCHEMACHANGES.md` - All schema modifications
- **Migrations**: `docs/DBMIGRATE.md` - Migration commands
- **User Annotations**: `docs/CLIENTDATA_USER_ANNOTATIONS.md` - User data guide
- **Data Scripts**: `docs/DATA_SCRIPTS.md` - Loading and processing data
- **GUI Design**: `electron/GUI_README.md` - UI integration

---

## Summary

| Aspect | rhdata.db | patchbin.db | clientdata.db |
|--------|-----------|-------------|---------------|
| **Purpose** | Game metadata | Binary patches | User preferences |
| **Shareable** | ✅ Yes | ✅ Yes | ❌ No |
| **Multi-user** | Shared | Shared | One per user |
| **Env Var** | RHDATA_DB_PATH | PATCHBIN_DB_PATH | CLIENTDATA_DB_PATH |
| **Backup Priority** | High | Medium | Low |
| **Contains BLOBs** | No | Yes | No |
| **User-modifiable** | Admin only | Admin only | Yes |

---

*Last Updated: October 12, 2025*  
*Architecture Version: 1.0*

