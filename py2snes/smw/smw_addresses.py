"""
Super Mario World RAM Address Constants
Generated from smwdisc_ram.txt

All addresses are in SNES format (0x7Exxxx for RAM)
For USB2SNES PutAddress/GetAddress, use these directly with SNES address space
"""

def to_snes_addr(hex_str):
    """Convert 7Exxxx or 7Fxxxx SNES address to actual address"""
    clean = hex_str.replace('0x', '').strip()
    return int(clean, 16)

# SMW RAM Addresses
class SMWAddresses:
    # Frame and Input
    FrameCounter = to_snes_addr('7E0013')
    FrameCounterB = to_snes_addr('7E0014')
    ControllerA = to_snes_addr('7E0015')
    ControllerB = to_snes_addr('7E0017')
    
    # Mario State (In-Level)
    MarioPowerUp = to_snes_addr('7E0019')         # 0=small, 1=big, 2=cape, 3=fire
    MarioAnimation = to_snes_addr('7E0071')
    IsFlying = to_snes_addr('7E0072')
    IsDucking = to_snes_addr('7E0073')
    IsClimbing = to_snes_addr('7E0074')
    IsSwimming = to_snes_addr('7E0075')
    MarioDirection = to_snes_addr('7E0076')       # 0=right, 1=left
    MarioObjStatus = to_snes_addr('7E0077')
    MarioSpeedX = to_snes_addr('7E007B')
    MarioSpeedY = to_snes_addr('7E007D')
    
    # Mario Position (In-Level)
    MarioXPos = to_snes_addr('7E0094')            # Low byte
    MarioXPosHi = to_snes_addr('7E0095')          # High byte
    MarioYPos = to_snes_addr('7E0096')            # Low byte
    MarioYPosHi = to_snes_addr('7E0097')          # High byte
    
    # Screen Boundaries
    ScreenBndryXLo = to_snes_addr('7E001A')
    ScreenBndryXHi = to_snes_addr('7E001B')
    ScreenBndryYLo = to_snes_addr('7E001C')
    ScreenBndryYHi = to_snes_addr('7E001D')
    
    # Level Properties
    IsVerticalLvl = to_snes_addr('7E005B')
    ScreensInLvl = to_snes_addr('7E005D')
    IsWaterLevel = to_snes_addr('7E0085')
    GameMode = to_snes_addr('7E0100')             # See GAME_MODES
    
    # Block Interaction
    BlockXLo = to_snes_addr('7E0098')
    BlockXHi = to_snes_addr('7E0099')
    BlockYLo = to_snes_addr('7E009A')
    BlockYHi = to_snes_addr('7E009B')
    BlockBlock = to_snes_addr('7E009C')
    
    # Sprite Control
    SpritesLocked = to_snes_addr('7E009D')        # Non-zero = sprites frozen
    SpriteNum = to_snes_addr('7E009E')            # Sprite slot numbers (12 slots)
    SpriteSpeedY = to_snes_addr('7E00AA')         # Array (12 slots)
    SpriteSpeedX = to_snes_addr('7E00B6')         # Array (12 slots)
    SpriteState = to_snes_addr('7E00C2')          # Array (12 slots)
    SpriteYLo = to_snes_addr('7E00D8')            # Array (12 slots)
    SpriteXLo = to_snes_addr('7E00E4')            # Array (12 slots)
    SpriteYHi = to_snes_addr('7E14D4')            # Array (12 slots)
    SpriteXHi = to_snes_addr('7E14E0')            # Array (12 slots)
    SpriteDir = to_snes_addr('7E157C')            # Array (12 slots)
    SprObjStatus = to_snes_addr('7E1588')         # Array (12 slots)
    
    # Player Status (Overworld/Persistent)
    OWControllerA = to_snes_addr('7E0DA6')
    PlayerLives = to_snes_addr('7E0DB4')          # Lives (saved)
    PlayerCoins = to_snes_addr('7E0DB6')          # Coins (saved, 16-bit)
    PlayerPowerUp = to_snes_addr('7E0DB8')        # Powerup (saved)
    PlyrYoshiColor = to_snes_addr('7E0DBA')       # Yoshi color (saved)
    StatusLives = to_snes_addr('7E0DBE')          # Lives (display)
    StatusCoins = to_snes_addr('7E0DBF')          # Coins (display)
    OWHasYoshi = to_snes_addr('7E0DC1')           # Has Yoshi on overworld
    YoshiColor = to_snes_addr('7E13C7')           # In-level Yoshi color
    OnYoshi = to_snes_addr('7E187A')              # Currently riding Yoshi
    
    # Yoshi
    YoshiHasWingsB = to_snes_addr('7E1410')
    YoshiInPipe = to_snes_addr('7E1419')
    YoshiHasWings = to_snes_addr('7E141E')
    YoshiHasStomp = to_snes_addr('7E18E7')
    
    # Special States
    ChangingDir = to_snes_addr('7E13DD')
    WallWalkStatus = to_snes_addr('7E13E3')
    IsBehindScenery = to_snes_addr('7E13F9')
    IsSpinJump = to_snes_addr('7E140D')
    
    # Random Numbers
    RandomByte1 = to_snes_addr('7E148D')
    RandomByte2 = to_snes_addr('7E148E')
    
    # Timers
    PickUpImgTimer = to_snes_addr('7E1498')
    FaceCamImgTimer = to_snes_addr('7E1499')
    KickImgTimer = to_snes_addr('7E149A')
    FlashingPalTimer = to_snes_addr('7E149B')
    FireballImgTimer = to_snes_addr('7E149C')
    BluePowTimer = to_snes_addr('7E14AD')
    SilverPowTimer = to_snes_addr('7E14AE')
    ShakeGrndTimer = to_snes_addr('7E1887')
    LockMarioTimer = to_snes_addr('7E18BD')
    
    # ON/OFF Switch
    OnOffStatus = to_snes_addr('7E14AF')          # 0=yellow blocks, 1=yellow outline
    
    # Extended RAM (7F bank)
    RAM_7F8000 = to_snes_addr('7F8000')           # Free RAM start

# Game Mode Constants
class GAME_MODES:
    TITLE = 0x00
    OVERWORLD = 0x0E
    LEVEL = 0x14
    PAUSED = 0x02
    DYING = 0x09
    GAME_OVER = 0x16
    CUTSCENE = 0x17
    CREDITS = 0x1C

# Powerup Constants
class POWERUPS:
    SMALL = 0
    BIG = 1
    CAPE = 2
    FIRE = 3

# Yoshi Colors
class YOSHI_COLORS:
    GREEN = 0
    RED = 1
    BLUE = 2
    YELLOW = 3

# Direction Constants
class DIRECTIONS:
    RIGHT = 0
    LEFT = 1

