# Electron IPC Architecture

**Date**: October 12, 2025  
**Purpose**: Define the complete IPC (Inter-Process Communication) API for the RHTools Electron app

---

## Overview

This document defines all IPC channels and their contracts for communication between the Renderer Process (Vue.js UI) and Main Process (Node.js backend with database access).

---

## API Surface

### Complete API List

```typescript
interface ElectronAPI {
  // =============================
  // Game Data Operations
  // =============================
  
  /**
   * Get all games (latest versions only)
   * @returns Promise<Game[]>
   */
  getGames(): Promise<Game[]>;
  
  /**
   * Get specific game version with annotations
   * @param gameid - Game ID
   * @param version - Version number
   * @returns Promise<Game | null>
   */
  getGame(gameid: string, version: number): Promise<Game | null>;
  
  /**
   * Get all available versions for a game
   * @param gameid - Game ID
   * @returns Promise<number[]>
   */
  getVersions(gameid: string): Promise<number[]>;
  
  // =============================
  // User Annotations
  // =============================
  
  /**
   * Save game annotation (game-wide)
   * @param annotation - Annotation data
   * @returns Promise<{ success: boolean }>
   */
  saveAnnotation(annotation: GameAnnotation): Promise<Result>;
  
  /**
   * Save version-specific annotation
   * @param annotation - Version-specific annotation
   * @returns Promise<{ success: boolean }>
   */
  saveVersionAnnotation(annotation: VersionAnnotation): Promise<Result>;
  
  // =============================
  // Stage Operations
  // =============================
  
  /**
   * Get stages for a game
   * @param gameid - Game ID
   * @returns Promise<Stage[]>
   */
  getStages(gameid: string): Promise<Stage[]>;
  
  /**
   * Save stage annotation
   * @param annotation - Stage annotation
   * @returns Promise<{ success: boolean }>
   */
  saveStageAnnotation(annotation: StageAnnotation): Promise<Result>;
  
  // =============================
  // Settings Operations
  // =============================
  
  /**
   * Get all settings
   * @returns Promise<Record<string, string>>
   */
  getSettings(): Promise<Record<string, string>>;
  
  /**
   * Set a single setting
   * @param name - Setting name
   * @param value - Setting value
   * @returns Promise<{ success: boolean }>
   */
  setSetting(name: string, value: string): Promise<Result>;
  
  /**
   * Save multiple settings at once
   * @param settings - Settings object
   * @returns Promise<{ success: boolean }>
   */
  saveSettings(settings: Record<string, string>): Promise<Result>;
}
```

---

## TypeScript Types

### Core Types

```typescript
// electron/renderer/src/types.ts

export interface Game {
  id: string;
  name: string;
  author: string;
  length: string;
  type: string;
  legacyType?: string;
  publicDifficulty?: string;
  currentVersion: number;
  localRunExcluded: boolean;
  jsonData?: any;
  
  // User annotations
  status: 'Default' | 'In Progress' | 'Finished';
  myDifficultyRating?: number | null;
  myReviewRating?: number | null;
  hidden: boolean;
  excludeFromRandom: boolean;
  mynotes?: string;
}

export interface GameAnnotation {
  gameid: string;
  status: 'Default' | 'In Progress' | 'Finished';
  myDifficultyRating?: number | null;
  myReviewRating?: number | null;
  hidden: boolean;
  excludeFromRandom: boolean;
  mynotes?: string;
}

export interface VersionAnnotation {
  gameid: string;
  version: number;
  status?: 'Default' | 'In Progress' | 'Finished';
  myDifficultyRating?: number | null;
  myReviewRating?: number | null;
  mynotes?: string;
}

export interface Stage {
  key: string;
  parentId: string;
  exitNumber: string;
  description: string;
  publicRating?: number;
  myDifficultyRating?: number | null;
  myReviewRating?: number | null;
  myNotes?: string;
}

export interface StageAnnotation {
  gameid: string;
  exitNumber: string;
  myDifficultyRating?: number | null;
  myReviewRating?: number | null;
  myNotes?: string;
}

export interface Result {
  success: boolean;
  error?: string;
}
```

---

## IPC Channel Specifications

### Format

```
Channel: 'namespace:operation:entity'
Direction: Renderer → Main (invoke/handle pattern)
```

### Game Data Channels

#### `db:rhdata:get:games`
**Purpose**: Get all games (latest versions)  
**Request**: None  
**Response**: `Game[]`

```javascript
// Renderer
const games = await window.electronAPI.getGames();

// Main
ipcMain.handle('db:rhdata:get:games', async () => {
  // Implementation
});
```

#### `db:rhdata:get:game`
**Purpose**: Get specific game version  
**Request**: `{ gameid: string, version: number }`  
**Response**: `Game | null`

```javascript
// Renderer
const game = await window.electronAPI.getGame('12345', 2);

// Main
ipcMain.handle('db:rhdata:get:game', async (event, { gameid, version }) => {
  // Implementation
});
```

#### `db:rhdata:get:versions`
**Purpose**: Get all versions of a game  
**Request**: `{ gameid: string }`  
**Response**: `number[]`

```javascript
// Renderer
const versions = await window.electronAPI.getVersions('12345');
// Returns: [1, 2, 3]

// Main
ipcMain.handle('db:rhdata:get:versions', async (event, { gameid }) => {
  // Implementation
});
```

### Annotation Channels

#### `db:clientdata:set:annotation`
**Purpose**: Save game-wide annotation  
**Request**: `GameAnnotation`  
**Response**: `Result`

```javascript
// Renderer
await window.electronAPI.saveAnnotation({
  gameid: '12345',
  status: 'In Progress',
  myDifficultyRating: 4,
  myReviewRating: 5,
  hidden: false,
  excludeFromRandom: false,
  mynotes: 'Great game!'
});

// Main
ipcMain.handle('db:clientdata:set:annotation', async (event, annotation) => {
  // Implementation
});
```

#### `db:clientdata:set:version-annotation`
**Purpose**: Save version-specific annotation  
**Request**: `VersionAnnotation`  
**Response**: `Result`

```javascript
// Renderer
await window.electronAPI.saveVersionAnnotation({
  gameid: '12345',
  version: 2,
  myDifficultyRating: 3,  // v2 is easier than v1
  myReviewRating: 5,
  mynotes: 'Fixed bugs from v1'
});

// Main
ipcMain.handle('db:clientdata:set:version-annotation', async (event, annotation) => {
  // Implementation
});
```

### Stage Channels

#### `db:clientdata:get:stages`
**Purpose**: Get all stages for a game  
**Request**: `{ gameid: string }`  
**Response**: `Stage[]`

```javascript
// Renderer
const stages = await window.electronAPI.getStages('12345');

// Main
ipcMain.handle('db:clientdata:get:stages', async (event, { gameid }) => {
  // Implementation
});
```

#### `db:clientdata:set:stage-annotation`
**Purpose**: Save stage annotation  
**Request**: `StageAnnotation`  
**Response**: `Result`

```javascript
// Renderer
await window.electronAPI.saveStageAnnotation({
  gameid: '12345',
  exitNumber: '0x0F',
  myDifficultyRating: 5,
  myReviewRating: 4,
  myNotes: 'Very hard but fun'
});

// Main
ipcMain.handle('db:clientdata:set:stage-annotation', async (event, annotation) => {
  // Implementation
});
```

### Settings Channels

#### `db:settings:get:all`
**Purpose**: Get all settings  
**Request**: None  
**Response**: `Record<string, string>`

```javascript
// Renderer
const settings = await window.electronAPI.getSettings();
// Returns: { vanillaRomPath: '/path/to/rom', flipsPath: '/path/to/flips', ... }

// Main
ipcMain.handle('db:settings:get:all', async () => {
  // Implementation
});
```

#### `db:settings:set:value`
**Purpose**: Set single setting  
**Request**: `{ name: string, value: string }`  
**Response**: `Result`

```javascript
// Renderer
await window.electronAPI.setSetting('vanillaRomPath', '/path/to/rom');

// Main
ipcMain.handle('db:settings:set:value', async (event, { name, value }) => {
  // Implementation
});
```

#### `db:settings:set:bulk`
**Purpose**: Save multiple settings  
**Request**: `{ settings: Record<string, string> }`  
**Response**: `Result`

```javascript
// Renderer
await window.electronAPI.saveSettings({
  vanillaRomPath: '/path/to/rom',
  flipsPath: '/path/to/flips',
  launchMethod: 'program',
  launchProgram: '/path/to/retroarch'
});

// Main
ipcMain.handle('db:settings:set:bulk', async (event, { settings }) => {
  // Implementation
});
```

---

## Security Considerations

### Context Isolation

```javascript
// preload.js
const { contextBridge, ipcRenderer } = require('electron');

// GOOD: Specific, type-safe API
contextBridge.exposeInMainWorld('electronAPI', {
  getGames: () => ipcRenderer.invoke('db:rhdata:get:games'),
  // ... specific methods
});

// BAD: Don't expose raw ipcRenderer
// contextBridge.exposeInMainWorld('ipc', ipcRenderer); // NEVER DO THIS
```

### Input Validation

```javascript
// Main process
ipcMain.handle('db:clientdata:set:annotation', async (event, annotation) => {
  // Validate inputs
  if (!annotation.gameid || typeof annotation.gameid !== 'string') {
    return { success: false, error: 'Invalid gameid' };
  }
  
  if (annotation.myDifficultyRating !== null && 
      (annotation.myDifficultyRating < 1 || annotation.myDifficultyRating > 5)) {
    return { success: false, error: 'Rating must be 1-5' };
  }
  
  // Proceed with database operation
  try {
    // ... database code
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});
```

---

## Error Handling Pattern

### Standard Error Response

```typescript
interface Result {
  success: boolean;
  error?: string;
  data?: any;
}
```

### Implementation

```javascript
// Main process
ipcMain.handle('db:rhdata:get:games', async () => {
  try {
    const db = dbManager.getConnection('rhdata');
    const games = db.prepare(query).all();
    
    return {
      success: true,
      data: games
    };
  } catch (error) {
    console.error('Failed to get games:', error);
    
    return {
      success: false,
      error: error.message
    };
  }
});

// Renderer
async function loadGames() {
  const result = await window.electronAPI.getGames();
  
  if (result.success) {
    items.splice(0, items.length, ...result.data);
  } else {
    console.error('Failed to load games:', result.error);
    alert(`Error: ${result.error}`);
  }
}
```

---

## Performance Optimization

### Debounced Saves

```javascript
// Renderer
import { debounce } from 'lodash-es';

const debouncedSave = debounce(async (annotation) => {
  await window.electronAPI.saveAnnotation(annotation);
}, 500);

// Watch for changes
watch(selectedItem, (newVal) => {
  if (newVal) {
    debouncedSave(newVal);
  }
}, { deep: true });
```

### Batch Operations

```javascript
// Instead of multiple individual saves
for (const setting of settings) {
  await window.electronAPI.setSetting(setting.name, setting.value);
}

// Use bulk save
await window.electronAPI.saveSettings(settingsObject);
```

---

## Testing

### Mock API for Development

```javascript
// Create mock in development mode
if (import.meta.env.DEV && !window.electronAPI) {
  window.electronAPI = {
    getGames: async () => {
      // Return mock data
      return [
        { id: '12345', name: 'Mock Game', ... }
      ];
    },
    // ... other mocks
  };
}
```

### Unit Tests

```javascript
// Test IPC handlers
const { registerDatabaseHandlers } = require('./ipc-handlers');

describe('IPC Handlers', () => {
  let mockDbManager;
  
  beforeEach(() => {
    mockDbManager = {
      getConnection: jest.fn()
    };
    registerDatabaseHandlers(mockDbManager);
  });
  
  test('db:rhdata:get:games returns games', async () => {
    // Test implementation
  });
});
```

---

## Future Enhancements

### Potential Additional Channels

```typescript
// Random game selection
getRandomGames(filters: RandomFilters): Promise<Game[]>;

// Run system
createRun(run: RunData): Promise<{ runUuid: string }>;
startRun(runUuid: string): Promise<Result>;
updateRunResult(result: RunResult): Promise<Result>;

// File operations
importRom(filePath: string): Promise<Result>;
patchGame(gameid: string): Promise<{ patchedPath: string }>;
launchGame(gameid: string): Promise<Result>;
```

---

## Summary

This IPC architecture provides:

1. **Type-safe API**: Clear contracts between renderer and main
2. **Security**: Context isolation, no direct database access
3. **Performance**: Efficient with proper batching
4. **Maintainability**: Organized channel naming
5. **Cross-platform**: Works on Windows, Linux, macOS

---

*Last Updated: October 12, 2025*  
*Status: Specification Complete*

