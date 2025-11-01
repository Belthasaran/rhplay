const { EventEmitter } = require('events');

/**
 * Dummy USB Device Simulator for SD2SNES/FXPak Pro
 * 
 * Simulates a USB device for testing purposes without requiring actual hardware.
 * Implements the same binary protocol as the real device handler.
 */
class DummyUsbDevice extends EventEmitter {
  constructor() {
    super();
    this.isOpen = false;
    this.memory = Buffer.alloc(0x1000000); // 16MB memory space
    this.fileSystem = new Map(); // Simulated file system
    this.firmwareVersion = 'v1.0.0';
    this.versionString = 'DUMMY_SD2SNES';
    this.romRunning = 'Test ROM.sfc';
    this.features = 0xFF; // All features enabled
    this.writeBuffer = null; // Buffer for accumulating write data
    
    // Initialize with some test data
    this._initializeTestData();
  }

  /**
   * Initialize test data in memory and file system
   * @private
   */
  _initializeTestData() {
    // Write some test pattern to memory
    for (let i = 0; i < this.memory.length; i++) {
      this.memory[i] = i & 0xFF;
    }
    
    // Create some test files
    this.fileSystem.set('/test.sfc', Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]));
    this.fileSystem.set('/work/test.txt', Buffer.from('Hello, World!', 'utf8'));
  }

  /**
   * Open the dummy device
   * @returns {Promise<void>}
   */
  async open() {
    if (this.isOpen) {
      return;
    }
    
    this.isOpen = true;
    console.log('[DummyUsbDevice] Device opened');
    this.emit('open');
  }

  /**
   * Close the dummy device
   * @returns {Promise<void>}
   */
  async close() {
    if (!this.isOpen) {
      return;
    }
    
    this.isOpen = false;
    console.log('[DummyUsbDevice] Device closed');
    this.emit('close');
  }

  /**
   * Send command and get response
   * @param {number} opcode - Opcode enum
   * @param {number} space - Space enum
   * @param {number} flags - Flags enum
   * @param {Array} args - Command arguments
   * @returns {Promise<Buffer>} Response packet
   */
  async sendCommand(opcode, space, flags, args) {
    if (!this.isOpen) {
      throw new Error('Device not open');
    }

    // Simulate processing delay
    await new Promise(resolve => setTimeout(resolve, 10));

    const response = this._buildResponsePacket(opcode, space, flags);
    
    // Handle command based on opcode
    switch (opcode) {
      case 0: // GET
        if (space === 1) { // SNES
          const address = typeof args[0] === 'number' ? args[0] : parseInt(args[0], 16);
          const size = typeof args[1] === 'number' ? args[1] : parseInt(args[1], 16);
          
          // Validate address range
          if (address >= 0 && address + size <= this.memory.length) {
            // Set size in response (bytes 252-255)
            response[252] = (size >> 24) & 0xFF;
            response[253] = (size >> 16) & 0xFF;
            response[254] = (size >> 8) & 0xFF;
            response[255] = size & 0xFF;
            
            // Store data for _readData
            this.pendingData = this.memory.slice(address, address + size);
          } else {
            // Invalid address range - return zero size
            response[252] = 0;
            response[253] = 0;
            response[254] = 0;
            response[255] = 0;
            this.pendingData = Buffer.alloc(0);
          }
        } else if (space === 0) { // FILE
          const filePath = String(args[0]);
          const fileData = this.fileSystem.get(filePath) || Buffer.alloc(0);
          
          const size = fileData.length;
          response[252] = (size >> 24) & 0xFF;
          response[253] = (size >> 16) & 0xFF;
          response[254] = (size >> 8) & 0xFF;
          response[255] = size & 0xFF;
          
          this.pendingData = fileData;
        }
        break;
        
      case 1: // PUT
        if (space === 1) { // SNES
          // Address at bytes 252-255 in command
          // Data will come in _readData
          const address = typeof args[0] === 'number' ? args[0] : parseInt(args[0], 16);
          const size = typeof args[1] === 'number' ? args[1] : parseInt(args[1], 16);
          
          this.pendingWriteAddress = address;
          this.pendingWriteSize = size;
        } else if (space === 0) { // FILE
          const filePath = String(args[0]);
          const size = typeof args[1] === 'number' ? args[1] : parseInt(args[1], 16);
          
          this.pendingWriteFile = filePath;
          this.pendingWriteSize = size;
        } else if (space === 3) { // CMD
          const cmdAddress = typeof args[0] === 'number' ? args[0] : parseInt(args[0], 16);
          const size = typeof args[1] === 'number' ? args[1] : parseInt(args[1], 16);
          
          this.pendingWriteAddress = cmdAddress;
          this.pendingWriteSize = size;
        }
        break;
        
      case 4: // LS
        const dirPath = String(args[0] || '/');
        this._handleListDirectory(response, dirPath);
        break;
        
      case 5: // MKDIR
        // Fire-and-forget, no response expected
        break;
        
      case 6: // RM
        const removePath = String(args[0]);
        this.fileSystem.delete(removePath);
        break;
        
      case 7: // MV (used for Rename and PutIPS)
        if (args.length === 1) {
          // PutIPS: single operand is IPS file path
          const ipsPath = String(args[0]);
          // Simulate IPS patch application - for dummy, just acknowledge
          this.pendingData = Buffer.alloc(0);
        } else if (args.length === 2) {
          // Rename: source and dest paths
          const sourcePath = String(args[0]);
          const destPath = String(args[1]);
          const fileData = this.fileSystem.get(sourcePath);
          if (fileData) {
            this.fileSystem.set(destPath, fileData);
            this.fileSystem.delete(sourcePath);
          }
        }
        break;
        
      case 9: // BOOT
        const bootPath = String(args[0]);
        this.romRunning = bootPath.split('/').pop() || bootPath;
        break;
        
      case 11: // INFO
        this._handleInfo(response);
        break;
        
      case 12: // MENU_RESET
        // Menu reset - just acknowledge
        break;
        
      case 8: // RESET
      case 10: // POWER_CYCLE
        // Reset operations - acknowledge
        break;
        
      case 13: // STREAM (MSU space)
        if (space === 2) { // MSU
          // Generate dummy stream data
          const streamSize = 1024; // 1KB dummy data
          response[252] = (streamSize >> 24) & 0xFF;
          response[253] = (streamSize >> 16) & 0xFF;
          response[254] = (streamSize >> 8) & 0xFF;
          response[255] = streamSize & 0xFF;
          
          // Store dummy stream data
          this.pendingData = Buffer.alloc(streamSize, 0x42); // Fill with 0x42
        }
        break;
    }

    return response;
  }

  /**
   * Read data after command
   * @param {number} size - Number of bytes to read
   * @returns {Promise<Buffer>} Data buffer
   */
  async readData(size) {
    if (!this.isOpen) {
      throw new Error('Device not open');
    }

    // Simulate processing delay
    await new Promise(resolve => setTimeout(resolve, 5));

    if (this.pendingData) {
      const data = this.pendingData.slice(0, size);
      this.pendingData = null;
      return data;
    }

    // Return zero-filled buffer if no pending data
    return Buffer.alloc(size, 0);
  }

  /**
   * Write data to pending write operation
   * @param {Buffer} data - Data to write
   * @returns {Promise<void>}
   */
  async writeData(data) {
    if (!this.isOpen) {
      throw new Error('Device not open');
    }

    // Accumulate data if writing in progress
    if (!this.writeBuffer) {
      this.writeBuffer = Buffer.alloc(0);
    }
    
    this.writeBuffer = Buffer.concat([this.writeBuffer, data]);
    
    // Check if we have enough data
    if (this.pendingWriteAddress !== undefined && this.pendingWriteSize !== undefined) {
      // Write to memory
      const address = this.pendingWriteAddress;
      const size = this.pendingWriteSize;
      
      if (this.writeBuffer.length >= size) {
        if (address >= 0 && address + size <= this.memory.length) {
          this.writeBuffer.copy(this.memory, address, 0, Math.min(this.writeBuffer.length, size));
        }
        
        this.pendingWriteAddress = undefined;
        this.pendingWriteSize = undefined;
        this.writeBuffer = null;
      }
    } else if (this.pendingWriteFile && this.pendingWriteSize !== undefined) {
      // Write to file
      const filePath = this.pendingWriteFile;
      const size = this.pendingWriteSize;
      
      if (this.writeBuffer.length >= size) {
        this.fileSystem.set(filePath, this.writeBuffer.slice(0, size));
        
        this.pendingWriteFile = undefined;
        this.pendingWriteSize = undefined;
        this.writeBuffer = null;
      }
    }
  }

  /**
   * Build response packet
   * @private
   */
  _buildResponsePacket(opcode, space, flags) {
    const packet = Buffer.alloc(512);
    
    // Magic header: "USBA" (matching C# reference and QUSB2Snes)
    packet[0] = 0x55; // 'U'
    packet[1] = 0x53; // 'S'
    packet[2] = 0x42; // 'B'
    packet[3] = 0x41; // 'A'
    
    // Byte 4: Opcode (RESPONSE = 15)
    packet[4] = 15; // RESPONSE
    
    // Byte 5: Space
    packet[5] = space;
    
    // Byte 6: Flags (features for INFO)
    packet[6] = opcode === 11 ? this.features : flags;
    
    return packet;
  }

  /**
   * Handle INFO command
   * @private
   */
  _handleInfo(response) {
    // INFO response format (from C# Core.cs lines 911-934)
    // [firmwareversion, versionstring, romrunning, flag1, flag2]
    
    // Firmware version at byte 260
    const fwBytes = Buffer.from(this.firmwareVersion, 'utf8');
    fwBytes.copy(response, 260, 0, Math.min(fwBytes.length, 200));
    
    // Version string at bytes 256-259 (hex representation)
    const versionNum = 0x00010000; // v1.0.0
    response[256] = (versionNum >> 24) & 0xFF;
    response[257] = (versionNum >> 16) & 0xFF;
    response[258] = (versionNum >> 8) & 0xFF;
    response[259] = versionNum & 0xFF;
    
    // ROM running at byte 16
    const romBytes = Buffer.from(this.romRunning, 'utf8');
    romBytes.copy(response, 16, 0, Math.min(romBytes.length, 240));
  }

  /**
   * Handle LS (List) command
   * @private
   */
  _handleListDirectory(response, dirPath) {
    let offset = 0;
    const allFiles = Array.from(this.fileSystem.keys());
    
    // Filter files for the requested directory
    const files = allFiles
      .filter(path => {
        // Remove leading slash for root
        const normalizedPath = path.startsWith('/') ? path.substring(1) : path;
        const normalizedDir = dirPath === '/' ? '' : (dirPath.startsWith('/') ? dirPath.substring(1) : dirPath);
        
        if (normalizedDir === '') {
          // Root directory - return files in root (no subdirectories)
          return !normalizedPath.includes('/');
        }
        
        // Check if file is in the requested directory
        if (normalizedPath.startsWith(normalizedDir + '/')) {
          const relativePath = normalizedPath.substring(normalizedDir.length + 1);
          // Only direct children (not grandchildren)
          return !relativePath.includes('/');
        }
        
        return false;
      })
      .map(path => {
        // Determine if it's a directory (for now, all entries are files)
        const type = 0; // 0 = file, 1 = directory
        const fullPath = path.startsWith('/') ? path : '/' + path;
        const normalizedDir = dirPath === '/' ? '' : (dirPath.startsWith('/') ? dirPath.substring(1) : dirPath);
        let name = fullPath;
        
        if (normalizedDir === '') {
          name = fullPath.substring(1); // Remove leading slash
        } else {
          const dirPrefix = '/' + normalizedDir + '/';
          if (fullPath.startsWith(dirPrefix)) {
            name = fullPath.substring(dirPrefix.length);
          }
        }
        
        return {
          type: type,
          name: name
        };
      });
    
    // Format: (type byte, filename null-terminated) pairs (from C# Core.cs lines 490-533)
    for (const file of files) {
      if (offset >= 512 - 2) break; // Leave room for null terminator
      
      response[offset++] = file.type;
      const nameBytes = Buffer.from(file.name, 'ascii');
      const nameLen = Math.min(nameBytes.length, 255);
      nameBytes.copy(response, offset, 0, nameLen);
      offset += nameLen;
      response[offset++] = 0; // Null terminator
    }
    
    // End with 0xFF if space available
    if (offset < 512) {
      response[offset] = 0xFF;
    }
  }

  /**
   * Reset the dummy device
   * @returns {Promise<boolean>} Success status
   */
  async reset() {
    if (!this.isOpen) {
      return false;
    }
    
    // Simulate reset delay
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Reset clears pending operations
    this.pendingData = null;
    this.pendingWriteAddress = undefined;
    this.pendingWriteSize = undefined;
    this.pendingWriteFile = undefined;
    this.writeBuffer = null;
    
    console.log('[DummyUsbDevice] Reset executed');
    return true;
  }

  /**
   * Get device info
   * @returns {Promise<Object>} Device info
   */
  async getInfo() {
    return {
      firmwareversion: this.firmwareVersion,
      versionstring: this.versionString,
      romrunning: this.romRunning,
      flag1: 'FEAT_DSPX|FEAT_ST0010|FEAT_SRTC|FEAT_MSU1|FEAT_213F|FEAT_CMD_UNLOCK|FEAT_USB1|FEAT_DMA1',
      flag2: ''
    };
  }
}

module.exports = DummyUsbDevice;

