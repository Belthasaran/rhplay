#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadConfig, saveConfig, getConfigPath, DEFAULT_CONFIG } = require('../lib/stage-autotest/config');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function testDefaultConfigCreation() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sat-cfg-'));
  const cfg = loadConfig(tmp);
  assert(cfg.backend === 'retroarch', 'default backend');
  assert(fs.existsSync(getConfigPath(tmp)), 'config file created');
  assert(cfg.logging.logDir.includes('stage-autotest/logs'), 'log dir expanded');
}

function testConfigMergeOverride() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sat-cfg-'));
  saveConfig(tmp, { ...DEFAULT_CONFIG, headless: true, backend: 'bizhawk' });
  const cfg = loadConfig(tmp, { timeoutsSec: { boot: 99 } });
  assert(cfg.headless === true, 'headless preserved');
  assert(cfg.timeoutsSec.boot === 99, 'override merged');
}

function testConfigPathResolution() {
  const tmp = '/tmp/sat-userdata-test';
  const p = getConfigPath(tmp);
  assert(p.endsWith('stage-autotest/tester_config.json'), 'config path suffix');
}

function testUsb2snesConnectOptions() {
  const { buildUsb2snesConnectOptions } = require('../lib/stage-autotest/utils');
  const fromApp = buildUsb2snesConnectOptions(
    { usb2snesLibrary: 'usb2snes_a', usb2snesAddress: 'ws://localhost:64213', usb2snesHostingMethod: 'external' },
    { library: 'qusb2snes', wsAddress: 'ws://localhost:23074', autoStart: true }
  );
  assert(fromApp.library === 'usb2snes_a', 'app settings override config library');
  assert(fromApp.address === 'ws://localhost:64213', 'external hosting keeps user address');
  assert(fromApp.hostingMethod === 'external', 'preserve hosting method from settings');

  const sniMode = buildUsb2snesConnectOptions(
    { usb2snesLibrary: 'usb2snes_a', usb2snesHostingMethod: 'sni' },
    { wsAddress: 'ws://localhost:23074', autoStart: true }
  );
  assert(sniMode.address === 'ws://localhost:23074', 'SNI hosting uses SNI ws address');

  const fallback = buildUsb2snesConnectOptions({}, { library: 'usb2snes_a', wsAddress: 'ws://localhost:23074' });
  assert(fallback.library === 'usb2snes_a', 'fallback library');
}

function main() {
  testDefaultConfigCreation();
  testConfigMergeOverride();
  testConfigPathResolution();
  testUsb2snesConnectOptions();
  console.log('✅ test_stage_autotest_config passed');
}

main();
