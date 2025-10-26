/**
 * update-processor.js - Process Updates to Existing Games
 * 
 * Orchestrates change detection, version creation, and statistics updates
 */

const crypto = require('crypto');
const ChangeDetector = require('./change-detector');
const StatsManager = require('./stats-manager');
const UrlComparator = require('./url-comparator');
const ResourceManager = require('./resource-manager');

class UpdateProcessor {
  constructor(dbManager, config) {
    this.dbManager = dbManager;
    this.config = config;
    this.changeDetector = new ChangeDetector(dbManager, config);
    this.statsManager = new StatsManager(dbManager);
    this.urlComparator = new UrlComparator(config);
    this.resourceManager = new ResourceManager(dbManager, config);
  }
  
  /**
   * Process updates for existing games
   */
  async processExistingGames(fetchedGames) {
    console.log('\n[Change Detection] Checking for updates to existing games...');
    
    const existingIds = new Set(this.dbManager.getExistingGameIds());
    const existingGames = fetchedGames.filter(game => 
      existingIds.has(String(game.id))
    );
    
    console.log(`  Found ${existingGames.length} existing games to check\n`);
    
    let majorUpdates = 0;
    let minorUpdates = 0;
    let noChange = 0;
    let errors = 0;
    let downloadNeeded = [];
    
    for (const game of existingGames) {
      const gameid = String(game.id);
      
      try {
        const result = await this.processGameUpdate(gameid, game);
        
        if (result.type === 'major') {
          majorUpdates++;
          if (result.needsDownload) {
            downloadNeeded.push({ gameid, metadata: game, result });
          }
        } else if (result.type === 'minor') {
          minorUpdates++;
        } else {
          noChange++;
        }
      } catch (error) {
        console.error(`  [${gameid}] ✗ Error: ${error.message}`);
        errors++;
      }
    }
    
    console.log('\n  Update Detection Summary:');
    console.log(`    Major updates:    ${majorUpdates}`);
    console.log(`    Minor updates:    ${minorUpdates}`);
    console.log(`    No changes:       ${noChange}`);
    console.log(`    Errors:           ${errors}`);
    console.log(`    Need download:    ${downloadNeeded.length}\n`);
    
    return {
      majorUpdates,
      minorUpdates,
      noChange,
      errors,
      downloadNeeded
    };
  }
  
  /**
   * Process update for a single game
   */
  async processGameUpdate(gameid, newMetadata) {
    // Get latest version
    const latestVersion = this.dbManager.getLatestVersionForGame(gameid);
    
    if (!latestVersion) {
      // Should not happen for existing game
      throw new Error(`No existing version found for game ${gameid}`);
    }
    
    // Detect changes
    const classification = this.changeDetector.detectChanges(
      latestVersion,
      newMetadata
    );
    
    if (classification.type === 'none') {
      return { type: 'none', gameid };
    }
    
    // Log changes
    const changeSummary = this.changeDetector.formatChangeSummary(classification);
    console.log(`  [${gameid}] ${newMetadata.name || latestVersion.name}`);
    console.log(changeSummary);
    
    // Log to database
    this.logChangeDetection(gameid, latestVersion.gvuuid, classification);
    
    // Handle based on type
    if (classification.type === 'major') {
      return await this.handleMajorUpdate(gameid, latestVersion, newMetadata, classification);
    } else {
      return await this.handleMinorUpdate(gameid, latestVersion, newMetadata, classification);
    }
  }
  
  /**
   * Handle major update - may need download and new version
   */
  async handleMajorUpdate(gameid, latestVersion, newMetadata, classification) {
    // Check if download URL changed
    const hasUrlChange = classification.majorChanges.some(c => 
      c.field === 'download_url' || c.field === 'name_href'
    );
    
    let needsDownload = false;
    let downloadDecision = null;
    
    if (hasUrlChange) {
      // Check if we actually need to download the file
      const downloadUrl = newMetadata.download_url || newMetadata.name_href;
      
      downloadDecision = await this.resourceManager.shouldDownloadFile(
        latestVersion,
        newMetadata,
        downloadUrl
      );
      
      needsDownload = downloadDecision.download;
      
      if (needsDownload) {
        console.log(`    → Download needed: ${downloadDecision.reason}`);
      } else {
        console.log(`    → Download skipped: ${downloadDecision.reason}`);
      }
    }
    
    // For now, we'll return the decision and let the main workflow handle downloads
    // In a full implementation, we might create the version here or queue it
    
    if (!needsDownload && !this.config.DRY_RUN) {
      // Update stats only (file unchanged despite metadata changes)
      this.statsManager.updateGameStats(gameid, latestVersion.gvuuid, newMetadata, false);
      this.updateChangeLog(gameid, 'updated_stats', null);
      
      return {
        type: 'minor', // Downgrade to minor since no actual file change
        gameid,
        gvuuid: latestVersion.gvuuid,
        needsDownload: false
      };
    }
    
    // Mark that this game needs a new version
    return {
      type: 'major',
      gameid,
      gvuuid: latestVersion.gvuuid,
      needsDownload: needsDownload,
      downloadDecision: downloadDecision,
      classification: classification
    };
  }
  
  /**
   * Handle minor update - update stats only
   */
  async handleMinorUpdate(gameid, latestVersion, newMetadata, classification) {
    console.log(`    → Updating statistics only`);
    
    if (!this.config.DRY_RUN) {
      // Update stats table
      this.statsManager.updateGameStats(gameid, latestVersion.gvuuid, newMetadata, false);
      
      // Update change log
      this.updateChangeLog(gameid, 'updated_stats', null);
    }
    
    return {
      type: 'minor',
      gameid,
      gvuuid: latestVersion.gvuuid
    };
  }
  
  /**
   * Log change detection to database
   */
  logChangeDetection(gameid, gvuuid, classification) {
    const data = {
      loguuid: crypto.randomUUID(),
      gameid: gameid,
      gvuuid: gvuuid,
      change_type: classification.type,
      changed_fields: JSON.stringify(
        [...classification.majorChanges, ...classification.minorChanges]
          .map(c => c.field)
      ),
      field_changes: JSON.stringify({
        major: classification.majorChanges,
        minor: classification.minorChanges,
        unknown: classification.unknownChanges
      }),
      action_taken: 'pending',
      metadata: JSON.stringify({
        score: classification.score,
        totalChanges: classification.totalChanges
      })
    };
    
    const fields = Object.keys(data);
    const placeholders = fields.map(f => `@${f}`).join(', ');
    
    this.dbManager.db.prepare(`
      INSERT INTO change_detection_log (${fields.join(', ')})
      VALUES (${placeholders})
    `).run(data);
  }
  
  /**
   * Update change log with action taken
   */
  updateChangeLog(gameid, actionTaken, newGvuuid) {
    this.dbManager.db.prepare(`
      UPDATE change_detection_log 
      SET action_taken = ?,
          new_gvuuid = ?
      WHERE loguuid = (
        SELECT loguuid FROM change_detection_log 
        WHERE gameid = ? 
        ORDER BY detection_time DESC 
        LIMIT 1
      )
    `).run(actionTaken, newGvuuid, gameid);
  }
}

module.exports = UpdateProcessor;

