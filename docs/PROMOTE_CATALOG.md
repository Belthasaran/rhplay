# Promote Catalog to RHPAK / Main Database

**Date**: February 2026  
**Scripts**: `promote_catalog_to_rhpak.js`, `promote_catalog_to_db.js`

---

## Overview

These scripts promote search catalog items (index7z JSON) to either a complete RHPAK file or directly into the main database (rhdata.db, patchbin.db, etc.).

---

## Scripts

### promote_catalog_to_rhpak.js

Create a complete RHPAK from an index7z JSON and BPS file.

```bash
enode.sh jstools/promote_catalog_to_rhpak.js --from-json index7z/abc123.json --bps-path /path/to/abc123.bps
enode.sh jstools/promote_catalog_to_rhpak.js --from-json item.json --bps-path bps.bps --output game.rhpak
enode.sh jstools/promote_catalog_to_rhpak.js --from-json item.json --bps-path bps.bps --add-screenshots ./screenshots
```

**Options**:
- `--from-json <path>` — Index7z JSON file (required)
- `--bps-path <path>` — Path to BPS file (required)
- `--metadata-file <path>` — Extra JSON to merge into gameversion
- `--add-screenshots <dir>` — Add screenshots from directory
- `--output <path>` — Output RHPAK path

---

### promote_catalog_to_db.js

Create RHPAK and import into main database, or use existing skeleton.

```bash
enode.sh jstools/promote_catalog_to_db.js --from-json index7z/abc123.json --bps-path /path/to/abc123.bps
enode.sh jstools/promote_catalog_to_db.js --skip-rhpak --skeleton /path/to/skeleton.json
```

**Options**:
- `--from-json <path>` — Index7z JSON file (required unless --skip-rhpak)
- `--bps-path <path>` — Path to BPS file (required unless --skip-rhpak)
- `--metadata-file <path>` — Extra JSON to merge into gameversion
- `--add-screenshots <dir>` — Add screenshots from directory
- `--skip-rhpak` — Use existing skeleton (skip RHPAK creation)
- `--skeleton <path>` — Path to prepared skeleton.json (with --skip-rhpak)

**Environment**:
- `RHDATA_DB_PATH` — Override rhdata.db path (for tests)
- `PATCHBIN_DB_PATH` — Override patchbin.db path (for tests)
