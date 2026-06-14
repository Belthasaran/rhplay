/**
 * rhpak-storage.js - Copy/move installed RHPAK archives under userData
 */

const fs = require('fs');
const path = require('path');
const {
  ensureDirectory,
  getRhpakInstalledDir,
  getRhpakRemovedDir
} = require('./patch-resolver-paths');

function installedRhpakPath(userDataPath, rhpakuuid) {
  const dir = getRhpakInstalledDir({ userDataPath });
  if (!dir || !rhpakuuid) return null;
  return path.join(dir, `${rhpakuuid}.rhpak`);
}

function copyRhpakToInstalled(packageAbs, rhpakuuid, userDataPath) {
  if (!packageAbs || !rhpakuuid || !userDataPath) return null;
  if (!fs.existsSync(packageAbs)) {
    throw new Error(`RHPAK package not found: ${packageAbs}`);
  }
  const dir = getRhpakInstalledDir({ userDataPath });
  ensureDirectory(dir);
  const dest = path.join(dir, `${rhpakuuid}.rhpak`);
  fs.copyFileSync(packageAbs, dest);
  return dest;
}

function moveInstalledRhpakToRemoved(rhpakuuid, userDataPath) {
  if (!rhpakuuid || !userDataPath) return null;
  const installedDir = getRhpakInstalledDir({ userDataPath });
  const removedDir = getRhpakRemovedDir({ userDataPath });
  ensureDirectory(removedDir);
  const src = path.join(installedDir, `${rhpakuuid}.rhpak`);
  if (!fs.existsSync(src)) {
    return null;
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(removedDir, `${rhpakuuid}_${stamp}.rhpak`);
  fs.renameSync(src, dest);
  return dest;
}

function findInstalledRhpakPath(ctx, rhpakuuid) {
  const userDataPath = ctx && ctx.userDataPath;
  if (!userDataPath || !rhpakuuid) return null;
  const candidate = installedRhpakPath(userDataPath, rhpakuuid);
  if (candidate && fs.existsSync(candidate)) {
    return candidate;
  }
  return null;
}

module.exports = {
  installedRhpakPath,
  copyRhpakToInstalled,
  moveInstalledRhpakToRemoved,
  findInstalledRhpakPath
};
