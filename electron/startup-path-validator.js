const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');

/**
 * Startup Path Validation System
 * Automatically detects and configures OS-specific program paths
 */
class StartupPathValidator {
    constructor(dbManager) {
        this.dbManager = dbManager;
        this.userDataDir = app.getPath('userData');
        this.validationResults = {
            vanillaRomValid: false,
            flipsPathValid: false,
            asarPathValid: false,
            uberAsmPathValid: false,
            needsSettingsModal: false,
            missingCriticalPaths: []
        };
    }

    /**
     * Main validation method - runs all path validations
     */
    async validateAllPaths() {
        console.log('🔍 Starting startup path validation...');
        
        try {
            // Validate vanilla ROM
            await this.validateVanillaRom();
            
            // Validate critical tools
            await this.validateFlipsPath();
            
            // Validate optional tools
            await this.validateAsarPath();
            await this.validateUberAsmPath();
            
            // Determine if settings modal should open
            this.determineSettingsModalNeed();
            
            console.log('✅ Startup path validation completed:', this.validationResults);
            return this.validationResults;
            
        } catch (error) {
            console.error('❌ Error during startup validation:', error);
            this.validationResults.needsSettingsModal = true;
            return this.validationResults;
        }
    }

    /**
     * Validate vanilla ROM path and search for ROM files
     */
    async validateVanillaRom() {
        console.log('🔍 Validating vanilla ROM...');
        
        const expectedHash = 'fdc4c00e09a8e08d395003e9c8a747f45a9e5e94cbfedc508458eb08';
        const romFilenames = ['smw.sfc', 'SuperMarioWorld.sfc'];
        
        try {
            // Get current vanillaRomPath from settings
            const currentPath = await this.getSetting('vanillaRomPath');
            
            // Check if current path is valid
            if (currentPath && await this.validateRomFile(currentPath, expectedHash)) {
                console.log('✅ Current vanilla ROM path is valid:', currentPath);
                await this.setSetting('vanillaRomValid', true);
                this.validationResults.vanillaRomValid = true;
                return;
            }
            
            // Search for ROM files in user data directory
            const foundRom = await this.searchForRomFile(this.userDataDir, romFilenames, expectedHash);
            
            if (foundRom) {
                console.log('✅ Found valid ROM in user data directory:', foundRom);
                await this.setSetting('vanillaRomPath', foundRom);
                await this.setSetting('vanillaRomValid', true);
                this.validationResults.vanillaRomValid = true;
                return;
            }
            
            // ROM not found or invalid
            console.log('❌ No valid vanilla ROM found');
            await this.setSetting('vanillaRomValid', false);
            this.validationResults.vanillaRomValid = false;
            this.validationResults.missingCriticalPaths.push('vanillaRomPath');
            
        } catch (error) {
            console.error('❌ Error validating vanilla ROM:', error);
            await this.setSetting('vanillaRomValid', false);
            this.validationResults.vanillaRomValid = false;
            this.validationResults.missingCriticalPaths.push('vanillaRomPath');
        }
    }

    /**
     * Validate flips path and search for flips executable
     */
    async validateFlipsPath() {
        console.log('🔍 Validating flips path...');
        
        try {
            const currentPath = await this.getSetting('flipsPath');
            
            // Check if current path is valid
            if (currentPath && await this.validateExecutable(currentPath, 'flips')) {
                console.log('✅ Current flips path is valid:', currentPath);
                this.validationResults.flipsPathValid = true;
                return;
            }
            
            // Search for flips executable
            const foundFlips = await this.searchForExecutable('flips');
            
            if (foundFlips) {
                console.log('✅ Found flips executable:', foundFlips);
                await this.setSetting('flipsPath', foundFlips);
                this.validationResults.flipsPathValid = true;
                return;
            }
            
            // Flips not found
            console.log('❌ No flips executable found');
            this.validationResults.flipsPathValid = false;
            this.validationResults.missingCriticalPaths.push('flipsPath');
            
        } catch (error) {
            console.error('❌ Error validating flips path:', error);
            this.validationResults.flipsPathValid = false;
            this.validationResults.missingCriticalPaths.push('flipsPath');
        }
    }

    /**
     * Validate asar path (optional)
     */
    async validateAsarPath() {
        console.log('🔍 Validating asar path (optional)...');
        
        try {
            const currentPath = await this.getSetting('asarPath');
            
            if (currentPath && await this.validateExecutable(currentPath, 'asar')) {
                console.log('✅ Current asar path is valid:', currentPath);
                this.validationResults.asarPathValid = true;
                return;
            }
            
            const foundAsar = await this.searchForExecutable('asar');
            
            if (foundAsar) {
                console.log('✅ Found asar executable:', foundAsar);
                await this.setSetting('asarPath', foundAsar);
                this.validationResults.asarPathValid = true;
            } else {
                console.log('ℹ️ No asar executable found (optional)');
                this.validationResults.asarPathValid = false;
            }
            
        } catch (error) {
            console.error('❌ Error validating asar path:', error);
            this.validationResults.asarPathValid = false;
        }
    }

    /**
     * Validate uberasm path (optional)
     */
    async validateUberAsmPath() {
        console.log('🔍 Validating uberasm path (optional)...');
        
        try {
            const currentPath = await this.getSetting('uberAsmPath');
            
            if (currentPath && await this.validateExecutable(currentPath, 'uberasm')) {
                console.log('✅ Current uberasm path is valid:', currentPath);
                this.validationResults.uberAsmPathValid = true;
                return;
            }
            
            const foundUberAsm = await this.searchForExecutable('uberasm');
            
            if (foundUberAsm) {
                console.log('✅ Found uberasm executable:', foundUberAsm);
                await this.setSetting('uberAsmPath', foundUberAsm);
                this.validationResults.uberAsmPathValid = true;
            } else {
                console.log('ℹ️ No uberasm executable found (optional)');
                this.validationResults.uberAsmPathValid = false;
            }
            
        } catch (error) {
            console.error('❌ Error validating uberasm path:', error);
            this.validationResults.uberAsmPathValid = false;
        }
    }

    /**
     * Validate ROM file by checking SHA224 hash
     */
    async validateRomFile(filePath, expectedHash) {
        try {
            if (!fs.existsSync(filePath)) {
                return false;
            }
            
            const fileBuffer = fs.readFileSync(filePath);
            const hash = crypto.createHash('sha224').update(fileBuffer).digest('hex');
            
            return hash === expectedHash;
        } catch (error) {
            console.error('Error validating ROM file:', error);
            return false;
        }
    }

    /**
     * Search for ROM files in directory
     */
    async searchForRomFile(searchDir, filenames, expectedHash) {
        try {
            if (!fs.existsSync(searchDir)) {
                return null;
            }
            
            const files = fs.readdirSync(searchDir, { recursive: true });
            
            for (const file of files) {
                const fullPath = path.join(searchDir, file);
                
                if (fs.statSync(fullPath).isFile()) {
                    const filename = path.basename(fullPath);
                    
                    if (filenames.includes(filename)) {
                        if (await this.validateRomFile(fullPath, expectedHash)) {
                            return fullPath;
                        }
                    }
                }
            }
            
            return null;
        } catch (error) {
            console.error('Error searching for ROM files:', error);
            return null;
        }
    }

    /**
     * Validate executable file
     */
    async validateExecutable(filePath, expectedName) {
        try {
            if (!fs.existsSync(filePath)) {
                return false;
            }
            
            const filename = path.basename(filePath).toLowerCase();
            const expectedFilename = expectedName.toLowerCase();
            
            // Check if filename matches expected name
            if (!filename.includes(expectedFilename)) {
                return false;
            }
            
            // Check if it's executable (has .exe extension on Windows or executable bit on Unix)
            if (process.platform === 'win32') {
                return filename.endsWith('.exe');
            } else {
                return fs.statSync(filePath).mode & 0o111; // Check executable bit
            }
        } catch (error) {
            console.error('Error validating executable:', error);
            return false;
        }
    }

    /**
     * Search for executable in various locations
     */
    async searchForExecutable(executableName) {
        const searchPaths = this.getExecutableSearchPaths();
        
        for (const searchPath of searchPaths) {
            try {
                if (!fs.existsSync(searchPath)) {
                    continue;
                }
                
                const files = fs.readdirSync(searchPath);
                
                for (const file of files) {
                    const fullPath = path.join(searchPath, file);
                    
                    if (fs.statSync(fullPath).isFile()) {
                        if (await this.validateExecutable(fullPath, executableName)) {
                            return fullPath;
                        }
                    }
                }
            } catch (error) {
                // Continue searching other paths
                continue;
            }
        }
        
        return null;
    }

    /**
     * Get executable search paths based on OS
     */
    getExecutableSearchPaths() {
        const paths = [this.userDataDir];
        
        if (process.platform === 'win32') {
            // Windows paths
            paths.push(
                path.join(this.userDataDir, 'Flips'),
                path.join(this.userDataDir, 'bin'),
                'C:\\Program Files\\Flips',
                'C:\\Program Files (x86)\\Flips'
            );
        } else if (process.platform === 'darwin') {
            // macOS paths
            paths.push(
                '/usr/local/bin',
                '/opt/homebrew/bin',
                path.join(process.env.HOME, 'bin')
            );
        } else {
            // Linux paths
            paths.push(
                '/usr/local/bin',
                '/usr/bin',
                '/bin',
                path.join(process.env.HOME, 'bin'),
                path.join(process.env.HOME, '.local', 'bin')
            );
        }
        
        return paths;
    }

    /**
     * Determine if settings modal should open
     */
    determineSettingsModalNeed() {
        const criticalPaths = ['vanillaRomPath', 'flipsPath'];
        const hasMissingCritical = criticalPaths.some(path => 
            this.validationResults.missingCriticalPaths.includes(path)
        );
        
        this.validationResults.needsSettingsModal = hasMissingCritical;
        
        if (hasMissingCritical) {
            console.log('⚠️ Critical paths missing, settings modal will open');
        }
    }

    /**
     * Get setting value from database
     */
    async getSetting(key) {
        try {
            const db = this.dbManager.getConnection('clientdata');
            const result = db.prepare(`
                SELECT csetting_value FROM csettings WHERE csetting_name = ?
            `).get(key);
            
            return result ? result.csetting_value : null;
        } catch (error) {
            console.error(`Error getting setting ${key}:`, error);
            return null;
        }
    }

    /**
     * Set setting value in database
     */
    async setSetting(key, value) {
        try {
            const db = this.dbManager.getConnection('clientdata');
            const crypto = require('crypto');
            const uuid = crypto.randomUUID();
            
            db.prepare(`
                INSERT INTO csettings (csettinguid, csetting_name, csetting_value)
                VALUES (?, ?, ?)
                ON CONFLICT(csetting_name) DO UPDATE SET csetting_value = excluded.csetting_value
            `).run(uuid, key, String(value));
            
            console.log(`Setting ${key} = ${value}`);
            return true;
        } catch (error) {
            console.error(`Error setting ${key}:`, error);
            return false;
        }
    }
}

module.exports = StartupPathValidator;
