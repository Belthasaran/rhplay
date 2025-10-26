/**
 * blob-creator.js - Encrypted Blob Creation
 * 
 * Creates encrypted and compressed patchblob files compatible with existing format
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const fernet = require('fernet');
const lzma = require('lzma-native');
const { execSync } = require('child_process');

class BlobCreator {
  constructor(dbManager, config) {
    this.dbManager = dbManager;
    this.config = config;
    // Use Python for blob creation by default (creates single-base64 format compatible with all decoders)
    this.usePythonCreator = config.USE_PYTHON_BLOB_CREATOR !== false;
  }
  
  /**
   * Create encrypted blob from patch file
   * Equivalent to mkblob.py functionality
   */
  async createPatchBlob(gameid, patchFileRecord) {
    // Use Python creator if enabled (default)
    if (this.usePythonCreator) {
      return await this.createPatchBlobPython(gameid, patchFileRecord);
    }
    
    // Otherwise use JavaScript creator (double base64 format)
    return await this.createPatchBlobJavaScript(gameid, patchFileRecord);
  }
  
  /**
   * Create blob using Python script (single base64 format - universally compatible)
   */
  async createPatchBlobPython(gameid, patchFileRecord) {
    const { 
      pat_sha224, 
      pat_sha1, 
      pat_shake_128,
      patch_file_path,
      result_sha224,
      result_sha1,
      result_shake1,
      result_file_path,
      patch_filename
    } = patchFileRecord;
    
    console.log(`    Creating encrypted blob (Python format)...`);
    
    // Call Python script to create blob
    const pythonScript = path.join(__dirname, '..', 'create_blob_python.py');
    
    try {
      const args = [
        patch_file_path,
        gameid,
        this.config.BLOBS_DIR,
        pat_sha224
      ];
      
      if (result_file_path && fs.existsSync(result_file_path)) {
        args.push(result_file_path);
      }
      
      const cmd = `python3 "${pythonScript}" ${args.map(a => `"${a}"`).join(' ')}`;
      const output = execSync(cmd, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
      
      const metadata = JSON.parse(output);
      
      if (!metadata.success) {
        throw new Error(metadata.error || 'Python blob creation failed');
      }
      
      console.log(`      ✓ Patchblob: ${metadata.patchblob1_name}`);
      
      if (metadata.romblob_name) {
        console.log(`      Creating ROM blob...`);
        console.log(`      ✓ ROM blob: ${metadata.romblob_name}`);
      }
      
      // Save metadata
      this.savePatchMetadata(pat_shake_128, {
        id: gameid,
        patch: patch_file_path,
        patch_filename: patch_filename,
        pat_sha1: pat_sha1,
        pat_sha224: pat_sha224,
        pat_shake_128: pat_shake_128,
        result_sha1: result_sha1 || metadata.result_sha1,
        result_sha224: result_sha224 || metadata.result_sha224,
        result_shake1: result_shake1,
        rom: result_file_path,
        patchblob1_name: metadata.patchblob1_name,
        patchblob1_key: metadata.patchblob1_key,
        patchblob1_sha224: metadata.patchblob1_sha224,
        romblob_name: metadata.romblob_name,
        romblob_salt: metadata.romblob_salt
      });
      
      if (result_shake1) {
        this.saveRomMetadata(result_shake1, {
          id: gameid,
          patch: patch_file_path,
          pat_sha224: pat_sha224,
          result_sha1: result_sha1 || metadata.result_sha1,
          result_sha224: result_sha224 || metadata.result_sha224,
          result_shake1: result_shake1,
          rom: result_file_path
        });
      }
      
      return metadata;
      
    } catch (error) {
      console.error(`      ✗ Python blob creation failed: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Create blob using JavaScript (double base64 format - works with loadsm.js)
   */
  async createPatchBlobJavaScript(gameid, patchFileRecord) {
    const { 
      pat_sha224, 
      pat_sha1, 
      pat_shake_128,
      patch_file_path,
      result_sha224,
      result_sha1,
      result_shake1,
      result_file_path,
      patch_filename
    } = patchFileRecord;
    
    console.log(`    Creating encrypted blob (JavaScript format)...`);
    
    // Read patch data
    const patchData = fs.readFileSync(patch_file_path);
    
    // Step 1: Compress patch with LZMA
    const compressedPatch = await this.compressLZMA(patchData);
    const compressedPatchSha224 = crypto.createHash('sha224')
      .update(compressedPatch)
      .digest('hex');
    
    // Step 2: Derive encryption key from patch hash
    const password = Buffer.from(pat_sha224, 'ascii');
    const salt = crypto.randomBytes(16);
    const key = this.deriveKey(password, salt);
    
    // Step 3: Encrypt with Fernet
    // Convert key to URL-safe base64 (compatible with Python's urlsafe_b64decode)
    const keyUrlSafeB64 = this.toUrlSafeBase64(key);
    const frn = new fernet.Secret(keyUrlSafeB64);
    const token = new fernet.Token({ secret: frn });
    // CRITICAL: Pass base64 string to match legacy format
    // JavaScript Fernet will base64-encode this string, creating double-base64
    // BUT: Python Fernet works differently - it encrypts raw bytes without extra base64
    // So we need to match what Python mkblob.py created
    const encryptedData = token.encode(compressedPatch.toString('base64'));
    
    // Step 4: Compress encrypted data
    const finalCompressed = await this.compressLZMA(Buffer.from(encryptedData));
    const finalSha224 = crypto.createHash('sha224')
      .update(finalCompressed)
      .digest('hex');
    
    // Generate blob name
    const blobName = `pblob_${gameid}_${finalSha224.substring(0, 10)}`;
    const blobPath = path.join(this.config.BLOBS_DIR, blobName);
    
    // Save blob
    const tempBlobPath = `${blobPath}.new`;
    fs.writeFileSync(tempBlobPath, finalCompressed);
    
    if (fs.existsSync(blobPath)) {
      fs.unlinkSync(blobPath);
    }
    fs.renameSync(tempBlobPath, blobPath);
    
    console.log(`      ✓ Patchblob: ${blobName}`);
    
    // Create ROM blob if result exists
    let romblobData = null;
    if (result_shake1 && result_file_path && fs.existsSync(result_file_path)) {
      romblobData = await this.createRomBlob(
        gameid, 
        result_file_path,
        pat_sha224, 
        salt
      );
    }
    
    // Save metadata to pat_meta and rom_meta directories
    this.savePatchMetadata(pat_shake_128, {
      id: gameid,
      patch: patch_file_path,
      patch_filename: patch_filename,
      pat_sha1: pat_sha1,
      pat_sha224: pat_sha224,
      pat_shake_128: pat_shake_128,
      result_sha1: result_sha1,
      result_sha224: result_sha224,
      result_shake1: result_shake1,
      rom: result_file_path,
      patchblob1_name: blobName,
      // Double-encode for Python compatibility
      patchblob1_key: Buffer.from(keyUrlSafeB64).toString('base64'),
      patchblob1_sha224: finalSha224,
      ...romblobData
    });
    
    if (result_shake1) {
      this.saveRomMetadata(result_shake1, {
        id: gameid,
        patch: patch_file_path,
        pat_sha224: pat_sha224,
        result_sha1: result_sha1,
        result_sha224: result_sha224,
        result_shake1: result_shake1,
        rom: result_file_path
      });
    }
    
    return {
      patchblob1_name: blobName,
      // Double-encode: base64(urlsafe_base64(key)) for Python compatibility
      patchblob1_key: Buffer.from(keyUrlSafeB64).toString('base64'),
      patchblob1_sha224: finalSha224,
      romblob_salt: salt.toString('base64'),
      ...romblobData
    };
  }
  
  /**
   * Create encrypted ROM blob
   */
  async createRomBlob(gameid, romPath, patSha224, salt) {
    console.log(`      Creating ROM blob...`);
    
    // Read ROM data
    const romData = fs.readFileSync(romPath);
    
    // Compress ROM
    const compressedRom = await this.compressLZMA(romData);
    
    // Derive key from base ROM + patch SHA
    const baseRomData = fs.readFileSync(this.config.BASE_ROM_PATH);
    const combinedHash = crypto.createHash('sha224')
      .update(Buffer.concat([baseRomData, Buffer.from(patSha224, 'ascii')]))
      .digest('hex');
    
    const password = Buffer.from(combinedHash, 'ascii');
    const key = this.deriveKey(password, salt);
    
    // Encrypt
    const frn = new fernet.Secret(key.toString('base64'));
    const token = new fernet.Token({ secret: frn });
    const encryptedData = token.encode(compressedRom.toString('base64'));
    
    // Compress encrypted data
    const finalCompressed = await this.compressLZMA(Buffer.from(encryptedData));
    const finalSha224 = crypto.createHash('sha224')
      .update(finalCompressed)
      .digest('hex');
    
    // Generate blob name
    const romblobName = `rblob_${gameid}_${finalSha224.substring(0, 10)}`;
    const romblobPath = path.join(this.config.BLOBS_DIR, romblobName);
    
    // Save blob
    const tempPath = `${romblobPath}.new`;
    fs.writeFileSync(tempPath, finalCompressed);
    
    if (fs.existsSync(romblobPath)) {
      fs.unlinkSync(romblobPath);
    }
    fs.renameSync(tempPath, romblobPath);
    
    console.log(`      ✓ ROM blob: ${romblobName}`);
    
    return {
      romblob_name: romblobName
    };
  }
  
  /**
   * Derive encryption key using PBKDF2
   */
  deriveKey(password, salt) {
    return crypto.pbkdf2Sync(
      password,
      salt,
      this.config.PBKDF2_ITERATIONS,
      32,
      'sha256'
    );
  }
  
  /**
   * Convert Buffer to URL-safe base64 string
   * Compatible with Python's base64.urlsafe_b64decode()
   */
  toUrlSafeBase64(buffer) {
    return buffer.toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
    // Keep padding (=) as Python's urlsafe_b64decode expects it
  }
  
  /**
   * Compress data using LZMA
   */
  async compressLZMA(data) {
    return new Promise((resolve, reject) => {
      lzma.compress(data, { preset: 6 }, (result, error) => {
        if (error) {
          reject(error);
        } else {
          resolve(Buffer.from(result));
        }
      });
    });
  }
  
  /**
   * Save patch metadata to pat_meta directory
   */
  savePatchMetadata(patShake128, metadata) {
    const metaPath = path.join(this.config.PAT_META_DIR, patShake128);
    const tempPath = `${metaPath}.new`;
    
    fs.writeFileSync(tempPath, JSON.stringify(metadata, null, 2) + '\n');
    
    if (fs.existsSync(metaPath)) {
      const backupPath = `${metaPath}.backup`;
      if (!fs.existsSync(backupPath)) {
        fs.copyFileSync(metaPath, backupPath);
      }
    }
    
    fs.renameSync(tempPath, metaPath);
  }
  
  /**
   * Save ROM metadata to rom_meta directory
   */
  saveRomMetadata(resultShake1, metadata) {
    const metaPath = path.join(this.config.ROM_META_DIR, resultShake1);
    const tempPath = `${metaPath}.new`;
    
    fs.writeFileSync(tempPath, JSON.stringify(metadata, null, 2) + '\n');
    
    if (fs.existsSync(metaPath)) {
      const backupPath = `${metaPath}.backup`;
      if (!fs.existsSync(backupPath)) {
        fs.copyFileSync(metaPath, backupPath);
      }
    }
    
    fs.renameSync(tempPath, metaPath);
  }
}

module.exports = BlobCreator;

