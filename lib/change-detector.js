/**
 * change-detector.js - Change Detection and Classification
 * 
 * Detects changes between old and new game metadata and classifies them as major or minor
 */

const UrlComparator = require('./url-comparator');

class ChangeDetector {
  constructor(dbManager, config = {}) {
    this.dbManager = dbManager;
    this.config = config;
    this.fieldConfig = this.loadConfiguration();
    this.urlComparator = new UrlComparator(config);
  }
  
  /**
   * Load field classification configuration from database
   */
  loadConfiguration() {
    const rows = this.dbManager.db.prepare(`
      SELECT field_name, classification, weight 
      FROM change_detection_config 
      WHERE active = 1
    `).all();
    
    const config = {
      major: new Map(),
      minor: new Map(),
      ignored: new Set()
    };
    
    for (const row of rows) {
      if (row.classification === 'major') {
        config.major.set(row.field_name, row.weight);
      } else if (row.classification === 'minor') {
        config.minor.set(row.field_name, row.weight);
      } else if (row.classification === 'ignored') {
        config.ignored.add(row.field_name);
      }
    }
    
    return config;
  }
  
  /**
   * Detect changes between old and new game data
   * Returns: { type: 'major'|'minor'|'none', changes: [...], score: number }
   */
  detectChanges(oldRecord, newMetadata) {
    // Parse JSON data
    const oldData = typeof oldRecord.gvjsondata === 'string' 
      ? JSON.parse(oldRecord.gvjsondata) 
      : oldRecord.gvjsondata;
    
    const newData = this.normalizeMetadata(newMetadata);
    
    // Find all changed fields
    const changes = this.compareObjects(oldData, newData, oldRecord);
    
    if (changes.length === 0) {
      return { type: 'none', changes: [], score: 0 };
    }
    
    // Classify changes
    const classification = this.classifyChanges(changes);
    
    return classification;
  }
  
  /**
   * Normalize metadata from SMWC (apply same normalization as Phase 1)
   */
  normalizeMetadata(raw) {
    const normalized = { ...raw };
    
    // Ensure id is string
    if (normalized.id !== undefined) {
      normalized.id = String(normalized.id);
    }
    
    // Time to added
    if (!normalized.added && normalized.time) {
      try {
        const timestamp = parseInt(normalized.time);
        if (!isNaN(timestamp)) {
          const date = new Date(timestamp * 1000);
          normalized.added = date.toISOString().replace('T', ' ').substring(0, 19);
        }
      } catch (error) {
        // Keep original
      }
    }
    
    // Normalize type/difficulty
    if (normalized.difficulty && !normalized.type) {
      normalized.type = normalized.difficulty;
    }
    
    // Normalize URLs
    if (!normalized.name_href && normalized.download_url) {
      normalized.name_href = normalized.download_url;
    }
    if (!normalized.download_url && normalized.name_href) {
      normalized.download_url = normalized.name_href;
    }
    
    // Normalize authors
    if (!normalized.author && normalized.authors) {
      if (typeof normalized.authors === 'string') {
        normalized.author = normalized.authors;
      } else if (Array.isArray(normalized.authors)) {
        normalized.author = normalized.authors.map(a => {
          if (typeof a === 'object' && a.name) return a.name;
          return String(a);
        }).join(', ');
        normalized.authors = normalized.author;
      }
    }
    
    return normalized;
  }
  
  /**
   * Compare two objects and find changed fields
   */
  compareObjects(oldObj, newObj, oldRecord) {
    const changes = [];
    
    // Get union of all keys
    const allKeys = new Set([
      ...Object.keys(oldObj),
      ...Object.keys(newObj)
    ]);
    
    for (const key of allKeys) {
      // Skip ignored fields
      if (this.fieldConfig.ignored.has(key)) {
        continue;
      }
      
      // Special handling for download URLs - use URL comparator
      if (key === 'download_url' || key === 'name_href') {
        const urlChange = this.urlComparator.isSignificantUrlChange(
          oldObj[key] || oldRecord[key],
          newObj[key],
          oldObj.size || oldRecord.size,
          newObj.size
        );
        
        if (urlChange.significant) {
          changes.push({
            field: key,
            oldValue: oldObj[key] || oldRecord[key],
            newValue: newObj[key],
            changeType: 'url_change',
            urlChangeReason: urlChange.reason,
            urlChangeDetails: urlChange.details
          });
        }
        continue;
      }
      
      const oldVal = oldObj[key] !== undefined ? oldObj[key] : oldRecord[key];
      const newVal = newObj[key];
      
      // Normalize for comparison
      const oldNorm = this.normalizeValue(oldVal);
      const newNorm = this.normalizeValue(newVal);
      
      // Compare
      if (!this.valuesEqual(oldNorm, newNorm)) {
        changes.push({
          field: key,
          oldValue: oldVal,
          newValue: newVal,
          changeType: this.getChangeType(oldVal, newVal)
        });
      }
    }
    
    return changes;
  }
  
  /**
   * Normalize value for comparison
   */
  normalizeValue(val) {
    // Treat null, undefined, empty string as equivalent
    if (val === null || val === undefined || val === '') {
      return null;
    }
    
    // Trim strings
    if (typeof val === 'string') {
      return val.trim();
    }
    
    // Sort arrays for comparison
    if (Array.isArray(val)) {
      return JSON.stringify([...val].sort());
    }
    
    // Stringify objects
    if (typeof val === 'object') {
      return JSON.stringify(val);
    }
    
    return val;
  }
  
  /**
   * Check if two normalized values are equal
   */
  valuesEqual(val1, val2) {
    if (val1 === val2) return true;
    
    // Both null-ish
    if (!val1 && !val2) return true;
    
    // Deep equality
    if (typeof val1 === 'string' && typeof val2 === 'string') {
      return val1 === val2;
    }
    
    return false;
  }
  
  /**
   * Determine type of change
   */
  getChangeType(oldVal, newVal) {
    if (oldVal === null || oldVal === undefined || oldVal === '') {
      return 'added';
    }
    if (newVal === null || newVal === undefined || newVal === '') {
      return 'removed';
    }
    return 'modified';
  }
  
  /**
   * Classify changes as major or minor
   */
  classifyChanges(changes) {
    let majorScore = 0;
    let minorScore = 0;
    const majorChanges = [];
    const minorChanges = [];
    const unknownChanges = [];
    
    for (const change of changes) {
      const field = change.field;
      
      if (this.fieldConfig.major.has(field)) {
        const weight = this.fieldConfig.major.get(field);
        majorScore += weight;
        majorChanges.push(change);
      } else if (this.fieldConfig.minor.has(field)) {
        const weight = this.fieldConfig.minor.get(field);
        minorScore += weight;
        minorChanges.push(change);
      } else {
        // Unknown field - treat as minor but log it
        unknownChanges.push(change);
        minorScore += 1;
      }
    }
    
    // Determine overall classification
    let type = 'none';
    if (majorScore > 0) {
      type = 'major';
    } else if (minorScore > 0 || unknownChanges.length > 0) {
      type = 'minor';
    }
    
    return {
      type,
      score: majorScore > 0 ? majorScore : minorScore,
      majorChanges,
      minorChanges,
      unknownChanges,
      totalChanges: changes.length
    };
  }
  
  /**
   * Create human-readable change summary
   */
  formatChangeSummary(classification) {
    const lines = [];
    
    if (classification.majorChanges.length > 0) {
      lines.push('    Major changes:');
      for (const change of classification.majorChanges) {
        lines.push(`      - ${change.field}: ${change.changeType}`);
        if (change.urlChangeReason) {
          lines.push(`        Reason: ${change.urlChangeReason}`);
        }
      }
    }
    
    if (classification.minorChanges.length > 0) {
      lines.push('    Minor changes:');
      for (const change of classification.minorChanges) {
        lines.push(`      - ${change.field}: ${change.changeType}`);
      }
    }
    
    if (classification.unknownChanges.length > 0) {
      lines.push('    Unknown fields:');
      for (const change of classification.unknownChanges) {
        lines.push(`      - ${change.field}: ${change.changeType}`);
      }
    }
    
    return lines.join('\n');
  }
}

module.exports = ChangeDetector;

