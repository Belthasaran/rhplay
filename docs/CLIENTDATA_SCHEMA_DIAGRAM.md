# clientdata.db Schema Diagram

Visual reference for the user annotations database schema.

---

## Database Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        clientdata.db                            │
│                   (User-Specific Private Data)                  │
└─────────────────────────────────────────────────────────────────┘
                                │
                ┌───────────────┼───────────────┐
                │               │               │
                ▼               ▼               ▼
        ┌──────────────┐  ┌────────────┐  ┌──────────────┐
        │  csettings   │  │ apiservers │  │ User Annotations │
        │              │  │            │  │   (NEW)          │
        │ Key-Value    │  │ API Creds  │  │                  │
        │ Settings     │  │ (Encrypted)│  │                  │
        └──────────────┘  └────────────┘  └──────────────────┘
                                                    │
                              ┌─────────────────────┼─────────────────────┐
                              │                     │                     │
                              ▼                     ▼                     ▼
                    ┌──────────────────┐  ┌──────────────┐  ┌──────────────────┐
                    │ user_game_       │  │ game_stages  │  │ user_stage_      │
                    │   annotations    │  │              │  │   annotations    │
                    │                  │  │              │  │                  │
                    │ • status         │  │ • exit_number│  │ • user_rating    │
                    │ • user_rating    │  │ • description│  │ • user_notes     │
                    │ • hidden         │  │ • public_    │  │                  │
                    │ • user_notes     │  │   rating     │  │                  │
                    └──────────────────┘  └──────────────┘  └──────────────────┘
                              │                     │                     │
                              └─────────────────────┴─────────────────────┘
                                            gameid relationship
```

---

## Table: user_game_annotations

**Purpose**: Store user-specific data for each game

```
user_game_annotations
┌─────────────────────────────────────────────────────────────┐
│ PRIMARY KEY: gameid (VARCHAR 255)                           │
├─────────────────────────────────────────────────────────────┤
│ status         VARCHAR(50)    DEFAULT 'Default'             │
│   ├─ 'Default'                                              │
│   ├─ 'In Progress'                                          │
│   └─ 'Finished'                                             │
│                                                             │
│ user_rating    INTEGER        1-5 or NULL                   │
│   ├─ 1: Very Easy                                           │
│   ├─ 2: Easy                                                │
│   ├─ 3: Normal                                              │
│   ├─ 4: Hard                                                │
│   └─ 5: Very Hard                                           │
│                                                             │
│ hidden         INTEGER        0 (visible) or 1 (hidden)     │
│                                                             │
│ user_notes     TEXT           Unlimited text                │
│                                                             │
│ created_at     TIMESTAMP      Auto-generated                │
│ updated_at     TIMESTAMP      Auto-updated on change        │
└─────────────────────────────────────────────────────────────┘

INDEXES:
  • idx_user_game_status   (status)
  • idx_user_game_hidden   (hidden)
  • idx_user_game_rating   (user_rating)

TRIGGERS:
  • trigger_user_game_updated (auto-updates updated_at)
```

---

## Table: game_stages

**Purpose**: Store stage/exit metadata (optional, not all games have stages)

```
game_stages
┌─────────────────────────────────────────────────────────────┐
│ PRIMARY KEY: stage_key (VARCHAR 510)                        │
│ Format: "gameid-exitnumber"                                 │
│ Examples: "12345-01", "9999-0xFF", "test-105"               │
├─────────────────────────────────────────────────────────────┤
│ gameid         VARCHAR(255)   References game               │
│ exit_number    VARCHAR(255)   Stage/exit ID                 │
│ description    TEXT           Stage name/description        │
│ public_rating  DECIMAL(3,2)   Community rating (e.g. 3.75)  │
│                                                             │
│ created_at     TIMESTAMP      Auto-generated                │
│ updated_at     TIMESTAMP      Auto-updated on change        │
└─────────────────────────────────────────────────────────────┘

INDEXES:
  • idx_game_stages_gameid  (gameid)
  • idx_game_stages_exit    (exit_number)

CONSTRAINTS:
  • UNIQUE(gameid, exit_number)

TRIGGERS:
  • trigger_game_stages_updated (auto-updates updated_at)
```

---

## Table: user_stage_annotations

**Purpose**: Store user-specific ratings/notes for individual stages

```
user_stage_annotations
┌─────────────────────────────────────────────────────────────┐
│ PRIMARY KEY: stage_key (VARCHAR 510)                        │
│ Format: "gameid-exitnumber"                                 │
├─────────────────────────────────────────────────────────────┤
│ gameid         VARCHAR(255)   References game               │
│ exit_number    VARCHAR(255)   References stage              │
│                                                             │
│ user_rating    INTEGER        1-5 or NULL                   │
│   ├─ 1: Very Easy                                           │
│   ├─ 2: Easy                                                │
│   ├─ 3: Normal                                              │
│   ├─ 4: Hard                                                │
│   └─ 5: Very Hard                                           │
│                                                             │
│ user_notes     TEXT           User's personal notes         │
│                                                             │
│ created_at     TIMESTAMP      Auto-generated                │
│ updated_at     TIMESTAMP      Auto-updated on change        │
└─────────────────────────────────────────────────────────────┘

INDEXES:
  • idx_user_stage_gameid  (gameid)
  • idx_user_stage_rating  (user_rating)

CONSTRAINTS:
  • UNIQUE(gameid, exit_number)

TRIGGERS:
  • trigger_user_stage_updated (auto-updates updated_at)
```

---

## Convenience Views

### v_games_with_annotations
```sql
SELECT 
    gameid,
    COALESCE(status, 'Default') as status,
    user_rating,
    COALESCE(hidden, 0) as hidden,
    user_notes,
    created_at,
    updated_at
FROM user_game_annotations;
```

### v_stages_with_annotations
```sql
SELECT 
    gs.stage_key,
    gs.gameid,
    gs.exit_number,
    gs.description,
    gs.public_rating,
    usa.user_rating,
    usa.user_notes,
    gs.created_at as stage_created_at,
    usa.created_at as annotation_created_at
FROM game_stages gs
LEFT JOIN user_stage_annotations usa ON gs.stage_key = usa.stage_key;
```

---

## Relationships

```
rhdata.db                           clientdata.db
┌──────────────┐                   ┌──────────────────┐
│ gameversions │                   │ user_game_       │
│              │                   │   annotations    │
│ • gameid ────┼───references──────│ • gameid (PK)    │
│ • name       │                   │ • status         │
│ • author     │                   │ • user_rating    │
│ • difficulty │                   │ • hidden         │
│              │                   │ • user_notes     │
└──────────────┘                   └──────────────────┘
                                            │
                                            │ gameid
                                            │
                        ┌───────────────────┴───────────────────┐
                        │                                       │
               ┌────────▼────────┐                   ┌─────────▼────────┐
               │ game_stages     │                   │ user_stage_      │
               │                 │                   │   annotations    │
               │ • stage_key (PK)│───stage_key───────│ • stage_key (PK) │
               │ • gameid        │                   │ • gameid         │
               │ • exit_number   │                   │ • exit_number    │
               │ • description   │                   │ • user_rating    │
               │ • public_rating │                   │ • user_notes     │
               └─────────────────┘                   └──────────────────┘
```

---

## Data Flow Example

### User Rates a Game

```
1. User opens game in UI
      │
      ▼
2. Load game from rhdata.gameversions
   ┌────────────────────────────┐
   │ gameid: 12345              │
   │ name: "Super Kaizo World"  │
   │ difficulty: "Advanced"     │
   └────────────────────────────┘
      │
      ▼
3. Check for existing annotation in clientdata
   SELECT * FROM user_game_annotations WHERE gameid = '12345'
      │
      ├─ Not Found → Show defaults (no rating, status = 'Default')
      └─ Found → Show user's data
      │
      ▼
4. User sets rating = 4, status = 'In Progress'
      │
      ▼
5. Save to clientdata.db
   INSERT OR REPLACE INTO user_game_annotations
     (gameid, status, user_rating, user_notes)
   VALUES ('12345', 'In Progress', 4, 'Great level design!')
      │
      ▼
6. Trigger updates updated_at automatically
      │
      ▼
7. UI reflects new data immediately
```

### User Rates a Stage

```
1. User selects game 12345 with documented stages
      │
      ▼
2. Load stages from game_stages
   SELECT * FROM game_stages WHERE gameid = '12345'
      │
      ▼
3. Display stages with public ratings
   ┌─────────────────────────────────────┐
   │ Exit 01: "Tutorial"    (Rating: 2.5)│
   │ Exit 02: "Cave Level"  (Rating: 3.5)│
   │ Exit 03: "Boss Fight"  (Rating: 4.5)│
   └─────────────────────────────────────┘
      │
      ▼
4. Load user annotations
   SELECT * FROM user_stage_annotations WHERE gameid = '12345'
      │
      ▼
5. User rates Exit 03 as 5 (Very Hard)
      │
      ▼
6. Save to user_stage_annotations
   INSERT OR REPLACE INTO user_stage_annotations
     (stage_key, gameid, exit_number, user_rating, user_notes)
   VALUES ('12345-03', '12345', '03', 5, 'Hardest boss!')
```

---

## Query Patterns

### Get All User Data for a Game
```sql
SELECT 
    gv.gameid,
    gv.name,
    gv.author,
    uga.status,
    uga.user_rating,
    uga.user_notes
FROM rhdata.gameversions gv
LEFT JOIN clientdata.user_game_annotations uga ON gv.gameid = uga.gameid
WHERE gv.gameid = '12345';
```

### Get Game with All Stages and User Ratings
```sql
SELECT 
    gv.name as game_name,
    gs.exit_number,
    gs.description,
    gs.public_rating,
    usa.user_rating,
    usa.user_notes
FROM rhdata.gameversions gv
JOIN clientdata.game_stages gs ON gv.gameid = gs.gameid
LEFT JOIN clientdata.user_stage_annotations usa ON gs.stage_key = usa.stage_key
WHERE gv.gameid = '12345'
ORDER BY gs.exit_number;
```

---

## Statistics

```
Schema Statistics
┌─────────────────────┬───────┐
│ Tables              │   3   │
│ Views               │   2   │
│ Indexes             │   7   │
│ Triggers            │   3   │
│ Columns (total)     │  21   │
│ Constraints         │   6   │
└─────────────────────┴───────┘
```

---

*Schema Diagram v1.0 - October 12, 2025*

