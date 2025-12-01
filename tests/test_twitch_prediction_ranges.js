#!/usr/bin/env node
/**
 * Test suite for Twitch prediction range calculation functions
 * 
 * Tests calculateWholeChallengeRanges and calculateTimeRangeOutcomes
 * to ensure all possible outcomes are covered exactly once with no gaps or overlaps.
 * 
 * Uses the centralized module to ensure tests stay in sync with implementation.
 */

const path = require('path');

// Import range calculation functions from centralized module
const {
  calculateWholeChallengeRanges,
  calculateTimeRangeOutcomes
} = require(path.join(__dirname, '..', 'electron', 'utils', 'twitch-prediction-ranges'));

/**
 * Verify that all outcomes from 0 to totalChallenges are covered exactly once
 */
function verifyWholeChallengeCoverage(totalChallenges, outcomeCount) {
  const ranges = calculateWholeChallengeRanges(totalChallenges, outcomeCount);
  
  // Build a set of all covered numbers
  const covered = new Set();
  const issues = [];
  
  for (const range of ranges) {
    if (range.min > range.max) {
      issues.push(`Invalid range: ${range.min} > ${range.max} (${range.title})`);
      continue;
    }
    
    for (let i = range.min; i <= range.max; i++) {
      if (covered.has(i)) {
        issues.push(`Overlap: ${i} is covered by multiple ranges`);
      }
      covered.add(i);
    }
  }
  
  // Check for gaps
  for (let i = 0; i <= totalChallenges; i++) {
    if (!covered.has(i)) {
      issues.push(`Gap: ${i} is not covered by any range`);
    }
  }
  
  // Check for numbers outside range
  for (const range of ranges) {
    if (range.min < 0) {
      issues.push(`Range starts below 0: ${range.min} (${range.title})`);
    }
    if (range.max > totalChallenges) {
      issues.push(`Range ends above totalChallenges: ${range.max} > ${totalChallenges} (${range.title})`);
    }
  }
  
  return {
    valid: issues.length === 0,
    issues: issues,
    ranges: ranges,
    coveredCount: covered.size,
    expectedCount: totalChallenges + 1
  };
}

/**
 * Verify that all outcomes from 0 to maxTimeMinutes are covered exactly once
 * (plus the ">N" failure case)
 */
function verifyTimeRangeCoverage(maxTimeMinutes, outcomeCount) {
  const ranges = calculateTimeRangeOutcomes(maxTimeMinutes, outcomeCount);
  
  // Build a set of all covered numbers
  const covered = new Set();
  const issues = [];
  let hasFailureCase = false;
  
  for (const range of ranges) {
    if (range.max === null) {
      // This is the ">N" failure case
      hasFailureCase = true;
      if (range.min !== maxTimeMinutes + 1) {
        // The failure case should conceptually start at maxTimeMinutes + 1
        // But we don't need to verify coverage for it since it's ">N"
      }
      continue;
    }
    
    if (range.min > range.max) {
      issues.push(`Invalid range: ${range.min} > ${range.max} (${range.title})`);
      continue;
    }
    
    for (let i = range.min; i <= range.max; i++) {
      if (covered.has(i)) {
        issues.push(`Overlap: ${i} is covered by multiple ranges`);
      }
      covered.add(i);
    }
  }
  
  // Check for gaps (0 to maxTimeMinutes inclusive)
  for (let i = 0; i <= maxTimeMinutes; i++) {
    if (!covered.has(i)) {
      issues.push(`Gap: ${i} is not covered by any range`);
    }
  }
  
  // Check for numbers outside range
  for (const range of ranges) {
    if (range.max !== null && range.min < 0) {
      issues.push(`Range starts below 0: ${range.min} (${range.title})`);
    }
    if (range.max !== null && range.max > maxTimeMinutes) {
      issues.push(`Range ends above maxTimeMinutes: ${range.max} > ${maxTimeMinutes} (${range.title})`);
    }
  }
  
  // Verify failure case exists
  if (!hasFailureCase) {
    issues.push('Missing failure case (">N" outcome)');
  }
  
  return {
    valid: issues.length === 0,
    issues: issues,
    ranges: ranges,
    coveredCount: covered.size,
    expectedCount: maxTimeMinutes + 1,
    hasFailureCase: hasFailureCase
  };
}

// Test execution
let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function runTest(name, testFn) {
  totalTests++;
  try {
    const result = testFn();
    if (result) {
      passedTests++;
      console.log(`✓ ${name}`);
      return true;
    } else {
      failedTests++;
      console.error(`✗ ${name}`);
      return false;
    }
  } catch (error) {
    failedTests++;
    console.error(`✗ ${name}: ${error.message}`);
    return false;
  }
}

console.log('='.repeat(80));
console.log('Twitch Prediction Range Calculation Tests');
console.log('='.repeat(80));
console.log();

// Test 1: Whole Challenge Ranges - Test all counts from 1 to 10
console.log('Test Suite 1: Whole Challenge Ranges (1-10 challenges)');
console.log('-'.repeat(80));

for (let totalChallenges = 1; totalChallenges <= 10; totalChallenges++) {
  for (let outcomeCount = 3; outcomeCount <= 10; outcomeCount++) {
    // Skip if outcomeCount is too large for the number of challenges
    if (outcomeCount > totalChallenges + 1) {
      continue; // Will be handled by the function's logic
    }
    
    const testName = `${totalChallenges} challenges, ${outcomeCount} outcomes`;
    runTest(testName, () => {
      const result = verifyWholeChallengeCoverage(totalChallenges, outcomeCount);
      if (!result.valid) {
        console.error(`  Issues:`, result.issues);
        console.error(`  Ranges:`, result.ranges);
        return false;
      }
      if (result.coveredCount !== result.expectedCount) {
        console.error(`  Coverage mismatch: ${result.coveredCount} vs ${result.expectedCount}`);
        return false;
      }
      return true;
    });
  }
}

console.log();

// Test 2: Whole Challenge Ranges - Sampling of larger counts (11+)
console.log('Test Suite 2: Whole Challenge Ranges (11+ challenges - sampling)');
console.log('-'.repeat(80));

const largeCounts = [11, 12, 15, 20, 25, 30, 50, 100];
for (const totalChallenges of largeCounts) {
  for (let outcomeCount = 3; outcomeCount <= 10; outcomeCount++) {
    const testName = `${totalChallenges} challenges, ${outcomeCount} outcomes`;
    runTest(testName, () => {
      const result = verifyWholeChallengeCoverage(totalChallenges, outcomeCount);
      if (!result.valid) {
        console.error(`  Issues:`, result.issues);
        console.error(`  Ranges:`, result.ranges);
        return false;
      }
      if (result.coveredCount !== result.expectedCount) {
        console.error(`  Coverage mismatch: ${result.coveredCount} vs ${result.expectedCount}`);
        return false;
      }
      return true;
    });
  }
}

console.log();

// Test 3: Time Range Outcomes - Various max times
console.log('Test Suite 3: Time Range Outcomes');
console.log('-'.repeat(80));

const maxTimes = [5, 10, 15, 20, 30, 60, 90, 120];
for (const maxTime of maxTimes) {
  for (let outcomeCount = 3; outcomeCount <= 7; outcomeCount++) {
    const testName = `Max ${maxTime} minutes, ${outcomeCount} outcomes`;
    runTest(testName, () => {
      const result = verifyTimeRangeCoverage(maxTime, outcomeCount);
      if (!result.valid) {
        console.error(`  Issues:`, result.issues);
        console.error(`  Ranges:`, result.ranges);
        return false;
      }
      if (result.coveredCount !== result.expectedCount) {
        console.error(`  Coverage mismatch: ${result.coveredCount} vs ${result.expectedCount}`);
        return false;
      }
      if (!result.hasFailureCase) {
        console.error(`  Missing failure case`);
        return false;
      }
      return true;
    });
  }
}

console.log();

// Test 4: Edge cases
console.log('Test Suite 4: Edge Cases');
console.log('-'.repeat(80));

// Test with exactly 3 challenges and 3 outcomes
runTest('3 challenges, 3 outcomes (exact match)', () => {
  const result = verifyWholeChallengeCoverage(3, 3);
  return result.valid && result.coveredCount === 4; // 0, 1, 2, 3
});

// Test with 1 challenge and 3 outcomes (should create individual outcomes)
runTest('1 challenge, 3 outcomes (more outcomes than numbers)', () => {
  const result = verifyWholeChallengeCoverage(1, 3);
  return result.valid && result.coveredCount === 2; // 0, 1
});

// Test with 0 challenges (edge case)
runTest('0 challenges, 3 outcomes', () => {
  const result = verifyWholeChallengeCoverage(0, 3);
  return result.valid && result.coveredCount === 1; // Just 0
});

// Test time range with very small max time
runTest('Max 1 minute, 3 outcomes', () => {
  const result = verifyTimeRangeCoverage(1, 3);
  return result.valid && result.coveredCount === 2 && result.hasFailureCase; // 0, 1, plus >1
});

// Test time range with very large max time
runTest('Max 180 minutes, 7 outcomes', () => {
  const result = verifyTimeRangeCoverage(180, 7);
  return result.valid && result.coveredCount === 181 && result.hasFailureCase; // 0-180, plus >180
});

console.log();

// Test 5: Verify range continuity (no gaps between ranges)
console.log('Test Suite 5: Range Continuity Verification');
console.log('-'.repeat(80));

function verifyRangeContinuity(ranges, totalChallenges) {
  // Sort ranges by min
  const sorted = [...ranges].sort((a, b) => a.min - b.min);
  
  // Check that ranges are contiguous
  for (let i = 0; i < sorted.length - 1; i++) {
    const current = sorted[i];
    const next = sorted[i + 1];
    
    if (current.max + 1 !== next.min) {
      return {
        valid: false,
        issue: `Gap between ranges: ${current.max + 1} to ${next.min - 1} is not covered`
      };
    }
  }
  
  // Check first range starts at 0
  if (sorted[0].min !== 0) {
    return {
      valid: false,
      issue: `First range does not start at 0: starts at ${sorted[0].min}`
    };
  }
  
  // Check last range ends at totalChallenges
  const lastRange = sorted[sorted.length - 1];
  if (lastRange.max !== totalChallenges) {
    return {
      valid: false,
      issue: `Last range does not end at ${totalChallenges}: ends at ${lastRange.max}`
    };
  }
  
  return { valid: true };
}

// Test continuity for a variety of cases
const continuityTestCases = [
  { challenges: 5, outcomes: 3 },
  { challenges: 10, outcomes: 5 },
  { challenges: 20, outcomes: 7 },
  { challenges: 50, outcomes: 10 }
];

for (const testCase of continuityTestCases) {
  const testName = `Continuity: ${testCase.challenges} challenges, ${testCase.outcomes} outcomes`;
  runTest(testName, () => {
    const ranges = calculateWholeChallengeRanges(testCase.challenges, testCase.outcomes);
    const result = verifyRangeContinuity(ranges, testCase.challenges);
    if (!result.valid) {
      console.error(`  ${result.issue}`);
      console.error(`  Ranges:`, ranges);
      return false;
    }
    return true;
  });
}

console.log();

// Summary
console.log('='.repeat(80));
console.log('Test Summary');
console.log('='.repeat(80));
console.log(`Total Tests: ${totalTests}`);
console.log(`Passed: ${passedTests}`);
console.log(`Failed: ${failedTests}`);
console.log(`Success Rate: ${((passedTests / totalTests) * 100).toFixed(1)}%`);
console.log();

if (failedTests === 0) {
  console.log('✓ All tests passed!');
  process.exit(0);
} else {
  console.error('✗ Some tests failed. Please review the output above.');
  process.exit(1);
}

