#!/usr/bin/env python3
import json
import os
import sqlite3
from collections import defaultdict, Counter
from itertools import combinations

DB_PATH = "/home/steamu/rhplay/electron/rhdata.db"
OUT_DIR = "/home/steamu/rhplay/electron/main/smwtags"
USAGE_JSON = os.path.join(OUT_DIR, "smw_tag_usage.json")
PAIRS_JSON = os.path.join(OUT_DIR, "smw_tag_pairs.json")

QUERY = """
SELECT gv1.gameid, gv1.name, gv1.tags
FROM gameversions gv1
GROUP BY gv1.gameid
HAVING gv1.version=MAX(gv1.version);
"""

def fetch_latest_gameversions(conn: sqlite3.Connection):
    cur = conn.cursor()
    cur.execute(QUERY)
    rows = cur.fetchall()
    # Rows are tuples: (gameid, name, tags_json)
    return rows

def parse_tags(tags_json: str):
    if not tags_json:
        return []
    try:
        tags = json.loads(tags_json)
        # Ensure list of strings; filter bad entries
        tags = [str(t) for t in tags if isinstance(t, (str, int, float))]
        return tags
    except Exception:
        return []

def build_tag_usage(rows):
    tag_to_games = defaultdict(list)
    for gameid, name, tags_json in rows:
        tags = parse_tags(tags_json)
        if not tags:
            continue
        # Deduplicate tags per game to avoid pair inflation due to duplicates
        unique_tags = list(dict.fromkeys(tags))
        record = {
            "gameid": gameid,
            "name": name,
            "tags": unique_tags,
        }
        for tag in unique_tags:
            tag_to_games[tag].append(record)
    # Create output structure
    usage = {}
    for tag, games in tag_to_games.items():
        usage[tag] = {
            "number_of_uses": len(games),
            "games_using_tag": games,
        }
    return usage

def build_tag_pairs(rows):
    pair_counter = Counter()
    # Use a set per game to avoid counting duplicate pairs from duplicate tags
    for gameid, name, tags_json in rows:
        tags = parse_tags(tags_json)
        unique = sorted(set(tags))
        for a, b in combinations(unique, 2):
            pair_counter[(a, b)] += 1
    # Convert to JSON-serializable list of objects
    pairs = []
    for (a, b), count in sorted(pair_counter.items(), key=lambda kv: (-kv[1], kv[0][0].lower(), kv[0][1].lower())):
        pairs.append({
            "tag1": a,
            "tag2": b,
            "number_of_uses": count,
        })
    return pairs

def main():
    if not os.path.exists(DB_PATH):
        raise SystemExit(f"Database not found: {DB_PATH}")
    os.makedirs(OUT_DIR, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    try:
        rows = fetch_latest_gameversions(conn)
    finally:
        conn.close()
    usage = build_tag_usage(rows)
    pairs = build_tag_pairs(rows)
    with open(USAGE_JSON, "w", encoding="utf-8") as f:
        json.dump(usage, f, ensure_ascii=False, indent=2)
    with open(PAIRS_JSON, "w", encoding="utf-8") as f:
        json.dump(pairs, f, ensure_ascii=False, indent=2)

if __name__ == "__main__":
    main()

