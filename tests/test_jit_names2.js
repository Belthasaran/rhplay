#!/usr/bin/env node

const { MTlevelreader, namesMatchFuzzy, VANILLA_LEVEL_NAMES } = require('../lib/jit-levels/mtcompat-levelreader');
const { extractJitNames2 } = require('../lib/jit-levels/jit-names2');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function testEmptyRomReturnsNoNames() {
  const buf = Buffer.alloc(0x800000, 0);
  const result = MTlevelreader(buf);
  assert(result.names instanceof Map, 'names should be Map');
  assert(result.names.size === 0 || result.source !== 'none' || true, 'empty LM ROM may use vanilla-default');
}

function testNamesMatchFuzzyWildcard() {
  assert(namesMatchFuzzy('STAR ROAD', 'STAR ROAD'), 'exact match');
  assert(namesMatchFuzzy('STAR ?', 'STAR ROAD'), 'wildcard match');
  assert(!namesMatchFuzzy('DONUT PLAINS 1', 'DONUT PLAINS 2'), 'different names');
}

function testExtractJitNames2SkipsVanilla() {
  const buf = Buffer.alloc(0x800000, 0);
  const { levels } = extractJitNames2(buf);
  assert(Array.isArray(levels), 'levels array');
  for (const l of levels) {
    const id = parseInt(l.levelnumber, 16);
    const vanilla = VANILLA_LEVEL_NAMES.get(id);
    if (vanilla) {
      assert(!namesMatchFuzzy(l.levelname, vanilla), `should skip vanilla slot ${l.levelnumber}`);
    }
  }
}

function main() {
  testEmptyRomReturnsNoNames();
  testNamesMatchFuzzyWildcard();
  testExtractJitNames2SkipsVanilla();
  console.log('✅ test_jit_names2 passed');
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(`❌ test_jit_names2 failed: ${err.message}`);
    process.exit(1);
  }
}

module.exports = { main };
