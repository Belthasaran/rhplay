#!/usr/bin/env node

const assert = require('assert');
const {
  resolveAppfilesManifestView,
  summarizeAppfilesManifest,
  inspectDatabases,
  buildPlan
} = require('../electron/installer/prepare_databases');

const unifiedAppfiles = {
  type: 'appfiles',
  version: '1',
  base: {
    file_name: 'patchtools.tar.xz',
    install_files: ['flips.exe'],
    sha256: 'abc'
  }
};

const platformAppfiles = {
  type: 'appfiles',
  version: '2',
  base: { install_files: [] },
  'base:linux64': {
    file_name: 'retroarch-linux64.tar.xz',
    format: 'tar+xz',
    sha256: 'linux-sha',
    install_files: ['RetroArch.AppImage']
  },
  'base:win64': {
    file_name: 'retroarch-win64.tar.xz',
    install_files: ['RetroArch-Win64/*']
  }
};

function testResolveUnified() {
  const view = resolveAppfilesManifestView(unifiedAppfiles, 'linux64');
  assert.strictEqual(view.applicable, true);
  assert.strictEqual(view.base.file_name, 'patchtools.tar.xz');
}

function testResolvePlatformBase() {
  const view = resolveAppfilesManifestView(platformAppfiles, 'linux64');
  assert.strictEqual(view.applicable, true);
  assert.strictEqual(view.base.file_name, 'retroarch-linux64.tar.xz');
  assert.deepStrictEqual(view.base.install_files, ['RetroArch.AppImage']);
}

function testSkipWrongPlatform() {
  const entry = {
    type: 'appfiles',
    platform: 'win64',
    base: { file_name: 'x.tar.xz', install_files: ['a'] }
  };
  const view = resolveAppfilesManifestView(entry, 'linux64');
  assert.strictEqual(view.applicable, false);
  assert.match(view.reason, /win64 only/);
}

function testInspectAndPlan(tmpDir) {
  const manifest = {
    greetings: { message: 'hi' },
    'retroarch_deploy.txt': platformAppfiles
  };
  const status = inspectDatabases({
    userDataDir: tmpDir,
    overwrite: new Set(),
    dbChain: 'full'
  }, manifest);
  const retro = status.find((d) => d.name === 'retroarch_deploy.txt');
  assert.ok(retro);
  assert.strictEqual(retro.action, 'provision-appfiles');
  assert.strictEqual(retro.manifestSummary.base.file_name, 'retroarch-linux64.tar.xz');

  const plan = buildPlan({ provision: false, dbChain: 'full' }, status);
  assert.strictEqual(plan.downloads.length, 1);
  assert.strictEqual(plan.downloads[0].database, 'retroarch_deploy.txt');
}

testResolveUnified();
testResolvePlatformBase();
testSkipWrongPlatform();
testInspectAndPlan(require('fs').mkdtempSync(require('path').join(__dirname, 'test_data', 'appfiles_')));
console.log('✓ prepare_databases appfiles platform resolution');
