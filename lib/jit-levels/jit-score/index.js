/**
 * JIT.Score — fingerprint v1 and scoring metrics.
 */

const { createRomFromBuffer, parseLevelIdToInt } = require('../smw-rom');
const { lmResolveTables } = require('../levelinfo/lm-tables');
const { parseLevelInfoRaw } = require('../levelinfo/level-parse');
const { parseLevelInfo } = require('../levelinfo');

const OBJ_STANDARD = 1;
const MAP16_DEC_KINDS = new Set([1, 2, 6, 8]);

const SCREEN_SHAPES = {
  horizontal: { cols: 16, rows: 27 },
  vertical: { cols: 16, rows: 16 },
};

function countLevelObjects(levelInfo) {
  const objs = levelInfo?.layer1?.objects;
  if (Array.isArray(objs)) return objs;
  if (objs && typeof objs === 'object') {
    return [
      ...(objs.standard || []),
      ...(objs.extended || []),
      ...(objs.screen_exits || []),
    ];
  }
  return [];
}

function countSprites(levelInfo) {
  return levelInfo?.sprite_data?.sprites || levelInfo?.layer1?.sprites || [];
}

function placeMap16Tile(grid, cols, rows, x, y, tileId) {
  if (x < 0 || y < 0 || x >= cols || y >= rows) return;
  grid[y * cols + x] = tileId & 0xff;
}

function fillMap16Rect(grid, cols, rows, x, y, width, height, baseTile) {
  for (let dy = 0; dy < height; dy++) {
    for (let dx = 0; dx < width; dx++) {
      placeMap16Tile(grid, cols, rows, x + dx, y + dy, baseTile + dy * width + dx);
    }
  }
}

function extractScreenGrids(rawInfo) {
  const mode = rawInfo.primary?.level_mode ?? 0;
  const shape = screenShapeForMode(mode);
  const { cols, rows } = shape;
  const maxTiles = cols * rows;

  let screenCount = rawInfo.primary?.length_in_screens ?? 1;
  if (screenCount === -1) screenCount = 32;
  screenCount = Math.max(1, Math.min(32, screenCount));

  const grids = Array.from({ length: screenCount }, () => new Array(maxTiles).fill(0));

  for (const obj of rawInfo.objects || []) {
    if (obj.kind !== OBJ_STANDARD || !obj.decoded?.present) continue;
    const dec = obj.decoded;
    if (!MAP16_DEC_KINDS.has(dec.kind)) continue;

    const screen = obj.screen_number ?? 0;
    if (screen < 0 || screen >= screenCount) continue;
    const grid = grids[screen];
    const baseX = obj.x_position ?? 0;
    const baseY = obj.y_position ?? 0;

    if (dec.kind === 1 || dec.kind === 2) {
      const width = (dec.width_4b ?? 0) + 1;
      const height = (dec.height_4b ?? 0) + 1;
      let tile = dec.map16_tile_9b & 0x1ff;
      if (dec.kind === 2) tile |= 0x100;
      fillMap16Rect(grid, cols, rows, baseX, baseY, width, height, tile);
      continue;
    }

    if (dec.kind === 6 || dec.kind === 8) {
      const width = Math.max(1, (dec.width ?? 0) + 1);
      const height = Math.max(1, (dec.height ?? 0) + 1);
      let baseTile = dec.base_map16 & 0x7ff;
      if (dec.kind === 8) baseTile |= 0x400;
      fillMap16Rect(grid, cols, rows, baseX, baseY, width, height, baseTile);
    }
  }

  return grids;
}

function parseRawLevelInfo(romBuffer, levelId) {
  const rom = createRomFromBuffer(romBuffer);
  const tablesRes = lmResolveTables(rom);
  if (!tablesRes.ok) {
    throw new Error(tablesRes.error || 'Table resolve failed');
  }

  let id = parseLevelIdToInt(levelId);
  if (id == null) {
    throw new Error(`Invalid LEVEL_ID: ${levelId}`);
  }
  const parseRes = parseLevelInfoRaw(rom, tablesRes.tables, id);
  if (!parseRes.ok) {
    throw new Error(parseRes.error || 'Parse failed');
  }
  return parseRes.info;
}

function screenShapeForMode(levelMode) {
  const mode = levelMode & 0x1f;
  if ([0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x10, 0x11, 0x14, 0x1a, 0x1b, 0x1f].includes(mode)) {
    return SCREEN_SHAPES.vertical;
  }
  return SCREEN_SHAPES.horizontal;
}

function fingerprintScreenV1(tiles, maxTiles) {
  const slice = tiles.slice(0, maxTiles);
  if (slice.every((t) => t === 0)) return null;
  const hex = slice.map((t) => (t & 0xff).toString(16).padStart(2, '0')).join('');
  return `v1:${hex}`;
}

function compareFingerprintsV1(fpA, fpB) {
  if (!fpA || !fpB || !fpA.startsWith('v1:') || !fpB.startsWith('v1:')) return 100;
  const a = fpA.slice(3);
  const b = fpB.slice(3);
  const len = Math.max(a.length / 2, b.length / 2, 1);
  let diff = 0;
  const pairs = Math.max(a.length, b.length) / 2;
  for (let i = 0; i < pairs; i++) {
    const ba = parseInt(a.substr(i * 2, 2) || '00', 16);
    const bb = parseInt(b.substr(i * 2, 2) || '00', 16);
    if (ba !== bb) diff++;
  }
  return Math.round((diff / pairs) * 100);
}

function loadFingerprintCorpus(filePath, fs) {
  const corpus = [];
  if (!fs.existsSync(filePath)) return corpus;
  const lines = fs.readFileSync(filePath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const parts = trimmed.split(',');
    if (parts.length < 3) continue;
    corpus.push({
      gameid: parts[0].trim(),
      levelid: parts[1].trim().toUpperCase().padStart(3, '0'),
      fingerprint: parts.slice(2).join(',').trim(),
    });
  }
  return corpus;
}

function scoreOriginality(fingerprints, corpus) {
  if (!fingerprints.length || !corpus.length) return 100;
  let minDiff = 100;
  for (const fp of fingerprints) {
    if (!fp) continue;
    for (const entry of corpus) {
      const diff = compareFingerprintsV1(fp, entry.fingerprint);
      minDiff = Math.min(minDiff, diff);
    }
  }
  return minDiff;
}

function scoreInternalSimilarity(allLevelFps, levelIndex) {
  const mine = allLevelFps[levelIndex] || [];
  if (mine.length === 0) return 100;
  let minDiff = 100;
  for (let j = 0; j < allLevelFps.length; j++) {
    if (j === levelIndex) continue;
    const other = allLevelFps[j] || [];
    for (const fpA of mine) {
      for (const fpB of other) {
        minDiff = Math.min(minDiff, compareFingerprintsV1(fpA, fpB));
      }
    }
  }
  return minDiff;
}

function scoreCompleteness(levelInfo) {
  const primary = levelInfo?.layer1?.primary_level_header || {};
  const objects = countLevelObjects(levelInfo);
  const sprites = countSprites(levelInfo);
  const exits = objects.filter((o) => o.kind === 'screen_exit' || o.object_number === 0x3f || o.std_id === 0x3f);
  let screens = primary.length_in_screens;
  if (screens === -1) screens = 32;
  if (screens == null || screens <= 0) screens = 1;

  let score = 0;
  score += Math.min(screens, 8) / 8 * 40;
  score += Math.min(objects.length, 80) / 80 * 30;
  score += Math.min(sprites.length, 40) / 40 * 15;
  if (exits.length > 0) score += 15;
  return Math.round(Math.min(100, score));
}

function buildLevelFingerprints(romBuffer, levelId) {
  const rawInfo = parseRawLevelInfo(romBuffer, levelId);
  const info = parseLevelInfo(romBuffer, levelId);
  const mode = rawInfo.primary?.level_mode ?? 0;
  const shape = screenShapeForMode(mode);
  const maxTiles = shape.cols * shape.rows;
  const grids = extractScreenGrids(rawInfo);
  const fingerprints = grids.map((tiles) => fingerprintScreenV1(tiles, maxTiles));
  return { fingerprints: fingerprints.filter(Boolean), levelInfo: info };
}

function scoreLevels(romBuffer, levelIds, corpusPath, fs) {
  const corpus = loadFingerprintCorpus(corpusPath, fs);
  const allFps = [];
  const infos = [];

  for (const levelId of levelIds) {
    const { fingerprints, levelInfo } = buildLevelFingerprints(romBuffer, levelId);
    allFps.push(fingerprints);
    infos.push(levelInfo);
  }

  return levelIds.map((levelId, idx) => ({
    levelnumber: String(levelId).replace(/^0x/i, '').toUpperCase().padStart(3, '0'),
    scores: {
      originality: scoreOriginality(allFps[idx], corpus),
      internalSimilarity: scoreInternalSimilarity(allFps, idx),
      completeness: scoreCompleteness(infos[idx]),
    },
    sources: ['jitscore'],
  }));
}

module.exports = {
  fingerprintScreenV1,
  compareFingerprintsV1,
  loadFingerprintCorpus,
  scoreOriginality,
  scoreInternalSimilarity,
  scoreCompleteness,
  buildLevelFingerprints,
  scoreLevels,
  screenShapeForMode,
};
