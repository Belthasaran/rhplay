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
  /**
   * Configure RHPAK file association state
   * @param {boolean} enabled
   */
  configureRhpakAssociation: (enabled) => ipcRenderer.invoke('rhpak:configure-association', { enabled }),
  notifyRhpakRendererReady: () => ipcRenderer.invoke('rhpak:renderer-ready'),
  
  /**
   * Subscribe to OS-level RHPAK open events
   * @param {(filePath: string) => void} callback
   * @returns {() => void} unsubscribe function
   */
  onRhpakOpenFromOS: (callback) => {
    if (typeof callback !== 'function') {
      return () => {};
    }
    const handler = (_event, filePath) => callback(filePath);
    ipcRenderer.on('rhpak:open-from-os', handler);
    return () => ipcRenderer.removeListener('rhpak:open-from-os', handler);
  },
  
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
   * Install a RHPAK package by invoking the newgame.js workflow
   * @param {string} filePath - Absolute path to .rhpak file
   * @returns {Promise<{success: boolean, output?: string, error?: string}>}
   */
  rhpakImport: (filePath) => ipcRenderer.invoke('rhpak:import', { filePath }),
  
  /**
   * List installed RHPAK packages
   * @returns {Promise<{success: boolean, rhpaks?: Array, error?: string}>}
   */
  rhpakListInstalled: () => ipcRenderer.invoke('rhpak:list'),
  
  /**
   * Uninstall an RHPAK by UUID
   * @param {string} rhpakuuid - Identifier of the rhpak to remove
   * @returns {Promise<{success: boolean, output?: string, error?: string}>}
   */
  rhpakUninstall: (rhpakuuid) => ipcRenderer.invoke('rhpak:uninstall', { rhpakuuid }),
  
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
   * Read file content
   * @param {Object} params - {filePath: string}
   * @returns {Promise<{success: boolean, content?: string, error?: string}>}
   */
  readFile: (params) => ipcRenderer.invoke('dialog:readFile', params),
  
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
  
  // =============================
  // Online/NOSTR Profile Operations
  // =============================
  
  /**
   * Get online profile
   * @returns {Promise<Object|null>} Profile object or null
   */
  getOnlineProfile: () => ipcRenderer.invoke('online:profile:get'),
  
  /**
   * List all profiles
   * @returns {Promise<Array>} Array of profile metadata
   */
  listOnlineProfiles: () => ipcRenderer.invoke('online:profiles:list'),
  listDetailedOnlineProfiles: () => ipcRenderer.invoke('online:profiles:list-detailed'),
  deleteOnlineProfile: (profileId) => ipcRenderer.invoke('online:profile:delete', { profileId }),
  
  /**
   * Switch to a different profile
   * @param {Object} params - {profileId: string}
   * @returns {Promise<{success: boolean, profile?: Object, error?: string}>}
   */
  switchOnlineProfile: (params) => ipcRenderer.invoke('online:profile:switch', params),
  
  /**
   * Create new online profile
   * @param {Object} params - {keyType: string}
   * @returns {Promise<{success: boolean, profile?: Object, error?: string}>}
   */
  createOnlineProfile: (params) => ipcRenderer.invoke('online:profile:create', params),
  
  /**
   * Create a new profile (add to standby or make current)
   * @param {Object} params - {profileData: Object}
   * @returns {Promise<{success: boolean, profile?: Object, isCurrent?: boolean, error?: string}>}
   */
  createNewOnlineProfile: (params) => ipcRenderer.invoke('online:profile:create-new', params),
  
  /**
   * Save online profile
   * @param {Object} profile - Profile object
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  saveOnlineProfile: (profile) => ipcRenderer.invoke('online:profile:save', profile),
  
  /**
   * Import profile from encrypted file
   * @param {Object} params - {filePath: string, password: string, overwriteExisting: boolean}
   * @returns {Promise<{success: boolean, profile?: Object, isCurrent?: boolean, error?: string}>}
   */
  importOnlineProfile: (params) => ipcRenderer.invoke('online:profile:import', params),
  
  /**
   * Export profile to encrypted file
   * @param {Object} params - {profileId: string, password: string, filePath: string}
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  exportOnlineProfile: (params) => ipcRenderer.invoke('online:profile:export', params),
  
  /**
   * Create online keypair
   * @param {Object} params - {profileId: Object, keyType: string, isPrimary: boolean, isAdmin?: boolean}
   * @returns {Promise<{success: boolean, keypair?: Object, error?: string}>}
   */
  createOnlineKeypair: (params) => ipcRenderer.invoke('online:keypair:create', params),
  
  /**
   * Regenerate online keypair
   * @param {Object} params - {profileId: Object, keyType: string, isPrimary: boolean}
   * @returns {Promise<{success: boolean, keypair?: Object, error?: string}>}
   */
  regenerateOnlineKeypair: (params) => ipcRenderer.invoke('online:keypair:regenerate', params),
  
  /**
   * Get admin master keys
   * @returns {Promise<Array>} Array of master keys
   */
  // Admin master keys are now accessed via listAdminKeypairs() and filtered by key_usage = 'master-admin-signing'
  
  /**
   * Save admin master keys
   * @param {Array} masterKeys - Array of master keys
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  // Admin master keys are now saved via createAdminKeypair/addAdminKeypair with keyUsage = 'master-admin-signing'
  
  /**
   * Copy text to clipboard
   * @param {string} text - Text to copy
   * @returns {Promise<{success: boolean}>}
   */
  copyToClipboard: (text) => ipcRenderer.invoke('clipboard:write', text),
  
  // =============================
  // Profile Guard Operations
  // =============================
  
  /**
   * Check Profile Guard status
   * @returns {Promise<{enabled: boolean, highSecurityMode?: boolean}>}
   */
  checkProfileGuard: () => ipcRenderer.invoke('profile-guard:check'),
  
  /**
   * Set up Profile Guard
   * @param {Object} params - {password: string, highSecurityMode: boolean}
   * @returns {Promise<{success: boolean, highSecurityMode?: boolean, error?: string}>}
   */
  setupProfileGuard: (params) => ipcRenderer.invoke('profile-guard:setup', params),
  
  /**
   * Update Profile Guard security mode
   * @param {Object} params - {highSecurityMode: boolean}
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  updateProfileGuardSecurityMode: (params) => ipcRenderer.invoke('profile-guard:update-security-mode', params),
  
  /**
   * Verify Profile Guard password (for High Security Mode)
   * @param {Object} params - {password: string}
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  verifyProfileGuardPassword: (params) => ipcRenderer.invoke('profile-guard:verify-password', params),
  
  /**
   * Unlock Profile Guard (auto-unlock if not in high security mode)
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  unlockProfileGuard: () => ipcRenderer.invoke('profile-guard:unlock'),
  
  /**
   * Remove Profile Guard
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  removeProfileGuard: () => ipcRenderer.invoke('profile-guard:remove'),
  
  /**
   * Delete Profile Guard secrets (forgot password option)
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  deleteProfileGuardSecrets: () => ipcRenderer.invoke('profile-guard:delete-secrets'),
  
  /**
   * Export online profile with password-based encryption
   * @param {Object} params - {profile: Object, password: string}
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  exportOnlineProfile: (params) => ipcRenderer.invoke('online:profile:export', params),
  
  /**
   * Export keypair with password-based encryption
   * @param {Object} params - {keypair: Object, password: string}
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  exportKeypair: (params) => ipcRenderer.invoke('online:keypair:export', params),
  
  /**
   * Import keypair with password-based decryption
   * @param {Object} params - {encryptedData: string, password: string}
   * @returns {Promise<{success: boolean, keypair?: Object, error?: string}>}
   */
  importKeypair: (params) => ipcRenderer.invoke('online:keypair:import', params),
  // Admin keypair operations (database-backed)
  listAdminKeypairs: () => ipcRenderer.invoke('online:admin-keypairs:list'),
  getAdminKeypair: (keypairUuid) => ipcRenderer.invoke('online:admin-keypair:get', { keypairUuid }),
  createAdminKeypair: (options) => ipcRenderer.invoke('online:admin-keypair:create', options),
  addAdminKeypair: (options) => ipcRenderer.invoke('online:admin-keypair:add', options),
  updateAdminKeypairStorageStatus: (keypairUuid, storageStatus, privateKey) => ipcRenderer.invoke('online:admin-keypair:update-storage-status', { keypairUuid, storageStatus, privateKey }),
  deleteAdminKeypair: (keypairUuid) => ipcRenderer.invoke('online:admin-keypair:delete', { keypairUuid }),
  updateAdminKeypairMetadata: (keypairUuid, name, label, comments) => ipcRenderer.invoke('online:admin-keypair:update-metadata', { keypairUuid, name, label, comments }),
  exportAdminKeypairSecretPKCS: (keypairUuid, password) => ipcRenderer.invoke('online:admin-keypair:export-secret-pkcs', { keypairUuid, password }),
  importAdminKeypairSecretPKCS: (keypairUuid, filePath, password) => ipcRenderer.invoke('online:admin-keypair:import-secret-pkcs', { keypairUuid, filePath, password }),
  removeAdminKeypairSecret: (keypairUuid) => ipcRenderer.invoke('online:admin-keypair:remove-secret', { keypairUuid }),
  
  // Encryption key operations
  listEncryptionKeys: () => ipcRenderer.invoke('online:encryption-keys:list'),
  getEncryptionKey: (params) => ipcRenderer.invoke('online:encryption-key:get', params),
  createEncryptionKey: (options) => ipcRenderer.invoke('online:encryption-key:create', options),
  updateEncryptionKeyMetadata: (params) => ipcRenderer.invoke('online:encryption-key:update-metadata', params),
  deleteEncryptionKey: (params) => ipcRenderer.invoke('online:encryption-key:delete', params),
  exportEncryptionKey: (params) => ipcRenderer.invoke('online:encryption-key:export', params),
  importEncryptionKey: (params) => ipcRenderer.invoke('online:encryption-key:import', params),
  
  // Trust Declaration operations
  listTrustDeclarations: () => ipcRenderer.invoke('online:trust-declarations:list'),
  getTrustDeclaration: (params) => ipcRenderer.invoke('online:trust-declaration:get', params),
  createTrustDeclaration: (declarationData) => ipcRenderer.invoke('online:trust-declaration:create', declarationData),
  updateTrustDeclarationMetadata: (params) => ipcRenderer.invoke('online:trust-declaration:update-metadata', params),
  deleteTrustDeclaration: (params) => ipcRenderer.invoke('online:trust-declaration:delete', params),
  exportAllTrustDeclarations: () => ipcRenderer.invoke('online:trust-declarations:export-all'),
  importTrustDeclarations: () => ipcRenderer.invoke('online:trust-declarations:import'),
  exportAdminPublicKeys: () => ipcRenderer.invoke('online:admin-public-keys:export'),
  importAdminPublicKeys: () => ipcRenderer.invoke('online:admin-public-keys:import'),
  
  // Admin Declaration operations (for admindeclarations table)
  saveAdminDeclaration: (declarationData) => ipcRenderer.invoke('online:admin-declaration:save', declarationData),
  updateAdminDeclarationStatus: (declarationUuid, status) => ipcRenderer.invoke('online:admin-declaration:update-status', { declarationUuid, status }),
  getAdminDeclaration: (declarationUuid) => ipcRenderer.invoke('online:admin-declaration:get', { declarationUuid }),
  signAdminDeclaration: (declarationUuid, keypairUuid, keypairType) => ipcRenderer.invoke('online:admin-declaration:sign', { declarationUuid, keypairUuid, keypairType }),
  
  // Nostr keypair publishing
  getAvailableNostrSigningKeypairs: () => ipcRenderer.invoke('online:get-available-nostr-signing-keypairs'),
  generateKeypairPublishEventPreview: (keypairType, keypairUuid, signingKeypairUuid, profileUuid) => ipcRenderer.invoke('online:generate-keypair-publish-event-preview', { keypairType, keypairUuid, signingKeypairUuid, profileUuid }),
  publishKeypairToNostr: (keypairType, keypairUuid, signingKeypairUuid, profileUuid) => ipcRenderer.invoke('online:publish-keypair-to-nostr', { keypairType, keypairUuid, signingKeypairUuid, profileUuid }),
  
  /**
   * Publish user profile as Nostr kind 0 event (NIP-01)
   * @param {Object} params - {profileUuid: string}
   * @returns {Promise<{success: boolean, eventId?: string, error?: string}>}
   */
  publishProfileToNostr: (params) => ipcRenderer.invoke('online:publish-profile-to-nostr', params),
  // Profile publishing preferences
  getProfilePublishingPreferences: () => ipcRenderer.invoke('online:profile:publishing-preferences:get'),
  setProfilePublishingPreferences: (prefs) => ipcRenderer.invoke('online:profile:publishing-preferences:set', prefs),
  
  // Check if user has profile and Nostr keypair for publishing
  checkProfileForPublishing: () => ipcRenderer.invoke('online:check-profile-for-publishing'),
  
  // Get profile publish status
  getProfilePublishStatus: () => ipcRenderer.invoke('online:profile:publish-status'),
  
  // Publish ratings to Nostr as NIP-33 event
  publishRatingsToNostr: (params) => ipcRenderer.invoke('online:publish-ratings-to-nostr', params),

  // Get list of ratings for publishing
  getRatingsForPublishing: () => ipcRenderer.invoke('online:ratings:list-for-publishing'),

  // Publish multiple ratings in batch
  publishRatingsBatch: (params) => ipcRenderer.invoke('online:ratings:publish-batch', params),

  // Publish history
  getPublishHistory: (params) => ipcRenderer.invoke('online:publish-history:get', params),

  // Queue maintenance
  clearCompletedQueue: (params) => ipcRenderer.invoke('online:queue:clear-completed', params),

  // Game submission
  enqueueGameSubmission: (params) => ipcRenderer.invoke('online:submission:enqueue', params),

  // =============================
  // Tags (SMW) - categories and suggestions
  // =============================
  getTagCategoryTree: () => ipcRenderer.invoke('tags:category-tree:get'),
  getTagsMap: () => ipcRenderer.invoke('tags:map:get'),
  suggestTags: (params) => ipcRenderer.invoke('tags:suggest', params || {}),
  getTagsByCategory: (categoryPath) => ipcRenderer.invoke('tags:by-category', { categoryPath }),

  // Ratings summaries (Nostr ingestion)
  ratings: {
    getSummaries: (gameId) => ipcRenderer.invoke('ratings:summaries:get', { gameId })
  },
  
  // User Op keypair operations (profile-bound admin keypairs)
  listUserOpKeypairs: (profileUuid) => ipcRenderer.invoke('online:user-op-keypairs:list', { profileUuid }),
  getUserOpKeypair: (keypairUuid) => ipcRenderer.invoke('online:user-op-keypair:get', { keypairUuid }),
  createUserOpKeypair: (options) => ipcRenderer.invoke('online:user-op-keypair:create', options),
  addUserOpKeypair: (options) => ipcRenderer.invoke('online:user-op-keypair:add', options),
  updateUserOpKeypairStorageStatus: (keypairUuid, storageStatus) => ipcRenderer.invoke('online:user-op-keypair:update-storage-status', { keypairUuid, storageStatus }),
  deleteUserOpKeypair: (keypairUuid) => ipcRenderer.invoke('online:user-op-keypair:delete', { keypairUuid }),
  updateUserOpKeypairMetadata: (keypairUuid, name, label, comments) => ipcRenderer.invoke('online:user-op-keypair:update-metadata', { keypairUuid, name, label, comments }),
  exportUserOpKeypairSecretPKCS: (keypairUuid, password) => ipcRenderer.invoke('online:user-op-keypair:export-secret-pkcs', { keypairUuid, password }),
  importUserOpKeypairSecretPKCS: (keypairUuid, pkcsDataJson, password) => ipcRenderer.invoke('online:user-op-keypair:import-secret-pkcs', { keypairUuid, pkcsDataJson, password }),
  removeUserOpKeypairSecret: (keypairUuid) => ipcRenderer.invoke('online:user-op-keypair:remove-secret', { keypairUuid }),

  // Nostr Runtime Service (stub) operations
  initNostrRuntime: (options) => ipcRenderer.invoke('nostr:nrs:init', options || {}),
  setNostrRuntimeMode: (mode) => ipcRenderer.invoke('nostr:nrs:set-mode', { mode }),
  getNostrRuntimeResourceLimits: () => ipcRenderer.invoke('nostr:nrs:limits:get'),
  setNostrRuntimeResourceLimits: (updates) => ipcRenderer.invoke('nostr:nrs:limits:set', updates || {}),
  getNostrRelayCategories: () => ipcRenderer.invoke('nostr:nrs:relay-categories:get'),
  setNostrRelayCategories: (categories) => ipcRenderer.invoke('nostr:nrs:relay-categories:set', categories || []),
  listNostrRelays: (options) => ipcRenderer.invoke('nostr:nrs:relays:list', options || {}),
  addNostrRelay: (relay) => ipcRenderer.invoke('nostr:nrs:relays:add', relay || {}),
  updateNostrRelay: (relayUrl, changes) => ipcRenderer.invoke('nostr:nrs:relays:update', { relayUrl, changes }),
  removeNostrRelay: (relayUrl, force = false) => ipcRenderer.invoke('nostr:nrs:relays:remove', { relayUrl, force }),
  listNostrManualFollows: () => ipcRenderer.invoke('nostr:nrs:follow:list'),
  updateNostrManualFollows: (entries) => ipcRenderer.invoke('nostr:nrs:follow:update', { entries: entries || [] }),
  addNostrManualFollow: (entry) => ipcRenderer.invoke('nostr:nrs:follow:add', entry || {}),
  removeNostrManualFollow: (pubkey) => ipcRenderer.invoke('nostr:nrs:follow:remove', { pubkey }),
  listNostrQueue: () => ipcRenderer.invoke('nostr:nrs:queue:list'),
  publishNostrEvent: (payload) => ipcRenderer.invoke('nostr:nrs:publish', payload || {}),
  getNostrQueueSummary: (tableName, recordUuid) => ipcRenderer.invoke('nostr:queue:summary', { tableName, recordUuid }),
  retryNostrQueueEvent: (tableName, recordUuid) => ipcRenderer.invoke('nostr:queue:retry', { tableName, recordUuid }),
  shutdownNostrRuntime: (options) => ipcRenderer.invoke('nostr:nrs:shutdown', options || {}),
  onNostrRuntimeStatus: (callback) => {
    const handler = (_event, status) => callback(status);
    ipcRenderer.on('nostr:nrs:status', handler);
    return () => ipcRenderer.removeListener('nostr:nrs:status', handler);
  },

  // Trust assignments
  listTrustAssignments: (pubkey) => ipcRenderer.invoke('trust:assignments:list', { pubkey }),
  createTrustAssignment: (payload) => ipcRenderer.invoke('trust:assignments:create', payload || {}),
  deleteTrustAssignment: ({ assignmentId, actorPubkey }) => ipcRenderer.invoke('trust:assignments:delete', { assignmentId, actorPubkey }),
  getTrustPermissions: (pubkey) => ipcRenderer.invoke('trust:permissions:get', { pubkey }),
  moderationBlockTarget: (payload) => ipcRenderer.invoke('moderation:block-target', payload || {}),
  moderationRevokeAction: (payload) => ipcRenderer.invoke('moderation:revoke-action', payload || {}),
  moderationListActions: (payload) => ipcRenderer.invoke('moderation:list-actions', payload || {}),
  onTrustChanged: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('trust:changed', handler);
    return () => ipcRenderer.removeListener('trust:changed', handler);
  },

  provisioner: {
    getState: () => ipcRenderer.invoke('provisioner:get-state'),
    runPlan: () => ipcRenderer.invoke('provisioner:run-plan'),
    runProvision: () => ipcRenderer.invoke('provisioner:run-provision'),
    launchMain: () => ipcRenderer.invoke('provisioner:launch-main'),
    openArDrive: () => ipcRenderer.invoke('provisioner:open-ardrive'),
    onLog: (callback) => {
      if (typeof callback !== 'function') {
        return () => {};
      }
      const handler = (_event, message) => callback(message);
      ipcRenderer.on('provisioner:log', handler);
      return () => ipcRenderer.removeListener('provisioner:log', handler);
    },
    onStatus: (callback) => {
      if (typeof callback !== 'function') {
        return () => {};
      }
      const handler = (_event, payload) => callback(payload);
      ipcRenderer.on('provisioner:status', handler);
      return () => ipcRenderer.removeListener('provisioner:status', handler);
    },
  },
});
