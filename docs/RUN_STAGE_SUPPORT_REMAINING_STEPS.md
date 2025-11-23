# Run Stage Support - Remaining Implementation Steps

**Date**: 2025-01-XX
**Feature**: Game Stage and Random Stage support in Run system

## Overview

This document tracks the remaining implementation steps to complete the Game Stage and Random Stage support in the Run system. The UI and database migrations are complete, but backend logic needs to be updated to handle stage entries.

## Completed ✅

1. ✅ RunEntry interface updated with `transLevel` and stage filter fields
2. ✅ "Add Random Stage" button and Stage Limits dropdown UI
3. ✅ `addRandomStageToRun` function (frontend)
4. ✅ "Trans Lvl" column in run table
5. ✅ "Add Stage to Run" button in GameStagesDialog
6. ✅ Database migration for `run_plan_entries` (stage filter fields)
7. ✅ IPC handler `countRandomStageMatches` for counting matching stages
8. ✅ UI always shows both game and stage match counts

## Remaining Steps

### Step 1: Update `saveRunPlan` Handler
**File**: `electron/ipc-handlers.js`
**Function**: `db:runs:save-plan` handler (around line 1914)

**Changes Needed**:
- Update INSERT statement to include new columns:
  - `trans_level` (TEXT)
  - `stage_filter_min_difficulty` (INTEGER)
  - `stage_filter_max_difficulty` (INTEGER)
  - `stage_filter_include_flags` (TEXT - JSON array)
  - `stage_filter_exclude_flags` (TEXT - JSON array)

**Current Code**:
```javascript
INSERT INTO run_plan_entries
  (entry_uuid, run_uuid, sequence_number, entry_type, gameid, exit_number,
   count, filter_difficulty, filter_type, filter_pattern, filter_seed, conditions)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
```

**Should Become**:
```javascript
INSERT INTO run_plan_entries
  (entry_uuid, run_uuid, sequence_number, entry_type, gameid, exit_number,
   count, filter_difficulty, filter_type, filter_pattern, filter_seed, conditions,
   trans_level, stage_filter_min_difficulty, stage_filter_max_difficulty,
   stage_filter_include_flags, stage_filter_exclude_flags)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
```

---

### Step 2: Create Database Migration for `run_results` Table
**File**: `electron/sql/migrations/012_clientdata_run_results_stage_fields.sql`

**Purpose**: Add stage-specific columns to `run_results` table

**Columns to Add**:
- `levelnumber` (TEXT) - Stage level number (hex string, e.g., "001")
- `translevel` (TEXT) - Translevel value (13BF, hex string, e.g., "01")
- `levelname` (TEXT) - Stage name

**Migration should also**:
- Register in `jsutils/migratedb.js`

---

### Step 3: Create `selectRandomStage` Function
**File**: `electron/seed-manager.js`
**Function**: `selectRandomStage`

**Purpose**: Select a random stage deterministically based on seed and filters (similar to `selectRandomGame`)

**Parameters**:
- `dbManager` - Database manager
- `seed` - Full seed (MAPID-SUFFIX)
- `challengeIndex` - Index of challenge (for uniqueness)
- `filterType` - Game type filter (optional)
- `filterDifficulty` - Game difficulty filter (optional)
- `filterPattern` - Game pattern filter (optional)
- `stageMinDifficulty` - Stage min difficulty (1-7, optional)
- `stageMaxDifficulty` - Stage max difficulty (1-7, optional)
- `stageIncludeFlags` - Array of flag codes to include (optional)
- `stageExcludeFlags` - Array of flag codes to exclude (optional)
- `excludeGameids` - Already used gameids to exclude (optional)
- `excludeStageUuids` - Already used stage UUIDs to exclude (optional)

**Returns**: 
```javascript
{
  stage_uuid: string,
  gameid: string,
  version: number,
  gameName: string,
  levelnumber: string,  // hex string
  translevel_13bf: string,  // hex string
  levelname: string
}
```

**Logic**:
1. Filter games by game filters (same as `selectRandomGame`)
2. Get all stages for matching games from `gamestages` table
3. Filter stages by stage filters (difficulty, flags)
4. Use seed + challengeIndex for deterministic selection
5. Return selected stage info

---

### Step 4: Update `expand-and-prepare` Handler
**File**: `electron/ipc-handlers.js`
**Function**: `db:runs:expand-and-prepare` handler (around line 2493)

**Changes Needed**:

1. **Handle `random_stage` entries**:
   - Call `selectRandomStage` instead of `selectRandomGame`
   - Store stage info (levelnumber, translevel_13bf, levelname) in `run_results`

2. **Handle `stage` entries** (specific stage entries):
   - Load stage info from `gamestages` table using `gameid` and `exit_number` (or `levelnumber`)
   - Store stage info in `run_results`

3. **Update INSERT statement for `run_results`**:
   - Include `levelnumber`, `translevel`, `levelname` columns
   - Update the INSERT to include these values

**Current Logic**:
- Only handles `random_game` entries
- Uses `selectRandomGame` to select games
- Stores `exit_number` and `stage_description` (but not stage-specific fields)

**Should Handle**:
- `random_game` entries (existing)
- `random_stage` entries (new - select random stages)
- `stage` entries (new - specific stage)
- `game` entries (existing - full game)

---

### Step 5: Update Staging Logic for Stage Entries
**File**: `electron/game-stager.js`
**Function**: `stageRunGames` (around line 340)

**Changes Needed**:
- For stage entries (`entry_type === 'stage'` or stage info present in `run_results`):
  - Use `buildPlusPatchedGame` instead of `createPatchedSFC`
  - Set `glevelnum` to the stage's `levelnumber`
  - Include requisite patches from stage's `requisites` field
  - Use playlevel patch code (from stage's `playlevel_patch_code` or default '1lvno')

**Current Logic**:
- Uses `createPatchedSFC` for all entries (basic patching only)

**Should Check**:
- If `result.levelnumber` or `result.exit_number` is present → use stage patching
- Call `buildPlusPatchedGame` with:
  - `gameId`: `result.gameid`
  - `selectedPatches`: Requisite patches + playlevel patch
  - `globalParams`: `{ glevelnum: result.levelnumber, ... }`
  - `action`: 'build'

---

### Step 6: Update `getRunPlan` Handler
**File**: `electron/ipc-handlers.js`
**Function**: `db:runs:get-plan` handler

**Changes Needed**:
- Update SELECT statement to include new columns:
  - `trans_level`
  - `stage_filter_min_difficulty`
  - `stage_filter_max_difficulty`
  - `stage_filter_include_flags`
  - `stage_filter_exclude_flags`

**Note**: Need to find if this handler exists, or if plan entries are loaded elsewhere.

---

### Step 7: Update `getRunResults` Handler
**File**: `electron/ipc-handlers.js`
**Function**: `db:runs:get-results` handler (around line 2135)

**Changes Needed**:
- Update SELECT statement to include:
  - `levelnumber`
  - `translevel`
  - `levelname`

**Current SELECT**:
```javascript
SELECT 
  result_uuid,
  run_uuid,
  plan_entry_uuid,
  sequence_number,
  gameid,
  game_name,
  exit_number,
  stage_description,
  ...
FROM run_results
```

**Should Include**:
```javascript
SELECT 
  result_uuid,
  run_uuid,
  plan_entry_uuid,
  sequence_number,
  gameid,
  game_name,
  exit_number,
  stage_description,
  levelnumber,
  translevel,
  levelname,
  ...
FROM run_results
```

---

### Step 8: Update `importRun` Function
**File**: `electron/seed-manager.js`
**Function**: `importRun` (around line 432)

**Changes Needed**:
- Update INSERT statement to include new stage filter fields
- Handle importing stage entries with stage filter data

**Current INSERT**:
```javascript
INSERT INTO run_plan_entries
  (entry_uuid, run_uuid, sequence_number, entry_type, gameid, exit_number,
   count, filter_difficulty, filter_type, filter_pattern, filter_seed, conditions, entry_notes)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
```

**Should Include New Fields**:
- `trans_level`
- `stage_filter_min_difficulty`
- `stage_filter_max_difficulty`
- `stage_filter_include_flags`
- `stage_filter_exclude_flags`

---

### Step 9: Update `exportRun` Function
**File**: `electron/seed-manager.js`
**Function**: `exportRun` (around line 330)

**Changes Needed**:
- Ensure exported plan entries include new stage filter fields
- Include stage info in exported run data

**Note**: Check if this function needs updates to include stage data in export.

---

## Implementation Order

1. **Step 2**: Create migration for `run_results` (foundation)
2. **Step 3**: Create `selectRandomStage` function (needed by expand-and-prepare)
3. **Step 1**: Update `saveRunPlan` handler (saves plan data)
4. **Step 6**: Update `getRunPlan` handler (loads plan data)
5. **Step 4**: Update `expand-and-prepare` handler (uses selectRandomStage)
6. **Step 7**: Update `getRunResults` handler (loads stage info)
7. **Step 5**: Update staging logic (uses stage info for patching)
8. **Step 8**: Update `importRun` function (imports stage data)
9. **Step 9**: Update `exportRun` function (exports stage data)

---

## Testing Checklist

- [ ] Can save run plan with stage entries (specific stages)
- [ ] Can save run plan with random_stage entries
- [ ] Can load run plan with stage filter fields
- [ ] Can expand random_stage entries (selects random stages correctly)
- [ ] Can expand stage entries (loads stage info correctly)
- [ ] Can stage run with stage entries (uses buildPlusPatchedGame)
- [ ] Can stage run with random_stage entries (uses correct patches)
- [ ] Can load run results with stage info
- [ ] Can import/export runs with stage data

---

## Notes

- Stage entries should automatically include requisite patches when staging
- The playlevel patch defaults to '1lvno' if not specified in the stage
- Stage entries should use `buildPlusPatchedGame` with `glevelnum` set to stage's `levelnumber`
- Random stage entries need to track used stage UUIDs to avoid duplicates (similar to excludeGameids)

