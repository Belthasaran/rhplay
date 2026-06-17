/**
 * RHServer endpoint configuration (release vs local testing).
 */

const fs = require('fs');
const path = require('path');

const ENDPOINTS_PATH = path.join(__dirname, 'rhserver-endpoints.json');

let _cached = null;

function loadEndpoints() {
  if (_cached) return _cached;
  const raw = fs.readFileSync(ENDPOINTS_PATH, 'utf8');
  _cached = JSON.parse(raw);
  return _cached;
}

function resolveEndpoints(testMode) {
  const endpoints = loadEndpoints();
  const useTesting = testMode === 'On';
  return useTesting ? { ...endpoints.testing } : { ...endpoints.release };
}

function getApiBaseUrl(testMode) {
  return resolveEndpoints(testMode).api.replace(/\/$/, '');
}

function getWebBaseUrl(testMode) {
  return resolveEndpoints(testMode).web.replace(/\/$/, '');
}

function getAdminBaseUrl(testMode) {
  return resolveEndpoints(testMode).admin.replace(/\/$/, '');
}

function getConnectUrl(testMode, queryString = '') {
  const base = `${getWebBaseUrl(testMode)}/connect/rhplay`;
  if (!queryString) return base;
  const qs = String(queryString).replace(/^\?/, '');
  return qs ? `${base}?${qs}` : base;
}

const DEFAULT_API_BASE = getApiBaseUrl('Off');

module.exports = {
  ENDPOINTS_PATH,
  loadEndpoints,
  resolveEndpoints,
  getApiBaseUrl,
  getWebBaseUrl,
  getAdminBaseUrl,
  getConnectUrl,
  DEFAULT_API_BASE
};
