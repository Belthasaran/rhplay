#!/usr/bin/env node

/**
 * test_jit_names.js — compare JITNames against level_reader binary when available.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { createRomFromBuffer, normalizeLevelId } = require('../lib/jit-levels/smw-rom');
const { extractJitNames } = require('../lib/jit-levels/jit-names');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function testVanillaExclusion() {
  const fakeRom = Buffer.alloc(0x800000, 0);
  const rom = createRomFromBuffer(fakeRom);
  const result = extractJitNames(rom);
  assert(Array.isArray(result.levels), 'expected levels array');
}

function testNormalizeLevelId() {
  assert(normalizeLevelId('0x109') === '109');
  assert(normalizeLevelId(0x001) === '001');
  assert(normalizeLevelId('invalid') === null);
}

function testAgainstLevelReaderIfPresent() {
  const readerPath = path.join(__dirname, '..', 'lmlevelnames', 'level_reader');
  const testRom = process.env.JIT_TEST_ROM;
  if (!fs.existsSync(readerPath) || !testRom || !fs.existsSync(testRom)) {
    console.log('Skipping level_reader parity (set JIT_TEST_ROM and build level_reader)');
    return;
  }

  const out = spawnSync(readerPath, [testRom], { encoding: 'utf8' });
  assert(out.status === 0, `level_reader failed: ${out.stderr}`);

  const rom = createRomFromBuffer(fs.readFileSync(testRom));
  const jsResult = extractJitNames(rom);
  const jsNames = new Map(jsResult.levels.map((l) => [l.levelnumber, l.levelname]));

  const matches = out.stdout.matchAll(/"([0-9A-F]{3})": "([^"]*)"/g);
  for (const m of matches) {
    const levelnumber = m[1];
    const name = m[2];
    if (name === '-' || !name.trim()) continue;
    assert(jsNames.has(levelnumber), `JS missing level ${levelnumber} from C reader`);
    assert(jsNames.get(levelnumber) === name, `Name mismatch for ${levelnumber}`);
  }
}

function main() {
  testVanillaExclusion();
  testNormalizeLevelId();
  testAgainstLevelReaderIfPresent();
  console.log('✅ test_jit_names passed');
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(`❌ test_jit_names failed: ${err.message}`);
    process.exit(1);
  }
}

module.exports = { main };
