const { EventEmitter } = require('events');
const WebSocket = require('ws');
const usb = require('usb');
const net = require('net');
const { SocksProxyAgent } = require('socks-proxy-agent');

// Try to load Rust module first, fall back to JavaScript implementation
let UsbDeviceHandler = null;
try {
    const UsbDeviceHandlerRust = require('./usbDeviceHandlerRust');
    if (UsbDeviceHandlerRust.isAvailable()) {
        UsbDeviceHandler = UsbDeviceHandlerRust;
        console.log('[USBFXP] Using Rust native module for USB device handling');
    } else {
        throw new Error('Rust module not available');
    }
} catch (err) {
    // Fall back to JavaScript implementation
    UsbDeviceHandler = require('./usbDeviceHandler');
    console.log('[USBFXP] Using JavaScript implementation for USB device handling');
}

/**
 * USBFXP Server Manager
 * 
 * Manages the embedded USB2SNES/FXP WebSocket server that implements the SD2SNES protocol.
 * The server listens on a configurable port and handles USB2SNES client connections.
 */
class UsbfxpServer extends EventEmitter {
  constructor() {
    super();
    this.wss = null;
    this.server = null;
    this.port = null;
    this.desired = false;
    this.retryTimer = null;
    this.retryCount = 0;
    this.maxRetries = Infinity; // Will retry indefinitely every 15 seconds as long as desired is true
    this.config = null;
    this.consoleHistory = [];
    this.maxHistorySize = 100;
    this.clients = new Map(); // Track connected WebSocket clients
    this.usbDevices = []; // Track connected USB devices
    this.deviceHandlers = new Map(); // Map of device handlers keyed by device info
    
    this.state = {
      running: false,
      desired: false,
      status: 'stopped',
      health: 'red',
      port: null,
      lastError: '',
      lastChange: '',
      clientCount: 0,
      deviceCount: 0
    };
  }

  _addHistoryEntry(event, message, exitCode = null, details = null) {
    const entry = {
      timestamp: new Date().toISOString(),
      event, // 'start', 'stop', 'error', 'client-connect', 'client-disconnect', 'port-in-use', 'retry'
      message,
      exitCode,
      details
    };
    this.consoleHistory.push(entry);
    
    // Limit history size
    if (this.consoleHistory.length > this.maxHistorySize) {
      this.consoleHistory.shift();
    }
    
    this.emit('history-update', this.consoleHistory);
  }

  getConsoleHistory() {
    return [...this.consoleHistory]; // Return a copy
  }

  getStatus() {
    return {
      running: this.state.running,
      desired: this.state.desired,
      status: this.state.status,
      health: this.state.health,
      port: this.state.port,
      lastError: this.state.lastError,
      lastChange: this.state.lastChange,
      clientCount: this.state.clientCount,
      deviceCount: this.state.deviceCount
    };
  }

  async start(config = {}) {
    this.config = this._normalizeConfig(config);
    this.desired = true;
    this.retryCount = 0;
    this._clearRetryTimer();

    const result = await this._launch(true);
    return result;
  }

  async _launch(isManualStart) {
    if (!this.config) {
      throw new Error('Server configuration not provided.');
    }

    // Stop existing server if running
    if (this.wss) {
      this._stopServer();
    }

    const port = this.config.port;
    this.port = port;
    this._addHistoryEntry('start', `Starting USBFXP server on port ${port}${isManualStart ? '' : ' (auto-retry)'}`, null, { port });
    
    this._updateStatus({
      running: false,
      desired: true,
      status: 'starting',
      health: 'yellow',
      port: port,
      lastError: '',
      lastChange: new Date().toISOString()
    });

    return new Promise((resolve, reject) => {
      let resolved = false;

      try {
        // Create HTTP server for WebSocket upgrade
        const http = require('http');
        this.server = http.createServer();
        
        // Create WebSocket server
        this.wss = new WebSocket.Server({
          server: this.server,
          path: '/'
        });

        // Handle WebSocket connections
        this.wss.on('connection', (ws, req) => {
          this._handleClientConnection(ws, req);
        });

        this.wss.on('error', (error) => {
          this._addHistoryEntry('error', `WebSocket server error: ${error.message}`, null, { error: error.message });
          this._updateStatus({
            running: false,
            desired: this.desired,
            status: 'error',
            health: 'red',
            lastError: error.message,
            lastChange: new Date().toISOString()
          });
          
          if (!resolved) {
            resolved = true;
            reject(error);
          }
        });

        // Start listening
        this.server.listen(port, 'localhost', () => {
          this.retryCount = 0;
          this._addHistoryEntry('start', `USBFXP server started successfully on port ${port}`, 0, { port });
          this._updateStatus({
            running: true,
            desired: true,
            status: 'running',
            health: 'green',
            port: port,
            lastError: '',
            lastChange: new Date().toISOString()
          });
          
          // Scan for USB devices
          this._scanUsbDevices();
          
          if (!resolved) {
            resolved = true;
            resolve({ success: true, manual: isManualStart, status: this.getStatus() });
          }
        });

        this.server.on('error', (error) => {
          // Check if it's a port already in use error
          if (error.code === 'EADDRINUSE') {
            this._addHistoryEntry('port-in-use', `Port ${port} is already in use`, null, { port, error: error.code });
            this._updateStatus({
              running: false,
              desired: this.desired,
              status: 'port-in-use',
              health: 'yellow',
              port: port,
              lastError: `Port ${port} is already in use`,
              lastChange: new Date().toISOString()
            });

            // If we still want the server running, schedule a retry
            if (this.desired) {
              this._scheduleRetry();
            }
            
            if (!resolved) {
              resolved = true;
              reject(new Error(`Port ${port} is already in use`));
            }
          } else {
            this._addHistoryEntry('error', `Server error: ${error.message}`, null, { error: error.message, code: error.code });
            this._updateStatus({
              running: false,
              desired: this.desired,
              status: 'error',
              health: 'red',
              port: port,
              lastError: error.message,
              lastChange: new Date().toISOString()
            });
            
            if (!resolved) {
              resolved = true;
              reject(error);
            }
          }
        });

      } catch (error) {
        if (!resolved) {
          resolved = true;
          this._addHistoryEntry('error', `Failed to start server: ${error.message}`, null, { error: error.message });
          this._updateStatus({
            running: false,
            desired: false,
            status: 'error',
            health: 'red',
            lastError: error.message,
            lastChange: new Date().toISOString()
          });
          reject(error);
        }
      }
    });
  }

  _handleClientConnection(ws, req) {
    const clientId = `${Date.now()}-${Math.random()}`;
    this.clients.set(clientId, {
      ws,
      connected: true,
      connectedAt: new Date(),
      req
    });
    
    this._updateClientCount();
    this._addHistoryEntry('client-connect', `Client connected from ${req.socket.remoteAddress}`, null, { clientId, address: req.socket.remoteAddress });
    
    // Check if diversion mode is enabled
    if (this.config && (this.config.diversionMode === 'always' || this.config.diversionMode === 'fallback')) {
      // Relay mode - forward connection to target
      this._handleDiversionConnection(clientId, ws, req);
      return;
    }
    
    // Normal mode - handle protocol locally
    // Handle incoming messages (both JSON and binary)
    // Set up message handler immediately
    
    ws.on('message', async (data, isBinary) => {
      try {
        // Debug: Log what we received
        const dataSize = Buffer.isBuffer(data) ? data.length : (typeof data === 'string' ? data.length : data.toString().length);
        this._addHistoryEntry('ws-message', `Received WebSocket message: ${dataSize} bytes, isBinary: ${isBinary}`, null, { 
          clientId,
          size: dataSize,
          isBinary: isBinary || false,
          dataType: Buffer.isBuffer(data) ? 'Buffer' : typeof data
        });
        
        // Convert to string first - DeviceList and most protocol messages are JSON text
        let messageText;
        if (Buffer.isBuffer(data)) {
          messageText = data.toString('utf8');
        } else if (typeof data === 'string') {
          messageText = data;
        } else {
          messageText = String(data);
        }
        
        this._addHistoryEntry('ws-json', `Attempting to parse JSON message: ${messageText.substring(0, 200)}`, null, { clientId });
        
        // Try to parse as JSON first
        try {
          const message = JSON.parse(messageText);
          this._addHistoryEntry('ws-json-parsed', `Parsed message opcode: ${message.Opcode}`, null, { clientId, opcode: message.Opcode });
          await this._handleClientMessage(clientId, message);
        } catch (parseError) {
          // If JSON parsing fails and message is marked as binary, treat as binary
          if (parseError instanceof SyntaxError && (isBinary === true || Buffer.isBuffer(data))) {
            this._addHistoryEntry('ws-binary', `Treating as binary message after JSON parse failed`, null, { clientId });
            this._handleBinaryMessage(clientId, data);
          } else {
            // JSON parse error on text message - this is a real error
            this._addHistoryEntry('ws-json-error', `JSON parse error: ${parseError.message}, data: ${messageText.substring(0, 100)}`, null, { 
              clientId, 
              error: parseError.message,
              data: messageText.substring(0, 100)
            });
            throw parseError;
          }
        }
      } catch (error) {
        // Handle any other errors
        this._addHistoryEntry('error', `Error processing client message: ${error.message}`, null, { 
          clientId, 
          error: error.message, 
          stack: error.stack,
          errorType: error.constructor.name
        });
        
        // Send error response
        const client = this.clients.get(clientId);
        if (client && client.ws && client.ws.readyState === WebSocket.OPEN) {
          try {
            const errorResponse = JSON.stringify({ Results: [], status: 'error', message: error.message });
            client.ws.send(errorResponse);
            this._addHistoryEntry('error-sent', `Sent error response to client`, null, { clientId });
          } catch (sendError) {
            this._addHistoryEntry('error-send-failed', `Failed to send error response: ${sendError.message}`, null, { clientId, error: sendError.message });
          }
        }
      }
    });
    
    // Handle client disconnect
    ws.on('close', async () => {
      const client = this.clients.get(clientId);
      if (client) {
        // Clean up target WebSocket if in relay mode
        if (client.targetWs && client.targetWs.readyState === WebSocket.OPEN) {
          client.targetWs.close();
        }
        client.targetWs = null;
        
        // Clean up device handler if this was the last client for this device
        if (client.deviceKey) {
          // Check if any other client is using this device
          let deviceInUse = false;
          for (const [otherId, otherClient] of this.clients.entries()) {
            if (otherId !== clientId && otherClient.deviceKey === client.deviceKey) {
              deviceInUse = true;
              break;
            }
          }
          
          // If no other client is using the device, close it
          if (!deviceInUse && this.deviceHandlers.has(client.deviceKey)) {
            const handler = this.deviceHandlers.get(client.deviceKey);
            await handler.closeDevice();
            this.deviceHandlers.delete(client.deviceKey);
          }
        }
      }
      
      this.clients.delete(clientId);
      this._updateClientCount();
      this._addHistoryEntry('client-disconnect', `Client disconnected`, null, { clientId });
    });
    
    ws.on('error', (error) => {
      this._addHistoryEntry('error', `Client WebSocket error: ${error.message}`, null, { clientId, error: error.message });
    });
  }

  /**
   * Start bidirectional WebSocket relay
   * @private
   */
  _startWebSocketRelay(clientId, ws, targetWs) {
    const client = this.clients.get(clientId);
    if (!client) return;

    // Remove any existing message listeners on ws to avoid duplicates
    ws.removeAllListeners('message');

    // Forward WebSocket messages from client to target
    ws.on('message', (data, isBinary) => {
      if (targetWs && targetWs.readyState === WebSocket.OPEN) {
        try {
          // Forward as binary or text based on original message type
          if (isBinary || Buffer.isBuffer(data)) {
            targetWs.send(data, { binary: true });
          } else {
            targetWs.send(data);
          }
        } catch (error) {
          this._addHistoryEntry('error', `Error forwarding message to target: ${error.message}`, null, { clientId, error: error.message });
        }
      }
    });

    // Forward messages from target to client
    targetWs.on('message', (data, isBinary) => {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          // Forward as binary or text based on original message type
          if (isBinary || Buffer.isBuffer(data)) {
            ws.send(data, { binary: true });
          } else {
            ws.send(data);
          }
        } catch (error) {
          this._addHistoryEntry('error', `Error forwarding message to client: ${error.message}`, null, { clientId, error: error.message });
        }
      }
    });

    this._addHistoryEntry('diversion-relay', 'Bidirectional WebSocket relay started', null, { clientId });
  }

  /**
   * Generate WebSocket key for handshake
   * @private
   */
  _generateWebSocketKey() {
    const crypto = require('crypto');
    return crypto.randomBytes(16).toString('base64');
  }

  /**
   * Parse flags array into numeric flag value
   * @private
   */
  _parseFlags(flagsArray) {
    if (!Array.isArray(flagsArray)) return 0;
    // Flags are typically string names like "DATA64B", "STREAM_BURST", etc.
    // For now, we'll map common flags to their numeric values
    // STREAM_BURST = 16 (0x10), DATA64B = 128 (0x80), etc.
    let flags = 0;
    for (const flag of flagsArray) {
      if (typeof flag === 'string') {
        if (flag === 'STREAM_BURST') flags |= 16;
        else if (flag === 'DATA64B') flags |= 128;
        else if (flag === 'NORESP') flags |= 64;
        else if (flag === 'SKIPRESET') flags |= 1;
        else if (flag === 'ONLYRESET') flags |= 2;
      }
    }
    return flags;
  }

  async _handleClientMessage(clientId, message) {
    // Log the message
    this._addHistoryEntry('client-message', `Received message from client: ${message.Opcode || 'unknown'}`, null, { clientId, opcode: message.Opcode });
    
    const client = this.clients.get(clientId);
    if (!client || !client.ws) return;
    
    // Handle different opcodes
    const opcode = message.Opcode;
    let response = null;
    
    // Ensure client has a message queue for binary data
    if (!client.messageQueue) {
      client.messageQueue = [];
      client.binaryBuffer = Buffer.alloc(0);
    }
    
    if (opcode === 'DeviceList') {
      // DeviceList should return an array of device name strings
      // Refresh USB device list
      this._scanUsbDevices();
      
      // Return device names as strings
      const deviceNames = this.usbDevices.map((device, index) => {
        if (device.vendorId === 0x1209 && device.productId === 0x5a22) {
          return 'SD2SNES'; // Standard name that matches client detection
        }
        return `USB2SNES_${index}`;
      });
      
      response = {
        Results: deviceNames.length > 0 ? deviceNames : []
      };
      
      this._addHistoryEntry('device-list', `Returning ${deviceNames.length} device(s) to client`, null, { 
        clientId,
        deviceCount: deviceNames.length,
        deviceNames 
      });
      
      // Send response immediately
      if (client && client.ws && client.ws.readyState === WebSocket.OPEN) {
        try {
          const responseJson = JSON.stringify(response);
          client.ws.send(responseJson);
          this._addHistoryEntry('device-list-sent', `DeviceList response sent to client`, null, { 
            clientId,
            responseLength: responseJson.length,
            deviceCount: deviceNames.length
          });
        } catch (sendError) {
          this._addHistoryEntry('error', `Failed to send DeviceList response: ${sendError.message}`, null, { 
            clientId,
            error: sendError.message 
          });
        }
        return; // Already sent response, don't send again
      }
    } else if (opcode === 'Attach') {
      // Attach to a specific device
      const operands = message.Operands || [];
      const deviceName = operands[0];
      
      if (!deviceName || typeof deviceName !== 'string') {
        response = {
          Results: [],
          status: 'error',
          message: 'Invalid device name'
        };
      } else {
        const deviceIndex = this.usbDevices.findIndex((dev, idx) => {
          if (deviceName === 'SD2SNES' && dev.vendorId === 0x1209 && dev.productId === 0x5a22) {
            return true;
          }
          return `USB2SNES_${idx}` === deviceName;
        });
        
        if (deviceIndex >= 0) {
          // Store attached device for this client
          const deviceInfo = this.usbDevices[deviceIndex];
          client.attachedDevice = deviceInfo;
          
          // Get or create device handler
          const deviceKey = `${deviceInfo.vendorId}-${deviceInfo.productId}-${deviceIndex}`;
          if (!this.deviceHandlers.has(deviceKey)) {
            // Check if dummy device mode is enabled
            const useDummy = this.config?.useDummyDevice || false;
            const handler = new UsbDeviceHandler(useDummy);
            this.deviceHandlers.set(deviceKey, handler);
            
            // Open device connection and wait for it to complete
            try {
              this._addHistoryEntry('device-opening', `Opening device connection...`, null, { clientId, deviceKey });
              await handler.openDevice(deviceInfo);
              this._addHistoryEntry('device-opened', `Device opened successfully`, null, { clientId, deviceKey });
            } catch (error) {
              this._addHistoryEntry('error', `Failed to open device: ${error.message}`, null, { error: error.message, deviceKey });
              // Remove handler if open failed
              this.deviceHandlers.delete(deviceKey);
            }
          }
          
          const handler = this.deviceHandlers.get(deviceKey);
          if (!handler) {
            response = {
              Results: [],
              status: 'error',
              message: 'Failed to create device handler'
            };
            this._addHistoryEntry('device-handler-error', `No handler available`, null, { clientId, deviceKey });
          } else {
            client.deviceHandler = handler;
            client.deviceKey = deviceKey;
            
            response = {
              Results: [deviceName],
              status: 'ok'
            };
            this._addHistoryEntry('device-attach', `Client attached to device: ${deviceName}`, null, { 
              clientId, 
              deviceName,
              deviceIndex 
            });
          }
        } else {
          response = {
            Results: [],
            status: 'error',
            message: `Device not found: ${deviceName}`
          };
          this._addHistoryEntry('device-attach-error', `Failed to attach to device: ${deviceName}`, null, { 
            clientId, 
            deviceName 
          });
        }
      }
    } else if (opcode === 'Info') {
      // Return device info - Results is array of strings: [firmwareversion, versionstring, romrunning, flag1, flag2]
      const deviceHandler = client.deviceHandler;
      this._addHistoryEntry('info-start', `Info command received, deviceHandler: ${!!deviceHandler}, isOpen: ${deviceHandler?.isOpen}`, null, { clientId });
      
      if (!deviceHandler) {
        response = {
          Results: [],
          status: 'error',
          message: 'No device handler - device not attached'
        };
        this._addHistoryEntry('info-error', `No device handler`, null, { clientId });
      } else if (!deviceHandler.isOpen) {
        // Device handler exists but not open yet - wait for it
        this._addHistoryEntry('info-waiting', `Device not open yet, waiting...`, null, { clientId });
        
        // Wait for device to open (with timeout)
        let waited = 0;
        while (!deviceHandler.isOpen && waited < 5000) {
          await new Promise(resolve => setTimeout(resolve, 100));
          waited += 100;
        }
        
        if (!deviceHandler.isOpen) {
          response = {
            Results: [
              'N/A',
              'USBFXP Embedded Server',
              'N/A',
              '',
              ''
            ]
          };
          this._addHistoryEntry('info-timeout', `Device did not open within 5 seconds`, null, { clientId });
        }
      }
      
      if (!response && deviceHandler && deviceHandler.isOpen) {
        try {
          this._addHistoryEntry('info-calling', `Calling deviceHandler.getInfo()...`, null, { clientId });
          const info = await deviceHandler.getInfo();
          this._addHistoryEntry('info-received', `Received info from device`, null, { 
            clientId,
            firmwareversion: info.firmwareversion,
            versionstring: info.versionstring,
            romrunning: info.romrunning
          });
          
          response = {
            Results: [
              info.firmwareversion || 'N/A',
              info.versionstring || 'N/A',
              info.romrunning || 'N/A',
              info.flag1 || '',
              info.flag2 || ''
            ]
          };
        } catch (error) {
          this._addHistoryEntry('error', `GetInfo error: ${error.message}`, null, { 
            clientId, 
            error: error.message,
            stack: error.stack
          });
          response = {
            Results: [
              'N/A',
              'USBFXP Embedded Server',
              'N/A',
              '',
              ''
            ]
          };
        }
      }
      
      if (!response) {
        response = {
          Results: [],
          status: 'error',
          message: 'No device attached'
        };
      }
    } else if (opcode === 'Name') {
      // Set client name - no response needed, but acknowledge
      const operands = message.Operands || [];
      const name = operands[0] || 'Unknown';
      client.name = name;
      response = {
        Results: []
      };
      this._addHistoryEntry('client-name', `Client set name: ${name}`, null, { clientId, name });
    } else if (opcode === 'Boot') {
      // Boot ROM file
      const operands = message.Operands || [];
      const romPath = operands[0];
      const deviceHandler = client.deviceHandler;
      if (!deviceHandler || !deviceHandler.isOpen) {
        response = {
          Results: [],
          status: 'error',
          message: 'No device attached'
        };
      } else {
        try {
          await deviceHandler.boot(romPath);
          response = {
            Results: []
          };
          this._addHistoryEntry('boot', `Boot command: ${romPath}`, null, { clientId, romPath });
        } catch (error) {
          response = {
            Results: [],
            status: 'error',
            message: `Boot failed: ${error.message}`
          };
          this._addHistoryEntry('error', `Boot error: ${error.message}`, null, { clientId, romPath, error: error.message });
        }
      }
    } else if (opcode === 'Menu') {
      // Return to menu
      const deviceHandler = client.deviceHandler;
      if (!deviceHandler || !deviceHandler.isOpen) {
        response = {
          Results: [],
          status: 'error',
          message: 'No device attached'
        };
      } else {
        try {
          await deviceHandler.menu();
          response = {
            Results: []
          };
          this._addHistoryEntry('menu', `Menu command`, null, { clientId });
        } catch (error) {
          response = {
            Results: [],
            status: 'error',
            message: `Menu failed: ${error.message}`
          };
          this._addHistoryEntry('error', `Menu error: ${error.message}`, null, { clientId, error: error.message });
        }
      }
    } else if (opcode === 'Reset') {
      // Reset console
      const deviceHandler = client.deviceHandler;
      if (!deviceHandler || !deviceHandler.isOpen) {
        response = {
          Results: [],
          status: 'error',
          message: 'No device attached'
        };
      } else {
        try {
          // CRITICAL: Reset opcode should be sent to the SNES device, NOT connection reset!
          // From C# Scheduler.cs line 790: opcode2 = 8; (RESET opcode)
          // From C# Scheduler.cs line 868: SendCommand(opcode2, usbint_server_space_e.FILE, flags1)
          // From C# Scheduler.cs line 921: flags1 |= usbint_server_flags_e.NORESP (flag 64)
          // So we send: opcode 8 (RESET), space 0 (FILE), flags 64 (NORESP)
          
          this._addHistoryEntry('reset-start', `Sending RESET opcode to SNES device (opcode 8, space FILE, flags NORESP)`, null, { clientId });
          
          // Send response immediately (matching C# behavior)
          response = {
            Results: []
          };
          
          // Send response first (before sending command to device)
          client.ws.send(JSON.stringify(response));
          this._addHistoryEntry('reset', `Reset command response sent`, null, { clientId });
          
          // Execute RESET opcode command asynchronously (don't block)
          // This sends the RESET opcode (8) to the SNES device, not a connection reset
          deviceHandler._sendCommandPacket(
            deviceHandler.OPCODES.RESET, // opcode 8
            deviceHandler.SPACES.FILE,   // space 0
            deviceHandler.FLAGS.NORESP,  // flag 64 - no response expected
            []
          ).then(() => {
            this._addHistoryEntry('reset-complete', `RESET opcode sent to SNES device`, null, { clientId });
          }).catch((resetError) => {
            this._addHistoryEntry('reset-error', `Reset opcode error: ${resetError.message}`, null, { 
              clientId, 
              error: resetError.message 
            });
          });
          
          return; // Already sent response
        } catch (error) {
          response = {
            Results: [],
            status: 'error',
            message: `Reset failed: ${error.message}`
          };
          this._addHistoryEntry('error', `Reset error: ${error.message}`, null, { clientId, error: error.message });
        }
      }
    } else if (opcode === 'GetAddress') {
      // Read memory
      const operands = message.Operands || [];
      const deviceHandler = client.deviceHandler;
      if (!deviceHandler || !deviceHandler.isOpen) {
        response = {
          Results: [],
          status: 'error',
          message: 'No device attached'
        };
      } else if (operands.length < 2) {
        response = {
          Results: [],
          status: 'error',
          message: 'Invalid GetAddress operands'
        };
      } else {
        try {
          // Parse address and size from operands
          const address = parseInt(operands[0], 16);
          const size = parseInt(operands[1], 16);
          
          // Read from USB device
          const data = await deviceHandler.readMemory(address, size);
          
          response = {
            Results: []
          };
          // Send JSON response first, then binary data
          client.ws.send(JSON.stringify(response));
          
          // Send binary data
          client.ws.send(data);
          
          this._addHistoryEntry('get-address', `GetAddress: ${address.toString(16)}, size: ${size}`, null, { clientId, address, size });
          return; // Already sent response
        } catch (error) {
          response = {
            Results: [],
            status: 'error',
            message: `GetAddress failed: ${error.message}`
          };
          this._addHistoryEntry('error', `GetAddress error: ${error.message}`, null, { clientId, error: error.message });
        }
      }
    } else if (opcode === 'PutAddress') {
      // Write memory - client will send binary data after this message
      const operands = message.Operands || [];
      const deviceHandler = client.deviceHandler;
      if (!deviceHandler || !deviceHandler.isOpen) {
        response = {
          Results: [],
          status: 'error',
          message: 'No device attached'
        };
      } else {
        // Parse address and size from operands
        const address = operands[0] ? parseInt(operands[0], 16) : null;
        const size = operands[1] ? parseInt(operands[1], 16) : null;
        
        // Mark that we're expecting binary data
        if (message.Space === 'CMD') {
          // SD2SNES CMD space - special handling
          client.pendingPutAddress = { type: 'CMD', operands, data: null, handler: deviceHandler };
        } else {
          // SNES space
          client.pendingPutAddress = { type: 'SNES', address, size, data: null, handler: deviceHandler };
        }
        
        response = {
          Results: []
        };
        this._addHistoryEntry('put-address', `PutAddress: ${address ? address.toString(16) : 'CMD'}, size: ${size || 'unknown'}`, null, { clientId, address, size, space: message.Space });
        // Binary data will arrive in next message
      }
    } else if (opcode === 'GetFile') {
      // Download file - first response contains file size in hex
      const operands = message.Operands || [];
      const filePath = operands[0];
      const deviceHandler = client.deviceHandler;
      if (!deviceHandler || !deviceHandler.isOpen) {
        response = {
          Results: [],
          status: 'error',
          message: 'No device attached'
        };
      } else {
        try {
          // Get file from USB device
          const fileData = await deviceHandler.getFile(filePath);
          
          // Send size first
          response = {
            Results: [fileData.length.toString(16)]
          };
          client.ws.send(JSON.stringify(response));
          
          // Send binary data
          client.ws.send(fileData);
          
          this._addHistoryEntry('get-file', `GetFile: ${filePath}, size: ${fileData.length}`, null, { clientId, filePath, size: fileData.length });
          return; // Already sent response
        } catch (error) {
          response = {
            Results: [],
            status: 'error',
            message: `GetFile failed: ${error.message}`
          };
          this._addHistoryEntry('error', `GetFile error: ${error.message}`, null, { clientId, filePath, error: error.message });
        }
      }
    } else if (opcode === 'PutFile') {
      // Upload file - client will send binary data after this message
      const operands = message.Operands || [];
      const filePath = operands[0];
      const fileSize = operands[1] ? parseInt(operands[1], 16) : 0;
      const deviceHandler = client.deviceHandler;
      if (!deviceHandler || !deviceHandler.isOpen) {
        response = {
          Results: [],
          status: 'error',
          message: 'No device attached'
        };
      } else {
        // Mark that we're expecting binary data
        client.pendingPutFile = { filePath, fileSize, receivedSize: 0, data: Buffer.alloc(0), handler: deviceHandler };
        response = {
          Results: []
        };
        this._addHistoryEntry('put-file', `PutFile: ${filePath}, size: ${fileSize}`, null, { clientId, filePath, size: fileSize });
        // Binary data will arrive in next messages
      }
    } else if (opcode === 'List') {
      // List directory - return array of [type, filename] pairs
      const operands = message.Operands || [];
      const dirPath = operands[0] || '/';
      const deviceHandler = client.deviceHandler;
      if (!deviceHandler || !deviceHandler.isOpen) {
        response = {
          Results: [],
          status: 'error',
          message: 'No device attached'
        };
      } else {
        try {
          // List directory from USB device
          const files = await deviceHandler.listDirectory(dirPath);
          
          // Format: [type, filename, type, filename, ...]
          const results = [];
          for (const file of files) {
            if (file.filename !== '.' && file.filename !== '..') {
              results.push(file.type);
              results.push(file.filename);
            }
          }
          
          response = {
            Results: results
          };
          this._addHistoryEntry('list', `List: ${dirPath}, ${files.length} items`, null, { clientId, dirPath, itemCount: files.length });
        } catch (error) {
          response = {
            Results: [],
            status: 'error',
            message: `List failed: ${error.message}`
          };
          this._addHistoryEntry('error', `List error: ${error.message}`, null, { clientId, dirPath, error: error.message });
        }
      }
    } else if (opcode === 'MakeDir') {
      // Create directory - fire and forget, no response expected
      const operands = message.Operands || [];
      const dirPath = operands[0];
      const deviceHandler = client.deviceHandler;
      if (!deviceHandler || !deviceHandler.isOpen) {
        response = {
          Results: [],
          status: 'error',
          message: 'No device attached'
        };
      } else {
        try {
          // Create directory on USB device
          await deviceHandler.makeDirectory(dirPath);
          this._addHistoryEntry('make-dir', `MakeDir: ${dirPath}`, null, { clientId, dirPath });
        } catch (error) {
          this._addHistoryEntry('error', `MakeDir error: ${error.message}`, null, { clientId, dirPath, error: error.message });
        }
        // Don't send response - protocol expects no response for MakeDir
        return;
      }
    } else if (opcode === 'Remove') {
      // Remove file/directory
      const operands = message.Operands || [];
      const path = operands[0];
      const deviceHandler = client.deviceHandler;
      if (!deviceHandler || !deviceHandler.isOpen) {
        response = {
          Results: [],
          status: 'error',
          message: 'No device attached'
        };
      } else {
        try {
          // Remove file/directory on USB device
          await deviceHandler.remove(path);
          response = {
            Results: []
          };
          this._addHistoryEntry('remove', `Remove: ${path}`, null, { clientId, path });
        } catch (error) {
          response = {
            Results: [],
            status: 'error',
            message: `Remove failed: ${error.message}`
          };
          this._addHistoryEntry('error', `Remove error: ${error.message}`, null, { clientId, path, error: error.message });
        }
      }
    } else if (opcode === 'AppVersion') {
      // Return application version
      const packageJson = require('../../package.json');
      const version = packageJson.version || '0.1.0beta';
      response = {
        Results: [version]
      };
      this._addHistoryEntry('app-version', `AppVersion: ${version}`, null, { clientId, version });
    } else if (opcode === 'Stream') {
      // Stream data from MSU space
      const deviceHandler = client.deviceHandler;
      if (!deviceHandler || !deviceHandler.isOpen) {
        response = {
          Results: [],
          status: 'error',
          message: 'No device attached'
        };
      } else {
        try {
          // Stream reads from MSU space, sends data in chunks
          // Flags may include STREAM_BURST
          const flags = this._parseFlags(message.Flags || []);
          const streamBurst = (flags & 16) !== 0; // STREAM_BURST flag
          
          const streamData = await deviceHandler.stream(streamBurst);
          
          // Send size first
          response = {
            Results: [streamData.length.toString(16)]
          };
          client.ws.send(JSON.stringify(response));
          
          // Send binary data in chunks (64 bytes for STREAM_BURST, or all at once)
          if (streamBurst) {
            const chunkSize = 64;
            for (let offset = 0; offset < streamData.length; offset += chunkSize) {
              const chunk = streamData.slice(offset, Math.min(offset + chunkSize, streamData.length));
              client.ws.send(chunk);
            }
          } else {
            client.ws.send(streamData);
          }
          
          this._addHistoryEntry('stream', `Stream: ${streamData.length} bytes, burst=${streamBurst}`, null, { clientId, size: streamData.length, burst: streamBurst });
          return; // Already sent response
        } catch (error) {
          response = {
            Results: [],
            status: 'error',
            message: `Stream failed: ${error.message}`
          };
          this._addHistoryEntry('error', `Stream error: ${error.message}`, null, { clientId, error: error.message });
        }
      }
    } else if (opcode === 'Fence') {
      // Fence is a synchronization marker - just acknowledge
      response = {
        Results: []
      };
      this._addHistoryEntry('fence', `Fence synchronization`, null, { clientId });
    } else if (opcode === 'PutIPS') {
      // Apply IPS patch from file
      const operands = message.Operands || [];
      const ipsPath = operands[0];
      const deviceHandler = client.deviceHandler;
      if (!deviceHandler || !deviceHandler.isOpen) {
        response = {
          Results: [],
          status: 'error',
          message: 'No device attached'
        };
      } else if (!ipsPath) {
        response = {
          Results: [],
          status: 'error',
          message: 'IPS file path not provided'
        };
      } else {
        try {
          await deviceHandler.putIPS(ipsPath);
          response = {
            Results: []
          };
          this._addHistoryEntry('put-ips', `PutIPS: ${ipsPath}`, null, { clientId, ipsPath });
        } catch (error) {
          response = {
            Results: [],
            status: 'error',
            message: `PutIPS failed: ${error.message}`
          };
          this._addHistoryEntry('error', `PutIPS error: ${error.message}`, null, { clientId, ipsPath, error: error.message });
        }
      }
    } else if (opcode === 'Rename') {
      // Rename/move file
      const operands = message.Operands || [];
      const sourcePath = operands[0];
      const destPath = operands[1];
      const deviceHandler = client.deviceHandler;
      if (!deviceHandler || !deviceHandler.isOpen) {
        response = {
          Results: [],
          status: 'error',
          message: 'No device attached'
        };
      } else if (!sourcePath || !destPath) {
        response = {
          Results: [],
          status: 'error',
          message: 'Source and destination paths required'
        };
      } else {
        try {
          await deviceHandler.rename(sourcePath, destPath);
          response = {
            Results: []
          };
          this._addHistoryEntry('rename', `Rename: ${sourcePath} -> ${destPath}`, null, { clientId, sourcePath, destPath });
        } catch (error) {
          response = {
            Results: [],
            status: 'error',
            message: `Rename failed: ${error.message}`
          };
          this._addHistoryEntry('error', `Rename error: ${error.message}`, null, { clientId, sourcePath, destPath, error: error.message });
        }
      }
    } else if (opcode === 'Shutdown') {
      // Shutdown the server
      this._addHistoryEntry('shutdown', `Shutdown requested by client`, null, { clientId });
      response = {
        Results: []
      };
      client.ws.send(JSON.stringify(response));
      
      // Stop the server after short delay
      setTimeout(() => {
        this.stop().catch((error) => {
          this._addHistoryEntry('error', `Shutdown error: ${error.message}`, null, { error: error.message });
        });
      }, 100);
      
      return; // Already sent response
    } else {
      // Unknown opcode - return error
      response = {
        Results: [],
        status: 'error',
        message: `Opcode not implemented: ${opcode}`
      };
      this._addHistoryEntry('unknown-opcode', `Unhandled opcode: ${opcode}`, null, { opcode });
    }
    
    // Send response (unless MakeDir which expects no response)
    if (response && opcode !== 'MakeDir') {
      client.ws.send(JSON.stringify(response));
    }
  }

  _handleBinaryMessage(clientId, data) {
    const client = this.clients.get(clientId);
    if (!client || !client.ws) return;
    
    // Handle binary data based on pending operation
    if (client.pendingPutFile) {
      // Receiving file upload data
      const pending = client.pendingPutFile;
      pending.data = Buffer.concat([pending.data, data]);
      pending.receivedSize += data.length;
      
      this._addHistoryEntry('put-file-data', `Receiving file data: ${pending.receivedSize}/${pending.fileSize} bytes`, null, { 
        clientId, 
        filePath: pending.filePath,
        received: pending.receivedSize,
        total: pending.fileSize 
      });
      
      // Check if complete
      if (pending.receivedSize >= pending.fileSize) {
        // Write file to USB device
        pending.handler.putFile(pending.filePath, pending.data).then(() => {
          this._addHistoryEntry('put-file-complete', `File upload complete: ${pending.filePath}`, null, { 
            clientId, 
            filePath: pending.filePath,
            size: pending.receivedSize 
          });
        }).catch((error) => {
          this._addHistoryEntry('error', `PutFile write error: ${error.message}`, null, { 
            clientId, 
            filePath: pending.filePath,
            error: error.message 
          });
        });
        client.pendingPutFile = null;
      }
    } else if (client.pendingPutAddress) {
      // Receiving memory write data
      const pending = client.pendingPutAddress;
      if (!pending.data) {
        pending.data = Buffer.alloc(0);
      }
      pending.data = Buffer.concat([pending.data, data]);
      
      // Determine when data is complete
      if (pending.type === 'SNES' && pending.size && pending.data.length >= pending.size) {
        // Write memory to USB device
        const dataToWrite = pending.data.slice(0, pending.size);
        const handler = pending.handler;
        const address = pending.address;
        handler.writeMemory(address, dataToWrite).then(() => {
          this._addHistoryEntry('put-address-data', `Memory write complete: ${address.toString(16)}, ${dataToWrite.length} bytes`, null, { 
            clientId, 
            address: address,
            size: dataToWrite.length 
          });
        }).catch((error) => {
          this._addHistoryEntry('error', `PutAddress write error: ${error.message}`, null, { 
            clientId, 
            address: address,
            error: error.message 
          });
        });
        client.pendingPutAddress = null;
      } else if (pending.type === 'CMD') {
        // CMD space - special handling for SD2SNES
        // The data is already a complete CMD buffer
        try {
          // For CMD space, we need to send the command differently
          // Parse the CMD operands: ["2C00", size_hex, "2C00", "1"]
          const cmdAddress = parseInt(pending.operands[0], 16);
          const cmdSize = parseInt(pending.operands[1], 16);
          
          // Write CMD buffer to device at command address using CMD space
          pending.handler.writeMemoryCMD(cmdAddress, pending.data.slice(0, cmdSize)).then(() => {
            this._addHistoryEntry('put-address-data', `CMD write complete: ${pending.data.length} bytes`, null, { 
              clientId, 
              size: pending.data.length 
            });
          }).catch((error) => {
            this._addHistoryEntry('error', `CMD write error: ${error.message}`, null, { 
              clientId, 
              error: error.message 
            });
          });
        } catch (error) {
          this._addHistoryEntry('error', `CMD parse error: ${error.message}`, null, { 
            clientId, 
            error: error.message 
          });
        }
        client.pendingPutAddress = null;
      }
    } else {
      // Unexpected binary data - could be WebSocket control frames (ping/pong) or initial handshake
      // For small binary data (< 64 bytes), it's likely a control frame which we can ignore
      if (data.length < 64) {
        // Likely a WebSocket control frame - silently ignore
        // This prevents log spam from ping/pong frames
        return;
      }
      
      // Log larger unexpected binary data as it might be actual data we should handle
      this._addHistoryEntry('unexpected-binary', `Received unexpected binary data: ${data.length} bytes`, null, { 
        clientId, 
        size: data.length 
      });
    }
  }

  _scanUsbDevices() {
    try {
      // If dummy device mode is enabled, add a dummy device
      if (this.config?.useDummyDevice) {
        this.usbDevices = [{
          id: 0,
          device: null, // No actual USB device
          descriptor: null,
          vendorId: 0x1209,
          productId: 0x5a22,
          serialPort: null,
          isDummy: true
        }];
        
        this.state.deviceCount = 1;
        this._addHistoryEntry('device-scan', `Using dummy USB device for testing`, null, { 
          count: 1,
          dummy: true
        });
        return;
      }
      
      // Scan for SD2SNES/FXP devices
      // Known USB vendor/product IDs:
      // SD2SNES/FXPak Pro: VID 0x1209, PID 0x5a22 (Generic ikari_01 sd2snes)
      // Some variants may use different PIDs
      
      const devices = usb.getDeviceList();
      const snesDevices = devices.filter(device => {
        const descriptor = device.deviceDescriptor;
        // Check for known SD2SNES/FXP device IDs
        // VID 0x1209 is used by SD2SNES/FXPak Pro
        return (descriptor.idVendor === 0x1209 && descriptor.idProduct === 0x5a22);
      });
      
      this.usbDevices = snesDevices.map((device, index) => {
        const descriptor = device.deviceDescriptor;
        return {
          id: index,
          device: device,
          descriptor: descriptor,
          vendorId: descriptor.idVendor,
          productId: descriptor.idProduct,
          // Device appears as serial port /dev/ttyACM0 on Linux
          serialPort: `/dev/ttyACM${index}`, // Common mapping
          isDummy: false
        };
      });
      
      this.state.deviceCount = this.usbDevices.length;
      this._addHistoryEntry('device-scan', `Found ${this.usbDevices.length} USB device(s)`, null, { 
        count: this.usbDevices.length,
        devices: this.usbDevices.map(d => ({
          vid: `0x${d.vendorId.toString(16).padStart(4, '0')}`,
          pid: `0x${d.productId.toString(16).padStart(4, '0')}`
        }))
      });
      
      // Log device details for debugging
      if (this.usbDevices.length > 0) {
        this.usbDevices.forEach((dev, idx) => {
          console.log(`[USBFXP] Device ${idx}: VID=0x${dev.vendorId.toString(16).padStart(4, '0')}, PID=0x${dev.productId.toString(16).padStart(4, '0')}`);
        });
      }
      
    } catch (error) {
      this._addHistoryEntry('error', `Error scanning USB devices: ${error.message}`, null, { error: error.message });
      console.warn('[USBFXP] USB device scan error:', error);
      
      // On Linux, the device might appear as a serial port rather than raw USB
      // Check if it's a permissions issue or if we need to use serial port access
      if (process.platform === 'linux') {
        const fs = require('fs');
        try {
          // Check if /dev/ttyACM0 exists
          const serialPorts = ['/dev/ttyACM0', '/dev/ttyACM1', '/dev/ttyACM2'];
          const foundPorts = serialPorts.filter(port => {
            try {
              fs.accessSync(port, fs.constants.F_OK);
              return true;
            } catch {
              return false;
            }
          });
          
          if (foundPorts.length > 0) {
            this._addHistoryEntry('device-scan', `Found ${foundPorts.length} serial port(s): ${foundPorts.join(', ')}. Device may require serial port access instead of raw USB.`, null, { 
              ports: foundPorts,
              note: 'Device detected as serial port, may need serial library instead of raw USB'
            });
            console.log(`[USBFXP] Found serial ports: ${foundPorts.join(', ')}`);
          }
        } catch (serialError) {
          // Ignore serial port check errors
        }
      }
    }
  }

  /**
   * Handle diversion/relay connection
   * @private
   */
  async _handleDiversionConnection(clientId, ws, req) {
    const client = this.clients.get(clientId);
    if (!client) return;

    const diversionTarget = this.config.diversionTarget;
    if (!diversionTarget) {
      this._addHistoryEntry('error', 'Diversion target not configured', null, { clientId });
      ws.close(1000, 'Diversion target not configured');
      return;
    }

    // Parse target host:port
    const [targetHost, targetPortStr] = diversionTarget.split(':');
    const targetPort = parseInt(targetPortStr, 10);

    if (!targetHost || !targetPort || isNaN(targetPort)) {
      this._addHistoryEntry('error', `Invalid diversion target: ${diversionTarget}`, null, { clientId, target: diversionTarget });
      ws.close(1000, `Invalid diversion target: ${diversionTarget}`);
      return;
    }

    this._addHistoryEntry('diversion-start', `Attempting to relay connection to ${diversionTarget}`, null, { clientId, target: diversionTarget });

    try {
      // Create WebSocket connection to target (with optional SOCKS proxy)
      // This allows us to properly relay WebSocket frames
      const targetWsUrl = `ws://${targetHost}:${targetPort}/`;
      let targetWsOptions = {
        perMessageDeflate: false
      };

      // Use SOCKS proxy for WebSocket connection if configured
      if (this.config.diversionUseSocks && this.config.diversionSocksProxyUrl) {
        try {
          const { SocksProxyAgent } = require('socks-proxy-agent');
          targetWsOptions.agent = new SocksProxyAgent(this.config.diversionSocksProxyUrl);
          this._addHistoryEntry('diversion-socks', `Using SOCKS proxy for WebSocket connection to ${diversionTarget}`, null, { clientId, target: diversionTarget });
        } catch (socksError) {
          this._addHistoryEntry('error', `Failed to create SOCKS agent: ${socksError.message}`, null, { clientId, error: socksError.message });
          
          if (this.config.diversionMode === 'fallback') {
            this._addHistoryEntry('diversion-fallback', 'Falling back to local USB handling', null, { clientId });
            this._handleLocalUsbConnection(clientId, ws, req);
            return;
          } else {
            ws.close(1000, `SOCKS proxy setup failed: ${socksError.message}`);
            return;
          }
        }
      }

      // Create WebSocket connection to target
      try {
        const targetWs = new WebSocket(targetWsUrl, targetWsOptions);
        
        // Store target WebSocket in client object
        client.targetWs = targetWs;
        client.relayMode = true;

        targetWs.on('open', () => {
          this._addHistoryEntry('diversion-connected', `WebSocket connected to ${diversionTarget}`, null, { clientId, target: diversionTarget });
          
          // Start bidirectional relay
          this._startWebSocketRelay(clientId, ws, targetWs);
        });

        targetWs.on('error', (error) => {
          this._addHistoryEntry('error', `Target WebSocket error: ${error.message}`, null, { clientId, error: error.message });
          
          if (ws.readyState === WebSocket.OPEN) {
            if (this.config.diversionMode === 'fallback') {
              targetWs.close();
              this._handleLocalUsbConnection(clientId, ws, req);
            } else {
              ws.close(1006, `Target connection error: ${error.message}`);
            }
          }
        });

        targetWs.on('close', () => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.close(1000, 'Target connection closed');
          }
          if (client) {
            client.targetWs = null;
          }
        });

        // Handle WebSocket close
        ws.on('close', () => {
          if (targetWs && targetWs.readyState === WebSocket.OPEN) {
            targetWs.close();
          }
        });

        // Connection timeout
        setTimeout(() => {
          if (targetWs.readyState === WebSocket.CONNECTING) {
            targetWs.close();
            this._addHistoryEntry('error', `Connection timeout to ${diversionTarget}`, null, { clientId, target: diversionTarget });
            
            if (this.config.diversionMode === 'fallback') {
              this._handleLocalUsbConnection(clientId, ws, req);
            } else {
              ws.close(1006, 'Connection timeout');
            }
          }
        }, 5000);

      } catch (wsError) {
        this._addHistoryEntry('error', `Failed to create WebSocket connection: ${wsError.message}`, null, { clientId, error: wsError.message });
        
        if (this.config.diversionMode === 'fallback') {
          this._addHistoryEntry('diversion-fallback', 'Falling back to local USB handling', null, { clientId });
          this._handleLocalUsbConnection(clientId, ws, req);
        } else {
          ws.close(1000, `Connection error: ${wsError.message}`);
        }
      }

    } catch (error) {
      this._addHistoryEntry('error', `Diversion connection error: ${error.message}`, null, { clientId, error: error.message });
      
      if (this.config.diversionMode === 'fallback') {
        this._addHistoryEntry('diversion-fallback', 'Falling back to local USB handling', null, { clientId });
        this._handleLocalUsbConnection(clientId, ws, req);
      } else {
        ws.close(1000, `Connection error: ${error.message}`);
      }
    }
  }

  /**
   * Handle local USB connection (fallback or normal mode)
   * @private
   */
  _handleLocalUsbConnection(clientId, ws, req) {
    const client = this.clients.get(clientId);
    if (!client) return;

    // Remove relay mode flag if set
    client.relayMode = false;
    client.targetWs = null;

    // Set up normal protocol handling
    // Handle incoming messages (both JSON and binary)
    ws.on('message', async (data) => {
      try {
        // Check if message is binary or text
        if (Buffer.isBuffer(data)) {
          // Binary data - handle based on pending operation
          this._handleBinaryMessage(clientId, data);
        } else {
          // Text/JSON message
          const message = JSON.parse(data.toString());
          await this._handleClientMessage(clientId, message);
        }
      } catch (error) {
        this._addHistoryEntry('error', `Error processing client message: ${error.message}`, null, { clientId, error: error.message });
        // Send error response
        if (client && client.ws && client.ws.readyState === WebSocket.OPEN) {
          try {
            client.ws.send(JSON.stringify({ Results: [{ status: 'error', error: error.message }] }));
          } catch (sendError) {
            // Ignore send errors
          }
        }
      }
    });
    
    // Handle client disconnect
    ws.on('close', async () => {
      const client = this.clients.get(clientId);
      if (client) {
        // Clean up device handler if this was the last client for this device
        if (client.deviceKey) {
          // Check if any other client is using this device
          let deviceInUse = false;
          for (const [otherId, otherClient] of this.clients.entries()) {
            if (otherId !== clientId && otherClient.deviceKey === client.deviceKey) {
              deviceInUse = true;
              break;
            }
          }
          
          // If no other client is using the device, close it
          if (!deviceInUse && this.deviceHandlers.has(client.deviceKey)) {
            const handler = this.deviceHandlers.get(client.deviceKey);
            await handler.closeDevice();
            this.deviceHandlers.delete(client.deviceKey);
          }
        }
      }
      
      this.clients.delete(clientId);
      this._updateClientCount();
      this._addHistoryEntry('client-disconnect', `Client disconnected (fallback)`, null, { clientId });
    });
    
    ws.on('error', (error) => {
      this._addHistoryEntry('error', `Client WebSocket error: ${error.message}`, null, { clientId, error: error.message });
    });

    this._addHistoryEntry('local-usb', 'Handling connection with local USB protocol', null, { clientId });
  }

  _scheduleRetry() {
    // Check if we should continue retrying (if desired is still true, keep retrying indefinitely)
    if (!this.desired) {
      this._addHistoryEntry('retry', 'Retry cancelled: server no longer desired', null, { retryCount: this.retryCount });
      return;
    }

    this._clearRetryTimer();
    this.retryCount += 1;
    const delayMs = 15000; // 15 seconds
    
    this._addHistoryEntry('retry', `Scheduling retry ${this.retryCount} in ${delayMs/1000} seconds (attempt ${this.retryCount})`, null, { retryCount: this.retryCount });
    this._updateStatus({
      running: false,
      desired: this.desired,
      status: 'retrying',
      health: 'yellow',
      lastError: `Port in use, retrying in ${delayMs/1000} seconds (attempt ${this.retryCount})`,
      lastChange: new Date().toISOString()
    });
    
    this.retryTimer = setTimeout(() => {
      this._launch(false).catch((error) => {
        this._addHistoryEntry('error', `Retry failed: ${error.message}`, null, { error: error.message, retryCount: this.retryCount });
        this._updateStatus({
          running: false,
          desired: this.desired,
          status: 'error',
          health: 'red',
          lastError: error.message,
          lastChange: new Date().toISOString()
        });
      });
    }, delayMs);
  }

  _clearRetryTimer() {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  stop() {
    this.desired = false;
    this.retryCount = 0;
    this._clearRetryTimer();

    this._stopServer();

    this._addHistoryEntry('stop', 'USBFXP server stopped by user', null, {});
    this._updateStatus({
      running: false,
      desired: false,
      status: 'stopped',
      health: 'red',
      lastError: '',
      port: null,
      clientCount: 0,
      lastChange: new Date().toISOString()
    });

    return { success: true, status: this.getStatus() };
  }

  _stopServer() {
    // Close all client connections
    for (const [clientId, client] of this.clients.entries()) {
      try {
        if (client.ws && client.ws.readyState === WebSocket.OPEN) {
          client.ws.close();
        }
      } catch (error) {
        // Ignore close errors
      }
    }
    this.clients.clear();
    this._updateClientCount();

    // Close WebSocket server
    if (this.wss) {
      try {
        this.wss.close();
      } catch (error) {
        // Ignore close errors
      }
      this.wss = null;
    }

    // Close HTTP server
    if (this.server) {
      return new Promise((resolve) => {
        this.server.close(() => {
          this.server = null;
          resolve();
        });
      });
    }
  }

  restart() {
    if (!this.config) {
      throw new Error('Server configuration not provided. Cannot restart.');
    }

    this._addHistoryEntry('restart', 'Restarting USBFXP server', null, {});
    
    return new Promise((resolve, reject) => {
      this.stop();
      
      // Small delay before restart
      setTimeout(() => {
        this.start(this.config)
          .then(resolve)
          .catch(reject);
      }, 500);
    });
  }

  _normalizeConfig(config) {
    // Extract port from WebSocket address or use default
    let port = 64213; // Default USB2SNES port
    
    if (config.port) {
      port = parseInt(config.port, 10);
    } else if (config.address) {
      // Parse port from address (e.g., "ws://localhost:64213" or "64213")
      const match = config.address.match(/:(\d+)/);
      if (match) {
        port = parseInt(match[1], 10);
      } else if (!isNaN(parseInt(config.address, 10))) {
        port = parseInt(config.address, 10);
      }
    }

    if (!Number.isFinite(port) || port < 1 || port > 65535) {
      throw new Error(`Invalid port number: ${port}`);
    }

    return {
      port: port,
      useDummyDevice: config.useDummyDevice || false,
      diversionMode: config.diversionMode || null, // 'always' or 'fallback'
      diversionTarget: config.diversionTarget || null, // 'host:port'
      diversionUseSocks: config.diversionUseSocks || false,
      diversionSocksProxyUrl: config.diversionSocksProxyUrl || null
    };
  }

  _updateStatus(patch) {
    this.state = {
      ...this.state,
      ...patch
    };
    this.emit('status', this.getStatus());
  }

  /**
   * Update client count in state
   * @private
   */
  _updateClientCount() {
    const clientCount = this.clients.size;
    this._updateStatus({
      clientCount: clientCount
    });
  }
}

module.exports = new UsbfxpServer();

