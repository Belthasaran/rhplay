#!/usr/bin/env python3
"""
Apply the levelnames-related migrations to rhdata.db
"""

import sqlite3
import os
import sys


def get_database_path():
    """Get the rhdata.db path"""
    if 'RHDATA_DB_PATH' in os.environ:
        return os.environ['RHDATA_DB_PATH']
    return os.path.join(os.path.dirname(os.path.dirname(__file__)), 'electron', 'rhdata.db')


def column_exists(cursor: sqlite3.Cursor, table: str, column: str) -> bool:
    cursor.execute(f"PRAGMA table_info({table})")
    return any(row[1].lower() == column.lower() for row in cursor.fetchall())


def apply_migration(db_path: str) -> bool:
    """Apply the levelnames migrations"""
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        
        # Migration 009: levelnames tables
        migration_009_path = os.path.join(
            os.path.dirname(os.path.dirname(__file__)),
            'electron', 'sql', 'migrations', '009_add_levelnames_tables.sql'
        )

        if not os.path.exists(migration_009_path):
            print(f"Error: Migration file not found: {migration_009_path}")
            return False

        with open(migration_009_path, 'r') as f:
            migration_sql = f.read()
        cursor.executescript(migration_sql)

        # Add lmlevels column if missing
        if not column_exists(cursor, 'gameversions', 'lmlevels'):
            cursor.execute("ALTER TABLE gameversions ADD COLUMN lmlevels TEXT")
            print("Added lmlevels column to gameversions")

        # Add detectedlevels column if missing
        if not column_exists(cursor, 'gameversions', 'detectedlevels'):
            cursor.execute("ALTER TABLE gameversions ADD COLUMN detectedlevels TEXT")
            print("Added detectedlevels column to gameversions")

        # Create gameversions_translevels table, indexes, and trigger
        cursor.executescript(
            """
            CREATE TABLE IF NOT EXISTS gameversions_translevels (
              gvtuuid varchar(255) primary key DEFAULT (lower(hex(randomblob(16)))),
              gvuuid varchar(255) NOT NULL REFERENCES gameversions(gvuuid) ON DELETE CASCADE,
              translevel TEXT NOT NULL,
              level_number TEXT,
              locations TEXT,
              events TEXT,
              created_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              updated_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              UNIQUE(gvuuid, translevel)
            );
            CREATE INDEX IF NOT EXISTS idx_gameversions_translevels_gvuuid
              ON gameversions_translevels(gvuuid);
            CREATE INDEX IF NOT EXISTS idx_gameversions_translevels_translevel
              ON gameversions_translevels(translevel);
            CREATE TRIGGER IF NOT EXISTS trg_gameversions_translevels_updated
              AFTER UPDATE ON gameversions_translevels
            BEGIN
              UPDATE gameversions_translevels
              SET updated_time = CURRENT_TIMESTAMP
              WHERE gvtuuid = NEW.gvtuuid;
            END;
            """
        )

        conn.commit()
        print("Successfully applied levelnames migrations")
        return True

    except Exception as e:
        print(f"Error applying migration: {e}")
        conn.rollback()
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
