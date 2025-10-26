/**
 * Super Mario World Helper Functions
 * 
 * High-level helpers for manipulating SMW game state via USB2SNES
 * Requires an active SNESWrapper instance
 */

const { SMWAddresses, GAME_MODES, POWERUPS, YOSHI_COLORS, DIRECTIONS, SPRITE_STATES } = require('./SMWAddresses');

class SMWHelpers {
  /**
   * @param {SNESWrapper} snesWrapper - Active SNES connection wrapper
   */
  constructor(snesWrapper) {
    this.snes = snesWrapper;
    this.RAM = SMWAddresses;
    this.MODES = GAME_MODES;
    this.POWERUPS = POWERUPS;
    this.YOSHI = YOSHI_COLORS;
    this.DIRS = DIRECTIONS;
  }

  // ========================================
  // Game State Queries
  // ========================================

  /**
   * Get current game mode
   * @returns {Promise<number>} Game mode (see GAME_MODES)
   */
  async getGameMode() {
    const data = await this.snes.GetAddress(this.RAM.GameMode, 1);
    return data[0];
  }

  /**
   * Check if Mario is currently in a level
   * @returns {Promise<boolean>}
   */
  async isInLevel() {
    const mode = await this.getGameMode();
    return mode === GAME_MODES.LEVEL;
  }

  /**
   * Check if game is paused
   * @returns {Promise<boolean>}
   */
  async isPaused() {
    const mode = await this.getGameMode();
    return mode === GAME_MODES.PAUSED;
  }

  /**
   * Check if on overworld
   * @returns {Promise<boolean>}
   */
  async isOnOverworld() {
    const mode = await this.getGameMode();
    return mode === GAME_MODES.OVERWORLD;
  }

  /**
   * Check if level is vertical
   * @returns {Promise<boolean>}
   */
  async isVerticalLevel() {
    const data = await this.snes.GetAddress(this.RAM.IsVerticalLvl, 1);
    return data[0] !== 0;
  }

  /**
   * Check if water level
   * @returns {Promise<boolean>}
   */
  async isWaterLevel() {
    const data = await this.snes.GetAddress(this.RAM.IsWaterLevel, 1);
    return data[0] !== 0;
  }

  // ========================================
  // Player State (Lives, Coins, Powerup)
  // ========================================

  /**
   * Get player lives
   * @returns {Promise<number>}
   */
  async getLives() {
    const data = await this.snes.GetAddress(this.RAM.StatusLives, 1);
    return data[0];
  }

  /**
   * Set player lives
   * @param {number} count - Number of lives (0-99)
   */
  async setLives(count) {
    const value = Math.max(0, Math.min(99, count));
    await this.snes.PutAddress([[this.RAM.StatusLives, Buffer.from([value])]]);
    // Also set persistent value
    await this.snes.PutAddress([[this.RAM.PlayerLives, Buffer.from([value])]]);
  }

  /**
   * Add lives
   * @param {number} count - Number of lives to add
   */
  async addLives(count) {
    const current = await this.getLives();
    await this.setLives(current + count);
  }

  /**
   * Get coin count
   * @returns {Promise<number>}
   */
  async getCoins() {
    const data = await this.snes.GetAddress(this.RAM.StatusCoins, 1);
    return data[0];
  }

  /**
   * Set coin count
   * @param {number} count - Number of coins (0-99)
   */
  async setCoins(count) {
    const value = Math.max(0, Math.min(99, count));
    await this.snes.PutAddress([[this.RAM.StatusCoins, Buffer.from([value])]]);
  }

  /**
   * Add coins
   * @param {number} count - Number of coins to add
   */
  async addCoins(count) {
    const current = await this.getCoins();
    await this.setCoins(current + count);
  }

  /**
   * Get current powerup (in level)
   * @returns {Promise<number>} 0=small, 1=big, 2=cape, 3=fire
   */
  async getPowerup() {
    const data = await this.snes.GetAddress(this.RAM.MarioPowerUp, 1);
    return data[0];
  }

  /**
   * Set powerup (in level)
   * @param {number} powerup - 0=small, 1=big, 2=cape, 3=fire
   */
  async setPowerup(powerup) {
    const value = Math.max(0, Math.min(3, powerup));
    await this.snes.PutAddress([[this.RAM.MarioPowerUp, Buffer.from([value])]]);
    // Also set persistent value
    await this.snes.PutAddress([[this.RAM.PlayerPowerUp, Buffer.from([value])]]);
  }

  /**
   * Get powerup name
   * @param {number} powerup - Powerup value
   * @returns {string}
   */
  getPowerupName(powerup) {
    const names = ['Small', 'Big', 'Cape', 'Fire'];
    return names[powerup] || 'Unknown';
  }

  // ========================================
  // Position and Movement
  // ========================================

  /**
   * Get Mario's position
   * @returns {Promise<{x: number, y: number}>}
   */
  async getPosition() {
    const data = await this.snes.GetAddresses([
      [this.RAM.MarioXPos, 1],
      [this.RAM.MarioXPosHi, 1],
      [this.RAM.MarioYPos, 1],
      [this.RAM.MarioYPosHi, 1]
    ]);
    
    const x = data[0][0] | (data[1][0] << 8);
    const y = data[2][0] | (data[3][0] << 8);
    
    return { x, y };
  }

  /**
   * Set Mario's position
   * @param {number} x - X position
   * @param {number} y - Y position
   */
  async setPosition(x, y) {
    const xLo = x & 0xFF;
    const xHi = (x >> 8) & 0xFF;
    const yLo = y & 0xFF;
    const yHi = (y >> 8) & 0xFF;
    
    await this.snes.PutAddress([
      [this.RAM.MarioXPos, Buffer.from([xLo])],
      [this.RAM.MarioXPosHi, Buffer.from([xHi])],
      [this.RAM.MarioYPos, Buffer.from([yLo])],
      [this.RAM.MarioYPosHi, Buffer.from([yHi])]
    ]);
  }

  /**
   * Get Mario's speed
   * @returns {Promise<{x: number, y: number}>}
   */
  async getSpeed() {
    const data = await this.snes.GetAddresses([
      [this.RAM.MarioSpeedX, 1],
      [this.RAM.MarioSpeedY, 1]
    ]);
    
    // These are signed bytes
    let x = data[0][0];
    let y = data[1][0];
    
    // Convert to signed
    if (x > 127) x -= 256;
    if (y > 127) y -= 256;
    
    return { x, y };
  }

  /**
   * Set Mario's speed
   * @param {number} x - X speed (signed)
   * @param {number} y - Y speed (signed)
   */
  async setSpeed(x, y) {
    // Convert signed to unsigned byte
    const xByte = x < 0 ? 256 + x : x;
    const yByte = y < 0 ? 256 + y : y;
    
    await this.snes.PutAddress([
      [this.RAM.MarioSpeedX, Buffer.from([xByte])],
      [this.RAM.MarioSpeedY, Buffer.from([yByte])]
    ]);
  }

  /**
   * Get Mario's direction
   * @returns {Promise<number>} 0=right, 1=left
   */
  async getDirection() {
    const data = await this.snes.GetAddress(this.RAM.MarioDirection, 1);
    return data[0];
  }

  /**
   * Set Mario's direction
   * @param {number} direction - 0=right, 1=left
   */
  async setDirection(direction) {
    const value = direction ? 1 : 0;
    await this.snes.PutAddress([[this.RAM.MarioDirection, Buffer.from([value])]]);
  }

  // ========================================
  // Mario State Flags
  // ========================================

  /**
   * Check if Mario is flying
   * @returns {Promise<boolean>}
   */
  async isFlying() {
    const data = await this.snes.GetAddress(this.RAM.IsFlying, 1);
    return data[0] !== 0;
  }

  /**
   * Check if Mario is ducking
   * @returns {Promise<boolean>}
   */
  async isDucking() {
    const data = await this.snes.GetAddress(this.RAM.IsDucking, 1);
    return data[0] !== 0;
  }

  /**
   * Check if Mario is climbing
   * @returns {Promise<boolean>}
   */
  async isClimbing() {
    const data = await this.snes.GetAddress(this.RAM.IsClimbing, 1);
    return data[0] !== 0;
  }

  /**
   * Check if Mario is swimming
   * @returns {Promise<boolean>}
   */
  async isSwimming() {
    const data = await this.snes.GetAddress(this.RAM.IsSwimming, 1);
    return data[0] !== 0;
  }

  /**
   * Check if spin jumping
   * @returns {Promise<boolean>}
   */
  async isSpinJumping() {
    const data = await this.snes.GetAddress(this.RAM.IsSpinJump, 1);
    return data[0] !== 0;
  }

  // ========================================
  // Yoshi Functions
  // ========================================

  /**
   * Check if Mario is on Yoshi
   * @returns {Promise<boolean>}
   */
  async hasYoshi() {
    const data = await this.snes.GetAddress(this.RAM.OnYoshi, 1);
    return data[0] !== 0;
  }

  /**
   * Get Yoshi color
   * @returns {Promise<number>} 0=green, 1=red, 2=blue, 3=yellow
   */
  async getYoshiColor() {
    const data = await this.snes.GetAddress(this.RAM.YoshiColor, 1);
    return data[0];
  }

  /**
   * Give Mario a Yoshi
   * @param {number} color - 0=green, 1=red, 2=blue, 3=yellow
   */
  async giveYoshi(color = 0) {
    const yoshiColor = Math.max(0, Math.min(3, color));
    await this.snes.PutAddress([
      [this.RAM.OnYoshi, Buffer.from([1])],
      [this.RAM.YoshiColor, Buffer.from([yoshiColor])],
      [this.RAM.OWHasYoshi, Buffer.from([1])]
    ]);
  }

  /**
   * Remove Yoshi
   */
  async removeYoshi() {
    await this.snes.PutAddress([
      [this.RAM.OnYoshi, Buffer.from([0])],
      [this.RAM.OWHasYoshi, Buffer.from([0])]
    ]);
  }

  /**
   * Check if Yoshi has wings
   * @returns {Promise<boolean>}
   */
  async yoshiHasWings() {
    const data = await this.snes.GetAddress(this.RAM.YoshiHasWings, 1);
    return data[0] !== 0;
  }

  /**
   * Give Yoshi wings
   * @param {boolean} hasWings
   */
  async setYoshiWings(hasWings) {
    const value = hasWings ? 1 : 0;
    await this.snes.PutAddress([[this.RAM.YoshiHasWings, Buffer.from([value])]]);
  }

  // ========================================
  // Sprite Control
  // ========================================

  /**
   * Check if sprites are locked (frozen)
   * @returns {Promise<boolean>}
   */
  async areSpritesLocked() {
    const data = await this.snes.GetAddress(this.RAM.SpritesLocked, 1);
    return data[0] !== 0;
  }

  /**
   * Lock/unlock sprites (freeze/unfreeze)
   * @param {boolean} locked
   */
  async setSpritesLocked(locked) {
    const value = locked ? 1 : 0;
    await this.snes.PutAddress([[this.RAM.SpritesLocked, Buffer.from([value])]]);
  }

  /**
   * Get sprite state for a specific slot
   * @param {number} slot - Sprite slot (0-11)
   * @returns {Promise<number>} Sprite state
   */
  async getSpriteState(slot) {
    if (slot < 0 || slot > 11) throw new Error('Invalid sprite slot (must be 0-11)');
    const data = await this.snes.GetAddress(this.RAM.SpriteState + slot, 1);
    return data[0];
  }

  /**
   * Set sprite state for a specific slot
   * @param {number} slot - Sprite slot (0-11)
   * @param {number} state - Sprite state
   */
  async setSpriteState(slot, state) {
    if (slot < 0 || slot > 11) throw new Error('Invalid sprite slot (must be 0-11)');
    await this.snes.PutAddress([[this.RAM.SpriteState + slot, Buffer.from([state])]]);
  }

  /**
   * Kill all sprites
   */
  async killAllSprites() {
    // Set all sprite states to 0 (dead/inactive)
    const kills = [];
    for (let i = 0; i < 12; i++) {
      kills.push([this.RAM.SpriteState + i, Buffer.from([0])]);
    }
    await this.snes.PutAddress(kills);
  }

  // ========================================
  // Special Items and Timers
  // ========================================

  /**
   * Get ON/OFF switch status
   * @returns {Promise<boolean>} true if yellow outline, false if yellow blocks
   */
  async getOnOffStatus() {
    const data = await this.snes.GetAddress(this.RAM.OnOffStatus, 1);
    return data[0] !== 0;
  }

  /**
   * Toggle ON/OFF switch
   */
  async toggleOnOff() {
    const current = await this.getOnOffStatus();
    await this.snes.PutAddress([[this.RAM.OnOffStatus, Buffer.from([current ? 0 : 1])]]);
  }

  /**
   * Get P-switch timer
   * @returns {Promise<number>} Frames remaining
   */
  async getBluePowTimer() {
    const data = await this.snes.GetAddress(this.RAM.BluePowTimer, 1);
    return data[0];
  }

  /**
   * Activate P-switch
   * @param {number} duration - Duration in frames (default 588 = 9.8 seconds)
   */
  async activatePSwitch(duration = 588) {
    await this.snes.PutAddress([[this.RAM.BluePowTimer, Buffer.from([duration & 0xFF])]]);
  }

  /**
   * Get silver P-switch timer
   * @returns {Promise<number>} Frames remaining
   */
  async getSilverPowTimer() {
    const data = await this.snes.GetAddress(this.RAM.SilverPowTimer, 1);
    return data[0];
  }

  /**
   * Activate silver P-switch
   * @param {number} duration - Duration in frames
   */
  async activateSilverPSwitch(duration = 588) {
    await this.snes.PutAddress([[this.RAM.SilverPowTimer, Buffer.from([duration & 0xFF])]]);
  }

  // ========================================
  // Frame Counter and Random
  // ========================================

  /**
   * Get frame counter
   * @returns {Promise<number>}
   */
  async getFrameCounter() {
    const data = await this.snes.GetAddress(this.RAM.FrameCounter, 1);
    return data[0];
  }

  /**
   * Get random bytes
   * @returns {Promise<{byte1: number, byte2: number}>}
   */
  async getRandomBytes() {
    const data = await this.snes.GetAddresses([
      [this.RAM.RandomByte1, 1],
      [this.RAM.RandomByte2, 1]
    ]);
    return { byte1: data[0][0], byte2: data[1][0] };
  }

  // ========================================
  // Controller Input
  // ========================================

  /**
   * Get controller input (raw)
   * @returns {Promise<number>} 16-bit button state
   */
  async getController() {
    const data = await this.snes.GetAddress(this.RAM.ControllerA, 2);
    return data[0] | (data[1] << 8);
  }

  /**
   * Parse controller buttons
   * @param {number} controller - Raw controller value
   * @returns {Object} Button states
   */
  parseController(controller) {
    return {
      B: !!(controller & 0x8000),
      Y: !!(controller & 0x4000),
      SELECT: !!(controller & 0x2000),
      START: !!(controller & 0x1000),
      UP: !!(controller & 0x0800),
      DOWN: !!(controller & 0x0400),
      LEFT: !!(controller & 0x0200),
      RIGHT: !!(controller & 0x0100),
      A: !!(controller & 0x0080),
      X: !!(controller & 0x0040),
      L: !!(controller & 0x0020),
      R: !!(controller & 0x0010)
    };
  }

  // ========================================
  // Utility Functions
  // ========================================

  /**
   * Get comprehensive game state (one batch read)
   * @returns {Promise<Object>} All major game state values
   */
  async getGameState() {
    const data = await this.snes.GetAddresses([
      [this.RAM.GameMode, 1],
      [this.RAM.StatusLives, 1],
      [this.RAM.StatusCoins, 1],
      [this.RAM.MarioPowerUp, 1],
      [this.RAM.MarioXPos, 1],
      [this.RAM.MarioXPosHi, 1],
      [this.RAM.MarioYPos, 1],
      [this.RAM.MarioYPosHi, 1],
      [this.RAM.OnYoshi, 1],
      [this.RAM.YoshiColor, 1],
      [this.RAM.SpritesLocked, 1]
    ]);
    
    return {
      gameMode: data[0][0],
      lives: data[1][0],
      coins: data[2][0],
      powerup: data[3][0],
      position: {
        x: data[4][0] | (data[5][0] << 8),
        y: data[6][0] | (data[7][0] << 8)
      },
      hasYoshi: data[8][0] !== 0,
      yoshiColor: data[9][0],
      spritesLocked: data[10][0] !== 0
    };
  }

  /**
   * Create a game state watcher
   * @param {Function} onChange - Callback when state changes
   * @param {number} pollRate - Poll rate in milliseconds
   * @returns {Object} Watcher object
   */
  createStateWatcher(onChange, pollRate = 100) {
    return this.snes.createMemoryWatcher(
      [
        [this.RAM.GameMode, 1],
        [this.RAM.StatusLives, 1],
        [this.RAM.StatusCoins, 1],
        [this.RAM.MarioPowerUp, 1],
        [this.RAM.OnYoshi, 1]
      ],
      pollRate,
      onChange
    );
  }
}

module.exports = SMWHelpers;

