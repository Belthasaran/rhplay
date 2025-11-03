/**
 * Raw file descriptor-based serial port communication for Linux
 * 
 * This is an alternative implementation that uses raw file descriptors
 * (fs.openSync, fs.readSync, fs.writeSync) instead of the serialport library.
 * This approach is more similar to how the C reference implementation works
 * with synchronous blocking reads.
 * 
 * Based on the C Core implementation which uses:
 * - SafeSerialPort with ReadTimeout = 5000
 * - Synchronous blocking Read() calls
 * - Direct serial port file handle operations
 */

const fs = require('fs');
const { spawn } = require('child_process');

// Try to load native module for setting O_NONBLOCK and ioctl operations
let setNonBlocking = null;
let setExclusive = null;
let clearExclusive = null;
let flushBuffers = null;
let drainOutput = null;
let getModemControl = null;
let clearModemControl = null;
let setModemControl = null;
let disableFlowControl = null;
let TIOCM_DTR = 2; // Default fallback value
try {
  // Try relative path first (for local development)
  try {
    const serialportNonblock = require('../../../native-modules/serialport-nonblock');
    setNonBlocking = serialportNonblock.setNonBlocking;
    setExclusive = serialportNonblock.setExclusive;
    clearExclusive = serialportNonblock.clearExclusive;
    flushBuffers = serialportNonblock.flushBuffers;
    drainOutput = serialportNonblock.drainOutput;
    getModemControl = serialportNonblock.getModemControl;
    clearModemControl = serialportNonblock.clearModemControl;
    setModemControl = serialportNonblock.setModemControl;
    disableFlowControl = serialportNonblock.disableFlowControl;
    TIOCM_DTR = serialportNonblock.TIOCM_DTR || 2;
    console.log(`[RawFD] Native module loaded: serialport-nonblock`);
  } catch (relativeErr) {
    // Try absolute path (for packaged builds)
    const path = require('path');
    const modulePath = path.join(__dirname, '../../../native-modules/serialport-nonblock');
    const serialportNonblock = require(modulePath);
    setNonBlocking = serialportNonblock.setNonBlocking;
    setExclusive = serialportNonblock.setExclusive;
    clearExclusive = serialportNonblock.clearExclusive;
    flushBuffers = serialportNonblock.flushBuffers;
    drainOutput = serialportNonblock.drainOutput;
    getModemControl = serialportNonblock.getModemControl;
    clearModemControl = serialportNonblock.clearModemControl;
    setModemControl = serialportNonblock.setModemControl;
    disableFlowControl = serialportNonblock.disableFlowControl;
    TIOCM_DTR = serialportNonblock.TIOCM_DTR || 2;
    console.log(`[RawFD] Native module loaded: serialport-nonblock (from ${modulePath})`);
  }
} catch (err) {
  console.warn(`[RawFD] Native module not available: ${err.message}`);
  console.warn(`[RawFD] File descriptor will be in blocking mode (may cause issues)`);
  console.warn(`[RawFD] Exclusive lock, buffer flushing, DTR control, and flow control disable will not be available`);
  console.warn(`[RawFD] Stack: ${err.stack}`);
}
const util = require('util');
const exec = util.promisify(require('child_process').exec);

/**
 * Configure serial port using stty command
 * @param {string} portPath - Path to serial port (e.g., '/dev/ttyACM0')
 */
async function configureSerialPortStty(portPath) {
  try {
    const sttyCommand = `stty -F ${portPath} 0:0:cbd:0:3:1c:7f:15:4:5:40:0:11:13:1a:0:12:f:17:16:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0`;
    console.log(`[RawFD] Configuring serial port with stty: ${sttyCommand}`);
    
    const { stdout, stderr } = await exec(sttyCommand);
    
    if (stderr && stderr.trim()) {
      console.warn(`[RawFD] stty stderr: ${stderr}`);
    }
    
    console.log(`[RawFD] Serial port configured successfully with stty`);
    return true;
  } catch (error) {
    console.error(`[RawFD] stty configuration failed: ${error.message}`);
    throw error;
  }
}

/**
 * Open serial port using raw file descriptor
 * @param {string} portPath - Path to serial port (e.g., '/dev/ttyACM0')
 * @param {number} baudRate - Baud rate (default: 9600)
 * @returns {Object} Port handle with read/write methods
 */
async function openRawSerialPort(portPath, baudRate = 9600) {
  console.log(`[RawFD] Opening raw file descriptor for: ${portPath} at ${baudRate} baud`);
  
  // Configure port with stty first (critical for proper termios settings)
  await configureSerialPortStty(portPath);
  
  // CRITICAL: Open file descriptor in read/write mode
  // QUSB2Snes opens with O_RDWR|O_NOCTTY|O_NONBLOCK|O_CLOEXEC
  // Node.js fs.openSync() doesn't support O_NONBLOCK flag directly,
  // but we'll handle non-blocking behavior via async fs.read() with polling
  // Note: fs.openSync opens in blocking mode by default on Linux
  const fd = fs.openSync(portPath, 'r+');
  
  console.log(`[RawFD] Opened file descriptor: ${fd} (path: ${portPath})`);
  
  // CRITICAL: Set TIOCEXCL (exclusive lock) like QUSB2Snes does
  // This prevents other processes from accessing the device
  if (setExclusive) {
    try {
      setExclusive(fd);
      console.log(`[RawFD] ✓ Set TIOCEXCL (exclusive lock)`);
    } catch (err) {
      console.warn(`[RawFD] ⚠ Failed to set TIOCEXCL: ${err.message}`);
      console.warn(`[RawFD] Continuing without exclusive lock (may allow other processes to interfere)`);
    }
  } else {
    console.warn(`[RawFD] ⚠ Native module not available - cannot set exclusive lock`);
  }
  
  // CRITICAL: Set O_NONBLOCK flag like QUSB2Snes does
  if (setNonBlocking) {
    try {
      setNonBlocking(fd);
      console.log(`[RawFD] ✓ Set O_NONBLOCK flag (non-blocking mode)`);
    } catch (err) {
      console.warn(`[RawFD] ⚠ Failed to set O_NONBLOCK: ${err.message}`);
      console.warn(`[RawFD] Continuing with blocking mode (may cause issues)`);
    }
  } else {
    console.warn(`[RawFD] ⚠ Native module not available - file descriptor is in blocking mode`);
    console.warn(`[RawFD] This may cause read operations to block indefinitely`);
  }
  
  // CRITICAL: Disable all flow control (RTS/CTS, XON/XOFF) to ensure the TTY doesn't wait
  // for signals that don't exist on the USB2SNES device
  if (disableFlowControl) {
    try {
      disableFlowControl(fd);
      console.log(`[RawFD] ✓ Disabled hardware and software flow control (CRTSCTS, XON/XOFF)`);
    } catch (err) {
      console.warn(`[RawFD] ⚠ Failed to disable flow control: ${err.message}`);
      console.warn(`[RawFD] Continuing - flow control may cause writes to hang if not properly disabled`);
    }
  } else {
    console.warn(`[RawFD] ⚠ Native module not available - cannot disable flow control`);
    console.warn(`[RawFD] Writes may hang if TTY waits for flow control signals that don't exist`);
  }
  
  // NOTE: We do NOT re-apply stty after opening because:
  // 1. TIOCEXCL sets an exclusive lock, preventing other processes (including stty subprocess) from accessing the device
  // 2. QUSB2Snes doesn't run stty after opening - it only configures via ioctl() calls which we do via the serialport library or native module
  // 3. The termios settings from the initial stty call should persist after opening
  
  // Clear input buffer by reading any pending data
  try {
    const buffer = Buffer.alloc(4096);
    let cleared = 0;
    
    // Try to read available data using async fs.read with short timeout
    for (let i = 0; i < 10; i++) {
      try {
        // Use async read with timeout
        const readPromise = new Promise((resolve, reject) => {
          fs.read(fd, buffer, 0, buffer.length, null, (err, bytesRead) => {
            if (err) {
              reject(err);
            } else {
              resolve(bytesRead);
            }
          });
        });
        
        const timeoutPromise = new Promise((resolve) => {
          setTimeout(() => resolve(0), 50); // 50ms timeout
        });
        
        const bytesRead = await Promise.race([readPromise, timeoutPromise]);
        
        if (bytesRead > 0) {
          cleared += bytesRead;
          console.log(`[RawFD] Cleared ${bytesRead} bytes of stale data (total: ${cleared})`);
        } else {
          break; // No more data or timeout
        }
      } catch (err) {
        if (err.code === 'EAGAIN' || err.code === 'EWOULDBLOCK') {
          // No data available, expected
          break;
        }
        // Ignore timeout errors
        if (!err.message || !err.message.includes('timeout')) {
          console.warn(`[RawFD] Read error during buffer clear: ${err.message}`);
        }
        break;
      }
      
      // Small delay between reads
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    
    if (cleared > 0) {
      console.log(`[RawFD] Cleared ${cleared} total bytes of stale data from input buffer`);
    } else {
      console.log(`[RawFD] Input buffer is clean (no stale data)`);
    }
  } catch (clearError) {
    console.warn(`[RawFD] Input buffer clear failed (continuing anyway): ${clearError.message}`);
  }
  
  // Create port handle object
  const port = {
    fd: fd,
    path: portPath,
    baudRate: baudRate,
    isOpen: true,
    readable: true,
    writable: true,
    _readLock: false, // Lock to prevent concurrent reads
    
    /**
     * Read data from serial port (blocking with timeout via worker thread)
     * CRITICAL: Only one read can happen at a time to prevent double-reading
     * @param {Buffer} buffer - Buffer to read into
     * @param {number} offset - Offset in buffer
     * @param {number} length - Number of bytes to read
     * @param {number} timeoutMs - Timeout in milliseconds (default: 5000)
     * @returns {Promise<number>} Number of bytes read
     */
    readAsync: function(buffer, offset, length, timeoutMs = 5000) {
      return new Promise((resolve, reject) => {
        // CRITICAL: Prevent concurrent reads - only one read at a time
        if (this._readLock) {
          reject(new Error('Read already in progress - concurrent reads not allowed'));
          return;
        }
        
        this._readLock = true;
        
        const startTime = Date.now();
        let completed = false;
        
        const releaseLock = () => {
          this._readLock = false;
        };
        
        // Set up timeout
        const timeoutId = setTimeout(() => {
          if (!completed) {
            completed = true;
            releaseLock();
            reject(new Error(`Read timeout after ${timeoutMs}ms - no data received`));
          }
        }, timeoutMs);
        
        // Start read immediately
        const attemptRead = () => {
          if (completed) return;
          
          try {
            // CRITICAL: Only one fs.read() call at a time on this FD
            // With O_NONBLOCK set, fs.read() will return immediately:
            // - If data is available: bytesReadNow > 0
            // - If no data: err.code === 'EAGAIN' or 'EWOULDBLOCK'
            // We need to poll in a loop (like QUSB2Snes uses poll() then read)
            fs.read(this.fd, buffer, offset, length, null, (err, bytesReadNow) => {
              if (completed) return;
              
              if (err) {
                // With O_NONBLOCK, we expect EAGAIN/EWOULDBLOCK when no data is available
                if (err.code === 'EAGAIN' || err.code === 'EWOULDBLOCK') {
                  // No data available yet - check timeout and retry
                  const elapsed = Date.now() - startTime;
                  if (elapsed >= timeoutMs) {
                    completed = true;
                    releaseLock();
                    clearTimeout(timeoutId);
                    reject(new Error(`Read timeout after ${timeoutMs}ms (EAGAIN)`));
                    return;
                  }
                  
                  // Log occasionally to show we're polling (once per 100ms)
                  if (elapsed % 100 < 5 && elapsed % 100 >= 0) {
                    console.log(`[RawFD] Polling for data (EAGAIN, elapsed: ${elapsed}ms)...`);
                  }
                  
                  // CRITICAL: Add small delay between poll attempts (5ms) to avoid tight loop
                  // QUSB2Snes uses poll() with a timeout, then reads when data is available
                  // We simulate this by retrying with a small delay
                  setTimeout(attemptRead, 5);
                  return;
                }
                
                // Other errors
                completed = true;
                releaseLock();
                clearTimeout(timeoutId);
                reject(err);
                return;
              }
              
              // bytesReadNow > 0 means data was read successfully
              if (bytesReadNow > 0) {
                completed = true;
                releaseLock();
                clearTimeout(timeoutId);
                console.log(`[RawFD] *** Read ${bytesReadNow} bytes from serial port (offset ${offset}, length ${length}) ***`);
                resolve(bytesReadNow);
                return;
              }
              
              // bytesReadNow === 0 means EOF (end of file)
              // This shouldn't happen on a serial port unless connection is closed
              const elapsed = Date.now() - startTime;
              console.warn(`[RawFD] Read returned 0 bytes (EOF) after ${elapsed}ms - connection may be closed`);
              
              // Check timeout
              if (elapsed >= timeoutMs) {
                completed = true;
                releaseLock();
                clearTimeout(timeoutId);
                reject(new Error(`Read timeout after ${timeoutMs}ms (EOF)`));
                return;
              }
              
              // Retry immediately (EOF might be transient)
              setImmediate(attemptRead);
            });
          } catch (err) {
            completed = true;
            releaseLock();
            clearTimeout(timeoutId);
            reject(err);
          }
        };
        
        // Start read attempt
        attemptRead();
      });
    },
    
    /**
     * Write data to serial port
     * @param {Buffer} buffer - Data to write
     * @param {number} offset - Offset in buffer (optional)
     * @param {number} length - Number of bytes to write (optional)
     * @returns {number} Number of bytes written
     */
    writeSync: function(buffer, offset = 0, length = buffer.length) {
      console.log(`[RawFD] ===== WRITE TO FILE DESCRIPTOR =====`);
      console.log(`[RawFD] FD: ${this.fd}, Path: ${this.path}`);
      console.log(`[RawFD] Buffer length: ${buffer.length}, Offset: ${offset}, Length: ${length}`);
      console.log(`[RawFD] First 64 bytes being written (hex): ${buffer.slice(offset, Math.min(offset + 64, offset + length)).toString('hex')}`);
      console.log(`[RawFD] First 64 bytes being written (ascii): ${buffer.slice(offset, Math.min(offset + 64, offset + length)).toString('ascii').replace(/[^\x20-\x7E]/g, '.')}`);
      
      const bytesWritten = fs.writeSync(this.fd, buffer, offset, length);
      console.log(`[RawFD] ✓ fs.writeSync returned: ${bytesWritten} bytes written`);
      
      if (bytesWritten !== length) {
        console.error(`[RawFD] ⚠ WARNING: Only ${bytesWritten}/${length} bytes written!`);
      }
      
      // CRITICAL: QUSB2Snes does NOT call tcdrain() after write!
      // From strace: write(56, ...) = 512, then immediately poll() and read()
      // tcdrain() can block indefinitely if hardware flow control isn't configured correctly
      // Instead, we rely on writeSync() which should ensure data is queued for transmission
      // For NORESP commands, the device doesn't send a response anyway, so no need to wait
      console.log(`[RawFD] Write completed - data queued for transmission (matching QUSB2Snes behavior)`);
      
      return bytesWritten;
    },
    
    /**
     * Close the serial port
     */
    /**
     * Flush serial port buffers using TCFLSH with TCIOFLUSH
     * This is what QUSB2Snes does after writing a command
     */
    flushBuffers: function() {
      if (this.fd === null || !this.isOpen) {
        console.warn(`[RawFD] Cannot flush buffers - port not open`);
        return;
      }
      
      if (flushBuffers) {
        try {
          flushBuffers(this.fd);
          console.log(`[RawFD] ✓ Flushed input and output buffers (TCFLSH with TCIOFLUSH)`);
        } catch (err) {
          console.warn(`[RawFD] ⚠ Failed to flush buffers: ${err.message}`);
        }
      } else {
        console.warn(`[RawFD] ⚠ Native module not available - cannot flush buffers`);
      }
    },
    
    /**
     * Close the serial port
     */
    close: function() {
      if (this.fd !== null) {
        // CRITICAL: Release exclusive lock before closing (like QUSB2Snes does)
        if (clearExclusive) {
          try {
            clearExclusive(this.fd);
            console.log(`[RawFD] ✓ Released exclusive lock (TIOCNXCL)`);
          } catch (err) {
            console.warn(`[RawFD] ⚠ Failed to release exclusive lock: ${err.message}`);
          }
        }
        
        fs.closeSync(this.fd);
        this.fd = null;
        this.isOpen = false;
        console.log(`[RawFD] Closed file descriptor for: ${this.path}`);
      }
    }
  };
  
  // Add drainOutput method to port object (ensures data is transmitted before returning)
  port.drainOutput = function() {
    if (this.fd === null || !this.isOpen) {
      console.warn(`[RawFD] Cannot drain output - port not open`);
      return false;
    }
    
    // Use drainOutput from the module already loaded at the top of the file
    if (drainOutput && typeof drainOutput === 'function') {
      try {
        drainOutput(this.fd);
        console.log(`[RawFD] ✓ Output drained (all data transmitted to device)`);
        return true;
      } catch (err) {
        console.warn(`[RawFD] ⚠ Failed to drain output: ${err.message}`);
        return false;
      }
    } else {
      console.warn(`[RawFD] ⚠ drainOutput function not available in native module`);
      return false;
    }
  };
  
  // Add DTR control methods to port object (matching QUSB2Snes ioctl usage)
  port.clearDTR = function() {
    if (this.fd === null || !this.isOpen) {
      console.warn(`[RawFD] Cannot clear DTR - port not open`);
      return false;
    }
    
    if (clearModemControl && TIOCM_DTR) {
      try {
        clearModemControl(this.fd, TIOCM_DTR);
        console.log(`[RawFD] ✓ Cleared DTR using TIOCMBIC (like QUSB2Snes)`);
        return true;
      } catch (err) {
        console.warn(`[RawFD] ⚠ Failed to clear DTR: ${err.message}`);
        return false;
      }
    } else {
      console.warn(`[RawFD] ⚠ Native module DTR control not available`);
      return false;
    }
  };
  
  port.setDTR = function(value) {
    if (this.fd === null || !this.isOpen) {
      console.warn(`[RawFD] Cannot set DTR - port not open`);
      return false;
    }
    
    if (setModemControl && clearModemControl && TIOCM_DTR) {
      try {
        if (value) {
          setModemControl(this.fd, TIOCM_DTR);
          console.log(`[RawFD] ✓ Set DTR using TIOCMBIS`);
        } else {
          clearModemControl(this.fd, TIOCM_DTR);
          console.log(`[RawFD] ✓ Cleared DTR using TIOCMBIC`);
        }
        return true;
      } catch (err) {
        console.warn(`[RawFD] ⚠ Failed to ${value ? 'set' : 'clear'} DTR: ${err.message}`);
        return false;
      }
    } else {
      console.warn(`[RawFD] ⚠ Native module DTR control not available`);
      return false;
    }
  };
  
  port.getDTR = function() {
    if (this.fd === null || !this.isOpen) {
      console.warn(`[RawFD] Cannot get DTR - port not open`);
      return null;
    }
    
    if (getModemControl && TIOCM_DTR) {
      try {
        const status = getModemControl(this.fd);
        return (status & TIOCM_DTR) !== 0;
      } catch (err) {
        console.warn(`[RawFD] ⚠ Failed to get DTR: ${err.message}`);
        return null;
      }
    } else {
      console.warn(`[RawFD] ⚠ Native module DTR control not available`);
      return null;
    }
  };
  
  console.log(`[RawFD] Raw file descriptor port ready: ${portPath}`);
  return port;
}

module.exports = {
  openRawSerialPort,
  configureSerialPortStty
};

