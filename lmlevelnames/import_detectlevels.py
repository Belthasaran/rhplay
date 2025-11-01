#!/usr/bin/env python3
"""
Import detected level CSV files (GAMEID_detect.csv) into rhdata.db

The CSV file should contain a comma-separated list of level IDs. On import the
script normalizes the IDs (adds 0x prefix, uppercases, and zero-pads) and stores
them as a JSON array string in gameversions.detectedlevels for the target
version (highest by default unless --version is supplied).
"""

import argparse
import json
import os
import sqlite3
import sys
from typing import List, Optional, Tuple


def get_database_path() -> str:
    if 'RHDATA_DB_PATH' in os.environ:
        return os.environ['RHDATA_DB_PATH']
    return os.path.join(os.path.dirname(os.path.dirname(__file__)), 'electron', 'rhdata.db')


def normalize_level_id(level_id: str) -> str:
    text = str(level_id).strip()
    if not text:
        return text
    if text.lower().startswith('0x'):
        hex_part = text[2:]
    else:
        hex_part = text
    hex_part = hex_part.upper()
    width = max(3, len(hex_part))
    hex_part = hex_part.zfill(width)
    return f"0x{hex_part}"


def parse_csv(csv_path: str) -> List[str]:
    with open(csv_path, 'r', encoding='utf-8') as f:
        content = f.read().strip()
    if not content:
        return []
    parts = [part.strip() for part in content.split(',')]
    return [normalize_level_id(part) for part in parts if part]


def infer_gameid(csv_path: str) -> str:
    basename = os.path.basename(csv_path)
    if '_detect.csv' in basename:
        return basename.replace('_detect.csv', '')
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


def import_detectlevels(db_path: str, csv_path: str, version_override: Optional[int], verbose: bool = False) -> None:
    levels = parse_csv(csv_path)
    gameid = infer_gameid(csv_path)

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    try:
        gvuuid, actual_version = get_gameversion(cursor, gameid, version_override)
        if verbose:
            print(f"Importing detected levels for gameid {gameid}, version {actual_version} (gvuuid={gvuuid})")
            print(f"  Parsed {len(levels)} detected levels")

        json_levels = json.dumps(levels)
        cursor.execute(
            "UPDATE gameversions SET detectedlevels = ? WHERE gvuuid = ?",
            (json_levels, gvuuid)
        )
        conn.commit()
        if verbose:
            print("Detected levels updated successfully")

    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def main():
    parser = argparse.ArgumentParser(description='Import detected level CSV files into rhdata.db')
    parser.add_argument('csv_file', help='Path to GAMEID_detect.csv file')
    parser.add_argument('--version', type=int, help='Specific version number to target (default: highest available)')
    parser.add_argument('--db', help='Path to rhdata.db (default: auto-detect)')
    parser.add_argument('--verbose', '-v', action='store_true', help='Verbose output')
    args = parser.parse_args()

    db_path = args.db or get_database_path()
    if not os.path.exists(db_path):
        print(f"Error: Database file not found: {db_path}")
        return 1
    if not os.path.exists(args.csv_file):
        print(f"Error: CSV file not found: {args.csv_file}")
        return 1

    try:
        import_detectlevels(db_path, args.csv_file, args.version, args.verbose)
        return 0
    except Exception as exc:
        print(f"Error importing detected levels: {exc}")
        return 1


if __name__ == '__main__':
    sys.exit(main())
