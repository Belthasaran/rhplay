/**
 * emulator-install.js - Platform helpers to install RetroArch / libretro core.
 */

const { execSync, spawnSync } = require('child_process');

function isWingetAvailable() {
  if (process.platform !== 'win32') return false;
  try {
    execSync('where winget', { encoding: 'utf8', stdio: 'pipe', timeout: 10000 });
    return true;
  } catch {
    try {
      execSync('winget --version', { encoding: 'utf8', stdio: 'pipe', timeout: 10000 });
      return true;
    } catch {
      return false;
    }
  }
}

function getInstallCapabilities() {
  return {
    apt: process.platform === 'linux',
    winget: isWingetAvailable(),
  };
}

function installRetroarchLinux() {
  if (process.platform !== 'linux') {
    return { success: false, error: 'APT install is only available on Linux' };
  }
  try {
    execSync('pkexec apt install -y libretro-snes9x', {
      encoding: 'utf8',
      timeout: 600000,
      stdio: 'pipe',
    });
    return {
      success: true,
      message: 'Installed libretro-snes9x via APT. You may still need to install RetroArch separately.',
    };
  } catch (error) {
    if (error.status === 126 || error.status === 127) {
      return { success: false, error: 'pkexec is not available or permission was denied' };
    }
    if (error.status === 1) {
      return { success: false, error: 'Install was cancelled or failed' };
    }
    return { success: false, error: error.message || String(error) };
  }
}

function installRetroarchWindows() {
  if (process.platform !== 'win32') {
    return { success: false, error: 'Winget install is only available on Windows' };
  }
  if (!isWingetAvailable()) {
    return { success: false, error: 'winget is not available on this system' };
  }
  const innerCmd = 'winget install -e --id Libretro.RetroArch & pause';
  const psCommand = `Start-Process cmd.exe -Verb RunAs -Wait -ArgumentList '/c ${innerCmd.replace(/'/g, "''")}'`;
  try {
    const result = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psCommand],
      { encoding: 'utf8', timeout: 900000, stdio: 'pipe' }
    );
    if (result.error) {
      return { success: false, error: result.error.message };
    }
    if (result.status !== 0) {
      return {
        success: false,
        error: result.stderr?.trim() || result.stdout?.trim() || `Install exited with code ${result.status}`,
      };
    }
    return {
      success: true,
      message: 'RetroArch installed via winget. Install the SNES9x core manually in RetroArch Online Updater.',
    };
  } catch (error) {
    return { success: false, error: error.message || String(error) };
  }
}

function installRetroarch() {
  if (process.platform === 'linux') return installRetroarchLinux();
  if (process.platform === 'win32') return installRetroarchWindows();
  return { success: false, error: 'Install is not supported on this platform' };
}

module.exports = {
  isWingetAvailable,
  getInstallCapabilities,
  installRetroarchLinux,
  installRetroarchWindows,
  installRetroarch,
};
