# clientdata.db User Annotations

## Overview

The `clientdata.db` database stores user-specific, private data for the RHTools Electron application. This includes personal ratings, notes, progress tracking, and other user preferences that should NOT be shared between users.

**Key Principle**: Each user installation should have its own `clientdata.db` file.

## Database Location

Default: `electron/clientdata.db`

Can be overridden via environment variable:
```bash
export CLIENTDATA_DB_PATH=/path/to/my/clientdata.db
```

## Schema Overview

The user annotations system consists of three main tables:

1. **user_game_annotations** - User-specific data for games
2. **game_stages** - Stage/exit metadata for games
3. **user_stage_annotations** - User-specific data for stages

Plus two convenience views for easier querying.

---

## Table: user_game_annotations

### Purpose
Store user-specific annotations for each game, including status, ratings, visibility, and personal notes.

### Schema

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `gameid` | VARCHAR(255) | - | **PRIMARY KEY**. References gameid from rhdata.db |
| `status` | VARCHAR(50) | 'Default' | Progress status: 'Default', 'In Progress', 'Finished' |
| `user_rating` | INTEGER | NULL | Personal difficulty rating (1-5 scale) |
| `hidden` | INTEGER | 0 | Visibility flag: 0 = visible, 1 = hidden |
| `user_notes` | TEXT | NULL | Personal notes about the game |
| `created_at` | TIMESTAMP | CURRENT_TIMESTAMP | When record was created |
| `updated_at` | TIMESTAMP | CURRENT_TIMESTAMP | When record was last modified |

### Constraints

- **PRIMARY KEY**: gameid
- **CHECK**: `user_rating IS NULL OR (user_rating >= 1 AND user_rating <= 5)`
- **TRIGGER**: `trigger_user_game_updated` - Auto-updates `updated_at` on modification

### Indexes

- `idx_user_game_status` - Fast queries by status
- `idx_user_game_hidden` - Fast filtering of hidden games
- `idx_user_game_rating` - Fast sorting/filtering by rating

### Usage Examples

```sql
-- Add a game annotation
INSERT OR REPLACE INTO user_game_annotations 
  (gameid, status, user_rating, hidden, user_notes)
VALUES 
  ('12345', 'In Progress', 4, 0, 'Great traditional hack!');

-- Mark a game as finished
UPDATE user_game_annotations 
SET status = 'Finished' 
WHERE gameid = '12345';

-- Hide a game
UPDATE user_game_annotations 
SET hidden = 1 
WHERE gameid = '12345';

-- Update rating and notes
UPDATE user_game_annotations 
SET user_rating = 5, 
    user_notes = 'One of my favorites!'
WHERE gameid = '12345';

-- Get all games in progress
SELECT * FROM user_game_annotations 
WHERE status = 'In Progress';

-- Get visible games with high ratings
SELECT * FROM user_game_annotations 
WHERE hidden = 0 AND user_rating >= 4
ORDER BY user_rating DESC;

-- Get all finished games
SELECT * FROM user_game_annotations 
WHERE status = 'Finished';
```

---

## Table: game_stages

### Purpose
Store metadata about stages/exits within games. Not all games have documented stages - this table is optional.

### Schema

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `stage_key` | VARCHAR(510) | - | **PRIMARY KEY**. Format: "gameid-exitnumber" |
| `gameid` | VARCHAR(255) | - | References the game |
| `exit_number` | VARCHAR(255) | - | Stage/exit identifier |
| `description` | TEXT | NULL | Stage description/name |
| `public_rating` | DECIMAL(3,2) | NULL | Community average rating |
| `created_at` | TIMESTAMP | CURRENT_TIMESTAMP | When record was created |
| `updated_at` | TIMESTAMP | CURRENT_TIMESTAMP | When record was last modified |

### Constraints

- **PRIMARY KEY**: stage_key
- **UNIQUE**: (gameid, exit_number)
- **TRIGGER**: `trigger_game_stages_updated` - Auto-updates `updated_at`

### Indexes

- `idx_game_stages_gameid` - Fast queries by game
- `idx_game_stages_exit` - Fast lookups by exit number

### Stage Key Format

Stage keys follow the format: `"gameid-exitnumber"`

Examples:
- `"12345-01"` - Game 12345, exit 01
- `"9999-0xFF"` - Game 9999, exit 0xFF (hex)
- `"test-105"` - Game test, exit 105

### Usage Examples

```sql
-- Add stage metadata
INSERT INTO game_stages 
  (stage_key, gameid, exit_number, description, public_rating)
VALUES 
  ('12345-01', '12345', '01', 'First Level - Tutorial', 2.5),
  ('12345-02', '12345', '02', 'Second Level - Cave', 3.5),
  ('12345-03', '12345', '03', 'Boss Fight', 4.5);

-- Get all stages for a game
SELECT * FROM game_stages 
WHERE gameid = '12345'
ORDER BY exit_number;

-- Get highly rated stages across all games
SELECT * FROM game_stages 
WHERE public_rating >= 4.0
ORDER BY public_rating DESC;

-- Update stage description
UPDATE game_stages 
SET description = 'Final Boss - Very Hard'
WHERE stage_key = '12345-03';
```

---

## Table: user_stage_annotations

### Purpose
Store user-specific annotations for individual stages within games. Allows rating and commenting on specific stages.

### Schema

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `stage_key` | VARCHAR(510) | - | **PRIMARY KEY**. Format: "gameid-exitnumber" |
| `gameid` | VARCHAR(255) | - | References the game |
| `exit_number` | VARCHAR(255) | - | References the stage |
| `user_rating` | INTEGER | NULL | Personal difficulty rating (1-5 scale) |
| `user_notes` | TEXT | NULL | Personal notes about this stage |
| `created_at` | TIMESTAMP | CURRENT_TIMESTAMP | When record was created |
| `updated_at` | TIMESTAMP | CURRENT_TIMESTAMP | When record was last modified |

### Constraints

- **PRIMARY KEY**: stage_key
- **UNIQUE**: (gameid, exit_number)
- **CHECK**: `user_rating IS NULL OR (user_rating >= 1 AND user_rating <= 5)`
- **TRIGGER**: `trigger_user_stage_updated` - Auto-updates `updated_at`

### Indexes

- `idx_user_stage_gameid` - Fast queries by game
- `idx_user_stage_rating` - Fast sorting/filtering by rating

### Usage Examples

```sql
-- Add user annotations for stages
INSERT OR REPLACE INTO user_stage_annotations 
  (stage_key, gameid, exit_number, user_rating, user_notes)
VALUES 
  ('12345-01', '12345', '01', 2, 'Easy tutorial level'),
  ('12345-02', '12345', '02', 4, 'Tricky platforming'),
  ('12345-03', '12345', '03', 5, 'Very hard boss!');

-- Get all user ratings for a game's stages
SELECT exit_number, user_rating, user_notes 
FROM user_stage_annotations 
WHERE gameid = '12345'
ORDER BY exit_number;

-- Find all stages the user rated highly
SELECT gameid, exit_number, user_rating, user_notes
FROM user_stage_annotations
WHERE user_rating >= 4
ORDER BY user_rating DESC, gameid;

-- Update stage rating
UPDATE user_stage_annotations 
SET user_rating = 3, user_notes = 'Not as hard as I thought'
WHERE stage_key = '12345-03';
```

---

## Convenience Views

### View: v_games_with_annotations

Simplified view of game annotations with default values applied.

```sql
SELECT * FROM v_games_with_annotations;
-- Returns all game annotations with COALESCE for defaults
```

### View: v_stages_with_annotations

Combined view of stage metadata and user annotations.

```sql
SELECT * FROM v_stages_with_annotations WHERE gameid = '12345';
-- Returns stage info with user annotations (LEFT JOIN preserves stages without annotations)
```

Example:
```sql
-- Get all stages for a game with both public and user ratings
SELECT 
  exit_number,
  description,
  public_rating,
  user_rating,
  user_notes
FROM v_stages_with_annotations 
WHERE gameid = '12345'
ORDER BY exit_number;
```

---

## Rating Scale

User ratings use a 1-5 integer scale:

| Rating | Meaning |
|--------|---------|
| 1 | Very Easy |
| 2 | Easy |
| 3 | Normal / Medium |
| 4 | Hard |
| 5 | Very Hard |
| NULL | Not rated |

**Note**: This is a *difficulty* rating, not a quality rating. Higher numbers mean more difficult.

---

## Status Values

Game status tracks user progress:

| Status | Meaning |
|--------|---------|
| 'Default' | Not started or no status set |
| 'In Progress' | Currently playing |
| 'Finished' | Completed |

---

## Common Query Patterns

### Get all games in progress with high ratings
```sql
SELECT gameid, user_rating, user_notes
FROM user_game_annotations
WHERE status = 'In Progress' AND user_rating >= 4;
```

### Get visible (not hidden) games, ordered by rating
```sql
SELECT gameid, status, user_rating
FROM user_game_annotations
WHERE hidden = 0 AND user_rating IS NOT NULL
ORDER BY user_rating DESC;
```

### Count games by status
```sql
SELECT status, COUNT(*) as count
FROM user_game_annotations
GROUP BY status
ORDER BY count DESC;
```

### Get games with all stages and ratings
```sql
SELECT 
  uga.gameid,
  uga.status,
  uga.user_rating as game_rating,
  gs.exit_number,
  gs.description,
  usa.user_rating as stage_rating,
  usa.user_notes as stage_notes
FROM user_game_annotations uga
JOIN game_stages gs ON uga.gameid = gs.gameid
LEFT JOIN user_stage_annotations usa ON gs.stage_key = usa.stage_key
WHERE uga.gameid = '12345'
ORDER BY gs.exit_number;
```

### Get average user rating for all stages in a game
```sql
SELECT 
  gameid,
  COUNT(*) as stage_count,
  AVG(user_rating) as avg_user_rating
FROM user_stage_annotations
WHERE gameid = '12345' AND user_rating IS NOT NULL
GROUP BY gameid;
```

### Find games where user rating differs significantly from public rating
```sql
-- This requires joining with gameversions from rhdata.db
-- Example: compare user_game_annotations.user_rating with gameversions.difficulty
```

---

## Integration with rhdata.db

The `gameid` field references games from `rhdata.db`:

```sql
-- Example: Get game names with user annotations
SELECT 
  gv.gameid,
  gv.name,
  gv.author,
  gv.difficulty as public_difficulty,
  uga.status,
  uga.user_rating,
  uga.user_notes
FROM user_game_annotations uga
JOIN rhdata.gameversions gv ON uga.gameid = gv.gameid
WHERE uga.hidden = 0
ORDER BY uga.user_rating DESC;
```

**Note**: Use `ATTACH DATABASE` to join across databases:

```sql
ATTACH DATABASE 'electron/rhdata.db' AS rhdata;

SELECT gv.name, uga.user_rating
FROM user_game_annotations uga
JOIN rhdata.gameversions gv ON uga.gameid = gv.gameid
WHERE uga.status = 'In Progress';

DETACH DATABASE rhdata;
```

---

## Migration and Setup

### For New Installations

The schema is automatically created when using the base `clientdata.sql`:

```bash
sqlite3 electron/clientdata.db < electron/sql/clientdata.sql
```

### For Existing Installations

Apply the migration:

```bash
sqlite3 electron/clientdata.db < electron/sql/migrations/001_clientdata_user_annotations.sql
```

### Verification

```bash
# Check tables exist
sqlite3 electron/clientdata.db "SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE 'user_%' OR name='game_stages');"

# Expected output:
# user_game_annotations
# game_stages
# user_stage_annotations

# Check views exist
sqlite3 electron/clientdata.db "SELECT name FROM sqlite_master WHERE type='view';"

# Expected output:
# v_games_with_annotations
# v_stages_with_annotations
```

---

## Environment Variable Support

Scripts should support the `CLIENTDATA_DB_PATH` environment variable:

```javascript
const Database = require('better-sqlite3');
const path = require('path');

const CLIENTDATA_DB_PATH = process.env.CLIENTDATA_DB_PATH || 
  path.join(__dirname, 'electron', 'clientdata.db');

const db = new Database(CLIENTDATA_DB_PATH);
```

---

## Testing

Run the test suite:

```bash
node electron/tests/test_clientdata_annotations.js
```

This test covers:
- Schema creation (tables, views, indexes, triggers)
- CRUD operations on game annotations
- Stage metadata and annotations
- Convenience views
- Practical usage scenarios
- Timestamp triggers

---

## Best Practices

### 1. Use Upserts for User Data

```sql
INSERT OR REPLACE INTO user_game_annotations 
  (gameid, status, user_rating, hidden, user_notes)
VALUES (?, ?, ?, ?, ?);
```

### 2. Handle NULL Ratings Gracefully

```sql
-- Filter out unrated games
WHERE user_rating IS NOT NULL

-- Include unrated games at the end
ORDER BY user_rating DESC NULLS LAST
```

### 3. Use Transactions for Multiple Updates

```javascript
db.transaction(() => {
  updateStatus.run('Finished', gameid);
  updateRating.run(5, gameid);
  addNote.run('Completed!', gameid);
})();
```

### 4. Maintain Stage Key Consistency

```javascript
function makeStageKey(gameid, exitNumber) {
  return `${gameid}-${exitNumber}`;
}
```

### 5. Don't Share clientdata.db

Each user should have their own `clientdata.db`. This database contains:
- Personal opinions (ratings, notes)
- Individual progress (status)
- Personal preferences (hidden games)

These should NOT be synced or shared between users.

---

## Related Documentation

- **Migration**: `docs/DBMIGRATE.md` - Migration commands and procedures
- **Schema Changes**: `docs/SCHEMACHANGES.md` - Complete schema changelog
- **GUI Design**: `electron/GUI_README.md` - UI integration points
- **Test Suite**: `electron/tests/test_clientdata_annotations.js`

---

## Future Enhancements

Potential additions to consider:

1. **Play History**: Track when games were played
2. **Completion Tracking**: Per-exit completion tracking
3. **Custom Tags**: User-defined tags for organizing games
4. **Favorites**: Quick access to favorite games
5. **Difficulty Curve**: Graph of stage difficulties within a game
6. **Import/Export**: Backup and restore user annotations
7. **Statistics**: Aggregate stats (total games finished, average ratings, etc.)

---

*Last Updated: October 12, 2025*  
*Schema Version: 001*

