#!/usr/bin/env python3
"""
Import level names from JSON files into rhdata.db
Handles duplicate prevention and cleanup of orphaned records
"""

import argparse
import json
import sqlite3
import os
import sys
from typing import Dict, List, Set, Tuple

def get_database_path():
    """Get the rhdata.db path"""
    # Check environment variable first
    if 'RHDATA_DB_PATH' in os.environ:
        return os.environ['RHDATA_DB_PATH']
    
    # Default to electron directory
    return os.path.join(os.path.dirname(os.path.dirname(__file__)), 'electron', 'rhdata.db')

def load_json_file(json_path: str) -> Dict:
    """Load and parse JSON file"""
    try:
        with open(json_path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        print(f"Error loading JSON file {json_path}: {e}")
        return None

def get_gameid_from_filename(filename: str) -> str:
    """Extract gameid from filename like '26252_levelids.json'"""
    basename = os.path.basename(filename)
    if '_levelids.json' in basename:
        return basename.replace('_levelids.json', '')
    return None

def import_levelnames(db_path: str, json_path: str, verbose: bool = False) -> bool:
    """Import level names from JSON file into database"""
    
    # Load JSON data
    data = load_json_file(json_path)
    if not data:
        return False
    
    # Get gameid from filename if not in JSON structure
    gameid = None
    if len(data) == 1:
        gameid = list(data.keys())[0]
    else:
        gameid = get_gameid_from_filename(json_path)
        if not gameid:
            print(f"Error: Could not determine gameid from JSON file {json_path}")
            return False
    
    if gameid not in data:
        print(f"Error: Gameid {gameid} not found in JSON data")
        return False
    
    game_data = data[gameid]
    version = game_data.get('version', '1')
    levelnames = game_data.get('levelnames', {})
    
    if verbose:
        print(f"Importing {len(levelnames)} level names for gameid {gameid}, version {version}")
    
    try:
        conn = sqlite3.connect(db_path)
        conn.execute('PRAGMA foreign_keys = ON')  # Enable foreign key constraints
        cursor = conn.cursor()
        
        # Start transaction
        cursor.execute('BEGIN TRANSACTION')
        
        # Get the gvuuid for this gameid and version
        cursor.execute('''
            SELECT gvuuid FROM gameversions 
            WHERE gameid = ? AND version = ?
        ''', (gameid, int(version)))
        
        gv_result = cursor.fetchone()
        if not gv_result:
            print(f"Error: No gameversion found for gameid {gameid}, version {version}")
            conn.rollback()
            conn.close()
            return False
        
        gvuuid = gv_result[0]
        
        # Remove existing levelname links for this gameversion
        cursor.execute('''
            DELETE FROM gameversion_levelnames WHERE gvuuid = ?
        ''', (gvuuid,))
        
        if verbose:
            print(f"  Removed existing levelname links for gvuuid {gvuuid}")
        
        # Process each level name
        for levelid, levelname in levelnames.items():
            # Check if this levelname already exists for this gameid
            cursor.execute('''
                SELECT lvluuid FROM levelnames 
                WHERE gameid = ? AND levelid = ?
            ''', (gameid, levelid))
            
            existing = cursor.fetchone()
            
            if existing:
                # Update existing levelname
                lvluuid = existing[0]
                cursor.execute('''
                    UPDATE levelnames 
                    SET levelname = ?, updated_time = CURRENT_TIMESTAMP
                    WHERE lvluuid = ?
                ''', (levelname, lvluuid))
                
                if verbose:
                    print(f"  Updated levelname {levelid}: {levelname}")
            else:
                # Create new levelname
                cursor.execute('''
                    INSERT INTO levelnames (gameid, levelid, levelname)
                    VALUES (?, ?, ?)
                ''', (gameid, levelid, levelname))
                
                # Get the lvluuid that was generated
                cursor.execute('''
                    SELECT lvluuid FROM levelnames 
                    WHERE gameid = ? AND levelid = ?
                ''', (gameid, levelid))
                lvluuid = cursor.fetchone()[0]
                
                if verbose:
                    print(f"  Created levelname {levelid}: {levelname}")
            
            # Link to gameversion
            cursor.execute('''
                INSERT OR IGNORE INTO gameversion_levelnames (gvuuid, lvluuid)
                VALUES (?, ?)
            ''', (gvuuid, lvluuid))
        
        # Clean up orphaned levelnames (not linked to any gameversion)
        cursor.execute('''
            DELETE FROM levelnames 
            WHERE lvluuid NOT IN (
                SELECT DISTINCT lvluuid FROM gameversion_levelnames
            )
        ''')
        
        orphaned_count = cursor.rowcount
        if orphaned_count > 0 and verbose:
            print(f"  Cleaned up {orphaned_count} orphaned levelnames")
        
        # Commit transaction
        conn.commit()
        
        if verbose:
            print(f"Successfully imported {len(levelnames)} level names")
        
        return True
        
    except Exception as e:
        print(f"Error importing levelnames: {e}")
        conn.rollback()
        return False
    finally:
        conn.close()

def main():
    parser = argparse.ArgumentParser(
        description='Import level names from JSON files into rhdata.db'
    )
    
    parser.add_argument('json_file', help='Path to JSON file to import')
    parser.add_argument('--db', help='Path to rhdata.db (default: auto-detect)')
    parser.add_argument('--verbose', '-v', action='store_true',
                       help='Verbose output')
    
    args = parser.parse_args()
    
    # Determine database path
    if args.db:
        db_path = args.db
    else:
        db_path = get_database_path()
    
    if not os.path.exists(db_path):
        print(f"Error: Database file not found: {db_path}")
        return 1
    
    if not os.path.exists(args.json_file):
        print(f"Error: JSON file not found: {args.json_file}")
        return 1
    
    # Import the levelnames
    success = import_levelnames(db_path, args.json_file, args.verbose)
    
    return 0 if success else 1

if __name__ == '__main__':
    sys.exit(main())
