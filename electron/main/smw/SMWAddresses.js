/**
 * Super Mario World RAM Address Constants
 * Generated from smwdisc_ram.txt
 * 
 * All addresses are in SNES format (0x7Exxxx for RAM)
 * For USB2SNES PutAddress/GetAddress, use these directly with SNES address space
 */

// Convert 7Exxxx or 7Fxxxx SNES address to actual address
function toSNESAddr(hexStr) {
  // Remove any 0x prefix and whitespace
  const clean = hexStr.replace(/^0x/, '').trim();
  return parseInt(clean, 16);
}

const SMWAddresses = {
  // Frame and Input
  FrameCounter: toSNESAddr('7E0013'),
  FrameCounterB: toSNESAddr('7E0014'),
  ControllerA: toSNESAddr('7E0015'),
  ControllerB: toSNESAddr('7E0017'),
  
  // Mario State (In-Level)
  MarioPowerUp: toSNESAddr('7E0019'),           // 0=small, 1=big, 2=cape, 3=fire
  MarioAnimation: toSNESAddr('7E0071'),
  IsFlying: toSNESAddr('7E0072'),
  IsDucking: toSNESAddr('7E0073'),
  IsClimbing: toSNESAddr('7E0074'),
  IsSwimming: toSNESAddr('7E0075'),
  MarioDirection: toSNESAddr('7E0076'),         // 0=right, 1=left
  MarioObjStatus: toSNESAddr('7E0077'),
  MarioSpeedX: toSNESAddr('7E007B'),
  MarioSpeedY: toSNESAddr('7E007D'),
  
  // Mario Position (In-Level)
  MarioXPos: toSNESAddr('7E0094'),              // Low byte
  MarioXPosHi: toSNESAddr('7E0095'),            // High byte
  MarioYPos: toSNESAddr('7E0096'),              // Low byte
  MarioYPosHi: toSNESAddr('7E0097'),            // High byte
  
  // Screen Boundaries
  ScreenBndryXLo: toSNESAddr('7E001A'),
  ScreenBndryXHi: toSNESAddr('7E001B'),
  ScreenBndryYLo: toSNESAddr('7E001C'),
  ScreenBndryYHi: toSNESAddr('7E001D'),
  
  // Level Properties
  IsVerticalLvl: toSNESAddr('7E005B'),
  ScreensInLvl: toSNESAddr('7E005D'),
  IsWaterLevel: toSNESAddr('7E0085'),
  GameMode: toSNESAddr('7E0100'),               // See GAME_MODES enum
  
  // Block Interaction
  BlockXLo: toSNESAddr('7E0098'),
  BlockXHi: toSNESAddr('7E0099'),
  BlockYLo: toSNESAddr('7E009A'),
  BlockYHi: toSNESAddr('7E009B'),
  BlockBlock: toSNESAddr('7E009C'),
  
  // Sprite Control
  SpritesLocked: toSNESAddr('7E009D'),          // Non-zero = sprites frozen
  SpriteNum: toSNESAddr('7E009E'),              // Sprite slot numbers (12 slots)
  SpriteSpeedY: toSNESAddr('7E00AA'),           // Array (12 slots)
  SpriteSpeedX: toSNESAddr('7E00B6'),           // Array (12 slots)
  SpriteState: toSNESAddr('7E00C2'),            // Array (12 slots)
  SpriteYLo: toSNESAddr('7E00D8'),              // Array (12 slots)
  SpriteXLo: toSNESAddr('7E00E4'),              // Array (12 slots)
  SpriteYHi: toSNESAddr('7E14D4'),              // Array (12 slots)
  SpriteXHi: toSNESAddr('7E14E0'),              // Array (12 slots)
  SpriteDir: toSNESAddr('7E157C'),              // Array (12 slots)
  SprObjStatus: toSNESAddr('7E1588'),           // Array (12 slots)
  OffscreenHorz: toSNESAddr('7E15A0'),          // Array (12 slots)
  OffscreenVert: toSNESAddr('7E186C'),          // Array (12 slots)
  SprOAMIndex: toSNESAddr('7E15EA'),            // Array (12 slots)
  SpritePal: toSNESAddr('7E15F6'),              // Array (12 slots)
  SprIndexInLvl: toSNESAddr('7E161A'),          // Array (12 slots)
  SprBehindScrn: toSNESAddr('7E1632'),          // Array (12 slots)
  SprLoadStatus: toSNESAddr('7E1938'),          // Array (12 slots)
  
  // Sprite Tweakers (Advanced)
  Tweaker1656: toSNESAddr('7E1656'),            // Array (12 slots)
  Tweaker1662: toSNESAddr('7E1662'),            // Array (12 slots)
  Tweaker166E: toSNESAddr('7E166E'),            // Array (12 slots)
  Tweaker167A: toSNESAddr('7E167A'),            // Array (12 slots)
  Tweaker1686: toSNESAddr('7E1686'),            // Array (12 slots)
  Tweaker190F: toSNESAddr('7E190F'),            // Array (12 slots)
  
  // Player Status (Overworld/Persistent)
  OWControllerA: toSNESAddr('7E0DA6'),
  PlayerLives: toSNESAddr('7E0DB4'),            // Lives (saved)
  PlayerCoins: toSNESAddr('7E0DB6'),            // Coins (saved, 16-bit)
  PlayerPowerUp: toSNESAddr('7E0DB8'),          // Powerup (saved)
  PlyrYoshiColor: toSNESAddr('7E0DBA'),         // Yoshi color (saved)
  StatusLives: toSNESAddr('7E0DBE'),            // Lives (display)
  StatusCoins: toSNESAddr('7E0DBF'),            // Coins (display)
  OWHasYoshi: toSNESAddr('7E0DC1'),             // Has Yoshi on overworld
  YoshiColor: toSNESAddr('7E13C7'),             // In-level Yoshi color
  OnYoshi: toSNESAddr('7E187A'),                // Currently riding Yoshi
  
  // Yoshi
  YoshiHasWingsB: toSNESAddr('7E1410'),
  YoshiInPipe: toSNESAddr('7E1419'),
  YoshiHasWings: toSNESAddr('7E141E'),
  YoshiHasStomp: toSNESAddr('7E18E7'),
  
  // Special States
  ChangingDir: toSNESAddr('7E13DD'),
  WallWalkStatus: toSNESAddr('7E13E3'),
  IsBehindScenery: toSNESAddr('7E13F9'),
  IsSpinJump: toSNESAddr('7E140D'),
  
  // Key/Keyhole
  KeyHolePos1: toSNESAddr('7E1436'),
  KeyHolePos2: toSNESAddr('7E1438'),
  
  // Random Numbers
  RandomByte1: toSNESAddr('7E148D'),
  RandomByte2: toSNESAddr('7E148E'),
  
  // Timers
  PickUpImgTimer: toSNESAddr('7E1498'),
  FaceCamImgTimer: toSNESAddr('7E1499'),
  KickImgTimer: toSNESAddr('7E149A'),
  FlashingPalTimer: toSNESAddr('7E149B'),
  FireballImgTimer: toSNESAddr('7E149C'),
  BluePowTimer: toSNESAddr('7E14AD'),
  SilverPowTimer: toSNESAddr('7E14AE'),
  ShakeGrndTimer: toSNESAddr('7E1887'),
  LockMarioTimer: toSNESAddr('7E18BD'),
  TimeTillRespawn: toSNESAddr('7E18C0'),
  SpriteToRespawn: toSNESAddr('7E18C1'),
  
  // ON/OFF Switch
  OnOffStatus: toSNESAddr('7E14AF'),            // 0=yellow blocks, 1=yellow outline
  
  // Scrolling Sprites
  ScrollSprNum: toSNESAddr('7E143E'),
  
  // Bounce Sprites
  BounceSprNum: toSNESAddr('7E1699'),
  BounceSprInit: toSNESAddr('7E169D'),
  BounceSprXLo: toSNESAddr('7E16A1'),
  BounceSprYLo: toSNESAddr('7E16A5'),
  BounceSprXHi: toSNESAddr('7E16A9'),
  BounceSprYHi: toSNESAddr('7E16AD'),
  BouncBlkSpeedX: toSNESAddr('7E16B1'),
  BouncBlkSpeedY: toSNESAddr('7E16B5'),
  BounceSprBlock: toSNESAddr('7E16C1'),
  BounceSprTimer: toSNESAddr('7E16C5'),
  BouncBlkStatus: toSNESAddr('7E16CD'),
  
  // Score Sprites
  ScoreSprNum: toSNESAddr('7E16E1'),
  ScoreSprYLo: toSNESAddr('7E16E7'),
  ScoreSprXLo: toSNESAddr('7E16ED'),
  ScoreSprXHi: toSNESAddr('7E16F3'),
  ScoreSprYHi: toSNESAddr('7E16F9'),
  ScoreSprSpeedY: toSNESAddr('7E16FF'),
  
  // Extended Sprites
  ExSpriteNum: toSNESAddr('7E170B'),
  ExSpriteYLo: toSNESAddr('7E1715'),
  ExSpriteXLo: toSNESAddr('7E171F'),
  ExSpriteYHi: toSNESAddr('7E1729'),
  ExSpriteXHi: toSNESAddr('7E1733'),
  ExSprSpeedY: toSNESAddr('7E173D'),
  ExSprSpeedX: toSNESAddr('7E1747'),
  
  // Shooter
  ShooterYLo: toSNESAddr('7E178B'),
  ShooterYHi: toSNESAddr('7E1793'),
  ShooterXLo: toSNESAddr('7E179B'),
  ShooterXHi: toSNESAddr('7E17A3'),
  ShooterTimer: toSNESAddr('7E17AB'),
  
  // Display
  Layer1DispYLo: toSNESAddr('7E1888'),
  Layer1DispYHi: toSNESAddr('7E1889'),
  
  // Generators
  GeneratorNum: toSNESAddr('7E18B9'),
  
  // Reznor Bosses
  Reznor1Dead: toSNESAddr('7E1520'),
  Reznor2Dead: toSNESAddr('7E1521'),
  Reznor3Dead: toSNESAddr('7E1522'),
  Reznor4Dead: toSNESAddr('7E1523'),
  
  // Misc
  DisableInter: toSNESAddr('7E154C'),           // Disable interaction
  
  // Extended RAM (7F bank)
  RAM_7F8000: toSNESAddr('7F8000'),             // Free RAM start
  RAM_7F8002: toSNESAddr('7F8002'),
  RAM_7F812E: toSNESAddr('7F812E'),
  RAM_7F8182: toSNESAddr('7F8182')
};

// Game Mode Constants
const GAME_MODES = {
  TITLE: 0x00,
  OVERWORLD: 0x0E,
  LEVEL: 0x14,
  PAUSED: 0x02,
  DYING: 0x09,
  GAME_OVER: 0x16,
  CUTSCENE: 0x17,
  CREDITS: 0x1C
};

// Powerup Constants
const POWERUPS = {
  SMALL: 0,
  BIG: 1,
  CAPE: 2,
  FIRE: 3
};

// Yoshi Colors
const YOSHI_COLORS = {
  GREEN: 0,
  RED: 1,
  BLUE: 2,
  YELLOW: 3
};

// Direction Constants
const DIRECTIONS = {
  RIGHT: 0,
  LEFT: 1
};

// Sprite State Constants
const SPRITE_STATES = {
  INIT: 0x00,
  NORMAL: 0x08,
  STUNNED: 0x09,
  CARRIED: 0x0B,
  DEAD: 0x00
};

module.exports = {
  SMWAddresses,
  GAME_MODES,
  POWERUPS,
  YOSHI_COLORS,
  DIRECTIONS,
  SPRITE_STATES
};

