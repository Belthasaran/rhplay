#!/usr/bin/env node

const { extractJitMtIncluded } = require('../lib/jit-levels/mtcompat-levelreader');
const { extractJitMt } = require('../lib/jit-levels/jit-mt');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function testExtractJitMtShape() {
  const buf = Buffer.alloc(0x800000, 0);
  const { levels } = extractJitMt(buf);
  assert(Array.isArray(levels), 'levels array');
  for (const l of levels) {
    assert(l.sources.includes('jitmt'), 'jitmt source tag');
    assert(l.mtIncluded === true, 'mtIncluded true');
    assert(typeof l.levelnumber === 'string', 'levelnumber string');
  }
}

function testExtractJitMtIncludedReturnsLevelsArray() {
  const buf = Buffer.alloc(0x800000, 0);
  const result = extractJitMtIncluded(buf);
  assert(Array.isArray(result.levels), 'levels in result');
  assert(typeof result.source === 'string', 'source id');
}

function testIncludedLevelsHaveCodes() {
  const buf = Buffer.alloc(0x800000, 0);
  const result = extractJitMtIncluded(buf);
  for (const entry of result.levels) {
    assert(/^[0-9A-F]{2,3}$/.test(entry.code), `valid hex code ${entry.code}`);
    assert(typeof entry.isPipe === 'boolean', 'isPipe boolean');
    assert(typeof entry.isVanillaName === 'boolean', 'isVanillaName boolean');
  }
}

function main() {
  testExtractJitMtShape();
  testExtractJitMtIncludedReturnsLevelsArray();
  testIncludedLevelsHaveCodes();
  console.log('✅ test_jit_mt passed');
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(`❌ test_jit_mt failed: ${err.message}`);
    process.exit(1);
  }
}

module.exports = { main };
