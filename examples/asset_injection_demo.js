/**
 * Asset Injection Demonstration
 * 
 * Shows how to inject graphics and palettes dynamically
 * 
 * Prerequisites:
 * - QUsb2snes or USB2SNES server running
 * - SMW ROM loaded on console
 * - In a level (to see palette changes)
 */

const { SNESWrapper } = require('../electron/main/usb2snes/SNESWrapper');
const SNESAssetInjector = require('../electron/main/assets/SNESAssetInjector');

async function demonstrateAssetInjection() {
  console.log('=== Asset Injection Demonstration ===\n');
  
  // Connect
  console.log('Connecting to USB2SNES...');
  const snes = new SNESWrapper();
  
  try {
    await snes.fullConnect('usb2snes_a', 'ws://localhost:64213');
    console.log('✓ Connected!\n');
  } catch (error) {
    console.error('✗ Connection failed:', error.message);
    process.exit(1);
  }
  
  // Create asset injector
  const assets = new SNESAssetInjector(snes);
  
  // ========================================
  // Demo 1: Color Conversion
  // ========================================
  console.log('--- Demo 1: Color Conversion ---\n');
  
  const testColors = [
    { r: 255, g: 0, b: 0, name: 'Red' },
    { r: 0, g: 255, b: 0, name: 'Green' },
    { r: 0, g: 0, b: 255, name: 'Blue' },
    { r: 255, g: 255, b: 0, name: 'Yellow' },
    { r: 255, g: 255, b: 255, name: 'White' }
  ];
  
  console.log('RGB → SNES BGR555 conversion:');
  for (const color of testColors) {
    const snesColor = assets.rgbToSNES(color.r, color.g, color.b);
    console.log(`  ${color.name} RGB(${color.r}, ${color.g}, ${color.b}) → SNES(0x${snesColor.toString(16).padStart(4, '0').toUpperCase()})`);
  }
  
  console.log('\nSNES → RGB conversion:');
  const snesWhite = 0x7FFF;  // Maximum value = white
  const rgbWhite = assets.snesToRGB(snesWhite);
  console.log(`  SNES(0x7FFF) → RGB(${rgbWhite.r}, ${rgbWhite.g}, ${rgbWhite.b})`);
  
  console.log();
  
  // ========================================
  // Demo 2: Read Current Palettes
  // ========================================
  console.log('--- Demo 2: Read Current Palettes ---\n');
  
  console.log('Reading Mario palette (sprite palette 0)...');
  const marioPalette = await assets.readSMWPalette(8);
  const marioColors = assets.parsePalette(marioPalette);
  
  console.log('Mario palette colors:');
  for (let i = 0; i < 16; i++) {
    const c = marioColors[i];
    console.log(`  Color ${i.toString().padStart(2)}: RGB(${c.r.toString().padStart(3)}, ${c.g.toString().padStart(3)}, ${c.b.toString().padStart(3)})`);
  }
  
  console.log();
  
  // ========================================
  // Demo 3: Create Custom Palettes
  // ========================================
  console.log('--- Demo 3: Create Custom Palettes ---\n');
  
  console.log('Creating grayscale palette...');
  const grayPalette = assets.createGrayscalePalette(16);
  console.log(`✓ Created (${grayPalette.length} bytes)`);
  
  console.log('Creating rainbow palette...');
  const rainbowPalette = assets.createRainbowPalette();
  console.log(`✓ Created (${rainbowPalette.length} bytes)`);
  
  const rainbowColors = assets.parsePalette(rainbowPalette);
  console.log('Rainbow colors:');
  rainbowColors.slice(0, 8).forEach((c, i) => {
    console.log(`  Color ${i}: RGB(${c.r}, ${c.g}, ${c.b})`);
  });
  
  console.log();
  
  // ========================================
  // Demo 4: Palette Modification
  // ========================================
  console.log('--- Demo 4: Palette Modification ---');
  console.log('WARNING: This will change game colors!');
  console.log('Press Ctrl+C to cancel, or wait 3 seconds...\n');
  
  await sleep(3000);
  
  // Backup original palette
  console.log('Backing up current Mario palette...');
  const originalMarioPalette = await assets.readSMWPalette(8);
  console.log('✓ Backed up');
  
  // Apply rainbow palette to Mario
  console.log('\nApplying rainbow palette to Mario...');
  await assets.injectSMWPalette(rainbowPalette, 8);
  console.log('✓ Rainbow Mario activated!');
  console.log('  (Look at Mario - he should be rainbow colored!)');
  
  await sleep(3000);
  
  // Apply grayscale
  console.log('\nApplying grayscale palette to Mario...');
  await assets.injectSMWPalette(grayPalette, 8);
  console.log('✓ Grayscale Mario activated!');
  console.log('  (Mario should now be black and white!)');
  
  await sleep(3000);
  
  // Restore original
  console.log('\nRestoring original Mario palette...');
  await assets.injectSMWPalette(originalMarioPalette, 8);
  console.log('✓ Original palette restored!');
  
  console.log();
  
  // ========================================
  // Demo 5: Brightness Adjustment
  // ========================================
  console.log('--- Demo 5: Brightness Adjustment ---\n');
  
  const bgPalette = await assets.readSMWPalette(0);
  
  console.log('Making background darker (50% brightness)...');
  const darkPalette = assets.adjustPaletteBrightness(bgPalette, 0.5);
  await assets.injectSMWPalette(darkPalette, 0);
  console.log('✓ Dark mode activated!');
  
  await sleep(2000);
  
  console.log('Making background brighter (150% brightness)...');
  const brightPalette = assets.adjustPaletteBrightness(bgPalette, 1.5);
  await assets.injectSMWPalette(brightPalette, 0);
  console.log('✓ Bright mode activated!');
  
  await sleep(2000);
  
  console.log('Restoring normal brightness...');
  await assets.injectSMWPalette(bgPalette, 0);
  console.log('✓ Normal brightness restored!');
  
  console.log();
  
  // ========================================
  // Demo 6: Modify Specific Colors
  // ========================================
  console.log('--- Demo 6: Modify Specific Colors ---\n');
  
  console.log('Changing Mario colors (purple/cyan/yellow)...');
  await assets.modifyPaletteColors(8, {
    1: { r: 255, g: 0, b: 255 },    // Purple shirt
    2: { r: 0, g: 255, b: 255 },    // Cyan overalls
    3: { r: 255, g: 255, b: 0 }     // Yellow skin
  });
  console.log('✓ Custom Mario colors applied!');
  
  await sleep(3000);
  
  console.log('Restoring original colors...');
  await assets.injectSMWPalette(originalMarioPalette, 8);
  console.log('✓ Restored!');
  
  console.log();
  
  // ========================================
  // Demo 7: Tileset Utilities
  // ========================================
  console.log('--- Demo 7: Tileset Utilities ---\n');
  
  // Create sample tileset data
  const sampleTileset = Buffer.alloc(512);  // 16 tiles × 32 bytes (4bpp)
  
  console.log('Tileset analysis:');
  console.log(`  Format: 4bpp`);
  console.log(`  Tile size: ${assets.getTileSize('4bpp')} bytes`);
  console.log(`  Tile count: ${assets.getTileCount(sampleTileset, '4bpp')} tiles`);
  
  // Extract first tile
  const firstTile = assets.extractTile(sampleTileset, 0, '4bpp');
  console.log(`  First tile: ${firstTile.length} bytes`);
  
  console.log();
  
  // ========================================
  // Summary
  // ========================================
  console.log('=== Demo Complete! ===\n');
  console.log('Asset Injection system provides:');
  console.log('  ✓ Graphics injection (via RAM staging)');
  console.log('  ✓ Palette injection and modification');
  console.log('  ✓ Color conversion (RGB ↔ SNES BGR555)');
  console.log('  ✓ Palette utilities (grayscale, rainbow, brightness, hue)');
  console.log('  ✓ Tileset utilities');
  console.log('  ✓ File loading from SD card');
  console.log('\nSee devdocs/ASSET_INJECTION_GUIDE.md for complete documentation.');
  
  process.exit(0);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Run demonstration
demonstrateAssetInjection().catch(error => {
  console.error('\n✗ Error:', error.message);
  console.error(error.stack);
  process.exit(1);
});

