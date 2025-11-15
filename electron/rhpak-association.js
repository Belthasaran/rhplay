const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
let WinReg = null;
if (process.platform === 'win32') {
  try {
    WinReg = require('winreg');
  } catch (error) {
    WinReg = null;
  }
}

function runCommand(command, args = []) {
  return new Promise((resolve, reject) => {
    const child = execFile(command, args, (error, stdout = '', stderr = '') => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
    child.stdin && child.stdin.end();
  });
}

function ensureDirectory(dirPath) {
  if (!dirPath) return;
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function escapeExeForCommand(exePath) {
  const normalized = exePath.replace(/"/g, '\\"');
  return `"${normalized}" "%1"`;
}

function ensureWindowsRegistryKey(keyPath) {
  return new Promise((resolve, reject) => {
    const key = new WinReg({
      hive: WinReg.HKCU,
      key: keyPath,
    });
    key.create((createErr) => {
      if (createErr) {
        reject(createErr);
      } else {
        resolve(key);
      }
    });
  });
}

async function setRegistryValue(keyPath, name, type, value) {
  const key = await ensureWindowsRegistryKey(keyPath);
  return new Promise((resolve, reject) => {
    key.set('"' + name + '"', type, value, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function getRegistryValue(keyPath, name) {
  return new Promise((resolve, reject) => {
    const key = new WinReg({
      hive: WinReg.HKCU,
      key: keyPath,
    });
    key.get('"' + name + '"', (err, item) => {
      if (err) {
        if (err.code === 1 || err.code === 'ERROR_FILE_NOT_FOUND') {
          resolve(null);
          return;
        }
        reject(err);
        return;
      }
      resolve(item ? item.value : null);
    });
  });
}

function deleteRegistryTree(keyPath) {
  return new Promise((resolve, reject) => {
    const key = new WinReg({
      hive: WinReg.HKCU,
      key: keyPath,
    });
    key.destroy((err) => {
      if (err) {
        if (err.code === 1 || err.code === 'ERROR_FILE_NOT_FOUND') {
          resolve();
          return;
        }
        reject(err);
        return;
      }
      resolve();
    });
  });
}

function deleteRegistryValue(keyPath, name) {
  return new Promise((resolve, reject) => {
    const key = new WinReg({
      hive: WinReg.HKCU,
      key: keyPath,
    });
    key.remove('"' + name + '"', (err) => {
      if (err && err.code !== 1 && err.code !== 'ERROR_FILE_NOT_FOUND') {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

function refreshWindowsShellAssociations() {
  const psScript = `
$sig = @"
using System;
using System.Runtime.InteropServices;
public static class ShellRefresh {
  [DllImport("shell32.dll")]
  public static extern void SHChangeNotify(int wEventId, int uFlags, IntPtr dwItem1, IntPtr dwItem2);
}
"@
Add-Type $sig | Out-Null
[ShellRefresh]::SHChangeNotify(0x08000000, 0, [IntPtr]::Zero, [IntPtr]::Zero)
`;
  return runCommand('powershell', ['-NoProfile', '-Command', psScript.trim()]);
}

async function ensureWindowsAssociation(exePath) {
  if (!WinReg) {
    return { success: false, error: 'winreg module unavailable on this platform.' };
  }
  const progId = 'rhtools.rhpak';
  const command = escapeExeForCommand(exePath);
  try {
    await setRegistryValue('\\Software\\Classes\\.rhpak', '', WinReg.REG_SZ, progId);
    await setRegistryValue('\\Software\\Classes\\.rhpak', 'Content Type', WinReg.REG_SZ, 'application/x-rhpak');
    await setRegistryValue('\\Software\\Classes\\.rhpak\\OpenWithProgids', progId, WinReg.REG_NONE, '');
    await setRegistryValue(`\\Software\\Classes\\${progId}`, '', WinReg.REG_SZ, 'RHPlay Package');
    await setRegistryValue(`\\Software\\Classes\\${progId}\\DefaultIcon`, '', WinReg.REG_SZ, `"${exePath}",0`);
    await setRegistryValue(`\\Software\\Classes\\${progId}\\shell`, '', WinReg.REG_SZ, 'open');
    await setRegistryValue(`\\Software\\Classes\\${progId}\\shell\\open`, '', WinReg.REG_SZ, 'Open');
    await setRegistryValue(`\\Software\\Classes\\${progId}\\shell\\open\\command`, '', WinReg.REG_SZ, command);
    await setRegistryValue(`\\Software\\Classes\\${progId}\\shell\\Open with RHPlay`, '', WinReg.REG_SZ, '&Open with RHPlay');
    await setRegistryValue(`\\Software\\Classes\\${progId}\\shell\\Open with RHPlay\\command`, '', WinReg.REG_SZ, command);
    try {
      await refreshWindowsShellAssociations();
    } catch (refreshError) {
      console.warn('[rhpak-association] Failed to refresh Explorer associations:', refreshError.message);
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function removeWindowsAssociation() {
  if (!WinReg) {
    return { success: false, error: 'winreg module unavailable on this platform.' };
  }
  const progId = 'rhtools.rhpak';
  try {
    const current = await getRegistryValue('\\Software\\Classes\\.rhpak', '');
    if (current && current.trim().toLowerCase() === progId) {
      await setRegistryValue('\\Software\\Classes\\.rhpak', '', WinReg.REG_SZ, '');
    }
    await deleteRegistryValue('\\Software\\Classes\\.rhpak\\OpenWithProgids', progId);
    await deleteRegistryTree(`\\Software\\Classes\\${progId}`);
    try {
      await refreshWindowsShellAssociations();
    } catch (refreshError) {
      console.warn('[rhpak-association] Failed to refresh Explorer associations:', refreshError.message);
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function ensureLinuxAssociation(exePath) {
  const desktopId = 'rhtools-rhpak.desktop';
  const userDataDir = require('electron').app.getPath('userData');
  const assocDir = path.join(userDataDir, 'file-associations');
  ensureDirectory(assocDir);
  const desktopPath = path.join(assocDir, desktopId);
  const mimePath = path.join(assocDir, 'rhtools-rhpak-mime.xml');
  const execLine = `"${exePath}" %f`;
  const iconCandidate = path.join(__dirname, '..', 'assets', 'icon.png');
  const desktopContent = `[Desktop Entry]
Type=Application
Name=RHPlay
Exec=${execLine}
Icon=${fs.existsSync(iconCandidate) ? iconCandidate : 'application-x-executable'}
MimeType=application/x-rhpak;
NoDisplay=false
Terminal=false
Categories=Game;
`;
  const mimeContent = `<mime-info xmlns="http://www.freedesktop.org/standards/shared-mime-info">
  <mime-type type="application/x-rhpak">
    <comment>RHPlay Package</comment>
    <glob pattern="*.rhpak"/>
  </mime-type>
</mime-info>
`;
  try {
    fs.writeFileSync(desktopPath, desktopContent, 'utf8');
    fs.chmodSync(desktopPath, 0o755);
    fs.writeFileSync(mimePath, mimeContent, 'utf8');
    await runCommand('xdg-mime', ['install', '--mode', 'user', mimePath]);
    await runCommand('xdg-desktop-menu', ['install', '--mode', 'user', desktopPath]);
    await runCommand('xdg-mime', ['default', desktopId, 'application/x-rhpak']);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function removeLinuxAssociation() {
  const userDataDir = require('electron').app.getPath('userData');
  const assocDir = path.join(userDataDir, 'file-associations');
  const desktopPath = path.join(assocDir, 'rhtools-rhpak.desktop');
  const mimePath = path.join(assocDir, 'rhtools-rhpak-mime.xml');
  try {
    if (fs.existsSync(mimePath)) {
      await runCommand('xdg-mime', ['uninstall', '--mode', 'user', mimePath]);
    }
    if (fs.existsSync(desktopPath)) {
      await runCommand('xdg-desktop-menu', ['uninstall', '--mode', 'user', desktopPath]);
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function getMacLsregisterPath() {
  const candidate = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';
  if (fs.existsSync(candidate)) {
    return candidate;
  }
  return null;
}

function getMacBundlePath() {
  const execPath = process.execPath;
  const appIndex = execPath.indexOf('.app/');
  if (appIndex === -1) {
    return null;
  }
  return execPath.slice(0, appIndex + 4);
}

async function ensureMacAssociation() {
  const lsregister = getMacLsregisterPath();
  const bundlePath = getMacBundlePath();
  if (!lsregister || !bundlePath) {
    return { success: false, error: 'Cannot determine lsregister or bundle path.' };
  }
  try {
    await runCommand(lsregister, ['-f', bundlePath]);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function removeMacAssociation() {
  const lsregister = getMacLsregisterPath();
  const bundlePath = getMacBundlePath();
  if (!lsregister || !bundlePath) {
    return { success: false, error: 'Cannot determine lsregister or bundle path.' };
  }
  try {
    await runCommand(lsregister, ['-u', bundlePath]);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function ensureRhpakAssociation(exePath) {
  if (process.platform === 'win32') {
    return ensureWindowsAssociation(exePath);
  }
  if (process.platform === 'linux') {
    return ensureLinuxAssociation(exePath);
  }
  if (process.platform === 'darwin') {
    return ensureMacAssociation(exePath);
  }
  return { success: false, error: `File associations are not supported on ${process.platform}` };
}

async function removeRhpakAssociation() {
  if (process.platform === 'win32') {
    return removeWindowsAssociation();
  }
  if (process.platform === 'linux') {
    return removeLinuxAssociation();
  }
  if (process.platform === 'darwin') {
    return removeMacAssociation();
  }
  return { success: true };
}

module.exports = {
  ensureRhpakAssociation,
  removeRhpakAssociation,
};

