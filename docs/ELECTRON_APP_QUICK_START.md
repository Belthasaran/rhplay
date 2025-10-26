# RHTools Electron App - Quick Start Guide

**Last Updated**: October 12, 2025  
**App Version**: 2.0  
**Status**: Production Ready ✅

---

## Quick Start

### Run the App (Development)

**⚠️ IMPORTANT**: Run from ROOT directory (`/home/main/proj/rhtools`)

**Option 1: One Command (Easiest)**
```bash
cd /home/main/proj/rhtools
npm run app:dev
```

**Option 2: Manual (Two Terminals)**
```bash
# Terminal 1: Start Vite dev server
cd /home/main/proj/rhtools
npm run renderer:dev

# Terminal 2: Start Electron
cd /home/main/proj/rhtools
npm run electron:start
```

The app will open showing **3,168 games** loaded from the database!

---

## What You Can Do

### 1. Browse Games

- **Search**: Type in search box to filter by name, author, type, etc.
- **Select**: Click any game to view details
- **Filter**: Use checkboxes to show/hide finished or hidden games
- **Sort**: Click column headers to sort (when implemented)

### 2. Rate Games (Triple Rating System)

**Difficulty (0-5)**:
- 0 = Super Easy
- 5 = Very Hard

**Review (0-5)**:
- 0 = Terrible
- 5 = Excellent

**Skill Level (0-10)** when you rated it:
- 0 = Observer
- 5 = Master
- 10 = Pro Speedrunner

**How**: Click stars in Details panel → Auto-saves after 500ms

### 3. Manage Versions

- Select different versions in dropdown
- Rate each version separately
- Click "Set Version-Specific Rating" for override

### 4. Plan Challenge Runs

1. Select games → Click "Add to Run"
2. Or click "Add Random Game" with filters
3. Click "Prepare Run" to see/edit run list
4. Set challenge conditions (Hitless, Deathless, etc.)
5. Reorder entries with drag-and-drop
6. Save run plan

### 5. Track Progress

- Set Status: Default / In Progress / Finished
- Hide games you don't want to see
- Exclude games from random selection
- Add personal notes

---

## Features

### ✅ Game Library
- 3,168 games from SMWC database
- Search and filter
- Multiple versions per game
- Full metadata (author, difficulty, length, etc.)

### ✅ User Annotations
- Triple rating system
- Version-specific ratings
- Progress tracking
- Personal notes
- Hide/show games

### ✅ Challenge Runs
- Plan runs with specific games
- Add random games with filters
- Set conditions (Hitless, Deathless, etc.)
- Global and per-entry conditions

### ✅ Settings
- ROM and tool paths
- Launch preferences
- USB2SNES configuration
- All settings persist

---

## Database Locations

### Linux (Development)
```
/home/main/proj/rhtools/electron/rhdata.db
/home/main/proj/rhtools/electron/patchbin.db
/home/main/proj/rhtools/electron/clientdata.db
```

### Linux (Production)
```
~/.config/rhtools/*.db
```

### Windows (Production)
```
C:\Users\<YourName>\AppData\Roaming\rhtools\*.db
```

---

## Keyboard Shortcuts

*(To be implemented)*

- `Ctrl+F` - Focus search
- `Ctrl+A` - Select all
- `Ctrl+D` - Deselect all
- `Space` - Toggle selection
- `Enter` - Open details

---

## Tips & Tricks

### Quick Rating

Click the stars in the Details panel - no need to save manually!

### Bulk Operations

1. Check multiple games
2. Use "Status for checked" dropdown
3. Or use "Hide checked" / "Unhide checked"

### Find Games to Play

1. Set "Hide finished" to see unplayed games
2. Use search to find by author, type, or difficulty
3. Add interesting ones to your run

### Version Comparison

1. Select a game
2. Use version dropdown to compare versions
3. Set different ratings if versions differ in quality

---

## Troubleshooting

### No Games Show Up

**Check**:
```bash
sqlite3 electron/rhdata.db "SELECT COUNT(*) FROM gameversions;"
```
If 0, you need to load game data.

**Solution**: Import games using loaddata.js or updategames.js

### Annotations Don't Save

**Check console** for errors (F12 in Electron)

**Verify migrations**:
```bash
sqlite3 electron/clientdata.db "SELECT name FROM sqlite_master WHERE type='table';"
```
Should show 9 tables.

**Re-apply if needed**:
```bash
sqlite3 electron/clientdata.db < electron/sql/migrations/001_clientdata_user_annotations.sql
sqlite3 electron/clientdata.db < electron/sql/migrations/002_clientdata_enhanced_ratings_and_runs.sql
sqlite3 electron/clientdata.db < electron/sql/migrations/003_clientdata_skill_rating_and_conditions.sql
```

### App Won't Start

**Check Node modules**:
```bash
cd electron
npm install
cd renderer
npm install
```

**Check database files exist**:
```bash
ls -lh electron/*.db
```

---

## Documentation

**For Users**:
- This file (Quick Start)
- `ENHANCED_RATINGS_AND_RUN_SYSTEM.md`

**For Developers**:
- `ELECTRON_APP_DATABASES.md` - Architecture
- `ELECTRON_DATABASE_INTEGRATION_PLAN.md` - Integration guide
- `DATABASE_INTEGRATION_COMPLETE.md` - Implementation summary

**For Database**:
- `DBMIGRATE.md` - Migration commands
- `SCHEMACHANGES.md` - Schema changelog
- `CLIENTDATA_USER_ANNOTATIONS.md` - User data guide

---

## Next Features (Planned)

1. **Run Execution**
   - Start runs
   - Timer display
   - Done/Skip/Undo buttons
   - Results tracking

2. **Random Selection**
   - Implement filter-based random
   - Respect exclusion flags
   - Seed-based reproducibility

3. **Stage Definition**
   - Add stages to games
   - Import stage lists
   - Community stage data

4. **Statistics**
   - Completion rates
   - Time tracking
   - Favorite types
   - Rating distributions

---

## Quick Reference

### Rating a Game

1. Select game
2. Click stars in Details panel
3. Done! (Auto-saves)

### Planning a Run

1. Check games in main list
2. Click "Add to Run"
3. Click "Prepare Run"
4. Reorder as needed
5. Click "Stage and Save"

### Setting Challenge Conditions

1. Open "Prepare Run"
2. Click "Set Global Conditions" for entire run
3. Or click "Set" button per entry
4. Enter numbers (e.g., "1,2,5" for Hitless, Deathless, No Midway)

---

## Support

### Questions?

See full documentation in `/docs` folder:
- 15 comprehensive guides
- 8,000+ lines of documentation
- Complete API reference
- Migration guides

### Issues?

1. Check console logs (F12)
2. Run integration tests
3. Verify migrations applied
4. Check database file permissions

---

**Enjoy your SMW hack collection!** 🎮

*Made with ❤️ for the SMW hacking community*

