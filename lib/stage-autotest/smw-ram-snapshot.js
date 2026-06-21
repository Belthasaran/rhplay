'use strict';

const { SMWAddresses, GAME_MODES } = require('../../electron/main/smw/SMWAddresses');
const { snesRamToUsb2snes } = require('./utils');

const ADDR = {
  gameMode: snesRamToUsb2snes(SMWAddresses.GameMode),
  runGame: snesRamToUsb2snes(0x7e0010),
  translevelLo: snesRamToUsb2snes(0x7e13bf),
  levelHighFlags: snesRamToUsb2snes(0x7e19d8),
  water: snesRamToUsb2snes(SMWAddresses.IsWaterLevel),
  slippery: snesRamToUsb2snes(0x7e0086),
  inNormalLevel: snesRamToUsb2snes(0x7e0d9b),
  vertical: snesRamToUsb2snes(SMWAddresses.IsVerticalLvl),
  screens: snesRamToUsb2snes(SMWAddresses.ScreensInLvl),
  marioXLo: snesRamToUsb2snes(SMWAddresses.MarioXPos),
  marioXHi: snesRamToUsb2snes(SMWAddresses.MarioXPosHi),
  marioYLo: snesRamToUsb2snes(SMWAddresses.MarioYPos),
  marioYHi: snesRamToUsb2snes(SMWAddresses.MarioYPosHi),
  frameCounter: snesRamToUsb2snes(SMWAddresses.FrameCounter),
};

const BATCH = [
  ['gameMode', ADDR.gameMode, 1],
  ['runGame', ADDR.runGame, 1],
  ['translevelLo', ADDR.translevelLo, 1],
  ['levelHighFlags', ADDR.levelHighFlags, 1],
  ['water', ADDR.water, 1],
  ['slippery', ADDR.slippery, 1],
  ['inNormalLevel', ADDR.inNormalLevel, 1],
  ['vertical', ADDR.vertical, 1],
  ['screens', ADDR.screens, 1],
  ['marioXLo', ADDR.marioXLo, 1],
  ['marioXHi', ADDR.marioXHi, 1],
  ['marioYLo', ADDR.marioYLo, 1],
  ['marioYHi', ADDR.marioYHi, 1],
  ['frameCounter', ADDR.frameCounter, 1],
];

async function readSmwRamSnapshot(snesWrapper) {
  const addressList = BATCH.map(([, addr, size]) => [addr, size]);
  const results = await snesWrapper.GetAddresses(addressList);
  if (!results) {
    throw new Error('SNI/USB2SNES RAM read failed');
  }
  const snap = { raw: {} };
  for (let i = 0; i < BATCH.length; i++) {
    const [name] = BATCH[i];
    snap.raw[name] = results[i][0];
  }
  snap.gameMode = snap.raw.gameMode;
  snap.runGame = snap.raw.runGame;
  snap.translevel_13bf = snap.raw.translevelLo;
  snap.levelHighBit = snap.raw.levelHighFlags & 0x01;
  snap.fullLevelId = snap.levelHighBit * 256 + snap.translevel_13bf;
  snap.water = snap.raw.water !== 0;
  snap.slippery = snap.raw.slippery;
  snap.inNormalLevel = snap.raw.inNormalLevel !== 0;
  snap.vertical = snap.raw.vertical !== 0;
  snap.screens = snap.raw.screens;
  snap.marioX = snap.raw.marioXLo | (snap.raw.marioXHi << 8);
  snap.marioY = snap.raw.marioYLo | (snap.raw.marioYHi << 8);
  snap.frameCounter = snap.raw.frameCounter;
  snap.inLevel = snap.gameMode === GAME_MODES.LEVEL;
  snap.onOverworld = snap.gameMode === GAME_MODES.OVERWORLD || snap.gameMode === 0x0f;
  snap.gameOver = snap.gameMode === GAME_MODES.GAME_OVER;
  snap.isTitle = snap.gameMode >= 0x00 && snap.gameMode <= 0x03;
  return snap;
}

function translevelMatches(snap, expectedTranslevel) {
  if (expectedTranslevel === null || expectedTranslevel === undefined) return false;
  return snap.translevel_13bf === (expectedTranslevel & 0xff);
}

function snapshotToEstFlags(snap) {
  return {
    water: snap.water ? 1 : 0,
    slippery: snap.slippery,
    in_level: snap.inLevel ? 1 : 0,
    vertical: snap.vertical ? 1 : 0,
    screens: snap.screens,
    translevel_13bf: snap.translevel_13bf,
    game_mode: snap.gameMode,
  };
}

module.exports = {
  ADDR,
  readSmwRamSnapshot,
  translevelMatches,
  snapshotToEstFlags,
};
