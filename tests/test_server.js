#!/usr/bin/env node

/**
 * Launch test server with test databases
 */

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const TEST_DIR = path.join(__dirname, 'test_data');
const TEST_CONFIG_FILE = path.join(TEST_DIR, 'test_config.json');
const TEST_ENV_FILE = path.join(TEST_DIR, 'test_environment');

console.log('======================================================================');
console.log('Launching Test Metadata Server');
console.log('======================================================================\n');

// Check test environment exists
if (!fs.existsSync(TEST_CONFIG_FILE)) {
  console.error('Error: Test environment not found. Run setup_test_env.js first.');
  process.exit(1);
}

if (!fs.existsSync(TEST_ENV_FILE)) {
  console.error('Error: Test environment file not found. Run create_test_signers.js first.');
  process.exit(1);
}

// Load test configuration
const testConfig = JSON.parse(fs.readFileSync(TEST_CONFIG_FILE, 'utf8'));

console.log('Test Configuration:');
console.log(`  Server DB:   ${testConfig.databases.serverdata}`);
console.log(`  RHData DB:   ${testConfig.databases.rhdata}`);
console.log(`  Patchbin DB: ${testConfig.databases.patchbin}`);
console.log();

// Launch server with test databases
const serverScript = path.join(__dirname, '..', 'mdserver', 'server.js');

const serverProcess = spawn('node', [
  serverScript,
  `--serverdatadb=${testConfig.databases.serverdata}`,
  `--rhdatadb=${testConfig.databases.rhdata}`,
  `--patchbindb=${testConfig.databases.patchbin}`
], {
  env: {
    ...process.env,
    // Override with test environment
    ...require('dotenv').config({ path: TEST_ENV_FILE }).parsed
  },
  stdio: 'inherit'
});

serverProcess.on('close', (code) => {
  console.log(`\nTest server exited with code ${code}`);
  process.exit(code);
});

// Handle Ctrl+C
process.on('SIGINT', () => {
  console.log('\n\nShutting down test server...');
  serverProcess.kill('SIGINT');
});

process.on('SIGTERM', () => {
  serverProcess.kill('SIGTERM');
});

