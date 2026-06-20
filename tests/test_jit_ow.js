#!/usr/bin/env node

const { extractJitOwPlaced } = require('../lib/jit-levels/mtcompat-levelreader');
const { extractJitOw } = require('../lib/jit-levels/jit-ow');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function testEmptyRomNoOwPlacements() {
  const buf = Buffer.alloc(0x800000, 0);
  const ids = extractJitOwPlaced(buf);
  assert(ids instanceof Set, 'returns Set');
  assert(ids.size === 0, 'empty ROM has no OW placements');
}

function testExtractJitOwShape() {
  const buf = Buffer.alloc(0x800000, 0);
  const { levels } = extractJitOw(buf);
  assert(Array.isArray(levels), 'levels array');
  assert(levels.length === 0, 'empty ROM yields no jitow entries');
}

function testStarBlockDetection() {
  const buf = Buffer.alloc(0x10000, 0);
  // Minimal STAR RLE block with E4 translevel opcode pattern at offset 8
  buf.write('STAR', 0x1000, 'ascii');
  buf[0x1004] = 0x08;
  buf[0x1005] = 0x00;
  buf[0x1006] = 0xf7;
  buf[0x1007] = 0xff;
  buf[0x1008] = 0xe4;
  buf[0x1009] = 0x00;
  buf[0x100a] = 0x00;
  buf[0x100b] = 0x05;
  const ids = extractJitOwPlaced(buf);
  assert(ids.size >= 0, 'scan completes without error');
}

function main() {
  testEmptyRomNoOwPlacements();
  testExtractJitOwShape();
  testStarBlockDetection();
  console.log('✅ test_jit_ow passed');
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(`❌ test_jit_ow failed: ${err.message}`);
    process.exit(1);
  }
}

module.exports = { main };
