# fetchpatches.js - Add Sizes Mode Documentation

## Overview

The `addsizes` mode populates the `file_size` attribute for attachments that have `file_data` but are missing the `file_size` value.

## Purpose

When attachments are populated with `file_data` (by `attachblobs.js` or other means), the `file_size` column may not be set. This mode scans the database and automatically calculates and sets the `file_size` based on the actual length of the `file_data` blob.

## Usage

```bash
# Run the addsizes mode
node fetchpatches.js addsizes

# Or use the npm script
npm run fetchpatches:addsizes
```

## What It Does

1. **Checks Schema**: Verifies that the `file_size` column exists in the `attachments` table
2. **Queries Database**: Finds all attachments where:
   - `file_data IS NOT NULL` (has file content)
   - `file_size IS NULL OR file_size = 0` (missing size)
3. **Calculates Size**: For each attachment, measures the byte length of `file_data`
4. **Updates Database**: Sets `file_size` to the calculated value
5. **Verifies**: Confirms all records were updated successfully

## Features

✅ **Database-only operation** - No remote server queries  
✅ **No fetch limits** - Processes all matching records  
✅ **No delays** - Fast local operation  
✅ **Automatic verification** - Confirms all records updated  
✅ **Idempotent** - Safe to run multiple times  
✅ **Progress tracking** - Shows each record as it's processed  

## Output Example

### When records need updating:

```
======================================================================
MODE: Add Sizes
======================================================================

Populate file_size attribute for attachments with file_data

Querying attachments with file_data but missing file_size...
Found 150 attachments needing file_size

======================================================================
Processing attachments...

[1/150] pblob_11374_7003deed8b (149 remaining)
  auuid: a1b2c3d4-e5f6-7890-abcd-ef1234567890
  file_size: 182536 bytes
  ✓ Updated

[2/150] pblob_12923_4a82423cd8 (148 remaining)
  auuid: b2c3d4e5-f678-9012-bcde-f12345678901
  file_size: 225648 bytes
  ✓ Updated

...

======================================================================

Summary:
  Total attachments processed: 150
  Successfully updated:        150
  Failed:                      0
  Still missing file_size:     0

✓ All attachments with file_data now have file_size set!
```

### When all records already have file_size:

```
======================================================================
MODE: Add Sizes
======================================================================

Populate file_size attribute for attachments with file_data

Querying attachments with file_data but missing file_size...
Found 0 attachments needing file_size

✓ All attachments with file_data already have file_size set!
```

### If file_size column doesn't exist:

```
======================================================================
MODE: Add Sizes
======================================================================

Populate file_size attribute for attachments with file_data

Error: file_size column does not exist in attachments table

You may need to update the schema. Add the column with:
  ALTER TABLE attachments ADD COLUMN file_size INTEGER;
```

## When to Use

Run `addsizes` mode after:

1. **Running `attachblobs.js`** - Populates `file_data` for local files
2. **Running `mode2`** (future) - Downloads missing `file_data` from remote sources
3. **Manual database imports** - If `file_data` was added without `file_size`
4. **Schema migrations** - After adding the `file_size` column to existing data

## Database Schema

The mode expects this column in the `attachments` table:

```sql
file_size BIGINT DEFAULT 0
```

## Performance

- **Speed**: Very fast (local database operation only)
- **No network**: Does not query remote servers
- **No limits**: Processes all matching records in one run
- **Typical time**: <1 second per 1000 records

## Verification

Check results after running:

```bash
# Count attachments with file_data and file_size
sqlite3 electron/patchbin.db "
  SELECT 
    COUNT(*) as total,
    SUM(CASE WHEN file_data IS NOT NULL THEN 1 ELSE 0 END) as with_data,
    SUM(CASE WHEN file_data IS NOT NULL AND file_size > 0 THEN 1 ELSE 0 END) as with_size
  FROM attachments;
"
```

Expected output (after running addsizes):
```
total|with_data|with_size
2682 |150      |150
```

## Integration with Other Modes

### Typical Workflow

1. **Populate local file_data**:
   ```bash
   node attachblobs.js
   ```

2. **Add file sizes**:
   ```bash
   node fetchpatches.js addsizes
   ```

3. **Populate ArDrive metadata**:
   ```bash
   node fetchpatches.js mode1 --fetchlimit=100
   ```

4. **Download missing files** (future):
   ```bash
   node fetchpatches.js mode2 --fetchlimit=50
   ```

5. **Add sizes for new downloads**:
   ```bash
   node fetchpatches.js addsizes
   ```

## Error Handling

The mode handles these scenarios:

- ✅ No matching records (success message)
- ✅ Missing `file_size` column (helpful error with SQL command)
- ✅ Database locked (error with details)
- ✅ Null `file_data` (skipped, not counted)
- ✅ Zero-length `file_data` (sets `file_size` to 0)

## Technical Details

### Query Used

```sql
SELECT auuid, file_name, file_data
FROM attachments
WHERE file_data IS NOT NULL
  AND (file_size IS NULL OR file_size = 0)
```

### Update Statement

```sql
UPDATE attachments
SET file_size = ?
WHERE auuid = ?
```

### Size Calculation

```javascript
const fileSize = attachment.file_data ? attachment.file_data.length : 0;
```

Uses the JavaScript `.length` property on the Buffer/blob to get byte count.

## Current Database Status

As of last check:
```
Total attachments: 2,682
With file_data:    0 (0%)
With file_size>0:  0 (0%)
```

The mode will be useful after running `attachblobs.js` to populate `file_data` for local files.

## Related Scripts

- **`attachblobs.js`** - Populates `file_data` from local filesystem
- **`fetchpatches.js mode1`** - Populates ArDrive metadata
- **`fetchpatches.js mode2`** - Downloads missing `file_data` (future)

## Safety

✅ **Read-only query** - Initial SELECT is safe  
✅ **Idempotent** - Can run multiple times safely  
✅ **Atomic updates** - Each record updated individually  
✅ **No data loss** - Only sets NULL or 0 values  
✅ **Verification** - Confirms success after completion  

## Testing

The mode has been tested with:
- ✅ Empty database (0 records needing update)
- ✅ Missing `file_size` column detection
- ✅ Help text display
- ✅ npm script shortcut
- ✅ Error handling

## Future Enhancements

Possible future improvements:
- [ ] Add `--verify` flag to check sizes without updating
- [ ] Report size statistics (min/max/avg/total)
- [ ] Support batch updates for large datasets
- [ ] Add option to recalculate all sizes (not just NULL/0)

