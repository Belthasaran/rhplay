# Launch Program Setting - UI Comparison

## Visual Comparison

### BEFORE (Text Input Only)
```
┌─────────────────────────────────────────────────────────────┐
│ Settings                                                     │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Game launch method                                          │
│  [ Launch Manually ▼                                    ]    │
│                                                              │
│  Launch Program                                              │
│  [_____________________________________________]             │
│   ↑ Manual text entry only                                  │
│                                                              │
│  Launch Program Arguments                                    │
│  [%file____________________________________]                 │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### AFTER (Browse + Drag-Drop)
```
┌─────────────────────────────────────────────────────────────┐
│ Settings                                                     │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Game launch method                                          │
│  [ Launch Manually ▼                                    ]    │
│                                                              │
│  Launch Program                                              │
│  ┌──────────────────────────────────┐                       │
│  │  Drag program file here          │  [ Browse ]           │
│  └──────────────────────────────────┘                       │
│  Current: /usr/bin/retroarch                                │
│                                                              │
│  Launch Program Arguments                                    │
│  [%file____________________________________]                 │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## Feature Comparison

| Feature | Before | After |
|---------|--------|-------|
| **Input Method** | Text only | Text, Browse, Drag-drop |
| **File Dialog** | ❌ None | ✅ Native OS dialog |
| **Drag-Drop** | ❌ Not supported | ✅ Fully supported |
| **Path Display** | Hidden in input | Clearly shown below |
| **Visual Feedback** | None | Drop zone hover effects |
| **File Filtering** | None | Pre-filtered executables |
| **User Experience** | Manual typing | Point-and-click |

## Interaction Examples

### Example 1: Using Drag-and-Drop

1. User opens Settings dialog
2. User drags `/usr/bin/retroarch` from file manager
3. User drops file onto "Drag program file here" zone
4. ✅ Path instantly appears: `Current: /usr/bin/retroarch`

### Example 2: Using Browse Button

1. User opens Settings dialog
2. User clicks **Browse** button
3. Native file dialog opens, filtered to show executables
4. User navigates to `/Applications/RetroArch.app`
5. User clicks "Open"
6. ✅ Path instantly appears: `Current: /Applications/RetroArch.app`

### Example 3: Visual States

**Normal State:**
```
┌──────────────────────────────────┐
│  Drag program file here          │  (Gray dashed border)
└──────────────────────────────────┘
```

**Hover State:**
```
┌──────────────────────────────────┐
│  Drag program file here          │  (Blue dashed border, light blue bg)
└──────────────────────────────────┘
```

**With File Set:**
```
┌──────────────────────────────────┐
│  Drag program file here          │  [ Browse ]
└──────────────────────────────────┘
Current: /usr/bin/retroarch
```

## Match with FLIPS Pattern

The Launch Program setting now follows the **exact same pattern** as FLIPS executable:

### FLIPS Executable (Reference)
```
  ✓ Import FLIPS executable
  ┌──────────────────────────────────┐
  │  Drag FLIPS file here            │  [ Browse ]
  └──────────────────────────────────┘
  Current: /usr/local/bin/flips
  Floating IPS https://www.gamebrew.org/wiki/Floating_IPS
```

### Launch Program (New)
```
  Launch Program
  ┌──────────────────────────────────┐
  │  Drag program file here          │  [ Browse ]
  └──────────────────────────────────┘
  Current: /usr/bin/retroarch
```

## Supported Platforms

### Windows
- **Executables**: `.exe`, `.bat`, `.cmd`
- **Example**: `C:\Program Files\RetroArch\retroarch.exe`

### macOS
- **Applications**: `.app`, shell scripts
- **Example**: `/Applications/RetroArch.app`

### Linux
- **Binaries**: Shell scripts (`.sh`), executables
- **Example**: `/usr/bin/retroarch`

## Code Implementation Summary

### Template Changes
```vue
<!-- OLD -->
<input type="text" v-model="settings.launchProgram" />

<!-- NEW -->
<div class="drop-zone" @drop.prevent="handleLaunchProgramDrop">
  Drag program file here
</div>
<button @click="browseLaunchProgram">Browse</button>
<div v-if="settings.launchProgram" class="setting-current-path">
  Current: <code>{{ settings.launchProgram }}</code>
</div>
```

### New Functions
- `handleLaunchProgramDrop(e: DragEvent)` - Handles file drops
- `browseLaunchProgram()` - Opens file browser dialog

## Benefits Summary

🎯 **User-Friendly**
- No need to remember exact file paths
- Visual drag-and-drop interface
- Native file browser support

🔧 **Reduced Errors**
- File dialog ensures valid paths
- No typos in manual entry
- Automatic path formatting

🎨 **Consistent Design**
- Matches FLIPS, ASAR, UberASM settings
- Same visual language throughout app
- Professional appearance

⚡ **Efficient Workflow**
- Faster path selection
- Multiple input methods
- Clear visual feedback

---

**Created:** 2025-10-13  
**Author:** AI Assistant

