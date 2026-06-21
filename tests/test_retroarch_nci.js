#!/usr/bin/env node
'use strict';

const { formatNciCommand } = require('../lib/stage-autotest/retroarch-nci');
const { RETROPAD } = require('../lib/stage-autotest/retroarch-retropad');
const { mergeAppendConfigRetropad } = require('../lib/stage-autotest/append-config-merge');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function testNciCommandFormat() {
  assert(formatNciCommand('QUIT') === 'QUIT', 'bare command');
  assert(formatNciCommand('PAUSE_TOGGLE', '127.0.0.1') === 'PAUSE_TOGGLE;127.0.0.1', 'host only');
  assert(formatNciCommand('FRAMEADVANCE', '127.0.0.1', 55355) === 'FRAMEADVANCE;127.0.0.1;55355', 'host+port');
}

function testRetropadBitmask() {
  assert(RETROPAD.A === 256, 'A button bit');
  assert((RETROPAD.START | RETROPAD.A) === 264, 'start+A combo');
}

function testAppendMerge() {
  const merged = mergeAppendConfigRetropad('network_cmd_enable = "true"\n');
  assert(merged.includes('network_remote_enable'), 'adds retropad enable');
  assert(merged.includes('network_remote_base_port'), 'adds port');
}

function main() {
  testNciCommandFormat();
  testRetropadBitmask();
  testAppendMerge();
  console.log('✅ test_retroarch_nci passed');
}

main();
