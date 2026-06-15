/**
 * Twitch predictions template defaults and merge helpers.
 * Keep in sync with electron/shared/twitch-predictions-template.js
 */

import type { PrepPredictionsMode } from './twitch-prep-status';
import { templateTypeForPrepMode } from './twitch-prep-status';

export type IndividualPredictionSubtype = 'yes_no' | 'time_range';

export type PredictionsTemplate = {
  type: 'whole_challenge' | 'individual_item';
  wholeChallenge: {
    outcomeCount: number;
    predictionWindowSeconds: number;
    customTitle?: string;
  };
  individualItem: {
    predictionType: IndividualPredictionSubtype;
    predictionCreationDelaySeconds: number;
    yesNo: {
      windowSeconds: number;
      customTitle?: string;
      yesOutcomeName: string;
      noOutcomeName: string;
      cancelIfSuccessWithinSeconds?: number;
    };
    timeRange: {
      windowSeconds: number;
      customTitle?: string;
      outcomeCount: number;
      maxTimeMinutes: number;
      lowTimeRangesOnlyOnSuccess: boolean;
      useTemplateMaxEvenIfWinRulesAllowLess: boolean;
      excludePredictionWindow: boolean;
      cancelIfSuccessWithinSeconds?: number;
    };
  };
};

// Defaults mirrored from shared JS module
export function getDefaultPredictionsTemplate(
  activeType: 'whole_challenge' | 'individual_item' = 'whole_challenge',
  individualSubtype: IndividualPredictionSubtype = 'yes_no'
): PredictionsTemplate {
  return {
    type: activeType,
    wholeChallenge: {
      outcomeCount: 5,
      predictionWindowSeconds: 600,
    },
    individualItem: {
      predictionType: individualSubtype,
      predictionCreationDelaySeconds: 30,
      yesNo: {
        windowSeconds: 30,
        yesOutcomeName: 'Yes',
        noOutcomeName: 'No',
      },
      timeRange: {
        windowSeconds: 45,
        outcomeCount: 5,
        maxTimeMinutes: 60,
        lowTimeRangesOnlyOnSuccess: true,
        useTemplateMaxEvenIfWinRulesAllowLess: false,
        excludePredictionWindow: true,
      },
    },
  };
}

export function normalizePredictionsTemplate(raw: any): PredictionsTemplate {
  const base = getDefaultPredictionsTemplate();
  if (!raw || typeof raw !== 'object') {
    return base;
  }

  const individual = raw.individualItem || {};
  return {
    type: raw.type === 'individual_item' ? 'individual_item' : 'whole_challenge',
    wholeChallenge: {
      ...base.wholeChallenge,
      ...(raw.wholeChallenge || {}),
    },
    individualItem: {
      ...base.individualItem,
      ...individual,
      predictionType: individual.predictionType === 'time_range' ? 'time_range' : 'yes_no',
      yesNo: {
        ...base.individualItem.yesNo,
        ...(individual.yesNo || {}),
      },
      timeRange: {
        ...base.individualItem.timeRange,
        ...(individual.timeRange || {}),
      },
    },
  };
}

export function mergePredictionsTemplate(
  existing: any,
  patch: {
    type?: 'whole_challenge' | 'individual_item';
    wholeChallenge?: Record<string, unknown>;
    individualItem?: Record<string, unknown> & {
      yesNo?: Record<string, unknown>;
      timeRange?: Record<string, unknown>;
    };
  }
): PredictionsTemplate {
  const base = normalizePredictionsTemplate(existing);
  const result: PredictionsTemplate = {
    ...base,
    type: patch.type || base.type,
    wholeChallenge: { ...base.wholeChallenge },
    individualItem: {
      ...base.individualItem,
      yesNo: { ...base.individualItem.yesNo },
      timeRange: { ...base.individualItem.timeRange },
    },
  };

  if (patch.wholeChallenge) {
    result.wholeChallenge = {
      ...result.wholeChallenge,
      ...(patch.wholeChallenge as PredictionsTemplate['wholeChallenge']),
    };
    if (patch.wholeChallenge.customTitle === '') {
      delete result.wholeChallenge.customTitle;
    }
  }

  if (patch.individualItem) {
    const ii = patch.individualItem;
    result.individualItem = {
      ...result.individualItem,
      ...(ii as Partial<PredictionsTemplate['individualItem']>),
      yesNo: { ...result.individualItem.yesNo },
      timeRange: { ...result.individualItem.timeRange },
    };

    if (ii.yesNo) {
      result.individualItem.yesNo = {
        ...result.individualItem.yesNo,
        ...(ii.yesNo as PredictionsTemplate['individualItem']['yesNo']),
      };
      if (ii.yesNo.customTitle === '') {
        delete result.individualItem.yesNo.customTitle;
      }
    }

    if (ii.timeRange) {
      result.individualItem.timeRange = {
        ...result.individualItem.timeRange,
        ...(ii.timeRange as PredictionsTemplate['individualItem']['timeRange']),
      };
      if (ii.timeRange.customTitle === '') {
        delete result.individualItem.timeRange.customTitle;
      }
    }
  }

  return result;
}

export function getIndividualSubtypeFromTemplate(template: any): IndividualPredictionSubtype {
  const normalized = normalizePredictionsTemplate(template);
  return normalized.individualItem.predictionType;
}

export function getTimeRangeOutcomeCount(template: any): number {
  const normalized = normalizePredictionsTemplate(template);
  return normalized.individualItem.timeRange.outcomeCount;
}

export async function savePredictionsTemplateObject(template: PredictionsTemplate): Promise<{ success: boolean; error?: string }> {
  return await (window as any).electronAPI.savePredictionsTemplate({
    template: JSON.stringify(template),
  });
}

export async function loadPredictionsTemplateObject(): Promise<PredictionsTemplate> {
  const template = await (window as any).electronAPI.getPredictionsTemplate();
  return normalizePredictionsTemplate(template);
}

export async function ensureTemplateMatchesPrepMode(prepMode: PrepPredictionsMode): Promise<PredictionsTemplate> {
  const existing = await loadPredictionsTemplateObject();
  if (prepMode === 'none') {
    return existing;
  }

  const targetType = templateTypeForPrepMode(prepMode);
  if (!targetType || existing.type === targetType) {
    return existing;
  }

  const updated = mergePredictionsTemplate(existing, { type: targetType });
  await savePredictionsTemplateObject(updated);
  return updated;
}

export async function saveIndividualSubtype(subtype: IndividualPredictionSubtype): Promise<PredictionsTemplate> {
  const existing = await loadPredictionsTemplateObject();
  const updated = mergePredictionsTemplate(existing, {
    type: 'individual_item',
    individualItem: {
      predictionType: subtype,
    },
  });
  const result = await savePredictionsTemplateObject(updated);
  if (!result?.success) {
    throw new Error(result?.error || 'Failed to save prediction template');
  }
  return updated;
}
