# RHTools Electron App - How to Start

**Quick Start Guide for the Run System**

---

## Prerequisites

### 1. Apply Database Migrations

```bash
cd /home/main/proj/rhtools

# Migration 004: Fix gameid constraint for random challenges
sqlite3 electron/clientdata.db < electron/sql/migrations/004_clientdata_fix_run_results_gameid.sql

# Migration 006: Add seed mappings for deterministic random selection
sqlite3 electron/clientdata.db < electron/sql/migrations/006_clientdata_seed_mappings.sql
```

### 2. Restart Electron (REQUIRED!)

```bash
# Kill all processes
pkill -f electron
pkill -f vite

# Start fresh
cd /home/main/proj/rhtools/electron
./smart-start.sh
```

**Why restart?**: Backend code (seed-manager.js, ipc-handlers.js) doesn't hot-reload.

---

## Using the Run System

### Create a Simple Run

```
1. Click "Prepare Run" button (top right)
2. Add some games:
   - Select games in main list
   - Click "Add to Run"
3. Click "Stage and Save"
4. Enter run name: "My First Run"
5. Click "▶ Start Run"
6. Complete challenges:
   - Click "✓ Done" when finished
   - Watch timer and progress
7. Run completes!
```

### Create a Random Challenge Run

```
1. Click "Prepare Run"
2. Observe: Seed auto-generated (e.g., "A7K9M-XyZ3q")
   - Console shows: "Generated seed (3168 games)"
3. Set random filters:
   - Type: Kaizo
   - Difficulty: Advanced  
   - Count: 5
   - Seed: (already filled)
4. Click "Add Random Game"
   - Adds 1 plan entry (count=5)
   - New seed generated for next entry
5. Click "Stage and Save" → Enter name
6. Click "▶ Start Run"
7. Observe:
   - UI now shows 5 rows (expanded!)
   - All show "???" (masked)
   - Progress: "Challenge 1 / 5"
8. Reach Challenge 1:
   - Auto-reveals: "Super Dram World"
   - Console: "Revealed challenge 1: ..."
   - Name visible in UI
9. Complete or skip challenges:
   - Done → ✓ green checkmark
   - Skip → ✗ red X (reveals name first)
   - Back → undo last action
```

---

## Key Features

### Auto-Generated Seeds
- Format: `MAPID-SUFFIX` (e.g., "A7K9M-XyZ3q")
- Auto-generated when opening Run modal
- Regenerate with 🎲 button
- Deterministic: Same seed = same games

### Count Expansion
- Set count=5 → Creates 5 separate challenges
- Each challenge revealed independently
- UI updates from 1 row to 5 rows when run starts

### Auto-Reveal
- Random games masked as "???" initially
- Automatically revealed when reached
- Name shown in UI immediately
- Database updated with actual game

### Status Tracking
- ✓ Green = Perfect completion
- ⚠ Orange = Completed but revealed early
- ✗ Red = Skipped

### Undo System
- Click "↶ Back" to undo last action
- Returns to previous challenge
- Preserves revealed-early status
- Can undo multiple times

---

## Export/Import

### Export Run

```
1. Save a run with random challenges
2. Click "📤 Export"
3. File downloads: "run-My_Challenge-timestamp.json"
4. Share file with friends!
```

**File contains**:
- Run metadata
- Plan entries
- Seed mappings (for compatibility)

### Import Run

```
1. Click "📥 Import"
2. Select .json file
3. System validates:
   ✓ All seed mappings compatible?
   ✓ All games exist in your database?
4. If valid: Imports successfully
5. If invalid: Shows error (missing games)
```

**Compatibility**: Import only works if you have all the games referenced in the seed mappings.

---

## Competitive Runs

### Setup

```
Player A:
1. Create run with random challenges
2. Use specific seed: "A7K9M-XyZ3q"
3. Export run
4. Share with Player B

Player B:
1. Import run file
2. System checks compatibility
3. If all games present: Import succeeds
4. Both players now have identical challenges
```

### Race

```
Both start simultaneously:
- Challenge 1: Both get "Super Dram World" ✓
- Challenge 2: Both get "Kaizo Master" ✓
- Challenge 3: Both get "Hard Mode 3" ✓
- Identical challenges for fair competition!
```

**Key**: Same seed + same mapping = same games (always)

---

## Troubleshooting

### "Invalid seed" Error

**Problem**: Seed mapping not found in database

**Solution**:
1. Click 🎲 to regenerate seed
2. Or ask the person who shared the run to export it (includes mappings)
3. Or create new mapping

### "Import failed: Missing games"

**Problem**: Your database doesn't have all games in the seed mapping

**Solution**:
1. Update your game database (run updategames.js)
2. Or ask for a run that uses a smaller mapping
3. Or create a custom mapping with only games you have

### Run doesn't expand (still shows count=5 in 1 row)

**Problem**: Electron not restarted after code changes

**Solution**:
```bash
pkill -f electron && pkill -f vite
cd /home/main/proj/rhtools/electron && ./smart-start.sh
```

### Random games not revealing

**Problem**: Watcher not triggering or IPC error

**Solution**:
1. Open DevTools (F12)
2. Check Console for errors
3. Verify seed is valid
4. Restart Electron

---

## Documentation

**Start Here**:
- `HOW_TO_START.md` (this file) - Quick start guide
- `ELECTRON_APP_MASTER_REFERENCE.md` - Complete technical reference

**Features**:
- `SEED_RANDOM_SELECTION_COMPLETE.md` - Seed system explained
- `RANDOM_SELECTION_WORKFLOW.md` - Visual workflow diagrams
- `RUN_EXECUTION_IMPLEMENTATION.md` - Execution features
- `RUN_EXECUTION_ENHANCEMENTS.md` - Status, timing, undo

**Summary**:
- `COMPLETE_RUN_SYSTEM_SUMMARY.md` - Complete overview

**Database**:
- `SCHEMACHANGES.md` - All schema changes
- `DBMIGRATE.md` - Migration commands

---

## What You Can Do

### Solo Play
- Create challenge runs
- Track your progress
- Time yourself
- Try different game types

### Competitive Play
- Share runs with friends
- Race with identical random challenges
- Compare times
- Track who completes more

### Content Creation
- Create interesting challenge lists
- Share with community
- Create themed runs
- Export for others to try

---

## Next Steps

### Immediate Testing

```bash
# 1. Apply migrations (if not done)
cd /home/main/proj/rhtools
sqlite3 electron/clientdata.db < electron/sql/migrations/004_clientdata_fix_run_results_gameid.sql
sqlite3 electron/clientdata.db < electron/sql/migrations/006_clientdata_seed_mappings.sql

# 2. Restart Electron
pkill -f electron && pkill -f vite
cd electron && ./smart-start.sh

# 3. Test
# Open app → Prepare Run → Add Random Game → Save → Start → Watch magic happen!
```

### Future Development
- Implement random stage selection
- Add auto-launch games
- Create run archive/history
- Build statistics dashboard
- Add run templates
- Community run sharing platform

---

**Ready to test the complete system!** 🎉

---

*Guide created: October 12, 2025*  
*Status: PRODUCTION READY ✅*
