const fs = require('fs');
const UrlBase64 = require('urlsafe-base64');

const path = require('path');
const process = require('process');
const crypto = require('crypto');
const zlib = require('zlib'); // For decompression (LZMA would require a specific library)
//const  lzma = require('node-liblzma');
//const lzma = require('@poeticode/js-lzma')

//
const { promisify } = require('util');
const decompress = promisify(zlib.unzip); // Simplified example using unzip
const { parse } = require('json5'); // To handle JSON with comments or non-standard syntax

const fernet = require('fernet');
const lzma = require('lzma-native');
const { Buffer } = require('buffer');

//
var CryptoJS = require('crypto-js/core');
var AES = require('crypto-js/aes');
var Utf8 = require('crypto-js/enc-utf8');
var Latin1 = require('crypto-js/enc-latin1');
var Hex = require('crypto-js/enc-hex');
var Base64 = require('crypto-js/enc-base64');
var HmacSHA256 = require('crypto-js/hmac-sha256');
var URLBase64 = require('urlsafe-base64');


// Dummy function for key retrieval, replace with actual logic
function rhmd_key(filename) {
    // Implement your logic to get the key
    return 'JtSYvgCpAX4Hz_J63g-5dmDKbJp_Dl2GnKL_yuhoEck=';
}


// Dummy function for path prefix, replace with actual implementation
function getPathPrefix() {
    // Implement your logic to determine the path prefix
    if (process.env.RHTOOLS_PATH) {
        return process.env.RHTOOLS_PATH;
    }
    return ''; // Replace with your actual path prefix logic
}

function rhmd_path() {
    const pathPrefix = getPathPrefix();
    const files = [
        'RHMD_FILE',
        'rhmd.dat',
        'rhmd_dist.dat',
        'rhmd_sample2.dat',
        'rhmd_sample.dat'
    ];

    // Check if 'RHMD_FILE' environment variable is set
    if (process.env.RHMD_FILE) {
        return process.env.RHMD_FILE;
    }

    // Check for the existence of each file in order
    for (const file of files.slice(1)) {
        const filePath = path.join(pathPrefix, file);
        if (fs.existsSync(filePath)) {
            return filePath;
        }
    }

    // If 'rhmd_dist.dat' file is not found, throw an error
    const fallbackPath = path.join(pathPrefix, 'rhmd_dist.dat');
    if (!fs.existsSync(fallbackPath)) {
        throw new Error('No rhmd DAT file found. Did you forget to extract rhtools-sampledata-20xx.tar.gz?');
    }

    return fallbackPath;
}


// Function to decode base64 and decrypt using Fernet-like encryption
async function decryptFernet(encryptedData, key) {
    // Fernet is not directly available in Node.js, so you might need to use a library or implement it
    // This is a placeholder implementation
	// frnsecret = new fernet.Secret(frnkeyS)

    //const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(key, 'base64'), Buffer.alloc(16, 0)); // Adjust mode and key
    //let decrypted = Buffer.concat([decipher.update(encryptedData), decipher.final()]);
    //console.log(`new fernet.Secret ${key}`)
    //console.log(`encryptedData = ${encryptedData}`)
	//
	//
    frnsecret = new fernet.Secret(key);
	//console.log("X:"+encryptedData);
    //encryptedData = UrlBase64.decode( encryptedData ).toString();
    token = new fernet.Token({secret: frnsecret, ttl: 0, token: encryptedData })

    //console.log("DECODE:" + encryptedData);
    //console.log(token.decode(encryptedData));
    return token.decode();
}

function atob(bstr) {
	return Buffer.from(bstr, 'base64').toString();
}

function base64ToArrayBuffer(base64) {
    var binaryString = atob(base64);
    var bytes = new Uint8Array(binaryString.length);
    for (var i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
}

async function getHackListData(filename) {
    if (!filename) {
        filename = rhmd_path();
    }

    //const key = Buffer.from(rhmd_key(filename), 'ascii').toString(); //.toString('base64');
    var key = rhmd_key(filename).toString();
    var fileContent = fs.readFileSync(filename, 'utf8');
    let hacklist;

    if (fileContent[0] === '*') {
	fileContent = fileContent.substring(1);


        // Use LZMA decompression or equivalent
        //const decrypted = await decryptFernet(Buffer.from(fileContent.substring(1), 'base64'), key);
	decrypted = await decryptFernet(fileContent, key);
	    //console.log("X:"+decrypted);
	    //
        const decompressed = await lzma.decompress(Buffer.from(decrypted, 'base64'));
	//console.log(decompressed.toString('utf8'));

        hacklist = JSON.parse(decompressed.toString('utf8'));
    } else if (fileContent[0] === '[' || fileContent[0] === '{') {
        if (fileContent[0] === '{') {
            fileContent = '[' + fileContent + ']';
        }
        hacklist = JSON.parse(fileContent); // Handle file if not encoded
    } else {
        hacklist = JSON.parse(Buffer.from(fileContent, 'base64').toString('utf8'));
    }

    return hacklist;
}



///
//
//
//


//const fs = require('fs');
//const fernet = require('fernet');
//const lzma = require('lzma-native');
//const { Buffer } = require('buffer');

// Function to initialize Fernet
function getFernetInstance(key) {
    return new fernet.Token({
        secret: Buffer.from(key, 'base64'),
        ttl: 0 // Set to 0 for no expiration
    });
}

async function getGenListData(filename, fernetKey) {
    // Read the file contents
    const data = fs.readFileSync(filename, 'utf8');
    let hacklist = null;

    if (data[0] === '*') {
        // Decrypt and decompress the data
        const fernetInstance = getFernetInstance(fernetKey);
        const decryptedData = fernetInstance.decrypt(Buffer.from(data, 'utf8')).toString('utf8');
        const decompressedData = await lzma.decompress(Buffer.from(decryptedData, 'base64'));
        hacklist = JSON.parse(decompressedData.toString('utf8'));
    } else if (data[0] === '[' || data[0] === '{') {
        if (data[0] === '{') {
            // Wrap single JSON object in array brackets
            const wrappedData = '[' + data + ']';
            hacklist = JSON.parse(wrappedData);
        } else {
            // Directly parse the JSON array
            hacklist = JSON.parse(data);
        }
    } else {
        // Base64 decode and parse
        const base64Data = Buffer.from(data, 'base64').toString('utf8');
        hacklist = JSON.parse(base64Data);
    }

    return hacklist;
}

//def get_patch_blob(hackid, blobinfo=None):
async function getHackInfo(hacklist, hackid) 
{
     var result = hacklist.filter(x => x.id === ('' + hackid))

     return result[result.length - 1]
}

async function getPatchRawBlob( blob_name, blobinfo )
{
      const directPath = path.join(getPathPrefix(), "blobs", blob_name);

      if (fs.existsSync(directPath)) {
         return fs.readFileSync(directPath)
      }
}

function sha224(buffer) {
  return crypto.createHash("sha224").update(buffer).digest("hex");
}

async function decompressLZMA(buffer) {
	return await lzma.decompress(buffer)
}

async function getHackPatchBlob(hackinfo) 
{  //  Object.keys(b.xdata).filter(x => x.match('^patchblob.*_name'))
   blob_namekeys = []

   if (hackinfo.xdata) {
       blob_namekeys = Object.keys(hackinfo.xdata).filter(x => x.match('^patchblob1_name'))
   }

   if (blob_namekeys.length == 0) {
	      blob_namekeys = Object.keys(hackinfo).filter(x => x.match('^patchblob1_name'))

   }

   if (blob_namekeys.length == 1) {
	   if (hackinfo.xdata && hackinfo.xdata.patchblob1_name) {
	   pblob_name = hackinfo.xdata.patchblob1_name
	   pblob_key  = hackinfo.xdata.patchblob1_key
	   pblob_kn   = hackinfo.xdata.patchblob1_kn
	   pblob_sha224 = hackinfo.xdata.patchblob1_sha224
	   } else {
		   pblob_name = hackinfo.patchblob1_name
           pblob_key  = hackinfo.patchblob1_key
           pblob_kn   = hackinfo.patchblob1_kn
           pblob_sha224 = hackinfo.patchblob1_sha224
	   }

	   /*blobinfo = {
		   // patchblob1_url:
		   patchblob1_kn: pblob_kn,
		   // patchblob1_ipfs_hash:
		   // patchblob1_ipfs_url
	   }*/
	   rawblob = await getPatchRawBlob( pblob_name, null )
	   rbsha224 = sha224(rawblob)
	   console.log('Expected patchblob1_sha224 = ' + pblob_sha224)
	   console.log('sha224(rawblob) = ' + rbsha224)
	   if (rbsha224 != pblob_sha224) {
		   console.log('ERROR: Patchblob integrity check failed sha224 of patchblob does not match')
		   return null
	   }

	   decomp1 = await decompressLZMA(rawblob)

	   console.log(`pblob_key = ${pblob_key}`)
	   
	   key = UrlBase64.encode(atob(pblob_key)).toString()  //btoa(pblob_key)
	   console.log(`key = ${key}`)

	   data = await decryptFernet( Buffer.from(decomp1).toString(), key)
	   //console.log(`Decrypt: ${data}`)
           console.log(`expected patch_sha224 = ${hackinfo.pat_sha224}`)
	   //console.log(`X=${ sha224(data) }`)
	   //
	   //        const decompressedData = await lzma.decompress(Buffer.from(decryptedData, 'base64'));
	   
	   // Auto-detect format: Python blobs (single base64) vs JavaScript blobs (double base64)
	   let lzmaData = Buffer.from(data, 'base64');
	   // Check for LZMA/XZ magic bytes (0xFD or 0x5D)
	   if (lzmaData[0] !== 0xfd && lzmaData[0] !== 0x5d) {
	       // Not valid LZMA - might be double-encoded (JavaScript format)
	       try {
	           const decoded1 = lzmaData.toString('utf8');
	           lzmaData = Buffer.from(decoded1, 'base64');
	       } catch (e) {
	           // Keep original if double-decode fails
	       }
	   }
	   
	   decomp2 = await decompressLZMA(lzmaData)

	   console.log(`expected patch_sha224 = ${hackinfo.pat_sha224}`)
	   console.log(`sha224(decoded_blob) = ${ sha224(decomp2) }`)
	   // incomplete
	   //
	   if (hackinfo.pat_sha224 != sha224(decomp2)) {
		   console.log('ERROR: Patch data integrity check failed. sha224 of decoded patch blob does not match pat_sha224')
		   return null
	   }
	   return decomp2
   }
   return null
}

/*
    idstr = str(hackid)
    rawblob = get_patch_raw_blob(hackid, blobinfo)
    hackinfo = get_hack_info(hackid, True)
    #print(json.dumps(hackinfo, indent=4))
    print('Expected patchblob1_sha224 = ' + str(hackinfo["patchblob1_sha224"]))
    print('sha224(rawblob) = ' + hashlib.sha224(rawblob).hexdigest())
    if hashlib.sha224(rawblob).hexdigest() == hackinfo["patchblob1_sha224"]:
        comp = Compressor()
        comp.use_lzma()
        decomp_blob = comp.decompress(rawblob)

        key = base64.urlsafe_b64decode( bytes(hackinfo["patchblob1_key"], 'ascii') )
        frn = Fernet(key)
        decrypted_blob  = frn.decrypt(decomp_blob)

        comp = Compressor()
        comp.use_lzma()
        decoded_blob = comp.decompress(decrypted_blob)
        #frn_sha224 = hashlib.sha224(comp_frndata).hexdigest()
        print('Expected pat_sha224 = ' + hackinfo["pat_sha224"]  )
        print('sha224(decoded_blob) = ' + hashlib.sha224(decoded_blob).hexdigest())
        if hashlib.sha224(decoded_blob).hexdigest() ==  hackinfo["pat_sha224"]:
            return decoded_blob
        print('Error: Decoded patch does not match expected file checksum - possible data corruption.')
        return None

    print('[*] Error: Possible file corruption: Sha224 data checksum of received file does not match')
    return None

	*/

module.exports = {
    getGenListData,
    getHackListData, 
    getHackInfo,
    getHackPatchBlob
};


var hld = getHackListData();










