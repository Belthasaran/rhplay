const fs = require('fs');
const path = require('path');

/**
 * Samples a random selection of lines from temp.txt, analyzes distribution,
 * and performs statistical tests for randomness.
 */

// Read the input file
const inputFile = path.join(__dirname, 'temp.txt');
const outputFile1 = path.join(__dirname, 'temp2.txt');
const outputFile2 = path.join(__dirname, 'temp3.txt');

try {
  // Read all lines from temp.txt
  const fileContent = fs.readFileSync(inputFile, 'utf-8');
  const lines = fileContent.split('\n');
  
  // Remove empty last line if exists
  if (lines[lines.length - 1] === '') {
    lines.pop();
  }
  
  const totalLines = lines.length;
  console.log(`Total lines in temp.txt: ${totalLines}`);
  
  // Calculate 4% of lines, rounded to nearest increment of 10
  const samplePercentage = 0.04;
  const rawSampleSize = totalLines * samplePercentage;
  const sampleSize = Math.round(rawSampleSize / 10) * 10;
  
  console.log(`Sample size (4% rounded to nearest 10): ${sampleSize}`);
  
  // Randomly sample lines
  const lineIndices = Array.from({ length: totalLines }, (_, i) => i);
  const sampledIndices = [];
  
  // Fisher-Yates shuffle to select random indices
  for (let i = 0; i < sampleSize && i < totalLines; i++) {
    const randomIndex = i + Math.floor(Math.random() * (lineIndices.length - i));
    [lineIndices[i], lineIndices[randomIndex]] = [lineIndices[randomIndex], lineIndices[i]];
    sampledIndices.push(lineIndices[i]);
  }
  
  // Sort indices to maintain order
  sampledIndices.sort((a, b) => a - b);
  
  // Extract sampled lines
  const sampledLines = sampledIndices.map(idx => lines[idx]);
  
  // Save sampled lines to temp2.txt
  fs.writeFileSync(outputFile1, sampledLines.join('\n') + '\n', 'utf-8');
  console.log(`Sampled lines saved to temp2.txt`);
  
  // Divide file into 10 equal regions and count samples per region
  const numRegions = 10;
  const regionSize = totalLines / numRegions;
  const regionCounts = new Array(numRegions).fill(0);
  
  // Count samples in each region
  sampledIndices.forEach(idx => {
    const region = Math.min(Math.floor(idx / regionSize), numRegions - 1);
    regionCounts[region]++;
  });
  
  console.log('Region counts:', regionCounts);
  
  // Create ASCII histogram
  let histogram = '='.repeat(70) + '\n';
  histogram += 'HISTOGRAM: Distribution of Samples Across File Regions\n';
  histogram += '='.repeat(70) + '\n\n';
  histogram += `Total lines in temp.txt: ${totalLines}\n`;
  histogram += `Sample size: ${sampleSize} (${(sampleSize/totalLines*100).toFixed(2)}%)\n`;
  histogram += `Regions: ${numRegions}\n`;
  histogram += `Lines per region: ${regionSize.toFixed(1)}\n\n`;
  
  // Find max count for scaling
  const maxCount = Math.max(...regionCounts);
  const barWidth = 50; // Maximum bar width in characters
  
  histogram += 'Region | Count | Distribution\n';
  histogram += '-------|-------|' + '-'.repeat(barWidth + 2) + '\n';
  
  regionCounts.forEach((count, idx) => {
    const barLength = maxCount > 0 ? Math.round((count / maxCount) * barWidth) : 0;
    const bar = '█'.repeat(barLength);
    const regionNum = (idx + 1).toString().padStart(2);
    const countStr = count.toString().padStart(5);
    histogram += `  ${regionNum}   | ${countStr} | ${bar} ${count}\n`;
  });
  
  histogram += '\n';
  
  // Statistical Analysis: Chi-square goodness-of-fit test
  histogram += '='.repeat(70) + '\n';
  histogram += 'STATISTICAL ANALYSIS: Chi-Square Goodness-of-Fit Test\n';
  histogram += '='.repeat(70) + '\n\n';
  histogram += 'Null Hypothesis (H0): The sample is uniformly distributed (random)\n';
  histogram += 'Alternative Hypothesis (H1): The sample is not uniformly distributed\n\n';
  
  // Expected count per region under uniform distribution
  const expectedCount = sampleSize / numRegions;
  
  histogram += `Expected count per region: ${expectedCount.toFixed(2)}\n\n`;
  
  // Calculate chi-square statistic
  let chiSquare = 0;
  histogram += 'Region | Observed | Expected | (O-E)²/E\n';
  histogram += '-------|----------|----------|----------\n';
  
  regionCounts.forEach((observed, idx) => {
    const contribution = Math.pow(observed - expectedCount, 2) / expectedCount;
    chiSquare += contribution;
    const regionNum = (idx + 1).toString().padStart(2);
    histogram += `  ${regionNum}   |   ${observed.toString().padStart(4)}   |  ${expectedCount.toFixed(2).padStart(6)} | ${contribution.toFixed(4)}\n`;
  });
  
  histogram += '\n';
  histogram += `Chi-square statistic (χ²): ${chiSquare.toFixed(4)}\n`;
  histogram += `Degrees of freedom: ${numRegions - 1}\n\n`;
  
  // Calculate p-value using chi-square distribution
  // Approximation using gamma function
  const df = numRegions - 1;
  const pValue = chiSquarePValue(chiSquare, df);
  
  histogram += `P-value: ${pValue.toFixed(6)}\n\n`;
  
  // Interpret results
  const alpha = 0.05;
  histogram += `Significance level (α): ${alpha}\n\n`;
  histogram += 'INTERPRETATION:\n';
  histogram += '-'.repeat(70) + '\n';
  
  if (pValue > alpha) {
    histogram += `P-value (${pValue.toFixed(6)}) > α (${alpha})\n`;
    histogram += 'Result: FAIL TO REJECT the null hypothesis\n\n';
    histogram += 'Conclusion: The sample distribution is consistent with a truly random\n';
    histogram += 'selection. There is no statistically significant evidence that the\n';
    histogram += 'sampling is non-uniform.\n';
  } else {
    histogram += `P-value (${pValue.toFixed(6)}) ≤ α (${alpha})\n`;
    histogram += 'Result: REJECT the null hypothesis\n\n';
    histogram += 'Conclusion: The sample distribution shows statistically significant\n';
    histogram += 'deviation from uniform distribution. This suggests the sampling may\n';
    histogram += 'not be truly random.\n';
  }
  
  histogram += '\n';
  histogram += '='.repeat(70) + '\n';
  
  // Save histogram and analysis to temp3.txt
  fs.writeFileSync(outputFile2, histogram, 'utf-8');
  console.log('Histogram and statistical analysis saved to temp3.txt');
  
  console.log('\nSummary:');
  console.log(`Chi-square: ${chiSquare.toFixed(4)}, P-value: ${pValue.toFixed(6)}`);
  console.log(`Result: ${pValue > alpha ? 'Random distribution' : 'Non-random distribution'}`);
  
} catch (error) {
  console.error('Error:', error.message);
  process.exit(1);
}

/**
 * Calculate p-value for chi-square test
 * Uses incomplete gamma function approximation
 */
function chiSquarePValue(chiSquare, df) {
  if (chiSquare < 0 || df < 1) {
    return 1;
  }
  
  // Use regularized gamma Q function
  return gammaQ(df / 2, chiSquare / 2);
}

/**
 * Regularized upper incomplete gamma function Q(a,x) = 1 - P(a,x)
 * This is the cumulative distribution function of chi-square
 */
function gammaQ(a, x) {
  if (x < 0 || a <= 0) {
    return 0;
  }
  
  if (x < a + 1) {
    // Use series representation
    return 1 - gammaP(a, x);
  } else {
    // Use continued fraction representation
    return gammaCF(a, x);
  }
}

/**
 * Regularized lower incomplete gamma function P(a,x)
 * Using series representation
 */
function gammaP(a, x) {
  if (x < 0 || a <= 0) {
    return 0;
  }
  
  if (x === 0) {
    return 0;
  }
  
  // Series expansion
  let sum = 1.0;
  let term = 1.0;
  let n = 1;
  
  while (n < 1000) {
    term *= x / (a + n);
    sum += term;
    if (Math.abs(term) < 1e-10 * Math.abs(sum)) {
      break;
    }
    n++;
  }
  
  return sum * Math.exp(-x + a * Math.log(x) - logGamma(a));
}

/**
 * Continued fraction representation for upper incomplete gamma
 */
function gammaCF(a, x) {
  const maxIterations = 1000;
  const epsilon = 1e-10;
  
  let b = x + 1 - a;
  let c = 1 / 1e-30;
  let d = 1 / b;
  let h = d;
  
  for (let i = 1; i <= maxIterations; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    
    if (Math.abs(d) < 1e-30) {
      d = 1e-30;
    }
    
    c = b + an / c;
    if (Math.abs(c) < 1e-30) {
      c = 1e-30;
    }
    
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    
    if (Math.abs(delta - 1) < epsilon) {
      return Math.exp(-x + a * Math.log(x) - logGamma(a)) * h;
    }
  }
  
  return Math.exp(-x + a * Math.log(x) - logGamma(a)) * h;
}

/**
 * Logarithm of gamma function
 * Using Stirling's approximation and Lanczos approximation
 */
function logGamma(x) {
  // Lanczos approximation coefficients
  const coef = [
    76.18009172947146,
    -86.50532032941677,
    24.01409824083091,
    -1.231739572450155,
    0.1208650973866179e-2,
    -0.5395239384953e-5
  ];
  
  let y = x;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  
  let ser = 1.000000000190015;
  for (let i = 0; i < 6; i++) {
    y += 1;
    ser += coef[i] / y;
  }
  
  return -tmp + Math.log(2.5066282746310005 * ser / x);
}

