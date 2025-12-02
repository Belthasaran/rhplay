/**
 * Twitch Prediction Range Calculation Utilities
 * 
 * Centralized functions for calculating outcome ranges for Twitch predictions.
 * Used by both IPC handlers and test cases to ensure consistency.
 */

/**
 * Calculate outcome ranges for whole challenge predictions
 * @param {number} totalChallenges - Total number of challenges in the run
 * @param {number} outcomeCount - Number of outcomes desired (3-10)
 * @returns {Array<{title: string, min: number, max: number}>} Array of outcome ranges
 */
function calculateWholeChallengeRanges(totalChallenges, outcomeCount) {
  if (outcomeCount < 3 || outcomeCount > 10) {
    throw new Error('Outcome count must be between 3 and 10 for range predictions');
  }
  
  // We need to cover 0 to totalChallenges (inclusive), which is totalChallenges + 1 numbers
  const totalNumbers = totalChallenges + 1;
  
  if (totalNumbers <= outcomeCount) {
    // If fewer numbers than outcomes, create one outcome per number
    const outcomes = [];
    for (let i = 0; i < totalNumbers; i++) {
      outcomes.push({
        title: i === totalChallenges ? `All ${i}` : `${i}`,
        min: i,
        max: i
      });
    }
    return outcomes;
  }
  
  // Calculate ranges: 0 to totalChallenges, inclusive
  // First range always includes 0
  // Last range always includes totalChallenges
  // Middle ranges are evenly divided
  
  const outcomes = [];
  // Each range should cover approximately (totalNumbers / outcomeCount) numbers
  const baseRangeSize = Math.floor(totalNumbers / outcomeCount);
  const remainder = totalNumbers % outcomeCount;
  
  let currentStart = 0;
  
  for (let i = 0; i < outcomeCount; i++) {
    let rangeEnd;
    
    if (i === outcomeCount - 1) {
      // Last range: always includes totalChallenges
      rangeEnd = totalChallenges;
    } else {
      // Distribute remainder across first ranges (give extra number to earlier ranges)
      const extra = i < remainder ? 1 : 0;
      rangeEnd = currentStart + baseRangeSize + extra - 1;
    }
    
    // Format title
    let title;
    if (currentStart === 0 && rangeEnd === 0) {
      title = '0';
    } else if (currentStart === rangeEnd) {
      title = `${currentStart}`;
    } else if (currentStart === 0) {
      title = `0 to ${rangeEnd}`;
    } else {
      title = `${currentStart} to ${rangeEnd}`;
    }
    
    outcomes.push({
      title: title,
      min: currentStart,
      max: rangeEnd
    });
    
    currentStart = rangeEnd + 1;
  }
  
  return outcomes;
}

/**
 * Calculate outcome ranges for time range predictions
 * @param {number} maxTimeMinutes - Maximum time in minutes (or 60 if unlimited)
 * @param {number} outcomeCount - Number of outcomes desired (3-7)
 * @param {number} predictionWindowSeconds - Prediction window in seconds (optional, for excluding from first range)
 * @param {boolean} excludePredictionWindow - Whether to exclude prediction window from first range (default false)
 * @returns {Array<{title: string, min: number, max: number|null}>} Array of outcome ranges (null max = ">N")
 */
function calculateTimeRangeOutcomes(maxTimeMinutes, outcomeCount, predictionWindowSeconds = 0, excludePredictionWindow = false) {
  if (outcomeCount < 3 || outcomeCount > 7) {
    throw new Error('Outcome count must be between 3 and 7 for time range predictions');
  }
  
  if (maxTimeMinutes <= 0) {
    maxTimeMinutes = 60; // Default to 60 minutes if unlimited
  }
  
  const outcomes = [];
  
  // We need to create continuous ranges with no gaps
  // Each range must be at least 1 minute long
  // Notation: ">N to M" means >N minutes AND <=M minutes (exclusive lower, inclusive upper)
  // This ensures ranges are continuous: ">0 to 1" covers 1-60s, ">1 to 2" covers 61-120s, etc.
  
  // If excluding prediction window, calculate the starting point
  // For example, if prediction window is 30 seconds, first range starts at >0.5 minutes (30 seconds)
  // Round up to nearest minute for display: 30 seconds = 0.5 minutes, round up to 1 minute
  let startMinute = 0;
  if (excludePredictionWindow && predictionWindowSeconds > 0) {
    // Convert prediction window to minutes and round UP to nearest minute
    startMinute = Math.ceil(predictionWindowSeconds / 60);
  }
  
  // Calculate how many ranges we can actually create (excluding the final ">N" outcome)
  const rangesToCreate = outcomeCount - 1; // Last one is ">N"
  
  // We need to cover startMinute to maxTimeMinutes with continuous ranges
  // Each range must be at least 1 minute, so we can create at most (maxTimeMinutes - startMinute) ranges
  // If rangesToCreate > (maxTimeMinutes - startMinute), we can't create that many 1-minute ranges
  // In that case, we'll create fewer ranges (but each will be at least 1 minute)
  const timeToCover = maxTimeMinutes - startMinute;
  const actualRangesToCreate = Math.min(rangesToCreate, Math.max(1, timeToCover));
  
  // Calculate the size of each range
  // We want to distribute timeToCover evenly across actualRangesToCreate ranges
  // But each range must be at least 1 minute
  const baseRangeSize = Math.floor(timeToCover / actualRangesToCreate);
  const remainder = timeToCover % actualRangesToCreate;
  
  let currentLowerBound = startMinute; // Exclusive lower bound for next range
  
  // Create the ranges
  for (let i = 0; i < actualRangesToCreate; i++) {
    // Distribute remainder across first ranges (give extra minute to earlier ranges)
    const extra = i < remainder ? 1 : 0;
    const rangeSize = baseRangeSize + extra;
    
    // Upper bound is inclusive
    const upperBound = currentLowerBound + rangeSize;
    
    // Format title: ">N to M" means >N minutes AND <=M minutes
    const title = currentLowerBound === 0 ? `>0 to ${upperBound}` : `>${currentLowerBound} to ${upperBound}`;
    
    outcomes.push({
      title: title,
      min: currentLowerBound,
      max: upperBound
    });
    
    // Next range starts where this one ends (exclusive lower bound)
    currentLowerBound = upperBound;
  }
  
  // Always add the final ">N" outcome for failure case
  outcomes.push({
    title: `>${maxTimeMinutes}`,
    min: maxTimeMinutes,
    max: null
  });
  
  return outcomes;
}

module.exports = {
  calculateWholeChallengeRanges,
  calculateTimeRangeOutcomes
};

