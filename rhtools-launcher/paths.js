/**
 * Resolve repo `electron/` and `lib/` for dev (rhtools-launcher next to electron) vs packaged app.
 */

const fs = require('fs');
const path = require('path');

function getElectronRoot() {
  const devPath = path.join(__dirname, '..', 'electron');
  if (fs.existsSync(devPath)) {
    return devPath;
  }
  const packaged = path.join(__dirname, 'electron');
  if (fs.existsSync(packaged)) {
    return packaged;
  }
  return devPath;
}

function getRepoRoot() {
  return path.join(getElectronRoot(), '..');
}

module.exports = {
  getElectronRoot,
  getRepoRoot
};
