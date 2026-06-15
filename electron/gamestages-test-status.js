/**
 * Compute gamestages test_status fields on update (invalidation + accept/reject snapshots).
 */

const { normalizeRequisitesForKey } = require('./utils/stage-feedback-log');

/**
 * @param {object} params
 * @param {object|null} params.existing - existing gamestages row
 * @param {string|null} params.normalizedLevelnumber
 * @param {string|null} params.playlevel_patch_code
 * @param {string|null} params.requisites
 * @param {string|null|undefined} params.test_status - undefined = preserve unless patch changed
 */
function computeGamestageTestStatusFields({
  existing,
  normalizedLevelnumber,
  playlevel_patch_code,
  requisites,
  test_status,
}) {
  const patchChanged = existing && (
    (normalizedLevelnumber || null) !== (existing.levelnumber || null)
    || (playlevel_patch_code || null) !== (existing.playlevel_patch_code || null)
    || normalizeRequisitesForKey(requisites) !== normalizeRequisitesForKey(existing.requisites)
  );

  let finalTestStatus = existing?.test_status ?? null;
  let finalTestStatusAt = existing?.test_status_at ?? null;
  let finalVerifiedLevel = existing?.test_verified_levelnumber ?? null;
  let finalVerifiedPlaylevel = existing?.test_verified_playlevel_patch_code ?? null;
  let finalVerifiedRequisites = existing?.test_verified_requisites ?? null;

  if (patchChanged && test_status === undefined) {
    finalTestStatus = null;
    finalTestStatusAt = null;
    finalVerifiedLevel = null;
    finalVerifiedPlaylevel = null;
    finalVerifiedRequisites = null;
  } else if (test_status === 'accept' || test_status === 'reject') {
    finalTestStatus = test_status;
    finalTestStatusAt = Math.floor(Date.now() / 1000);
    finalVerifiedLevel = normalizedLevelnumber || null;
    finalVerifiedPlaylevel = playlevel_patch_code || null;
    finalVerifiedRequisites = normalizeRequisitesForKey(requisites) || null;
  } else if (test_status === null) {
    finalTestStatus = null;
    finalTestStatusAt = null;
    finalVerifiedLevel = null;
    finalVerifiedPlaylevel = null;
    finalVerifiedRequisites = null;
  }

  return {
    patchChanged: !!patchChanged,
    test_status: finalTestStatus,
    test_status_at: finalTestStatusAt,
    test_verified_levelnumber: finalVerifiedLevel,
    test_verified_playlevel_patch_code: finalVerifiedPlaylevel,
    test_verified_requisites: finalVerifiedRequisites,
  };
}

module.exports = {
  computeGamestageTestStatusFields,
};
