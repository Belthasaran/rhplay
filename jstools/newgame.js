#!/usr/bin/env node

/**
 * newgame.js - Interactive utility for preparing and managing game submissions.
 *
 * Usage (run with enode.sh):
 *   enode.sh jstools/newgame.js <json-file> --create   # interactive skeleton wizard
 *   enode.sh jstools/newgame.js <json-file> --check    # validate JSON + database state
 *   enode.sh jstools/newgame.js <json-file> --add      # upsert records into databases
 *   enode.sh jstools/newgame.js <json-file> --remove   # remove records created from JSON
 *
 * General options:
 *   --rhdatadb=/path/to/rhdata.db
 *   --patchbindb=/path/to/patchbin.db
 *   --force                      # overwrite existing rows when adding
 *   --purge-files                # remove patch/blob files during --remove
 *   --help                       # show help text
 *
 * Environment overrides:
 *   RHDATA_DB_PATH
 *   PATCHBIN_DB_PATH
 *
 * Notes:
 * - The JSON skeleton captures the fields curated via gameversions/gameversion_stats tables.
 * - Patch metadata is generated from the supplied patch file path during --add.
 * - Re-running --add updates existing rows (if --force) without creating duplicates.
 * - --remove deletes database records that were previously inserted by this script.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const readline = require('readline/promises');
const { stdin, stdout } = require('process');
const Database = require('better-sqlite3');
const crc = require('crc');
const crc32 = require('crc-32');
const { CID } = require('multiformats/cid');
const { sha256: multiformatsSha256 } = require('multiformats/hashes/sha2');
const jssha = require('jssha');
const { spawnSync } = require('child_process');

const SCRIPT_VERSION = '0.1.0';

const DEFAULT_RHDATA_DB_PATH = process.env.RHDATA_DB_PATH ||
  path.join(__dirname, '..', 'electron', 'rhdata.db');
const DEFAULT_PATCHBIN_DB_PATH = process.env.PATCHBIN_DB_PATH ||
  path.join(__dirname, '..', 'electron', 'patchbin.db');

const BLOBS_DIR = path.join(__dirname, 'blobs');
const PATCH_DIR = path.join(__dirname, 'patch');

const ALLOWED_DIFFICULTIES = [
  'Newcomer', 'Casual', 'Skilled', 'Advanced', 'Expert', 'Master', 'Grandmaster'
];

const DEFAULT_TYPES = [
  'Standard', 'Kaizo', 'Puzzle', 'Tool-Assisted', 'Pit'
];

const DEFAULT_WARNINGS = [
  'None', 'Possible Photosensitivity Triggers', 'Suggestive Content or Language',
  'Violence', 'Adult Themes'
];

/**
 * Utility helpers
 */

function generateUuid() {
  return crypto.randomUUID();
}

function generateGameId() {
  const now = new Date();
  const parts = [
    now.getUTCFullYear().toString().slice(-2),
    String(now.getUTCMonth() + 1).padStart(2, '0'),
    String(now.getUTCDate()).padStart(2, '0'),
    String(now.getUTCHours()).padStart(2, '0'),
    String(now.getUTCMinutes()).padStart(2, '0'),
    String(now.getUTCSeconds()).padStart(2, '0')
  ];
  return `new${parts.join('')}_${now.getUTCMilliseconds().toString().padStart(3, '0')}`;
}

function pathToAbsolute(inputPath) {
  if (!inputPath) return '';
  if (path.isAbsolute(inputPath)) {
    return path.normalize(inputPath);
  }
  return path.normalize(path.join(process.cwd(), inputPath));
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function shake128Base64Url(buffer, outputBits = 192) {
  const sha = new jssha('SHAKE128', 'ARRAYBUFFER');
  sha.update(buffer);
  const hex = sha.getHash('HEX', { outputLen: outputBits });
  const raw = Buffer.from(hex, 'hex');
  return raw.toString('base64')
    .replace(/\+/g, '_')
    .replace(/\//g, '-')
    .replace(/=+$/g, '');
}

function sha224(buffer) {
  return crypto.createHash('sha224').update(buffer).digest('hex');
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function sha1(buffer) {
  return crypto.createHash('sha1').update(buffer).digest('hex');
}

function md5(buffer) {
  return crypto.createHash('md5').update(buffer).digest('hex');
}

async function computeIpfsCids(buffer) {
  const hash = await multiformatsSha256.digest(buffer);
  const cidV0 = CID.createV0(hash);
  const cidV1 = CID.createV1(0x70, hash);
  return {
    cidV0: cidV0.toString(),
    cidV1: cidV1.toString()
  };
}

function crc16(buffer) {
  return crc.crc16(buffer).toString(16).padStart(4, '0');
}

function crc32Hex(buffer) {
  return (crc32.buf(buffer) >>> 0).toString(16).padStart(8, '0');
}

function loadSkeleton(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Failed to read skeleton JSON: ${error.message}`);
  }
}

function defaultSkeleton() {
  return {
    metadata: {
      script: 'newgame.js',
      version: SCRIPT_VERSION,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    },
    gameversion: {
      gvuuid: generateUuid(),
      gameid: generateGameId(),
      section: 'smwhacks',
      based_against: 'SMW',
      version: 1,
      removed: 0,
      obsoleted: 0,
      moderated: 0,
      featured: 0,
      name: '',
      gametype: '',
      difficulty: '',
      raw_difficulty: 'diff_3',
      type: '',
      warnings: [],
      tags: [],
      author: '',
      authors: '',
      submitter: '',
      legacy_type: '',
      url: '',
      download_url: '',
      name_href: '',
      author_href: '',
      obsoleted_by: '',
      description: '',
      length: '',
      demo: 'No',
      sa1: 'No',
      collab: 'No',
      screenshots: [],
      patch_filename: '',
      patch_local_path: '',
      patch_notes: '',
      submission_notes: ''
    },
    gameversion_stats: {
      download_count: 0,
      view_count: 0,
      comment_count: 0,
      rating_value: null,
      rating_count: 0,
      favorite_count: 0,
      hof_status: null,
      featured_status: null
    },
    patchblob: {
      pbuuid: generateUuid(),
      patchblob1_name: null,
      patchblob1_sha224: null,
      patchblob1_key: null,
      pat_sha1: null,
      pat_sha224: null,
      pat_shake_128: null,
      result_sha1: null,
      result_sha224: null,
      result_shake1: null,
      patch_name: null
    },
    attachment: {
      auuid: generateUuid(),
      file_name: null,
      download_urls: []
    }
  };
}

function saveSkeleton(filePath, data) {
  const clone = { ...data };
  clone.metadata = {
    ...(clone.metadata || {}),
    updated_at: new Date().toISOString(),
    version: SCRIPT_VERSION,
    script: 'newgame.js'
  };
  fs.writeFileSync(filePath, JSON.stringify(clone, null, 2) + os.EOL);
}

function findEditorCommand() {
  if (process.platform === 'win32') {
    const winDir = process.env.WINDIR || 'C:\\Windows';
    const candidates = [
      path.join(winDir, 'System32', 'edit.exe'),
      path.join(winDir, 'System32', 'edit.com')
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return { command: candidate, args: [] };
      }
    }
    return null;
  }
  const editorPath = '/usr/bin/editor';
  if (fs.existsSync(editorPath)) {
    return { command: editorPath, args: [] };
  }
  return null;
}

async function editDescriptionWithEditor(initialText) {
  const editor = findEditorCommand();
  if (!editor) {
    return { status: 'unavailable' };
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rhtools-desc-'));
  const tmpFile = path.join(tmpDir, 'description.txt');
  fs.writeFileSync(tmpFile, initialText || '', 'utf8');

  try {
    const result = spawnSync(editor.command, [...editor.args, tmpFile], { stdio: 'inherit' });
    if (result.error) {
      console.log(`  ⚠ Failed to launch editor: ${result.error.message}`);
      return { status: 'failed', text: initialText || '' };
    }
    if (result.status !== 0) {
      console.log(`  ⚠ Editor exited with code ${result.status}; keeping existing description.`);
      return { status: 'failed', text: initialText || '' };
    }
    const edited = fs.readFileSync(tmpFile, 'utf8').replace(/\r\n/g, '\n');
    return { status: 'success', text: edited };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function promptMultilineDescription(rl, initialText) {
  console.log('\nEnter description text. Finish with a single "." on its own line.');
  if (initialText) {
    console.log('Press Enter without typing anything to keep the existing description.');
  } else {
    console.log('Provide at least one line, then use "." on a line by itself to finish.');
  }

  const lines = [];
  let isFirstLine = true;

  while (true) {
    const line = await rl.question('> ');
    if (isFirstLine && line === '' && initialText !== undefined && initialText !== null && initialText !== '') {
      console.log('  ↻ Keeping existing description.');
      return initialText;
    }
    if (line === '.') {
      break;
    }
    lines.push(line);
    isFirstLine = false;
  }

  return lines.join('\n');
}

/**
 * CLI argument parsing
 */
function parseArgs(argv) {
  const args = argv.slice(2);
  const config = {
    mode: null,
    jsonPath: null,
    rhdataPath: DEFAULT_RHDATA_DB_PATH,
    patchbinPath: DEFAULT_PATCHBIN_DB_PATH,
    force: false,
    purgeFiles: false
  };

  for (const arg of args) {
    if (!config.jsonPath && !arg.startsWith('--')) {
      config.jsonPath = pathToAbsolute(arg);
      continue;
    }
    if (arg === '--create' || arg === '--check' || arg === '--add' || arg === '--remove') {
      if (config.mode) {
        throw new Error('Only one mode flag can be provided (--create, --check, --add, --remove)');
      }
      config.mode = arg.slice(2);
      continue;
    }
    if (arg.startsWith('--rhdatadb=')) {
      config.rhdataPath = path.normalize(arg.split('=')[1]);
      continue;
    }
    if (arg.startsWith('--patchbindb=')) {
      config.patchbinPath = path.normalize(arg.split('=')[1]);
      continue;
    }
    if (arg === '--force') {
      config.force = true;
      continue;
    }
    if (arg === '--purge-files') {
      config.purgeFiles = true;
      continue;
    }
    if (arg === '--help') {
      config.mode = 'help';
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!config.mode) {
    config.mode = 'help';
  }

  if (config.mode !== 'help' && !config.jsonPath) {
    throw new Error('JSON file path is required as the first argument.');
  }

  return config;
}

function printHelp() {
  const lines = [
    'Usage: enode.sh jstools/newgame.js <json-file> [mode] [options]',
    '',
    'Modes (exactly one):',
    '  --create       Run interactive wizard to build or update the skeleton JSON',
    '  --check        Validate skeleton contents and database state',
    '  --add          Upsert records into rhdata.db and patchbin.db',
    '  --remove       Remove records inserted for the skeleton',
    '',
    'Options:',
    '  --rhdatadb=PATH     Override rhdata.db location (default from env or electron/rhdata.db)',
    '  --patchbindb=PATH   Override patchbin.db location',
    '  --force             Allow overwriting existing entries during --add',
    '  --purge-files       Delete stored patch/blob files during --remove',
    '  --help              Show this message',
    '',
    'Examples:',
    '  enode.sh jstools/newgame.js data/newhack.json --create',
    '  enode.sh jstools/newgame.js data/newhack.json --check',
    '  enode.sh jstools/newgame.js data/newhack.json --add --force',
    '  enode.sh jstools/newgame.js data/newhack.json --remove --purge-files'
  ];
  console.log(lines.join('\n'));
}

/**
 * Interactive prompt helpers
 */

async function ask(rl, question, defaultValue = '', { allowEmpty = false, parser = (v) => v } = {}) {
  const suffix = defaultValue ? ` [${defaultValue}]` : '';
  const answer = await rl.question(`${question}${suffix}: `);
  if (!answer && defaultValue !== undefined) {
    if (!allowEmpty && defaultValue === '') {
      return parser(answer.trim());
    }
    return parser(defaultValue);
  }
  if (!allowEmpty && !answer.trim()) {
    return parser(defaultValue);
  }
  return parser(answer.trim());
}

async function askChoice(rl, question, choices, defaultValue = '') {
  const display = `${question} (${choices.join('/')})`;
  return ask(rl, display, defaultValue, {
    parser: (value) => {
      if (!value) return defaultValue;
      const normalized = value.trim();
      if (choices.includes(normalized)) {
        return normalized;
      }
      console.log(`  ⚠ Invalid choice. Expected one of: ${choices.join(', ')}`);
      return defaultValue || choices[0];
    }
  });
}

async function runCreateWizard(filePath, skeleton) {
  console.log('Interactive new game wizard\n');
  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    const gv = skeleton.gameversion;

    gv.name = await ask(rl, 'Game name', gv.name);
    gv.gameid = await ask(rl, 'Game ID', gv.gameid);
    gv.version = parseInt(await ask(rl, 'Version number', gv.version.toString()), 10) || 1;
    gv.section = await ask(rl, 'Section', gv.section || 'smwhacks');
    gv.based_against = await ask(rl, 'Based against', gv.based_against || 'SMW');
    gv.gametype = await ask(rl, 'Game type / category', gv.gametype);
    gv.type = await askChoice(rl, 'Type label', [...DEFAULT_TYPES, 'Custom'], gv.type || DEFAULT_TYPES[0]);
    gv.difficulty = await askChoice(rl, 'Difficulty', ALLOWED_DIFFICULTIES, gv.difficulty || ALLOWED_DIFFICULTIES[0]);
    gv.raw_difficulty = await ask(rl, 'Raw difficulty code (diff_N)', gv.raw_difficulty || `diff_${Math.min(ALLOWED_DIFFICULTIES.indexOf(gv.difficulty) + 1, 7)}`);
    gv.length = await ask(rl, 'Length (e.g. "12 exit(s)")', gv.length || '');
    gv.demo = await askChoice(rl, 'Demo (Yes/No)', ['Yes', 'No'], gv.demo || 'No');
    gv.sa1 = await askChoice(rl, 'SA-1 (Yes/No)', ['Yes', 'No'], gv.sa1 || 'No');
    gv.collab = await askChoice(rl, 'Collab (Yes/No)', ['Yes', 'No'], gv.collab || 'No');
    gv.author = await ask(rl, 'Primary author', gv.author || '');
    gv.authors = await ask(rl, 'Author list (comma separated)', gv.authors || '');
    gv.submitter = await ask(rl, 'Submitter username', gv.submitter || gv.author);
    gv.legacy_type = await ask(rl, 'Legacy type (optional)', gv.legacy_type || '');
    gv.url = await ask(rl, 'Info URL (optional)', gv.url || '');
    gv.download_url = await ask(rl, 'Author download URL (optional)', gv.download_url || '');
    gv.name_href = await ask(rl, 'Name href (optional)', gv.name_href || '');
    gv.author_href = await ask(rl, 'Author href (optional)', gv.author_href || '');
    gv.obsoleted_by = await ask(rl, 'Obsoleted by (gameid)', gv.obsoleted_by || '');
    const editDescriptionChoice = await askChoice(rl, 'Edit Description', ['Yes', 'No'], 'No');
    if (editDescriptionChoice.toLowerCase() === 'yes') {
      const editorResult = await editDescriptionWithEditor(gv.description || '');
      if (editorResult.status === 'success') {
        gv.description = editorResult.text;
      } else if (editorResult.status === 'unavailable') {
        console.log('  ⚠ No external editor available; please enter the description below.');
        gv.description = await promptMultilineDescription(rl, gv.description || '');
      } else {
        gv.description = editorResult.text;
      }
    } else {
      gv.description = await promptMultilineDescription(rl, gv.description || '');
    }

    const tagAnswer = await ask(rl, 'Tags (comma separated)', (gv.tags || []).join(', '), { allowEmpty: true });
    gv.tags = tagAnswer ? tagAnswer.split(',').map((t) => t.trim()).filter(Boolean) : [];

    const warningAnswer = await ask(rl, 'Warnings (comma separated)', (gv.warnings || []).join(', '), { allowEmpty: true });
    gv.warnings = warningAnswer ? warningAnswer.split(',').map((t) => t.trim()).filter(Boolean) : [];

    const screenshotAnswer = await ask(rl, 'Screenshots (comma separated paths or URLs)', (gv.screenshots || []).join(', '), { allowEmpty: true });
    gv.screenshots = screenshotAnswer ? screenshotAnswer.split(',').map((t) => t.trim()).filter(Boolean) : [];

    gv.patch_local_path = pathToAbsolute(await ask(rl, 'Patch file path (.bps/.zip)', gv.patch_local_path || ''));
    gv.patch_filename = await ask(rl, 'Patch filename label', gv.patch_filename || path.basename(gv.patch_local_path || ''));
    gv.patch_notes = await ask(rl, 'Patch notes (optional)', gv.patch_notes || '');
    gv.submission_notes = await ask(rl, 'Submission notes (optional)', gv.submission_notes || '');

    skeleton.metadata.updated_at = new Date().toISOString();

    saveSkeleton(filePath, skeleton);
    console.log(`\n✓ Skeleton saved to ${filePath}`);
  } finally {
    rl.close();
  }
}

/**
 * Validation
 */

function validateSkeleton(skeleton, options = {}) {
  const issues = [];
  const gv = skeleton.gameversion || {};

  if (!gv.name) {
    issues.push({ level: 'error', message: 'Game name is required.' });
  }
  if (!gv.gameid) {
    issues.push({ level: 'error', message: 'Game ID is required.' });
  }
  if (!gv.gvuuid) {
    issues.push({ level: 'error', message: 'gvuuid is missing.' });
  }
  if (!gv.patch_local_path) {
    issues.push({ level: 'error', message: 'Patch file path is required.' });
  } else if (!fs.existsSync(gv.patch_local_path)) {
    issues.push({ level: 'error', message: `Patch file not found: ${gv.patch_local_path}` });
  }
  if (!ALLOWED_DIFFICULTIES.includes(gv.difficulty)) {
    issues.push({ level: 'warning', message: `Difficulty "${gv.difficulty}" is not in canonical list.` });
  }

  if (!gv.type) {
    issues.push({ level: 'warning', message: 'Type label is empty.' });
  }

  if (!gv.author) {
    issues.push({ level: 'warning', message: 'Author is empty.' });
  }

  if (!skeleton.patchblob || !skeleton.patchblob.pbuuid) {
    issues.push({ level: 'warning', message: 'Patch blob UUID missing. It will be generated during --add.' });
  }
  if (!skeleton.attachment || !skeleton.attachment.auuid) {
    issues.push({ level: 'warning', message: 'Attachment UUID missing. It will be generated during --add.' });
  }

  if (options.rhdataPath && !fs.existsSync(options.rhdataPath)) {
    issues.push({ level: 'error', message: `rhdata.db not found: ${options.rhdataPath}` });
  }
  if (options.patchbinPath && !fs.existsSync(options.patchbinPath)) {
    issues.push({ level: 'error', message: `patchbin.db not found: ${options.patchbinPath}` });
  }
  return issues;
}

function printIssues(issues) {
  if (!issues.length) {
    console.log('✓ No validation issues detected.');
    return;
  }
  const sorted = issues.sort((a, b) => (a.level === b.level ? 0 : a.level === 'error' ? -1 : 1));
  for (const issue of sorted) {
    const icon = issue.level === 'error' ? '✗' : '⚠';
    console.log(`${icon} ${issue.message}`);
  }
}

function summarizeDatabaseState(dbPaths, skeleton) {
  const summary = [];
  const { rhdataPath, patchbinPath } = dbPaths;
  const gv = skeleton.gameversion;
  try {
    if (fs.existsSync(rhdataPath)) {
      const db = new Database(rhdataPath, { readonly: true });
      try {
        const existing = db.prepare('SELECT gvuuid FROM gameversions WHERE gameid = ? AND version = ?').get(gv.gameid, gv.version);
        if (existing) {
          summary.push(`ℹ gameversions entry already exists for ${gv.gameid} v${gv.version} (gvuuid=${existing.gvuuid})`);
        } else {
          summary.push(`✓ gameversions slot available for ${gv.gameid} v${gv.version}`);
        }
        const stats = db.prepare('SELECT gameid FROM gameversion_stats WHERE gameid = ?').get(gv.gameid);
        if (stats) {
          summary.push(`ℹ gameversion_stats entry exists for ${gv.gameid}`);
        }
        const patch = db.prepare('SELECT patchblob1_name FROM patchblobs WHERE patchblob1_name = ?').get(skeleton.patchblob.patchblob1_name || '');
        if (patch) {
          summary.push(`ℹ patchblobs entry already exists for ${patch.patchblob1_name}`);
        }
      } finally {
        db.close();
      }
    }
    if (fs.existsSync(patchbinPath) && skeleton.patchblob.patchblob1_name) {
      const db = new Database(patchbinPath, { readonly: true });
      try {
        const att = db.prepare('SELECT auuid FROM attachments WHERE file_name = ?').get(skeleton.patchblob.patchblob1_name);
        if (att) {
          summary.push(`ℹ attachments entry exists for ${skeleton.patchblob.patchblob1_name}`);
        }
      } finally {
        db.close();
      }
    }
  } catch (error) {
    summary.push(`✗ Failed to inspect database state: ${error.message}`);
  }

  for (const line of summary) {
    console.log(line);
  }
}

/**
 * Patch and attachment preparation
 */

async function preparePatchArtifacts(skeleton) {
  const gv = skeleton.gameversion;
  const patchPath = pathToAbsolute(gv.patch_local_path);
  const buffer = fs.readFileSync(patchPath);
  const stats = fs.statSync(patchPath);
  const extension = path.extname(patchPath).replace('.', '').toLowerCase();

  const patSha224 = sha224(buffer);
  const patSha1 = sha1(buffer);
  const patSha256 = sha256(buffer);
  const patShake128 = shake128Base64Url(buffer);
  const ipfsCids = await computeIpfsCids(buffer);
  const patchblobName = `pblob_${gv.gameid}_${patSha224.slice(0, 10)}`;

  return {
    buffer,
    size: stats.size,
    extension,
    patSha224,
    patSha1,
    patSha256,
    patHashMd5: md5(buffer),
    patShake128,
    crc16: crc16(buffer),
    crc32: crc32Hex(buffer),
    ipfsCidV0: ipfsCids.cidV0,
    ipfsCidV1: ipfsCids.cidV1,
    patchblobName,
    patchStoredPath: path.join(PATCH_DIR, patShake128),
    patchRelativePath: `patch/${patShake128}`,
    patchblobStoredPath: path.join(BLOBS_DIR, patchblobName)
  };
}

function ensurePatchStorage(artifact, buffer) {
  ensureDir(PATCH_DIR);
  ensureDir(BLOBS_DIR);

  if (!fs.existsSync(artifact.patchStoredPath)) {
    fs.writeFileSync(artifact.patchStoredPath, buffer);
  }
  if (!fs.existsSync(artifact.patchblobStoredPath)) {
    fs.writeFileSync(artifact.patchblobStoredPath, buffer);
  }
}

/**
 * Upsert operations
 */

function upsertGameversion(db, skeleton, artifact, options) {
  const gv = skeleton.gameversion;
  const now = new Date().toISOString();
  const tagsString = gv.tags && gv.tags.length ? JSON.stringify(gv.tags) : null;
  const warningsString = gv.warnings && gv.warnings.length ? JSON.stringify(gv.warnings) : null;
  const jsonPayload = {
    id: gv.gameid,
    gameid: gv.gameid,
    name: gv.name,
    authors: gv.authors || gv.author || '',
    author: gv.author || '',
    submitter: gv.submitter || gv.author || '',
    description: gv.description || '',
    url: gv.url || '',
    download_url: gv.download_url || '',
    length: gv.length || '',
    difficulty: gv.difficulty || '',
    raw_difficulty: gv.raw_difficulty || '',
    type: gv.type || gv.gametype || '',
    gametype: gv.gametype || '',
    based_against: gv.based_against || 'SMW',
    demo: gv.demo || 'No',
    sa1: gv.sa1 || 'No',
    collab: gv.collab || 'No',
    tags: gv.tags || [],
    warnings: gv.warnings || [],
    screenshots: gv.screenshots || [],
    patch: artifact.patchRelativePath,
    patch_filename: gv.patch_filename || path.basename(gv.patch_local_path || ''),
    pat_sha1: artifact.patSha1,
    pat_sha224: artifact.patSha224,
    pat_shake_128: artifact.patShake128,
    patchblob1_name: artifact.patchblobName,
    patchblob1_sha224: artifact.patSha224,
    patchblob1_key: null,
    submission_notes: gv.submission_notes || '',
    patch_notes: gv.patch_notes || '',
    name_href: gv.name_href || '',
    author_href: gv.author_href || '',
    obsoleted_by: gv.obsoleted_by || ''
  };

  const query = `
    INSERT INTO gameversions (
      gvuuid, section, gameid, version, removed, obsoleted, gametype, name,
      time, added, moderated, author, authors, submitter, demo, featured,
      length, difficulty, url, download_url, name_href, author_href, obsoleted_by,
      patchblob1_name, pat_sha224, size, description, gvjsondata, tags,
      tags_href, gvchange_attributes, gvchanges, fields_type, raw_difficulty,
      combinedtype, legacy_type
    )
    VALUES (
      @gvuuid, @section, @gameid, @version, @removed, @obsoleted, @gametype, @name,
      @time, @added, @moderated, @author, @authors, @submitter, @demo, @featured,
      @length, @difficulty, @url, @download_url, @name_href, @author_href, @obsoleted_by,
      @patchblob1_name, @pat_sha224, @size, @description, @gvjsondata, @tags,
      NULL, NULL, NULL, @fields_type, @raw_difficulty,
      NULL, @legacy_type
    )
    ON CONFLICT(gameid, version) DO UPDATE SET
      section = excluded.section,
      removed = excluded.removed,
      obsoleted = excluded.obsoleted,
      gametype = excluded.gametype,
      name = excluded.name,
      time = excluded.time,
      added = excluded.added,
      moderated = excluded.moderated,
      author = excluded.author,
      authors = excluded.authors,
      submitter = excluded.submitter,
      demo = excluded.demo,
      featured = excluded.featured,
      length = excluded.length,
      difficulty = excluded.difficulty,
      url = excluded.url,
      download_url = excluded.download_url,
      name_href = excluded.name_href,
      author_href = excluded.author_href,
      obsoleted_by = excluded.obsoleted_by,
      patchblob1_name = excluded.patchblob1_name,
      pat_sha224 = excluded.pat_sha224,
      size = excluded.size,
      description = excluded.description,
      gvjsondata = excluded.gvjsondata,
      tags = excluded.tags,
      fields_type = excluded.fields_type,
      raw_difficulty = excluded.raw_difficulty,
      legacy_type = excluded.legacy_type
  `;

  const params = {
    gvuuid: gv.gvuuid,
    section: gv.section || 'smwhacks',
    gameid: gv.gameid,
    version: gv.version || 1,
    removed: gv.removed || 0,
    obsoleted: gv.obsoleted || 0,
    gametype: gv.gametype || gv.type || '',
    name: gv.name,
    time: now,
    added: now,
    moderated: gv.moderated || 0,
    author: gv.author || '',
    authors: gv.authors || gv.author || '',
    submitter: gv.submitter || gv.author || '',
    demo: gv.demo || 'No',
    featured: gv.featured || 0,
    length: gv.length || '',
    difficulty: gv.difficulty || '',
    url: gv.url || '',
    download_url: gv.download_url || '',
    name_href: gv.name_href || '',
    author_href: gv.author_href || '',
    obsoleted_by: gv.obsoleted_by || '',
    patchblob1_name: artifact.patchblobName,
    pat_sha224: artifact.patSha224,
    size: artifact.size.toString(),
    description: gv.description || '',
    gvjsondata: JSON.stringify(jsonPayload),
    tags: tagsString,
    fields_type: gv.type || gv.gametype || '',
    raw_difficulty: gv.raw_difficulty || '',
    legacy_type: gv.legacy_type || ''
  };

  if (!options.force) {
    const existing = db.prepare('SELECT gvuuid FROM gameversions WHERE gameid = ? AND version = ?')
      .get(gv.gameid, gv.version);
    if (existing && existing.gvuuid !== gv.gvuuid) {
      throw new Error(`Record already exists for ${gv.gameid} v${gv.version}. Use --force to overwrite.`);
    }
  }

  db.prepare(query).run(params);
}

function upsertGameversionStats(db, skeleton) {
  const gv = skeleton.gameversion;
  const stats = skeleton.gameversion_stats || {};
  const query = `
    INSERT INTO gameversion_stats (
      gameid, gvuuid, download_count, view_count, comment_count,
      rating_value, rating_count, favorite_count, hof_status,
      featured_status, gvjsondata
    )
    VALUES (
      @gameid, @gvuuid, @download_count, @view_count, @comment_count,
      @rating_value, @rating_count, @favorite_count, @hof_status,
      @featured_status, @gvjsondata
    )
    ON CONFLICT(gameid) DO UPDATE SET
      gvuuid = excluded.gvuuid,
      download_count = excluded.download_count,
      view_count = excluded.view_count,
      comment_count = excluded.comment_count,
      rating_value = excluded.rating_value,
      rating_count = excluded.rating_count,
      favorite_count = excluded.favorite_count,
      hof_status = excluded.hof_status,
      featured_status = excluded.featured_status,
      gvjsondata = excluded.gvjsondata,
      last_updated = CURRENT_TIMESTAMP
  `;

  const payload = {
    gameid: gv.gameid,
    gvuuid: gv.gvuuid,
    download_count: stats.download_count || 0,
    view_count: stats.view_count || 0,
    comment_count: stats.comment_count || 0,
    rating_value: stats.rating_value,
    rating_count: stats.rating_count || 0,
    favorite_count: stats.favorite_count || 0,
    hof_status: stats.hof_status || null,
    featured_status: stats.featured_status || null,
    gvjsondata: JSON.stringify({
      id: gv.gameid,
      download_count: stats.download_count || 0,
      view_count: stats.view_count || 0,
      comment_count: stats.comment_count || 0,
      rating_value: stats.rating_value,
      rating_count: stats.rating_count || 0,
      favorite_count: stats.favorite_count || 0
    })
  };

  db.prepare(query).run(payload);
}

function upsertPatchblob(db, skeleton, artifact) {
  const gv = skeleton.gameversion;
  const pb = skeleton.patchblob;
  if (!pb.pbuuid) {
    pb.pbuuid = generateUuid();
  }

  const query = `
    INSERT INTO patchblobs (
      pbuuid, gvuuid, patch_name, pat_sha1, pat_sha224, pat_shake_128,
      patchblob1_key, patchblob1_name, patchblob1_sha224,
      result_sha1, result_sha224, result_shake1, pbjsondata
    )
    VALUES (
      @pbuuid, @gvuuid, @patch_name, @pat_sha1, @pat_sha224, @pat_shake_128,
      @patchblob1_key, @patchblob1_name, @patchblob1_sha224,
      @result_sha1, @result_sha224, @result_shake1, @pbjsondata
    )
    ON CONFLICT(patchblob1_name) DO UPDATE SET
      gvuuid = excluded.gvuuid,
      patch_name = excluded.patch_name,
      pat_sha1 = excluded.pat_sha1,
      pat_sha224 = excluded.pat_sha224,
      pat_shake_128 = excluded.pat_shake_128,
      patchblob1_key = excluded.patchblob1_key,
      patchblob1_sha224 = excluded.patchblob1_sha224,
      result_sha1 = excluded.result_sha1,
      result_sha224 = excluded.result_sha224,
      result_shake1 = excluded.result_shake1,
      pbjsondata = excluded.pbjsondata
  `;

  const payload = {
    pbuuid: pb.pbuuid,
    gvuuid: gv.gvuuid,
    patch_name: artifact.patchRelativePath,
    pat_sha1: artifact.patSha1,
    pat_sha224: artifact.patSha224,
    pat_shake_128: artifact.patShake128,
    patchblob1_key: pb.patchblob1_key || null,
    patchblob1_name: artifact.patchblobName,
    patchblob1_sha224: artifact.patSha224,
    result_sha1: pb.result_sha1 || null,
    result_sha224: pb.result_sha224 || null,
    result_shake1: pb.result_shake1 || null,
    pbjsondata: JSON.stringify({
      patch: artifact.patchRelativePath,
      pat_sha1: artifact.patSha1,
      pat_sha224: artifact.patSha224,
      pat_shake_128: artifact.patShake128,
      patchblob1_name: artifact.patchblobName
    })
  };

  db.prepare(query).run(payload);
  pb.patchblob1_name = artifact.patchblobName;
  pb.patchblob1_sha224 = artifact.patSha224;
  pb.pat_sha1 = artifact.patSha1;
  pb.pat_sha224 = artifact.patSha224;
  pb.pat_shake_128 = artifact.patShake128;
  pb.patch_name = artifact.patchRelativePath;
}

function upsertPatchblobExtended(db, skeleton, artifact) {
  const pb = skeleton.patchblob;
  const gv = skeleton.gameversion;
  const query = `
    INSERT INTO patchblobs_extended (
      pbuuid, patch_filename, patch_type, is_primary, zip_source
    )
    VALUES (
      @pbuuid, @patch_filename, @patch_type, @is_primary, @zip_source
    )
    ON CONFLICT(pbuuid) DO UPDATE SET
      patch_filename = excluded.patch_filename,
      patch_type = excluded.patch_type,
      is_primary = excluded.is_primary,
      zip_source = excluded.zip_source
  `;

  db.prepare(query).run({
    pbuuid: pb.pbuuid,
    patch_filename: gv.patch_filename || path.basename(gv.patch_local_path || artifact.patchblobName),
    patch_type: artifact.extension || 'bps',
    is_primary: 1,
    zip_source: null
  });
}

function upsertAttachment(db, skeleton, artifact) {
  const pb = skeleton.patchblob;
  const gv = skeleton.gameversion;
  const at = skeleton.attachment;
  if (!at.auuid) {
    at.auuid = generateUuid();
  }

  const query = `
    REPLACE INTO attachments (
      auuid, pbuuid, gvuuid, resuuid,
      file_crc16, file_crc32, locators, parents,
      file_ipfs_cidv0, file_ipfs_cidv1,
      file_hash_sha224, file_hash_sha1, file_hash_md5, file_hash_sha256,
      file_name, filekey,
      decoded_ipfs_cidv0, decoded_ipfs_cidv1,
      decoded_hash_sha224, decoded_hash_sha1, decoded_hash_md5, decoded_hash_sha256,
      file_data, download_urls, file_size
    )
    VALUES (
      @auuid, @pbuuid, @gvuuid, NULL,
      @file_crc16, @file_crc32, @locators, @parents,
      @file_ipfs_cidv0, @file_ipfs_cidv1,
      @file_hash_sha224, @file_hash_sha1, @file_hash_md5, @file_hash_sha256,
      @file_name, @filekey,
      '', '', '', '', '', '',
      @file_data, @download_urls, @file_size
    )
  `;

  db.prepare(query).run({
    auuid: at.auuid,
    pbuuid: pb.pbuuid,
    gvuuid: gv.gvuuid,
    file_crc16: artifact.crc16,
    file_crc32: artifact.crc32,
    locators: JSON.stringify([]),
    parents: JSON.stringify([]),
    file_ipfs_cidv0: artifact.ipfsCidV0,
    file_ipfs_cidv1: artifact.ipfsCidV1,
    file_hash_sha224: artifact.patSha224,
    file_hash_sha1: artifact.patSha1,
    file_hash_md5: artifact.patHashMd5,
    file_hash_sha256: artifact.patSha256,
    file_name: artifact.patchblobName,
    filekey: '',
    file_data: artifact.buffer,
    download_urls: (at.download_urls || []).concat(gv.download_url ? [gv.download_url] : []).join(','),
    file_size: artifact.size
  });

  at.file_name = artifact.patchblobName;
}

function upsertPatchRecord(db, skeleton, artifact) {
  const gv = skeleton.gameversion;
  const query = `
    INSERT INTO rhpatches (rhpuuid, gameid, patch_name)
    VALUES (@rhpuuid, @gameid, @patch_name)
    ON CONFLICT(patch_name) DO UPDATE SET
      gameid = excluded.gameid
  `;
  db.prepare(query).run({
    rhpuuid: generateUuid(),
    gameid: gv.gameid,
    patch_name: artifact.patchRelativePath
  });
}

/**
 * Removal helpers
 */

function removeRecords(rhdataDb, patchbinDb, skeleton, options) {
  const gv = skeleton.gameversion;
  const pb = skeleton.patchblob;
  const at = skeleton.attachment;

  const deleteRh = rhdataDb.prepare('DELETE FROM rhpatches WHERE gameid = ?');
  const deleteStats = rhdataDb.prepare('DELETE FROM gameversion_stats WHERE gameid = ?');
  const deleteGameversion = rhdataDb.prepare('DELETE FROM gameversions WHERE gameid = ? AND version = ?');
  const deletePatchblob = rhdataDb.prepare('DELETE FROM patchblobs WHERE patchblob1_name = ?');
  const deletePatchblobExtended = rhdataDb.prepare('DELETE FROM patchblobs_extended WHERE pbuuid = ?');

  deleteRh.run(gv.gameid);
  deleteStats.run(gv.gameid);
  deleteGameversion.run(gv.gameid, gv.version);
  if (pb.patchblob1_name) {
    const existing = rhdataDb.prepare('SELECT pbuuid FROM patchblobs WHERE patchblob1_name = ?').get(pb.patchblob1_name);
    deletePatchblob.run(pb.patchblob1_name);
    if (existing) {
      deletePatchblobExtended.run(existing.pbuuid);
    }
  }

  if (pb.patchblob1_name) {
    patchbinDb.prepare('DELETE FROM attachments WHERE file_name = ?').run(pb.patchblob1_name);
  }

  if (options.purgeFiles && pb.patchblob1_name) {
    const blobPath = path.join(BLOBS_DIR, pb.patchblob1_name);
    if (fs.existsSync(blobPath)) {
      fs.unlinkSync(blobPath);
    }
  }
  if (options.purgeFiles && skeleton.patchblob.pat_shake_128) {
    const patchPath = path.join(PATCH_DIR, skeleton.patchblob.pat_shake_128);
    if (fs.existsSync(patchPath)) {
      fs.unlinkSync(patchPath);
    }
  }
}

/**
 * Mode handlers
 */

async function handleCheck(config, skeleton) {
  const issues = validateSkeleton(skeleton, {
    rhdataPath: config.rhdataPath,
    patchbinPath: config.patchbinPath
  });
  printIssues(issues);
  if (issues.some((i) => i.level === 'error')) {
    console.log('\n✗ Resolve errors above before proceeding.');
    return;
  }
  console.log('');
  summarizeDatabaseState({
    rhdataPath: config.rhdataPath,
    patchbinPath: config.patchbinPath
  }, skeleton);
}

async function handleAdd(config, skeleton) {
  const issues = validateSkeleton(skeleton, {
    rhdataPath: config.rhdataPath,
    patchbinPath: config.patchbinPath
  });
  printIssues(issues);
  if (issues.some((i) => i.level === 'error')) {
    throw new Error('Cannot add records while validation errors exist.');
  }

  const artifact = await preparePatchArtifacts(skeleton);
  ensurePatchStorage(artifact, artifact.buffer);

  const rhdataDb = new Database(config.rhdataPath);
  const patchbinDb = new Database(config.patchbinPath);
  try {
    const transactionRh = rhdataDb.transaction(() => {
      upsertGameversion(rhdataDb, skeleton, artifact, { force: config.force });
      upsertGameversionStats(rhdataDb, skeleton);
      upsertPatchblob(rhdataDb, skeleton, artifact);
      upsertPatchblobExtended(rhdataDb, skeleton, artifact);
      upsertPatchRecord(rhdataDb, skeleton, artifact);
    });
    const transactionAttachment = patchbinDb.transaction(() => {
      upsertAttachment(patchbinDb, skeleton, artifact);
    });

    transactionRh();
    transactionAttachment();
  } finally {
    rhdataDb.close();
    patchbinDb.close();
  }

  skeleton.patchblob.patchblob1_name = artifact.patchblobName;
  skeleton.patchblob.patchblob1_sha224 = artifact.patSha224;
  skeleton.patchblob.pat_sha224 = artifact.patSha224;
  skeleton.patchblob.pat_sha1 = artifact.patSha1;
  skeleton.patchblob.pat_shake_128 = artifact.patShake128;
  skeleton.patchblob.patch_name = artifact.patchRelativePath;
  skeleton.gameversion.patchblob1_name = artifact.patchblobName;
  skeleton.gameversion.pat_sha224 = artifact.patSha224;
  skeleton.gameversion.patch = artifact.patchRelativePath;
  skeleton.attachment.file_name = artifact.patchblobName;

  saveSkeleton(config.jsonPath, skeleton);
  console.log('✓ Database updated successfully.');
}

async function handleRemove(config, skeleton) {
  if (!fs.existsSync(config.rhdataPath)) {
    throw new Error(`rhdata.db not found at ${config.rhdataPath}`);
  }
  if (!fs.existsSync(config.patchbinPath)) {
    throw new Error(`patchbin.db not found at ${config.patchbinPath}`);
  }

  const rhdataDb = new Database(config.rhdataPath);
  const patchbinDb = new Database(config.patchbinPath);

  try {
    const trx = rhdataDb.transaction(() => {
      const sub = patchbinDb.transaction(() => {
        removeRecords(rhdataDb, patchbinDb, skeleton, { purgeFiles: config.purgeFiles });
      });
      sub();
    });
    trx();
  } finally {
    rhdataDb.close();
    patchbinDb.close();
  }

  console.log(`✓ Removed database records for ${skeleton.gameversion.gameid} v${skeleton.gameversion.version}`);
}

/**
 * Entry point
 */

async function main() {
  let config;
  try {
    config = parseArgs(process.argv);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    printHelp();
    process.exit(1);
  }

  if (config.mode === 'help') {
    printHelp();
    return;
  }

  let skeleton = loadSkeleton(config.jsonPath);
  if (!skeleton) {
    skeleton = defaultSkeleton();
    saveSkeleton(config.jsonPath, skeleton);
    console.log(`Created new skeleton at ${config.jsonPath}`);
  }

  switch (config.mode) {
    case 'create':
      await runCreateWizard(config.jsonPath, skeleton);
      break;
    case 'check':
      await handleCheck(config, skeleton);
      break;
    case 'add':
      await handleAdd(config, skeleton);
      break;
    case 'remove':
      await handleRemove(config, skeleton);
      break;
    default:
      printHelp();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`\nFatal error: ${error.message}`);
    process.exit(1);
  });
}


