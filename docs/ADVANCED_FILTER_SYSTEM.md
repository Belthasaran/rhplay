# Advanced Filter System Documentation

## Overview

RHTools includes a powerful advanced filter system that provides consistent filtering capabilities across the main game list view and random game selection. The system supports both simple text search and sophisticated attribute-based queries with comparison operators and negation.

## Accessing the Filter System

### Main Game List
- **Button**: Click "Search/Filters" button in the toolbar
- **Keyboard**: Press `/` (forward slash) to open filter dropdown
- **Visual Indicator**: Blue button with orange dot when filters are active

### Random Game Selection
- **Location**: "Optional filter pattern" field in Prepare Run modal
- **Placeholder**: Shows example syntax: `rating:>3, author:Panga, Kaizo`

## Filter Syntax

### 1. Simple Text Search

Type any text to search across all game fields:

```
Kaizo          # Finds games with "Kaizo" anywhere
Panga          # Finds games by authors containing "Panga"
Cave           # Finds games with "Cave" in name, notes, etc.
```

**Searched Fields:**
- Game ID, Name, Type, Author, Length, Status
- My Ratings, Public Rating, Notes
- JSON data fields (added, difficulty, etc.)

### 2. Attribute-Based Filtering

Use `attribute:value` format for specific field searches:

```
author:Panga           # Games by authors containing "Panga"
type:Kaizo            # Games of type containing "Kaizo"
rating:>3             # Games with rating above 3
added:2025            # Games added in 2025
```

### 3. Comparison Operators

Use operators for numeric and date comparisons:

```
rating:>3             # Rating greater than 3
rating:<4             # Rating less than 4
rating:>=3.5          # Rating greater than or equal to 3.5
rating:<=4.0          # Rating less than or equal to 4.0
version:>2            # Version greater than 2
added:>2024           # Added after 2024
```

### 4. Negation (Exclusion)

Use `-` prefix to exclude games matching criteria:

```
-author:Panga         # Exclude games by authors containing "Panga"
-type:Kaizo           # Exclude games of type containing "Kaizo"
-rating:<3            # Exclude games with rating below 3
-demo:Yes             # Exclude demo games
-added:2024           # Exclude games added in 2024
-tags:racelevel       # Exclude games with racelevel tag
```

**Negation Examples:**
- `-tags:racelevel` - Excludes any games that contain "racelevel" in their tags
- `-demo:Yes -combinedtype:Kaizo -length:<2 -added:2024` - Excludes games that have demo Yes, contain "kaizo" in combinedtype, have length < 2, or were added in 2024

### 5. Multiple Criteria

Combine multiple filters with spaces (AND logic):

```
author:Panga rating:>3        # Games by Panga with rating > 3
type:Kaizo -demo:Yes          # Kaizo games that are not demos
rating:>3 -added:2024         # High-rated games not added in 2024
-demo:Yes -tags:racelevel     # Non-demo games without racelevel tag
```

## Supported Attributes

### Core Game Properties
| Attribute | Description | Example |
|-----------|-------------|---------|
| `id` | Game ID | `id:11374` |
| `name` | Game name | `name:Dram` |
| `author` | Author name | `author:Panga` |
| `type` | Game type/genre | `type:Kaizo` |
| `length` | Game length | `length:18` |
| `status` | User status | `status:Finished` |
| `rating` | Public rating (from gameversion_stats.rating_value) | `rating:>3` |
| `notes` | User notes | `notes:practice` |
| `version` | Game version | `version:>2` |

### Database Fields (gameversions table)
| Attribute | Description | Example |
|-----------|-------------|---------|
| `demo` | Demo status | `demo:Yes` |
| `featured` | Featured status | `featured:Yes` |
| `combinedtype` | Combined type | `combinedtype:Kaizo` |
| `legacy_type` | Legacy type | `legacy_type:Standard` |
| `gametype` | Game type | `gametype:Kaizo` |
| `difficulty` | Difficulty | `difficulty:Expert` |
| `added` | Added date | `added:2025` |
| `obsoleted` | Obsoleted status | `obsoleted:0` |
| `removed` | Removed status | `removed:0` |
| `moderated` | Moderated status | `moderated:1` |

### JSON Data Fields
| Attribute | Description | Example |
|-----------|-------------|---------|
| `tags` | Game tags | `tags:racelevel` |
| `section` | Game section | `section:Kaizo` |

## Examples

### Basic Filtering
```
Kaizo                           # All Kaizo games
author:Panga                    # Games by Panga
rating:>4                       # Highly rated games
```

### Advanced Filtering
```
type:Kaizo rating:>3            # High-rated Kaizo games
author:Panga -demo:Yes          # Panga games that aren't demos
rating:>3 -added:2024           # High-rated games not from 2024
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

### Random Game Selection Examples
```
# In "Optional filter pattern" field:
rating:>3 author:Panga          # High-rated games by Panga
type:Kaizo -demo:Yes            # Kaizo games excluding demos
added:2025 -tags:racelevel      # 2025 games without racelevel tag
-demo:Yes -featured:No          # Exclude demos and non-featured games
```

## Implementation Details

### File Structure
- **Backend**: `electron/shared-filter-utils.js`
- **Frontend**: `electron/renderer/src/shared-filter-utils.ts`
- **Usage**: `electron/seed-manager.js`, `electron/ipc-handlers.js`, `electron/renderer/src/App.vue`

### Key Functions
- `matchesFilter(game, query)` - Main filtering function
- `getGameAttribute(game, attr)` - Attribute value extraction
- `filterGames(games, query)` - Apply filter to game array
- `countMatchingGames(games, query)` - Count matching games

### Logic Flow
1. Split query into space-separated terms
2. For each term, check for negation (`-` prefix)
3. Parse attribute patterns (`attr:value` or `attr:operator:value`)
4. Handle special cases (rating, version with operators)
5. Apply attribute-specific or general text search
6. Combine results with AND logic (all terms must match)
7. Return boolean match result

## Maintenance Reference

### Adding New Attributes

1. **Update `getGameAttribute()` function** in both files:
```javascript
// Backend (shared-filter-utils.js)
const directProps = {
  // ... existing props
  newattr: game.newattr ?? game.NewAttr,
};

// Frontend (shared-filter-utils.ts)
const directProps: Record<string, any> = {
  // ... existing props
  newattr: item.NewAttr,
};
```

2. **Add to haystack** for general text search:
```javascript
// Backend
const haystack = [
  // ... existing fields
  game.newattr ?? game.NewAttr ?? '',
];

// Frontend
const haystack = [
  // ... existing fields
  item.NewAttr ?? '',
];
```

### Adding Special Operators

For attributes that need numeric/date comparison:

1. **Add operator handling** in `matchesFilter()`:
```javascript
if (attr === 'newattr') {
  const value = game.newattr ?? game.NewAttr ?? 0;
  const targetValue = parseFloat(queryValue);
  
  if (isNaN(targetValue)) return false;
  
  if (operator === '>') return value > targetValue;
  if (operator === '<') return value < targetValue;
  if (operator === '>=') return value >= targetValue;
  if (operator === '<=') return value <= targetValue;
  return value === targetValue;
}
```

### Testing New Features

1. **Test in main game list**: Use Search/Filters dropdown
2. **Test in random selection**: Use "Optional filter pattern" field
3. **Verify consistency**: Same query should work in both places
4. **Test edge cases**: Empty values, invalid operators, special characters

### Database Integration

When adding new database fields:

1. **Update SQL queries** in `seed-manager.js` and `ipc-handlers.js`
2. **Add field to SELECT statements**:
```sql
SELECT gv.gameid, gv.version, gv.name, gv.newfield
FROM gameversions gv
```

3. **Update attribute mapping** in filter utilities
4. **Test with real data** to ensure field values are accessible

## Troubleshooting

### Common Issues

1. **Filter not working**: Check attribute name spelling and case
2. **Negation not working**: Ensure `-` is at start of word/attribute
3. **Operators not working**: Verify attribute supports numeric comparison
4. **Inconsistent results**: Check both frontend and backend implementations

### Debug Tips

1. **Console logging**: Add `console.log()` in `matchesFilter()` to debug
2. **Test individual parts**: Test attribute parsing vs. value matching separately
3. **Check data format**: Verify game objects have expected field names
4. **Compare implementations**: Ensure frontend and backend logic match

## Future Enhancements

### Planned Features
- **Regex support**: `name:/pattern/` for regex matching
- **Boolean operators**: `AND`, `OR`, `NOT` for complex queries
- **Date ranges**: `added:2024-2025` for date ranges
- **Nested attributes**: `json.field:value` for deep JSON access

### Extension Points
- **Custom operators**: Add domain-specific comparison logic
- **Field aliases**: Support multiple names for same field
- **Performance optimization**: Index frequently searched fields
- **Query caching**: Cache parsed queries for repeated use
