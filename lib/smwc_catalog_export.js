/**
 * smwc_catalog_export.js - SMWC catalog tree + smwchack 7z export for updategames
 *
 * Produces fetchmissing-compatible layout under a target folder:
 *   bps/, bpsindex/, games/, extras/, images/, and {target}.build/smwchack_(GAMEID).7z
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync, spawnSync, spawn } = require('child_process');
const AdmZip = require('adm-zip');
const PatchProcessor = require('./patch-processor');
const { extractExtrasToDir, listExtrasUnder } = require('../jstools/smwc_world_extras');

const IMAGE_DOWNLOAD_DELAY = 2000;

function formatDateStamp(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

function resolveCatalogDir(argv = {}, date = new Date()) {
  if (process.env.SMWC_CATALOG_DIR) {
    return path.resolve(process.env.SMWC_CATALOG_DIR);
  }
  if (argv['target-7zfolder']) {
    return path.resolve(argv['target-7zfolder']);
  }
  const home = process.env.HOME;
  if (!home) {
    throw new Error('HOME is not set and --target-7zfolder was not specified');
  }
  return path.join(home, 'proj', `smwcgames${formatDateStamp(date)}`);
}

function getCatalogBuildDir(catalogDir) {
  return `${catalogDir}.build`;
}

function probeWritableDir(dirPath, label) {
  fs.mkdirSync(dirPath, { recursive: true });
  const probe = path.join(dirPath, `.write_probe_${process.pid}_${Date.now()}`);
  fs.writeFileSync(probe, 'ok');
  fs.unlinkSync(probe);
}

function verifyHomeWritable() {
  const home = process.env.HOME;
  if (!home) {
    throw new Error('HOME is not set');
  }
  if (!fs.existsSync(home)) {
    throw new Error(`HOME directory does not exist: ${home}`);
  }
  try {
    fs.accessSync(home, fs.constants.W_OK);
  } catch (e) {
    throw new Error(`HOME directory is not writable: ${home}`);
  }
}

function verifyCatalogWritable(catalogDir, options = {}) {
  verifyHomeWritable();
  const projDir = path.join(process.env.HOME, 'proj');
  fs.mkdirSync(projDir, { recursive: true });
  probeWritableDir(projDir, 'proj');

  probeWritableDir(catalogDir, 'catalog export directory');
  probeWritableDir(getCatalogBuildDir(catalogDir), 'catalog .build directory');

  for (const sub of ['bps', 'bpsindex', 'games', 'extras', 'images']) {
    probeWritableDir(path.join(catalogDir, sub), sub);
  }

  if (!options.skip7zCheck) {
    try {
      execSync('7z -h', { stdio: 'pipe' });
    } catch (e) {
      throw new Error('7z command not found on PATH (required for catalog 7z export)');
    }
  }
}

function parseIdList(value) {
  if (!value) return new Set();
  return new Set(String(value).split(',').map(s => s.trim()).filter(Boolean));
}

function shouldSkipCatalogImages(gameid, argv) {
  if (argv['skip-catalog-images']) return true;
  return parseIdList(argv['skip-catalog-images-for']).has(String(gameid));
}

function shouldSkipCatalog7z(gameid, argv) {
  if (argv['skip-catalog-7z']) return true;
  return parseIdList(argv['skip-catalog-7z-for']).has(String(gameid));
}

function shouldUseFullCatalogExport(oldPatSha224, newPatSha224) {
  const oldVal = oldPatSha224 == null ? '' : String(oldPatSha224);
  const newVal = newPatSha224 == null ? '' : String(newPatSha224);
  return oldVal !== newVal;
}

function extractBpsFiles(zipPath) {
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();
  const bpsFiles = [];

  for (const entry of entries) {
    if (entry.isDirectory) continue;
    const filename = entry.entryName;
    if (!filename.match(/\.bps$/i)) continue;
    const nameLower = filename.toLowerCase();
    const isEnglish = !nameLower.match(/(spanish|espa|french|franc|german|deutsch|italian|italia|japanese|japan|chinese|korean)/i);
    bpsFiles.push({
      filename,
      entry,
      isEnglish,
      size: entry.header.size || 0
    });
  }

  bpsFiles.sort((a, b) => {
    if (a.isEnglish && !b.isEnglish) return -1;
    if (!a.isEnglish && b.isEnglish) return 1;
    return a.filename.localeCompare(b.filename);
  });
  return bpsFiles;
}

function calculateHash(data, useSha256 = false) {
  const algo = useSha256 ? 'sha256' : 'sha1';
  return crypto.createHash(algo).update(data).digest('hex');
}

function detectHeader(romData) {
  return (romData.length % 1024) === 512;
}

function addHeader(romData) {
  return Buffer.concat([Buffer.alloc(512, 0), romData]);
}

function removeHeader(romData) {
  return detectHeader(romData) ? romData.slice(512) : romData;
}

function mapTypeAndDifficulty(gameData) {
  const difficulty = gameData.difficulty || '';
  const difficultyLower = difficulty.toLowerCase();
  const validFieldsTypes = [
    'Joke', 'Misc.', 'Kaizo', 'Kaizo, Puzzle', 'Kaizo, Puzzle, Tool-Assisted',
    'Kaizo, Tool-Assisted', 'Puzzle', 'Standard', 'Standard, Kaizo',
    'Standard, Kaizo, Puzzle', 'Standard, Puzzle', 'Standard, Puzzle, Tool-Assisted',
    'Tool-Assisted, Pit'
  ];
  const validDifficulties = [
    'Newcomer', 'Casual', 'Skilled', 'Intermediate', 'Advanced',
    'Hard', 'Expert', 'Master', 'Grandmaster'
  ];

  let fields_type = gameData.fields_type;
  if (!fields_type || !validFieldsTypes.includes(fields_type)) {
    const typesFound = [];
    if (difficultyLower.includes('kaizo')) typesFound.push('Kaizo');
    if (difficultyLower.includes('puzzle')) typesFound.push('Puzzle');
    if (difficultyLower.includes('standard')) typesFound.push('Standard');
    if (difficultyLower.includes('tool-assisted')) typesFound.push('Tool-Assisted');
    if (difficultyLower.includes('pit')) typesFound.push('Pit');
    if (difficultyLower.includes('joke')) typesFound.push('Joke');
    if (difficultyLower.includes('misc')) typesFound.push('Misc.');

    fields_type = null;
    if (typesFound.includes('Standard') && typesFound.includes('Kaizo') && typesFound.includes('Puzzle')) {
      fields_type = 'Standard, Kaizo, Puzzle';
    } else if (typesFound.includes('Kaizo') && typesFound.includes('Puzzle') && typesFound.includes('Tool-Assisted')) {
      fields_type = 'Kaizo, Puzzle, Tool-Assisted';
    } else if (typesFound.includes('Standard') && typesFound.includes('Puzzle') && typesFound.includes('Tool-Assisted')) {
      fields_type = 'Standard, Puzzle, Tool-Assisted';
    } else if (typesFound.includes('Standard') && typesFound.includes('Kaizo')) {
      fields_type = 'Standard, Kaizo';
    } else if (typesFound.includes('Standard') && typesFound.includes('Puzzle')) {
      fields_type = 'Standard, Puzzle';
    } else if (typesFound.includes('Kaizo') && typesFound.includes('Tool-Assisted')) {
      fields_type = 'Kaizo, Tool-Assisted';
    } else if (typesFound.includes('Kaizo') && typesFound.includes('Puzzle')) {
      fields_type = 'Kaizo, Puzzle';
    } else if (typesFound.includes('Tool-Assisted') && typesFound.includes('Pit')) {
      fields_type = 'Tool-Assisted, Pit';
    } else if (typesFound.includes('Joke')) {
      fields_type = 'Joke';
    } else if (typesFound.includes('Misc.')) {
      fields_type = 'Misc.';
    } else if (typesFound.includes('Kaizo')) {
      fields_type = 'Kaizo';
    } else if (typesFound.includes('Puzzle')) {
      fields_type = 'Puzzle';
    } else if (typesFound.includes('Standard')) {
      fields_type = 'Standard';
    }
  }

  let mappedDifficulty = gameData.difficulty;
  if (!mappedDifficulty || !validDifficulties.includes(mappedDifficulty)) {
    mappedDifficulty = null;
    if (difficultyLower.includes('newcomer')) mappedDifficulty = 'Newcomer';
    else if (difficultyLower.includes('casual')) mappedDifficulty = 'Casual';
    else if (difficultyLower.includes('skilled')) mappedDifficulty = 'Skilled';
    else if (difficultyLower.includes('intermediate')) mappedDifficulty = 'Intermediate';
    else if (difficultyLower.includes('advanced')) mappedDifficulty = 'Advanced';
    else if (difficultyLower.includes('hard')) mappedDifficulty = 'Hard';
    else if (difficultyLower.includes('expert')) mappedDifficulty = 'Expert';
    else if (difficultyLower.includes('master')) mappedDifficulty = 'Master';
    else if (difficultyLower.includes('grandmaster')) mappedDifficulty = 'Grandmaster';
  }

  return {
    fields_type,
    difficulty: mappedDifficulty,
    legacy_type: gameData.fields_type || difficulty
  };
}

function extractFirstAuthor(authors) {
  if (!authors || authors === 'None' || String(authors).trim() === '') return null;
  return String(authors).split(',').map(s => s.trim())[0] || null;
}

function detectLanguageFromFilename(filename) {
  if (!filename) return null;
  const lowerFilename = filename.toLowerCase();
  const pathParts = filename.split('/');
  const languagePatterns = [
    { lang: 'Portuguese', pattern: /(ptbr|portug[uú][êe]s[e]?|portguese|portugese|brazil|brasil)/i },
    { lang: 'Spanish', pattern: /(spanish|espa[ñn]ol|espanol)/i },
    { lang: 'French', pattern: /(french|fran[çc]ais|francais)/i },
    { lang: 'German', pattern: /(german|deutsch)/i },
    { lang: 'Italian', pattern: /(italian|italiano)/i },
    { lang: 'Japanese', pattern: /(japanese|japan)/i },
    { lang: 'Chinese', pattern: /(chinese|china)/i },
    { lang: 'Korean', pattern: /(korean|korea)/i },
    { lang: 'English', pattern: /(english)/i }
  ];

  const parenMatch = lowerFilename.match(/\(([^)]+)\)/);
  if (parenMatch) {
    for (const { lang, pattern } of languagePatterns) {
      if (pattern.test(parenMatch[1]) && lang !== 'English') return lang;
    }
  }
  for (const { lang, pattern } of languagePatterns) {
    if (pattern.test(lowerFilename) && lang !== 'English') return lang;
  }
  for (const part of pathParts.slice(0, -1)) {
    for (const { lang, pattern } of languagePatterns) {
      if (pattern.test(part.toLowerCase()) && lang !== 'English') return lang;
    }
  }
  if (/^(smw|super mario|princess|rescue|mario)/i.test(lowerFilename.split('/').pop())) {
    return 'English';
  }
  return 'English';
}

function getLanguageTag(language) {
  if (!language || language === 'English') return '';
  const tagMap = {
    Portuguese: '[Lang PT]', Spanish: '[Lang ES]', French: '[Lang FR]',
    German: '[Lang DE]', Italian: '[Lang IT]', Japanese: '[Lang JP]',
    Chinese: '[Lang CN]', Korean: '[Lang KR]'
  };
  return tagMap[language] || '[Lang Non-EN]';
}

function createSyntheticFilename(name, author, date, languageTag = '') {
  let dateStr = date || new Date().toISOString().split('T')[0];
  if (!dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
    if (dateStr.match(/^\d{4}-\d{2}$/)) dateStr = `${dateStr}-01`;
    else dateStr = new Date().toISOString().split('T')[0];
  }
  const nameWithLang = languageTag ? `${name || 'Unknown'} ${languageTag}` : (name || 'Unknown');
  return `${nameWithLang} by ${author || 'Unknown'} [${dateStr}] (SMW Hack).sfc`;
}

function extractDateFromUrl(url) {
  const urlMatch = String(url || '').match(/\/(\d{4})\/(\w+)\//);
  if (!urlMatch) return null;
  const monthMap = {
    January: '01', February: '02', March: '03', April: '04', May: '05', June: '06',
    July: '07', August: '08', September: '09', October: '10', November: '11', December: '12'
  };
  return `${urlMatch[1]}-${monthMap[urlMatch[2]] || '01'}-01`;
}

function getParentDirectoryName(fieldsType) {
  if (!fieldsType) return '[Super Mario World Hacks] SMW-General';
  const primaryType = String(fieldsType).split(',')[0].trim();
  const typeMap = {
    Kaizo: 'SMW-Kaizo', Standard: 'SMW-Standard', Puzzle: 'SMW-Puzzle',
    Joke: 'SMW-General', 'Misc.': 'SMW-General', 'Tool-Assisted': 'SMW-General'
  };
  return `[Super Mario World Hacks] ${typeMap[primaryType] || 'SMW-General'}`;
}

function enhanceGameNameForCatalog(game, gameDate) {
  const smwcTag = `[SMWC ${gameDate}]`;
  let enhanced = game.name || '';
  if (!enhanced.includes('[SMWC ')) {
    enhanced = `${enhanced} ${smwcTag}`.trim();
  }
  return enhanced;
}

function getSmwcSectionKey(section) {
  const sec = (section || 'smwhacks').replace(/^smwc_/, '');
  return `smwc_${sec}`;
}

function normalizeMetadata(metadata, gameid) {
  const game = typeof metadata === 'string' ? JSON.parse(metadata) : { ...metadata };
  if (!game.gameid) game.gameid = String(gameid);
  return game;
}

function testPatchBps(bpsPath, outputPath, flipsPath, baseRomPath) {
  try {
    execSync(`"${flipsPath}" --apply "${bpsPath}" "${baseRomPath}" "${outputPath}"`, { stdio: 'pipe' });
    if (!fs.existsSync(outputPath)) {
      return { success: false, error: 'Output file not created' };
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function downloadImage(imageUrl, imagePath, lastRequestTime) {
  const elapsed = Date.now() - lastRequestTime;
  const waitTime = IMAGE_DOWNLOAD_DELAY - elapsed;
  if (waitTime > 0) {
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }
  try {
    const response = await fetch(imageUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    const imageData = Buffer.from(await response.arrayBuffer());
    const tempPath = `${imagePath}.tmp`;
    fs.writeFileSync(tempPath, imageData);
    fs.renameSync(tempPath, imagePath);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function downloadGameImages(game, gameid, imagesDir, logFn = console.log) {
  const screenshotFiles = [];
  const gameImagesDir = path.join(imagesDir, String(gameid));
  fs.mkdirSync(gameImagesDir, { recursive: true });
  const images = game.images;
  if (!images || !Array.isArray(images) || images.length === 0) {
    return screenshotFiles;
  }

  logFn(`  Catalog: downloading ${images.length} image(s)...`);
  let lastImageRequestTime = 0;
  for (const imageUrl of images) {
    if (!imageUrl || typeof imageUrl !== 'string') continue;
    const filename = imageUrl.split('/').pop();
    if (!filename) continue;
    const imagePath = path.join(gameImagesDir, filename);
    if (fs.existsSync(imagePath)) {
      screenshotFiles.push(filename);
      continue;
    }
    const result = await downloadImage(imageUrl, imagePath, lastImageRequestTime);
    lastImageRequestTime = Date.now();
    if (result.success) screenshotFiles.push(filename);
    else logFn(`    Catalog: image download failed ${filename}: ${result.error}`);
  }
  return screenshotFiles.sort();
}

function copyImagesToHashDir(screenshotFiles, gameid, primaryHash, imagesDir) {
  if (!primaryHash || screenshotFiles.length === 0) return;
  const hash2 = primaryHash.slice(0, 2);
  const hashDir = path.join(imagesDir, hash2, primaryHash);
  fs.mkdirSync(hashDir, { recursive: true });
  const srcDir = path.join(imagesDir, String(gameid));
  for (const sf of screenshotFiles) {
    const src = path.join(srcDir, sf);
    const dest = path.join(hashDir, sf);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dest);
    }
  }
}

function getExistingScreenshotFiles(gameid, imagesDir) {
  const gameImagesDir = path.join(imagesDir, String(gameid));
  if (!fs.existsSync(gameImagesDir)) return [];
  return fs.readdirSync(gameImagesDir)
    .filter(f => fs.statSync(path.join(gameImagesDir, f)).isFile())
    .sort();
}

function runLevelReader(resultSfcPath) {
  try {
    const levelReaderPath = process.env.LEVEL_READER || path.join(process.env.HOME || '', 'smwdb', 'level_reader');
    if (!levelReaderPath || !fs.existsSync(levelReaderPath)) return null;
    const result = spawnSync(levelReaderPath, [resultSfcPath], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    if (result.status !== 0 || !result.stdout || !result.stdout.trim()) return null;
    const trimmed = result.stdout.trim();
    if (trimmed.startsWith('"levelnames"')) {
      const parsed = JSON.parse(`{${trimmed}}`);
      return parsed.levelnames || null;
    }
    if (trimmed.startsWith('{')) {
      const parsed = JSON.parse(trimmed);
      return parsed.levelnames || parsed;
    }
    return null;
  } catch (e) {
    return null;
  }
}

function spawnWithTimeout(command, args, options = {}, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    let timeoutId;
    let killed = false;
    let stdout = '';
    let stderr = '';
    const child = spawn(command, args, { ...options, stdio: ['pipe', 'pipe', 'pipe'] });
    if (child.stdout) {
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (data) => { stdout += data; });
    }
    if (child.stderr) {
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (data) => { stderr += data; });
    }
    timeoutId = setTimeout(() => {
      if (!killed && !child.killed) {
        killed = true;
        try { child.kill('SIGTERM'); } catch (e) { /* ignore */ }
        reject(new Error(`Process ${command} exceeded timeout of ${timeoutMs}ms`));
      }
    }, timeoutMs);
    child.on('exit', (code, signal) => {
      clearTimeout(timeoutId);
      if (killed) return;
      if (signal) reject(new Error(`Process ${command} killed by signal ${signal}`));
      else resolve({ status: code, stdout, stderr });
    });
    child.on('error', (error) => {
      clearTimeout(timeoutId);
      if (!killed) reject(error);
    });
  });
}

async function runLmFilter(resultSfcPath, resultSha1, tempDir) {
  try {
    const result = await spawnWithTimeout('python3', ['try_lmfilter.py'], {
      env: { ...process.env, GAMETAG: resultSha1, GAMEVER: '1', ROMFILE: resultSfcPath },
      cwd: process.cwd()
    }, 20000);
    if (result.status !== 0) return null;
    const tempJsonPath = path.join(tempDir, 'temp.json');
    if (!fs.existsSync(tempJsonPath)) return null;
    const fileContent = fs.readFileSync(tempJsonPath, 'utf8').trim();
    fs.unlinkSync(tempJsonPath);
    try {
      const parsed = JSON.parse(fileContent);
      if (parsed.levels && Array.isArray(parsed.levels)) return parsed.levels;
      if (Array.isArray(parsed)) return parsed;
    } catch (e) {
      const levelsIndex = fileContent.indexOf('"levels"');
      if (levelsIndex === -1) return null;
      const colonIndex = fileContent.indexOf(':', levelsIndex);
      const bracketIndex = fileContent.indexOf('[', colonIndex);
      if (bracketIndex === -1) return null;
      let depth = 0;
      let end = -1;
      for (let i = bracketIndex; i < fileContent.length; i++) {
        if (fileContent[i] === '[') depth++;
        else if (fileContent[i] === ']') {
          depth--;
          if (depth === 0) { end = i; break; }
        }
      }
      if (end === -1) return null;
      return JSON.parse(fileContent.substring(bracketIndex, end + 1));
    }
    return null;
  } catch (e) {
    return null;
  }
}

function runFindTranslevels(resultSfcPath, resultSha1, tempDir) {
  try {
    const translevelsOutputPath = path.join(tempDir, `${resultSha1}_translevel.json`);
    const result = spawnSync(
      'python3',
      ['findtranslevels/find_translevels.py', `--romfile=${resultSfcPath}`, `--output=${translevelsOutputPath}`],
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], cwd: process.cwd() }
    );
    if (result.status === 0 && fs.existsSync(translevelsOutputPath)) {
      return JSON.parse(fs.readFileSync(translevelsOutputPath, 'utf8'));
    }
    return null;
  } catch (e) {
    return null;
  }
}

function scorePrimaryBps(bpsFiles) {
  const processor = new PatchProcessor(null, {});
  const scored = processor.scorePatchFiles(
    bpsFiles.map(b => ({ filename: b.filename, type: 'bps', size: b.size }))
  );
  return scored[0] ? scored[0].filename : (bpsFiles[0] && bpsFiles[0].filename);
}

function buildBpsIndexJson(opts) {
  const {
    game, enhancedGameName, gameDate, bpsFile, bpsFilename, indexJsonFilename,
    resultHash, resultSha256, resultSha224, resultDataLength, smcRomSha1, smc2RomSha256,
    bpsSha1, bpsSha256, originalFilename, uploadEstimate, zipContentTimestamp,
    detectedLanguages, levelnames, lmFilterData, translevelData, syntheticSfcFilename,
    titleWithLang, firstAuthor, typeMapping, estimatedLanguage, languageTag
  } = opts;

  const sectionKey = getSmwcSectionKey(game.section);
  const parentDirName = getParentDirectoryName(typeMapping.fields_type);
  const gameversion = {
    ...game,
    name: enhancedGameName,
    legacy_type: typeMapping.legacy_type || game.fields_type || game.difficulty,
    combinedtype: game.combinedtype || typeMapping.legacy_type || game.fields_type || game.difficulty,
    fields_type: typeMapping.fields_type || game.fields_type || null,
    difficulty: typeMapping.difficulty || game.difficulty || null,
    author: firstAuthor || game.author || null,
    authors: game.authors || null
  };

  const indexJson = {
    [sectionKey]: {
      gameid: String(game.gameid),
      name: enhancedGameName,
      url: game.url,
      download_url: game.download_url
    },
    sfcsource_filename: syntheticSfcFilename,
    bps_filename: bpsFilename,
    bps_sha1_hash: bpsSha1,
    bps_sha256_hash: bpsSha256,
    original_download_filename: originalFilename,
    source_bps_filename: bpsFile.filename,
    sfc_rom_sha1_hash: resultHash,
    sfc_rom_sha256_hash: resultSha256,
    sfc_rom_sha224_hash: resultSha224,
    sfc_rom_size: resultDataLength,
    smc_rom_sha1_hash: smcRomSha1,
    smc2_rom_sha256_hash: smc2RomSha256,
    sfc_filename_title: titleWithLang,
    sfc_filename_author: firstAuthor || game.authors,
    sfc_filename_date: gameDate,
    '7z_filename_title': titleWithLang,
    '7z_filename_author': firstAuthor || game.authors,
    '7z_filename_date': gameDate,
    estimated_language: estimatedLanguage,
    sfc_upload_estimate: uploadEstimate || new Date().toISOString(),
    dir_upload_estimate: uploadEstimate || new Date().toISOString(),
    '7z_upload_estimate': uploadEstimate || new Date().toISOString(),
    sfc_parent_directory: parentDirName,
    '7z_parent_directory': parentDirName,
    zip_parent_directory: parentDirName,
    zip_content_filename: bpsFile.filename,
    zip_content_timestamp: zipContentTimestamp,
    '7z_content_filename': bpsFile.filename,
    '7z_content_timestamp': zipContentTimestamp,
    gameversion,
    index7z_name: null,
    index7z_ipfs_cidv1: null,
    indexbps_name: bpsFilename,
    levelnames: levelnames || null,
    translevel_data: translevelData || null
  };
  if (lmFilterData && Array.isArray(lmFilterData)) {
    indexJson.lmfilter = lmFilterData;
  }
  return { indexJson, indexJsonFilename };
}

function buildSmwchack7z(catalogDir, gameid, gameData, options = {}) {
  const includeExtras = options.includeExtras !== false;
  const jsonFiles = gameData.json_files || [];
  const bpsFiles = gameData.bps_files || [];
  const screenshotFiles = gameData.screenshot_files || [];
  const buildDir = getCatalogBuildDir(catalogDir);
  fs.mkdirSync(buildDir, { recursive: true });
  const archivePath = path.join(buildDir, `smwchack_${gameid}.7z`);

  const filesToAdd = [];
  filesToAdd.push(`games/${gameid}.json`);
  for (const jf of jsonFiles) {
    if (fs.existsSync(path.join(catalogDir, 'bpsindex', jf))) {
      filesToAdd.push(`bpsindex/${jf}`);
    }
  }
  for (const bf of bpsFiles) {
    if (fs.existsSync(path.join(catalogDir, 'bps', bf))) {
      filesToAdd.push(`bps/${bf}`);
    }
  }
  for (const sf of screenshotFiles) {
    const p = path.join(catalogDir, 'images', String(gameid), sf);
    if (fs.existsSync(p)) filesToAdd.push(`images/${gameid}/${sf}`);
  }

  const extrasDir = path.join(catalogDir, 'extras');
  if (includeExtras && fs.existsSync(extrasDir)) {
    for (const rel of listExtrasUnder(extrasDir, String(gameid))) {
      filesToAdd.push(`extras/${gameid}/${rel.replace(/\\/g, '/')}`);
    }
    for (const bf of bpsFiles) {
      const hash = bf.replace(/\.bps$/, '');
      const hash2 = hash.slice(0, 2);
      const subPath = path.join(hash2, hash);
      for (const rel of listExtrasUnder(extrasDir, subPath)) {
        filesToAdd.push(`extras/${hash2}/${hash}/${rel.replace(/\\/g, '/')}`);
      }
    }
  }

  if (filesToAdd.length === 0) {
    throw new Error('No files to add to smwchack 7z archive');
  }

  const args = ['a', '-t7z', '-y', archivePath, ...filesToAdd];
  const result = spawnSync('7z', args, { cwd: catalogDir, stdio: 'pipe', encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`7z failed: ${result.stderr || result.stdout || 'unknown error'}`);
  }
  return { archivePath, filesAdded: filesToAdd.length };
}

function resolveUpdateJsonPath(gamesDir, gameid, ts) {
  let candidate = path.join(gamesDir, `${gameid}_update${ts}.json`);
  if (!fs.existsSync(candidate)) return candidate;
  const tsFull = ts + String(new Date().getHours()).padStart(2, '0')
    + String(new Date().getMinutes()).padStart(2, '0')
    + String(new Date().getSeconds()).padStart(2, '0');
  return path.join(gamesDir, `${gameid}_update${tsFull}.json`);
}

function writeAbbreviatedUpdateJson(opts) {
  const {
    catalogDir, gameid, metadata, version, latestVersion, changedFields, dryRun, logFn = console.log
  } = opts;
  const game = normalizeMetadata(metadata, gameid);
  const ts = formatDateStamp();
  const gamesDir = path.join(catalogDir, 'games');
  fs.mkdirSync(gamesDir, { recursive: true });
  const outPath = resolveUpdateJsonPath(gamesDir, String(gameid), ts);

  const payload = {
    update_type: 'metadata',
    gameid: String(gameid),
    update_timestamp: new Date().toISOString(),
    version: version != null ? version : (latestVersion && latestVersion.version),
    pat_sha224: latestVersion ? latestVersion.pat_sha224 : null,
    name: game.name,
    url: game.url,
    download_url: game.download_url,
    gvjsondata: game,
    changed_fields: changedFields || null
  };

  if (dryRun) {
    logFn(`  [DRY RUN] Would write abbreviated catalog update: ${outPath}`);
    return { ok: true, path: outPath, dryRun: true };
  }

  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
  logFn(`  Catalog: wrote abbreviated update JSON ${outPath}`);
  return { ok: true, path: outPath };
}

async function exportCatalogForGame(opts) {
  const {
    catalogDir,
    gameid,
    metadata,
    zipPath,
    flipsPath,
    baseRomPath,
    tempDir,
    argv = {},
    dryRun = false,
    logFn = console.log
  } = opts;

  const game = normalizeMetadata(metadata, gameid);
  const gid = String(gameid);
  const dirs = {
    bps: path.join(catalogDir, 'bps'),
    bpsindex: path.join(catalogDir, 'bpsindex'),
    games: path.join(catalogDir, 'games'),
    images: path.join(catalogDir, 'images'),
    extras: path.join(catalogDir, 'extras')
  };

  if (!zipPath || !fs.existsSync(zipPath)) {
    return { ok: false, errors: [`ZIP not found: ${zipPath}`] };
  }

  let originalFilename = game.original_download_filename;
  if (!originalFilename && game.download_url) {
    originalFilename = game.download_url.split('/').pop();
  }
  let uploadEstimate = null;
  try {
    uploadEstimate = fs.statSync(zipPath).mtime.toISOString();
  } catch (e) {
    uploadEstimate = new Date().toISOString();
  }

  let gameDate;
  if (game.time) {
    gameDate = new Date(game.time * 1000).toISOString().split('T')[0];
  } else {
    gameDate = extractDateFromUrl(game.download_url) || game.date || new Date().toISOString().split('T')[0];
  }
  const enhancedGameName = enhanceGameNameForCatalog(game, gameDate);

  const skipImages = shouldSkipCatalogImages(gid, argv);
  const skip7z = shouldSkipCatalog7z(gid, argv);

  if (dryRun) {
    logFn(`  [DRY RUN] Would export catalog for ${gid} to ${catalogDir}`);
    if (!skip7z) {
      logFn(`  [DRY RUN] Would build ${getCatalogBuildDir(catalogDir)}/smwchack_${gid}.7z`);
    }
    return { ok: true, dryRun: true, primaryHash: null };
  }

  for (const d of Object.values(dirs)) {
    fs.mkdirSync(d, { recursive: true });
  }
  fs.mkdirSync(tempDir, { recursive: true });

  const errors = [];
  let screenshotFiles = [];
  if (!skipImages) {
    try {
      screenshotFiles = await downloadGameImages(game, gid, dirs.images, logFn);
      const existing = getExistingScreenshotFiles(gid, dirs.images);
      screenshotFiles = [...new Set([...screenshotFiles, ...existing])].sort();
    } catch (e) {
      errors.push(`Images: ${e.message}`);
    }
  } else {
    screenshotFiles = getExistingScreenshotFiles(gid, dirs.images);
  }

  const bpsFiles = extractBpsFiles(zipPath);
  if (bpsFiles.length === 0) {
    return { ok: false, errors: ['No BPS files found in ZIP'] };
  }

  const detectedLanguages = new Set();
  for (const bpsFile of bpsFiles) {
    detectedLanguages.add(detectLanguageFromFilename(bpsFile.filename));
  }

  const gameResults = {
    ...game,
    gameid: gid,
    name: enhancedGameName,
    original_download_filename: originalFilename,
    screenshot_files: screenshotFiles,
    bps_files: [],
    json_files: [],
    errors: []
  };

  const processedBps = [];
  const zip = new AdmZip(zipPath);
  const typeMapping = mapTypeAndDifficulty(game);
  const firstAuthor = extractFirstAuthor(game.authors);

  for (const bpsFile of bpsFiles) {
    try {
      logFn(`  Catalog: processing BPS ${bpsFile.filename}`);
      const bpsData = zip.readFile(bpsFile.entry);
      if (!bpsData) throw new Error('Failed to extract BPS from ZIP');

      const tempBpsPath = path.join(tempDir, `catalog_${gid}_${Date.now()}_${Math.random().toString(36).slice(2)}.bps`);
      const tempResultPath = path.join(tempDir, `catalog_result_${gid}_${Date.now()}_${Math.random().toString(36).slice(2)}.sfc`);
      fs.writeFileSync(tempBpsPath, bpsData);

      const patchResult = testPatchBps(tempBpsPath, tempResultPath, flipsPath, baseRomPath);
      if (!patchResult.success) {
        gameResults.errors.push(`BPS ${bpsFile.filename}: ${patchResult.error}`);
        try { fs.unlinkSync(tempBpsPath); } catch (e) { /* ignore */ }
        continue;
      }

      const resultData = fs.readFileSync(tempResultPath);
      const resultHash = calculateHash(resultData, false);
      const resultSha256 = crypto.createHash('sha256').update(resultData).digest('hex');
      const resultSha224 = crypto.createHash('sha224').update(resultData).digest('hex');
      const resultDataLength = resultData.length;

      const bpsFilename = `${resultHash}.bps`;
      const bpsDest = path.join(dirs.bps, bpsFilename);
      const indexJsonFilename = `${resultHash}.json`;
      const bpsAlreadyExists = fs.existsSync(bpsDest);

      const hasHeader = detectHeader(resultData);
      const headeredData = hasHeader ? resultData : addHeader(resultData);
      const smcRomSha1 = calculateHash(headeredData, false);
      const smc2RomSha256 = calculateHash(headeredData, true);

      const zipEntryTime = bpsFile.entry.header.time;
      const zipContentTimestamp = zipEntryTime
        ? new Date(zipEntryTime.getTime()).toISOString().replace(/\.\d{3}Z$/, '')
        : null;

      let levelnames = null;
      let lmFilterData = null;
      let translevelData = null;
      if (!bpsAlreadyExists) {
        levelnames = runLevelReader(tempResultPath);
        lmFilterData = await runLmFilter(tempResultPath, resultHash, tempDir);
        translevelData = runFindTranslevels(tempResultPath, resultHash, tempDir);
      }

      if (!bpsAlreadyExists) {
        const tempBpsFinal = `${bpsDest}.tmp`;
        fs.writeFileSync(tempBpsFinal, bpsData);
        fs.renameSync(tempBpsFinal, bpsDest);
      }

      const bpsSha1 = calculateHash(bpsData, false);
      const bpsSha256 = calculateHash(bpsData, true);
      const detectedLanguage = detectLanguageFromFilename(bpsFile.filename);
      let languageTag = '';
      if (detectedLanguages.size > 1) {
        if (detectedLanguage === 'English') languageTag = '[Lang EN]';
        else if (detectedLanguage) languageTag = getLanguageTag(detectedLanguage);
        else languageTag = '[Lang Non-EN]';
      } else {
        languageTag = getLanguageTag(detectedLanguage);
      }
      const estimatedLanguage = detectedLanguage || 'English';
      const syntheticSfcFilename = createSyntheticFilename(
        enhancedGameName, firstAuthor || game.authors, gameDate, languageTag
      );
      const titleWithLang = languageTag ? `${enhancedGameName} ${languageTag}` : enhancedGameName;

      const { indexJson } = buildBpsIndexJson({
        game, enhancedGameName, gameDate, bpsFile, bpsFilename, indexJsonFilename,
        resultHash, resultSha256, resultSha224, resultDataLength, smcRomSha1, smc2RomSha256,
        bpsSha1, bpsSha256, originalFilename, uploadEstimate, zipContentTimestamp,
        detectedLanguages, levelnames, lmFilterData, translevelData, syntheticSfcFilename,
        titleWithLang, firstAuthor, typeMapping, estimatedLanguage, languageTag
      });

      const indexPath = path.join(dirs.bpsindex, indexJsonFilename);
      fs.writeFileSync(indexPath, JSON.stringify(indexJson, null, 2));

      gameResults.bps_files.push(bpsFilename);
      gameResults.json_files.push(indexJsonFilename);
      processedBps.push({ hash: resultHash, filename: bpsFilename, source_filename: bpsFile.filename });

      try { fs.unlinkSync(tempBpsPath); } catch (e) { /* ignore */ }
      if (bpsAlreadyExists) {
        try { fs.unlinkSync(tempResultPath); } catch (e) { /* ignore */ }
      }
    } catch (e) {
      gameResults.errors.push(`BPS ${bpsFile.filename}: ${e.message}`);
    }
  }

  if (processedBps.length === 0) {
    return { ok: false, errors: gameResults.errors.length ? gameResults.errors : ['No BPS files processed successfully'] };
  }

  const primarySource = scorePrimaryBps(bpsFiles.filter(b =>
    processedBps.some(p => p.source_filename === b.filename)
  ));
  const primaryEntry = processedBps.find(p => p.source_filename === primarySource) || processedBps[0];
  const primaryHash = primaryEntry.hash;

  copyImagesToHashDir(screenshotFiles, gid, primaryHash, dirs.images);

  try {
    const hashes = processedBps.map(p => p.hash);
    extractExtrasToDir(zip, gid, hashes, dirs.extras);
  } catch (e) {
    logFn(`  Catalog: extras extraction warning: ${e.message}`);
  }

  gameResults.errors = [...gameResults.errors, ...errors];
  const wrapupPath = path.join(dirs.games, `${gid}.json`);
  fs.writeFileSync(wrapupPath, JSON.stringify(gameResults, null, 2));
  logFn(`  Catalog: wrote games/${gid}.json`);

  if (!skip7z) {
    try {
      const built = buildSmwchack7z(catalogDir, gid, gameResults);
      logFn(`  Catalog: built ${built.archivePath} (${built.filesAdded} files)`);
    } catch (e) {
      return { ok: false, errors: [...gameResults.errors, `7z build failed: ${e.message}`], gameJson: gameResults, primaryHash };
    }
  }

  return {
    ok: true,
    gameJson: gameResults,
    primaryHash,
    errors: gameResults.errors
  };
}

async function runCatalogStepForNewGame(ctx) {
  const { gameid, queueItem, argv, catalogDir, dryRun, logFn } = ctx;
  const metadata = typeof queueItem.game_metadata === 'string'
    ? JSON.parse(queueItem.game_metadata)
    : queueItem.game_metadata;
  const zipPath = queueItem.zip_path || path.join(ctx.zipsDir, `${gameid}.zip`);

  return exportCatalogForGame({
    catalogDir,
    gameid,
    metadata,
    zipPath,
    flipsPath: ctx.flipsPath,
    baseRomPath: ctx.baseRomPath,
    tempDir: ctx.tempDir,
    argv,
    dryRun,
    logFn
  });
}

async function runCatalogStepForGameUpdate(ctx) {
  const {
    gameid, metadata, zipPath, latestVersion, primaryPatchFile,
    nextVersion, argv, catalogDir, dryRun, logFn, recordCreator
  } = ctx;

  const oldPat = latestVersion ? latestVersion.pat_sha224 : null;
  const newPat = primaryPatchFile ? primaryPatchFile.pat_sha224 : null;

  if (!shouldUseFullCatalogExport(oldPat, newPat)) {
    let changedFields = null;
    if (recordCreator && latestVersion) {
      try {
        changedFields = recordCreator.findChangedFields(latestVersion, metadata);
      } catch (e) { /* ignore */ }
    }
    return writeAbbreviatedUpdateJson({
      catalogDir,
      gameid,
      metadata,
      version: nextVersion,
      latestVersion,
      changedFields,
      dryRun,
      logFn
    });
  }

  return exportCatalogForGame({
    catalogDir,
    gameid,
    metadata,
    zipPath,
    flipsPath: ctx.flipsPath,
    baseRomPath: ctx.baseRomPath,
    tempDir: ctx.tempDir,
    argv,
    dryRun,
    logFn
  });
}

module.exports = {
  resolveCatalogDir,
  getCatalogBuildDir,
  formatDateStamp,
  verifyCatalogWritable,
  verifyHomeWritable,
  shouldSkipCatalogImages,
  shouldSkipCatalog7z,
  shouldUseFullCatalogExport,
  exportCatalogForGame,
  writeAbbreviatedUpdateJson,
  buildSmwchack7z,
  buildBpsIndexJson,
  enhanceGameNameForCatalog,
  getSmwcSectionKey,
  runCatalogStepForNewGame,
  runCatalogStepForGameUpdate,
  parseIdList
};
