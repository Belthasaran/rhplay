#!/usr/bin/env python3
"""
create_blob_python.py - Python Blob Creator for JavaScript

Creates blobs using Python Fernet (single base64 format) that are
compatible with all decoders including original loadsmwrh.py.

This script is called from JavaScript blob-creator.js to create
Python-format blobs instead of JavaScript-format blobs.

Usage from command line:
    python3 create_blob_python.py <patch_file> <gameid> <output_dir> <pat_sha224>

Returns JSON:
    {
      "success": true,
      "patchblob1_name": "pblob_...",
      "patchblob1_key": "...",
      "patchblob1_sha224": "...",
      "romblob_name": "...",  (if ROM provided)
      "romblob_salt": "..."
    }
"""

import sys
import os
import base64
import hashlib
import lzma
import json
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

def create_patch_blob(patch_file, gameid, output_dir, pat_sha224_expected=None):
    """
    Create encrypted patch blob using Python Fernet.
    
    Returns metadata dict with blob name, key, hashes, etc.
    """
    # Read patch file
    with open(patch_file, 'rb') as f:
        patdata = f.read()
    
    # Calculate hashes
    pat_sha224 = hashlib.sha224(patdata).hexdigest()
    pat_sha1 = hashlib.sha1(patdata).hexdigest()
    
    # Verify if expected hash provided
    if pat_sha224_expected and pat_sha224 != pat_sha224_expected:
        raise ValueError(f"Patch hash mismatch: expected {pat_sha224_expected}, got {pat_sha224}")
    
    # Step 1: Compress patch with LZMA
    comp_patdata = lzma.compress(patdata, preset=6)
    
    # Step 2: Derive encryption key
    password = bytes(pat_sha224, 'ascii')
    salt = os.urandom(16)
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=390000
    )
    key_bytes = kdf.derive(password)
    key_urlsafe = base64.urlsafe_b64encode(key_bytes)
    
    # Step 3: Encrypt with Fernet
    frn = Fernet(key_urlsafe)
    frndata = frn.encrypt(comp_patdata)  # Python: encrypts bytes, returns bytes
    
    # Step 4: Compress encrypted data
    comp_frndata = lzma.compress(frndata, preset=6)
    frn_sha224 = hashlib.sha224(comp_frndata).hexdigest()
    
    # Step 5: Save blob
    blob_name = f"pblob_{gameid}_{frn_sha224[0:10]}"
    blob_path = os.path.join(output_dir, blob_name)
    
    os.makedirs(output_dir, exist_ok=True)
    
    with open(blob_path + ".new", "wb") as f:
        f.write(comp_frndata)
    
    if os.path.exists(blob_path):
        os.remove(blob_path)
    os.replace(blob_path + ".new", blob_path)
    
    # Return metadata
    metadata = {
        'success': True,
        'patchblob1_name': blob_name,
        'patchblob1_key': base64.urlsafe_b64encode(key_urlsafe).decode('ascii'),  # Double-encode
        'patchblob1_sha224': frn_sha224,
        'romblob_salt': base64.urlsafe_b64encode(salt).decode('ascii'),
        'pat_sha224': pat_sha224,
        'pat_sha1': pat_sha1,
        'created_by': 'python'
    }
    
    return metadata


def create_rom_blob(rom_file, gameid, output_dir, pat_sha224, salt_b64):
    """
    Create encrypted ROM blob.
    """
    with open(rom_file, 'rb') as f:
        romdata = f.read()
    
    # Calculate hashes
    result_sha224 = hashlib.sha224(romdata).hexdigest()
    result_sha1 = hashlib.sha1(romdata).hexdigest()
    
    # Step 1: Compress ROM
    comp_romdata = lzma.compress(romdata, preset=6)
    
    # Step 2: Use same salt and password as patch
    password = bytes(pat_sha224, 'ascii')
    salt = base64.urlsafe_b64decode(salt_b64.encode('ascii'))
    
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=390000
    )
    key_bytes = kdf.derive(password)
    key_urlsafe = base64.urlsafe_b64encode(key_bytes)
    
    # Step 3: Encrypt
    frn = Fernet(key_urlsafe)
    frndata = frn.encrypt(comp_romdata)
    
    # Step 4: Compress
    comp_frndata = lzma.compress(frndata, preset=6)
    frn_sha224 = hashlib.sha224(comp_frndata).hexdigest()
    
    # Step 5: Save
    blob_name = f"rblob_{gameid}_{frn_sha224[0:10]}"
    blob_path = os.path.join(output_dir, blob_name)
    
    with open(blob_path + ".new", "wb") as f:
        f.write(comp_frndata)
    
    if os.path.exists(blob_path):
        os.remove(blob_path)
    os.replace(blob_path + ".new", blob_path)
    
    return {
        'romblob_name': blob_name,
        'result_sha224': result_sha224,
        'result_sha1': result_sha1
    }


if __name__ == '__main__':
    if len(sys.argv) < 5:
        print(json.dumps({
            'success': False,
            'error': 'Usage: python3 create_blob_python.py <patch_file> <gameid> <output_dir> <pat_sha224> [rom_file]'
        }))
        sys.exit(1)
    
    try:
        patch_file = sys.argv[1]
        gameid = sys.argv[2]
        output_dir = sys.argv[3]
        pat_sha224 = sys.argv[4]
        rom_file = sys.argv[5] if len(sys.argv) > 5 else None
        
        # Create patch blob
        metadata = create_patch_blob(patch_file, gameid, output_dir, pat_sha224)
        
        # Create ROM blob if provided
        if rom_file and os.path.exists(rom_file):
            rom_metadata = create_rom_blob(rom_file, gameid, output_dir, pat_sha224, metadata['romblob_salt'])
            metadata.update(rom_metadata)
        
        # Output as JSON
        print(json.dumps(metadata))
        sys.exit(0)
        
    except Exception as e:
        print(json.dumps({
            'success': False,
            'error': str(e)
        }), file=sys.stderr)
        sys.exit(1)

