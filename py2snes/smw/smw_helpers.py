"""
Super Mario World Helper Functions

High-level helpers for manipulating SMW game state via USB2SNES
Requires an active py2snes.snes() instance
"""

from .smw_addresses import SMWAddresses, GAME_MODES, POWERUPS, YOSHI_COLORS, DIRECTIONS

class SMWHelpers:
    """SMW game manipulation helpers"""
    
    def __init__(self, snes_instance):
        """
        Args:
            snes_instance: Active py2snes.snes() instance
        """
        self.snes = snes_instance
        self.RAM = SMWAddresses
        self.MODES = GAME_MODES
        self.POWERUPS = POWERUPS
        self.YOSHI = YOSHI_COLORS
        self.DIRS = DIRECTIONS

    # ========================================
    # Game State Queries
    # ========================================

    async def get_game_mode(self):
        """Get current game mode"""
        data = await self.snes.GetAddress(self.RAM.GameMode, 1)
        return data[0]

    async def is_in_level(self):
        """Check if Mario is currently in a level"""
        mode = await self.get_game_mode()
        return mode == GAME_MODES.LEVEL

    async def is_paused(self):
        """Check if game is paused"""
        mode = await self.get_game_mode()
        return mode == GAME_MODES.PAUSED

    async def is_on_overworld(self):
        """Check if on overworld"""
        mode = await self.get_game_mode()
        return mode == GAME_MODES.OVERWORLD

    async def is_vertical_level(self):
        """Check if level is vertical"""
        data = await self.snes.GetAddress(self.RAM.IsVerticalLvl, 1)
        return data[0] != 0

    async def is_water_level(self):
        """Check if water level"""
        data = await self.snes.GetAddress(self.RAM.IsWaterLevel, 1)
        return data[0] != 0

    # ========================================
    # Player State (Lives, Coins, Powerup)
    # ========================================

    async def get_lives(self):
        """Get player lives"""
        data = await self.snes.GetAddress(self.RAM.StatusLives, 1)
        return data[0]

    async def set_lives(self, count):
        """Set player lives (0-99)"""
        value = max(0, min(99, count))
        await self.snes.PutAddress([[self.RAM.StatusLives, bytes([value])]])
        # Also set persistent value
        await self.snes.PutAddress([[self.RAM.PlayerLives, bytes([value])]])

    async def add_lives(self, count):
        """Add lives"""
        current = await self.get_lives()
        await self.set_lives(current + count)

    async def get_coins(self):
        """Get coin count"""
        data = await self.snes.GetAddress(self.RAM.StatusCoins, 1)
        return data[0]

    async def set_coins(self, count):
        """Set coin count (0-99)"""
        value = max(0, min(99, count))
        await self.snes.PutAddress([[self.RAM.StatusCoins, bytes([value])]])

    async def add_coins(self, count):
        """Add coins"""
        current = await self.get_coins()
        await self.set_coins(current + count)

    async def get_powerup(self):
        """Get current powerup (in level): 0=small, 1=big, 2=cape, 3=fire"""
        data = await self.snes.GetAddress(self.RAM.MarioPowerUp, 1)
        return data[0]

    async def set_powerup(self, powerup):
        """Set powerup (in level): 0=small, 1=big, 2=cape, 3=fire"""
        value = max(0, min(3, powerup))
        await self.snes.PutAddress([[self.RAM.MarioPowerUp, bytes([value])]])
        # Also set persistent value
        await self.snes.PutAddress([[self.RAM.PlayerPowerUp, bytes([value])]])

    def get_powerup_name(self, powerup):
        """Get powerup name string"""
        names = ['Small', 'Big', 'Cape', 'Fire']
        return names[powerup] if 0 <= powerup < 4 else 'Unknown'

    # ========================================
    # Position and Movement
    # ========================================

    async def get_position(self):
        """Get Mario's position"""
        data = await self.snes.GetAddresses([
            (self.RAM.MarioXPos, 1),
            (self.RAM.MarioXPosHi, 1),
            (self.RAM.MarioYPos, 1),
            (self.RAM.MarioYPosHi, 1)
        ])
        
        x = data[0][0] | (data[1][0] << 8)
        y = data[2][0] | (data[3][0] << 8)
        
        return {'x': x, 'y': y}

    async def set_position(self, x, y):
        """Set Mario's position"""
        x_lo = x & 0xFF
        x_hi = (x >> 8) & 0xFF
        y_lo = y & 0xFF
        y_hi = (y >> 8) & 0xFF
        
        await self.snes.PutAddress([
            [self.RAM.MarioXPos, bytes([x_lo])],
            [self.RAM.MarioXPosHi, bytes([x_hi])],
            [self.RAM.MarioYPos, bytes([y_lo])],
            [self.RAM.MarioYPosHi, bytes([y_hi])]
        ])

    async def get_speed(self):
        """Get Mario's speed (signed)"""
        data = await self.snes.GetAddresses([
            (self.RAM.MarioSpeedX, 1),
            (self.RAM.MarioSpeedY, 1)
        ])
        
        # Convert to signed
        x = data[0][0] if data[0][0] < 128 else data[0][0] - 256
        y = data[1][0] if data[1][0] < 128 else data[1][0] - 256
        
        return {'x': x, 'y': y}

    async def set_speed(self, x, y):
        """Set Mario's speed (signed)"""
        # Convert signed to unsigned byte
        x_byte = x if x >= 0 else 256 + x
        y_byte = y if y >= 0 else 256 + y
        
        await self.snes.PutAddress([
            [self.RAM.MarioSpeedX, bytes([x_byte & 0xFF])],
            [self.RAM.MarioSpeedY, bytes([y_byte & 0xFF])]
        ])

    async def get_direction(self):
        """Get Mario's direction: 0=right, 1=left"""
        data = await self.snes.GetAddress(self.RAM.MarioDirection, 1)
        return data[0]

    async def set_direction(self, direction):
        """Set Mario's direction: 0=right, 1=left"""
        value = 1 if direction else 0
        await self.snes.PutAddress([[self.RAM.MarioDirection, bytes([value])]])

    # ========================================
    # Mario State Flags
    # ========================================

    async def is_flying(self):
        """Check if Mario is flying"""
        data = await self.snes.GetAddress(self.RAM.IsFlying, 1)
        return data[0] != 0

    async def is_ducking(self):
        """Check if Mario is ducking"""
        data = await self.snes.GetAddress(self.RAM.IsDucking, 1)
        return data[0] != 0

    async def is_climbing(self):
        """Check if Mario is climbing"""
        data = await self.snes.GetAddress(self.RAM.IsClimbing, 1)
        return data[0] != 0

    async def is_swimming(self):
        """Check if Mario is swimming"""
        data = await self.snes.GetAddress(self.RAM.IsSwimming, 1)
        return data[0] != 0

    async def is_spin_jumping(self):
        """Check if spin jumping"""
        data = await self.snes.GetAddress(self.RAM.IsSpinJump, 1)
        return data[0] != 0

    # ========================================
    # Yoshi Functions
    # ========================================

    async def has_yoshi(self):
        """Check if Mario is on Yoshi"""
        data = await self.snes.GetAddress(self.RAM.OnYoshi, 1)
        return data[0] != 0

    async def get_yoshi_color(self):
        """Get Yoshi color: 0=green, 1=red, 2=blue, 3=yellow"""
        data = await self.snes.GetAddress(self.RAM.YoshiColor, 1)
        return data[0]

    async def give_yoshi(self, color=0):
        """Give Mario a Yoshi"""
        yoshi_color = max(0, min(3, color))
        await self.snes.PutAddress([
            [self.RAM.OnYoshi, bytes([1])],
            [self.RAM.YoshiColor, bytes([yoshi_color])],
            [self.RAM.OWHasYoshi, bytes([1])]
        ])

    async def remove_yoshi(self):
        """Remove Yoshi"""
        await self.snes.PutAddress([
            [self.RAM.OnYoshi, bytes([0])],
            [self.RAM.OWHasYoshi, bytes([0])]
        ])

    async def yoshi_has_wings(self):
        """Check if Yoshi has wings"""
        data = await self.snes.GetAddress(self.RAM.YoshiHasWings, 1)
        return data[0] != 0

    async def set_yoshi_wings(self, has_wings):
        """Give Yoshi wings"""
        value = 1 if has_wings else 0
        await self.snes.PutAddress([[self.RAM.YoshiHasWings, bytes([value])]])

    # ========================================
    # Sprite Control
    # ========================================

    async def are_sprites_locked(self):
        """Check if sprites are locked (frozen)"""
        data = await self.snes.GetAddress(self.RAM.SpritesLocked, 1)
        return data[0] != 0

    async def set_sprites_locked(self, locked):
        """Lock/unlock sprites (freeze/unfreeze)"""
        value = 1 if locked else 0
        await self.snes.PutAddress([[self.RAM.SpritesLocked, bytes([value])]])

    async def get_sprite_state(self, slot):
        """Get sprite state for a specific slot (0-11)"""
        if not 0 <= slot <= 11:
            raise ValueError('Invalid sprite slot (must be 0-11)')
        data = await self.snes.GetAddress(self.RAM.SpriteState + slot, 1)
        return data[0]

    async def set_sprite_state(self, slot, state):
        """Set sprite state for a specific slot (0-11)"""
        if not 0 <= slot <= 11:
            raise ValueError('Invalid sprite slot (must be 0-11)')
        await self.snes.PutAddress([[self.RAM.SpriteState + slot, bytes([state])]])

    async def kill_all_sprites(self):
        """Kill all sprites"""
        # Set all sprite states to 0 (dead/inactive)
        kills = [[self.RAM.SpriteState + i, bytes([0])] for i in range(12)]
        await self.snes.PutAddress(kills)

    # ========================================
    # Special Items and Timers
    # ========================================

    async def get_on_off_status(self):
        """Get ON/OFF switch status: True if yellow outline, False if yellow blocks"""
        data = await self.snes.GetAddress(self.RAM.OnOffStatus, 1)
        return data[0] != 0

    async def toggle_on_off(self):
        """Toggle ON/OFF switch"""
        current = await self.get_on_off_status()
        await self.snes.PutAddress([[self.RAM.OnOffStatus, bytes([0 if current else 1])]])

    async def get_blue_pow_timer(self):
        """Get P-switch timer (frames remaining)"""
        data = await self.snes.GetAddress(self.RAM.BluePowTimer, 1)
        return data[0]

    async def activate_p_switch(self, duration=588):
        """Activate P-switch (default 588 frames = 9.8 seconds)"""
        await self.snes.PutAddress([[self.RAM.BluePowTimer, bytes([duration & 0xFF])]])

    async def get_silver_pow_timer(self):
        """Get silver P-switch timer (frames remaining)"""
        data = await self.snes.GetAddress(self.RAM.SilverPowTimer, 1)
        return data[0]

    async def activate_silver_p_switch(self, duration=588):
        """Activate silver P-switch"""
        await self.snes.PutAddress([[self.RAM.SilverPowTimer, bytes([duration & 0xFF])]])

    # ========================================
    # Frame Counter and Random
    # ========================================

    async def get_frame_counter(self):
        """Get frame counter"""
        data = await self.snes.GetAddress(self.RAM.FrameCounter, 1)
        return data[0]

    async def get_random_bytes(self):
        """Get random bytes"""
        data = await self.snes.GetAddresses([
            (self.RAM.RandomByte1, 1),
            (self.RAM.RandomByte2, 1)
        ])
        return {'byte1': data[0][0], 'byte2': data[1][0]}

    # ========================================
    # Utility Functions
    # ========================================

    async def get_game_state(self):
        """Get comprehensive game state (one batch read)"""
        data = await self.snes.GetAddresses([
            (self.RAM.GameMode, 1),
            (self.RAM.StatusLives, 1),
            (self.RAM.StatusCoins, 1),
            (self.RAM.MarioPowerUp, 1),
            (self.RAM.MarioXPos, 1),
            (self.RAM.MarioXPosHi, 1),
            (self.RAM.MarioYPos, 1),
            (self.RAM.MarioYPosHi, 1),
            (self.RAM.OnYoshi, 1),
            (self.RAM.YoshiColor, 1),
            (self.RAM.SpritesLocked, 1)
        ])
        
        return {
            'game_mode': data[0][0],
            'lives': data[1][0],
            'coins': data[2][0],
            'powerup': data[3][0],
            'position': {
                'x': data[4][0] | (data[5][0] << 8),
                'y': data[6][0] | (data[7][0] << 8)
            },
            'has_yoshi': data[8][0] != 0,
            'yoshi_color': data[9][0],
            'sprites_locked': data[10][0] != 0
        }

    def create_state_watcher(self, on_change, poll_rate=0.1):
        """Create a game state watcher"""
        return self.snes.create_memory_watcher(
            [
                (self.RAM.GameMode, 1),
                (self.RAM.StatusLives, 1),
                (self.RAM.StatusCoins, 1),
                (self.RAM.MarioPowerUp, 1),
                (self.RAM.OnYoshi, 1)
            ],
            poll_rate,
            on_change
        )

