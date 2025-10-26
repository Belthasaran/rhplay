const key1 = 'bU9uR0NOSExLUzNVTUpDcHktZkhqM0pEMTl2bVRTZWN3dnI1REZjbGQ2WT0='; // 60 chars, double-encoded
const key2 = 'p2aVxpQEz2LVAr4n8yoTYqXX5BSzEOHvmBrjWtZ7Nxg='; // 44 chars, single-encoded

function detectKeyFormat(keyBase64) {
  console.log('\n----- Testing key:', keyBase64.substring(0, 40) + '...');
  console.log('Length:', keyBase64.length);
  
  try {
    const decoded = Buffer.from(keyBase64, 'base64').toString('utf8');
    console.log('Decoded to UTF8:', decoded);
    console.log('Decoded length:', decoded.length);
    
    // Check if it looks like base64
    if (/^[A-Za-z0-9+/]+=*$/.test(decoded)) {
      console.log('✓ Looks like base64 (double-encoded)');
      const innerBuf = Buffer.from(decoded, 'base64');
      console.log('Inner decoded length:', innerBuf.length, 'bytes');
      return decoded; // Use the inner base64 string
    } else {
      console.log('✗ Not double-encoded, contains non-base64 chars');
      return keyBase64; // Use as-is
    }
  } catch (error) {
    console.log('✗ Decode error:', error.message);
    return keyBase64;
  }
}

detectKeyFormat(key1);
detectKeyFormat(key2);

