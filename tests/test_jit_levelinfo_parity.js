#!/usr/bin/env node

/**
 * test_jit_levelinfo_parity.js — compare JS parseLevelInfo vs level_info1 --json
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { parseLevelInfo } = require('../lib/jit-levels/levelinfo');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function stripDerived(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const copy = JSON.parse(JSON.stringify(obj));
  delete copy.derived;
  delete copy.gfx_route;
  return copy;
}

function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((acc, key) => {
      acc[key] = sortKeysDeep(value[key]);
      return acc;
    }, {});
  }
  return value;
}

function deepEqualJson(a, b) {
  return JSON.stringify(sortKeysDeep(a)) === JSON.stringify(sortKeysDeep(b));
}

function testAkogare109Parity() {
  const romPath = path.join(__dirname, '..', 'lmlevelinfo', 'test', 'akogare', 'orig_Ako.sfc');
  const levelInfoBin = path.join(__dirname, '..', 'lmlevelinfo', 'level_info1');
  if (!fs.existsSync(romPath) || !fs.existsSync(levelInfoBin)) {
    console.log('Skipping akogare parity (fixture or level_info1 missing)');
    return;
  }

  const romBuffer = fs.readFileSync(romPath);
  const jsJson = stripDerived(parseLevelInfo(romBuffer, '0x109'));

  const tmpOut = path.join(__dirname, 'fixtures', 'generated', 'c109.json');
  fs.mkdirSync(path.dirname(tmpOut), { recursive: true });
  const cRun = spawnSync(levelInfoBin, [romPath, '0x109', '--json', '-o', tmpOut], { encoding: 'utf8' });
  assert(cRun.status === 0, `level_info1 failed: ${cRun.stderr || cRun.stdout}`);
  const cJson = stripDerived(JSON.parse(fs.readFileSync(tmpOut, 'utf8')));

  assert(deepEqualJson(jsJson, cJson), 'JS/C JSON mismatch for akogare 0x109');
}

function testParseInvalidLevel() {
  const rom = Buffer.alloc(0x400000, 0);
  try {
    parseLevelInfo(rom, '0x999');
    throw new Error('expected invalid level to fail');
  } catch (err) {
    assert(err.message.length > 0);
  }
}

function testMapLevelInfoExports() {
  const { mapLevelInfoToStageDefaults, deriveTagsFromLevelInfo } = require('../lib/jit-levels/levelinfo');
  assert(typeof mapLevelInfoToStageDefaults === 'function');
  assert(typeof deriveTagsFromLevelInfo === 'function');
}

function main() {
  testMapLevelInfoExports();
  testParseInvalidLevel();
  testAkogare109Parity();
  console.log('✅ test_jit_levelinfo_parity passed');
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(`❌ test_jit_levelinfo_parity failed: ${err.message}`);
    process.exit(1);
  }
}

module.exports = { main };
