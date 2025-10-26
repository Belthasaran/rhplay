#!/usr/bin/env node

/**
 * Test script for Metadata API Server
 * 
 * Usage:
 *   node test_api.js <client_id> <client_secret>
 */

const http = require('http');

const API_URL = process.env.API_URL || 'http://localhost:3000';

function makeRequest(path, method = 'GET', headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, API_URL);
    
    const options = {
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname + url.search,
      method: method,
      headers: headers
    };
    
    const req = http.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({ status: res.statusCode, data: json, headers: res.headers });
        } catch (e) {
          resolve({ status: res.statusCode, data: data, headers: res.headers });
        }
      });
    });
    
    req.on('error', reject);
    
    if (body) {
      req.write(JSON.stringify(body));
    }
    
    req.end();
  });
}

async function testAPI(clientId, clientSecret) {
  console.log('='.repeat(70));
  console.log('Testing Metadata API Server');
  console.log('='.repeat(70));
  console.log();
  
  const authHeaders = {
    'X-Client-Id': clientId,
    'X-Client-Secret': clientSecret,
    'Content-Type': 'application/json'
  };
  
  try {
    // Test 1: Health check (no auth)
    console.log('Test 1: Health check...');
    const health = await makeRequest('/health');
    if (health.status === 200) {
      console.log('  ✓ Health check passed');
      console.log(`    Status: ${health.data.status}`);
    } else {
      console.log(`  ✗ Health check failed (${health.status})`);
    }
    console.log();
    
    // Test 2: Root endpoint (no auth)
    console.log('Test 2: Root endpoint...');
    const root = await makeRequest('/');
    if (root.status === 200) {
      console.log('  ✓ Root endpoint accessible');
      console.log(`    Service: ${root.data.service}`);
    } else {
      console.log(`  ✗ Root endpoint failed (${root.status})`);
    }
    console.log();
    
    // Test 3: List attachments (auth required)
    console.log('Test 3: List attachments (authenticated)...');
    const attachments = await makeRequest('/api/attachments?limit=5', 'GET', authHeaders);
    if (attachments.status === 200) {
      console.log('  ✓ Authentication successful');
      console.log(`    Retrieved: ${attachments.data.data?.length || 0} attachments`);
      console.log(`    Total: ${attachments.data.total}`);
    } else if (attachments.status === 401) {
      console.log('  ✗ Authentication failed');
      console.log(`    Error: ${attachments.data.error}`);
    } else {
      console.log(`  ✗ Request failed (${attachments.status})`);
    }
    console.log();
    
    // Test 4: List gameversions
    console.log('Test 4: List gameversions...');
    const gameversions = await makeRequest('/api/gameversions?limit=5', 'GET', authHeaders);
    if (gameversions.status === 200) {
      console.log('  ✓ GameVersions accessible');
      console.log(`    Retrieved: ${gameversions.data.data?.length || 0} records`);
    } else {
      console.log(`  ✗ Request failed (${gameversions.status})`);
    }
    console.log();
    
    // Test 5: List patchblobs
    console.log('Test 5: List patchblobs...');
    const patchblobs = await makeRequest('/api/patchblobs?limit=5', 'GET', authHeaders);
    if (patchblobs.status === 200) {
      console.log('  ✓ PatchBlobs accessible');
      console.log(`    Retrieved: ${patchblobs.data.data?.length || 0} records`);
    } else {
      console.log(`  ✗ Request failed (${patchblobs.status})`);
    }
    console.log();
    
    // Test 6: Search endpoint
    console.log('Test 6: Search endpoint...');
    const searchBody = {
      file_name: 'test_file',
      file_hash_sha256: 'nonexistent_hash'
    };
    const search = await makeRequest('/api/search', 'POST', authHeaders, searchBody);
    if (search.status === 404) {
      console.log('  ✓ Search endpoint working (no results expected)');
    } else if (search.status === 200) {
      console.log('  ✓ Search endpoint found results');
    } else {
      console.log(`  ⚠ Search returned ${search.status}`);
    }
    console.log();
    
    // Test 7: List clients (admin only)
    console.log('Test 7: List clients (admin only)...');
    const clients = await makeRequest('/api/clients', 'GET', authHeaders);
    if (clients.status === 200) {
      console.log('  ✓ Admin access confirmed');
      console.log(`    Total clients: ${clients.data.data?.length || 0}`);
    } else if (clients.status === 403) {
      console.log('  ✓ Read-only client correctly denied admin access');
    } else {
      console.log(`  ⚠ Unexpected status: ${clients.status}`);
    }
    console.log();
    
    console.log('='.repeat(70));
    console.log('All tests complete!');
    console.log('='.repeat(70));
    
  } catch (error) {
    console.error('Test error:', error.message);
    process.exit(1);
  }
}

// Main
const args = process.argv.slice(2);

if (args.length < 2) {
  console.log('Test Metadata API Server\n');
  console.log('Usage:');
  console.log('  node test_api.js <client_id> <client_secret>');
  console.log();
  console.log('Example:');
  console.log('  node test_api.js 12345678-1234-1234-1234-123456789abc abc123...');
  console.log();
  process.exit(0);
}

const clientId = args[0];
const clientSecret = args[1];

testAPI(clientId, clientSecret);

