# Launch Program Browse & Drag-Drop Feature

## Overview

Enhanced the "Launch Program" setting in the Settings dialog to support file browsing and drag-and-drop functionality, matching the user experience of the FLIPS executable configuration.

## Changes Made

### Before
The Launch Program setting only had a text input field where users had to manually type or paste the file path.

```
Launch Program: [________________________]
                (text input only)
```

### After
The Launch Program setting now has:
- **Drag-and-Drop Zone**: Visual drop zone for dragging files
- **Browse Button**: Native file dialog for selecting files
- **Current Path Display**: Shows the currently configured path

```
Launch Program: [Drag program file here] [Browse]
                Current: /path/to/program
```

## Implementation Details

### UI Components (App.vue)

**HTML Template:**
```vue
<div class="settings-section">
  <div class="setting-row">
    <label class="setting-label">Launch Program</label>
    <div class="setting-control">
      <div 
        class="drop-zone"
        @dragover.prevent
        @drop.prevent="handleLaunchProgramDrop"
      >
        Drag program file here
      </div>
      <button @click="browseLaunchProgram">Browse</button>
    </div>
  </div>
  <div v-if="settings.launchProgram" class="setting-current-path">
    Current: <code>{{ settings.launchProgram }}</code>
  </div>
</div>
```

### JavaScript Functions

#### Drag-and-Drop Handler
```typescript
async function handleLaunchProgramDrop(e: DragEvent) {
  e.preventDefault();
  const files = e.dataTransfer?.files;
  if (files && files.length > 0) {
    const filePath = files[0].path;
    settings.launchProgram = filePath;
    console.log('✓ Launch program path set:', filePath);
  }
}
```

#### Browse Button Handler
```typescript
async function browseLaunchProgram() {
  if (!isElectronAvailable()) {
    alert('File selection requires Electron environment');
    return;
  }
  
  try {
    const result = await (window as any).electronAPI.selectFile({
      title: 'Select Launch Program',
      filters: [
        { name: 'Executable Files', extensions: ['exe', 'sh', 'bat', 'cmd', '*'] },
        { name: 'All Files', extensions: ['*'] }
      ],
      properties: ['openFile']
    });
    
    if (result.success && result.filePath) {
      settings.launchProgram = result.filePath;
      console.log('✓ Launch program path set:', result.filePath);
    }
  } catch (error: any) {
    console.error('Error browsing launch program:', error);
    alert('Error selecting launch program: ' + error.message);
  }
}
```

## User Experience Improvements

### 1. **Drag-and-Drop**
- Users can drag executable files from their file manager directly into the drop zone
- Visual feedback on hover (border color changes, background highlights)
- Instant path update when file is dropped

### 2. **Browse Button**
- Opens native OS file dialog
- Pre-filtered to show executable files first (.exe, .sh, .bat, .cmd)
- Option to show all files if needed
- Better accessibility for keyboard-only users

### 3. **Visual Feedback**
- Drop zone has clear visual styling (dashed border, gray background)
- Hover state provides visual confirmation (blue border, light blue background)
- Current path displayed in green with monospace font for readability
- Path uses `word-break: break-all` to prevent overflow

## Supported File Types

The browse dialog filters for common executable types:
- **Windows**: `.exe`, `.bat`, `.cmd`
- **Unix/Linux**: `.sh` (shell scripts)
- **All platforms**: `*` (all files)

## Consistency with Existing Patterns

This implementation follows the same pattern as:
- **FLIPS executable** (Import FLIPS executable)
- **ASAR executable** (Import ASAR executable)
- **UberASM executable** (Import UberASM executable)

All use the same:
- Drop zone styling and behavior
- Browse button functionality
- Current path display format

## Files Modified

1. **`electron/renderer/src/App.vue`**
   - Added drop zone and browse button to Launch Program setting
   - Added `handleLaunchProgramDrop()` function
   - Added `browseLaunchProgram()` function
   - Added current path display

2. **`electron/GUI_README.md`**
   - Updated Launch Program documentation
   - Changed from "Text input" to "Drag-and-drop zone + Browse button"
   - Added display information

3. **`docs/CHANGELOG.md`**
   - Added feature entry for Launch Program Browse and Drag-Drop support

## Testing

### Manual Testing Steps

1. **Test Drag-and-Drop:**
   - Open Settings dialog
   - Drag an executable file onto the "Drag program file here" zone
   - Verify path appears in "Current:" line below
   - Verify path is saved to settings

2. **Test Browse Button:**
   - Click "Browse" button
   - Select an executable from the file dialog
   - Verify path appears in "Current:" line
   - Verify path is saved to settings

3. **Test Path Display:**
   - Set a launch program path
   - Close and reopen settings
   - Verify path persists and displays correctly

4. **Test Edge Cases:**
   - Try dragging a non-executable file (should still work)
   - Try dragging multiple files (should use first one)
   - Try on different operating systems

## Benefits

✅ **Improved UX**: No more typing long file paths manually  
✅ **Fewer Errors**: File dialog ensures paths are valid  
✅ **Consistency**: Matches other executable settings in the UI  
✅ **Accessibility**: Both mouse (drag-drop) and keyboard (browse) options  
✅ **Visual Feedback**: Clear indication of current configuration  

## Related Features

- FLIPS executable configuration
- ASAR executable configuration
- UberASM executable configuration
- Vanilla ROM path configuration

All these settings now have the same consistent browse and drag-drop experience.

---

**Version:** 1.0.0  
**Date:** 2025-10-13  
**Modified by:** AI Assistant

