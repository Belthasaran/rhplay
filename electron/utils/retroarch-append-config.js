/**
 * RetroArch append.cfg lifecycle in program data (userData).
 */

const fs = require('fs');
const path = require('path');

const APPEND_DIR = 'retroarch';
const APPEND_FILE = 'append.cfg';
const TEMPLATE_NAME = 'append.cfg.template';

function getUserDataDir() {
  const manifestResolver = require('./manifest-resolver');
  return manifestResolver.getUserDataDir();
}

function getAppendConfigPath() {
  return path.join(getUserDataDir(), APPEND_DIR, APPEND_FILE);
}

function resolveTemplatePath() {
  const candidates = [
    path.join(__dirname, '..', TEMPLATE_NAME),
    path.join(process.cwd(), 'electron', TEMPLATE_NAME),
  ];
  try {
    const { app } = require('electron');
    candidates.push(path.join(app.getAppPath(), 'electron', TEMPLATE_NAME));
    if (process.resourcesPath) {
      candidates.push(path.join(process.resourcesPath, 'electron', TEMPLATE_NAME));
      candidates.push(path.join(process.resourcesPath, 'app.asar.unpacked', 'electron', TEMPLATE_NAME));
      candidates.push(path.join(process.resourcesPath, 'app.asar', 'electron', TEMPLATE_NAME));
    }
  } catch (_err) {
    // Node test / non-Electron context
  }
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || null;
}

function getTemplatePath() {
  return resolveTemplatePath();
}

function readTemplateContent() {
  const templatePath = resolveTemplatePath();
  if (!templatePath) {
    throw new Error(`RetroArch append config template not found (${TEMPLATE_NAME})`);
  }
  const content = fs.readFileSync(templatePath, 'utf8');
  if (!String(content).trim()) {
    throw new Error(`RetroArch append config template is empty: ${templatePath}`);
  }
  return { path: templatePath, content };
}

function ensureAppendConfigDir() {
  const dir = path.join(getUserDataDir(), APPEND_DIR);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function appendConfigNeedsRestore(configPath) {
  if (!fs.existsSync(configPath)) {
    return true;
  }
  try {
    const stat = fs.statSync(configPath);
    if (!stat.isFile() || stat.size === 0) {
      return true;
    }
    const content = fs.readFileSync(configPath, 'utf8');
    return !String(content).trim();
  } catch (_err) {
    return true;
  }
}

function ensureAppendConfig() {
  const configPath = getAppendConfigPath();
  if (appendConfigNeedsRestore(configPath)) {
    return restoreAppendConfigDefault();
  }
  return configPath;
}

function readAppendConfig() {
  const configPath = ensureAppendConfig();
  return {
    path: configPath,
    content: fs.readFileSync(configPath, 'utf8'),
  };
}

function writeAppendConfig(content) {
  ensureAppendConfigDir();
  const configPath = getAppendConfigPath();
  fs.writeFileSync(configPath, String(content), 'utf8');
  return configPath;
}

function restoreAppendConfigDefault() {
  const { content } = readTemplateContent();
  ensureAppendConfigDir();
  const configPath = getAppendConfigPath();
  fs.writeFileSync(configPath, content, 'utf8');
  return configPath;
}

module.exports = {
  getAppendConfigPath,
  getTemplatePath,
  resolveTemplatePath,
  ensureAppendConfig,
  readAppendConfig,
  writeAppendConfig,
  restoreAppendConfigDefault,
};
