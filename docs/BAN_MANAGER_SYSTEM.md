# GameVersion Ban Manager System Documentation

## Overview

The GameVersion Ban Manager (`electron/gameversion-banmanager.js`) provides a flexible system for banning games from specific actions (senses) within the application. Bans can be hardcoded in the ban manager file or stored dynamically in the `gameversion_banlist` database table.

## Table of Contents

1. [System Architecture](#system-architecture)
2. [Ban Entry Structure](#ban-entry-structure)
3. [Match Criteria](#match-criteria)
4. [Pattern Matching](#pattern-matching)
5. [Senses (Actions)](#senses-actions)
6. [Required Acknowledgments](#required-acknowledgments)
7. [Soft vs Hard Bans](#soft-vs-hard-bans)
8. [Integration Points](#integration-points)
9. [API Reference](#api-reference)
10. [Usage Examples](#usage-examples)

---

## System Architecture

### Ban Sources

1. **Hardcoded Bans** (`HARDCODED_BANS` array in `gameversion-banmanager.js`)
   - Always evaluated first (sequence_no = 0)
   - Permanently embedded in code
   - No `banuuid` required
   - Used for critical/system-level bans

2. **Database Bans** (`gameversion_banlist` table in `rhdata.db`)
   - Evaluated after hardcoded bans
   - Ordered by `sequence_no` (lower numbers first)
   - Can be added/updated/deleted dynamically
   - Requires `banuuid` (UUID v4)

### Evaluation Order

1. Hardcoded bans (all active, sequence_no = 0)
2. Database bans sorted by `sequence_no` ASC, then `created_at` ASC
3. First matching ban for a game + action combination is used
4. Multiple bans can match the same game, but only the first (lowest sequence_no) applies

### Caching

- Bans are cached for 1 minute to reduce database queries
- Cache is invalidated when bans are added/updated/deleted
- Call `invalidateCache()` after modifying bans

---

## Ban Entry Structure

### Required Fields

- **`match_column`** (TEXT, NOT NULL): Field to match against
  - Valid values: `'gameid'`, `'gvuuid'`, `'author'`, `'tags'`, `'url'`, `'name'`
  
- **`match_pattern`** (TEXT, NOT NULL): Pattern to match
  - See [Pattern Matching](#pattern-matching) section for formats
  
- **`sense`** (TEXT, NOT NULL): Comma-separated list of banned actions
  - See [Senses (Actions)](#senses-actions) section for valid values
  - Supports wildcards (e.g., `"run_random_*"`)

- **`active`** (INTEGER, NOT NULL): Whether ban is active
  - `1` = active, `0` = inactive
  - Only active bans are evaluated

### Optional Fields

- **`banuuid`** (TEXT): Unique UUID (required for database bans, not for hardcoded)
- **`gameid`** (TEXT): Game ID if match is based on gameid
- **`required_acknowledgments`** (TEXT): Comma-separated list of required acknowledgments
  - See [Required Acknowledgments](#required-acknowledgments) section
- **`starting_at`** (TEXT): ISO timestamp when ban becomes active (null = immediately active)
- **`reason`** (TEXT): Internal reason/documentation for the ban
- **`warningtext`** (TEXT): Warning message to display to users for soft bans
- **`sequence_no`** (INTEGER): Evaluation order (default: 0)
  - Lower numbers evaluated first
  - Hardcoded bans always have sequence_no = 0

---

## Match Criteria

Bans can match games based on different fields:

### `gameid`
Matches the game's unique identifier.
- **Example pattern**: `"exact:12345"` or `"12345,67890"` (comma-separated list)

### `gvuuid`
Matches the game version UUID.
- **Example pattern**: `"exact:550e8400-e29b-41d4-a716-446655440000"`

### `author`
Matches the game's author field.
- **Example pattern**: `"substring:Panga"` or `"exact:Author Name"`

### `tags`
Matches against game tags (comma-separated or JSON array).
- **Example pattern**: `"substring:kaizo"` or `"exact:kaizo,troll"`

### `url`
Matches the game's URL or download URL.
- **Example pattern**: `"substring:example.com"` or `"regex:/^https:\/\/.*\.com$/i"`

### `name`
Matches the game's name/title.
- **Example pattern**: `"substring:Super Mario"` or `"exact:Game Title"`

---

## Pattern Matching

All pattern matching is **case-insensitive**.

### Comma-Separated List
Matches if the value equals any item in the list.
```
Pattern: "a,b,c,d"
Matches: "a", "b", "c", or "d"
Example: match_pattern = "12345,67890,99999"
```

### Exact Match
Exact string match (case-insensitive).
```
Pattern: "exact:text here"
Matches: "text here" (exact match only)
Example: match_pattern = "exact:Super Mario World"
```

### Substring Match
Matches if the value contains the substring.
```
Pattern: "substring:text here"
Matches: Any string containing "text here"
Example: match_pattern = "substring:Panga"
```

### Regex Match
Regular expression pattern match.
```
Pattern: "regex:/^pattern$/"
Matches: Strings matching the regex pattern
Example: match_pattern = "regex:/^https:\/\/.*\.com$/i"
Note: Leading/trailing slashes are optional and will be removed
```

---

## Senses (Actions)

Senses define which application actions are banned. Multiple senses can be specified in a comma-separated list. Wildcards are supported (e.g., `"run_random_*"` matches both `run_random_game` and `run_random_stage`).

### Image-Related Senses

#### `image_title`
- **Type**: Hard ban
- **Computed Column**: `image_title` = 1
- **Behavior**: Do not display title image or thumbnail image for game in list views
- **Note**: Does NOT block viewing images by opening gallery in game details
- **Integration Point**: Tiles mode, list mode thumbnail display

#### `image_preview`
- **Type**: Hard ban
- **Computed Column**: `image_preview` = 1
- **Behavior**: Do not display previews of game's images
- **Integration Point**: Image preview/thumbnail generation

#### `image_show_soft`
- **Type**: Soft ban
- **Computed Column**: `image_show_soft` = 1
- **Behavior**: Warn before showing game's image gallery
- **Integration Point**: Screenshot gallery modal - show warning before opening
- **Required**: User acknowledgment before proceeding

#### `image_show_hard`
- **Type**: Hard ban
- **Computed Column**: `image_show_hard` = 1
- **Behavior**: Deny access to view game's image gallery entirely
- **Integration Point**: Screenshot gallery modal - block access completely

### Random Selection Senses

#### `check_random`
- **Type**: Hard ban
- **Computed Column**: `check_random` = 1
- **Behavior**: Make Select > Check random function exclude game from selection
- **Integration Point**: "Check random" button in Select dropdown

#### `run_random_game`
- **Type**: Hard ban
- **Computed Column**: `run_random_game` = 1
- **Behavior**: Make random game filters in Prepare Run exclude this gameversion
- **Integration Point**: Random game selection in Prepare Run dialog
- **Note**: Game will not appear in random game selection results

#### `run_random_stage`
- **Type**: Hard ban
- **Computed Column**: `run_random_stage` = 1
- **Behavior**: Make random game stage filters in Prepare Run exclude all stages from this game
- **Integration Point**: Random stage selection in Prepare Run dialog
- **Note**: All stages from this game are excluded from random stage selection

### Manual Run Selection Senses

#### `run_pick_game`
- **Type**: Hard ban
- **Computed Column**: `run_pick_game` = 1
- **Behavior**: Make manually adding this game with "Add to Run" button disallowed
- **Integration Point**: "Add to Run" button - should fail with error message if game is checked
- **Error Message**: Should display ban reason or default message

#### `run_pick_stage`
- **Type**: Hard ban
- **Computed Column**: `run_pick_stage` = 1
- **Behavior**: Prevent the user from adding any individual stages of this game in the View Game Stages dialog
- **Integration Point**: Game Stages dialog - disable stage selection/adding
- **Note**: Blocks all stages from this game, not just specific stages

### Details View Senses

#### `details_stages_soft`
- **Type**: Soft ban
- **Computed Column**: `details_stages_soft` = 1
- **Behavior**: Clicking "View Game Stages" on this game will require confirming a warning message
- **Integration Point**: "View Game Stages" button/action - show warning dialog before opening
- **Required**: User acknowledgment before proceeding

#### `details_stages_hard`
- **Type**: Hard ban
- **Computed Column**: `details_stages_hard` = 1
- **Behavior**: Clicking "View Game Stages" on this game will display an alert that the game is blocked from this app function
- **Integration Point**: "View Game Stages" button/action - show blocking alert, do not open dialog

#### `details_soft`
- **Type**: Soft ban
- **Computed Column**: `details_soft` = 1
- **Behavior**: Selecting just this game in the main view, and its details will be hidden behind a warning panel. The game details panel is limited to showing only a few basic details (gameid, name, author, and ban status) until the user acknowledges the warning.
- **Integration Point**: Game details panel - show warning overlay, require acknowledgment to view full details
- **Required**: User acknowledgment before showing full details
- **Note**: The gameid detail and ban attributes will always be accessible, so the game details panel is mostly masked but not completely blocked

#### `details_hard`
- **Type**: Hard ban
- **Computed Column**: `details_hard` = 1
- **Behavior**: Selecting just this game in main view, then its details pages will be limited to showing only a few basic details (gameid, name, author, and ban status). Full details cannot be displayed and cannot be overridden.
- **Integration Point**: Game details panel - show blocking message, display only basic details (gameid, name, author, ban status)
- **Note**: The gameid detail and ban attributes will always be accessible, so the game details panel is mostly masked but not completely blocked

### List Display Senses

#### `list_title`
- **Type**: Hard ban
- **Computed Column**: `list_title` = 1
- **Behavior**: Text of the game's title will display as `<censored>` in the main game's list
- **Integration Point**: Game list table/tiles - replace title with `<censored>`
- **Note**: Game still appears in list, but title is censored

#### `list_any`
- **Type**: Hard ban
- **Computed Column**: `list_any` = 1
- **Behavior**: The game will not show up in the main list view at all
- **Integration Point**: Game list filtering - exclude game from all list queries
- **Note**: Most restrictive list sense - completely hides game from main view

### Start/Run Senses

#### `start_multi`
- **Type**: Hard ban
- **Computed Column**: `start_multi` = 1
- **Behavior**: Prevents selecting the game with other games when clicking the "Start" or "+Patch" button. The game can only be started individually.
- **Integration Point**: Start button, +Patch button - check if multiple games selected, block if this game is included
- **Note**: Game can still be started alone, but not with other games

#### `start_patchplus`
- **Type**: Hard ban
- **Computed Column**: `start_patchplus` = 1
- **Behavior**: Prevents selecting the game when using the +Patch function
- **Integration Point**: +Patch button - block if this game is selected
- **Note**: Game cannot be used with +Patch, but can be started normally

#### `start_single`
- **Type**: Hard ban
- **Computed Column**: `start_single` = 1
- **Behavior**: Prevents using the "Start" button when the game is selected at all. This also blocks access to test stages on the matching games' gameid from the Select Game Stage dialog in view mode.
- **Integration Point**: 
  - Start button - block if this game is selected
  - Game Stages dialog (view mode) - disable "Test Stage" action for all stages from this game
- **Note**: Most restrictive start sense - completely blocks starting the game

### Wildcard Senses

Senses support wildcards for matching multiple related actions:

- **`run_random_*`**: Matches both `run_random_game` and `run_random_stage`
- **`image_*`**: Matches all image-related senses
- **`details_*`**: Matches all details-related senses
- **`start_*`**: Matches all start-related senses

---

## Required Acknowledgments

Required acknowledgments are used for **soft ban** senses. They represent content warnings that users must acknowledge before accessing banned content.

### Acknowledgment Values

All acknowledgment values are case-sensitive and must match exactly:

#### `Photosensitivity_Triggers`
- **Description**: Content may contain flashing lights, rapid color changes, or other visual effects that could trigger photosensitive epilepsy or seizures
- **Global Allowed**: Yes (unless suffixed with `*`)
- **Use Case**: Games with rapid screen flashes, strobe effects, or intense visual patterns

#### `Suggestive_Content`
- **Description**: Content contains suggestive themes, innuendo, or mild sexual references
- **Global Allowed**: Yes (unless suffixed with `*`)
- **Use Case**: Games with suggestive imagery, themes, or dialogue

#### `Crude_Content_or_Language`
- **Description**: Content contains crude humor, profanity, or offensive language
- **Global Allowed**: Yes (unless suffixed with `*`)
- **Use Case**: Games with profanity, crude jokes, or offensive language

#### `Violence`
- **Description**: Content contains depictions of violence, combat, or graphic imagery
- **Global Allowed**: Yes (unless suffixed with `*`)
- **Use Case**: Games with violent content, combat, or graphic imagery

#### `Mature_Content`
- **Description**: Content is intended for mature audiences and may contain adult themes
- **Global Allowed**: Yes (unless suffixed with `*`)
- **Use Case**: General mature content warning

#### `Sexual_Content`
- **Description**: Content contains sexual themes, imagery, or explicit content
- **Global Allowed**: Yes (unless suffixed with `*`)
- **Use Case**: Games with sexual content or explicit imagery

#### `Extreme_Frustration_Warning`
- **Description**: Game contains trolls or extreme time-consuming or frustrating content even for players of a grandmaster+  skill level
- **Global Allowed**: Yes (unless suffixed with `*`)
- **Use Case**: Games with extreme player frustration concerns (warning level that the game's difficulty markers are not an adequate caution).

#### `Extreme_Difficulty`
- **Description**: Contains difficulty extremely higher than expected for its type/rating
- **Global Allowed**: Yes (unless suffixed with `*`)
- **Use Case**: Games with extreme difficulty concerns

### Acknowledgment Format

- **Comma-separated list**: Multiple acknowledgments can be required
  - Example: `"Mature_Content,Violence,Suggestive_Content"`
  
- **Asterisk suffix (`*`)**: Indicates acknowledgment is always required, even if user has global preference to skip
  - Example: `"Mature_Content*"` - Always requires confirmation
  - Example: `"Mature_Content"` - Can be saved globally if user prefers
  
- **Mixed format**: Some can have `*`, some can be global
  - Example: `"Mature_Content*,Violence,Suggestive_Content*"`

### Global Acknowledgments

Users can set preferences to automatically acknowledge certain warnings for all games. However:

- **Acknowledgment with `*` suffix**: Always requires manual confirmation, even if global preference is set
- **Acknowledgment without `*`**: Can be saved globally, user won't be prompted again

### Warning Message Format

When a soft ban requires acknowledgment, display:

```
Some elements of this game are banned from default usage in the app, but you can certify you are of legal age above 18 and confirm warnings:

[Required Acknowledgments List]

[Warning Text from ban.warningtext, or default message]

[Checkboxes for each acknowledgment]
[Checkbox: "Remember this choice for all games" (only if no * suffixed acknowledgments)]
[OK] [Cancel]
```

**Default Warning Text** (if `warningtext` is not provided):
```
The action [sense name] is deemed hazardous or sensitive on this specific game. Are you sure you want to continue?
```

---

## Soft vs Hard Bans

### Soft Bans

**Senses ending with `_soft`**:
- `image_show_soft`
- `details_stages_soft`
- `details_soft`

**Behavior**:
- Display warning message with required acknowledgments
- Allow user to proceed after acknowledgment
- Can be saved globally (unless acknowledgment has `*` suffix)
- Use `ban.warningtext` or default message

**Integration Pattern**:
```javascript
const ban = banManager.getBanDetails(gameid, 'details_soft', gameData);
if (ban) {
  // Show warning dialog with ban.warningtext
  // Check ban.required_acknowledgments
  // Require user confirmation
  // If confirmed, proceed with action
}
```

### Hard Bans

**All other senses** (do not end with `_soft`):
- `image_title`, `image_preview`, `image_show_hard`
- `check_random`, `run_random_game`, `run_random_stage`
- `run_pick_game`, `run_pick_stage`
- `details_stages_hard`, `details_hard`
- `list_title`, `list_any`
- `start_multi`, `start_patchplus`, `start_single`

**Behavior**:
- Completely block the action
- Display error/blocking message
- Do not allow user to proceed
- No acknowledgment possible

**Integration Pattern**:
```javascript
if (banManager.isGameBanned(gameid, 'list_any', gameData)) {
  // Exclude game from list query
  // Do not display game at all
}
```

---

## Integration Points

### 1. Game List Display

**Location**: `electron/renderer/src/App.vue` - Main game list

**Checks Needed**:
- `list_any`: Exclude game from list entirely
- `list_title`: Replace title with `<censored>`
- `image_title`: Hide thumbnail in tiles/list mode

**Implementation**:
```javascript
// In filteredItems computed property
const filtered = items.filter(game => {
  if (banManager.isGameBanned(game.Id, 'list_any', game)) {
    return false; // Exclude from list
  }
  return true;
});

// In display logic
const displayTitle = banManager.isGameBanned(game.Id, 'list_title', game)
  ? '<censored>'
  : game.Name;
```

### 2. Random Selection

**Location**: `electron/seed-manager.js` - Random game/stage selection

**Checks Needed**:
- `check_random`: Exclude from "Check random"
- `run_random_game`: Exclude from random game selection
- `run_random_stage`: Exclude all stages from this game

**Implementation**:
```javascript
// In selectRandomGame
const availableGames = games.filter(game => {
  return !banManager.isGameBanned(game.gameid, 'run_random_game', game);
});

// In selectRandomStage
const availableStages = stages.filter(stage => {
  return !banManager.isGameBanned(stage.gameid, 'run_random_stage', { gameid: stage.gameid });
});
```

### 3. Add to Run

**Location**: `electron/renderer/src/App.vue` - "Add to Run" button

**Checks Needed**:
- `run_pick_game`: Block adding game to run
- `start_multi`: Block if multiple games selected
- `start_patchplus`: Block if using +Patch
- `start_single`: Block starting game entirely

**Implementation**:
```javascript
async function addGameToRun(game) {
  // Check for bans
  if (banManager.isGameBanned(game.Id, 'run_pick_game', game)) {
    const ban = banManager.getBanDetails(game.Id, 'run_pick_game', game);
    await showAlert(ban?.reason || 'This game cannot be added to a run.', 'Game Banned');
    return;
  }
  
  // Check start_single
  if (banManager.isGameBanned(game.Id, 'start_single', game)) {
    await showAlert('This game cannot be started.', 'Game Banned');
    return;
  }
  
  // Check start_multi if multiple games selected
  if (selectedIds.size > 1) {
    for (const gameid of selectedIds) {
      if (banManager.isGameBanned(gameid, 'start_multi', gameData)) {
        await showAlert('One or more selected games cannot be started together.', 'Game Banned');
        return;
      }
    }
  }
  
  // Proceed with adding to run
}
```

### 4. Game Details Panel

**Location**: `electron/renderer/src/App.vue` - Game details inspector

**Checks Needed**:
- `details_hard`: Block displaying details entirely
- `details_soft`: Show warning overlay, require acknowledgment
- `image_show_hard`: Block screenshot gallery
- `image_show_soft`: Show warning before opening gallery

**Implementation**:
```javascript
// When game is selected
const banDetails = banManager.getBanDetails(selectedGame.Id, 'details_soft', selectedGame);
if (banDetails) {
  // Show warning overlay
  // Require acknowledgment
  // Only show details after acknowledgment
}

// For screenshot gallery
if (banManager.isGameBanned(gameId, 'image_show_hard', gameData)) {
  await showAlert('Image gallery is not available for this game.', 'Access Denied');
  return;
}

const banDetails = banManager.getBanDetails(gameId, 'image_show_soft', gameData);
if (banDetails) {
  // Show warning with required acknowledgments
  // Require confirmation before opening gallery
}
```

### 5. Game Stages Dialog

**Location**: `electron/renderer/src/components/GameStagesDialog.vue`

**Checks Needed**:
- `details_stages_hard`: Block opening dialog
- `details_stages_soft`: Show warning before opening
- `run_pick_stage`: Disable stage selection/adding
- `start_single`: Disable "Test Stage" action in view mode

**Implementation**:
```javascript
async function openGameStagesDialog(game) {
  // Check hard ban
  if (banManager.isGameBanned(game.Id, 'details_stages_hard', game)) {
    const ban = banManager.getBanDetails(game.Id, 'details_stages_hard', game);
    await showAlert(ban?.reason || 'Game stages are not available for this game.', 'Access Denied');
    return;
  }
  
  // Check soft ban
  const banDetails = banManager.getBanDetails(game.Id, 'details_stages_soft', game);
  if (banDetails) {
    const confirmed = await showAcknowledgmentDialog(banDetails);
    if (!confirmed) return;
  }
  
  // Open dialog
}

// In stage selection
function canSelectStage(stage) {
  if (banManager.isGameBanned(stage.gameid, 'run_pick_stage', { gameid: stage.gameid })) {
    return false;
  }
  return true;
}

// In test stage action
function canTestStage(stage) {
  if (banManager.isGameBanned(stage.gameid, 'start_single', { gameid: stage.gameid })) {
    return false;
  }
  return true;
}
```

### 6. Thumbnail/Image Display

**Location**: `electron/renderer/src/App.vue` - Tiles mode, thumbnail loading

**Checks Needed**:
- `image_title`: Hide thumbnail
- `image_preview`: Block preview generation

**Implementation**:
```javascript
// In tiles mode
function shouldShowThumbnail(game) {
  if (banManager.isGameBanned(game.Id, 'image_title', game)) {
    return false;
  }
  return true;
}
```

---

## API Reference

### Class: `GameVersionBanManager`

#### Constructor
```javascript
const banManager = new GameVersionBanManager(dbManager);
```
- **`dbManager`**: DatabaseManager instance (from `electron/database-manager.js`)

#### Methods

##### `isGameBanned(gameid, action, gameData = null)`
Check if a game is banned for a specific action.

**Parameters**:
- `gameid` (string): Game ID to check
- `action` (string): Action/sense to check (e.g., `'image_preview'`, `'list_any'`)
- `gameData` (object, optional): Full game object for matching on other fields (author, tags, etc.)

**Returns**: `boolean` - `true` if game is banned for this action

**Example**:
```javascript
if (banManager.isGameBanned('12345', 'image_preview')) {
  // Hide image preview
}
```

##### `getBanDetails(gameid, action, gameData = null)`
Get detailed ban information for a game and action.

**Parameters**:
- `gameid` (string): Game ID to check
- `action` (string): Action/sense to check
- `gameData` (object, optional): Full game object

**Returns**: `Object|null` - Ban details object or `null` if not banned

**Ban Details Object**:
```javascript
{
  banuuid: 'uuid' or undefined (for hardcoded),
  gameid: '12345',
  match_column: 'gameid',
  match_pattern: 'exact:12345',
  sense: 'image_preview,list_title',
  required_acknowledgments: 'Mature_Content*,Violence',
  starting_at: null or '2025-01-01T00:00:00Z',
  reason: 'Content warning',
  warningtext: 'This game contains mature content',
  sequence_no: 0,
  active: 1
}
```

**Example**:
```javascript
const ban = banManager.getBanDetails('12345', 'details_soft');
if (ban) {
  // Show warning with ban.warningtext
  // Check ban.required_acknowledgments
}
```

##### `getBannedList(action)`
Get list of all banned gameids for a specific action.

**Parameters**:
- `action` (string): Action/sense to check

**Returns**: `Array<string>` - Array of banned gameids

**Example**:
```javascript
const bannedGameids = banManager.getBannedList('list_any');
// Returns: ['12345', '67890', ...]
```

##### `getComputedColumn(ban, columnName)`
Get computed column value (1 or 0) based on sense string.

**Parameters**:
- `ban` (object): Ban entry object
- `columnName` (string): Column name to check (e.g., `'image_title'`, `'list_any'`)

**Returns**: `number` - `1` if sense matches column, `0` otherwise

**Example**:
```javascript
const ban = { sense: 'image_title,list_any' };
const imageTitle = banManager.getComputedColumn(ban, 'image_title'); // Returns 1
const runRandom = banManager.getComputedColumn(ban, 'run_random_game'); // Returns 0
```

##### `addBan(banData)`
Add a new ban to the database.

**Parameters**:
- `banData` (object): Ban data object
  ```javascript
  {
    gameid: '12345' or null,
    match_column: 'gameid',
    match_pattern: 'exact:12345',
    sense: 'list_any',
    required_acknowledgments: 'Mature_Content' or null,
    starting_at: null or '2025-01-01T00:00:00Z',
    reason: 'Reason text' or null,
    warningtext: 'Warning text' or null,
    sequence_no: 0,
    active: 1
  }
  ```

**Returns**: `string` - `banuuid` of created ban

**Example**:
```javascript
const banuuid = banManager.addBan({
  gameid: '12345',
  match_column: 'gameid',
  match_pattern: 'exact:12345',
  sense: 'list_any,details_hard',
  reason: 'Content warning',
  active: 1
});
```

##### `updateBan(banuuid, banData)`
Update an existing ban in the database.

**Parameters**:
- `banuuid` (string): Ban UUID to update
- `banData` (object): Updated ban data (only include fields to update)

**Example**:
```javascript
banManager.updateBan(banuuid, {
  active: 0, // Deactivate ban
  reason: 'Updated reason'
});
```

##### `deleteBan(banuuid)`
Delete a ban from the database.

**Parameters**:
- `banuuid` (string): Ban UUID to delete

**Example**:
```javascript
banManager.deleteBan(banuuid);
```

##### `invalidateCache()`
Invalidate the ban cache (call after adding/updating/deleting bans).

**Example**:
```javascript
banManager.addBan(banData);
banManager.invalidateCache(); // Not needed - addBan does this automatically
```

---

## Usage Examples

### Example 1: Check if game should be hidden from list

```javascript
const GameVersionBanManager = require('./electron/gameversion-banmanager');
const banManager = new GameVersionBanManager(dbManager);

// In game list filtering
const visibleGames = allGames.filter(game => {
  return !banManager.isGameBanned(game.Id, 'list_any', game);
});
```

### Example 2: Handle soft ban with acknowledgments

```javascript
async function openGameDetails(game) {
  const banDetails = banManager.getBanDetails(game.Id, 'details_soft', game);
  
  if (banDetails) {
    // Parse required acknowledgments
    const acknowledgments = banDetails.required_acknowledgments
      ? banDetails.required_acknowledgments.split(',').map(a => a.trim())
      : [];
    
    // Check for * suffix (always required)
    const alwaysRequired = acknowledgments.filter(a => a.endsWith('*'));
    const canSaveGlobally = acknowledgments.filter(a => !a.endsWith('*'));
    
    // Show acknowledgment dialog
    const confirmed = await showAcknowledgmentDialog({
      warningText: banDetails.warningtext || 
        `The action details_soft is deemed hazardous or sensitive on this specific game. Are you sure you want to continue?`,
      acknowledgments: acknowledgments,
      alwaysRequired: alwaysRequired,
      canSaveGlobally: canSaveGlobally.length > 0 && alwaysRequired.length === 0
    });
    
    if (!confirmed) {
      return; // User cancelled
    }
  }
  
  // Proceed with showing details
  showGameDetails(game);
}
```

### Example 3: Block game from random selection

```javascript
// In seed-manager.js selectRandomGame
function selectRandomGame(params) {
  // ... existing code ...
  
  const availableGames = filteredGames.filter(game => {
    return !banManager.isGameBanned(game.gameid, 'run_random_game', game);
  });
  
  // ... rest of function ...
}
```

### Example 4: Add a ban programmatically

```javascript
const banuuid = banManager.addBan({
  gameid: '12345',
  match_column: 'gameid',
  match_pattern: 'exact:12345',
  sense: 'image_preview,list_title,details_soft',
  required_acknowledgments: 'Mature_Content*,Violence',
  reason: 'Contains mature content',
  warningtext: 'This game contains mature themes and violence. Viewer discretion advised.',
  active: 1,
  sequence_no: 10
});
```

### Example 5: Wildcard sense matching

```javascript
// Ban with wildcard sense
banManager.addBan({
  gameid: '12345',
  match_column: 'gameid',
  match_pattern: 'exact:12345',
  sense: 'run_random_*', // Matches both run_random_game and run_random_stage
  active: 1
});

// Check will match both
banManager.isGameBanned('12345', 'run_random_game'); // true
banManager.isGameBanned('12345', 'run_random_stage'); // true
```

---

## Database Schema

### Table: `gameversion_banlist`

```sql
CREATE TABLE gameversion_banlist (
  banuuid TEXT PRIMARY KEY,
  gameid TEXT,
  match_column TEXT NOT NULL CHECK(match_column IN ('gameid', 'gvuuid', 'author', 'tags', 'url', 'name')),
  match_pattern TEXT NOT NULL,
  sense TEXT NOT NULL,
  required_acknowledgments TEXT,
  starting_at TEXT,
  reason TEXT,
  warningtext TEXT,
  sequence_no INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

### Indexes

- `idx_gameversion_banlist_gameid` - On `gameid`
- `idx_gameversion_banlist_match_column` - On `match_column`
- `idx_gameversion_banlist_active` - On `active`
- `idx_gameversion_banlist_sequence` - On `sequence_no`
- `idx_gameversion_banlist_starting_at` - On `starting_at`

---

## Notes

1. **Hardcoded bans are always evaluated first** - They have implicit `sequence_no = 0` and are checked before any database bans.

2. **First match wins** - If multiple bans match a game + action, only the first one (lowest sequence_no) applies.

3. **Case-insensitive matching** - All pattern matching is case-insensitive, but acknowledgment values are case-sensitive.

4. **Wildcard support** - Sense strings support wildcards (e.g., `"run_random_*"`), but match patterns do not (use regex for pattern wildcards).

5. **Computed columns are not stored** - They are computed on-the-fly from the `sense` string when needed.

6. **Cache invalidation** - The ban manager caches results for 1 minute. Call `invalidateCache()` after modifying bans to ensure immediate effect.

7. **Soft ban acknowledgments** - Users can save global preferences for acknowledgments without `*` suffix, but `*` suffixed acknowledgments always require manual confirmation.

8. **Integration order** - When integrating, check hard bans first (block immediately), then check soft bans (show warning, allow proceed after acknowledgment).

