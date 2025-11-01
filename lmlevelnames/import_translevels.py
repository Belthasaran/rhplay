#!/usr/bin/env python3
"""
Import translevel JSON files (GAMEID_translevs.json) into rhdata.db

Each JSON file is expected to contain a "translevels" array with objects that
include at least "translevel" and optionally "level_number", "locations", and
"events". This script replaces the existing translevel records for the selected
(gameid, version) pair with the data from the JSON file.
"""

import argparse
import json
import os
import sqlite3
import sys
from typing import Dict, List, Optional, Tuple


def get_database_path() -> str:
    if 'RHDATA_DB_PATH' in os.environ:
        return os.environ['RHDATA_DB_PATH']
    return os.path.join(os.path.dirname(os.path.dirname(__file__)), 'electron', 'rhdata.db')


def load_json(json_path: str) -> Dict:
    with open(json_path, 'r', encoding='utf-8') as f:
        return json.load(f)


def infer_gameid(json_path: str, data: Dict) -> str:
    basename = os.path.basename(json_path)
    if '_translevs.json' in basename:
        return basename.replace('_translevs.json', '')
    raise ValueError('Could not determine gameid from filename')


def get_gameversion(cursor: sqlite3.Cursor, gameid: str, version_override: Optional[int]) -> Tuple[str, int]:
    if version_override is not None:
        cursor.execute(
            "SELECT gvuuid, version FROM gameversions WHERE gameid = ? AND version = ?",
            (gameid, version_override)
        )
    else:
        cursor.execute(
            "SELECT gvuuid, version FROM gameversions WHERE gameid = ? ORDER BY version DESC LIMIT 1",
            (gameid,)
        )
    row = cursor.fetchone()
    if not row:
        raise ValueError(f"No gameversion found for gameid {gameid}"
                         + (f" version {version_override}" if version_override is not None else ""))
    return row[0], int(row[1])


def import_translevels(db_path: str, json_path: str, version_override: Optional[int], verbose: bool = False) -> None:
    data = load_json(json_path)
    gameid = infer_gameid(json_path, data)
    translevels = data.get('translevels') or []
    if not isinstance(translevels, list):
        raise ValueError('translevels attribute must be an array/list')

    conn = sqlite3.connect(db_path)
    conn.execute('PRAGMA foreign_keys = ON')
    cursor = conn.cursor()

    try:
        gvuuid, actual_version = get_gameversion(cursor, gameid, version_override)
        if verbose:
            print(f"Importing {len(translevels)} translevels for gameid {gameid}, version {actual_version} (gvuuid={gvuuid})")

        # Remove existing entries for this gameversion
        cursor.execute("DELETE FROM gameversions_translevels WHERE gvuuid = ?", (gvuuid,))

        for entry in translevels:
            if not isinstance(entry, dict):
                raise ValueError('Each translevel entry must be a JSON object')
            translevel_id = str(entry.get('translevel') or '').strip()
            if not translevel_id:
                raise ValueError('Translevel entry missing "translevel" value')
            level_number = entry.get('level_number')
            locations = entry.get('locations', [])
            events = entry.get('events', [])

            cursor.execute(
                """
                INSERT INTO gameversions_translevels (gvuuid, translevel, level_number, locations, events)
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    gvuuid,
                    translevel_id.upper(),
                    level_number if level_number is None else str(level_number),
                    json.dumps(locations, ensure_ascii=False),
                    json.dumps(events, ensure_ascii=False)
                )
            )
            if verbose:
                print(f"  Imported translevel {translevel_id}")

        conn.commit()
        if verbose:
            print("Translevels import completed")

    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def main():
    parser = argparse.ArgumentParser(description='Import translevel JSON files into rhdata.db')
    parser.add_argument('json_file', help='Path to GAMEID_translevs.json file')
    parser.add_argument('--version', type=int, help='Specific version number to target (default: highest available)')
    parser.add_argument('--db', help='Path to rhdata.db (default: auto-detect)')
    parser.add_argument('--verbose', '-v', action='store_true', help='Verbose output')
    args = parser.parse_args()

    db_path = args.db or get_database_path()
    if not os.path.exists(db_path):
        print(f"Error: Database file not found: {db_path}")
        return 1
    if not os.path.exists(args.json_file):
        print(f"Error: JSON file not found: {args.json_file}")
        return 1

    try:
        import_translevels(db_path, args.json_file, args.version, args.verbose)
        return 0
    except Exception as exc:
        print(f"Error importing translevels: {exc}")
        return 1


if __name__ == '__main__':
    sys.exit(main())
