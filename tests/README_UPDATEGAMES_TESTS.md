# Updategames.js Test Suite

## Overview

This test suite verifies that `updategames.js` handles the same schema compatibility issues that were fixed in `loaddata.js`. The tests ensure that both scripts maintain feature parity for database operations.

## Test Files

- **test_updategames.js** - Main test suite (8 tests)
- **test_data/** - Test database and data files (generated during tests)

## Running Tests

### Basic Usage

```bash
# From project root
node tests/test_updategames.js

# Or make it executable and run directly
chmod +x tests/test_updategames.js
./tests/test_updategames.js
```

### Expected Output

```
╔════════════════════════════════════════════════════════╗
║  Updategames.js Test Suite - Schema Compatibility     ║
╚════════════════════════════════════════════════════════╝

Running tests...

✓ Test 1: Schema columns exist (fields_type, raw_difficulty, combinedtype, legacy_type)
✓ Test 2: Boolean values are normalized for SQLite
✓ Test 3: fields_type is extracted from fields.type
✓ Test 4: raw_difficulty is extracted from raw_fields.difficulty
✓ Test 5: combinedtype is computed correctly
✓ Test 6: combinedtype handles array types correctly
✓ Test 7: Locked attributes are preserved across versions
✓ Test 8: Backward compatible with old JSON format

────────────────────────────────────────────────────────────

Test Summary:
  Passed: 8
  Failed: 0
  Total:  8

✓ All tests passed!
```

## Test Coverage

### 1. Schema Compatibility
- ✅ Verifies new columns exist: fields_type, raw_difficulty, combinedtype, legacy_type

### 2. Boolean Normalization (Issue #1)
- ✅ Tests that `moderated: true` converts to `"1"`
- ✅ Tests that `featured: false` converts to `"0"`
- ✅ Prevents SQLite binding error with boolean values

### 3. fields_type Extraction (Issue #2a)
- ✅ Extracts `fields.type` from nested JSON
- ✅ Stores as `fields_type` column
- ✅ Example: `fields: { type: "Kaizo" }` → `fields_type: "Kaizo"`

### 4. raw_difficulty Extraction (Issue #2b)
- ✅ Extracts `raw_fields.difficulty` from nested JSON
- ✅ Stores as `raw_difficulty` column
- ✅ Example: `raw_fields: { difficulty: "diff_4" }` → `raw_difficulty: "diff_4"`

### 5. combinedtype Computation (Issue #2c)
- ✅ Computes combined type from multiple fields
- ✅ Format: `[fields_type]: [difficulty] (raw_difficulty) (raw_fields.type)`
- ✅ Example: `"Kaizo: Advanced (diff_4) (kaizo)"`

### 6. combinedtype Array Handling
- ✅ Handles array values in `raw_fields.type`
- ✅ Joins with commas: `["standard", "traditional"]` → `"(standard, traditional)"`

### 7. Locked Attributes (Issue #3)
- ✅ Preserves `legacy_type` across versions
- ✅ Copies value from version 1 to version 2
- ✅ Prevents curator changes from being overwritten

### 8. Backward Compatibility
- ✅ Works with old JSON format (no fields, no raw_fields)
- ✅ Falls back to type field for combinedtype
- ✅ Null values for missing new fields

## What the Tests Verify

### Database Operations
- Record creation without SQLite binding errors
- Proper data type conversion
- Field extraction from nested objects
- Version number incrementation
- Locked attribute preservation

### Data Integrity
- Boolean values stored as "1"/"0" strings
- Nested fields extracted correctly
- Combined type computed accurately
- Curator changes preserved

### Compatibility
- Old JSON format still works
- New JSON format fully supported
- No breaking changes to existing functionality

## Cleanup

The test creates a temporary database at `tests/test_data/test_updategames.db`. This is recreated for each test run to ensure a clean state.

To manually clean up:

```bash
rm -rf tests/test_data/test_updategames.db
```

## Integration Tests

These are unit tests for the `lib/record-creator.js` module. For end-to-end testing:

```bash
# Test full updategames.js workflow (requires SMWC access)
node updategames.js --dry-run --limit=1

# Test with specific game IDs
node updategames.js --game-ids=12345 --dry-run
```

## Troubleshooting

### Test Fails: "Record should be created"
- Check that better-sqlite3 is installed
- Verify test database path is writable

### Test Fails: "Boolean true should be stored as '1'"
- Check normalizeValueForSQLite() function in lib/record-creator.js
- Verify the function is being called for moderated/featured fields

### Test Fails: "fields_type should be extracted"
- Check extraction logic in createGameVersionRecord()
- Verify metadata.fields.type path is correct

### Test Fails: "Locked attribute should be preserved"
- Check LOCKED_ATTRIBUTES constant includes 'legacy_type'
- Verify locked value copying logic in createGameVersionRecord()

## Related Documentation

- **Issue Details**: `docs/GV_BUGFIX_LOADDATA.md`
- **Schema Reference**: `docs/GAMEVERSIONS_TABLE_SCHEMA.md`
- **Locked Attributes**: `docs/LOCKED_ATTRIBUTES.md`
- **Update Summary**: `docs/UPDATEGAMES_SCHEMA_COMPATIBILITY.md`
- **loaddata.js Tests**: `tests/README_LOADDATA_TESTS.md` (similar test suite)

## Adding New Tests

To add a new test:

```javascript
function testYourNewFeature() {
  const dbPath = setupTestDatabase();
  const dbManager = new DatabaseManager(dbPath);
  
  // Your test code here
  
  assert(condition, 'Your assertion message');
  
  dbManager.close();
}

// Add to runTests() function
test('Your test description', testYourNewFeature);
```

## Dependencies

- **better-sqlite3** - SQLite database
- **crypto** - UUID generation
- **fs** - File system operations
- **path** - Path manipulation

All dependencies are already in package.json for the updategames.js implementation.

## Summary

This test suite ensures that `updategames.js` correctly handles:
- ✅ Boolean value normalization (SQLite compatibility)
- ✅ New schema field extraction (fields_type, raw_difficulty)
- ✅ Combined type computation
- ✅ Locked attributes preservation
- ✅ Backward compatibility

**Status**: 8/8 tests passing ✅

---

*Last updated: October 12, 2025*

