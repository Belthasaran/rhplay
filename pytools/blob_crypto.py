#!/usr/bin/env python3
"""
blob_crypto.py - Blob Encryption/Decryption Library

A standalone library for blob encryption and decryption that:
1. Can be called from both Python and JavaScript (via subprocess)
2. Handles ONLY encryption/decryption (no database or filesystem operations)
3. Supports both Python-created and JavaScript-created blob formats
4. Is compatible with existing mkblob.py format

Usage from Python:
    import blob_crypto
    blob_data, key = blob_crypto.encrypt_blob(patch_data, pat_sha224)
    patch_data = blob_crypto.decrypt_blob(blob_data, key, patchblob1_sha224)

Usage from JavaScript:
    const result = execSync('python3 blob_crypto.py encrypt <input_file> <output_file> <pat_sha224>');
    const result = execSync('python3 blob_crypto.py decrypt <input_file> <output_file> <key>');
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

def encrypt_blob(patch_data, pat_sha224):
    """
    Encrypt patch data to create blob.
    
    Args:
        patch_data (bytes): Raw patch file data
        pat_sha224 (str): SHA-224 hash of patch data (hex string)
    
    Returns:
        tuple: (blob_data, metadata_dict)
            blob_data (bytes): Encrypted and compressed blob
            metadata_dict (dict): Contains keys, hashes, etc.
    """
    # Step 1: Compress patch with LZMA
    comp_patdata = lzma.compress(patch_data, preset=6)
    
    # Step 2: Derive encryption key using PBKDF2
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
    frndata = frn.encrypt(comp_patdata)
    
    # Step 4: Compress encrypted data
    comp_frndata = lzma.compress(frndata, preset=6)
    
    # Calculate final hash
    frn_sha224 = hashlib.sha224(comp_frndata).hexdigest()
    
    # Prepare metadata
    metadata = {
        'patchblob1_key': base64.urlsafe_b64encode(key_urlsafe).decode('ascii'),  # Double-encode
        'patchblob1_sha224': frn_sha224,
        'romblob_salt': base64.urlsafe_b64encode(salt).decode('ascii'),
        'pat_sha224': pat_sha224,
        'key_urlsafe_b64': key_urlsafe.decode('ascii'),  # Single-encoded for internal use
        'created_by': 'python'
    }
    
    return comp_frndata, metadata


def decrypt_blob(blob_data, patchblob1_key, patchblob1_sha224, pat_sha224=None, detect_format=True):
    """
    Decrypt blob data to get original patch.
    
    Args:
        blob_data (bytes): Encrypted blob data
        patchblob1_key (str): Double-encoded base64 key
        patchblob1_sha224 (str): Expected SHA-224 of blob (for verification)
        pat_sha224 (str, optional): Expected SHA-224 of decoded patch (for verification)
        detect_format (bool): Auto-detect JavaScript vs Python blob format
    
    Returns:
        bytes: Decrypted patch data
    
    Raises:
        ValueError: If hashes don't match
    """
    # Verify blob hash
    actual_blob_hash = hashlib.sha224(blob_data).hexdigest()
    if actual_blob_hash != patchblob1_sha224:
        raise ValueError(f"Blob hash mismatch: expected {patchblob1_sha224}, got {actual_blob_hash}")
    
    # Step 1: Decompress blob
    decomp_blob = lzma.decompress(blob_data)
    
    # Step 2: Decrypt with Fernet
    # Decode the double-encoded key
    key = base64.urlsafe_b64decode(patchblob1_key.encode('ascii'))
    frn = Fernet(key)
    decrypted_blob = frn.decrypt(decomp_blob)
    
    # Step 3: Decompress decrypted data
    # Auto-detect format: Python format vs JavaScript format
    if detect_format:
        try:
            # Try Python format first (single LZMA decompress)
            decoded_blob = lzma.decompress(decrypted_blob)
        except Exception as e1:
            # Might be JavaScript format (base64-encoded LZMA data)
            try:
                # JavaScript Fernet returns base64 of the original data
                # If JavaScript passed base64(compressed_patch), we get that back
                # So we need to decode and then decompress
                lzma_data = base64.b64decode(decrypted_blob)
                decoded_blob = lzma.decompress(lzma_data)
            except Exception as e2:
                raise ValueError(f"Cannot decode blob. Python format failed: {e1}, JavaScript format failed: {e2}")
    else:
        # Standard Python format
        decoded_blob = lzma.decompress(decrypted_blob)
    
    # Verify patch hash if provided
    if pat_sha224:
        actual_pat_hash = hashlib.sha224(decoded_blob).hexdigest()
        if actual_pat_hash != pat_sha224:
            raise ValueError(f"Patch hash mismatch: expected {pat_sha224}, got {actual_pat_hash}")
    
    return decoded_blob


def encrypt_for_javascript(patch_data, pat_sha224):
    """
    Create a blob that JavaScript can decrypt.
    
    Since JavaScript Fernet can't handle raw bytes, we pre-encode to base64.
    This creates the same double-base64 format that JavaScript blob-creator.js creates.
    
    Returns:
        tuple: (blob_data, metadata_dict)
    """
    # Step 1: Compress patch
    comp_patdata = lzma.compress(patch_data, preset=6)
    
    # Step 2: Encode to base64 (JavaScript requirement to avoid UTF-8 corruption)
    comp_patdata_b64 = base64.b64encode(comp_patdata).decode('ascii')
    
    # Step 3: Derive key
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
    
    # Step 4: Encrypt the base64 string (Python Fernet will encrypt it as bytes)
    frn = Fernet(key_urlsafe)
    # Convert base64 string to bytes for encryption
    frndata = frn.encrypt(comp_patdata_b64.encode('utf-8'))
    
    # Step 5: Compress encrypted data
    comp_frndata = lzma.compress(frndata, preset=6)
    
    frn_sha224 = hashlib.sha224(comp_frndata).hexdigest()
    
    metadata = {
        'patchblob1_key': base64.urlsafe_b64encode(key_urlsafe).decode('ascii'),
        'patchblob1_sha224': frn_sha224,
        'romblob_salt': base64.urlsafe_b64encode(salt).decode('ascii'),
        'pat_sha224': pat_sha224,
        'created_by': 'python_for_js'
    }
    
    return comp_frndata, metadata


def main_cli():
    """Command-line interface"""
    if len(sys.argv) < 2:
        print("Usage:")
        print("  Encrypt: python3 blob_crypto.py encrypt <input_patch> <output_blob> <pat_sha224>")
        print("  Decrypt: python3 blob_crypto.py decrypt <input_blob> <output_patch> <key> <blob_sha224> [pat_sha224]")
        print("  Info:    python3 blob_crypto.py info <blob_file> <key> <blob_sha224>")
        sys.exit(1)
    
    command = sys.argv[1]
    
    if command == 'encrypt':
        if len(sys.argv) < 5:
            print("Error: encrypt requires <input_patch> <output_blob> <pat_sha224>")
            sys.exit(1)
        
        input_file = sys.argv[2]
        output_file = sys.argv[3]
        pat_sha224 = sys.argv[4]
        
        with open(input_file, 'rb') as f:
            patch_data = f.read()
        
        blob_data, metadata = encrypt_blob(patch_data, pat_sha224)
        
        with open(output_file, 'wb') as f:
            f.write(blob_data)
        
        # Output metadata as JSON
        print(json.dumps(metadata, indent=2))
    
    elif command == 'decrypt':
        if len(sys.argv) < 6:
            print("Error: decrypt requires <input_blob> <output_patch> <key> <blob_sha224> [pat_sha224]")
            sys.exit(1)
        
        input_file = sys.argv[2]
        output_file = sys.argv[3]
        patchblob1_key = sys.argv[4]
        patchblob1_sha224 = sys.argv[5]
        pat_sha224 = sys.argv[6] if len(sys.argv) > 6 else None
        
        with open(input_file, 'rb') as f:
            blob_data = f.read()
        
        patch_data = decrypt_blob(blob_data, patchblob1_key, patchblob1_sha224, pat_sha224)
        
        with open(output_file, 'wb') as f:
            f.write(patch_data)
        
        result = {
            'success': True,
            'patch_size': len(patch_data),
            'patch_sha224': hashlib.sha224(patch_data).hexdigest()
        }
        print(json.dumps(result, indent=2))
    
    elif command == 'info':
        if len(sys.argv) < 5:
            print("Error: info requires <blob_file> <key> <blob_sha224>")
            sys.exit(1)
        
        blob_file = sys.argv[2]
        patchblob1_key = sys.argv[3]
        patchblob1_sha224 = sys.argv[4]
        
        with open(blob_file, 'rb') as f:
            blob_data = f.read()
        
        try:
            patch_data = decrypt_blob(blob_data, patchblob1_key, patchblob1_sha224, detect_format=True)
            
            info = {
                'success': True,
                'blob_size': len(blob_data),
                'blob_sha224': hashlib.sha224(blob_data).hexdigest(),
                'patch_size': len(patch_data),
                'patch_sha224': hashlib.sha224(patch_data).hexdigest(),
                'format': 'auto-detected'
            }
            print(json.dumps(info, indent=2))
        except Exception as e:
            info = {
                'success': False,
                'error': str(e)
            }
            print(json.dumps(info, indent=2))
            sys.exit(1)
    
    else:
        print(f"Unknown command: {command}")
        sys.exit(1)


if __name__ == '__main__':
    main_cli()

