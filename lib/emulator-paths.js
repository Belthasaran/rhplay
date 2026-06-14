/**
 * emulator-paths.js - Detect common RetroArch / BizHawk install paths and build launch args.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const CORE_BASENAMES = ['snes9x_libretro'];

function fileExists(p) {
  try {
    return p && fs.existsSync(p);
  } catch {
    return false;
  }
}

function coreExtension() {
  if (process.platform === 'win32') return '.dll';
  if (process.platform === 'darwin') return '.dylib';
  return '.so';
}

function retroarchExeCandidates() {
  const home = os.homedir();
  if (process.platform === 'win32') {
    return [
      'C:\\RetroArch-Win64\\retroarch.exe',
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'RetroArch', 'retroarch.exe'),
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'RetroArch', 'retroarch.exe'),
      path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'RetroArch', 'retroarch.exe'),
    ];
  }
  if (process.platform === 'darwin') {
    return [
      '/Applications/RetroArch.app/Contents/MacOS/RetroArch',
      path.join(home, 'Applications', 'RetroArch.app', 'Contents', 'MacOS', 'RetroArch'),
    ];
  }
  return [
    '/usr/bin/retroarch',
    '/usr/local/bin/retroarch',
    path.join(home, '.local', 'share', 'retroarch', 'retroarch'),
    path.join(home, '.local', 'bin', 'retroarch'),
  ];
}

function retroarchCoreCandidates(retroarchExe) {
  const ext = coreExtension();
  const bases = [];
  if (retroarchExe) {
    bases.push(path.join(path.dirname(retroarchExe), 'cores'));
    if (process.platform === 'win32') {
      bases.push(path.join(path.dirname(retroarchExe), '..', 'cores'));
    }
  }
  if (process.platform === 'win32') {
    bases.push('C:\\RetroArch-Win64\\cores');
  }
  const home = os.homedir();
  if (process.platform === 'linux') {
    bases.push(path.join(home, '.config', 'retroarch', 'cores'));
    bases.push('/usr/lib/libretro');
  }
  if (process.platform === 'darwin') {
    bases.push(path.join(home, 'Library', 'Application Support', 'RetroArch', 'cores'));
  }

  const candidates = [];
  for (const base of bases) {
    for (const name of CORE_BASENAMES) {
      candidates.push(path.join(base, `${name}${ext}`));
    }
  }
  if (process.platform === 'linux') {
    candidates.push('/usr/lib/x86_64-linux-gnu/libretro/snes9x_libretro.so');
  }
  return candidates;
}

function bizhawkExeCandidates() {
  const home = os.homedir();
  if (process.platform === 'win32') {
    return [
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'BizHawk', 'EmuHawk.exe'),
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'BizHawk', 'EmuHawk.exe'),
      'C:\\BizHawk\\EmuHawk.exe',
      path.join(home, 'BizHawk', 'EmuHawk.exe'),
    ];
  }
  if (process.platform === 'darwin') {
    return [
      '/Applications/BizHawk.app/Contents/MacOS/EmuHawk',
    ];
  }
  return [
    path.join(home, '.local', 'share', 'bizhawk', 'EmuHawk'),
    path.join(home, 'BizHawk', 'EmuHawk'),
    '/usr/local/bin/EmuHawk',
  ];
}

function firstExisting(candidates) {
  for (const p of candidates) {
    if (fileExists(p)) return p;
  }
  return '';
}

function detectRetroarchPaths(existing = {}) {
  const retroarch_path = existing.retroarch_path && fileExists(existing.retroarch_path)
    ? existing.retroarch_path
    : firstExisting(retroarchExeCandidates());
  const retroarch_core_path = existing.retroarch_core_path && fileExists(existing.retroarch_core_path)
    ? existing.retroarch_core_path
    : firstExisting(retroarchCoreCandidates(retroarch_path));
  return { retroarch_path, retroarch_core_path };
}

function detectBizhawkPaths(existing = {}) {
  const bizhawk_path = existing.bizhawk_path && fileExists(existing.bizhawk_path)
    ? existing.bizhawk_path
    : firstExisting(bizhawkExeCandidates());
  return { bizhawk_path };
}

function detectEmulatorPaths(existing = {}) {
  return {
    ...detectRetroarchPaths(existing),
    ...detectBizhawkPaths(existing),
  };
}

function buildRetroarchLaunchArgs(corePath) {
  if (!corePath) return '-L %file';
  const quoted = corePath.includes(' ') ? `"${corePath}"` : corePath;
  return `-L ${quoted} %file`;
}

function buildBizhawkLaunchArgs() {
  return '--open %file';
}

function uniquePaths(list) {
  const seen = new Set();
  const out = [];
  for (const p of list) {
    if (!p || seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}

function searchPaths(kind, ctx = {}) {
  let candidates = [];
  if (kind === 'retroarch_exe') {
    candidates = retroarchExeCandidates();
  } else if (kind === 'retroarch_core') {
    candidates = retroarchCoreCandidates(ctx.retroarch_path || '');
  } else if (kind === 'bizhawk_exe') {
    candidates = bizhawkExeCandidates();
  } else {
    throw new Error(`Unknown search kind: ${kind}`);
  }
  candidates = uniquePaths(candidates);
  const found = candidates.filter((p) => fileExists(p));
  return { found, candidates };
}

function applyPresetLaunchSettings(preset, paths) {
  if (preset === 'retroarch') {
    const detected = detectRetroarchPaths(paths);
    const retroarch_path = paths.retroarch_path || detected.retroarch_path;
    const retroarch_core_path = paths.retroarch_core_path || detected.retroarch_core_path;
    return {
      launchProgramPreset: 'retroarch',
      retroarch_path,
      retroarch_core_path,
      launchProgram: retroarch_path,
      launchProgramArgs: buildRetroarchLaunchArgs(retroarch_core_path),
    };
  }
  if (preset === 'bizhawk') {
    const detected = detectBizhawkPaths(paths);
    const bizhawk_path = paths.bizhawk_path || detected.bizhawk_path;
    return {
      launchProgramPreset: 'bizhawk',
      bizhawk_path,
      launchProgram: bizhawk_path,
      launchProgramArgs: buildBizhawkLaunchArgs(),
    };
  }
  return {
    launchProgramPreset: 'other',
    launchProgram: paths.launchProgram || '',
    launchProgramArgs: paths.launchProgramArgs || '%file',
  };
}

module.exports = {
  detectEmulatorPaths,
  detectRetroarchPaths,
  detectBizhawkPaths,
  buildRetroarchLaunchArgs,
  buildBizhawkLaunchArgs,
  applyPresetLaunchSettings,
  retroarchExeCandidates,
  retroarchCoreCandidates,
  bizhawkExeCandidates,
  searchPaths,
};
