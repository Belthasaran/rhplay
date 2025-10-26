/**
 * binary-finder.js - Locate Required Binaries and Files
 * 
 * Finds flips, asar binaries and smw.sfc ROM file by checking multiple locations:
 * 1. Database setting (clientdata.db csettings table)
 * 2. Environment variable
 * 3. Current working directory
 * 4. Script directory (where this script is located)
 * 5. Common installation directories (platform-specific)
 * 6. Additional tool-specific directories
 * 7. System PATH
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');
const Database = require('better-sqlite3');

// Expected SHA224 hash for valid SMW ROM
const SMW_EXPECTED_SHA224 = 'fdc4c00e09a8e08d395003e9c8a747f45a9e5e94cbfedc508458eb08';

class BinaryFinder {
  constructor(options = {}) {
    this.projectRoot = options.projectRoot || process.cwd();
    this.clientDbPath = options.clientDbPath || path.join(this.projectRoot, 'electron', 'clientdata.db');
    this.platform = process.platform;
    this.isWindows = this.platform === 'win32';
    
    // Error tracking
    this.lastError = null;
    this.errorCallback = options.errorCallback || null;
  }

  /**
   * Find flips binary
   */
  findFlips() {
    const executableName = this.isWindows ? 'flips.exe' : 'flips';
    
    const checks = [
      { name: 'Database setting', fn: () => this.checkDatabase('flips_path') },
      { name: 'Environment variable', fn: () => this.checkEnvironment('FLIPS_BIN_PATH') },
      { name: 'Current directory', fn: () => this.checkCurrentDirectory(executableName) },
      { name: 'Script directory', fn: () => this.checkScriptDirectory(executableName) },
      { name: 'Common directories', fn: () => this.checkCommonDirectories(executableName) },
      { name: 'System PATH', fn: () => this.checkSystemPath(executableName) },
    ];

    for (const check of checks) {
      try {
        const result = check.fn();
        if (result && this.validateBinary(result, 'flips')) {
          console.log(`  ✓ Found flips via ${check.name}: ${result}`);
          return result;
        }
      } catch (error) {
        // Silently continue to next check
      }
    }

    return null;
  }

  /**
   * Find asar binary
   */
  findAsar() {
    const executableName = this.isWindows ? 'asar.exe' : 'asar';
    
    const checks = [
      { name: 'Database setting', fn: () => this.checkDatabase('asar_path') },
      { name: 'Environment variable', fn: () => this.checkEnvironment('ASAR_BIN_PATH') },
      { name: 'Current directory', fn: () => this.checkCurrentDirectory(executableName) },
      { name: 'Script directory', fn: () => this.checkScriptDirectory(executableName) },
      { name: 'Asar-specific directories', fn: () => this.checkAsarDirectories() },
      { name: 'Common directories', fn: () => this.checkCommonDirectories(executableName) },
      { name: 'System PATH', fn: () => this.checkSystemPath(executableName) },
    ];

    for (const check of checks) {
      try {
        const result = check.fn();
        if (result && this.validateBinary(result, 'asar')) {
          console.log(`  ✓ Found asar via ${check.name}: ${result}`);
          return result;
        }
      } catch (error) {
        // Silently continue to next check
      }
    }

    return null;
  }

  /**
   * Find smw.sfc ROM file with SHA224 validation
   */
  findSmwRom() {
    const checks = [
      { name: 'Database setting', fn: () => this.checkDatabase('sfc_path') },
      { name: 'Environment variable', fn: () => this.checkEnvironment('SMW_SFC_PATH') },
      { name: 'Current directory', fn: () => this.checkCurrentDirectory('smw.sfc') },
      { name: 'Script directory', fn: () => this.checkScriptDirectory('smw.sfc') },
      { name: 'Common ROM directories', fn: () => this.checkRomDirectories() },
    ];

    this.lastError = null;

    for (const check of checks) {
      try {
        const result = check.fn();
        if (result && fs.existsSync(result)) {
          const validation = this.validateSmwRom(result);
          if (validation.valid) {
            console.log(`  ✓ Found smw.sfc via ${check.name}: ${result}`);
            console.log(`    SHA224: ${validation.hash}`);
            return result;
          } else {
            // Hash mismatch - log error and continue searching
            const errorMsg = `SMW ROM found at ${result} but SHA224 hash mismatch:\n` +
                           `  Expected: ${SMW_EXPECTED_SHA224}\n` +
                           `  Actual:   ${validation.hash}`;
            this.lastError = errorMsg;
            process.stderr.write(`  ✗ ${errorMsg}\n`);
            
            if (this.errorCallback) {
              this.errorCallback(errorMsg, { path: result, ...validation });
            }
          }
        }
      } catch (error) {
        // Silently continue to next check
      }
    }

    return null;
  }

  /**
   * Validate SMW ROM file by checking SHA224 hash
   */
  validateSmwRom(romPath) {
    try {
      const romData = fs.readFileSync(romPath);
      const hash = crypto.createHash('sha224').update(romData).digest('hex');
      
      return {
        valid: hash === SMW_EXPECTED_SHA224,
        hash: hash,
        expected: SMW_EXPECTED_SHA224,
        size: romData.length
      };
    } catch (error) {
      return {
        valid: false,
        error: error.message
      };
    }
  }

  /**
   * Check clientdata.db for setting
   */
  checkDatabase(settingName) {
    if (!fs.existsSync(this.clientDbPath)) {
      return null;
    }

    try {
      const db = new Database(this.clientDbPath, { readonly: true, fileMustExist: true });
      
      // Check if csettings table exists
      const tableExists = db.prepare(`
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name='csettings'
      `).get();

      if (!tableExists) {
        db.close();
        return null;
      }

      // Query for setting
      const row = db.prepare(`
        SELECT csetting_value FROM csettings 
        WHERE csetting_name = ?
      `).get(settingName);

      db.close();

      if (row && row.csetting_value) {
        return row.csetting_value;
      }

      return null;

    } catch (error) {
      // Database error, continue to next method
      return null;
    }
  }

  /**
   * Check environment variable
   */
  checkEnvironment(envVar) {
    const envPath = process.env[envVar];
    if (envPath) {
      return envPath;
    }
    return null;
  }

  /**
   * Check current working directory
   */
  checkCurrentDirectory(filename) {
    const cwd = process.cwd();
    const filePath = path.join(cwd, filename);
    
    if (fs.existsSync(filePath)) {
      return filePath;
    }

    return null;
  }

  /**
   * Check script/project root directory
   */
  checkScriptDirectory(filename) {
    const filePath = path.join(this.projectRoot, filename);
    
    if (fs.existsSync(filePath)) {
      return filePath;
    }

    return null;
  }

  /**
   * Check asar-specific directories (from pb_lvlrand.py)
   */
  checkAsarDirectories() {
    const executableName = this.isWindows ? 'asar.exe' : 'asar';
    
    const asarPaths = [
      // From pb_lvlrand.py
      path.join(this.projectRoot, 'bin', 'asar'),
      path.join(this.projectRoot, 'asar.exe'),
      '/mnt/c/snesgaming/bin/asar',
      '/usr/local/bin/asar',
      path.join(this.projectRoot, 'asar'),
    ];

    for (const checkPath of asarPaths) {
      if (fs.existsSync(checkPath)) {
        return checkPath;
      }
    }

    return null;
  }

  /**
   * Check common ROM directories
   */
  checkRomDirectories() {
    const romPaths = [
      path.join(this.projectRoot, 'smw.sfc'),
      path.join(this.projectRoot, 'rom', 'smw.sfc'),
      path.join(this.projectRoot, 'roms', 'smw.sfc'),
    ];

    // Add path_prefix if RHTOOLS_PATH is set
    if (process.env.RHTOOLS_PATH) {
      romPaths.push(path.join(process.env.RHTOOLS_PATH, 'smw.sfc'));
    }

    for (const checkPath of romPaths) {
      if (fs.existsSync(checkPath)) {
        return checkPath;
      }
    }

    return null;
  }

  /**
   * Check common installation directories (platform-specific)
   */
  checkCommonDirectories(filename) {
    let commonPaths = [];

    if (this.isWindows) {
      // Windows common paths
      const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
      const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
      const localAppData = process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || 'C:\\Users\\Default', 'AppData', 'Local');
      const appData = process.env.APPDATA || path.join(process.env.USERPROFILE || 'C:\\Users\\Default', 'AppData', 'Roaming');

      const toolName = filename.replace('.exe', '');
      const toolNameCap = toolName.charAt(0).toUpperCase() + toolName.slice(1);

      commonPaths = [
        path.join(programFiles, toolNameCap, filename),
        path.join(programFilesX86, toolNameCap, filename),
        path.join(localAppData, toolNameCap, filename),
        path.join(appData, toolNameCap, filename),
        path.join(programFiles, filename),
        path.join(programFilesX86, filename),
        `C:\\${toolName}\\${filename}`,
        `C:\\tools\\${filename}`,
      ];

    } else {
      // Unix-like systems (Linux, macOS, etc.)
      const homeDir = process.env.HOME || '/root';

      commonPaths = [
        `/usr/local/bin/${filename}`,
        `/usr/bin/${filename}`,
        `/opt/${filename}/${filename}`,
        `/opt/local/bin/${filename}`,
        path.join(homeDir, 'bin', filename),
        path.join(homeDir, '.local', 'bin', filename),
        `/snap/bin/${filename}`,
      ];
    }

    for (const checkPath of commonPaths) {
      if (fs.existsSync(checkPath)) {
        return checkPath;
      }
    }

    return null;
  }

  /**
   * Check system PATH by attempting to execute which/where
   */
  checkSystemPath(filename) {
    try {
      const command = this.isWindows ? `where ${filename}` : `which ${filename}`;
      const result = execSync(command, { 
        stdio: 'pipe',
        encoding: 'utf8',
        timeout: 5000
      }).trim();

      if (result) {
        // On Windows, 'where' might return multiple paths, take the first one
        const paths = result.split('\n').map(p => p.trim()).filter(p => p);
        if (paths.length > 0) {
          return paths[0];
        }
      }
    } catch (error) {
      // Command failed, not in PATH
    }

    return null;
  }

  /**
   * Validate that a path points to a valid binary
   */
  validateBinary(binaryPath, expectedName) {
    // Check if file exists
    if (!fs.existsSync(binaryPath)) {
      return false;
    }

    // Check if it's a file (not a directory)
    const stats = fs.statSync(binaryPath);
    if (!stats.isFile()) {
      return false;
    }

    // On Unix-like systems, check if executable
    if (!this.isWindows) {
      try {
        fs.accessSync(binaryPath, fs.constants.X_OK);
      } catch (error) {
        return false;
      }
    }

    // Try to run with --version or --help to verify it's the correct binary
    try {
      execSync(`"${binaryPath}" --version`, { 
        stdio: 'pipe',
        timeout: 3000,
        windowsHide: true
      });
      return true;
    } catch (error) {
      // Some versions might not support --version, try --help
      try {
        execSync(`"${binaryPath}" --help`, { 
          stdio: 'pipe',
          timeout: 3000,
          windowsHide: true
        });
        return true;
      } catch (error2) {
        // If both fail, still consider it valid if it exists and has right name
        return path.basename(binaryPath).toLowerCase().includes(expectedName);
      }
    }
  }

  /**
   * Get flips path or throw error with helpful message
   */
  getFlipsPathOrThrow() {
    const flipsPath = this.findFlips();
    
    if (!flipsPath) {
      throw new Error(this.generateErrorMessage('flips', 'FLIPS_BIN_PATH', 'flips_path'));
    }

    return flipsPath;
  }

  /**
   * Get asar path or throw error with helpful message
   */
  getAsarPathOrThrow() {
    const asarPath = this.findAsar();
    
    if (!asarPath) {
      throw new Error(this.generateErrorMessage('asar', 'ASAR_BIN_PATH', 'asar_path'));
    }

    return asarPath;
  }

  /**
   * Get SMW ROM path or return null with error info
   */
  getSmwRomPath(throwOnError = false) {
    const romPath = this.findSmwRom();
    
    if (!romPath) {
      const errorMsg = this.generateSmwRomErrorMessage();
      
      if (throwOnError) {
        throw new Error(errorMsg);
      } else {
        // Write to stderr
        if (!this.lastError) {
          // No hash mismatch error was encountered, so ROM simply wasn't found
          process.stderr.write(`✗ ${errorMsg}\n`);
        }
        return null;
      }
    }

    return romPath;
  }

  /**
   * Generate helpful error message for binaries
   */
  generateErrorMessage(toolName, envVar, dbSetting) {
    const executableName = this.isWindows ? `${toolName}.exe` : toolName;
    
    let msg = `${toolName.charAt(0).toUpperCase() + toolName.slice(1)} utility not found.\n\n`;
    msg += `${toolName} was searched for in the following locations:\n`;
    msg += '  1. Database setting (electron/clientdata.db → csettings table)\n';
    msg += `  2. Environment variable: ${envVar}\n`;
    msg += '  3. Current working directory\n';
    msg += '  4. Project root directory\n';
    msg += '  5. Common installation directories\n';
    if (toolName === 'asar') {
      msg += '  6. Asar-specific directories (bin/asar, /mnt/c/snesgaming/bin/asar, etc.)\n';
      msg += '  7. System PATH\n\n';
    } else {
      msg += '  6. System PATH\n\n';
    }
    msg += 'To fix this issue:\n';
    
    if (this.isWindows) {
      msg += `  • Place ${executableName} in the project root directory, OR\n`;
      msg += '  • Add to PATH, OR\n';
      msg += `  • Set ${envVar} environment variable, OR\n`;
      msg += `  • Add to database: INSERT INTO csettings (csettinguid, csetting_name, csetting_value) VALUES (lower(hex(randomblob(16))), '${dbSetting}', 'C:\\path\\to\\${executableName}');\n`;
    } else {
      msg += `  • Place ${executableName} in the project root directory, OR\n`;
      msg += `  • Install to system: sudo cp ${executableName} /usr/local/bin/\n`;
      msg += '  • Add to PATH, OR\n';
      msg += `  • Set ${envVar} environment variable, OR\n`;
      msg += `  • Add to database: INSERT INTO csettings (csettinguid, csetting_name, csetting_value) VALUES (lower(hex(randomblob(16))), '${dbSetting}', '/path/to/${executableName}');\n`;
    }

    if (toolName === 'flips') {
      msg += '\nDownload Flips from: https://github.com/Alcaro/Flips\n';
    } else if (toolName === 'asar') {
      msg += '\nDownload Asar from: https://github.com/RPGHacker/asar\n';
    }

    return msg;
  }

  /**
   * Generate helpful error message for SMW ROM
   */
  generateSmwRomErrorMessage() {
    let msg = 'SMW ROM file (smw.sfc) not found or invalid.\n\n';
    
    if (this.lastError) {
      msg += 'Issue encountered:\n';
      msg += `  ${this.lastError}\n\n`;
    }
    
    msg += 'smw.sfc was searched for in the following locations:\n';
    msg += '  1. Database setting (electron/clientdata.db → csettings.sfc_path)\n';
    msg += '  2. Environment variable: SMW_SFC_PATH\n';
    msg += '  3. Current working directory\n';
    msg += '  4. Project root directory\n';
    msg += '  5. rom/ and roms/ subdirectories\n\n';
    msg += 'Requirements:\n';
    msg += '  • File must be a valid Super Mario World ROM\n';
    msg += `  • SHA224 hash must be: ${SMW_EXPECTED_SHA224}\n\n`;
    msg += 'To fix this issue:\n';
    msg += '  • Obtain a legally owned SMW ROM file\n';
    msg += '  • Place smw.sfc in the project root directory, OR\n';
    msg += '  • Set SMW_SFC_PATH environment variable, OR\n';
    msg += '  • Add to database: INSERT INTO csettings (csettinguid, csetting_name, csetting_value) VALUES (lower(hex(randomblob(16))), \'sfc_path\', \'/path/to/smw.sfc\');\n';

    return msg;
  }

  /**
   * Get last error message (useful for smw.sfc hash mismatches)
   */
  getLastError() {
    return this.lastError;
  }
}

/**
 * Convenience functions
 */

function getFlipsPath(options = {}) {
  const finder = new BinaryFinder(options);
  return finder.getFlipsPathOrThrow();
}

function findFlips(options = {}) {
  const finder = new BinaryFinder(options);
  return finder.findFlips();
}

function getAsarPath(options = {}) {
  const finder = new BinaryFinder(options);
  return finder.getAsarPathOrThrow();
}

function findAsar(options = {}) {
  const finder = new BinaryFinder(options);
  return finder.findAsar();
}

function getSmwRomPath(options = {}) {
  const finder = new BinaryFinder(options);
  return finder.getSmwRomPath(options.throwOnError || false);
}

function findSmwRom(options = {}) {
  const finder = new BinaryFinder(options);
  return finder.findSmwRom();
}

function validateSmwRom(romPath, options = {}) {
  const finder = new BinaryFinder(options);
  return finder.validateSmwRom(romPath);
}

module.exports = {
  BinaryFinder,
  getFlipsPath,
  findFlips,
  getAsarPath,
  findAsar,
  getSmwRomPath,
  findSmwRom,
  validateSmwRom,
  SMW_EXPECTED_SHA224
};

