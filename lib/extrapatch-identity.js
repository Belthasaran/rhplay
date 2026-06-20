/**
 * Content-based identity hashes for extrapatches and base game patch metadata.
 */

const crypto = require('crypto');
const fs = require('fs');

function stableJson(obj) {
  if (obj === null || obj === undefined) return 'null';
  if (typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return `[${obj.map((v) => stableJson(v)).join(',')}]`;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableJson(obj[k])}`).join(',')}}`;
}

function sha256Hex(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex');
}

function fileDataHex(row) {
  if (!row?.file_data) return '';
  const buf = Buffer.isBuffer(row.file_data) ? row.file_data : Buffer.from(row.file_data);
  return buf.toString('hex');
}

function fieldStr(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return stableJson(value);
  return String(value);
}

function int01(value) {
  return value ? 1 : 0;
}

function computePatchUsageHash(row) {
  const payload = [
    fieldStr(row.patch_type),
    fileDataHex(row),
    fieldStr(row.template_text),
    fieldStr(row.parameter_mappings),
    String(row.priority ?? 100),
    String(int01(row.is_playlevel)),
    String(int01(row.requires_parameters)),
    String(int01(row.ignore_warnings))
  ].join('');
  return sha256Hex(payload);
}

function computePatchDefinitionHash(row) {
  const payload = [
    fieldStr(row.patch_code),
    fieldStr(row.patch_type),
    fileDataHex(row),
    fieldStr(row.template_text),
    fieldStr(row.parameter_mappings),
    fieldStr(row.restrictions),
    fieldStr(row.conflicts),
    fieldStr(row.dependencies),
    String(row.priority ?? 100),
    String(int01(row.is_playlevel)),
    String(int01(row.requires_parameters)),
    String(int01(row.ignore_warnings))
  ].join('');
  return sha256Hex(payload);
}

function hashRomFile(filePath) {
  const data = fs.readFileSync(filePath);
  return {
    result_sha1: crypto.createHash('sha1').update(data).digest('hex'),
    result_sha224: crypto.createHash('sha224').update(data).digest('hex')
  };
}

function resolveBasePatchIdentity(rhdataDb, gameid, gameVersion) {
  if (!rhdataDb || !gameid) {
    return {
      pat_sha224: null,
      pat_sha1: null,
      result_sha1: null,
      result_sha224: null,
      gameVersion: gameVersion ?? null
    };
  }

  let version = gameVersion;
  if (version === null || version === undefined) {
    const row = rhdataDb.prepare(`
      SELECT MAX(version) AS v FROM gameversions WHERE gameid = ?
    `).get(String(gameid));
    version = row?.v ?? 1;
  }

  const gv = rhdataDb.prepare(`
    SELECT gv.pat_sha224, gv.version,
      pb.pat_sha1, pb.result_sha1, pb.result_sha224
    FROM gameversions gv
    LEFT JOIN patchblobs pb ON gv.patchblob1_name = pb.patchblob1_name
    WHERE gv.gameid = ? AND gv.version = ?
  `).get(String(gameid), version);

  if (!gv) {
    return {
      pat_sha224: null,
      pat_sha1: null,
      result_sha1: null,
      result_sha224: null,
      gameVersion: version
    };
  }

  return {
    pat_sha224: gv.pat_sha224 || null,
    pat_sha1: gv.pat_sha1 || null,
    result_sha1: gv.result_sha1 || null,
    result_sha224: gv.result_sha224 || null,
    gameVersion: gv.version ?? version
  };
}

function sortPatchesLikeBuildPlus(patchRows) {
  const rows = [...patchRows];
  const processed = new Set();
  const sorted = [];

  function addPatch(patch) {
    if (!patch || processed.has(patch.epuuid)) return;
    if (patch.dependencies) {
      try {
        const deps = JSON.parse(patch.dependencies);
        if (Array.isArray(deps)) {
          for (const depCode of deps) {
            const dep = rows.find((p) => p.patch_code === depCode);
            if (dep && !processed.has(dep.epuuid)) addPatch(dep);
          }
        }
      } catch (_) {}
    }
    sorted.push(patch);
    processed.add(patch.epuuid);
  }

  const prioritySorted = [...rows].sort((a, b) => (a.priority || 100) - (b.priority || 100));
  for (const patch of prioritySorted) addPatch(patch);
  return sorted;
}

function computeUsageHashesForPatchCodes(rhdataDb, patchCodes, opts = {}) {
  const codes = (Array.isArray(patchCodes) ? patchCodes : [])
    .map((c) => String(c || '').trim())
    .filter(Boolean);
  if (!codes.length || !rhdataDb) {
    return { hashes: [], csv: '', appliedPatchCodes: [] };
  }

  const placeholders = codes.map(() => '?').join(',');
  const rows = rhdataDb.prepare(`
    SELECT * FROM extrapatches WHERE patch_code IN (${placeholders})
  `).all(...codes);

  const byCode = new Map(rows.map((r) => [String(r.patch_code).toLowerCase(), r]));
  const orderedRows = opts.sortLikeBuildPlus !== false
    ? sortPatchesLikeBuildPlus(rows)
    : codes.map((c) => byCode.get(c.toLowerCase())).filter(Boolean);

  const hashes = orderedRows.map((row) => computePatchUsageHash(row));
  return {
    hashes,
    csv: hashes.join(','),
    appliedPatchCodes: orderedRows.map((r) => r.patch_code)
  };
}

function buildPatchIdentitySnapshot(rhdataDb, opts = {}) {
  const {
    gameid,
    gameVersion,
    patchCodes,
    initialSfcPath
  } = opts;

  const base = resolveBasePatchIdentity(rhdataDb, gameid, gameVersion);
  const usage = computeUsageHashesForPatchCodes(rhdataDb, patchCodes);

  let result_sha1 = base.result_sha1;
  let result_sha224 = base.result_sha224;
  if ((!result_sha1 || !result_sha224) && initialSfcPath && fs.existsSync(initialSfcPath)) {
    try {
      const romHashes = hashRomFile(initialSfcPath);
      result_sha1 = result_sha1 || romHashes.result_sha1;
      result_sha224 = result_sha224 || romHashes.result_sha224;
    } catch (_) {}
  }

  return {
    gameid: gameid ? String(gameid) : null,
    gameVersion: base.gameVersion,
    pat_sha224: base.pat_sha224,
    pat_sha1: base.pat_sha1,
    result_sha1,
    result_sha224,
    patchdb_template_hashes: usage.csv,
    appliedPatchCodes: usage.appliedPatchCodes
  };
}

module.exports = {
  stableJson,
  sha256Hex,
  computePatchUsageHash,
  computePatchDefinitionHash,
  resolveBasePatchIdentity,
  sortPatchesLikeBuildPlus,
  computeUsageHashesForPatchCodes,
  buildPatchIdentitySnapshot,
  hashRomFile
};
