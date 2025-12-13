#!/usr/bin/env node

/**
 * generate-rating-help.js
 * 
 * Extracts rating factor information from App.vue and generates:
 * 1. A JSON file with all rating factors and their labels
 * 2. A Vue component for displaying the help page
 * 
 * Usage: node generate-rating-help.js
 */

const fs = require('fs');
const path = require('path');

const APP_VUE_PATH = path.join(__dirname, '../electron/renderer/src/App.vue');
const TEMPLATE_PATH = path.join(__dirname, '../docs/rating-factors-template.json');
const OUTPUT_JSON_PATH = path.join(__dirname, '../docs/rating-factors.json');
const OUTPUT_COMPONENT_PATH = path.join(__dirname, '../electron/renderer/src/components/RatingFactorsHelp.vue');

// Mapping of internal names to their label functions and UI info
const RATING_FACTOR_MAP = {
  'user_review_rating': {
    labelFunction: 'reviewLabel',
    dataKey: 'MyReviewRating',
    range: { min: 0, max: 5 },
    stars: 6
  },
  'user_difficulty_rating': {
    labelFunction: 'difficultyLabel',
    dataKey: 'MyDifficultyRating',
    range: { min: 0, max: 10 },
    stars: 11
  },
  'user_skill_rating': {
    labelFunction: 'skillLabel',
    dataKey: 'MySkillRating',
    range: { min: 0, max: 10 },
    stars: 11,
    hasHoverText: true,
    hoverFunction: 'skillRatingHoverText'
  },
  'user_skill_rating_when_beat': {
    labelFunction: 'skillLabel',
    dataKey: 'MySkillRatingWhenBeat',
    range: { min: 0, max: 10 },
    stars: 11,
    hasHoverText: true,
    hoverFunction: 'skillRatingHoverText'
  },
  'user_recommendation_rating': {
    labelFunction: 'recommendLabel',
    dataKey: 'MyRecommendationRating',
    range: { min: 0, max: 5 },
    stars: 6
  },
  'user_importance_rating': {
    labelFunction: 'importanceLabel',
    dataKey: 'MyImportanceRating',
    range: { min: 0, max: 5 },
    stars: 6
  },
  'user_technical_quality_rating': {
    labelFunction: 'techQualityLabel',
    dataKey: 'MyTechnicalQualityRating',
    range: { min: 0, max: 5 },
    stars: 6
  },
  'user_gameplay_design_rating': {
    labelFunction: 'designGameplayLabel',
    dataKey: 'MyGameplayDesignRating',
    range: { min: 0, max: 5 },
    stars: 6
  },
  'user_fairness_rating': {
    labelFunction: 'designFairnessLabel',
    dataKey: 'MyFairnessRating',
    range: { min: 0, max: 5 },
    stars: 6
  },
  'user_challenge_quality_rating': {
    labelFunction: 'designChallengeQualityLabel',
    dataKey: 'MyChallengeQualityRating',
    range: { min: 0, max: 5 },
    stars: 6
  },
  'user_originality_rating': {
    labelFunction: 'originalityLabel',
    dataKey: 'MyOriginalityRating',
    range: { min: 0, max: 5 },
    stars: 6
  },
  'user_visual_aesthetics_rating': {
    labelFunction: 'visualAestheticsLabel',
    dataKey: 'MyVisualAestheticsRating',
    range: { min: 0, max: 5 },
    stars: 6
  },
  'user_story_rating': {
    labelFunction: 'designStoryLabel',
    dataKey: 'MyStoryRating',
    range: { min: 0, max: 5 },
    stars: 6
  },
  'user_soundtrack_graphics_rating': {
    labelFunction: 'designSoundtrackLabel',
    dataKey: 'MySoundtrackGraphicsRating',
    range: { min: 0, max: 5 },
    stars: 6
  },
  'user_accessibility_rating': {
    labelFunction: 'accessibilityLabel',
    dataKey: 'MyAccessibilityRating',
    range: { min: 0, max: 5 },
    stars: 6
  },
  'user_length_pacing': {
    labelFunction: 'lengthPacingLabel',
    dataKey: 'MyLengthPacing',
    range: { min: 0, max: 5 },
    stars: 6
  },
  'user_progression_rating': {
    labelFunction: 'progressionLabel',
    dataKey: 'MyProgressionRating',
    range: { min: 0, max: 5 },
    stars: 6
  },
  'user_consistency_rating': {
    labelFunction: 'consistencyLabel',
    dataKey: 'MyConsistencyRating',
    range: { min: 0, max: 5 },
    stars: 6
  },
  'user_overworld_rating': {
    labelFunction: 'overworldLabel',
    dataKey: 'MyOverworldRating',
    range: { min: 0, max: 5 },
    stars: 6
  },
  'user_education_rating': {
    labelFunction: 'educationLabel',
    dataKey: 'MyEducationRating',
    range: { min: 0, max: 5 },
    stars: 6
  },
  'user_custom_rating': {
    labelFunction: 'customLabel',
    dataKey: 'MyCustomRating',
    range: { min: 0, max: 5 },
    stars: 6
  },
  'user_puzzle_rating': {
    labelFunction: 'puzzleLabel',
    dataKey: 'MyPuzzleRating',
    range: { min: 0, max: 5 },
    stars: 6
  },
  'user_polish_rating': {
    labelFunction: 'polishLabel',
    dataKey: 'MyPolishRating',
    range: { min: 0, max: 5 },
    stars: 6
  },
  'user_boss_rating': {
    labelFunction: 'bossLabel',
    dataKey: 'MyBossRating',
    range: { min: 0, max: 5 },
    stars: 6
  }
};

function extractLabelFunction(appVueContent, functionName) {
  // Extract the label function - match from function declaration to closing brace
  const functionRegex = new RegExp(
    `function\\s+${functionName}\\s*\\([^)]*\\)[^{]*{([^}]+const\\s+labels\\s*=\\s*\\[[^\\]]+\\][^}]+return[^}]+)}`,
    's'
  );
  
  const match = appVueContent.match(functionRegex);
  if (!match) {
    console.warn(`Could not find function ${functionName}`);
    return null;
  }
  
  // Extract the labels array
  const labelsArrayRegex = /const\s+labels\s*=\s*\[([^\]]+)\]/s;
  const labelsMatch = match[1].match(labelsArrayRegex);
  if (!labelsMatch) {
    console.warn(`Could not find labels array in ${functionName}`);
    return null;
  }
  
  return parseLabels(labelsMatch[1]);
}

function parseLabels(labelsString) {
  // Extract labels from array string, handling multi-line, quotes, and comments
  const labels = [];
  
  // First, try to match all quoted strings using regex (handles single, double, template literals)
  // This is more reliable than manual parsing
  const quotedStringRegex = /(['"`])((?:(?=(\\?))\3.)*?)\1/g;
  let match;
  let lastIndex = 0;
  
  while ((match = quotedStringRegex.exec(labelsString)) !== null) {
    let label = match[2];
    // Unescape common escape sequences
    label = label
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\'/g, "'")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
    labels.push(label);
    lastIndex = match.index + match[0].length;
  }
  
  // If we found quoted strings, return them
  if (labels.length > 0) {
    return labels;
  }
  
  // Fallback: parse unquoted strings (less common, but handle it)
  // Split by comma, but be careful with commas inside parentheses
  const parts = [];
  let currentPart = '';
  let depth = 0;
  
  for (let i = 0; i < labelsString.length; i++) {
    const char = labelsString[i];
    if (char === '(' || char === '[' || char === '{') {
      depth++;
      currentPart += char;
    } else if (char === ')' || char === ']' || char === '}') {
      depth--;
      currentPart += char;
    } else if (char === ',' && depth === 0) {
      parts.push(currentPart.trim());
      currentPart = '';
    } else {
      currentPart += char;
    }
  }
  if (currentPart.trim()) {
    parts.push(currentPart.trim());
  }
  
  // Clean up each part
  for (const part of parts) {
    const cleaned = part
      .replace(/\s*\/\/.*$/, '') // Remove comments
      .trim();
    if (cleaned && !cleaned.startsWith('//')) {
      labels.push(cleaned);
    }
  }
  
  return labels;
}

function extractHoverTextFunction(appVueContent, functionName) {
  // Extract the hover text function - it returns from an array
  const functionRegex = new RegExp(
    `function\\s+${functionName}\\s*\\([^)]*\\)[^{]*{([^}]+const\\s+texts\\s*=\\s*\\[[^\\]]+\\][^}]+return[^}]+)}`,
    's'
  );
  
  const match = appVueContent.match(functionRegex);
  if (!match) {
    return null;
  }
  
  // Extract the texts array
  const textsArrayRegex = /const\s+texts\s*=\s*\[([^\]]+)\]/s;
  const textsMatch = match[1].match(textsArrayRegex);
  if (!textsMatch) {
    return null;
  }
  
  const labels = parseLabels(textsMatch[1]);
  const hoverTexts = {};
  labels.forEach((label, index) => {
    hoverTexts[index] = label;
  });
  
  return hoverTexts;
}

function extractDescriptionFromUI(appVueContent, dataKey) {
  // Find the rating component for this dataKey
  // We need to find the specific rating component block that contains this dataKey
  // Pattern: Find the rating-component div that contains updateRating('dataKey')
  
  // First, find all rating-component blocks
  const componentBlocks = appVueContent.match(/<div[^>]*class="rating-component"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/g);
  if (!componentBlocks) {
    return null;
  }
  
  // Find the block that contains this dataKey
  for (const block of componentBlocks) {
    if (block.includes(`updateRating('${dataKey}'`)) {
      // Extract description from this specific block
      const descMatch = block.match(/<span[^>]*class="rating-description-inline"[^>]*>([\s\S]*?)<\/span>/);
      if (descMatch && descMatch[1]) {
        let desc = descMatch[1].trim();
        // Remove HTML tags
        desc = desc.replace(/<[^>]+>/g, '');
        // Remove leading/trailing parentheses and newlines
        desc = desc.replace(/^\s*\(|\s*\)\s*$/g, '').trim();
        // Normalize whitespace
        desc = desc.replace(/\s+/g, ' ').trim();
        if (desc && desc !== '()' && desc.length > 0) {
          return desc;
        }
      }
    }
  }
  
  return null;
}

function extractDisplayName(appVueContent, dataKey) {
  // Find the label text - look for the label element associated with this rating
  const regex = new RegExp(
    `@click="updateRating\\('${dataKey}'[\\s\\S]{0,300}<label[^>]*class="rating-label"[^>]*>([^<]+)<span`,
    's'
  );
  
  const match = appVueContent.match(regex);
  if (match && match[1]) {
    let name = match[1].trim();
    // Remove any HTML tags
    name = name.replace(/<[^>]+>/g, '').trim();
    return name;
  }
  
  // Alternative: look for label before updateRating
  const altRegex = new RegExp(
    `<label[^>]*class="rating-label"[^>]*>([^<]+)</label>[\\s\\S]{0,200}updateRating\\('${dataKey}'`,
    's'
  );
  const altMatch = appVueContent.match(altRegex);
  if (altMatch && altMatch[1]) {
    let name = altMatch[1].trim();
    name = name.replace(/<[^>]+>/g, '').trim();
    return name;
  }
  
  return null;
}

function main() {
  console.log('Reading App.vue...');
  const appVueContent = fs.readFileSync(APP_VUE_PATH, 'utf8');
  
  console.log('Reading template...');
  const template = JSON.parse(fs.readFileSync(TEMPLATE_PATH, 'utf8'));
  
  console.log('Extracting rating factors...');
  
  // Update each rating factor in the template
  for (const factor of template.ratingFactors) {
    const mapping = RATING_FACTOR_MAP[factor.internalName];
    if (!mapping) {
      console.warn(`No mapping found for ${factor.internalName}`);
      continue;
    }
    
    // Extract labels
    const labels = extractLabelFunction(appVueContent, mapping.labelFunction);
    if (labels) {
      factor.labels = labels.map((label, index) => ({
        value: index,
        text: label
      }));
    }
    
    // Extract hover text if available
    if (mapping.hasHoverText && mapping.hoverFunction) {
      const hoverTexts = extractHoverTextFunction(appVueContent, mapping.hoverFunction);
      if (hoverTexts) {
        factor.hoverText = hoverTexts;
      }
    }
    
    // Extract description from UI
    const description = extractDescriptionFromUI(appVueContent, mapping.dataKey);
    if (description && description !== 'AUTO_EXTRACT') {
      factor.description = description;
    } else if (factor.description === 'AUTO_EXTRACT') {
      // Keep AUTO_EXTRACT if extraction failed - user can fill in manually
      console.warn(`  ⚠ Could not extract description for ${factor.internalName}`);
    }
    
    // Extract display name
    const displayName = extractDisplayName(appVueContent, mapping.dataKey);
    if (displayName) {
      factor.displayName = displayName;
    }
    
    // Update range
    factor.range = mapping.range;
    factor.range.description = `${factor.range.min} to ${factor.range.max} stars`;
    
    console.log(`  ✓ ${factor.internalName}`);
  }
  
  // Update metadata
  template.metadata.lastUpdated = new Date().toISOString();
  
  console.log('Writing output JSON...');
  fs.writeFileSync(OUTPUT_JSON_PATH, JSON.stringify(template, null, 2));
  
  console.log('Generating Vue component...');
  generateVueComponent(template);
  
  console.log('Done!');
  console.log(`  - JSON: ${OUTPUT_JSON_PATH}`);
  console.log(`  - Component: ${OUTPUT_COMPONENT_PATH}`);
}

function generateVueComponent(template) {
  // Serialize template to JSON string for inline use
  const templateJson = JSON.stringify(template, null, 2).replace(/\\/g, '\\\\').replace(/`/g, '\\`');
  
  const componentContent = `<!--
  Rating Factors Help Component
  Auto-generated by generate-rating-help.js
  Do not edit manually - regenerate using: node jstools/generate-rating-help.js
-->
<template>
  <div class="rating-factors-help">
    <div class="help-header">
      <h1>{{ template.introduction.title }}</h1>
      <p v-if="template.introduction.description">{{ template.introduction.description }}</p>
      <div v-if="template.introduction.customContent && template.introduction.customContent !== '<!-- Add custom introduction content here -->'" v-html="template.introduction.customContent"></div>
    </div>
    
    <div class="rating-factors-list">
      <div 
        v-for="(factor, index) in template.ratingFactors" 
        :key="factor.internalName"
        class="rating-factor-section"
      >
        <h2 class="factor-title">
          <span class="factor-number">{{ index + 1 }}.</span>
          {{ factor.displayName }}
        </h2>
        
        <div class="factor-meta">
          <div class="meta-item">
            <strong>Internal Name:</strong> <code>{{ factor.internalName }}</code>
          </div>
          <div class="meta-item">
            <strong>Range:</strong> {{ factor.range.min }} to {{ factor.range.max }} stars
          </div>
        </div>
        
        <div v-if="factor.description" class="factor-description">
          <strong>Description:</strong>
          <p>{{ factor.description }}</p>
        </div>
        
        <div v-if="factor.extraGuidelines && factor.extraGuidelines !== '<!-- Add extra guidelines here -->'" class="factor-guidelines">
          <strong>Additional Guidelines:</strong>
          <div v-html="factor.extraGuidelines"></div>
        </div>
        
        <div class="factor-labels" v-if="factor.labels && factor.labels.length > 0">
          <strong>Rating Labels:</strong>
          <table class="labels-table">
            <thead>
              <tr>
                <th>Rating</th>
                <th>Label</th>
                <th v-if="hasHoverText(factor)">Additional Context</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="label in factor.labels" :key="label.value">
                <td class="rating-value">{{ label.value }}</td>
                <td class="label-text">{{ label.text }}</td>
                <td v-if="hasHoverText(factor) && factor.hoverText && factor.hoverText[label.value]" class="hover-text">
                  {{ factor.hoverText[label.value] }}
                </td>
                <td v-else-if="hasHoverText(factor)"></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
    
    <div v-if="template.footer.customContent && template.footer.customContent !== '<!-- Add custom footer content here -->'" class="help-footer" v-html="template.footer.customContent"></div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';

// Rating factors data (embedded from generation)
const templateData = ${templateJson};

const template = ref(templateData);

function hasHoverText(factor: any): boolean {
  return factor.hoverText && Object.keys(factor.hoverText).length > 0;
}
</script>

<style scoped>
.rating-factors-help {
  padding: 20px;
  max-width: 1200px;
  margin: 0 auto;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
  line-height: 1.6;
  color: #333;
}

.help-header {
  margin-bottom: 40px;
  padding-bottom: 20px;
  border-bottom: 2px solid #e0e0e0;
}

.help-header h1 {
  margin: 0 0 10px 0;
  color: #2c3e50;
}

.rating-factors-list {
  display: flex;
  flex-direction: column;
  gap: 40px;
}

.rating-factor-section {
  background: #f9f9f9;
  padding: 25px;
  border-radius: 8px;
  border-left: 4px solid #3498db;
}

.factor-title {
  margin: 0 0 15px 0;
  color: #2c3e50;
  font-size: 1.4em;
}

.factor-number {
  color: #3498db;
  margin-right: 10px;
}

.factor-meta {
  display: flex;
  gap: 20px;
  margin-bottom: 15px;
  flex-wrap: wrap;
}

.meta-item {
  font-size: 0.9em;
  color: #666;
}

.meta-item code {
  background: #e8e8e8;
  padding: 2px 6px;
  border-radius: 3px;
  font-family: 'Courier New', monospace;
  font-size: 0.9em;
}

.factor-description,
.factor-guidelines {
  margin: 15px 0;
  padding: 15px;
  background: white;
  border-radius: 5px;
}

.factor-description strong,
.factor-guidelines strong {
  display: block;
  margin-bottom: 8px;
  color: #2c3e50;
}

.factor-labels {
  margin-top: 20px;
}

.factor-labels strong {
  display: block;
  margin-bottom: 10px;
  color: #2c3e50;
}

.labels-table {
  width: 100%;
  border-collapse: collapse;
  background: white;
  border-radius: 5px;
  overflow: hidden;
}

.labels-table thead {
  background: #3498db;
  color: white;
}

.labels-table th,
.labels-table td {
  padding: 12px;
  text-align: left;
  border-bottom: 1px solid #e0e0e0;
}

.labels-table th {
  font-weight: 600;
}

.rating-value {
  font-weight: bold;
  color: #3498db;
  width: 80px;
}

.label-text {
  color: #333;
}

.hover-text {
  color: #666;
  font-style: italic;
  font-size: 0.9em;
}

.help-footer {
  margin-top: 40px;
  padding-top: 20px;
  border-top: 2px solid #e0e0e0;
}
</style>
`;

  fs.writeFileSync(OUTPUT_COMPONENT_PATH, componentContent);
}

if (require.main === module) {
  main();
}

module.exports = { main, extractLabelFunction, extractHoverTextFunction };

