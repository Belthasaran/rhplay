/**
 * emulator-paths.js - Detect common RetroArch / BizHawk install paths and build launch args.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const CORE_BASENAMES = ['bsnes_mercury_balanced_libretro', 'snes9x_libretro'];

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

function quoteArgIfNeeded(value) {
  if (!value) return value;
  return value.includes(' ') ? `"${value}"` : value;
}

function getBundledRetroarchAppImagePath(programDataDir) {
  if (!programDataDir) return '';
  return path.join(programDataDir, 'RetroArch-Linux-x86_64', 'RetroArch-Linux-x86_64.AppImage');
}

function getBundledRetroarchWindowsExe(programDataDir) {
  if (!programDataDir) return '';
  return path.join(programDataDir, 'RetroArch-Win64', 'retroarch.exe');
}

function retroarchExeCandidates(programDataDir = '') {
  const home = os.homedir();
  const bundled = [];
  if (process.platform === 'win32' && programDataDir) {
    bundled.push(getBundledRetroarchWindowsExe(programDataDir));
  }
  if (process.platform === 'linux' && programDataDir) {
    bundled.push(getBundledRetroarchAppImagePath(programDataDir));
  }

  if (process.platform === 'win32') {
    return [
      ...bundled,
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
    ...bundled,
    '/usr/bin/retroarch',
    '/usr/local/bin/retroarch',
    path.join(home, '.local', 'share', 'retroarch', 'retroarch'),
    path.join(home, '.local', 'bin', 'retroarch'),
  ];
}

function retroarchCoreCandidates(retroarchExe, programDataDir = '') {
  const ext = coreExtension();
  const bases = [];

  if (programDataDir) {
    if (process.platform === 'win32') {
      bases.push(path.join(programDataDir, 'RetroArch-Win64', 'cores'));
    }
    if (process.platform === 'linux') {
      const appImage = getBundledRetroarchAppImagePath(programDataDir);
      if (appImage) {
        bases.push(path.join(
          path.dirname(appImage),
          'RetroArch-Linux-x86_64.AppImage.home',
          '.config',
          'retroarch',
          'cores'
        ));
      }
    }
  }

  if (retroarchExe) {
    bases.push(path.join(path.dirname(retroarchExe), 'cores'));
    if (process.platform === 'win32') {
      bases.push(path.join(path.dirname(retroarchExe), '..', 'cores'));
    }
    if (process.platform === 'linux' && retroarchExe.endsWith('.AppImage')) {
      bases.push(path.join(
        path.dirname(retroarchExe),
        `${path.basename(retroarchExe)}.home`,
        '.config',
        'retroarch',
        'cores'
      ));
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
    for (const name of CORE_BASENAMES) {
      candidates.push(`/usr/lib/x86_64-linux-gnu/libretro/${name}${ext}`);
    }
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

function detectRetroarchPaths(existing = {}, programDataDir = '') {
  const retroarch_path = existing.retroarch_path && fileExists(existing.retroarch_path)
    ? existing.retroarch_path
    : firstExisting(retroarchExeCandidates(programDataDir));
  const retroarch_core_path = existing.retroarch_core_path && fileExists(existing.retroarch_core_path)
    ? existing.retroarch_core_path
    : firstExisting(retroarchCoreCandidates(retroarch_path, programDataDir));
  return { retroarch_path, retroarch_core_path };
}

function detectBizhawkPaths(existing = {}) {
  const bizhawk_path = existing.bizhawk_path && fileExists(existing.bizhawk_path)
    ? existing.bizhawk_path
    : firstExisting(bizhawkExeCandidates());
  return { bizhawk_path };
}

function detectEmulatorPaths(existing = {}, programDataDir = '') {
  return {
    ...detectRetroarchPaths(existing, programDataDir),
    ...detectBizhawkPaths(existing),
  };
}

function buildRetroarchLaunchArgs(corePath, appendConfigPath) {
  const parts = [];
  if (appendConfigPath) {
    parts.push(`--appendconfig ${quoteArgIfNeeded(appendConfigPath)}`);
  }
  if (corePath) {
    parts.push(`-L ${quoteArgIfNeeded(corePath)}`);
  } else if (!appendConfigPath) {
    return '-L %file';
  }
  parts.push('%file');
  return parts.join(' ');
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
  const programDataDir = ctx.programDataDir || '';
  let candidates = [];
  if (kind === 'retroarch_exe') {
    candidates = retroarchExeCandidates(programDataDir);
  } else if (kind === 'retroarch_core') {
    candidates = retroarchCoreCandidates(ctx.retroarch_path || '', programDataDir);
  } else if (kind === 'bizhawk_exe') {
    candidates = bizhawkExeCandidates();
  } else {
    throw new Error(`Unknown search kind: ${kind}`);
  }
  candidates = uniquePaths(candidates);
  const found = candidates.filter((p) => fileExists(p));
  return { found, candidates };
}

function applyPresetLaunchSettings(preset, paths = {}) {
  const programDataDir = paths.programDataDir || '';
  const appendConfigPath = paths.retroarch_append_config_path || '';

  if (preset === 'retroarch') {
    const detected = detectRetroarchPaths(paths, programDataDir);
    const retroarch_path = paths.retroarch_path || detected.retroarch_path;
    const retroarch_core_path = paths.retroarch_core_path || detected.retroarch_core_path;
    return {
      launchProgramPreset: 'retroarch',
      retroarch_path,
      retroarch_core_path,
      launchProgram: retroarch_path,
      launchProgramArgs: buildRetroarchLaunchArgs(retroarch_core_path, appendConfigPath),
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
  getBundledRetroarchAppImagePath,
  getBundledRetroarchWindowsExe,
};
