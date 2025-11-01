const { contextBridge, ipcRenderer } = require('electron');

// Expose version info
contextBridge.exposeInMainWorld('rhtools', {
    version: '0.1.0'
});

/**
 * Expose electronAPI to renderer process
 * Provides type-safe database access via IPC
 */
contextBridge.exposeInMainWorld('electronAPI', {
  // =============================
  // Game Data Operations
  // =============================
  
  /**
   * Get all games (latest versions only) with user annotations
   * @returns {Promise<Array>} Array of games
   */
  getGames: () => ipcRenderer.invoke('db:rhdata:get:games'),
  
  /**
   * Get all available versions for a specific game
   * @param {string} gameid - Game ID
   * @returns {Promise<Array<number>>} Array of version numbers
   */
  getVersions: (gameid) => ipcRenderer.invoke('db:rhdata:get:versions', { gameid }),
  
  /**
   * Get specific game version with annotations
   * @param {string} gameid - Game ID
   * @param {number} version - Version number
   * @returns {Promise<Object|null>} Game data or null
   */
  getGame: (gameid, version) => ipcRenderer.invoke('db:rhdata:get:game', { gameid, version }),
  
  // =============================
  // User Annotations
  // =============================
  
  /**
   * Save game annotation (game-wide)
   * @param {Object} annotation - Annotation data
   * @returns {Promise<{success: boolean}>}
   */
  saveAnnotation: (annotation) => ipcRenderer.invoke('db:clientdata:set:annotation', annotation),
  
  /**
   * Save version-specific annotation
   * @param {Object} annotation - Version-specific annotation
   * @returns {Promise<{success: boolean}>}
   */
  saveVersionAnnotation: (annotation) => ipcRenderer.invoke('db:clientdata:set:version-annotation', annotation),
  
  // =============================
  // Stage Operations
  // =============================
  
  /**
   * Get stages for a game with user annotations
   * @param {string} gameid - Game ID
   * @returns {Promise<Array>} Array of stages
   */
  getStages: (gameid) => ipcRenderer.invoke('db:clientdata:get:stages', { gameid }),
  
  /**
   * Save stage annotation
   * @param {Object} annotation - Stage annotation
   * @returns {Promise<{success: boolean}>}
   */
  saveStageAnnotation: (annotation) => ipcRenderer.invoke('db:clientdata:set:stage-annotation', annotation),
  
  /**
   * Save multiple stage annotations at once
   * @param {Array} annotations - Array of stage annotations
   * @returns {Promise<{success: boolean}>}
   */
  saveStageAnnotationsBulk: (annotations) => ipcRenderer.invoke('db:clientdata:set:stage-annotations-bulk', { annotations }),
  
  // =============================
  // Settings Operations
  // =============================
  
  /**
   * Get all settings
   * @returns {Promise<Object>} Settings object
   */
  getSettings: () => ipcRenderer.invoke('db:settings:get:all'),
  
  /**
   * Set a single setting
   * @param {string} name - Setting name
   * @param {string} value - Setting value
   * @returns {Promise<{success: boolean}>}
   */
  setSetting: (name, value) => ipcRenderer.invoke('db:settings:set:value', { name, value }),
  
  /**
   * Save multiple settings at once
   * @param {Object} settings - Settings object
   * @returns {Promise<{success: boolean}>}
   */
  saveSettings: (settings) => ipcRenderer.invoke('db:settings:set:bulk', { settings }),
  
  // =============================
  // Startup Validation Events
  // =============================
  
  /**
   * Listen for startup validation results
   * @param {Function} callback - Callback function
   */
  onStartupValidationResults: (callback) => ipcRenderer.on('startup-validation-results', callback),
  
  /**
   * Listen for settings modal open request
   * @param {Function} callback - Callback function
   */
  onOpenSettingsModal: (callback) => ipcRenderer.on('open-settings-modal', callback),
  
  // =============================
  // Run System Operations
  // =============================
  
  /**
   * Create a new run
   * @param {string} runName - Run name
   * @param {string} runDescription - Run description
   * @param {Array} globalConditions - Global challenge conditions
   * @returns {Promise<{success: boolean, runUuid: string}>}
   */
  createRun: (runName, runDescription, globalConditions) => 
    ipcRenderer.invoke('db:runs:create', { runName, runDescription, globalConditions }),
  
  /**
   * Save run plan entries
   * @param {string} runUuid - Run UUID
   * @param {Array} entries - Run plan entries
   * @returns {Promise<{success: boolean}>}
   */
  saveRunPlan: (runUuid, entries) => ipcRenderer.invoke('db:runs:save-plan', { runUuid, entries }),
  
  /**
   * Start a run (change status to active, expand plan to results)
   * @param {Object} params - {runUuid: string}
   * @returns {Promise<{success: boolean}>}
   */
  startRun: (params) => ipcRenderer.invoke('db:runs:start', params),
  
  /**
   * Record challenge result
   * @param {Object} params - {runUuid: string, challengeIndex: number, status: string}
   * @returns {Promise<{success: boolean}>}
   */
  recordChallengeResult: (params) => ipcRenderer.invoke('db:runs:record-result', params),
  
  /**
   * Cancel a run
   * @param {Object} params - {runUuid: string}
   * @returns {Promise<{success: boolean}>}
   */
  cancelRun: (params) => ipcRenderer.invoke('db:runs:cancel', params),
  
  /**
   * Complete a run (mark as finished)
   * @param {Object} params - {runUuid: string}
   * @returns {Promise<{success: boolean}>}
   */
  completeRun: (params) => ipcRenderer.invoke('db:runs:complete', params),
  
  /**
   * Get run results (expanded challenges)
   * @param {Object} params - {runUuid: string}
   * @returns {Promise<Array>} Array of run results
   */
  getRunResults: (params) => ipcRenderer.invoke('db:runs:get-results', params),
  
  /**
   * Reveal a random challenge (select game and update)
   * @param {Object} params - {runUuid: string, resultUuid: string, revealedEarly: boolean}
   * @returns {Promise<{success: boolean, gameid?: string, gameName?: string}>}
   */
  revealChallenge: (params) => ipcRenderer.invoke('db:runs:reveal-challenge', params),
  
  /**
   * Mark a challenge as revealed early (after using Back button)
   * @param {Object} params - {runUuid: string, challengeIndex: number, revealedEarly: boolean}
   * @returns {Promise<{success: boolean}>}
   */
  markChallengeRevealedEarly: (params) => ipcRenderer.invoke('db:runs:mark-revealed-early', params),
  
  /**
   * Get unique filter values for random game selection (difficulties and types)
   * @returns {Promise<{success: boolean, difficulties: string[], types: string[]}>}
   */
  getRandomFilterValues: () => ipcRenderer.invoke('db:get-random-filter-values'),
  
  /**
   * Count games matching random filter criteria
   * @param {Object} params - {filterType: string, filterDifficulty: string, filterPattern: string}
   * @returns {Promise<{success: boolean, count: number}>}
   */
  countRandomMatches: (params) => ipcRenderer.invoke('db:count-random-matches', params),
  
  /**
   * Get active run (for startup check)
   * @returns {Promise<Object|null>} Active run with calculated elapsed time
   */
  getActiveRun: () => ipcRenderer.invoke('db:runs:get-active'),
  
  /**
   * Get all runs from database
   * @returns {Promise<Array>} Array of all runs
   */
  getAllRuns: () => ipcRenderer.invoke('db:runs:get-all'),
  
  /**
   * Delete a run
   * @param {Object} params - {runUuid}
   * @returns {Promise<{success: boolean}>}
   */
  deleteRun: (params) => ipcRenderer.invoke('db:runs:delete', params),
  
  /**
   * Export games to directory
   * @param {Object} params - {gameIds, exportDirectory}
   * @returns {Promise<{success: boolean, exportedCount?: number, error?: string}>}
   */
  exportGames: (params) => ipcRenderer.invoke('db:games:export', params),
  
  /**
   * Import games from files
   * @param {Object} params - {filePaths}
   * @returns {Promise<{success: boolean, importedCount?: number, errors?: Array, error?: string}>}
   */
  importGames: (params) => ipcRenderer.invoke('db:games:import', params),
  
  /**
   * Select directory
   * @param {Object} options - Directory selection options
   * @returns {Promise<{canceled: boolean, filePaths?: Array}>}
   */
  selectDirectory: (options) => ipcRenderer.invoke('dialog:selectDirectory', options),
  
  /**
   * Select multiple files
   * @param {Object} options - File selection options
   * @returns {Promise<{canceled: boolean, filePaths?: Array}>}
   */
  selectFiles: (options) => ipcRenderer.invoke('dialog:selectFiles', options),
  
  /**
   * Pause a run
   * @param {string} runUuid - Run UUID
   * @returns {Promise<{success: boolean}>}
   */
  pauseRun: (runUuid) => ipcRenderer.invoke('db:runs:pause', { runUuid }),
  
  /**
   * Unpause a run
   * @param {string} runUuid - Run UUID
   * @returns {Promise<{success: boolean}>}
   */
  unpauseRun: (runUuid) => ipcRenderer.invoke('db:runs:unpause', { runUuid }),
  
  /**
   * Expand run plan and select all random games
   * @param {Object} params - {runUuid}
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  expandAndStageRun: (params) => ipcRenderer.invoke('db:runs:expand-and-prepare', params),
  
  /**
   * Stage run games (create SFC files)
   * @param {Object} params - {runUuid, expandedResults, vanillaRomPath, flipsPath}
   * @returns {Promise<{success: boolean, stagingFolder?: string, error?: string}>}
   */
  stageRunGames: (params) => ipcRenderer.invoke('db:runs:stage-games', params),
  stageQuickLaunchGames: (params) => ipcRenderer.invoke('db:games:quick-launch-stage', params),
  uploadRunToSnes: (params) => ipcRenderer.invoke('db:runs:upload-to-snes', params),
  
  // =============================
  // Seed Management
  // =============================
  
  /**
   * Generate a new random seed
   * @returns {Promise<{success: boolean, seed: string, mapId: string, gameCount: number}>}
   */
  generateSeed: () => ipcRenderer.invoke('db:seeds:generate'),
  
  /**
   * Get all available seed mappings
   * @returns {Promise<Array>} Array of seed mappings
   */
  getSeedMappings: () => ipcRenderer.invoke('db:seeds:get-mappings'),
  
  /**
   * Validate a seed
   * @param {string} seed - Seed to validate
   * @returns {Promise<{valid: boolean, mapId?: string, gameCount?: number}>}
   */
  validateSeed: (seed) => ipcRenderer.invoke('db:seeds:validate', { seed }),
  
  /**
   * Export run with seed mappings
   * @param {string} runUuid - Run UUID
   * @returns {Promise<{success: boolean, data?: Object}>}
   */
  exportRun: (runUuid) => ipcRenderer.invoke('db:runs:export', { runUuid }),
  
  /**
   * Import run with seed mappings
   * @param {Object} importData - Import data
   * @returns {Promise<{success: boolean, runUuid?: string, warnings?: Array}>}
   */
  importRun: (importData) => ipcRenderer.invoke('db:runs:import', { importData }),
  
  /**
   * Access to ipcRenderer for event listeners
   */
  ipcRenderer: {
    on: (channel, func) => ipcRenderer.on(channel, func),
    removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel)
  },
  
  /**
   * Shell operations for opening folders/files
   */
  shell: {
    openPath: (path) => ipcRenderer.invoke('shell:open-path', path)
  },
  
  /**
   * File selection and validation
   */
  selectFile: (options) => ipcRenderer.invoke('file:select', options),
  validateRomFile: (filePath) => ipcRenderer.invoke('file:validate-rom', { filePath }),
  validateFlipsFile: (filePath) => ipcRenderer.invoke('file:validate-flips', { filePath }),
  validatePath: (filePath) => ipcRenderer.invoke('file:validate-path', { filePath }),
  validateAsarFile: (filePath) => ipcRenderer.invoke('file:validate-asar', { filePath }),
  validateUberAsmFile: (filePath) => ipcRenderer.invoke('file:validate-uberasm', { filePath }),
  
  // =============================
  // USB2SNES Operations
  // =============================
  
  /**
   * Connect to USB2SNES server
   * @param {Object} options - Connection options (library, address, proxy settings)
   * @returns {Promise<Object>} Connection info
   */
  usb2snesConnect: (options) => ipcRenderer.invoke('usb2snes:connect', options),
  /**
   * Start managed SSH client for USB2SNES tunneling
   * @param {Object} config - SSH configuration
   * @returns {Promise<{success: boolean, status?: Object, error?: string}>}
   */
  usb2snesStartSsh: (config) => ipcRenderer.invoke('usb2snes:ssh-start', config),
  /**
   * Stop managed SSH client
   * @returns {Promise<{success: boolean, status?: Object, error?: string}>}
   */
  usb2snesStopSsh: () => ipcRenderer.invoke('usb2snes:ssh-stop'),
  /**
   * Get current SSH client status
   * @returns {Promise<Object>} Status info
   */
  usb2snesGetSshStatus: () => ipcRenderer.invoke('usb2snes:ssh-status'),
  /**
   * Subscribe to SSH status updates
   * @param {Function} callback - (status) => void
   * @returns {Function} Cleanup function
   */
  onUsb2snesSshStatus: (callback) => {
    const handler = (_event, status) => callback(status);
    ipcRenderer.on('usb2snes:ssh-status', handler);
    return () => ipcRenderer.removeListener('usb2snes:ssh-status', handler);
  },
  /**
   * Get SSH console history
   * @returns {Promise<Array>} Console history entries
   */
  usb2snesGetSshConsoleHistory: () => ipcRenderer.invoke('usb2snes:ssh-console-history'),
  
  /**
   * Start USBFXP embedded server
   * @param {Object} config - Server configuration (port, address)
   * @returns {Promise<{success: boolean, status?: Object, error?: string}>}
   */
  usb2snesFxpStart: (config) => ipcRenderer.invoke('usb2snes:fxp-start', config),
  /**
   * Stop USBFXP embedded server
   * @returns {Promise<{success: boolean, status?: Object, error?: string}>}
   */
  usb2snesFxpStop: () => ipcRenderer.invoke('usb2snes:fxp-stop'),
  /**
   * Restart USBFXP embedded server
   * @param {Object} config - Server configuration (port, address)
   * @returns {Promise<{success: boolean, status?: Object, error?: string}>}
   */
  usb2snesFxpRestart: (config) => ipcRenderer.invoke('usb2snes:fxp-restart', config),
  /**
   * Get current USBFXP server status
   * @returns {Promise<Object>} Status info
   */
  usb2snesGetFxpStatus: () => ipcRenderer.invoke('usb2snes:fxp-status'),
  /**
   * Subscribe to USBFXP server status updates
   * @param {Function} callback - (status) => void
   * @returns {Function} Cleanup function
   */
  onUsb2snesFxpStatus: (callback) => {
    const handler = (_event, status) => callback(status);
    ipcRenderer.on('usb2snes:fxp-status', handler);
    return () => ipcRenderer.removeListener('usb2snes:fxp-status', handler);
  },
  /**
   * Get USBFXP console history
   * @returns {Promise<Array>} Console history entries
   */
  usb2snesGetFxpConsoleHistory: () => ipcRenderer.invoke('usb2snes:fxp-console-history'),
  /**
   * Check USB/serial device permissions
   * @returns {Promise<{hasPermissions: boolean, platform: string, issues: string[], instructions: string[]}>}
   */
  usb2snesCheckFxpPermissions: () => ipcRenderer.invoke('usb2snes:fxp-check-permissions'),
  /**
   * Grant dialout group permission using pkexec
   * @returns {Promise<{success: boolean, message: string, error?: string}>}
   */
  usb2snesGrantFxpPermission: () => ipcRenderer.invoke('usb2snes:fxp-grant-permission'),
  
  /**
   * Disconnect from USB2SNES server
   * @returns {Promise<{connected: boolean}>}
   */
  usb2snesDisconnect: () => ipcRenderer.invoke('usb2snes:disconnect'),
  
  /**
   * Get USB2SNES connection status
   * @returns {Promise<Object>} Status info
   */
  usb2snesStatus: () => ipcRenderer.invoke('usb2snes:status'),
  
  /**
   * Reset the console
   * @returns {Promise<{success: boolean}>}
   */
  usb2snesReset: () => ipcRenderer.invoke('usb2snes:reset'),
  
  /**
   * Return to menu
   * @returns {Promise<{success: boolean}>}
   */
  usb2snesMenu: () => ipcRenderer.invoke('usb2snes:menu'),
  
  /**
   * Boot a ROM file
   * @param {string} romPath - Path to ROM on console
   * @returns {Promise<{success: boolean}>}
   */
  usb2snesBoot: (romPath) => ipcRenderer.invoke('usb2snes:boot', romPath),
  
  /**
   * Show native file open dialog
   * @param {Object} options - Dialog options
   * @returns {Promise<{canceled: boolean, filePaths: string[]}>}
   */
  showOpenDialog: (options) => ipcRenderer.invoke('dialog:showOpenDialog', options),
  
  /**
   * Read directory contents
   * @param {string} dirPath - Directory path
   * @returns {Promise<string[]>} Array of filenames
   */
  readDirectory: (dirPath) => ipcRenderer.invoke('fs:readDirectory', dirPath),
  
  /**
   * Launch external program with file
   * @param {string} program - Program path
   * @param {string} args - Arguments with %file placeholder
   * @param {string} filePath - File path to launch
   * @returns {Promise<void>}
   */
  launchProgram: (program, args, filePath) => ipcRenderer.invoke('fs:launchProgram', program, args, filePath),
  
  /**
   * Upload ROM file to console
   * @param {string} srcPath - Source file path (local)
   * @param {string} dstPath - Destination path on console
   * @returns {Promise<{success: boolean}>}
   */
  usb2snesUploadRom: (srcPath, dstPath) => ipcRenderer.invoke('usb2snes:uploadRom', srcPath, dstPath),
  
  /**
   * Listen for upload progress events
   * @param {Function} callback - Callback function (transferred, total, percent) => void
   * @returns {Function} Cleanup function
   */
  onUploadProgress: (callback) => {
    const handler = (event, data) => callback(data.transferred, data.total, data.percent);
    ipcRenderer.on('usb2snes:upload-progress', handler);
    return () => ipcRenderer.removeListener('usb2snes:upload-progress', handler);
  },
  
  /**
   * Read memory from console
   * @param {number} address - Memory address
   * @param {number} size - Number of bytes
   * @returns {Promise<{data: Array}>}
   */
  usb2snesReadMemory: (address, size) => ipcRenderer.invoke('usb2snes:readMemory', address, size),
  
  /**
   * Read multiple memory addresses in one call (batch operation)
   * Much faster than multiple usb2snesReadMemory calls
   * @param {Array<[number, number]>} addressList - Array of [address, size] tuples
   * @returns {Promise<{success: boolean, data: Array<Array>}>}
   */
    usb2snesReadMemoryBatch: (addressList) => ipcRenderer.invoke('usb2snes:readMemoryBatch', addressList),
    
    // Chat Commands System
    chatExecuteCommand: (command) => ipcRenderer.invoke('chat:executeCommand', command),
    chatGetHistory: () => ipcRenderer.invoke('chat:getHistory'),
    chatGetLoadedModules: () => ipcRenderer.invoke('chat:getLoadedModules'),
    chatGetMemoryStats: () => ipcRenderer.invoke('chat:getMemoryStats'),
    chatGetPseudocommands: () => ipcRenderer.invoke('chat:getPseudocommands'),
  
  /**
   * Write memory to console
   * @param {Array} writeList - Array of [address, data] tuples
   * @returns {Promise<{success: boolean}>}
   */
  usb2snesWriteMemory: (writeList) => ipcRenderer.invoke('usb2snes:writeMemory', writeList),
  
  /**
   * Download file from console
   * @param {string} filePath - File path on console
   * @returns {Promise<{success: boolean, data: Array, size: number}>}
   */
  usb2snesGetFile: (filePath) => ipcRenderer.invoke('usb2snes:getFile', filePath),
  
  /**
   * Blocking file download with timeout
   * @param {string} filePath - File path on console
   * @param {number|null} timeoutMs - Timeout in milliseconds (null = 5 minutes)
   * @returns {Promise<{success: boolean, data: Array, size: number}>}
   */
  usb2snesGetFileBlocking: (filePath, timeoutMs = null) => ipcRenderer.invoke('usb2snes:getFileBlocking', filePath, timeoutMs),
  
  /**
   * List directory on console
   * @param {string} dirPath - Directory path
   * @returns {Promise<{files: Array}>}
   */
  usb2snesListDir: (dirPath) => ipcRenderer.invoke('usb2snes:listDir', dirPath),
  
  /**
   * Create directory on console
   * @param {string} dirPath - Directory path to create
   * @returns {Promise<{success: boolean}>}
   */
  usb2snesCreateDir: (dirPath) => ipcRenderer.invoke('usb2snes:createDir', dirPath),
  
  // =============================
  // SMW-Specific Operations
  // =============================
  
  /**
   * Grant cape powerup to player
   * @returns {Promise<{success: boolean}>}
   */
  usb2snesGrantCape: () => ipcRenderer.invoke('usb2snes:smw:grantCape'),
  
  /**
   * Check if player is in a level
   * @returns {Promise<{inLevel: boolean}>}
   */
  usb2snesInLevel: () => ipcRenderer.invoke('usb2snes:smw:inLevel'),
  
  /**
   * Set game timer
   * @param {number} seconds - Time in seconds
   * @returns {Promise<{success: boolean}>}
   */
  usb2snesSetTime: (seconds) => ipcRenderer.invoke('usb2snes:smw:setTime', seconds),
  
  /**
   * Timer challenge: Wait for player to enter level, then set timer to 1 second
   * @returns {Promise<{success: boolean, message: string}>}
   */
  usb2snesTimerChallenge: () => ipcRenderer.invoke('usb2snes:smw:timerChallenge'),
  
  // =============================
  // SNES Contents Cache
  // =============================
  
  /**
   * Sync SNES /work/ folder with cache
   * @param {Object} uploadedFile - File that was just uploaded (optional)
   * @returns {Promise<{success: boolean}>}
   */
  snesContentsSync: (uploadedFile) => ipcRenderer.invoke('snesContents:sync', uploadedFile),
  
  /**
   * Get list of files on SNES
   * @param {boolean} showAll - Include dismissed files
   * @returns {Promise<Array>}
   */
  snesContentsGetList: (showAll) => ipcRenderer.invoke('snesContents:getList', showAll),
  
  /**
   * Update file status
   * @param {string} fullpath - File path on SNES
   * @param {Object} updates - Status updates
   * @returns {Promise<{success: boolean}>}
   */
  snesContentsUpdateStatus: (fullpath, updates) => ipcRenderer.invoke('snesContents:updateStatus', fullpath, updates),
  
  /**
   * Delete file from cache
   * @param {string} fullpath - File path on SNES
   * @returns {Promise<{success: boolean}>}
   */
  snesContentsDelete: (fullpath) => ipcRenderer.invoke('snesContents:delete', fullpath),
});
