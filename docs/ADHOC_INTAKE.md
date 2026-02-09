# Ad-Hoc Catalog Intake

**Date**: February 2026  
**Scripts**: `intake_bps_metadata.js`, `intake_adhoc.js`, `intake_pack_and_index.js`

---

## Overview

Ad-hoc intake supports cataloging ROM hacks from contests (e.g., QLDC), one-off hacks from third-party sites, and raw BPS/ZIP/SFC folders without SMWC metadata.

---

## Intake Paths

| Source | Script / Flow | Notes |
|--------|---------------|-------|
| Raw BPS folder | `intake_bps_metadata.js` -> `patch_cwd_bps_files.py` -> `process_arcsfc_runner.js` | Need SFC first; patch creates SFC+7z |
| Raw ZIP (BPS + README/Credits) | Extract -> `intake_bps_metadata.js` -> same as BPS | Same flow after extraction |
| Raw SFC folder | `process_arcsfc_runner.js` | Creates 7z per SFC if missing |

---

## Scripts

### intake_bps_metadata.js

Interactive BPS metadata enrichment. Output format: `Name by Author [YYYY-MM-DD] (SMW Hack).bps`

```bash
enode.sh jstools/intake_bps_metadata.js --input-dir ./contest_bps --interactive
enode.sh jstools/intake_bps_metadata.js --input-dir ./contest_bps --batch
enode.sh jstools/intake_bps_metadata.js --input-dir ./contest_bps --apply --csv ./contest_bps/intake_rename_plan.csv
```

**Options**:
- `--input-dir <dir>` — Directory containing BPS files
- `--output-dir <dir>` — Copy/rename to different directory
- `--interactive` — Step through each BPS (default)
- `--batch` — Output CSV of original->suggested, no rename
- `--apply` — Apply renames from CSV
- `--csv <path>` — Path to CSV from --batch (for --apply)
- `--dry-run` — Show what would happen

---

### intake_adhoc.js

Orchestrate ad-hoc intake. Routes BPS/ZIP/SFC folders through the appropriate pipeline.

```bash
enode.sh jstools/intake_adhoc.js --input-dir ./contest_bps --mode bps --metadata-script
enode.sh jstools/intake_adhoc.js --input-dir ./contest_zips --mode zip
enode.sh jstools/intake_adhoc.js --input-dir ./contest_sfc --mode sfc
```

**Options**:
- `--input-dir <dir>` — Directory containing BPS, ZIP, or SFC files
- `--mode bps|zip|sfc` — Source type (default: auto-detect)
- `--metadata-script` — Run intake_bps_metadata before processing (BPS/ZIP only)
- `--dry-run` — Report what would run

**Output**: `output/` from process_arcsfc (BPS, JSON)

---

### intake_pack_and_index.js

Pack BPS into 7z archives, run process_index7zs and search_build.

```bash
enode.sh jstools/intake_pack_and_index.js --json-dir arcsfcXX_json --bps-dir arcsfcXX_bps
enode.sh jstools/intake_pack_and_index.js --json-dir output --bps-dir output --bps7z ./bps7z_new
```

**Options**:
- `--json-dir <dir>` — Directory with master JSON files
- `--bps-dir <dir>` — Directory with BPS files
- `--index7z <dir>` — Master index directory (default: refmaterial/index7z)
- `--bps7z <dir>` — Output dir for new 7z archives
- `--batch-prefix <s>` — Prefix for 7z files (default: bpsxc_YYYYMMDD)
- `--max-per-7z N` — Max items per 7z (default: 100)
- `--max-size-mb N` — Target max size per 7z in MB (default: 25)
- `--dry-run` — Report what would run
- `--skip-search` — Skip search_build1 and search_build2

**Next**: Run `update_bpsarchives.js --add-archive` for each new 7z file.
