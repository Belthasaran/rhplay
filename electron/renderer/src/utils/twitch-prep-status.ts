/**
 * Prepare Run Twitch prediction status labels and mode mapping.
 * Keep in sync with electron/shared/twitch-prep-status.js
 */

export type PrepPredictionsMode = 'none' | 'same_item' | 'whole_challenge';

export function getTwitchPrepStatusLabel(params: {
  predictionsConfigured: boolean;
  twitchTokenValid: boolean;
  prepPredictionsMode: PrepPredictionsMode;
}): string {
  if (!params.predictionsConfigured || !params.twitchTokenValid) {
    return '(Off)';
  }
  if (params.prepPredictionsMode === 'same_item') {
    return '(On, Per-Item)';
  }
  if (params.prepPredictionsMode === 'whole_challenge') {
    return '(On, Per-Run)';
  }
  return '(Ready)';
}

export function prepModeFromPredictionState(
  enabled: boolean,
  operationalMode: string | null | undefined
): PrepPredictionsMode {
  if (!enabled || !operationalMode) {
    return 'none';
  }
  if (operationalMode === 'same_item' || operationalMode === 'whole_challenge') {
    return operationalMode;
  }
  return 'none';
}

export function predictionStateFromPrepMode(prepMode: PrepPredictionsMode): {
  enabled: boolean;
  operationalMode: 'whole_challenge' | 'same_item' | null;
} {
  if (prepMode === 'same_item') {
    return { enabled: true, operationalMode: 'same_item' };
  }
  if (prepMode === 'whole_challenge') {
    return { enabled: true, operationalMode: 'whole_challenge' };
  }
  return { enabled: false, operationalMode: null };
}

export function templateTypeForPrepMode(
  prepMode: PrepPredictionsMode
): 'individual_item' | 'whole_challenge' | null {
  if (prepMode === 'same_item') return 'individual_item';
  if (prepMode === 'whole_challenge') return 'whole_challenge';
  return null;
}
