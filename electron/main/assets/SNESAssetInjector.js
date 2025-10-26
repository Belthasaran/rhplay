/**
 * SNES Asset Injection System
 * 
 * Dynamic injection of graphics, palettes, and other assets
 * into SNES memory (VRAM, CGRAM, etc.)
 * 
 * Features:
 * - Graphics/tileset injection to VRAM
 * - Palette injection to CGRAM
 * - Sprite graphics updates
 * - Background tileset updates
 */

// SNES PPU Memory Addresses
const PPU_ADDRESSES = {
  // VRAM (Video RAM) - Tile graphics
  VRAM_START: 0x0000,
  VRAM_SIZE: 0x10000,  // 64KB
  
  // CGRAM (Color Generator RAM) - Palettes
  CGRAM_START: 0x0000,
  CGRAM_SIZE: 0x200,   // 512 bytes (256 colors × 2 bytes)
  
  // OAM (Object Attribute Memory) - Sprite data
  OAM_START: 0x0000,
  OAM_SIZE: 0x220,     // 544 bytes
};

// SMW-Specific VRAM Addresses
const SMW_VRAM = {
  // Graphics regions
  SP1_TILES: 0x0000,   // SP1 tileset (4bpp)
  SP2_TILES: 0x1000,   // SP2 tileset (4bpp)
  SP3_TILES: 0x2000,   // SP3 tileset (2bpp)
  SP4_TILES: 0x3000,   // SP4 tileset (2bpp)
  FG_TILES: 0x4000,    // Foreground tiles (2bpp)
  BG_TILES: 0x5000,    // Background tiles (2bpp)
  
  // Layer 3 (Mode 7)
  MODE7_TILES: 0x0000  // Mode 7 uses different addressing
};

// SMW Palette RAM Addresses
const SMW_PALETTE_RAM = {
  BG_PALETTES: 0x7E0703,   // Background palettes (8 palettes × 16 colors)
  SPR_PALETTES: 0x7E0743,  // Sprite palettes (8 palettes × 16 colors)
  // Note: Palettes are in RAM, will be uploaded to CGRAM by game
};

class SNESAssetInjector {
  /**
   * @param {SNESWrapper} snesWrapper - Active SNES connection
   */
  constructor(snesWrapper) {
    this.snes = snesWrapper;
    this.PPU = PPU_ADDRESSES;
    this.SMW_VRAM = SMW_VRAM;
    this.SMW_PAL_RAM = SMW_PALETTE_RAM;
  }

  // ========================================
  // Graphics Injection (VRAM)
  // ========================================

  /**
   * Upload graphics data to VRAM
   * Note: VRAM cannot be accessed while display is on (mostly)
   * Best to inject during VBlank or when display is forced off
   * 
   * @param {Buffer} graphicsData - Graphics data (raw tile data)
   * @param {number} vramAddress - Target VRAM address
   * @param {string} format - Format: '2bpp', '4bpp', '8bpp'
   * @returns {Promise<number>} Bytes written
   */
  async injectGraphics(graphicsData, vramAddress, format = '4bpp') {
    console.log(`[AssetInjector] Injecting ${graphicsData.length} bytes to VRAM 0x${vramAddress.toString(16).toUpperCase()} (${format})`);
    
    // Validate VRAM address
    if (vramAddress < 0 || vramAddress >= this.PPU.VRAM_SIZE) {
      throw new Error(`Invalid VRAM address: 0x${vramAddress.toString(16)}`);
    }
    
    // Note: Direct VRAM writes via USB2SNES may not work on all hardware
    // Alternative: Write to RAM, let game copy to VRAM
    // For now, document the approach
    
    console.log('[AssetInjector] Graphics injection via RAM staging:');
    console.log('  1. Upload graphics to free RAM');
    console.log('  2. Trigger DMA transfer to VRAM via game code');
    console.log('  (Direct VRAM write not supported on all hardware)');
    
    // Upload to staging RAM
    const stagingAddr = 0x7F9000;
    await this.snes.PutAddress([[stagingAddr, graphicsData]]);
    
    console.log(`✓ Graphics staged at RAM 0x${stagingAddr.toString(16).toUpperCase()}`);
    console.log(`  (Game must DMA transfer to VRAM 0x${vramAddress.toString(16).toUpperCase()})`);
    
    return graphicsData.length;
  }

  /**
   * Inject tileset for SMW
   * 
   * @param {Buffer} tilesetData - Tileset data (4bpp or 2bpp format)
   * @param {string} slot - Slot: 'sp1', 'sp2', 'sp3', 'sp4', 'fg', 'bg'
   * @returns {Promise<number>} Bytes written
   */
  async injectSMWTileset(tilesetData, slot) {
    const slotMap = {
      'sp1': { addr: this.SMW_VRAM.SP1_TILES, format: '4bpp' },
      'sp2': { addr: this.SMW_VRAM.SP2_TILES, format: '4bpp' },
      'sp3': { addr: this.SMW_VRAM.SP3_TILES, format: '2bpp' },
      'sp4': { addr: this.SMW_VRAM.SP4_TILES, format: '2bpp' },
      'fg': { addr: this.SMW_VRAM.FG_TILES, format: '2bpp' },
      'bg': { addr: this.SMW_VRAM.BG_TILES, format: '2bpp' }
    };
    
    if (!slotMap[slot]) {
      throw new Error(`Invalid slot: ${slot}`);
    }
    
    const { addr, format } = slotMap[slot];
    console.log(`[AssetInjector] Injecting SMW ${slot.toUpperCase()} tileset (${format})`);
    
    return await this.injectGraphics(tilesetData, addr, format);
  }

  // ========================================
  // Palette Injection
  // ========================================

  /**
   * Convert RGB888 color to SNES BGR555 format
   * 
   * @param {number} r - Red (0-255)
   * @param {number} g - Green (0-255)
   * @param {number} b - Blue (0-255)
   * @returns {number} SNES color (16-bit BGR555)
   */
  rgbToSNES(r, g, b) {
    // SNES uses BGR555: %0bbbbbgg gggrrrrr
    const r5 = Math.floor(r / 8);  // 8-bit to 5-bit
    const g5 = Math.floor(g / 8);
    const b5 = Math.floor(b / 8);
    
    return (b5 << 10) | (g5 << 5) | r5;
  }

  /**
   * Convert SNES BGR555 to RGB888
   * 
   * @param {number} snesColor - SNES color (16-bit)
   * @returns {Object} {r, g, b} (0-255 each)
   */
  snesToRGB(snesColor) {
    const r5 = snesColor & 0x1F;
    const g5 = (snesColor >> 5) & 0x1F;
    const b5 = (snesColor >> 10) & 0x1F;
    
    return {
      r: r5 * 8,  // 5-bit to 8-bit
      g: g5 * 8,
      b: b5 * 8
    };
  }

  /**
   * Create palette from RGB colors
   * 
   * @param {Array<{r, g, b}>} colors - Array of RGB colors (max 16)
   * @returns {Buffer} Palette data (32 bytes for 16 colors)
   */
  createPalette(colors) {
    if (colors.length > 16) {
      throw new Error('Palette can have max 16 colors');
    }
    
    const buffer = Buffer.alloc(32);  // 16 colors × 2 bytes
    
    for (let i = 0; i < colors.length; i++) {
      const { r, g, b } = colors[i];
      const snesColor = this.rgbToSNES(r, g, b);
      
      // Write as little-endian 16-bit
      buffer[i * 2] = snesColor & 0xFF;
      buffer[i * 2 + 1] = (snesColor >> 8) & 0xFF;
    }
    
    return buffer;
  }

  /**
   * Inject palette to SMW palette RAM
   * 
   * @param {Buffer} paletteData - Palette data (32 bytes = 16 colors)
   * @param {number} paletteNum - Palette number (0-7 for BG, 8-15 for sprites)
   * @returns {Promise<void>}
   */
  async injectSMWPalette(paletteData, paletteNum) {
    if (paletteData.length !== 32) {
      throw new Error(`Invalid palette size: ${paletteData.length} bytes (expected 32)`);
    }
    
    if (paletteNum < 0 || paletteNum > 15) {
      throw new Error(`Invalid palette number: ${paletteNum} (must be 0-15)`);
    }
    
    // Calculate address
    let baseAddr;
    if (paletteNum < 8) {
      // Background palette (0-7)
      baseAddr = this.SMW_PAL_RAM.BG_PALETTES + (paletteNum * 32);
      console.log(`[AssetInjector] Injecting background palette ${paletteNum}`);
    } else {
      // Sprite palette (8-15)
      baseAddr = this.SMW_PAL_RAM.SPR_PALETTES + ((paletteNum - 8) * 32);
      console.log(`[AssetInjector] Injecting sprite palette ${paletteNum - 8}`);
    }
    
    // Write to RAM (game will upload to CGRAM)
    await this.snes.PutAddress([[baseAddr, paletteData]]);
    
    console.log('✓ Palette injected to RAM');
    console.log('  (Game will upload to CGRAM during next frame)');
  }

  /**
   * Read current palette from SMW RAM
   * 
   * @param {number} paletteNum - Palette number (0-7 for BG, 8-15 for sprites)
   * @returns {Promise<Buffer>} Palette data (32 bytes)
   */
  async readSMWPalette(paletteNum) {
    if (paletteNum < 0 || paletteNum > 15) {
      throw new Error(`Invalid palette number: ${paletteNum}`);
    }
    
    let baseAddr;
    if (paletteNum < 8) {
      baseAddr = this.SMW_PAL_RAM.BG_PALETTES + (paletteNum * 32);
    } else {
      baseAddr = this.SMW_PAL_RAM.SPR_PALETTES + ((paletteNum - 8) * 32);
    }
    
    return await this.snes.GetAddress(baseAddr, 32);
  }

  /**
   * Parse palette data to RGB colors
   * 
   * @param {Buffer} paletteData - Palette data (32 bytes)
   * @returns {Array<{r, g, b}>} Array of 16 RGB colors
   */
  parsePalette(paletteData) {
    const colors = [];
    
    for (let i = 0; i < 16; i++) {
      const snesColor = paletteData[i * 2] | (paletteData[i * 2 + 1] << 8);
      colors.push(this.snesToRGB(snesColor));
    }
    
    return colors;
  }

  /**
   * Modify specific colors in a palette
   * 
   * @param {number} paletteNum - Palette number (0-15)
   * @param {Object} colorMap - Map of color index to RGB: {0: {r, g, b}, 5: {r, g, b}}
   */
  async modifyPaletteColors(paletteNum, colorMap) {
    console.log(`[AssetInjector] Modifying palette ${paletteNum}...`);
    
    // Read current palette
    const currentPalette = await this.readSMWPalette(paletteNum);
    const newPalette = Buffer.from(currentPalette);
    
    // Modify specified colors
    for (const [colorIndex, rgb] of Object.entries(colorMap)) {
      const idx = parseInt(colorIndex);
      if (idx < 0 || idx > 15) continue;
      
      const snesColor = this.rgbToSNES(rgb.r, rgb.g, rgb.b);
      newPalette[idx * 2] = snesColor & 0xFF;
      newPalette[idx * 2 + 1] = (snesColor >> 8) & 0xFF;
      
      console.log(`  Color ${idx}: RGB(${rgb.r}, ${rgb.g}, ${rgb.b}) → SNES(0x${snesColor.toString(16).padStart(4, '0')})`);
    }
    
    // Write modified palette
    await this.injectSMWPalette(newPalette, paletteNum);
    
    console.log('✓ Palette colors modified');
  }

  // ========================================
  // Asset File Loading
  // ========================================

  /**
   * Load graphics file from SD card and inject
   * 
   * @param {string} graphicsPath - Path to graphics file on SD card
   * @param {number} vramAddress - Target VRAM address
   * @param {string} format - Format: '2bpp', '4bpp', '8bpp'
   * @returns {Promise<number>} Bytes injected
   */
  async loadAndInjectGraphics(graphicsPath, vramAddress, format = '4bpp') {
    console.log(`[AssetInjector] Loading graphics from ${graphicsPath}...`);
    
    const graphicsData = await this.snes.GetFile(graphicsPath);
    console.log(`  ✓ Loaded ${graphicsData.length} bytes`);
    
    return await this.injectGraphics(graphicsData, vramAddress, format);
  }

  /**
   * Load palette file from SD card and inject
   * 
   * @param {string} palettePath - Path to palette file on SD card
   * @param {number} paletteNum - Target palette number (0-15)
   * @returns {Promise<void>}
   */
  async loadAndInjectPalette(palettePath, paletteNum) {
    console.log(`[AssetInjector] Loading palette from ${palettePath}...`);
    
    const paletteData = await this.snes.GetFile(palettePath);
    
    if (paletteData.length !== 32) {
      throw new Error(`Invalid palette file size: ${paletteData.length} bytes (expected 32)`);
    }
    
    console.log('  ✓ Loaded 16-color palette');
    
    return await this.injectSMWPalette(paletteData, paletteNum);
  }

  // ========================================
  // Tileset Utilities
  // ========================================

  /**
   * Calculate tile size based on format
   * 
   * @param {string} format - Format: '2bpp', '4bpp', '8bpp'
   * @returns {number} Bytes per tile
   */
  getTileSize(format) {
    switch (format) {
      case '2bpp': return 16;   // 8×8 pixels, 2 bits per pixel
      case '4bpp': return 32;   // 8×8 pixels, 4 bits per pixel
      case '8bpp': return 64;   // 8×8 pixels, 8 bits per pixel
      default: throw new Error(`Unknown format: ${format}`);
    }
  }

  /**
   * Calculate number of tiles in graphics data
   * 
   * @param {Buffer} graphicsData - Graphics data
   * @param {string} format - Format: '2bpp', '4bpp', '8bpp'
   * @returns {number} Number of tiles
   */
  getTileCount(graphicsData, format) {
    const tileSize = this.getTileSize(format);
    return Math.floor(graphicsData.length / tileSize);
  }

  /**
   * Extract a single tile from graphics data
   * 
   * @param {Buffer} graphicsData - Graphics data
   * @param {number} tileIndex - Tile index
   * @param {string} format - Format: '2bpp', '4bpp', '8bpp'
   * @returns {Buffer} Tile data
   */
  extractTile(graphicsData, tileIndex, format) {
    const tileSize = this.getTileSize(format);
    const offset = tileIndex * tileSize;
    
    if (offset + tileSize > graphicsData.length) {
      throw new Error(`Tile ${tileIndex} out of range`);
    }
    
    return graphicsData.slice(offset, offset + tileSize);
  }

  // ========================================
  // Palette Utilities
  // ========================================

  /**
   * Create grayscale palette
   * 
   * @param {number} numColors - Number of colors (1-16)
   * @returns {Buffer} Palette data
   */
  createGrayscalePalette(numColors = 16) {
    const colors = [];
    
    for (let i = 0; i < numColors; i++) {
      const value = Math.floor((i / (numColors - 1)) * 255);
      colors.push({ r: value, g: value, b: value });
    }
    
    return this.createPalette(colors);
  }

  /**
   * Create rainbow palette
   * 
   * @returns {Buffer} Palette data (16 colors)
   */
  createRainbowPalette() {
    const colors = [
      { r: 0, g: 0, b: 0 },       // Black (transparent)
      { r: 255, g: 0, b: 0 },     // Red
      { r: 255, g: 127, b: 0 },   // Orange
      { r: 255, g: 255, b: 0 },   // Yellow
      { r: 127, g: 255, b: 0 },   // Lime
      { r: 0, g: 255, b: 0 },     // Green
      { r: 0, g: 255, b: 127 },   // Teal
      { r: 0, g: 255, b: 255 },   // Cyan
      { r: 0, g: 127, b: 255 },   // Sky blue
      { r: 0, g: 0, b: 255 },     // Blue
      { r: 127, g: 0, b: 255 },   // Purple
      { r: 255, g: 0, b: 255 },   // Magenta
      { r: 255, g: 0, b: 127 },   // Pink
      { r: 255, g: 255, b: 255 }, // White
      { r: 127, g: 127, b: 127 }, // Gray
      { r: 64, g: 64, b: 64 }     // Dark gray
    ];
    
    return this.createPalette(colors);
  }

  /**
   * Shift palette hue
   * 
   * @param {Buffer} paletteData - Original palette (32 bytes)
   * @param {number} hueShift - Hue shift in degrees (0-360)
   * @returns {Buffer} Modified palette
   */
  shiftPaletteHue(paletteData, hueShift) {
    const colors = this.parsePalette(paletteData);
    const shiftedColors = [];
    
    for (const color of colors) {
      const shifted = this._shiftHue(color.r, color.g, color.b, hueShift);
      shiftedColors.push(shifted);
    }
    
    return this.createPalette(shiftedColors);
  }

  /**
   * Adjust palette brightness
   * 
   * @param {Buffer} paletteData - Original palette (32 bytes)
   * @param {number} factor - Brightness factor (0.0-2.0, 1.0 = no change)
   * @returns {Buffer} Modified palette
   */
  adjustPaletteBrightness(paletteData, factor) {
    const colors = this.parsePalette(paletteData);
    const adjustedColors = [];
    
    for (const color of colors) {
      adjustedColors.push({
        r: Math.min(255, Math.floor(color.r * factor)),
        g: Math.min(255, Math.floor(color.g * factor)),
        b: Math.min(255, Math.floor(color.b * factor))
      });
    }
    
    return this.createPalette(adjustedColors);
  }

  // ========================================
  // Helper Methods
  // ========================================

  /**
   * Shift RGB color hue
   * @private
   */
  _shiftHue(r, g, b, degrees) {
    // Convert RGB to HSL
    const rNorm = r / 255;
    const gNorm = g / 255;
    const bNorm = b / 255;
    
    const max = Math.max(rNorm, gNorm, bNorm);
    const min = Math.min(rNorm, gNorm, bNorm);
    const delta = max - min;
    
    let h = 0;
    const l = (max + min) / 2;
    const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));
    
    if (delta !== 0) {
      if (max === rNorm) {
        h = ((gNorm - bNorm) / delta) % 6;
      } else if (max === gNorm) {
        h = (bNorm - rNorm) / delta + 2;
      } else {
        h = (rNorm - gNorm) / delta + 4;
      }
      h *= 60;
    }
    
    // Shift hue
    h = (h + degrees) % 360;
    if (h < 0) h += 360;
    
    // Convert back to RGB
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs((h / 60) % 2 - 1));
    const m = l - c / 2;
    
    let rNew, gNew, bNew;
    
    if (h < 60) {
      [rNew, gNew, bNew] = [c, x, 0];
    } else if (h < 120) {
      [rNew, gNew, bNew] = [x, c, 0];
    } else if (h < 180) {
      [rNew, gNew, bNew] = [0, c, x];
    } else if (h < 240) {
      [rNew, gNew, bNew] = [0, x, c];
    } else if (h < 300) {
      [rNew, gNew, bNew] = [x, 0, c];
    } else {
      [rNew, gNew, bNew] = [c, 0, x];
    }
    
    return {
      r: Math.round((rNew + m) * 255),
      g: Math.round((gNew + m) * 255),
      b: Math.round((bNew + m) * 255)
    };
  }
}

module.exports = SNESAssetInjector;

