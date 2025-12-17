#!/usr/bin/env node

/**
 * augment_index7zs.js - Augment master JSON files with database information
 * 
 * Usage:
 *   enode.sh augment_index7zs.js <BPS Index Folder> <BPS Archives Folder> [options]
 *   enode.sh augment_index7zs.js --help
 * 
 * This script scans 7z archives containing BPS patch files and augments existing
 * master JSON index files with data from databases (patchblobs, gameversions,
 * attachments, screenshots, res_attachments).
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

// Main processing function
async function augmentIndex7zs(bpsIndexFolder, bpsArchivesFolder) {
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
  const sevenZFiles = archiveFiles.filter(f => f.toLowerCase().endsWith('.7z'));
  
  console.log(`Found ${sevenZFiles.length} 7z archive(s)`);
  
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
  --help, -h            Show this help message

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
  
  // Run processing
  try {
    await augmentIndex7zs(bpsIndexFolder, bpsArchivesFolder);
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
