# Findings: `patchblob1_sha224` was written incorrectly

## Summary

Some RHPlay installs have `rhdata.patchblobs.patchblob1_sha224` populated with the **decoded patch hash** (`pat_sha224`) instead of the **encoded outer patchblob hash** (the SHA-224 of the encrypted/compressed patchblob bytes).

This breaks tooling that expects:

- `patchblobs.patchblob1_sha224` **==** `patchbin.attachments.file_hash_sha224` (**encoded** blob bytes)
- `patchblobs.pat_sha224` **==** SHA-224(**decoded** BPS patch bytes)

## Symptoms

- RHServer db-packager extract reports many attachments “orphan skipped” or fails decode with `Invalid Token: HMAC`.
- Provision bundle analysis shows many changed attachments but `0 ADDITEM resolved`.
- `jstools/verify-all-blobs.js --verify-blobs=db` reports “File hash mismatch: expected <patchblob1_sha224>, got <actual>”.

## Root cause

`jstools/newgame.js` upsert paths wrote `artifact.patSha224` (decoded patch) into `patchblobs.patchblob1_sha224` (should be the encoded outer blob hash).

## Fix

RHPlay now:

- Writes `patchblobs.patchblob1_sha224` from the encoded blob hash (from `BlobCreator` / `computeAttachmentMetadata`), **never** from `patSha224`.
- Populates `patchblobs.result_sha256` when the column exists, and carries it through `updategames.js` skeleton/export/import.

## Repair tool

The repair script updates existing databases by backfilling:

- `rhdata.patchblobs.patchblob1_sha224 = patchbin.attachments.file_hash_sha224`

Script:

- `jstools/fix-patchblob1-sha224.js`

It prefers matching `patchblobs.patchblob1_name` to `attachments.file_name`, and only falls back to `pbuuid` if the match is unambiguous.

## How to run the repair on another RHPlay install

### 0) Identify the target databases

You need the **pair** from the same install / dataset:

- `rhdata.db`
- `patchbin.db`

Common locations:

- In-repo dev install: `electron/rhdata.db` and `electron/patchbin.db`
- Packaged installs often store DBs under the app’s user data directory (location depends on how that install was packaged/configured).

### 1) Make backups (recommended)

Copy the DB files somewhere safe before modifying them.

### 2) Dry-run (shows how many rows would change)

From the RHPlay repo root (this repo), run:

```bash
RHDATA_DB_PATH="/path/to/that/install/rhdata.db" \
PATCHBIN_DB_PATH="/path/to/that/install/patchbin.db" \
./enode.sh jstools/fix-patchblob1-sha224.js --dry-run
```

Expected output includes counts like:

- `Scanned N patchblobs`
- `Mismatched patchblob1_sha224: M (...)`
- `No attachment match: K`

### 3) Apply the fix

```bash
RHDATA_DB_PATH="/path/to/that/install/rhdata.db" \
PATCHBIN_DB_PATH="/path/to/that/install/patchbin.db" \
./enode.sh jstools/fix-patchblob1-sha224.js
```

This updates **only** `rhdata.db` (the `patchblobs` table). `patchbin.db` is opened read-only.

### 4) Verify (recommended)

#### Option A: verify a specific game

```bash
RHDATA_DB_PATH="/path/to/that/install/rhdata.db" \
PATCHBIN_DB_PATH="/path/to/that/install/patchbin.db" \
./enode.sh jstools/verify-all-blobs.js --verify-blobs=db --gameid=41660 --full-check
```

#### Option B: verify everything (slow)

```bash
RHDATA_DB_PATH="/path/to/that/install/rhdata.db" \
PATCHBIN_DB_PATH="/path/to/that/install/patchbin.db" \
./enode.sh jstools/verify-all-blobs.js --verify-blobs=db
```

Add `--full-check` to also apply patches with flips (requires flips + base ROM configured as usual for full-check).

## Notes / gotchas

- **Always use `enode.sh`** for these scripts (project rule); don’t run them with bare `node`.
- `No attachment match: K` means those `patchblobs` rows had no corresponding `attachments` row with a `file_hash_sha224` to copy from (so they were left untouched).
- If you see any `Invalid Token: HMAC` after repair, it typically indicates the blob bytes and the key don’t match (corrupted blob, wrong DB pairing, or stale/alias rows).

