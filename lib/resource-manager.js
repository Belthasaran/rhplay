/**
 * resource-manager.js - Resource Management with HTTP Optimization
 * 
 * Handles versioned ZIP file storage, HTTP HEAD requests for change detection,
 * and duplicate prevention
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class ResourceManager {
  constructor(dbManager, config) {
    this.dbManager = dbManager;
    this.config = config;
  }
  
  /**
   * Determine if file should be downloaded based on HTTP headers
   * Uses HEAD request for large files to avoid unnecessary downloads
   */
  async shouldDownloadFile(gameversion, newMetadata, downloadUrl) {
    // 1. If no previous version, always download
    if (!gameversion) {
      return { download: true, reason: 'new_game' };
    }
    
    // 2. Get estimated size
    const estimatedSize = parseInt(newMetadata.size) || 0;
    const SIZE_THRESHOLD = this.config.HEAD_REQUEST_SIZE_THRESHOLD || (5 * 1024 * 1024); // 5 MB
    
    // 3. If size is large, do HEAD request first
    if (estimatedSize > SIZE_THRESHOLD) {
      console.log(`    File size ${(estimatedSize / 1024 / 1024).toFixed(2)} MB > threshold, using HEAD request...`);
      
      const headResponse = await this.makeHeadRequest(downloadUrl);
      
      if (headResponse.success) {
        // 3a. Compare ETag if available
        if (gameversion.local_resource_etag && headResponse.etag) {
          if (gameversion.local_resource_etag === headResponse.etag) {
            console.log(`    ✓ ETag match, file unchanged`);
            return { 
              download: false, 
              reason: 'etag_match',
              headers: headResponse
            };
          }
        }
        
        // 3b. Compare Last-Modified if available
        if (gameversion.local_resource_lastmodified && headResponse.lastModified) {
          const oldTime = new Date(gameversion.local_resource_lastmodified).getTime();
          const newTime = new Date(headResponse.lastModified).getTime();
          
          if (oldTime === newTime) {
            console.log(`    ✓ Last-Modified match, file unchanged`);
            return { 
              download: false, 
              reason: 'lastmodified_match',
              headers: headResponse
            };
          }
        }
        
        // 3c. Compare size from HEAD response
        if (headResponse.contentLength && gameversion.size) {
          const oldSize = parseInt(gameversion.size);
          const newSize = headResponse.contentLength;
          
          if (oldSize === newSize) {
            console.log(`    ✓ Size match (${oldSize} bytes), file unchanged`);
            return { 
              download: false, 
              reason: 'size_match',
              headers: headResponse
            };
          }
        }
        
        console.log(`    File appears changed, download needed`);
      } else {
        console.log(`    ⚠ HEAD request failed, will attempt full download`);
      }
    }
    
    // 4. Download needed
    return { download: true, reason: 'change_detected' };
  }
  
  /**
   * Make HTTP HEAD request to get headers without downloading body
   */
  async makeHeadRequest(url) {
    try {
      const response = await fetch(url, { 
        method: 'HEAD',
        headers: { 
          'User-Agent': this.config.USER_AGENT 
        }
      });
      
      return {
        success: response.ok,
        etag: response.headers.get('ETag'),
        lastModified: response.headers.get('Last-Modified'),
        contentLength: parseInt(response.headers.get('Content-Length')),
        statusCode: response.status
      };
    } catch (error) {
      return { 
        success: false, 
        error: error.message 
      };
    }
  }
  
  /**
   * Determine versioned filename for ZIP file
   * Version 1: zips/GAMEID.zip
   * Version 2+: zips/GAMEID_VERSION.zip
   */
  determineZipFilename(gameid, version) {
    if (version === 1) {
      return path.join(this.config.ZIPS_DIR, `${gameid}.zip`);
    } else {
      return path.join(this.config.ZIPS_DIR, `${gameid}_${version}.zip`);
    }
  }
  
  /**
   * Save ZIP file with versioning and duplicate detection
   * Returns: { saved: boolean, path: string, wasDuplicate: boolean, duplicateOf: string|null }
   */
  async saveZipFile(gameid, version, zipData, headers = {}) {
    const targetPath = this.determineZipFilename(gameid, version);
    
    // 1. Check if exact file already exists at target path
    if (fs.existsSync(targetPath)) {
      const existingHash = this.calculateFileHash(targetPath);
      const newHash = this.calculateBufferHash(zipData);
      
      if (existingHash === newHash) {
        console.log(`    ⓘ File already exists with identical content: ${path.basename(targetPath)}`);
        return { 
          saved: false, 
          path: targetPath, 
          wasDuplicate: true,
          duplicateOf: targetPath
        };
      }
      
      // File exists but different content - this shouldn't happen with versioning
      console.warn(`    ⚠ Warning: File exists with different content: ${targetPath}`);
      // We'll overwrite in this case (version number should be unique)
    }
    
    // 2. Check for duplicate ZIPs in other versions of same game
    const newHash = this.calculateBufferHash(zipData);
    const duplicatePath = await this.findDuplicateZipByHash(gameid, newHash, targetPath);
    
    if (duplicatePath) {
      console.log(`    ⓘ Identical ZIP found in ${path.basename(duplicatePath)}, will reuse patchblobs`);
      
      // Still create a symlink or record the duplicate
      // But for now, we'll just note it and return the duplicate path
      return { 
        saved: false, 
        path: duplicatePath, 
        wasDuplicate: true,
        duplicateOf: duplicatePath,
        hash: newHash
      };
    }
    
    // 3. Save new file atomically
    const tempPath = `${targetPath}.new`;
    fs.writeFileSync(tempPath, zipData);
    
    // Atomic rename
    if (fs.existsSync(targetPath)) {
      fs.unlinkSync(targetPath);
    }
    fs.renameSync(tempPath, targetPath);
    
    console.log(`    ✓ Saved: ${path.basename(targetPath)} (${zipData.length.toLocaleString()} bytes)`);
    
    return { 
      saved: true, 
      path: targetPath, 
      wasDuplicate: false,
      hash: newHash
    };
  }
  
  /**
   * Find duplicate ZIP file by hash for same gameid
   */
  async findDuplicateZipByHash(gameid, targetHash, excludePath) {
    // Get all versions of this game from database
    const versions = this.dbManager.db.prepare(`
      SELECT local_resource_filename 
      FROM gameversions 
      WHERE gameid = ? AND local_resource_filename IS NOT NULL
    `).all(gameid);
    
    for (const version of versions) {
      const filePath = version.local_resource_filename;
      
      // Skip the path we're about to save to
      if (filePath === excludePath) {
        continue;
      }
      
      // Check if file exists
      if (!fs.existsSync(filePath)) {
        continue;
      }
      
      // Calculate hash
      const fileHash = this.calculateFileHash(filePath);
      
      if (fileHash === targetHash) {
        return filePath;
      }
    }
    
    return null;
  }
  
  /**
   * Calculate SHA-256 hash of a file
   */
  calculateFileHash(filePath) {
    const data = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(data).digest('hex');
  }
  
  /**
   * Calculate SHA-256 hash of a buffer
   */
  calculateBufferHash(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }
  
  /**
   * Extract path and filename (public method)
   */
  extractPathAndFilename(url) {
    if (!url) return '';
    
    // Remove protocol
    let path = url.replace(/^https?:\/\//, '').replace(/^\/\//, '');
    
    // Find first slash
    const slashIndex = path.indexOf('/');
    
    if (slashIndex === -1) {
      return '/';
    }
    
    return path.substring(slashIndex);
  }
}

module.exports = ResourceManager;

