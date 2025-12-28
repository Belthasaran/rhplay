#!/usr/bin/env node

/**
 * process_index7zs.js - Index BPS files from 7z archives and consolidate JSON metadata
 * 
 * Usage:
 *   enode.sh process_index7zs.js <JSON File Tree> <BPS Index Folder> <BPS Archives Folder> [options]
 *   enode.sh process_index7zs.js --help
 * 
 * This script scans 7z archives containing BPS patch files, finds corresponding JSON
 * metadata files in a directory tree, and creates/updates master JSON index files.
 */

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync, spawnSync } = require('child_process');
const { of: ipfsOnlyHash } = require('ipfs-only-hash');

// Constants
const SMW_BASE_ROM = process.env.PATH_BASE_ROM || '/home/me/smwdb/smw.sfc';

//const DEFAULT_ARDIVE_DRIVE_ID = '58677413-8a0c-4982-944d-4a1b40454039';
//const DEFAULT_ARDIVE_FOLDER_ID = '1e42b095-4fbf-4411-bcc9-688917d5a5af';
const DEFAULT_ARDRIVE_DRIVE_ID = 'd3338fab-d24c-4d75-9e78-d3024befc225';
const DEFAULT_ARDRIVE_FOLDER_ID = 'a6130936-d92e-45ac-a004-273d96e9ec9d';
//const DEFAULT_ARDRIVE_FOLDER_ID = 'ffdad5c7-5299-4b6a-b925-e0214356085f'

// Helper function to calculate SHA1 hash
async function calculateSHA1(filePath) {
  const buffer = await fs.readFile(filePath);
  return crypto.createHash('sha1').update(buffer).digest('hex');
}

// Helper function to calculate SHA256 hash
async function calculateSHA256(filePath) {
  const buffer = await fs.readFile(filePath);
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

// Helper function to ensure directory exists
async function ensureDir(dirPath) {
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch (error) {
    if (error.code !== 'EEXIST') {
      throw error;
    }
  }
}

// Helper function to list contents of 7z archive
async function list7zContents(archivePath) {
  try {
    const result = execSync(`7z l -slt "${archivePath}"`, { encoding: 'utf8' });
    const lines = result.split('\n');
    
    const files = [];
    let currentFile = null;
    let inFileBlock = false;
    let isArchiveEntry = false;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      
      if (trimmed.startsWith('Path = ')) {
        if (currentFile && currentFile.path && !isArchiveEntry) {
          files.push(currentFile);
        }
        const pathValue = trimmed.replace('Path = ', '').trim();
        currentFile = { path: pathValue };
        inFileBlock = true;
        isArchiveEntry = false;
        continue;
      }
      
      if (inFileBlock && currentFile) {
        if (trimmed.startsWith('Type = ')) {
          const typeValue = trimmed.replace('Type = ', '').trim();
          currentFile.type = typeValue;
          if (typeValue === '7z') {
            isArchiveEntry = true;
          }
        } else if (trimmed.startsWith('Size = ')) {
          currentFile.size = trimmed.replace('Size = ', '').trim();
        } else if (trimmed.startsWith('----------')) {
          if (currentFile && currentFile.path && !isArchiveEntry) {
            files.push(currentFile);
          }
          currentFile = null;
          inFileBlock = false;
          isArchiveEntry = false;
        }
      }
    }
    
    if (currentFile && currentFile.path && !isArchiveEntry) {
      files.push(currentFile);
    }
    
    // Filter out directories and archive entries
    return files.filter(f => {
      if (!f.path) return false;
      if (f.path.endsWith('/')) return false;
      if (f.type === '7z') return false;
      return true;
    });
  } catch (error) {
    throw new Error(`Failed to list 7z contents: ${error.message}`);
  }
}

// Helper function to extract file from 7z archive
async function extractFrom7z(archivePath, filePath, outputDir) {
  try {
    await ensureDir(outputDir);
    const fileName = path.basename(filePath);
    
    // Extract to a flat structure (just the filename)
    execSync(`7z x -y -o"${outputDir}" "${archivePath}" "${filePath}"`, { stdio: 'pipe' });
    
    // Try multiple possible paths
    const possiblePaths = [
      path.join(outputDir, filePath),  // Full path with subdirectories
      path.join(outputDir, fileName),  // Just filename
    ];
    
    // Also try with path components split
    const pathParts = filePath.split(/[/\\]/);
    if (pathParts.length > 1) {
      possiblePaths.push(path.join(outputDir, ...pathParts));
    }
    
    for (const possiblePath of possiblePaths) {
      if (fsSync.existsSync(possiblePath)) {
        return possiblePath;
      }
    }
    
    // If not found, recursively search for the file
    async function findFileRecursive(dir, targetName) {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            const found = await findFileRecursive(fullPath, targetName);
            if (found) return found;
          } else if (entry.name === targetName) {
            return fullPath;
          }
        }
      } catch (error) {
        // Skip directories we can't read
      }
      return null;
    }
    
    const foundFile = await findFileRecursive(outputDir, fileName);
    if (foundFile) {
      return foundFile;
    }
    
    throw new Error(`Extracted file not found: ${filePath}`);
  } catch (error) {
    throw new Error(`Failed to extract from 7z: ${error.message}`);
  }
}

// Helper function to recursively find files matching pattern
async function findFilesRecursive(dir, pattern) {
  const results = [];
  
  async function search(currentDir) {
    try {
      const entries = await fs.readdir(currentDir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        
        // Skip symbolic links
        if (entry.isSymbolicLink()) {
          continue;
        }
        
        if (entry.isDirectory()) {
          await search(fullPath);
        } else if (entry.isFile()) {
          if (pattern.test(entry.name)) {
            results.push(fullPath);
          }
        }
      }
    } catch (error) {
      // Skip directories we can't read
    }
  }
  
  await search(dir);
  return results;
}

// Helper function to load JSON file, handling malformed JSON
async function loadJSONFile(filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    if (!content.trim()) {
      return null;
    }
    
    // Try to parse as complete JSON
    try {
      return JSON.parse(content);
    } catch (e) {
      // If it's a single line with trailing comma (like _lmfilter.json), try to fix it
      const trimmed = content.trim();
      if (trimmed.endsWith(',')) {
        const fixed = trimmed.slice(0, -1);
        try {
          return JSON.parse(`{${fixed}}`);
        } catch (e2) {
          // If still fails, try to extract just the levels array
          const levelsMatch = trimmed.match(/"levels"\s*:\s*\[([^\]]+)\]/);
          if (levelsMatch) {
            const levelsStr = levelsMatch[1];
            const levels = levelsStr.split(',').map(s => s.trim().replace(/"/g, '')).filter(s => s);
            return { levels };
          }
        }
      }
      
      // If it starts with "levelnames" : {, try to extract it
      if (trimmed.startsWith('"levelnames"') || trimmed.startsWith('"levelnames"')) {
        try {
          return JSON.parse(`{${trimmed}}`);
        } catch (e3) {
          // Try to extract the levelnames object (may span multiple lines)
          // Match from "levelnames" : { to closing }
          let braceCount = 0;
          let startIdx = -1;
          let endIdx = -1;
          for (let i = 0; i < trimmed.length; i++) {
            if (trimmed[i] === '{') {
              if (startIdx === -1) startIdx = i;
              braceCount++;
            } else if (trimmed[i] === '}') {
              braceCount--;
              if (braceCount === 0 && startIdx !== -1) {
                endIdx = i;
                break;
              }
            }
          }
          if (startIdx !== -1 && endIdx !== -1) {
            const levelnamesStr = trimmed.substring(startIdx, endIdx + 1);
            try {
              return { levelnames: JSON.parse(levelnamesStr) };
            } catch (e4) {
              // Last resort: try to parse as partial JSON
            }
          }
        }
      }
      
      return null;
    }
  } catch (error) {
    return null;
  }
}

// Helper function to get category from parent folder name
function getCategoryFromFolder(folderPath) {
  const folderName = path.basename(folderPath);
  // Extract category from folder name like "[Super Mario World Hacks] SMW-Kaizo"
  // The category is typically after the bracket, like "SMW-Kaizo" or "SMW-Unknown"
  const bracketMatch = folderName.match(/\]\s*(.+)$/);
  if (bracketMatch) {
    const afterBracket = bracketMatch[1].trim();
    // Extract category from patterns like "SMW-Kaizo" or "SMW-Unknown"
    const parts = afterBracket.split(/[-_]/);
    if (parts.length > 1) {
      return parts.slice(1).join('-');
    }
    return afterBracket;
  }
  // If no bracket pattern, try to extract from patterns like "SMW-Kaizo"
  const parts = folderName.split(/[-_]/);
  if (parts.length > 1) {
    return parts.slice(1).join('-');
  }
  return folderName || 'Unknown';
}

// Helper function to merge JSON objects (deep merge, prefer existing values)
function mergeJSON(existing, newData) {
  const result = { ...existing };
  
  for (const [key, value] of Object.entries(newData)) {
    if (value === null || value === undefined) {
      continue;
    }
    
    if (key === 'sourcejson') {
      // Special handling for sourcejson array
      if (!result.sourcejson) {
        result.sourcejson = [];
      }
      // Add new entries if not already present (by json_file_sha256_hash)
      if (Array.isArray(value)) {
        for (const entry of value) {
          const existingIndex = result.sourcejson.findIndex(
            e => e.json_file_sha256_hash === entry.json_file_sha256_hash
          );
          if (existingIndex === -1) {
            result.sourcejson.push(entry);
          } else {
            // Update existing entry
            result.sourcejson[existingIndex] = { ...result.sourcejson[existingIndex], ...entry };
          }
        }
      }
    } else if (key === 'levelnames' && typeof value === 'object' && !Array.isArray(value)) {
      // Merge levelnames object
      if (!result.levelnames) {
        result.levelnames = {};
      }
      result.levelnames = { ...result.levelnames, ...value };
    } else if (key === 'translevel_data' && typeof value === 'object') {
      // Replace translevel_data (don't merge)
      result.translevel_data = value;
    } else if (key === 'lmfilter' && Array.isArray(value)) {
      // Normalize lmfilter to list of 3-character strings
      const normalized = value.map(v => String(v).padStart(3, '0').slice(0, 3));
      if (!result.lmfilter) {
        result.lmfilter = [];
      }
      // Merge arrays, removing duplicates
      const combined = [...new Set([...result.lmfilter, ...normalized])];
      result.lmfilter = combined.sort();
    } else if (typeof value === 'object' && !Array.isArray(value) && value !== null) {
      // Deep merge objects
      result[key] = mergeJSON(result[key] || {}, value);
    } else {
      // For other types, only update if existing value is missing
      if (result[key] === undefined || result[key] === null) {
        result[key] = value;
      }
    }
  }
  
  return result;
}

// Helper function to apply BPS patch using flips
async function applyBPSPatch(bpsPath, outputPath) {
  try {
    const result = spawnSync('flips', ['--apply', bpsPath, SMW_BASE_ROM, outputPath], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    if (result.status !== 0) {
      throw new Error(`flips failed: ${result.stderr || result.stdout || 'Unknown error'}`);
    }
    
    if (!fsSync.existsSync(outputPath)) {
      throw new Error('Output file was not created');
    }
    
    return true;
  } catch (error) {
    throw new Error(`Failed to apply BPS patch: ${error.message}`);
  }
}

// Helper function to calculate IPFS CID v1
async function calculateIPFSCIDv1(filePath) {
  try {
    const buffer = await fs.readFile(filePath);
    const cid = await ipfsOnlyHash(buffer, {
      cidVersion: 1,
      rawLeaves: true,
      hashAlg: 'sha2-256',
      wrapWithDirectory: false,
    });
    return cid;
  } catch (error) {
    throw new Error(`Failed to calculate IPFS CID: ${error.message}`);
  }
}

// Helper function to load ArDrive client
async function loadArdriveClient() {
  try {
    const arweave = require('arweave');
    const arDriveCore = require('ardrive-core-js');

    const arweaveUrl = new URL('https://arweave.net:443');
    const arweaveClient = arweave.init({
      host: arweaveUrl.hostname,
      protocol: arweaveUrl.protocol.replace(':', ''),
      port: arweaveUrl.port || 443,
      timeout: 600000,
    });

    return arDriveCore.arDriveAnonymousFactory({ arweave: arweaveClient });
  } catch (error) {
    throw new Error(`Failed to load ArDrive client: ${error.message}`);
  }
}

// Helper function to fetch ArDrive file index
async function fetchArdriveFileIndex(folderId) {
  try {
    const arDrive = await loadArdriveClient();
    const arDriveCore = require('ardrive-core-js');
    const folderEid = arDriveCore.EID(folderId);
    const items = await arDrive.listPublicFolder({ folderId: folderEid, maxDepth: 10 });
    const files = items.filter((item) => item.entityType === 'file');
    const index = new Map();
    for (const file of files) {
      index.set(file.name, file);
    }
    return index;
  } catch (error) {
    throw new Error(`Failed to fetch ArDrive file index: ${error.message}`);
  }
}

// Main processing function
async function processIndex7zs(jsonFileTree, bpsIndexFolder, bpsArchivesFolder, options) {
  const { checkrom, tryLmfilter, tryLevelread, tryTranslevels, updateArdrive } = options;
  
  // Load ArDrive index if needed
  let ardriveIndex = null;
  if (updateArdrive) {
    console.log('Loading ArDrive file index...');
    try {
      ardriveIndex = await fetchArdriveFileIndex(DEFAULT_ARDRIVE_FOLDER_ID);
      console.log(`  Loaded ${ardriveIndex.size} files from ArDrive`);
    } catch (error) {
      console.warn(`  ⚠ Failed to load ArDrive index: ${error.message}`);
      console.warn(`  Continuing without ArDrive metadata updates`);
    }
  }
  
  // Validate directories
  try {
    await fs.access(jsonFileTree);
    await fs.access(bpsArchivesFolder);
  } catch (error) {
    throw new Error(`Directory not accessible: ${error.message}`);
  }
  
  await ensureDir(bpsIndexFolder);
  
  // Scan BPS archives folder for 7z files
  console.log(`Scanning BPS archives folder: ${bpsArchivesFolder}`);
  const archiveFiles = await fs.readdir(bpsArchivesFolder);
  const sevenZFiles = archiveFiles.filter(f => f.toLowerCase().endsWith('.7z'));
  
  console.log(`Found ${sevenZFiles.length} 7z archive(s)`);
  
  // Process each 7z file
  const processedBPS = new Set();
  
  for (const archiveFile of sevenZFiles) {
    const archivePath = path.join(bpsArchivesFolder, archiveFile);
    console.log(`\nProcessing archive: ${archiveFile}`);
    
    try {
      // List contents of 7z file
      const contents = await list7zContents(archivePath);
      const bpsFiles = contents.filter(f => f.path.toLowerCase().endsWith('.bps'));
      
      console.log(`  Found ${bpsFiles.length} BPS file(s) in archive`);
      
      // Process each BPS file
      for (const bpsEntry of bpsFiles) {
        const bpsFileName = path.basename(bpsEntry.path);
        // Extract SHA1 hash from filename (assuming format: <sha1>.bps)
        const sha1Match = bpsFileName.match(/^([a-f0-9]{40})\.bps$/i);
        if (!sha1Match) {
          console.log(`  ⚠ Skipping BPS file with unexpected name: ${bpsFileName}`);
          continue;
        }
        
        const bpsSha1 = sha1Match[1].toLowerCase();
        
        if (processedBPS.has(bpsSha1)) {
          console.log(`  ⊙ Already processed: ${bpsSha1}`);
          continue;
        }
        
        processedBPS.add(bpsSha1);
        console.log(`  Processing BPS: ${bpsSha1}`);
        
        // Set index7z_name and indexbps_name attributes
        const index7zName = archiveFile;
        const indexBpsName = bpsEntry.path; // Full path within archive
        
        // Search for JSON files in the JSON file tree
        const jsonPattern = new RegExp(`^${bpsSha1}\\.json$`, 'i');
        const levelreadPattern = new RegExp(`^${bpsSha1}_levelread\\.json$`, 'i');
        const lmfilterPattern = new RegExp(`^${bpsSha1}_lmfilter\\.json$`, 'i');
        const translevelPattern = new RegExp(`^${bpsSha1}_translevel\\.json$`, 'i');
        
        const mainJsonFiles = await findFilesRecursive(jsonFileTree, jsonPattern);
        const levelreadFiles = await findFilesRecursive(jsonFileTree, levelreadPattern);
        const lmfilterFiles = await findFilesRecursive(jsonFileTree, lmfilterPattern);
        const translevelFiles = await findFilesRecursive(jsonFileTree, translevelPattern);
        
        // Load existing master JSON if it exists
        const masterJsonPath = path.join(bpsIndexFolder, `${bpsSha1}.json`);
        let masterJson = null;
        
        try {
          const existingContent = await fs.readFile(masterJsonPath, 'utf8');
          masterJson = JSON.parse(existingContent);
        } catch (error) {
          // File doesn't exist or is invalid, start fresh
          masterJson = {
            folder_categories: [],
            sourcejson: []
          };
        }
        
        // Process main JSON files
        const sourceJsonEntries = [];
        const folderCategories = new Set(masterJson.folder_categories || []);
        let firstMainJsonUsed = false;
        
        // Check if master JSON already has main fields (indicating it was initialized from a JSON file)
        const hasMainFields = masterJson.sfc_rom_sha1_hash || masterJson.bps_filename || 
                             masterJson.sfcsource_filename || masterJson.sfc_filename_title;
        
        for (const jsonFile of mainJsonFiles) {
          try {
            const jsonContent = await loadJSONFile(jsonFile);
            if (!jsonContent) continue;
            
            const jsonHash = await calculateSHA256(jsonFile);
            const parentFolder = path.basename(path.dirname(jsonFile));
            const category = getCategoryFromFolder(path.dirname(jsonFile));
            folderCategories.add(category);
            
            // Check if this source JSON is already in the list
            const existingIndex = masterJson.sourcejson.findIndex(
              e => e.json_file_sha256_hash === jsonHash
            );
            
            const sourceEntry = {
              parent_folder: parentFolder,
              json_file_sha256_hash: jsonHash,
              ...jsonContent
            };
            
            if (existingIndex === -1) {
              sourceJsonEntries.push(sourceEntry);
              
              // Use first main JSON as base if master JSON doesn't have main fields yet
              if (!firstMainJsonUsed && !hasMainFields) {
                // Copy all fields except parent_folder and json_file_sha256_hash to master
                for (const [key, value] of Object.entries(jsonContent)) {
                  if (masterJson[key] === undefined || masterJson[key] === null) {
                    masterJson[key] = value;
                  }
                }
                firstMainJsonUsed = true;
              }
            } else {
              // Update existing entry if needed
              masterJson.sourcejson[existingIndex] = { 
                ...masterJson.sourcejson[existingIndex], 
                ...sourceEntry 
              };
            }
          } catch (error) {
            console.log(`    ⚠ Error loading JSON file ${jsonFile}: ${error.message}`);
          }
        }
        
        // Merge all source JSON entries into sourcejson array
        masterJson.sourcejson = masterJson.sourcejson || [];
        for (const entry of sourceJsonEntries) {
          const existingIndex = masterJson.sourcejson.findIndex(
            e => e.json_file_sha256_hash === entry.json_file_sha256_hash
          );
          if (existingIndex === -1) {
            masterJson.sourcejson.push(entry);
          }
        }
        
        masterJson.folder_categories = Array.from(folderCategories).sort();
        
        // Set index7z_name and indexbps_name
        masterJson.index7z_name = index7zName;
        masterJson.indexbps_name = indexBpsName;
        
        // Calculate IPFS CID v1 for the 7z archive if not already set
        if (!masterJson.index7z_ipfs_cidv1) {
          try {
            console.log(`    Calculating IPFS CID v1 for ${index7zName}...`);
            const ipfsCid = await calculateIPFSCIDv1(archivePath);
            masterJson.index7z_ipfs_cidv1 = ipfsCid;
            console.log(`    ✓ IPFS CID v1: ${ipfsCid}`);
          } catch (error) {
            console.log(`    ⚠ Failed to calculate IPFS CID: ${error.message}`);
          }
        }
        
        // Update ArDrive metadata if requested
        if (updateArdrive && ardriveIndex) {
          const ardriveFile = ardriveIndex.get(index7zName);
          if (ardriveFile) {
            masterJson.index7z_ardrive_file_name = ardriveFile.name;
            masterJson.index7z_ardrive_file_path = ardriveFile.path || null;
            masterJson.index7z_ardrive_file_id = ardriveFile.entityId || ardriveFile.id || null;
            masterJson.index7z_ardrive_data_txid = ardriveFile.dataTxId || ardriveFile.dataTxID || null;
            masterJson.index7z_ardrive_metadata_txid = ardriveFile.manifestTxId || ardriveFile.metadataTxId || null;
            masterJson.index7z_ardrive_drive_id = DEFAULT_ARDRIVE_DRIVE_ID;
            masterJson.index7z_ardrive_folder_id = DEFAULT_ARDRIVE_FOLDER_ID;
            console.log(`    ✓ Updated ArDrive metadata for ${index7zName}`);
          } else {
            console.log(`    ⚠ ArDrive file not found for ${index7zName}`);
          }
        }
        
        // Process levelread JSON files - only one correct set per ROM
        if (levelreadFiles.length > 0) {
          // Sort by modification time (newest first)
          const levelreadFilesWithTime = await Promise.all(
            levelreadFiles.map(async (file) => {
              const stats = await fs.stat(file);
              return { file, mtime: stats.mtime };
            })
          );
          levelreadFilesWithTime.sort((a, b) => b.mtime - a.mtime);
          
          let latestLevelread = null;
          let latestLevelreadFile = null;
          const otherLevelreads = [];
          
          for (const { file, mtime } of levelreadFilesWithTime) {
            try {
              const levelreadContent = await loadJSONFile(file);
              if (levelreadContent && levelreadContent.levelnames && Object.keys(levelreadContent.levelnames).length > 0) {
                if (!latestLevelread) {
                  latestLevelread = levelreadContent.levelnames;
                  latestLevelreadFile = file;
                } else {
                  // Compare with latest - they should match
                  const latestKeys = Object.keys(latestLevelread).sort();
                  const currentKeys = Object.keys(levelreadContent.levelnames).sort();
                  const latestValues = latestKeys.map(k => latestLevelread[k]).sort();
                  const currentValues = currentKeys.map(k => levelreadContent.levelnames[k]).sort();
                  
                  if (latestKeys.length !== currentKeys.length || 
                      JSON.stringify(latestKeys) !== JSON.stringify(currentKeys) ||
                      JSON.stringify(latestValues) !== JSON.stringify(currentValues)) {
                    otherLevelreads.push({ file, content: levelreadContent.levelnames });
                  }
                }
              }
            } catch (error) {
              console.log(`    ⚠ Error loading levelread file ${file}: ${error.message}`);
            }
          }
          
          if (latestLevelread) {
            masterJson.levelnames = latestLevelread;
            console.log(`    ✓ Using levelread from: ${path.basename(latestLevelreadFile)}`);
            
            if (otherLevelreads.length > 0) {
              console.log(`    ⚠⚠⚠ WARNING: Found ${otherLevelreads.length} conflicting levelread file(s) that disagree with the latest:`);
              for (const { file } of otherLevelreads) {
                console.log(`       - ${file}`);
              }
              console.log(`    ⚠⚠⚠ Only one set of level names can be correct for ROM ${bpsSha1}`);
              console.log(`    ⚠⚠⚠ One or more of these files may contain incorrect or failed extraction data!`);
            }
          }
        }
        
        // Process lmfilter JSON files - only one correct set per ROM
        if (lmfilterFiles.length > 0) {
          // Sort by modification time (newest first)
          const lmfilterFilesWithTime = await Promise.all(
            lmfilterFiles.map(async (file) => {
              const stats = await fs.stat(file);
              return { file, mtime: stats.mtime };
            })
          );
          lmfilterFilesWithTime.sort((a, b) => b.mtime - a.mtime);
          
          let latestLmfilter = null;
          let latestLmfilterFile = null;
          const otherLmfilters = [];
          
          for (const { file, mtime } of lmfilterFilesWithTime) {
            try {
              const lmfilterContent = await loadJSONFile(file);
              if (lmfilterContent && lmfilterContent.levels && Array.isArray(lmfilterContent.levels) && lmfilterContent.levels.length > 0) {
                const normalized = lmfilterContent.levels.map(v => String(v).padStart(3, '0').slice(0, 3)).sort();
                
                if (!latestLmfilter) {
                  latestLmfilter = normalized;
                  latestLmfilterFile = file;
                } else {
                  // Compare with latest - they should match
                  if (JSON.stringify(latestLmfilter) !== JSON.stringify(normalized)) {
                    otherLmfilters.push({ file, content: normalized });
                  }
                }
              }
            } catch (error) {
              console.log(`    ⚠ Error loading lmfilter file ${file}: ${error.message}`);
            }
          }
          
          if (latestLmfilter) {
            masterJson.lmfilter = latestLmfilter;
            console.log(`    ✓ Using lmfilter from: ${path.basename(latestLmfilterFile)}`);
            
            if (otherLmfilters.length > 0) {
              console.log(`    ⚠⚠⚠ WARNING: Found ${otherLmfilters.length} conflicting lmfilter file(s) that disagree with the latest:`);
              for (const { file } of otherLmfilters) {
                console.log(`       - ${file}`);
              }
              console.log(`    ⚠⚠⚠ Only one set of levels can be correct for ROM ${bpsSha1}`);
              console.log(`    ⚠⚠⚠ One or more of these files may contain incorrect or failed extraction data!`);
            }
          }
        }
        
        // Process translevel JSON files - only one correct set per ROM
        if (translevelFiles.length > 0) {
          // Sort by modification time (newest first)
          const translevelFilesWithTime = await Promise.all(
            translevelFiles.map(async (file) => {
              const stats = await fs.stat(file);
              return { file, mtime: stats.mtime };
            })
          );
          translevelFilesWithTime.sort((a, b) => b.mtime - a.mtime);
          
          let latestTranslevel = null;
          let latestTranslevelFile = null;
          const otherTranslevels = [];
          
          for (const { file, mtime } of translevelFilesWithTime) {
            try {
              const translevelContent = await loadJSONFile(file);
              if (translevelContent && Object.keys(translevelContent).length > 0) {
                if (!latestTranslevel) {
                  latestTranslevel = translevelContent;
                  latestTranslevelFile = file;
                } else {
                  // Compare with latest - they should match
                  if (JSON.stringify(latestTranslevel) !== JSON.stringify(translevelContent)) {
                    otherTranslevels.push({ file, content: translevelContent });
                  }
                }
              }
            } catch (error) {
              console.log(`    ⚠ Error loading translevel file ${file}: ${error.message}`);
            }
          }
          
          if (latestTranslevel) {
            masterJson.translevel_data = latestTranslevel;
            console.log(`    ✓ Using translevel from: ${path.basename(latestTranslevelFile)}`);
            
            if (otherTranslevels.length > 0) {
              console.log(`    ⚠⚠⚠ WARNING: Found ${otherTranslevels.length} conflicting translevel file(s) that disagree with the latest:`);
              for (const { file } of otherTranslevels) {
                console.log(`       - ${file}`);
              }
              console.log(`    ⚠⚠⚠ Only one set of translevel data can be correct for ROM ${bpsSha1}`);
              console.log(`    ⚠⚠⚠ One or more of these files may contain incorrect or failed extraction data!`);
            }
          }
        }
        
        // Handle --checkrom option
        if (checkrom) {
          const tempDir = path.join(bpsIndexFolder, 'temp');
          await ensureDir(tempDir);
          
          try {
            // Extract BPS file from archive
            const extractedBPS = await extractFrom7z(archivePath, bpsEntry.path, tempDir);
            
            // Calculate BPS hashes if missing
            if (!masterJson.bps_sha1_hash || !masterJson.bps_sha256_hash) {
              masterJson.bps_sha1_hash = await calculateSHA1(extractedBPS);
              masterJson.bps_sha256_hash = await calculateSHA256(extractedBPS);
            }
            
            // Apply BPS patch to create ROM
            const outputROM = path.join(tempDir, 'source_unh.sfc');
            await applyBPSPatch(extractedBPS, outputROM);
            
            // Verify SHA1 hash matches
            const romSha1 = await calculateSHA1(outputROM);
            if (romSha1.toLowerCase() !== bpsSha1.toLowerCase()) {
              throw new Error(`ROM SHA1 mismatch: expected ${bpsSha1}, got ${romSha1}`);
            }
            
            // Get ROM size
            const stats = await fs.stat(outputROM);
            masterJson.sfc_rom_size = stats.size;
            
            // Handle --try-lmfilter, --try-levelread, --try-translevels
            const outputDir = path.join(tempDir, 'output');
            await ensureDir(outputDir);
            
            if (tryLmfilter && !masterJson.lmfilter) {
              console.log(`    Trying to generate lmfilter...`);
              try {
                const env = {
                  ...process.env,
                  GAMETAG: bpsSha1,
                  GAMEVER: '1',
                  ROMFILE: outputROM
                };
                const lmfilterResult = spawnSync('python3', ['try_lmfilter.py'], {
                  env: env,
                  cwd: process.cwd(),
                  encoding: 'utf8',
                  stdio: 'pipe',
                  timeout: 20000
                });
                
                if (lmfilterResult.status === 0) {
                  const tempJsonPath = path.join(process.cwd(), 'temp', 'temp.json');
                  if (fsSync.existsSync(tempJsonPath)) {
                    const outputPath = path.join(outputDir, `${bpsSha1}_lmfilter.json`);
                    await fs.copyFile(tempJsonPath, outputPath);
                    console.log(`    ✓ Generated lmfilter: ${outputPath}`);
                  }
                }
              } catch (error) {
                console.log(`    ⚠ Failed to generate lmfilter: ${error.message}`);
              }
            }
            
            if (tryLevelread && !masterJson.levelnames) {
              console.log(`    Trying to generate levelread...`);
              try {
                const levelReaderPath = process.env.LEVEL_READER || path.join(process.env.HOME || '/home/me', 'smwdb', 'level_reader');
                const levelreadResult = spawnSync(levelReaderPath, [outputROM], {
                  encoding: 'utf8',
                  stdio: 'pipe',
                  timeout: 20000
                });
                
                if (levelreadResult.status === 0) {
                  const outputPath = path.join(outputDir, `${bpsSha1}_levelread.json`);
                  await fs.writeFile(outputPath, levelreadResult.stdout);
                  console.log(`    ✓ Generated levelread: ${outputPath}`);
                }
              } catch (error) {
                console.log(`    ⚠ Failed to generate levelread: ${error.message}`);
              }
            }
            
            if (tryTranslevels && !masterJson.translevel_data) {
              console.log(`    Trying to generate translevels...`);
              try {
                const translevelsOutputPath = path.join(outputDir, `${bpsSha1}_translevel.json`);
                const translevelsResult = spawnSync('python3', [
                  'findtranslevels/find_translevels.py',
                  `--romfile=${outputROM}`,
                  `--output=${translevelsOutputPath}`
                ], {
                  encoding: 'utf8',
                  stdio: 'pipe',
                  cwd: process.cwd(),
                  timeout: 20000
                });
                
                if (translevelsResult.status === 0 && fsSync.existsSync(translevelsOutputPath)) {
                  console.log(`    ✓ Generated translevels: ${translevelsOutputPath}`);
                }
              } catch (error) {
                console.log(`    ⚠ Failed to generate translevels: ${error.message}`);
              }
            }
            
            // Cleanup extracted BPS and ROM
            try {
              await fs.unlink(extractedBPS);
              await fs.unlink(outputROM);
            } catch (e) {
              // Ignore cleanup errors
            }
          } catch (error) {
            console.log(`    ⚠ Error during --checkrom processing: ${error.message}`);
          }
        }
        
        // Write master JSON to temp file first
        const tempJsonPath = `${masterJsonPath}.temp`;
        await fs.writeFile(tempJsonPath, JSON.stringify(masterJson, null, 2));
        
        // Rename temp file to final file
        await fs.rename(tempJsonPath, masterJsonPath);
        console.log(`    ✓ Updated master JSON: ${path.basename(masterJsonPath)}`);
      }
    } catch (error) {
      console.log(`  ⚠ Error processing archive ${archiveFile}: ${error.message}`);
    }
  }
  
  console.log(`\n✓ Processing complete. Processed ${processedBPS.size} BPS file(s).`);
}

// Main entry point
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log(`
Usage: enode.sh process_index7zs.js <JSON File Tree> <BPS Index Folder> <BPS Archives Folder> [options]

Process 7z archives containing BPS patch files and consolidate JSON metadata.

Arguments:
  JSON File Tree        Directory tree containing JSON metadata files
  BPS Index Folder      Directory where master JSON index files will be created/updated
  BPS Archives Folder   Directory containing 7z archives with BPS files

Options:
  --checkrom            Extract BPS files, apply to smw.sfc, verify SHA1, and get ROM size
  --try-lmfilter        If lmfilter is missing, attempt to generate it (requires --checkrom)
  --try-levelread       If levelread is missing, attempt to generate it (requires --checkrom)
  --try-translevels     If translevels is missing, attempt to generate it (requires --checkrom)
  --update-ardrive      Scan ArDrive and update metadata for 7z archives
  --help, -h            Show this help message

Examples:
  enode.sh process_index7zs.js ~/rhplay/refmaterial/arcsfc1 ~/rhplay/refmaterial/index7z ~/rhplay/refmaterial/bps7z/
  enode.sh process_index7zs.js ~/rhplay/refmaterial/arcsfc1 ~/rhplay/refmaterial/index7z ~/rhplay/refmaterial/bps7z/ --checkrom
  enode.sh process_index7zs.js ~/rhplay/refmaterial/arcsfc1 ~/rhplay/refmaterial/index7z ~/rhplay/refmaterial/bps7z/ --checkrom --try-lmfilter --try-levelread
  enode.sh process_index7zs.js ~/rhplay/refmaterial/arcsfc1 ~/rhplay/refmaterial/index7z ~/rhplay/refmaterial/bps7z/ --update-ardrive

The script:
  - Scans 7z archives in the BPS Archives Folder
  - Lists contents of each archive to find BPS files (named by SHA1 hash)
  - Searches the JSON File Tree for matching JSON files:
    * <sha1>.json (main metadata)
    * <sha1>_levelread.json (level names)
    * <sha1>_lmfilter.json (level filter list)
    * <sha1>_translevel.json (translevel data)
  - Creates or updates master JSON files in BPS Index Folder
  - Merges data from multiple source JSON files
  - Handles duplicate JSON files by tracking SHA256 hashes
  - Normalizes lmfilter data to 3-character level codes
  - Records 7z archive name and BPS filename within archive
  - Calculates IPFS CID v1 for 7z archives
  - Optionally updates ArDrive metadata for 7z archives
`);
    process.exit(0);
  }
  
  if (args.length < 3) {
    console.error('Error: Missing required arguments');
    console.error('Usage: enode.sh process_index7zs.js <JSON File Tree> <BPS Index Folder> <BPS Archives Folder> [options]');
    console.error('Run with --help for more information');
    process.exit(1);
  }
  
  const jsonFileTree = args[0];
  const bpsIndexFolder = args[1];
  const bpsArchivesFolder = args[2];
  
  // Parse options
  const options = {
    checkrom: args.includes('--checkrom'),
    tryLmfilter: args.includes('--try-lmfilter'),
    tryLevelread: args.includes('--try-levelread'),
    tryTranslevels: args.includes('--try-translevels'),
    updateArdrive: args.includes('--update-ardrive')
  };
  
  // Validate option dependencies
  if ((options.tryLmfilter || options.tryLevelread || options.tryTranslevels) && !options.checkrom) {
    console.error('Error: --try-lmfilter, --try-levelread, and --try-translevels require --checkrom');
    process.exit(1);
  }
  
  // Run processing
  try {
    await processIndex7zs(jsonFileTree, bpsIndexFolder, bpsArchivesFolder, options);
  } catch (error) {
    console.error(`Fatal error: ${error.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(`Fatal error: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { processIndex7zs };
