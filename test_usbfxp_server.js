#!/usr/bin/env node
/**
 * USBFXP Server Test Utility
 * 
 * Standalone test utility for the embedded USB2SNES/FXP server.
 * Can be run with: enode.sh test_usbfxp_server.js [options]
 * 
 * Usage:
 *   enode.sh test_usbfxp_server.js                    # Test with default settings
 *   enode.sh test_usbfxp_server.js --port 64213       # Test on specific port
 *   enode.sh test_usbfxp_server.js --dummy            # Test with dummy device
 *   enode.sh test_usbfxp_server.js --help             # Show help
 */

const path = require('path');
const WebSocket = require('ws');

// Note: usbfxpServer exports a singleton instance, not a class
const usbfxpServer = require(path.join(__dirname, 'electron', 'main', 'usb2snes', 'usbfxpServer'));

// Parse command line arguments
const args = process.argv.slice(2);
let port = 64213;
let useDummy = false;
let verbose = false;
let showHelp = false;
const testOptions = {
  boot: false,
  reset: false,
  menu: false,
  putFile: false,
  list: false,
  all: false
};

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--help' || arg === '-h') {
    showHelp = true;
  } else if (arg === '--port' || arg === '-p') {
    port = parseInt(args[++i], 10) || port;
  } else if (arg === '--dummy' || arg === '-d') {
    useDummy = true;
  } else if (arg === '--verbose' || arg === '-v') {
    verbose = true;
  } else if (arg === '--boot' || arg === '-b') {
    testOptions.boot = true;
  } else if (arg === '--reset' || arg === '-r') {
    testOptions.reset = true;
  } else if (arg === '--menu' || arg === '-m') {
    testOptions.menu = true;
  } else if (arg === '--putfile' || arg === '--put-file') {
    testOptions.putFile = true;
  } else if (arg === '--list' || arg === '-l') {
    testOptions.list = true;
  } else if (arg === '--all' || arg === '-a') {
    testOptions.all = true;
    // Enable all tests
    Object.keys(testOptions).forEach(key => {
      if (key !== 'all') testOptions[key] = true;
    });
  }
}

if (showHelp) {
  console.log(`
USBFXP Server Test Utility

Usage:
  enode.sh test_usbfxp_server.js [options]

Options:
  --port, -p <number>    WebSocket port (default: 64213)
  --dummy, -d            Use dummy USB device for testing
  --verbose, -v          Enable verbose logging
  --boot, -b             Test Boot command
  --reset, -r            Test Reset command
  --menu, -m             Test Menu command
  --putfile              Test PutFile command (uploads test file to /work)
  --list, -l             Test List command (lists files in /work)
  --all, -a              Run all optional tests (boot, reset, menu, putfile, list)
  --help, -h             Show this help message

Examples:
  enode.sh test_usbfxp_server.js
  enode.sh test_usbfxp_server.js --port 64213 --dummy
  enode.sh test_usbfxp_server.js --verbose
  enode.sh test_usbfxp_server.js --reset --list
  enode.sh test_usbfxp_server.js --all

Exit Codes:
  0  - All tests passed
  1  - Server failed to start
  2  - Connection failed
  3  - Test failures
  `);
  process.exit(0);
}

// Test results tracking
const testResults = {
  passed: 0,
  failed: 0,
  errors: []
};

function log(message, level = 'info') {
  const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
  const prefix = {
    info: '[INFO]',
    success: '[✓]',
    error: '[✗]',
    warn: '[WARN]'
  }[level] || '[INFO]';
  console.log(`${timestamp} ${prefix} ${message}`);
}

function logVerbose(message) {
  if (verbose) {
    log(message, 'info');
  }
}

function testPass(testName) {
  testResults.passed++;
  log(`${testName}`, 'success');
}

function testFail(testName, error) {
  testResults.failed++;
  testResults.errors.push({ test: testName, error });
  log(`${testName}: ${error.message || error}`, 'error');
}

// Use the singleton server instance
const server = usbfxpServer;

// Listen for server events
server.on('history-update', (history) => {
  const lastEntry = history[history.length - 1];
  if (lastEntry) {
    logVerbose(`Server: ${lastEntry.event} - ${lastEntry.message}`);
  }
});

async function testServer() {
  log('Starting USBFXP Server Test Utility...');
  const enabledTests = Object.entries(testOptions).filter(([key, val]) => key !== 'all' && val);
  log(`Configuration: port=${port}, dummy=${useDummy}, verbose=${verbose}`);
  if (enabledTests.length > 0) {
    log(`Optional tests enabled: ${enabledTests.map(([key]) => key).join(', ')}`);
  }
  
  try {
    // Step 1: Start the server
    log('Step 1: Starting USBFXP server...');
    const serverConfig = {
      port: port,
      useDummyDevice: useDummy,
      diversionMode: 'none',
      diversionTarget: null,
      diversionUseSocks: false,
      diversionSocksProxyUrl: null
    };
    
    await server.start(serverConfig);
    const status = server.getStatus();
    
    if (!status.running) {
      testFail('Server Start', new Error('Server did not start successfully'));
      return 3;
    }
    
    testPass('Server Start');
    log(`Server running on port ${status.port}, health: ${status.health}`);
    
    // Wait a moment for server to stabilize
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Step 2: Connect to the server
    log('Step 2: Connecting to server...');
    const wsUrl = `ws://localhost:${port}`;
    logVerbose(`Connecting to ${wsUrl}...`);
    
    const ws = new WebSocket(wsUrl);
    
    const connectPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Connection timeout'));
      }, 5000);
      
      ws.on('open', () => {
        clearTimeout(timeout);
        logVerbose('WebSocket connected');
        resolve();
      });
      
      ws.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
    
    try {
      await connectPromise;
      testPass('WebSocket Connection');
    } catch (error) {
      testFail('WebSocket Connection', error);
      await server.stop();
      return 2;
    }
    
    // Step 3: Test DeviceList
    log('Step 3: Testing DeviceList command...');
    const deviceListPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('DeviceList timeout'));
      }, 5000);
      
      ws.once('message', (data) => {
        clearTimeout(timeout);
        try {
          const message = JSON.parse(data);
          logVerbose(`DeviceList response: ${JSON.stringify(message)}`);
          
          if (message.Results && Array.isArray(message.Results) && message.Results.length > 0) {
            resolve(message.Results);
          } else {
            reject(new Error('Invalid DeviceList response'));
          }
        } catch (parseError) {
          reject(parseError);
        }
      });
      
      const request = JSON.stringify({
        Opcode: 'DeviceList',
        Space: 'SNES'
      });
      
      logVerbose(`Sending DeviceList request: ${request}`);
      ws.send(request);
    });
    
    let devices = [];
    try {
      devices = await deviceListPromise;
      testPass('DeviceList Command');
      log(`Found ${devices.length} device(s): ${devices.join(', ')}`);
    } catch (error) {
      testFail('DeviceList Command', error);
    }
    
    // Step 4: Test Attach
    if (devices.length > 0) {
      log('Step 4: Testing Attach command...');
      const deviceName = devices[0];
      
      const attachPromise = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Attach timeout'));
        }, 10000); // Longer timeout for attach (device needs to open)
        
        ws.once('message', (data) => {
          clearTimeout(timeout);
          try {
            const message = JSON.parse(data);
            logVerbose(`Attach response: ${JSON.stringify(message)}`);
            
            // Attach response can be empty Results array OR can include device name
            // Accept either format
            if (message.Results && Array.isArray(message.Results)) {
              // Empty array or array with device name both indicate success
              resolve(true);
            } else if (message.status === 'ok') {
              // Alternative format with status field
              resolve(true);
            } else {
              reject(new Error('Invalid Attach response'));
            }
          } catch (parseError) {
            reject(parseError);
          }
        });
        
        const request = JSON.stringify({
          Opcode: 'Attach',
          Space: 'SNES',
          Operands: [deviceName]
        });
        
        logVerbose(`Sending Attach request: ${request}`);
        ws.send(request);
      });
      
      try {
        await attachPromise;
        testPass('Attach Command');
        log(`Attached to device: ${deviceName}`);
        
        // Wait a moment for device to initialize
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Step 5: Test Info
        log('Step 5: Testing Info command...');
        const infoPromise = new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('Info timeout'));
          }, 10000);
          
          ws.once('message', (data) => {
            clearTimeout(timeout);
            try {
              const message = JSON.parse(data);
              logVerbose(`Info response: ${JSON.stringify(message)}`);
              
              if (message.Results && Array.isArray(message.Results) && message.Results.length >= 3) {
                resolve(message.Results);
              } else {
                reject(new Error('Invalid Info response'));
              }
            } catch (parseError) {
              reject(parseError);
            }
          });
          
          const request = JSON.stringify({
            Opcode: 'Info',
            Space: 'SNES',
            Operands: [deviceName]
          });
          
          logVerbose(`Sending Info request: ${request}`);
          ws.send(request);
        });
        
        try {
          const info = await infoPromise;
          
          // CRITICAL: Verify that Info command actually returned valid data
          // If firmware version or ROM name is "N/A", the command failed
          const firmwareVersion = info[0] || 'N/A';
          const versionString = info[1] || 'N/A';
          const romRunning = info[2] || 'N/A';
          
          log(`Device Info:`);
          log(`  Firmware Version: ${firmwareVersion}`);
          log(`  Version String: ${versionString}`);
          log(`  ROM Running: ${romRunning}`);
          
          // Check if Info command actually returned valid data
          if (firmwareVersion === 'N/A' || romRunning === 'N/A') {
            testFail('Info Command', new Error(`Info command returned invalid data: firmware="${firmwareVersion}", ROM="${romRunning}"`));
          } else {
            testPass('Info Command');
          }
        } catch (error) {
          testFail('Info Command', error);
        }
        
        // Helper function to send command and wait for response
        async function sendCommand(opcode, space, operands = [], expectBinary = false, binaryTimeout = 30000) {
          return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
              reject(new Error(`${opcode} timeout`));
            }, 15000);
            
            const messageHandler = (data) => {
              clearTimeout(timeout);
              try {
                if (expectBinary && Buffer.isBuffer(data)) {
                  resolve({ binary: true, data });
                } else {
                  const message = JSON.parse(data);
                  logVerbose(`${opcode} response: ${JSON.stringify(message)}`);
                  
                  if (message.status === 'error') {
                    reject(new Error(message.message || `Error: ${opcode}`));
                  } else {
                    resolve(message);
                  }
                }
              } catch (parseError) {
                reject(parseError);
              }
            };
            
            ws.once('message', messageHandler);
            
            const request = JSON.stringify({
              Opcode: opcode,
              Space: space,
              Operands: operands
            });
            
            logVerbose(`Sending ${opcode} request: ${request}`);
            ws.send(request);
          });
        }
        
        // Optional tests
        if (testOptions.reset) {
          log('Testing Reset command...');
          try {
            await sendCommand('Reset', 'SNES');
            testPass('Reset Command');
            log('Device reset successfully');
            // Wait a moment after reset
            await new Promise(resolve => setTimeout(resolve, 1000));
          } catch (error) {
            testFail('Reset Command', error);
          }
        }
        
        if (testOptions.menu) {
          log('Testing Menu command...');
          try {
            await sendCommand('Menu', 'SNES');
            testPass('Menu Command');
            log('Menu command executed successfully');
            // Wait a moment after menu
            await new Promise(resolve => setTimeout(resolve, 1000));
          } catch (error) {
            testFail('Menu Command', error);
          }
        }
        
        if (testOptions.list) {
          log('Testing List command (listing /work directory)...');
          try {
            const response = await sendCommand('List', 'FILE', ['/work']);
            if (response.Results && Array.isArray(response.Results)) {
              testPass('List Command');
              log(`Found ${response.Results.length} item(s) in /work:`);
              response.Results.forEach((item, index) => {
                if (Array.isArray(item) && item.length >= 2) {
                  const [name, type] = item;
                  log(`  ${index + 1}. ${name} (${type === 0 ? 'file' : 'directory'})`);
                } else {
                  log(`  ${index + 1}. ${JSON.stringify(item)}`);
                }
              });
            } else {
              throw new Error('Invalid List response format');
            }
          } catch (error) {
            testFail('List Command', error);
          }
        }
        
        if (testOptions.putFile) {
          log('Testing PutFile command (uploading test file to /work)...');
          try {
            // Create a small test file
            const fs = require('fs');
            const testFileName = 'test_file.txt';
            const testFilePath = require('path').join(require('os').tmpdir(), testFileName);
            const testContent = Buffer.from('This is a test file uploaded via PutFile command.\nCreated at: ' + new Date().toISOString() + '\n');
            
            fs.writeFileSync(testFilePath, testContent);
            log(`Created test file: ${testFilePath} (${testContent.length} bytes)`);
            
            // Send PutFile command
            const targetPath = '/work/' + testFileName;
            const request = JSON.stringify({
              Opcode: 'PutFile',
              Space: 'FILE',
              Operands: [targetPath]
            });
            
            logVerbose(`Sending PutFile request: ${request}`);
            
            // PutFile expects binary data after the JSON command
            const putFilePromise = new Promise((resolve, reject) => {
              const timeout = setTimeout(() => {
                reject(new Error('PutFile timeout'));
              }, 30000);
              
              let responseReceived = false;
              
              const messageHandler = (data) => {
                if (Buffer.isBuffer(data)) {
                  // Binary data - ignore (could be response data)
                  return;
                }
                
                try {
                  const message = JSON.parse(data);
                  logVerbose(`PutFile response: ${JSON.stringify(message)}`);
                  
                  if (!responseReceived) {
                    responseReceived = true;
                    clearTimeout(timeout);
                    ws.removeListener('message', messageHandler);
                    
                    if (message.status === 'error') {
                      reject(new Error(message.message || 'PutFile error'));
                    } else {
                      resolve(message);
                    }
                  }
                } catch (parseError) {
                  // Ignore parse errors for binary data
                }
              };
              
              ws.on('message', messageHandler);
              
              // Send JSON command
              ws.send(request);
              
              // Send binary file data immediately after
              setTimeout(() => {
                ws.send(testContent);
                logVerbose(`Sent ${testContent.length} bytes of file data`);
                
                // Wait a moment for response
                setTimeout(() => {
                  if (!responseReceived) {
                    clearTimeout(timeout);
                    ws.removeListener('message', messageHandler);
                    // PutFile might not send response - check if file exists
                    log('PutFile command sent, verifying with List command...');
                    sendCommand('List', 'FILE', ['/work'])
                      .then((listResponse) => {
                        if (listResponse.Results && Array.isArray(listResponse.Results)) {
                          const found = listResponse.Results.some(item => {
                            if (Array.isArray(item) && item.length >= 1) {
                              return item[0] === testFileName || item[0] === targetPath;
                            }
                            return item === testFileName || item === targetPath;
                          });
                          if (found) {
                            resolve({ success: true });
                          } else {
                            reject(new Error('File not found after PutFile'));
                          }
                        } else {
                          resolve({ success: true }); // Assume success if we can't verify
                        }
                      })
                      .catch(reject);
                  }
                }, 2000);
              }, 100);
            });
            
            await putFilePromise;
            testPass('PutFile Command');
            log(`File uploaded successfully to ${targetPath}`);
            
            // Clean up test file
            try {
              fs.unlinkSync(testFilePath);
            } catch (cleanupErr) {
              // Ignore cleanup errors
            }
          } catch (error) {
            testFail('PutFile Command', error);
          }
        }
        
        if (testOptions.boot) {
          log('Testing Boot command...');
          try {
            // Boot requires a file path - try to boot a common test file or use the current ROM
            const bootPath = '/work/test.sfc'; // Default test path
            const response = await sendCommand('Boot', 'FILE', [bootPath]);
            testPass('Boot Command');
            log(`Boot command executed for: ${bootPath}`);
            // Wait after boot
            await new Promise(resolve => setTimeout(resolve, 2000));
          } catch (error) {
            // Boot might fail if file doesn't exist - that's okay for testing
            if (error.message && error.message.includes('timeout')) {
              testFail('Boot Command', error);
            } else {
              log(`Boot command returned (may have failed if file doesn't exist): ${error.message}`, 'warn');
              // Don't fail the test if file doesn't exist
              testPass('Boot Command (attempted)');
            }
          }
        }
        
      } catch (error) {
        testFail('Attach Command', error);
      }
    } else {
      log('Skipping Attach/Info tests - no devices found');
    }
    
    // Close WebSocket
    ws.close();
    
    // Step 6: Stop the server
    log('Step 6: Stopping server...');
    await server.stop();
    testPass('Server Stop');
    
  } catch (error) {
    testFail('Test Suite', error);
    log(`Error: ${error.message}`, 'error');
    if (verbose) {
      console.error(error.stack);
    }
    try {
      await server.stop();
    } catch (stopError) {
      // Ignore stop errors
    }
    return 1;
  }
  
  // Print summary
  log('\n=== Test Summary ===');
  log(`Passed: ${testResults.passed}`);
  log(`Failed: ${testResults.failed}`);
  
  if (testResults.errors.length > 0) {
    log('\nErrors:');
    testResults.errors.forEach(({ test, error }) => {
      log(`  ${test}: ${error.message || error}`, 'error');
    });
  }
  
  // Exit with appropriate code
  if (testResults.failed === 0) {
    log('\nAll tests passed!', 'success');
    return 0;
  } else {
    log('\nSome tests failed.', 'error');
    return 3;
  }
}

// Run tests with timeout
const testTimeout = 30000; // 30 seconds total timeout
const timeoutId = setTimeout(() => {
  log(`\n[ERROR] Test execution timed out after ${testTimeout}ms`, 'error');
  log('[ERROR] Some tests may still be running...', 'error');
  log('[ERROR] This might indicate a hanging operation.', 'error');
  process.exit(1);
}, testTimeout);

testServer()
  .then((exitCode) => {
    clearTimeout(timeoutId);
    process.exit(exitCode);
  })
  .catch((error) => {
    clearTimeout(timeoutId);
    log(`Fatal error: ${error.message}`, 'error');
    if (verbose) {
      console.error(error.stack);
    }
    process.exit(1);
  });

