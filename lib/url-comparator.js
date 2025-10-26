/**
 * url-comparator.js - URL Change Detection Logic
 * 
 * Determines if download URL changes are significant (new file) or minor (CDN/hostname change)
 */

class UrlComparator {
  constructor(config = {}) {
    this.config = {
      SIZE_CHANGE_THRESHOLD_PERCENT: config.SIZE_CHANGE_THRESHOLD_PERCENT || 5,
      ...config
    };
  }
  
  /**
   * Determine if URL change is significant (indicates new file version)
   * 
   * MAJOR changes (new file version):
   * - Path or filename changed (e.g., v1.0.11.zip → v1.0.12.zip)
   * - File size changed significantly (>5%)
   * 
   * MINOR changes (same file, different location):
   * - Hostname changed (dl.smwcentral.net → dl2.smwcentral.net)
   * - Protocol changed (http → https)
   * - Relative vs absolute URL
   */
  isSignificantUrlChange(oldUrl, newUrl, oldSize, newSize) {
    if (!oldUrl || !newUrl) {
      return { significant: true, reason: 'missing_url' };
    }
    
    // 1. Normalize and extract path/filename
    const oldPath = this.extractPathAndFilename(oldUrl);
    const newPath = this.extractPathAndFilename(newUrl);
    
    // 2. Compare paths and filenames
    if (oldPath !== newPath) {
      return { 
        significant: true, 
        reason: 'path_changed',
        details: { oldPath, newPath }
      };
    }
    
    // 3. Compare sizes if available
    if (oldSize && newSize) {
      const oldSizeNum = parseInt(oldSize);
      const newSizeNum = parseInt(newSize);
      
      if (!isNaN(oldSizeNum) && !isNaN(newSizeNum) && oldSizeNum > 0) {
        const sizeDiff = Math.abs(newSizeNum - oldSizeNum);
        const sizeChangePercent = (sizeDiff / oldSizeNum) * 100;
        
        if (sizeChangePercent > this.config.SIZE_CHANGE_THRESHOLD_PERCENT) {
          return { 
            significant: true, 
            reason: 'size_changed',
            details: { 
              oldSize: oldSizeNum, 
              newSize: newSizeNum, 
              changePercent: sizeChangePercent.toFixed(2) 
            }
          };
        }
      }
    }
    
    // 4. Only hostname/protocol changed - not significant
    return { 
      significant: false, 
      reason: 'hostname_or_protocol_only',
      details: { oldPath, newPath }
    };
  }
  
  /**
   * Extract path and filename from URL, ignoring protocol and hostname
   * 
   * Examples:
   *   "https://dl.smwcentral.net/39116/file.zip" → "/39116/file.zip"
   *   "//dl.smwcentral.net/39116/file.zip" → "/39116/file.zip"
   *   "http://dl2.smwcentral.net/39116/file.zip" → "/39116/file.zip"
   */
  extractPathAndFilename(url) {
    if (!url) return '';
    
    // Remove protocol (http://, https://, or //)
    let path = url.replace(/^https?:\/\//, '').replace(/^\/\//, '');
    
    // Find first slash (start of path)
    const slashIndex = path.indexOf('/');
    
    if (slashIndex === -1) {
      // No path, just hostname
      return '/';
    }
    
    // Return path from first slash onward
    return path.substring(slashIndex);
  }
  
  /**
   * Compare two URLs and provide detailed analysis
   */
  compareUrls(oldUrl, newUrl) {
    const oldNormalized = this.normalizeUrl(oldUrl);
    const newNormalized = this.normalizeUrl(newUrl);
    
    return {
      identical: oldNormalized === newNormalized,
      oldUrl: oldNormalized,
      newUrl: newNormalized,
      oldPath: this.extractPathAndFilename(oldUrl),
      newPath: this.extractPathAndFilename(newUrl),
      pathChanged: this.extractPathAndFilename(oldUrl) !== this.extractPathAndFilename(newUrl)
    };
  }
  
  /**
   * Normalize URL for comparison
   */
  normalizeUrl(url) {
    if (!url) return '';
    
    let normalized = url;
    
    // Add protocol if missing
    if (normalized.startsWith('//')) {
      normalized = 'https:' + normalized;
    }
    
    // Ensure protocol
    if (!normalized.match(/^https?:\/\//)) {
      normalized = 'https://' + normalized;
    }
    
    // Remove trailing slash
    normalized = normalized.replace(/\/$/, '');
    
    return normalized;
  }
  
  /**
   * Determine if size change is significant
   */
  isSizeChangeSignificant(oldSize, newSize) {
    const oldSizeNum = parseInt(oldSize);
    const newSizeNum = parseInt(newSize);
    
    if (isNaN(oldSizeNum) || isNaN(newSizeNum) || oldSizeNum === 0) {
      return { significant: false, reason: 'invalid_size_data' };
    }
    
    const sizeDiff = Math.abs(newSizeNum - oldSizeNum);
    const sizeChangePercent = (sizeDiff / oldSizeNum) * 100;
    
    if (sizeChangePercent > this.config.SIZE_CHANGE_THRESHOLD_PERCENT) {
      return {
        significant: true,
        changePercent: sizeChangePercent.toFixed(2),
        oldSize: oldSizeNum,
        newSize: newSizeNum,
        difference: sizeDiff
      };
    }
    
    return { significant: false, changePercent: sizeChangePercent.toFixed(2) };
  }
}

module.exports = UrlComparator;

