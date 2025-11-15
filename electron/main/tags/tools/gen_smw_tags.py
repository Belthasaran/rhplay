#!/usr/bin/env python3
import json
import os
import re
from collections import defaultdict, OrderedDict

ROOT = "/home/steamu/rhplay/electron/main/smwtags"
SRC_MD = os.path.join(ROOT, "smw_complete_categorization_revised.md")
OUT_JSON = os.path.join(ROOT, "smw_tags.json")

# Map the 21-category markdown into the 7-top-level hierarchy paths
# Subcategory mapping is best-effort based on the hierarchy recommendation
TOP_MAP = {
    "Difficulty Level": lambda sub: "Gameplay & Difficulty > Difficulty Levels",
    "Gameplay Style & Mechanics": lambda sub: {
        None: "Gameplay & Difficulty > Core Mechanics",
        "Core Mechanics": "Gameplay & Difficulty > Core Mechanics",
        "Shell Mechanics": "Gameplay & Difficulty > Gameplay Specializations > Shell Techniques",
        "Experimental Mechanics": "Gameplay & Difficulty > Core Mechanics",
    }.get(sub, "Gameplay & Difficulty > Core Mechanics"),
    "Level Structure & Design": lambda sub: {
        None: "Design & Structure > Level Structure",
        "Level Structure & Design": "Design & Structure > Level Structure",
    }.get(sub, "Design & Structure > Level Structure"),
    "Graphics & Visual Style": lambda sub: {
        None: "Content & Presentation > Graphics & Visual Style > Custom Graphics",
        "Custom Graphics": "Content & Presentation > Graphics & Visual Style > Custom Graphics",
        "Visual Themes": "Content & Presentation > Graphics & Visual Style > Visual Themes",
    }.get(sub, "Content & Presentation > Graphics & Visual Style > Custom Graphics"),
    "Music & Audio": lambda sub: "Content & Presentation > Music & Audio > Custom Audio",
    "Technical & ASM Features": lambda sub: {
        None: "Technical & Development > ASM & Programming > Core Technical",
    }.get(sub, "Technical & Development > ASM & Programming > Core Technical"),
    "Theme & Setting": lambda sub: {
        None: "Content & Presentation > Themes & Genres > Environmental Themes",
        "Natural Environments": "Content & Presentation > Themes & Genres > Environmental Themes",
        "Architectural/Man-made": "Content & Presentation > Themes & Genres > Environmental Themes",
        "Fantasy/Abstract": "Content & Presentation > Themes & Genres > Genre & Tone",
    }.get(sub, "Content & Presentation > Themes & Genres > Environmental Themes"),
    "Seasonal & Holiday": lambda sub: "Content & Presentation > Themes & Genres > Holiday & Special Events",
    "Characters: Mario Universe": lambda sub: {
        None: "Characters & Universe > Mario Universe",
        "Playable Characters": "Characters & Universe > Mario Universe > Playable Characters",
        "Enemies & Bosses": "Characters & Universe > Mario Universe > Enemies & Bosses",
        "Other Mario Characters": "Characters & Universe > Mario Universe > Other Mario Characters",
    }.get(sub, "Characters & Universe > Mario Universe"),
    "Characters: Nintendo (Non-Mario)": lambda sub: {
        None: "Characters & Universe > Nintendo Characters > Core Nintendo",
        "Core Nintendo": "Characters & Universe > Nintendo Characters > Core Nintendo",
        "Pokemon": "Characters & Universe > Nintendo Characters > Pokemon",
    }.get(sub, "Characters & Universe > Nintendo Characters > Core Nintendo"),
    "Characters: Other Games & Media": lambda sub: {
        None: "Characters & Universe > Crossovers & References > Media References",
        "Named Characters": "Characters & Universe > Crossovers & References > Media References",
        "Character Types": "Characters & Universe > Crossovers & References > Media References",
    }.get(sub, "Characters & Universe > Crossovers & References > Media References"),
    "Crossovers & References": lambda sub: {
        None: "Characters & Universe > Crossovers & References > Media References",
        "Game Crossovers": "Characters & Universe > Crossovers & References > Game Crossovers",
        "Media References": "Characters & Universe > Crossovers & References > Media References",
    }.get(sub, "Characters & Universe > Crossovers & References > Media References"),
    "Game Series & Sequels": lambda sub: "Characters & Universe > Series & Sequels",
    "Content & Tone": lambda sub: {
        None: "Content & Presentation > Themes & Genres > Genre & Tone",
        "Content Warnings": "Community & Meta > Content Ratings > Maturity Warnings",
        "Tone & Mood": "Content & Presentation > Themes & Genres > Genre & Tone",
        "Cultural & Social": "Content & Presentation > Themes & Genres > Content Descriptors",
    }.get(sub, "Content & Presentation > Themes & Genres > Genre & Tone"),
    "Player Configuration": lambda sub: "Player Configuration > Player Count",
    "Development Status": lambda sub: "Technical & Development > Development Status",
    "Language & Localization": lambda sub: "Community & Meta > Language & Localization",
    "Platform & Hardware": lambda sub: "Technical & Development > Platform & Compatibility",
    "Community & Events": lambda sub: {
        None: "Community & Meta > Community Events",
        "Core Community": "Community & Meta > Community Events",
        "Traditional Style": "Community & Meta > Traditional Style",
        "Content Creation": "Community & Meta > Content Creation",
    }.get(sub, "Community & Meta > Community Events"),
    "Creator & Team Tags": lambda sub: {
        None: "Community & Meta > Creator Tags > Individual Creators",
        "Individual Creators": "Community & Meta > Creator Tags > Individual Creators",
        "Teams & Groups": "Community & Meta > Creator Tags > Teams & Groups",
    }.get(sub, "Community & Meta > Creator Tags > Individual Creators"),
    "Miscellaneous & Unique Tags": lambda sub: {
        None: "Content & Presentation > Themes & Genres > Genre & Tone",
        "Food & Objects": "Content & Presentation > Themes & Genres > Genre & Tone",
        "Other Uncategorized": "Content & Presentation > Themes & Genres > Genre & Tone",
    }.get(sub, "Content & Presentation > Themes & Genres > Genre & Tone"),
}

H3_RE = re.compile(r"^###\s+\d+\.\s+(.*)")
H4_RE = re.compile(r"^####\s+(.*)")
ITEM_RE = re.compile(r"^-\s+(.*)")
STOP_RE = re.compile(r"^##\s+Coverage Summary", re.IGNORECASE)

OVERRIDES = {
    "character": ["Characters & Universe > Crossovers & References > Media References"],
    "characters": ["Characters & Universe > Crossovers & References > Media References"],
    "creative": ["Design & Structure > Level Structure"],
    "custom": ["Technical & Development > ASM & Programming > Core Technical", "Technical & Development > ASM & Programming > Custom Features"],
    "custom level pack": ["Design & Structure > Level Structure"],
    "custom levels": ["Design & Structure > Level Structure"],
    "custom powerups": ["Gameplay & Difficulty > Gameplay Specializations > Shell Techniques", "Gameplay & Difficulty > Core Mechanics"],
    "custom sprite": ["Content & Presentation > Graphics & Visual Style > Custom Graphics"],
    "dupe": ["Design & Structure > Level Structure"],
    "exfgx": ["Content & Presentation > Graphics & Visual Style > Custom Graphics"],
    "fat mario": ["Characters & Universe > Crossovers & References > Media References"],
    "full hack": ["Design & Structure > Level Structure"],
    "hybrid": ["Design & Structure > Level Structure"],
    "kaizo block": ["Gameplay & Difficulty > Core Mechanics"],
    "kaizo mario": ["Characters & Universe > Series & Sequels"],
    "kaizo mario world": ["Characters & Universe > Series & Sequels"],
    "light chocolate": ["Content & Presentation > Graphics & Visual Style > Visual Themes"],
    "mix": ["Design & Structure > Level Structure"],
    "moon": ["Content & Presentation > Themes & Genres > Environmental Themes"],
    "nintendo": ["Characters & Universe > Crossovers & References > Media References"],
    "non kaizo": ["Community & Meta > Traditional Style"],
    "old": ["Design & Structure > Level Structure"],
    "pirate": ["Characters & Universe > Crossovers & References > Media References"],
    "puzzle": ["Design & Structure > Level Structure"],
    "puzzles": ["Design & Structure > Level Structure"]
    ,
    "remake": ["Design & Structure > Level Structure"],
    "rpg": ["Characters & Universe > Crossovers & References > Media References"],
    "smb 3": ["Content & Presentation > Graphics & Visual Style > Custom Graphics"],
    "star": ["Characters & Universe > Series & Sequels"],
    "stars": ["Characters & Universe > Series & Sequels"],
    "win": ["Community & Meta > Community Events"]
}

def parse_markdown():
    tags_to_paths = defaultdict(set)
    top = None
    sub = None
    with open(SRC_MD, "r", encoding="utf-8") as f:
        for raw in f:
            line = raw.rstrip("\n").strip()
            if not line:
                continue
            if STOP_RE.match(line):
                break
            m3 = H3_RE.match(line)
            if m3:
                top = m3.group(1).strip()
                sub = None
                continue
            m4 = H4_RE.match(line)
            if m4:
                sub = m4.group(1).strip()
                continue
            mi = ITEM_RE.match(line)
            if mi and top:
                tag = mi.group(1).strip()
                tag = tag.lstrip("-").strip()
                # Normalize dash bullets that might include inline notes
                tag = re.sub(r"\s+\(NEW\)|\s+\[.*?\]", "", tag).strip()
                # Skip markdown stats or emphasized lines
                if tag.startswith("**"):
                    continue
                # Map category path
                mapper = TOP_MAP.get(top)
                if mapper is None:
                    continue
                try:
                    path = mapper(sub)
                except Exception:
                    path = mapper(None) if callable(mapper) else mapper
                if not path:
                    continue
                tags_to_paths[tag].add(path)
    return tags_to_paths

def load_existing_partial():
    if not os.path.exists(OUT_JSON):
        return {}
    try:
        with open(OUT_JSON, "r", encoding="utf-8") as f:
            data = json.load(f)
            tags = data.get("tags", {})
            # Filter out any accidental coverage/stat keys
            return {k: v for k, v in tags.items() if not str(k).startswith("**")}
    except Exception:
        return {}

def main():
    parsed = parse_markdown()
    existing = load_existing_partial()
    # Merge existing mappings
    for tag, paths in existing.items():
        parsed.setdefault(tag, set())
        parsed[tag].update(paths)
    # Apply manual overrides for uncovered tags
    for tag, paths in OVERRIDES.items():
        parsed.setdefault(tag, set()).update(paths)
    # Sort tags and convert sets to sorted lists
    ordered = OrderedDict()
    for tag in sorted(parsed.keys(), key=lambda s: s.lower()):
        ordered[tag] = sorted(parsed[tag])
    out = {
        "categoriesVersion": "revised_complete_v1",
        "categoryPathConvention": "Major Category > Subcategory > (Optional) Sub-subcategory",
        "tags": ordered,
    }
    with open(OUT_JSON, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    # Coverage validation
    src_tags_path = os.path.join(ROOT, "smwtags.txt")
    if os.path.exists(src_tags_path):
        with open(src_tags_path, "r", encoding="utf-8") as tf:
            src_tags = [ln.strip() for ln in tf.readlines() if ln.strip()]
        norm_existing = {t.lower(): t for t in ordered.keys()}
        missing = []
        for t in src_tags:
            if t.lower() not in norm_existing:
                missing.append(t)
        print(f"Total tags in source: {len(src_tags)}")
        print(f"Total tags in JSON:   {len(ordered)}")
        print(f"Missing (by name):    {len(missing)}")
        if missing:
            print("First 25 missing:", missing[:25])

if __name__ == "__main__":
    main()

