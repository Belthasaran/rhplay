# RHTools Electron GUI - Visual Layout Diagrams

## Main Window Layout

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│ TOOLBAR                                                                         │
│ ┌─────────────────────────────────────────────────┬─────────────────────────┐ │
│ │ LEFT CONTROLS                                   │ RIGHT ACTIONS           │ │
│ │ [Open settings] [USB2SNES Tools (conditional)]  │ [Prepare Run]           │ │
│ │ [Search/Filters ▼] [Ignore ▼] [Select ▼]        │ [Start] [Edit notes]    │ │
│ │ [Add to Run]                                    │ [My rating]             │ │
│ │ Status: [___▼] ☐Show hidden ☐Hide finished      │                         │ │
│ └─────────────────────────────────────────────────┴─────────────────────────┘ │
├─────────────────────────────────────────────────────────────────────────────────┤
│ CONTENT AREA                                                                    │
│ ┌───────────────────────────────────────────────┬─────────────────────────────┐ │
│ │ MAIN GAME LIST (Table)                        │ RIGHT SIDEBAR               │ │
│ │ ┌──┬──┬────┬──────┬────┬────────┬────┬───┬─┐ │ ┌─────────────────────────┐ │ │
│ │ │☐│* │ Id │ Name │Type│ Author │Len │...│ │ │ │ DETAILS PANEL           │ │ │
│ │ ├──┼──┼────┼──────┼────┼────────┼────┼───┼─┤ │ │ (when 1 item selected)  │ │ │
│ │ │☐│  │1234│Game A│Std │Bob     │10  │...│ │ │ │                         │ │ │
│ │ │☐│* │5678│Game B│Kai │Alice   │20  │...│ │ │ │ Id: [read-only]         │ │ │
│ │ │☐│  │9012│Game C│Trd │Charlie │5   │...│ │ │ │ Name: [____________]    │ │ │
│ │ │  │  │    │      │    │        │    │   │ │ │ │ Type: [____________]    │ │ │
│ │ │  │  │    │      │    │        │    │   │ │ │ │ Author: [__________]    │ │ │
│ │ │  │  │    │      │    │        │    │   │ │ │ │ Length: [__________]    │ │ │
│ │ │  │  │    │      │    │        │    │   │ │ │ │ Status: [_____▼]        │ │ │
│ │ │  │  │    │      │    │        │    │   │ │ │ │ My rating: [___]        │ │ │
│ │ │  │  │    │      │    │        │    │   │ │ │ │ Public rating: [___]    │ │ │
│ │ │  │  │    │      │    │        │    │   │ │ │ │ Hidden: ☐               │ │ │
│ │ │  │  │    │      │    │        │    │   │ │ │ │ My notes:               │ │ │
│ │ │  │  │    │      │    │        │    │   │ │ │ │ [________________]      │ │ │
│ │ │  │  │    │      │    │        │    │   │ │ │ └─────────────────────────┘ │ │
│ │ └──┴──┴────┴──────┴────┴────────┴────┴───┴─┘ │ ┌─────────────────────────┐ │ │
│ │                                               │ │ STAGES PANEL            │ │ │
│ │ Column Legend:                                │ │ (when 1 item selected)  │ │ │
│ │ • ☐ = Selection checkbox                      │ │                         │ │ │
│ │ • * = In run list indicator                   │ │ Actions:                │ │ │
│ │ • Bold Name = Game in run                     │ │ [Add to run] [Edit      │ │ │
│ │                                               │ │  notes] [My rating]     │ │ │
│ │ Row States:                                   │ │                         │ │ │
│ │ • Faded = Hidden                              │ │ ┌──┬───┬────┬────┬───┐ │ │ │
│ │ • Strikethrough Name = Finished               │ │ │☐│ID │Ex# │Desc│...│ │ │ │
│ │                                               │ │ ├──┼───┼────┼────┼───┤ │ │ │
│ │                                               │ │ │☐│123│1   │Lvl1│...│ │ │ │
│ │                                               │ │ │☐│123│2   │Lvl2│...│ │ │ │
│ │                                               │ │ └──┴───┴────┴────┴───┘ │ │ │
│ │                                               │ └─────────────────────────┘ │ │
│ └───────────────────────────────────────────────┴─────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────────┘

* = Game is in current run list (shows in Action column)
```

---

## Prepare Run Modal Dialog Layout

```
┌───────────────────────────────────────────────────────────────────────────────┐
│ MODAL HEADER                                                                  │
│ Prepare Run                      [Stage and Save] [Stage and Upload] [✕]     │
├───────────────────────────────────────────────────────────────────────────────┤
│ MODAL TOOLBAR                                                                 │
│ ┌─────────────────────────────────────┬───────────────────────────────────┐ │
│ │ LEFT: List Management               │ RIGHT: Add Random Game            │ │
│ │ [Check All] [Uncheck All] [Remove]  │ Type:[__▼] Diff:[__▼]             │ │
│ │ [↑ Move Up] [↓ Move Down]           │ Pattern:[______]                  │ │
│ │                                     │ Count:[__] Seed:[______]          │ │
│ │                                     │ [Add Random Game]                 │ │
│ └─────────────────────────────────────┴───────────────────────────────────┘ │
├───────────────────────────────────────────────────────────────────────────────┤
│ MODAL BODY - RUN LIST TABLE                                                  │
│ ┌──┬─┬───────┬──┬────┬────┬────┬──┬──┬────┬────┬────┬────┬────┐           │
│ │☐│#│Actions│ID│Type│Name│St# │Snm│Ct│FDif│FTyp│FPat│Seed│    │           │
│ ├──┼─┼───────┼──┼────┼────┼────┼──┼──┼────┼────┼────┼────┼────┤           │
│ │☐│1│ ↑  ↓  │12│Game│Dram│    │   │1 │    │    │    │abc1│    │  <--Drag  │
│ │☐│2│ ↑  ↓  │56│Game│Strk│    │   │1 │    │    │    │def2│    │  <--Drop  │
│ │☐│3│ ↑  ↓  │90│Stge│Ex  │0x0F│Jmp│1 │    │    │    │ghi3│    │           │
│ │☐│4│ ↑  ↓  │?? │Game│Rand│    │   │5 │Int │Kai │pat1│jkl4│    │           │
│ │  │ │       │  │    │    │    │   │  │    │    │    │    │    │           │
│ └──┴─┴───────┴──┴────┴────┴────┴──┴──┴────┴────┴────┴────┴────┘           │
│                                                                               │
│ Column Width Legend:                                                          │
│ • # (Seq)      : 40px  - Sequence number                                     │
│ • Actions      : 70px  - Per-row move buttons                                │
│ • Count        : 72px  - 3-digit number input                                │
│ • Seed         : 100px - 8-character text                                    │
│ • Filter Pat   : 220px - 16-character text                                   │
│                                                                               │
│ Row Interaction:                                                              │
│ • Click ↑ or ↓ to move individual row                                        │
│ • Drag row to reorder (entire row is draggable)                              │
│ • Check multiple rows + use toolbar Move Up/Down for bulk operations         │
│                                                                               │
└───────────────────────────────────────────────────────────────────────────────┘
```

---

## Component Hierarchy Tree

```
App.vue
├─ Main Layout
│  ├─ Toolbar (header)
│  │  ├─ Left Controls
│  │  │  ├─ Open settings button
│  │  │  ├─ Search input
│  │  │  ├─ Clear filters button
│  │  │  ├─ Check all button
│  │  │  ├─ Uncheck all button
│  │  │  ├─ Add to Run button *
│  │  │  ├─ Hide checked button
│  │  │  ├─ Unhide checked button
│  │  │  ├─ Status dropdown
│  │  │  ├─ Show hidden toggle
│  │  │  └─ Hide finished toggle
│  │  └─ Right Actions
│  │     ├─ Prepare Run button *
│  │     ├─ Start button
│  │     ├─ Edit notes button
│  │     └─ My rating button
│  │
│  └─ Content Area
│     ├─ Main Game List (table-wrapper)
│     │  └─ Data Table
│     │     ├─ Header Row
│     │     │  ├─ Select All checkbox
│     │     │  ├─ Action column header
│     │     │  └─ Data column headers (Id, Name, Type, etc.)
│     │     └─ Body Rows
│     │        ├─ Checkbox cell
│     │        ├─ Action cell (shows "*" if in run)
│     │        └─ Data cells
│     │
│     └─ Right Sidebar
│        ├─ Details Panel
│        │  └─ Key-Value Table
│        │     ├─ Id (read-only)
│        │     ├─ Name (editable)
│        │     ├─ Type (editable)
│        │     ├─ Author (editable)
│        │     ├─ Length (editable)
│        │     ├─ Status (dropdown)
│        │     ├─ My rating (number input)
│        │     ├─ Public rating (number input)
│        │     ├─ Hidden (checkbox)
│        │     └─ My notes (textarea)
│        │
│        └─ Stages Panel
│           ├─ Panel Actions (toolbar)
│           │  ├─ Add chosen stages to run button
│           │  ├─ Edit notes button
│           │  └─ My rating button
│           └─ Data Table
│              ├─ Header Row (with Select All)
│              └─ Stage Rows
│
└─ Prepare Run Modal (v-if runModalOpen) *
   ├─ Modal Backdrop (click to close)
   └─ Modal Container
      ├─ Modal Header
      │  ├─ Title: "Prepare Run"
      │  └─ Header Actions
      │     ├─ Stage and Save button
      │     ├─ Stage and Upload button
      │     └─ Close button (✕)
      │
      ├─ Modal Toolbar
      │  ├─ Left Section
      │  │  ├─ Check All button
      │  │  ├─ Uncheck All button
      │  │  ├─ Remove button
      │  │  ├─ Move Up button *
      │  │  └─ Move Down button *
      │  └─ Right Section (add-random)
      │     ├─ Filter Type dropdown
      │     ├─ Difficulty dropdown
      │     ├─ Filter pattern input
      │     ├─ Count input *
      │     ├─ Seed input *
      │     └─ Add Random Game button
      │
      └─ Modal Body
         └─ Run List Table
            ├─ Header Row
            │  ├─ Select All checkbox
            │  ├─ # (Sequence) column *
            │  ├─ Actions column *
            │  └─ Data column headers
            └─ Body Rows (draggable) *
               ├─ Checkbox cell
               ├─ Sequence number cell *
               ├─ Actions cell (↑↓ buttons) *
               ├─ ID cell
               ├─ Entry Type dropdown
               ├─ Name cell (read-only)
               ├─ Stage # cell (read-only)
               ├─ Stage name cell (read-only)
               ├─ Count input
               ├─ Filter difficulty dropdown
               ├─ Filter type dropdown
               ├─ Filter pattern input
               └─ Seed input

* = Components added or significantly modified in recent updates
```

---

## State Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│ APPLICATION STATE                                               │
│                                                                 │
│ Main View State:                    Run Modal State:           │
│ • items (all games)                 • runModalOpen             │
│ • selectedIds (Set)          ┌─────>• runEntries (Array)       │
│ • searchQuery                │      • checkedRun (Set)         │
│ • showHidden                 │      • randomFilter (Object)    │
│ • hideFinished               │      • draggedIndex             │
│ • selectedStageIds (Set)     │                                 │
└──────────────┬───────────────┴──────────────────────────────────┘
               │
               │ User Actions
               │
    ┌──────────┴──────────┐
    │                     │
    ▼                     ▼
┌─────────────────┐  ┌──────────────────┐
│ Main List       │  │ Prepare Run      │
│ Interactions    │  │ Modal            │
│                 │  │                  │
│ • Select items  │  │ • Reorder entries│
│ • Filter/search │  │ • Add/remove     │
│ • Edit details  │  │ • Configure run  │
│ • Add to run ───┼──┤ • Bulk moves     │
└─────────────────┘  └──────────────────┘
```

---

## Button State Decision Flow

### Add to Run Button (Main List)
```
                    ┌─ Disabled
numChecked === 0 ───┤
                    └─ Enabled ──> Click ──> Add games to runEntries
                                            └─> Clear selectedIds
```

### Move Up/Down Buttons (Modal)
```
checkedRunCount === 0 ───┬─ Disabled
                         │
firstRowChecked ─────────┼─ Disable Move Up
                         │
lastRowChecked ──────────┼─ Disable Move Down
                         │
                         └─ Enabled ──> Bulk move preserving order
```

### Per-Row Move Buttons (Modal)
```
index === 0 ──────────────── Disable ↑ button
index === lastIndex ─────────── Disable ↓ button
otherwise ───────────────────── Enable both
```

### Remove Button (Modal)
```
checkedRunCount === 0 ─── Disabled
checkedRunCount > 0 ───── Enabled ──> Remove ──> Filter & splice
                                              └─> Clear checkedRun
```

---

## Data Relationship Diagram

```
┌─────────────────┐
│   items[]       │  Main game list
│   (Item)        │
└────────┬────────┘
         │ 1:N
         │ references
         ▼
┌─────────────────┐
│ stagesByItemId  │  Stages per game
│ [itemId]: []    │
│   (Stage)       │
└─────────────────┘

         ┌────────────────────────┐
         │  selectedIds: Set      │  Current selection
         └────────────────────────┘

┌─────────────────┐
│  runEntries[]   │  Run list entries
│  (RunEntry)     │  (ordered array)
└────────┬────────┘
         │
         │ references Item.Id (for games)
         │ or Stage.key (for stages)
         │
         └──> Can include duplicates with different configs
              (e.g., same game with different seeds)

         ┌────────────────────────┐
         │  checkedRun: Set       │  Selected run entries
         └────────────────────────┘
```

---

## Visual State Indicators

### Main List Item States
```
┌─────────────────────────────────────────────────────────┐
│ Normal Item                                             │
│ ☐  │    │ 1234 │ Normal Game    │ ...                  │
├─────────────────────────────────────────────────────────┤
│ In Run (bolded name + *)                               │
│ ☐  │ *  │ 5678 │ **Game in Run**│ ...                  │
├─────────────────────────────────────────────────────────┤
│ Hidden (faded)                                          │
│ ☐  │    │ 9012 │ Hidden Game    │ ... (50% opacity)    │
├─────────────────────────────────────────────────────────┤
│ Finished (strikethrough)                                │
│ ☐  │    │ 3456 │ ~~Done Game~~  │ ...                  │
├─────────────────────────────────────────────────────────┤
│ Selected (checked)                                      │
│ ☑  │    │ 7890 │ Selected Game  │ ...                  │
└─────────────────────────────────────────────────────────┘
```

### Run List Entry States
```
┌─────────────────────────────────────────────────────────┐
│ Normal Entry                                            │
│ ☐│ 1 │ ↑  ↓  │ 1234 │ Game │ ...                       │
├─────────────────────────────────────────────────────────┤
│ Dragging (semi-transparent + blue bg)                  │
│ ☐│ 2 │ ↑  ↓  │ 5678 │ Game │ ... (50% opacity, blue)   │
├─────────────────────────────────────────────────────────┤
│ First Row (↑ disabled)                                  │
│ ☐│ 1 │ ✗  ↓  │ 9012 │ Game │ ...                       │
├─────────────────────────────────────────────────────────┤
│ Last Row (↓ disabled)                                   │
│ ☐│ 5 │ ↑  ✗  │ 3456 │ Game │ ...                       │
└─────────────────────────────────────────────────────────┘
```

---

## Keyboard & Mouse Interactions

### Main List
- **Click row (not checkbox)**: Single-select, clears others
- **Click checkbox**: Multi-select, preserves others
- **Click-drag**: No dragging (not implemented)
- **Keyboard**: Not implemented

### Run List Modal
- **Click row**: No default action
- **Click checkbox**: Multi-select
- **Click-drag row**: Reorder via drag-and-drop
- **Click ↑/↓ buttons**: Move single row
- **Keyboard**: Not implemented

---

## Future Integration Points

These elements are designed for future backend/IPC integration:

1. **Main List**
   - `items[]` - Load from database via IPC
   - `stagesByItemId` - Load per-game stages via IPC
   - "Start" button - Launch game via IPC

2. **Run Modal**
   - "Stage and Save" - Save run to local file
   - "Stage and Upload" - Upload run to server
   - "Add Random Game" - Query backend for random selection

3. **Settings**
   - "Open settings" button - Show settings dialog
   - Configure paths, launch options, etc.

---

## File Reference
- **Main Component**: `/electron/renderer/src/App.vue` (823 lines)
- **Documentation**: This file
- **Installation**: `/INSTALL.md`
- **Project README**: `/README.md`

