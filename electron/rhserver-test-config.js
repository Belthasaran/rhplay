/**
 * RHServer test mode build policy (optional embed at build time).
 *
 * Dev: reads RHPLAY_TEST_STATUS from environment.
 * Production: reads bundled rhserver-test-config.json.
 */

const fs = require('fs');
const path = require('path');

function readBundledConfig() {
  if (process.env.RHPLAY_TEST_STATUS) {
    return process.env.RHPLAY_TEST_STATUS;
  }

  let app;
  try {
    ({ app } = require('electron'));
  } catch {
    return null;
  }

  const isDev = process.env.ELECTRON_START_URL || process.env.NODE_ENV === 'development';
  const isPackaged = app && app.isPackaged;

  if (isDev && !isPackaged) {
    return null;
  }

  try {
    let configPath;
    if (isPackaged) {
      const resourcesPath = process.resourcesPath || app.getAppPath();
      configPath = path.join(resourcesPath, 'rhserver-test-config.json');
      if (!fs.existsSync(configPath)) {
        const altPath = path.join(resourcesPath, '..', 'resources', 'rhserver-test-config.json');
        if (fs.existsSync(altPath)) configPath = altPath;
      }
    } else {
      configPath = path.join(__dirname, 'rhserver-test-config.json');
    }

    if (!fs.existsSync(configPath)) return null;
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return config.testStatus || null;
  } catch (error) {
    console.warn('[RHServer Test Config] Error reading config:', error.message);
    return null;
  }
}

/**
 * @returns {'disabled'|null}
 */
function getRhplayTestStatus() {
  const status = readBundledConfig();
  return status === 'disabled' ? 'disabled' : null;
}

module.exports = {
  getRhplayTestStatus
};
