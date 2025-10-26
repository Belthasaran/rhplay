# RHTools Electron GUI - Component Reference

## Overview
The RHTools GUI is built with Electron + Vue 3 and consists of a main window with two primary views:
1. Main Game List View
2. Prepare Run Modal Dialog

---

## Main Window Layout

### 1. Toolbar (Top Header)
Location: Top of main window  
Purpose: Primary controls for filtering, selection, and bulk operations

#### Left Controls Section
- **Open settings** button
  - Purpose: Opens Settings modal dialog

- **USB2SNES Tools** button (conditional)
  - Visibility: Only shown when USB2SNES Enabled is set to "Yes" in Settings
  - Purpose: Opens USB2SNES Tools & Diagnostics modal
  - Features: Connection status, diagnostics, and quick actions
  
- **Search/Filters** dropdown button
  - Purpose: Opens dropdown dialog for search and filtering
  - Visual indicator: Shows blue highlight and dot when filters are active
  - Contains search textbox, filter tags, and syntax guide
  - Keyboard shortcut: Press `/` to open and focus search
  
- **Ignore** dropdown button
  - Purpose: Opens dropdown with visibility actions
  - Options:
    - **Hide checked**: Sets Hidden flag on selected items (disabled when no items selected)
    - **Unhide checked**: Clears Hidden flag on selected items (disabled when no items selected)
  
- **Select** dropdown button
  - Purpose: Opens dropdown with selection actions
  - Options:
    - **Check all**: Selects all visible (filtered) items (disabled when no items visible)
    - **Uncheck all**: Clears all selections
    - **Check random**: Randomly selects one visible item (disabled when no items visible)
  
- **Add to Run** button
  - State: Disabled when no items selected
  - Purpose: Adds selected games to run list (skips duplicates)
  - Behavior: Unchecks all after successful addition
  
- **Status for checked** dropdown + auto-apply
  - Options: Default, In Progress, Finished
  - State: Disabled when no items selected
  - Purpose: Bulk update Status field for selected items
  
- **Show hidden** checkbox toggle
  - Purpose: Toggles visibility of items marked as Hidden
  
- **Hide finished** checkbox toggle
  - Purpose: Toggles visibility of items with Status = "Finished"

#### Right Actions Section
- **Prepare Run** button
  - Purpose: Opens Prepare Run modal dialog
  
- **Start** button
  - State: Disabled unless exactly one item selected
  - Purpose: Launches selected game (placeholder)
  
- **Edit notes** button
  - State: Disabled unless exactly one item selected
  - Purpose: Opens prompt to edit My notes field
  
- **My rating** button
  - State: Disabled unless exactly one item selected
  - Purpose: Opens prompt to set My rating (0-5)

---

### 2. Main Game List (Center Panel)
Location: Center-left of main window  
Purpose: Displays searchable/filterable list of all games

#### Table Columns
1. **Checkbox column** (col-check)
   - Header: Select all visible checkbox
   - Rows: Individual selection checkboxes
   - Behavior: Multi-select support; click propagates

2. **Action column**
   - Purpose: Shows "*" if game is in current run list
   - Visual: Games in run list have bolded names

3. **Id** - Game identifier

4. **Name** - Game title
   - Visual: Bold by default; extra bold if in run list
   - Visual: Strike-through if Status = "Finished"

5. **Type** - Game difficulty/category

6. **Author** - Creator name

7. **Length** - Number of exits/levels

8. **Status** - Current play status
   - Values: Default, In Progress, Finished

9. **My rating** - User's rating (0-5)

10. **Public rating** - Community rating

11. **Hidden** - Yes/No visibility flag

12. **My notes** - User's personal notes

#### Row Behaviors
- **Click row**: Single-select (clears others, selects clicked)
- **Click checkbox**: Multi-select (preserves other selections)
- **Visual states**:
  - Hidden items: Reduced opacity
  - Finished items: Strike-through name
  - Items in run: Bolded name + "*" in Action column

---

### 3. Details Panel (Right Sidebar - Top)
Location: Right sidebar, top panel  
Visibility: Only when exactly one item selected  
Purpose: View/edit all attributes of selected game

#### Editable Fields
- **Id** - Read-only display
- **Name** - Text input
- **Type** - Text input
- **Author** - Text input
- **Length** - Text input
- **Status** - Dropdown (Default, In Progress, Finished)
- **My rating** - Number input (0-5, step 0.5)
- **Public rating** - Number input (0-5, step 0.1)
- **Hidden** - Checkbox
- **My notes** - Textarea (4 rows)

---

### 4. Stages Panel (Right Sidebar - Bottom)
Location: Right sidebar, below Details panel  
Visibility: Only when exactly one item selected  
Purpose: Manage individual stages/exits within selected game

#### Toolbar Actions
- **Add chosen stages to run** button
  - State: Disabled when no stages selected
  - Purpose: Adds selected stages to run list
  
- **Edit notes** button
  - State: Disabled when no stages selected
  - Purpose: Bulk edit notes for selected stages
  
- **My rating** button
  - State: Disabled when no stages selected
  - Purpose: Bulk set rating for selected stages

#### Stages Table Columns
1. **Checkbox column** - Multi-select stages
   - Header: Select all stages checkbox
2. **Parent ID** - Game identifier
3. **Exit #** - Stage/exit number
4. **Description** - Stage description
5. **Rating** - Public/community rating
6. **My notes** - User notes for this stage
7. **My rating** - User rating for this stage

---

## Settings Modal Dialog

### Modal Structure
- **Header**
  - Title: "Settings"
  - Close (✕) button - Closes modal without saving

### Settings Sections

#### 1. Import required Vanilla SMW ROM
- **Purpose**: Import the base Super Mario World ROM file required for patching
- **Controls**:
  - Drag-and-drop zone for file import
  - Browse button to open file picker
- **Validation**: Green checkmark (✓) shown when valid ROM found
- **Caption**: Legal notice and acceptable file checksums
  - SHA-224: `fdc4c00e09a8e08d395003e9c8a747f45a9e5e94cbfedc508458eb08`
  - SHA-1: `6b47bb75d16514b6a476aa0c73a683a2a4c18765`
  - MD5: `cdd3c8c37322978ca8669b34bc89c804`

#### 2. Import FLIPS executable
- **Purpose**: Import Floating IPS patcher for applying patches
- **Controls**: Drag-and-drop zone + Browse button
- **Validation**: Green checkmark (✓) when found
- **Link**: https://www.gamebrew.org/wiki/Floating_IPS

#### 3. Game launch method
- **Purpose**: Choose how games are launched
- **Options**:
  - Launch Manually
  - Run Launch Program
  - Launch from USB2Snes

#### 4. Launch Program
- **Purpose**: Path to external launch program (e.g., RetroArch, emulator)
- **Controls**: Drag-and-drop zone + Browse button
- **Type**: File path
- **Default**: Empty
- **Display**: Shows current path below the controls when set

#### 5. Launch Program Arguments
- **Purpose**: Command-line arguments for launch program
- **Type**: Text input
- **Default**: `%file` (placeholder for ROM file path)

#### 6. USB2snes Websocket address
- **Purpose**: WebSocket URL for USB2SNES server connection
- **Type**: Text input
- **Default**: `ws://localhost:64213`
- **Warning**: Requires USB2SNES server running (https://usb2snes.com/)

#### 7. USB2SNES Enabled
- **Purpose**: Enable/disable USB2SNES functionality
- **Options**: Yes, No
- **Default**: No

#### 8. USB2SNES Launch Preference
- **Purpose**: Control how games are launched via USB2SNES
- **Options**:
  - Launch Automatically
  - Manual Launch (Do nothing)
  - Manual Launch (Reset console)
- **Default**: Launch Automatically

#### 9. USB2SNES Upload Preference
- **Purpose**: Control file upload behavior to console
- **Options**:
  - Manual Transfer (do not upload)
  - Check first and Upload
  - Always Upload
- **Default**: Manual Transfer

#### 10. USB2SNES Upload Directory
- **Purpose**: Target directory on console for uploads
- **Type**: Text input
- **Default**: `/work`

#### 11. Import ASAR executable
- **Purpose**: Import ASAR assembler for custom ASM patches
- **Controls**: Drag-and-drop zone + Browse button
- **Validation**: Green checkmark (✓) when found
- **Link**: https://smwc.me/s/37443

#### 12. Import UberASM executable
- **Purpose**: Import UberASM tool for level-specific code
- **Controls**: Drag-and-drop zone + Browse button
- **Validation**: Green checkmark (✓) when found
- **Link**: https://smwc.me/s/39036

### Footer
- **Save Changes and Close** button
  - Purpose: Saves all settings and closes modal
  - Style: Primary blue button

---

## Prepare Run Modal Dialog

### Modal Structure
- **Header**
  - Title: "Prepare Run"
  - Right actions:
    - **Stage and Save** button - Saves run configuration
    - **Stage and Upload** button - Uploads run configuration
    - **Close (✕)** button - Closes modal

### Toolbar (Below Header)

#### Left Section - List Management
- **Check All** button
  - Purpose: Selects all run entries
  
- **Uncheck All** button
  - Purpose: Clears all run entry selections
  
- **Remove** button
  - State: Disabled when no entries selected
  - Purpose: Removes selected entries from run list
  
- **↑ Move Up** button
  - State: Disabled when first row is checked or no selection
  - Purpose: Moves all checked entries up one position
  - Behavior: Preserves relative order of checked items
  
- **↓ Move Down** button
  - State: Disabled when last row is checked or no selection
  - Purpose: Moves all checked entries down one position
  - Behavior: Preserves relative order of checked items

#### Right Section - Add Random Game
- **Filter Type** dropdown
  - Options: Any, Standard, Kaizo, Traditional
  
- **Difficulty** dropdown
  - Options: Any, Beginner, Intermediate, Expert
  
- **Filter pattern** text input
  - Purpose: Optional text pattern for filtering random selection
  - Size: ~16 characters
  
- **Count** number input
  - Range: 1-100
  - Purpose: Number of random games to add
  - Validation: Required for Add Random Game button
  
- **Seed** text input
  - Purpose: Random seed for reproducible selection
  - Default: Auto-generated random seed on modal open
  - Size: ~8 characters
  
- **Add Random Game** button
  - State: Disabled when Count invalid (not 1-100)
  - Purpose: Adds random game entry with specified filters

---

### Run List Table

#### Table Columns

1. **Checkbox column** (col-check)
   - Header: Select all entries checkbox
   - Purpose: Multi-select for bulk operations
   
2. **# column** (col-seq)
   - Purpose: Shows sequence number (1, 2, 3...)
   - Visual: Bold, centered, gray color
   
3. **Actions column** (col-actions)
   - **↑ button** - Move entry up one position
     - State: Disabled for first row
   - **↓ button** - Move entry down one position
     - State: Disabled for last row
   
4. **ID** - Game/entry identifier
   - Display: Read-only text
   
5. **Entry Type** - Dropdown
   - Options: Game, Stage
   - Purpose: Distinguishes between full games and individual stages
   
6. **Name** - Entry name
   - Display: Read-only text
   
7. **Stage #** - Stage number
   - Display: Read-only text
   - Relevance: Only for Stage entry types
   
8. **Stage name** - Stage description
   - Display: Read-only text
   - Relevance: Only for Stage entry types
   
9. **Count** (col-count) - Number input
   - Purpose: How many times to run this entry
   - Size: ~3 digits (60px input)
   
10. **Filter difficulty** - Dropdown
    - Options: (empty), Beginner, Intermediate, Expert
    - Relevance: For random game entries
    
11. **Filter type** - Dropdown
    - Options: (empty), Standard, Kaizo, Traditional
    - Relevance: For random game entries
    
12. **Filter pattern** (col-pattern) - Text input
    - Purpose: Pattern for random selection
    - Size: ~16 characters (200px input)
    
13. **Seed** (col-seed) - Text input
    - Purpose: Random seed for this entry
    - Size: ~8 characters (90px input)

#### Row Behaviors
- **Draggable**: All rows can be dragged to reorder
  - Visual: Cursor changes to "move"
  - Visual: Dragged row becomes semi-transparent with blue background
- **Drop zones**: Can drop on any row to insert before it
- **Per-row move buttons**: Quick up/down without selecting

---

## Data Model Relationships

### Main List Item
```typescript
{
  Id: string
  Name: string
  Type: string
  Author: string
  Length: string
  Status: 'Default' | 'In Progress' | 'Finished'
  Myrating?: number (0-5)
  Publicrating?: number (0-5)
  Hidden: boolean
  Mynotes?: string
}
```

### Stage
```typescript
{
  key: string (unique: parentId-exitNumber)
  parentId: string (references Item.Id)
  exitNumber: string
  description: string
  publicRating?: number
  myNotes?: string
  myRating?: number
}
```

### Run Entry
```typescript
{
  key: string (unique identifier)
  id: string (game/stage ID)
  entryType: 'game' | 'stage'
  name: string
  stageNumber?: string
  stageName?: string
  count: number (1-100)
  filterDifficulty?: '' | 'beginner' | 'intermediate' | 'expert'
  filterType?: '' | 'standard' | 'kaizo' | 'traditional'
  filterPattern?: string
  seed?: string
}
```

---

## State Management

### Main View State
- `items`: Array of all games
- `selectedIds`: Set of selected game IDs
- `searchQuery`: Current filter text
- `showHidden`: Boolean toggle
- `hideFinished`: Boolean toggle
- `selectedStageIds`: Set of selected stage keys

### Settings Modal State
- `settingsModalOpen`: Boolean visibility flag
- `settings`: Object containing all configuration values
  - `vanillaRomValid`: Boolean - ROM file validation status
  - `flipsValid`: Boolean - FLIPS executable validation status
  - `asarValid`: Boolean - ASAR executable validation status
  - `uberAsmValid`: Boolean - UberASM executable validation status
  - `launchMethod`: 'manual' | 'program' | 'usb2snes'
  - `launchProgram`: String - Path to launch program
  - `launchProgramArgs`: String - Launch arguments (default: '%file')
  - `usb2snesAddress`: String - WebSocket URL (default: 'ws://localhost:64213')
  - `usb2snesEnabled`: 'yes' | 'no'
  - `usb2snesLaunchPref`: 'auto' | 'manual' | 'reset'
  - `usb2snesUploadPref`: 'manual' | 'check' | 'always'
  - `usb2snesUploadDir`: String - Upload directory (default: '/work')

### Run Modal State
- `runModalOpen`: Boolean visibility flag
- `runEntries`: Array of run entries (ordered)
- `checkedRun`: Set of checked run entry keys
- `randomFilter`: Object with filter settings
- `draggedIndex`: Currently dragged row index (null when not dragging)

---

## Computed Properties

### Main View
- `filteredItems`: Items matching search and toggle filters
- `hasActiveFilters`: True if any filter is active
- `numChecked`: Count of selected items
- `exactlyOneSelected`: True if exactly one item selected
- `allVisibleChecked`: True if all visible items selected
- `selectedItem`: The single selected item (or null)
- `currentStages`: Stages for selected item
- `allStagesChecked`: True if all stages selected

### Run Modal
- `allRunChecked`: True if all run entries selected
- `checkedRunCount`: Count of checked run entries
- `isRandomAddValid`: True if Count is valid (1-100)
- `canMoveCheckedUp`: True if checked entries can move up
- `canMoveCheckedDown`: True if checked entries can move down

---

## Key Interaction Flows

### Adding Games to Run
1. User selects games in main list (checkboxes)
2. Click "Add to Run" button
3. System checks for duplicates (by game ID)
4. New run entries created for non-duplicate games
5. All selections cleared
6. Games appear with "*" in Action column

### Reordering Run Entries
**Method 1: Per-row buttons**
- Click ↑ or ↓ button on specific row
- Entry swaps with adjacent entry

**Method 2: Drag and drop**
- Click and drag row to new position
- Visual feedback during drag
- Drop to insert at new position

**Method 3: Bulk move**
- Check multiple entries
- Click "↑ Move Up" or "↓ Move Down" in toolbar
- All checked entries move together, preserving relative order

### Filtering and Selection
1. Type in search box → immediate filter
2. Toggle "Show hidden" or "Hide finished" → filter updates
3. "Check all" → selects all visible (filtered) items
4. Individual checkbox → adds/removes from selection
5. Click row → exclusive selection (clears others)

---

## Version Notes
- Current implementation uses demo/mock data
- Backend integration (IPC) is placeholder for:
  - File import and validation (ROM, FLIPS, ASAR, UberASM)
  - Settings persistence
  - Game launching
  - USB2SNES communication
- "Start" functionality not yet implemented
- Stage and Save/Upload actions are placeholders

