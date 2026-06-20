#!/usr/bin/env node

/**
 * test_rom_mtdispatch_code.js
 *
 * Unit tests for MT. MTDispatch compatibility (lib/rom-mtdispatch-code.js).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  ROM_MTDISPATCH_SITE_OFFSET,
  JML_OPCODE,
  VANILLA_MTDISPATCH_CODE,
  buildMTDispatchFromRom,
  computeMTDispatchParamsFromRomPath,
  mappingsNeedMTDispatchParams,
  patchObjectsNeedMTDispatchParams,
} = require('../lib/rom-mtdispatch-code');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function makeRomBuffer({ header = false, siteByte = 0xad, jmlTarget = 0 }) {
  const headerSize = header ? 512 : 0;
  const minSize = headerSize + ROM_MTDISPATCH_SITE_OFFSET + 4;
  const buf = Buffer.alloc(Math.max(minSize, 32768), 0);
  buf[headerSize + ROM_MTDISPATCH_SITE_OFFSET] = siteByte;
  if (siteByte === JML_OPCODE) {
    buf[headerSize + ROM_MTDISPATCH_SITE_OFFSET + 1] = jmlTarget & 0xff;
    buf[headerSize + ROM_MTDISPATCH_SITE_OFFSET + 2] = (jmlTarget >> 8) & 0xff;
    buf[headerSize + ROM_MTDISPATCH_SITE_OFFSET + 3] = (jmlTarget >> 16) & 0xff;
  }
  return buf;
}

function testRelocatedJml() {
  const rom = makeRomBuffer({ siteByte: JML_OPCODE, jmlTarget: 0x00abcd });
  const result = buildMTDispatchFromRom(rom);
  assert(result.isRelocated === true, 'expected isRelocated true');
  assert(result.code.includes('JML $00ABCD'), `unexpected code: ${result.code}`);
  console.log('  ok relocated JML');
}

function testVanillaFallback() {
  const rom = makeRomBuffer({ siteByte: 0xad });
  const result = buildMTDispatchFromRom(rom);
  assert(result.isRelocated === false, 'expected isRelocated false');
  assert(result.code === VANILLA_MTDISPATCH_CODE, 'expected vanilla MTDispatch code');
  console.log('  ok vanilla fallback');
}

function testSmcHeaderSkip() {
  const total = 32768 + 512;
  const buf = Buffer.alloc(total, 0);
  const site = 512 + ROM_MTDISPATCH_SITE_OFFSET;
  buf[site] = JML_OPCODE;
  buf[site + 1] = 0x56;
  buf[site + 2] = 0x34;
  buf[site + 3] = 0x12;
  const result = buildMTDispatchFromRom(buf);
  assert(result.isRelocated === true, 'expected header-aware relocated detection');
  assert(result.code.includes('JML $123456'), `unexpected code: ${result.code}`);
  console.log('  ok SMC header skip');
}

function testComputeFromRomPath() {
  const tmpRom = path.join(os.tmpdir(), `mtdispatch-test-${process.pid}.sfc`);
  const rom = makeRomBuffer({ siteByte: 0xad });
  fs.writeFileSync(tmpRom, rom);
  try {
    const params = computeMTDispatchParamsFromRomPath(tmpRom);
    assert(params.mtdispatch_check === '0', 'expected check 0');
    assert(params.mtdispatch_code === VANILLA_MTDISPATCH_CODE, 'expected vanilla code in params');
  } finally {
    try {
      fs.unlinkSync(tmpRom);
    } catch {
      // ignore
    }
  }
  console.log('  ok computeMTDispatchParamsFromRomPath');
}

function testMappingsNeedScan() {
  const needs = mappingsNeedMTDispatchParams({
    dispatch_chain: { input: 'mtdispatch_code' },
    level_number: { input: 'glevelnum_s' },
  });
  assert(needs === true, 'expected mappings to need MTDispatch');

  const noNeed = mappingsNeedMTDispatchParams({
    level_number: { input: 'glevelnum_s' },
  });
  assert(noNeed === false, 'expected mappings without mtdispatch to skip');

  const legacy = mappingsNeedMTDispatchParams({
    mtdispatch_check: { output: '${check}' },
  });
  assert(legacy === true, 'expected legacy key format to need MTDispatch');

  const patches = patchObjectsNeedMTDispatchParams([
    { parameter_mappings: null },
    { parameter_mappings: '{"foo":{"input":"glevelnum"}}' },
    { parameter_mappings: '{"dispatch_code":{"input":"mtdispatch_code"}}' },
  ]);
  assert(patches === true, 'expected patchObjectsNeedMTDispatchParams true');

  const patchesNo = patchObjectsNeedMTDispatchParams([
    { parameter_mappings: '{"level_number":{"input":"glevelnum_s"}}' },
  ]);
  assert(patchesNo === false, 'expected patchObjectsNeedMTDispatchParams false');

  console.log('  ok mapping need scan');
}

function main() {
  console.log('test_rom_mtdispatch_code');
  testRelocatedJml();
  testVanillaFallback();
  testSmcHeaderSkip();
  testComputeFromRomPath();
  testMappingsNeedScan();
  console.log('✅ test_rom_mtdispatch_code passed');
}

main();
