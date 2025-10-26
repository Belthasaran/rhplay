#!/usr/bin/env python3
"""
loadsmwrh_compat.py - Compatibility Wrapper for loadsmwrh.py

Provides backward-compatible functions that work with both:
- Legacy Python-created blobs (single base64 format)
- New JavaScript-created blobs (double base64 format)

Usage:
    import loadsmwrh_compat as loadsmwrh
    
    # Drop-in replacement for loadsmwrh functions
    patch_data = loadsmwrh.get_patch_blob(hackid)
    hack_info = loadsmwrh.get_hack_info(hackid)
"""

import sys
import os
import base64
import hashlib

# Import original loadsmwrh for most functionality
sys.path.insert(0, os.path.dirname(__file__))
import loadsmwrh as original_loadsmwrh
import blob_crypto

# Re-export all functions from original loadsmwrh
from loadsmwrh import *

def get_patch_blob(hackid, blobinfo=None):
    """
    Get patch blob data - compatible with both Python and JavaScript blobs.
    
    This is a drop-in replacement for loadsmwrh.get_patch_blob() that adds
    support for JavaScript-created blobs with double base64 encoding.
    """
    idstr = str(hackid)
    
    # Get raw blob and hack info
    rawblob = original_loadsmwrh.get_patch_raw_blob(hackid, blobinfo)
    hackinfo = original_loadsmwrh.get_hack_info(hackid, True)
    
    if not hackinfo:
        return None
    
    # Get blob metadata
    if 'xdata' in hackinfo and hackinfo['xdata']:
        patchblob1_name = hackinfo['xdata'].get('patchblob1_name') or hackinfo.get('patchblob1_name')
        patchblob1_key = hackinfo['xdata'].get('patchblob1_key') or hackinfo.get('patchblob1_key')
        patchblob1_sha224 = hackinfo['xdata'].get('patchblob1_sha224') or hackinfo.get('patchblob1_sha224')
    else:
        patchblob1_name = hackinfo.get('patchblob1_name')
        patchblob1_key = hackinfo.get('patchblob1_key')
        patchblob1_sha224 = hackinfo.get('patchblob1_sha224')
    
    if not (patchblob1_name and patchblob1_key and patchblob1_sha224):
        print(f"[*] Error: Missing blob metadata for hack {hackid}")
        return None
    
    pat_sha224 = hackinfo.get('pat_sha224')
    
    try:
        # Use blob_crypto.py with auto-detection
        decoded_blob = blob_crypto.decrypt_blob(
            rawblob,
            patchblob1_key,
            patchblob1_sha224,
            pat_sha224,
            detect_format=True
        )
        
        print(f'Expected pat_sha224 = {pat_sha224}')
        print(f'sha224(decoded_blob) = {hashlib.sha224(decoded_blob).hexdigest()}')
        
        return decoded_blob
        
    except Exception as e:
        print(f'[*] Error decoding blob for hack {hackid}: {e}')
        return None


# Keep all other functions from original loadsmwrh
# They're already imported via "from loadsmwrh import *"

if __name__ == '__main__':
    # Test mode
    if len(sys.argv) > 1:
        hackid = sys.argv[1]
        print(f"Testing get_patch_blob for hack {hackid}...")
        blob = get_patch_blob(hackid)
        if blob:
            print(f"✅ Success! Blob size: {len(blob)} bytes")
        else:
            print(f"❌ Failed to get blob")
            sys.exit(1)

