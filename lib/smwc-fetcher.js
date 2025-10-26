/**
 * smwc-fetcher.js - SMWC Metadata Fetcher
 * 
 * Handles fetching game metadata from SMWC server with proper rate limiting
 */

const crypto = require('crypto');

class SMWCFetcher {
  constructor(dbManager, config) {
    this.dbManager = dbManager;
    this.config = config;
    this.lastRequestTime = 0;
  }
  
  /**
   * Fetch complete game list from SMWC with rate limiting
   * Returns array of game metadata objects
   */
  async fetchCompleteGameList() {
    console.log('Fetching game list from SMWC...');
    console.log(`  Base URL: ${this.config.SMWC_BASE_URL}`);
    console.log(`  Rate limit: ${this.config.SMWC_REQUEST_DELAY/1000}+ seconds between requests\n`);
    
    const games = [];
    let nextUrl = this.buildInitialUrl();
    let pageNumber = 0;
    
    await this.sleep(5000)
    while (nextUrl) {
      // Check cache first
      const cached = this.dbManager.getCachedMetadata(pageNumber);
      if (cached && cached.games && cached.games.length > 0) {
        console.log(`  Page ${pageNumber + 1}: Using cached data (${cached.games.length} games)`);
        games.push(...cached.games);
        nextUrl = cached.nextPageUrl;
        pageNumber++;
        continue;
      }
      
      // Rate limiting
      await this.waitForRateLimit();
      
      // Fetch page
      console.log(`  Page ${pageNumber + 1}: Fetching from server...`);
      
      try {
        const response = await this.fetchPage(nextUrl);
        
        if (!response || !response.data) {
          console.error('  ✗ Invalid response from server');
          break;
        }
        
        // Normalize entries
        const normalizedGames = response.data.map(entry => this.normalizeGameEntry(entry));
        
        // Cache response
        this.dbManager.cacheMetadataPage(
          pageNumber, 
          normalizedGames, 
          response.next_page_url || null
        );
        
        console.log(`  ✓ Fetched ${normalizedGames.length} games`);
        
        games.push(...normalizedGames);
        nextUrl = response.next_page_url;
        pageNumber++;
        
        // Safety check - don't loop forever
        if (pageNumber > 500) {
          console.warn('  ⚠ Reached maximum page limit (500), stopping');
          break;
        }
        
      } catch (error) {
        console.error(`  ✗ Error fetching page ${pageNumber + 1}: ${error.message}`);
        
        // If we have some games, continue with what we have
        if (games.length > 0) {
          console.log(`  Continuing with ${games.length} games fetched so far`);
          break;
        }
        
        throw error;
      }
    }
    
    console.log(`\n  Total games fetched: ${games.length}`);
    
    return games;
  }
  
  /**
   * Build initial URL for first page
   */
  buildInitialUrl() {
    // Decode the base64 URL from the original script
    const baseUrl = Buffer.from(  process.env.SMWC_QUERY_B_GAMEFETCHER, 
      'base64'
    ).toString('utf8');
    
    return baseUrl;
  }
  
  /**
   * Wait for rate limit (60+ seconds between requests)
   */
  async waitForRateLimit() {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    const requiredDelay = this.config.SMWC_REQUEST_DELAY + this.config.SMWC_EXTRA_DELAY;
    const waitTime = requiredDelay - elapsed;
    
    if (waitTime > 0) {
      console.log(`  Rate limiting: waiting ${Math.ceil(waitTime/1000)} seconds...`);
      await this.sleep(waitTime);
    }
    
    this.lastRequestTime = Date.now();
  }
  
  /**
   * Fetch single page from SMWC
   */
  async fetchPage(url) {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': this.config.USER_AGENT
        }
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      
      return data;
      
    } catch (error) {
      // Check if it's a network error
      if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
        throw new Error(`Network error: Cannot connect to SMWC server (${error.code})`);
      }
      
      throw error;
    }
  }
  
  /**
   * Process raw game data (equivalent to loadsmwrh.fix_hentry)
   */
  normalizeGameEntry(rawEntry) {
    const normalized = { ...rawEntry };
    
    // Ensure id is string
    if (normalized.id !== undefined) {
      normalized.id = String(normalized.id);
    }
    
    // Convert time to added date if needed
    if (!normalized.added && normalized.time) {
      try {
        const timestamp = parseInt(normalized.time);
        if (!isNaN(timestamp)) {
          const date = new Date(timestamp * 1000);
          normalized.added = date.toISOString().replace('T', ' ').substring(0, 19);
        }
      } catch (error) {
        // Keep original time value
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
          if (typeof a === 'object' && a.name) {
            return a.name;
          }
          return String(a);
        }).join(', ');
        normalized.authors = normalized.author;
      }
    }
    
    // Handle fields object
    if (normalized.fields && typeof normalized.fields === 'object') {
      const fieldsToPromote = ['demo', 'featured', 'length', 'difficulty', 'description'];
      fieldsToPromote.forEach(field => {
        if (normalized.fields[field] !== undefined) {
          normalized[field] = normalized.fields[field];
        }
      });
      
      // Remove fields if empty
      const remainingFields = { ...normalized.fields };
      fieldsToPromote.forEach(field => delete remainingFields[field]);
      
      if (Object.keys(remainingFields).length === 0) {
        delete normalized.fields;
      } else {
        normalized.fields = remainingFields;
      }
    }
    
    // Normalize tags
    if (Array.isArray(normalized.tags)) {
      // Keep as array, will be stringified when stored
    }
    
    return normalized;
  }
  
  /**
   * Sleep utility
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = SMWCFetcher;

