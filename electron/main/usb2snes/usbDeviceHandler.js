const { SerialPort } = require('serialport');
const usb = require('usb');
const { spawn } = require('child_process');
const util = require('util');
const exec = util.promisify(require('child_process').exec);
const fs = require('fs');

// Import raw file descriptor implementation for Linux
let rawSerialPort;
if (process.platform === 'linux') {
  try {
    rawSerialPort = require('./usbDeviceHandlerRaw');
  } catch (err) {
    console.warn(`[UsbDeviceHandler] Could not load raw file descriptor module: ${err.message}`);
    rawSerialPort = null;
  }
}

/**
 * USB Device Handler for SD2SNES/FXPak Pro
 * 
 * Implements the binary USB protocol as defined in the C# reference implementation.
 * Protocol uses 512-byte binary packets with "USBA" magic header.
 * Serial port configuration: 9600 baud, 8N1, DTR enabled
 */
class UsbDeviceHandler {
  constructor(useDummy = false) {
    this.device = null;
    this.port = null;
    this.isOpen = false;
    this.commandLock = false;
    this.responseTimeout = 5000; // 5 seconds
    this.useDummy = useDummy;
    this.responseBuffer = Buffer.alloc(0);
    this._readCheckInterval = null; // Periodic read check interval (fallback if events don't fire)
    this._lastReadCheckLog = null; // Timestamp of last periodic read check log
    this._lastReadErrorLog = null; // Timestamp of last read error log
    this.pendingResponse = null;
    this.dataBuffer = Buffer.alloc(0);
    this.pendingDataSize = 0;
    
    // Protocol opcode enums (from usbint_server_opcode_e.cs)
    this.OPCODES = {
      GET: 0,
      PUT: 1,
      VGET: 2,
      VPUT: 3,
      LS: 4,
      MKDIR: 5,
      RM: 6,
      MV: 7,
      RESET: 8,
      BOOT: 9,
      POWER_CYCLE: 10,
      INFO: 11,
      MENU_RESET: 12,
      STREAM: 13,
      TIME: 14,
      RESPONSE: 15
    };
    
    // Protocol space enums (from usbint_server_space_e.cs)
    this.SPACES = {
      FILE: 0,
      SNES: 1,
      MSU: 2,
      CMD: 3,
      CONFIG: 4
    };
    
    // Protocol flags (from usbint_server_flags_e.cs)
    this.FLAGS = {
      NONE: 0,
      SKIPRESET: 1,
      ONLYRESET: 2,
      CLRX: 4,
      SETX: 8,
      STREAM_BURST: 16,
      NORESP: 64,
      DATA64B: 128
    };
    
    // If using dummy device, use dummy handler
    if (this.useDummy) {
      const DummyUsbDevice = require('./dummyUsbDevice');
      this.dummyDevice = new DummyUsbDevice();
    }
  }

  /**
   * Find and open the SD2SNES/FXPak Pro device
   * @param {Object} deviceInfo - Device information from scan
   * @returns {Promise<boolean>} Success status
   */
  async openDevice(deviceInfo) {
    try {
      await this.closeDevice();
      this.device = deviceInfo;

      // Use dummy device if configured
      if (this.useDummy && this.dummyDevice) {
        await this.dummyDevice.open();
        this.isOpen = true;
        console.log('[UsbDeviceHandler] Opened dummy USB device');
        return true;
      }

      // On Linux, try raw file descriptor approach first (more reliable)
      // Falls back to serialport library if raw FD fails
      if (process.platform === 'linux') {
        if (rawSerialPort) {
          try {
            return await this._openRawFileDescriptor(deviceInfo);
          } catch (rawError) {
            console.warn(`[UsbDeviceHandler] Raw file descriptor approach failed: ${rawError.message}`);
            console.warn(`[UsbDeviceHandler] Falling back to serialport library...`);
            return await this._openSerialPort(deviceInfo);
          }
        } else {
          console.log(`[UsbDeviceHandler] Raw FD module not available, using serialport library...`);
          return await this._openSerialPort(deviceInfo);
        }
      } else if (process.platform === 'win32') {
        return await this._openWindowsDevice(deviceInfo);
      } else if (process.platform === 'darwin') {
        return await this._openMacDevice(deviceInfo);
      } else {
        throw new Error(`Unsupported platform: ${process.platform}`);
      }
    } catch (error) {
      console.error('[UsbDeviceHandler] Error opening device:', error);
      throw error;
    }
  }

  /**
   * Configure serial port with stty (Linux-specific, matching QUSB2Snes)
   * @param {string} portPath - Serial port path (e.g., /dev/ttyACM0)
   * @private
   */
  /**
   * Open serial port using raw file descriptor approach (Linux only)
   * This is more reliable than the serialport library on Linux
   * @private
   */
  async _openRawFileDescriptor(deviceInfo) {
    // Try common serial port paths
    const possiblePorts = deviceInfo.serialPort ? [deviceInfo.serialPort] : (
      deviceInfo.possiblePorts || [
        '/dev/ttyACM0',
        '/dev/ttyACM1',
        '/dev/ttyUSB0',
        '/dev/ttyUSB1'
      ]
    );
    
    let lastError = null;
    
    for (const portPath of possiblePorts) {
      try {
        // Check if port exists
        if (!fs.existsSync(portPath)) {
          console.log(`[UsbDeviceHandler] Port ${portPath} does not exist, trying next...`);
          continue;
        }
        
        // Open raw file descriptor
        const port = await rawSerialPort.openRawSerialPort(portPath, 9600);
        
        this.port = port;
        this.isOpen = true;
        this.useRawFD = true;
        
        console.log(`[UsbDeviceHandler] Successfully opened raw file descriptor: ${portPath}`);
        
        // CRITICAL: For raw FD, we do NOT:
        // - Set up event listeners (those are for serialport library)
        // - Start periodic read check (that uses serialport.read() which won't work)
        // - Clear buffers via port.read() (that's serialport-specific)
        // We ONLY use the raw FD read methods
        
        // Wait for port to stabilize
        await new Promise(resolve => setTimeout(resolve, 500));
        
        console.log(`[UsbDeviceHandler] Raw file descriptor ready - using direct readAsync() only`);
        
        return true;
      } catch (error) {
        console.warn(`[UsbDeviceHandler] Failed to open ${portPath}: ${error.message}`);
        lastError = error;
        continue;
      }
    }
    
    // No port worked
    if (lastError) {
      throw new Error(`Failed to open any serial port: ${lastError.message}`);
    } else {
      throw new Error('No serial ports available');
    }
  }

  async _configureSerialPortStty(portPath) {
    if (process.platform !== 'linux') {
      return; // Only needed on Linux
    }
    
    try {
      // QUSB2Snes uses this exact stty command to configure the port
      // This sets termios flags that the serialport library might not set correctly
      const sttyCommand = `stty -F ${portPath} 0:0:cbd:0:3:1c:7f:15:4:5:40:0:11:13:1a:0:12:f:17:16:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0`;
      console.log(`[UsbDeviceHandler] Configuring serial port with stty: ${sttyCommand}`);
      
      const { stdout, stderr } = await exec(sttyCommand);
      if (stderr && !stderr.includes('speed')) {
        console.warn(`[UsbDeviceHandler] stty warning: ${stderr}`);
      }
      console.log(`[UsbDeviceHandler] Serial port configured successfully with stty`);
    } catch (error) {
      console.warn(`[UsbDeviceHandler] Failed to configure serial port with stty: ${error.message}`);
      console.warn(`[UsbDeviceHandler] Continuing anyway - serialport library may still work`);
      // Don't fail - try opening anyway, serialport might work without stty
    }
  }

  /**
   * Open device via serial port (Linux/macOS)
   * @private
   */
  async _openSerialPort(deviceInfo) {
    return new Promise((resolve, reject) => {
      try {
        // Try common serial port paths
        const possiblePorts = deviceInfo.serialPort ? [deviceInfo.serialPort] : (
          deviceInfo.possiblePorts || [
            '/dev/ttyACM0',
            '/dev/ttyACM1',
            '/dev/ttyACM2',
            '/dev/ttyUSB0',
            '/dev/ttyUSB1',
            '/dev/ttyUSB2'
          ]
        );

        let openedPort = null;
        let attemptCount = 0;
        
        const tryNextPort = () => {
          if (attemptCount >= possiblePorts.length) {
            reject(new Error('Failed to open any serial port. Is the device connected?'));
            return;
          }
          
          const portPath = possiblePorts[attemptCount++];
          
          // Configure serial port with stty before opening (Linux-specific, matches QUSB2Snes)
          // Note: If stty fails, we still try to open the port (serialport library might work)
          this._configureSerialPortStty(portPath).catch((sttyError) => {
            // stty failed, but continue anyway - serialport might work
            console.warn(`[UsbDeviceHandler] stty configuration failed, continuing anyway: ${sttyError.message}`);
          }).finally(() => {
            // Continue with port opening after stty configuration (success or failure)
            try {
              // Serial port configuration from C# reference: 9600 baud, 8N1, DTR enabled
              // CRITICAL: On Linux, we've already applied stty configuration
              // The serialport library should match those settings
              const port = new SerialPort({
              path: portPath,
              baudRate: 9600, // CRITICAL: C# uses 9600, not 921600!
              dataBits: 8,
              stopBits: 1,
              parity: 'none',
              autoOpen: false,
              // DTR/RTS control - may not be supported on all Linux systems
              // Will fall back to RESET opcode if DTR control fails
              dtr: true, // DTR enabled as per C# reference (may not work on all systems)
              rts: false,
              // Flow control - match C# reference: Handshake.None = no hardware flow control
              hupcl: false, // Don't hang up on close
              // Explicitly disable hardware flow control (matching C# Handshake.None)
              xon: false,
              xoff: false,
              xany: false,
              // CRITICAL: Disable any buffering that might interfere with reading
              // Set read timeout to match C# ReadTimeout = 5000
              // Note: serialport library doesn't directly expose ReadTimeout/WriteTimeout
              // but we can use low-level options if available
              highWaterMark: 512 // Buffer size for reading (match packet size)
            });

            port.open((err) => {
              if (err) {
                // Try next port
                tryNextPort();
                return;
              }

              // Successfully opened
              openedPort = port;
              this.port = port;
              
              // CRITICAL: Set up multiple data reception methods
              // The serialport library might not fire events properly on Linux
              // So we use both event-based AND polling-based reading
              
              // Method 1: Event-based reading (preferred if it works)
              port.on('data', (data) => {
                console.log(`[UsbDeviceHandler] Serial port 'data' event fired: ${data.length} bytes`);
                this._handleIncomingData(data);
              });
              
              // Method 2: Readable event (backup)
              port.on('readable', () => {
                console.log(`[UsbDeviceHandler] Serial port 'readable' event fired`);
                // Try to read available data
                const data = port.read();
                if (data) {
                  console.log(`[UsbDeviceHandler] Read ${data.length} bytes via 'readable' event`);
                  this._handleIncomingData(data);
                }
              });
              
              // Method 3: Explicitly enable reading (some serialport versions need this)
              // Try to set the port into continuous read mode if available
              try {
                // Some serialport versions expose this
                if (port.set && typeof port.set === 'function') {
                  // Try to ensure reading is enabled
                  console.log(`[UsbDeviceHandler] Attempting to enable explicit reading mode`);
                }
              } catch (readModeError) {
                console.warn(`[UsbDeviceHandler] Could not set explicit read mode: ${readModeError.message}`);
              }
              
              port.on('error', (err) => {
                console.error('[UsbDeviceHandler] Serial port error:', err);
                console.error('[UsbDeviceHandler] Error details:', err.message, err.stack);
                this.isOpen = false;
              });

              port.on('close', () => {
                console.log('[UsbDeviceHandler] Serial port closed');
                this.isOpen = false;
              });
              
              // Verify event listeners are set up
              console.log(`[UsbDeviceHandler] Event listeners registered:`);
              console.log(`[UsbDeviceHandler]   - 'data': ${port.listenerCount('data')} listener(s)`);
              console.log(`[UsbDeviceHandler]   - 'readable': ${port.listenerCount('readable')} listener(s)`);
              console.log(`[UsbDeviceHandler]   - 'error': ${port.listenerCount('error')} listener(s)`);
              console.log(`[UsbDeviceHandler]   - 'close': ${port.listenerCount('close')} listener(s)`);

              this.isOpen = true;
              console.log(`[UsbDeviceHandler] Opened serial port: ${portPath} at 9600 baud`);
              console.log(`[UsbDeviceHandler] Serial port settings: baudRate=${port.baudRate}, dataBits=${port.dataBits}, stopBits=${port.stopBits}, parity=${port.parity}`);
              console.log(`[UsbDeviceHandler] Serial port options: autoOpen=${port.autoOpen}, dtr=${port.dtr}, rts=${port.rts}`);
              
              // CRITICAL: Re-run stty AFTER opening the port
              // The serialport library might reset termios flags when it opens the port
              // So we need to re-apply stty configuration after opening
              console.log(`[UsbDeviceHandler] Re-applying stty configuration after port open...`);
              this._configureSerialPortStty(portPath).then(async () => {
                console.log(`[UsbDeviceHandler] stty configuration re-applied after port open`);
                
                // CRITICAL: Clear input buffer after stty (matching C# DiscardInBuffer)
                // This ensures we start with a clean state and can receive responses
                try {
                  // Clear our internal buffers
                  this.responseBuffer = Buffer.alloc(0);
                  this.dataBuffer = Buffer.alloc(0);
                  
                  // Try to read and discard any stale data from hardware buffer
                  // This mimics C# DiscardInBuffer() behavior
                  let staleDataCleared = 0;
                  for (let i = 0; i < 10; i++) {
                    if (port.readable) {
                      const stale = port.read();
                      if (stale && stale.length > 0) {
                        staleDataCleared += stale.length;
                        console.log(`[UsbDeviceHandler] Cleared ${stale.length} bytes of stale data (total: ${staleDataCleared} bytes)`);
                      } else {
                        break; // No more stale data
                      }
                    }
                    // Small delay to let hardware buffer fill if needed
                    await new Promise(resolve => setTimeout(resolve, 10));
                  }
                  
                  if (staleDataCleared > 0) {
                    console.log(`[UsbDeviceHandler] Cleared ${staleDataCleared} total bytes of stale data from input buffer`);
                  } else {
                    console.log(`[UsbDeviceHandler] Input buffer is clean (no stale data)`);
                  }
                } catch (clearError) {
                  console.warn(`[UsbDeviceHandler] Input buffer clear failed: ${clearError.message}`);
                }
                
                // Verify data handler is set up
                console.log(`[UsbDeviceHandler] Data handler listeners: ${port.listenerCount('data')}`);
                
                // Wait a moment for the port to stabilize after stty re-configuration
                // Some devices need time after opening before accepting commands
                setTimeout(() => {
                  console.log(`[UsbDeviceHandler] Serial port ready for commands`);
                  console.log(`[UsbDeviceHandler] Port is open: ${port.isOpen}, readable: ${port.readable}, writable: ${port.writable}`);
                  
                  // Try to read any pending data (device might send init data)
                  if (port.readable) {
                    const initData = port.read();
                    if (initData) {
                      console.log(`[UsbDeviceHandler] Found ${initData.length} bytes of pending data on port open - handling now`);
                      this._handleIncomingData(initData);
                    } else {
                      console.log(`[UsbDeviceHandler] No pending data on port open`);
                    }
                  }
                  
                  // Set up periodic read check as fallback if events don't fire
                  this._startPeriodicReadCheck();
                  
                  resolve(true);
                }, 500); // Increased to 500ms after stty re-configuration for better stability
              }).catch((sttyError) => {
                console.warn(`[UsbDeviceHandler] Failed to re-apply stty after port open: ${sttyError.message}`);
                // Continue anyway - might still work
                console.log(`[UsbDeviceHandler] Data handler listeners: ${port.listenerCount('data')}`);
                
                setTimeout(() => {
                  console.log(`[UsbDeviceHandler] Serial port ready for commands`);
                  console.log(`[UsbDeviceHandler] Port is open: ${port.isOpen}, readable: ${port.readable}, writable: ${port.writable}`);
                  
                  if (port.readable) {
                    const initData = port.read();
                    if (initData) {
                      console.log(`[UsbDeviceHandler] Found ${initData.length} bytes of pending data on port open - handling now`);
                      this._handleIncomingData(initData);
                    } else {
                      console.log(`[UsbDeviceHandler] No pending data on port open`);
                    }
                  }
                  
                  this._startPeriodicReadCheck();
                  
                  resolve(true);
                }, 500);
              });
            });
            } catch (portError) {
              // Try next port
              console.error(`[UsbDeviceHandler] Error creating serial port: ${portError.message}`);
              tryNextPort();
            }
          });
        };
        
        tryNextPort();
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Start periodic read check as fallback if events don't fire
   * CRITICAL: NOT USED for raw file descriptor approach - we use direct readAsync() instead
   * @private
   */
  _startPeriodicReadCheck() {
    // CRITICAL: Don't start periodic read check for raw FD - it uses serialport.read() which won't work
    // and would interfere with our raw FD reads
    if (this.useRawFD) {
      console.log(`[UsbDeviceHandler] Skipping periodic read check - using raw FD direct reads instead`);
      return;
    }
    
    if (!this.isOpen || !this.port) {
      console.warn(`[UsbDeviceHandler] Cannot start periodic read check - port not open`);
      return;
    }
    
    console.log(`[UsbDeviceHandler] Starting periodic read check (every 100ms as fallback)`);
    
    // Stop any existing interval first
    if (this._readCheckInterval) {
      clearInterval(this._readCheckInterval);
      this._readCheckInterval = null;
    }
    
    // Check every 100ms for incoming data (fallback if events don't fire)
    this._readCheckInterval = setInterval(() => {
      if (!this.isOpen || !this.port) {
        if (this._readCheckInterval) {
          clearInterval(this._readCheckInterval);
          this._readCheckInterval = null;
        }
        return;
      }
      
      try {
        if (this.port.readable) {
          const data = this.port.read();
          if (data && data.length > 0) {
            console.log(`[UsbDeviceHandler] *** PERIODIC READ CHECK: Found ${data.length} bytes ***`);
            this._handleIncomingData(data);
          }
        } else {
          // Log occasionally that we're checking but port isn't readable
          const now = Date.now();
          if (!this._lastReadCheckLog || (now - this._lastReadCheckLog) > 5000) {
            console.log(`[UsbDeviceHandler] Periodic read check: port.readable=${this.port.readable}, port.isOpen=${this.port.isOpen}`);
            this._lastReadCheckLog = now;
          }
        }
      } catch (err) {
        // Log read errors occasionally
        const now = Date.now();
        if (!this._lastReadErrorLog || (now - this._lastReadErrorLog) > 5000) {
          console.warn(`[UsbDeviceHandler] Periodic read check error: ${err.message}`);
          this._lastReadErrorLog = now;
        }
      }
    }, 100);
  }

  /**
   * Handle incoming data from serial port
   * @private
   */
  _handleIncomingData(data) {
    // CRITICAL: Log ALL incoming data for debugging
    console.log(`[UsbDeviceHandler] *** RECEIVED ${data.length} bytes from serial port ***`);
    console.log(`[UsbDeviceHandler] Raw data (first 64 bytes hex): ${data.slice(0, Math.min(64, data.length)).toString('hex')}`);
    console.log(`[UsbDeviceHandler] Raw data (first 64 bytes ascii): ${data.slice(0, Math.min(64, data.length)).toString('ascii').replace(/[^\x20-\x7E]/g, '.')}`);
    
    // Accumulate data in buffer
    this.responseBuffer = Buffer.concat([this.responseBuffer, data]);
    
    console.log(`[UsbDeviceHandler] Buffer size after accumulation: ${this.responseBuffer.length} bytes`);
    
    // Check for complete packet (512 bytes)
    while (this.responseBuffer.length >= 512) {
      const packet = this.responseBuffer.slice(0, 512);
      this.responseBuffer = this.responseBuffer.slice(512);
      
      // Verify response packet magic: "USBA" (bytes 0-3)
      const magic = packet[0] === 0x55 && packet[1] === 0x53 && 
                    packet[2] === 0x42 && packet[3] === 0x41;
      
      if (magic) {
        console.log(`[UsbDeviceHandler] ✓ Valid packet received: opcode=${packet[4]}, space=${packet[5]}, flags=${packet[6]}`);
        // Valid packet - resolve pending promise if any
        if (this.pendingResponse) {
          const resolve = this.pendingResponse.resolve;
          this.pendingResponse = null;
          console.log(`[UsbDeviceHandler] Resolving pending response`);
          resolve(packet);
        } else {
          console.warn(`[UsbDeviceHandler] Received valid packet but no pending response`);
        }
      } else {
        console.warn(`[UsbDeviceHandler] ✗ Invalid packet magic: 0x${packet[0].toString(16).padStart(2, '0')} 0x${packet[1].toString(16).padStart(2, '0')} 0x${packet[2].toString(16).padStart(2, '0')} 0x${packet[3].toString(16).padStart(2, '0')}`);
        console.warn(`[UsbDeviceHandler] Expected: 0x55 0x53 0x42 0x41 (USBA)`);
        console.warn(`[UsbDeviceHandler] First 64 bytes (hex): ${packet.slice(0, 64).toString('hex')}`);
        console.warn(`[UsbDeviceHandler] First 64 bytes (ascii): ${packet.slice(0, 64).toString('ascii').replace(/[^\x20-\x7E]/g, '.')}`);
      }
    }
    
    // Check for pending data read
    if (this.pendingDataSize > 0 && this.responseBuffer.length > 0) {
      const needed = Math.min(this.pendingDataSize - this.dataBuffer.length, this.responseBuffer.length);
      this.dataBuffer = Buffer.concat([this.dataBuffer, this.responseBuffer.slice(0, needed)]);
      this.responseBuffer = this.responseBuffer.slice(needed);
      
      if (this.dataBuffer.length >= this.pendingDataSize) {
        const data = this.dataBuffer.slice(0, this.pendingDataSize);
        this.dataBuffer = Buffer.alloc(0);
        this.pendingDataSize = 0;
        
        if (this.pendingDataResolve) {
          const resolve = this.pendingDataResolve;
          this.pendingDataResolve = null;
          resolve(data);
        }
      }
    }
  }

  /**
   * Build a 512-byte binary packet for the device protocol
   * @param {number} opcode - Opcode enum value
   * @param {number} space - Space enum value
   * @param {number} flags - Flags enum value
   * @returns {Buffer} 512-byte packet
   */
  _buildPacket(opcode, space, flags) {
    const packet = Buffer.alloc(512); // 0x200 bytes
    
    // Magic header: "USBA" (bytes 0-3) - matching C# reference and QUSB2Snes
    packet[0] = 0x55; // 'U'
    packet[1] = 0x53; // 'S'
    packet[2] = 0x42; // 'B'
    packet[3] = 0x41; // 'A'
    
    // Byte 4: Opcode
    packet[4] = opcode;
    
    // Byte 5: Space
    packet[5] = space;
    
    // Byte 6: Flags
    packet[6] = flags;
    
    // Bytes 7-511: Reserved/unused (0) - buffer already zero-filled
    
    return packet;
  }

  /**
   * Send command packet and wait for response
   * @param {number} opcode - Opcode enum
   * @param {number} space - Space enum
   * @param {number} flags - Flags enum
   * @param {Array} args - Command arguments
   * @returns {Promise<Buffer>} Response packet
   */
  async _sendCommandPacket(opcode, space, flags, args) {
    if (!this.isOpen) {
      throw new Error('Device not open');
    }

    // Use dummy device if configured
    if (this.useDummy && this.dummyDevice) {
      return await this.dummyDevice.sendCommand(opcode, space, flags, args);
    }

    // Check if NORESP flag is set - if so, don't wait for response
    const noResponse = (flags & this.FLAGS.NORESP) !== 0;
    
    if (noResponse) {
      // For commands with NORESP flag (like RESET), send packet and return immediately
      console.log(`[UsbDeviceHandler] NORESP flag set (0x${flags.toString(16)}) - sending packet without waiting for response`);
      
      // Wait for command lock (but briefly, don't block long)
      let lockWaitCount = 0;
      while (this.commandLock && lockWaitCount < 50) {
        await new Promise(resolve => setTimeout(resolve, 10));
        lockWaitCount++;
      }
      if (this.commandLock) {
        console.warn(`[UsbDeviceHandler] Command lock still active after ${lockWaitCount * 10}ms, proceeding anyway for NORESP command`);
      }
      this.commandLock = true;

      try {
        const packet = this._buildCommandPacket(opcode, space, flags, args);
        
        // Send packet
        if (this.useRawFD && this.port && this.port.writeSync) {
          // Flush buffers before write (matching QUSB2Snes)
          if (this.port.flushBuffers) {
            try {
              this.port.flushBuffers();
            } catch (flushErr) {
              console.warn(`[UsbDeviceHandler] Buffer flush failed: ${flushErr.message}`);
            }
          }
          
          console.log(`[UsbDeviceHandler] Sending NORESP command packet (opcode ${opcode}) via raw FD...`);
          const bytesWritten = this.port.writeSync(packet, 0, packet.length);
          console.log(`[UsbDeviceHandler] ✓ NORESP command packet written: ${bytesWritten}/${packet.length} bytes`);
          
          // CRITICAL: QUSB2Snes does NOT call tcdrain() after write for RESET!
          // From strace: write(56, ...) = 512, then immediately moves on
          // tcdrain() can block indefinitely - we don't need it since the device processes
          // the RESET opcode immediately and doesn't send a response anyway (NORESP flag)
          console.log(`[UsbDeviceHandler] ✓ RESET packet written - device will process it (matching QUSB2Snes, no tcdrain)`);
          
          // Clear command lock immediately
          this.commandLock = false;
          
          // Return empty buffer (no response expected)
          return Buffer.alloc(512);
        } else if (this.port && this.port.write) {
          // Use serialport library
          return new Promise((resolve, reject) => {
            this.port.write(packet, (err) => {
              this.commandLock = false;
              if (err) {
                reject(err);
              } else {
                console.log(`[UsbDeviceHandler] ✓ NORESP command packet written via serialport`);
                // Return empty buffer (no response expected)
                resolve(Buffer.alloc(512));
              }
            });
          });
        } else {
          throw new Error('Port not available for writing');
        }
      } finally {
        // Lock already cleared above
      }
    }

    // Wait for command lock
    while (this.commandLock) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    this.commandLock = true;

    try {
      const packet = this._buildCommandPacket(opcode, space, flags, args);
      
      // Send packet and wait for response (normal case - no NORESP flag)
      return new Promise((resolve, reject) => {
        let timeoutId = null;
        let resolved = false; // Track if promise was resolved to prevent race conditions
        const timeout = setTimeout(() => {
          // Check if already resolved (race condition check)
          if (resolved) {
            console.log(`[UsbDeviceHandler] Timeout fired but already resolved - ignoring`);
            return;
          }
          console.error(`[UsbDeviceHandler] Command timeout for opcode ${opcode}, space ${space}`);
          console.error(`[UsbDeviceHandler] Command lock: ${this.commandLock}, pending response: ${!!this.pendingResponse}`);
          resolved = true;
          this.commandLock = false;
          this.pendingResponse = null;
          timeoutId = null;
          reject(new Error('Command timeout'));
        }, this.responseTimeout);
        timeoutId = timeout;

        // Store pending response resolver
        this.pendingResponse = { 
          resolve: (packet) => {
            // CRITICAL: Clear timeout BEFORE checking resolved flag to prevent race condition
            // If timeout fires between reading packet and calling resolve, clearTimeout is idempotent
            if (timeoutId) {
              clearTimeout(timeoutId);
              timeoutId = null;
            }
            
            // Check if already resolved (race condition check)
            if (resolved) {
              console.warn(`[UsbDeviceHandler] ⚠ Attempted to resolve but timeout already fired - ignoring (this should be rare)`);
              return;
            }
            resolved = true;
            this.commandLock = false;
            this.pendingResponse = null;
            console.log(`[UsbDeviceHandler] ✓ Resolving outer Promise with packet (opcode: ${packet[4]})`);
            resolve(packet);
          }, 
          reject: (err) => {
            // Check if already resolved (race condition check)
            if (resolved) {
              console.log(`[UsbDeviceHandler] Attempted to reject but already timed out - ignoring`);
              return;
            }
            resolved = true;
            if (timeoutId) {
              clearTimeout(timeoutId);
              timeoutId = null;
            }
            this.commandLock = false;
            this.pendingResponse = null;
            reject(err);
          }
        };

        // CRITICAL: Clear input buffer before sending command (matching C# DiscardInBuffer)
        // This ensures we don't have stale data interfering
        try {
          if (this.port.flush) {
            this.port.flush((flushErr) => {
              if (flushErr) {
                console.warn(`[UsbDeviceHandler] Flush error (continuing anyway): ${flushErr.message}`);
              } else {
                console.log(`[UsbDeviceHandler] Input buffer flushed before sending command`);
              }
            });
          }
        } catch (flushError) {
          console.warn(`[UsbDeviceHandler] Flush failed (continuing anyway): ${flushError.message}`);
        }
        
        // Clear our internal buffers before sending
        this.responseBuffer = Buffer.alloc(0);
        this.dataBuffer = Buffer.alloc(0);
        
        // Write command packet
        console.log(`[UsbDeviceHandler] ===== SENDING COMMAND PACKET =====`);
        console.log(`[UsbDeviceHandler] Opcode: ${opcode} (0x${opcode.toString(16).padStart(2, '0')}), Space: ${space} (0x${space.toString(16).padStart(2, '0')}), Flags: ${flags} (0x${flags.toString(16).padStart(2, '0')})`);
        console.log(`[UsbDeviceHandler] Packet length: ${packet.length} bytes (expected: 512)`);
        console.log(`[UsbDeviceHandler] Magic header (bytes 0-3): 0x${packet[0].toString(16).padStart(2, '0')} 0x${packet[1].toString(16).padStart(2, '0')} 0x${packet[2].toString(16).padStart(2, '0')} 0x${packet[3].toString(16).padStart(2, '0')} (expected: 0x55 0x53 0x42 0x41 = USBA)`);
        console.log(`[UsbDeviceHandler] Packet first 64 bytes (hex): ${packet.slice(0, 64).toString('hex')}`);
        console.log(`[UsbDeviceHandler] Packet first 64 bytes (ascii): ${packet.slice(0, 64).toString('ascii').replace(/[^\x20-\x7E]/g, '.')}`);
        console.log(`[UsbDeviceHandler] Full packet hex (first 256 bytes):`);
        for (let i = 0; i < Math.min(256, packet.length); i += 16) {
          const chunk = packet.slice(i, i + 16);
          const hexStr = Array.from(chunk).map(b => b.toString(16).padStart(2, '0')).join(' ');
          const asciiStr = chunk.toString('ascii').replace(/[^\x20-\x7E]/g, '.');
          console.log(`[UsbDeviceHandler]    ${i.toString(16).padStart(4, '0')}: ${hexStr} | ${asciiStr}`);
        }
        
        // Use raw file descriptor write if available, otherwise serialport library
        if (this.useRawFD && this.port && this.port.writeSync && this.port.readAsync) {
          try {
            // CRITICAL: QUSB2Snes flushes buffers BEFORE writing, not after!
            // From strace: ioctl(TCFLSH, TCIOFLUSH) happens BEFORE write()
            // Flushing after write would clear the command we just sent!
            if (this.port && this.port.flushBuffers) {
              try {
                this.port.flushBuffers();
                console.log(`[UsbDeviceHandler] ✓ Flushed buffers BEFORE write (matching QUSB2Snes)`);
              } catch (flushErr) {
                console.warn(`[UsbDeviceHandler] ⚠ Buffer flush failed: ${flushErr.message}`);
              }
            } else {
              console.warn(`[UsbDeviceHandler] ⚠ Cannot flush buffers - flushBuffers not available`);
            }
            
            console.log(`[UsbDeviceHandler] Writing ${packet.length} bytes via raw file descriptor (FD: ${this.port.fd}, path: ${this.port.path})...`);
            const bytesWritten = this.port.writeSync(packet, 0, packet.length);
            console.log(`[UsbDeviceHandler] ✓ writeSync completed: ${bytesWritten} bytes written (expected: ${packet.length})`);
            if (bytesWritten !== packet.length) {
              console.error(`[UsbDeviceHandler] ⚠ WARNING: Only ${bytesWritten}/${packet.length} bytes written!`);
            }
            
            // CRITICAL: QUSB2Snes does NOT call tcdrain() after write!
            // From strace: write(56, ...) = 512, then immediately poll() and read()
            // We should NOT drain output - it can block indefinitely if hardware flow control
            // isn't properly configured. Instead, just wait briefly then start reading.
            console.log(`[UsbDeviceHandler] Command packet written successfully (raw FD), waiting for response...`);
            
            // Use an async IIFE to handle delays and reading
            (async () => {
              try {
                // Wait briefly for device to receive command and start processing
                // C# reference uses ReadTimeout = 5000ms and reads synchronously, so device has time to respond
                // QUSB2Snes writes, then immediately starts polling for data (no tcdrain!)
                console.log(`[UsbDeviceHandler] Waiting 50ms after write for device to receive command...`);
                await new Promise(resolve => setTimeout(resolve, 50));
                
                // Start reading response immediately (matching QUSB2Snes behavior)
                // QUSB2Snes writes, then immediately uses poll() to wait for data
                console.log(`[UsbDeviceHandler] Starting read after write...`);
                
                // Read the full 512-byte response packet
                this._readRawResponsePacket(timeoutId, resolve, reject);
              } catch (readErr) {
                console.warn(`[UsbDeviceHandler] Read setup error: ${readErr.message}`);
                // Continue with read anyway
                this._readRawResponsePacket(timeoutId, resolve, reject);
              }
            })();
            
            // Note: Response will come via _readRawResponsePacket callback
            return; // Early return - response handling is in _readRawResponsePacket
          } catch (writeErr) {
            console.error(`[UsbDeviceHandler] Raw FD write error: ${writeErr.message}`);
            if (timeoutId) {
              clearTimeout(timeoutId);
              timeoutId = null;
            }
            this.commandLock = false;
            this.pendingResponse = null;
            reject(writeErr);
            return;
          }
        }
        
        // Fallback to serialport library approach
        this.port.write(packet, (err) => {
          if (err) {
            console.error(`[UsbDeviceHandler] Write error: ${err.message}`);
            if (timeoutId) {
              clearTimeout(timeoutId);
              timeoutId = null;
            }
            this.commandLock = false;
            this.pendingResponse = null;
            reject(err);
          } else {
            console.log(`[UsbDeviceHandler] Command packet written successfully, waiting for response...`);
            // Drain the write buffer to ensure data is sent
            this.port.drain((drainErr) => {
              if (drainErr) {
                console.error(`[UsbDeviceHandler] Drain error: ${drainErr.message}`);
              } else {
                console.log(`[UsbDeviceHandler] Write buffer drained, data should be sent`);
                
                // CRITICAL: After draining, actively try to read response using blocking-style approach
                // The C# reference uses blocking reads with timeout
                // Try to read immediately after drain completes
                console.log(`[UsbDeviceHandler] Starting blocking read attempt after drain...`);
                if (this.useRawFD) {
                  this._tryRawBlockingRead();
                } else {
                  this._tryBlockingRead();
                }
              }
            });
          }
        });
      });
    } finally {
      // Lock cleared in promise resolution/rejection
    }
  }

  /**
   * Read full 512-byte response packet using raw file descriptor
   * Matches C# behavior of reading immediately after write and accumulating bytes
   * @private
   */
  _readRawResponsePacket(timeoutId, resolve, reject) {
    if (!this.useRawFD || !this.port || !this.port.readAsync) {
      const err = new Error('Raw FD read not available');
      // Call pending response rejector if available
      if (this.pendingResponse && this.pendingResponse.reject) {
        this.pendingResponse.reject(err);
      } else {
        reject(err);
      }
      return;
    }
    
    const packetSize = 512;
    const responseBuffer = Buffer.alloc(packetSize);
    let bytesRead = 0;
    const startTime = Date.now();
    
    const readLoop = async () => {
      // Check timeout
      const elapsed = Date.now() - startTime;
      if (elapsed >= this.responseTimeout) {
        console.error(`[UsbDeviceHandler] ⚠ Read timeout: waited ${elapsed}ms, read ${bytesRead}/${packetSize} bytes`);
        // CRITICAL: Call the pending response rejector to clear timeout and reject outer Promise
        if (this.pendingResponse && this.pendingResponse.reject) {
          this.pendingResponse.reject(new Error(`Read timeout after ${this.responseTimeout}ms`));
        } else {
          // Fallback if pendingResponse structure changed
          clearTimeout(timeoutId);
          this.commandLock = false;
          this.pendingResponse = null;
          reject(new Error(`Read timeout after ${this.responseTimeout}ms`));
        }
        return;
      }
      
      try {
        // Read remaining bytes
        const remaining = packetSize - bytesRead;
        const readBuffer = Buffer.alloc(remaining);
        // CRITICAL: Use longer timeout for each read attempt to give device time to respond
        // The device might take longer than 1 second to start responding
        const readTimeout = Math.min(3000, this.responseTimeout - elapsed);
        
        // CRITICAL: Read in 128-byte chunks like QUSB2Snes does (not all at once)
        // QUSB2Snes reads 128 bytes at a time until it has 512 bytes total
        const chunkSize = Math.min(128, remaining);
        console.log(`[UsbDeviceHandler] Attempting to read ${chunkSize} bytes (chunk of ${remaining} remaining, already have ${bytesRead}/${packetSize}, timeout: ${readTimeout}ms)...`);
        
        const bytesReadNow = await this.port.readAsync(
          readBuffer, 
          0, 
          chunkSize, 
          readTimeout
        );
        
        if (bytesReadNow > 0) {
          // Copy into response buffer
          readBuffer.slice(0, bytesReadNow).copy(responseBuffer, bytesRead);
          bytesRead += bytesReadNow;
          
          console.log(`[UsbDeviceHandler] *** RAW FD READ: ${bytesReadNow} bytes (total: ${bytesRead}/${packetSize}) ***`);
          console.log(`[UsbDeviceHandler] Read data (hex, first 64 bytes): ${readBuffer.slice(0, Math.min(64, bytesReadNow)).toString('hex')}`);
          console.log(`[UsbDeviceHandler] Read data (ascii, first 64 bytes): ${readBuffer.slice(0, Math.min(64, bytesReadNow)).toString('ascii').replace(/[^\x20-\x7E]/g, '.')}`);
          
          // Check if we have a complete packet
          if (bytesRead >= packetSize) {
            // Complete packet received
            const packet = responseBuffer.slice(0, packetSize);
            console.log(`[UsbDeviceHandler] ✓ Complete 512-byte packet received via raw FD`);
            console.log(`[UsbDeviceHandler] Response packet first 64 bytes (hex): ${packet.slice(0, 64).toString('hex')}`);
            console.log(`[UsbDeviceHandler] Response packet first 64 bytes (ascii): ${packet.slice(0, 64).toString('ascii').replace(/[^\x20-\x7E]/g, '.')}`);
            
            // Verify response packet magic: "USBA" (bytes 0-3)
            const magic = packet[0] === 0x55 && packet[1] === 0x53 && 
                         packet[2] === 0x42 && packet[3] === 0x41;
            
            if (magic) {
              console.log(`[UsbDeviceHandler] ✓ Valid response packet magic: USBA`);
              console.log(`[UsbDeviceHandler] Response opcode: ${packet[4]}, space: ${packet[5]}, flags: ${packet[6]}`);
              // CRITICAL: Call the pending response resolver to clear timeout and resolve outer Promise
              console.log(`[UsbDeviceHandler] Calling this.pendingResponse.resolve(packet) - pendingResponse exists: ${!!this.pendingResponse}`);
              if (this.pendingResponse && this.pendingResponse.resolve) {
                console.log(`[UsbDeviceHandler] ✓ Calling pendingResponse.resolve() to resolve outer Promise and clear timeout`);
                this.pendingResponse.resolve(packet);
                console.log(`[UsbDeviceHandler] ✓ pendingResponse.resolve() called - Promise should be resolving now`);
              } else {
                console.warn(`[UsbDeviceHandler] ⚠ pendingResponse is null or missing resolve function - using fallback`);
                // Fallback if pendingResponse structure changed
                clearTimeout(timeoutId);
                this.commandLock = false;
                this.pendingResponse = null;
                resolve(packet);
              }
            } else {
              console.error(`[UsbDeviceHandler] ✗ Invalid packet magic: 0x${packet[0].toString(16).padStart(2, '0')} 0x${packet[1].toString(16).padStart(2, '0')} 0x${packet[2].toString(16).padStart(2, '0')} 0x${packet[3].toString(16).padStart(2, '0')}`);
              console.error(`[UsbDeviceHandler] Expected: 0x55 0x53 0x42 0x41 (USBA)`);
              // Continue reading to try to sync
              readLoop();
            }
          } else {
            // Continue reading to get full packet
            console.log(`[UsbDeviceHandler] Partial packet received: ${bytesRead}/${packetSize} bytes, continuing read...`);
            readLoop();
          }
        } else {
          // No data - retry immediately
          console.log(`[UsbDeviceHandler] Read returned 0 bytes (no data yet), retrying... (elapsed: ${Date.now() - startTime}ms)`);
          readLoop();
        }
      } catch (readErr) {
        if (readErr.message && readErr.message.includes('timeout')) {
          // Timeout on this read attempt, but check overall timeout
          const elapsed = Date.now() - startTime;
          if (elapsed < this.responseTimeout) {
            // Still time left, retry
            setTimeout(readLoop, 10);
          } else {
            // Overall timeout
            // CRITICAL: Call the pending response rejector to clear timeout and reject outer Promise
            if (this.pendingResponse && this.pendingResponse.reject) {
              this.pendingResponse.reject(new Error(`Read timeout after ${this.responseTimeout}ms`));
            } else {
              // Fallback if pendingResponse structure changed
              clearTimeout(timeoutId);
              this.commandLock = false;
              this.pendingResponse = null;
              reject(new Error(`Read timeout after ${this.responseTimeout}ms`));
            }
          }
        } else {
          // Other read error - call pending response rejector
          if (this.pendingResponse && this.pendingResponse.reject) {
            this.pendingResponse.reject(readErr);
          } else {
            // Fallback if pendingResponse structure changed
            clearTimeout(timeoutId);
            this.commandLock = false;
            this.pendingResponse = null;
            reject(readErr);
          }
        }
      }
    };
    
    // Start reading immediately
    readLoop();
  }

  /**
   * Try blocking read using raw file descriptor (if available)
   * @private
   */
  _tryRawBlockingRead() {
    if (!this.useRawFD || !this.port || !this.port.readAsync) {
      // Fall back to regular blocking read
      this._tryBlockingRead();
      return;
    }
    
    // Use raw file descriptor blocking read
    const startTime = Date.now();
    const timeoutMs = this.responseTimeout;
    const packetSize = 512;
    let timedOut = false;
    
    const readLoop = () => {
      if (timedOut) {
        return; // Already timed out
      }
      
      const elapsed = Date.now() - startTime;
      if (elapsed >= timeoutMs) {
        console.log(`[UsbDeviceHandler] Raw FD blocking read timeout after ${timeoutMs}ms`);
        timedOut = true;
        return;
      }
      
      try {
        // Try to read a chunk (up to packet size)
        const remainingTime = timeoutMs - elapsed;
        const readBuffer = Buffer.alloc(packetSize);
        
        // Use async read with timeout
        this.port.readAsync(readBuffer, 0, Math.min(packetSize, readBuffer.length), Math.min(remainingTime, 1000))
          .then((bytesRead) => {
            if (timedOut) return;
            
            if (bytesRead > 0) {
              const data = readBuffer.slice(0, bytesRead);
              console.log(`[UsbDeviceHandler] *** RAW FD BLOCKING READ: Found ${bytesRead} bytes ***`);
              this._handleIncomingData(data);
              
              // If we got a complete packet, we're done
              if (this.responseBuffer.length >= packetSize && this.pendingResponse) {
                console.log(`[UsbDeviceHandler] Complete packet received via raw FD blocking read`);
                timedOut = true; // Stop loop
                return;
              }
              
              // Continue reading if we got partial data
              readLoop();
            } else {
              // No data yet, retry
              readLoop();
            }
          })
          .catch((readErr) => {
            if (timedOut) return;
            
            if (readErr.message && readErr.message.includes('timeout')) {
              // Timeout is expected if no data yet
              const remainingTime = timeoutMs - (Date.now() - startTime);
              if (remainingTime > 0) {
                // Wait a bit and retry
                setTimeout(readLoop, 10);
              } else {
                timedOut = true;
              }
            } else {
              console.warn(`[UsbDeviceHandler] Raw FD read error: ${readErr.message}`);
              setTimeout(readLoop, 10);
            }
          });
      } catch (readErr) {
        if (timedOut) return;
        console.warn(`[UsbDeviceHandler] Raw FD read exception: ${readErr.message}`);
        setTimeout(readLoop, 10);
      }
    };
    
    // Start read loop
    readLoop();
  }

  /**
   * Try blocking-style read to get response immediately
   * This mimics the C# synchronous Read() approach
   * @private
   */
  _tryBlockingRead() {
    // Try to read available data immediately
    // Loop for a short time to read complete 512-byte packet
    let readAttempts = 0;
    const maxAttempts = 500; // Try for up to 5 seconds (500 * 10ms) - longer for slow device responses
    
    const readLoop = () => {
      if (readAttempts >= maxAttempts) {
        // Timeout - data will come via events if available
        console.log(`[UsbDeviceHandler] Blocking read attempts exhausted (${maxAttempts} attempts)`);
        return;
      }
      
      readAttempts++;
      
      try {
        if (this.port && this.port.isOpen && this.port.readable) {
          const data = this.port.read();
          if (data && data.length > 0) {
            console.log(`[UsbDeviceHandler] *** BLOCKING READ: Found ${data.length} bytes ***`);
            this._handleIncomingData(data);
            
            // If we got a complete packet, stop trying
            if (this.responseBuffer.length >= 512 && this.pendingResponse) {
              console.log(`[UsbDeviceHandler] Complete packet received via blocking read`);
              return;
            }
            
            // Continue reading if we got partial data
            // Device might send data in multiple chunks
            setTimeout(readLoop, 5); // Faster polling if we're getting data
            return;
          }
        }
        
        // Continue trying (no data yet)
        setTimeout(readLoop, 10); // Check every 10ms
      } catch (err) {
        // Log read errors occasionally
        if (readAttempts % 50 === 0) {
          console.warn(`[UsbDeviceHandler] Blocking read error (attempt ${readAttempts}): ${err.message}`);
        }
        setTimeout(readLoop, 10);
      }
    };
    
    // Start read loop immediately
    readLoop();
  }

  /**
   * Build command packet with proper operand encoding based on C# reference
   * @private
   */
  _buildCommandPacket(opcode, space, flags, args) {
    const packet = this._buildPacket(opcode, space, flags);
    
    // Encode operands based on opcode type (from C# Core.cs SendCommand)
    if (opcode === this.OPCODES.GET || opcode === this.OPCODES.PUT) {
      // GET/PUT: args[0] = address (uint), args[1] = size (uint)
      // From C# line 797: num3 = (uint) args[1] (size)
      // From C# line 831: num4 = (uint) args[0] (address)
      // Address at bytes 252-255 (big-endian) - from C# lines 862, 820, 679, 504
      if (args.length >= 1 && args[0] != null) {
        const address = typeof args[0] === 'number' ? args[0] : parseInt(args[0], 16);
        packet[252] = (address >> 24) & 0xFF;
        packet[253] = (address >> 16) & 0xFF;
        packet[254] = (address >> 8) & 0xFF;
        packet[255] = address & 0xFF;
      }
      
      // Size is used for data transfer, not encoded in packet for GET/PUT
      // GET: size determines how much data to read after response
      // PUT: size determines how much data follows the command packet
    } else if (opcode === this.OPCODES.LS || opcode === this.OPCODES.BOOT || 
               opcode === this.OPCODES.MKDIR || opcode === this.OPCODES.RM || 
               opcode === this.OPCODES.MV) {
      // String operand at bytes 8+ (first string)
      if (args[0]) {
        const path = String(args[0]);
        const pathBytes = Buffer.from(path, 'ascii');
        const len = Math.min(pathBytes.length, 247); // Max 247 bytes (8 to 255)
        pathBytes.copy(packet, 8, 0, len);
      }
      
      // For MV, second string at bytes 256+
      if (opcode === this.OPCODES.MV && args[1]) {
        const path2 = String(args[1]);
        const path2Bytes = Buffer.from(path2, 'ascii');
        const len = Math.min(path2Bytes.length, 255);
        path2Bytes.copy(packet, 256, 0, len);
      }
    } else if (opcode === this.OPCODES.INFO) {
      // INFO: No operands needed
    } else if (opcode === this.OPCODES.RESET || opcode === this.OPCODES.MENU_RESET || 
               opcode === this.OPCODES.POWER_CYCLE) {
      // RESET/MENU_RESET/POWER_CYCLE: No operands needed
    } else if (opcode === this.OPCODES.VGET || opcode === this.OPCODES.VPUT) {
      // VGET/VPUT: Multiple (address, size) pairs
      // Encoded at bytes 32+ as (size byte, address uint32) tuples
      let offset = 32;
      const numPairs = Math.min(Math.floor(args.length / 2), 8); // Max 8 pairs
      
      for (let i = 0; i < numPairs && offset < 256; i++) {
        const address = typeof args[i * 2] === 'number' ? args[i * 2] : parseInt(args[i * 2], 16);
        const size = typeof args[i * 2 + 1] === 'number' ? args[i * 2 + 1] : parseInt(args[i * 2 + 1], 16);
        
        packet[offset] = size & 0xFF;
        packet[offset + 1] = (address >> 24) & 0xFF;
        packet[offset + 2] = (address >> 16) & 0xFF;
        packet[offset + 3] = (address >> 8) & 0xFF;
        packet[offset + 4] = address & 0xFF;
        offset += 5;
      }
    }
    
    return packet;
  }

  /**
   * Read additional data after command response
   * @param {number} size - Number of bytes to read
   * @returns {Promise<Buffer>} Data buffer
   */
  async _readData(size) {
    if (this.useDummy && this.dummyDevice) {
      return await this.dummyDevice.readData(size);
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingDataSize = 0;
        this.dataBuffer = Buffer.alloc(0);
        this.pendingDataResolve = null;
        reject(new Error('Data read timeout'));
      }, this.responseTimeout * 2);

      this.pendingDataSize = size;
      this.dataBuffer = Buffer.alloc(0);
      this.pendingDataResolve = (data) => {
        clearTimeout(timeout);
        resolve(data);
      };

      // Check if we already have the data
      if (this.responseBuffer.length >= size) {
        const data = this.responseBuffer.slice(0, size);
        this.responseBuffer = this.responseBuffer.slice(size);
        this.pendingDataSize = 0;
        this.pendingDataResolve = null;
        clearTimeout(timeout);
        resolve(data);
      }
    });
  }

  /**
   * Execute Reset command on device (via DTR toggle)
   * @returns {Promise<boolean>} Success status
   */
  async reset() {
    try {
      if (this.useDummy && this.dummyDevice) {
        return await this.dummyDevice.reset();
      }

      if (!this.isOpen || !this.port) {
        throw new Error('Device not open');
      }
      
      console.log('[UsbDeviceHandler] Starting reset sequence...');
      
      // Clear any pending commands/locks first
      if (this.commandLock) {
        console.warn('[UsbDeviceHandler] Clearing stuck command lock before reset');
        this.commandLock = false;
        this.pendingResponse = null;
      }
      
      // CRITICAL: C# reference uses DTR toggle, NOT the RESET opcode!
      // From C# Core.cs line 232-236:
      //   public void Reset()
      //   {
      //     this._serial_port.DtrEnable = false;
      //     Thread.Sleep(500);
      //   }
      // QUSB2Snes uses ioctl(TIOCMBIC, TIOCM_DTR) which is the same as setting DTR to false
      // We should use DTR toggle directly, matching the C# behavior exactly
      
      // CRITICAL: Reset the SNES console, NOT the USB connection
      // This uses DTR (Data Terminal Ready) line to trigger SNES hardware reset
      // The C# reference sets DtrEnable=false and waits 500ms (doesn't restore)
      // QUSB2Snes uses ioctl(TIOCMGET) then ioctl(TIOCMBIC, TIOCM_DTR) - gets status, then clears DTR
      // Matching QUSB2Snes behavior: check DTR status, ensure it's high, then clear it
      if (this.useRawFD && this.port && this.port.getDTR && this.port.clearDTR) {
        console.log('[UsbDeviceHandler] Resetting SNES console via DTR toggle (matching QUSB2Snes)...');
        
        // Step 1: Check current DTR status (like QUSB2Snes does with TIOCMGET)
        const dtrStatus = this.port.getDTR();
        console.log(`[UsbDeviceHandler] Current DTR status: ${dtrStatus ? 'HIGH' : 'LOW'}`);
        
        // Step 2: Ensure DTR is high before clearing (device needs to see the high->low transition)
        // QUSB2Snes strace shows DTR is already high when it gets cleared (TIOCM_DTR bit is set)
        // If DTR is low, set it high first to create a proper transition
        if (this.port.setDTR && dtrStatus === false) {
          console.log('[UsbDeviceHandler] DTR is low, setting to HIGH first to create transition...');
          this.port.setDTR(true);
          await new Promise(resolve => setTimeout(resolve, 50)); // Brief delay for transition
        }
        
        // Step 3: Clear DTR (set to LOW) - matching C#: DtrEnable = false and QUSB2Snes: TIOCMBIC
        const dtrCleared = this.port.clearDTR();
        if (dtrCleared) {
          console.log('[UsbDeviceHandler] DTR cleared (HIGH->LOW transition detected by SNES), waiting 500ms...');
          
          // Step 4: Wait 500ms (matching C#: Thread.Sleep(500))
          // This gives the SNES console time to process the reset signal
          await new Promise(resolve => setTimeout(resolve, 500));
          
          // Note: QUSB2Snes and C# reference do NOT restore DTR to high after reset
          // They leave it low. The device will handle it or it will be restored on next command
          
          // Clear command buffers and locks after reset
          this.responseBuffer = Buffer.alloc(0);
          this.dataBuffer = Buffer.alloc(0);
          this.pendingResponse = null;
          this.commandLock = false;
          
          console.log('[UsbDeviceHandler] SNES console reset complete (DTR LOW for 500ms, matching QUSB2Snes and C# reference)');
          return true;
        } else {
          console.warn('[UsbDeviceHandler] Failed to clear DTR via native ioctl, trying fallback...');
        }
      } else if (this.useRawFD && this.port && this.port.clearDTR) {
        // Fallback: Just clear DTR if getDTR not available
        console.log('[UsbDeviceHandler] Resetting SNES console (DTR status check not available)...');
        const dtrCleared = this.port.clearDTR();
        if (dtrCleared) {
          await new Promise(resolve => setTimeout(resolve, 500));
          this.responseBuffer = Buffer.alloc(0);
          this.dataBuffer = Buffer.alloc(0);
          this.pendingResponse = null;
          this.commandLock = false;
          console.log('[UsbDeviceHandler] SNES console reset complete (DTR cleared for 500ms)');
          return true;
        }
      }
      
      // Fallback to serialport library DTR control
      // Note: C# implementation only sets DTR to false and waits 500ms - it doesn't restore to true
      // This matches the C# behavior exactly
      return new Promise((resolve) => {
        // Try port.set first (some platforms support it)
        if (this.port.set) {
          console.log('[UsbDeviceHandler] Attempting DTR toggle (port.set) - matching C# behavior...');
          this.port.set({ dtr: false }, (err) => {
            if (err) {
              console.warn('[UsbDeviceHandler] DTR toggle via port.set failed:', err.message);
              console.warn('[UsbDeviceHandler] This is common on Linux - DTR control may not be supported by your system/driver');
              console.warn('[UsbDeviceHandler] Reset may not work correctly without DTR control');
              
              // Clear buffers anyway and return false (reset didn't work)
              this.responseBuffer = Buffer.alloc(0);
              this.dataBuffer = Buffer.alloc(0);
              this.pendingResponse = null;
              this.commandLock = false;
              resolve(false);
              return;
            }
            
            console.log('[UsbDeviceHandler] DTR set to false (matching C#: DtrEnable = false), waiting 500ms...');
            // Match C# behavior: set DTR to false, wait 500ms, done (no restore to true)
            setTimeout(() => {
              // Clear buffers
              this.responseBuffer = Buffer.alloc(0);
              this.dataBuffer = Buffer.alloc(0);
              this.pendingResponse = null;
              this.commandLock = false;
              console.log('[UsbDeviceHandler] Reset complete (DTR held low for 500ms, matching C# behavior)');
              resolve(true);
            }, 500);
          });
        } else if (this.port.dtr !== undefined) {
          // Try direct dtr property (some serialport versions)
          console.log('[UsbDeviceHandler] Attempting DTR toggle via direct property...');
          try {
            this.port.dtr = false;
            setTimeout(() => {
              // Match C# behavior: don't restore DTR to true, just wait 500ms
              this.responseBuffer = Buffer.alloc(0);
              this.dataBuffer = Buffer.alloc(0);
              this.pendingResponse = null;
              this.commandLock = false;
              console.log('[UsbDeviceHandler] Reset complete via direct DTR property (matching C# behavior)');
              resolve(true);
            }, 500);
          } catch (dtrError) {
            console.warn('[UsbDeviceHandler] Direct DTR property failed:', dtrError.message);
            console.warn('[UsbDeviceHandler] DTR control not supported - Reset may not work correctly');
            this.responseBuffer = Buffer.alloc(0);
            this.dataBuffer = Buffer.alloc(0);
            this.pendingResponse = null;
            this.commandLock = false;
            resolve(false);
          }
        } else {
          // No DTR support
          console.warn('[UsbDeviceHandler] No DTR support detected - Reset may not work correctly');
          console.warn('[UsbDeviceHandler] This is common on Linux - the RESET opcode should be used instead');
          this.responseBuffer = Buffer.alloc(0);
          this.dataBuffer = Buffer.alloc(0);
          this.pendingResponse = null;
          this.commandLock = false;
          resolve(false);
        }
      });
    } catch (error) {
      console.error('[UsbDeviceHandler] Reset error:', error);
      return false;
    }
  }

  /**
   * Reset via port close/reopen (fallback when DTR not supported)
   * @private
   */
  _resetViaCloseReopen(resolve) {
    if (!this.port || !this.isOpen) {
      console.warn('[UsbDeviceHandler] Port not open, cannot reset via close/reopen');
      resolve(false);
      return;
    }
    
    console.log('[UsbDeviceHandler] Closing port for reset...');
    const portPath = this.port.path;
    const wasOpen = this.isOpen;
    
    this.port.close((closeErr) => {
      if (closeErr) {
        console.error('[UsbDeviceHandler] Port close error:', closeErr.message);
        resolve(false);
        return;
      }
      
      this.isOpen = false;
      
      // Wait for port to close and device to reset
      setTimeout(() => {
        console.log('[UsbDeviceHandler] Reopening port after reset...');
        // Reopen port (simulate by clearing buffers - actual reopen requires deviceInfo)
        this.responseBuffer = Buffer.alloc(0);
        this.dataBuffer = Buffer.alloc(0);
        this.pendingResponse = null;
        this.commandLock = false;
        
        // Note: Full reopen requires deviceInfo, which we don't have here
        // For now, just clear buffers and mark as ready
        // The user may need to reconnect
        console.warn('[UsbDeviceHandler] Port closed for reset - user may need to reconnect');
        resolve(false);
      }, 500);
    });
  }

  /**
   * Execute Boot command on device
   * @param {string} romPath - Path to ROM file on device
   * @returns {Promise<boolean>} Success status
   */
  async boot(romPath) {
    try {
      if (this.useDummy && this.dummyDevice) {
        const response = await this.dummyDevice.sendCommand(
          this.OPCODES.BOOT,
          this.SPACES.FILE,
          this.FLAGS.NONE,
          [romPath]
        );
        return response[4] === this.OPCODES.RESPONSE;
      }

      const response = await this._sendCommandPacket(
        this.OPCODES.BOOT,
        this.SPACES.FILE,
        this.FLAGS.NONE,
        [romPath]
      );
      return response[4] === this.OPCODES.RESPONSE;
    } catch (error) {
      console.error('[UsbDeviceHandler] Boot error:', error);
      return false;
    }
  }

  /**
   * Execute Menu command on device (MENU_RESET opcode)
   * @returns {Promise<boolean>} Success status
   */
  async menu() {
    try {
      if (this.useDummy && this.dummyDevice) {
        const response = await this.dummyDevice.sendCommand(
          this.OPCODES.MENU_RESET,
          this.SPACES.SNES,
          this.FLAGS.NONE,
          []
        );
        return response[4] === this.OPCODES.RESPONSE;
      }

      const response = await this._sendCommandPacket(
        this.OPCODES.MENU_RESET,
        this.SPACES.SNES,
        this.FLAGS.NONE,
        []
      );
      return response[4] === this.OPCODES.RESPONSE;
    } catch (error) {
      console.error('[UsbDeviceHandler] Menu error:', error);
      return false;
    }
  }

  /**
   * Read memory from device
   * @param {number} address - Memory address
   * @param {number} size - Number of bytes
   * @returns {Promise<Buffer>} Memory data
   */
  async readMemory(address, size) {
    try {
      if (this.useDummy && this.dummyDevice) {
        const response = await this.dummyDevice.sendCommand(
          this.OPCODES.GET,
          this.SPACES.SNES,
          this.FLAGS.NONE,
          [address, size]
        );
        
        const sizeField = (response[252] << 24) | (response[253] << 16) | 
                         (response[254] << 8) | response[255];
        
        if (sizeField > 0 && sizeField <= size) {
          return await this.dummyDevice.readData(sizeField);
        }
        
        return Buffer.alloc(0);
      }

      const response = await this._sendCommandPacket(
        this.OPCODES.GET,
        this.SPACES.SNES,
        this.FLAGS.NONE,
        [address, size]
      );
      
      // Response packet contains size at bytes 252-255 (from C# line 675)
      const sizeField = (response[252] << 24) | (response[253] << 16) | 
                       (response[254] << 8) | response[255];
      
      if (sizeField > 0 && sizeField <= size) {
        // Read data following the response packet
        return await this._readData(sizeField);
      }
      
      return Buffer.alloc(0);
    } catch (error) {
      console.error('[UsbDeviceHandler] Read memory error:', error);
      throw error;
    }
  }

  /**
   * Write memory to device
   * @param {number} address - Memory address
   * @param {Buffer} data - Data to write
   * @returns {Promise<boolean>} Success status
   */
  async writeMemory(address, data) {
    try {
      if (this.useDummy && this.dummyDevice) {
        // Send PUT command
        const response = await this.dummyDevice.sendCommand(
          this.OPCODES.PUT,
          this.SPACES.SNES,
          this.FLAGS.NONE,
          [address, data.length]
        );
        
        // Write data to dummy device
        await this.dummyDevice.writeData(data);
        return response[4] === this.OPCODES.RESPONSE;
      }

      // Send PUT command with address and size
      const response = await this._sendCommandPacket(
        this.OPCODES.PUT,
        this.SPACES.SNES,
        this.FLAGS.NONE,
        [address, data.length]
      );
      
      // After response, send data
      if (response[4] === this.OPCODES.RESPONSE) {
        return new Promise((resolve, reject) => {
          this.port.write(data, (err) => {
            if (err) {
              reject(err);
            } else {
              // Wait for drain to ensure data is sent
              this.port.drain((err) => {
                if (err) {
                  reject(err);
                } else {
                  resolve(true);
                }
              });
            }
          });
        });
      }
      
      return false;
    } catch (error) {
      console.error('[UsbDeviceHandler] Write memory error:', error);
      return false;
    }
  }

  /**
   * Write memory using CMD space (for SD2SNES assembly commands)
   * @param {number} cmdAddress - Command address (e.g., 0x2C00)
   * @param {Buffer} cmdData - Command data (assembly instructions)
   * @returns {Promise<boolean>} Success status
   */
  async writeMemoryCMD(cmdAddress, cmdData) {
    try {
      if (this.useDummy && this.dummyDevice) {
        const response = await this.dummyDevice.sendCommand(
          this.OPCODES.PUT,
          this.SPACES.CMD,
          this.FLAGS.NONE,
          [cmdAddress, cmdData.length]
        );
        
        await this.dummyDevice.writeData(cmdData);
        return response[4] === this.OPCODES.RESPONSE;
      }

      // CMD space uses PUT opcode with CMD space
      const response = await this._sendCommandPacket(
        this.OPCODES.PUT,
        this.SPACES.CMD,
        this.FLAGS.NONE,
        [cmdAddress, cmdData.length]
      );
      
      if (response[4] === this.OPCODES.RESPONSE) {
        return new Promise((resolve, reject) => {
          this.port.write(cmdData, (err) => {
            if (err) {
              reject(err);
            } else {
              this.port.drain((err) => {
                if (err) {
                  reject(err);
                } else {
                  resolve(true);
                }
              });
            }
          });
        });
      }
      
      return false;
    } catch (error) {
      console.error('[UsbDeviceHandler] Write CMD error:', error);
      return false;
    }
  }

  /**
   * Get file from device
   * @param {string} filePath - File path
   * @returns {Promise<Buffer>} File data
   */
  async getFile(filePath) {
    try {
      if (this.useDummy && this.dummyDevice) {
        const response = await this.dummyDevice.sendCommand(
          this.OPCODES.GET,
          this.SPACES.FILE,
          this.FLAGS.NONE,
          [filePath]
        );
        
        const size = (response[252] << 24) | (response[253] << 16) | 
                     (response[254] << 8) | response[255];
        
        if (size === 0) {
          return Buffer.alloc(0);
        }
        
        return await this.dummyDevice.readData(size);
      }

      const response = await this._sendCommandPacket(
        this.OPCODES.GET,
        this.SPACES.FILE,
        this.FLAGS.NONE,
        [filePath]
      );
      
      // Response contains size at bytes 252-255
      const size = (response[252] << 24) | (response[253] << 16) | 
                   (response[254] << 8) | response[255];
      
      if (size === 0) {
        return Buffer.alloc(0);
      }
      
      // Read file data
      return await this._readData(size);
    } catch (error) {
      console.error('[UsbDeviceHandler] Get file error:', error);
      throw error;
    }
  }

  /**
   * Put file to device
   * @param {string} filePath - Destination path
   * @param {Buffer} data - File data
   * @returns {Promise<boolean>} Success status
   */
  async putFile(filePath, data) {
    try {
      if (this.useDummy && this.dummyDevice) {
        const response = await this.dummyDevice.sendCommand(
          this.OPCODES.PUT,
          this.SPACES.FILE,
          this.FLAGS.NONE,
          [filePath, data.length]
        );
        
        await this.dummyDevice.writeData(data);
        return response[4] === this.OPCODES.RESPONSE;
      }

      // Send PUT command with file path and size
      const response = await this._sendCommandPacket(
        this.OPCODES.PUT,
        this.SPACES.FILE,
        this.FLAGS.NONE,
        [filePath, data.length]
      );
      
      if (response[4] === this.OPCODES.RESPONSE) {
        // Send file data in chunks (512 bytes at a time to match packet size)
        return new Promise((resolve, reject) => {
          let offset = 0;
          const chunkSize = 512;
          
          const writeChunk = () => {
            if (offset >= data.length) {
              // All data sent, drain and resolve
              this.port.drain((err) => {
                if (err) {
                  reject(err);
                } else {
                  resolve(true);
                }
              });
              return;
            }
            
            const chunk = data.slice(offset, offset + chunkSize);
            this.port.write(chunk, (err) => {
              if (err) {
                reject(err);
              } else {
                offset += chunk.length;
                writeChunk();
              }
            });
          };
          
          writeChunk();
        });
      }
      
      return false;
    } catch (error) {
      console.error('[UsbDeviceHandler] Put file error:', error);
      return false;
    }
  }

  /**
   * List directory on device
   * @param {string} dirPath - Directory path
   * @returns {Promise<Array>} Directory listing [{type: string, filename: string}, ...]
   */
  async listDirectory(dirPath) {
    try {
      if (this.useDummy && this.dummyDevice) {
        const response = await this.dummyDevice.sendCommand(
          this.OPCODES.LS,
          this.SPACES.FILE,
          this.FLAGS.NONE,
          [dirPath || '/']
        );
        
        return this._parseDirectoryListing(response);
      }

      const response = await this._sendCommandPacket(
        this.OPCODES.LS,
        this.SPACES.FILE,
        this.FLAGS.NONE,
        [dirPath || '/']
      );
      
      return this._parseDirectoryListing(response);
    } catch (error) {
      console.error('[UsbDeviceHandler] List directory error:', error);
      throw error;
    }
  }

  /**
   * Parse directory listing from response packet
   * @private
   */
  _parseDirectoryListing(response) {
    // Format: (type byte, filename null-terminated) pairs starting at byte 0 (from C# Core.cs lines 490-533)
    const files = [];
    let offset = 0;
    
    while (offset < 512 && response[offset] !== 0 && response[offset] !== 0xFF) {
      const type = response[offset];
      offset++;
      
      // Read null-terminated filename
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
  }

  /**
   * Make directory on device
   * @param {string} dirPath - Directory path
   * @returns {Promise<boolean>} Success status
   */
  async makeDirectory(dirPath) {
    try {
      // MKDIR uses NORESP flag (fire-and-forget) - from C# Core.cs line 874
      // Don't wait for response
      const packet = this._buildCommandPacket(
        this.OPCODES.MKDIR,
        this.SPACES.FILE,
        this.FLAGS.NORESP,
        [dirPath]
      );
      
      return new Promise((resolve, reject) => {
        if (this.useDummy && this.dummyDevice) {
          this.dummyDevice.sendCommand(
            this.OPCODES.MKDIR,
            this.SPACES.FILE,
            this.FLAGS.NORESP,
            [dirPath]
          ).then(() => resolve(true)).catch(reject);
          return;
        }
        
        this.port.write(packet, (err) => {
          if (err) {
            reject(err);
          } else {
            // No response expected for NORESP
            resolve(true);
          }
        });
      });
    } catch (error) {
      console.error('[UsbDeviceHandler] Make directory error:', error);
      return false;
    }
  }

  /**
   * Remove file/directory on device
   * @param {string} path - Path to remove
   * @returns {Promise<boolean>} Success status
   */
  async remove(path) {
    try {
      if (this.useDummy && this.dummyDevice) {
        const response = await this.dummyDevice.sendCommand(
          this.OPCODES.RM,
          this.SPACES.FILE,
          this.FLAGS.NONE,
          [path]
        );
        return response[4] === this.OPCODES.RESPONSE;
      }

      const response = await this._sendCommandPacket(
        this.OPCODES.RM,
        this.SPACES.FILE,
        this.FLAGS.NONE,
        [path]
      );
      return response[4] === this.OPCODES.RESPONSE;
    } catch (error) {
      console.error('[UsbDeviceHandler] Remove error:', error);
      return false;
    }
  }

  /**
   * Stream data from MSU space
   * @param {boolean} streamBurst - Whether to use STREAM_BURST flag (64-byte chunks)
   * @returns {Promise<Buffer>} Stream data
   */
  async stream(streamBurst = false) {
    try {
      const flags = streamBurst ? this.FLAGS.STREAM_BURST | this.FLAGS.DATA64B : this.FLAGS.DATA64B;
      
      if (this.useDummy && this.dummyDevice) {
        const response = await this.dummyDevice.sendCommand(
          this.OPCODES.STREAM,
          this.SPACES.MSU,
          flags,
          []
        );
        
        // Stream reads from MSU space
        const size = (response[252] << 24) | (response[253] << 16) | 
                     (response[254] << 8) | response[255];
        
        if (size === 0) {
          return Buffer.alloc(0);
        }
        
        return await this.dummyDevice.readData(size);
      }

      const response = await this._sendCommandPacket(
        this.OPCODES.STREAM,
        this.SPACES.MSU,
        flags,
        []
      );
      
      // Response contains size at bytes 252-255
      const size = (response[252] << 24) | (response[253] << 16) | 
                   (response[254] << 8) | response[255];
      
      if (size === 0) {
        return Buffer.alloc(0);
      }
      
      // Read stream data
      return await this._readData(size);
    } catch (error) {
      console.error('[UsbDeviceHandler] Stream error:', error);
      throw error;
    }
  }

  /**
   * Apply IPS patch from file
   * @param {string} ipsPath - Path to IPS patch file on device
   * @returns {Promise<boolean>} Success status
   */
  async putIPS(ipsPath) {
    try {
      // PutIPS uses MV (move) opcode - from C# Scheduler.cs line 373-377
      // The IPS file path is passed as operand
      if (this.useDummy && this.dummyDevice) {
        const response = await this.dummyDevice.sendCommand(
          this.OPCODES.MV,
          this.SPACES.FILE,
          this.FLAGS.NONE,
          [ipsPath]
        );
        return response[4] === this.OPCODES.RESPONSE;
      }

      const response = await this._sendCommandPacket(
        this.OPCODES.MV,
        this.SPACES.FILE,
        this.FLAGS.NONE,
        [ipsPath]
      );
      return response[4] === this.OPCODES.RESPONSE;
    } catch (error) {
      console.error('[UsbDeviceHandler] PutIPS error:', error);
      return false;
    }
  }

  /**
   * Rename/move file on device
   * @param {string} sourcePath - Source file path
   * @param {string} destPath - Destination file path
   * @returns {Promise<boolean>} Success status
   */
  async rename(sourcePath, destPath) {
    try {
      // Rename uses MV (move) opcode with both source and dest paths
      // From C# Scheduler.cs line 649-653, it passes operands[0] and operands[1]
      if (this.useDummy && this.dummyDevice) {
        const response = await this.dummyDevice.sendCommand(
          this.OPCODES.MV,
          this.SPACES.FILE,
          this.FLAGS.NONE,
          [sourcePath, destPath]
        );
        return response[4] === this.OPCODES.RESPONSE;
      }

      const response = await this._sendCommandPacket(
        this.OPCODES.MV,
        this.SPACES.FILE,
        this.FLAGS.NONE,
        [sourcePath, destPath]
      );
      return response[4] === this.OPCODES.RESPONSE;
    } catch (error) {
      console.error('[UsbDeviceHandler] Rename error:', error);
      return false;
    }
  }

  /**
   * Get device info
   * @returns {Promise<Object>} Device info {firmwareversion, versionstring, romrunning, flag1, flag2}
   */
  async getInfo() {
    try {
      if (this.useDummy && this.dummyDevice) {
        return await this.dummyDevice.getInfo();
      }

      console.log('[UsbDeviceHandler] Sending INFO command...');
      const response = await this._sendCommandPacket(
        this.OPCODES.INFO,
        this.SPACES.SNES,
        this.FLAGS.NONE,
        []
      );
      
      if (!response || response.length < 512) {
        console.error(`[UsbDeviceHandler] Invalid INFO response: length=${response ? response.length : 0}`);
        throw new Error('Invalid INFO response packet');
      }
      
      console.log(`[UsbDeviceHandler] Received INFO response, packet length: ${response.length}`);
      console.log(`[UsbDeviceHandler] Response magic: ${response[0].toString(16)} ${response[1].toString(16)} ${response[2].toString(16)} ${response[3].toString(16)}`);
      console.log(`[UsbDeviceHandler] Response opcode: ${response[4]}, expected RESPONSE=${this.OPCODES.RESPONSE}`);
      
      // Parse INFO response (from C# Core.cs lines 911-934)
      // Format: [firmwareversion, versionstring, romrunning, flag1, flag2]
      // firmwareVersion: UTF-8 string starting at byte 260, null-terminated
      const firmwareVersionOffset = 260;
      let firmwareVersionEnd = response.indexOf(0, firmwareVersionOffset);
      if (firmwareVersionEnd < 0) firmwareVersionEnd = response.length;
      const firmwareVersion = firmwareVersionEnd > firmwareVersionOffset
        ? response.slice(firmwareVersionOffset, firmwareVersionEnd).toString('utf8')
        : '';
      
      // versionString: 32-bit integer at bytes 256-259, converted to hex (uppercase, no padding in C#)
      const versionStringValue = (response[256] << 24) | (response[257] << 16) | 
                                 (response[258] << 8) | response[259];
      const versionString = versionStringValue > 0 
        ? versionStringValue.toString(16).toUpperCase() 
        : '';
      
      // romRunning: UTF-8 string starting at byte 16, null-terminated
      const romRunningOffset = 16;
      let romRunningEnd = response.indexOf(0, romRunningOffset);
      if (romRunningEnd < 0) romRunningEnd = response.length;
      const romRunning = romRunningEnd > romRunningOffset
        ? response.slice(romRunningOffset, romRunningEnd).toString('utf8')
        : '';
      
      console.log(`[UsbDeviceHandler] Parsed Info response:`);
      console.log(`  Raw bytes 256-259 (versionString): ${response[256].toString(16)} ${response[257].toString(16)} ${response[258].toString(16)} ${response[259].toString(16)}`);
      console.log(`  Raw bytes 16-31 (romRunning): ${response.slice(16, 32).toString('hex')}`);
      console.log(`  Raw bytes 260-300 (firmwareVersion): ${response.slice(260, 300).toString('hex')}`);
      console.log(`  Parsed: firmwareVersion="${firmwareVersion}", versionString="${versionString}", romRunning="${romRunning}"`);
      
      // Flags at byte 6 (from C# lines 915-932)
      const flags = response[6];
      const featureFlags = [];
      if (flags & 1) featureFlags.push('FEAT_DSPX');
      if (flags & 2) featureFlags.push('FEAT_ST0010');
      if (flags & 4) featureFlags.push('FEAT_SRTC');
      if (flags & 8) featureFlags.push('FEAT_MSU1');
      if (flags & 16) featureFlags.push('FEAT_213F');
      if (flags & 32) featureFlags.push('FEAT_CMD_UNLOCK');
      if (flags & 64) featureFlags.push('FEAT_USB1');
      if (flags & 128) featureFlags.push('FEAT_DMA1');
      
      return {
        firmwareversion: firmwareVersion || 'N/A',
        versionstring: versionString || 'N/A',
        romrunning: romRunning || 'N/A',
        flag1: featureFlags.join('|'),
        flag2: ''
      };
    } catch (error) {
      console.error('[UsbDeviceHandler] Get info error:', error);
      throw error;
    }
  }

  /**
   * Read null-terminated string from buffer
   * @private
   */
  _readNullTerminatedString(buffer, offset) {
    let str = '';
    for (let i = offset; i < buffer.length && buffer[i] !== 0; i++) {
      str += String.fromCharCode(buffer[i]);
    }
    return str;
  }

  /**
   * Close device connection
   * @returns {Promise<void>}
   */
  async closeDevice() {
    // Stop periodic read check
    if (this._readCheckInterval) {
      clearInterval(this._readCheckInterval);
      this._readCheckInterval = null;
    }
    
    if (this.useDummy && this.dummyDevice) {
      await this.dummyDevice.close();
      this.isOpen = false;
      return;
    }

    if (this.port) {
      return new Promise((resolve) => {
        if (this.port.isOpen) {
          this.port.close((err) => {
            if (err) console.error('[UsbDeviceHandler] Error closing port:', err);
            this.port = null;
            this.isOpen = false;
            resolve();
          });
        } else {
          this.port = null;
          this.isOpen = false;
          resolve();
        }
      });
    }

    this.isOpen = false;
    this.device = null;
    this.responseBuffer = Buffer.alloc(0);
    this.dataBuffer = Buffer.alloc(0);
    this.pendingResponse = null;
    this.pendingDataResolve = null;
  }

  /**
   * Windows device opening
   * @private
   */
  async _openWindowsDevice(deviceInfo) {
    // Windows implementation - try COM ports
    const possiblePorts = deviceInfo.possiblePorts || ['COM3', 'COM4', 'COM5', 'COM6'];
    return this._openSerialPort({ ...deviceInfo, possiblePorts });
  }

  /**
   * macOS device opening
   * @private
   */
  async _openMacDevice(deviceInfo) {
    // macOS implementation
    const possiblePorts = deviceInfo.possiblePorts || ['/dev/cu.usbmodem*', '/dev/tty.usbmodem*'];
    return this._openSerialPort({ ...deviceInfo, possiblePorts });
  }
}

module.exports = UsbDeviceHandler;
