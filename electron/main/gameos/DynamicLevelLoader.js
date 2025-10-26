/**
 * Dynamic Level Loader
 * 
 * Load level data dynamically from SD card files
 * Allows games with unlimited levels stored as separate files
 * 
 * Features:
 * - Load level data from SD card
 * - Cache levels in memory
 * - Install levels to SNES RAM
 * - Support for multiple level formats
 */

class DynamicLevelLoader {
  /**
   * @param {SNESWrapper} snesWrapper - Active SNES connection
   */
  constructor(snesWrapper) {
    this.snes = snesWrapper;
    this.levelDirectory = '/work/levels/';
    this.levelCache = new Map();
    this.cacheSize = 0;
    this.maxCacheSize = 1024 * 1024;  // 1MB cache limit
  }

  /**
   * Set level directory path
   * 
   * @param {string} path - Directory path on SD card
   */
  setLevelDirectory(path) {
    this.levelDirectory = path;
    if (!this.levelDirectory.endsWith('/')) {
      this.levelDirectory += '/';
    }
  }

  /**
   * Load level data from SD card
   * 
   * @param {number|string} levelId - Level identifier
   * @returns {Promise<Buffer>} Level data
   */
  async loadLevel(levelId) {
    const levelKey = String(levelId);
    
    // Check cache first
    if (this.levelCache.has(levelKey)) {
      console.log(`Level ${levelId} found in cache`);
      return this.levelCache.get(levelKey);
    }
    
    // Build file path
    const filename = this._getLevelFilename(levelId);
    const path = `${this.levelDirectory}${filename}`;
    
    console.log(`Loading level ${levelId} from ${path}...`);
    
    // Load from SD card
    const levelData = await this.snes.GetFile(path);
    console.log(`  ✓ Loaded ${levelData.length} bytes`);
    
    // Add to cache
    this._addToCache(levelKey, levelData);
    
    return levelData;
  }

  /**
   * Install level data to SNES RAM
   * 
   * @param {number|string} levelId - Level identifier
   * @param {number} ramAddress - Target RAM address
   * @returns {Promise<number>} Bytes written
   */
  async installLevel(levelId, ramAddress) {
    console.log(`Installing level ${levelId} to RAM...`);
    
    // Load level data
    const levelData = await this.loadLevel(levelId);
    
    // Upload to SNES RAM
    console.log(`  Writing to 0x${ramAddress.toString(16).toUpperCase()}...`);
    await this.snes.PutAddress([[ramAddress, levelData]]);
    
    console.log(`  ✓ Installed ${levelData.length} bytes`);
    
    return levelData.length;
  }

  /**
   * Pre-load multiple levels into cache
   * 
   * @param {Array<number|string>} levelIds - Level identifiers to preload
   */
  async preloadLevels(levelIds) {
    console.log(`Preloading ${levelIds.length} levels...`);
    
    for (const levelId of levelIds) {
      try {
        await this.loadLevel(levelId);
      } catch (error) {
        console.log(`  ✗ Failed to load level ${levelId}: ${error.message}`);
      }
    }
    
    console.log(`✓ Preload complete (${this.levelCache.size} levels cached)`);
  }

  /**
   * List available levels in directory
   * 
   * @returns {Promise<Array>} Array of level info
   */
  async listLevels() {
    try {
      const files = await this.snes.List(this.levelDirectory);
      const levels = files
        .filter(f => this._isLevelFile(f))
        .map(f => this._parseLevelFilename(f))
        .filter(l => l !== null);
      
      console.log(`Found ${levels.length} level(s) in ${this.levelDirectory}`);
      
      return levels;
    } catch (error) {
      console.log(`Level directory not found: ${this.levelDirectory}`);
      return [];
    }
  }

  /**
   * Clear level cache
   */
  clearCache() {
    this.levelCache.clear();
    this.cacheSize = 0;
    console.log('Level cache cleared');
  }

  /**
   * Get cache statistics
   * 
   * @returns {Object} Cache stats
   */
  getCacheStats() {
    return {
      cachedLevels: this.levelCache.size,
      cacheSize: this.cacheSize,
      maxCacheSize: this.maxCacheSize,
      cacheUsage: ((this.cacheSize / this.maxCacheSize) * 100).toFixed(1) + '%'
    };
  }

  /**
   * Remove level from cache
   * 
   * @param {number|string} levelId - Level identifier
   */
  uncacheLevel(levelId) {
    const levelKey = String(levelId);
    if (this.levelCache.has(levelKey)) {
      const levelData = this.levelCache.get(levelKey);
      this.cacheSize -= levelData.length;
      this.levelCache.delete(levelKey);
      console.log(`Level ${levelId} removed from cache`);
    }
  }

  /**
   * Get level filename from ID
   * 
   * @private
   * @param {number|string} levelId - Level identifier
   * @returns {string} Filename
   */
  _getLevelFilename(levelId) {
    if (typeof levelId === 'number') {
      // Numeric: level001.dat, level002.dat, etc.
      return `level${String(levelId).padStart(3, '0')}.dat`;
    } else {
      // String: use as-is
      return levelId;
    }
  }

  /**
   * Check if file is a level file
   * 
   * @private
   * @param {string} filename - Filename to check
   * @returns {boolean} True if level file
   */
  _isLevelFile(filename) {
    return filename.endsWith('.dat') || 
           filename.endsWith('.lvl') ||
           filename.endsWith('.level');
  }

  /**
   * Parse level ID from filename
   * 
   * @private
   * @param {string} filename - Filename to parse
   * @returns {Object|null} Level info or null
   */
  _parseLevelFilename(filename) {
    // Try to extract level number: level001.dat → 1
    const match = filename.match(/level(\d+)\./i);
    if (match) {
      return {
        id: parseInt(match[1]),
        filename: filename
      };
    }
    
    // Otherwise use filename as ID
    return {
      id: filename.replace(/\.(dat|lvl|level)$/, ''),
      filename: filename
    };
  }

  /**
   * Add level to cache
   * 
   * @private
   * @param {string} levelKey - Cache key
   * @param {Buffer} levelData - Level data
   */
  _addToCache(levelKey, levelData) {
    // Check if we need to make room
    while (this.cacheSize + levelData.length > this.maxCacheSize && this.levelCache.size > 0) {
      // Remove oldest entry (first in Map)
      const firstKey = this.levelCache.keys().next().value;
      const firstData = this.levelCache.get(firstKey);
      this.cacheSize -= firstData.length;
      this.levelCache.delete(firstKey);
      console.log(`  Cache full, evicted level ${firstKey}`);
    }
    
    // Add to cache
    if (levelData.length <= this.maxCacheSize) {
      this.levelCache.set(levelKey, levelData);
      this.cacheSize += levelData.length;
    }
  }
}

module.exports = DynamicLevelLoader;

