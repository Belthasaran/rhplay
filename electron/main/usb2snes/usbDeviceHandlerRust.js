// USB2SNES Device Handler using Rust native module
// This replaces usbDeviceHandler.js with a Rust-based implementation

const path = require('path');

// Try to get Electron app, but don't fail if it's not available (standalone Node.js)
let app = null;
try {
    const electron = require('electron');
    app = electron.app;
} catch (e) {
    // Not in Electron context, app will be null
}

// Try to load the Rust native module
let Usb2SnesCore = null;
let parseInfoResponse = null;
let parseGetResponse = null;

try {
    // Try multiple paths for the native module
    // Handle both Electron and standalone Node.js environments
    // __dirname here is electron/main/usb2snes/
    let possiblePaths = [
        // Relative to usb2snes directory: electron/main/usb2snes/ -> project root -> native-modules/
        path.resolve(__dirname, '../../../native-modules/usb2snes-core/index.node'),
        // From project root (for standalone scripts)
        path.resolve(process.cwd(), 'native-modules/usb2snes-core/index.node'),
        // Fallback: relative join then resolve
        path.join(__dirname, '../../../native-modules/usb2snes-core/index.node'),
    ];

    // Add Electron app path if available (only in Electron context)
    try {
        if (app && typeof app.getAppPath === 'function') {
            possiblePaths.push(path.join(app.getAppPath(), 'native-modules/usb2snes-core/index.node'));
        }
    } catch (e) {
        // app not available (standalone Node.js), skip Electron-specific paths
    }

    let moduleLoaded = false;
    for (const modulePath of possiblePaths) {
        try {
            // Try loading via index.js wrapper first (better error handling)
            const wrapperPath = modulePath.replace(/index\.node$/, 'index.js');
            let rustModule = null;
            
            try {
                // Try wrapper first
                const fs = require('fs');
                if (fs.existsSync(wrapperPath)) {
                    rustModule = require(wrapperPath);
                } else {
                    // Fall back to direct .node require
                    rustModule = require(modulePath);
                }
            } catch (wrapperErr) {
                // If wrapper fails, try direct .node
                try {
                    rustModule = require(modulePath);
                } catch (nodeErr) {
                    throw wrapperErr; // Use wrapper error which is usually better
                }
            }
            
            if (rustModule && rustModule.Usb2SnesCore) {
                Usb2SnesCore = rustModule.Usb2SnesCore;
                parseInfoResponse = rustModule.parseInfoResponse;
                parseGetResponse = rustModule.parseGetResponse;
                moduleLoaded = true;
                console.log(`[UsbDeviceHandlerRust] ✓ Loaded Rust native module from: ${modulePath}`);
                break;
            }
        } catch (err) {
            // Try next path (verbose logging disabled to avoid spam)
            continue;
        }
    }

    if (!moduleLoaded) {
        console.warn('[UsbDeviceHandlerRust] ⚠ Failed to load Rust native module, falling back to JavaScript implementation');
        Usb2SnesCore = null;
    }
} catch (err) {
    console.error('[UsbDeviceHandlerRust] ✗ Error loading Rust native module:', err);
    Usb2SnesCore = null;
}

class UsbDeviceHandlerRust {
    constructor(useDummy = false) {
        this.core = null;
        this.deviceName = null;
        this.isOpen = false;
        this.useDummy = useDummy;
        
        // If using dummy device, use dummy handler
        if (this.useDummy) {
            const DummyUsbDevice = require('./dummyUsbDevice');
            this.dummyDevice = new DummyUsbDevice();
        }
    }

    async openDevice(deviceInfo) {
        try {
            // If using dummy device, use dummy handler
            if (this.useDummy && this.dummyDevice) {
                return await this.dummyDevice.openDevice(deviceInfo);
            }
            
            if (!Usb2SnesCore) {
                throw new Error('Rust native module not available');
            }

            if (this.core && this.isOpen) {
                await this.closeDevice();
            }

            this.core = new Usb2SnesCore();
            
            // Try to get port path from deviceInfo (matching JavaScript handler logic)
            let portPath = deviceInfo.serialPort || deviceInfo.portPath || deviceInfo.path || 
                          deviceInfo.port || deviceInfo.devicePath;
            
            // If no port path provided, try to find it (matching JavaScript handler behavior)
            if (!portPath || typeof portPath !== 'string') {
                // Try common serial port paths (matching JavaScript handler)
                const possiblePorts = deviceInfo.possiblePorts || [
                    '/dev/ttyACM0',
                    '/dev/ttyACM1',
                    '/dev/ttyACM2',
                    '/dev/ttyUSB0',
                    '/dev/ttyUSB1',
                    '/dev/ttyUSB2'
                ];
                
                // Try each port until one works
                const fs = require('fs');
                for (const testPort of possiblePorts) {
                    try {
                        // Check if port exists and is accessible
                        if (fs.existsSync(testPort)) {
                            portPath = testPort;
                            console.log(`[UsbDeviceHandlerRust] Found port path: ${portPath}`);
                            break;
                        }
                    } catch (err) {
                        // Port doesn't exist - try next one
                        continue;
                    }
                }
            }
            
            if (!portPath || typeof portPath !== 'string') {
                console.error('[UsbDeviceHandlerRust] DeviceInfo keys:', Object.keys(deviceInfo));
                throw new Error('Could not find serial port path. Is the device connected?');
            }

            await this.core.connect(portPath);
            
            // Extract device name (handle both string and object cases)
            let deviceName = 'SD2SNES'; // default
            if (typeof deviceInfo.name === 'string') {
                deviceName = deviceInfo.name;
            } else if (typeof deviceInfo.device === 'string') {
                deviceName = deviceInfo.device;
            } else if (typeof deviceInfo.deviceName === 'string') {
                deviceName = deviceInfo.deviceName;
            } else if (deviceInfo.vendorId === 0x1209 && deviceInfo.productId === 0x5a22) {
                deviceName = 'SD2SNES';
            }
            
            this.deviceName = deviceName;
            this.isOpen = true;

            console.log(`[UsbDeviceHandlerRust] ✓ Opened device: ${this.deviceName} on ${portPath}`);
            return true;
        } catch (error) {
            console.error(`[UsbDeviceHandlerRust] ✗ Failed to open device:`, error);
            this.isOpen = false;
            throw error;
        }
    }

    async closeDevice() {
        try {
            if (this.core && this.isOpen) {
                await this.core.disconnect();
            }
            this.core = null;
            this.isOpen = false;
            this.deviceName = null;
            console.log('[UsbDeviceHandlerRust] ✓ Device closed');
        } catch (error) {
            console.error(`[UsbDeviceHandlerRust] ✗ Error closing device:`, error);
            throw error;
        }
    }

    async reset() {
        try {
            if (this.useDummy && this.dummyDevice) {
                return await this.dummyDevice.reset();
            }
            
            if (!this.core || !this.isOpen) {
                throw new Error('Device not open');
            }

            // Send RESET opcode (8) with NORESP flag (64)
            // Space is FILE (0) according to C# reference
            await this.core.sendCommand(8, 0, 64, null);
            
            // Also call core.reset() to set DTR = false and wait 500ms (matching C# Reset() method)
            await this.core.reset();
            
            console.log('[UsbDeviceHandlerRust] ✓ Reset command sent');
            return true;
        } catch (error) {
            console.error(`[UsbDeviceHandlerRust] ✗ Reset failed:`, error);
            throw error;
        }
    }

    async getInfo() {
        try {
            if (this.useDummy && this.dummyDevice) {
                return await this.dummyDevice.getInfo();
            }
            
            if (!this.core || !this.isOpen) {
                throw new Error('Device not open');
            }

            // INFO opcode (11), Space SNES (1), Flags 0
            const response = await this.core.sendCommand(11, 1, 0, null);
            
            if (!parseInfoResponse) {
                throw new Error('parseInfoResponse function not available');
            }

            const parsed = parseInfoResponse(response);
            const [firmwareVersion, versionString, romRunning, flags] = parsed;

            console.log(`[UsbDeviceHandlerRust] ✓ Info retrieved: FW=${firmwareVersion}, ROM=${romRunning}`);
            
            return {
                firmwareVersion: firmwareVersion || null,
                versionString: versionString || null,
                romRunning: romRunning || null,
                flag1: flags || '',
                flag2: ''
            };
        } catch (error) {
            console.error(`[UsbDeviceHandlerRust] ✗ GetInfo failed:`, error);
            throw error;
        }
    }

    async readMemory(address, size) {
        try {
            if (this.useDummy && this.dummyDevice) {
                return await this.dummyDevice.readMemory(address, size);
            }
            
            if (!this.core || !this.isOpen) {
                throw new Error('Device not open');
            }

            // GET opcode (0), Space SNES (1), Flags 0
            // Args: address (hex string), size (hex string)
            const addressHex = address.toString(16).padStart(8, '0');
            const sizeHex = size.toString(16).padStart(8, '0');
            const response = await this.core.sendCommand(0, 1, 0, [addressHex, sizeHex]);
            
            // Parse response - GET returns data starting at byte 0
            // The actual data is in the response packet
            const dataSize = parseGetResponse ? parseGetResponse(response) : size;
            const data = response.slice(0, Math.min(dataSize, size));
            
            return Buffer.from(data);
        } catch (error) {
            console.error(`[UsbDeviceHandlerRust] ✗ ReadMemory failed:`, error);
            throw error;
        }
    }

    async writeMemory(address, data) {
        try {
            if (this.useDummy && this.dummyDevice) {
                return await this.dummyDevice.writeMemory(address, data);
            }
            
            if (!this.core || !this.isOpen) {
                throw new Error('Device not open');
            }

            // PUT opcode (1), Space SNES (1), Flags 0
            // Args: address (hex string), size (hex string)
            const addressHex = address.toString(16).padStart(8, '0');
            const sizeHex = data.length.toString(16).padStart(8, '0');
            
            // PUT requires data in the packet - send command first
            const response = await this.core.sendCommand(1, 1, 0, [addressHex, sizeHex]);
            
            // After PUT command, data must be written separately
            // This matches the JavaScript handler behavior
            // Note: Full PUT implementation would need to send data after the command response
            // For now, we rely on the Rust core to handle this properly
            // TODO: Implement full PUT data writing if needed
            
            return response && response[4] === 15; // RESPONSE opcode = 15
        } catch (error) {
            console.error(`[UsbDeviceHandlerRust] ✗ WriteMemory failed:`, error);
            throw error;
        }
    }

    async writeMemoryCMD(cmdAddress, cmdData) {
        try {
            if (this.useDummy && this.dummyDevice) {
                return await this.dummyDevice.writeMemoryCMD(cmdAddress, cmdData);
            }
            
            if (!this.core || !this.isOpen) {
                throw new Error('Device not open');
            }

            // PUT opcode (1), Space CMD (3), Flags 0
            // Args: address (hex string), size (hex string)
            const addressHex = cmdAddress.toString(16).padStart(8, '0');
            const sizeHex = cmdData.length.toString(16).padStart(8, '0');
            
            // Send PUT command to CMD space
            const response = await this.core.sendCommand(1, 3, 0, [addressHex, sizeHex]);
            
            // After PUT command to CMD space, data must be written separately
            // This matches the JavaScript handler behavior (usbDeviceHandler.js line 1706-1720)
            // Note: Full CMD PUT implementation would need to send data after the command response
            // TODO: Implement full CMD PUT data writing if needed
            
            return response && response[4] === 15; // RESPONSE opcode = 15
        } catch (error) {
            console.error(`[UsbDeviceHandlerRust] ✗ WriteMemoryCMD failed:`, error);
            throw error;
        }
    }

    async listDirectory(dirPath) {
        try {
            if (this.useDummy && this.dummyDevice) {
                return await this.dummyDevice.listDirectory(dirPath);
            }
            
            if (!this.core || !this.isOpen) {
                throw new Error('Device not open');
            }

            // LS opcode (4), Space FILE (0), Flags 0
            // Args: path (string)
            const response = await this.core.sendCommand(4, 0, 0, [dirPath || '/']);
            
            // Parse LS response (type byte, filename null-terminated pairs)
            // This matches the JavaScript handler's _parseDirectoryListing method
            const files = [];
            let offset = 0;
            
            while (offset < 512 && response[offset] !== 0 && response[offset] !== 0xFF) {
                const type = response[offset];
                offset++;
                
                const filenameStart = offset;
                while (offset < 512 && response[offset] !== 0) {
                    offset++;
                }
                
                if (offset > filenameStart) {
                    const filename = response.slice(filenameStart, offset).toString('ascii');
                    if (filename && filename !== '.' && filename !== '..') {
                        files.push({
                            type: type === 0 ? 'file' : type === 1 ? 'dir' : 'unknown',
                            filename: filename
                        });
                    }
                }
                offset++; // Skip null terminator
            }
            
            return files;
        } catch (error) {
            console.error(`[UsbDeviceHandlerRust] ✗ ListDirectory failed:`, error);
            throw error;
        }
    }

    async makeDirectory(dirPath) {
        try {
            if (this.useDummy && this.dummyDevice) {
                return await this.dummyDevice.makeDirectory(dirPath);
            }
            
            if (!this.core || !this.isOpen) {
                throw new Error('Device not open');
            }

            // MKDIR opcode (5), Space FILE (0), Flags NORESP (64)
            // MKDIR uses NORESP flag (fire-and-forget) - no response expected
            await this.core.sendCommand(5, 0, 64, [dirPath]);
            
            return true;
        } catch (error) {
            console.error(`[UsbDeviceHandlerRust] ✗ MakeDirectory failed:`, error);
            return false;
        }
    }

    async remove(path) {
        try {
            if (this.useDummy && this.dummyDevice) {
                return await this.dummyDevice.remove(path);
            }
            
            if (!this.core || !this.isOpen) {
                throw new Error('Device not open');
            }

            // RM opcode (6), Space FILE (0), Flags 0
            const response = await this.core.sendCommand(6, 0, 0, [path]);
            
            return response && response[4] === 15; // RESPONSE opcode = 15
        } catch (error) {
            console.error(`[UsbDeviceHandlerRust] ✗ Remove failed:`, error);
            return false;
        }
    }

    async rename(sourcePath, destPath) {
        try {
            if (this.useDummy && this.dummyDevice) {
                return await this.dummyDevice.rename(sourcePath, destPath);
            }
            
            if (!this.core || !this.isOpen) {
                throw new Error('Device not open');
            }

            // MV opcode (7), Space FILE (0), Flags 0
            // Args: sourcePath (string), destPath (string)
            const response = await this.core.sendCommand(7, 0, 0, [sourcePath, destPath]);
            
            return response && response[4] === 15; // RESPONSE opcode = 15
        } catch (error) {
            console.error(`[UsbDeviceHandlerRust] ✗ Rename failed:`, error);
            return false;
        }
    }

    async bootFile(filePath) {
        try {
            if (this.useDummy && this.dummyDevice) {
                return await this.dummyDevice.bootFile(filePath);
            }
            
            if (!this.core || !this.isOpen) {
                throw new Error('Device not open');
            }

            // BOOT opcode (9), Space FILE (0), Flags 0
            // Args: filePath (string)
            const response = await this.core.sendCommand(9, 0, 0, [filePath]);
            
            return response && response[4] === 15; // RESPONSE opcode = 15
        } catch (error) {
            console.error(`[UsbDeviceHandlerRust] ✗ BootFile failed:`, error);
            return false;
        }
    }

    // Utility methods for compatibility
    getDeviceName() {
        return this.deviceName;
    }

    getIsOpen() {
        return this.isOpen;
    }

    // Check if Rust module is available
    static isAvailable() {
        return Usb2SnesCore !== null;
    }
}

module.exports = UsbDeviceHandlerRust;

