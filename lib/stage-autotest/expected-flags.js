'use strict';

const fs = require('fs');
const { parseLevelInfo } = require('../jit-levels/levelinfo');
const { resolveExpectedTranslevel } = require('./utils');

function flagsFromGamestage(stage) {
  if (!stage) return null;
  const stagetags = stage.stagetags ? String(stage.stagetags) : '';
  return {
    source: 'gamestages',
    water: Number(stage.water) || 0,
    castle: Number(stage.castle) || 0,
    ghouse: Number(stage.ghouse) || 0,
    spalace: Number(stage.spalace) || 0,
    boss: Number(stage.boss) || 0,
    stagetags,
    slippery_tag: stagetags.toLowerCase().includes('slippery') ? 1 : 0,
  };
}

function flagsFromJitRom(romPath, levelnumber) {
  if (!romPath || !fs.existsSync(romPath)) return null;
  try {
    const romBuffer = fs.readFileSync(romPath);
    const info = parseLevelInfo(romBuffer, levelnumber, { includeObjects: true });
    const d = info.derived || {};
    const objects = info.layer1?.objects?.standard?.length ?? info.layer1?.objects?.count ?? 0;
    const sprites = info.layer1?.sprites?.count ?? 0;
    return {
      source: 'jitlevels',
      water: d.water ? 1 : 0,
      castle: d.castle ? 1 : 0,
      ghouse: d.ghouse ? 1 : 0,
      spalace: d.spalace ? 1 : 0,
      boss: d.boss ? 1 : 0,
      slippery: d.slippery ? 1 : 0,
      screens: d.screens ?? null,
      objects,
      sprites,
      level_mode_name: d.level_mode_name || '',
    };
  } catch (e) {
    return { source: 'jitlevels', error: e.message };
  }
}

function buildExpectedFlags(stage, romPath) {
  const gs = flagsFromGamestage(stage);
  const jit = flagsFromJitRom(romPath, stage?.levelnumber);
  return {
    expectedTranslevel: resolveExpectedTranslevel(stage),
    gamestages: gs,
    jitlevels: jit,
  };
}

function compareEstToExpected(est, expected) {
  const warnings = [];
  const gs = expected.gamestages;
  const jit = expected.jitlevels;
  if (gs) {
    if (gs.water !== est.water) warnings.push(`water mismatch: test=${est.water} gamestages=${gs.water}`);
    if (jit && !jit.error && jit.slippery !== undefined && jit.slippery !== (est.slippery > 0 ? 1 : 0)) {
      warnings.push(`slippery mismatch: test=${est.slippery} jitlevels=${jit.slippery}`);
    }
  }
  return warnings;
}

module.exports = {
  flagsFromGamestage,
  flagsFromJitRom,
  buildExpectedFlags,
  compareEstToExpected,
};
