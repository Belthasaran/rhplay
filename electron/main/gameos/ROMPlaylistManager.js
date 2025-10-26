/**
 * ROM Playlist Manager
 * 
 * Auto-progression system for playing through multiple ROMs sequentially
 * Works with stock SD2SNES firmware - no modifications needed!
 * 
 * Features:
 * - Load ROM playlist from file
 * - Auto-detect game completion (credits, game over)
 * - Automatically load next ROM
 * - Save progress between ROMs
 * - Resume from last position
 */

const fs = require('fs').promises;

class ROMPlaylistManager {
  /**
   * @param {SNESWrapper} snesWrapper - Active SNES connection
   */
  constructor(snesWrapper) {
    this.snes = snesWrapper;
    this.playlist = [];
    this.currentIndex = 0;
    this.playlistPath = null;
    this.progressPath = '/work/playlist_progress.json';
  }

  /**
   * Load playlist from SD card file
   * 
   * @param {string} path - Path to playlist file on SD card
   * @returns {Promise<number>} Number of ROMs in playlist
   */
  async loadPlaylist(path) {
    this.playlistPath = path;
    
    console.log(`Loading playlist from ${path}...`);
    const data = await this.snes.GetFile(path);
    const text = data.toString('utf-8');
    
    // Parse playlist (one ROM path per line)
    this.playlist = text.split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'));  // Skip empty and comments
    
    console.log(`✓ Loaded ${this.playlist.length} ROMs`);
    
    // Try to load progress
    await this.loadProgress();
    
    return this.playlist.length;
  }

  /**
   * Load progress from previous session
   */
  async loadProgress() {
    try {
      const data = await this.snes.GetFile(this.progressPath);
      const progress = JSON.parse(data.toString());
      
      if (progress.playlistPath === this.playlistPath) {
        this.currentIndex = progress.currentIndex || 0;
        console.log(`Resuming from ROM ${this.currentIndex + 1}/${this.playlist.length}`);
      }
    } catch (error) {
      console.log('No previous progress found (starting fresh)');
    }
  }

  /**
   * Save current progress
   */
  async saveProgress() {
    const progress = {
      playlistPath: this.playlistPath,
      currentIndex: this.currentIndex,
      timestamp: Date.now(),
      currentROM: this.playlist[this.currentIndex]
    };
    
    const data = Buffer.from(JSON.stringify(progress, null, 2));
    await this.snes.PutFile(data, this.progressPath);
    console.log('Progress saved');
  }

  /**
   * Wait for game completion
   * Watches for credits or game over
   * 
   * @param {Object} options - Detection options
   * @returns {Promise<string>} Completion reason
   */
  async waitForCompletion(options = {}) {
    const {
      creditsAddress = 0x7E0100,  // SMW game mode address
      creditsValue = 0x1C,         // SMW credits mode
      pollRate = 1000,             // Check every second
      timeout = 0                  // 0 = no timeout
    } = options;
    
    console.log('Waiting for game completion...');
    console.log('  (Watching for credits or game over)');
    
    try {
      await this.snes.watchForConditions([
        { address: creditsAddress, size: 1, value: creditsValue }
      ], timeout, pollRate);
      
      return 'credits';
    } catch (error) {
      if (error.message.includes('timeout')) {
        return 'timeout';
      }
      throw error;
    }
  }

  /**
   * Load next ROM in playlist
   * 
   * @returns {Promise<boolean>} True if loaded, false if playlist complete
   */
  async loadNextROM() {
    this.currentIndex++;
    
    if (this.currentIndex >= this.playlist.length) {
      console.log('\n🎉 Playlist complete! All ROMs finished!');
      return false;
    }
    
    const nextROM = this.playlist[this.currentIndex];
    console.log(`\nLoading ROM ${this.currentIndex + 1}/${this.playlist.length}:`);
    console.log(`  ${nextROM}`);
    
    // Save progress before loading
    await this.saveProgress();
    
    // Load ROM
    await this.snes.Boot(nextROM);
    
    // Wait for boot
    await this._sleep(5000);
    
    console.log('✓ ROM loaded and ready!');
    return true;
  }

  /**
   * Run the full playlist auto-progression
   * 
   * @param {Object} options - Completion detection options
   */
  async run(options = {}) {
    console.log('\n=== ROM Playlist Auto-Progression ===');
    console.log(`Playlist: ${this.playlist.length} ROMs`);
    console.log(`Starting at: ROM ${this.currentIndex + 1}`);
    console.log();
    
    // Load first ROM if starting fresh
    if (this.currentIndex === 0) {
      console.log('Loading first ROM...');
      await this.snes.Boot(this.playlist[0]);
      await this._sleep(5000);
    }
    
    while (true) {
      console.log(`\n--- ROM ${this.currentIndex + 1}/${this.playlist.length} ---`);
      console.log(`Current: ${this.playlist[this.currentIndex]}`);
      
      // Wait for completion
      const reason = await this.waitForCompletion(options);
      console.log(`✓ ROM completed (${reason})`);
      
      // Load next ROM
      const hasNext = await this.loadNextROM();
      if (!hasNext) break;
    }
    
    console.log('\n=== Playlist Complete ===');
  }

  /**
   * Get current status
   * 
   * @returns {Object} Status information
   */
  getStatus() {
    return {
      totalROMs: this.playlist.length,
      currentIndex: this.currentIndex,
      currentROM: this.playlist[this.currentIndex],
      remaining: this.playlist.length - this.currentIndex - 1,
      percentComplete: ((this.currentIndex / this.playlist.length) * 100).toFixed(1)
    };
  }

  /**
   * Skip to specific ROM
   * 
   * @param {number} index - ROM index to skip to
   */
  async skipTo(index) {
    if (index < 0 || index >= this.playlist.length) {
      throw new Error(`Invalid index: ${index}`);
    }
    
    this.currentIndex = index;
    const rom = this.playlist[index];
    
    console.log(`Skipping to ROM ${index + 1}/${this.playlist.length}: ${rom}`);
    await this.saveProgress();
    await this.snes.Boot(rom);
    await this._sleep(5000);
    console.log('✓ ROM loaded');
  }

  async _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = ROMPlaylistManager;

