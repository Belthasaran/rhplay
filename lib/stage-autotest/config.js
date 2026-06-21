'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_CONFIG = {
  backend: 'retroarch',
  headless: false,
  skipOverworldNavigation: false,
  retroarch: {
    useAppSettings: true,
    nciPort: 55355,
    retropadPort: 55400,
    appendNetworkRetropad: true,
  },
  sni: {
    autoStart: true,
    wsAddress: 'ws://localhost:23074',
    library: 'usb2snes_a',
  },
  timeoutsSec: {
    boot: 60,
    navigate: 45,
    retryObserve: 20,
    freezeDetect: 8,
    sniConnect: 30,
  },
  inputPlan: {
    titleSkipStartMs: [2000, 4000],
    enterGameStartMs: [6000, 8000],
    navigateWindowMs: 30000,
    retryPressWindowMs: 15000,
    buttonIntervalMs: 500,
  },
  logging: {
    logDir: '{userData}/stage-autotest/logs',
  },
  onPassUpdateTestStatus: false,
};

function deepMerge(base, override) {
  if (!override || typeof override !== 'object') return base;
  const out = { ...base };
  for (const key of Object.keys(override)) {
    const val = override[key];
    if (val && typeof val === 'object' && !Array.isArray(val) && base[key] && typeof base[key] === 'object') {
      out[key] = deepMerge(base[key], val);
    } else if (val !== undefined) {
      out[key] = val;
    }
  }
  return out;
}

function resolveUserDataPath(userDataDir) {
  if (!userDataDir) {
    try {
      const manifestResolver = require('../../electron/utils/manifest-resolver');
      return manifestResolver.getUserDataDir();
    } catch (_e) {
      return path.join(process.cwd(), '.rhtools-userdata');
    }
  }
  return userDataDir;
}

function getConfigDir(userDataDir) {
  return path.join(resolveUserDataPath(userDataDir), 'stage-autotest');
}

function getConfigPath(userDataDir) {
  return path.join(getConfigDir(userDataDir), 'tester_config.json');
}

function expandConfigPaths(config, userDataDir) {
  const ud = resolveUserDataPath(userDataDir);
  const json = JSON.stringify(config);
  const expanded = json.replace(/\{userData\}/g, ud.replace(/\\/g, '/'));
  return JSON.parse(expanded);
}

function loadConfig(userDataDir, overrides = {}) {
  const configPath = getConfigPath(userDataDir);
  const configDir = getConfigDir(userDataDir);
  let loaded = { ...DEFAULT_CONFIG };

  if (fs.existsSync(configPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      loaded = deepMerge(DEFAULT_CONFIG, raw);
    } catch (e) {
      console.warn('[stage-autotest] Failed to parse config, using defaults:', e.message);
    }
  } else {
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    fs.writeFileSync(configPath, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`, 'utf8');
  }

  loaded = deepMerge(loaded, overrides);
  return expandConfigPaths(loaded, userDataDir);
}

function saveConfig(userDataDir, config) {
  const configPath = getConfigPath(userDataDir);
  const configDir = getConfigDir(userDataDir);
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return configPath;
}

module.exports = {
  DEFAULT_CONFIG,
  loadConfig,
  saveConfig,
  getConfigPath,
  getConfigDir,
  resolveUserDataPath,
  expandConfigPaths,
};
