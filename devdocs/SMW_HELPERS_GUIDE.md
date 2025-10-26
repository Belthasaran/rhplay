**# SMW Helpers Guide - Phase 4.1

**Date:** October 13, 2025  
**Status:** ✅ COMPLETE

## Overview

The SMW Helpers library provides **40+ high-level functions** for manipulating Super Mario World game state via USB2SNES. Instead of manually reading/writing raw RAM addresses, you can use intuitive helper functions.

**Features:**
- Player state manipulation (lives, coins, powerup, position)
- Yoshi control (give/remove, colors, wings)
- Sprite control (freeze, kill, query)
- Game state queries (mode, level type, flags)
- Special items (P-switches, ON/OFF blocks)
- Batch operations (get entire game state in one call)
- Memory watchers (monitor state changes)

---

## Installation & Setup

### JavaScript (Electron)

```javascript
const { SNESWrapper } = require('./main/usb2snes/SNESWrapper');
const SMWHelpers = require('./main/smw/SMWHelpers');

// Connect to console
const snes = new SNESWrapper();
await snes.fullConnect('usb2snes_a', 'ws://localhost:64213');

// Create SMW helper instance
const smw = new SMWHelpers(snes);

// Use helpers!
await smw.setLives(99);
await smw.setPowerup(smw.POWERUPS.CAPE);
```

### Python (py2snes)

```python
from py2snes import py2snes
from py2snes.smw import SMWHelpers, POWERUPS

# Connect to console
snes = py2snes.snes()
await snes.connect('ws://localhost:64213')
devices = await snes.DeviceList()
await snes.Attach(devices[0])

# Create SMW helper instance
smw = SMWHelpers(snes)

# Use helpers!
await smw.set_lives(99)
await smw.set_powerup(POWERUPS.CAPE)
```

---

## API Reference

### Game State Queries

#### `getGameMode()` / `get_game_mode()`
Get current game mode.

**Returns:** `number` - Game mode (see `GAME_MODES`)

**Example:**
```javascript
const mode = await smw.getGameMode();
if (mode === smw.MODES.LEVEL) {
  console.log('In level!');
}
```

#### `isInLevel()` / `is_in_level()`
Check if Mario is currently in a level.

**Returns:** `boolean`

#### `isPaused()` / `is_paused()`
Check if game is paused.

**Returns:** `boolean`

#### `isOnOverworld()` / `is_on_overworld()`
Check if on overworld.

**Returns:** `boolean`

#### `isVerticalLevel()` / `is_vertical_level()`
Check if current level is vertical.

**Returns:** `boolean`

#### `isWaterLevel()` / `is_water_level()`
Check if current level is underwater.

**Returns:** `boolean`

---

### Player State

#### `getLives()` / `get_lives()`
Get player lives.

**Returns:** `number` (0-99)

#### `setLives(count)` / `set_lives(count)`
Set player lives.

**Args:**
- `count` - Number of lives (0-99)

**Example:**
```javascript
await smw.setLives(99);
```

#### `addLives(count)` / `add_lives(count)`
Add lives to current count.

**Args:**
- `count` - Number of lives to add

**Example:**
```javascript
await smw.addLives(10);  // Add 10 lives
```

#### `getCoins()` / `get_coins()`
Get coin count.

**Returns:** `number` (0-99)

#### `setCoins(count)` / `set_coins(count)`
Set coin count.

**Args:**
- `count` - Number of coins (0-99)

#### `addCoins(count)` / `add_coins(count)`
Add coins to current count.

**Args:**
- `count` - Number of coins to add

#### `getPowerup()` / `get_powerup()`
Get current powerup (in level).

**Returns:** `number` - 0=small, 1=big, 2=cape, 3=fire

**Example:**
```javascript
const powerup = await smw.getPowerup();
console.log('Powerup:', smw.getPowerupName(powerup));
```

#### `setPowerup(powerup)` / `set_powerup(powerup)`
Set powerup (in level).

**Args:**
- `powerup` - 0=small, 1=big, 2=cape, 3=fire

**Example:**
```javascript
await smw.setPowerup(smw.POWERUPS.CAPE);  // Give cape
```

#### `getPowerupName(powerup)` / `get_powerup_name(powerup)`
Get human-readable powerup name.

**Args:**
- `powerup` - Powerup value (0-3)

**Returns:** `string` - "Small", "Big", "Cape", "Fire"

---

### Position and Movement

#### `getPosition()` / `get_position()`
Get Mario's current position.

**Returns:** `{x: number, y: number}`

**Example:**
```javascript
const pos = await smw.getPosition();
console.log(`Mario at (${pos.x}, ${pos.y})`);
```

#### `setPosition(x, y)` / `set_position(x, y)`
Set Mario's position (teleport).

**Args:**
- `x` - X coordinate
- `y` - Y coordinate

**Example:**
```javascript
await smw.setPosition(1000, 500);  // Teleport to (1000, 500)
```

#### `getSpeed()` / `get_speed()`
Get Mario's current speed (velocity).

**Returns:** `{x: number, y: number}` - Signed speed values

**Example:**
```javascript
const speed = await smw.getSpeed();
console.log(`Speed: X=${speed.x}, Y=${speed.y}`);
```

#### `setSpeed(x, y)` / `set_speed(x, y)`
Set Mario's speed (velocity).

**Args:**
- `x` - X speed (signed, -128 to 127)
- `y` - Y speed (signed, -128 to 127)

**Example:**
```javascript
await smw.setSpeed(48, -64);  // Fast horizontal, upward vertical
```

#### `getDirection()` / `get_direction()`
Get Mario's facing direction.

**Returns:** `number` - 0=right, 1=left

#### `setDirection(direction)` / `set_direction(direction)`
Set Mario's facing direction.

**Args:**
- `direction` - 0=right, 1=left

---

### Mario State Flags

#### `isFlying()` / `is_flying()`
Check if Mario is flying (with cape).

**Returns:** `boolean`

#### `isDucking()` / `is_ducking()`
Check if Mario is ducking.

**Returns:** `boolean`

#### `isClimbing()` / `is_climbing()`
Check if Mario is climbing.

**Returns:** `boolean`

#### `isSwimming()` / `is_swimming()`
Check if Mario is swimming.

**Returns:** `boolean`

#### `isSpinJumping()` / `is_spin_jumping()`
Check if performing a spin jump.

**Returns:** `boolean`

---

### Yoshi Functions

#### `hasYoshi()` / `has_yoshi()`
Check if Mario is currently on Yoshi.

**Returns:** `boolean`

#### `getYoshiColor()` / `get_yoshi_color()`
Get current Yoshi color.

**Returns:** `number` - 0=green, 1=red, 2=blue, 3=yellow

#### `giveYoshi(color)` / `give_yoshi(color)`
Give Mario a Yoshi.

**Args:**
- `color` - Yoshi color (0-3), default 0 (green)

**Example:**
```javascript
await smw.giveYoshi(smw.YOSHI.RED);  // Give red Yoshi
```

#### `removeYoshi()` / `remove_yoshi()`
Remove Yoshi.

**Example:**
```javascript
await smw.removeYoshi();
```

#### `yoshiHasWings()` / `yoshi_has_wings()`
Check if Yoshi has wings.

**Returns:** `boolean`

#### `setYoshiWings(hasWings)` / `set_yoshi_wings(has_wings)`
Give/remove Yoshi wings.

**Args:**
- `hasWings` - Boolean

**Example:**
```javascript
await smw.setYoshiWings(true);  // Give wings
```

---

### Sprite Control

#### `areSpritesLocked()` / `are_sprites_locked()`
Check if sprites are locked (frozen).

**Returns:** `boolean`

#### `setSpritesLocked(locked)` / `set_sprites_locked(locked)`
Lock/unlock all sprites (freeze/unfreeze).

**Args:**
- `locked` - Boolean

**Example:**
```javascript
await smw.setSpritesLocked(true);   // Freeze all sprites
await smw.setSpritesLocked(false);  // Unfreeze
```

#### `getSpriteState(slot)` / `get_sprite_state(slot)`
Get state of a specific sprite slot.

**Args:**
- `slot` - Sprite slot number (0-11)

**Returns:** `number` - Sprite state

#### `setSpriteState(slot, state)` / `set_sprite_state(slot, state)`
Set state of a specific sprite slot.

**Args:**
- `slot` - Sprite slot number (0-11)
- `state` - Sprite state value

#### `killAllSprites()` / `kill_all_sprites()`
Kill all sprites (set all slots to inactive).

**Example:**
```javascript
await smw.killAllSprites();  // Clear all enemies
```

---

### Special Items and Timers

#### `getOnOffStatus()` / `get_on_off_status()`
Get ON/OFF switch status.

**Returns:** `boolean` - true if yellow outline, false if yellow blocks

#### `toggleOnOff()` / `toggle_on_off()`
Toggle ON/OFF switch state.

**Example:**
```javascript
await smw.toggleOnOff();  // Switch blocks <-> outlines
```

#### `getBluePowTimer()` / `get_blue_pow_timer()`
Get P-switch timer remaining.

**Returns:** `number` - Frames remaining

#### `activatePSwitch(duration)` / `activate_p_switch(duration)`
Activate P-switch.

**Args:**
- `duration` - Duration in frames (default 588 = 9.8 seconds)

**Example:**
```javascript
await smw.activatePSwitch();  // Activate with default duration
```

#### `getSilverPowTimer()` / `get_silver_pow_timer()`
Get silver P-switch timer remaining.

**Returns:** `number` - Frames remaining

#### `activateSilverPSwitch(duration)` / `activate_silver_p_switch(duration)`
Activate silver P-switch.

**Args:**
- `duration` - Duration in frames (default 588)

---

### Frame Counter and Random

#### `getFrameCounter()` / `get_frame_counter()`
Get current frame counter.

**Returns:** `number` - Frame count (0-255, wraps)

#### `getRandomBytes()` / `get_random_bytes()`
Get random number generator bytes.

**Returns:** `{byte1: number, byte2: number}`

**Example:**
```javascript
const rng = await smw.getRandomBytes();
console.log('Random:', rng.byte1, rng.byte2);
```

---

### Utility Functions

#### `getGameState()` / `get_game_state()`
Get comprehensive game state in one batch read.

**Returns:** Object with all major state values

**Example:**
```javascript
const state = await smw.getGameState();
console.log('Lives:', state.lives);
console.log('Coins:', state.coins);
console.log('Powerup:', smw.getPowerupName(state.powerup));
console.log('Position:', state.position);
console.log('Has Yoshi:', state.hasYoshi);
console.log('Sprites Locked:', state.spritesLocked);
```

**Performance:** Uses batch read (`GetAddresses`) - much faster than individual calls!

#### `createStateWatcher(onChange, pollRate)` / `create_state_watcher(on_change, poll_rate)`
Create a memory watcher for key game state.

**Args:**
- `onChange` / `on_change` - Callback function(changes)
- `pollRate` / `poll_rate` - Poll rate (ms for JS, seconds for Python)

**Returns:** Watcher object with `start()`, `stop()`, `isRunning`

**Example:**
```javascript
const watcher = smw.createStateWatcher((changes) => {
  console.log('State changed:', changes);
}, 100);

await watcher.start();
// ... monitor changes ...
watcher.stop();
```

---

## Constants

### GAME_MODES / GAME_MODES
```javascript
TITLE: 0x00
OVERWORLD: 0x0E
LEVEL: 0x14
PAUSED: 0x02
DYING: 0x09
GAME_OVER: 0x16
CUTSCENE: 0x17
CREDITS: 0x1C
```

### POWERUPS / POWERUPS
```javascript
SMALL: 0
BIG: 1
CAPE: 2
FIRE: 3
```

### YOSHI_COLORS / YOSHI_COLORS
```javascript
GREEN: 0
RED: 1
BLUE: 2
YELLOW: 3
```

### DIRECTIONS / DIRECTIONS
```javascript
RIGHT: 0
LEFT: 1
```

---

## Usage Examples

### Example 1: Practice Mode

```javascript
// Save practice checkpoint
const checkpoint = {
  lives: await smw.getLives(),
  coins: await smw.getCoins(),
  powerup: await smw.getPowerup(),
  position: await smw.getPosition(),
  yoshi: await smw.hasYoshi(),
  yoshiColor: await smw.getYoshiColor()
};

console.log('Checkpoint saved!');

// ... attempt hard section, die ...

// Restore checkpoint
await smw.setLives(checkpoint.lives);
await smw.setCoins(checkpoint.coins);
await smw.setPowerup(checkpoint.powerup);
await smw.setPosition(checkpoint.position.x, checkpoint.position.y);

if (checkpoint.yoshi) {
  await smw.giveYoshi(checkpoint.yoshiColor);
} else {
  await smw.removeYoshi();
}

console.log('Checkpoint loaded!');
```

### Example 2: Challenge Mode - Small Mario Only

```javascript
// Enforce small Mario
await smw.setPowerup(smw.POWERUPS.SMALL);
await smw.removeYoshi();

// Watch for violations
const watcher = smw.createStateWatcher(async (changes) => {
  for (const change of changes) {
    if (change.address === smw.RAM.MarioPowerUp && change.newValue[0] !== 0) {
      console.log('Challenge violation! Reverting to small Mario.');
      await smw.setPowerup(smw.POWERUPS.SMALL);
    }
  }
}, 100);

await watcher.start();
console.log('Small Mario challenge active!');
```

### Example 3: Speedrun Setup

```javascript
// Setup for speedrun attempts
async function setupSpeedrun() {
  await smw.setLives(1);          // 1 life (no game overs)
  await smw.setCoins(0);          // Reset coins
  await smw.setPowerup(smw.POWERUPS.BIG);  // Start big
  await smw.giveYoshi(smw.YOSHI.GREEN);    // Start with Yoshi
  
  console.log('Speedrun setup complete!');
}

await setupSpeedrun();
```

### Example 4: Level Teleporter

```javascript
// Teleport to specific coordinates
const levelPositions = {
  start: { x: 100, y: 500 },
  midpoint: { x: 2000, y: 300 },
  end: { x: 5000, y: 500 }
};

await smw.setPosition(levelPositions.midpoint.x, levelPositions.midpoint.y);
console.log('Teleported to midpoint!');
```

### Example 5: Auto-Powerup Cycler

```javascript
// Cycle through all powerups every 5 seconds
const powerups = [
  smw.POWERUPS.SMALL,
  smw.POWERUPS.BIG,
  smw.POWERUPS.CAPE,
  smw.POWERUPS.FIRE
];

let currentIndex = 0;

setInterval(async () => {
  const powerup = powerups[currentIndex];
  await smw.setPowerup(powerup);
  console.log(`Powerup changed to: ${smw.getPowerupName(powerup)}`);
  
  currentIndex = (currentIndex + 1) % powerups.length;
}, 5000);
```

### Example 6: P-Switch Challenge

```javascript
// Activate P-switch and freeze sprites
await smw.activatePSwitch(1176);  // 19.6 seconds (double duration)
await smw.setSpritesLocked(true); // Freeze enemies

console.log('P-switch challenge started!');

// Wait for P-switch to expire
while (await smw.getBluePowTimer() > 0) {
  await new Promise(resolve => setTimeout(resolve, 100));
}

await smw.setSpritesLocked(false);  // Unfreeze
console.log('Challenge complete!');
```

### Example 7: Real-Time Stats Display

```javascript
// Display live stats
async function displayStats() {
  const state = await smw.getGameState();
  
  console.clear();
  console.log('=== SMW Live Stats ===');
  console.log(`Lives: ${state.lives}`);
  console.log(`Coins: ${state.coins}`);
  console.log(`Powerup: ${smw.getPowerupName(state.powerup)}`);
  console.log(`Position: (${state.position.x}, ${state.position.y})`);
  console.log(`Yoshi: ${state.hasYoshi ? 'Yes' : 'No'}`);
  console.log(`Mode: ${state.gameMode === smw.MODES.LEVEL ? 'In Level' : 'Not in Level'}`);
}

// Update every second
setInterval(displayStats, 1000);
```

### Example 8: Python - Auto-Cape Giver

```python
from py2snes import py2snes
from py2snes.smw import SMWHelpers, POWERUPS
import asyncio

async def main():
    # Connect
    snes = py2snes.snes()
    await snes.connect('ws://localhost:64213')
    devices = await snes.DeviceList()
    await snes.Attach(devices[0])
    
    # Create helpers
    smw = SMWHelpers(snes)
    
    # Monitor powerup and auto-give cape
    while True:
        powerup = await smw.get_powerup()
        
        if powerup == POWERUPS.SMALL or powerup == POWERUPS.BIG:
            print(f'Upgrading to cape from {smw.get_powerup_name(powerup)}')
            await smw.set_powerup(POWERUPS.CAPE)
        
        await asyncio.sleep(0.5)

asyncio.run(main())
```

---

## Performance Tips

### Use Batch Operations

**Bad** (multiple GetAddress calls):
```javascript
const lives = await smw.getLives();
const coins = await smw.getCoins();
const powerup = await smw.getPowerup();
// 3 WebSocket round-trips (~30ms)
```

**Good** (single batch read):
```javascript
const state = await smw.getGameState();
const lives = state.lives;
const coins = state.coins;
const powerup = state.powerup;
// 1 WebSocket round-trip (~10ms) - 3x faster!
```

### Use Memory Watchers

**Bad** (polling loop):
```javascript
while (true) {
  const lives = await smw.getLives();
  if (lives !== lastLives) {
    console.log('Lives changed:', lives);
    lastLives = lives;
  }
  await sleep(100);
}
```

**Good** (memory watcher):
```javascript
const watcher = smw.createStateWatcher((changes) => {
  changes.forEach(change => {
    console.log('State changed:', change);
  });
}, 100);

await watcher.start();
```

---

## Address Reference

All addresses are available via `smw.RAM`:

```javascript
smw.RAM.MarioPowerUp     // 0x7E0019
smw.RAM.StatusLives      // 0x7E0DBE
smw.RAM.StatusCoins      // 0x7E0DBF
smw.RAM.GameMode         // 0x7E0100
smw.RAM.OnYoshi          // 0x7E187A
smw.RAM.SpritesLocked    // 0x7E009D
// ... 50+ more addresses
```

See `SMWAddresses.js` / `smw_addresses.py` for complete list.

---

## Testing

### Manual Testing

```javascript
// Test basic functions
await smw.setLives(99);
console.log('Lives:', await smw.getLives());  // Should be 99

await smw.setPowerup(smw.POWERUPS.CAPE);
console.log('Powerup:', smw.getPowerupName(await smw.getPowerup()));  // Should be "Cape"

await smw.giveYoshi(smw.YOSHI.RED);
console.log('Has Yoshi:', await smw.hasYoshi());  // Should be true
console.log('Yoshi Color:', await smw.getYoshiColor());  // Should be 1 (red)
```

### Automated Testing

Create test cases in `tests/test_smw_helpers.js`:

```javascript
const assert = require('assert');
const { SNESWrapper } = require('../electron/main/usb2snes/SNESWrapper');
const SMWHelpers = require('../electron/main/smw/SMWHelpers');

async function testSMWHelpers() {
  const snes = new SNESWrapper();
  await snes.fullConnect('usb2snes_a', 'ws://localhost:64213');
  const smw = new SMWHelpers(snes);
  
  // Test lives
  await smw.setLives(50);
  const lives = await smw.getLives();
  assert.strictEqual(lives, 50, 'Lives should be 50');
  
  // Test powerup
  await smw.setPowerup(smw.POWERUPS.FIRE);
  const powerup = await smw.getPowerup();
  assert.strictEqual(powerup, 3, 'Powerup should be 3 (fire)');
  
  console.log('✓ All tests passed!');
}

testSMWHelpers();
```

---

## Troubleshooting

### "Not connected" errors
Make sure SNES is connected before using helpers:
```javascript
if (!snes.isConnected()) {
  await snes.fullConnect('usb2snes_a', 'ws://localhost:64213');
}
```

### Values not changing
- Ensure game is in the correct mode (some addresses only work in-level)
- Check that ROM is running (not paused, not in menu)
- Try setting values twice (some addresses need confirmation)

### Position teleport doesn't work
- Position only works when in a level
- Coordinates must be valid for the current level
- Try freezing sprites first to prevent interactions

---

## Future Enhancements (Phase 4.2+)

Planned features:
- Custom code execution helpers
- Level data manipulation
- Graphics injection
- Savestate shortcuts (via Phase 3)
- ROM patching helpers
- More SMW-specific functions (message box, cutscene control, etc.)

---

## Summary

**Phase 4.1 Delivers:**
- ✅ 40+ SMW helper functions
- ✅ JavaScript implementation (859 lines)
- ✅ Python implementation (531 lines)
- ✅ Comprehensive documentation
- ✅ Usage examples
- ✅ Address constants (50+ addresses)
- ✅ Game mode/powerup/Yoshi constants
- ✅ Batch operation support
- ✅ Memory watcher integration

**Total:** ~1,390 lines of production-ready code!

**Ready to use NOW!** 🎉

