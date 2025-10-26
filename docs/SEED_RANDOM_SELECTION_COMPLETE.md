# Seed-Based Random Selection System - Complete Implementation

**Date**: October 12, 2025  
**Status**: ✅ **COMPLETE**

---

## Overview

Implemented complete deterministic random game selection system using seed mappings. This enables:
- Reproducible random selection across different installations
- Competitive runs with same random challenges
- Export/import of runs with seed compatibility
- Automatic game reveal when challenge is reached
- Revealed-early tracking for skipped random challenges

---

## How It Works

### Seed Format

**Structure**: `MAPID-SUFFIX`

**Example**: `A7K9M-XyZ3q`

**Components**:
- `MAPID` (5 chars): References a seed mapping (game snapshot)
- `-`: Separator
- `SUFFIX` (5 chars): Random component for uniqueness

**Character Set**: Alphanumeric excluding confusing characters
- ❌ Excluded: `0` (zero), `O` (capital o), `1` (one), `l` (lowercase L), `I` (capital i)
- ✅ Allowed: `ABCDEFGHJKLMNPQRSTUVWXYZ23456789abcdefghjkmnpqrstuvwxyz` (53 chars)

**Why Exclude Characters**: Avoid confusion when manually sharing seeds
- `0` vs `O`: Zero vs capital O
- `1` vs `l` vs `I`: One vs lowercase L vs capital I

---

## Seed Mapping System

### Purpose

**Problem**: Two players might have different gameversions tables (different update dates)
- Player A has 3,000 games
- Player B has 3,200 games (updated more recently)
- Same seed would select different games!

**Solution**: Seed mappings freeze a snapshot of available games
- MAPID `A7K9M` maps to specific list of {gameid: version} pairs
- Both players import/export this mapping
- Same MAPID = same game list = same selections

### seedmappings Table

**Schema**:
```sql
CREATE TABLE seedmappings (
    mapid VARCHAR(20) PRIMARY KEY,        -- "A7K9M"
    mappingdata TEXT NOT NULL,            -- JSON: {"11374": 1, "12345": 2, ...}
    game_count INTEGER NOT NULL,          -- Number of games in mapping
    mapping_hash VARCHAR(64),             -- SHA-256 hash for verification
    created_at TIMESTAMP,
    description TEXT
);
```

**Example Mapping Data**:
```json
{
  "11374": 1,
  "12345": 2,
  "54321": 3,
  "99999": 1,
  ...
}
```

**Each entry**: `"gameid": version_number`

**Meaning**: For this mapping, gameid `11374` at version `1` is a candidate for random selection

---

## Random Selection Algorithm

### Step 1: Parse Seed

```javascript
// Seed: "A7K9M-XyZ3q"
const { mapId, suffix } = parseSeed(seed);
// mapId = "A7K9M"
// suffix = "XyZ3q"
```

### Step 2: Load Mapping

```javascript
const mapping = getSeedMapping(dbManager, "A7K9M");
// Returns: { "11374": 1, "12345": 2, ... }
```

### Step 3: Get Candidate Games

```javascript
const candidateGameids = Object.keys(mapping.mappingData);
// Returns: ["11374", "12345", "54321", ...]
```

### Step 4: Apply Filters

```sql
SELECT gv.gameid, gv.version, gv.name
FROM gameversions gv
WHERE gv.gameid IN (candidates)
  AND gv.combinedtype LIKE '%Kaizo%'  -- Filter by type
  AND gv.difficulty = 'Advanced'       -- Filter by difficulty
  AND gv.name LIKE '%World%'           -- Filter by pattern
```

### Step 5: Deterministic Selection

```javascript
// Hash seed + challengeIndex for deterministic random value
const seedString = `${seed}-${challengeIndex}`;
const hash = crypto.createHash('sha256').update(seedString).digest();
const randomValue = hash.readUInt32BE(0);

// Select game deterministically
const selectedIndex = randomValue % filteredGames.length;
const selectedGame = filteredGames[selectedIndex];
```

**Key Property**: Same seed + same index = same game (always!)

---

## Challenge Reveal System

### When Challenge is Revealed

**Automatic Reveal** (Normal):
```
Player reaches challenge 3 (a random challenge)
→ Watcher detects currentChallengeIndex changed to 3
→ Checks if challenge.name === '???'
→ Calls revealCurrentChallenge(revealedEarly=false)
→ Backend selects random game
→ Updates database: gameid='11374', game_name='Super Dram World'
→ UI updates: Shows actual game name
→ Player can now attempt the challenge
```

**Manual Reveal** (Skip):
```
Player clicks "⏭ Skip" on challenge 3
→ Calls revealCurrentChallenge(revealedEarly=true)
→ Backend selects random game and marks revealed_early=1
→ Confirmation dialog shows actual game name
→ Player confirms skip
→ Status shows red ✗
→ If later completed via Back: Can only get ⚠ 'ok' status (not ✓ 'success')
```

### Database Updates

**Before Reveal**:
```sql
result_uuid: "abc-123"
gameid: NULL
game_name: "???"
was_random: 1
revealed_early: 0
status: 'pending'
```

**After Reveal (Normal)**:
```sql
result_uuid: "abc-123"
gameid: "11374"
game_name: "Super Dram World"
was_random: 1
revealed_early: 0  ← Normal reveal
status: 'pending'
started_at: NOW()
```

**After Reveal (Early)**:
```sql
result_uuid: "abc-123"
gameid: "11374"
game_name: "Super Dram World"
was_random: 1
revealed_early: 1  ← Revealed by skip/peek
status: 'pending'
started_at: NOW()
```

---

## Status System

### Three Success States

1. **✓ success** (Green Checkmark)
   - Perfect completion
   - Random challenge revealed at correct time
   - `revealed_early = 0`

2. **⚠ ok** (Orange Warning)
   - Completed but revealed early
   - Random challenge was skipped then completed via Back
   - `revealed_early = 1`

3. **✗ skipped** (Red X)
   - Challenge skipped
   - Does not count toward completion

---

## Competitive Run Support

### Scenario: Two Players Racing

**Player A Setup**:
```
1. Creates run with random challenges
2. Seed: "A7K9M-XyZ3q"
3. Exports run to file: "my_challenge.json"
4. Shares file with Player B
```

**Player B Setup**:
```
1. Imports "my_challenge.json"
2. Seed mapping "A7K9M" imported automatically
3. If Player B has all games in mapping: Import succeeds ✅
4. If Player B missing games: Import fails ❌
```

**Race**:
```
Both players start their run
→ Challenge 1: Both get "Super Dram World" (gameid 11374)
→ Challenge 2: Both get "Kaizo Master" (gameid 54321)
→ Challenge 3: Both get "Hard Mode" (gameid 99999)
→ Identical challenges for fair competition!
```

**Key**: Same seed + same mapping = same games in same order

---

## Seed Generation

### Automatic Generation

**When**: Clicking "Add Random Game" or opening Run modal

**Process**:
```javascript
1. Check if seed mappings exist
2. If not: Create new mapping from current gameversions
3. Get largest mapping (most games)
4. Generate MAPID (5 random chars)
5. Generate SUFFIX (5 random chars)
6. Result: "A7K9M-XyZ3q"
```

**UI**:
- Seed auto-generated when opening Prepare Run modal
- New seed generated after each "Add Random Game"
- 🎲 button to regenerate manually

### Manual Generation

**Special Input**: Type `*` in seed field
```
1. User types "*" in seed field
2. Modal opens: "Generate Seed"
3. Shows list of available mappings:
   - A7K9M: 3,168 games (2025-10-12)
   - B4N8P: 3,000 games (2025-10-01)
   - ...
4. User selects mapping
5. New seed generated with that mapping
```

---

## Export/Import System

### Export Run

**Button**: 📤 Export (in Prepare Run modal)

**Process**:
```
1. Click "📤 Export"
2. Backend collects:
   - Run metadata (name, description, conditions)
   - Plan entries (all challenges)
   - Seed mappings (all MAPIDs referenced)
3. Creates JSON file
4. Downloads: "run-My_Challenge-1697123456.json"
```

**JSON Structure**:
```json
{
  "version": 1,
  "exportDate": "2025-10-12T10:30:00.000Z",
  "run": {
    "run_uuid": "...",
    "run_name": "My Challenge",
    "global_conditions": "[\"Hitless\",\"Deathless\"]"
  },
  "planEntries": [
    {
      "entry_type": "game",
      "gameid": "11374",
      "count": 1
    },
    {
      "entry_type": "random_game",
      "count": 5,
      "filter_type": "Kaizo",
      "filter_seed": "A7K9M-XyZ3q"
    }
  ],
  "seedMappings": [
    {
      "mapid": "A7K9M",
      "mappingdata": "{\"11374\":1,\"12345\":2,...}",
      "game_count": 3168,
      "mapping_hash": "abc123..."
    }
  ]
}
```

### Import Run

**Button**: 📥 Import (in Prepare Run modal)

**Process**:
```
1. Click "📥 Import"
2. File picker opens
3. Select .json file
4. Validation:
   a. Check all seed mappings
   b. Verify all gameids/versions exist in local gameversions
   c. If missing: REJECT import
   d. If all present: Import succeeded
5. Create new run with "(Imported)" suffix
6. Import seed mappings if not already exists
```

**Validation Rules**:
```javascript
// For each mapping:
for (const [gameid, version] of mapping) {
  const exists = db.query(
    "SELECT 1 FROM gameversions WHERE gameid=? AND version=?",
    [gameid, version]
  );
  
  if (!exists) {
    return { success: false, error: `Missing ${gameid} v${version}` };
  }
}
```

### Use Cases

**Use Case 1: Share Challenge**
- Player A creates interesting challenge run
- Exports to file
- Shares with Player B
- Player B imports and plays same challenges

**Use Case 2: Competitive Race**
- Both players import same run file
- Both start simultaneously
- Both get identical random selections
- Fair competition!

**Use Case 3: Custom Seed Creation**
- Export empty run
- Edit JSON manually
- Create custom mapping with specific games
- Filter by arbitrary criteria
- Share custom challenge

---

## Implementation Files

### New Files

1. **`electron/seed-manager.js`** (300+ lines)
   - Seed generation and parsing
   - Seed mapping creation
   - Random game selection algorithm
   - Export/import logic
   - Validation functions

2. **`electron/sql/migrations/006_clientdata_seed_mappings.sql`** (new migration)
   - Creates `seedmappings` table
   - Indexes for performance

### Modified Files

1. **`electron/ipc-handlers.js`** (+200 lines)
   - `db:runs:reveal-challenge` - Reveal random challenge
   - `db:seeds:generate` - Generate new seed
   - `db:seeds:get-mappings` - Get all mappings
   - `db:seeds:validate` - Validate seed
   - `db:runs:export` - Export run with mappings
   - `db:runs:import` - Import run with validation

2. **`electron/preload.js`** (+30 lines)
   - Exposed all seed management functions
   - Exposed reveal challenge function
   - Exposed export/import functions

3. **`electron/renderer/src/App.vue`** (+100 lines)
   - Auto-generate seed on modal open
   - 🎲 regenerate button
   - Watch currentChallengeIndex → auto-reveal
   - Skip reveals early before confirmation
   - Export/Import buttons
   - Status differentiation (✓ success vs ⚠ ok)

---

## User Workflow

### Creating a Run with Random Challenges

```
1. Click "Prepare Run"
   → Seed auto-generated: "A7K9M-XyZ3q"
   → Console: "Generated seed (mapping A7K9M, 3168 games)"

2. Set filters:
   - Type: Kaizo
   - Difficulty: Advanced
   - Pattern: (empty)
   - Count: 5
   - Seed: A7K9M-XyZ3q (auto-filled)

3. Click "Add Random Game"
   → Adds 1 row: "Random Game (count=5, seed=A7K9M-XyZ3q)"
   → New seed auto-generated for next entry: "A7K9M-Abc2D"

4. Click "Stage and Save"
   → Run saved with plan entry (count=5)

5. Click "▶ Start Run"
   → Backend expands to 5 results
   → UI now shows 5 rows, all with "???"
   → Challenge 1 highlighted
```

### Executing Run with Random Challenges

```
Challenge 1 (Specific game: Super Dram World):
→ Name visible immediately
→ Player attempts and completes
→ Click "✓ Done"
→ Green ✓ shown

Challenge 2 (Random - ???):
→ Watcher detects challenge reached
→ Backend selects game using seed "A7K9M-XyZ3q" + index 2
→ Database updated: gameid='54321', name='Kaizo Master'
→ UI updates: Shows "Kaizo Master" instead of "???"
→ revealed_early = 0 (normal reveal)
→ Player attempts and completes
→ Click "✓ Done"
→ Green ✓ shown (success)

Challenge 3 (Random - ???):
→ Auto-revealed: Shows "Hard Mode 3"
→ Player finds it too difficult
→ Click "⏭ Skip"
  → Game name shown in confirmation: "Skip Hard Mode 3?"
  → Confirms
  → Red ✗ shown
  → revealed_early = 1 (skipped before attempt)

Challenge 4:
→ Continues...

Later: Click "↶ Back" to challenge 3
→ Returns to "Hard Mode 3"
→ Status clears (no icon)
→ Player completes it
→ Click "✓ Done"
→ Orange ⚠ shown ('ok' status - revealed early)
```

---

## Deterministic Selection

### Same Seed = Same Game

**Seed**: `A7K9M-XyZ3q`

**Selection Process**:
```javascript
// Challenge index 2
seedString = "A7K9M-XyZ3q-2"
hash = SHA256(seedString) = 0x7a3f9e2b...
randomValue = hash[0:4] as uint32 = 2051493419
selectedIndex = randomValue % filteredGames.length
selectedGame = filteredGames[selectedIndex]
```

**Result**: Always selects same game for that seed + index combination

**Different Challenges**:
```
Challenge 2: "A7K9M-XyZ3q-2" → hash1 → game1
Challenge 3: "A7K9M-XyZ3q-3" → hash2 → game2 (different!)
Challenge 4: "A7K9M-XyZ3q-4" → hash3 → game3 (different!)
```

### Avoiding Duplicates

**Within Same Run**:
```javascript
const usedGameids = getAlreadyUsedGamesInRun(runUuid);
// Filter out already used games
const available = candidates.filter(gid => !usedGameids.includes(gid));
```

**Ensures**: Each challenge in a run uses a different game

---

## API Reference

### IPC Channels

**db:seeds:generate**
- Generates new random seed with default mapping
- Returns: `{success, seed, mapId, gameCount}`

**db:seeds:get-mappings**
- Returns all available seed mappings
- Sorted by game_count DESC

**db:seeds:validate**
- Validates a seed (checks if mapping exists)
- Returns: `{valid, mapId, gameCount}`

**db:runs:reveal-challenge**
- Selects and reveals a random challenge
- Returns: `{success, gameid, gameName, gameType, gameDifficulty}`

**db:runs:export**
- Exports run with all seed mappings
- Returns: `{success, data}`

**db:runs:import**
- Imports run and validates compatibility
- Returns: `{success, runUuid, warnings}`

### Frontend API

```typescript
// Generate seed
const result = await electronAPI.generateSeed();
// result.seed = "A7K9M-XyZ3q"

// Validate seed
const validation = await electronAPI.validateSeed(seed);
// validation.valid = true/false

// Reveal challenge
const reveal = await electronAPI.revealChallenge({
  runUuid,
  resultUuid,
  revealedEarly: false
});
// reveal.gameName = "Super Dram World"

// Export run
const exported = await electronAPI.exportRun(runUuid);
// Downloads JSON file

// Import run
const imported = await electronAPI.importRun(jsonData);
// imported.success = true/false
```

---

## Testing

### Test 1: Seed Generation

```bash
# In Electron app:
1. Click "Prepare Run"
2. Observe console: "Generated seed: A7K9M-XyZ3q (3168 games)"
3. Check database:
   sqlite3 electron/clientdata.db "SELECT * FROM seedmappings;"
4. Should show mapping with 3168 games
```

### Test 2: Deterministic Selection

```bash
# Create two identical runs with same seed
Run 1: Seed "A7K9M-XyZ3q", count=5
Run 2: Seed "A7K9M-XyZ3q", count=5

# Start both runs
# Expected: Both reveal same 5 games in same order
```

### Test 3: Reveal on Reach

```bash
# Start run with random challenges
1. Challenge 1 current → No reveal (specific game)
2. Challenge 2 current → AUTO-REVEAL
   - Console: "Revealed challenge 2: Super Dram World (11374)"
   - UI shows: "Super Dram World" instead of "???"
3. Challenge 3 current → AUTO-REVEAL
   - Different game selected
```

### Test 4: Revealed Early

```bash
1. Reach random challenge (auto-reveals normally)
2. Skip it
   - Confirmation shows actual name
   - Red ✗ displayed
   - revealed_early = 1
3. Click Back
4. Complete it
   - Orange ⚠ displayed ('ok' status)
   - NOT green ✓ (can't get perfect score after reveal early)
```

### Test 5: Export/Import

```bash
1. Create run with random challenges (seed: "A7K9M-XyZ3q")
2. Click "📤 Export"
3. Save file
4. Open in text editor
5. Verify:
   - seedMappings array present
   - mapid = "A7K9M"
   - mappingdata contains gameids
6. Click "📥 Import"
7. Select exported file
8. Verify:
   - Run imported successfully
   - Seed mapping available
   - Can start run
```

---

## Code Statistics

**New Files**:
- `electron/seed-manager.js` (300 lines)
- `electron/sql/migrations/006_clientdata_seed_mappings.sql` (30 lines)

**Modified Files**:
- `electron/ipc-handlers.js` (+200 lines)
- `electron/preload.js` (+30 lines)
- `electron/renderer/src/App.vue` (+100 lines)

**Total**: ~660 lines of new code

**Functions Added**: 20+
**IPC Channels**: 6 new
**Database Tables**: 1 new

---

## Summary

✅ **Seed Mapping System**: Snapshot of available games for reproducibility  
✅ **Deterministic Selection**: Same seed = same games (always)  
✅ **Auto-Reveal**: Games revealed when challenge reached  
✅ **Revealed Early Tracking**: Skipped challenges marked accordingly  
✅ **Status Differentiation**: ✓ success vs ⚠ ok vs ✗ skipped  
✅ **Export/Import**: Share runs with compatibility validation  
✅ **Competitive Support**: Fair races with identical challenges  
✅ **No Duplicate Games**: Within same run  
✅ **Filter Support**: Type, difficulty, pattern  

**Ready for Testing**: Restart Electron and try it out!

---

*Implementation complete: October 12, 2025*  
*Lines of code: ~660*  
*Test scenarios: 5*  
*All features: IMPLEMENTED ✅*

