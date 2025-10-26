#!/usr/bin/env python3
"""
create_reference_blob.py - Create Reference Blob Using Python

Creates a blob using the EXACT same method as mkblob.py to serve as a reference
for JavaScript blob-creator.js to match.

Usage:
    python3 create_reference_blob.py <patch_file> <gameid> [output_dir]
    
Example:
    python3 create_reference_blob.py tests/test_patches/test.bps test_ref tests/test_blobs
"""

import sys
import os
import hashlib
import base64
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

# Add compressor if available
try:
    from compressor import Compressor
except ImportError:
    # Use lzma directly
    import lzma
    class Compressor:
        def __init__(self):
            self.mode = 'lzma'
        def use_lzma(self):
            self.mode = 'lzma'
        def compress(self, data):
            return lzma.compress(data, preset=6)
        def decompress(self, data):
            return lzma.decompress(data)

def create_blob(patch_path, gameid, output_dir='blobs'):
    """Create blob using Python Fernet - matches mkblob.py exactly"""
    
    # Read patch file
    with open(patch_path, 'rb') as f:
        patdata = f.read()
    
    print(f"Patch file: {patch_path}")
    print(f"Patch size: {len(patdata)} bytes")
    
    # Calculate patch hashes
    pat_sha224 = hashlib.sha224(patdata).hexdigest()
    pat_sha1 = hashlib.sha1(patdata).hexdigest()
    
    print(f"Patch SHA-224: {pat_sha224}")
    
    # Step 1: Compress patch with LZMA
    comp = Compressor()
    comp.use_lzma()
    comp_patdata = comp.compress(patdata)
    
    print(f"Compressed size: {len(comp_patdata)} bytes")
    
    # Step 2: Derive encryption key (PBKDF2)
    password = bytes(pat_sha224, 'ascii')
    salt = os.urandom(16)
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=390000
    )
    key = base64.urlsafe_b64encode(kdf.derive(password))
    
    print(f"Key (URL-safe base64): {key.decode('ascii')}")
    print(f"Key length: {len(key.decode('ascii'))} chars")
    
    # Step 3: Encrypt with Fernet
    frn = Fernet(key)
    frndata = frn.encrypt(comp_patdata)
    
    print(f"Encrypted size: {len(frndata)} bytes")
    
    # Step 4: Compress encrypted data
    comp2 = Compressor()
    comp2.use_lzma()
    comp_frndata = comp2.compress(frndata)
    
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
    
    print(f"\n✅ Blob created: {blob_name}")
    print(f"Blob SHA-224: {frn_sha224}")
    
    # Return metadata for verification
    metadata = {
        'patchblob1_name': blob_name,
        'patchblob1_key': base64.urlsafe_b64encode(key).decode('ascii'),  # Double-encode!
        'patchblob1_sha224': frn_sha224,
        'pat_sha224': pat_sha224,
        'pat_sha1': pat_sha1,
        'romblob_salt': base64.urlsafe_b64encode(salt).decode('ascii')
    }
    
    # Save metadata JSON
    import json
    meta_path = blob_path + '.meta.json'
    with open(meta_path, 'w') as f:
        json.dump(metadata, f, indent=2)
    
    print(f"Metadata saved: {meta_path}")
    print(f"\nKey (double-encoded): {metadata['patchblob1_key']}")
    print(f"Key length: {len(metadata['patchblob1_key'])} chars")
    
    return metadata

if __name__ == '__main__':
    if len(sys.argv) < 3:
        print("Usage: python3 create_reference_blob.py <patch_file> <gameid> [output_dir]")
        print("Example: python3 create_reference_blob.py tests/test_patches/test.bps test_ref tests/test_blobs")
        sys.exit(1)
    
    patch_path = sys.argv[1]
    gameid = sys.argv[2]
    output_dir = sys.argv[3] if len(sys.argv) > 3 else 'blobs'
    
    if not os.path.exists(patch_path):
        print(f"Error: Patch file not found: {patch_path}")
        sys.exit(1)
    
    metadata = create_blob(patch_path, gameid, output_dir)
    
    print(f"\n{'='*70}")
    print("METADATA FOR TESTING:")
    print('='*70)
    for key, value in metadata.items():
        print(f"{key}: {value}")

