/**
 * SMW Chat Commands System
 * 
 * Commands mimicing those based of PatCdr's chat bot system
 * Implements Chat Hacks-like command parsing and execution
 * 
 * Supported Commands:
 * - !w ADDRESS VALUE [ADDRESS VALUE ...] - Write to memory
 * - !r ADDRESS [ADDRESS ...] - Read from memory
 * - !read ADDRESS - Read from memory
 * - !reset - Reboot the SNES console
 * - !menu - Return to SNES menu
 * - !boot FILE - Boot a ROM file (e.g., !boot /work/smw.sfc)
 * - !powerup VALUE - Set powerup (pseudocommand)
 * - !lives VALUE - Set lives (pseudocommand)
 * - ... (50+ pseudocommands)
 * - !load MODULE_NAME - Load CARL-Like ASM module
 * - !unload MODULE_NAME - Unload CARL-Like ASM module
 * - !reload MODULE_NAME - Reload CARL-Like ASM module
 */

/**
 * Chat Hacks Pseudocommand to Address Mapping
 * From carl_defines.txt and Chat_Hacks.html
 */
const PSEUDOCOMMANDS = {
  // Basic Commands
  'powerup': 0x7E0019,
  'vx': 0x7E007B,                    // Mario velocity X
  'vy': 0x7E007D,                    // Mario velocity Y
  'mode': 0x7E0100,                  // Game mode
  
  // Player Status
  'lives': 0x7E0DBE,                 // Actually uses StatusLives (display)
  'coins': 0x7E0DBF,                 // Status coins
  'reserve_item': 0x7E0DC2,
  'queued_lives': 0x7E18E4,
  
  // Level Properties
  'is_water_level': 0x7E0085,
  'slippery_amount': 0x7E0086,
  'can_scroll': 0x7E1411,
  'scroll_screen': 0x7E13FE,
  'scroll_mode': 0x7E143E,
  
  // Visual Effects
  'screen_display_value': 0x7E0DAE,  // Brightness
  'mosaic_value': 0x7E0DB0,
  'layer_1_shake_timer': 0x7E1887,
  'transition_stars': 0x7E13CB,
  'transition_counter': 0x7E141A,
  
  // Control Flags
  'freeze_everything': 0x7E13FD,
  'is_paused': 0x7E13D4,
  'disable_ground_collision': 0x7E185C,
  'can_climb_on_air': 0x7E18BE,
  
  // Yoshi
  'yoshi_color': 0x7E13C7,
  'is_riding_yoshi': 0x7E187A,
  'loose_yoshi_flag': 0x7E18E2,
  'yoshi_egg_sprite': 0x7E18DA,
  'yoshi_egg_timer': 0x7E18DE,
  
  // Timers
  'star_timer': 0x7E1490,
  'invulnerability_timer': 0x7E1497,
  'end_level_timer': 0x7E1493,
  'keyhole_timer': 0x7E1434,
  'sparkle_timer': 0x7E18D3,
  'pswitch_blue_timer': 0x7E14AD,
  'pswitch_silver_timer': 0x7E14AE,
  'bonus_game_end_timer': 0x7E14AB,
  'player_stun_timer': 0x7E18BD,
  
  // Timer Display
  'timer_hundreds': 0x7E0F31,
  'timer_tens': 0x7E0F32,
  'timer_ones': 0x7E0F33,
  
  // P-Meter and Messages
  'p_meter': 0x7E13E4,
  'message_box_dispatch': 0x7E1426,
  
  // Multiplayer
  'is_multiplayer': 0x7E0DB2,
  'is_player2': 0x7E0DB3,
  'is_player2_overworld': 0x7E0DD6,
  
  // Overworld Position (Mario)
  'mario_overworld_x_lo': 0x7E1F17,
  'mario_overworld_x_hi': 0x7E1F18,
  'mario_overworld_y_lo': 0x7E1F19,
  'mario_overworld_y_hi': 0x7E1F1A,
  'mario_submap': 0x7E1F11,
  
  // Overworld Position (Luigi)
  'luigi_overworld_x_lo': 0x7E1F1B,
  'luigi_overworld_x_hi': 0x7E1F1C,
  'luigi_overworld_y_lo': 0x7E1F1D,
  'luigi_overworld_y_hi': 0x7E1F1E,
  'luigi_submap': 0x7E1F12,
  
  // Level Mechanics
  'is_water_current': 0x7E1403,
  'generator_type': 0x7E18B9,
  'enemy_hop_counter': 0x7E1697,
  'is_in_lakitu_cloud': 0x7E18C2,
  
  // Platform Control
  'brown_platform_radius_low': 0x7E14BC,
  'brown_platform_radius_high': 0x7E14BD,
  'skull_platform_speed': 0x7E18BC,
  
  // Special
  'bonus_game_1ups': 0x7E1890,
  'player_mode_dispatch': 0x7E0071,
  'music_dispatch': 0x7E1DFB,
  'is_switch_off': 0x7E14AF,
  'switch_palace_flags': 0x7E1F27,
  'side_exit_flag': 0x7E1B96
};

class SMWChatCommands {
  /**
   * @param {SNESWrapper} snesWrapper - Active SNES connection
   */
  constructor(snesWrapper) {
    this.snes = snesWrapper;
    this.commandHistory = [];
    this.maxHistory = 100;
  }

  /**
   * Parse and execute a chat command
   * 
   * @param {string} command - Chat command string
   * @returns {Promise<Object>} Result {success, message, data}
   */
  async executeCommand(command) {
    try {
      const trimmed = command.trim();
      
      // Add to history
      this.addToHistory(trimmed);
      
      // Empty command
      if (!trimmed) {
        return { success: false, message: 'Empty command' };
      }
      
      // Parse command type
      if (trimmed.startsWith('!w ')) {
        return await this.executeWrite(trimmed);
      } else if (trimmed.startsWith('!r ') || trimmed.startsWith('!read ')) {
        return await this.executeRead(trimmed);
      } else if (trimmed === '!reset') {
        return await this.executeReset();
      } else if (trimmed === '!menu') {
        return await this.executeMenu();
      } else if (trimmed.startsWith('!boot ')) {
        return await this.executeBoot(trimmed);
      } else if (trimmed.startsWith('!load ')) {
        return await this.executeLoad(trimmed);
      } else if (trimmed.startsWith('!unload ')) {
        return await this.executeUnload(trimmed);
      } else if (trimmed.startsWith('!reload ')) {
        return await this.executeReload(trimmed);
      } else if (trimmed === '!unloadall') {
        return await this.executeUnloadAll();
      } else if (trimmed === '!clearhook') {
        return await this.executeClearHook();
      } else if (trimmed.startsWith('!')) {
        // Check for pseudocommand
        return await this.executePseudocommand(trimmed);
      } else {
        return { success: false, message: 'Unknown command format. Use !w, !r, !reset, !menu, !boot, !load, !unload, !unloadall, or a pseudocommand' };
      }
    } catch (error) {
      console.error('[SMWChatCommands] Error:', error);
      return { success: false, message: `Error: ${error.message}` };
    }
  }

  /**
   * Execute !w (write) command
   * Format: !w ADDRESS VALUE [ADDRESS VALUE ...]
   * 
   * @param {string} command - Full command string
   * @returns {Promise<Object>} Result
   */
  async executeWrite(command) {
    // Remove !w prefix
    const args = command.substring(3).trim().split(/\s+/).filter(arg => arg && !arg.startsWith('--'));
    
    if (args.length < 2 || args.length % 2 !== 0) {
      return { success: false, message: 'Usage: !w ADDRESS VALUE [ADDRESS VALUE ...]' };
    }
    
    const writes = [];
    const writeLog = [];
    
    // Parse address/value pairs
    for (let i = 0; i < args.length; i += 2) {
      const addr = this.parseHex(args[i]);
      const value = this.parseHex(args[i + 1]);
      
      if (addr === null || value === null) {
        return { success: false, message: `Invalid hex value: ${args[i]} or ${args[i + 1]}` };
      }
      
      // Convert SNES address to USB2SNES protocol address
      // SNES: 0x7E0000-0x7FFFFF (WRAM) -> USB2SNES: 0xF50000-0xF6FFFF
      let protocolAddr = addr;
      if (addr >= 0x7E0000 && addr <= 0x7FFFFF) {
        protocolAddr = 0xF50000 + (addr - 0x7E0000);
      }
      
      writes.push([protocolAddr, Buffer.from([value & 0xFF])]);
      writeLog.push(`0x${addr.toString(16).toUpperCase()}=0x${value.toString(16).padStart(2, '0').toUpperCase()}`);
    }
    
    // Execute writes
    try {
      await this.snes.PutAddress(writes);
      
      return {
        success: true,
        message: `✓ Wrote ${writes.length} value(s): ${writeLog.join(', ')}`,
        data: { writes: writeLog }
      };
    } catch (error) {
      console.error('[SMWChatCommands] PutAddress error:', error);
      return {
        success: false,
        message: `✗ Failed to write: ${error.message}`,
        data: { error: error.message }
      };
    }
  }

  /**
   * Execute !r / !read (read) command
   * Format: !r ADDRESS [ADDRESS ...]
   * 
   * @param {string} command - Full command string
   * @returns {Promise<Object>} Result
   */
  async executeRead(command) {
    // Remove !r or !read prefix
    const prefix = command.startsWith('!read') ? '!read' : '!r';
    const args = command.substring(prefix.length).trim().split(/\s+/).filter(arg => arg && !arg.startsWith('--'));
    
    if (args.length < 1) {
      return { success: false, message: 'Usage: !r ADDRESS [ADDRESS ...]' };
    }
    
    const addresses = [];
    const originalAddrs = [];
    const results = [];
    
    // Parse addresses
    for (const arg of args) {
      const addr = this.parseHex(arg);
      if (addr === null) {
        return { success: false, message: `Invalid hex address: ${arg}` };
      }
      
      // Convert SNES address to USB2SNES protocol address
      // SNES: 0x7E0000-0x7FFFFF (WRAM) -> USB2SNES: 0xF50000-0xF6FFFF
      let protocolAddr = addr;
      if (addr >= 0x7E0000 && addr <= 0x7FFFFF) {
        protocolAddr = 0xF50000 + (addr - 0x7E0000);
      }
      
      addresses.push([protocolAddr, 1]);
      originalAddrs.push(addr);
    }
    
    // Read values
    try {
      const values = await this.snes.GetAddresses(addresses);
      
      // Format results (use original SNES addresses in output)
      for (let i = 0; i < originalAddrs.length; i++) {
        const addr = originalAddrs[i];
        const value = values[i][0];
        results.push(`0x${addr.toString(16).toUpperCase()}=0x${value.toString(16).padStart(2, '0').toUpperCase()}`);
      }
      
      return {
        success: true,
        message: `✓ Read ${values.length} value(s): ${results.join(', ')}`,
        data: { reads: results }
      };
    } catch (error) {
      console.error('[SMWChatCommands] GetAddresses error:', error);
      return {
        success: false,
        message: `✗ Failed to read: ${error.message}`,
        data: { error: error.message }
      };
    }
  }

  /**
   * Execute pseudocommand
   * Format: !powerup 0x02, !lives 0x63, etc.
   * 
   * @param {string} command - Full command string
   * @returns {Promise<Object>} Result
   */
  async executePseudocommand(command) {
    const parts = command.substring(1).trim().split(/\s+/);
    const cmdName = parts[0].toLowerCase();
    const value = parts[1];
    
    if (!PSEUDOCOMMANDS[cmdName]) {
      return { success: false, message: `Unknown pseudocommand: !${cmdName}` };
    }
    
    if (!value) {
      return { success: false, message: `Usage: !${cmdName} VALUE` };
    }
    
    const addr = PSEUDOCOMMANDS[cmdName];
    const val = this.parseHex(value);
    
    if (val === null) {
      return { success: false, message: `Invalid hex value: ${value}` };
    }
    
    // Convert SNES address to USB2SNES protocol address
    // SNES: 0x7E0000-0x7FFFFF (WRAM) -> USB2SNES: 0xF50000-0xF6FFFF
    let protocolAddr = addr;
    if (addr >= 0x7E0000 && addr <= 0x7FFFFF) {
      protocolAddr = 0xF50000 + (addr - 0x7E0000);
    }
    
    // Execute write
    try {
      await this.snes.PutAddress([[protocolAddr, Buffer.from([val & 0xFF])]]);
      
      return {
        success: true,
        message: `✓ Set ${cmdName} to 0x${val.toString(16).padStart(2, '0').toUpperCase()} (address 0x${addr.toString(16).toUpperCase()})`,
        data: { command: cmdName, address: addr, value: val }
      };
    } catch (error) {
      console.error('[SMWChatCommands] PutAddress error:', error);
      return {
        success: false,
        message: `✗ Failed to write to address 0x${addr.toString(16).toUpperCase()}: ${error.message}`,
        data: { command: cmdName, address: addr, value: val, error: error.message }
      };
    }
  }

  /**
   * Execute !load command (simulating interface of Patcdr's Project CARL)
   * Format: !load MODULE_NAME
   * 
   * @param {string} command - Full command string
   * @returns {Promise<Object>} Result
   */
  async executeLoad(command) {
    const moduleName = command.substring(6).trim();
    
    if (!moduleName) {
      return { success: false, message: 'Usage: !load MODULE_NAME' };
    }
    
    // This will be handled by CarlModuleLoader
    return {
      success: true,
      message: `Loading module: ${moduleName}...`,
      data: { action: 'load', module: moduleName }
    };
  }

  /**
   * Execute !unload command (simulating interface of CARL)
   * Format: !unload MODULE_NAME
   * 
   * @param {string} command - Full command string
   * @returns {Promise<Object>} Result
   */
  async executeUnload(command) {
    const moduleName = command.substring(8).trim();
    
    if (!moduleName) {
      return { success: false, message: 'Usage: !unload MODULE_NAME' };
    }
    
    return {
      success: true,
      message: `Unloading module: ${moduleName}...`,
      data: { action: 'unload', module: moduleName }
    };
  }

  /**
   * Execute !reload command (simulating CARL-Like modules)
   * Format: !reload MODULE_NAME
   * 
   * @param {string} command - Full command string
   * @returns {Promise<Object>} Result
   */
  async executeReload(command) {
    const moduleName = command.substring(8).trim();
    
    if (!moduleName) {
      return { success: false, message: 'Usage: !reload MODULE_NAME' };
    }
    
    return {
      success: true,
      message: `Reloading module: ${moduleName}...`,
      data: { action: 'reload', module: moduleName }
    };
  }

  /**
   * Execute !unloadall command (CARL-Like modules)
   * Format: !unloadall
   * 
   * @returns {Promise<Object>} Result
   */
  async executeUnloadAll() {
    return {
      success: true,
      message: 'Unloading all modules...',
      data: { action: 'unloadall' }
    };
  }

  /**
   * Execute !clearhook command (Restore original $7F8000 routine)
   * Format: !clearhook
   * Useful after soft resets when hook may be corrupted
   * 
   * @returns {Promise<Object>} Result
   */
  async executeClearHook() {
    return {
      success: true,
      message: 'Clearing CARL frame hook...',
      data: { action: 'clearhook' }
    };
  }

  /**
   * Execute !reset command
   * Format: !reset
   * 
   * @returns {Promise<Object>} Result
   */
  async executeReset() {
    try {
      await this.snes.Reset();
      
      return {
        success: true,
        message: '✓ SNES console rebooting...',
        data: { action: 'reset' }
      };
    } catch (error) {
      console.error('[SMWChatCommands] Reset error:', error);
      return {
        success: false,
        message: `✗ Failed to reset console: ${error.message}`,
        data: { error: error.message }
      };
    }
  }

  /**
   * Execute !menu command
   * Format: !menu
   * 
   * @returns {Promise<Object>} Result
   */
  async executeMenu() {
    try {
      await this.snes.Menu();
      
      return {
        success: true,
        message: '✓ Returning to SNES menu...',
        data: { action: 'menu' }
      };
    } catch (error) {
      console.error('[SMWChatCommands] Menu error:', error);
      return {
        success: false,
        message: `✗ Failed to return to menu: ${error.message}`,
        data: { error: error.message }
      };
    }
  }

  /**
   * Execute !boot command
   * Format: !boot FILE_PATH
   * 
   * @param {string} command - Full command string
   * @returns {Promise<Object>} Result
   */
  async executeBoot(command) {
    const filePath = command.substring(6).trim();
    
    if (!filePath) {
      return { success: false, message: 'Usage: !boot FILE_PATH (e.g., !boot /work/smw.sfc)' };
    }
    
    try {
      await this.snes.Boot(filePath);
      
      return {
        success: true,
        message: `✓ Booting ${filePath}...`,
        data: { action: 'boot', file: filePath }
      };
    } catch (error) {
      console.error('[SMWChatCommands] Boot error:', error);
      return {
        success: false,
        message: `✗ Failed to boot ${filePath}: ${error.message}`,
        data: { file: filePath, error: error.message }
      };
    }
  }

  /**
   * Parse hex number (supports 0x prefix or not)
   * 
   * @param {string} hexStr - Hex string
   * @returns {number|null} Parsed number or null if invalid
   */
  parseHex(hexStr) {
    try {
      const cleaned = hexStr.trim().replace(/^0x/i, '');
      const value = parseInt(cleaned, 16);
      return isNaN(value) ? null : value;
    } catch {
      return null;
    }
  }

  /**
   * Add command to history
   * 
   * @param {string} command - Command string
   */
  addToHistory(command) {
    this.commandHistory.push(command);
    
    // Limit history size
    if (this.commandHistory.length > this.maxHistory) {
      this.commandHistory.shift();
    }
  }

  /**
   * Get command history
   * 
   * @returns {Array<string>} Command history
   */
  getHistory() {
    return [...this.commandHistory];
  }

  /**
   * Get list of available pseudocommands
   * 
   * @returns {Array<string>} Pseudocommand names
   */
  getPseudocommands() {
    return Object.keys(PSEUDOCOMMANDS).sort();
  }

  /**
   * Get help text for a specific command
   * 
   * @param {string} cmdName - Command name (without !)
   * @returns {string|null} Help text
   */
  getCommandHelp(cmdName) {
    const helps = {
      'w': 'Write to memory. Usage: !w ADDRESS VALUE [ADDRESS VALUE ...]',
      'r': 'Read from memory. Usage: !r ADDRESS [ADDRESS ...]',
      'read': 'Read from memory. Usage: !read ADDRESS [ADDRESS ...]',
      'reset': 'Reboot the SNES console. Usage: !reset',
      'menu': 'Return to SNES menu. Usage: !menu',
      'boot': 'Boot a ROM file. Usage: !boot FILE_PATH (e.g., !boot /work/smw.sfc)',
      'load': 'Load CARL-Like ASM module. Usage: !load MODULE_NAME',
      'unload': 'Unload CARL-Like ASM module. Usage: !unload MODULE_NAME',
      'reload': 'Reload CARL-Like ASM module. Usage: !reload MODULE_NAME',
      'powerup': 'Set powerup. Usage: !powerup VALUE (0=small, 1=big, 2=cape, 3=fire)',
      'lives': 'Set lives. Usage: !lives VALUE',
      'coins': 'Set coins. Usage: !coins VALUE',
      'vx': 'Set horizontal velocity. Usage: !vx VALUE',
      'vy': 'Set vertical velocity. Usage: !vy VALUE',
      'freeze_everything': 'Freeze sprites. Usage: !freeze_everything 1 (freeze) or 0 (unfreeze)',
      'star_timer': 'Set star invincibility timer. Usage: !star_timer VALUE',
      'pswitch_blue_timer': 'Set P-switch timer. Usage: !pswitch_blue_timer VALUE',
      'end_level_timer': 'End level. Usage: !end_level_timer 0xFF'
    };
    
    return helps[cmdName] || null;
  }
}

module.exports = { SMWChatCommands, PSEUDOCOMMANDS };

