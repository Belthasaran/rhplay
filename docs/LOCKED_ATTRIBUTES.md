# Locked Attributes Feature

## Overview
The **Locked Attributes** feature allows certain fields in the `gameversions` table to be preserved across version updates, preventing them from being overwritten by incoming JSON data. This is essential for curator-managed fields that should persist even when new versions of a game are imported.

## Purpose
When loading new JSON data for an existing game, the system normally creates a new version and populates all fields from the JSON. However, some fields need to remain stable across versions because they represent manual curation work that should not be lost.

## How It Works

### 1. Definition
Locked attributes are defined in the `LOCKED_ATTRIBUTES` constant in `loaddata.js`:

```javascript
const LOCKED_ATTRIBUTES = [
  'legacy_type'  // User-curated type classification that persists across versions
];
```

### 2. Behavior
When inserting a new version of a gameversion record:

1. **Check for previous version**: The script looks for the most recent version of the same `gameid`
2. **Copy locked values**: If found, it copies the values of all locked attributes from the previous version
3. **Override JSON data**: These locked values override any values from the incoming JSON data
4. **Console notification**: The script logs which locked attributes are being preserved

### 3. Example Workflow

```
Initial State:
  gameid: 38660, version: 1, legacy_type: NULL

User manually sets:
  UPDATE gameversions SET legacy_type = 'Classic Kaizo' WHERE gameid = '38660' AND version = 1;

New JSON arrives for gameid 38660:
  - Script creates version 2
  - Detects previous version has legacy_type = 'Classic Kaizo'
  - Copies legacy_type to new version
  - Logs: "ℹ️  Preserving locked attribute: legacy_type = 'Classic Kaizo'"

Result:
  gameid: 38660, version: 2, legacy_type: 'Classic Kaizo' (preserved!)
```

## Current Locked Attributes

### legacy_type (VARCHAR 255)
- **Purpose**: User-curated type classification that persists across versions
- **Use Case**: Curators can manually classify games with custom type labels that won't be overwritten by external data updates
- **Example Values**: "Classic Kaizo", "Historical", "Competition Entry", "Tool-Assisted Showcase"

## Adding New Locked Attributes

To add a new locked attribute:

1. **Add to database schema**: Ensure the column exists in the `gameversions` table
2. **Add to LOCKED_ATTRIBUTES array** in `loaddata.js`:
   ```javascript
   const LOCKED_ATTRIBUTES = [
     'legacy_type',
     'curator_notes',  // New locked attribute
     'verified_status'  // Another new locked attribute
   ];
   ```
3. **Add to GAMEVERSION_FIELDS** if not already present
4. **Document** the new attribute's purpose

## Behavior Details

### When Locked Attributes Are Applied
- ✅ When creating a new version of an existing game
- ✅ When the previous version has a non-NULL value for the locked attribute
- ❌ When creating version 1 of a new game (no previous version)
- ❌ When the locked attribute is NULL in the previous version

### Value Checking
A locked attribute is only copied if:
- Previous version exists (`prevVersion !== null`)
- The attribute value is not `undefined`
- The attribute value is not `null`

### Override Priority
```
Priority (highest to lowest):
1. Locked value from previous version (if exists)
2. Value from incoming JSON data
3. NULL/undefined (if neither exists)
```

## Console Output

When locked attributes are preserved, the script outputs:
```
[1/1] Processing record...
  ℹ️  Preserving locked attribute: legacy_type = "Classic Kaizo"
Inserted gameversion: 38660 - The Stinky Black Banana Peel (gvuuid: ...)
```

## SQL Examples

### Setting a Locked Attribute Manually
```sql
-- Set legacy_type for latest version of a game
UPDATE gameversions 
SET legacy_type = 'Classic Kaizo'
WHERE gameid = '38660' 
  AND version = (SELECT MAX(version) FROM gameversions WHERE gameid = '38660');
```

### Viewing Locked Attributes
```sql
-- See which games have manual legacy_type classifications
SELECT gameid, version, name, legacy_type, combinedtype
FROM gameversions
WHERE legacy_type IS NOT NULL
ORDER BY gameid, version;
```

### Checking Locked Attribute Persistence
```sql
-- Verify legacy_type persists across versions
SELECT gameid, version, legacy_type, gvimport_time
FROM gameversions
WHERE gameid = '38660'
ORDER BY version;
```

## Use Cases

### 1. Historical Classification
Curators can mark games with historical significance:
```sql
UPDATE gameversions SET legacy_type = 'Historical - First Kaizo Hack'
WHERE gameid = '1234' AND version = (SELECT MAX(version) FROM gameversions WHERE gameid = '1234');
```

### 2. Competition Entries
Mark games that were competition entries:
```sql
UPDATE gameversions SET legacy_type = 'VLDC9 Competition Entry'
WHERE gameid = '5678';
```

### 3. Special Categories
Create custom categories that external data doesn't provide:
```sql
UPDATE gameversions SET legacy_type = 'Tool-Assisted Showcase'
WHERE gameid IN (SELECT gameid FROM gameversions WHERE tags LIKE '%tool_assisted%');
```

## Integration with Other Scripts

### loaddata.js
- ✅ **Fully implemented**: Automatically preserves locked attributes when creating new versions

### Other Scripts (Future)
Other scripts that insert gameversion records should also respect locked attributes:

```javascript
// Recommended pattern for other scripts
const LOCKED_ATTRIBUTES = ['legacy_type'];

function insertNewVersion(db, gameid, newData) {
  // Get previous version
  const prevVersion = db.prepare(
    'SELECT * FROM gameversions WHERE gameid = ? ORDER BY version DESC LIMIT 1'
  ).get(gameid);
  
  // Copy locked attributes
  const lockedValues = {};
  if (prevVersion) {
    LOCKED_ATTRIBUTES.forEach(attr => {
      if (prevVersion[attr] !== undefined && prevVersion[attr] !== null) {
        lockedValues[attr] = prevVersion[attr];
      }
    });
  }
  
  // Merge locked values with new data
  const finalData = { ...newData, ...lockedValues };
  
  // Insert...
}
```

## Best Practices

### For Curators
1. **Set locked attributes on the latest version**: Always update the most recent version
2. **Document your classifications**: Keep notes on why specific values were set
3. **Be consistent**: Use standardized values across similar games
4. **Check after imports**: Verify locked attributes persist after loading new data

### For Developers
1. **Don't add lightly**: Only lock attributes that truly need manual curation
2. **Document new locked attributes**: Explain purpose and use cases
3. **Test preservation**: Verify locked attributes are copied correctly
4. **Consider impact**: Locked attributes cannot be updated via JSON imports

## Limitations

### What Locked Attributes DON'T Do
- ❌ Don't prevent manual SQL updates (curators can still change them)
- ❌ Don't apply to first version of a game (no previous version to copy from)
- ❌ Don't prevent deletion or obsolescence
- ❌ Don't lock metadata like timestamps or UUIDs

### When NOT to Use Locked Attributes
- For data that should reflect current JSON source (use computed fields instead)
- For version-specific information (like patch hashes)
- For automatically tracked data (like import timestamps)
- For data that changes with every version

## Troubleshooting

### Locked Attribute Not Preserved
**Check:**
1. Is the attribute in the `LOCKED_ATTRIBUTES` array?
2. Does the previous version have a non-NULL value?
3. Are you creating version 2 or higher? (version 1 has no previous version)
4. Check console output for "Preserving locked attribute" message

### Locked Attribute Unexpectedly NULL
**Possible causes:**
1. Previous version had NULL value (nothing to copy)
2. Manual SQL update set it to NULL
3. Database was restored from backup without that field
4. First version of game (expected behavior)

### Locked Attribute Not Showing in Console
**Check:**
1. Previous version exists
2. Previous version has non-NULL value
3. Script is loaddata.js (not another script)
4. Console output is not filtered/redirected

## Version History

### v1.3 (2025-01-10) - Current
- ✅ Implemented locked attributes feature
- ✅ Added `legacy_type` as first locked attribute
- ✅ Console logging for preserved attributes
- ✅ Documentation created

### Future Enhancements
- [ ] Web UI for managing locked attributes
- [ ] Bulk operations for setting locked attributes
- [ ] Audit log for locked attribute changes
- [ ] Validation rules for locked attribute values
- [ ] Export/import of locked attribute definitions

## Related Documentation
- `docs/GAMEVERSIONS_TABLE_SCHEMA.md` - Complete schema reference
- `loaddata.js` - Implementation details
- `SCHEMA_UPDATE_SUMMARY.md` - Schema evolution history

## Summary
Locked attributes provide a powerful way to preserve curator-managed data across automatic imports, ensuring that manual classification work is never lost while still allowing the database to be updated with fresh data from external sources.

