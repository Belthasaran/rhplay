/**
 * dns-pointer.js
 *
 * Query DNS TXT and URI records for coremanifest pointer metadata.
 * Used as secondary update mechanism after on-chain pointer check.
 * Uses dns-query package for DNS-over-HTTPS (TXT and URI record types).
 */

const { getCurrentChannel, getCurrentPlatform } = require('./software-update-check');

// URI record type per RFC 7553
const DNS_TYPE_URI = 256;

/**
 * Resolve dnshost_pointer from manifest: section-specific or top-level
 * @param {Object} manifest - Current core manifest
 * @returns {string[]} Array of hostnames to query
 */
function resolveDnshostPointer(manifest) {
  const channel = getCurrentChannel();
  const plat = getCurrentPlatform();
  const platform = plat?.platform;
  const format = plat?.format;

  let hostnames = null;

  if (platform && format) {
    const key = `${channel}/RHPLAY/${platform}/${format}`;
    const normalizedKey = key.toLowerCase();
    for (const manifestKey of Object.keys(manifest)) {
      if (manifestKey.toLowerCase() === normalizedKey) {
        const section = manifest[manifestKey];
        if (section && Array.isArray(section.dnshost_pointer) && section.dnshost_pointer.length > 0) {
          hostnames = section.dnshost_pointer.filter((h) => typeof h === 'string' && h.trim());
          break;
        }
        break;
      }
    }
  }

  if (!hostnames || hostnames.length === 0) {
    hostnames = Array.isArray(manifest.dnshost_pointer)
      ? manifest.dnshost_pointer.filter((h) => typeof h === 'string' && h.trim())
      : [];
  }

  return hostnames;
}

const COREMF_TXT_PREFIX = 'coremf ';

/**
 * Parse TXT record content. Supports formats:
 * - Legacy: "currentVersion=4 updatedat=1771707248 size=1540 sha256=0x... cid=..."
 * - New:    "coremf currentVersion=6 updatedat=1772872293 size=1676 sha256=0x... cid=..."
 * @param {string} txt - Raw TXT content (may start with "coremf ")
 * @returns {Object|null} { currentVersion, updatedat, size, sha256, cid } or null
 */
function parseTxtRecord(txt) {
  if (!txt || typeof txt !== 'string') return null;
  const stripped = txt.startsWith(COREMF_TXT_PREFIX)
    ? txt.slice(COREMF_TXT_PREFIX.length)
    : txt;
  const result = {};
  const parts = stripped.split(/\s+/);
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const key = part.substring(0, eq);
    const value = part.substring(eq + 1).trim();
    if (key === 'currentVersion') result.currentVersion = parseInt(value, 10);
    else if (key === 'updatedat') result.updatedat = parseInt(value, 10);
    else if (key === 'size') result.size = parseInt(value, 10);
    else if (key === 'sha256') result.sha256 = value;
    else if (key === 'cid') result.cid = value;
  }
  if (result.currentVersion == null || result.updatedat == null || !result.sha256) {
    return null;
  }
  return result;
}

/**
 * Query DNS TXT record for hostname
 * @param {string} hostname
 * @param {Object} [options] - { endpoints, timeout }
 * @returns {Promise<Object|null>} Parsed TXT metadata or null
 */
async function queryDnsTxt(hostname, options = {}) {
  const { query, combineTXT, wellknown } = require('dns-query');
  const endpoints = options.endpoints || wellknown.endpoints('doh');
  const timeout = options.timeout ?? 10000;

  try {
    const response = await query(
      { question: { type: 'TXT', name: hostname } },
      { endpoints, timeout }
    );
    if (!response.answers || response.answers.length === 0) return null;
    const txtAnswers = (response.answers || []).filter(a => (a.type === 'TXT' || a.type === 16) && a.data);
    for (const answer of txtAnswers) {
      const data = answer.data;
      const txtStr = Array.isArray(data) && combineTXT
        ? combineTXT(data)
        : (typeof data === 'string' ? data : (Buffer.isBuffer(data) || data instanceof Uint8Array ? Buffer.from(data).toString('utf8') : ''));
      if (txtStr.startsWith(COREMF_TXT_PREFIX)) {
        const parsed = parseTxtRecord(txtStr);
        if (parsed) return parsed;
      }
    }
    return null;
  } catch (err) {
    console.warn(`[dns-pointer] TXT query failed for ${hostname}:`, err.message);
    return null;
  }
}

/**
 * Parse URI record RDATA per RFC 7553: priority weight "target"
 * dns-query returns answers with data - structure depends on record type
 * @param {*} data - URI record data from dns-query response
 * @returns {Array<{priority:number, weight:number, target:string}>}
 */
function parseUriRecords(data) {
  const out = [];
  if (!data) return out;
  // dns-query / dns-packet may return URI as { priority, weight, target } or encoded
  if (typeof data === 'object' && data.priority != null && data.target) {
    out.push({
      priority: Number(data.priority) || 0,
      weight: Number(data.weight) || 0,
      target: String(data.target).replace(/^"|"$/g, '')
    });
    return out;
  }
  if (Array.isArray(data)) {
    for (const item of data) {
      const parsed = parseUriRecords(item);
      out.push(...parsed);
    }
  }
  return out;
}

/**
 * Query DNS URI records for hostname (RFC 7553)
 * @param {string} hostname
 * @param {Object} [options] - { endpoints, timeout }
 * @returns {Promise<string[]>} Array of target URLs ordered by priority (asc) then weight (desc)
 */
async function queryDnsUri(hostname, options = {}) {
  const { query, wellknown } = require('dns-query');
  const endpoints = options.endpoints || wellknown.endpoints('doh');
  const timeout = options.timeout ?? 10000;

  try {
    const response = await query(
      { question: { type: DNS_TYPE_URI, name: hostname } },
      { endpoints, timeout }
    );
    if (!response.answers || response.answers.length === 0) return [];

    const records = [];
    for (const ans of response.answers) {
      const parsed = parseUriRecords(ans.data);
      records.push(...parsed);
    }

    records.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return b.weight - a.weight;
    });

    return records.map((r) => r.target).filter(Boolean);
  } catch (err) {
    console.warn(`[dns-pointer] URI query failed for ${hostname}:`, err.message);
    return [];
  }
}

/**
 * Query DNS pointer: TXT + URI for hostnames
 * @param {string[]} hostnames - Hostnames to query (tried in order until one returns valid TXT)
 * @param {Object} [options] - { endpoints, timeout }
 * @returns {Promise<Object|null>} { currentVersion, updatedat, size, sha256, cid, urls } or null
 */
async function queryDnsPointer(hostnames, options = {}) {
  if (!hostnames || hostnames.length === 0) return null;

  let txtMeta = null;
  let urls = [];

  for (const hostname of hostnames) {
    txtMeta = await queryDnsTxt(hostname, options);
    if (txtMeta) {
      urls = await queryDnsUri(hostname, options);
      break;
    }
  }

  if (!txtMeta) return null;

  return {
    currentVersion: txtMeta.currentVersion,
    updatedat: txtMeta.updatedat,
    size: txtMeta.size,
    sha256: txtMeta.sha256,
    cid: txtMeta.cid || null,
    urls
  };
}

module.exports = {
  resolveDnshostPointer,
  queryDnsTxt,
  queryDnsUri,
  queryDnsPointer,
  parseTxtRecord,
  DNS_TYPE_URI
};
