# clientdata.db Quick Reference

Fast reference for working with user annotations in clientdata.db.

---

## Table Overview

```
clientdata.db
├── csettings                    # General settings (key-value)
├── apiservers                   # API credentials (encrypted)
├── user_game_annotations        # User game ratings/status/notes
├── game_stages                  # Stage metadata (optional)
└── user_stage_annotations       # User stage ratings/notes
```

---

## Common Operations

### Set Game Rating and Status
```sql
INSERT OR REPLACE INTO user_game_annotations 
  (gameid, status, user_rating, user_notes)
VALUES ('12345', 'In Progress', 4, 'Great hack!');
```

### Hide a Game
```sql
UPDATE user_game_annotations SET hidden = 1 WHERE gameid = '12345';
```

### Mark Game as Finished
```sql
UPDATE user_game_annotations SET status = 'Finished' WHERE gameid = '12345';
```

### Add Stage Info
```sql
INSERT INTO game_stages (stage_key, gameid, exit_number, description)
VALUES ('12345-01', '12345', '01', 'First Level');
```

### Rate a Stage
```sql
INSERT OR REPLACE INTO user_stage_annotations 
  (stage_key, gameid, exit_number, user_rating, user_notes)
VALUES ('12345-01', '12345', '01', 5, 'Best level!');
```

---

## Common Queries

### Get In-Progress Games
```sql
SELECT * FROM user_game_annotations WHERE status = 'In Progress';
```

### Get Visible Games with Ratings ≥ 4
```sql
SELECT * FROM user_game_annotations 
WHERE hidden = 0 AND user_rating >= 4
ORDER BY user_rating DESC;
```

### Get All Stages for a Game
```sql
SELECT * FROM v_stages_with_annotations WHERE gameid = '12345';
```

### Count Games by Status
```sql
SELECT status, COUNT(*) FROM user_game_annotations GROUP BY status;
```

---

## Rating Scale

| Rating | Meaning |
|--------|---------|
| 1 | Very Easy |
| 2 | Easy |
| 3 | Normal |
| 4 | Hard |
| 5 | Very Hard |
| NULL | Not rated |

---

## Status Values

- `'Default'` - Not started
- `'In Progress'` - Currently playing
- `'Finished'` - Completed

---

## Stage Key Format

Format: `"gameid-exitnumber"`

Examples:
- `"12345-01"`
- `"9999-0xFF"`
- `"test-105"`

---

## Node.js Usage

```javascript
const Database = require('better-sqlite3');
const db = new Database('electron/clientdata.db');

// Set game rating
db.prepare(`
  INSERT OR REPLACE INTO user_game_annotations 
    (gameid, status, user_rating, user_notes)
  VALUES (?, ?, ?, ?)
`).run('12345', 'In Progress', 4, 'Great hack!');

// Get all in-progress games
const games = db.prepare(`
  SELECT * FROM user_game_annotations WHERE status = 'In Progress'
`).all();

db.close();
```

---

## Cross-Database Query

```javascript
const db = new Database('electron/rhdata.db');
db.exec(`ATTACH DATABASE 'electron/clientdata.db' AS clientdata`);

const games = db.prepare(`
  SELECT gv.name, gv.author, uga.user_rating, uga.status
  FROM gameversions gv
  LEFT JOIN clientdata.user_game_annotations uga ON gv.gameid = uga.gameid
  WHERE uga.hidden = 0 OR uga.hidden IS NULL
`).all();

db.exec('DETACH DATABASE clientdata');
```

---

## Environment Variable

Override database location:
```bash
export CLIENTDATA_DB_PATH=/path/to/clientdata.db
```

---

## Migration

```bash
sqlite3 electron/clientdata.db < electron/sql/migrations/001_clientdata_user_annotations.sql
```

---

## Test

```bash
node electron/tests/test_clientdata_annotations.js
```

---

## Schema Reference

### user_game_annotations

| Column | Type | Description |
|--------|------|-------------|
| gameid | VARCHAR(255) | PRIMARY KEY |
| status | VARCHAR(50) | 'Default', 'In Progress', 'Finished' |
| user_rating | INTEGER | 1-5 or NULL |
| hidden | INTEGER | 0 or 1 |
| user_notes | TEXT | User notes |
| created_at | TIMESTAMP | Auto-set |
| updated_at | TIMESTAMP | Auto-updated |

### game_stages

| Column | Type | Description |
|--------|------|-------------|
| stage_key | VARCHAR(510) | PRIMARY KEY "gameid-exit" |
| gameid | VARCHAR(255) | Game reference |
| exit_number | VARCHAR(255) | Exit/stage number |
| description | TEXT | Stage description |
| public_rating | DECIMAL(3,2) | Community rating |
| created_at | TIMESTAMP | Auto-set |
| updated_at | TIMESTAMP | Auto-updated |

### user_stage_annotations

| Column | Type | Description |
|--------|------|-------------|
| stage_key | VARCHAR(510) | PRIMARY KEY "gameid-exit" |
| gameid | VARCHAR(255) | Game reference |
| exit_number | VARCHAR(255) | Exit/stage number |
| user_rating | INTEGER | 1-5 or NULL |
| user_notes | TEXT | User notes |
| created_at | TIMESTAMP | Auto-set |
| updated_at | TIMESTAMP | Auto-updated |

---

## Full Documentation

- **Complete Guide**: `docs/CLIENTDATA_USER_ANNOTATIONS.md`
- **Architecture**: `docs/ELECTRON_APP_DATABASES.md`
- **Migration**: `docs/DBMIGRATE.md`
- **Schema Changes**: `docs/SCHEMACHANGES.md`

---

*Quick Reference v1.0 - October 12, 2025*

