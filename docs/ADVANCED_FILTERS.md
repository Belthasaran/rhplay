# Advanced Search & Filter System

## Overview

RHTools includes a powerful search and filtering system that allows you to quickly find games using simple text search or advanced attribute-based queries. The filter dropdown provides a clean interface with common filter tags and syntax help.

## Accessing the Filter System

### Opening the Filter Dropdown

**Method 1: Click the Button**
- Click the "Search/Filters" button (located next to "Open Settings")
- The dropdown opens with the search input focused and ready

**Method 2: Keyboard Shortcut**
- Press the `/` (forward slash) key anywhere in the application
- The filter dropdown opens instantly with the search box focused
- This works unless you're already typing in another input field

### Visual Indicators

- **Active Filter Indicator**: When filters are active, the "Search/Filters" button turns blue with a small orange dot
- **Down Arrow**: Indicates the button opens a dropdown
- **Filter Count**: The button highlights to show active filters

## Search Modes

### 1. Simple Text Search

Type any text to search across all game fields:
- Game ID
- Game Name
- Type/Genre
- Author
- Length
- Status
- My Ratings
- Public Rating
- Notes
- JSON Data fields (added, difficulty, etc.)

**Examples:**
- `Kaizo` - Finds all games with "Kaizo" anywhere
- `FuSoYa` - Finds all games by author FuSoYa
- `Cave` - Finds games with "Cave" in name or notes

### 2. Attribute Search

Use the format `<attribute>:<value>` to search specific fields:

**Format:** `attribute:value`

**Supported Attributes:**
- `id:` - Game ID
- `name:` - Game name
- `type:` - Game type/genre
- `author:` - Author name
- `length:` - Game length
- `status:` - Status (Default, In Progress, Finished)
- `rating:` - Public rating (supports operators)
- `notes:` - Your notes
- `added:` - Added date (from JSON data)
- `difficulty:` - Difficulty (from JSON data)
- Any other JSON data field

**Examples:**
```
added:2025          # Games added in 2025
author:Carol        # Games by authors with "Carol" in name
name:World          # Games with "World" in title
type:Kaizo          # Kaizo-type games
difficulty:Hard     # Games marked as Hard difficulty
```

### 3. Rating Filters with Operators

For rating searches, you can use comparison operators:

**Operators:**
- `rating:5` - Exactly rating 5
- `rating:>3` - Rating greater than 3
- `rating:<4` - Rating less than 4
- `rating:>=4` - Rating 4 or higher
- `rating:<=3` - Rating 3 or lower

**Examples:**
```
rating:5       # Perfect 5-star games
rating:>3      # Games rated 4 or 5
rating:>=4     # High-rated games (4-5)
rating:<3      # Lower-rated games
```

### 4. Version Filtering (Placeholder)

Version filtering syntax is reserved for future use:

```
version:1      # Filter specific version 1
version:*      # Filter all versions
```

Currently, the system searches only the highest/latest version of each game by default.

## Common Filter Tags

Click any tag to add it to your search:

### Game Types
- **Kaizo** - Kaizo-style hacks
- **Standard** - Standard difficulty hacks
- **Puzzle** - Puzzle-focused hacks
- **Troll** - Troll/surprise hacks
- **Vanilla** - Vanilla-style hacks

### Time-Based
- **Added: 2025** - Games added in 2025
- **Added: 2024** - Games added in 2024

### Rating-Based
- **Rating > 3** - Highly rated games (4-5 stars)
- **Rating: 5** - Perfect 5-star games
- **Rating: 4** - 4-star games

## Tips & Tricks

### Keyboard Shortcuts
- **`/`** - Open filter dropdown and focus search
- **`Esc`** - Close filter dropdown
- Click outside dropdown to close

### Building Complex Filters
You can combine filters by adding multiple tags:
1. Click a tag (e.g., "Kaizo")
2. Click another tag (e.g., "Rating > 3")
3. Result: Search for "Kaizo Rating > 3"

### Clearing Filters
- Click the "Clear" button in the dropdown
- Or manually delete text from the search box

### Case Insensitive
All searches are case-insensitive:
- `kaizo` = `Kaizo` = `KAIZO`

### Partial Matching
Text searches match partial strings:
- `added:202` matches 2020, 2021, 2022, 2023, 2024, 2025, etc.
- `author:Fu` matches FuSoYa, Fusion, etc.

## Filter Syntax Reference

### Quick Reference Card

| Syntax | Description | Example |
|--------|-------------|---------|
| `text` | Simple search all fields | `Kaizo` |
| `attr:value` | Search specific attribute | `author:FuSoYa` |
| `rating:N` | Exact rating | `rating:5` |
| `rating:>N` | Greater than | `rating:>3` |
| `rating:<N` | Less than | `rating:<4` |
| `rating:>=N` | Greater or equal | `rating:>=4` |
| `rating:<=N` | Less or equal | `rating:<=3` |
| `added:YEAR` | Added in year | `added:2025` |

### Built-in Help

The filter dropdown includes a collapsible "Filter Syntax Guide" with:
- Attribute search format
- Examples of common searches
- Rating filter operators
- Version filtering notes

## How It Works (Technical)

### Search Processing

1. **Query Parsing**: The system detects if the query uses `attribute:value` format
2. **Operator Detection**: For ratings, detects comparison operators (>, <, >=, <=)
3. **Attribute Lookup**: 
   - Checks direct item properties (Id, Name, Type, etc.)
   - Falls back to JSON data attributes (added, difficulty, etc.)
4. **Matching**: Performs case-insensitive substring or operator-based matching

### Default Behavior

- **Version Filtering**: By default, only searches the latest/highest version of each game
- **Hidden Items**: Respects the "Show hidden" toggle
- **Finished Items**: Respects the "Hide finished" toggle
- **Case Sensitivity**: All searches are case-insensitive

### Extensibility

The system is designed to be easily extended:
- Add new common filter tags in the UI
- Support additional attributes from JSON data
- Add new comparison operators if needed
- Implement version-specific filtering in the future

## Use Cases

### Finding Games by Author
```
author:FuSoYa
```

### Finding Recent High-Quality Games
```
added:2024 rating:>4
```

### Finding Kaizo Games Added Recently
```
Kaizo added:2025
```

### Finding Unfinished High-Rated Games
1. Click "Rating > 3" tag
2. Ensure "Hide finished" is NOT checked
3. Games shown will be incomplete high-rated games

### Quick Game Lookup by ID
```
id:12345
```

## Future Enhancements

Planned improvements:
- Multi-condition AND/OR logic (e.g., `kaizo OR puzzle`)
- Regular expression support
- Save favorite filter combinations
- Filter presets/templates
- Version-specific filtering implementation
- Date range filters (e.g., `added:2024-01 to 2024-06`)
- Advanced difficulty filtering with comparisons
- Tag-based filtering if tags are added to games

## Troubleshooting

### Filter Not Working?
- Check spelling of attribute names
- Verify the attribute exists in the data
- Try simple text search first to confirm game exists

### No Results?
- Check "Show hidden" and "Hide finished" toggles
- Try removing operators and using simple text
- Verify the rating/value you're searching for exists

### Dropdown Won't Open?
- Check if you're in an input field (keyboard shortcut won't work)
- Try clicking the button instead
- Refresh the page if needed

### Can't Close Dropdown?
- Press `Esc` key
- Click outside the dropdown
- Click the X button in the header

