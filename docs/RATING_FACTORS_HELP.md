# Rating Factors Help System

This document describes the semi-automated rating factors documentation system.

## Overview

The rating factors help system provides comprehensive documentation of all rating factors in the rating card. It consists of:

1. **Template File** (`docs/rating-factors-template.json`) - Defines the structure and allows manual additions
2. **Generation Script** (`jstools/generate-rating-help.js`) - Extracts information from `App.vue` and generates documentation
3. **Generated Files**:
   - `docs/rating-factors.json` - Complete rating factors data
   - `electron/renderer/src/components/RatingFactorsHelp.vue` - Vue component for displaying help

## Usage

### Generating the Help Documentation

Run the generation script:

```bash
node jstools/generate-rating-help.js
```

This script:
- Extracts label functions from `App.vue`
- Extracts display names and descriptions from the UI
- Extracts hover text (if available)
- Generates the JSON file and Vue component

### Adding Custom Content

Edit `docs/rating-factors-template.json` to add:
- Custom introduction content in `introduction.customContent`
- Extra guidelines for each rating factor in `ratingFactors[].extraGuidelines`
- Custom footer content in `footer.customContent`

After editing the template, regenerate the documentation.

### Viewing the Help

The help is accessible from the Rating Sheet modal:
1. Open the Rating Sheet for any game
2. Click the "?" button in the modal header
3. The Rating Factors Help modal will open showing all rating factors

## Template Structure

Each rating factor in the template includes:

- **internalName**: Database column name (e.g., `user_review_rating`)
- **displayName**: Display name shown in UI (auto-extracted)
- **range**: Min/max values (auto-extracted)
- **description**: Descriptive text from UI (auto-extracted)
- **extraGuidelines**: Additional manual guidelines (edit in template)
- **labels**: Array of rating labels (auto-extracted from label functions)
- **hoverText**: Additional context for specific ratings (auto-extracted if available)
- **commentField**: Associated comment field name

## Auto-Extracted Fields

The following fields are automatically extracted and should not be manually edited:

- `displayName` - Extracted from UI labels
- `description` - Extracted from `rating-description-inline` spans
- `labels` - Extracted from label functions (e.g., `reviewLabel`, `difficultyLabel`)
- `hoverText` - Extracted from hover text functions (e.g., `skillRatingHoverText`)
- `range.min` and `range.max` - Determined from label function analysis

## Manual Fields

The following fields should be edited in the template:

- `introduction.customContent` - Custom introduction HTML
- `ratingFactors[].extraGuidelines` - Additional guidelines per factor
- `footer.customContent` - Custom footer HTML

## Maintenance

When adding new rating factors:

1. Add the rating factor to `App.vue` (UI component and label function)
2. Add the factor to `docs/rating-factors-template.json` in the `ratingFactors` array
3. Update `RATING_FACTOR_MAP` in `jstools/generate-rating-help.js` with the mapping
4. Run the generation script
5. Add any custom guidelines in the template
6. Regenerate

## Files

- `docs/rating-factors-template.json` - Template (edit for custom content)
- `docs/rating-factors.json` - Generated output (do not edit manually)
- `electron/renderer/src/components/RatingFactorsHelp.vue` - Generated component (do not edit manually)
- `jstools/generate-rating-help.js` - Generation script

