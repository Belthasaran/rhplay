# attachblobs.js --newonly Feature

## Overview

Added a new `--newonly` command line option to `attachblobs.js` that significantly speeds up incremental processing by skipping patchblobs where the file_name already exists in the attachments table.

## Motivation

When running `attachblobs.js` repeatedly to process new patches, the original implementation would:
1. Search the filesystem for every patchblob file
2. Calculate hashes for every file
3. Update existing attachments (even if nothing changed)

This was time-consuming when most patchblobs had already been processed. The `--newonly` option solves this by:
1. Quickly checking if the file_name exists in attachments (simple database query)
2. Skipping the entire processing pipeline if it exists
3. Only processing genuinely new patchblobs

## Usage

```bash
# Original mode (process all patchblobs)
node attachblobs.js

# New mode (only process new patchblobs)
node attachblobs.js --newonly

# Show help
node attachblobs.js --help
```

## Implementation Details

### Modified Files

1. **attachblobs.js**
   - Added `fileNameExistsInAttachments()` function
   - Added `parseCommandLineArgs()` function
   - Modified `main()` to support command line options
   - Updated processing loop to skip existing files when `--newonly` is set
   - Enhanced summary output to show skip counts

2. **tests/test_attachblobs.js** (NEW)
   - Comprehensive test suite
   - Tests both original and --newonly modes
   - Unit tests for helper functions
   - Integration tests with real databases

3. **tests/README_ATTACHBLOBS_TESTS.md** (NEW)
   - Complete test documentation
   - Usage instructions
   - Troubleshooting guide

### Key Functions

#### `fileNameExistsInAttachments(db, fileName)`
Checks if any attachment record exists with the given file_name.

```javascript
function fileNameExistsInAttachments(db, fileName) {
  const query = `
    SELECT COUNT(*) as count
    FROM attachments 
    WHERE file_name = ?
  `;
  const result = db.prepare(query).get(fileName);
  return result.count > 0;
}
```

**Note:** This is a simple file_name check, not hash-based. It matches on file_name only, which is intentional for performance.

#### `parseCommandLineArgs()`
Parses command line arguments and returns options object.

```javascript
function parseCommandLineArgs() {
  const args = process.argv.slice(2);
  const options = {
    newonly: false
  };
  
  for (const arg of args) {
    if (arg === '--newonly') {
      options.newonly = true;
    } else if (arg === '--help' || arg === '-h') {
      // Show help and exit
    }
  }
  
  return options;
}
```

### Processing Logic

**Original Mode (default):**
```
For each patchblob in rhdata.db:
  1. Search filesystem for file
  2. Verify hash
  3. Calculate checksums and IPFS CIDs
  4. Insert or update attachment
```

**--newonly Mode:**
```
For each patchblob in rhdata.db:
  1. Check if file_name exists in attachments
  2. If exists: Skip (increment skip counter)
  3. If not exists:
     a. Search filesystem for file
     b. Verify hash
     c. Calculate checksums and IPFS CIDs
     d. Insert attachment
```

## Test Coverage

The test suite verifies:

✅ **Unit Tests**
- `fileNameExistsInAttachments()` correctly identifies existing files
- `fileNameExistsInAttachments()` correctly identifies non-existing files
- `generateUUID()` generates unique UUIDs

✅ **Integration Tests - Original Mode**
- Processes all 5 patchblobs
- Updates 2 existing attachments
- Inserts 3 new attachments
- Total count: 5 attachments

✅ **Integration Tests - --newonly Mode**
- Skips 2 existing patchblobs (test_patch_1.bin, test_patch_3.dat)
- Processes 3 new patchblobs (test_patch_2.bin, test_patch_4.bin, test_patch_5.dat)
- Correct skip counting in summary
- Pre-existing attachments remain unchanged
- New attachments are correctly inserted

## Performance Comparison

### Example Scenario
- **Total patchblobs:** 1,000
- **Already in attachments:** 950
- **New patchblobs:** 50

### Original Mode
- **Files searched:** 1,000
- **Hashes calculated:** 1,000
- **Database operations:** 1,000 updates/inserts
- **Time:** ~10 minutes (example)

### --newonly Mode
- **Files searched:** 50
- **Hashes calculated:** 50
- **Database operations:** 950 simple queries + 50 inserts
- **Time:** ~30 seconds (example)

**Speed improvement: ~20x faster for incremental updates**

## Backward Compatibility

✅ **Fully backward compatible**
- Default behavior unchanged (no --newonly flag = original mode)
- All existing functionality preserved
- No breaking changes to API or database schema

## Error Handling

- Unknown options trigger a warning but don't stop execution
- Help message available with `--help` or `-h`
- Invalid arguments are logged but processing continues

## Example Output

### Original Mode
```bash
$ node attachblobs.js

attachblobs.js - Attaching blob files to patchbin.db

Found 5 patchblob records to process

============================================================

Processing: test_patch_1.bin
Searching for file: test_patch_1.bin...
  ✓ Hash verified
  ✓ Updated attachments table

Processing: test_patch_2.bin
Searching for file: test_patch_2.bin...
  ✓ Hash verified
  ✓ Inserted into attachments table

...

Summary:
  Total processed: 5
  Inserted:        3
  Skipped:         2
  Errors:          0
```

### --newonly Mode
```bash
$ node attachblobs.js --newonly

attachblobs.js - Attaching blob files to patchbin.db

Mode: --newonly (skipping existing file_names)

Found 5 patchblob records to process

============================================================

Skipping (--newonly): test_patch_1.bin (already exists)

Processing: test_patch_2.bin
Searching for file: test_patch_2.bin...
  ✓ Hash verified
  ✓ Inserted into attachments table

Skipping (--newonly): test_patch_3.dat (already exists)

...

Summary:
  Total processed: 5
  Inserted:        3
  Skipped:         0
  Skipped (--newonly): 2
  Errors:          0
```

## Recommended Workflow

### Initial Import
```bash
# First time: Process all patchblobs
node attachblobs.js
```

### Incremental Updates
```bash
# Subsequent runs: Only process new patchblobs
node attachblobs.js --newonly
```

### Force Re-processing
```bash
# If you need to re-process everything (e.g., after schema change)
node attachblobs.js
```

## Limitations

1. **File name based, not hash based:** The `--newonly` check only looks at file_name, not the hash. If a file with the same name but different content exists, it will be skipped.

2. **No partial update:** If you want to update specific fields of existing attachments, you need to use original mode (without --newonly).

3. **No granular control:** It's all-or-nothing - either skip all existing file_names or process all patchblobs.

## Future Enhancements

Possible improvements for future versions:

- `--force-update` flag to re-process specific files
- `--update-fields` flag to update only specific fields
- `--hash-check` flag to verify hashes even when skipping
- Progress bar for long-running operations
- Parallel processing for multiple files

## Testing

Run the test suite:

```bash
cd tests
node test_attachblobs.js
```

Expected result: All tests pass ✅

## Related Documentation

- `attachblobs.js` - Main implementation
- `tests/test_attachblobs.js` - Test suite
- `tests/README_ATTACHBLOBS_TESTS.md` - Test documentation
- `electron/sql/patchbin.sql` - Database schema

## Support

For questions or issues:
1. Check the help message: `node attachblobs.js --help`
2. Review test output: `node tests/test_attachblobs.js`
3. Check database schema matches expectations
4. Verify file_name uniqueness in your use case

---

**Version:** 1.0.0  
**Date:** 2025-10-12  
**Author:** Implementation via AI Assistant

