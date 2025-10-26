/**
 * Option G Implementation: API Search with Signature Verification
 * 
 * For fetchpatches.js Mode 2
 */

const crypto = require('crypto');

/**
 * Verify server signature and timestamp
 */
function verifyServerSignature(responseData, serverSignature, signerPublicKey, algorithm) {
  try {
    // CRITICAL: Verify timestamp is recent (protect against replay attacks)
    if (!responseData.response_timestamp) {
      console.error('    ✗ Server response missing response_timestamp');
      console.error('    ⚠ This could be a replay attack - REJECTING');
      return false;
    }
    
    const serverTime = new Date(responseData.response_timestamp).getTime();
    const clientTime = Date.now();
    const timeDiffSeconds = Math.abs(clientTime - serverTime) / 1000;
    
    if (timeDiffSeconds > 86400) {
      console.error('    ✗ Server time disagreement detected');
      console.error(`    ⚠ Server timestamp: ${responseData.response_timestamp}`);
      console.error(`    ⚠ Client time:      ${new Date().toISOString()}`);
      console.error(`    ⚠ Time difference:  ${Math.floor(timeDiffSeconds)} seconds (${Math.floor(timeDiffSeconds / 3600)} hours)`);
      console.error(`    ⚠ Maximum allowed:  86400 seconds (24 hours)`);
      if (serverTime < clientTime) {
        console.error('    ⚠ Server response is TOO OLD - possible replay attack');
      } else {
        console.error('    ⚠ Server time is in the FUTURE - check client system clock');
      }
      console.error('    REJECTING response due to timestamp validation failure');
      return false;
    }
    
    // Recreate hash of response data (including timestamp, excluding server_signature)
    // Server creates hash before adding server_signature, so we must exclude it
    const dataWithoutSignature = { ...responseData };
    delete dataWithoutSignature.server_signature;
    
    const dataString = JSON.stringify(dataWithoutSignature);
    const hash = crypto.createHash('sha256').update(dataString).digest();
    
    // Verify hash matches
    if (hash.toString('hex') !== serverSignature.hash) {
      console.error('    ✗ Server response hash mismatch');
      return false;
    }
    
    // Create public key object
    const publicKey = crypto.createPublicKey({
      key: Buffer.from(signerPublicKey, 'hex'),
      format: 'der',
      type: 'spki'
    });
    
    // Verify signature
    let isValid;
    if (algorithm === 'ED25519') {
      isValid = crypto.verify(
        null,
        hash,
        publicKey,
        Buffer.from(serverSignature.signature, 'hex')
      );
    } else if (algorithm === 'RSA') {
      isValid = crypto.verify(
        'sha256',
        hash,
        {
          key: publicKey,
          padding: crypto.constants.RSA_PKCS1_PSS_PADDING
        },
        Buffer.from(serverSignature.signature, 'hex')
      );
    } else {
      console.error(`    ✗ Unsupported algorithm: ${algorithm}`);
      return false;
    }
    
    if (isValid) {
      console.log(`    ✓ Timestamp verified: ${responseData.response_timestamp} (${Math.floor(timeDiffSeconds)}s ago)`);
    }
    
    return isValid;
  } catch (error) {
    console.error(`    ✗ Server signature verification error: ${error.message}`);
    return false;
  }
}

/**
 * Verify metadata signature
 */
function verifyMetadataSignature(record, signature, signerPublicKey, algorithm) {
  try {
    // Recreate canonical string (same as server signing process)
    const canonical = createCanonicalStringClient(record);
    
    // Hash the canonical string
    const hash = crypto.createHash('sha256').update(canonical).digest();
    
    // Create public key object
    const publicKey = crypto.createPublicKey({
      key: Buffer.from(signerPublicKey, 'hex'),
      format: 'der',
      type: 'spki'
    });
    
    // Verify signature
    let isValid;
    if (algorithm === 'ED25519') {
      isValid = crypto.verify(
        null,
        hash,
        publicKey,
        Buffer.from(signature.signature, 'hex')
      );
    } else if (algorithm === 'RSA') {
      isValid = crypto.verify(
        'sha256',
        hash,
        {
          key: publicKey,
          padding: crypto.constants.RSA_PKCS1_PSS_PADDING
        },
        Buffer.from(signature.signature, 'hex')
      );
    } else {
      return false;
    }
    
    return isValid;
  } catch (error) {
    console.error(`    ✗ Metadata signature verification error: ${error.message}`);
    return false;
  }
}

/**
 * Create canonical string for client-side verification
 * Must match server's createCanonicalString function
 */
function createCanonicalStringClient(record) {
  const entries = Object.entries(record)
    .filter(([key, value]) => {
      // Exclude signature-related fields
      if (key === 'siglistuuid') return false;
      if (key.includes('signature')) return false;
      
      // Exclude timestamp fields
      if (key.includes('import_time')) return false;
      if (key.includes('updated_time')) return false;
      if (key.includes('gvimport_time')) return false;
      if (key.includes('pbimport_time')) return false;
      if (key === 'last_search') return false;
      if (key === 'created_at') return false;
      if (key === 'last_access') return false;
      
      // IMPORTANT: Exclude file_data (covered by file_hash_sha256)
      if (key === 'file_data') return false;
      if (key === 'pblobdata') return false;
      
      return true;
    })
    .sort(([a], [b]) => a.localeCompare(b));
  
  const parts = entries.map(([key, value]) => {
    if (value === null) {
      return `${key}=null`;
    } else if (Buffer.isBuffer(value)) {
      return `${key}=${value.toString('hex')}`;
    } else {
      return `${key}=${value}`;
    }
  });
  
  return parts.join('&');
}

/**
 * Validate file_data hash
 */
function validateFileDataHash(fileData, expectedHash) {
  if (!fileData || !expectedHash) {
    return { valid: false, reason: 'missing_data_or_hash' };
  }
  
  const actualHash = crypto.createHash('sha256').update(fileData).digest('hex');
  
  if (actualHash !== expectedHash) {
    return {
      valid: false,
      reason: 'hash_mismatch',
      expected: expectedHash,
      actual: actualHash
    };
  }
  
  return { valid: true };
}

/**
 * Check donotsearch table for blocked URLs
 */
function isUrlBlocked(db, url) {
  try {
    const now = Math.floor(Date.now() / 1000);
    
    const blocked = db.prepare(`
      SELECT * FROM donotsearch
      WHERE url = ?
        AND (
          strftime('%s', since) + stop_time > ?
        )
      ORDER BY since DESC
      LIMIT 1
    `).get(url, now);
    
    if (blocked) {
      const expiresAt = new Date((Math.floor(new Date(blocked.since).getTime() / 1000) + blocked.stop_time) * 1000);
      return {
        blocked: true,
        reason: blocked.server_response,
        expiresAt: expiresAt
      };
    }
    
    return { blocked: false };
  } catch (error) {
    // If donotsearch table doesn't exist, not blocked
    return { blocked: false };
  }
}

/**
 * Add URL to donotsearch table
 */
function addToDoNotSearch(db, url, reason, stopTime = 17200) {
  try {
    const entryuuid = crypto.randomUUID();
    
    db.prepare(`
      INSERT OR REPLACE INTO donotsearch (entryuuid, url, server_response, stop_time)
      VALUES (?, ?, ?, ?)
    `).run(entryuuid, url, reason, stopTime);
    
    return true;
  } catch (error) {
    console.error(`    ⚠ Error adding to donotsearch: ${error.message}`);
    return false;
  }
}

/**
 * Search API endpoint
 */
async function searchAPI(attachment, options, db) {
  console.log(`  🌐 Searching API: ${options.apiUrl}`);
  
  if (!options.apiUrl || !options.apiClient || !options.apiSecret) {
    console.log(`    ⚠ API credentials not configured`);
    return null;
  }
  
  // Check if URL is blocked
  const blockStatus = isUrlBlocked(db, options.apiUrl);
  if (blockStatus.blocked) {
    console.log(`    ⚠ URL blocked until ${blockStatus.expiresAt.toISOString()}`);
    console.log(`      Reason: ${blockStatus.reason}`);
    return null;
  }
  
  try {
    // Prepare search request
    const searchData = {
      auuid: attachment.auuid,
      file_name: attachment.file_name,
      file_size: attachment.file_size,
      file_hash_sha256: attachment.file_hash_sha256,
      file_hash_sha224: attachment.file_hash_sha224,
      file_ipfs_cidv0: attachment.file_ipfs_cidv0,
      file_ipfs_cidv1: attachment.file_ipfs_cidv1,
      arweave_file_id: attachment.arweave_file_id,
      arweave_file_path: attachment.arweave_file_path
    };
    
    console.log(`    POST to ${options.apiUrl}`);
    
    const response = await fetch(options.apiUrl, {
      method: 'POST',
      headers: {
        'X-Client-Id': options.apiClient,
        'X-Client-Secret': options.apiSecret,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(searchData),
      signal: AbortSignal.timeout(30000) // 30 second timeout
    });
    
    // Handle HTTP errors
    if (response.status === 403) {
      console.log(`    ✗ HTTP 403 Forbidden - cancelling API search for this run`);
      return { cancelEndpoint: true };
    }
    
    if (response.status === 603) {
      console.log(`    ✗ HTTP 603 - server requests no more queries`);
      addToDoNotSearch(db, options.apiUrl, 'HTTP 603 received', 17200);
      return { cancelEndpoint: true };
    }
    
    if (!response.ok) {
      console.log(`    ✗ HTTP ${response.status}`);
      return null;
    }
    
    const contentType = response.headers.get('content-type');
    
    // Handle binary response
    if (contentType === 'application/octet-stream') {
      const fileData = Buffer.from(await response.arrayBuffer());
      const fileName = response.headers.get('x-file-name');
      const fileSize = parseInt(response.headers.get('x-file-size') || '0');
      
      console.log(`    ✓ Received binary file: ${fileName} (${fileSize} bytes)`);
      
      // Verify file hash (CRITICAL)
      const validation = validateFileDataHash(fileData, attachment.file_hash_sha256);
      
      if (!validation.valid) {
        console.error(`    ✗ file_data hash validation failed: ${validation.reason}`);
        if (validation.expected) {
          console.error(`      Expected: ${validation.expected}`);
          console.error(`      Got:      ${validation.actual}`);
        }
        return null;
      }
      
      console.log(`    ✓ file_data hash verified`);
      return { data: fileData, source: `api:${options.apiUrl}` };
    }
    
    // Handle JSON response
    const jsonResponse = await response.json();
    
    // Verify server signature (REQUIRED for JSON responses)
    if (!jsonResponse.server_signature) {
      console.error(`    ✗ No server signature - REJECTING response`);
      return null;
    }
    
    // Get server signer from local database
    const serverSigner = db.prepare(`
      SELECT publickey, publickey_type, signer_name
      FROM signers
      WHERE signeruuid = ?
    `).get(jsonResponse.server_signature.signeruuid);
    
    if (!serverSigner) {
      console.error(`    ✗ Unknown server signer: ${jsonResponse.server_signature.signeruuid}`);
      console.error(`      Add server signer to your local signers table`);
      return null;
    }
    
    // Verify server signer type (must be 'server' type, check by name convention)
    if (!serverSigner.signer_name.toLowerCase().includes('server')) {
      console.error(`    ✗ Signer is not a server signer: ${serverSigner.signer_name}`);
      return null;
    }
    
    // Verify server signature (pass entire response, not just .data)
    const serverSigValid = verifyServerSignature(
      jsonResponse,  // ← Fixed: Pass entire response (has response_timestamp at top level)
      jsonResponse.server_signature,
      serverSigner.publickey,
      jsonResponse.server_signature.algorithm
    );
    
    if (!serverSigValid) {
      console.error(`    ✗ Server signature verification FAILED - REJECTING response`);
      return null;
    }
    
    console.log(`    ✓ Server signature verified`);
    
    // Extract data
    const data = jsonResponse.data;
    
    if (!data.found && data.error) {
      console.log(`    ⚠ ${data.error}: ${data.message}`);
      return null;
    }
    
    // Check if response includes URLs for downloading
    if (data.file_ipfs_cidv1 || data.file_ipfs_cidv0 || data.arweave_file_id || data.download_urls) {
      console.log(`    ⓘ Metadata received (no file_data), URLs available:`);
      if (data.file_ipfs_cidv1) console.log(`      IPFS: ${data.file_ipfs_cidv1}`);
      if (data.arweave_file_id) console.log(`      ArDrive: ${data.arweave_file_id}`);
      if (data.download_urls) console.log(`      URLs: ${data.download_urls}`);
      
      // Return metadata - other search methods can use these URLs
      return { metadata: data, source: `api:${options.apiUrl}` };
    }
    
    return null;
    
  } catch (error) {
    console.error(`    ✗ API error: ${error.message}`);
    return null;
  }
}

module.exports = {
  searchAPI,
  verifyServerSignature,
  verifyMetadataSignature,
  validateFileDataHash,
  isUrlBlocked,
  addToDoNotSearch,
  createCanonicalStringClient
};

