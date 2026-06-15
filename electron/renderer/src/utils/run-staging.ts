/**
 * Resolve staged run ROM filenames (e.g. 02_1781492846_1lvno01.sfc).
 * Keep in sync with electron/run-staging-resolve.js (Node / IPC).
 */

const RUN_STAGED_SFC_PATTERN = /^\d{2}_\d+(?:_[a-zA-Z0-9]+)?\.sfc$/;
const RUN_STAGED_SFC_LEGACY_PATTERN = /^\d{2}\.sfc$/;

export function isRunStagedSfcFilename(name: string): boolean {
  return RUN_STAGED_SFC_PATTERN.test(name) || RUN_STAGED_SFC_LEGACY_PATTERN.test(name);
}

export function sortRunStagedSfcFilenames(files: string[]): string[] {
  return files.filter(isRunStagedSfcFilename).sort();
}

/** Resolve staged .sfc basename for a run challenge (0-based index). */
export function resolveRunStagedSfcFilename(files: string[], challengeIndex: number): string | null {
  const seq = String(challengeIndex + 1).padStart(2, '0');
  const staged = sortRunStagedSfcFilenames(files);
  const prefixMatch = staged.find(
    (filename) => filename === `${seq}.sfc` || filename.startsWith(`${seq}_`)
  );
  if (prefixMatch) return prefixMatch;
  return staged[challengeIndex] ?? null;
}

export function runStagedSfcMatchesSequence(filename: string, sequenceNumber: number): boolean {
  const seq = String(sequenceNumber).padStart(2, '0');
  return filename === `${seq}.sfc` || filename.startsWith(`${seq}_`);
}
