# GameStagesDialog Component Architecture

**Date**: January 2025  
**Component**: `electron/renderer/src/components/GameStagesDialog.vue`  
**Purpose**: Comprehensive documentation of the Game Stages editing and selection dialog system

---

## Table of Contents

1. [Overview](#overview)
2. [Component Modes](#component-modes)
3. [Submission Draft Mode vs Database Admin Mode](#submission-draft-mode-vs-database-admin-mode)
4. [Stage Visibility and Filtering](#stage-visibility-and-filtering)
5. [Stage Selection Behavior](#stage-selection-behavior)
6. [Notes and Tags Viewing](#notes-and-tags-viewing)
7. [Set Playlevel Patch Dialog](#set-playlevel-patch-dialog)
8. [Component Props and State](#component-props-and-state)
9. [Key Functions](#key-functions)
10. [Recent Updates and Changes](#recent-updates-and-changes)

---

## Overview

The `GameStagesDialog` component provides a comprehensive interface for viewing, editing, and selecting game stages. It supports multiple modes of operation:

- **Select Mode**: For selecting stages to add to runs
- **Edit Mode**: For editing stage data (requires DEVADMIN or submission author mode)
- **View-Only Mode**: For viewing stages without editing capabilities

The component can operate in two distinct contexts:
1. **Database Admin Mode**: Editing stages in the production SQL database (requires DEVADMIN)
2. **Submission Draft Mode**: Editing stages in a submission draft (no database access)

---

## Component Modes

### Select Mode (`mode: 'select'`)

**Purpose**: Allows users to select one or more stages for adding to runs.

**Features**:
- Checkbox column for multi-selection
- "Select" button to choose highlighted stage
- "Add Stages to Run" button for bulk selection
- Stage highlighting on row click

**Behavior**:
- Locked stages are visible but not selectable (checkbox disabled, row click prevented)
- Secret stages are hidden (unless also in edit mode)
- Locked + Secret stages are hidden

### Edit Mode (`mode: 'edit'`)

**Purpose**: Allows full editing of stage data.

**Requirements**:
- DEVADMIN mode enabled (`DEVADMIN=1` or `csetting DEVADMIN=1`), OR
- Submission author mode (`forceAuthorMode: true`)

**Features**:
- All fields editable
- Add/Delete stages
- Import/Export CSV
- Set playlevel patches
- Edit extra descriptions and tags

### View-Only Mode

**Purpose**: Display stages without editing capabilities.

**Behavior**:
- All fields read-only
- Locked stages visible but not selectable
- Secret stages show "-" for values
- Notes and Tags viewable for locked stages (unless also secret)

---

## Submission Draft Mode vs Database Admin Mode

### Key Distinction

**Database Admin Mode**:
- Stages are saved directly to the `gamestages` SQL database table
- Requires DEVADMIN mode to be enabled
- Changes are permanent and affect the production database
- Stages have `stage_uuid` identifiers

**Submission Draft Mode**:
- Stages exist only in the submission draft (`meta.gamestages` array)
- No database interaction whatsoever
- Changes are saved to the draft JSON, not the database
- Stages may not have `stage_uuid` (they're draft data)
- Activated when `forceAuthorMode: true` prop is set

### Implementation Details

#### Props

```typescript
interface Props {
  isOpen: boolean;
  gameId: string;
  gameName?: string;
  gameVersion?: number | null;
  mode?: 'select' | 'edit';
  initialLevelNumber?: string | null;
  showAddToRunButton?: boolean;
  forceAuthorMode?: boolean; // Activates submission draft mode
  draftStages?: GameStage[] | null; // Draft stages for submission authoring
}
```

#### Mode Detection

The component determines its mode using:

```typescript
const canEdit = computed(() => {
  return (isDevAdmin.value || props.forceAuthorMode) && currentMode.value === 'edit';
});
```

#### Dialog Title

The dialog title reflects the current mode:

- **"Edit Game Stages (Database Admin Mode)"**: When `isDevAdmin && currentMode === 'edit'`
- **"Edit Game Stages (Submission Draft Mode)"**: When `forceAuthorMode && currentMode === 'edit'`
- **"Select Game Stage"**: When `currentMode === 'select'`
- **"Game Stages"**: When in view-only mode

#### Loading Stages

**Draft Mode** (`forceAuthorMode === true`):
```typescript
if (props.forceAuthorMode) {
  stages.value = JSON.parse(JSON.stringify(props.draftStages || [])) || [];
  // No database query
}
```

**Database Mode**:
```typescript
const result = await api.getGameStages({
  gameid: props.gameId,
  version: props.gameVersion || null,
});
stages.value = result.stages || [];
```

#### Saving Stages

**Draft Mode** (`forceAuthorMode === true`):
```typescript
if (props.forceAuthorMode) {
  // Calculate translevel for all stages
  const draftStages = stages.value.map(stage => {
    const stageCopy = { ...stage };
    stageCopy.translevel_13bf = calculateTranslevel(stageCopy);
    // Remove stage_uuid and other database-only fields
    const { stage_uuid, rhpakuuid, ...draftStage } = stageCopy;
    return draftStage;
  });
  
  // Emit stages back to parent to save in draft
  emit('draft-stages-saved', draftStages);
  emit('saved');
  return; // No database save
}
```

**Database Mode**:
```typescript
for (const stage of stages.value) {
  const result = await api.saveGameStage({
    stage_uuid: stage.stage_uuid || null,
    // ... all stage fields
  });
}
```

#### Deleting Stages

**Draft Mode**:
```typescript
if (props.forceAuthorMode) {
  const index = stages.value.indexOf(stage);
  if (index >= 0) {
    stages.value.splice(index, 1);
  }
  return; // No database delete
}
```

**Database Mode**:
```typescript
const result = await api.deleteGameStage({ stage_uuid: stage.stage_uuid });
```

---

## Stage Visibility and Filtering

### Filter Logic

The `filteredStages` computed property controls which stages are displayed:

```typescript
const filteredStages = computed(() => {
  if (currentMode.value === 'edit' || canEdit.value) {
    // In edit mode, show all stages
    return stages.value;
  }
  
  // In view-only mode:
  // - Locked-only stages: visible (just disabled)
  // - Secret-only stages: visible (show "-" for values)
  // - Only hide stages that are BOTH locked AND secret
  return stages.value.filter(stage => {
    return !(stage.lock === 1 && stage.secret === 1);
  });
});
```

### Visibility Rules

| Stage Type | Edit Mode | View-Only Mode | Select Mode |
|------------|-----------|----------------|-------------|
| Normal | ✅ Visible | ✅ Visible | ✅ Visible & Selectable |
| Locked Only | ✅ Visible | ✅ Visible (disabled) | ✅ Visible (not selectable) |
| Secret Only | ✅ Visible | ✅ Visible (shows "-") | ❌ Hidden |
| Locked + Secret | ✅ Visible | ❌ Hidden | ❌ Hidden |

### Secret Stage Display

When a stage is marked as secret (`secret === 1`) and not in edit mode:
- Level number: Shows "-"
- Level name: Shows "-"
- Translevel: Shows "-"
- Submap ID: Shows "-"
- Tile X/Y: Shows "-"
- Requisites: Shows "-"
- Playlevel Patch: Shows "-"
- Excluded Patch Codes: Shows "-"
- Difficulty: Shows "-"

---

## Stage Selection Behavior

### Selection Prevention

Locked stages cannot be selected in view-only mode:

```typescript
function selectStage(stage: GameStage) {
  if (currentMode.value === 'select') {
    // Don't allow selection of locked stages in view-only mode
    if (stage.lock === 1 && currentMode.value !== 'edit') {
      // If already selected, unselect it
      const stageUuid = stage.stage_uuid || '';
      if (selectedStageUuids.value.has(stageUuid)) {
        selectedStageUuids.value.delete(stageUuid);
      }
      // Clear highlighted stage
      if (selectedStageUuid.value === stage.stage_uuid) {
        selectedStageUuid.value = null;
      }
      return;
    }
    // ... selection logic
  }
}
```

### Checkbox State

Locked stages have disabled checkboxes:

```html
<input 
  type="checkbox" 
  :checked="selectedStageUuids.has(stage.stage_uuid || '')"
  :disabled="stage.lock === 1 && currentMode !== 'edit'"
  @change.stop="toggleStageSelection(stage)"
/>
```

### Row Click Behavior

Clicking a locked stage row in view-only mode:
1. Prevents selection
2. Unselects if already selected
3. Clears highlighted stage

---

## Notes and Tags Viewing

### Viewing Rules

Notes (Extra Description) and Stage Tags can be viewed for locked stages in view-only mode, **unless the stage is also marked as Secret**.

### Implementation

```typescript
// Check if Notes and Tags can be viewed for a stage
function canViewNotesAndTags(stage: GameStage): boolean {
  // In edit mode, can always view
  if (currentMode.value === 'edit' || canEdit.value) return true;
  // In view-only mode, can view unless stage is secret
  return stage.secret !== 1;
}
```

### Button Visibility

The Notes (📝) and Tags (🏷️) buttons are shown when:

```html
<button 
  v-if="canEdit || canViewNotesAndTags(stage)"
  @click.stop="openExtraDescriptionDialog(stage)" 
  class="btn-icon btn-memo"
  title="Edit/View Extra Description"
>
  📝
</button>
```

### Actions Cell Visibility

The actions cell (containing Test, Notes, Tags buttons) is shown when:

```html
<td v-if="canEdit || (currentMode === 'select' && (canTestStage(stage) || canViewNotesAndTags(stage)))" 
    class="actions-cell">
```

This ensures:
- Test button: Only shown if stage can be tested
- Notes button: Shown if editable OR viewable (not secret)
- Tags button: Shown if editable OR viewable (not secret)

### Dialog Read-Only State

When viewing Notes or Tags in view-only mode:

```html
<textarea 
  v-model="editingExtraDescriptionText" 
  :readonly="!canEdit"
/>
```

The dialogs are automatically read-only when `!canEdit`, so locked stages can view but not edit.

---

## Set Playlevel Patch Dialog

### Purpose

Allows bulk setting of playlevel patch codes for multiple stages.

### Draft Stage Support

The dialog now works with draft stages that may not have `stage_uuid`:

```typescript
// Helper function to get a unique identifier for a stage
function getStageIdentifier(stage: GameStage, index: number): string {
  if (stage.stage_uuid) {
    return stage.stage_uuid;
  }
  // For draft stages without stage_uuid, use a combination of levelname and levelnumber
  return `${stage.levelname || 'stage'}_${stage.levelnumber || index}`;
}
```

### Selection Logic

All selection functions use the identifier system:

```typescript
function openSetPlaylevelPatchDialog() {
  selectedStagesForPlaylevelPatch.value = new Set(
    stages.value.map((s, index) => getStageIdentifier(s, index))
  );
}

function toggleStageForPlaylevelPatch(stage: GameStage, index: number) {
  const identifier = getStageIdentifier(stage, index);
  // ... toggle logic
}
```

### Saving Behavior

**Draft Mode**:
```typescript
if (props.forceAuthorMode) {
  // Apply patch codes to local stages
  for (const stageIdentifier of selectedStagesForPlaylevelPatch.value) {
    const stage = stages.value.find((s, index) => 
      getStageIdentifier(s, index) === stageIdentifier
    );
    if (stage) {
      stage.playlevel_patch_code = patchCode === '2lvno' ? null : patchCode;
    }
  }
  closeSetPlaylevelPatchDialog();
  return; // No database save - changes saved when main "Save" is clicked
}
```

**Database Mode**:
```typescript
// Save each stage to database
for (const stageIdentifier of selectedStagesForPlaylevelPatch.value) {
  const stage = stages.value.find((s, index) => 
    getStageIdentifier(s, index) === stageIdentifier
  );
  if (stage && stage.stage_uuid) {
    await api.saveGameStage({ /* ... */ });
  }
}
```

---

## Component Props and State

### Props

```typescript
interface Props {
  isOpen: boolean;                    // Dialog visibility
  gameId: string;                     // Game identifier
  gameName?: string;                  // Display name
  gameVersion?: number | null;        // Game version
  mode?: 'select' | 'edit';          // Dialog mode
  initialLevelNumber?: string | null; // Initial selection
  showAddToRunButton?: boolean;      // Show "Add to Run" button
  forceAuthorMode?: boolean;         // Submission draft mode
  draftStages?: GameStage[] | null;  // Draft stages data
}
```

### Key State Variables

```typescript
const currentMode = ref<'select' | 'edit'>(props.mode || 'select');
const stages = ref<GameStage[]>([]);
const selectedStageUuid = ref<string | null>(null);
const selectedStageUuids = ref<Set<string>>(new Set());
const loading = ref(false);
const saving = ref(false);
const isDevAdmin = ref(false);
```

### GameStage Interface

```typescript
interface GameStage {
  stage_uuid?: string;              // Database UUID (may be absent in drafts)
  gameid: string;
  levelnumber?: string | null;      // 3-digit hex string (000-13C)
  levelname: string;
  versions?: string;
  submapid?: string | null;
  translevel_13bf?: string | null;  // Hex string
  tile_x?: string | null;
  tile_y?: string | null;
  tile_value?: string | null;
  requisites?: string | null;
  playable: number;
  rando: number;
  difficulty: number;
  mainexit: number;
  keyhole: number;
  credits: number;
  water: number;
  ghouse: number;
  spalace: number;
  castle: number;
  boss: number;
  secret: number;
  troll: number;
  final: number;
  lock?: number;                    // Lock flag - level only accessible in Edit mode
  playlevel_patch_code?: string | null;
  excluded_patchcodes?: string | null;
  extradescription?: string | null; // Notes/Extra Description
  stagetags?: string | null;        // Comma-separated tags
}
```

---

## Key Functions

### Stage Loading

**`loadStages()`**
- Checks if in draft mode (`forceAuthorMode`)
- Draft mode: Loads from `props.draftStages` (no database)
- Database mode: Calls `api.getGameStages()`
- Restores scroll position after load

### Stage Saving

**`saveAll()`**
- Draft mode: Emits `draft-stages-saved` event with stages (no database)
- Database mode: Saves each stage via `api.saveGameStage()`
- Calculates `translevel_13bf` for all stages before saving

### Stage Selection

**`selectStage(stage)`**
- Prevents selection of locked stages in view-only mode
- Unselects locked stages if already selected
- Toggles selection in `selectedStageUuids` set
- Sets highlighted stage

**`toggleStageSelection(stage)`**
- Same logic as `selectStage` but for checkbox clicks
- Prevents selection of locked stages

### Stage Testing

**`canTestStage(stage)`**
- Returns `false` if:
  - Stage is secret
  - Stage is locked and not in edit mode
  - Difficulty > 8
- Returns `true` otherwise

### Stage Visibility

**`canViewNotesAndTags(stage)`**
- Returns `true` if:
  - In edit mode, OR
  - Stage is not secret
- Returns `false` if stage is secret in view-only mode

### Stage Filtering

**`filteredStages` (computed)**
- Edit mode: Returns all stages
- View-only mode: Hides only stages that are BOTH locked AND secret
- All other stages are visible

---

## Recent Updates and Changes

### January 2025: Submission Draft Mode Implementation

**Problem**: Submission authors were trying to save stages to the database, causing DEVADMIN errors.

**Solution**: Implemented complete separation between draft and database modes:

1. **Added `draftStages` prop**: Pass draft stages directly to dialog
2. **Updated `loadStages()`**: Load from prop in draft mode, database in normal mode
3. **Updated `saveAll()`**: Emit stages to parent in draft mode, save to database in normal mode
4. **Updated `deleteStage()`**: Remove from local array in draft mode, call API in normal mode
5. **Added `draft-stages-saved` event**: Emit stages back to parent for draft saving
6. **Updated dialog title**: Show "(Submission Draft Mode)" or "(Database Admin Mode)"

**Files Modified**:
- `electron/renderer/src/components/GameStagesDialog.vue`
- `electron/renderer/src/components/submit/GameSubmissionDashboard.vue`
- `electron/ipc-handlers.js` (updated comment, no functional change)

### January 2025: Locked Stage Visibility Fix

**Problem**: Locked stages were being hidden in view-only mode, but should be visible (just not selectable).

**Solution**: Updated filter to only hide stages that are BOTH locked AND secret:

```typescript
// Before: Hide all locked stages
return stages.value.filter(stage => !stage.lock || stage.lock === 0);

// After: Only hide if both locked AND secret
return stages.value.filter(stage => {
  return !(stage.lock === 1 && stage.secret === 1);
});
```

**Files Modified**:
- `electron/renderer/src/components/GameStagesDialog.vue`

### January 2025: Locked Stage Selection Prevention

**Problem**: Locked stages could be selected by clicking the row, even though checkbox was disabled.

**Solution**: Updated `selectStage()` and `toggleStageSelection()` to:
1. Check if stage is locked and not in edit mode
2. Prevent selection
3. Unselect if already selected
4. Clear highlighted stage

**Files Modified**:
- `electron/renderer/src/components/GameStagesDialog.vue`

### January 2025: Notes and Tags Viewing for Locked Stages

**Problem**: Notes and Tags buttons were hidden for locked stages in view-only mode.

**Solution**: 
1. Added `canViewNotesAndTags()` function
2. Updated actions cell visibility condition
3. Made Notes and Tags buttons conditional on `canViewNotesAndTags()`

**Behavior**:
- Locked stages (not secret): Can view Notes and Tags
- Locked + Secret stages: Cannot view Notes and Tags
- Secret-only stages: Cannot view Notes and Tags

**Files Modified**:
- `electron/renderer/src/components/GameStagesDialog.vue`

### January 2025: Set Playlevel Patch Dialog Draft Support

**Problem**: Dialog was using `stage_uuid` to identify stages, which doesn't work for draft stages.

**Solution**:
1. Added `getStageIdentifier()` helper function
2. Updated all selection functions to use identifier system
3. Updated `applyPlaylevelPatch()` to skip database save in draft mode

**Files Modified**:
- `electron/renderer/src/components/GameStagesDialog.vue`

---

## Integration with Parent Components

### GameSubmissionDashboard Integration

When opening the stages editor from a submission draft:

```vue
<GameStagesDialog
  :is-open="showStagesDialog"
  :game-id="current?.meta?.gameid || 'draft'"
  :game-name="current?.meta?.name || 'Draft Submission'"
  :game-version="current?.meta?.version || 1"
  mode="edit"
  :force-author-mode="true"
  :draft-stages="current?.meta?.gamestages || []"
  @close="showStagesDialog = false"
  @saved="handleStagesSaved"
  @draft-stages-saved="handleDraftStagesSaved"
/>
```

**Event Handlers**:

```typescript
function handleDraftStagesSaved(stages: any[]) {
  // Stages were saved directly to draft (no database interaction)
  current.value.meta.gamestages = stages;
  saveDraftToDb(); // Save draft to database
}

async function handleStagesSaved() {
  // Called after draft-stages-saved event
  // Stages are already stored in draft
}
```

**Important**: The parent component does NOT:
- Save stages to database temporarily
- Load stages from database
- Delete stages from database

All interaction is with the draft data only.

---

## Testing Considerations

### Draft Mode Testing

1. **Open stages editor from submission draft**
   - Verify stages load from `draftStages` prop
   - Verify dialog title shows "(Submission Draft Mode)"
   - Verify no database queries are made

2. **Edit stages in draft mode**
   - Add new stage
   - Edit existing stage
   - Delete stage
   - Verify changes are only in local state

3. **Save stages in draft mode**
   - Click "Save" button
   - Verify `draft-stages-saved` event is emitted
   - Verify no `saveGameStage` API calls are made
   - Verify parent receives stages and saves to draft

4. **Set playlevel patch in draft mode**
   - Open "Set Playlevel Patch" dialog
   - Select stages (including draft stages without UUID)
   - Apply patch code
   - Verify changes are in local state only
   - Verify no database saves

### Locked Stage Testing

1. **View-only mode with locked stages**
   - Verify locked stages are visible
   - Verify checkboxes are disabled
   - Verify row clicks don't select locked stages
   - Verify clicking locked stage unselects it if already selected

2. **Locked + Secret stages**
   - Verify they are hidden in view-only mode
   - Verify they are visible in edit mode

3. **Notes and Tags on locked stages**
   - Verify Notes button is visible for locked (not secret) stages
   - Verify Tags button is visible for locked (not secret) stages
   - Verify dialogs open in read-only mode
   - Verify Notes/Tags buttons are hidden for secret stages

### Database Mode Testing

1. **DEVADMIN mode**
   - Verify dialog title shows "(Database Admin Mode)"
   - Verify stages load from database
   - Verify saves go to database
   - Verify deletes go to database

---

## Future Work Considerations

### Potential Enhancements

1. **Bulk Operations**: Add bulk edit capabilities for multiple stages
2. **Stage Validation**: Add validation for stage data before saving
3. **Stage Templates**: Allow creating stages from templates
4. **Import/Export**: Enhance CSV import/export with more fields
5. **Stage History**: Track changes to stages (audit log)

### Known Limitations

1. **Draft Stage UUIDs**: Draft stages don't have UUIDs, which can complicate some operations
2. **Concurrent Editing**: No support for concurrent editing of the same draft
3. **Validation**: Limited validation of stage data before saving
4. **Performance**: Large numbers of stages (>100) may have performance issues

### Migration Notes

If migrating stages from draft to database:
1. Ensure all required fields are present
2. Generate UUIDs for stages
3. Calculate `translevel_13bf` if not present
4. Validate data before database insert

---

## Related Files

- **Component**: `electron/renderer/src/components/GameStagesDialog.vue`
- **Parent (Submission)**: `electron/renderer/src/components/submit/GameSubmissionDashboard.vue`
- **IPC Handlers**: `electron/ipc-handlers.js` (handlers: `gamestages:save`, `gamestages:delete`, `gamestages:get`)
- **Preload**: `electron/preload.js` (exposes `saveGameStage`, `deleteGameStage`, `getGameStages`)

---

## Summary

The GameStagesDialog component is a complex, multi-mode dialog system that supports:

- **Two distinct modes**: Database admin mode (production) and submission draft mode (temporary)
- **Three operation modes**: Select, Edit, and View-only
- **Complex visibility rules**: Based on lock and secret flags
- **Draft stage support**: Works with stages that don't have database UUIDs
- **Flexible viewing**: Notes and Tags viewable for locked stages (unless secret)

All recent updates have focused on:
1. Separating draft and database operations completely
2. Improving locked stage visibility and behavior
3. Supporting draft stages in all sub-dialogs
4. Making Notes and Tags accessible for locked stages

When working on this component in the future, always consider:
- Which mode the dialog is in (draft vs database)
- Whether stages have UUIDs (draft stages may not)
- The lock and secret status of stages
- The current operation mode (select, edit, view-only)

