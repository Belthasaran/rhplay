/**
 * Helpers for reading/updating the global Twitch predictions template.
 */

import type { PrepPredictionsMode } from './twitch-prep-status';
import { templateTypeForPrepMode } from './twitch-prep-status';

export type IndividualPredictionSubtype = 'yes_no' | 'time_range';

export function getIndividualSubtypeFromTemplate(template: any): IndividualPredictionSubtype {
  const subtype = template?.individualItem?.predictionType;
  return subtype === 'time_range' ? 'time_range' : 'yes_no';
}

export function getTimeRangeOutcomeCount(template: any): number {
  return template?.individualItem?.timeRange?.outcomeCount ?? 5;
}

/**
 * Build a save payload from an existing template, switching top-level type for prep mode.
 */
export function buildTemplateForPrepMode(
  existingTemplate: any,
  prepMode: PrepPredictionsMode
): any | null {
  const targetType = templateTypeForPrepMode(prepMode);
  if (!targetType || !existingTemplate) {
    return null;
  }

  const template = JSON.parse(JSON.stringify(existingTemplate));
  template.type = targetType;

  if (targetType === 'whole_challenge' && !template.wholeChallenge) {
    template.wholeChallenge = {
      outcomeCount: 5,
      predictionWindowSeconds: 600,
    };
  }

  if (targetType === 'individual_item' && !template.individualItem) {
    template.individualItem = {
      predictionType: 'yes_no',
      predictionCreationDelaySeconds: 30,
      yesNo: {
        windowSeconds: 30,
        yesOutcomeName: 'Yes',
        noOutcomeName: 'No',
      },
    };
  }

  return template;
}

/**
 * Update individual_item subtype on a template copy (preserves other settings).
 */
export function buildTemplateWithIndividualSubtype(
  existingTemplate: any,
  subtype: IndividualPredictionSubtype
): any {
  const template = JSON.parse(JSON.stringify(existingTemplate || { type: 'individual_item' }));
  template.type = 'individual_item';
  template.individualItem = template.individualItem || {
    predictionCreationDelaySeconds: 30,
  };
  template.individualItem.predictionType = subtype;

  if (subtype === 'yes_no') {
    template.individualItem.yesNo = template.individualItem.yesNo || {
      windowSeconds: 30,
      yesOutcomeName: 'Yes',
      noOutcomeName: 'No',
    };
  } else {
    template.individualItem.timeRange = template.individualItem.timeRange || {
      windowSeconds: 45,
      outcomeCount: 5,
      maxTimeMinutes: 60,
      lowTimeRangesOnlyOnSuccess: true,
      useTemplateMaxEvenIfWinRulesAllowLess: false,
      excludePredictionWindow: true,
    };
  }

  return template;
}

export async function savePredictionsTemplateObject(template: any): Promise<void> {
  await (window as any).electronAPI.savePredictionsTemplate({
    template: JSON.stringify(template),
  });
}

export async function loadPredictionsTemplateObject(): Promise<any | null> {
  const template = await (window as any).electronAPI.getPredictionsTemplate();
  return template && template.type ? template : null;
}

export async function ensureTemplateMatchesPrepMode(prepMode: PrepPredictionsMode): Promise<any | null> {
  if (prepMode === 'none') {
    return loadPredictionsTemplateObject();
  }

  const existing = await loadPredictionsTemplateObject();
  if (!existing) {
    return null;
  }

  const targetType = templateTypeForPrepMode(prepMode);
  if (existing.type === targetType) {
    return existing;
  }

  const updated = buildTemplateForPrepMode(existing, prepMode);
  if (!updated) {
    return existing;
  }

  await savePredictionsTemplateObject(updated);
  return updated;
}

export async function saveIndividualSubtype(subtype: IndividualPredictionSubtype): Promise<any | null> {
  const existing = await loadPredictionsTemplateObject();
  const updated = buildTemplateWithIndividualSubtype(existing, subtype);
  await savePredictionsTemplateObject(updated);
  return updated;
}
