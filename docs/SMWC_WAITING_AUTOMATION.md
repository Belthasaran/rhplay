# SMWC Waiting Automation

**Date**: February 2026  
**Scripts**: `smwcw_waiting_build7z.js`, `smwcw_waiting_periodic.js`, `smwcw_waiting_upload.js`

---

## Overview

The SMWC Waiting automation pipeline automates building and uploading waiting 7z packages for games processed by `smwcw_waiting_compare.js` and `smwcw_waiting_fetchmissing.js`.

**Design principle**: `upload/done/` is ephemeral — an external process expires old files. The persistent completed registry (`waiting_packages_completed.json`) is the only source of truth for "this GameID has been fully processed."

---

## Pipeline Flow

1. **smwcw_waiting_compare.js** — Compares SMWC Waiting ROMs with rhdata.db, outputs `waiting_queue.json`, `waiting_processed.json`
2. **smwcw_waiting_fetchmissing.js** — Downloads games from queue, creates BPS, bpsindex JSON, games JSON, images
3. **smwcw_waiting_build7z.js** — Builds `upload/waiting_<GAMEID>.7z` for each processed game (skips if in completed registry)
4. **smwcw_waiting_upload.js** — Uploads 7z to IPFS and Pixeldrain, moves to `upload/done/`, appends GameID to completed registry

---

## Scripts

### smwcw_waiting_build7z.js

Build 7z waiting packages. Uses persistent completed registry so we never re-build for games already fully processed.

```bash
enode.sh jstools/smwcw_waiting_build7z.js <GAMEID>
enode.sh jstools/smwcw_waiting_build7z.js --all
enode.sh jstools/smwcw_waiting_build7z.js --all --dry-run
```

**Output**: `jstools/smwc_world/upload/waiting_<GAMEID>.7z`

---

### smwcw_waiting_periodic.js

Periodic runner. Runs compare, fetch, and build7z in sequence.

```bash
enode.sh jstools/smwcw_waiting_periodic.js
enode.sh jstools/smwcw_waiting_periodic.js --only-build-7z --max-games 10
enode.sh jstools/smwcw_waiting_periodic.js --dry-run
```

**Options**:
- `--dry-run` — Report what would run, do not execute
- `--skip-compare` — Skip smwcw_waiting_compare
- `--skip-fetch` — Skip smwcw_waiting_fetchmissing
- `--only-build-7z` — Skip compare and fetch, only run build7z
- `--max-games N` — Limit build7z to at most N games

**Output**: Logs to `smwc_world/periodic_log_YYYYMMDD.txt`

---

### smwcw_waiting_upload.js

Upload waiting 7z packages to IPFS and Pixeldrain. After verification, moves to `upload/done/` and appends GameID to persistent completed registry.

```bash
enode.sh jstools/smwcw_waiting_upload.js
enode.sh jstools/smwcw_waiting_upload.js --dry-run
enode.sh jstools/smwcw_waiting_upload.js --skip-ipfs
```

**Environment**: `PIXELDRAIN_API_KEY` required for Pixeldrain upload

---

## File Layout

```
jstools/smwc_world/
  waiting_packages_completed.json   # PERSISTENT: GameIDs fully handled (never reprocess)
  upload/
    done/                           # Ephemeral — external process expires old files
    upload_state.json               # Per-file upload status (transient)
  periodic_log_YYYYMMDD.txt         # Run logs
```

---

## Dependencies

- `SMWC_QUERY_A_WAITING` — Required for smwcw_waiting_compare (Base64 encoded API URL)
- `7z` — For creating 7z archives
- `ipfs` — For IPFS add (local node)
- `PIXELDRAIN_API_KEY` — For Pixeldrain upload (Basic auth)
