# Updategames.js Schema Compatibility Updates

## Date: October 12, 2025

## Overview
Updated `updategames.js` and its supporting modules to ensure compatibility with the schema enhancements that were previously applied to `loaddata.js`. This ensures both scripts handle the same data types consistently and support the new JSON schema format from SMWC.

## Problems Addressed

### 1. Boolean Type Error ✅
**Problem**: New JSON format from SMWC includes boolean values (`moderated: true`), but SQLite cannot bind JavaScript booleans directly.

**Solution**: Added `normalizeValueForSQLite()` function to `lib/record-creator.js` that converts:
- `true` → `"1"`
- `false` → `"0"`
- Arrays → JSON strings
- Objects → JSON strings

### 2. Missing New Schema Fields ✅
**Problem**: New JSON format includes nested type/difficulty fields that weren't being extracted.

**Solution**: Added extraction and storage of:
- **fields_type** - from `fields.type` (e.g., "Kaizo", "Standard")
- **raw_difficulty** - from `raw_fields.difficulty` (e.g., "diff_4")
- **combinedtype** - computed field combining all type/difficulty information

### 3. No Locked Attributes Support ✅
**Problem**: Curator-managed fields could be overwritten when new versions were imported.

**Solution**: Implemented locked attributes system:
- **legacy_type** field is preserved across versions
- Values copied from previous version to new version
- Console notification when preserving locked values

## Code Changes

### File: `lib/record-creator.js`

#### 1. Added Constants and Helper Functions (Lines 19-113)

```javascript
// Locked attributes that should be preserved across versions
const LOCKED_ATTRIBUTES = [
  'legacy_type'
];

function normalizeValueForSQLite(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return (value ? 1 : 0).toString();
  if (Array.isArray(value)) return JSON.stringify(value);
  if (typeof value === 'object') return JSON.stringify(value);
  return value;
}

function computeCombinedType(record) {
  // Format: [fields_type]: [difficulty] (raw_difficulty) (raw_fields.type)
  // Example: "Kaizo: Advanced (diff_4) (kaizo)"
  // ... (full implementation as in loaddata.js)
}
```

#### 2. Updated `createGameVersionRecord()` Method

**Changes**:
- Extract `fields_type` from `metadata.fields.type`
- Extract `raw_difficulty` from `metadata.raw_fields.difficulty`
- Compute `combinedtype` using `computeCombinedType()`
- Apply `normalizeValueForSQLite()` to `moderated` and `featured` fields
- Copy locked attributes from previous version
- Log when locked attributes are preserved

**Before**:
```javascript
moderated: metadata.moderated || null,
featured: metadata.featured || null,
```

**After**:
```javascript
moderated: normalizeValueForSQLite(metadata.moderated),
featured: normalizeValueForSQLite(metadata.featured),
fields_type: fieldsType,
raw_difficulty: rawDifficulty,
combinedtype: combinedType,
// Apply locked attributes from previous version (overrides JSON data)
...lockedValues
```

## Testing

### Test Suite Created
**File**: `tests/test_updategames.js`

**Tests** (8 total):
1. ✅ Schema columns exist (fields_type, raw_difficulty, combinedtype, legacy_type)
2. ✅ Boolean values are normalized for SQLite
3. ✅ fields_type is extracted from fields.type
4. ✅ raw_difficulty is extracted from raw_fields.difficulty
5. ✅ combinedtype is computed correctly
6. ✅ combinedtype handles array types correctly
7. ✅ Locked attributes are preserved across versions
8. ✅ Backward compatible with old JSON format

**Running Tests**:
```bash
node tests/test_updategames.js
```

**Expected Output**:
```
╔════════════════════════════════════════════════════════╗
║  Updategames.js Test Suite - Schema Compatibility     ║
╚════════════════════════════════════════════════════════╝

✓ Test 1: Schema columns exist
✓ Test 2: Boolean values are normalized for SQLite
✓ Test 3: fields_type is extracted from fields.type
✓ Test 4: raw_difficulty is extracted from raw_fields.difficulty
✓ Test 5: combinedtype is computed correctly
✓ Test 6: combinedtype handles array types correctly
✓ Test 7: Locked attributes are preserved across versions
✓ Test 8: Backward compatible with old JSON format

Test Summary:
  Passed: 8
  Failed: 0
  Total:  8

✓ All tests passed!
```

## Database Schema Requirements

### Required Columns in `gameversions` Table

These columns must exist in `electron/rhdata.db`:

| Column | Type | Added | Purpose |
|--------|------|-------|---------|
| fields_type | VARCHAR(255) | v1.1 | Type from fields.type |
| raw_difficulty | VARCHAR(255) | v1.1 | Difficulty code |
| combinedtype | VARCHAR(255) | v1.2 | Computed combined type |
| legacy_type | VARCHAR(255) | v1.3 | Locked curator attribute |

### Migration Required

If updating from Phase 1 initial implementation, run:

```bash
# Add new columns (if not already present)
sqlite3 electron/rhdata.db < electron/sql/migrations/001_add_fields_type_raw_difficulty.sql
sqlite3 electron/rhdata.db < electron/sql/migrations/002_add_combinedtype.sql
```

Or manually:

```sql
ALTER TABLE gameversions ADD COLUMN fields_type VARCHAR(255);
ALTER TABLE gameversions ADD COLUMN raw_difficulty VARCHAR(255);
ALTER TABLE gameversions ADD COLUMN combinedtype VARCHAR(255);
ALTER TABLE gameversions ADD COLUMN legacy_type VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_gameversions_fields_type ON gameversions(fields_type);
CREATE INDEX IF NOT EXISTS idx_gameversions_raw_difficulty ON gameversions(raw_difficulty);
CREATE INDEX IF NOT EXISTS idx_gameversions_combinedtype ON gameversions(combinedtype);
```

## Compatibility Matrix

### JSON Format Support

| Format | loaddata.js | updategames.js | Status |
|--------|-------------|----------------|--------|
| Old (pre-2025) | ✅ | ✅ | Compatible |
| New (2025+) | ✅ | ✅ | Compatible |
| Mixed | ✅ | ✅ | Compatible |
| Boolean values | ✅ | ✅ | Compatible |
| Nested fields | ✅ | ✅ | Compatible |

### Feature Parity

| Feature | loaddata.js | updategames.js | Status |
|---------|-------------|----------------|--------|
| Boolean normalization | ✅ | ✅ | ✅ Complete |
| fields_type extraction | ✅ | ✅ | ✅ Complete |
| raw_difficulty extraction | ✅ | ✅ | ✅ Complete |
| combinedtype computation | ✅ | ✅ | ✅ Complete |
| Locked attributes | ✅ | ✅ | ✅ Complete |
| Environment variables | ✅ | ✅ | ✅ Complete |

## Examples

### New JSON Format Handling

**Input** (from SMWC API):
```json
{
  "id": "38660",
  "name": "The Stinky Black Banana Peel",
  "type": "Advanced",
  "moderated": true,
  "featured": false,
  "fields": {
    "type": "Kaizo"
  },
  "raw_fields": {
    "difficulty": "diff_4",
    "type": ["kaizo"]
  }
}
```

**Database Record Created**:
```sql
SELECT 
  gameid, 
  name,
  moderated,          -- "1" (from true)
  featured,           -- "0" (from false)
  fields_type,        -- "Kaizo"
  raw_difficulty,     -- "diff_4"
  combinedtype        -- "Kaizo: Advanced (diff_4) (kaizo)"
FROM gameversions WHERE gameid = '38660';
```

### Locked Attributes Preservation

**Scenario**:
```
Version 1: Created by updategames.js
  legacy_type: NULL

Curator Action: Manual SQL update
  UPDATE gameversions SET legacy_type = 'Historical' WHERE gameid = '38660';

Version 2: Created by updategames.js (new data from SMWC)
  legacy_type: 'Historical' (PRESERVED!)
  Console: "ℹ️  Preserving locked attribute: legacy_type = \"Historical\""
```

## Verification

### After Update, Verify

```bash
# 1. Run tests
node tests/test_updategames.js

# 2. Check schema
sqlite3 electron/rhdata.db "PRAGMA table_info(gameversions);" | grep -E "fields_type|raw_difficulty|combinedtype|legacy_type"

# 3. Test with actual data (dry run)
node updategames.js --dry-run --limit=1

# 4. Check for boolean handling
# Should not see error: "SQLite3 can only bind numbers, strings, bigints, buffers, and null"
```

## Benefits

### 1. Consistency
Both `loaddata.js` and `updategames.js` now handle data identically, ensuring database consistency regardless of which script is used.

### 2. Future-Proof
Supports new JSON schema format from SMWC while maintaining backward compatibility with old formats.

### 3. Curator-Friendly
Locked attributes allow manual classifications to persist across automated updates.

### 4. Enhanced Querying
New fields enable more precise filtering and searching:

```sql
-- Find all Kaizo Advanced games
SELECT * FROM gameversions 
WHERE combinedtype LIKE 'Kaizo: Advanced%';

-- Find games with diff_4 difficulty
SELECT * FROM gameversions 
WHERE raw_difficulty = 'diff_4';

-- Find curator-classified games
SELECT * FROM gameversions 
WHERE legacy_type IS NOT NULL;
```

## Related Documentation

- **loaddata.js fixes**: `docs/GV_BUGFIX_LOADDATA.md`
- **Schema details**: `docs/GAMEVERSIONS_TABLE_SCHEMA.md`
- **Locked attributes**: `docs/LOCKED_ATTRIBUTES.md`
- **Combined type**: `docs/GV_COMBINEDTYPE_UPDATE.md`
- **Complete session**: `docs/GV_COMPLETE_SESSION_SUMMARY.md`

## Summary

The `updategames.js` script and its `lib/record-creator.js` module now have complete feature parity with `loaddata.js` for:
- ✅ Boolean value normalization
- ✅ New schema field extraction (fields_type, raw_difficulty)
- ✅ Combined type computation
- ✅ Locked attributes preservation
- ✅ Backward compatibility

All 8 tests pass, confirming that the same issues found in `loaddata.js` have been successfully addressed in `updategames.js`.

**Status**: ✅ **COMPLETE AND TESTED**

---

*Updates completed: October 12, 2025*  
*Test coverage: 8/8 tests passing*  
*Feature parity: 100% with loaddata.js*

