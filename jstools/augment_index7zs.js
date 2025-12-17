#!/usr/bin/env node

/**
 * augment_index7zs.js - Augment master JSON files with database information
 *  Ultimately this data collection is to help out searching for game info based on metadata.
 *  And automation (Such as one-click Patch and start of games through the USB2SNES connection
 *  of the sd2snes or FXPAK).
 *
 *  Example of finished Master JSON file for the SMW romhack named Invictus, 1.0 after
 *  data harvesting has completed:
 *
 *  https://gist.github.com/Belthasaran/3e3a28d22e8c9e9afad338c0c7d9208a
 *
 *
 *  This essentially harvests all the information we have collected about each
 *  of our found ~29,000 SMW Romhack files so far, into a single master JSON data file
 *  for each hack (our index7z folder contains 29,000 JSON files; each JSON file represents
 *  one of the BPS files stored in the 256 .7z files in the bps7z folder).
 *
 *  (Although this only takes care of hacks that already had a master JSON file generated.
 *  and patches saved in the bps_**.7z files
 *   And not necessarily all hacks in our database have these yet.)
 *
 *  This attempts to add the following metadata:
 *  Such as name, author, but also our parsed data, such as:
 *    - Overworld level names for each romhack (Where we were successful)
 *    - Level numbers that contain modified level data or pointers for each hack (Where we were succesful)
 *
 *    The level numbers "detected" are then to be used to help compile gamestages data.
 *
 *- For now: gamestages records still have to be created manually by a human.
 *
 * The problem is "detected levels" in a ROMhack includes non-playable levels left behind by
 * the authors.  We want to create a randomizer that plucks legitimate stages for the player
 * to play, and drops the player in, and has the stage work correctly no matter what the hack
 * is, and even if there is custom ASM.
 * But we need a way to automatically detect that the stage chosen will be good and proper,
 * and that the stage can actually be won.
 *
 *
 * 
 * Usage:
 *   enode.sh augment_index7zs.js <BPS Index Folder> <BPS Archives Folder> [options]
 *   enode.sh augment_index7zs.js --help
 * 
 * This script scans 7z archives containing SMW Romhacks (BPS patch files) and
 * augments the existing master JSON index files with data aggregated from our
 * databases (patchblobs, gameversions, attachments, screenshots, res_attachments).
 */

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const Database = require('better-sqlite3');

// Database paths
const RHDATA_DB_PATH = process.env.RHDATA_DB_PATH || path.join(__dirname, '..', 'electron', 'rhdata.db');
const PATCHBIN_DB_PATH = process.env.PATCHBIN_DB_PATH || path.join(__dirname, '..', 'electron', 'patchbin.db');
const SCREENSHOT_DB_PATH = process.env.SCREENSHOT_DB_PATH || path.join(__dirname, '..', 'electron', 'screenshot.db');
const RESOURCE_DB_PATH = process.env.RESOURCE_DB_PATH || path.join(__dirname, '..', 'electron', 'resource.db');

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

// Helper function to load JSON file
async function loadJSONFile(filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    if (!content.trim()) {
      return null;
    }
    return JSON.parse(content);
  } catch (error) {
    return null;
  }
}

// Helper function to convert database row to object, excluding blob columns
function rowToObject(row, excludeColumns = []) {
  const obj = {};
  for (const key in row) {
    if (!excludeColumns.includes(key)) {
      obj[key] = row[key];
    }
  }
  return obj;
}

// Helper function to check if hex string is in range
function isHexInRange(hexStr, startHex, endHex) {
  // Normalize hex strings to same length for comparison
  const maxLen = Math.max(startHex.length, endHex.length, hexStr.length);
  const normalizedStart = startHex.padStart(maxLen, '0');
  const normalizedEnd = endHex.padStart(maxLen, '0');
  const normalizedValue = hexStr.substring(0, maxLen).padStart(maxLen, '0');
  
  const start = parseInt(normalizedStart, 16);
  const end = parseInt(normalizedEnd, 16);
  const value = parseInt(normalizedValue, 16);
  
  return value >= start && value <= end;
}

// Main processing function
async function augmentIndex7zs(bpsIndexFolder, bpsArchivesFolder, options) {
  const { bpsRange, sevenZRange, sevenZFile, bpsFile } = options;
  // Validate directories
  try {
    await fs.access(bpsArchivesFolder);
  } catch (error) {
    throw new Error(`BPS Archives Folder not accessible: ${error.message}`);
  }
  
  await ensureDir(bpsIndexFolder);
  
  // Open database connections
  console.log('Opening database connections...');
  const rhdataDb = new Database(RHDATA_DB_PATH, { readonly: true });
  const patchbinDb = new Database(PATCHBIN_DB_PATH, { readonly: true });
  const screenshotDb = fsSync.existsSync(SCREENSHOT_DB_PATH) 
    ? new Database(SCREENSHOT_DB_PATH, { readonly: true })
    : null;
  const resourceDb = fsSync.existsSync(RESOURCE_DB_PATH)
    ? new Database(RESOURCE_DB_PATH, { readonly: true })
    : null;
  
  console.log(`  rhdata.db: ${RHDATA_DB_PATH}`);
  console.log(`  patchbin.db: ${PATCHBIN_DB_PATH}`);
  if (screenshotDb) console.log(`  screenshot.db: ${SCREENSHOT_DB_PATH}`);
  if (resourceDb) console.log(`  resource.db: ${RESOURCE_DB_PATH}`);
  
  // Prepare database queries
  const getPatchblobByResultSha1 = rhdataDb.prepare(`
    SELECT * FROM patchblobs WHERE result_sha1 = ?
  `);
  
  const getGameversionByPatchblobName = rhdataDb.prepare(`
    SELECT * FROM gameversions 
    WHERE patchblob1_name = ? 
    ORDER BY version DESC 
    LIMIT 1
  `);
  
  const getAttachmentByFileName = patchbinDb.prepare(`
    SELECT * FROM attachments WHERE file_name = ?
  `);
  
  const getScreenshotsByGameid = screenshotDb ? screenshotDb.prepare(`
    SELECT * FROM res_screenshots 
    WHERE gameid = ? OR gvuuid = ?
  `) : null;
  
  const getGameversionScreenshots = screenshotDb ? screenshotDb.prepare(`
    SELECT * FROM gameversion_screenshots WHERE gameid = ?
  `) : null;
  
  const getResAttachmentsByGameid = resourceDb ? resourceDb.prepare(`
    SELECT * FROM res_attachments 
    WHERE gameid = ? OR gvuuid = ?
  `) : null;
  
  // Scan BPS archives folder for 7z files
  console.log(`\nScanning BPS archives folder: ${bpsArchivesFolder}`);
  const archiveFiles = await fs.readdir(bpsArchivesFolder);
  let sevenZFiles = archiveFiles.filter(f => f.toLowerCase().endsWith('.7z'));
  
  // Filter 7z files based on options
  if (sevenZFile) {
    // Only process specific 7z file
    const targetFile = sevenZFile.toLowerCase();
    sevenZFiles = sevenZFiles.filter(f => f.toLowerCase() === targetFile);
    if (sevenZFiles.length === 0) {
      console.log(`⚠ Specified 7z file not found: ${sevenZFile}`);
      return;
    }
    console.log(`Filtering to specific 7z file: ${sevenZFile}`);
  } else if (sevenZRange) {
    // Filter by hex range (e.g., bps_09.7z through bps_0b.7z)
    const [startHex, endHex] = sevenZRange.split(':');
    if (!startHex || !endHex) {
      throw new Error(`Invalid --7zrange format: ${sevenZRange}. Expected format: START:END (hex)`);
    }
    sevenZFiles = sevenZFiles.filter(f => {
      // Extract hex prefix from filename like "bps_09.7z"
      const match = f.match(/^bps_([0-9a-f]+)\.7z$/i);
      if (!match) return false;
      const fileHex = match[1];
      return isHexInRange(fileHex, startHex, endHex);
    });
    console.log(`Filtering 7z files by range: ${sevenZRange} (${sevenZFiles.length} file(s))`);
  }
  
  console.log(`Found ${sevenZFiles.length} 7z archive(s) to process`);
  
  // Process each 7z file
  const processedBPS = new Set();
  let augmented = 0;
  let notFound = 0;
  
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
        
        // Filter by BPS file option
        if (bpsFile) {
          const targetBps = bpsFile.toLowerCase().replace(/\.bps$/i, '');
          if (bpsSha1 !== targetBps) {
            continue;
          }
          console.log(`Filtering to specific BPS file: ${bpsFile}`);
        }
        
        // Filter by BPS range option
        if (bpsRange && !bpsFile) {
          const [startHex, endHex] = bpsRange.split(':');
          if (!startHex || !endHex) {
            throw new Error(`Invalid --bpsrange format: ${bpsRange}. Expected format: START:END (hex)`);
          }
          // Extract prefix from BPS SHA1 matching the length of the range specifiers
          const prefixLen = Math.max(startHex.length, endHex.length);
          const bpsPrefix = bpsSha1.substring(0, prefixLen);
          if (!isHexInRange(bpsPrefix, startHex, endHex)) {
            continue;
          }
        }
        
        if (processedBPS.has(bpsSha1)) {
          console.log(`  ⊙ Already processed: ${bpsSha1}`);
          continue;
        }
        
        processedBPS.add(bpsSha1);
        console.log(`  Processing BPS: ${bpsSha1}`);
        
        // Load existing master JSON if it exists
        const masterJsonPath = path.join(bpsIndexFolder, `${bpsSha1}.json`);
        let masterJson = null;
        let jsonExists = false;
        
        try {
          const existingContent = await fs.readFile(masterJsonPath, 'utf8');
          masterJson = JSON.parse(existingContent);
          jsonExists = true;
        } catch (error) {
          // File doesn't exist or is invalid, create new
          masterJson = {};
          console.log(`    ⚠ Master JSON not found, creating new entry`);
        }
        
        let updated = false;
        
        // Step 1: Query patchblobs table
        const patchblob = getPatchblobByResultSha1.get(bpsSha1);
        if (patchblob) {
          console.log(`    ✓ Found patchblob: ${patchblob.patchblob1_name}`);
          masterJson.patchblob = rowToObject(patchblob);
          updated = true;
          
          // Step 2: Query gameversions table for highest version
          const gameversion = getGameversionByPatchblobName.get(patchblob.patchblob1_name);
          if (gameversion) {
            console.log(`    ✓ Found gameversion: ${gameversion.gameid} v${gameversion.version}`);
            masterJson.gameversion = rowToObject(gameversion);
            updated = true;
            
            // Step 3: Query attachments table
            const attachment = getAttachmentByFileName.get(patchblob.patchblob1_name);
            if (attachment) {
              console.log(`    ✓ Found attachment: ${attachment.file_name}`);
              if (!masterJson.attachments) {
                masterJson.attachments = [];
              }
              // Check if this attachment is already in the array
              const existingIndex = masterJson.attachments.findIndex(
                a => a.auuid === attachment.auuid
              );
              const attachmentObj = rowToObject(attachment, ['file_data']);
              if (existingIndex === -1) {
                masterJson.attachments.push(attachmentObj);
              } else {
                masterJson.attachments[existingIndex] = attachmentObj;
              }
              updated = true;
            }
            
            // Step 4: Query screenshots
            if (screenshotDb) {
              // First, get linked screenshots from gameversion_screenshots
              const gameversionScreenshots = getGameversionScreenshots.all(gameversion.gameid);
              const linkedRsuuids = new Set(gameversionScreenshots.map(gvs => gvs.rsuuid));
              
              // Get screenshots by gameid or gvuuid
              const screenshotsByGameid = getScreenshotsByGameid.all(gameversion.gameid, gameversion.gvuuid);
              
              // Also get screenshots by linked rsuuids
              const allRsuuids = Array.from(linkedRsuuids);
              let screenshotsByRsuuid = [];
              if (allRsuuids.length > 0) {
                const placeholders = allRsuuids.map(() => '?').join(',');
                const getScreenshotsByRsuuids = screenshotDb.prepare(`
                  SELECT * FROM res_screenshots WHERE rsuuid IN (${placeholders})
                `);
                screenshotsByRsuuid = getScreenshotsByRsuuids.all(...allRsuuids);
              }
              
              // Combine and deduplicate screenshots
              const screenshotMap = new Map();
              
              for (const screenshot of screenshotsByGameid) {
                screenshotMap.set(screenshot.rsuuid, screenshot);
              }
              
              for (const screenshot of screenshotsByRsuuid) {
                screenshotMap.set(screenshot.rsuuid, screenshot);
              }
              
              const allScreenshots = Array.from(screenshotMap.values());
              
              if (allScreenshots.length > 0) {
                console.log(`    ✓ Found ${allScreenshots.length} screenshot(s)`);
                if (!masterJson.screenshots) {
                  masterJson.screenshots = [];
                }
                
                // Update or add screenshots
                for (const screenshot of allScreenshots) {
                  const screenshotObj = rowToObject(screenshot, ['encrypted_data']);
                  const existingIndex = masterJson.screenshots.findIndex(
                    s => s.rsuuid === screenshotObj.rsuuid
                  );
                  if (existingIndex === -1) {
                    masterJson.screenshots.push(screenshotObj);
                  } else {
                    masterJson.screenshots[existingIndex] = screenshotObj;
                  }
                }
                updated = true;
              }
            }
            
            // Step 5: Query res_attachments
            if (resourceDb) {
              const resAttachments = getResAttachmentsByGameid.all(gameversion.gameid, gameversion.gvuuid);
              
              if (resAttachments.length > 0) {
                console.log(`    ✓ Found ${resAttachments.length} resource attachment(s)`);
                if (!masterJson.res_attachments) {
                  masterJson.res_attachments = [];
                }
                
                // Update or add res_attachments
                for (const resAttachment of resAttachments) {
                  const resAttachmentObj = rowToObject(resAttachment, ['encrypted_data']);
                  const existingIndex = masterJson.res_attachments.findIndex(
                    r => r.rauuid === resAttachmentObj.rauuid
                  );
                  if (existingIndex === -1) {
                    masterJson.res_attachments.push(resAttachmentObj);
                  } else {
                    masterJson.res_attachments[existingIndex] = resAttachmentObj;
                  }
                }
                updated = true;
              }
            }
          } else {
            console.log(`    ⚠ No gameversion found for patchblob: ${patchblob.patchblob1_name}`);
          }
        } else {
          console.log(`    ⊙ No patchblob found for BPS SHA1: ${bpsSha1}`);
          notFound++;
        }
        
        // Save master JSON if it was updated or if it exists
        if (updated || jsonExists) {
          // Write master JSON to temp file first
          const tempJsonPath = `${masterJsonPath}.temp`;
          await fs.writeFile(tempJsonPath, JSON.stringify(masterJson, null, 2));
          
          // Rename temp file to final file
          await fs.rename(tempJsonPath, masterJsonPath);
          if (updated) {
            console.log(`    ✓ Updated master JSON: ${path.basename(masterJsonPath)}`);
            augmented++;
          } else {
            console.log(`    ⊙ Master JSON unchanged: ${path.basename(masterJsonPath)}`);
          }
        }
      }
    } catch (error) {
      console.log(`  ⚠ Error processing archive ${archiveFile}: ${error.message}`);
    }
  }
  
  // Close database connections
  rhdataDb.close();
  patchbinDb.close();
  if (screenshotDb) screenshotDb.close();
  if (resourceDb) resourceDb.close();
  
  console.log(`\n✓ Processing complete.`);
  console.log(`  Processed ${processedBPS.size} BPS file(s)`);
  console.log(`  Augmented ${augmented} master JSON file(s)`);
  console.log(`  Not found in databases: ${notFound}`);
}

// Main entry point
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log(`
Usage: enode.sh augment_index7zs.js <BPS Index Folder> <BPS Archives Folder> [options]

Augment master JSON index files with data from databases.

Arguments:
  BPS Index Folder      Directory containing master JSON index files
  BPS Archives Folder   Directory containing 7z archives with BPS files

Options:
  --bpsrange=START:END  Only process BPS files whose SHA1 starts with hex in range (e.g., 09:0b)
  --7zrange=START:END  Only scan 7z files in hex range (e.g., 09:0b for bps_09.7z through bps_0b.7z)
  --7zfile=FILE        Only scan specific 7z file (e.g., bps_00.7z)
  --bpsfile=FILE       Only process specific BPS file (e.g., 6dd24c31b5d8c568aab0de6d68855f609cbe8f08.bps)
  --help, -h           Show this help message

Environment Variables:
  RHDATA_DB_PATH         Path to rhdata.db (default: electron/rhdata.db)
  PATCHBIN_DB_PATH       Path to patchbin.db (default: electron/patchbin.db)
  SCREENSHOT_DB_PATH     Path to screenshot.db (default: electron/screenshot.db)
  RESOURCE_DB_PATH       Path to resource.db (default: electron/resource.db)

The script:
  - Scans 7z archives in the BPS Archives Folder
  - Lists contents of each archive to find BPS files (named by SHA1 hash)
  - For each BPS file:
    * Queries patchblobs table where result_sha1 = BPS SHA1
    * Queries gameversions table for highest version with matching patchblob1_name
    * Queries attachments table where file_name = patchblob1_name
    * Queries res_screenshots and gameversion_screenshots tables
    * Queries res_attachments table
  - Augments master JSON files in BPS Index Folder with database data
  - Excludes blob columns (file_data, encrypted_data) from JSON output

Examples:
  enode.sh augment_index7zs.js ~/rhplay/refmaterial/index7z ~/rhplay/refmaterial/bps7z/
  enode.sh augment_index7zs.js ~/rhplay/refmaterial/index7z ~/rhplay/refmaterial/bps7z/ --7zrange=09:0b
  enode.sh augment_index7zs.js ~/rhplay/refmaterial/index7z ~/rhplay/refmaterial/bps7z/ --bpsrange=09:0b
  enode.sh augment_index7zs.js ~/rhplay/refmaterial/index7z ~/rhplay/refmaterial/bps7z/ --7zfile=bps_00.7z
  enode.sh augment_index7zs.js ~/rhplay/refmaterial/index7z ~/rhplay/refmaterial/bps7z/ --bpsfile=6dd24c31b5d8c568aab0de6d68855f609cbe8f08.bps
`);
    process.exit(0);
  }
  
  if (args.length < 2) {
    console.error('Error: Missing required arguments');
    console.error('Usage: enode.sh augment_index7zs.js <BPS Index Folder> <BPS Archives Folder>');
    console.error('Run with --help for more information');
    process.exit(1);
  }
  
  const bpsIndexFolder = args[0];
  const bpsArchivesFolder = args[1];
  
  // Parse options
  const options = {
    bpsRange: null,
    sevenZRange: null,
    sevenZFile: null,
    bpsFile: null
  };
  
  for (const arg of args.slice(2)) {
    if (arg.startsWith('--bpsrange=')) {
      options.bpsRange = arg.substring('--bpsrange='.length);
    } else if (arg.startsWith('--7zrange=')) {
      options.sevenZRange = arg.substring('--7zrange='.length);
    } else if (arg.startsWith('--7zfile=')) {
      options.sevenZFile = arg.substring('--7zfile='.length);
    } else if (arg.startsWith('--bpsfile=')) {
      options.bpsFile = arg.substring('--bpsfile='.length);
    } else if (arg === '--help' || arg === '-h') {
      // Already handled above
    } else {
      console.error(`Error: Unknown option: ${arg}`);
      console.error('Run with --help for usage information');
      process.exit(1);
    }
  }
  
  // Validate mutually exclusive options
  if (options.sevenZFile && options.sevenZRange) {
    console.error('Error: --7zfile and --7zrange are mutually exclusive');
    process.exit(1);
  }
  
  if (options.bpsFile && options.bpsRange) {
    console.error('Error: --bpsfile and --bpsrange are mutually exclusive');
    process.exit(1);
  }
  
  // Run processing
  try {
    await augmentIndex7zs(bpsIndexFolder, bpsArchivesFolder, options);
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

module.exports = { augmentIndex7zs };
