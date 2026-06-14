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

assert(
  buildRetroarchLaunchArgs('C:\\RetroArch-Win64\\cores\\snes9x_libretro.dll').includes('-L'),
  'RetroArch args include -L flag'
);

assert(
  buildRetroarchLaunchArgs('C:\\RetroArch-Win64\\cores\\snes9x_libretro.dll').includes('snes9x_libretro.dll'),
  'RetroArch args include core path'
);

assert(
  buildRetroarchLaunchArgs('C:\\RetroArch-Win64\\cores\\snes9x_libretro.dll').includes('%file'),
  'RetroArch args include %file placeholder'
);

assert(
  buildBizhawkLaunchArgs() === '--open %file',
  'BizHawk args are --open %file'
);

const retroPreset = applyPresetLaunchSettings('retroarch', {
  retroarch_path: 'C:\\RetroArch-Win64\\retroarch.exe',
  retroarch_core_path: 'C:\\RetroArch-Win64\\cores\\snes9x_libretro.dll',
});
assert(retroPreset.launchProgramPreset === 'retroarch', 'RetroArch preset id');
assert(retroPreset.launchProgram === 'C:\\RetroArch-Win64\\retroarch.exe', 'RetroArch launch program');
assert(retroPreset.launchProgramArgs.includes('-L'), 'RetroArch preset launch args');

const bizPreset = applyPresetLaunchSettings('bizhawk', {
  bizhawk_path: 'C:\\Program Files\\BizHawk\\EmuHawk.exe',
});
assert(bizPreset.launchProgramPreset === 'bizhawk', 'BizHawk preset id');
assert(bizPreset.launchProgramArgs === '--open %file', 'BizHawk preset launch args');

assert(Array.isArray(retroarchExeCandidates()) && retroarchExeCandidates().length > 0, 'RetroArch exe candidates non-empty');
assert(Array.isArray(retroarchCoreCandidates('C:\\RetroArch-Win64\\retroarch.exe')), 'Core candidates from exe dir');

if (process.platform === 'linux') {
  const coreCandidates = retroarchCoreCandidates('');
  assert(
    coreCandidates.includes('/usr/lib/x86_64-linux-gnu/libretro/snes9x_libretro.so'),
    'Ubuntu libretro core path in candidates'
  );
}

const searchResult = searchPaths('retroarch_exe');
assert(Array.isArray(searchResult.found), 'searchPaths returns found array');
assert(Array.isArray(searchResult.candidates), 'searchPaths returns candidates array');
assert(searchResult.candidates.length >= searchResult.found.length, 'candidates includes all found paths');

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
