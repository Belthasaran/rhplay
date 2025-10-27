/**
 * Shared Filter Utilities for RHTools (Frontend)
 * 
 * Provides consistent filtering logic for the Vue.js frontend.
 * This mirrors the backend shared-filter-utils.js functionality.
 */

/**
 * Parse and apply advanced filter query to a game object
 * @param {Object} item - Game object with properties like Name, Author, Type, etc.
 * @param {string} query - Filter query string
 * @returns {boolean} - Whether the game matches the filter
 */
export function matchesFilter(item: any, query: string): boolean {
  if (!query) return true;
  
  const q = query.trim();
  
  // Split query into individual terms (space-separated)
  const terms = q.split(/\s+/).filter(term => term.length > 0);
  
  // Process each term and combine with AND logic
  for (const term of terms) {
    if (!matchesTerm(item, term)) {
      return false;
    }
  }
  
  return true;
}

/**
 * Check if a game matches a single filter term
 * @param {Object} item - Game item object
 * @param {string} term - Single filter term
 * @returns {boolean} - Whether the game matches the term
 */
function matchesTerm(item: any, term: string): boolean {
  const isNegated = term.startsWith('-');
  const actualTerm = isNegated ? term.substring(1) : term;
  const matches = evaluateTerm(item, actualTerm);
  
  return isNegated ? !matches : matches;
}

/**
 * Evaluate a single filter term (without negation)
 * @param {Object} item - Game item object
 * @param {string} term - Filter term (without negation)
 * @returns {boolean} - Whether the game matches the term
 */
function evaluateTerm(item: any, term: string): boolean {
  const t = term.toLowerCase();
  
  // Check for attribute:value pattern
  const attributeMatch = t.match(/^(\w+):(>|<|>=|<=)?(.+)$/);
  
  if (attributeMatch) {
    const [, attr, operator, value] = attributeMatch;
    
    // Handle rating filters with operators
    if (attr === 'rating') {
      const rating = item.Publicrating ?? 0;
      const targetValue = parseFloat(value);
      
      if (isNaN(targetValue)) return false;
      
      if (operator === '>') return rating > targetValue;
      if (operator === '<') return rating < targetValue;
      if (operator === '>=') return rating >= targetValue;
      if (operator === '<=') return rating <= targetValue;
      return rating === targetValue;
    }
    
    // Handle version filters
    if (attr === 'version') {
      const gameVersion = item.CurrentVersion ?? 1;
      const targetVersion = parseInt(value);
      
      if (isNaN(targetVersion)) return false;
      
      if (operator === '>') return gameVersion > targetVersion;
      if (operator === '<') return gameVersion < targetVersion;
      if (operator === '>=') return gameVersion >= targetVersion;
      if (operator === '<=') return gameVersion <= targetVersion;
      return gameVersion === targetVersion;
    }
    
    // Handle numeric fields with operators
    if (['length', 'added'].includes(attr)) {
      const itemValue = getItemAttribute(item, attr);
      if (itemValue === null) return false;
      
      const numValue = parseFloat(itemValue);
      const targetValue = parseFloat(value);
      
      if (isNaN(numValue) || isNaN(targetValue)) {
        // Fall back to string comparison
        return itemValue.toLowerCase().includes(value.toLowerCase());
      }
      
      if (operator === '>') return numValue > targetValue;
      if (operator === '<') return numValue < targetValue;
      if (operator === '>=') return numValue >= targetValue;
      if (operator === '<=') return numValue <= targetValue;
      return numValue === targetValue;
    }
    
    // Handle other attribute searches
    const itemValue = getItemAttribute(item, attr);
    if (itemValue === null) return false;
    
    return itemValue.toLowerCase().includes(value.toLowerCase());
  }
  
  // Default: search across all fields
  const haystack = [
    item.Id,
    item.Name,
    item.Type,
    item.Author,
    item.Length,
    item.Status,
    String(item.MyDifficultyRating ?? ''),
    String(item.MyReviewRating ?? ''),
    String(item.Publicrating ?? ''),
    String(item.Mynotes ?? ''),
    // Include JSON data if available
    item.JsonData?.added ? String(item.JsonData.added) : '',
    item.JsonData?.difficulty ? String(item.JsonData.difficulty) : '',
    item.JsonData?.gametype ? String(item.JsonData.gametype) : '',
    item.JsonData?.legacy_type ? String(item.JsonData.legacy_type) : '',
    item.JsonData?.demo ? String(item.JsonData.demo) : '',
    item.JsonData?.featured ? String(item.JsonData.featured) : '',
    item.JsonData?.obsoleted ? String(item.JsonData.obsoleted) : '',
    item.JsonData?.removed ? String(item.JsonData.removed) : '',
    item.JsonData?.moderated ? String(item.JsonData.moderated) : '',
    item.JsonData?.tags ? String(item.JsonData.tags) : '',
    item.JsonData?.section ? String(item.JsonData.section) : '',
  ].join(' ').toLowerCase();
  
  return haystack.includes(t);
}

/**
 * Get attribute value from item or its JSON data
 * @param {Object} item - Game item object
 * @param {string} attr - Attribute name
 * @returns {string|null} - Attribute value or null if not found
 */
export function getItemAttribute(item: any, attr: string): string | null {
  // Direct properties
  const directProps: Record<string, any> = {
    id: item.Id,
    name: item.Name,
    type: item.Type,
    author: item.Author,
    length: item.Length,
    status: item.Status,
    rating: item.Publicrating,
    notes: item.Mynotes,
    version: item.CurrentVersion,
  };
  
  if (directProps[attr] !== undefined) {
    return String(directProps[attr] ?? '');
  }
  
  // Check JSON data attributes
  if (item.JsonData && item.JsonData[attr] !== undefined) {
    return String(item.JsonData[attr]);
  }
  
  return null;
}

/**
 * Apply filter to a list of items
 * @param {Array} items - Array of item objects
 * @param {string} query - Filter query string
 * @returns {Array} - Filtered array of items
 */
export function filterItems(items: any[], query: string): any[] {
  if (!query) return items;
  return items.filter(item => matchesFilter(item, query));
}

/**
 * Count items matching a filter query
 * @param {Array} items - Array of item objects
 * @param {string} query - Filter query string
 * @returns {number} - Number of matching items
 */
export function countMatchingItems(items: any[], query: string): number {
  if (!query) return items.length;
  return items.filter(item => matchesFilter(item, query)).length;
}
