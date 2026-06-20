'use strict';

/**
 * MT share-code compatibility
 * @module electron/shared/mt-share-code
 */

const SHA1_RE = /^[0-9a-f]{40}$/;

/**
 * @param {string} flagsStr
 * @param {'ik3'|'ik4'|'ik5'|'ik6'} format
 */
function parseFlags(flagsStr, format) {
  const flags = { switchPalaces: false, freePlay: false };
  const str = flagsStr || '';
  if (str.includes('s')) {
    flags.switchPalaces = true;
  }
  if ((format === 'ik5' || format === 'ik6') && str.includes('o')) {
    flags.freePlay = true;
  }
  return flags;
}

/**
 * @param {string} blob
 */
function parseIk6OptionsBlob(blob) {
  const trimmed = (blob || '').trim();
  if (!trimmed) {
    return {};
  }
  try {
    const json = JSON.parse(Buffer.from(trimmed, 'base64').toString('utf8'));
    if (!json || typeof json !== 'object') {
      return {};
    }
    const options = {};
    if (
      json.openGraph
      && typeof json.openGraph === 'object'
      && Array.isArray(json.openGraph.edges)
      && Array.isArray(json.openGraph.locks)
    ) {
      options.openGraph = json.openGraph;
    }
    if (json.goal === 'any' || json.goal === 'hundred') {
      options.goal = json.goal;
    }
    if (typeof json.requireEdgePredecessors === 'boolean') {
      options.requireEdgePredecessors = json.requireEdgePredecessors;
    }
    return options;
  } catch {
    return {};
  }
}

/**
 * Legacy ik1/ik2/ik3 payload: sha1:105,13B|...
 * @param {string} payload
 */
function parseLegacyPayload(payload) {
  const entries = [];
  for (const part of (payload || '').split('|')) {
    const segment = part.trim();
    if (!segment) continue;
    const colon = segment.indexOf(':');
    if (colon < 0) continue;
    const sha1 = segment.slice(0, colon).trim().toLowerCase();
    if (!SHA1_RE.test(sha1)) continue;
    const levels = segment.slice(colon + 1).split(',').map((l) => l.trim()).filter(Boolean);
    if (levels.length === 0) continue;
    entries.push({ source: 'legacy', sha1, levels });
  }
  return entries;
}

/**
 * ik4+ payload: d{sha1}:levels|c{fileId}:levels|f{sha1}:levels
 * @param {string} payload
 */
function parseModernEntries(payload) {
  const entries = [];
  for (const part of (payload || '').split('|')) {
    const segment = part.trim();
    if (!segment) continue;
    const colon = segment.indexOf(':');
    if (colon < 1) continue;
    const prefix = segment.slice(0, colon).trim();
    const kind = prefix[0]?.toLowerCase();
    const idPart = prefix.slice(1).trim().toLowerCase();
    const levels = segment.slice(colon + 1).split(',').map((l) => l.trim()).filter(Boolean);
    if (levels.length === 0) continue;

    if (kind === 'd') {
      if (!SHA1_RE.test(idPart)) continue;
      entries.push({ source: 'smwdb', sha1: idPart, levels });
    } else if (kind === 'c') {
      const fileId = Number(idPart);
      if (!Number.isFinite(fileId) || fileId <= 0 || !Number.isInteger(fileId)) continue;
      entries.push({ source: 'smwc', fileId, levels });
    } else if (kind === 'f') {
      if (!SHA1_RE.test(idPart)) continue;
      entries.push({ source: 'folder', sha1: idPart, levels });
    }
  }
  return entries;
}

function decodeUrlName(raw) {
  if (!raw) return null;
  try {
    return decodeURIComponent(raw) || null;
  } catch {
    return raw || null;
  }
}

/**
 * @param {string} shareCode
 * @returns {{
 *   ok: true,
 *   format: string,
 *   name: string|null,
 *   flags: { switchPalaces: boolean, freePlay: boolean },
 *   options: Record<string, unknown>,
 *   entries: Array<{ source: string, sha1?: string, fileId?: number, levels: string[] }>,
 * } | { ok: false, error: { kind: string, preview?: string } }}
 */
function parseShareCode(shareCode) {
  const trimmed = (shareCode || '').trim();
  if (!trimmed) {
    return { ok: false, error: { kind: 'empty' } };
  }

  let decoded;
  try {
    const normalized = trimmed.replace(/\s/g, '');
    if (!normalized || normalized.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) {
      return { ok: false, error: { kind: 'invalid-base64' } };
    }
    decoded = Buffer.from(normalized, 'base64').toString('utf8');
  } catch {
    return { ok: false, error: { kind: 'invalid-base64' } };
  }

  let payload = '';
  let name = null;
  let flags = { switchPalaces: false, freePlay: false };
  let options = {};
  let format = '';
  let parsePayload = parseLegacyPayload;

  if (decoded.startsWith('ik6|')) {
    format = 'ik6';
    parsePayload = parseModernEntries;
    const rest = decoded.slice(4);
    const nameEnd = rest.indexOf('|');
    if (nameEnd < 0) {
      name = decodeUrlName(rest);
      payload = '';
    } else {
      name = decodeUrlName(rest.slice(0, nameEnd));
      const flagsEnd = rest.indexOf('|', nameEnd + 1);
      if (flagsEnd < 0) {
        flags = parseFlags(rest.slice(nameEnd + 1), 'ik6');
        payload = '';
      } else {
        flags = parseFlags(rest.slice(nameEnd + 1, flagsEnd), 'ik6');
        const optsEnd = rest.indexOf('|', flagsEnd + 1);
        if (optsEnd < 0) {
          options = parseIk6OptionsBlob(rest.slice(flagsEnd + 1));
          payload = '';
        } else {
          options = parseIk6OptionsBlob(rest.slice(flagsEnd + 1, optsEnd));
          payload = rest.slice(optsEnd + 1);
        }
      }
    }
  } else if (decoded.startsWith('ik5|')) {
    format = 'ik5';
    parsePayload = parseModernEntries;
    const rest = decoded.slice(4);
    const nameEnd = rest.indexOf('|');
    if (nameEnd < 0) {
      name = decodeUrlName(rest);
    } else {
      name = decodeUrlName(rest.slice(0, nameEnd));
      const flagsEnd = rest.indexOf('|', nameEnd + 1);
      if (flagsEnd < 0) {
        flags = parseFlags(rest.slice(nameEnd + 1), 'ik5');
      } else {
        flags = parseFlags(rest.slice(nameEnd + 1, flagsEnd), 'ik5');
        payload = rest.slice(flagsEnd + 1);
      }
    }
  } else if (decoded.startsWith('ik4|')) {
    format = 'ik4';
    parsePayload = parseModernEntries;
    const rest = decoded.slice(4);
    const nameEnd = rest.indexOf('|');
    if (nameEnd < 0) {
      name = decodeUrlName(rest);
    } else {
      name = decodeUrlName(rest.slice(0, nameEnd));
      const flagsEnd = rest.indexOf('|', nameEnd + 1);
      if (flagsEnd < 0) {
        flags = parseFlags(rest.slice(nameEnd + 1), 'ik4');
      } else {
        flags = parseFlags(rest.slice(nameEnd + 1, flagsEnd), 'ik4');
        payload = rest.slice(flagsEnd + 1);
      }
    }
  } else if (decoded.startsWith('ik3|')) {
    format = 'ik3';
    const rest = decoded.slice(4);
    const nameEnd = rest.indexOf('|');
    if (nameEnd < 0) {
      name = decodeUrlName(rest);
    } else {
      name = decodeUrlName(rest.slice(0, nameEnd));
      const flagsEnd = rest.indexOf('|', nameEnd + 1);
      if (flagsEnd < 0) {
        flags = parseFlags(rest.slice(nameEnd + 1), 'ik3');
      } else {
        flags = parseFlags(rest.slice(nameEnd + 1, flagsEnd), 'ik3');
        payload = rest.slice(flagsEnd + 1);
      }
    }
  } else if (decoded.startsWith('ik2|')) {
    format = 'ik2';
    const rest = decoded.slice(4);
    const nameEnd = rest.indexOf('|');
    if (nameEnd < 0) {
      name = decodeUrlName(rest);
    } else {
      name = decodeUrlName(rest.slice(0, nameEnd));
      payload = rest.slice(nameEnd + 1);
    }
  } else if (decoded.startsWith('ik1|')) {
    format = 'ik1';
    payload = decoded.slice(4);
  } else {
    return { ok: false, error: { kind: 'unsupported-format', preview: decoded.slice(0, 80) } };
  }

  const entries = parsePayload(payload);
  if (entries.length === 0) {
    return { ok: false, error: { kind: 'no-hacks' } };
  }

  return {
    ok: true,
    format,
    name,
    flags,
    options,
    entries,
  };
}

/**
 * @param {{ kind: string, preview?: string }} error
 */
function formatShareCodeError(error) {
  switch (error?.kind) {
    case 'empty':
      return '';
    case 'invalid-base64':
      return "That doesn't look like base64 — make sure you copied the whole code.";
    case 'unsupported-format':
      return `Unsupported run code format. Codes start with "ik1|", "ik2|", "ik3|", "ik4|", "ik5|", or "ik6|"; got: ${(error.preview || '').slice(0, 40)}…`;
    case 'no-hacks':
      return "Couldn't find any hacks with levels in that code.";
    default:
      return 'Invalid share code.';
  }
}

/**
 * Encode ik1 share code for tests.
 * @param {string} payload
 */
function encodeIk1ShareCode(payload) {
  return Buffer.from(`ik1|${payload}`, 'utf8').toString('base64');
}

module.exports = {
  SHA1_RE,
  parseShareCode,
  parseLegacyPayload,
  parseModernEntries,
  parseFlags,
  parseIk6OptionsBlob,
  formatShareCodeError,
  encodeIk1ShareCode,
};
