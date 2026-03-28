/**
 * Build RHTools Launcher portable (Windows) and AppImage (Linux).
 * Run from repo root: npm run build:launcher:win | build:launcher:linux
 * Or: cd rhtools-launcher && npm run build:win
 */
const path = require('path');

const rootDir = path.join(__dirname, '..');

/**
 * electron-builder uses --projectDir rhtools-launcher (no electron in that folder's node_modules).
 * Pin the runtime version from the repo root install (same Electron as the main app).
 */
function getElectronVersionFromRoot() {
  try {
    const pkgPath = path.join(rootDir, 'node_modules', 'electron', 'package.json');
    return require(pkgPath).version;
  } catch (err) {
    throw new Error(
      'Could not read electron version from repo root node_modules/electron. Run npm install at the repository root.'
    );
  }
}

module.exports = {
  appId: 'com.rhtools.launcher',
  productName: 'RHTools Launcher',
  copyright: 'Copyright © RHTools',
  electronVersion: getElectronVersionFromRoot(),
  directories: {
    output: path.join(rootDir, 'dist-builds-launcher'),
    buildResources: path.join(__dirname, 'build')
  },
  files: [
    'main.js',
    'preload.js',
    'paths.js',
    'progress-window.html',
    'electron-builder.cjs',
    'renderer/dist/**/*',
    {
      from: path.join(rootDir, 'electron', 'utils'),
      to: 'electron/utils',
      filter: ['**/*.js']
    },
    {
      from: path.join(rootDir, 'electron', 'installer'),
      to: 'electron/installer',
      filter: ['**/*.js']
    },
    {
      from: path.join(rootDir, 'electron'),
      to: 'electron',
      filter: ['coremanifest.json', 'dbmanifest.json', 'bpsarchives.json']
    },
    {
      from: path.join(rootDir, 'lib'),
      to: 'lib',
      filter: ['**/*.js']
    },
    {
      from: path.join(rootDir, 'jsutils'),
      to: 'jsutils',
      filter: ['migratedb.js']
    },
    {
      from: path.join(rootDir, 'electron', 'sql', 'migrations'),
      to: 'electron/sql/migrations',
      filter: ['**/*']
    },
    {
      from: path.join(rootDir, 'node_modules'),
      to: 'node_modules',
      // Omit .bin trees: npm CLI stubs are not needed at runtime; broken symlinks here break packaging (e.g. stale serial-number).
      filter: ['**/*', '!.bin/**', '!**/.bin/**']
    }
  ],
  extraResources: [
    {
      // Secondary BrowserWindow loadFile() from app.asar can fail to resolve on Linux AppImage; keep outside asar.
      from: path.join(__dirname, 'progress-window.html'),
      to: 'progress-window.html'
    },
    {
      from: path.join(rootDir, 'electron', 'dbmanifest.json'),
      to: 'db/dbmanifest.json'
    },
    {
      from: path.join(rootDir, 'electron', 'bpsarchives.json'),
      to: 'db/bpsarchives.json'
    },
    {
      from: path.join(rootDir, 'electron', 'packed_db'),
      to: 'db/packed_db',
      filter: ['**/*']
    },
    {
      from: path.join(rootDir, 'electron', 'installer', 'prepare_databases.js'),
      to: 'db/prepare_databases.js'
    },
    {
      from: path.join(rootDir, 'node_modules', '7zip-mini'),
      to: 'app.asar.unpacked/node_modules/7zip-mini'
    }
  ],
  asarUnpack: [
    'node_modules/better-sqlite3/**/*',
    'node_modules/lzma-native/**/*',
    'node_modules/tar/**/*',
    'node_modules/chownr/**/*',
    'node_modules/fs-minipass/**/*',
    'node_modules/minipass/**/*',
    'node_modules/minizlib/**/*',
    'node_modules/mkdirp/**/*',
    'node_modules/yallist/**/*',
    'node_modules/readable-stream/**/*',
    'electron/installer/**/*',
    'electron/utils/ipfs-fetch-config.js',
    'electron/utils/arweave-fetch-config.js'
  ],
  win: {
    target: [{ target: 'portable', arch: ['x64'] }]
  },
  portable: {
    artifactName: 'rhtools-launcher-${version}-portable.exe'
  },
  linux: {
    target: ['AppImage'],
    category: 'Utility',
    artifactName: 'rhtools-launcher-${version}.AppImage'
  }
};
