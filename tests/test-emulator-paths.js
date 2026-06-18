#!/usr/bin/env node

/**
 * test-emulator-paths.js - Tests for lib/emulator-paths.js
 * Run: node tests/test-emulator-paths.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  buildRetroarchLaunchArgs,
  buildBizhawkLaunchArgs,
  applyPresetLaunchSettings,
  retroarchExeCandidates,
  retroarchCoreCandidates,
  searchPaths,
  linuxRetroarchAppImageCandidates,
  appImageHomeCoreDir,
  getBundledRetroarchAppImagePath,
} = require('../lib/emulator-paths');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) {
    failed += 1;
    console.error(`✗ ${message}`);
    return false;
  }
  passed += 1;
  console.log(`✓ ${message}`);
  return true;
}

const appendPath = '/tmp/rhtools/retroarch/append.cfg';
const corePath = 'C:\\RetroArch-Win64\\cores\\bsnes_mercury_balanced_libretro.dll';

assert(
  buildRetroarchLaunchArgs(corePath, appendPath).includes('--appendconfig'),
  'RetroArch args include --appendconfig'
);

assert(
  buildRetroarchLaunchArgs(corePath, appendPath).includes('-L'),
  'RetroArch args include -L flag'
);

assert(
  buildRetroarchLaunchArgs(corePath, appendPath).includes('bsnes_mercury_balanced_libretro.dll'),
  'RetroArch args include core path'
);

assert(
  buildRetroarchLaunchArgs(corePath, appendPath).includes('%file'),
  'RetroArch args include %file placeholder'
);

assert(
  buildBizhawkLaunchArgs() === '--open %file',
  'BizHawk args are --open %file'
);

const retroPreset = applyPresetLaunchSettings('retroarch', {
  retroarch_path: 'C:\\RetroArch-Win64\\retroarch.exe',
  retroarch_core_path: corePath,
  retroarch_append_config_path: appendPath,
});
assert(retroPreset.launchProgramPreset === 'retroarch', 'RetroArch preset id');
assert(retroPreset.launchProgram === 'C:\\RetroArch-Win64\\retroarch.exe', 'RetroArch launch program');
assert(retroPreset.launchProgramArgs.includes('--appendconfig'), 'RetroArch preset includes appendconfig');
assert(retroPreset.launchProgramArgs.includes('-L'), 'RetroArch preset launch args');

const bizPreset = applyPresetLaunchSettings('bizhawk', {
  bizhawk_path: 'C:\\Program Files\\BizHawk\\EmuHawk.exe',
});
assert(bizPreset.launchProgramPreset === 'bizhawk', 'BizHawk preset id');
assert(bizPreset.launchProgramArgs === '--open %file', 'BizHawk preset launch args');

const programDataDir = '/home/user/.config/rhtools';
const flatAppImage = path.join(programDataDir, 'RetroArch-Linux-x86_64.AppImage');
const nestedAppImage = path.join(programDataDir, 'RetroArch-Linux-x86_64', 'RetroArch-Linux-x86_64.AppImage');

const appImageCandidates = linuxRetroarchAppImageCandidates(programDataDir);
assert(
  appImageCandidates[0] === flatAppImage,
  'linuxRetroarchAppImageCandidates: flat layout is first'
);
assert(
  appImageCandidates[1] === nestedAppImage,
  'linuxRetroarchAppImageCandidates: nested tarball layout is second'
);
assert(
  getBundledRetroarchAppImagePath(programDataDir) === flatAppImage,
  'getBundledRetroarchAppImagePath returns flat layout path'
);

const flatHomeCoreDir = appImageHomeCoreDir(flatAppImage);
assert(
  flatHomeCoreDir === path.join(programDataDir, 'RetroArch-Linux-x86_64.AppImage.home', '.config', 'retroarch', 'cores'),
  'appImageHomeCoreDir derives .home core directory from AppImage basename'
);

const linuxExeCandidates = retroarchExeCandidates(programDataDir);
if (process.platform === 'linux') {
  assert(
    linuxExeCandidates[0] === flatAppImage,
    'Linux program-data flat AppImage is first exe candidate'
  );
  assert(
    linuxExeCandidates[1] === nestedAppImage,
    'Linux program-data nested AppImage is second exe candidate'
  );
}

const winExeCandidates = retroarchExeCandidates('C:\\Users\\test\\AppData\\Roaming\\rhtools');
if (process.platform === 'win32') {
  assert(
    winExeCandidates[0].includes('RetroArch-Win64\\retroarch.exe'),
    'Windows program-data retroarch.exe is first candidate'
  );
}

const coreCandidates = retroarchCoreCandidates(flatAppImage, programDataDir);
assert(
  coreCandidates[0].includes('bsnes_mercury_balanced_libretro'),
  'bsnes core is searched before snes9x in candidate list'
);
assert(
  coreCandidates[0].includes('RetroArch-Linux-x86_64.AppImage.home'),
  'flat AppImage .home core path is first core candidate'
);

if (process.platform === 'linux') {
  const coreCandidatesNoExe = retroarchCoreCandidates('', programDataDir);
  const flatBsnesCore = path.join(flatHomeCoreDir, 'bsnes_mercury_balanced_libretro.so');
  const ubuntuSnes9x = '/usr/lib/x86_64-linux-gnu/libretro/snes9x_libretro.so';
  assert(
    coreCandidatesNoExe.includes(flatBsnesCore),
    'program-data flat .home bsnes core in candidates without retroarch exe'
  );
  assert(
    coreCandidatesNoExe.indexOf(flatBsnesCore) < coreCandidatesNoExe.indexOf(ubuntuSnes9x),
    'program-data core candidates precede Ubuntu system libretro paths'
  );
  assert(
    coreCandidatesNoExe.includes(ubuntuSnes9x),
    'Ubuntu libretro core path in candidates'
  );
}

const searchResult = searchPaths('retroarch_exe', { programDataDir });
assert(Array.isArray(searchResult.found), 'searchPaths returns found array');
assert(Array.isArray(searchResult.candidates), 'searchPaths returns candidates array');
assert(searchResult.candidates.length >= searchResult.found.length, 'candidates includes all found paths');

if (process.platform === 'linux') {
  const tempProgramData = fs.mkdtempSync(path.join(os.tmpdir(), 'rhtools-emulator-test-'));
  const tempAppImage = path.join(tempProgramData, 'RetroArch-Linux-x86_64.AppImage');
  fs.writeFileSync(tempAppImage, '#!/bin/sh\necho test\n', { mode: 0o755 });
  try {
    const tempSearch = searchPaths('retroarch_exe', { programDataDir: tempProgramData });
    assert(
      tempSearch.found.includes(tempAppImage),
      'searchPaths finds flat program-data AppImage when file exists'
    );
    assert(
      tempSearch.found.indexOf(tempAppImage) === 0,
      'searchPaths lists flat program-data AppImage before system paths'
    );

    const tempCoreDir = appImageHomeCoreDir(tempAppImage);
    fs.mkdirSync(tempCoreDir, { recursive: true });
    const tempCore = path.join(tempCoreDir, 'bsnes_mercury_balanced_libretro.so');
    fs.writeFileSync(tempCore, 'mock-core');
    const tempCoreSearch = searchPaths('retroarch_core', { programDataDir: tempProgramData });
    assert(
      tempCoreSearch.found.includes(tempCore),
      'searchPaths finds program-data AppImage .home core when file exists'
    );
  } finally {
    fs.rmSync(tempProgramData, { recursive: true, force: true });
  }
}

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
