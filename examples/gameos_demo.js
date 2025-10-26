/**
 * GameOS Demonstration
 * 
 * Shows all 3 practical implementations from Phase 4.3:
 * 1. ROM Playlist Manager - Auto-progression
 * 2. Save State Manager - File-based saves
 * 3. Dynamic Level Loader - Level loading from SD
 * 
 * Prerequisites:
 * - QUsb2snes or USB2SNES server running
 * - SD2SNES/FXPak Pro hardware
 * - ROM loaded on console
 */

const { SNESWrapper } = require('../electron/main/usb2snes/SNESWrapper');
const ROMPlaylistManager = require('../electron/main/gameos/ROMPlaylistManager');
const SaveStateManager = require('../electron/main/gameos/SaveStateManager');
const DynamicLevelLoader = require('../electron/main/gameos/DynamicLevelLoader');

async function demonstrateGameOS() {
  console.log('=== GameOS Features Demonstration ===\n');
  
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
  
  // ========================================
  // Demo 1: Save State Manager
  // ========================================
  console.log('--- Demo 1: Save State Manager ---\n');
  
  const saveManager = new SaveStateManager(snes);
  
  // List existing save states
  console.log('Existing save states:');
  await saveManager.printStates();
  
  // Save current state
  console.log('Saving current state...');
  await saveManager.saveState('demo_checkpoint1', {
    description: 'Demo checkpoint from GameOS demo',
    level: 'Tutorial'
  });
  
  // List again
  console.log('\nSave states after saving:');
  await saveManager.printStates();
  
  // ========================================
  // Demo 2: Dynamic Level Loader
  // ========================================
  console.log('--- Demo 2: Dynamic Level Loader ---\n');
  
  const levelLoader = new DynamicLevelLoader(snes);
  
  // Set level directory
  levelLoader.setLevelDirectory('/work/levels/');
  
  // List available levels
  console.log('Available levels:');
  const levels = await levelLoader.listLevels();
  if (levels.length > 0) {
    levels.forEach(level => {
      console.log(`  - Level ${level.id}: ${level.filename}`);
    });
  } else {
    console.log('  (No levels found - create some in /work/levels/)');
  }
  
  // Show cache stats
  const cacheStats = levelLoader.getCacheStats();
  console.log('\nCache statistics:');
  console.log(`  Cached levels: ${cacheStats.cachedLevels}`);
  console.log(`  Cache usage: ${cacheStats.cacheUsage}`);
  
  // Example: Load a level (if available)
  if (levels.length > 0) {
    console.log(`\nLoading level ${levels[0].id}...`);
    try {
      await levelLoader.installLevel(levels[0].id, 0x7F8000);
      console.log('✓ Level installed to RAM at 0x7F8000');
    } catch (error) {
      console.log(`✗ Failed to load level: ${error.message}`);
    }
  }
  
  console.log();
  
  // ========================================
  // Demo 3: ROM Playlist Manager
  // ========================================
  console.log('--- Demo 3: ROM Playlist Manager ---\n');
  
  const playlist = new ROMPlaylistManager(snes);
  
  // Check for playlist file
  console.log('Checking for playlist file on SD card...');
  try {
    const playlistFiles = await snes.List('/work/');
    const hasPlaylist = playlistFiles.some(f => f === 'playlist.txt');
    
    if (hasPlaylist) {
      console.log('✓ Found playlist.txt');
      
      // Load playlist
      await playlist.loadPlaylist('/work/playlist.txt');
      
      // Show status
      const status = playlist.getStatus();
      console.log('\nPlaylist status:');
      console.log(`  Total ROMs: ${status.totalROMs}`);
      console.log(`  Current: ROM ${status.currentIndex + 1}`);
      console.log(`  Remaining: ${status.remaining}`);
      console.log(`  Progress: ${status.percentComplete}%`);
      console.log(`  Current ROM: ${status.currentROM}`);
      
      console.log('\nTo run auto-progression:');
      console.log('  await playlist.run();');
      console.log('  (This will auto-play through all ROMs!)');
    } else {
      console.log('✗ No playlist.txt found');
      console.log('\nTo create a playlist:');
      console.log('  1. Create /work/playlist.txt on SD card');
      console.log('  2. Add one ROM path per line:');
      console.log('     /work/roms/rom1.sfc');
      console.log('     /work/roms/rom2.sfc');
      console.log('     /work/roms/rom3.sfc');
    }
  } catch (error) {
    console.log(`✗ Error checking playlist: ${error.message}`);
  }
  
  console.log();
  
  // ========================================
  // Demo 4: Combined Usage
  // ========================================
  console.log('--- Demo 4: Combined Usage Example ---\n');
  
  console.log('Example: ROM playlist with auto-save states\n');
  console.log('```javascript');
  console.log('// Load playlist');
  console.log('await playlist.loadPlaylist("/work/playlist.txt");');
  console.log('');
  console.log('// Run with auto-save');
  console.log('for (let i = 0; i < playlist.playlist.length; i++) {');
  console.log('  // Save state before ROM');
  console.log('  await saveManager.saveState(`rom${i}_start`);');
  console.log('  ');
  console.log('  // Wait for completion');
  console.log('  await playlist.waitForCompletion();');
  console.log('  ');
  console.log('  // Save state after completion');
  console.log('  await saveManager.saveState(`rom${i}_complete`);');
  console.log('  ');
  console.log('  // Load next ROM');
  console.log('  await playlist.loadNextROM();');
  console.log('}');
  console.log('```');
  console.log();
  
  // ========================================
  // Summary
  // ========================================
  console.log('=== Demo Complete! ===\n');
  console.log('Phase 4.3 GameOS features:');
  console.log('  ✓ ROM Playlist Manager - Auto-progression');
  console.log('  ✓ Save State Manager - File-based saves');
  console.log('  ✓ Dynamic Level Loader - Load levels from SD');
  console.log('\nAll features work with stock SD2SNES firmware!');
  console.log('No custom firmware modifications needed!');
  console.log('\nSee devdocs/ROM_RESEARCH_PHASE43.md for complete documentation.');
  
  process.exit(0);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Run demonstration
demonstrateGameOS().catch(error => {
  console.error('\n✗ Error:', error.message);
  console.error(error.stack);
  process.exit(1);
});

