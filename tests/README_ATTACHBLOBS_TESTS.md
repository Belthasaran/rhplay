# Test Suite for attachblobs.js

## Overview

This directory contains comprehensive test scripts for `attachblobs.js` functionality, including the new `--newonly` command line option.

## Test Files

### `test_attachblobs.js`

Comprehensive test suite for `attachblobs.js` that validates both original mode and the new `--newonly` mode.

**Features:**
- Creates test databases (rhdata.db and patchbin.db)
- Creates test fixtures (sample blob files)
- Tests original mode (processes all patchblobs)
- Tests --newonly mode (skips existing file_names)
- Validates implementation with real file processing
- Generates detailed test reports

**Usage:**
```bash
# Run all tests
cd tests
node test_attachblobs.js

# Tests will create:
# - tests/temp/test_rhdata_attachblobs.db (test rhdata database)
# - tests/temp/test_patchbin_attachblobs.db (test patchbin database)
# - tests/fixtures_attachblobs/*.bin (test blob files)
```

## Test Results

The test suite validates:

✅ **Core Functionality**
- Database query logic
- File searching and hash verification
- Attachment insertion and updates
- Preservation of existing data during updates

✅ **Unit Functions**
- `fileNameExistsInAttachments()` - Check if file_name exists
- `generateUUID()` - UUID generation
- Hash calculation functions

✅ **Original Mode**
- Processes all patchblobs from database
- Updates existing attachments correctly
- Inserts new attachments
- Preserves non-NULL fields during updates

✅ **--newonly Mode**
- Skips patchblobs where file_name already exists in attachments
- Processes only new patchblobs
- Faster incremental processing
- Correct skip counting in summary

## Test Coverage

**Implementation: 100% of features**

### Fully Implemented ✅
- Original mode (default behavior)
- --newonly mode (new feature)
- File name existence checking
- Command line argument parsing
- Help message (--help)

## Test Database

The test databases include:

**rhdata.db:**
- `patchblobs` table with 5 test records

**patchbin.db:**
- Full schema from `patchbin.sql`
- Pre-populated with 2 existing attachments
- 3 new attachments added during tests

**Test Data:**
- 5 test patchblobs in rhdata.db
- 2 pre-existing attachments (test_patch_1.bin, test_patch_3.dat)
- 3 new patchblobs to process (test_patch_2.bin, test_patch_4.bin, test_patch_5.dat)

## Test Fixtures

Located in `tests/fixtures_attachblobs/`:

1. **test_patch_1.bin** (1,000 bytes)
   - Pre-exists in attachments
   - Should be skipped with --newonly

2. **test_patch_2.bin** (2,000 bytes)
   - New attachment
   - Should be processed in both modes

3. **test_patch_3.dat** (1,500 bytes)
   - Pre-exists in attachments
   - Should be skipped with --newonly

4. **test_patch_4.bin** (1,200 bytes)
   - New attachment
   - Should be processed in both modes

5. **test_patch_5.dat** (1,600 bytes)
   - New attachment
   - Should be processed in both modes

Each fixture has calculated:
- SHA-224 hash (for verification)
- SHA-1, SHA-256, MD5 hashes
- CRC16, CRC32 checksums
- IPFS CIDs (v0 and v1)
- File size

## Running Tests

### Prerequisites

```bash
# Ensure you're in the project root
cd /home/main/proj/rhtools

# Dependencies should already be installed
npm install
```

### Run Test Suite

```bash
cd tests
node test_attachblobs.js
```

### Expected Output

```
╔════════════════════════════════════════════════════════════════════╗
║          attachblobs.js Test Suite                                ║
╚════════════════════════════════════════════════════════════════════╝

======================================================================
Setting up test databases
======================================================================
✓ Created test rhdata.db
✓ Created test patchbin.db with schema

======================================================================
Creating test fixtures
======================================================================
✓ Created fixture: test_patch_1.bin (1000 bytes, sha224: e1f86d441086...)
✓ Created fixture: test_patch_2.bin (2000 bytes, sha224: 212f069c4edb...)
...

======================================================================
Testing original mode (without --newonly)
======================================================================
✓ Original mode: All 5 attachments exist in database

======================================================================
Testing --newonly mode
======================================================================
✓ Output correctly shows --newonly mode is active
✓ Output shows files were skipped due to --newonly
✓ --newonly mode: Correctly processed only new files (5 total attachments)
✓ --newonly mode: Pre-existing files remain in database
✓ --newonly mode: New files were correctly added

======================================================================
ALL TESTS COMPLETE
======================================================================
✓ All tests passed successfully!
```

## Test Scenarios

### Original Mode Test

1. Create 5 patchblobs in rhdata.db
2. Pre-populate 2 attachments in patchbin.db
3. Run attachblobs.js without --newonly
4. Verify all 5 patchblobs are processed:
   - 2 existing attachments are updated (preserving non-NULL fields)
   - 3 new attachments are inserted
5. Verify total count is 5 attachments

### --newonly Mode Test

1. Reset patchbin.db with 2 pre-existing attachments
2. Run attachblobs.js with --newonly flag
3. Verify behavior:
   - test_patch_1.bin is skipped (pre-exists)
   - test_patch_2.bin is processed (new)
   - test_patch_3.dat is skipped (pre-exists)
   - test_patch_4.bin is processed (new)
   - test_patch_5.dat is processed (new)
4. Verify summary shows:
   - Total processed: 5
   - Inserted: 3
   - Skipped (--newonly): 2

## Cleaning Up

```bash
# Remove test databases
rm tests/temp/test_rhdata_attachblobs.db
rm tests/temp/test_patchbin_attachblobs.db

# Remove test fixtures
rm -rf tests/fixtures_attachblobs/

# Remove temporary test scripts
rm tests/temp/test_attachblobs_*.js
```

## Adding New Tests

To add new tests to `test_attachblobs.js`:

1. **Add test function:**
   ```javascript
   function testNewFeature() {
     section('Testing new feature');
     // Test implementation
   }
   ```

2. **Call in main:**
   ```javascript
   async function runTests() {
     // ... existing tests
     testNewFeature();
   }
   ```

## Command Line Usage

After running tests, you can manually test the tool:

```bash
# Test original mode (from project root)
node attachblobs.js

# Test --newonly mode
node attachblobs.js --newonly

# Show help
node attachblobs.js --help
```

## Performance Comparison

**Original Mode:**
- Processes all patchblobs in database
- Re-processes existing attachments (updates them)
- Slower for incremental updates

**--newonly Mode:**
- Only processes patchblobs with new file_names
- Skips file searching and hash calculation for existing entries
- Significantly faster for incremental updates
- Recommended for regular sync operations

**Example Speed Improvement:**
- 1000 patchblobs total
- 950 already in attachments
- Original mode: Processes all 1000 (slow)
- --newonly mode: Processes only 50 (fast)

## Continuous Integration

To integrate with CI/CD:

```yaml
# Example .github/workflows/test.yml
test-attachblobs:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v2
    - uses: actions/setup-node@v2
    - run: npm install
    - run: cd tests && node test_attachblobs.js
```

## Related Documentation

- `../attachblobs.js` - Main script
- `../electron/sql/patchbin.sql` - Database schema
- `README.md` - General test suite overview

## Support

For issues or questions about tests:
1. Check test output for specific errors
2. Verify database schema matches expectations
3. Check fixture files exist and have correct hashes
4. Ensure all dependencies are installed

## Troubleshooting

**Common Issues:**

1. **Database locked error:**
   - Close any open database connections
   - Remove test databases and rerun

2. **Fixture files not found:**
   - Ensure fixtures_attachblobs directory exists
   - Check file permissions

3. **Hash mismatch errors:**
   - Verify fixture file content hasn't changed
   - Regenerate test fixtures if needed

4. **Module not found errors:**
   - Run `npm install` in project root
   - Check all required dependencies are installed






