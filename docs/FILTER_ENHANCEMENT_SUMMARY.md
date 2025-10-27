# Advanced Filter System Enhancement Summary

## Overview

Enhanced the RHTools advanced filter system with negation support and additional filterable fields. The system now provides comprehensive filtering capabilities across both the main game list view and random game selection.

## New Features Added

### 1. Negation Support
- **Syntax**: Use `-` prefix before any filter term
- **Logic**: Excludes games matching the criteria
- **Examples**:
  - `-demo:Yes` - Exclude demo games
  - `-tags:racelevel` - Exclude games with racelevel tag
  - `-author:Panga` - Exclude games by Panga
  - `-rating:<3` - Exclude low-rated games

### 2. Additional Filterable Fields
Added support for filtering by these gameversions table fields:
- `demo` - Demo status
- `featured` - Featured status  
- `obsoleted` - Obsoleted status
- `removed` - Removed status
- `moderated` - Moderated status

### 3. Enhanced Query Processing
- **Multi-term support**: Space-separated terms with AND logic
- **Negation handling**: Proper parsing of `-` prefix
- **Numeric operators**: Support for `length` and `added` fields with `>`, `<`, `>=`, `<=`

## Implementation Details

### Files Modified

**Backend Files:**
- `electron/shared-filter-utils.js` - Enhanced with negation and new fields
- `electron/seed-manager.js` - Updated SQL queries to include new fields
- `electron/ipc-handlers.js` - Updated countRandomMatches handler

**Frontend Files:**
- `electron/renderer/src/shared-filter-utils.ts` - Enhanced with negation and new fields
- `electron/renderer/src/App.vue` - Updated placeholder text with negation examples

**Documentation:**
- `docs/ADVANCED_FILTER_SYSTEM.md` - Comprehensive documentation with examples

### Key Functions Enhanced

1. **`matchesFilter()`** - Now handles multi-term queries with negation
2. **`matchesTerm()`** - New function to handle individual terms with negation
3. **`evaluateTerm()`** - New function to evaluate terms without negation
4. **`getGameAttribute()`** - Enhanced with additional field mappings

### SQL Query Updates

**seed-manager.js:**
```sql
SELECT gv.gameid, gv.version, gv.name, gv.combinedtype, gv.difficulty, gv.gametype, gv.legacy_type, gv.author, gv.length, gv.description, gv.publicrating, gv.demo, gv.featured, gv.obsoleted, gv.removed, gv.moderated
```

**ipc-handlers.js:**
```sql
SELECT gameid, version, name, combinedtype, difficulty, gametype, legacy_type, author, length, description, publicrating, demo, featured, obsoleted, removed, moderated
```

## Usage Examples

### Basic Negation
```
-demo:Yes                    # Exclude demo games
-tags:racelevel              # Exclude games with racelevel tag
-author:Panga                # Exclude games by Panga
```

### Complex Queries
```
type:Kaizo rating:>3 -demo:Yes -tags:racelevel
# Kaizo games with rating > 3, not demos, without racelevel tag

author:Panga -combinedtype:Kaizo -length:<2 -added:2024
# Panga games that are not Kaizo, not short (<2 exits), not from 2024

-demo:Yes -tags:racelevel -obsoleted:1
# Exclude demos, racelevel tags, and obsoleted games
```

### Random Game Selection
```
# In "Optional filter pattern" field:
rating:>3 author:Panga          # High-rated games by Panga
type:Kaizo -demo:Yes            # Kaizo games excluding demos
added:2025 -tags:racelevel      # 2025 games without racelevel tag
-demo:Yes -featured:No          # Exclude demos and non-featured games
```

## Benefits

1. **Powerful Exclusion**: Users can now exclude unwanted games with precision
2. **Comprehensive Filtering**: Access to all major gameversions table fields
3. **Consistent Experience**: Same filtering capabilities in main view and random selection
4. **Future-Proof**: Easy to add new fields and features
5. **User-Friendly**: Intuitive syntax with helpful placeholder examples

## Testing Recommendations

1. **Test negation**: Verify `-` prefix works correctly
2. **Test multi-term**: Ensure space-separated terms work with AND logic
3. **Test new fields**: Verify all new filterable fields work
4. **Test consistency**: Same queries should work in main view and random selection
5. **Test edge cases**: Empty values, invalid operators, special characters

## Future Enhancements

- **OR logic**: Support for `|` operator for OR conditions
- **Regex support**: `name:/pattern/` for regex matching
- **Date ranges**: `added:2024-2025` for date ranges
- **Nested attributes**: `json.field:value` for deep JSON access
- **Query caching**: Cache parsed queries for performance
