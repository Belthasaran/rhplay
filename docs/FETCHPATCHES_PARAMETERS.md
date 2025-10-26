# fetchpatches.js - Fetch Parameters Documentation

## Overview

The `fetchpatches.js` script now supports two global parameters to control how it interacts with remote servers:

1. **`--fetchlimit`** - Limits the number of attachments processed per run
2. **`--fetchdelay`** - Adds a delay between processing each attachment

These parameters help avoid server overload and allow incremental processing of large datasets.

## Parameters

### `--fetchlimit=N`

**Purpose:** Limit the number of attachments to process in a single run.

**Default:** `20` attachments

**Valid Range:** Any positive integer (1 or greater)

**Applies To:** All modes that process multiple attachments and query remote servers (mode1, mode2)

**Examples:**
```bash
# Process 3 attachments
node fetchpatches.js mode1 --fetchlimit=3

# Process 100 attachments
node fetchpatches.js mode1 --fetchlimit=100

# Process 1000 attachments (for overnight runs)
node fetchpatches.js mode1 --fetchlimit=1000
```

### `--fetchdelay=MS`

**Purpose:** Add a delay (in milliseconds) between processing each attachment to avoid server overload.

**Default:** `2000ms` (2 seconds)

**Valid Range:** Minimum `500ms` (0.5 seconds), no maximum

**Applies To:** All modes that query remote servers (mode1, mode2)

**Does NOT Apply To:** Modes that only query local database/filesystem

**Examples:**
```bash
# Use 500ms delay (fastest allowed)
node fetchpatches.js mode1 --fetchdelay=500

# Use 1 second delay
node fetchpatches.js mode1 --fetchdelay=1000

# Use 5 second delay (very conservative)
node fetchpatches.js mode1 --fetchdelay=5000
```

## Combining Parameters

Both parameters can be used together:

```bash
# Process 50 attachments with 1 second delay
node fetchpatches.js mode1 --fetchlimit=50 --fetchdelay=1000

# Process 10 attachments with minimum delay
node fetchpatches.js mode1 --fetchlimit=10 --fetchdelay=500
```

## Usage Examples

### Quick Test (3 attachments, fast)
```bash
node fetchpatches.js mode1 --fetchlimit=3 --fetchdelay=500
```
**Time estimate:** ~10 seconds

### Small Batch (20 attachments, default)
```bash
node fetchpatches.js mode1
```
**Time estimate:** ~1 minute

### Medium Batch (100 attachments)
```bash
node fetchpatches.js mode1 --fetchlimit=100 --fetchdelay=1000
```
**Time estimate:** ~5 minutes

### Large Batch (500 attachments)
```bash
node fetchpatches.js mode1 --fetchlimit=500 --fetchdelay=2000
```
**Time estimate:** ~20-30 minutes

### Overnight Run (2000+ attachments)
```bash
node fetchpatches.js mode1 --fetchlimit=2000 --fetchdelay=2000
```
**Time estimate:** ~2-3 hours

## Validation

### Invalid `--fetchlimit`

```bash
$ node fetchpatches.js mode1 --fetchlimit=0
Invalid fetchlimit value: 0
fetchlimit must be a positive integer

$ node fetchpatches.js mode1 --fetchlimit=abc
Invalid fetchlimit value: abc
fetchlimit must be a positive integer
```

### Invalid `--fetchdelay`

```bash
$ node fetchpatches.js mode1 --fetchdelay=300
Invalid fetchdelay value: 300
fetchdelay must be at least 500ms

$ node fetchpatches.js mode1 --fetchdelay=-1000
Invalid fetchdelay value: -1000
fetchdelay must be at least 500ms
```

## Output

The script displays configuration at the start:

```
======================================================================
MODE 1: Populate ArDrive Metadata
======================================================================

Configuration:
  Fetch Limit: 3 attachments per run
  Fetch Delay: 500ms between each attachment

Initializing ArDrive client...
```

During processing, it shows progress and remaining count:

```
[1/3] Matched: pblob_10034_f2bdf6e17b (2 remaining)
  ArDrive Path: /SMWRH/pblobs/pblob_10034_f2bdf6e17b
  File ID: 6ef6f04b-7f43-45c4-8dfd-10490120b98d
  Attachment: pblob_10034_f2bdf6e17b (auuid: 630967c7-9ab0-4b5c-be09-6d9147cab912)
  Downloading file for verification...
  Downloaded 225856 bytes
    ✓ Verified with SHA-256: ee0c491086615e31dce484514f13131fa7fcdfa558ecdd26bcb9bdfb26e7f466
  ✓ Updated database record
  ⏱ Waiting 500ms before next download...
```

When the limit is reached:

```
⚠ Reached fetch limit of 3 attachments
  Stopping to avoid server overload
  Run the script again to process more attachments
```

Final summary:

```
Summary:
  Total attachments needing metadata: 2639
  Attachments processed this run:     3
  Files matched by name:              3
  Files verified by hash:             3
  Records updated:                    3
  Failed:                             0
  Still missing metadata:             2636

💡 Tip: Run the script again to process more attachments
   2636 attachments still need metadata
```

## Incremental Processing Strategy

For large datasets (2000+ attachments), use incremental processing:

1. **Start with small test run:**
   ```bash
   node fetchpatches.js mode1 --fetchlimit=3 --fetchdelay=500
   ```

2. **Verify results in database:**
   ```bash
   sqlite3 electron/patchbin.db "SELECT COUNT(*) FROM attachments WHERE arweave_file_id IS NOT NULL;"
   ```

3. **Run medium batches:**
   ```bash
   node fetchpatches.js mode1 --fetchlimit=50
   ```

4. **Repeat until complete:**
   ```bash
   # Check remaining
   sqlite3 electron/patchbin.db "SELECT COUNT(*) FROM attachments WHERE arweave_file_id IS NULL;"
   
   # Run again
   node fetchpatches.js mode1 --fetchlimit=50
   ```

5. **For final cleanup (if needed):**
   ```bash
   node fetchpatches.js mode1 --fetchlimit=9999 --fetchdelay=2000
   ```

## Performance Considerations

### Network Impact

- **Fetch Delay:** Controls request rate to ArDrive/Arweave
- **Recommended minimum:** 500ms (respects server resources)
- **Default:** 2000ms (conservative, reliable)

### Time Estimates

Factors affecting runtime:
- File size (download time)
- Network speed
- Arweave network load
- Fetch delay setting

**Approximate times per attachment:**
- Small files (<100KB): 2-5 seconds
- Medium files (100KB-500KB): 5-10 seconds
- Large files (>500KB): 10-30 seconds

**Plus:** Fetch delay (default 2 seconds between each)

### Current Database State

As of last update:
```
Total attachments: 2,682
With ArDrive metadata: 46 (1.7%)
Missing metadata: 2,636 (98.3%)
```

**Estimated time to complete all:**
- At default rate (20/run, 2s delay): ~2.5 hours (133 runs)
- At fast rate (100/run, 1s delay): ~30-45 minutes (27 runs)
- At overnight rate (1000/run, 2s delay): ~3-5 hours (3 runs)

## Best Practices

1. **Start small** - Test with `--fetchlimit=3` first
2. **Monitor progress** - Check database after each run
3. **Be respectful** - Don't use delays less than 1000ms for large batches
4. **Use batches** - Multiple small runs are safer than one huge run
5. **Check failures** - Review "Failed" count in summary
6. **Verify data** - Spot-check updated records in database

## Troubleshooting

### Script stops early

If the script stops before reaching the limit, check:
- Network connectivity
- ArDrive availability
- Hash mismatches (shown in output)

### High failure rate

If many files fail verification:
- Check if file names match but content differs
- Verify database hashes are correct
- Review ArDrive folder structure

### Database not updating

Ensure:
- Script shows "✓ Updated database record"
- No database lock errors
- `patchbin.db` has write permissions

## Related Documentation

- `FETCHPATCHES_README.md` - Main documentation
- `FETCHPATCHES_SUMMARY.md` - Implementation details
- `electron/sql/patchbin.sql` - Database schema

