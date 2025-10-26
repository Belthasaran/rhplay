#!/usr/bin/env node

/**
 * Metadata API Server
 * 
 * Provides API access to gameversions, patchblobs, and attachments tables
 * Supports read-only and admin clients with encrypted credentials
 * 
 * Usage:
 *   node server.js
 *   npm run mdserver:start
 */

const express = require('express');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
require('dotenv').config({ path: path.join(__dirname, 'environment') });

const app = express();
const PORT = process.env.PORT || 3000;
const VAULT_KEY = process.env.VAULT_KEY;
const SERVER_SIGNER_UUID = process.env.SERVER_SIGNER_UUID;
const SERVER_SIGNER_ALGORITHM = process.env.SERVER_SIGNER_ALGORITHM || 'ED25519';
const SERVER_PRIVATE_KEY_HEX = process.env.SERVER_PRIVATE_KEY_HEX;

if (!VAULT_KEY || VAULT_KEY.length !== 64) {
  console.error('Error: VAULT_KEY must be a 64-character hex string (256 bits)');
  process.exit(1);
}

// Server signing key is optional but recommended for production
let serverPrivateKey = null;
if (SERVER_PRIVATE_KEY_HEX && SERVER_SIGNER_UUID) {
  try {
    const keyBuffer = Buffer.from(SERVER_PRIVATE_KEY_HEX, 'hex');
    serverPrivateKey = crypto.createPrivateKey({
      key: keyBuffer,
      format: 'der',
      type: 'pkcs8'
    });
    console.log('✓ Server signing key loaded');
  } catch (error) {
    console.warn('⚠ Failed to load server signing key:', error.message);
  }
}

// Parse command line arguments for database paths
const args = process.argv.slice(2);
let SERVER_DATA_DB = path.join(__dirname, 'mdserverdata.db');
let RHDATA_DB = path.join(__dirname, 'rhdata.db');
let PATCHBIN_DB = path.join(__dirname, 'patchbin.db');

for (const arg of args) {
  if (arg.startsWith('--serverdatadb=')) {
    SERVER_DATA_DB = arg.split('=')[1];
  } else if (arg.startsWith('--rhdatadb=')) {
    RHDATA_DB = arg.split('=')[1];
  } else if (arg.startsWith('--patchbindb=')) {
    PATCHBIN_DB = arg.split('=')[1];
  }
}

// Initialize databases
let serverDb, rhdataDb, patchbinDb;

/**
 * Encrypt data using VAULT_KEY
 */
function encrypt(text) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(VAULT_KEY, 'hex'), iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

/**
 * Decrypt data using VAULT_KEY
 */
function decrypt(text) {
  const parts = text.split(':');
  const iv = Buffer.from(parts[0], 'hex');
  const encrypted = parts[1];
  const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(VAULT_KEY, 'hex'), iv);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

/**
 * Generate UUID
 */
function generateUUID() {
  return crypto.randomUUID();
}

/**
 * Initialize server database
 */
function initializeServerDatabase() {
  if (!fs.existsSync(SERVER_DATA_DB)) {
    console.log('Creating server database...');
    serverDb = new Database(SERVER_DATA_DB);
    
    const schema = fs.readFileSync(path.join(__dirname, 'serverdata.sql'), 'utf8');
    serverDb.exec(schema);
    
    console.log('✓ Server database created');
  } else {
    serverDb = new Database(SERVER_DATA_DB);
    console.log('✓ Server database loaded');
  }
}

/**
 * Initialize data databases
 */
function initializeDataDatabases() {
  // Check if data databases exist
  if (!fs.existsSync(RHDATA_DB)) {
    console.warn(`⚠ rhdata.db not found at ${RHDATA_DB}`);
    console.warn('  Copy from ../electron/rhdata.db to mdserver/rhdata.db');
  } else {
    rhdataDb = new Database(RHDATA_DB, { readonly: true });
    console.log('✓ rhdata.db loaded (read-only)');
  }
  
  if (!fs.existsSync(PATCHBIN_DB)) {
    console.warn(`⚠ patchbin.db not found at ${PATCHBIN_DB}`);
    console.warn('  Copy from ../electron/patchbin.db to mdserver/patchbin.db');
  } else {
    patchbinDb = new Database(PATCHBIN_DB, { readonly: false });
    console.log('✓ patchbin.db loaded');
  }
}

/**
 * Authentication middleware
 */
function authenticate(req, res, next) {
  const clientId = req.headers['x-client-id'];
  const clientSecret = req.headers['x-client-secret'];
  
  if (!clientId || !clientSecret) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Missing client credentials'
    });
  }
  
  try {
    // Find all clients and try to match (encryption makes it hard to search directly)
    const allClients = serverDb.prepare(`
      SELECT clientuuid, encrypted_clientid, encrypted_secret, admin_client, client_name
      FROM apiclients
    `).all();
    
    let matchedClient = null;
    
    for (const client of allClients) {
      try {
        const decryptedClientId = decrypt(client.encrypted_clientid);
        const decryptedSecret = decrypt(client.encrypted_secret);
        
        if (decryptedClientId === clientId && decryptedSecret === clientSecret) {
          matchedClient = client;
          break;
        }
      } catch (e) {
        // Decryption failed, continue
      }
    }
    
    if (!matchedClient) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid client credentials'
      });
    }
    
    // Update last access
    serverDb.prepare(`
      UPDATE apiclients
      SET last_access = CURRENT_TIMESTAMP,
          access_count = access_count + 1
      WHERE clientuuid = ?
    `).run(matchedClient.clientuuid);
    
    // Attach client info to request
    req.client = {
      uuid: matchedClient.clientuuid,
      name: matchedClient.client_name,
      isAdmin: matchedClient.admin_client === 1
    };
    
    next();
  } catch (error) {
    console.error('Authentication error:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Authentication failed'
    });
  }
}

/**
 * Admin-only middleware
 */
function requireAdmin(req, res, next) {
  if (!req.client.isAdmin) {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Admin access required'
    });
  }
  next();
}

/**
 * Log API request
 */
function logRequest(clientuuid, endpoint, method, statusCode, requestData, responseSize) {
  try {
    serverDb.prepare(`
      INSERT INTO apilogs (loguuid, clientuuid, endpoint, method, status_code, request_data, response_size)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      generateUUID(),
      clientuuid,
      endpoint,
      method,
      statusCode,
      JSON.stringify(requestData || {}),
      responseSize || 0
    );
  } catch (error) {
    console.error('Logging error:', error);
  }
}

/**
 * Load metadata signatures for records
 */
function loadMetadataSignatures(records, db) {
  if (!Array.isArray(records)) {
    records = [records];
  }
  
  const mdsignatures = {};
  
  for (const record of records) {
    if (!record.siglistuuid) continue;
    
    try {
      const signatures = db.prepare(`
        SELECT e.signeruuid, e.signature, e.signature_algorithm, e.hash_algorithm, e.signed_at,
               s.signer_name, s.publickey_type
        FROM signaturelistentries e
        JOIN signers s ON e.signeruuid = s.signeruuid
        WHERE e.siglistuuid = ?
      `).all(record.siglistuuid);
      
      if (signatures.length > 0) {
        mdsignatures[record.siglistuuid] = signatures;
      }
    } catch (error) {
      // Ignore signature loading errors
    }
  }
  
  return Object.keys(mdsignatures).length > 0 ? mdsignatures : null;
}

/**
 * Sign server response
 */
function signResponse(data) {
  if (!serverPrivateKey || !SERVER_SIGNER_UUID) {
    return null;
  }
  
  try {
    const dataString = JSON.stringify(data);
    const hash = crypto.createHash('sha256').update(dataString).digest();
    
    let signature;
    if (SERVER_SIGNER_ALGORITHM === 'ED25519') {
      signature = crypto.sign(null, hash, serverPrivateKey);
    } else if (SERVER_SIGNER_ALGORITHM === 'RSA') {
      signature = crypto.sign('sha256', hash, {
        key: serverPrivateKey,
        padding: crypto.constants.RSA_PKCS1_PSS_PADDING
      });
    } else {
      return null;
    }
    
    return {
      signeruuid: SERVER_SIGNER_UUID,
      signature: signature.toString('hex'),
      algorithm: SERVER_SIGNER_ALGORITHM,
      hash: hash.toString('hex')
    };
  } catch (error) {
    console.error('Response signing error:', error);
    return null;
  }
}

/**
 * Add signatures to response
 */
function addSignaturesToResponse(responseData, records, db) {
  const response = { ...responseData };
  
  // Add metadata signatures if available
  if (records) {
    const mdsignatures = loadMetadataSignatures(records, db);
    if (mdsignatures) {
      response.mdsignatures = mdsignatures;
    }
  }
  
  // Add response timestamp (BEFORE signing, so it's included in signature)
  response.response_timestamp = new Date().toISOString();
  
  // Add server signature (signs the complete response including timestamp)
  const serverSignature = signResponse(response);
  if (serverSignature) {
    response.server_signature = serverSignature;
  }
  
  return response;
}

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`);
  });
  next();
});

// ============================================================================
// Public Endpoints (No Authentication)
// ============================================================================

app.get('/', (req, res) => {
  res.json({
    service: 'Metadata API Server',
    version: '1.0.0',
    endpoints: {
      public: [
        'GET /',
        'GET /health'
      ],
      authenticated: [
        'GET /api/gameversions',
        'GET /api/gameversions/:id',
        'GET /api/patchblobs',
        'GET /api/patchblobs/:id',
        'GET /api/attachments',
        'GET /api/attachments/:id',
        'POST /api/search'
      ],
      admin: [
        'POST /api/gameversions',
        'PUT /api/gameversions/:id',
        'DELETE /api/gameversions/:id',
        'POST /api/patchblobs',
        'PUT /api/patchblobs/:id',
        'DELETE /api/patchblobs/:id',
        'POST /api/attachments',
        'PUT /api/attachments/:id',
        'DELETE /api/attachments/:id',
        'POST /api/clients',
        'GET /api/clients'
      ]
    }
  });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    databases: {
      serverDb: serverDb ? 'connected' : 'disconnected',
      rhdataDb: rhdataDb ? 'connected' : 'disconnected',
      patchbinDb: patchbinDb ? 'connected' : 'disconnected'
    },
    timestamp: new Date().toISOString()
  });
});

// ============================================================================
// Authenticated Endpoints
// ============================================================================

// GameVersions Endpoints
app.get('/api/gameversions', authenticate, (req, res) => {
  try {
    if (!rhdataDb) {
      return res.status(503).json({ error: 'rhdata.db not available' });
    }
    
    const limit = parseInt(req.query.limit) || 100;
    const offset = parseInt(req.query.offset) || 0;
    
    const gameversions = rhdataDb.prepare(`
      SELECT * FROM gameversions
      ORDER BY gvimport_time DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset);
    
    const total = rhdataDb.prepare('SELECT COUNT(*) as count FROM gameversions').get().count;
    
    logRequest(req.client.uuid, '/api/gameversions', 'GET', 200, req.query, gameversions.length);
    
    res.json({
      data: gameversions,
      total: total,
      limit: limit,
      offset: offset
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Internal Server Error', message: error.message });
  }
});

app.get('/api/gameversions/:id', authenticate, (req, res) => {
  try {
    if (!rhdataDb) {
      return res.status(503).json({ error: 'rhdata.db not available' });
    }
    
    const gameversion = rhdataDb.prepare(`
      SELECT * FROM gameversions WHERE gvuuid = ?
    `).get(req.params.id);
    
    if (!gameversion) {
      return res.status(404).json({ error: 'Not found' });
    }
    
    logRequest(req.client.uuid, `/api/gameversions/${req.params.id}`, 'GET', 200, null, 1);
    
    res.json({ data: gameversion });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Internal Server Error', message: error.message });
  }
});

// PatchBlobs Endpoints
app.get('/api/patchblobs', authenticate, (req, res) => {
  try {
    if (!rhdataDb) {
      return res.status(503).json({ error: 'rhdata.db not available' });
    }
    
    const limit = parseInt(req.query.limit) || 100;
    const offset = parseInt(req.query.offset) || 0;
    
    const patchblobs = rhdataDb.prepare(`
      SELECT * FROM patchblobs
      ORDER BY pbimport_time DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset);
    
    const total = rhdataDb.prepare('SELECT COUNT(*) as count FROM patchblobs').get().count;
    
    logRequest(req.client.uuid, '/api/patchblobs', 'GET', 200, req.query, patchblobs.length);
    
    res.json({
      data: patchblobs,
      total: total,
      limit: limit,
      offset: offset
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Internal Server Error', message: error.message });
  }
});

app.get('/api/patchblobs/:id', authenticate, (req, res) => {
  try {
    if (!rhdataDb) {
      return res.status(503).json({ error: 'rhdata.db not available' });
    }
    
    const patchblob = rhdataDb.prepare(`
      SELECT * FROM patchblobs WHERE pbuuid = ?
    `).get(req.params.id);
    
    if (!patchblob) {
      return res.status(404).json({ error: 'Not found' });
    }
    
    logRequest(req.client.uuid, `/api/patchblobs/${req.params.id}`, 'GET', 200, null, 1);
    
    res.json({ data: patchblob });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Internal Server Error', message: error.message });
  }
});

// Attachments Endpoints
app.get('/api/attachments', authenticate, (req, res) => {
  try {
    if (!patchbinDb) {
      return res.status(503).json({ error: 'patchbin.db not available' });
    }
    
    const limit = parseInt(req.query.limit) || 100;
    const offset = parseInt(req.query.offset) || 0;
    const includeData = req.query.include_data === 'true';
    
    let query = 'SELECT ';
    if (includeData) {
      query += '*';
    } else {
      // Exclude file_data for performance
      query += `auuid, pbuuid, gvuuid, resuuid, file_crc16, file_crc32, locators, parents,
                file_ipfs_cidv0, file_ipfs_cidv1, file_hash_sha224, file_hash_sha1,
                file_hash_md5, file_hash_sha256, file_name, filekey,
                decoded_ipfs_cidv0, decoded_ipfs_cidv1, decoded_hash_sha224,
                decoded_hash_sha1, decoded_hash_md5, decoded_hash_sha256,
                updated_time, import_time, download_urls,
                arweave_file_name, arweave_file_id, arweave_file_path,
                last_search, file_size`;
    }
    
    query += ` FROM attachments ORDER BY import_time DESC LIMIT ? OFFSET ?`;
    
    const attachments = patchbinDb.prepare(query).all(limit, offset);
    const total = patchbinDb.prepare('SELECT COUNT(*) as count FROM attachments').get().count;
    
    logRequest(req.client.uuid, '/api/attachments', 'GET', 200, req.query, attachments.length);
    
    res.json({
      data: attachments,
      total: total,
      limit: limit,
      offset: offset
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Internal Server Error', message: error.message });
  }
});

app.get('/api/attachments/:id', authenticate, (req, res) => {
  try {
    if (!patchbinDb) {
      return res.status(503).json({ error: 'patchbin.db not available' });
    }
    
    const includeData = req.query.include_data === 'true';
    
    let query;
    if (includeData) {
      query = 'SELECT * FROM attachments WHERE auuid = ?';
    } else {
      query = `SELECT auuid, pbuuid, gvuuid, resuuid, file_crc16, file_crc32, locators, parents,
                      file_ipfs_cidv0, file_ipfs_cidv1, file_hash_sha224, file_hash_sha1,
                      file_hash_md5, file_hash_sha256, file_name, filekey,
                      decoded_ipfs_cidv0, decoded_ipfs_cidv1, decoded_hash_sha224,
                      decoded_hash_sha1, decoded_hash_md5, decoded_hash_sha256,
                      updated_time, import_time, download_urls,
                      arweave_file_name, arweave_file_id, arweave_file_path,
                      last_search, file_size
               FROM attachments WHERE auuid = ?`;
    }
    
    const attachment = patchbinDb.prepare(query).get(req.params.id);
    
    if (!attachment) {
      return res.status(404).json({ error: 'Not found' });
    }
    
    logRequest(req.client.uuid, `/api/attachments/${req.params.id}`, 'GET', 200, null, 1);
    
    res.json({ data: attachment });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Internal Server Error', message: error.message });
  }
});

// Search Endpoint (for fetchpatches.js Option G)
app.post('/api/search', authenticate, (req, res) => {
  try {
    if (!patchbinDb) {
      return res.status(503).json({ error: 'patchbin.db not available' });
    }
    
    const searchParams = req.body;
    
    // Build search query based on provided parameters
    let query = 'SELECT * FROM attachments WHERE 1=1';
    const params = [];
    
    if (searchParams.file_hash_sha256) {
      query += ' AND file_hash_sha256 = ?';
      params.push(searchParams.file_hash_sha256);
    } else if (searchParams.file_hash_sha224) {
      query += ' AND file_hash_sha224 = ?';
      params.push(searchParams.file_hash_sha224);
    }
    
    if (searchParams.file_name) {
      query += ' AND file_name = ?';
      params.push(searchParams.file_name);
    }
    
    if (searchParams.file_ipfs_cidv1) {
      query += ' AND file_ipfs_cidv1 = ?';
      params.push(searchParams.file_ipfs_cidv1);
    }
    
    if (searchParams.auuid) {
      query += ' AND auuid = ?';
      params.push(searchParams.auuid);
    }
    
    query += ' LIMIT 10';
    
    const results = patchbinDb.prepare(query).all(...params);
    
    logRequest(req.client.uuid, '/api/search', 'POST', 200, searchParams, results.length);
    
    if (results.length === 0) {
      return res.status(404).json({
        error: 'Not found',
        message: 'No matching attachments found'
      });
    }
    
    // Return first match with file_data if available
    const match = results[0];
    
    if (match.file_data) {
      // Return binary file data
      // Note: Binary responses are not signed
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('X-File-Name', match.file_name);
      res.setHeader('X-File-Size', match.file_size || match.file_data.length);
      
      // Add signature headers if available
      if (match.siglistuuid) {
        res.setHeader('X-Signature-List-UUID', match.siglistuuid);
      }
      
      res.send(match.file_data);
    } else {
      // Return metadata with URLs and signatures
      const responseData = {
        found: true,
        data: {
          auuid: match.auuid,
          file_name: match.file_name,
          file_size: match.file_size,
          arweave_file_id: match.arweave_file_id,
          arweave_file_path: match.arweave_file_path,
          file_ipfs_cidv0: match.file_ipfs_cidv0,
          file_ipfs_cidv1: match.file_ipfs_cidv1,
          download_urls: match.download_urls,
          siglistuuid: match.siglistuuid
        }
      };
      
      // Add signatures to response
      const signedResponse = addSignaturesToResponse(responseData, match, patchbinDb);
      res.json(signedResponse);
    }
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Internal Server Error', message: error.message });
  }
});

// ============================================================================
// Admin Endpoints
// ============================================================================

// Create new API client (admin only)
app.post('/api/clients', authenticate, requireAdmin, (req, res) => {
  try {
    const { client_name, admin_client } = req.body;
    
    if (!client_name) {
      return res.status(400).json({ error: 'client_name required' });
    }
    
    // Generate credentials
    const clientId = generateUUID();
    const clientSecret = crypto.randomBytes(32).toString('hex');
    const clientUuid = generateUUID();
    
    // Encrypt credentials
    const encryptedClientId = encrypt(clientId);
    const encryptedSecret = encrypt(clientSecret);
    
    // Insert into database
    serverDb.prepare(`
      INSERT INTO apiclients (clientuuid, encrypted_clientid, encrypted_secret, admin_client, client_name)
      VALUES (?, ?, ?, ?, ?)
    `).run(clientUuid, encryptedClientId, encryptedSecret, admin_client || 0, client_name);
    
    logRequest(req.client.uuid, '/api/clients', 'POST', 201, { client_name }, 1);
    
    res.status(201).json({
      message: 'Client created successfully',
      credentials: {
        client_id: clientId,
        client_secret: clientSecret,
        admin_client: admin_client || 0
      },
      warning: 'Save these credentials securely. They cannot be retrieved later.'
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Internal Server Error', message: error.message });
  }
});

// List API clients (admin only)
app.get('/api/clients', authenticate, requireAdmin, (req, res) => {
  try {
    const clients = serverDb.prepare(`
      SELECT clientuuid, client_name, admin_client, created_at, last_access, access_count
      FROM apiclients
      ORDER BY created_at DESC
    `).all();
    
    logRequest(req.client.uuid, '/api/clients', 'GET', 200, null, clients.length);
    
    res.json({ data: clients });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Internal Server Error', message: error.message });
  }
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal Server Error',
    message: err.message
  });
});

// ============================================================================
// Server Initialization
// ============================================================================

function startServer() {
  console.log('='.repeat(70));
  console.log('Metadata API Server');
  console.log('='.repeat(70));
  console.log();
  
  // Initialize databases
  initializeServerDatabase();
  initializeDataDatabases();
  
  console.log();
  
  // Start server
  app.listen(PORT, () => {
    console.log('='.repeat(70));
    console.log(`✓ Server running on http://localhost:${PORT}`);
    console.log('='.repeat(70));
    console.log();
    console.log('Endpoints:');
    console.log(`  GET  /                      - API information`);
    console.log(`  GET  /health                - Health check`);
    console.log(`  GET  /api/gameversions      - List game versions`);
    console.log(`  GET  /api/patchblobs        - List patch blobs`);
    console.log(`  GET  /api/attachments       - List attachments`);
    console.log(`  POST /api/search            - Search attachments`);
    console.log(`  POST /api/clients           - Create client (admin)`);
    console.log(`  GET  /api/clients           - List clients (admin)`);
    console.log();
    console.log('Authentication:');
    console.log(`  Headers: X-Client-Id, X-Client-Secret`);
    console.log();
  });
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down server...');
  if (serverDb) serverDb.close();
  if (rhdataDb) rhdataDb.close();
  if (patchbinDb) patchbinDb.close();
  process.exit(0);
});

if (require.main === module) {
  startServer();
}

module.exports = { app, encrypt, decrypt };

