/**
 * stats-manager.js - Game Version Statistics Manager
 * 
 * Manages the gameversion_stats table for tracking current game statistics
 */

const crypto = require('crypto');

class StatsManager {
  constructor(dbManager) {
    this.dbManager = dbManager;
  }
  
  /**
   * Extract statistics from JSON data
   */
  extractStats(jsonData) {
    const data = typeof jsonData === 'string' ? JSON.parse(jsonData) : jsonData;
    
    return {
      download_count: this.extractNumber(data, ['downloads', 'download_count']),
      view_count: this.extractNumber(data, ['views', 'view_count']),
      comment_count: this.extractNumber(data, ['comment_count', 'comments.count']),
      rating_value: this.extractNumber(data, ['rating', 'rating.value']),
      rating_count: this.extractNumber(data, ['rating_count', 'rating.count']),
      favorite_count: this.extractNumber(data, ['favorites', 'favorite_count']),
      hof_status: this.extractValue(data, ['hof', 'hall_of_fame']),
      featured_status: this.extractValue(data, ['featured'])
    };
  }
  
  /**
   * Extract numeric value from multiple possible paths
   */
  extractNumber(obj, paths) {
    for (const path of paths) {
      const val = this.getNestedValue(obj, path);
      if (val !== null && val !== undefined) {
        const num = Number(val);
        if (!isNaN(num)) {
          return num;
        }
      }
    }
    return null;
  }
  
  /**
   * Extract value from multiple possible paths
   */
  extractValue(obj, paths) {
    for (const path of paths) {
      const val = this.getNestedValue(obj, path);
      if (val !== null && val !== undefined) {
        return String(val);
      }
    }
    return null;
  }
  
  /**
   * Get nested value using dot notation
   */
  getNestedValue(obj, path) {
    const parts = path.split('.');
    let current = obj;
    
    for (const part of parts) {
      if (current && typeof current === 'object' && part in current) {
        current = current[part];
      } else {
        return null;
      }
    }
    
    return current;
  }
  
  /**
   * Update or create gameversion_stats record
   */
  updateGameStats(gameid, gvuuid, metadata, isMajorUpdate) {
    const stats = this.extractStats(metadata);
    const jsonData = JSON.stringify(metadata);
    
    // Check if stats record exists
    const existing = this.dbManager.db.prepare(`
      SELECT * FROM gameversion_stats WHERE gameid = ?
    `).get(gameid);
    
    if (existing) {
      // Update existing record
      const updateData = {
        gvuuid: gvuuid,
        download_count: stats.download_count,
        view_count: stats.view_count,
        comment_count: stats.comment_count,
        rating_value: stats.rating_value,
        rating_count: stats.rating_count,
        favorite_count: stats.favorite_count,
        hof_status: stats.hof_status,
        featured_status: stats.featured_status,
        previous_gvjsondata: existing.gvjsondata,
        gvjsondata: jsonData,
        last_updated: new Date().toISOString(),
        change_count: existing.change_count + 1,
        gameid: gameid
      };
      
      if (isMajorUpdate) {
        updateData.last_major_change = new Date().toISOString();
      } else {
        updateData.last_minor_change = new Date().toISOString();
      }
      
      const fields = Object.keys(updateData).filter(k => k !== 'gameid');
      const setClause = fields.map(f => `${f} = @${f}`).join(', ');
      
      this.dbManager.db.prepare(`
        UPDATE gameversion_stats 
        SET ${setClause}
        WHERE gameid = @gameid
      `).run(updateData);
      
    } else {
      // Create new record
      const insertData = {
        gvstatuuid: crypto.randomUUID(),
        gameid: gameid,
        gvuuid: gvuuid,
        download_count: stats.download_count,
        view_count: stats.view_count,
        comment_count: stats.comment_count,
        rating_value: stats.rating_value,
        rating_count: stats.rating_count,
        favorite_count: stats.favorite_count,
        hof_status: stats.hof_status,
        featured_status: stats.featured_status,
        gvjsondata: jsonData,
        previous_gvjsondata: null,
        last_major_change: isMajorUpdate ? new Date().toISOString() : null,
        last_minor_change: !isMajorUpdate ? new Date().toISOString() : null,
        change_count: 0
      };
      
      const fields = Object.keys(insertData);
      const placeholders = fields.map(f => `@${f}`).join(', ');
      
      this.dbManager.db.prepare(`
        INSERT INTO gameversion_stats (${fields.join(', ')})
        VALUES (${placeholders})
      `).run(insertData);
    }
  }
  
  /**
   * Get stats for a game
   */
  getGameStats(gameid) {
    return this.dbManager.db.prepare(`
      SELECT * FROM gameversion_stats WHERE gameid = ?
    `).get(gameid);
  }
  
  /**
   * Initialize stats table from existing gameversions
   */
  initializeStatsTable() {
    console.log('Initializing gameversion_stats table...');
    
    const games = this.dbManager.db.prepare(`
      SELECT gameid, gvuuid, gvjsondata, gvimport_time
      FROM gameversions gv
      WHERE version = (
        SELECT MAX(version) 
        FROM gameversions 
        WHERE gameid = gv.gameid
      )
    `).all();
    
    console.log(`  Processing ${games.length} games...`);
    
    let created = 0;
    
    for (const game of games) {
      const stats = this.extractStats(game.gvjsondata);
      
      try {
        this.dbManager.db.prepare(`
          INSERT OR REPLACE INTO gameversion_stats (
            gvstatuuid, gameid, gvuuid, 
            download_count, view_count, comment_count,
            rating_value, rating_count, favorite_count,
            hof_status, featured_status,
            gvjsondata, last_major_change, first_seen
          ) VALUES (
            @gvstatuuid, @gameid, @gvuuid,
            @download_count, @view_count, @comment_count,
            @rating_value, @rating_count, @favorite_count,
            @hof_status, @featured_status,
            @gvjsondata, @last_major_change, @first_seen
          )
        `).run({
          gvstatuuid: crypto.randomUUID(),
          gameid: game.gameid,
          gvuuid: game.gvuuid,
          download_count: stats.download_count,
          view_count: stats.view_count,
          comment_count: stats.comment_count,
          rating_value: stats.rating_value,
          rating_count: stats.rating_count,
          favorite_count: stats.favorite_count,
          hof_status: stats.hof_status,
          featured_status: stats.featured_status,
          gvjsondata: game.gvjsondata,
          last_major_change: game.gvimport_time,
          first_seen: game.gvimport_time
        });
        
        created++;
      } catch (error) {
        console.error(`  ✗ Error for game ${game.gameid}: ${error.message}`);
      }
    }
    
    console.log(`  ✓ Stats table initialized: ${created} records created`);
  }
}

module.exports = StatsManager;

