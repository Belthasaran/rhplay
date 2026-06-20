/** Keep in sync with electron/shared/run-types.js */

export type RunType = 'standard' | 'free_play';

export const RUN_TYPE_STANDARD: RunType = 'standard';
export const RUN_TYPE_FREE_PLAY: RunType = 'free_play';

export const RUN_TYPE_OPTIONS: { value: RunType; label: string }[] = [
  { value: RUN_TYPE_STANDARD, label: 'Standard Run' },
  { value: RUN_TYPE_FREE_PLAY, label: 'Free Play' },
];

export function normalizeRunType(value: string | null | undefined): RunType {
  if (value === RUN_TYPE_FREE_PLAY) return RUN_TYPE_FREE_PLAY;
  return RUN_TYPE_STANDARD;
}

export function isFreePlayRunType(runType: string | null | undefined): boolean {
  return normalizeRunType(runType) === RUN_TYPE_FREE_PLAY;
}

export function runTypeLabel(runType: string | null | undefined): string {
  const opt = RUN_TYPE_OPTIONS.find((o) => o.value === normalizeRunType(runType));
  return opt?.label ?? 'Standard Run';
}
