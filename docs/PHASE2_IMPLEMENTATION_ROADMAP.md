# Phase 2: Database Integration - Implementation Roadmap

**Status**: 📋 Ready to Begin  
**Estimated Effort**: 4-6 hours  
**Prerequisites**: Phase 1 UI Complete ✅

---

## Quick Start Checklist

### Before You Begin

- [ ] Review `docs/ELECTRON_DATABASE_INTEGRATION_PLAN.md`
- [ ] Review `docs/ELECTRON_IPC_ARCHITECTURE.md`
- [ ] Apply database migrations:
  ```bash
  sqlite3 electron/clientdata.db < electron/sql/migrations/002_clientdata_enhanced_ratings_and_runs.sql
  sqlite3 electron/rhdata.db < electron/sql/migrations/005_add_local_runexcluded.sql
  ```
- [ ] Verify migrations: `node electron/tests/test_enhanced_ratings.js`

---

## Implementation Steps

### Step 1: Create Database Manager (30 min)

**File**: `electron/database-manager.js`

```bash
# Create file
touch electron/database-manager.js
```

**Implement**:
- [ ] DatabaseManager class
- [ ] getDatabasePaths() function
- [ ] getConnection() method
- [ ] ensureDatabaseExists() method
- [ ] closeAll() method

**Test**:
```javascript
// Quick test
const { DatabaseManager } = require('./database-manager');
const dbm = new DatabaseManager();
const db = dbm.getConnection('clientdata');
console.log('Tables:', db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all());
```

### Step 2: Create IPC Handlers (60 min)

**File**: `electron/ipc-handlers.js`

```bash
# Create file
touch electron/ipc-handlers.js
```

**Implement** (in order):
- [ ] `db:rhdata:get:games` - Get all games
- [ ] `db:rhdata:get:versions` - Get game versions
- [ ] `db:rhdata:get:game` - Get specific version
- [ ] `db:clientdata:set:annotation` - Save annotation
- [ ] `db:clientdata:set:version-annotation` - Save version-specific
- [ ] `db:clientdata:get:stages` - Get stages
- [ ] `db:clientdata:set:stage-annotation` - Save stage annotation
- [ ] `db:settings:get:all` - Get all settings
- [ ] `db:settings:set:value` - Set single setting
- [ ] `db:settings:set:bulk` - Bulk save settings

**Test**:
```javascript
// Quick test each handler
const { ipcMain } = require('electron');
// Register handlers
// Emit test events
```

### Step 3: Update preload.js (15 min)

**File**: `electron/preload.js`

**Implement**:
- [ ] Import contextBridge, ipcRenderer
- [ ] Create electronAPI object
- [ ] Expose all 10 API methods
- [ ] Add TypeScript declarations

**Verify**:
```javascript
// In renderer console
console.log(window.electronAPI);
// Should show all methods
```

### Step 4: Update main.js (15 min)

**File**: `electron/main.js`

**Implement**:
- [ ] Import DatabaseManager
- [ ] Import registerDatabaseHandlers
- [ ] Initialize dbManager
- [ ] Register handlers on app ready
- [ ] Close connections on quit

**Test**:
```bash
# Run app in dev mode
npm start
# Check console for database initialization
```

### Step 5: Refactor App.vue (90 min)

**File**: `electron/renderer/src/App.vue`

**Implement**:
- [ ] Import onMounted, watch
- [ ] Create loadGames() function
- [ ] Create loadSettings() function
- [ ] Replace dummy items with reactive empty array
- [ ] Call loadGames() on mount
- [ ] Implement saveAnnotation() function
- [ ] Add debounced auto-save on changes
- [ ] Implement loadStages() function
- [ ] Implement saveStageAnnotation() function
- [ ] Implement version switching logic
- [ ] Update settings save/load

**Code Structure**:
```javascript
// Loading
onMounted(async () => {
  await loadGames();
  await loadSettings();
});

// Auto-save
const debouncedSave = debounce(async (item) => {
  await window.electronAPI.saveAnnotation(item);
}, 500);

watch(selectedItem, (newVal, oldVal) => {
  if (newVal && oldVal && newVal.Id === oldVal.Id) {
    debouncedSave(newVal);
  }
}, { deep: true });

// Version switching
watch(selectedVersion, async (newVersion) => {
  if (selectedItem.value) {
    await loadGameVersion(selectedItem.value.Id, newVersion);
  }
});
```

### Step 6: Add Loading States (30 min)

**Add to App.vue**:
- [ ] Loading spinner component
- [ ] isLoading ref
- [ ] Show spinner during load
- [ ] Error state handling
- [ ] Retry mechanism

```javascript
const isLoading = ref(false);
const loadError = ref<string | null>(null);

async function loadGames() {
  isLoading.value = true;
  loadError.value = null;
  
  try {
    const result = await window.electronAPI.getGames();
    if (result.success) {
      items.splice(0, items.length, ...result.data);
    } else {
      loadError.value = result.error;
    }
  } catch (error) {
    loadError.value = error.message;
  } finally {
    isLoading.value = false;
  }
}
```

### Step 7: Testing (60 min)

**Test Each Feature**:
- [ ] Games load from database
- [ ] Filtering works
- [ ] Selection works
- [ ] Detail inspector loads correct data
- [ ] Ratings save to database
- [ ] Version switching loads correct version
- [ ] Version-specific ratings work
- [ ] Stages load from database
- [ ] Stage annotations save
- [ ] Settings load from database
- [ ] Settings save to database
- [ ] JSON viewer shows correct data
- [ ] Exclude from random saves

**Cross-Database Tests**:
- [ ] Verify JOIN between rhdata and clientdata
- [ ] Verify version-specific override works
- [ ] Verify latest version filtering

---

## Code Files Checklist

### New Files to Create (3)

1. [ ] `electron/database-manager.js` (~150 lines)
2. [ ] `electron/ipc-handlers.js` (~400 lines)
3. [ ] `electron/renderer/src/types.ts` (~80 lines) - TypeScript definitions

### Files to Modify (3)

4. [ ] `electron/preload.js` - Add electronAPI exposure
5. [ ] `electron/main.js` - Initialize database manager
6. [ ] `electron/renderer/src/App.vue` - Replace dummy data with API calls

---

## Dependencies

### Check package.json

Ensure these are installed:

```json
{
  "dependencies": {
    "better-sqlite3": "^9.0.0",
    "electron": "^27.0.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.0"
  }
}
```

Install if needed:
```bash
cd electron/renderer
npm install lodash-es
```

---

## Testing Commands

### Run Application

```bash
# Development mode
cd electron/renderer
npm run dev
# In another terminal:
cd electron
npm start

# Production build
cd electron/renderer
npm run build
cd ..
npm start
```

### Verify Databases

```bash
# Check tables exist
sqlite3 electron/rhdata.db "SELECT COUNT(*) FROM gameversions;"
sqlite3 electron/clientdata.db "SELECT name FROM sqlite_master WHERE type='table';"

# Check data
sqlite3 electron/rhdata.db "SELECT gameid, name, version FROM gameversions LIMIT 5;"
```

---

## Debugging Tips

### Enable DevTools

```javascript
// main.js
mainWindow.webContents.openDevTools();
```

### Log IPC Calls

```javascript
// preload.js
contextBridge.exposeInMainWorld('electronAPI', {
  getGames: async () => {
    console.log('[IPC] Calling db:rhdata:get:games');
    const result = await ipcRenderer.invoke('db:rhdata:get:games');
    console.log('[IPC] Result:', result);
    return result;
  },
  // ... etc
});
```

### Check Database Paths

```javascript
// Add to main.js
console.log('Database paths:', dbManager.paths);
```

---

## Common Issues & Solutions

### Issue: Database locked

**Solution**: Use WAL mode
```javascript
db.pragma('journal_mode = WAL');
```

### Issue: Database not found

**Solution**: Check paths and create if missing
```javascript
if (!fs.existsSync(dbPath)) {
  // Create with schema
}
```

### Issue: Context isolation error

**Solution**: Use contextBridge, don't expose ipcRenderer directly

### Issue: Type errors in TypeScript

**Solution**: Create proper type definitions in types.ts

---

## Rollback Plan

If Phase 2 causes issues:

1. Keep UI changes (Phase 1)
2. Revert to dummy data temporarily
3. Debug database integration separately
4. Re-enable piece by piece

---

## Estimated Timeline

| Task | Time | Dependencies |
|------|------|--------------|
| Database Manager | 30 min | None |
| IPC Handlers | 60 min | Database Manager |
| preload.js Update | 15 min | IPC Handlers |
| main.js Update | 15 min | Database Manager |
| App.vue Refactor | 90 min | All above |
| Loading States | 30 min | App.vue |
| Testing | 60 min | All complete |
| **Total** | **~5 hours** | |

---

## Success Criteria for Phase 2

- [ ] Application starts without errors
- [ ] Games load from rhdata.db
- [ ] User annotations load from clientdata.db
- [ ] Changes save to database
- [ ] Version switching works
- [ ] Settings persist correctly
- [ ] No console errors
- [ ] Performance acceptable (<100ms for game load)
- [ ] Works on Linux
- [ ] Works on Windows (test later)

---

## Ready to Proceed

When you're ready to implement Phase 2:

1. Read the implementation plan: `docs/ELECTRON_DATABASE_INTEGRATION_PLAN.md`
2. Follow this roadmap step-by-step
3. Test after each step
4. Commit working changes frequently

---

*Roadmap Created: October 12, 2025*  
*Ready for Implementation*

