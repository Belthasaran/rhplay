/**
 * SNES Contents Manager
 * 
 * Manages cache of files on SNES device in clientdata.db
 * Syncs after uploads and provides quick launch functionality
 */

class SnesContentsManager {
  constructor(db, snesWrapper) {
    this.db = db;
    this.snes = snesWrapper;
  }

  /**
   * Sync /work/ folder contents with cache
   * Called after uploading files
   * 
   * @param {Object} uploadedFile - Info about file just uploaded
   * @param {string} uploadedFile.fullpath - Full path on SNES (e.g. /work/smw12345_1.sfc)
   * @param {string} uploadedFile.filename - Filename
   * @param {string} uploadedFile.gameid - Game ID (if known)
   * @param {number} uploadedFile.version - Version (if known)
   * @param {Object} uploadedFile.metadata - Game metadata from database
   */
  async syncWorkFolder(uploadedFile = null) {
    console.log('[SnesContents] Syncing /work/ folder...');
    
    // Retry logic - device may be temporarily busy after large uploads
    const maxRetries = 3;
    let files = null;
    let lastError = null;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`[SnesContents] List attempt ${attempt}/${maxRetries}...`);
        
        // Small delay before first attempt to let device recover
        if (attempt === 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        files = await this.snes.List('/work');
        
        // Handle null response (connection issues)
        if (!files) {
          throw new Error('List returned null - device not responding');
        }
        
        // Success!
        break;
        
      } catch (error) {
        lastError = error;
        console.warn(`[SnesContents] List attempt ${attempt} failed:`, error.message);
        
        if (attempt < maxRetries) {
          const retryWait = 2000 * attempt; // 2s, 4s
          console.log(`[SnesContents] Waiting ${retryWait}ms before retry...`);
          await new Promise(resolve => setTimeout(resolve, retryWait));
        }
      }
    }
    
    if (!files) {
      console.error('[SnesContents] Failed to list /work/ folder after all retries');
      throw new Error(`Failed to list /work/ folder - ${lastError?.message || 'USB2SNES not responding'}`);
    }
    
    try {
      console.log('[SnesContents] Found', files.length, 'files in /work/');
      console.log('[SnesContents] Files:', files.map(f => f.filename).join(', '));
      
      // Filter to .sfc files only
      const sfcFiles = files.filter(f => f.filename.toLowerCase().endsWith('.sfc'));
      console.log('[SnesContents] Filtered to', sfcFiles.length, '.sfc files');
      
      const currentPaths = sfcFiles.map(f => `/work/${f.filename}`);
      console.log('[SnesContents] Current paths to sync:', currentPaths);
      
      // Get all entries currently in cache
      const cacheEntries = this.db.prepare(
        'SELECT fullpath FROM snes_contents'
      ).all();
      
      const cachedPaths = cacheEntries.map(e => e.fullpath);
      
      // Delete entries for files no longer on SNES
      const pathsToDelete = cachedPaths.filter(p => !currentPaths.includes(p));
      if (pathsToDelete.length > 0) {
        console.log('[SnesContents] Deleting', pathsToDelete.length, 'missing files from cache');
        const deleteStmt = this.db.prepare('DELETE FROM snes_contents WHERE fullpath = ?');
        for (const path of pathsToDelete) {
          deleteStmt.run(path);
        }
      }
      
      // Update last_seen_timestamp for all files still on device
      const updateSeenStmt = this.db.prepare(
        `UPDATE snes_contents 
         SET last_seen_timestamp = strftime('%s', 'now'),
             updated_at = strftime('%s', 'now')
         WHERE fullpath = ?`
      );
      
      for (const path of currentPaths) {
        updateSeenStmt.run(path);
      }
      
      // Add new files (ONLY from /work directory!)
      const newPaths = currentPaths.filter(p => !cachedPaths.includes(p) && p.startsWith('/work/'));
      if (newPaths.length > 0) {
        console.log('[SnesContents] Adding', newPaths.length, 'new files to cache');
        console.log('[SnesContents] New files:', newPaths);
        
        for (const fullpath of newPaths) {
          const filename = fullpath.substring(fullpath.lastIndexOf('/') + 1);
          
          // Check if this is the file we just uploaded
          const isUploadedFile = uploadedFile && uploadedFile.fullpath === fullpath;
          
          if (isUploadedFile) {
            // Insert with full metadata
            this.db.prepare(`
              INSERT INTO snes_contents (
                filename, fullpath, gameid, version, gamename, gametype, 
                difficulty, combinedtype, part_of_a_run, upload_timestamp
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%s', 'now'))
            `).run(
              filename,
              fullpath,
              uploadedFile.gameid || null,
              uploadedFile.version || null,
              uploadedFile.metadata?.gamename || null,
              uploadedFile.metadata?.gametype || null,
              uploadedFile.metadata?.difficulty || null,
              uploadedFile.metadata?.combinedtype || null,
              uploadedFile.part_of_a_run ? 1 : 0
            );
            console.log('[SnesContents] Added uploaded file:', filename);
          } else {
            // Insert as unknown file (detected on device)
            this.db.prepare(`
              INSERT INTO snes_contents (filename, fullpath)
              VALUES (?, ?)
            `).run(filename, fullpath);
            console.log('[SnesContents] Added detected file:', filename);
          }
        }
      }
      
      // If re-uploading existing file, reset dismissed and update metadata
      if (uploadedFile) {
        const existing = this.db.prepare(
          'SELECT id FROM snes_contents WHERE fullpath = ?'
        ).get(uploadedFile.fullpath);
        
        if (existing) {
          console.log('[SnesContents] Updating re-uploaded file:', uploadedFile.filename);
          this.db.prepare(`
            UPDATE snes_contents 
            SET dismissed = 0,
                upload_timestamp = strftime('%s', 'now'),
                updated_at = strftime('%s', 'now'),
                gameid = ?,
                version = ?,
                gamename = ?,
                gametype = ?,
                difficulty = ?,
                combinedtype = ?,
                part_of_a_run = ?
            WHERE fullpath = ?
          `).run(
            uploadedFile.gameid || null,
            uploadedFile.version || null,
            uploadedFile.metadata?.gamename || null,
            uploadedFile.metadata?.gametype || null,
            uploadedFile.metadata?.difficulty || null,
            uploadedFile.metadata?.combinedtype || null,
            uploadedFile.part_of_a_run ? 1 : 0,
            uploadedFile.fullpath
          );
        }
      }
      
      console.log('[SnesContents] Sync complete');
    } catch (error) {
      console.error('[SnesContents] Sync error:', error);
      throw error;
    }
  }

  /**
   * Get list of files for display
   * @param {boolean} showAll - Include dismissed files
   * @returns {Array} List of files sorted by pinned, then upload timestamp
   */
  getFileList(showAll = false) {
    let query = `
      SELECT * FROM snes_contents
      WHERE 1=1
    `;
    
    if (!showAll) {
      query += ' AND dismissed = 0';
    }
    
    query += ' ORDER BY pinned DESC, upload_timestamp DESC NULLS LAST, detected_timestamp DESC';
    
    return this.db.prepare(query).all();
  }

  /**
   * Update file status
   */
  updateStatus(fullpath, updates) {
    const fields = [];
    const values = [];
    
    if (updates.dismissed !== undefined) {
      fields.push('dismissed = ?');
      values.push(updates.dismissed ? 1 : 0);
    }
    
    if (updates.pinned !== undefined) {
      fields.push('pinned = ?');
      values.push(updates.pinned ? 1 : 0);
    }
    
    if (updates.launched_yet !== undefined) {
      fields.push('launched_yet = ?');
      values.push(updates.launched_yet ? 1 : 0);
    }
    
    if (updates.finished !== undefined) {
      fields.push('finished = ?');
      values.push(updates.finished ? 1 : 0);
    }
    
    fields.push('updated_at = strftime(\'%s\', \'now\')');
    values.push(fullpath);
    
    const query = `UPDATE snes_contents SET ${fields.join(', ')} WHERE fullpath = ?`;
    this.db.prepare(query).run(...values);
  }

  /**
   * Delete file from cache
   */
  deleteFile(fullpath) {
    this.db.prepare('DELETE FROM snes_contents WHERE fullpath = ?').run(fullpath);
  }
}

module.exports = { SnesContentsManager };

