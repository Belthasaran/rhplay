/**
 * SMW Helpers Demonstration
 * 
 * Shows how to use the SMW helper library to manipulate
 * Super Mario World game state
 * 
 * Prerequisites:
 * - QUsb2snes or USB2SNES server running
 * - SMW ROM loaded on console
 * - In a level (for most functions to work)
 */

const { SNESWrapper } = require('../electron/main/usb2snes/SNESWrapper');
const SMWHelpers = require('../electron/main/smw/SMWHelpers');

async function demonstrateSMWHelpers() {
  console.log('=== SMW Helpers Demonstration ===\n');
  
  // Connect to console
  console.log('Connecting to USB2SNES...');
  const snes = new SNESWrapper();
  
  try {
    await snes.fullConnect('usb2snes_a', 'ws://localhost:64213');
    console.log('✓ Connected!\n');
  } catch (error) {
    console.error('✗ Connection failed:', error.message);
    console.log('\nMake sure:');
    console.log('  1. QUsb2snes is running');
    console.log('  2. Console is powered on');
    console.log('  3. SMW ROM is loaded');
    process.exit(1);
  }
  
  // Create SMW helpers
  const smw = new SMWHelpers(snes);
  
  // ========================================
  // Demo 1: Read Current Game State
  // ========================================
  console.log('--- Demo 1: Current Game State ---');
  
  const mode = await smw.getGameMode();
  console.log(`Game Mode: 0x${mode.toString(16).toUpperCase()}`);
  
  if (mode === smw.MODES.LEVEL) {
    console.log('  → In Level ✓');
  } else if (mode === smw.MODES.OVERWORLD) {
    console.log('  → On Overworld');
  } else if (mode === smw.MODES.TITLE) {
    console.log('  → At Title Screen');
  } else {
    console.log(`  → Other mode (${mode})`);
  }
  
  const lives = await smw.getLives();
  const coins = await smw.getCoins();
  const powerup = await smw.getPowerup();
  
  console.log(`Lives: ${lives}`);
  console.log(`Coins: ${coins}`);
  console.log(`Powerup: ${smw.getPowerupName(powerup)} (${powerup})`);
  
  const hasYoshi = await smw.hasYoshi();
  if (hasYoshi) {
    const yoshiColor = await smw.getYoshiColor();
    const colorNames = ['Green', 'Red', 'Blue', 'Yellow'];
    console.log(`Yoshi: ${colorNames[yoshiColor]} ✓`);
  } else {
    console.log('Yoshi: None');
  }
  
  console.log();
  
  // ========================================
  // Demo 2: Batch Read (Fast!)
  // ========================================
  console.log('--- Demo 2: Batch Read (Fast!) ---');
  
  const startTime = Date.now();
  const state = await smw.getGameState();
  const elapsed = Date.now() - startTime;
  
  console.log(`Got entire game state in ${elapsed}ms:`);
  console.log(`  Lives: ${state.lives}`);
  console.log(`  Coins: ${state.coins}`);
  console.log(`  Powerup: ${smw.getPowerupName(state.powerup)}`);
  console.log(`  Position: (${state.position.x}, ${state.position.y})`);
  console.log(`  Yoshi: ${state.hasYoshi ? 'Yes' : 'No'}`);
  console.log(`  Sprites Locked: ${state.spritesLocked ? 'Yes' : 'No'}`);
  console.log();
  
  // ========================================
  // Demo 3: Modify Game State
  // ========================================
  console.log('--- Demo 3: Modify Game State ---');
  console.log('WARNING: This will change your game state!');
  console.log('Press Ctrl+C to cancel, or wait 3 seconds...\n');
  
  await sleep(3000);
  
  console.log('Setting lives to 99...');
  await smw.setLives(99);
  const newLives = await smw.getLives();
  console.log(`✓ Lives now: ${newLives}`);
  
  console.log('Setting coins to 50...');
  await smw.setCoins(50);
  const newCoins = await smw.getCoins();
  console.log(`✓ Coins now: ${newCoins}`);
  
  if (await smw.isInLevel()) {
    console.log('Giving cape powerup...');
    await smw.setPowerup(smw.POWERUPS.CAPE);
    const newPowerup = await smw.getPowerup();
    console.log(`✓ Powerup now: ${smw.getPowerupName(newPowerup)}`);
    
    if (!await smw.hasYoshi()) {
      console.log('Giving green Yoshi...');
      await smw.giveYoshi(smw.YOSHI.GREEN);
      console.log('✓ Yoshi given!');
    }
  } else {
    console.log('(Skipping powerup/Yoshi - not in level)');
  }
  
  console.log();
  
  // ========================================
  // Demo 4: Position Queries (In Level Only)
  // ========================================
  if (await smw.isInLevel()) {
    console.log('--- Demo 4: Position Queries ---');
    
    const pos = await smw.getPosition();
    console.log(`Current Position: (${pos.x}, ${pos.y})`);
    
    const speed = await smw.getSpeed();
    console.log(`Current Speed: X=${speed.x}, Y=${speed.y}`);
    
    const dir = await smw.getDirection();
    console.log(`Direction: ${dir === 0 ? 'Right' : 'Left'}`);
    
    const isFlying = await smw.isFlying();
    const isDucking = await smw.isDucking();
    const isSwimming = await smw.isSwimming();
    
    console.log(`Flying: ${isFlying ? 'Yes' : 'No'}`);
    console.log(`Ducking: ${isDucking ? 'Yes' : 'No'}`);
    console.log(`Swimming: ${isSwimming ? 'Yes' : 'No'}`);
    console.log();
  }
  
  // ========================================
  // Demo 5: Level Queries
  // ========================================
  if (await smw.isInLevel()) {
    console.log('--- Demo 5: Level Queries ---');
    
    const isVertical = await smw.isVerticalLevel();
    const isWater = await smw.isWaterLevel();
    
    console.log(`Vertical Level: ${isVertical ? 'Yes' : 'No'}`);
    console.log(`Water Level: ${isWater ? 'Yes' : 'No'}`);
    console.log();
  }
  
  // ========================================
  // Demo 6: Special Items
  // ========================================
  if (await smw.isInLevel()) {
    console.log('--- Demo 6: Special Items ---');
    
    const pTimer = await smw.getBluePowTimer();
    console.log(`P-Switch Timer: ${pTimer} frames`);
    
    const onOffStatus = await smw.getOnOffStatus();
    console.log(`ON/OFF Switch: ${onOffStatus ? 'Yellow Outline' : 'Yellow Blocks'}`);
    
    console.log('\nActivating P-switch for 5 seconds...');
    await smw.activatePSwitch(300);  // 300 frames = 5 seconds
    console.log('✓ P-switch activated!');
    console.log('  (Watch yellow blocks turn into coins!)');
    console.log();
  }
  
  // ========================================
  // Demo 7: Sprite Control
  // ========================================
  if (await smw.isInLevel()) {
    console.log('--- Demo 7: Sprite Control ---');
    
    const spritesLocked = await smw.areSpritesLocked();
    console.log(`Sprites Currently: ${spritesLocked ? 'Frozen' : 'Active'}`);
    
    console.log('Freezing all sprites for 3 seconds...');
    await smw.setSpritesLocked(true);
    console.log('✓ Sprites frozen! (Enemies stopped moving)');
    
    await sleep(3000);
    
    console.log('Unfreezing sprites...');
    await smw.setSpritesLocked(false);
    console.log('✓ Sprites unfrozen!');
    console.log();
  }
  
  // ========================================
  // Demo 8: Memory Watcher
  // ========================================
  console.log('--- Demo 8: Memory Watcher ---');
  console.log('Watching for state changes for 10 seconds...');
  console.log('(Try collecting coins, changing powerup, etc.)\n');
  
  let changeCount = 0;
  const watcher = smw.createStateWatcher((changes) => {
    changeCount += changes.length;
    changes.forEach(change => {
      const addr = change.address;
      if (addr === smw.RAM.StatusLives) {
        console.log(`  → Lives changed: ${change.oldValue[0]} → ${change.newValue[0]}`);
      } else if (addr === smw.RAM.StatusCoins) {
        console.log(`  → Coins changed: ${change.oldValue[0]} → ${change.newValue[0]}`);
      } else if (addr === smw.RAM.MarioPowerUp) {
        console.log(`  → Powerup changed: ${smw.getPowerupName(change.oldValue[0])} → ${smw.getPowerupName(change.newValue[0])}`);
      } else if (addr === smw.RAM.OnYoshi) {
        console.log(`  → Yoshi: ${change.oldValue[0] ? 'On' : 'Off'} → ${change.newValue[0] ? 'On' : 'Off'}`);
      }
    });
  }, 100);  // Poll every 100ms
  
  await watcher.start();
  await sleep(10000);
  watcher.stop();
  
  console.log(`\nDetected ${changeCount} state changes in 10 seconds.`);
  console.log();
  
  // ========================================
  // Summary
  // ========================================
  console.log('=== Demo Complete! ===');
  console.log('\nSMW Helpers provides 40+ functions:');
  console.log('  ✓ Player state (lives, coins, powerup, position, speed)');
  console.log('  ✓ Yoshi control (give, remove, colors, wings)');
  console.log('  ✓ Sprite control (freeze, kill, query)');
  console.log('  ✓ Game queries (mode, level type, flags)');
  console.log('  ✓ Special items (P-switch, ON/OFF)');
  console.log('  ✓ Memory watchers (auto-detect changes)');
  console.log('  ✓ Batch operations (3x faster!)');
  console.log('\nSee devdocs/SMW_HELPERS_GUIDE.md for complete API reference.');
  
  process.exit(0);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Run demonstration
demonstrateSMWHelpers().catch(error => {
  console.error('\n✗ Error:', error.message);
  console.error(error.stack);
  process.exit(1);
});

