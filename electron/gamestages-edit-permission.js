/**
 * Permission logic for editing game stages outside DEVADMIN mode.
 */

function normalizeTimestamp(value) {
  if (value == null || value === '') return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

function getStagesEditPermission({
  isDevAdmin = false,
  stagesSealed = null,
  stagesSealedAt = null,
  hasDbStages = false,
  localEditAt = null,
} = {}) {
  if (isDevAdmin) {
    return { canEdit: true, reason: 'devadmin' };
  }

  const sealed = stagesSealed === null || stagesSealed === undefined
    ? null
    : Number(stagesSealed);

  if (sealed === 2) {
    return { canEdit: false, reason: 'sealed_strict' };
  }
  if (sealed === 0) {
    return { canEdit: true, reason: 'sealed_open' };
  }
  if (sealed === 1) {
    const editTime = normalizeTimestamp(localEditAt);
    const sealTime = normalizeTimestamp(stagesSealedAt);
    if (editTime != null && sealTime != null && editTime < sealTime) {
      return { canEdit: true, reason: 'sealed_grandfather' };
    }
    return { canEdit: false, reason: 'sealed_partial' };
  }

  if (localEditAt) {
    return { canEdit: true, reason: 'local_edit' };
  }
  if (!hasDbStages) {
    return { canEdit: true, reason: 'no_stages' };
  }
  return { canEdit: false, reason: 'author_stages' };
}

function queryStagesEditContext(db, gameid, version) {
  const stageCount = db.prepare('SELECT COUNT(*) AS cnt FROM gamestages WHERE gameid = ?').get(gameid);
  const hasDbStages = (stageCount?.cnt || 0) > 0;

  const localRow = db.prepare(
    'SELECT stages_edited_at FROM gameversions_local WHERE gameid = ?'
  ).get(gameid);
  const localEditAt = localRow?.stages_edited_at || null;

  let versionRow = null;
  if (version !== undefined && version !== null) {
    versionRow = db.prepare(`
      SELECT stages_sealed, stages_sealed_at
      FROM gameversions
      WHERE gameid = ? AND version = ?
    `).get(gameid, version);
  }
  if (!versionRow) {
    versionRow = db.prepare(`
      SELECT stages_sealed, stages_sealed_at
      FROM gameversions
      WHERE gameid = ?
      ORDER BY version DESC
      LIMIT 1
    `).get(gameid);
  }

  return {
    hasDbStages,
    localEditAt,
    stagesSealed: versionRow?.stages_sealed ?? null,
    stagesSealedAt: versionRow?.stages_sealed_at ?? null,
  };
}

function getStagesEditPermissionForGame(db, gameid, version, isDevAdmin) {
  const context = queryStagesEditContext(db, gameid, version);
  const permission = getStagesEditPermission({
    isDevAdmin,
    stagesSealed: context.stagesSealed,
    stagesSealedAt: context.stagesSealedAt,
    hasDbStages: context.hasDbStages,
    localEditAt: context.localEditAt,
  });

  return {
    ...context,
    ...permission,
    stages_sealed: context.stagesSealed,
    stages_sealed_at: context.stagesSealedAt,
    has_local_edit: !!context.localEditAt,
    local_edit_at: context.localEditAt,
  };
}

function recordLocalStagesEdit(db, gameid) {
  db.prepare(`
    INSERT INTO gameversions_local (gameid, stages_edited_at)
    VALUES (?, CURRENT_TIMESTAMP)
    ON CONFLICT(gameid) DO UPDATE SET stages_edited_at = CURRENT_TIMESTAMP
  `).run(gameid);
}

function assertStagesEditAllowed(db, gameid, version, isDevAdmin) {
  const permission = getStagesEditPermissionForGame(db, gameid, version, isDevAdmin);
  if (!permission.canEdit) {
    const error = permission.reason === 'sealed_strict'
      ? 'Game stages are locked for this game.'
      : permission.reason === 'author_stages'
        ? 'Game stages are defined by the author and cannot be edited.'
        : 'You do not have permission to edit stages for this game.';
    return { allowed: false, error, permission };
  }
  return { allowed: true, permission };
}

module.exports = {
  getStagesEditPermission,
  queryStagesEditContext,
  getStagesEditPermissionForGame,
  recordLocalStagesEdit,
  assertStagesEditAllowed,
};
