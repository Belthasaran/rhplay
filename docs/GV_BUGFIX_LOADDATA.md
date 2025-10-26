# Bug Fix: loaddata.js - Support for New JSON Schema

## Problem
The `loaddata.js` script was failing to load new JSON data files from the `tempj` directory with the following error:

```
TypeError: SQLite3 can only bind numbers, strings, bigints, buffers, and null
```

## Root Cause
The new JSON files from the external source have schema changes that include **boolean values** (e.g., `moderated: true` instead of `moderated: undefined` or string values). SQLite3's parameter binding does not support JavaScript boolean types - it only accepts: numbers, strings, bigints, buffers, and null.

### Schema Differences
**Old JSON Format:**
- `moderated`: undefined or not present
- Boolean-like fields were strings (e.g., `"Yes"`, `"No"`)

**New JSON Format:**
- `moderated`: `true` or `false` (boolean)
- `featured`: potentially boolean
- Additional complex fields like `fields`, `raw_fields`, `authors_list`, `images` (objects/arrays)

## Solution
Added a new normalization function `normalizeValueForSQLite()` that converts JavaScript values to SQLite-compatible types:

1. **Booleans → Numbers**: `true` → `1`, `false` → `0`
2. **Arrays → JSON Strings**: Arrays are serialized to JSON strings
3. **Objects → JSON Strings**: Objects are serialized to JSON strings
4. **Null/Undefined → Null**: Remains as null

### Changes Made

#### 1. New Normalization Function (lines 69-87)
```javascript
function normalizeValueForSQLite(value) {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }
  if (Array.isArray(value)) {
    return JSON.stringify(value);
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return value;
}
```

#### 2. Updated `isDuplicate()` Function (line 99)
Applied normalization when binding parameters for duplicate checking:
```javascript
params[field] = normalizeValueForSQLite(record[field]);
```

#### 3. Updated `insertGameVersion()` Function (lines 231, 236)
Normalized boolean fields before insertion:
```javascript
moderated: normalizeValueForSQLite(record.moderated),
featured: normalizeValueForSQLite(record.featured),
```

#### 4. Enhanced `findChangedAttributes()` Function (lines 177-187)
Added boolean-to-number normalization for accurate comparison between old (numeric) and new (boolean) values:
```javascript
// Normalize booleans to numbers for comparison (true->1, false->0)
if (typeof newNorm === 'boolean') {
  newNorm = newNorm ? 1 : 0;
}
if (typeof prevNorm === 'boolean') {
  prevNorm = prevNorm ? 1 : 0;
}
```

## Testing Results

### Successful Tests
✅ New JSON files from `tempj` directory load successfully
✅ Duplicate detection works correctly
✅ Old JSON files continue to work (backward compatibility maintained)
✅ Boolean values are correctly converted to 0/1 for database storage
✅ Version tracking and change detection work correctly

### Test Commands
```bash
# Test new JSON format
node loaddata.js tempj/38329  # Success
node loaddata.js tempj/38427  # Success
node loaddata.js tempj/38474  # Success
node loaddata.js tempj/40001  # Success

# Test duplicate detection
node loaddata.js tempj/38329  # Correctly skips duplicate

# Test old JSON format (backward compatibility)
node loaddata.js electron/example-rhmd/38595  # Success
```

## Compatibility
- ✅ **Backward Compatible**: Old JSON files without boolean values continue to work
- ✅ **Forward Compatible**: New JSON files with boolean and complex types are now supported
- ✅ **Database Compatibility**: Boolean values are stored as 0/1, matching SQLite's convention

## Summary
The fix enables `loaddata.js` to handle both old and new JSON schemas by normalizing all values to SQLite-compatible types before database operations. This ensures seamless loading of data from external sources that may have evolved their schema over time.

