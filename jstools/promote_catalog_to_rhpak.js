#!/usr/bin/env node

/**
 * promote_catalog_to_rhpak.js - Promote search catalog item to RHPAK file
 *
 * Creates a complete RHPAK from an index7z JSON and BPS file.
 * Reuses logic from catalog:create-rhpak IPC handler.
 *
 * Usage:
 *   enode.sh ~/rhplay/jstools/promote_catalog_to_rhpak.js --from-json <path> --bps-path <path> [options]
 *
 * Options:
 *   --from-json <path>    Index7z JSON file (required)
 *   --bps-path <path>     Path to BPS file (required)
 *   --metadata-file <path> Extra JSON to merge into gameversion
 *   --add-screenshots <dir> Add screenshots from directory
 *   --output <path>       Output RHPAK path (default: <uuid>.rhpak)
 *   --help                Show this help message
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const CONFIG = {
  JSTOOLS_DIR: __dirname,
  PROJECT_ROOT: path.resolve(__dirname, '..')
};

function uuidFromSha256(sha256) {
  if (!sha256 || sha256.length < 32) return crypto.randomUUID();
  const hex = sha256.substring(0, 32);
  return `${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20, 32)}`;
}

function loadItemJson(fromJson) {
  const raw = fs.readFileSync(fromJson, 'utf8');
  return JSON.parse(raw);
}

async function createRhpak(itemJson, bpsPath, options = {}) {
  const sfcSha256 = itemJson.sfc_rom_sha256_hash || itemJson.sfc_rom_sha1_hash || crypto.randomUUID().replace(/-/g, '').substring(0, 64);
  const itemId = itemJson.sfc_rom_sha1_hash || itemJson.sfc_rom_sha256_hash?.substring(0, 40) || sfcSha256.substring(0, 40);

  const deterministicUuid = uuidFromSha256(sfcSha256);
  const deterministicGvuuid = itemJson.gameversion?.gvuuid || uuidFromSha256(sfcSha256);

  const tempDir = path.join(os.tmpdir(), `promote-rhpak-${Date.now()}`);
  fs.mkdirSync(tempDir, { recursive: true });

  const bpsFileName = path.basename(bpsPath);
  const bpsDestPath = path.join(tempDir, bpsFileName);
  fs.copyFileSync(bpsPath, bpsDestPath);
  const bpsRelativePath = bpsFileName;

  const title = itemJson.title || itemJson.gameversion?.name || itemJson.sfc_filename_title || itemJson['7z_filename_title'] || null;
  const versionInfo = itemJson.versioninfo || itemJson.gameversion?.version || itemJson.sfc_filename_versioninfo || itemJson['7z_filename_versioninfo'] || null;
  const author = itemJson.author || itemJson.gameversion?.author || itemJson.sfc_filename_author || itemJson['7z_filename_author'] || null;

  const catalogPrefix = `catalog_${itemId.substring(0, 8)}`;
  let gameName;
  if (title) {
    gameName = versionInfo ? `${title} ${versionInfo} ${catalogPrefix}` : `${title} ${catalogPrefix}`;
  } else {
    gameName = catalogPrefix;
  }
  const finalAuthor = author || 'Unknown';

  const folderCategories = itemJson.folder_categories || [];
  const hasKaizo = Array.isArray(folderCategories) && folderCategories.includes('Kaizo');
  const inferredType = itemJson.gameversion?.type || itemJson.gameversion?.gametype || itemJson.type || (hasKaizo ? 'Kaizo' : 'Standard');

  let gameversion = {
    ...(itemJson.gameversion || {}),
    gvuuid: deterministicGvuuid,
    gameid: itemJson.gameversion?.gameid || catalogPrefix,
    name: gameName,
    author: finalAuthor,
    version: itemJson.gameversion?.version || (versionInfo ? parseInt(String(versionInfo).replace(/[^0-9]/g, '')) || 1 : 1),
    difficulty: itemJson.gameversion?.difficulty || itemJson.difficulty || 'Intermediate',
    gametype: itemJson.gameversion?.gametype || inferredType,
    type: itemJson.gameversion?.type || inferredType,
    fields_type: itemJson.gameversion?.fields_type || (hasKaizo ? 'Kaizo' : inferredType),
    patch: bpsRelativePath,
    patch_relative_path: bpsRelativePath,
    patch_filename: bpsFileName,
    patch_local_path: bpsRelativePath
  };

  if (options.metadataFile && fs.existsSync(options.metadataFile)) {
    const extra = JSON.parse(fs.readFileSync(options.metadataFile, 'utf8'));
    gameversion = { ...gameversion, ...extra };
  }

  const skeleton = {
    metadata: {
      rhpakuuid: deterministicUuid,
      rhpakname: `${title || 'Game'}${versionInfo ? ` ${versionInfo}` : ''} - ${author || 'Unknown'}`,
      version: '0.1.1',
      gameids: gameversion.gameid ? [gameversion.gameid] : [catalogPrefix]
    },
    gameversion,
    patchblob: itemJson.patchblob || {},
    attachments: itemJson.attachments || [],
    screenshots: itemJson.screenshots || [],
    res_attachments: itemJson.res_attachments || []
  };

  if (options.addScreenshots && fs.existsSync(options.addScreenshots)) {
    const files = fs.readdirSync(options.addScreenshots).filter(f => /\.(png|jpg|jpeg|gif)$/i.test(f));
    for (const f of files) {
      const src = path.join(options.addScreenshots, f);
      const dest = path.join(tempDir, f);
      fs.copyFileSync(src, dest);
    }
    skeleton.screenshots = (skeleton.screenshots || []).concat(files.map(f => ({ filename: f })));
  }

  const skeletonPath = path.join(tempDir, 'skeleton.json');
  fs.writeFileSync(skeletonPath, JSON.stringify(skeleton, null, 2));

  const newgame = require(path.join(CONFIG.JSTOOLS_DIR, 'newgame.js'));
  const clientDbPath = process.env.CLIENTDATA_DB_PATH || path.join(CONFIG.PROJECT_ROOT, 'electron', 'clientdata.db');
  if (!fs.existsSync(clientDbPath)) {
    console.warn('clientdata.db not found, BinaryFinder may fail to locate smw.sfc');
  }

  await newgame.handlePrepare(skeletonPath, {
    baseDir: tempDir,
    clientDbPath,
    NO_PYTHON: true
  });

  let preparedSkeleton = JSON.parse(fs.readFileSync(skeletonPath, 'utf8'));
  if (preparedSkeleton.gameversion) {
    preparedSkeleton.gameversion.name = gameName;
    preparedSkeleton.gameversion.author = finalAuthor;
    preparedSkeleton.gameversion.authors = finalAuthor;
    preparedSkeleton.gameversion.gvuuid = deterministicGvuuid;
  }
  fs.writeFileSync(skeletonPath, JSON.stringify(preparedSkeleton, null, 2));

  const rhpakFileName = `${deterministicUuid}.rhpak`;
  const rhpakPath = options.output || path.join(process.cwd(), rhpakFileName);
  if (path.extname(rhpakPath) !== '.rhpak') {
    throw new Error('Output path must end with .rhpak');
  }

  await newgame.handlePackage(skeletonPath, rhpakPath);

  try {
    fs.rmSync(tempDir, { recursive: true });
  } catch (e) {
    console.warn('Could not remove temp dir:', tempDir);
  }

  return rhpakPath;
}

function main() {
  const argv = process.argv.slice(2);
  let fromJson = null;
  let bpsPath = null;
  let metadataFile = null;
  let addScreenshots = null;
  let output = null;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--from-json' && i + 1 < argv.length) fromJson = argv[++i];
    else if (argv[i] === '--bps-path' && i + 1 < argv.length) bpsPath = argv[++i];
    else if (argv[i] === '--metadata-file' && i + 1 < argv.length) metadataFile = argv[++i];
    else if (argv[i] === '--add-screenshots' && i + 1 < argv.length) addScreenshots = argv[++i];
    else if (argv[i] === '--output' && i + 1 < argv.length) output = argv[++i];
    else if (argv[i] === '--help' || argv[i] === '-h') {
      console.log(`
Usage: enode.sh promote_catalog_to_rhpak.js --from-json <path> --bps-path <path> [options]

Promote search catalog item to RHPAK file.

Options:
  --from-json <path>     Index7z JSON file (required)
  --bps-path <path>      Path to BPS file (required)
  --metadata-file <path> Extra JSON to merge into gameversion
  --add-screenshots <dir> Add screenshots from directory
  --output <path>        Output RHPAK path
  --help                 Show this help message
`);
      process.exit(0);
    }
  }

  if (!fromJson || !bpsPath) {
    console.error('Error: --from-json and --bps-path required');
    process.exit(1);
  }

  fromJson = path.resolve(fromJson);
  bpsPath = path.resolve(bpsPath);

  if (!fs.existsSync(fromJson)) {
    console.error('Error: JSON file not found:', fromJson);
    process.exit(1);
  }
  if (!fs.existsSync(bpsPath)) {
    console.error('Error: BPS file not found:', bpsPath);
    process.exit(1);
  }

  const itemJson = loadItemJson(fromJson);
  createRhpak(itemJson, bpsPath, { metadataFile, addScreenshots, output })
    .then(rhpakPath => {
      console.log('Created:', rhpakPath);
    })
    .catch(e => {
      console.error('Failed:', e.message);
      process.exit(1);
    });
}

if (require.main === module) {
  main();
}

module.exports = { createRhpak, loadItemJson, CONFIG };
