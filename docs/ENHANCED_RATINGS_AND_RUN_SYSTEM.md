# Enhanced Ratings and Run System

**Date**: October 12, 2025  
**Migration**: 002 (clientdata.db), 005 (rhdata.db)

---

## Overview

This enhancement adds comprehensive support for:
1. **Two types of ratings** - Difficulty and Review ratings
2. **Version-specific annotations** - Different ratings for different game versions
3. **Random exclusion flags** - User and curator control over random selection
4. **Complete run system** - Plan, execute, and track game/stage challenge runs

---

## Part 1: Dual Rating System

### Difficulty Rating (1-5)
**Purpose**: Rate how hard the game or stage is

| Rating | Meaning |
|--------|---------|
| 1 | Very Easy |
| 2 | Easy |
| 3 | Normal |
| 4 | Hard |
| 5 | Very Hard |

### Review/Fun Rating (1-5)
**Purpose**: Rate how much you recommend the game or stage

| Rating | Meaning |
|--------|---------|
| 1 | Not Recommended |
| 2 | Below Average |
| 3 | Average/Decent |
| 4 | Good/Recommended |
| 5 | Excellent/Highly Recommended |

### Database Fields

#### user_game_annotations
- `user_difficulty_rating` - INTEGER 1-5 or NULL
- `user_review_rating` - INTEGER 1-5 or NULL  
- `user_rating` - (deprecated, kept for backwards compatibility)

#### user_stage_annotations
- `user_difficulty_rating` - INTEGER 1-5 or NULL
- `user_review_rating` - INTEGER 1-5 or NULL

---

## Part 2: Version-Specific Annotations

### Problem
Games can have multiple versions. Users may want different ratings for different versions.

### Solution
New table: `user_game_version_annotations`

```sql
CREATE TABLE user_game_version_annotations (
    annotation_key VARCHAR(510) PRIMARY KEY,  -- "gameid-version"
    gameid VARCHAR(255) NOT NULL,
    version INTEGER NOT NULL,
    user_difficulty_rating INTEGER (1-5 or NULL),
    user_review_rating INTEGER (1-5 or NULL),
    status VARCHAR(50),  -- Override game-wide status
    user_notes TEXT,
    created_at TIMESTAMP,
    updated_at TIMESTAMP,
    UNIQUE(gameid, version)
);
```

### Annotation Resolution Priority

When displaying annotations for a game version:

1. **Check version-specific annotations** (user_game_version_annotations WHERE gameid=X AND version=Y)
2. **Fall back to game-wide annotations** (user_game_annotations WHERE gameid=X)
3. **Use defaults** (NULL ratings, 'Default' status)

### Example

```sql
-- User rates game 12345 generally
INSERT INTO user_game_annotations (gameid, user_difficulty_rating, user_review_rating)
VALUES ('12345', 4, 5);  -- Hard but excellent

-- User rates version 2 specifically (it's easier)
INSERT INTO user_game_version_annotations 
  (annotation_key, gameid, version, user_difficulty_rating, user_review_rating)
VALUES ('12345-2', '12345', 2, 3, 5);  -- Normal difficulty, still excellent

-- When viewing version 2: Shows 3 (difficulty), 5 (review) from version-specific
-- When viewing version 1 or 3: Shows 4 (difficulty), 5 (review) from game-wide
```

---

## Part 3: Random Exclusion System

### User-Level Exclusion

**Field**: `user_game_annotations.exclude_from_random` (INTEGER 0/1)

Users can mark games they don't want in random selections:
- Games they've completed
- Games they don't enjoy
- Games too easy/hard for random runs

```sql
-- Exclude game from random selection
UPDATE user_game_annotations SET exclude_from_random = 1 WHERE gameid = '12345';
```

### Curator-Level Exclusion

**Field**: `gameversions.local_runexcluded` (INTEGER 0/1) in rhdata.db

Curators can mark games that shouldn't appear in random selections:
- Broken/buggy games
- Inappropriate content
- Test/demo games
- Duplicates

```sql
-- Mark game as excluded by curator
UPDATE gameversions SET local_runexcluded = 1 WHERE gameid = '12345';
```

### Random Selection Query

```sql
-- Get games eligible for random selection
SELECT gv.gameid, gv.name, gv.author, gv.difficulty
FROM gameversions gv
LEFT JOIN clientdata.user_game_annotations uga ON gv.gameid = uga.gameid
WHERE gv.removed = 0  -- Not removed
  AND gv.obsoleted = 0  -- Not obsoleted
  AND gv.local_runexcluded = 0  -- Not excluded by curator
  AND (uga.exclude_from_random IS NULL OR uga.exclude_from_random = 0)  -- Not excluded by user
  AND gv.version = (SELECT MAX(version) FROM gameversions WHERE gameid = gv.gameid)  -- Latest version only
ORDER BY RANDOM()
LIMIT 1;
```

---

## Part 4: Run System Architecture

### Overview

The run system allows users to:
1. **Plan a run** - Create a sequence of challenges
2. **Execute the run** - Play through challenges with timing
3. **Track results** - Record success/skip/fail for each challenge
4. **Archive completed runs** - Save run history

### Run States

```
preparing → active → completed
     ↓         ↓
  cancelled  cancelled
```

| State | Description |
|-------|-------------|
| `preparing` | User is planning the run, can edit entries |
| `active` | Run in progress, entries locked, timer running |
| `completed` | Run finished, results saved |
| `cancelled` | Run aborted, can't be resumed |

### Database Tables

#### 1. runs
Stores run metadata and status

```sql
CREATE TABLE runs (
    run_uuid VARCHAR(255) PRIMARY KEY,
    run_name VARCHAR(255),
    run_description TEXT,
    status VARCHAR(50) DEFAULT 'preparing',
    created_at TIMESTAMP,
    started_at TIMESTAMP NULL,
    completed_at TIMESTAMP NULL,
    updated_at TIMESTAMP,
    total_challenges INTEGER DEFAULT 0,
    completed_challenges INTEGER DEFAULT 0,
    skipped_challenges INTEGER DEFAULT 0,
    config_json TEXT
);
```

#### 2. run_plan_entries
Stores planned challenges (before execution)

```sql
CREATE TABLE run_plan_entries (
    entry_uuid VARCHAR(255) PRIMARY KEY,
    run_uuid VARCHAR(255) NOT NULL,
    sequence_number INTEGER NOT NULL,
    entry_type VARCHAR(50) NOT NULL,  -- 'game', 'stage', 'random_game', 'random_stage'
    
    -- For specific entries
    gameid VARCHAR(255),
    exit_number VARCHAR(255),
    
    -- For random entries
    count INTEGER DEFAULT 1,
    filter_difficulty VARCHAR(255),
    filter_type VARCHAR(255),
    filter_pattern VARCHAR(255),
    filter_seed VARCHAR(255),
    
    entry_notes TEXT,
    created_at TIMESTAMP,
    UNIQUE(run_uuid, sequence_number)
);
```

#### 3. run_results
Stores actual execution results (expanded from plan)

```sql
CREATE TABLE run_results (
    result_uuid VARCHAR(255) PRIMARY KEY,
    run_uuid VARCHAR(255) NOT NULL,
    plan_entry_uuid VARCHAR(255),
    sequence_number INTEGER NOT NULL,
    
    -- Resolved challenge
    gameid VARCHAR(255) NOT NULL,
    game_name VARCHAR(255),
    exit_number VARCHAR(255),
    stage_description VARCHAR(255),
    
    -- Challenge metadata
    was_random BOOLEAN DEFAULT 0,
    revealed_early BOOLEAN DEFAULT 0,
    
    -- Result
    status VARCHAR(50) DEFAULT 'pending',  -- 'pending', 'success', 'ok', 'skipped', 'failed'
    started_at TIMESTAMP NULL,
    completed_at TIMESTAMP NULL,
    duration_seconds INTEGER,
    result_notes TEXT,
    
    UNIQUE(run_uuid, sequence_number)
);
```

#### 4. run_archive
Archived run metadata

```sql
CREATE TABLE run_archive (
    archive_uuid VARCHAR(255) PRIMARY KEY,
    run_uuid VARCHAR(255) NOT NULL,
    archived_at TIMESTAMP,
    archive_notes TEXT,
    total_time_seconds INTEGER,
    success_rate DECIMAL(5,2),
    UNIQUE(run_uuid)
);
```

---

## Part 5: Run System Workflow

### Step 1: Create Run

```sql
INSERT INTO runs (run_uuid, run_name, status) 
VALUES (lower(hex(randomblob(16))), 'Morning Kaizo Run', 'preparing');
```

### Step 2: Add Plan Entries

```sql
-- Add specific game
INSERT INTO run_plan_entries (run_uuid, sequence_number, entry_type, gameid, count)
VALUES ('abc123', 1, 'game', '12345', 1);

-- Add random kaizo game (3 times)
INSERT INTO run_plan_entries (run_uuid, sequence_number, entry_type, count, filter_type, filter_seed)
VALUES ('abc123', 2, 'random_game', 3, 'Kaizo', 'seed789');

-- Add specific stage
INSERT INTO run_plan_entries (run_uuid, sequence_number, entry_type, gameid, exit_number, count)
VALUES ('abc123', 3, 'stage', '67890', '0x05', 1);
```

### Step 3: Start Run

```sql
-- Change status to active
UPDATE runs 
SET status = 'active', 
    started_at = CURRENT_TIMESTAMP,
    total_challenges = (SELECT SUM(count) FROM run_plan_entries WHERE run_uuid = 'abc123')
WHERE run_uuid = 'abc123';

-- Expand plan entries into run_results
-- For each plan entry:
--   If count = 1: Create 1 run_result
--   If count > 1: Create N run_results
--   If random: Resolve game/stage now or mask until attempted
```

### Step 4: Execute Challenges

```sql
-- User starts challenge
UPDATE run_results 
SET status = 'pending', started_at = CURRENT_TIMESTAMP
WHERE result_uuid = 'xyz789';

-- User completes challenge (success)
UPDATE run_results 
SET status = 'success', 
    completed_at = CURRENT_TIMESTAMP,
    duration_seconds = (julianday(CURRENT_TIMESTAMP) - julianday(started_at)) * 86400
WHERE result_uuid = 'xyz789';

-- Update run progress
UPDATE runs 
SET completed_challenges = completed_challenges + 1
WHERE run_uuid = 'abc123';
```

### Step 5: Complete Run

```sql
-- Mark run as completed
UPDATE runs 
SET status = 'completed', completed_at = CURRENT_TIMESTAMP
WHERE run_uuid = 'abc123';
```

### Step 6: Archive Run

```sql
INSERT INTO run_archive (run_uuid, total_time_seconds, success_rate)
SELECT 
    run_uuid,
    (julianday(completed_at) - julianday(started_at)) * 86400,
    (completed_challenges * 100.0 / NULLIF(total_challenges, 0))
FROM runs
WHERE run_uuid = 'abc123';
```

---

## Part 6: Entry Types

### game
Play a specific game (any exit/100%)

```sql
INSERT INTO run_plan_entries (run_uuid, sequence_number, entry_type, gameid, count)
VALUES ('run1', 1, 'game', '12345', 1);
```

### stage
Play a specific stage/exit

```sql
INSERT INTO run_plan_entries (run_uuid, sequence_number, entry_type, gameid, exit_number, count)
VALUES ('run1', 2, 'stage', '12345', '0x0F', 1);
```

### random_game
Random game matching filters

```sql
INSERT INTO run_plan_entries 
  (run_uuid, sequence_number, entry_type, count, filter_difficulty, filter_type, filter_seed)
VALUES ('run1', 3, 'random_game', 5, 'Advanced', 'Kaizo', 'myseed');
```

### random_stage
Random stage from games matching filters

```sql
INSERT INTO run_plan_entries 
  (run_uuid, sequence_number, entry_type, count, filter_difficulty, filter_pattern, filter_seed)
VALUES ('run1', 4, 'random_stage', 10, 'Normal', '%castle%', 'seed456');
```

---

## Part 7: Challenge Result States

| Status | Meaning |
|--------|---------|
| `pending` | Challenge started but not completed |
| `success` | Challenge completed successfully |
| `ok` | Challenge completed but with warning (e.g., name revealed early) |
| `skipped` | User chose to skip this challenge |
| `failed` | User failed the challenge |

### revealed_early Flag

If a random challenge name is revealed before it's attempted:
- Set `revealed_early = 1`
- Success can only be marked as `ok` (not `success`)

---

## Part 8: Random Challenge Resolution

### Seed-Based Selection

Random challenges use seeds for reproducibility:

```javascript
function selectRandomGame(filterDifficulty, filterType, filterSeed, count) {
  const rng = seedRandom(filterSeed);
  
  // Get eligible games
  const eligible = db.prepare(`
    SELECT gv.gameid, gv.name
    FROM gameversions gv
    LEFT JOIN clientdata.user_game_annotations uga ON gv.gameid = uga.gameid
    WHERE gv.difficulty = ?
      AND gv.fields_type = ?
      AND gv.local_runexcluded = 0
      AND (uga.exclude_from_random IS NULL OR uga.exclude_from_random = 0)
      AND gv.version = (SELECT MAX(version) FROM gameversions WHERE gameid = gv.gameid)
  `).all(filterDifficulty, filterType);
  
  // Shuffle with seed
  shuffle(eligible, rng);
  
  return eligible.slice(0, count);
}
```

### Masking Random Names

When a random challenge is added to run_results:
- Set `gameid` but don't set `game_name`
- UI shows "???" until user attempts or reveals
- When user clicks "reveal" or starts challenge, populate `game_name`

---

## Part 9: GUI Integration

### Details Inspector Changes

#### Version Selector (New)
```html
<select v-model="selectedVersion">
  <option v-for="v in availableVersions" :value="v">Version {{v}}</option>
</select>
```

#### Read-Only Official Fields
- Id (gameid) - READ ONLY
- Name - READ ONLY (from gameversions)
- Type (combinedtype) - READ ONLY
- Author - READ ONLY (from gameversions)
- Legacy Type - READ ONLY (if set)
- Public Rating - READ ONLY
- Public Difficulty - READ ONLY

#### User-Editable Fields
- My Difficulty Rating (1-5 stars)
- My Review Rating (1-5 stars)
- Status (Default/In Progress/Finished)
- Hidden (checkbox)
- Exclude from Random (checkbox)
- My Notes (textarea)

#### Version-Specific Rating Button
```html
<button @click="setVersionSpecificRating">
  Set rating for this version only
</button>
```

#### View JSON Details Button
```html
<button @click="showJsonDetails">View Details</button>

<!-- Modal -->
<div v-if="jsonModalOpen" class="modal">
  <h3>Game JSON Data</h3>
  <pre>{{ prettyJson }}</pre>
</div>
```

### Main List Columns

Update to show:
- Id (gameid from gameversions)
- Name (from gameversions)
- Type (combinedtype from gameversions)
- Author (from gameversions)
- Status (from user_game_annotations)
- My Difficulty (user_difficulty_rating)
- My Review (user_review_rating)
- Public Rating (from gameversions)
- Hidden (from user_game_annotations)

### Settings Modal

Load/save from `csettings` table:

```javascript
// Load setting
const value = db.prepare(`
  SELECT csetting_value FROM csettings WHERE csetting_name = ?
`).get('vanillaRomPath')?.csetting_value;

// Save setting
db.prepare(`
  INSERT OR REPLACE INTO csettings (csetting_name, csetting_value)
  VALUES (?, ?)
`).run('vanillaRomPath', '/path/to/rom');
```

---

## Part 10: Migration Instructions

### Apply Migrations

```bash
# Client data (ratings + run system)
sqlite3 electron/clientdata.db < electron/sql/migrations/002_clientdata_enhanced_ratings_and_runs.sql

# Public data (local_runexcluded)
sqlite3 electron/rhdata.db < electron/sql/migrations/005_add_local_runexcluded.sql
```

### Verification

```bash
# Check clientdata.db tables
sqlite3 electron/clientdata.db "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"

# Expected new tables:
# - user_game_version_annotations
# - runs
# - run_plan_entries
# - run_results
# - run_archive

# Check new columns
sqlite3 electron/clientdata.db "PRAGMA table_info(user_game_annotations);" | grep rating

# Check rhdata.db
sqlite3 electron/rhdata.db "PRAGMA table_info(gameversions);" | grep runexcluded
```

---

## Part 11: API Examples

### Set Both Ratings

```javascript
db.prepare(`
  INSERT OR REPLACE INTO user_game_annotations 
    (gameid, user_difficulty_rating, user_review_rating, status)
  VALUES (?, ?, ?, ?)
`).run('12345', 4, 5, 'In Progress');
```

### Set Version-Specific Rating

```javascript
db.prepare(`
  INSERT OR REPLACE INTO user_game_version_annotations 
    (annotation_key, gameid, version, user_difficulty_rating, user_review_rating)
  VALUES (?, ?, ?, ?, ?)
`).run('12345-2', '12345', 2, 3, 5);
```

### Get Annotations for Version

```javascript
function getAnnotationsForVersion(gameid, version) {
  // Check version-specific first
  const versionSpecific = db.prepare(`
    SELECT * FROM user_game_version_annotations 
    WHERE gameid = ? AND version = ?
  `).get(gameid, version);
  
  if (versionSpecific) return versionSpecific;
  
  // Fall back to game-wide
  return db.prepare(`
    SELECT * FROM user_game_annotations WHERE gameid = ?
  `).get(gameid);
}
```

### Create Run

```javascript
const runUuid = generateUuid();

db.prepare(`
  INSERT INTO runs (run_uuid, run_name, status)
  VALUES (?, ?, 'preparing')
`).run(runUuid, 'Morning Run');

// Add entries
db.prepare(`
  INSERT INTO run_plan_entries 
    (run_uuid, sequence_number, entry_type, gameid, count)
  VALUES (?, ?, 'game', ?, 1)
`).run(runUuid, 1, '12345');
```

---

## Related Documentation

- **User Annotations**: `docs/CLIENTDATA_USER_ANNOTATIONS.md`
- **Database Architecture**: `docs/ELECTRON_APP_DATABASES.md`
- **Schema Changes**: `docs/SCHEMACHANGES.md`
- **Migrations**: `docs/DBMIGRATE.md`

---

*Last Updated: October 12, 2025*  
*Version: 2.0*
