#!/usr/bin/env python3
"""
Import levelname JSON files (GAMEID_levelids.json) into rhdata.db

This script updates:
- levelnames table (name + game association)
- gameversion_levelnames junction table (for the selected gameversion)
- gameversions.lmlevels column (if the JSON includes a "levels" attribute)

Usage:
  python3 import_levelids.py temp/26252_levelids.json [--version N] [--db path] [--verbose]
"""

import argparse
import json
import os
import sqlite3
import sys
from typing import Dict, Optional, Tuple, List


def get_database_path() -> str:
    if 'RHDATA_DB_PATH' in os.environ:
        return os.environ['RHDATA_DB_PATH']
    return os.path.join(os.path.dirname(os.path.dirname(__file__)), 'electron', 'rhdata.db')


def load_json(json_path: str) -> Dict:
    with open(json_path, 'r', encoding='utf-8') as f:
        return json.load(f)


def infer_gameid(json_path: str, data: Dict) -> str:
    if len(data) == 1:
        return next(iter(data.keys()))
    basename = os.path.basename(json_path)
    if '_levelids.json' in basename:
        return basename.replace('_levelids.json', '')
    raise ValueError('Could not determine gameid from JSON structure or filename')


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


def upsert_levelname(cursor: sqlite3.Cursor, gameid: str, level_id: str, level_name: str, verbose: bool = False) -> str:
    cursor.execute(
        "SELECT lvluuid FROM levelnames WHERE gameid = ? AND levelid = ?",
        (gameid, level_id)
    )
    row = cursor.fetchone()
    if row:
        lvluuid = row[0]
        cursor.execute(
            "UPDATE levelnames SET levelname = ?, updated_time = CURRENT_TIMESTAMP WHERE lvluuid = ?",
            (level_name, lvluuid)
        )
        if verbose:
            print(f"  Updated levelname {level_id}: {level_name}")
        return lvluuid
    cursor.execute(
        "INSERT INTO levelnames (gameid, levelid, levelname) VALUES (?, ?, ?)",
        (gameid, level_id, level_name)
    )
    cursor.execute(
        "SELECT lvluuid FROM levelnames WHERE gameid = ? AND levelid = ?",
        (gameid, level_id)
    )
    lvluuid = cursor.fetchone()[0]
    if verbose:
        print(f"  Created levelname {level_id}: {level_name}")
    return lvluuid


def import_levelids(db_path: str, json_path: str, version_override: Optional[int], verbose: bool = False) -> None:
    data = load_json(json_path)
    gameid = infer_gameid(json_path, data)
    game_data = data.get(gameid)
    if not isinstance(game_data, dict):
        raise ValueError(f"Invalid JSON structure for gameid {gameid}")

    levelnames = game_data.get('levelnames', {})
    if not isinstance(levelnames, dict):
        raise ValueError('levelnames attribute must be an object/dictionary')

    lmlevels_raw = game_data.get('levels')
    if lmlevels_raw is not None and not isinstance(lmlevels_raw, list):
        raise ValueError('levels attribute must be a list when present')

    conn = sqlite3.connect(db_path)
    conn.execute('PRAGMA foreign_keys = ON')
    cursor = conn.cursor()

    try:
        gvuuid, actual_version = get_gameversion(cursor, gameid, version_override)
        if verbose:
            print(f"Importing levelnames for gameid {gameid}, version {actual_version} (gvuuid={gvuuid})")
            print(f"  Levels JSON contains {len(lmlevels_raw or [])} entries")
            print(f"  Levelnames JSON contains {len(levelnames)} entries")

        # Remove existing links for this gameversion
        cursor.execute("DELETE FROM gameversion_levelnames WHERE gvuuid = ?", (gvuuid,))

        # Upsert all levelnames and recreate links
        for level_id_key, level_name in levelnames.items():
            norm_level_id = normalize_level_id(level_id_key)
            lvluuid = upsert_levelname(cursor, gameid, norm_level_id, str(level_name), verbose)
            cursor.execute(
                "INSERT INTO gameversion_levelnames (gvuuid, lvluuid) VALUES (?, ?)",
                (gvuuid, lvluuid)
            )

        # Update lmlevels column if present
        if lmlevels_raw is not None:
            normalized_levels = [normalize_level_id(item) for item in lmlevels_raw]
            cursor.execute(
                "UPDATE gameversions SET lmlevels = ? WHERE gvuuid = ?",
                (json.dumps(normalized_levels), gvuuid)
            )
        else:
            cursor.execute(
                "UPDATE gameversions SET lmlevels = NULL WHERE gvuuid = ?",
                (gvuuid,)
            )

        conn.commit()
        if verbose:
            print(f"Imported {len(levelnames)} level names for gameid {gameid}")

    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def main():
    parser = argparse.ArgumentParser(description='Import levelname JSON files into rhdata.db')
    parser.add_argument('json_file', help='Path to GAMEID_levelids.json file')
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
        import_levelids(db_path, args.json_file, args.version, args.verbose)
        return 0
    except Exception as exc:
        print(f"Error importing levelids: {exc}")
        return 1


if __name__ == '__main__':
    sys.exit(main())
