/**
 * Test USB2SNES ephemeral connection test helper.
 *
 * Usage: node tests/test_usb2snes_test_connection.js
 */

const path = require('path');
const { testUsb2snesConnection } = require(path.join(__dirname, '..', 'electron', 'main', 'usb2snes', 'testConnection'));
const usbfxpServer = require(path.join(__dirname, '..', 'electron', 'main', 'usb2snes', 'usbfxpServer'));

const TEST_PORT = Number(process.env.USB2SNES_TEST_PORT) || 64997;

let failures = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    failures += 1;
    return false;
  }
  console.log(`PASS: ${message}`);
  return true;
}

async function stopServerIfRunning() {
  try {
    await usbfxpServer.stop();
  } catch (_error) {
    // ignore stop errors when server was not running
  }
}

async function runTests() {
  console.log('=== USB2SNES testConnection tests ===\n');

  const invalidResult = await testUsb2snesConnection({
    address: 'ws://localhost:1',
    proxyMode: 'direct',
    timeoutMs: 2000
  });
  assert(invalidResult.status === 'failure', 'invalid address returns failure');

  const missingSocksResult = await testUsb2snesConnection({
    address: 'ws://localhost:64213',
    proxyMode: 'socks',
    socksProxyUrl: ''
  });
  assert(missingSocksResult.status === 'failure', 'socks mode without proxy URL returns failure');

  await stopServerIfRunning();

  await usbfxpServer.start({
    port: TEST_PORT,
    useDummyDevice: true,
    diversionMode: 'none',
    diversionTarget: null,
    diversionUseSocks: false,
    diversionSocksProxyUrl: null
  });
  await new Promise((resolve) => setTimeout(resolve, 500));

  const successResult = await testUsb2snesConnection({
    address: `ws://localhost:${TEST_PORT}`,
    proxyMode: 'direct',
    timeoutMs: 5000
  });
  assert(
    successResult.status === 'success' && Array.isArray(successResult.devices) && successResult.devices.length >= 1,
    'dummy server returns success with at least one device'
  );

  await stopServerIfRunning();

  await usbfxpServer.start({
    port: TEST_PORT,
    useDummyDevice: false,
    diversionMode: 'none',
    diversionTarget: null,
    diversionUseSocks: false,
    diversionSocksProxyUrl: null
  });
  await new Promise((resolve) => setTimeout(resolve, 500));

  const warningResult = await testUsb2snesConnection({
    address: `ws://localhost:${TEST_PORT}`,
    proxyMode: 'direct',
    timeoutMs: 5000
  });
  assert(
    warningResult.status === 'warning' && Array.isArray(warningResult.devices) && warningResult.devices.length === 0,
    'server without devices returns warning'
  );

  await stopServerIfRunning();

  console.log(`\n=== Done: ${failures} failure(s) ===`);
  process.exit(failures > 0 ? 1 : 0);
}

runTests().catch(async (error) => {
  console.error('Test runner error:', error);
  await stopServerIfRunning();
  process.exit(1);
});
