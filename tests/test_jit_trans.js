#!/usr/bin/env node

/**
 * test_jit_trans.js — JIT.Trans vanilla tilemap scan tests
 */

const { createRomFromBuffer } = require('../lib/jit-levels/smw-rom');
const { scanVanillaTilemap, translevelToLevel } = require('../lib/jit-levels/jit-trans');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function testTranslevelMapping() {
  assert(translevelToLevel(0x01) === 0x01);
  assert(translevelToLevel(0x25) === 0x101);
}

function testVanillaTilemapScan() {
  const tilemap = Buffer.alloc(0x800, 0);
  tilemap[0] = 0x56;
  tilemap[1] = 0x57;
  const exits = Buffer.alloc(96, 0);
  const result = scanVanillaTilemap(tilemap, exits);
  assert(Object.keys(result).length === 2, 'expected 2 translevels');
  assert(result[1][0].tile_x === 0);
  assert(result[2][0].tile_x === 1);
}

function testExtractEmptyRom() {
  const rom = createRomFromBuffer(Buffer.alloc(0x200000, 0));
  const { extractJitTrans } = require('../lib/jit-levels/jit-trans');
  const result = extractJitTrans(rom);
  assert(Array.isArray(result.levels));
}

function main() {
  testTranslevelMapping();
  testVanillaTilemapScan();
  testExtractEmptyRom();
  console.log('✅ test_jit_trans passed');
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(`❌ test_jit_trans failed: ${err.message}`);
    process.exit(1);
  }
}

module.exports = { main };
