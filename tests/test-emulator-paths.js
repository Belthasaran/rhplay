#!/usr/bin/env node

/**
 * test-emulator-paths.js - Tests for lib/emulator-paths.js
 * Run: node tests/test-emulator-paths.js
 */

const {
  buildRetroarchLaunchArgs,
  buildBizhawkLaunchArgs,
  applyPresetLaunchSettings,
  retroarchExeCandidates,
  retroarchCoreCandidates,
  searchPaths,
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
const linuxExeCandidates = retroarchExeCandidates(programDataDir);
assert(
  linuxExeCandidates[0] === '/home/user/.config/rhtools/RetroArch-Linux-x86_64/RetroArch-Linux-x86_64.AppImage' ||
    process.platform !== 'linux',
  'Linux program-data AppImage is first candidate when on Linux'
);

const winExeCandidates = retroarchExeCandidates('C:\\Users\\test\\AppData\\Roaming\\rhtools');
if (process.platform === 'win32') {
  assert(
    winExeCandidates[0].includes('RetroArch-Win64\\retroarch.exe'),
    'Windows program-data retroarch.exe is first candidate'
  );
}

const coreCandidates = retroarchCoreCandidates(
  '/home/user/.config/rhtools/RetroArch-Linux-x86_64/RetroArch-Linux-x86_64.AppImage',
  programDataDir
);
assert(
  coreCandidates[0].includes('bsnes_mercury_balanced_libretro'),
  'bsnes core is searched before snes9x in candidate list'
);

if (process.platform === 'linux') {
  const coreCandidatesNoExe = retroarchCoreCandidates('', programDataDir);
  assert(
    coreCandidatesNoExe.includes('/usr/lib/x86_64-linux-gnu/libretro/snes9x_libretro.so'),
    'Ubuntu libretro core path in candidates'
  );
}

const searchResult = searchPaths('retroarch_exe', { programDataDir });
assert(Array.isArray(searchResult.found), 'searchPaths returns found array');
assert(Array.isArray(searchResult.candidates), 'searchPaths returns candidates array');
assert(searchResult.candidates.length >= searchResult.found.length, 'candidates includes all found paths');

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
