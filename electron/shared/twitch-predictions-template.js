'use strict';

/**
 * Default and merge helpers for Twitch predictions template storage.
 * Single JSON blob in csettings.predictionsTemplate preserves all mode-specific settings.
 */

const WHOLE_CHALLENGE_DEFAULTS = {
  outcomeCount: 5,
  predictionWindowSeconds: 600,
};

const YES_NO_DEFAULTS = {
  windowSeconds: 30,
  yesOutcomeName: 'Yes',
  noOutcomeName: 'No',
};

const TIME_RANGE_DEFAULTS = {
  windowSeconds: 45,
  outcomeCount: 5,
  maxTimeMinutes: 60,
  lowTimeRangesOnlyOnSuccess: true,
  useTemplateMaxEvenIfWinRulesAllowLess: false,
  excludePredictionWindow: true,
};

/**
 * Full template with defaults for all four management styles:
 * - whole_challenge (Whole Run)
 * - individual_item + yes_no (Per-Item Win/Loss)
 * - individual_item + time_range (Per-Item Time-Range)
 */
function getDefaultPredictionsTemplate(
  activeType = 'whole_challenge',
  individualSubtype = 'yes_no'
) {
  return {
    type: activeType,
    wholeChallenge: { ...WHOLE_CHALLENGE_DEFAULTS },
    individualItem: {
      predictionType: individualSubtype,
      predictionCreationDelaySeconds: 30,
      yesNo: { ...YES_NO_DEFAULTS },
      timeRange: { ...TIME_RANGE_DEFAULTS },
    },
  };
}

/**
 * Fill missing sections with defaults. Never drops saved mode-specific fields.
 * @param {object|null|undefined} raw
 * @returns {object}
 */
function normalizePredictionsTemplate(raw) {
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

/**
 * Merge a partial save onto existing template (preserves inactive mode settings).
 * Custom titles are stored separately:
 * - wholeChallenge.customTitle
 * - individualItem.yesNo.customTitle
 * - individualItem.timeRange.customTitle
 *
 * @param {object|null|undefined} existing
 * @param {{ type?: string, wholeChallenge?: object, individualItem?: object }} patch
 * @returns {object}
 */
function mergePredictionsTemplate(existing, patch) {
  const base = normalizePredictionsTemplate(existing);
  const result = {
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
      ...patch.wholeChallenge,
    };
    if (patch.wholeChallenge.customTitle === '') {
      delete result.wholeChallenge.customTitle;
    }
  }

  if (patch.individualItem) {
    const ii = patch.individualItem;
    result.individualItem = {
      ...result.individualItem,
      ...ii,
      yesNo: { ...result.individualItem.yesNo },
      timeRange: { ...result.individualItem.timeRange },
    };

    if (ii.yesNo) {
      result.individualItem.yesNo = {
        ...result.individualItem.yesNo,
        ...ii.yesNo,
      };
      if (ii.yesNo.customTitle === '') {
        delete result.individualItem.yesNo.customTitle;
      }
    }

    if (ii.timeRange) {
      result.individualItem.timeRange = {
        ...result.individualItem.timeRange,
        ...ii.timeRange,
      };
      if (ii.timeRange.customTitle === '') {
        delete result.individualItem.timeRange.customTitle;
      }
    }
  }

  return result;
}

function getIndividualSubtypeFromTemplate(template) {
  const normalized = normalizePredictionsTemplate(template);
  return normalized.individualItem.predictionType === 'time_range' ? 'time_range' : 'yes_no';
}

function getTimeRangeOutcomeCount(template) {
  const normalized = normalizePredictionsTemplate(template);
  return normalized.individualItem.timeRange.outcomeCount;
}

module.exports = {
  WHOLE_CHALLENGE_DEFAULTS,
  YES_NO_DEFAULTS,
  TIME_RANGE_DEFAULTS,
  getDefaultPredictionsTemplate,
  normalizePredictionsTemplate,
  mergePredictionsTemplate,
  getIndividualSubtypeFromTemplate,
  getTimeRangeOutcomeCount,
};
