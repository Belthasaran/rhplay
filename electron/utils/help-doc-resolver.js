/**
 * help-doc-resolver.js - Resolve packaged or dev paths for in-app help HTML.
 */

const fs = require('fs');
const path = require('path');

const HELP_DOC_IDS = {
  retroarch: 'RETROARCH_SETUP.html',
  bizhawk: 'BIZHAWK_SETUP.html',
};

function resolveResourcePath(input) {
  if (!input) return null;
  const candidates = [];
  if (path.isAbsolute(input)) {
    candidates.push(input);
  } else {
    if (process.resourcesPath) {
      candidates.push(path.join(process.resourcesPath, input));
      candidates.push(path.join(process.resourcesPath, 'help', path.basename(input)));
      candidates.push(path.join(process.resourcesPath, 'app.asar.unpacked', input));
      candidates.push(path.join(process.resourcesPath, 'app.asar.unpacked', 'electron', 'help', path.basename(input)));
    }
    candidates.push(path.join(__dirname, '..', 'help', path.basename(input)));
    candidates.push(path.join(__dirname, '..', '..', 'electron', 'help', path.basename(input)));
    candidates.push(path.join(process.cwd(), 'electron', 'help', path.basename(input)));
  }
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || null;
}

function resolveHelpDocPath(docIdOrFilename) {
  const filename = HELP_DOC_IDS[docIdOrFilename] || docIdOrFilename;
  if (!filename || !filename.endsWith('.html')) return null;
  return resolveResourcePath(path.join('help', filename));
}

function getHelpDocFilename(docId) {
  return HELP_DOC_IDS[docId] || null;
}

module.exports = {
  HELP_DOC_IDS,
  resolveHelpDocPath,
  resolveResourcePath,
  getHelpDocFilename,
};
