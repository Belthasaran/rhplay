const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const fernet = require('fernet');
const lzma = require('lzma-native');

const blobName = 'pblob_40663_4e20099461';
const keyBase64 = 'eWJsLW5ldzRQNlBTblVaZEVuc3ViNVRDWVJCbU5oM21GWklCaTF0UTl3UT0=';

async function decodeBlob(encryptedData, keyBase64) {
  console.log('Step 1: Decompressing LZMA...');
  console.log('  Input length:', encryptedData.length);
  
  try {
    const decompressed1 = await new Promise((resolve, reject) => {
      lzma.decompress(encryptedData, (result, error) => {
        if (error) reject(error);
        else resolve(Buffer.from(result));
      });
    });
    console.log('  ✓ Decompressed length:', decompressed1.length);
    console.log('  First 100 chars:', decompressed1.toString().substring(0, 100));
    
    console.log('\nStep 2: Decrypting Fernet...');
    const decoded = Buffer.from(keyBase64, 'base64').toString('utf8');
    console.log('  Decoded key:', decoded);
    console.log('  Is double-encoded?', /^[A-Za-z0-9+/\-_]+=*$/.test(decoded) && decoded.length >= 40);
    
    const fernetKey = decoded;
    console.log('  Using key:', fernetKey);
    
    const frnsecret = new fernet.Secret(fernetKey);
    const token = new fernet.Token({ 
      secret: frnsecret, 
      ttl: 0, 
      token: decompressed1.toString()
    });
    const decrypted = token.decode();
    console.log('  ✓ Decrypted length:', decrypted.length);
    
    console.log('\nStep 3: Decompressing LZMA again...');
    const decompressed2 = await new Promise((resolve, reject) => {
      lzma.decompress(Buffer.from(decrypted, 'base64'), (result, error) => {
        if (error) reject(error);
        else resolve(Buffer.from(result));
      });
    });
    console.log('  ✓ Final length:', decompressed2.length);
    console.log('  SHA-224:', crypto.createHash('sha224').update(decompressed2).digest('hex'));
    
    return decompressed2;
  } catch (error) {
    console.error('  ✗ Error:', error.message);
    throw error;
  }
}

const blobPath = path.join(__dirname, 'blobs', blobName);
console.log('Reading blob:', blobPath);

if (!fs.existsSync(blobPath)) {
  console.error('✗ Blob not found!');
  process.exit(1);
}

const fileData = fs.readFileSync(blobPath);
console.log('Blob size:', fileData.length, 'bytes\n');

decodeBlob(fileData, keyBase64)
  .then(() => console.log('\n✓ SUCCESS!'))
  .catch(err => {
    console.error('\n✗ FAILED:', err.message);
    process.exit(1);
  });

