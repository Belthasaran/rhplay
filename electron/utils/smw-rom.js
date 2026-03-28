/**
 * Shared SMW ROM checks (used by main app and rhtools-launcher).
 * Pass getUserDataDir as a function returning the RHTools program data directory.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { SMW_EXPECTED_SHA224 } = require(path.join(__dirname, '..', '..', 'lib', 'binary-finder'));

/**
 * @param {() => string} getUserDataDir
 * @param {{ projectRootForDevCheck?: string }} [options]
 */
function checkSmwRomWithoutDb(getUserDataDir, options = {}) {
  const userDataDir = typeof getUserDataDir === 'function' ? getUserDataDir() : getUserDataDir;
  const skipRomPath = path.join(userDataDir, 'skiprom.txt');

  if (fs.existsSync(skipRomPath)) {
    return { found: true, path: null, skipped: true };
  }

  const projectRoot =
    options.projectRootForDevCheck != null
      ? options.projectRootForDevCheck
      : path.join(__dirname, '..', '..');

  const checks = [
    { name: 'Program data directory', fn: () => path.join(userDataDir, 'smw.sfc') },
    { name: 'Environment variable', fn: () => process.env.SMW_SFC_PATH },
    { name: 'Common ROM dir 1', fn: () => path.join(userDataDir, 'rom', 'smw.sfc') },
    { name: 'Common ROM dir 2', fn: () => path.join(userDataDir, 'roms', 'smw.sfc') },
    { name: 'Current directory', fn: () => path.join(process.cwd(), 'smw.sfc') },
    { name: 'Project root', fn: () => path.join(projectRoot, 'smw.sfc') }
  ];

  for (const check of checks) {
    try {
      const romPath = check.fn();
      if (romPath && fs.existsSync(romPath)) {
        try {
          const romData = fs.readFileSync(romPath);
          const hash = crypto.createHash('sha224').update(romData).digest('hex');

          if (hash === SMW_EXPECTED_SHA224) {
            return { found: true, path: romPath, hash };
          }
        } catch (error) {
          console.warn(`[smw-rom] Failed to validate ROM at ${romPath}:`, error.message);
        }
      }
    } catch (error) {
      // continue
    }
  }

  return { found: false, path: null };
}

function validateSmwRom(romPath) {
  try {
    const romData = fs.readFileSync(romPath);
    const hash = crypto.createHash('sha224').update(romData).digest('hex');

    return {
      valid: hash === SMW_EXPECTED_SHA224,
      hash,
      expected: SMW_EXPECTED_SHA224,
      size: romData.length
    };
  } catch (error) {
    return {
      valid: false,
      error: error.message
    };
  }
}

function copySmwRomToDataDir(getUserDataDir, sourcePath, ensureDirectoryFn) {
  const userDataDir = typeof getUserDataDir === 'function' ? getUserDataDir() : getUserDataDir;
  const targetPath = path.join(userDataDir, 'smw.sfc');

  try {
    if (ensureDirectoryFn) {
      ensureDirectoryFn(userDataDir);
    } else if (!fs.existsSync(userDataDir)) {
      fs.mkdirSync(userDataDir, { recursive: true });
    }
    fs.copyFileSync(sourcePath, targetPath);
    return { success: true, path: targetPath };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

module.exports = {
  checkSmwRomWithoutDb,
  validateSmwRom,
  copySmwRomToDataDir,
  SMW_EXPECTED_SHA224
};
