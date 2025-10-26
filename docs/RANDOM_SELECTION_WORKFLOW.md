# Random Selection Workflow - Visual Guide

**Date**: October 12, 2025

---

## Complete Workflow

### Phase 1: Opening Prepare Run Modal

```
User clicks "Prepare Run"
         ↓
┌────────────────────────────────────────────────┐
│ Backend: Generate Seed                         │
│ 1. Check if seed mappings exist                │
│ 2. If not: Create mapping from gameversions    │
│ 3. Get largest mapping (most games)            │
│ 4. Generate MAPID (5 random chars) → "A7K9M"  │
│ 5. Generate SUFFIX (5 random chars) → "XyZ3q"  │
│ 6. Return seed: "A7K9M-XyZ3q"                  │
└────────────────────────────────────────────────┘
         ↓
┌────────────────────────────────────────────────┐
│ Frontend: Display Modal                        │
│ Seed field shows: "A7K9M-XyZ3q"                │
│ Console: "Generated seed (mapping A7K9M, 3168  │
│           games)"                               │
└────────────────────────────────────────────────┘
```

### Phase 2: Adding Random Challenge

```
User fills in:
- Type: Kaizo
- Difficulty: Advanced
- Pattern: (empty)
- Count: 3
- Seed: A7K9M-XyZ3q (already filled)

User clicks "Add Random Game"
         ↓
┌────────────────────────────────────────────────┐
│ Frontend: Create Plan Entry                    │
│ runEntries.push({                               │
│   entry_type: 'random_game',                   │
│   count: 3,                                     │
│   filter_type: 'Kaizo',                         │
│   filter_difficulty: 'Advanced',                │
│   filter_seed: 'A7K9M-XyZ3q'                   │
│ })                                              │
│                                                 │
│ UI Shows: 1 row with count=3                   │
└────────────────────────────────────────────────┘
         ↓
┌────────────────────────────────────────────────┐
│ Auto-generate next seed: "A7K9M-Def4G"        │
│ (Ready for next random entry)                  │
└────────────────────────────────────────────────┘
```

### Phase 3: Saving Run

```
User clicks "Stage and Save"
         ↓
┌────────────────────────────────────────────────┐
│ Enter Run Name: "My Challenge"                 │
└────────────────────────────────────────────────┘
         ↓
┌────────────────────────────────────────────────┐
│ Database: Create Run                            │
│ INSERT INTO runs (run_uuid, run_name, ...)    │
│ VALUES ('uuid-123', 'My Challenge', ...)       │
│                                                 │
│ INSERT INTO run_plan_entries                   │
│ (entry_uuid, run_uuid, sequence_number,       │
│  entry_type, count, filter_seed, ...)         │
│ VALUES                                          │
│  ('entry-1', 'uuid-123', 1, 'random_game',    │
│   3, 'A7K9M-XyZ3q', ...)                      │
└────────────────────────────────────────────────┘
         ↓
"Start Run" button enabled
```

### Phase 4: Starting Run

```
User clicks "▶ Start Run"
         ↓
┌────────────────────────────────────────────────┐
│ Backend: Expand Plan to Results                │
│                                                 │
│ FOR each plan entry:                           │
│   FOR i = 1 to count:                          │
│     sequence++                                  │
│                                                 │
│     IF random:                                  │
│       gameid = NULL                            │
│       game_name = "???"                        │
│       was_random = 1                           │
│                                                 │
│     INSERT INTO run_results                    │
│       (sequence, gameid, game_name, ...)       │
└────────────────────────────────────────────────┘
         ↓
┌────────────────────────────────────────────────┐
│ Result: 3 run_results created                  │
│ - Seq 1: gameid=NULL, name="???"              │
│ - Seq 2: gameid=NULL, name="???"              │
│ - Seq 3: gameid=NULL, name="???"              │
└────────────────────────────────────────────────┘
         ↓
┌────────────────────────────────────────────────┐
│ Frontend: Fetch and Display                    │
│ GET /db:runs:get-results                       │
│                                                 │
│ runEntries = [                                  │
│   { id: '(random)', name: '???' },            │
│   { id: '(random)', name: '???' },            │
│   { id: '(random)', name: '???' }             │
│ ]                                               │
│                                                 │
│ UI: Shows 3 rows with "???"                    │
│ Progress: "Challenge 1 / 3"                    │
│ Timer: Starts at 0s                            │
└────────────────────────────────────────────────┘
```

### Phase 5: Reaching Challenge 1

```
currentChallengeIndex changes to 0
         ↓
┌────────────────────────────────────────────────┐
│ Watcher: Detects Index Change                  │
│ IF runEntries[0].name === '???':              │
│   → Trigger reveal                             │
└────────────────────────────────────────────────┘
         ↓
┌────────────────────────────────────────────────┐
│ Frontend: revealCurrentChallenge(early=false)  │
│ CALL /db:runs:reveal-challenge                 │
│   runUuid: "uuid-123"                          │
│   resultUuid: "result-uuid-1"                  │
│   revealedEarly: false                         │
└────────────────────────────────────────────────┘
         ↓
┌────────────────────────────────────────────────┐
│ Backend: Select Random Game                    │
│                                                 │
│ 1. Parse seed: "A7K9M-XyZ3q"                  │
│    → mapId = "A7K9M"                           │
│    → suffix = "XyZ3q"                          │
│                                                 │
│ 2. Load mapping "A7K9M":                       │
│    → {"11374":1, "12345":2, "54321":3, ...}   │
│                                                 │
│ 3. Get candidate gameids:                      │
│    → [11374, 12345, 54321, ...]               │
│                                                 │
│ 4. Apply filters:                              │
│    WHERE combinedtype LIKE '%Kaizo%'          │
│    AND difficulty = 'Advanced'                 │
│    → Filtered: [11374, 54321, 99999, ...]     │
│                                                 │
│ 5. Get already used games in this run:        │
│    → usedGameids = []  (first challenge)      │
│                                                 │
│ 6. Filter out used:                            │
│    → available = [11374, 54321, 99999, ...]   │
│                                                 │
│ 7. Deterministic select:                       │
│    seedString = "A7K9M-XyZ3q-1"  (seq=1)     │
│    hash = SHA256(seedString)                   │
│    index = hash % available.length             │
│    selectedGame = available[index]             │
│    → Selected: gameid=11374, name="Super      │
│                 Dram World"                    │
│                                                 │
│ 8. UPDATE run_results                          │
│    SET gameid='11374',                         │
│        game_name='Super Dram World',          │
│        revealed_early=0,                       │
│        started_at=NOW()                        │
│    WHERE result_uuid='result-uuid-1'          │
└────────────────────────────────────────────────┘
         ↓
┌────────────────────────────────────────────────┐
│ Frontend: Update UI                            │
│ challenge.id = "11374"                         │
│ challenge.name = "Super Dram World"            │
│                                                 │
│ UI: Shows "Super Dram World" instead of "???" │
│ Console: "Revealed challenge 1: Super Dram     │
│          World (11374)"                        │
└────────────────────────────────────────────────┘
         ↓
Player can now see and attempt the challenge!
```

### Phase 6: Completing Challenge 1

```
Player finishes game
User clicks "✓ Done"
         ↓
recordChallengeResult(status='success')
         ↓
Status icon: ✓ (green checkmark)
Time frozen: 3m 15s
Move to Challenge 2
```

### Phase 7: Reaching Challenge 2

```
Same reveal process as Challenge 1, but:
- seedString = "A7K9M-XyZ3q-2"  (different index!)
- Different hash
- Different selectedIndex
- Different game revealed: "Kaizo Master" (gameid 54321)
- usedGameids = [11374]  (exclude Challenge 1's game)
```

### Phase 8: Skipping Challenge 3

```
Challenge 3 reached
         ↓
Auto-reveals: "Hard Mode 3" (gameid 99999)
         ↓
User finds it too hard
User clicks "⏭ Skip"
         ↓
┌────────────────────────────────────────────────┐
│ revealCurrentChallenge(early=TRUE)             │
│ (already revealed, so marks revealed_early=1)  │
└────────────────────────────────────────────────┘
         ↓
Confirmation: "Skip Hard Mode 3?"
User confirms
         ↓
Status: ✗ (red X)
revealed_early = 1
Move to next challenge
```

### Phase 9: Using Back

```
User realizes they can beat Challenge 3
User clicks "↶ Back"
         ↓
Returns to Challenge 3
Status cleared (no icon)
revealed_early still = 1  (preserved)
         ↓
User completes challenge
User clicks "✓ Done"
         ↓
Check: revealed_early = 1?
→ Yes: finalStatus = 'ok'
→ Status icon: ⚠ (orange warning)
```

---

## Visual State Diagram

```
┌──────────────┐
│ PREPARING    │  Plan entries with count
│              │  Seeds auto-generated
│ UI: 1 row    │  "Random Game (count=3)"
│    count=3   │
└──────┬───────┘
       │ Start Run
       ↓
┌──────────────┐
│ EXPANDING    │  Backend expands plan to results
│              │  1 entry → 3 results
│ DB: Creates  │  All with gameid=NULL, name="???"
│     3 rows   │
└──────┬───────┘
       │ Fetch Results
       ↓
┌──────────────┐
│ ACTIVE       │  UI: 3 rows, all "???"
│              │  Timer running
│ Challenge 1  │  → REVEAL → "Super Dram World"
│   REVEALED   │  → Complete → ✓ success
└──────┬───────┘
       │ Next
       ↓
┌──────────────┐
│ Challenge 2  │  → REVEAL → "Kaizo Master"
│   REVEALED   │  → Complete → ✓ success
└──────┬───────┘
       │ Next
       ↓
┌──────────────┐
│ Challenge 3  │  → REVEAL → "Hard Mode 3"
│   REVEALED   │  → Skip → ✗ skipped (revealed_early=1)
└──────┬───────┘
       │ Back
       ↓
┌──────────────┐
│ Challenge 3  │  Name still visible: "Hard Mode 3"
│ RE-ATTEMPT   │  revealed_early=1 preserved
│              │  → Complete → ⚠ ok (not ✓ success)
└──────┬───────┘
       │ Complete
       ↓
┌──────────────┐
│ COMPLETED    │  Summary shown
│              │  Timer stopped
│ Results:     │  Modal closes
│  2 ✓         │
│  1 ⚠         │
│  0 ✗         │
└──────────────┘
```

---

## Seed Flow Diagram

```
SEED: "A7K9M-XyZ3q"
  │
  ├─ MAPID: "A7K9M" ──────┐
  │                        ↓
  │                 ┌──────────────────┐
  │                 │ seedmappings DB  │
  │                 │ WHERE mapid=...  │
  │                 └──────────────────┘
  │                        ↓
  │                 ┌──────────────────┐
  │                 │ mappingdata JSON │
  │                 │ {                │
  │                 │  "11374": 1,     │
  │                 │  "12345": 2,     │
  │                 │  "54321": 3,     │
  │                 │  ...             │
  │                 │ }                │
  │                 └──────────────────┘
  │                        ↓
  │                 Candidate gameids: [11374, 12345, 54321, ...]
  │
  └─ SUFFIX: "XyZ3q" ─────┐
                           ↓
                    ┌──────────────────┐
                    │ Hash Component    │
                    │ "A7K9M-XyZ3q-1"  │
                    │ (seed + index)   │
                    └──────────────────┘
                           ↓
                    SHA256 Hash
                           ↓
                    Deterministic Index
                           ↓
                    Selected: gameids[index]
```

---

## Status Icon Legend

```
┌──────────┬─────────┬──────────────────────────────────────┐
│ Icon     │ Color   │ Meaning                              │
├──────────┼─────────┼──────────────────────────────────────┤
│ (empty)  │ -       │ Pending - not yet attempted          │
│ ✓        │ Green   │ Success - completed perfectly        │
│ ⚠        │ Orange  │ OK - completed but revealed early    │
│ ✗        │ Red     │ Skipped - not attempted              │
└──────────┴─────────┴──────────────────────────────────────┘

Perfect Score: All ✓ (no ⚠, no ✗)
Good Score: Mix of ✓ and ⚠
Failed: Any ✗ remaining
```

---

## Seed Validation Flow

```
User enters seed manually: "B4N8P-Zzz9Q"
         ↓
Frontend: validateSeed("B4N8P-Zzz9Q")
         ↓
┌────────────────────────────────────────────────┐
│ Backend: Validate                              │
│ 1. Parse: mapId="B4N8P", suffix="Zzz9Q"       │
│ 2. Check database:                             │
│    SELECT * FROM seedmappings WHERE mapid=?    │
│ 3. IF found:                                   │
│      return { valid: true, gameCount: 3000 }   │
│    ELSE:                                       │
│      return { valid: false }                   │
└────────────────────────────────────────────────┘
         ↓
┌────────────────────────────────────────────────┐
│ Frontend: Show Validation                      │
│ IF valid:                                      │
│   Show: "✓ Valid seed (3000 games)"           │
│ ELSE:                                          │
│   Show: "✗ Invalid seed - regenerate"         │
│   Disable save button                          │
└────────────────────────────────────────────────┘
```

---

## Export/Import Flow

### Export

```
User has saved run with random challenges
User clicks "📤 Export"
         ↓
┌────────────────────────────────────────────────┐
│ Backend: Collect Data                          │
│ 1. Get run metadata                            │
│ 2. Get plan entries                            │
│ 3. Extract all seeds used:                     │
│    - "A7K9M-XyZ3q" → mapId "A7K9M"            │
│    - "A7K9M-Def4G" → mapId "A7K9M" (same)     │
│ 4. Get unique seed mappings:                   │
│    - Load mapping "A7K9M" from DB             │
│ 5. Build export JSON                           │
└────────────────────────────────────────────────┘
         ↓
┌────────────────────────────────────────────────┐
│ Frontend: Download File                        │
│ File: "run-My_Challenge-1697123456.json"      │
│ Contains:                                       │
│ - Run metadata                                  │
│ - Plan entries                                  │
│ - Seed mapping "A7K9M" (full game list)       │
└────────────────────────────────────────────────┘
```

### Import

```
User receives "run-Kaizo_Challenge.json"
User clicks "📥 Import"
User selects file
         ↓
┌────────────────────────────────────────────────┐
│ Frontend: Read File                            │
│ Parse JSON                                     │
│ Send to backend                                │
└────────────────────────────────────────────────┘
         ↓
┌────────────────────────────────────────────────┐
│ Backend: Validate Compatibility                │
│                                                 │
│ FOR each seed mapping:                         │
│   mappingData = {"11374":1, "12345":2, ...}   │
│                                                 │
│   FOR each (gameid, version):                  │
│     Check: Does this gameid + version exist?  │
│     Query: SELECT 1 FROM gameversions          │
│            WHERE gameid=? AND version=?        │
│                                                 │
│     IF NOT exists:                             │
│       REJECT import                            │
│       Return: { success: false,                │
│                 error: "Missing game ..." }    │
│                                                 │
│ IF all games present:                          │
│   1. Import seed mappings (if not exists)      │
│   2. Create new run (with new UUID)            │
│   3. Import plan entries                       │
│   4. Return: { success: true, runUuid: ... }   │
└────────────────────────────────────────────────┘
         ↓
┌────────────────────────────────────────────────┐
│ Frontend: Show Result                          │
│ IF success:                                    │
│   Alert: "Run imported successfully!"          │
│   Close modal                                  │
│ ELSE:                                          │
│   Alert: "Import failed: Missing games"        │
│   (User needs to update their game database)   │
└────────────────────────────────────────────────┘
```

---

## Example: Same Seed, Different Players

```
SEED: "A7K9M-XyZ3q"
Filters: Type=Kaizo, Difficulty=Advanced
Count: 3

┌─────────────────────┬─────────────────────┐
│ Player A (3168 games)│ Player B (3168 games)│
├─────────────────────┼─────────────────────┤
│ Mapping A7K9M:      │ Mapping A7K9M:      │
│ - Same 3168 games   │ - Same 3168 games   │
│ - Same versions     │ - Same versions     │
├─────────────────────┼─────────────────────┤
│ Challenge 1:        │ Challenge 1:        │
│ SHA256("...-1")     │ SHA256("...-1")     │
│ → index 42          │ → index 42          │
│ → Game: 11374       │ → Game: 11374       │
│ "Super Dram World"  │ "Super Dram World"  │ ← SAME!
├─────────────────────┼─────────────────────┤
│ Challenge 2:        │ Challenge 2:        │
│ SHA256("...-2")     │ SHA256("...-2")     │
│ → index 158         │ → index 158         │
│ → Game: 54321       │ → Game: 54321       │
│ "Kaizo Master"      │ "Kaizo Master"      │ ← SAME!
├─────────────────────┼─────────────────────┤
│ Challenge 3:        │ Challenge 3:        │
│ SHA256("...-3")     │ SHA256("...-3")     │
│ → index 231         │ → index 231         │
│ → Game: 99999       │ → Game: 99999       │
│ "Hard Mode 3"       │ "Hard Mode 3"       │ ← SAME!
└─────────────────────┴─────────────────────┘

RESULT: Identical challenges for fair competition!
```

---

## Summary

The random selection system provides:

1. **Reproducibility**: Same seed = same games (guaranteed)
2. **Fairness**: Competitive runs with identical challenges
3. **Sharing**: Export/import with validation
4. **Privacy**: Name masking until challenge reached
5. **Integrity**: Revealed-early tracking prevents cheating
6. **Flexibility**: Filters, patterns, custom mappings

**Status**: Fully implemented and ready for testing!

---

*Visual guide created: October 12, 2025*

