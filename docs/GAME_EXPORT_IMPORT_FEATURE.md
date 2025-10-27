# Game Export/Import Feature Implementation

## Overview

Implemented comprehensive game export/import functionality in the RHTools application, replacing the "Ignore" dropdown with a "Manage" dropdown that includes export and import capabilities.

## Changes Made

### 1. UI Changes

**Renamed "Ignore" to "Manage"**
- Updated dropdown button text from "Ignore" to "Manage"
- Added visual separator between existing and new functions
- Maintained existing "Hide checked" and "Unhide checked" functionality

**New Buttons Added**
- **Export Full**: Exports selected games with all associated data
- **Import**: Imports games from JSON files

### 2. Export Functionality

**Export Process**
1. User selects games using checkboxes
2. Clicks "Export Full" button
3. Directory picker opens to select export location
4. System exports comprehensive data for each selected game

**Export Data Structure**
Each exported game creates a `{gameid}_info.json` file containing:

```json
{
  "gameid": "12345",
  "exported_at": "2025-01-27T10:30:00.000Z",
  "databases": {
    "rhdata": {
      "gameversions": [...],
      "gameversion_stats": [...],
      "rhpatches": [...],
      "patchblobs": [...],
      "patchblobs_extended": [...]
    },
    "clientdata": {
      "user_game_annotations": [...]
    },
    "patchbin": {
      "attachments": [...],
      "attachment_files": [...]
    }
  }
}
```

**Attachment Files**
- Binary attachment data saved as separate files
- File names sanitized (alphanumeric, hyphens, underscores only)
- Fallback to UUID if filename is invalid
- Base64 encoded file_data excluded from JSON

### 3. Import Functionality

**Import Process**
1. User clicks "Import" button
2. File picker opens for multiple file selection
3. System validates and imports JSON files first
4. Attachment files processed with hash verification
5. Game list refreshes to show imported data

**Import Validation**
- JSON files must end with `_info.json`
- File structure validation
- Hash verification for attachment files
- Error handling and reporting

### 4. Backend Implementation

**New IPC Handlers**
- `db:games:export` - Export games to directory
- `db:games:import` - Import games from files
- `dialog:selectDirectory` - Directory picker
- `dialog:selectFiles` - File picker

**Database Operations**
- Comprehensive data extraction from all relevant tables
- Proper foreign key relationship handling
- Transaction safety with error recovery
- File system operations with proper error handling

## Technical Details

### Files Modified

**Frontend (Vue.js)**
- `electron/renderer/src/App.vue`
  - Renamed dropdown and functions
  - Added export/import functions
  - Added CSS for separator
  - Updated keyboard event handlers

**Backend (Node.js)**
- `electron/ipc-handlers.js`
  - Added export/import IPC handlers
  - Added dialog handlers
  - Added file sanitization helper
- `electron/preload.js`
  - Added new API methods for export/import
  - Added dialog selection methods

### Database Tables Exported

**rhdata.db**
- `gameversions` - All versions of selected games
- `gameversion_stats` - Statistics for each game
- `rhpatches` - Patch data for games
- `patchblobs` - Binary patch data
- `patchblobs_extended` - Extended patch metadata

**clientdata.db**
- `user_game_annotations` - User-specific game data

**patchbin.db**
- `attachments` - File attachments (metadata only)
- Binary files saved separately with hash verification

### Database Relationships

**Key Relationships**:
- `gameversions.patchblob1_name` → `patchblobs.patchblob1_name`
- `patchblobs.pbuuid` → `patchblobs_extended.pbuuid`
- `patchblobs.pbuuid` → `attachments.pbuuid`

**Export Logic**:
1. Collect all `patchblob1_name` values from gameversions
2. Query patchblobs table using these names
3. Get corresponding `pbuuid` values from patchblobs
4. Query patchblobs_extended and attachments using these UUIDs
5. Export binary attachment data as separate files

### Security Features

**File Name Sanitization**
- Only alphanumeric characters, hyphens, underscores allowed
- Invalid characters replaced with underscores
- Fallback to UUID for completely invalid names

**Hash Verification**
- SHA256 hash verification for imported attachment files
- Prevents data corruption during import
- Ensures file integrity

**Error Handling**
- Comprehensive error catching and reporting
- Graceful degradation for partial failures
- User-friendly error messages

## Usage Examples

### Exporting Games
1. Select games using checkboxes
2. Click "Manage" → "Export Full"
3. Choose export directory
4. System creates `{gameid}_info.json` files and attachment files

### Importing Games
1. Click "Manage" → "Import"
2. Select multiple `{gameid}_info.json` files
3. System validates and imports data
4. Game list refreshes automatically

## Benefits

1. **Complete Data Portability**: All game data can be exported/imported
2. **Cross-Installation Sharing**: Games can be shared between RHTools installations
3. **Backup Capability**: Easy backup of selected games
4. **Data Integrity**: Hash verification ensures data integrity
5. **User-Friendly**: Simple UI with clear feedback

## Future Enhancements

- Batch import progress indicators
- Export format versioning
- Selective field import/export
- Compression for large exports
- Cloud storage integration
