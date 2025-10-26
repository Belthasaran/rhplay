/**
 * game-downloader.js - Game ZIP Downloader
 * 
 * Downloads game ZIP files from SMWC with retry logic
 */

const fs = require('fs');
const path = require('path');

class GameDownloader {
  constructor(dbManager, config) {
    this.dbManager = dbManager;
    this.config = config;
  }
  
  /**
   * Download game ZIP file with HTTP header capture
   * Returns: { zipPath, etag, lastModified, contentLength }
   */
  async downloadGame(queueItem, version = 1) {
    const { gameid, game_metadata } = queueItem;
    
    // Parse metadata if it's a string
    const metadata = typeof game_metadata === 'string' 
      ? JSON.parse(game_metadata) 
      : game_metadata;
    
    // Get download URL
    let downloadUrl = queueItem.download_url || metadata.download_url || metadata.name_href;
    
    if (!downloadUrl) {
      throw new Error(`No download URL found for game ${gameid}`);
    }
    
    // Normalize URL
    downloadUrl = this.normalizeUrl(downloadUrl);
    
    console.log(`  Downloading from: ${downloadUrl}`);
    
    // Attempt download with retry
    let attempt = 0;
    let lastError = null;
    
    while (attempt < this.config.DOWNLOAD_RETRY_MAX) {
      try {
        const zipPath = await this.attemptDownload(gameid, downloadUrl, version, attempt);
        return zipPath;
      } catch (error) {
        lastError = error;
        attempt++;
        
        if (attempt < this.config.DOWNLOAD_RETRY_MAX) {
          const backoffTime = Math.min(5000 * Math.pow(2, attempt - 1), 30000);
          console.log(`  ✗ Attempt ${attempt} failed: ${error.message}`);
          console.log(`  Retrying in ${backoffTime/1000} seconds...`);
          await this.sleep(backoffTime);
        }
      }
    }
    
    throw new Error(`Failed to download after ${this.config.DOWNLOAD_RETRY_MAX} attempts: ${lastError.message}`);
  }
  
  /**
   * Attempt single download
   */
  async attemptDownload(gameid, url, version, attemptNumber) {
    // Create AbortController for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.DOWNLOAD_TIMEOUT);
    
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': this.config.USER_AGENT
        },
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      // Get the response as a buffer
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      
      // Capture HTTP headers for resource tracking
      const etag = response.headers.get('ETag');
      const lastModified = response.headers.get('Last-Modified');
      const contentLength = parseInt(response.headers.get('Content-Length')) || buffer.length;
      
      // Validate it's actually a ZIP file
      if (!this.isValidZip(buffer)) {
        throw new Error('Downloaded file is not a valid ZIP archive');
      }
      
      // Determine versioned filename
      const zipFilename = version === 1 
        ? `${gameid}.zip` 
        : `${gameid}_${version}.zip`;
      const zipPath = path.join(this.config.ZIPS_DIR, zipFilename);
      const tempPath = `${zipPath}.new`;
      
      fs.writeFileSync(tempPath, buffer);
      
      // Atomic rename
      if (fs.existsSync(zipPath)) {
        fs.unlinkSync(zipPath);
      }
      fs.renameSync(tempPath, zipPath);
      
      console.log(`  ✓ Downloaded: ${zipFilename} (${buffer.length.toLocaleString()} bytes)`);
      
      // Return path and headers for resource tracking
      return {
        zipPath,
        etag,
        lastModified,
        contentLength,
        filename: zipFilename
      };
      
    } catch (error) {
      clearTimeout(timeoutId);
      
      // Handle abort/timeout
      if (error.name === 'AbortError') {
        throw new Error(`Download timeout after ${this.config.DOWNLOAD_TIMEOUT/1000} seconds`);
      }
      
      throw error;
    }
  }
  
  /**
   * Normalize download URL
   */
  normalizeUrl(url) {
    // Handle protocol-relative URLs
    if (url.startsWith('//')) {
      return 'https:' + url;
    }
    
    // Handle relative URLs
    if (url.startsWith('/')) {
      return this.config.SMWC_BASE_URL.replace(/\/$/, '') + url;
    }
    
    // Already absolute
    return url;
  }
  
  /**
   * Validate ZIP file signature
   */
  isValidZip(buffer) {
    // ZIP files start with PK\x03\x04 or PK\x05\x06 (empty archive) or PK\x07\x08 (spanned archive)
    if (buffer.length < 4) {
      return false;
    }
    
    const header = buffer.slice(0, 4);
    
    // Check for PK signature
    if (header[0] !== 0x50 || header[1] !== 0x4B) {
      return false;
    }
    
    // Check for valid ZIP header types
    const type = (header[2] << 8) | header[3];
    const validTypes = [0x0304, 0x0506, 0x0708];
    
    return validTypes.includes(type);
  }
  
  /**
   * Sleep utility
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = GameDownloader;

