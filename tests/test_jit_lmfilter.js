#!/usr/bin/env node

/**
 * test_jit_lmfilter.js — JIT.LMFilter parsing and catalog resolution
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  levelsFromHexList,
  parseMwlLevelIdsFromDirectory,
  resolveFromCatalog,
} = require('../lib/jit-levels/jit-lmfilter');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function testLevelsFromHexList() {
  const levels = levelsFromHexList(['109', '0x10A', '1D3']);
  assert(levels.length === 3, 'expected 3 levels');
  assert(levels[0].levelnumber === '109');
  assert(levels[1].levelnumber === '10A');
  assert(levels[2].levelnumber === '1D3');
  assert(levels.every((l) => l.sources.includes('jitlmfilter')));
}

function testParseMwlFilenames() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jit-lmfilter-'));
  const levelsDir = path.join(tmp, 'resources', 'levels');
  fs.mkdirSync(levelsDir, { recursive: true });
  fs.writeFileSync(path.join(levelsDir, 'level 1D3.mwl'), 'stub');
  fs.writeFileSync(path.join(levelsDir, 'level 010.mwl'), 'stub');
  fs.writeFileSync(path.join(levelsDir, 'readme.txt'), 'skip');

  const parsed = parseMwlLevelIdsFromDirectory(levelsDir);
  assert(parsed.length === 2, 'expected 2 MWL levels');
  const ids = parsed.map((p) => p.levelnumber).sort();
  assert(ids[0] === '010' && ids[1] === '1D3');

  fs.rmSync(tmp, { recursive: true, force: true });
}

function testResolveFromCatalogBySha1() {
  const catalogDir = path.join(__dirname, '..', 'jstools', 'smwc_world', 'bpsindex');
  const sample = path.join(catalogDir, '22ca74e712209d22ce5babe6c4f9ba193a92d353.json');
  if (!fs.existsSync(sample)) {
    console.log('Skipping catalog SHA1 test (sample index missing)');
    return;
  }

  const levels = resolveFromCatalog(catalogDir, {
    patchedRomSha1: '22ca74e712209d22ce5babe6c4f9ba193a92d353',
  });
  assert(levels.length > 0, 'expected lmfilter levels from catalog SHA1 file');
  assert(levels.some((l) => l.levelnumber === '106'));
}

function main() {
  testLevelsFromHexList();
  testParseMwlFilenames();
  testResolveFromCatalogBySha1();
  console.log('✅ test_jit_lmfilter passed');
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(`❌ test_jit_lmfilter failed: ${err.message}`);
    process.exit(1);
  }
}

module.exports = { main };
