/**
 * Save State Manager
 * 
 * File-based save state system using SD card storage
 * Integrates with Phase 3 savestate functionality
 * 
 * Features:
 * - Save states to SD card files
 * - Load states from SD card files
 * - Multiple save slots
 * - Metadata tracking (timestamp, size, ROM)
 * - List available save states
 */

class SaveStateManager {
  /**
   * @param {SNESWrapper} snesWrapper - Active SNES connection
   */
  constructor(snesWrapper) {
    this.snes = snesWrapper;
    this.saveDirectory = '/work/saves/';
  }

  /**
   * Ensure save directory exists
   */
  async ensureSaveDirectory() {
    try {
      await this.snes.MakeDir(this.saveDirectory);
    } catch (error) {
      // Directory might already exist, that's okay
    }
  }

  /**
   * Save current game state to a named slot
   * 
   * @param {string} slotName - Name for this save slot
   * @param {Object} metadata - Additional metadata to save
   * @returns {Promise<Object>} Save information
   */
  async saveState(slotName, metadata = {}) {
    await this.ensureSaveDirectory();
    
    console.log(`Saving state to slot: ${slotName}...`);
    
    // Capture state (Phase 3 feature)
    const stateData = await this.snes.SaveStateToMemory(true);
    
    // Generate paths
    const statePath = `${this.saveDirectory}${slotName}.state`;
    const metaPath = `${this.saveDirectory}${slotName}.meta`;
    
    // Save state data
    console.log(`  Writing ${stateData.length} bytes...`);
    await this.snes.PutFile(stateData, statePath);
    
    // Save metadata
    const metaData = {
      slotName,
      timestamp: Date.now(),
      size: stateData.length,
      version: 1,
      ...metadata  // Include any additional metadata
    };
    
    await this.snes.PutFile(
      Buffer.from(JSON.stringify(metaData, null, 2)),
      metaPath
    );
    
    console.log('✓ State saved successfully!');
    
    return metaData;
  }

  /**
   * Load game state from a named slot
   * 
   * @param {string} slotName - Name of save slot to load
   * @returns {Promise<Object>} Metadata of loaded state
   */
  async loadState(slotName) {
    console.log(`Loading state from slot: ${slotName}...`);
    
    const statePath = `${this.saveDirectory}${slotName}.state`;
    const metaPath = `${this.saveDirectory}${slotName}.meta`;
    
    // Load metadata first
    let metadata = null;
    try {
      const metaData = await this.snes.GetFile(metaPath);
      metadata = JSON.parse(metaData.toString());
      console.log(`  Savestate from: ${new Date(metadata.timestamp).toLocaleString()}`);
    } catch (error) {
      console.log('  (No metadata found)');
    }
    
    // Load state data
    console.log(`  Loading state data...`);
    const stateData = await this.snes.GetFile(statePath);
    
    if (stateData.length !== 320 * 1024) {
      throw new Error(`Invalid savestate size: ${stateData.length} bytes (expected ${320 * 1024})`);
    }
    
    // Restore state (Phase 3 feature)
    console.log('  Restoring state...');
    await this.snes.LoadStateFromMemory(stateData);
    
    console.log('✓ State loaded successfully!');
    
    return metadata;
  }

  /**
   * List all available save states
   * 
   * @returns {Promise<Array>} Array of save state info
   */
  async listStates() {
    try {
      const files = await this.snes.List(this.saveDirectory);
      const stateFiles = files.filter(f => f.endsWith('.state'));
      
      const states = [];
      
      for (const stateFile of stateFiles) {
        const slotName = stateFile.replace('.state', '');
        const metaPath = `${this.saveDirectory}${slotName}.meta`;
        
        let metadata = {
          slotName,
          timestamp: null,
          size: null
        };
        
        try {
          const metaData = await this.snes.GetFile(metaPath);
          metadata = JSON.parse(metaData.toString());
        } catch {
          // No metadata file
        }
        
        states.push(metadata);
      }
      
      // Sort by timestamp (newest first)
      states.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      
      return states;
    } catch (error) {
      console.log('Save directory not found or empty');
      return [];
    }
  }

  /**
   * Delete a save state
   * 
   * @param {string} slotName - Name of slot to delete
   */
  async deleteState(slotName) {
    console.log(`Deleting save state: ${slotName}...`);
    
    const statePath = `${this.saveDirectory}${slotName}.state`;
    const metaPath = `${this.saveDirectory}${slotName}.meta`;
    
    try {
      await this.snes.Remove(statePath);
      console.log('  ✓ State file deleted');
    } catch (error) {
      console.log('  State file not found');
    }
    
    try {
      await this.snes.Remove(metaPath);
      console.log('  ✓ Metadata file deleted');
    } catch (error) {
      console.log('  Metadata file not found');
    }
    
    console.log('✓ Save state deleted');
  }

  /**
   * Check if a save state exists
   * 
   * @param {string} slotName - Name of slot to check
   * @returns {Promise<boolean>} True if exists
   */
  async existsState(slotName) {
    try {
      const statePath = `${this.saveDirectory}${slotName}.state`;
      await this.snes.GetFile(statePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Copy a save state to a new slot
   * 
   * @param {string} fromSlot - Source slot name
   * @param {string} toSlot - Destination slot name
   */
  async copyState(fromSlot, toSlot) {
    console.log(`Copying save state: ${fromSlot} → ${toSlot}...`);
    
    // Load source state
    const fromStatePath = `${this.saveDirectory}${fromSlot}.state`;
    const fromMetaPath = `${this.saveDirectory}${fromSlot}.meta`;
    
    const stateData = await this.snes.GetFile(fromStatePath);
    
    let metadata = {};
    try {
      const metaData = await this.snes.GetFile(fromMetaPath);
      metadata = JSON.parse(metaData.toString());
    } catch {
      // No metadata
    }
    
    // Save to destination
    const toStatePath = `${this.saveDirectory}${toSlot}.state`;
    const toMetaPath = `${this.saveDirectory}${toSlot}.meta`;
    
    await this.snes.PutFile(stateData, toStatePath);
    
    // Update metadata
    metadata.slotName = toSlot;
    metadata.timestamp = Date.now();
    metadata.copiedFrom = fromSlot;
    
    await this.snes.PutFile(
      Buffer.from(JSON.stringify(metadata, null, 2)),
      toMetaPath
    );
    
    console.log('✓ Save state copied');
  }

  /**
   * Print list of save states to console
   */
  async printStates() {
    const states = await this.listStates();
    
    if (states.length === 0) {
      console.log('No save states found');
      return;
    }
    
    console.log(`\nFound ${states.length} save state(s):`);
    console.log('─'.repeat(60));
    
    for (const state of states) {
      const date = state.timestamp 
        ? new Date(state.timestamp).toLocaleString()
        : 'Unknown date';
      const size = state.size
        ? `${(state.size / 1024).toFixed(0)}KB`
        : 'Unknown size';
      
      console.log(`${state.slotName}`);
      console.log(`  Date: ${date}`);
      console.log(`  Size: ${size}`);
      if (state.copiedFrom) {
        console.log(`  Copied from: ${state.copiedFrom}`);
      }
      console.log();
    }
  }
}

module.exports = SaveStateManager;

