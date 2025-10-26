#!/usr/bin/env python3
"""
verify-all-blobs.py - Comprehensive Blob Verification (Python)

Verifies all patchblobs can be decoded and are valid.

Usage:
    python3 verify-all-blobs.py [options]

Options:
    --dbtype=<type>        Database type: 'sqlite' or 'rhmd' (default: sqlite)
    --verify-blobs=<src>   Blob source: 'db' or 'files' (default: files)
                           db = verify from patchbin.db file_data column
                           files = verify from blob files in blobs/ directory
    --gameid=<id>          Verify specific game ID only
    --file-name=<name>     Verify specific blob file only
    --full-check           Test patches with flips (slow, comprehensive)
    --verify-result        Verify flips result hash against result_sha224 (requires --full-check)
    --newer-than=<value>   Only verify blobs newer than timestamp or blob file_name
                           (value can be ISO date/timestamp or a patchblob file_name)
    --log-file=<path>      Log results to file (default: verification_results_py.log)
    --failed-file=<path>   Save failed items list (default: failed_blobs_py.json)

Exit codes:
    0 - All blobs valid
    1 - Some blobs failed verification
    2 - Fatal error
"""

import sys
import os
import json
import hashlib
import sqlite3
import subprocess
from datetime import datetime

# Add project root to path
sys.path.insert(0, os.path.dirname(__file__))

try:
    import blob_crypto
except ImportError:
    print("Error: blob_crypto.py not found")
    sys.exit(2)

CONFIG = {
    'DB_PATH': 'electron/rhdata.db',
    'PATCHBIN_DB_PATH': 'electron/patchbin.db',
    'BLOBS_DIR': 'blobs',
    'TEMP_DIR': 'temp',
    'LOG_FILE': 'verification_results_py.log',
    'FAILED_FILE': 'failed_blobs_py.json',
    'DBTYPE': 'sqlite',
    'VERIFY_SOURCE': 'files',  # 'files' or 'db'
    'GAMEID': None,
    'FILE_NAME': None,
    'FULL_CHECK': False,
    'VERIFY_RESULT': False,
    'NEWER_THAN': None,
    'FLIPS_PATH': None,
    'BASE_ROM_PATH': None
}

class VerificationLogger:
    def __init__(self, log_file):
        self.log_file = log_file
        self.log_stream = open(log_file, 'w') if log_file else None
    
    def log(self, message):
        print(message)
        if self.log_stream:
            self.log_stream.write(message + '\n')
            self.log_stream.flush()
    
    def close(self):
        if self.log_stream:
            self.log_stream.close()

def verify_blob(patchblob, patchbin_conn, logger, full_check=False, verify_result=False, verify_source='files'):
    """Verify a single patchblob"""
    gameid = patchblob.get('gameid', 'N/A')
    blob_name = patchblob['patchblob1_name']
    
    result = {
        'gameid': gameid,
        'pbuuid': patchblob.get('pbuuid'),
        'patchblob1_name': blob_name,
        'source_checked': verify_source,
        'file_exists': False,
        'file_hash_valid': False,
        'decode_success': False,
        'patch_hash_valid': False,
        'flips_test_success': False,
        'result_hash_valid': False,
        'errors': []
    }
    
    file_data = None
    
    try:
        # Get blob data from appropriate source
        if verify_source == 'db':
            # Check 1: Get blob from patchbin.db file_data column
            cursor = patchbin_conn.cursor()
            cursor.execute(
                "SELECT file_data, file_hash_sha224 FROM attachments WHERE file_name = ?",
                (blob_name,)
            )
            row = cursor.fetchone()
            
            if not row or not row[0]:
                result['errors'].append('Attachment not found in database or file_data is NULL')
                return result
            result['file_exists'] = True
            
            file_data = row[0]
            db_file_hash = row[1]
            
            # Verify against stored hash
            file_hash = hashlib.sha224(file_data).hexdigest()
            if file_hash != db_file_hash:
                result['errors'].append(f"DB file_hash_sha224 mismatch: expected {db_file_hash}, got {file_hash}")
                return result
            
        else:
            # Check 1: Blob file exists on filesystem
            blob_path = os.path.join(CONFIG['BLOBS_DIR'], blob_name)
            
            if not os.path.exists(blob_path):
                result['errors'].append('Blob file not found on filesystem')
                return result
            result['file_exists'] = True
            
            with open(blob_path, 'rb') as f:
                file_data = f.read()
        
        # Check 2: File hash matches patchblob1_sha224
        file_hash = hashlib.sha224(file_data).hexdigest()
        
        if file_hash != patchblob['patchblob1_sha224']:
            result['errors'].append(f"File hash mismatch: expected {patchblob['patchblob1_sha224']}, got {file_hash}")
            return result
        result['file_hash_valid'] = True
        
        # Check 3: Blob can be decoded
        try:
            decoded_data = blob_crypto.decrypt_blob(
                file_data,
                patchblob['patchblob1_key'],
                patchblob['patchblob1_sha224'],
                patchblob.get('pat_sha224'),
                detect_format=True
            )
            result['decode_success'] = True
        except Exception as e:
            result['errors'].append(f"Decode failed: {e}")
            return result
        
        # Check 4: Decoded hash matches
        decoded_hash = hashlib.sha224(decoded_data).hexdigest()
        
        if decoded_hash != patchblob['pat_sha224']:
            result['errors'].append(f"Patch hash mismatch: expected {patchblob['pat_sha224']}, got {decoded_hash}")
            return result
        result['patch_hash_valid'] = True
        
        # Check 5: Full check with flips (optional)
        if full_check and CONFIG['FLIPS_PATH'] and CONFIG['BASE_ROM_PATH']:
            try:
                temp_patch = os.path.join(CONFIG['TEMP_DIR'], f"verify_{blob_name}.patch")
                temp_rom = os.path.join(CONFIG['TEMP_DIR'], f"verify_{blob_name}.sfc")
                
                with open(temp_patch, 'wb') as f:
                    f.write(decoded_data)
                
                flips_cmd = [CONFIG['FLIPS_PATH'], '--apply', temp_patch, CONFIG['BASE_ROM_PATH'], temp_rom]
                subprocess.run(flips_cmd, check=True, capture_output=True)
                
                result['flips_test_success'] = True
                
                # Check result hash if requested
                if verify_result and patchblob.get('result_sha224') and os.path.exists(temp_rom):
                    with open(temp_rom, 'rb') as f:
                        result_data = f.read()
                    
                    result_hash = hashlib.sha224(result_data).hexdigest()
                    
                    if result_hash == patchblob['result_sha224']:
                        result['result_hash_valid'] = True
                    else:
                        result['errors'].append(f"Result hash mismatch: expected {patchblob['result_sha224']}, got {result_hash}")
                        result['flips_test_success'] = False  # Override - result doesn't match
                elif verify_result and not patchblob.get('result_sha224'):
                    # No expected hash to verify against
                    result['result_hash_valid'] = None
                
                # Clean up
                if os.path.exists(temp_patch):
                    os.remove(temp_patch)
                if os.path.exists(temp_rom):
                    os.remove(temp_rom)
                
            except subprocess.CalledProcessError as e:
                result['errors'].append(f"Flips test failed: exit code {e.returncode}")
            except Exception as e:
                result['errors'].append(f"Flips test failed: {e}")
        
    except Exception as e:
        result['errors'].append(f"Unexpected error: {e}")
    
    return result

def get_patchblobs_from_sqlite(gameid=None, file_name=None, newer_than=None):
    """Get patchblobs from SQLite database"""
    conn = sqlite3.connect(CONFIG['DB_PATH'])
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    # Resolve newer-than timestamp if specified
    newer_than_timestamp = None
    if newer_than:
        # Need patchbin.db connection for resolving newer_than
        patchbin_conn_temp = sqlite3.connect(CONFIG['PATCHBIN_DB_PATH'])
        newer_than_timestamp = resolve_newer_than_timestamp(newer_than, conn, patchbin_conn_temp)
        patchbin_conn_temp.close()
        print(f"Filtering to blobs newer than: {newer_than_timestamp}\n")
    
    # Attach patchbin.db if using newer_than filter
    if newer_than_timestamp:
        cursor.execute(f"ATTACH DATABASE '{CONFIG['PATCHBIN_DB_PATH']}' AS patchbin")
        
        query = """
            SELECT pb.*, gv.gameid
            FROM patchblobs pb
            LEFT JOIN gameversions gv ON gv.gvuuid = pb.gvuuid
            LEFT JOIN patchbin.attachments a ON a.file_name = pb.patchblob1_name
            WHERE pb.patchblob1_key IS NOT NULL
        """
    else:
        query = """
            SELECT pb.*, gv.gameid
            FROM patchblobs pb
            LEFT JOIN gameversions gv ON gv.gvuuid = pb.gvuuid
            WHERE pb.patchblob1_key IS NOT NULL
        """
    
    params = []
    
    if gameid:
        query += " AND gv.gameid = ?"
        params.append(gameid)
    
    if file_name:
        query += " AND pb.patchblob1_name = ?"
        params.append(file_name)
    
    if newer_than_timestamp:
        query += " AND (pb.pbimport_time >= ? OR a.updated_time >= ? OR a.import_time >= ?)"
        params.extend([newer_than_timestamp, newer_than_timestamp, newer_than_timestamp])
    
    query += " ORDER BY gv.gameid"
    
    cursor.execute(query, params)
    rows = cursor.fetchall()
    
    patchblobs = [dict(row) for row in rows]
    
    conn.close()
    return patchblobs

def get_patchblobs_from_rhmd(gameid=None, file_name=None, newer_than=None):
    """Get patchblobs from RHMD file"""
    # Note: newer_than filtering for RHMD requires loading metadata for timestamp lookup
    newer_than_timestamp = None
    if newer_than:
        # For RHMD, we need to resolve the timestamp differently
        # If it's a blob name, we need to find it in the RHMD data
        if newer_than.startswith('pblob_') or newer_than.startswith('rblob_'):
            # We'll need to filter after loading all data
            print(f"Will filter to blobs newer than: {newer_than} (requires loading all data)")
        else:
            # Parse as timestamp
            from datetime import datetime
            dt = datetime.fromisoformat(newer_than.replace('Z', '+00:00'))
            newer_than_timestamp = dt.isoformat()
            print(f"Filtering to blobs newer than: {newer_than_timestamp}\n")
    
    try:
        import loadsmwrh
        
        hacklist = loadsmwrh.get_hacklist_data()
        patchblobs = []
        
        for hack in hacklist:
            # Filter by gameid if specified
            if gameid and str(hack.get('id')) != str(gameid):
                continue
            
            # Get patchblob info from hack
            if 'xdata' in hack and hack['xdata']:
                blob_name = hack['xdata'].get('patchblob1_name')
                blob_key = hack['xdata'].get('patchblob1_key')
                blob_sha224 = hack['xdata'].get('patchblob1_sha224')
            else:
                blob_name = hack.get('patchblob1_name')
                blob_key = hack.get('patchblob1_key')
                blob_sha224 = hack.get('patchblob1_sha224')
            
            if not (blob_name and blob_key and blob_sha224):
                continue
            
            # Filter by file name if specified
            if file_name and blob_name != file_name:
                continue
            
            # Get timestamps for filtering
            updated_time = hack.get('updated_time') or (hack.get('xdata', {}).get('updated_time') if isinstance(hack.get('xdata'), dict) else None)
            import_time = hack.get('import_time') or (hack.get('xdata', {}).get('import_time') if isinstance(hack.get('xdata'), dict) else None)
            pbimport_time = hack.get('pbimport_time') or (hack.get('xdata', {}).get('pbimport_time') if isinstance(hack.get('xdata'), dict) else None)
            
            # Filter by newer_than if specified
            if newer_than_timestamp:
                timestamps = [t for t in [updated_time, import_time, pbimport_time] if t]
                if timestamps:
                    latest = max(timestamps)
                    if latest < newer_than_timestamp:
                        continue
                else:
                    # No timestamps - skip if newer_than filter is active
                    continue
            elif newer_than and newer_than.startswith('pblob_'):
                # Blob name reference - need to find that blob's timestamp first
                if blob_name == newer_than:
                    # This is the reference blob itself
                    timestamps = [t for t in [updated_time, import_time, pbimport_time] if t]
                    if timestamps:
                        newer_than_timestamp = max(timestamps)
                    continue  # Don't include the reference blob itself
            
            patchblob = {
                'gameid': hack.get('id'),
                'pbuuid': None,
                'patchblob1_name': blob_name,
                'patchblob1_key': blob_key,
                'patchblob1_sha224': blob_sha224,
                'pat_sha224': hack.get('pat_sha224'),
                'updated_time': updated_time,
                'import_time': import_time,
                'pbimport_time': pbimport_time,
                'source': 'rhmd'
            }
            
            patchblobs.append(patchblob)
        
        return patchblobs
        
    except Exception as e:
        print(f"Error loading RHMD file: {e}")
        return []

def resolve_newer_than_timestamp(newer_than_value, conn, patchbin_conn=None):
    """
    Resolve newer-than value to a timestamp.
    Can be a blob file_name or a timestamp.
    """
    # Check if it looks like a patchblob filename
    if newer_than_value.startswith('pblob_') or newer_than_value.startswith('rblob_'):
        # Query patchblobs table for pbimport_time
        cursor = conn.cursor()
        cursor.execute(
            'SELECT pbimport_time FROM patchblobs WHERE patchblob1_name = ?',
            (newer_than_value,)
        )
        row = cursor.fetchone()
        
        timestamps = []
        
        if row and row[0]:
            timestamps.append(row[0])
        
        # Query attachments table for updated_time and import_time (from patchbin.db)
        if patchbin_conn:
            cursor = patchbin_conn.cursor()
            cursor.execute(
                'SELECT updated_time, import_time FROM attachments WHERE file_name = ?',
                (newer_than_value,)
            )
            row = cursor.fetchone()
            
            if row:
                if row[0]: timestamps.append(row[0])
                if row[1]: timestamps.append(row[1])
        
        if not timestamps:
            raise ValueError(f"Blob {newer_than_value} not found or has no valid timestamps")
        
        # Return the latest timestamp
        latest = max(timestamps)
        print(f"Using timestamp from blob {newer_than_value}: {latest}")
        return latest
    
    # Not a blob name - treat as timestamp
    # Try to parse as ISO date or timestamp
    try:
        from datetime import datetime
        dt = datetime.fromisoformat(newer_than_value.replace('Z', '+00:00'))
        timestamp = dt.isoformat()
        print(f"Using specified timestamp: {timestamp}")
        return timestamp
    except Exception as e:
        raise ValueError(f"Invalid --newer-than value: {newer_than_value}. Must be a valid blob file_name or ISO date/timestamp.")

def main():
    # Parse arguments
    import argparse
    parser = argparse.ArgumentParser(description='Verify all patchblobs')
    parser.add_argument('--dbtype', choices=['sqlite', 'rhmd'], default='sqlite', help='Database type')
    parser.add_argument('--verify-blobs', choices=['db', 'files'], default='files', help='Blob source: db or files')
    parser.add_argument('--gameid', help='Verify specific game ID only')
    parser.add_argument('--file-name', help='Verify specific blob file only')
    parser.add_argument('--full-check', action='store_true', help='Test with flips (slow)')
    parser.add_argument('--verify-result', action='store_true', help='Verify result hash (requires --full-check)')
    parser.add_argument('--newer-than', help='Only verify blobs newer than timestamp or blob file_name')
    parser.add_argument('--log-file', default='verification_results_py.log', help='Log file path')
    parser.add_argument('--failed-file', default='failed_blobs_py.json', help='Failed items file')
    
    args = parser.parse_args()
    
    CONFIG['DBTYPE'] = args.dbtype
    CONFIG['VERIFY_SOURCE'] = args.verify_blobs
    CONFIG['GAMEID'] = args.gameid
    CONFIG['FILE_NAME'] = args.file_name
    CONFIG['FULL_CHECK'] = args.full_check
    CONFIG['VERIFY_RESULT'] = args.verify_result
    CONFIG['NEWER_THAN'] = args.newer_than
    CONFIG['LOG_FILE'] = args.log_file
    CONFIG['FAILED_FILE'] = args.failed_file
    
    # Verify-result requires full-check
    if CONFIG['VERIFY_RESULT'] and not CONFIG['FULL_CHECK']:
        print('Error: --verify-result requires --full-check')
        sys.exit(2)
    
    print('=' * 70)
    print('BLOB VERIFICATION UTILITY (Python)')
    print('=' * 70)
    print(f"Database type: {CONFIG['DBTYPE']}")
    print(f"Verification source: {'patchbin.db file_data' if CONFIG['VERIFY_SOURCE'] == 'db' else 'blob files'}\n")
    
    if CONFIG['FULL_CHECK']:
        print('⚠️  FULL CHECK MODE - Will test patches with flips (SLOW)')
        if CONFIG['VERIFY_RESULT']:
            print('⚠️  VERIFY RESULT MODE - Will verify result_sha224 hash\n')
        else:
            print()
        
        # Find flips and base ROM
        try:
            # Try to find flips
            for flips_path in ['/usr/local/bin/flips', './flips', 'flips']:
                if os.path.exists(flips_path) or subprocess.run(['which', 'flips'], capture_output=True).returncode == 0:
                    CONFIG['FLIPS_PATH'] = flips_path
                    break
            
            # Find base ROM
            if os.path.exists('smw.sfc'):
                CONFIG['BASE_ROM_PATH'] = 'smw.sfc'
            
            if CONFIG['FLIPS_PATH'] and CONFIG['BASE_ROM_PATH']:
                print(f"✓ Flips: {CONFIG['FLIPS_PATH']}")
                print(f"✓ Base ROM: {CONFIG['BASE_ROM_PATH']}\n")
            else:
                print('✗ Cannot run full check: flips or smw.sfc not found')
                print('Continuing without flips verification...\n')
                CONFIG['FULL_CHECK'] = False
                
        except Exception as e:
            print(f'✗ Cannot run full check: {e}')
            CONFIG['FULL_CHECK'] = False
    
    if CONFIG['LOG_FILE']:
        print(f"📝 Logging to: {CONFIG['LOG_FILE']}\n")
    
    logger = VerificationLogger(CONFIG['LOG_FILE'])
    
    # Open patchbin database if verifying from db
    patchbin_conn = None
    if CONFIG['VERIFY_SOURCE'] == 'db':
        patchbin_conn = sqlite3.connect(CONFIG['PATCHBIN_DB_PATH'])
    
    try:
        # Get patchblobs from appropriate source
        if CONFIG['DBTYPE'] == 'sqlite':
            patchblobs = get_patchblobs_from_sqlite(CONFIG['GAMEID'], CONFIG['FILE_NAME'], CONFIG['NEWER_THAN'])
        else:  # rhmd
            patchblobs = get_patchblobs_from_rhmd(CONFIG['GAMEID'], CONFIG['FILE_NAME'], CONFIG['NEWER_THAN'])
        
        logger.log(f"\nFound {len(patchblobs)} patchblobs to verify\n")
        logger.log('=' * 70)
        
        verified = 0
        failed = 0
        failures = []
        
        for i, pb in enumerate(patchblobs):
            progress = f"[{i + 1}/{len(patchblobs)}]"
            logger.log(f"\n{progress} Game {pb.get('gameid', 'N/A')}: {pb['patchblob1_name']}")
            
            result = verify_blob(pb, patchbin_conn, logger, CONFIG['FULL_CHECK'], CONFIG['VERIFY_RESULT'], CONFIG['VERIFY_SOURCE'])
            
            if not result['errors'] and result['patch_hash_valid']:
                status_msg = '  ✅ VALID'
                if CONFIG['FULL_CHECK'] and result['flips_test_success']:
                    status_msg += ' (flips test passed'
                    if CONFIG['VERIFY_RESULT'] and result['result_hash_valid']:
                        status_msg += ', result hash verified'
                    status_msg += ')'
                logger.log(status_msg)
                verified += 1
            else:
                logger.log(f"  ❌ FAILED:")
                for err in result['errors']:
                    logger.log(f"     - {err}")
                failed += 1
                failures.append(result)
        
        logger.log('\n' + '=' * 70)
        logger.log('VERIFICATION SUMMARY')
        logger.log('=' * 70)
        logger.log(f"Total blobs:    {len(patchblobs)}")
        logger.log(f"✅ Valid:        {verified}")
        logger.log(f"❌ Failed:       {failed}")
        logger.log('=' * 70)
        
        # Save failures
        if failures:
            failed_data = {
                'timestamp': datetime.now().isoformat(),
                'dbtype': CONFIG['DBTYPE'],
                'total_checked': len(patchblobs),
                'failed_count': failed,
                'failures': failures
            }
            
            with open(CONFIG['FAILED_FILE'], 'w') as f:
                json.dump(failed_data, f, indent=2)
            
            logger.log(f"\n❌ Failed blobs saved to: {CONFIG['FAILED_FILE']}")
        
        if patchbin_conn:
            patchbin_conn.close()
        
        logger.close()
        sys.exit(1 if failed > 0 else 0)
        
    except Exception as e:
        logger.log(f"\n❌ Fatal error: {e}")
        import traceback
        logger.log(traceback.format_exc())
        
        if patchbin_conn:
            patchbin_conn.close()
        
        logger.close()
        sys.exit(2)

if __name__ == '__main__':
    main()

