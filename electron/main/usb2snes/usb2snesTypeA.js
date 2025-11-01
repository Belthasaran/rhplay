/**
 * usb2snesTypeA - Type A implementation (Python py2snes port)
 * 
 * This is a JavaScript port of the py2snes Python library.
 * It implements the USB2SNES WebSocket protocol to communicate with
 * USB2SNES/QUsb2snes servers.
 * 
 * Based on: py2snes/__init__.py from the project's Python codebase
 * 
 * Protocol Reference:
 * - https://github.com/Skarsnik/QUsb2snes/blob/master/docs/Protocol.md
 * - Default WebSocket address: ws://localhost:64213
 */

const { 
  BaseUsb2snes, 
  SNES_DISCONNECTED, 
  SNES_CONNECTING, 
  SNES_CONNECTED, 
  SNES_ATTACHED,
  ROM_START,
  WRAM_START,
  WRAM_SIZE,
  SRAM_START
} = require('./BaseUsb2snes');

// WebSocket library - using 'ws' package
const WebSocket = require('ws');
const { SocksProxyAgent } = require('socks-proxy-agent');

// ========================================
// CONFIGURATION CONSTANTS
// ========================================

// PutFile chunk size (bytes)
// Recommended: 1024 bytes for better flow control
// May use 4096 for faster transfers on stable connections
const DEFAULT_CHUNK_SIZE = 1024;
const CHUNK_SIZE = parseInt(process.env.USB2SNES_CHUNK_SIZE) || DEFAULT_CHUNK_SIZE;

// Backpressure handling
const BACKPRESSURE_ENABLED = process.env.USB2SNES_BACKPRESSURE !== 'false';  // Default: true
const MAX_BUFFERED_AMOUNT = parseInt(process.env.USB2SNES_MAX_BUFFER) || 16384;  // 16KB default

// Directory pre-creation
const PREEMPTIVE_DIR_CREATE = process.env.USB2SNES_PREEMPTIVE_DIR !== 'false';  // Default: true

// Upload verification
const VERIFY_AFTER_UPLOAD = process.env.USB2SNES_VERIFY_UPLOAD !== 'false';  // Default: true

// Blocking upload timeout (milliseconds per MB)
const BLOCKING_TIMEOUT_PER_MB = parseInt(process.env.USB2SNES_TIMEOUT_PER_MB) || 10000;  // 10 seconds per MB

// Savestate configuration
const SAVESTATE_SIZE = 320 * 1024;  // 320KB
const SAVESTATE_DATA_ADDRESS = 0xF00000;
const SAVESTATE_INTERFACE_ADDRESS_OLD = 0xFC2000;  // Firmware < 11
const SAVESTATE_INTERFACE_ADDRESS_NEW = 0xFE1000;  // Firmware >= 11

class Usb2snesTypeA extends BaseUsb2snes {
  constructor() {
    super();
    this.socket = null;
    this.recvQueue = [];
    this.requestLock = false;
    this.recvTask = null;
    
    // Configuration (can be overridden per instance)
    this.chunkSize = CHUNK_SIZE;
    this.backpressureEnabled = BACKPRESSURE_ENABLED;
    this.maxBufferedAmount = MAX_BUFFERED_AMOUNT;
    this.preemptiveDirCreate = PREEMPTIVE_DIR_CREATE;
    this.verifyAfterUpload = VERIFY_AFTER_UPLOAD;
    
    // Savestate configuration
    this.savestateInterfaceAddress = SAVESTATE_INTERFACE_ADDRESS_OLD;
    this.savestateDataAddress = SAVESTATE_DATA_ADDRESS;
    this.firmwareVersion = null;
    
    // Hang detection
    this.consecutiveTimeouts = 0;
    this.maxConsecutiveTimeouts = 3; // Reconnect after 3 consecutive timeouts
    
    // Track directories we've created in this session
    this.createdDirectories = new Set();
    
    console.log('[usb2snesTypeA] Configuration:');
    console.log(`  Chunk size: ${this.chunkSize} bytes`);
    console.log(`  Backpressure: ${this.backpressureEnabled ? 'enabled' : 'disabled'} (max buffer: ${this.maxBufferedAmount})`);
    console.log(`  Preemptive dir create: ${this.preemptiveDirCreate}`);
    console.log(`  Verify after upload: ${this.verifyAfterUpload}`);
  }

  /**
   * Connect to USB2SNES WebSocket server
   * @param {string} address - WebSocket address (e.g., 'ws://localhost:64213')
   * @param {Object} options - Additional connection options
   * @returns {Promise<void>}
   */
  async connect(address = 'ws://localhost:64213', options = {}) {
    if (this.socket !== null) {
      console.log('[usb2snesTypeA] Already connected');
      return;
    }

    this.state = SNES_CONNECTING;

    console.log(`[usb2snesTypeA] Connecting to ${address}...`);

    try {
      const wsOptions = {
        perMessageDeflate: false
      };

      if (options && options.proxyMode === 'socks' && options.socksProxyUrl) {
        console.log(`[usb2snesTypeA] Using SOCKS proxy ${options.socksProxyUrl}`);
        wsOptions.agent = new SocksProxyAgent(options.socksProxyUrl);
      }

      // For SSH port forwarding, override the Host header to use localhost:remotePort
      // This is required because the remote server expects connections to come from localhost
      if (options && options.proxyMode === 'ssh' && options.ssh && options.ssh.remotePort) {
        const remotePort = options.ssh.remotePort;
        if (!wsOptions.headers) {
          wsOptions.headers = {};
        }
        wsOptions.headers['Host'] = `localhost:${remotePort}`;
        console.log(`[usb2snesTypeA] SSH port forwarding: Setting Host header to localhost:${remotePort}`);
      }

      // Create WebSocket connection
      this.socket = new WebSocket(address, wsOptions);

      // Set up event handlers
      await this._setupWebSocket();

      this.state = SNES_CONNECTED;
      console.log('[usb2snesTypeA] Connected successfully');
    } catch (error) {
      if (this.socket) {
        this.socket.close();
        this.socket = null;
      }
      this.state = SNES_DISCONNECTED;
      throw error;
    }
  }

  /**
   * Set up WebSocket event handlers
   * @private
   */
  async _setupWebSocket() {
    return new Promise((resolve, reject) => {
      this.socket.on('open', () => {
        console.log('[usb2snesTypeA] WebSocket opened');
        // Start receive loop
        this._startRecvLoop();
        resolve();
      });

      this.socket.on('error', (error) => {
        console.error('[usb2snesTypeA] WebSocket error:', error);
        reject(error);
      });

      this.socket.on('close', () => {
        console.log('[usb2snesTypeA] WebSocket closed');
        this.socket = null;
        this.state = SNES_DISCONNECTED;
        this.recvQueue = [];
      });
    });
  }

  /**
   * Start receiving loop to queue incoming messages
   * @private
   */
  _startRecvLoop() {
    this.socket.on('message', (data, isBinary) => {
      // Queue incoming data
      this.recvQueue.push(data);
      
      // Debug: Log what we received
      try {
        // Try to parse as JSON regardless of binary flag - WebSocket can send text as binary
        const textData = Buffer.isBuffer(data) ? data.toString('utf8') : (typeof data === 'string' ? data : data.toString());
        const parsed = JSON.parse(textData);
        console.log('[usb2snesTypeA] Received message:', parsed.Opcode || 'no opcode', 'Results:', parsed.Results ? parsed.Results.length : 'none', 'isBinary:', isBinary);
      } catch (e) {
        console.log('[usb2snesTypeA] Received binary/non-JSON data:', data.length || data.toString().length, 'bytes', 'isBinary:', isBinary);
      }
    });
  }

  /**
   * Disconnect from USB2SNES server
   * @returns {Promise<void>}
   */
  async disconnect() {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    this.state = SNES_DISCONNECTED;
    this.recvQueue = [];
    this.device = null;
    this.isSD2SNES = false;
  }

  /**
   * Get list of available devices
   * @returns {Promise<string[]>} Array of device names
   */
  async DeviceList() {
    // Wait for request lock
    while (this.requestLock) {
      await this._sleep(10);
    }
    this.requestLock = true;

    try {
      if (this.state < SNES_CONNECTED || !this.socket || this.socket.readyState !== WebSocket.OPEN) {
        return null;
      }

      const request = {
        Opcode: "DeviceList",
        Space: "SNES"
      };

      const requestJson = JSON.stringify(request);
      console.log('[usb2snesTypeA] Sending DeviceList request:', requestJson);
      console.log('[usb2snesTypeA] Socket state:', this.socket.readyState, 'OPEN=', WebSocket.OPEN);
      
      this.socket.send(requestJson);
      console.log('[usb2snesTypeA] DeviceList request sent, waiting for response...');
      console.log('[usb2snesTypeA] Current recvQueue length:', this.recvQueue.length);

      // Wait for response with timeout
      const reply = await this._waitForResponse(5000);
      console.log('[usb2snesTypeA] Received DeviceList response:', reply);
      const devices = reply.Results && reply.Results.length > 0 ? reply.Results : null;

      if (!devices) {
        throw new Error('No devices found');
      }

      return devices;
    } catch (error) {
      // Only close socket on actual connection errors, not on timeouts
      if (error.message && error.message.includes('closed')) {
        if (this.socket) {
          this.socket.close();
          this.socket = null;
        }
        this.state = SNES_DISCONNECTED;
      }
      throw error;
    } finally {
      this.requestLock = false;
    }
  }

  /**
   * Attach to a specific device
   * @param {string} device - Device name from DeviceList
   * @returns {Promise<void>}
   */
  async Attach(device) {
    if (this.state !== SNES_CONNECTED || !this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('Not connected to USB2SNES server');
    }

    try {
      // Ensure device is a string
      const deviceName = typeof device === 'string' ? device : String(device || '');
      if (!deviceName) {
        throw new Error('Invalid device name: device must be a non-empty string');
      }

      const request = {
        Opcode: "Attach",
        Space: "SNES",
        Operands: [deviceName]
      };

      this.socket.send(JSON.stringify(request));
      this.state = SNES_ATTACHED;

      // Detect if SD2SNES device
      const deviceLower = deviceName.toLowerCase();
      if (deviceLower.includes('sd2snes') || (deviceName.length === 4 && deviceName.substring(0, 3) === 'COM')) {
        this.isSD2SNES = true;
      } else {
        this.isSD2SNES = false;
      }

      this.device = deviceName;
      console.log(`[usb2snesTypeA] Attached to ${deviceName}, isSD2SNES: ${this.isSD2SNES}`);
    } catch (error) {
      if (this.socket) {
        this.socket.close();
        this.socket = null;
      }
      this.state = SNES_DISCONNECTED;
      throw error;
    }
  }

  /**
   * Get device information
   * @returns {Promise<Object>} Device info
   */
  async Info() {
    while (this.requestLock) {
      await this._sleep(10);
    }
    this.requestLock = true;

    try {
      if (this.state !== SNES_ATTACHED || !this.socket || this.socket.readyState !== WebSocket.OPEN) {
        return null;
      }

      const request = {
        Opcode: "Info",
        Space: "SNES",
        Operands: [this.device]
      };

      this.socket.send(JSON.stringify(request));

      const reply = await this._waitForResponse(5000);
      const info = reply.Results && reply.Results.length > 0 ? reply.Results : [];

      return {
        firmwareversion: this._listItem(info, 0),
        versionstring: this._listItem(info, 1),
        romrunning: this._listItem(info, 2),
        flag1: this._listItem(info, 3),
        flag2: this._listItem(info, 4)
      };
    } catch (error) {
      // Only close socket on actual connection errors, not on timeouts
      if (error.message && error.message.includes('closed')) {
        if (this.socket) {
          this.socket.close();
          this.socket = null;
        }
        this.state = SNES_DISCONNECTED;
      }
      throw error;
    } finally {
      this.requestLock = false;
    }
  }

  /**
   * Set client name
   * @param {string} name - Client identifier
   * @returns {Promise<void>}
   */
  async Name(name) {
    if (this.state !== SNES_ATTACHED || !this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }

    try {
      const request = {
        Opcode: "Name",
        Space: "SNES",
        Operands: [name]
      };

      this.socket.send(JSON.stringify(request));
    } catch (error) {
      if (this.socket) {
        this.socket.close();
        this.socket = null;
      }
      this.state = SNES_DISCONNECTED;
      throw error;
    }
  }

  /**
   * Boot a ROM file
   * @param {string} romPath - Path to ROM on console
   * @returns {Promise<void>}
   */
  async Boot(romPath) {
    if (this.state !== SNES_ATTACHED || !this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('Not attached to device');
    }

    try {
      const request = {
        Opcode: "Boot",
        Space: "SNES",
        Operands: [romPath]
      };

      this.socket.send(JSON.stringify(request));
    } catch (error) {
      if (this.socket) {
        this.socket.close();
        this.socket = null;
      }
      this.state = SNES_DISCONNECTED;
      throw error;
    }
  }

  /**
   * Return to menu
   * @returns {Promise<void>}
   */
  async Menu() {
    if (this.state !== SNES_ATTACHED || !this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('Not attached to device');
    }

    try {
      const request = {
        Opcode: "Menu",
        Space: "SNES"
      };

      console.log('[usb2snesTypeA] Sending Menu command:', JSON.stringify(request));
      this.socket.send(JSON.stringify(request));
    } catch (error) {
      if (this.socket) {
        this.socket.close();
        this.socket = null;
      }
      this.state = SNES_DISCONNECTED;
      throw error;
    }
  }

  /**
   * Reset console
   * @returns {Promise<void>}
   */
  async Reset() {
    if (this.state !== SNES_ATTACHED || !this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('Not attached to device');
    }

    try {
      const request = {
        Opcode: "Reset",
        Space: "SNES"
      };

      this.socket.send(JSON.stringify(request));
    } catch (error) {
      if (this.socket) {
        this.socket.close();
        this.socket = null;
      }
      this.state = SNES_DISCONNECTED;
      throw error;
    }
  }

  /**
   * Read memory from console
   * @param {number} address - Memory address
   * @param {number} size - Number of bytes
   * @returns {Promise<Buffer>} Data read
   */
  async GetAddress(address, size) {
    while (this.requestLock) {
      await this._sleep(10);
    }
    this.requestLock = true;

    try {
      if (this.state !== SNES_ATTACHED || !this.socket || this.socket.readyState !== WebSocket.OPEN) {
        return null;
      }

      const request = {
        Opcode: "GetAddress",
        Space: "SNES",
        Operands: [address.toString(16), size.toString(16)]
      };

      this.socket.send(JSON.stringify(request));

      // Read binary data
      let data = Buffer.alloc(0);
      while (data.length < size) {
        const chunk = await this._waitForBinaryResponse(5000);
        if (!chunk) break;
        data = Buffer.concat([data, chunk]);
      }

      if (data.length !== size) {
        console.error(`[usb2snesTypeA] Error reading ${address.toString(16)}, requested ${size} bytes, received ${data.length}`);
        if (this.socket) {
          this.socket.close();
        }
        return null;
      }

      return data;
    } finally {
      this.requestLock = false;
    }
  }

  /**
   * Read multiple memory addresses in a single call (batch operation)
   * Much more efficient than multiple GetAddress calls - single WebSocket round-trip
   * Perfect for polling game state or reading multiple variables at once
   * @param {Array<[number, number]>} addressList - Array of [address, size] tuples
   * @returns {Promise<Array<Buffer>>} Array of data buffers (one per address, in order)
   */
  async GetAddresses(addressList) {
    while (this.requestLock) {
      await this._sleep(10);
    }
    this.requestLock = true;

    try {
      if (this.state !== SNES_ATTACHED || !this.socket || this.socket.readyState !== WebSocket.OPEN) {
        return null;
      }

      // Build operands: addr1, size1, addr2, size2, ...
      const operands = [];
      let totalSize = 0;
      
      for (const [address, size] of addressList) {
        operands.push(address.toString(16));
        operands.push(size.toString(16));
        totalSize += size;
      }

      const request = {
        Opcode: "GetAddress",
        Space: "SNES",
        Operands: operands
      };

      console.log(`[usb2snesTypeA] Batch read: ${addressList.length} addresses (${totalSize} bytes total)`);
      this.socket.send(JSON.stringify(request));

      // Read all binary data
      let data = Buffer.alloc(0);
      while (data.length < totalSize) {
        const chunk = await this._waitForBinaryResponse(5000);
        if (!chunk) break;
        data = Buffer.concat([data, chunk]);
      }

      if (data.length !== totalSize) {
        console.error(`[usb2snesTypeA] Batch read error: requested ${totalSize} bytes, received ${data.length}`);
        if (this.socket) {
          this.socket.close();
        }
        return null;
      }

      // Split data into individual results according to requested sizes
      const results = [];
      let consumed = 0;
      
      for (const [address, size] of addressList) {
        results.push(data.slice(consumed, consumed + size));
        consumed += size;
      }

      console.log(`[usb2snesTypeA] Batch read complete: ${results.length} addresses retrieved`);
      return results;
    } finally {
      this.requestLock = false;
    }
  }

  /**
   * Write memory to console
   * Includes SD2SNES special handling (CMD space with 65816 assembly)
   * @param {Array<[number, Buffer]>} writeList - Array of [address, data] tuples
   * @returns {Promise<boolean>} Success status
   */
  async PutAddress(writeList) {
    while (this.requestLock) {
      await this._sleep(10);
    }
    this.requestLock = true;

    try {
      if (this.state !== SNES_ATTACHED || !this.socket || this.socket.readyState !== WebSocket.OPEN) {
        return false;
      }

      const request = {
        Opcode: "PutAddress",
        Operands: []
      };

      if (this.isSD2SNES) {
        // SD2SNES requires special CMD space handling with 65816 assembly
        // Build assembly command to write values
        let cmd = Buffer.from([0x00, 0xE2, 0x20, 0x48, 0xEB, 0x48]);
        
        for (const [address, data] of writeList) {
          // Validate address is in WRAM range
          if (address < WRAM_START || (address + data.length) > (WRAM_START + WRAM_SIZE)) {
            console.error(`[usb2snesTypeA] SD2SNES: Write out of range ${address.toString(16)} (${data.length} bytes)`);
            return false;
          }
          
          // Generate assembly instructions for each byte
          for (let i = 0; i < data.length; i++) {
            const byte = data[i];
            const ptr = address + i + 0x7E0000 - WRAM_START;
            
            // LDA #byte
            cmd = Buffer.concat([cmd, Buffer.from([0xA9, byte])]);
            
            // STA.l ptr (long addressing)
            cmd = Buffer.concat([
              cmd,
              Buffer.from([
                0x8F,
                ptr & 0xFF,
                (ptr >> 8) & 0xFF,
                (ptr >> 16) & 0xFF
              ])
            ]);
          }
        }
        
        // Epilogue
        cmd = Buffer.concat([
          cmd,
          Buffer.from([0xA9, 0x00, 0x8F, 0x00, 0x2C, 0x00, 0x68, 0xEB, 0x68, 0x28, 0x6C, 0xEA, 0xFF, 0x08])
        ]);
        
        request.Space = 'CMD';
        request.Operands = ["2C00", (cmd.length - 1).toString(16), "2C00", "1"];
        
        this.socket.send(JSON.stringify(request));
        this.socket.send(cmd);
      } else {
        // Regular SNES space for non-SD2SNES devices
        request.Space = 'SNES';
        
        for (const [address, data] of writeList) {
          request.Operands = [address.toString(16), data.length.toString(16)];
          this.socket.send(JSON.stringify(request));
          this.socket.send(data);
        }
      }

      return true;
    } catch (error) {
      console.error('[usb2snesTypeA] PutAddress error:', error);
      return false;
    } finally {
      this.requestLock = false;
    }
  }

  /**
   * Upload file to console
   * @param {string} srcFile - Source file path
   * @param {string} dstFile - Destination file path
   * @param {Function|null} progressCallback - Optional progress callback (transferred, total) => void
   * @returns {Promise<boolean>} Success status
   */
  async PutFile(srcFile, dstFile, progressCallback = null) {
    const fs = require('fs').promises;
    const path = require('path');
    
    console.log('[usb2snesTypeA] PutFile called:', srcFile, '->', dstFile);
    console.log('[usb2snesTypeA] Waiting for request lock...');
    while (this.requestLock) {
      await this._sleep(10);
    }
    this.requestLock = true;
    console.log('[usb2snesTypeA] Request lock acquired');

    try {
      console.log('[usb2snesTypeA] Checking state - state:', this.state, 'SNES_ATTACHED:', SNES_ATTACHED);
      console.log('[usb2snesTypeA] Socket state - readyState:', this.socket?.readyState, 'OPEN:', WebSocket.OPEN);
      
      if (this.state !== SNES_ATTACHED || !this.socket || this.socket.readyState !== WebSocket.OPEN) {
        console.error('[usb2snesTypeA] Invalid state for upload');
        return false;
      }

      console.log('[usb2snesTypeA] State check passed');

      // Preemptive directory creation (if enabled)
      // NOTE: We must release the lock temporarily since MakeDir() needs the lock
      console.log('[usb2snesTypeA] Preemptive dir create enabled:', this.preemptiveDirCreate);
      if (this.preemptiveDirCreate) {
        const dirPath = dstFile.substring(0, dstFile.lastIndexOf('/')) || '/work';
        if (dirPath !== '/work' && !this.createdDirectories.has(dirPath)) {
          console.log('[usb2snesTypeA] Ensuring directory exists:', dirPath);
          
          // Release lock temporarily to avoid deadlock
          console.log('[usb2snesTypeA] Releasing lock for directory operations...');
          this.requestLock = false;
          
          try {
            // Just create the directory - don't check if it exists first
            // List() on non-existent directory causes server to close connection!
            await this._mkdir(dirPath);
            console.log(`[usb2snesTypeA] Directory creation command sent: ${dirPath}`);
            
            // Check if connection survived (server closes on error)
            if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
              console.error(`[usb2snesTypeA] Connection closed after MakeDir - server rejected command`);
              this.state = SNES_DISCONNECTED;
              this.socket = null;
              throw new Error(`MakeDir failed - server closed connection (invalid path: ${dirPath})`);
            }
            
            // Mark directory as created so we don't try again
            this.createdDirectories.add(dirPath);
            console.log(`[usb2snesTypeA] Directory created and cached: ${dirPath}`);
            
          } catch (mkdirError) {
            console.error(`[usb2snesTypeA] Directory creation failed:`, mkdirError);
            
            // Re-acquire lock before throwing
            while (this.requestLock) {
              await this._sleep(10);
            }
            this.requestLock = true;
            
            throw new Error(`Cannot create directory ${dirPath}: ${mkdirError.message}`);
          }
          
          // Re-acquire lock
          console.log('[usb2snesTypeA] Re-acquiring lock...');
          while (this.requestLock) {
            await this._sleep(10);
          }
          this.requestLock = true;
          console.log('[usb2snesTypeA] Lock re-acquired');
        } else if (dirPath !== '/work') {
          console.log(`[usb2snesTypeA] Directory already created in this session: ${dirPath}`);
        }
      }

      console.log('[usb2snesTypeA] Getting file stats...');
      const stats = await fs.stat(srcFile);
      const size = stats.size;
      console.log('[usb2snesTypeA] File size:', size, 'bytes');
      
      const request = {
        Opcode: "PutFile",
        Space: "SNES",
        Operands: [dstFile, size.toString(16)]
      };

      console.log('[usb2snesTypeA] Sending PutFile request:', JSON.stringify(request));
      this.socket.send(JSON.stringify(request));
      console.log('[usb2snesTypeA] PutFile request sent');

      // Read and send file in chunks with backpressure handling
      console.log('[usb2snesTypeA] Opening file for reading...');
      const fileHandle = await fs.open(srcFile, 'r');
      console.log('[usb2snesTypeA] File opened, chunk size:', this.chunkSize);
      const buffer = Buffer.alloc(this.chunkSize);
      let transferred = 0;
      
      // Initial progress callback
      console.log('[usb2snesTypeA] Calling initial progress callback...');
      if (progressCallback) {
        progressCallback(0, size);
      }
      
      console.log('[usb2snesTypeA] Starting file transfer loop...');
      try {
        let bytesRead;
        let chunkCount = 0;
        while ((bytesRead = (await fileHandle.read(buffer, 0, this.chunkSize)).bytesRead) > 0) {
          chunkCount++;
          if (chunkCount === 1 || chunkCount % 10 === 0) {
            console.log(`[usb2snesTypeA] Read chunk ${chunkCount}, bytes:`, bytesRead);
          }
          const chunk = buffer.slice(0, bytesRead);
          
          // Backpressure handling: Wait if socket buffer is full
          if (this.backpressureEnabled) {
            while (this.socket.bufferedAmount > this.maxBufferedAmount) {
              await this._sleep(50);
            }
          }
          
          this.socket.send(chunk);
          transferred += bytesRead;
          
          // Progress callback
          if (progressCallback) {
            progressCallback(transferred, size);
          }
          
          // Log progress for large files
          if (size > 1024 * 1024 && transferred % (512 * 1024) === 0) {
            console.log(`[usb2snesTypeA] Upload progress: ${Math.round(transferred / size * 100)}%`);
          }
        }
      } finally {
        console.log('[usb2snesTypeA] Closing file handle...');
        await fileHandle.close();
        console.log('[usb2snesTypeA] File handle closed');
      }

      // Verify byte count
      console.log('[usb2snesTypeA] Verifying byte count - transferred:', transferred, 'expected:', size);
      if (transferred !== size) {
        throw new Error(`Transfer incomplete: ${transferred}/${size} bytes`);
      }

      console.log(`[usb2snesTypeA] Transferred ${transferred} bytes successfully`);
      
      // CRITICAL: Wait for WebSocket buffer to drain before considering upload complete
      // We've sent all chunks, but they might still be buffered in the WebSocket
      console.log('[usb2snesTypeA] Waiting for WebSocket buffer to drain...');
      const drainStartTime = Date.now();
      while (this.socket && this.socket.bufferedAmount > 0) {
        const buffered = this.socket.bufferedAmount;
        console.log(`[usb2snesTypeA] Buffered: ${buffered} bytes, draining...`);
        await this._sleep(100);
        
        // Timeout after 30 seconds
        if (Date.now() - drainStartTime > 30000) {
          console.warn(`[usb2snesTypeA] WebSocket drain timeout - ${this.socket.bufferedAmount} bytes still buffered`);
          break;
        }
      }
      console.log(`[usb2snesTypeA] WebSocket buffer drained (took ${Date.now() - drainStartTime}ms)`);

      // CRITICAL: USB2SNES PutFile protocol has NO server acknowledgment!
      // We've sent all chunks, but device might still be processing.
      // We MUST verify (or send another command) to know when device is ready.
      // Verification serves dual purpose: confirm file exists AND confirm device finished processing
      console.log('[usb2snesTypeA] Verify after upload enabled:', this.verifyAfterUpload);
      if (this.verifyAfterUpload) {
        console.log('[usb2snesTypeA] Starting upload verification...');
        console.log('[usb2snesTypeA] Releasing lock for verification...');
        this.requestLock = false;
        
        try {
          await this._verifyUpload(dstFile, size);
          console.log('[usb2snesTypeA] Upload verification complete');
        } catch (verifyError) {
          console.warn('[usb2snesTypeA] Verification failed:', verifyError.message);
          // Don't fail the upload if verification fails
        }
        
        // Re-acquire lock
        console.log('[usb2snesTypeA] Re-acquiring lock after verification...');
        while (this.requestLock) {
          await this._sleep(10);
        }
        this.requestLock = true;
        console.log('[usb2snesTypeA] Lock re-acquired after verification');
      } else {
        // Verification disabled, but we still need to confirm device finished processing
        // Send a simple List command as a "ping" to wait for device readiness
        console.log('[usb2snesTypeA] Verification disabled - sending completion ping...');
        this.requestLock = false;
        
        try {
          const sizeMB = size / (1024 * 1024);
          const waitTime = Math.max(1000, Math.ceil(sizeMB * 500)); // 0.5s per MB, min 1s
          console.log(`[usb2snesTypeA] Waiting ${waitTime}ms for device to finish processing...`);
          await this._sleep(waitTime);
          
          // Ping device to confirm it's ready (List the upload directory)
          const dirPath = dstFile.substring(0, dstFile.lastIndexOf('/')) || '/work';
          await this.List(dirPath);
          console.log('[usb2snesTypeA] Device confirmed ready');
        } catch (error) {
          console.warn('[usb2snesTypeA] Completion ping failed:', error.message);
          // Don't fail upload, device might still be okay
        }
        
        // Re-acquire lock
        while (this.requestLock) {
          await this._sleep(10);
        }
        this.requestLock = true;
      }

      console.log('[usb2snesTypeA] PutFile returning true');
      return true;
    } catch (error) {
      console.error('[usb2snesTypeA] PutFile error:', error);
      return false;
    } finally {
      this.requestLock = false;
    }
  }

  /**
   * Verify uploaded file exists and is accessible
   * @private
   */
  async _verifyUpload(dstFile, expectedSize) {
    const dirPath = dstFile.substring(0, dstFile.lastIndexOf('/')) || '/work';
    const fileName = dstFile.substring(dstFile.lastIndexOf('/') + 1);
    
    // Small delay to let device finish processing the upload
    // Protocol has no ack, so we wait a bit before verifying
    const sizeMB = expectedSize / (1024 * 1024);
    const waitTime = Math.max(1000, Math.ceil(sizeMB * 500)); // 0.5s per MB, min 1s
    console.log(`[usb2snesTypeA] Waiting ${waitTime}ms for device to finish processing...`);
    await this._sleep(waitTime);
    
    // Check file exists with retry logic (device may still be busy)
    const maxRetries = 3;
    let lastError = null;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`[usb2snesTypeA] Verification attempt ${attempt}/${maxRetries}...`);
        const files = await this.List(dirPath);
        
        if (!files) {
          throw new Error('List returned null - device not responding');
        }
        
        const uploadedFile = files.find(f => f.filename === fileName);
        
        if (!uploadedFile) {
          throw new Error(`File ${fileName} not found after upload`);
        }
        
        console.log(`[usb2snesTypeA] Upload verified: ${dstFile}`);
        return; // Success!
        
      } catch (error) {
        lastError = error;
        console.warn(`[usb2snesTypeA] Verification attempt ${attempt} failed:`, error.message);
        
        if (attempt < maxRetries) {
          // Wait before retry - exponential backoff
          const retryWait = 2000 * attempt;
          console.log(`[usb2snesTypeA] Waiting ${retryWait}ms before retry...`);
          await this._sleep(retryWait);
        }
      }
    }
    
    // All retries failed
    console.error(`[usb2snesTypeA] Verification failed after ${maxRetries} attempts`);
    throw new Error(`Upload verification failed: ${lastError.message}`);
  }

  /**
   * Blocking file upload - waits for completion with timeout
   * @param {string} srcFile - Source file path
   * @param {string} dstFile - Destination file path
   * @param {number|null} timeoutMs - Timeout in milliseconds (null = auto-calculate)
   * @param {Function|null} progressCallback - Optional progress callback (transferred, total) => void
   * @returns {Promise<boolean>} Success status
   */
  async PutFileBlocking(srcFile, dstFile, timeoutMs = null, progressCallback = null) {
    const fs = require('fs').promises;
    
    try {
      const stats = await fs.stat(srcFile);
      const size = stats.size;
      
      // Calculate timeout based on file size if not specified
      if (timeoutMs === null) {
        const sizeMB = size / (1024 * 1024);
        timeoutMs = Math.max(30000, sizeMB * BLOCKING_TIMEOUT_PER_MB);  // Minimum 30 seconds
      }
      
      console.log(`[usb2snesTypeA] PutFileBlocking: ${srcFile} -> ${dstFile} (${size} bytes, timeout: ${timeoutMs}ms)`);
      
      // Create promise that will resolve/reject based on upload result (with progress callback)
      const uploadPromise = this.PutFile(srcFile, dstFile, progressCallback);
      
      // Create timeout promise
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Upload timeout after ${timeoutMs}ms (file size: ${size} bytes)`));
        }, timeoutMs);
      });
      
      // Race between upload and timeout
      const result = await Promise.race([uploadPromise, timeoutPromise]);
      
      console.log(`[usb2snesTypeA] PutFileBlocking completed successfully`);
      return result;
    } catch (error) {
      console.error('[usb2snesTypeA] PutFileBlocking error:', error);
      throw error;
    }
  }

  /**
   * Download file from console
   * @param {string} filePath - File path on console
   * @param {Function|null} progressCallback - Optional progress callback (received, total) => void
   * @returns {Promise<Buffer>} File data
   */
  async GetFile(filePath, progressCallback = null) {
    while (this.requestLock) {
      await this._sleep(10);
    }
    this.requestLock = true;

    try {
      if (this.state !== SNES_ATTACHED || !this.socket || this.socket.readyState !== WebSocket.OPEN) {
        return null;
      }

      const request = {
        Opcode: "GetFile",
        Space: "SNES",
        Operands: [filePath]
      };

      this.socket.send(JSON.stringify(request));

      // Get size from reply
      const reply = await this._waitForResponse(5000);
      const sizeHex = reply.Results[0];
      const size = parseInt(sizeHex, 16);

      console.log(`[usb2snesTypeA] Getting file: ${filePath} (${size} bytes)`);

      // Initial progress callback
      if (progressCallback) {
        progressCallback(0, size);
      }

      // Read binary data until complete
      let data = Buffer.alloc(0);
      let lastProgress = 0;
      
      while (data.length < size) {
        const chunk = await this._waitForBinaryResponse(10000);  // 10s timeout per chunk
        if (!chunk) {
          throw new Error(`GetFile timeout waiting for data (received ${data.length}/${size} bytes)`);
        }
        data = Buffer.concat([data, chunk]);

        // Progress callback
        if (progressCallback) {
          progressCallback(data.length, size);
        }

        // Log progress for large files
        if (size > 1024 * 1024 && data.length - lastProgress >= 512 * 1024) {
          console.log(`[usb2snesTypeA] Download progress: ${Math.round(data.length / size * 100)}%`);
          lastProgress = data.length;
        }
      }

      // Verify size
      if (data.length !== size) {
        throw new Error(`GetFile incomplete: received ${data.length}/${size} bytes`);
      }

      console.log(`[usb2snesTypeA] Downloaded ${data.length} bytes`);
      return data;
    } catch (error) {
      console.error('[usb2snesTypeA] GetFile error:', error);
      if (this.socket) {
        this.socket.close();
        this.socket = null;
      }
      this.state = SNES_DISCONNECTED;
      throw error;
    } finally {
      this.requestLock = false;
    }
  }

  /**
   * Blocking file download - waits for completion with timeout
   * @param {string} filePath - File path on console
   * @param {number|null} timeoutMs - Timeout in milliseconds (null = auto-calculate)
   * @param {Function|null} progressCallback - Optional progress callback (received, total) => void
   * @returns {Promise<Buffer>} File data
   */
  async GetFileBlocking(filePath, timeoutMs = null, progressCallback = null) {
    try {
      // Try to get file size first for timeout calculation
      // We'll use a heuristic: assume average download speed
      // If timeoutMs is null, we'll get it from the GetFile operation itself
      
      console.log(`[usb2snesTypeA] GetFileBlocking: ${filePath} (timeout: ${timeoutMs || 'auto'}ms)`);
      
      // If no timeout specified, use a generous default
      if (timeoutMs === null) {
        timeoutMs = 300000;  // 5 minutes default for downloads
      }
      
      // Create timeout promise
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Download timeout after ${timeoutMs}ms`));
        }, timeoutMs);
      });
      
      // Race between download and timeout
      const result = await Promise.race([
        this.GetFile(filePath, progressCallback),
        timeoutPromise
      ]);
      
      console.log(`[usb2snesTypeA] GetFileBlocking completed successfully`);
      return result;
    } catch (error) {
      console.error('[usb2snesTypeA] GetFileBlocking error:', error);
      throw error;
    }
  }

  /**
   * List directory contents
   * @param {string} dirPath - Directory path
   * @returns {Promise<Array>} Directory listing
   */
  async List(dirPath) {
    if (this.state !== SNES_ATTACHED || !this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return null;
    }

    // Validate path
    if (!dirPath.startsWith('/') && !['',' /'].includes(dirPath)) {
      throw new Error(`Path "${dirPath}" should start with "/"`);
    }
    if (dirPath.endsWith('/') && !['', '/'].includes(dirPath)) {
      throw new Error(`Path "${dirPath}" should not end with "/"`);
    }

    // Just try to list the directory directly
    // If it doesn't exist, _list() will return null or throw an error
    // No need for pre-validation
    return await this._list(dirPath);
  }

  /**
   * Internal list implementation
   * @private
   */
  async _list(dirPath) {
    while (this.requestLock) {
      await this._sleep(10);
    }
    this.requestLock = true;

    try {
      if (this.state !== SNES_ATTACHED || !this.socket || this.socket.readyState !== WebSocket.OPEN) {
        return null;
      }

      const request = {
        Opcode: 'List',
        Space: 'SNES',
        Flags: null,
        Operands: [dirPath]
      };

      console.log(`[usb2snesTypeA] Sending List request for directory: "${dirPath}"`);
      this.socket.send(JSON.stringify(request));
      
      const reply = await this._waitForResponse(5000);
      const results = reply.Results || [];
      
      console.log(`[usb2snesTypeA] List response for "${dirPath}": ${results.length / 2} items`);

      // Results alternate: type, filename, type, filename, ...
      const resultList = [];
      for (let i = 0; i < results.length; i += 2) {
        const filetype = results[i];
        const filename = results[i + 1];
        
        if (filename !== '.' && filename !== '..') {
          resultList.push({
            type: filetype,
            filename: filename
          });
        }
      }
      
      if (resultList.length > 0) {
        console.log(`[usb2snesTypeA] List "${dirPath}" returned:`, resultList.map(f => f.filename).join(', '));
      }

      return resultList;
    } catch (error) {
      // Close socket on connection errors or hung WebSocket
      if (error.message && (error.message.includes('closed') || error.message.includes('hung'))) {
        console.error(`[usb2snesTypeA] Closing connection: ${error.message}`);
        if (this.socket) {
          this.socket.close();
          this.socket = null;
        }
        this.state = SNES_DISCONNECTED;
        this.consecutiveTimeouts = 0; // Reset counter
      }
      // For simple timeouts, just return null and let caller handle retry
      if (error.message === 'Response timeout') {
        return null;
      }
      throw error;
    } finally {
      this.requestLock = false;
    }
  }

  /**
   * Create directory
   * @param {string} dirPath - Directory path
   * @returns {Promise<void>}
   */
  async MakeDir(dirPath, verify = false) {
    if (this.state !== SNES_ATTACHED || !this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return null;
    }
    
    if (dirPath === '' || dirPath === '/') {
      throw new Error('MakeDir: dirpath cannot be blank or "/"');
    }

    // Send the MakeDir command
    await this._mkdir(dirPath);
    console.log(`[usb2snesTypeA] MakeDir command sent for: ${dirPath}`);
    
    // Optional verification (disabled by default to prevent connection loss)
    if (verify) {
      // Wait a bit for device to process the command
      await this._sleep(500);
      
      // Try to verify with List() - use retry logic to avoid consecutive timeouts
      let verified = false;
      for (let attempt = 1; attempt <= 3; attempt++) {
        console.log(`[usb2snesTypeA] Verifying directory (attempt ${attempt}/3)...`);
        const listing = await this.List(dirPath);
        
        if (listing !== null) {
          console.log(`[usb2snesTypeA] Directory verified: ${dirPath}`);
          verified = true;
          break;
        }
        
        if (attempt < 3) {
          console.warn(`[usb2snesTypeA] Verification attempt ${attempt} returned null, retrying...`);
          await this._sleep(1000 * attempt);  // Exponential backoff
        }
      }
      
      if (!verified) {
        console.warn(`[usb2snesTypeA] Could not verify directory creation (device may be slow), but MakeDir command was sent`);
      }
    }
    
    return true;
  }

  /**
   * Internal mkdir implementation
   * @private
   * 
   * Note: MakeDir is a fire-and-forget command in USB2SNES protocol.
   * - No response on success
   * - Server closes connection on error
   * - Must check connection state after sending to detect errors
   */
  async _mkdir(dirPath) {
    if (this.state !== SNES_ATTACHED || !this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return null;
    }

    const request = {
      Opcode: 'MakeDir',
      Space: 'SNES',
      Flags: null,
      Operands: [dirPath]
    };

    console.log(`[usb2snesTypeA] Sending MakeDir request for: "${dirPath}"`);
    this.socket.send(JSON.stringify(request));
    console.log(`[usb2snesTypeA] MakeDir command sent (fire-and-forget)`);
    
    // MakeDir doesn't send a response on success
    // Server closes connection on error - wait a bit and check if connection is still alive
    await this._sleep(100);  // Small delay to let error propagate if it occurs
    
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      console.error(`[usb2snesTypeA] Connection closed after MakeDir - command failed for: "${dirPath}"`);
      this.state = SNES_DISCONNECTED;
      this.socket = null;
      throw new Error(`MakeDir failed - server closed connection (invalid path or permission error)`);
    }
    
    console.log(`[usb2snesTypeA] Connection still alive after MakeDir - command likely succeeded`);
    return true;
  }

  /**
   * Remove file/directory
   * @param {string} path - Path to remove
   * @returns {Promise<void>}
   */
  async Remove(path) {
    if (this.state !== SNES_ATTACHED || !this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return null;
    }

    try {
      const request = {
        Opcode: 'Remove',
        Space: 'SNES',
        Flags: null,
        Operands: [path]
      };

      this.socket.send(JSON.stringify(request));
    } catch (error) {
      if (this.socket) {
        this.socket.close();
        this.socket = null;
      }
      this.state = SNES_DISCONNECTED;
      throw error;
    }
  }

  // ========================================
  // Savestate Management
  // ========================================

  /**
   * Check if savestate support is available (ROM must be patched)
   * @returns {Promise<boolean>} True if savestate support detected
   */
  async CheckSavestateSupport() {
    try {
      // Try to read interface address
      const interfaceData = await this.GetAddress(this.savestateInterfaceAddress, 2);
      // If we can read it without error, support may be present
      // Full verification would require checking for specific patterns
      return interfaceData !== null;
    } catch (error) {
      return false;
    }
  }

  /**
   * Wait for safe state (both saveState and loadState flags are 0)
   * @param {number} timeoutMs - Timeout in milliseconds
   * @returns {Promise<boolean>} True if safe state reached
   */
  async WaitForSafeState(timeoutMs = 5000) {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeoutMs) {
      const flags = await this.GetAddress(this.savestateInterfaceAddress, 2);
      if (flags[0] === 0 && flags[1] === 0) {
        return true;
      }
      await this._sleep(30);  // Poll every 30ms
    }
    
    throw new Error('Timeout waiting for safe state');
  }

  /**
   * Save state to memory (reads 320KB savestate data)
   * @param {boolean} trigger - If true, triggers save via interface; if false, reads existing data
   * @returns {Promise<Buffer>} 320KB savestate data
   */
  async SaveStateToMemory(trigger = true) {
    try {
      console.log('[usb2snesTypeA] Saving state...');
      
      // Wait for safe state
      await this.WaitForSafeState(5000);
      
      if (trigger) {
        // Trigger save by writing 1 to saveState flag
        await this.PutAddress([[this.savestateInterfaceAddress, Buffer.from([1, 0])]]);
        
        // Wait for save to complete (flag returns to 0)
        await this._sleep(100);  // Small delay for save to start
        await this.WaitForSafeState(10000);  // Wait up to 10s for save to complete
      }
      
      // Read savestate data (320KB)
      console.log('[usb2snesTypeA] Reading savestate data (320KB)...');
      const savestateData = await this.GetAddress(this.savestateDataAddress, SAVESTATE_SIZE);
      
      if (!savestateData || savestateData.length !== SAVESTATE_SIZE) {
        throw new Error(`Invalid savestate data size: ${savestateData?.length || 0} bytes`);
      }
      
      console.log('[usb2snesTypeA] Savestate captured successfully');
      return savestateData;
    } catch (error) {
      console.error('[usb2snesTypeA] SaveStateToMemory error:', error);
      throw error;
    }
  }

  /**
   * Load state from memory (writes 320KB savestate data and triggers load)
   * @param {Buffer} savestateData - 320KB savestate data
   * @returns {Promise<boolean>} Success status
   */
  async LoadStateFromMemory(savestateData) {
    try {
      if (!savestateData || savestateData.length !== SAVESTATE_SIZE) {
        throw new Error(`Invalid savestate data size: ${savestateData?.length || 0} bytes (expected ${SAVESTATE_SIZE})`);
      }
      
      console.log('[usb2snesTypeA] Loading state...');
      
      // Wait for safe state
      await this.WaitForSafeState(5000);
      
      // Write savestate data to memory (320KB)
      console.log('[usb2snesTypeA] Writing savestate data (320KB)...');
      await this.PutAddress([[this.savestateDataAddress, savestateData]]);
      
      // Trigger load by writing 1 to loadState flag
      await this.PutAddress([[this.savestateInterfaceAddress + 1, Buffer.from([1])]]);
      
      // Wait for load to complete
      await this._sleep(100);
      await this.WaitForSafeState(10000);
      
      console.log('[usb2snesTypeA] Savestate loaded successfully');
      return true;
    } catch (error) {
      console.error('[usb2snesTypeA] LoadStateFromMemory error:', error);
      throw error;
    }
  }

  /**
   * Set firmware version and update savestate interface address
   * Should be called after connecting and getting Info()
   * @param {string} firmwareVersion - Firmware version string (e.g., "11.0")
   */
  setFirmwareVersion(firmwareVersion) {
    this.firmwareVersion = firmwareVersion;
    
    // Parse version number
    const versionMatch = firmwareVersion.match(/(\d+)/);
    if (versionMatch) {
      const majorVersion = parseInt(versionMatch[1]);
      if (majorVersion >= 11) {
        this.savestateInterfaceAddress = SAVESTATE_INTERFACE_ADDRESS_NEW;
        console.log('[usb2snesTypeA] Using new savestate interface address (firmware 11+)');
      } else {
        this.savestateInterfaceAddress = SAVESTATE_INTERFACE_ADDRESS_OLD;
        console.log('[usb2snesTypeA] Using old savestate interface address (firmware < 11)');
      }
    }
  }

  // ========================================
  // Memory Watching System
  // ========================================

  /**
   * Create a memory watcher for multiple addresses
   * Returns an object with start/stop/getValues methods
   * 
   * @param {Array<[number, number]>} addresses - Array of [address, size] pairs
   * @param {number} pollRate - Poll rate in milliseconds (default: 100ms = 10Hz)
   * @param {Function} onChange - Callback(changes) when values change, changes = [{index, address, oldValue, newValue}]
   * @returns {Object} Watcher object with {start(), stop(), getValues(), isRunning}
   */
  createMemoryWatcher(addresses, pollRate = 100, onChange = null) {
    let intervalId = null;
    let previousValues = null;
    let isRunning = false;
    
    const watcher = {
      start: async () => {
        if (isRunning) {
          console.warn('[MemoryWatcher] Already running');
          return;
        }
        
        console.log(`[MemoryWatcher] Starting watcher (${addresses.length} addresses, ${pollRate}ms poll rate)`);
        isRunning = true;
        
        // Initial read
        previousValues = await this.GetAddresses(addresses);
        
        // Start polling
        intervalId = setInterval(async () => {
          try {
            const currentValues = await this.GetAddresses(addresses);
            
            // Detect changes
            const changes = [];
            for (let i = 0; i < currentValues.length; i++) {
              if (!previousValues[i].equals(currentValues[i])) {
                changes.push({
                  index: i,
                  address: addresses[i][0],
                  size: addresses[i][1],
                  oldValue: Buffer.from(previousValues[i]),
                  newValue: Buffer.from(currentValues[i])
                });
              }
            }
            
            // Call onChange callback if changes detected
            if (changes.length > 0 && onChange) {
              onChange(changes);
            }
            
            previousValues = currentValues;
          } catch (error) {
            console.error('[MemoryWatcher] Poll error:', error);
            // Continue watching despite errors
          }
        }, pollRate);
      },
      
      stop: () => {
        if (!isRunning) {
          return;
        }
        
        console.log('[MemoryWatcher] Stopping watcher');
        if (intervalId) {
          clearInterval(intervalId);
          intervalId = null;
        }
        isRunning = false;
      },
      
      getValues: () => {
        return previousValues ? previousValues.map(buf => Buffer.from(buf)) : null;
      },
      
      get isRunning() {
        return isRunning;
      }
    };
    
    return watcher;
  }

  /**
   * Watch single address for specific value
   * Resolves when target value is detected or timeout occurs
   * 
   * @param {number} address - Memory address
   * @param {number} size - Number of bytes
   * @param {Buffer|number|Function} targetValue - Value to watch for, or predicate function(buffer)
   * @param {number} timeoutMs - Timeout in milliseconds (0 = no timeout)
   * @param {number} pollRate - Poll rate in milliseconds
   * @returns {Promise<Buffer>} The value when condition is met
   */
  async watchForValue(address, size, targetValue, timeoutMs = 30000, pollRate = 100) {
    const startTime = Date.now();
    
    // Convert number to Buffer if needed
    let checkFunc;
    if (typeof targetValue === 'function') {
      checkFunc = targetValue;
    } else if (typeof targetValue === 'number') {
      checkFunc = (buf) => buf[0] === targetValue;
    } else if (Buffer.isBuffer(targetValue)) {
      checkFunc = (buf) => buf.equals(targetValue);
    } else {
      throw new Error('targetValue must be Buffer, number, or function');
    }
    
    while (true) {
      // Check timeout
      if (timeoutMs > 0 && Date.now() - startTime > timeoutMs) {
        throw new Error('Watch timeout');
      }
      
      // Read current value
      const currentValue = await this.GetAddress(address, size);
      
      // Check condition
      if (checkFunc(currentValue)) {
        return currentValue;
      }
      
      // Wait before next poll
      await this._sleep(pollRate);
    }
  }

  /**
   * Watch multiple addresses until all conditions are met
   * 
   * @param {Array<{address, size, value}>} conditions - Array of conditions
   * @param {number} timeoutMs - Timeout in milliseconds
   * @param {number} pollRate - Poll rate in milliseconds
   * @returns {Promise<Array<Buffer>>} Values when all conditions met
   */
  async watchForConditions(conditions, timeoutMs = 30000, pollRate = 100) {
    const startTime = Date.now();
    const addresses = conditions.map(c => [c.address, c.size]);
    
    // Build check functions
    const checkFuncs = conditions.map(c => {
      if (typeof c.value === 'function') {
        return c.value;
      } else if (typeof c.value === 'number') {
        return (buf) => buf[0] === c.value;
      } else if (Buffer.isBuffer(c.value)) {
        return (buf) => buf.equals(c.value);
      } else {
        throw new Error('condition.value must be Buffer, number, or function');
      }
    });
    
    while (true) {
      // Check timeout
      if (timeoutMs > 0 && Date.now() - startTime > timeoutMs) {
        throw new Error('Watch timeout - not all conditions met');
      }
      
      // Read all addresses
      const values = await this.GetAddresses(addresses);
      
      // Check all conditions
      const allMet = values.every((val, i) => checkFuncs[i](val));
      
      if (allMet) {
        return values;
      }
      
      // Wait before next poll
      await this._sleep(pollRate);
    }
  }

  // ========================================
  // Helper Methods
  // ========================================

  /**
   * Wait for JSON response with timeout
   * @private
   */
  async _waitForResponse(timeout) {
    const startTime = Date.now();
    while (this.recvQueue.length === 0) {
      if (Date.now() - startTime > timeout) {
        this.consecutiveTimeouts++;
        console.warn(`[usb2snesTypeA] Response timeout (${this.consecutiveTimeouts} consecutive)`);
        
        // Detect hung WebSocket - too many consecutive timeouts
        if (this.consecutiveTimeouts >= this.maxConsecutiveTimeouts) {
          console.error(`[usb2snesTypeA] WebSocket appears hung after ${this.consecutiveTimeouts} timeouts`);
          throw new Error('WebSocket hung - too many consecutive timeouts');
        }
        
        throw new Error('Response timeout');
      }
      await this._sleep(10);
    }
    
    // Got response - reset timeout counter
    this.consecutiveTimeouts = 0;
    
    const msg = this.recvQueue.shift();
    // Handle both Buffer and string messages
    const textData = Buffer.isBuffer(msg) ? msg.toString('utf8') : (typeof msg === 'string' ? msg : msg.toString());
    return JSON.parse(textData);
  }

  /**
   * Wait for binary response with timeout
   * @private
   */
  async _waitForBinaryResponse(timeout) {
    const startTime = Date.now();
    while (this.recvQueue.length === 0) {
      if (Date.now() - startTime > timeout) {
        return null;
      }
      await this._sleep(10);
    }
    const msg = this.recvQueue.shift();
    return Buffer.isBuffer(msg) ? msg : Buffer.from(msg);
  }

  /**
   * Get list item safely
   * @private
   */
  _listItem(list, index) {
    try {
      return list[index] || null;
    } catch {
      return null;
    }
  }

  /**
   * Sleep helper
   * @private
   */
  async _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = Usb2snesTypeA;

