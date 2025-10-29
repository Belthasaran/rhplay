#!/usr/bin/env python3
"""
Apply the levelnames migration to rhdata.db
"""

import sqlite3
import os
import sys

def get_database_path():
    """Get the rhdata.db path"""
    if 'RHDATA_DB_PATH' in os.environ:
        return os.environ['RHDATA_DB_PATH']
    return os.path.join(os.path.dirname(os.path.dirname(__file__)), 'electron', 'rhdata.db')

def apply_migration(db_path: str) -> bool:
    """Apply the levelnames migration"""
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        
        # Read the migration SQL
        migration_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 
                                    'electron', 'sql', 'migrations', '009_add_levelnames_tables.sql')
        
        if not os.path.exists(migration_path):
            print(f"Error: Migration file not found: {migration_path}")
            return False
        
        with open(migration_path, 'r') as f:
            migration_sql = f.read()
        
        # Execute the migration
        cursor.executescript(migration_sql)
        conn.commit()
        
        print("Successfully applied levelnames migration")
        return True
        
    except Exception as e:
        print(f"Error applying migration: {e}")
        return False
    finally:
        conn.close()

def main():
    db_path = get_database_path()
    
    if not os.path.exists(db_path):
        print(f"Error: Database file not found: {db_path}")
        return 1
    
    success = apply_migration(db_path)
    return 0 if success else 1

if __name__ == '__main__':
    sys.exit(main())
