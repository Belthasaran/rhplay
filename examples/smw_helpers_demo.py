"""
SMW Helpers Demonstration (Python)

Shows how to use the SMW helper library to manipulate
Super Mario World game state

Prerequisites:
- QUsb2snes or USB2SNES server running
- SMW ROM loaded on console
- In a level (for most functions to work)
"""

import asyncio
import sys
import os

# Add parent directory to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from py2snes import py2snes
from py2snes.smw import SMWHelpers, GAME_MODES, POWERUPS, YOSHI_COLORS

async def demonstrate_smw_helpers():
    print('=== SMW Helpers Demonstration (Python) ===\n')
    
    # Connect to console
    print('Connecting to USB2SNES...')
    snes = py2snes.snes()
    
    try:
        await snes.connect('ws://localhost:64213')
        devices = await snes.DeviceList()
        if not devices:
            raise Exception('No devices found')
        await snes.Attach(devices[0])
        print('✓ Connected!\n')
    except Exception as error:
        print(f'✗ Connection failed: {error}')
        print('\nMake sure:')
        print('  1. QUsb2snes is running')
        print('  2. Console is powered on')
        print('  3. SMW ROM is loaded')
        sys.exit(1)
    
    # Create SMW helpers
    smw = SMWHelpers(snes)
    
    # ========================================
    # Demo 1: Read Current Game State
    # ========================================
    print('--- Demo 1: Current Game State ---')
    
    mode = await smw.get_game_mode()
    print(f'Game Mode: 0x{mode:02X}')
    
    if mode == GAME_MODES.LEVEL:
        print('  → In Level ✓')
    elif mode == GAME_MODES.OVERWORLD:
        print('  → On Overworld')
    elif mode == GAME_MODES.TITLE:
        print('  → At Title Screen')
    else:
        print(f'  → Other mode ({mode})')
    
    lives = await smw.get_lives()
    coins = await smw.get_coins()
    powerup = await smw.get_powerup()
    
    print(f'Lives: {lives}')
    print(f'Coins: {coins}')
    print(f'Powerup: {smw.get_powerup_name(powerup)} ({powerup})')
    
    has_yoshi = await smw.has_yoshi()
    if has_yoshi:
        yoshi_color = await smw.get_yoshi_color()
        color_names = ['Green', 'Red', 'Blue', 'Yellow']
        print(f'Yoshi: {color_names[yoshi_color]} ✓')
    else:
        print('Yoshi: None')
    
    print()
    
    # ========================================
    # Demo 2: Batch Read (Fast!)
    # ========================================
    print('--- Demo 2: Batch Read (Fast!) ---')
    
    import time
    start_time = time.time()
    state = await smw.get_game_state()
    elapsed = (time.time() - start_time) * 1000
    
    print(f'Got entire game state in {elapsed:.1f}ms:')
    print(f'  Lives: {state["lives"]}')
    print(f'  Coins: {state["coins"]}')
    print(f'  Powerup: {smw.get_powerup_name(state["powerup"])}')
    print(f'  Position: ({state["position"]["x"]}, {state["position"]["y"]})')
    print(f'  Yoshi: {"Yes" if state["has_yoshi"] else "No"}')
    print(f'  Sprites Locked: {"Yes" if state["sprites_locked"] else "No"}')
    print()
    
    # ========================================
    # Demo 3: Modify Game State
    # ========================================
    print('--- Demo 3: Modify Game State ---')
    print('WARNING: This will change your game state!')
    print('Press Ctrl+C to cancel, or wait 3 seconds...\n')
    
    await asyncio.sleep(3)
    
    print('Setting lives to 99...')
    await smw.set_lives(99)
    new_lives = await smw.get_lives()
    print(f'✓ Lives now: {new_lives}')
    
    print('Setting coins to 50...')
    await smw.set_coins(50)
    new_coins = await smw.get_coins()
    print(f'✓ Coins now: {new_coins}')
    
    if await smw.is_in_level():
        print('Giving cape powerup...')
        await smw.set_powerup(POWERUPS.CAPE)
        new_powerup = await smw.get_powerup()
        print(f'✓ Powerup now: {smw.get_powerup_name(new_powerup)}')
        
        if not await smw.has_yoshi():
            print('Giving green Yoshi...')
            await smw.give_yoshi(YOSHI_COLORS.GREEN)
            print('✓ Yoshi given!')
    else:
        print('(Skipping powerup/Yoshi - not in level)')
    
    print()
    
    # ========================================
    # Demo 4: Position Queries (In Level Only)
    # ========================================
    if await smw.is_in_level():
        print('--- Demo 4: Position Queries ---')
        
        pos = await smw.get_position()
        print(f'Current Position: ({pos["x"]}, {pos["y"]})')
        
        speed = await smw.get_speed()
        print(f'Current Speed: X={speed["x"]}, Y={speed["y"]}')
        
        direction = await smw.get_direction()
        print(f'Direction: {"Right" if direction == 0 else "Left"}')
        
        is_flying = await smw.is_flying()
        is_ducking = await smw.is_ducking()
        is_swimming = await smw.is_swimming()
        
        print(f'Flying: {"Yes" if is_flying else "No"}')
        print(f'Ducking: {"Yes" if is_ducking else "No"}')
        print(f'Swimming: {"Yes" if is_swimming else "No"}')
        print()
    
    # ========================================
    # Demo 5: Level Queries
    # ========================================
    if await smw.is_in_level():
        print('--- Demo 5: Level Queries ---')
        
        is_vertical = await smw.is_vertical_level()
        is_water = await smw.is_water_level()
        
        print(f'Vertical Level: {"Yes" if is_vertical else "No"}')
        print(f'Water Level: {"Yes" if is_water else "No"}')
        print()
    
    # ========================================
    # Demo 6: Special Items
    # ========================================
    if await smw.is_in_level():
        print('--- Demo 6: Special Items ---')
        
        p_timer = await smw.get_blue_pow_timer()
        print(f'P-Switch Timer: {p_timer} frames')
        
        on_off_status = await smw.get_on_off_status()
        print(f'ON/OFF Switch: {"Yellow Outline" if on_off_status else "Yellow Blocks"}')
        
        print('\nActivating P-switch for 5 seconds...')
        await smw.activate_p_switch(300)  # 300 frames = 5 seconds
        print('✓ P-switch activated!')
        print('  (Watch yellow blocks turn into coins!)')
        print()
    
    # ========================================
    # Demo 7: Sprite Control
    # ========================================
    if await smw.is_in_level():
        print('--- Demo 7: Sprite Control ---')
        
        sprites_locked = await smw.are_sprites_locked()
        print(f'Sprites Currently: {"Frozen" if sprites_locked else "Active"}')
        
        print('Freezing all sprites for 3 seconds...')
        await smw.set_sprites_locked(True)
        print('✓ Sprites frozen! (Enemies stopped moving)')
        
        await asyncio.sleep(3)
        
        print('Unfreezing sprites...')
        await smw.set_sprites_locked(False)
        print('✓ Sprites unfrozen!')
        print()
    
    # ========================================
    # Demo 8: Memory Watcher
    # ========================================
    print('--- Demo 8: Memory Watcher ---')
    print('Watching for state changes for 10 seconds...')
    print('(Try collecting coins, changing powerup, etc.)\n')
    
    change_count = [0]  # Use list for mutable reference
    
    def on_change(changes):
        change_count[0] += len(changes)
        for change in changes:
            addr = change['address']
            if addr == smw.RAM.StatusLives:
                print(f'  → Lives changed: {change["old_value"][0]} → {change["new_value"][0]}')
            elif addr == smw.RAM.StatusCoins:
                print(f'  → Coins changed: {change["old_value"][0]} → {change["new_value"][0]}')
            elif addr == smw.RAM.MarioPowerUp:
                print(f'  → Powerup changed: {smw.get_powerup_name(change["old_value"][0])} → {smw.get_powerup_name(change["new_value"][0])}')
            elif addr == smw.RAM.OnYoshi:
                print(f'  → Yoshi: {"On" if change["old_value"][0] else "Off"} → {"On" if change["new_value"][0] else "Off"}')
    
    watcher = smw.create_state_watcher(on_change, 0.1)  # Poll every 100ms
    
    await watcher.start()
    await asyncio.sleep(10)
    watcher.stop()
    
    print(f'\nDetected {change_count[0]} state changes in 10 seconds.')
    print()
    
    # ========================================
    # Summary
    # ========================================
    print('=== Demo Complete! ===')
    print('\nSMW Helpers provides 40+ functions:')
    print('  ✓ Player state (lives, coins, powerup, position, speed)')
    print('  ✓ Yoshi control (give, remove, colors, wings)')
    print('  ✓ Sprite control (freeze, kill, query)')
    print('  ✓ Game queries (mode, level type, flags)')
    print('  ✓ Special items (P-switch, ON/OFF)')
    print('  ✓ Memory watchers (auto-detect changes)')
    print('  ✓ Batch operations (3x faster!)')
    print('\nSee devdocs/SMW_HELPERS_GUIDE.md for complete API reference.')

# Run demonstration
if __name__ == '__main__':
    try:
        asyncio.run(demonstrate_smw_helpers())
    except KeyboardInterrupt:
        print('\n\nDemo interrupted by user.')
    except Exception as error:
        print(f'\n✗ Error: {error}')
        import traceback
        traceback.print_exc()
        sys.exit(1)

