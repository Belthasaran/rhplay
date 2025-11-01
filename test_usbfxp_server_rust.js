#!/usr/bin/env node
/**
 * Test utility for USBFXP Server using Rust native module
 * Usage: node test_usbfxp_server_rust.js [options]
 * Options:
 *   --verbose: Show detailed logs
 *   --start-server, -s: Start the server within this script (for standalone testing)
 *   --port, -p <number>: WebSocket port when starting server (default: 64213)
 *   --dummy, -d: Use dummy USB device for testing
 *   -i, --info: Test Info command
 *   -r, --reset: Test Reset command
 *   -b, --boot: Test Boot command
 *   -m, --menu: Test Menu command
 *   --putfile: Test PutFile command
 *   --list: Test List command
 *   --all: Run all tests
 */

const path = require('path');
const { WebSocket } = require('ws');

// Configuration
const START_SERVER = process.argv.includes('--start-server') || process.argv.includes('-s');
const VERBOSE = process.argv.includes('--verbose');
const TEST_INFO = process.argv.includes('-i') || process.argv.includes('--info') || process.argv.includes('--all');
const TEST_RESET = process.argv.includes('-r') || process.argv.includes('--reset') || process.argv.includes('--all');
const TEST_BOOT = process.argv.includes('-b') || process.argv.includes('--boot') || process.argv.includes('--all');
const TEST_MENU = process.argv.includes('-m') || process.argv.includes('--menu') || process.argv.includes('--all');
const TEST_PUTFILE = process.argv.includes('--putfile') || process.argv.includes('--all');
const TEST_LIST = process.argv.includes('--list') || process.argv.includes('--all');

// Parse port and dummy device options
let SERVER_PORT = 64213;
let USE_DUMMY = false;
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
    if ((args[i] === '--port' || args[i] === '-p') && i + 1 < args.length) {
        SERVER_PORT = parseInt(args[i + 1], 10) || SERVER_PORT;
    } else if (args[i] === '--dummy' || args[i] === '-d') {
        USE_DUMMY = true;
    }
}

const SERVER_URL = process.env.USBFXP_URL || `ws://localhost:${SERVER_PORT}`;

// Load server module if starting server
let usbfxpServer = null;
if (START_SERVER) {
    try {
        usbfxpServer = require(path.join(__dirname, 'electron', 'main', 'usb2snes', 'usbfxpServer'));
    } catch (err) {
        console.error('Error loading usbfxpServer:', err);
        process.exit(1);
    }
}

// Global timeout to prevent hanging
const GLOBAL_TIMEOUT = 30000; // 30 seconds

let globalTimer = null;

function log(message, level = 'INFO') {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`${timestamp} [${level}] ${message}`);
}

function verbose(message) {
    if (VERBOSE) {
        log(message, 'DEBUG');
    }
}

function sendCommand(ws, opcode, space, operands = []) {
    return new Promise((resolve, reject) => {
        const message = {
            Opcode: opcode,
            Space: space,
            Operands: operands
        };

        if (VERBOSE) {
            verbose(`Sending: ${JSON.stringify(message)}`);
        }

        ws.send(JSON.stringify(message));

        const timeout = setTimeout(() => {
            reject(new Error('Command timeout'));
        }, 5000);

        ws.once('message', (data) => {
            clearTimeout(timeout);
            try {
                const response = JSON.parse(data.toString());
                if (VERBOSE) {
                    verbose(`Received: ${JSON.stringify(response)}`);
                }
                resolve(response);
            } catch (err) {
                reject(new Error(`Failed to parse response: ${err.message}`));
            }
        });
    });
}

async function testInfo(ws) {
    log('Testing Info command...');
    try {
        const response = await sendCommand(ws, 'Info', 'SNES', ['SD2SNES']);
        
        if (!response.Results || response.Results.length < 3) {
            throw new Error('Invalid Info response format');
        }

        const [firmwareVersion, versionString, romRunning] = response.Results;
        
        // Check if we got actual data (not "N/A")
        if (firmwareVersion === 'N/A' || romRunning === 'N/A') {
            log(`✗ Info command failed: Missing firmware version or ROM name`, 'ERROR');
            log(`  Firmware: ${firmwareVersion}, ROM: ${romRunning}`, 'ERROR');
            return false;
        }

        log(`✓ Info Command`);
        log(`Device Info:`);
        log(`  Firmware Version: ${firmwareVersion}`);
        log(`  Version String: ${versionString}`);
        log(`  ROM Running: ${romRunning}`);
        
        return true;
    } catch (error) {
        log(`✗ Info command failed: ${error.message}`, 'ERROR');
        return false;
    }
}

async function testReset(ws) {
    log('Testing Reset command...');
    try {
        // Reset command should return immediately (NORESP flag)
        const response = await sendCommand(ws, 'Reset', 'SNES', []);
        
        // Wait for device to stabilize
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        log(`✓ Reset Command`);
        log(`Note: Visual confirmation required - SNES should reset`);
        
        return true;
    } catch (error) {
        log(`✗ Reset command failed: ${error.message}`, 'ERROR');
        return false;
    }
}

async function testBoot(ws) {
    log('Testing Boot command (requires ROM file)...');
    try {
        // Boot command requires a path to a ROM file
        const response = await sendCommand(ws, 'Boot', 'SNES', ['/work/test.sfc']);
        
        log(`✓ Boot Command`);
        log(`Response: ${JSON.stringify(response)}`);
        
        return true;
    } catch (error) {
        log(`✗ Boot command failed: ${error.message}`, 'ERROR');
        return false;
    }
}

async function testMenu(ws) {
    log('Testing Menu command...');
    try {
        const response = await sendCommand(ws, 'Menu', 'SNES', []);
        
        log(`✓ Menu Command`);
        log(`Response: ${JSON.stringify(response)}`);
        
        return true;
    } catch (error) {
        log(`✗ Menu command failed: ${error.message}`, 'ERROR');
        return false;
    }
}

async function testPutFile(ws) {
    log('Testing PutFile command...');
    try {
        // PutFile requires file data - simplified test
        const response = await sendCommand(ws, 'PutFile', 'SNES', ['/work/test.txt']);
        
        log(`✓ PutFile Command`);
        log(`Response: ${JSON.stringify(response)}`);
        
        return true;
    } catch (error) {
        log(`✗ PutFile command failed: ${error.message}`, 'ERROR');
        return false;
    }
}

async function testList(ws) {
    log('Testing List command...');
    try {
        const response = await sendCommand(ws, 'List', 'SNES', ['/work']);
        
        log(`✓ List Command`);
        log(`Response: ${JSON.stringify(response)}`);
        
        return true;
    } catch (error) {
        log(`✗ List command failed: ${error.message}`, 'ERROR');
        return false;
    }
}

async function startServerIfNeeded() {
    if (!START_SERVER || !usbfxpServer) {
        return null;
    }

    log('Starting USBFXP server...');
    
    const serverConfig = {
        port: SERVER_PORT,
        useDummyDevice: USE_DUMMY,
        diversionMode: 'none',
        diversionTarget: null,
        diversionUseSocks: false,
        diversionSocksProxyUrl: null
    };

    try {
        await usbfxpServer.start(serverConfig);
        const status = usbfxpServer.getStatus();
        
        if (!status.running) {
            throw new Error('Server did not start successfully');
        }
        
        log(`✓ Server started on port ${status.port}, health: ${status.health}`);
        
        // Wait for server to stabilize
        await new Promise(resolve => setTimeout(resolve, 500));
        
        return usbfxpServer;
    } catch (error) {
        log(`✗ Failed to start server: ${error.message}`, 'ERROR');
        throw error;
    }
}

async function stopServerIfNeeded(server) {
    if (!START_SERVER || !server) {
        return;
    }

    log('Stopping USBFXP server...');
    try {
        await server.stop();
        log('✓ Server stopped');
    } catch (error) {
        log(`✗ Error stopping server: ${error.message}`, 'ERROR');
    }
}

async function main() {
    log('USBFXP Server Test Utility (Rust Module)');
    
    // Check if any tests are specified
    if (!TEST_INFO && !TEST_RESET && !TEST_BOOT && !TEST_MENU && !TEST_PUTFILE && !TEST_LIST) {
        log('No tests specified. Use --info, --reset, --boot, --menu, --putfile, --list, or --all', 'ERROR');
        log('Usage: ./enode.sh test_usbfxp_server_rust.js --info --verbose [--start-server]', 'INFO');
        return 1;
    }

    let server = null;
    
    try {
        // Start server if needed
        if (START_SERVER) {
            server = await startServerIfNeeded();
        } else {
            log(`Connecting to: ${SERVER_URL}`);
            log('Note: Server should already be running. Use --start-server to start it automatically.', 'INFO');
        }

        // Set global timeout
        globalTimer = setTimeout(() => {
            log('Global timeout reached - exiting', 'ERROR');
            if (server) {
                stopServerIfNeeded(server);
            }
            process.exit(1);
        }, GLOBAL_TIMEOUT);

        return new Promise((resolve, reject) => {
            let connected = false;
            const ws = new WebSocket(SERVER_URL);

            ws.on('open', async () => {
                connected = true;
                log('✓ Connected to server');
                clearTimeout(globalTimer);

                try {
                    // First, attach to device
                    log('Step 1: Attaching to device...');
                    const attachResponse = await sendCommand(ws, 'Attach', 'SNES', ['SD2SNES']);
                    
                    if (!attachResponse.Results || attachResponse.Results.length === 0) {
                        throw new Error('Attach failed');
                    }
                    
                    log(`✓ Attached to device: ${attachResponse.Results[0]}`);

                    // Run tests
                    const results = {};
                    
                    if (TEST_INFO) {
                        results.info = await testInfo(ws);
                    }

                    if (TEST_RESET) {
                        results.reset = await testReset(ws);
                    }

                    if (TEST_BOOT) {
                        results.boot = await testBoot(ws);
                    }

                    if (TEST_MENU) {
                        results.menu = await testMenu(ws);
                    }

                    if (TEST_PUTFILE) {
                        results.putfile = await testPutFile(ws);
                    }

                    if (TEST_LIST) {
                        results.list = await testList(ws);
                    }

                    // Summary
                    log('\n=== Test Summary ===');
                    const total = Object.keys(results).length;
                    const passed = Object.values(results).filter(r => r === true).length;
                    
                    Object.entries(results).forEach(([test, result]) => {
                        log(`${test}: ${result ? '✓ PASS' : '✗ FAIL'}`);
                    });
                    
                    log(`\nTotal: ${passed}/${total} tests passed`);

                    ws.close();
                    const exitCode = passed === total ? 0 : 1;
                    
                    // Stop server if we started it
                    if (server) {
                        await stopServerIfNeeded(server);
                    }
                    
                    resolve(exitCode);
                } catch (error) {
                    log(`✗ Test failed: ${error.message}`, 'ERROR');
                    ws.close();
                    
                    // Stop server if we started it
                    if (server) {
                        await stopServerIfNeeded(server);
                    }
                    
                    reject(error);
                }
            });

            ws.on('error', async (error) => {
                clearTimeout(globalTimer);
                const errorMsg = error.message || error.code || String(error);
                log(`✗ Connection error: ${errorMsg}`, 'ERROR');
                
                if (!START_SERVER) {
                    log(`Server may not be running. Try using --start-server to start it automatically.`, 'ERROR');
                    log(`Check if port ${SERVER_URL.split(':')[2] || '64213'} is listening.`, 'ERROR');
                } else {
                    log(`Server was started but connection failed.`, 'ERROR');
                }
                
                // Stop server if we started it
                if (server) {
                    await stopServerIfNeeded(server);
                }
                
                reject(new Error(`Connection failed: ${errorMsg}`));
            });

            ws.on('close', async (code, reason) => {
                if (!connected) {
                    log(`✗ Connection refused or closed: code=${code}, reason=${reason || 'none'}`, 'ERROR');
                    if (!START_SERVER) {
                        log(`Make sure the USBFXP server is running on ${SERVER_URL}`, 'ERROR');
                        log(`Or use --start-server to start it automatically.`, 'ERROR');
                    }
                    clearTimeout(globalTimer);
                    
                    // Stop server if we started it
                    if (server) {
                        await stopServerIfNeeded(server);
                    }
                    
                    reject(new Error(`Connection refused: code ${code}`));
                } else {
                    log('Connection closed');
                    clearTimeout(globalTimer);
                }
            });
        });
    } catch (error) {
        log(`✗ Fatal error: ${error.message}`, 'ERROR');
        if (server) {
            await stopServerIfNeeded(server);
        }
        return 1;
    }
}

// Run tests
main()
    .then((exitCode) => {
        process.exit(exitCode);
    })
    .catch((error) => {
        log(`Fatal error: ${error.message}`, 'ERROR');
        process.exit(1);
    });

