/**
 * patch-processor.js - Patch Extraction and Testing
 * 
 * Extracts patch files from ZIP archives, tests them with flips,
 * and calculates verification hashes
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');
const AdmZip = require('adm-zip');

class PatchProcessor {
  constructor(dbManager, config) {
    this.dbManager = dbManager;
    this.config = config;
  }
  
  /**
   * Process all patches in a ZIP file
   */
  async processZipPatches(queueuuid, gameid, zipPath) {
    console.log(`  Analyzing ZIP file...`);
    
    // Extract list of patch files
    const patches = await this.extractPatchList(zipPath);
    
    if (patches.length === 0) {
      console.log(`  ⚠ No patch files found in ZIP`);
      return [];
    }
    
    console.log(`  Found ${patches.length} patch file(s):`);
    
    // Score patches for primary selection
    const scoredPatches = this.scorePatchFiles(patches);
    
    // Display scores
    scoredPatches.forEach((p, idx) => {
      const marker = idx === 0 ? '★' : ' ';
      console.log(`    ${marker} ${p.filename} (${p.type.toUpperCase()}, ${p.size} bytes, score: ${p.score})`);
    });
    
    // Determine which patches to process
    let patchesToProcess = [];
    
    if (this.config.PROCESS_ALL_PATCHES) {
      patchesToProcess = scoredPatches;
      console.log(`  Processing all ${patchesToProcess.length} patches...`);
    } else {
      // Only process primary (highest score)
      patchesToProcess = [scoredPatches[0]];
      console.log(`  Processing primary patch only...`);
    }
    
    // Process each patch
    const results = [];
    for (let i = 0; i < patchesToProcess.length; i++) {
      const patchInfo = patchesToProcess[i];
      const isPrimary = (i === 0); // First in scored list is primary
      
      try {
        const result = await this.processSinglePatch(
          queueuuid, 
          gameid, 
          zipPath, 
          patchInfo,
          isPrimary
        );
        results.push(result);
      } catch (error) {
        console.error(`    ✗ Failed to process ${patchInfo.filename}: ${error.message}`);
        results.push({ 
          filename: patchInfo.filename, 
          type: patchInfo.type,
          error: error.message,
          success: false,
          isPrimary: isPrimary
        });
      }
    }
    
    const successCount = results.filter(r => r.success).length;
    console.log(`  Completed: ${successCount}/${results.length} patches processed successfully`);
    
    return results;
  }
  
  /**
   * Extract list of patch files from ZIP
   */
  async extractPatchList(zipPath) {
    const zip = new AdmZip(zipPath);
    const entries = zip.getEntries();
    
    const patches = [];
    
    for (const entry of entries) {
      // Skip directories
      if (entry.isDirectory) continue;
      
      const filename = entry.entryName;
      
      // Skip Spanish versions (as per original script)
      if (filename.match(/^Espa/i)) {
        continue;
      }
      
      // Check for .bps or .ips files
      const match = filename.match(/\.(bps|ips)$/i);
      if (match) {
        patches.push({
          filename: filename,
          type: match[1].toLowerCase(),
          size: entry.header.size || 0,
          entry: entry
        });
      }
    }
    
    return patches;
  }
  
  /**
   * Score patch files for primary selection
   * Uses heuristics similar to extractpatch_enhanced.py
   */
  scorePatchFiles(patches) {
    const scored = patches.map(patch => {
      let score = 0;
      const name = patch.filename.toLowerCase();
      const parts = name.split('/');
      const basename = parts[parts.length - 1];
      
      // Prefer files in root directory
      if (parts.length === 1) {
        score += 100;
      } else if (parts.length === 2) {
        score += 50;
      }
      
      // Prefer .bps over .ips
      if (patch.type === 'bps') {
        score += 50;
      } else if (patch.type === 'ips') {
        score += 20;
      }
      
      // Prefer larger files (main hack vs readme patches)
      // Cap at 50 points
      score += Math.min(patch.size / 1000, 50);
      
      // Penalize certain patterns
      if (name.includes('readme')) score -= 100;
      if (name.includes('read me')) score -= 100;
      if (name.includes('read_me')) score -= 100;
      if (name.includes('optional')) score -= 50;
      if (name.includes('alternate')) score -= 30;
      if (name.includes('alt')) score -= 20;
      if (name.includes('extra')) score -= 20;
      if (name.includes('bonus')) score -= 20;
      if (name.includes('music')) score -= 30;
      if (name.includes('sound')) score -= 30;
      if (name.includes('sample')) score -= 40;
      if (name.includes('test')) score -= 40;
      
      // Prefer files with hack-related names
      if (name.includes('hack')) score += 20;
      if (name.includes('patch')) score += 10;
      if (name.includes('main')) score += 30;
      if (basename.includes('smw')) score += 10;
      
      return { ...patch, score };
    });
    
    // Sort by score descending
    return scored.sort((a, b) => b.score - a.score);
  }
  
  /**
   * Process a single patch file
   */
  async processSinglePatch(queueuuid, gameid, zipPath, patchInfo, isPrimary) {
    console.log(`\n    Processing: ${patchInfo.filename} ${isPrimary ? '(PRIMARY)' : ''}`);
    
    // Create working record
    const pfuuid = this.dbManager.addPatchFile(
      queueuuid,
      gameid,
      zipPath,
      patchInfo.filename,
      patchInfo.type,
      patchInfo.score,
      isPrimary
    );
    
    // Extract patch from ZIP
    const zip = new AdmZip(zipPath);
    const patchData = zip.readFile(patchInfo.entry);
    
    if (!patchData) {
      throw new Error('Failed to extract patch data from ZIP');
    }
    
    // Calculate patch hashes
    const patSha1 = crypto.createHash('sha1').update(patchData).digest('hex');
    const patSha224 = crypto.createHash('sha224').update(patchData).digest('hex');
    const patShake128 = this.calculateShake128(patchData);
    
    console.log(`      Patch SHA-224: ${patSha224}`);
    
    // Save patch file
    const patchPath = path.join(this.config.PATCH_DIR, patShake128);
    const tempPatchPath = `${patchPath}.new`;
    fs.writeFileSync(tempPatchPath, patchData);
    
    if (fs.existsSync(patchPath)) {
      fs.unlinkSync(patchPath);
    }
    fs.renameSync(tempPatchPath, patchPath);
    
    // Apply patch using flips
    const resultPath = path.join(this.config.TEMP_DIR, `result_${pfuuid}.sfc`);
    const testResult = await this.applyPatch(patchPath, resultPath);
    
    let resultHashes = null;
    let romPath = null;
    
    if (testResult.success) {
      // Calculate result hashes
      const resultData = fs.readFileSync(resultPath);
      const resultSha1 = crypto.createHash('sha1').update(resultData).digest('hex');
      const resultSha224 = crypto.createHash('sha224').update(resultData).digest('hex');
      const resultShake1 = this.calculateShake128(resultData);
      
      resultHashes = {
        result_sha1: resultSha1,
        result_sha224: resultSha224,
        result_shake1: resultShake1
      };
      
      console.log(`      ✓ Patch applied successfully`);
      console.log(`      Result SHA-224: ${resultSha224}`);
      
      // Save result ROM
      const romFilename = `${gameid}_${resultShake1}.sfc`;
      romPath = path.join(this.config.ROM_DIR, romFilename);
      const tempRomPath = `${romPath}.new`;
      fs.writeFileSync(tempRomPath, resultData);
      
      if (fs.existsSync(romPath)) {
        fs.unlinkSync(romPath);
      }
      fs.renameSync(tempRomPath, romPath);
      
      // Clean up temp result
      fs.unlinkSync(resultPath);
      
      // Save metadata to hacks/ directory
      this.saveHackMetadata(gameid, {
        gameid: gameid,
        patch: patchPath,
        patch_filename: patchInfo.filename,
        pat_sha1: patSha1,
        pat_sha224: patSha224,
        pat_shake_128: patShake128,
        result_sha1: resultSha1,
        result_sha224: resultSha224,
        result_shake1: resultShake1,
        rom: romPath
      });
      
    } else {
      console.log(`      ✗ Patch application failed: ${testResult.error}`);
      
      // Clean up temp result if it exists
      if (fs.existsSync(resultPath)) {
        fs.unlinkSync(resultPath);
      }
    }
    
    // Update working record
    this.dbManager.updatePatchFileHashes(pfuuid, {
      pat_sha1: patSha1,
      pat_sha224: patSha224,
      pat_shake_128: patShake128,
      ...resultHashes,
      patch_file_path: patchPath,
      result_file_path: romPath,
      test_result: testResult.success ? 'success' : 'failed',
      error_message: testResult.error,
      status: testResult.success ? 'completed' : 'failed'
    });
    
    return {
      pfuuid,
      filename: patchInfo.filename,
      type: patchInfo.type,
      isPrimary,
      success: testResult.success,
      hashes: {
        pat_sha1: patSha1,
        pat_sha224: patSha224,
        pat_shake_128: patShake128,
        ...resultHashes
      },
      zipPath: zipPath
    };
  }
  
  /**
   * Apply patch using flips utility
   */
  async applyPatch(patchPath, resultPath) {
    try {
      // Verify base ROM exists
      if (!fs.existsSync(this.config.BASE_ROM_PATH)) {
        return { 
          success: false, 
          error: `Base ROM not found: ${this.config.BASE_ROM_PATH}` 
        };
      }
      
      // Verify patch file exists
      if (!fs.existsSync(patchPath)) {
        return { 
          success: false, 
          error: 'Patch file not found' 
        };
      }
      
      // Build flips command
      const command = `"${this.config.FLIPS_PATH}" --apply "${patchPath}" "${this.config.BASE_ROM_PATH}" "${resultPath}"`;
      
      // Execute with timeout
      execSync(command, { 
        stdio: 'pipe',
        timeout: 30000, // 30 second timeout
        windowsHide: true
      });
      
      // Verify result file exists
      if (!fs.existsSync(resultPath)) {
        return { success: false, error: 'Result file not created' };
      }
      
      // Verify result file size is reasonable (should be ~512KB for SMW ROM)
      const stats = fs.statSync(resultPath);
      if (stats.size < 100000 || stats.size > 10000000) {
        return { 
          success: false, 
          error: `Result file size unusual: ${stats.size} bytes` 
        };
      }
      
      return { success: true };
      
    } catch (error) {
      // Parse error message
      let errorMsg = error.message || 'Flips execution failed';
      
      if (error.stderr) {
        errorMsg = error.stderr.toString().trim() || errorMsg;
      }
      
      return { 
        success: false, 
        error: errorMsg
      };
    }
  }
  
  /**
   * Calculate SHAKE-128 hash (24 bytes, base64 URL-safe)
   */
  calculateShake128(data) {
    try {
      // Node.js 12+ has shake128 support
      const hash = crypto.createHash('shake128', { outputLength: 24 });
      hash.update(data);
      const digest = hash.digest();
      
      // Base64 URL-safe encoding
      return digest.toString('base64')
        .replace(/\+/g, '_')
        .replace(/\//g, '-')
        .replace(/=/g, '');
    } catch (error) {
      // Fallback: use sha256 and truncate
      console.warn('      ⚠ SHAKE-128 not available, using SHA-256 truncated');
      const hash = crypto.createHash('sha256');
      hash.update(data);
      const digest = hash.digest().slice(0, 24);
      
      return digest.toString('base64')
        .replace(/\+/g, '_')
        .replace(/\//g, '-')
        .replace(/=/g, '');
    }
  }
  
  /**
   * Save hack metadata to hacks/ directory
   */
  saveHackMetadata(gameid, metadata) {
    const hacksPath = path.join(this.config.HACKS_DIR, gameid);
    const tempPath = `${hacksPath}.new`;
    
    // Read existing if it exists
    let existing = {};
    if (fs.existsSync(hacksPath)) {
      try {
        existing = JSON.parse(fs.readFileSync(hacksPath, 'utf8'));
      } catch (error) {
        // Ignore parse errors
      }
    }
    
    // Merge with new data
    const merged = {
      ...existing,
      ...metadata,
      id: gameid
    };
    
    fs.writeFileSync(tempPath, JSON.stringify(merged, null, 2) + '\n');
    
    if (fs.existsSync(hacksPath)) {
      // Keep backup
      const backupPath = `${hacksPath}.original`;
      if (!fs.existsSync(backupPath)) {
        fs.copyFileSync(hacksPath, backupPath);
      }
    }
    
    fs.renameSync(tempPath, hacksPath);
  }
}

module.exports = PatchProcessor;

