#!/usr/bin/env node
/**
 * Run `electron-builder install-app-deps` with cwd = rhtools-launcher.
 * Avoids `cd dir && ../node_modules/.bin/...` which breaks on Windows cmd.exe
 * (e.g. `'..' is not recognized as an internal or external command`).
 */
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const rootDir = path.join(__dirname, '..');
const launcherDir = path.join(rootDir, 'rhtools-launcher');
const cliJs = path.join(rootDir, 'node_modules', 'electron-builder', 'cli.js');

if (!fs.existsSync(launcherDir)) {
  console.error('[launcher-install-app-deps] Missing directory:', launcherDir);
  process.exit(1);
}
if (!fs.existsSync(cliJs)) {
  console.error('[launcher-install-app-deps] electron-builder not found. Run npm install at repo root:', cliJs);
  process.exit(1);
}

const r = spawnSync(process.execPath, [cliJs, 'install-app-deps'], {
  cwd: launcherDir,
  stdio: 'inherit',
  env: process.env
});
process.exit(r.status === null ? 1 : r.status);
