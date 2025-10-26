# RHTools Electron App - Master Reference Guide

**Version**: 2.0  
**Last Updated**: October 12, 2025  
**Purpose**: Complete technical reference for developers working on the Electron app

---

## Table of Contents

1. [Overview](#overview)
2. [Database Architecture](#database-architecture)
3. [gameversions Table](#gameversions-table)
4. [User Annotation System](#user-annotation-system)
5. [Rating Systems](#rating-systems)
6. [Run Management System](#run-management-system)
7. [Settings System](#settings-system)
8. [User Interface Components](#user-interface-components)
9. [IPC Architecture](#ipc-architecture)
10. [Data Flow](#data-flow)

---

## Overview

### What Is This App?

RHTools Electron is a **multi-platform desktop application** for managing and playing Super Mario World (SMW) ROM hacks. It provides:

- **Game Library**: Browse and search 3,000+ SMW hacks
- **Rating System**: Triple rating system (difficulty, quality, skill level)
- **Version Management**: Multiple versions per game with version-specific annotations
- **Run System**: Plan and execute challenge runs with conditions
- **Settings Management**: Persist user preferences and tool paths

### Technology Stack

- **Frontend**: Vue 3 + TypeScript + Vite
- **Backend**: Electron (Node.js) + better-sqlite3
- **Databases**: 3 SQLite databases (rhdata, patchbin, clientdata)
- **IPC**: Secure inter-process communication

### Platform Support

- ✅ Linux (tested)
- ✅ Windows (designed for)
- ✅ macOS (designed for)

---

## Database Architecture

### The 3-Database System

```
┌────────────────────────────────────────────────┐
│            Electron Application                │
├────────────────────────────────────────────────┤
│                                                │
│  ┌──────────┐  ┌───────────┐  ┌────────────┐ │
│  │ rhdata   │  │ patchbin  │  │ clientdata │ │
│  │          │  │           │  │            │ │
│  │ Public   │  │ Binary    │  │ User       │ │
│  │ Game     │  │ Patch     │  │ Private    │ │
│  │ Metadata │  │ Data      │  │ Data       │ │
│  └──────────┘  └───────────┘  └────────────┘ │
│   Shareable     Shareable      NOT Shareable  │
└────────────────────────────────────────────────┘
```

### 1. rhdata.db (Public Game Metadata)

**Purpose**: Public, shareable game information

**Location**:
- Development: `electron/rhdata.db`
- Production: `~/.config/rhtools/rhdata.db` (Linux)
- Production: `C:\Users\<User>\AppData\Roaming\rhtools\rhdata.db` (Windows)

**Environment Variable**: `RHDATA_DB_PATH`

**Key Tables**:
- `gameversions` - Game metadata (primary table)
- `patchblobs` - Patch references
- `rhpatches` - Patch registry
- `update_status` - Update tracking
- `patchblobs_extended` - Extended patch metadata

**Size**: ~49 MB (3,168 games)

**Sharing**: ✅ Can be distributed/synced between users

### 2. patchbin.db (Binary Patch Data)

**Purpose**: Actual patch file binary data

**Location**: Same as rhdata.db

**Environment Variable**: `PATCHBIN_DB_PATH`

**Key Tables**:
- `attachments` - Binary blob files with hashes
- `upload_status` - Cloud upload tracking

**Size**: ~1.6 GB

**Sharing**: ✅ Can be distributed

### 3. clientdata.db (User Private Data)

**Purpose**: User-specific, private annotations and preferences

**Location**: Same as rhdata.db (but unique per user)

**Environment Variable**: `CLIENTDATA_DB_PATH`

**Key Tables**:
- `csettings` - Settings (key-value pairs)
- `apiservers` - API credentials (encrypted)
- `user_game_annotations` - Game ratings/status/notes
- `user_game_version_annotations` - Version-specific ratings
- `game_stages` - Stage metadata (user-defined)
- `user_stage_annotations` - Stage ratings
- `runs` - Challenge run metadata
- `run_plan_entries` - Planned challenges
- `run_results` - Execution results
- `run_archive` - Historical runs

**Size**: ~16 KB initially (grows with usage)

**Sharing**: ❌ NEVER share (contains personal data)

---

## gameversions Table

### Purpose

The **gameversions** table is the **heart of the application**. It stores all public game metadata.

### Schema

**Location**: rhdata.db

**Primary Key**: `gvuuid` (auto-generated UUID)

**Unique Constraint**: `(gameid, version)` - Each game can have multiple versions

### Key Fields

#### Identity Fields
```sql
gvuuid VARCHAR(255) PRIMARY KEY  -- Auto-generated UUID
gameid VARCHAR(255)               -- Game identifier (e.g., '11374')
version INTEGER                   -- Version number (1, 2, 3...)
```

#### Basic Metadata
```sql
name VARCHAR(255) NOT NULL        -- Game name (e.g., 'Super Dram World')
author VARCHAR(255)               -- Primary author
authors VARCHAR(255)              -- All contributors
gametype VARCHAR(255)             -- Original type field
difficulty VARCHAR(255)           -- Public difficulty (e.g., 'Advanced')
```

#### Display Fields
```sql
combinedtype VARCHAR(255)         -- Computed: Complete type description
                                  -- Example: "Kaizo: Intermediate"
                                  
legacy_type VARCHAR(255)          -- User-curated type (locked attribute)
                                  -- Manually set by curators
                                  -- Not imported from external sources
```

#### Content Fields
```sql
description TEXT                  -- Game description
tags TEXT                         -- Game tags (comma-separated)
length VARCHAR(255)               -- Game length (e.g., '18 exits')
```

#### URLs and References
```sql
url VARCHAR(255)                  -- Game page URL
download_url VARCHAR(255)         -- Download link
patchblob1_name VARCHAR(255)      -- Reference to patch file
pat_sha224 VARCHAR(255)           -- Patch hash for verification
```

#### Status Fields
```sql
removed INTEGER DEFAULT 0         -- 1 if game removed from site
obsoleted INTEGER DEFAULT 0       -- 1 if replaced by newer version
obsoleted_by VARCHAR(255)         -- Which game replaced this
```

#### Computed/Locked Columns
```sql
-- These are NEVER imported from external JSON
combinedtype VARCHAR(255)         -- Computed from other fields
gvimport_time TIMESTAMP           -- Auto-set on import
version INTEGER                   -- Auto-incremented
gvuuid VARCHAR(255)               -- Auto-generated
local_resource_etag VARCHAR(255)  -- HTTP metadata
local_resource_lastmodified TIMESTAMP
local_resource_filename VARCHAR(500)
local_runexcluded INTEGER DEFAULT 0  -- Curator exclusion flag
```

#### JSON Storage
```sql
gvjsondata TEXT                   -- Complete original JSON data
                                  -- Used for "View Details" feature
```

### Important Concepts

#### Multiple Versions

Games can have multiple versions:
```sql
-- Get all versions of a game
SELECT version FROM gameversions 
WHERE gameid = '11374' 
ORDER BY version DESC;

-- Results: 3, 2, 1
```

#### Latest Version

By default, show only the latest version:
```sql
SELECT * FROM gameversions gv
WHERE gv.version = (
  SELECT MAX(version) FROM gameversions gv2 
  WHERE gv2.gameid = gv.gameid
);
```

#### Locked vs Importable Fields

**Locked/Computed** (NEVER import from external JSON):
- gvuuid, version, gvimport_time
- combinedtype, legacy_type
- local_resource_*, local_runexcluded

**Importable** (Updated from external sources):
- name, author, authors, difficulty
- description, tags, length
- url, download_url
- All other metadata fields

---

## User Annotation System

### Purpose

Allow each user to maintain their own **personal** data about games without modifying the public database.

### Architecture

```
Public Data (rhdata.db)          Private Data (clientdata.db)
┌──────────────┐                 ┌──────────────────────┐
│ gameversions │                 │ user_game_           │
│              │                 │   annotations        │
│ gameid ──────┼─────references──│ gameid (PK)          │
│ name         │                 │ status               │
│ author       │                 │ user_difficulty_...  │
│ difficulty   │                 │ user_review_rating   │
│              │                 │ user_skill_rating    │
└──────────────┘                 │ hidden               │
                                 │ exclude_from_random  │
                                 │ user_notes           │
                                 └──────────────────────┘
```

### Game-Wide Annotations

**Table**: `user_game_annotations` in clientdata.db

**Purpose**: Store user's default ratings/status for a game (applies to all versions unless overridden)

```sql
CREATE TABLE user_game_annotations (
    gameid VARCHAR(255) PRIMARY KEY,  -- References gameversions.gameid
    
    -- Progress tracking
    status VARCHAR(50) DEFAULT 'Default',  -- Default, In Progress, Finished
    
    -- Triple rating system
    user_difficulty_rating INTEGER,   -- 0-5: How hard?
    user_review_rating INTEGER,       -- 0-5: How good?
    user_skill_rating INTEGER,        -- 0-10: Your skill when rated
    
    -- Organization
    hidden INTEGER DEFAULT 0,         -- Hide from main list
    exclude_from_random INTEGER DEFAULT 0,  -- Exclude from random selection
    
    -- Notes
    user_notes TEXT,
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**Usage**:
```sql
-- Set ratings for a game
INSERT OR REPLACE INTO user_game_annotations 
  (gameid, status, user_difficulty_rating, user_review_rating, user_skill_rating)
VALUES ('11374', 'In Progress', 4, 5, 6);

-- Hide a game
UPDATE user_game_annotations SET hidden = 1 WHERE gameid = '11374';

-- Exclude from random
UPDATE user_game_annotations SET exclude_from_random = 1 WHERE gameid = '11374';
```

### Version-Specific Annotations

**Table**: `user_game_version_annotations` in clientdata.db

**Purpose**: Override game-wide annotations for specific versions

```sql
CREATE TABLE user_game_version_annotations (
    annotation_key VARCHAR(510) PRIMARY KEY,  -- "gameid-version"
    gameid VARCHAR(255) NOT NULL,
    version INTEGER NOT NULL,
    
    -- Overrides for this version
    status VARCHAR(50),
    user_difficulty_rating INTEGER,
    user_review_rating INTEGER,
    user_skill_rating INTEGER,
    user_notes TEXT,
    
    created_at TIMESTAMP,
    updated_at TIMESTAMP,
    UNIQUE(gameid, version)
);
```

**Example**:
```sql
-- Game-wide: difficulty = 4
INSERT INTO user_game_annotations (gameid, user_difficulty_rating)
VALUES ('11374', 4);

-- Version 2 is easier
INSERT INTO user_game_version_annotations 
  (annotation_key, gameid, version, user_difficulty_rating)
VALUES ('11374-2', '11374', 2, 2);

-- When viewing version 2: Shows difficulty = 2
-- When viewing version 1 or 3: Shows difficulty = 4
```

### Resolution Priority

When loading annotations:

1. **Check version-specific** (user_game_version_annotations)
2. **Fall back to game-wide** (user_game_annotations)
3. **Use defaults** (NULL/Default)

```sql
-- Query with fallback
SELECT 
  COALESCE(ugva.user_difficulty_rating, uga.user_difficulty_rating) as difficulty,
  COALESCE(ugva.status, uga.status, 'Default') as status
FROM gameversions gv
LEFT JOIN user_game_annotations uga ON gv.gameid = uga.gameid
LEFT JOIN user_game_version_annotations ugva 
  ON gv.gameid = ugva.gameid AND gv.version = ugva.version
WHERE gv.gameid = '11374' AND gv.version = 2;
```

### Stage Annotations

**Tables**:
- `game_stages` - Stage metadata (exit numbers, descriptions)
- `user_stage_annotations` - User ratings for stages

**Purpose**: Rate individual stages/exits within games

```sql
-- Define a stage
INSERT INTO game_stages (stage_key, gameid, exit_number, description)
VALUES ('11374-01', '11374', '01', 'First Level - Tutorial');

-- Rate that stage
INSERT INTO user_stage_annotations 
  (stage_key, gameid, exit_number, user_difficulty_rating, user_review_rating)
VALUES ('11374-01', '11374', '01', 3, 4);
```

**Stage Key Format**: `"gameid-exitnumber"` (e.g., "11374-01", "12345-0xFF")

---

## Rating Systems

### 1. Difficulty Rating (0-5)

**Purpose**: How hard is the game/stage?

**Scale**:
- 0 = Super Easy
- 1 = Very Easy
- 2 = Easy
- 3 = Normal
- 4 = Hard
- 5 = Very Hard

**Database**:
- Field: `user_difficulty_rating` (INTEGER 0-5)
- Constraint: `CHECK (user_difficulty_rating IS NULL OR (user_difficulty_rating >= 0 AND user_difficulty_rating <= 5))`

**UI**: 6 clickable stars (0-5)

### 2. Review Rating (0-5)

**Purpose**: How much do you recommend this game/stage?

**Scale**:
- 0 = Terrible
- 1 = Not Recommended
- 2 = Below Average
- 3 = Average
- 4 = Good
- 5 = Excellent

**Database**:
- Field: `user_review_rating` (INTEGER 0-5)
- Constraint: Same as difficulty

**UI**: 6 clickable stars (0-5)

**Why Separate?**: A game can be very hard (5) but excellent (5), or easy (2) but boring (2)

### 3. Skill Level Rating (0-10)

**Purpose**: Record your skill level when you rated the game (provides context for your ratings)

**Scale**:

| Rating | Label | Description |
|--------|-------|-------------|
| 0 | Observer | "I saw someone play Mario" |
| 1 | Casual | "Casual" |
| 2 | Apprentice | "Apprentice" |
| 3 | Advanced | "Advanced" |
| 4 | Expert | "Expert" |
| 5 | Master | "Master" |
| 6 | Legend | "I am one of the greats: Glitchcat7, jaku, shovda, juzcook, Panga, Stew_, Calco, MrMightymouse, Noblet, MitchFlowerPower, GPB, Aurateur, Pmiller, Barb, ThaBeast, DaWildGrim, etc" |
| 7 | Champion | "I beat Hackers Dragon or JUMP, Responsible World 1.0, Casio, and Fruit Dealer RTA" |
| 8 | Deity | "I would consider a second run of those" |
| 9 | Speedrunner | "I might speed run a few hacks like these" |
| 10 | Pro Speedrunner | "I did speedrun a few hacks of these" |

**Database**:
- Field: `user_skill_rating` (INTEGER 0-10)
- Constraint: `CHECK (user_skill_rating IS NULL OR (user_skill_rating >= 0 AND user_skill_rating <= 10))`

**UI**: 11 smaller stars (0-10) with hover text and caption below

**Why Useful**: Provides context - if someone rated a game as 5 (very hard) but their skill was 10 (pro speedrunner), that tells you the game is EXTREMELY hard!

### Display Format in Lists

**Main List Column**: "My Ratings"  
**Format**: `"D:4 R:5"` (Difficulty:4, Review:5)  
**Examples**:
- `D:5 R:3` - Very hard, average quality
- `D:2 R:5` - Easy, excellent
- `D:— R:—` - Not rated

---

## Run Management System

### Purpose

Plan and execute **challenge runs** - sequences of games/stages to complete with optional conditions.

### Database Schema

#### 1. runs Table

**Purpose**: Run metadata and status

```sql
CREATE TABLE runs (
    run_uuid VARCHAR(255) PRIMARY KEY,
    run_name VARCHAR(255),              -- User-defined name
    run_description TEXT,               -- Description
    status VARCHAR(50) DEFAULT 'preparing',  -- preparing, active, completed, cancelled
    created_at TIMESTAMP,
    started_at TIMESTAMP NULL,          -- When started
    completed_at TIMESTAMP NULL,        -- When finished
    updated_at TIMESTAMP,
    total_challenges INTEGER DEFAULT 0,
    completed_challenges INTEGER DEFAULT 0,
    skipped_challenges INTEGER DEFAULT 0,
    global_conditions TEXT,             -- JSON array of ChallengeCondition
    config_json TEXT
);
```

**Run States**:
```
preparing → active → completed
     ↓         ↓
  cancelled  cancelled
```

- **preparing**: User is building the run plan (editable)
- **active**: Run started, timer running, entries locked
- **completed**: Run finished successfully
- **cancelled**: Run aborted

#### 2. run_plan_entries Table

**Purpose**: Store planned challenges (before execution)

```sql
CREATE TABLE run_plan_entries (
    entry_uuid VARCHAR(255) PRIMARY KEY,
    run_uuid VARCHAR(255) NOT NULL,     -- References runs
    sequence_number INTEGER NOT NULL,   -- Order in run (1, 2, 3...)
    entry_type VARCHAR(50) NOT NULL,    -- game, stage, random_game, random_stage
    
    -- For specific challenges
    gameid VARCHAR(255),                -- Specific game ID
    exit_number VARCHAR(255),           -- Specific exit (for stage)
    
    -- For random challenges
    count INTEGER DEFAULT 1,            -- How many times
    filter_difficulty VARCHAR(255),     -- Filter by difficulty
    filter_type VARCHAR(255),           -- Filter by type
    filter_pattern VARCHAR(255),        -- Additional filter
    filter_seed VARCHAR(255),           -- Random seed
    
    -- Metadata
    conditions TEXT,                    -- JSON array of ChallengeCondition
    entry_notes TEXT,
    created_at TIMESTAMP,
    
    UNIQUE(run_uuid, sequence_number)
);
```

**Entry Types**:

1. **game**: Specific game (full playthrough)
   - Added via "Add to Run" button
   - Type is **locked** (can't be changed)
   - No filter fields (shows "—")
   - Example: Play "Super Dram World" (any%)

2. **stage**: Specific stage/exit
   - Added via "Add Chosen Stages to Run"
   - Type is **locked**
   - No filter fields
   - Example: Play "Super Dram World" exit 0x0F

3. **random_game**: Random game matching filters
   - Added via "Add Random Game" button
   - Type is **unlocked** (can toggle to random_stage)
   - All filter fields shown and editable
   - Example: 5 random Kaizo games with seed "abc123"

4. **random_stage**: Random stage matching filters
   - Type is **unlocked** (can toggle to random_game)
   - All filter fields shown
   - Example: 10 random stages from Advanced difficulty games

#### 3. run_results Table

**Purpose**: Store actual execution results (expanded from plan when run starts)

```sql
CREATE TABLE run_results (
    result_uuid VARCHAR(255) PRIMARY KEY,
    run_uuid VARCHAR(255) NOT NULL,
    plan_entry_uuid VARCHAR(255),       -- Original plan entry
    sequence_number INTEGER NOT NULL,
    
    -- Resolved challenge (what was actually played)
    gameid VARCHAR(255) NOT NULL,
    game_name VARCHAR(255),             -- Cached game name
    exit_number VARCHAR(255),
    stage_description VARCHAR(255),
    
    -- Challenge metadata
    was_random BOOLEAN DEFAULT 0,       -- Was this randomly selected?
    revealed_early BOOLEAN DEFAULT 0,   -- Name revealed before attempt?
    
    -- Result
    status VARCHAR(50) DEFAULT 'pending',  -- pending, success, ok, skipped, failed
    started_at TIMESTAMP NULL,
    completed_at TIMESTAMP NULL,
    duration_seconds INTEGER,           -- Time spent
    
    -- Metadata
    conditions TEXT,                    -- JSON array (combined global + entry)
    result_notes TEXT,
    
    UNIQUE(run_uuid, sequence_number)
);
```

**Result States**:
- **pending**: Challenge started but not completed
- **success**: Completed successfully (clean)
- **ok**: Completed with warning (e.g., name revealed early)
- **skipped**: User chose to skip
- **failed**: User failed the challenge

#### 4. run_archive Table

**Purpose**: Summary data for completed/archived runs

```sql
CREATE TABLE run_archive (
    archive_uuid VARCHAR(255) PRIMARY KEY,
    run_uuid VARCHAR(255) NOT NULL UNIQUE,
    archived_at TIMESTAMP,
    archive_notes TEXT,
    total_time_seconds INTEGER,         -- Total run time
    success_rate DECIMAL(5,2),          -- Percentage successful
    UNIQUE(run_uuid)
);
```

### Challenge Conditions

**Available Conditions**:
1. **Hitless** - No getting hit
2. **Deathless** - No dying
3. **No Coins** - Don't collect coins
4. **No Powerups** - Don't use powerups
5. **No Midway** - Don't use midway points

**Storage**: JSON array in TEXT fields

**Example**:
```json
["Hitless", "Deathless", "No Midway"]
```

**Two Levels**:

1. **Global Conditions** (`runs.global_conditions`)
   - Apply to entire run
   - Set via "Set Global Conditions" button
   - All challenges must follow these

2. **Entry Conditions** (`run_plan_entries.conditions`, `run_results.conditions`)
   - Apply to specific challenge
   - Set via "Conditions" button per entry
   - Supplements global conditions

### Run Workflow

```
1. Create Run (status = 'preparing')
   ↓
2. Add Plan Entries
   - Add specific games (type locked)
   - Add specific stages (type locked)
   - Add random challenges (type unlocked)
   - Set conditions per entry
   - Set global conditions
   ↓
3. Save Plan (Click "Stage and Save")
   - Prompts for run name
   - Creates run in database
   - Saves to run_plan_entries table
   - Enables "Start Run" button
   ↓
4. Start Run (Click "▶ Start Run")
   - Status changes to 'active'
   - Expand plan entries to run_results
   - If count > 1, create multiple results
   - If random, mask name as "???" until attempted
   - Start timer
   - Highlight first challenge
   - Show Done/Skip buttons
   ↓
5. Execute Challenges
   - Click "✓ Done" → Records success, moves to next
   - Click "⏭ Skip" → Records skip, moves to next
   - Timer continues running
   - Progress updates (Challenge X / Total)
   - Current challenge highlighted in blue
   ↓
6. Complete Run (status = 'completed')
   - Last challenge completed
   - Stop timer
   - Show completion summary (time, challenges)
   - Close modal
   OR
   Cancel Run (Click "✕ Cancel Run")
   - Confirms cancellation
   - Status changes to 'cancelled'
   - Stop timer
   - Close modal
   ↓
7. Archive Run (Future)
   - Move to run_archive
   - Preserve for history
```

### Random Challenge Resolution

**When Planning**: Store filters only
```json
{
  "entry_type": "random_game",
  "filter_type": "Kaizo",
  "filter_difficulty": "Advanced",
  "count": 3,
  "filter_seed": "abc123"
}
```

**When Starting Run**: Resolve to actual games
```javascript
// Use seed for reproducibility
const games = selectRandomGames({
  type: 'Kaizo',
  difficulty: 'Advanced',
  count: 3,
  seed: 'abc123'
});

// Create run_results for each
games.forEach((game, i) => {
  createRunResult({
    gameid: game.id,
    game_name: '???',  // Masked until attempted
    was_random: true
  });
});
```

**Name Masking**: Random challenge names are hidden until:
- User attempts the challenge, OR
- User explicitly reveals (marks `revealed_early = 1`)

If revealed early, can only achieve "ok" status, not "success"

---

## Settings System

### csettings Table

**Purpose**: Store all user preferences as key-value pairs

```sql
CREATE TABLE csettings (
    csettinguid VARCHAR(255) PRIMARY KEY,
    csetting_name VARCHAR(255) UNIQUE,  -- Setting key
    csetting_value TEXT NOT NULL,       -- Setting value (as string)
    csetting_binary BLOB                -- For binary data (unused currently)
);
```

### Settings in UI

**Settings Modal** includes:

1. **ROM and Tools**:
   - `vanillaRomPath` - Path to vanilla SMW ROM
   - `vanillaRomValid` - Boolean (stored as "true"/"false")
   - `flipsPath` - Path to FLIPS executable
   - `flipsValid` - Boolean
   - `asarPath` - Path to ASAR
   - `asarValid` - Boolean
   - `uberAsmPath` - Path to UberASM
   - `uberAsmValid` - Boolean

2. **Launch Configuration**:
   - `launchMethod` - 'manual', 'program', or 'usb2snes'
   - `launchProgram` - Path to launch program (e.g., RetroArch)
   - `launchProgramArgs` - Arguments (e.g., '%file')

3. **USB2SNES Configuration**:
   - `usb2snesAddress` - WebSocket URL (default: 'ws://localhost:64213')
   - `usb2snesEnabled` - 'yes' or 'no'
   - `usb2snesLaunchPref` - 'auto', 'manual', or 'reset'
   - `usb2snesUploadPref` - 'manual', 'check', or 'always'
   - `usb2snesUploadDir` - Upload directory (default: '/work')

### Settings Storage

**Save**: Convert all settings to strings and store
```javascript
await electronAPI.saveSettings({
  vanillaRomValid: 'true',
  flipsPath: '/usr/bin/flips',
  launchMethod: 'program',
  launchProgram: '/usr/bin/retroarch',
  // ... etc
});
```

**Load**: Retrieve and convert back to appropriate types
```javascript
const settings = await electronAPI.getSettings();
// Returns: { vanillaRomValid: 'true', flipsPath: '/usr/bin/flips', ... }

// Convert strings back to booleans
settings.vanillaRomValid = settings.vanillaRomValid === 'true';
```

---

## User Interface Components

### Main Window Layout

```
┌─────────────────────────────────────────────────────────────┐
│ TOOLBAR                                                     │
│ [Settings] [Search...] [Filters] [Bulk Actions]            │
│ ☐Show Hidden ☐Hide Finished                 [Prepare Run] │
├─────────────────────────────────────────────────────────────┤
│ CONTENT                                                      │
│ ┌──────────────────────────────┬────────────────────────┐  │
│ │ MAIN GAME LIST              │ DETAILS INSPECTOR      │  │
│ │                              │                        │  │
│ │ Table with 3,168 games      │ Version Selector       │  │
│ │ Columns:                     │ Official Fields (RO)   │  │
│ │ - Checkbox                   │ My Ratings (Stars)     │  │
│ │ - Action (*)                 │ Status, Hidden, etc.   │  │
│ │ - Id, Name, Type, Author    │ My Notes               │  │
│ │ - Length, Status             │ Action Buttons         │  │
│ │ - My Ratings (D:X R:Y)      │                        │  │
│ │ - Public, Hidden, Notes     ├────────────────────────┤  │
│ │                              │ STAGES PANEL           │  │
│ │ 3,168 games total           │                        │  │
│ │                              │ Table with stages      │  │
│ └──────────────────────────────┴────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Details Inspector

**Location**: Right sidebar (360px width)

**Sections**:

1. **Version Selector**
   ```html
   <select v-model="selectedVersion">
     <option v-for="v in availableVersions" :value="v">
       Version {{ v }}{{ v === latestVersion ? ' (Latest)' : '' }}
     </option>
   </select>
   ```
   - Shows all available versions for selected game
   - Marks latest version
   - Changing version loads that version's data + annotations

2. **Official Fields** (Read-Only)
   - Styled with gray background
   - Data from gameversions table
   - Fields: Id, Name, Type (combinedtype), Legacy Type, Author, Length, Public Difficulty, Public Rating

3. **User Editable Fields**
   
   **Status Dropdown**:
   ```html
   <select v-model="selectedItem.Status">
     <option value="Default">Default</option>
     <option value="In Progress">In Progress</option>
     <option value="Finished">Finished</option>
   </select>
   ```

   **Difficulty Stars** (0-5):
   ```html
   <div class="star-rating">
     <span v-for="n in 6" :key="n" 
           @click="selectedItem.MyDifficultyRating = n - 1"
           :class="{ filled: (n-1) <= (selectedItem.MyDifficultyRating ?? -1) }"
           class="star">★</span>
     <button @click="selectedItem.MyDifficultyRating = null">✕</button>
     <span class="rating-label">{{ difficultyLabel(...) }}</span>
   </div>
   ```

   **Review Stars** (0-5): Same as difficulty
   
   **Skill Level Stars** (0-10):
   ```html
   <div class="skill-rating-container">
     <div class="star-rating">
       <span v-for="n in 11" :key="n"
             @click="selectedItem.MySkillRating = n - 1"
             :title="skillRatingHoverText(n - 1)"
             class="star star-small">★</span>
       <!-- ... -->
     </div>
     <div class="skill-caption" v-if="selectedItem.MySkillRating !== null">
       {{ skillRatingHoverText(selectedItem.MySkillRating) }}
     </div>
   </div>
   ```

   **Checkboxes**:
   - Hidden
   - Exclude from Random

   **Textarea**:
   - My Notes

4. **Action Buttons**
   - **"Set Version-Specific Rating"**: Creates version-specific annotation
   - **"View Details (JSON)"**: Opens modal with gvjsondata

### Stages Panel

**Location**: Right sidebar, below Details

**Purpose**: Show and annotate individual stages/exits within a game

**Structure**:
```
Actions: [Add to Run] [Edit notes] [Set Difficulty] [Set Review]

Table:
☐ | Parent ID | Exit # | Description | Public | My Ratings | My notes
──┼───────────┼────────┼─────────────┼────────┼────────────┼─────────
☐ | 11374     | 01     | Tutorial    | 2.5    | D:3 R:4    | Easy
☐ | 11374     | 02     | Cave Level  | 3.5    | D:5 R:5    | Practice
```

**Features**:
- Multi-select stages with checkboxes
- Add selected stages to run
- Set difficulty/review ratings for stages
- Edit notes for selected stages

### Main Game List

**Columns**:

| Column | Source | Description |
|--------|--------|-------------|
| Checkbox | UI state | Multi-select |
| Action | Computed | "*" if in run list |
| Id | gameversions.gameid | Game identifier |
| Name | gameversions.name | Game name |
| Type | gameversions.combinedtype | Complete type |
| Author | gameversions.author | Creator |
| Length | gameversions.length | Game length |
| Status | user_game_annotations.status | User's status |
| My Ratings | Computed | "D:4 R:5" format |
| Public | gameversions (computed) | Public rating |
| Hidden | user_game_annotations.hidden | Yes/No |
| My notes | user_game_annotations.user_notes | Truncated |

**Features**:
- Click row to select (single-select)
- Click checkbox to multi-select
- Filter by any column value
- Show/hide hidden games
- Hide finished games
- Bulk status updates
- Bulk hide/unhide
- Add to run

### Prepare Run Modal

**Size**: 1200px wide modal

**Header (Preparing State)**:
- Title: "Prepare Run" (or "Prepare Run: Run Name" after save)
- **[Set Global Conditions]** - Opens dialog
- **[Stage and Save]** - Saves run plan to database
- **[▶ Start Run]** - Starts the run (disabled until saved)
- **[✕]** Close

**Header (Active State)**:
- Title: "Active Run: Run Name"
- **[⏱ Timer]** - Live elapsed time (e.g., "2m 15s")
- **[Progress]** - Current challenge / Total (e.g., "Challenge 3 / 10")
- **[✓ Done]** - Mark current challenge complete, move to next
- **[⏭ Skip]** - Skip current challenge, move to next
- **[✕ Cancel Run]** - Cancel entire run (with confirmation)
- **[✕]** Close

**Toolbar** (hidden when run is active):

Left side:
- [Check All] [Uncheck All]
- [Remove] - Remove checked entries
- [↑ Move Up] [↓ Move Down] - Bulk move

Right side (Add Random):
```
Filter Type: [Dropdown]  Difficulty: [Dropdown]
Pattern: [Input]  Count: [Input]  Seed: [Input]
[Add Random Game]
```

**Table**:

| Column | Description |
|--------|-------------|
| ☐ | Checkbox (disabled when active) |
| # | Sequence number (1, 2, 3...) |
| ↑↓ | Per-row move buttons (disabled when active) |
| ID | Game ID or "(random)" |
| Entry Type | Dropdown (disabled when active or locked) |
| Name | Game/stage name or "Random Game" |
| Stage # | Exit number (for stages) |
| Stage name | Stage description |
| Count | How many times (1-100, disabled when active) |
| Filter difficulty | Shown only for random types (disabled when active) |
| Filter type | Shown only for random types (disabled when active) |
| Filter pattern | Shown only for random types (disabled when active) |
| Seed | Shown only for random types (disabled when active) |
| Conditions | [Set] or [✓ (n)] button (disabled when active) |

**When Run is Active**:
- Current challenge row highlighted in blue with blue left border
- All inputs and buttons disabled
- Cannot edit, remove, or reorder entries

**Entry Type Behavior**:

Locked Entries (game, stage):
- Dropdown is disabled
- Only shows current type
- Filter fields show "—"
- Added via main list buttons

Unlocked Entries (random_game, random_stage):
- Dropdown enabled
- Can switch between random_game ↔ random_stage
- All filter fields editable
- Added via "Add Random Game"

**Conditions UI**:

Per-Entry:
```
Click [Set] → Dialog:
"Select challenge conditions for this entry:

1. Hitless
2. Deathless
3. No Coins
4. No Powerups
5. No Midway

Enter numbers (e.g., '1,3,5' or 'all' or 'none'):"

User enters: "1,2"
Button becomes: [✓ (2)]
Hover shows: "Conditions: Hitless, Deathless"
```

Global (entire run):
- Same UI as per-entry
- Button in modal header
- Shows: "✓ Global Conditions (n)"

### Settings Modal

**Size**: 800px wide modal

**Sections**:

Each setting has:
- Label (with status icon ✓ if valid)
- Drop zone for file drag-and-drop
- Browse button
- Or input field
- Caption with instructions/links

**Example**:
```
┌─────────────────────────────────────────────┐
│ [✓] Import required Vanilla SMW ROM         │
│     [Drag ROM file here]  [Browse]          │
│     You must have a legally-obtained SMW... │
│     sha224: fdc4c00e09a8e08d395003e9c8a7... │
├─────────────────────────────────────────────┤
│ Game launch method:  [Launch Manually ▼]   │
├─────────────────────────────────────────────┤
│ Launch Program:  [/path/to/retroarch____]   │
└─────────────────────────────────────────────┘
```

**Footer**:
- [Save Changes and Close] - Saves to csettings table

---

## IPC Architecture

### Security Model

```
Renderer Process (Vue.js)
  - Sandboxed
  - No Node.js access
  - No file system access
  - Only window.electronAPI available
        ↓ IPC (Secure Channel)
Main Process (Node.js)
  - Full Node.js access
  - Database connections
  - File system access
  - Validates all inputs
```

### IPC Channels

**Naming Convention**: `namespace:operation:entity`

#### Game Data Channels

1. **db:rhdata:get:games**
   - Request: None
   - Response: Array of games (latest versions with annotations)
   - Used: On app mount

2. **db:rhdata:get:versions**
   - Request: `{ gameid: string }`
   - Response: Array of version numbers
   - Used: When loading game for version selector

3. **db:rhdata:get:game**
   - Request: `{ gameid: string, version: number }`
   - Response: Game data with annotations for that version
   - Used: When switching versions

#### Annotation Channels

4. **db:clientdata:set:annotation**
   - Request: GameAnnotation object
   - Response: `{ success: boolean }`
   - Used: Auto-save (debounced 500ms)

5. **db:clientdata:set:version-annotation**
   - Request: VersionAnnotation object
   - Response: `{ success: boolean }`
   - Used: When setting version-specific rating

#### Stage Channels

6. **db:clientdata:get:stages**
   - Request: `{ gameid: string }`
   - Response: Array of stages
   - Used: When game selected in details panel

7. **db:clientdata:set:stage-annotation**
   - Request: StageAnnotation object
   - Response: `{ success: boolean }`
   - Used: When rating stages

#### Settings Channels

8. **db:settings:get:all**
   - Request: None
   - Response: Object with all settings
   - Used: On app mount

9. **db:settings:set:value**
   - Request: `{ name: string, value: string }`
   - Response: `{ success: boolean }`
   - Used: Single setting update

10. **db:settings:set:bulk**
    - Request: `{ settings: Object }`
    - Response: `{ success: boolean }`
    - Used: Settings modal "Save Changes"

#### Run System Channels

11. **db:runs:create**
    - Request: `{ runName, runDescription, globalConditions }`
    - Response: `{ success: boolean, runUuid: string }`
    - Used: Creating new run

12. **db:runs:save-plan**
    - Request: `{ runUuid, entries }`
    - Response: `{ success: boolean }`
    - Used: Saving run plan

13. **db:runs:start**
    - Request: `{ runUuid }`
    - Response: `{ success: boolean }`
    - Used: Starting a run (changes status to active, expands plan to results)

14. **db:runs:record-result**
    - Request: `{ runUuid, challengeIndex, status }`
    - Response: `{ success: boolean }`
    - Used: Recording challenge completion (success, skipped, failed)

15. **db:runs:cancel**
    - Request: `{ runUuid }`
    - Response: `{ success: boolean }`
    - Used: Cancelling an active run

### Type Definitions

```typescript
interface GameAnnotation {
  gameid: string;
  status: 'Default' | 'In Progress' | 'Finished';
  myDifficultyRating?: number | null;  // 0-5
  myReviewRating?: number | null;      // 0-5
  mySkillRating?: number | null;       // 0-10
  hidden: boolean;
  excludeFromRandom: boolean;
  mynotes?: string;
}

interface VersionAnnotation {
  gameid: string;
  version: number;
  status?: 'Default' | 'In Progress' | 'Finished';
  myDifficultyRating?: number | null;
  myReviewRating?: number | null;
  mySkillRating?: number | null;
  mynotes?: string;
}

interface StageAnnotation {
  gameid: string;
  exitNumber: string;
  myDifficultyRating?: number | null;
  myReviewRating?: number | null;
  mySkillRating?: number | null;
  myNotes?: string;
}

type ChallengeCondition = 
  | 'Hitless' 
  | 'Deathless' 
  | 'No Coins' 
  | 'No Powerups' 
  | 'No Midway';

interface RunEntry {
  key: string;  // Unique UI key
  id: string;   // gameid or "(random)"
  entryType: 'game' | 'stage' | 'random_game' | 'random_stage';
  name: string;
  stageNumber?: string;
  stageName?: string;
  count: number;  // 1-100
  filterDifficulty?: string;
  filterType?: string;
  filterPattern?: string;
  seed?: string;
  isLocked?: boolean;  // If true, type can't be changed
  conditions: ChallengeCondition[];
}
```

---

## Data Flow

### Application Startup

```
1. main.js loads
   ├─> Initialize DatabaseManager
   ├─> Register IPC handlers
   └─> Create BrowserWindow

2. Window loads Vue app
   ├─> preload.js exposes window.electronAPI
   └─> App.vue mounts

3. onMounted() runs
   ├─> loadGames()
   │   ├─> IPC: db:rhdata:get:games
   │   ├─> Main process queries databases
   │   ├─> Returns 3,168 games
   │   └─> items[] populated
   │
   ├─> For each game: getVersions()
   │   └─> Populates AvailableVersions
   │
   └─> loadSettings()
       └─> IPC: db:settings:get:all

4. UI renders with data
```

### User Selects Game

```
1. User clicks game in list
   ↓
2. selectedIds updated
   ↓
3. selectedItem computed updates
   ↓
4. Watcher triggers: watch(selectedItem)
   ├─> Check if stages loaded
   ├─> If not: loadStages(gameid)
   │   └─> IPC: db:clientdata:get:stages
   └─> Set selectedVersion = game.CurrentVersion
   ↓
5. Details panel shows:
   ├─> Version selector
   ├─> Official fields (from gameversions)
   ├─> User annotations (from clientdata)
   └─> Stages (from clientdata)
```

### User Changes Rating

```
1. User clicks star
   ↓
2. selectedItem.MyDifficultyRating = 4
   ↓
3. Watcher triggers: watch(items, { deep: true })
   ↓
4. debouncedSaveAnnotation() called
   ├─> Wait 500ms for more changes
   └─> IPC: db:clientdata:set:annotation
   ↓
5. Main process saves to database
   ↓
6. Console confirms: "Saved annotation"
```

### User Switches Version

```
1. User changes version dropdown
   ↓
2. selectedVersion updated (e.g., 1 → 2)
   ↓
3. Watcher triggers: watch(selectedVersion)
   ↓
4. loadGameVersion(gameid, 2)
   ├─> IPC: db:rhdata:get:game
   ├─> Main process queries:
   │   SELECT ... FROM gameversions
   │   LEFT JOIN user_game_annotations
   │   LEFT JOIN user_game_version_annotations
   │   WHERE gameid = ? AND version = 2
   └─> Returns version 2 data with annotations
   ↓
5. UI updates:
   ├─> Shows version 2 metadata
   ├─> Shows version 2 annotations (if exist)
   └─> Or falls back to game-wide annotations
```

### User Creates Run

```
1. User adds games to run:
   ├─> Check games
   ├─> Click "Add to Run"
   └─> Creates RunEntry with isLocked=true, entryType='game'

2. User adds random challenges:
   ├─> Set filters (type, difficulty, pattern, count, seed)
   ├─> Click "Add Random Game"
   └─> Creates RunEntry with isLocked=false, entryType='random_game'

3. User sets conditions:
   ├─> Global: Click "Set Global Conditions"
   └─> Per-entry: Click "Set" in Conditions column

4. User reorders:
   ├─> Drag-and-drop rows
   └─> Or use ↑↓ buttons

5. User saves:
   ├─> Click "Stage and Save"
   ├─> IPC: db:runs:create
   ├─> IPC: db:runs:save-plan
   └─> Saved to database
```

---

## Key Implementation Details

### Auto-Save System

**Debouncing**:
```javascript
const debouncedSaveAnnotation = debounce(async (item: Item) => {
  await electronAPI.saveAnnotation(item);
}, 500);

// Watcher
watch(items, () => {
  for (const item of items) {
    debouncedSaveAnnotation(item);
  }
}, { deep: true });
```

**Why 500ms?**: 
- Prevents excessive writes (user changing multiple ratings)
- Feels instant to user
- Reduces database load

### Cross-Database Queries

**Method 1: ATTACH DATABASE**
```javascript
db.exec(`ATTACH DATABASE '${clientDataPath}' AS clientdata`);

const games = db.prepare(`
  SELECT gv.*, uga.status, uga.user_difficulty_rating
  FROM gameversions gv
  LEFT JOIN clientdata.user_game_annotations uga ON gv.gameid = uga.gameid
`).all();

db.exec('DETACH DATABASE clientdata');
```

**Method 2: Helper Function**
```javascript
return dbManager.withClientData('rhdata', (db) => {
  // db has clientdata attached
  const result = db.prepare(query).all();
  return result;
  // clientdata auto-detached
});
```

### Version-Specific Override Logic

```sql
-- Priority: version-specific > game-wide > default
SELECT 
  COALESCE(
    ugva.user_difficulty_rating,     -- Version-specific (highest priority)
    uga.user_difficulty_rating,      -- Game-wide (fallback)
    NULL                             -- Default (no rating)
  ) as difficulty
FROM gameversions gv
LEFT JOIN user_game_annotations uga ON gv.gameid = uga.gameid
LEFT JOIN user_game_version_annotations ugva 
  ON gv.gameid = ugva.gameid AND gv.version = ugva.version
WHERE gv.gameid = ? AND gv.version = ?;
```

### Random Game Selection

**With Exclusions**:
```sql
SELECT gv.gameid, gv.name
FROM gameversions gv
LEFT JOIN clientdata.user_game_annotations uga ON gv.gameid = uga.gameid
WHERE gv.removed = 0
  AND gv.obsoleted = 0
  AND gv.local_runexcluded = 0  -- Curator says OK
  AND (uga.exclude_from_random IS NULL OR uga.exclude_from_random = 0)  -- User says OK
  AND gv.fields_type = ?  -- Filter by type
  AND gv.difficulty = ?  -- Filter by difficulty
  AND gv.version = (SELECT MAX(version) FROM gameversions gv2 WHERE gv2.gameid = gv.gameid)
ORDER BY RANDOM()
LIMIT ?;
```

**Seed-Based** (for reproducibility):
```javascript
function selectRandomGames(filters) {
  const rng = seedRandom(filters.seed);
  const eligible = getEligibleGames(filters);
  shuffle(eligible, rng);
  return eligible.slice(0, filters.count);
}
```

---

## File Locations

### Code Files

**Backend** (electron/):
- `main.js` - Main process entry point
- `preload.js` - IPC API exposure
- `database-manager.js` - Database connection management
- `ipc-handlers.js` - IPC request handlers

**Frontend** (electron/renderer/src/):
- `App.vue` - Main Vue component (1900+ lines)
- `main.ts` - Vue app entry point
- `env.d.ts` - TypeScript declarations

**Configuration**:
- `electron/renderer/vite.config.ts` - Vite configuration
- `electron/renderer/tsconfig.json` - TypeScript configuration
- `package.json` - Root package with npm scripts

### Database Files

**Location** (varies by platform):

Development:
```
electron/rhdata.db
electron/patchbin.db
electron/clientdata.db
```

Production Linux:
```
~/.config/rhtools/rhdata.db
~/.config/rhtools/patchbin.db
~/.config/rhtools/clientdata.db
```

Production Windows:
```
C:\Users\<User>\AppData\Roaming\rhtools\rhdata.db
C:\Users\<User>\AppData\Roaming\rhtools\patchbin.db
C:\Users\<User>\AppData\Roaming\rhtools\clientdata.db
```

### Migration Files

**Schema** (electron/sql/):
- `rhdata.sql` - rhdata.db base schema
- `patchbin.sql` - patchbin.db base schema
- `clientdata.sql` - clientdata.db base schema

**Migrations** (electron/sql/migrations/):

rhdata.db:
- `001_add_fields_type_raw_difficulty.sql`
- `002_add_combinedtype.sql`
- `003_backfill_combinedtype.js`
- `004_add_local_resource_tracking.sql`
- `005_add_local_runexcluded.sql`

clientdata.db:
- `001_clientdata_user_annotations.sql`
- `002_clientdata_enhanced_ratings_and_runs.sql`
- `003_clientdata_skill_rating_and_conditions.sql`

### Test Files

**Location**: electron/tests/

- `test_clientdata_annotations.js` - Base annotation tests (40 tests)
- `test_enhanced_ratings.js` - Enhanced ratings + run system (25 tests)
- `test_integration.js` - Database integration tests (17 tests)

---

## Common Development Tasks

### Adding a New IPC Channel

1. **Define in ipc-handlers.js**:
```javascript
ipcMain.handle('db:my-new-channel', async (event, { param1, param2 }) => {
  try {
    const db = dbManager.getConnection('rhdata');
    const result = db.prepare(query).all(param1, param2);
    return result;
  } catch (error) {
    console.error('Error:', error);
    throw error;
  }
});
```

2. **Expose in preload.js**:
```javascript
contextBridge.exposeInMainWorld('electronAPI', {
  // ... existing methods
  myNewMethod: (param1, param2) => 
    ipcRenderer.invoke('db:my-new-channel', { param1, param2 }),
});
```

3. **Use in App.vue**:
```javascript
const result = await (window as any).electronAPI.myNewMethod(param1, param2);
```

### Adding a New Rating Type

1. **Add column to schema** (migration SQL)
2. **Add to TypeScript types** (App.vue)
3. **Add star picker to UI** (template)
4. **Add to save function** (saveAnnotation)
5. **Update IPC handler** (include new field)
6. **Update views** (SQL views)

### Adding a New Setting

1. **Add to settings object** (App.vue)
2. **Add to Settings modal UI** (template)
3. **Add to saveSettings** (include in save object)
4. **Add to loadSettings** (parse from result)
5. **No database changes needed** (csettings is key-value)

### Modifying the Run System

**Key Files**:
- `electron/ipc-handlers.js` - Run database operations
- `App.vue` lines 1070-1350 - Run modal logic
- `clientdata.db` tables: runs, run_plan_entries, run_results

**Key Functions in App.vue**:
- `addSelectedToRun()` - Add games
- `addStagesToRun()` - Add stages
- `addRandomGameToRun()` - Add random
- `editConditions()` - Set entry conditions
- `editGlobalConditions()` - Set global conditions
- `isRandomEntry()` - Check if entry is random type

**Important**: 
- Locked entries (game/stage) have `isLocked=true`
- Random entries can toggle between random_game/random_stage
- Filter fields only shown for random entries
- Count field always shown (allows repeating same challenge)

---

## Troubleshooting Guide

### App Won't Start

**Check**:
1. Is Vite running? `lsof -i:5173`
2. Is Electron installed? `npx electron --version`
3. Check console for errors

### Blank Window

**Check**:
1. Press F12 to open DevTools
2. Look for JavaScript errors in Console
3. Check Network tab - should load main.ts, App.vue
4. Check if Vite and Electron on same port

### Database Errors

**Check**:
1. Do databases exist? `ls -lh electron/*.db`
2. Are migrations applied? `sqlite3 electron/clientdata.db "SELECT name FROM sqlite_master WHERE type='table';"`
3. Is better-sqlite3 built for Electron? `npm rebuild better-sqlite3`

### Native Module Errors

```bash
# Rebuild for Electron
cd /home/main/proj/rhtools/node_modules/better-sqlite3
npx node-gyp rebuild --target=30.5.1 --arch=x64 --dist-url=https://electronjs.org/headers
```

### Data Not Saving

**Check**:
1. Console shows "Saved annotation" messages?
2. Query database directly: `sqlite3 electron/clientdata.db "SELECT * FROM user_game_annotations;"`
3. Check IPC handler for errors

---

## Performance Considerations

### Query Optimization

**Use Indexes**: All common queries have indexes
```sql
CREATE INDEX idx_user_game_status ON user_game_annotations(status);
CREATE INDEX idx_user_game_rating ON user_game_annotations(user_difficulty_rating);
```

**Latest Version Query**: Optimized with subquery
```sql
WHERE gv.version = (SELECT MAX(version) FROM gameversions WHERE gameid = gv.gameid)
```

**WAL Mode**: Enabled for concurrency
```javascript
db.pragma('journal_mode = WAL');
```

### UI Performance

**Debounced Saves**: 500ms delay prevents spam

**Lazy Loading**: Stages only loaded when game selected

**Virtual Scrolling**: Not implemented yet (consider for 3,000+ item lists)

---

## Security Considerations

### Context Isolation

Renderer process is **sandboxed**:
- No file system access
- No Node.js modules
- Only window.electronAPI available

### Input Validation

All IPC handlers validate inputs:
```javascript
if (!gameid || typeof gameid !== 'string') {
  throw new Error('Invalid gameid');
}

if (rating < 0 || rating > 5) {
  throw new Error('Rating must be 0-5');
}
```

### SQL Injection Protection

**Always use prepared statements**:
```javascript
// GOOD
db.prepare(`SELECT * FROM games WHERE gameid = ?`).get(gameid);

// BAD - Never do this
db.exec(`SELECT * FROM games WHERE gameid = '${gameid}'`);
```

### Private Data Protection

**clientdata.db** should never be:
- Committed to git
- Shared between users
- Uploaded to cloud (unless encrypted)

Contains:
- Personal opinions (ratings)
- User preferences
- API credentials (encrypted)

---

## Migration Guide

### Applying All Migrations

```bash
# clientdata.db
sqlite3 electron/clientdata.db < electron/sql/clientdata.sql  # Fresh install
# OR
sqlite3 electron/clientdata.db < electron/sql/migrations/001_clientdata_user_annotations.sql
sqlite3 electron/clientdata.db < electron/sql/migrations/002_clientdata_enhanced_ratings_and_runs.sql
sqlite3 electron/clientdata.db < electron/sql/migrations/003_clientdata_skill_rating_and_conditions.sql

# rhdata.db
sqlite3 electron/rhdata.db < electron/sql/migrations/005_add_local_runexcluded.sql
```

### Verifying Migrations

```bash
# Check clientdata.db tables
sqlite3 electron/clientdata.db "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"

# Expected: 9 tables
# csettings, apiservers, user_game_annotations, user_game_version_annotations,
# game_stages, user_stage_annotations, runs, run_plan_entries, run_results, run_archive

# Check rhdata.db columns
sqlite3 electron/rhdata.db "PRAGMA table_info(gameversions);" | grep runexcluded

# Expected: 42|local_runexcluded|INTEGER|0|0|0
```

---

## Quick Reference

### Load Games
```javascript
const games = await window.electronAPI.getGames();
```

### Save Annotation
```javascript
await window.electronAPI.saveAnnotation({
  gameid: '11374',
  status: 'In Progress',
  myDifficultyRating: 4,
  myReviewRating: 5,
  mySkillRating: 6,
  hidden: false,
  excludeFromRandom: false,
  mynotes: 'Great game!'
});
```

### Get Stages
```javascript
const stages = await window.electronAPI.getStages('11374');
```

### Save Settings
```javascript
await window.electronAPI.saveSettings({
  launchMethod: 'program',
  launchProgram: '/usr/bin/retroarch',
  // ... all settings
});
```

### Query Database Directly (for debugging)
```bash
# Count games
sqlite3 electron/rhdata.db "SELECT COUNT(*) FROM gameversions;"

# View annotations
sqlite3 electron/clientdata.db "SELECT * FROM user_game_annotations;"

# Check run plans
sqlite3 electron/clientdata.db "SELECT * FROM run_plan_entries;"
```

---

## Related Documentation

**For Overview**:
- `ELECTRON_APP_MASTER_REFERENCE.md` (this document)
- `DATABASE_INTEGRATION_COMPLETE.md` - Implementation summary

**For Schema Details**:
- `SCHEMACHANGES.md` - Complete schema changelog
- `CLIENTDATA_USER_ANNOTATIONS.md` - User annotation guide
- `ENHANCED_RATINGS_AND_RUN_SYSTEM.md` - Rating + run system guide

**For Database**:
- `DBMIGRATE.md` - All migration commands
- `ELECTRON_APP_DATABASES.md` - Database architecture

**For Integration**:
- `ELECTRON_DATABASE_INTEGRATION_PLAN.md` - Integration guide
- `ELECTRON_IPC_ARCHITECTURE.md` - IPC specifications

**For Users**:
- `ELECTRON_APP_QUICK_START.md` - User guide
- `electron/HOW_TO_START.md` - Startup instructions

---

## Future Development

### Planned Features

1. **Run Execution**:
   - Start button (status → active)
   - Timer display
   - Current challenge highlighting
   - Done/Skip/Undo buttons
   - Result tracking

2. **Random Selection Implementation**:
   - Implement filter-based selection
   - Seed-based reproducibility
   - Name masking until attempted

3. **Stage Definition UI**:
   - Add stages to game_stages
   - Import stage lists
   - Community stage data integration

4. **Statistics Dashboard**:
   - Completion rates
   - Average ratings by type
   - Time spent tracking
   - Favorite games/types

5. **Public Rating Aggregation**:
   - Collect anonymous user ratings
   - Calculate community averages
   - Update public ratings in gameversions

6. **Import/Export**:
   - Backup user annotations
   - Share run configurations
   - Export statistics

---

## Summary

This Electron app provides a **comprehensive game management system** with:

- **3,168 games** from public database
- **Triple rating system** for nuanced feedback
- **Version management** with version-specific annotations
- **Challenge run system** for planning and tracking
- **Full settings persistence**
- **Secure, efficient architecture**
- **Cross-platform support**

All data is properly separated into shareable (rhdata/patchbin) and private (clientdata) databases, with secure IPC communication and efficient cross-database queries.

---

*Master Reference v1.0 - October 12, 2025*  
*For questions about any component, refer to specific documentation linked above*

