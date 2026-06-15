/**
 * Resolve staged run ROM filenames (e.g. 02_1781492846_1lvno01.sfc).
 * Keep in sync with electron/renderer/src/utils/run-staging.ts (Vite renderer).
 */

const RUN_STAGED_SFC_PATTERN = /^\d{2}_\d+(?:_[a-zA-Z0-9]+)?\.sfc$/;
const RUN_STAGED_SFC_LEGACY_PATTERN = /^\d{2}\.sfc$/;

function isRunStagedSfcFilename(name) {
  return RUN_STAGED_SFC_PATTERN.test(name) || RUN_STAGED_SFC_LEGACY_PATTERN.test(name);
}

function sortRunStagedSfcFilenames(files) {
  return files.filter(isRunStagedSfcFilename).sort();
}

/** Resolve staged .sfc basename for a run challenge (0-based index). */
function resolveRunStagedSfcFilename(files, challengeIndex) {
  const seq = String(challengeIndex + 1).padStart(2, '0');
  const staged = sortRunStagedSfcFilenames(files);
  const prefixMatch = staged.find(
    (filename) => filename === `${seq}.sfc` || filename.startsWith(`${seq}_`)
  );
  if (prefixMatch) return prefixMatch;
  return staged[challengeIndex] ?? null;
}

/** Match a staged filename to a 1-based sequence number. */
function runStagedSfcMatchesSequence(filename, sequenceNumber) {
  const seq = String(sequenceNumber).padStart(2, '0');
  return filename === `${seq}.sfc` || filename.startsWith(`${seq}_`);
}

module.exports = {
  isRunStagedSfcFilename,
  sortRunStagedSfcFilenames,
  resolveRunStagedSfcFilename,
  runStagedSfcMatchesSequence,
};
