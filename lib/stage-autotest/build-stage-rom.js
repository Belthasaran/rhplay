'use strict';

/**
 * Build a stage test ROM in the main process (mirrors stage-test-launch.ts).
 */
async function buildStageTestRom(deps, params) {
  const {
    gameId,
    gameVersion = 1,
    stage,
    settings = {},
    getPlaylevelPatchCode,
    getRequisiteTags,
    formatLevelNumberHex,
  } = params;

  const { gameStager, dbManager } = deps;
  if (!stage?.levelnumber) {
    return { success: false, error: 'Level number is required' };
  }

  const rhdataDb = dbManager.getConnection('rhdata');
  const allPatches = rhdataDb.prepare('SELECT * FROM extrapatches').all();
  const playlevelPatchCode = getPlaylevelPatchCode(stage);
  const playlevelPatch = allPatches.find((p) => p.patch_code === playlevelPatchCode);
  if (!playlevelPatch) {
    return { success: false, error: `Playlevel patch "${playlevelPatchCode}" not found` };
  }

  const selectedPatchUuids = [];
  const requisiteTags = getRequisiteTags(stage);
  const playlevelInRequisites = requisiteTags.includes(playlevelPatchCode);

  if (!playlevelInRequisites) {
    selectedPatchUuids.push(playlevelPatch.epuuid);
  }
  for (const tag of requisiteTags) {
    const matching = allPatches.find((p) => p.patch_code === tag);
    if (matching && !selectedPatchUuids.includes(matching.epuuid)) {
      selectedPatchUuids.push(matching.epuuid);
    }
  }
  if (playlevelInRequisites && !selectedPatchUuids.includes(playlevelPatch.epuuid)) {
    selectedPatchUuids.push(playlevelPatch.epuuid);
  }

  const levelHex = formatLevelNumberHex(stage.levelnumber);
  const result = await gameStager.buildPlusPatchedGame({
    dbManager,
    gameId,
    gameVersion,
    selectedPatches: selectedPatchUuids,
    globalParams: { glevelnum: levelHex, gonoffv: [] },
    localParams: {},
    action: 'boot',
    vanillaRomPath: settings.vanillaRomPath || '',
    flipsPath: settings.flipsPath || '',
    asarPath: settings.asarPath || '',
  });

  if (!result.success) {
    return { success: false, error: result.error || 'Build failed' };
  }

  return {
    success: true,
    outputPath: result.outputPath,
    filename: result.filename,
    levelHex,
    playlevelPatchCode,
    patchIdentity: result.patchIdentity || null,
  };
}

function loadAppSettings(clientDb) {
  const rows = clientDb.prepare('SELECT csetting_name, csetting_value FROM csettings').all();
  const settings = {};
  for (const row of rows) settings[row.csetting_name] = row.csetting_value;
  return settings;
}

function defaultPlaylevelPatchCode(stage) {
  return (stage && stage.playlevel_patch_code) ? stage.playlevel_patch_code : '2lvno';
}

function defaultRequisiteTags(stage) {
  if (!stage?.requisites) return [];
  return String(stage.requisites).split(',').map((s) => s.trim()).filter(Boolean);
}

function defaultFormatLevelNumberHex(levelnumber) {
  if (!levelnumber) return '000';
  const num = parseInt(String(levelnumber).trim(), 16);
  if (Number.isNaN(num)) return '000';
  return num.toString(16).toUpperCase().padStart(3, '0').slice(-3);
}

module.exports = {
  buildStageTestRom,
  loadAppSettings,
  defaultPlaylevelPatchCode,
  defaultRequisiteTags,
  defaultFormatLevelNumberHex,
};
