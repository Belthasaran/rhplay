# Game & Resource Submission Schema Plan

## 1. Objectives
- Allow trusted end users (default: trust level ≥5) to draft and submit new games/resources with required metadata, patch blobs, and screenshots.
- Support moderation workflow before public visibility: submissions start unmoderated, require moderator/admin approval, or rejection with optional deletion.
- Track submission provenance (submitter npub, timestamps, trust tier), moderation decisions, and publish history.
- Enforce rate limiting (≤1 submission per 24 h for trust <12).
- Prepare the schema for publishing corresponding Nostr events and distributing historical archives.

Game Submisison Modal :
- The UI should be implement as a separate Vue component and made accessible from a "Manage > Submit Game Additions"  menu
- The modal can be extended later to include Resource submissions, but for now is just for submitting new Games, and
updates for items previously published by that user.

- The UI tracks all the draft submissions the user is working on, as well as all the published ones.
A "New Game"  button opens a form which allows entry of the common game fields:
       - Please see the gameversions table of the rhdata.db database, and matching gameversion_stats tables; plus the patchblobs data table,
	     and rhpatches table.  Then patchbin.db database's attachments table which links to actual patch file data.
       - gameid, gvuuid, section - Calculated values, read-only to user submitters, only editable by admins.
	   - version is locked at 1 for a new game submission
	   - removed, obsoleted, moderated, and featured - Are all not editable by the submitter. Admins and moderators can set any of them.
	   - based_against - Dropdown list that contains only SMW, currently.
       - Patch filename - user needs to select a BPS file which will be compiled into a patchblob and prepared for addition to the
	   attachments table before the game verification. The patchblob filename will be pblob_(SHAKE128 hash of its contents, 20-characters in hex) -
	   It must be a patch against the base game. The file size must be less than 4194305 bytes.  No ROMs.
       - Screenshot filenames - Must be 256x224 pixel PNGs. Maximum 5 screenshots, file size 300kb each.
       - name - Name of the actual game
	   - length - Exit count
	   - demo - Yes or No
	   - sa1 - Yes or No
	   - collab - Yes or No
	   - difficulty - Dropdown list of the common difficulties: 1 Newcomer, 2 Casual, 3 Skilled, 4 Advanced, 5 Expert, 6 Master, 7 Grandmaster
	   - type - Multi-select Listbox, requires 1 or more selections: Standard, Kaizo, Puzzle, Tool-Assisted, Pit
       - warnings - Multi-select list: Suggestive Content or Language, Crude Content or Language, Possible Photosensitivity Triggers, Violence, Mature
       - author - Main Author
	   - authors - Authors list (Defaults to author if not specified)
	   - submitter - Public key of the submitter in npub format.
	   - legacy_type - Multi-select Listbox, allows picking from 1 or more:
	          Standard: Easy, Standard: Normal, Standard: Hard, Standard: Very Hard,
			  Kaizo: Beginner, Kaizo: Intermediate, Kaizo: Expert, Intermediate Intermediate Kaizo, Intermediate Advanced Kaizo,
			  Tool-Assisted: Pit, Tool-Assisted: Kaizo,  Misc.: Troll, Misc.: Puzzle, Intermediate Intro Kaizo, Intermediate,
			  Joke, Hard
       - combinedtype - Not edited directly, but is set according to code in computeCombinedType() from ~/rhplay/jstools/loaddata.js
   	   - url - optional URL to game info page
	   - download_url - optional author's direct download link for patch or zip containning patch
	   - name_href - optional link to a gamedb listing page
	   - author_href - optional link to an author listing page
	   - obsoleted_by - Only editable by moderators and admins.
	   - description -  Full text description
	   - tags - List of simple tags - Comma separated, usually must be from the available list: custom music, original music, original graphics, no audio
                            altered physics, bosses, exploration, gimmick, no boss, non-platformer, puzzle, traditional, tutorial, vanilla, variety
						creepypasta, crossover, holiday, horror, joke, remake, story, troll, cape, gauntlet, glitch, item tech, precision, shell
						script recommended, fixme, compilation, msu-1

						- Character names, languages, series names, environments, and types of media can also be used as tags
						(e.g. anime, sports, politics, desert, space)
						- Please consider the tags found in ~/rhplay/refmaterial/smwtags.txt   as of the moment as available tags also.
	   - raw_difficulty - The calculated numerical value on the difficulty, such as  diff_1, diff_2, diff_3, diff_4, diff_5
       - submission_notes
	   



## 2. New Tables

### 2.1 `game_submissions`
| Column | Type | Notes |
|--------|------|-------|
| `submission_id` | TEXT PRIMARY KEY (`newYYMMDDHH_<hash>` format) | Deterministic ID based on UTC timestamp + SHAKE128-8 of submitter npub. |
| `gvuuid` | TEXT UNIQUE | Deterministic UUID (SHA256 of timestamp + npub). |
| `submitter_pubkey_npub` | TEXT NOT NULL | Submitter’s npub (stored canonical). |
| `submitter_trust_level` | INTEGER NOT NULL | Snapshot of trust when submission created. |
| `state` | TEXT NOT NULL DEFAULT `draft` | `draft`, `pending`, `approved`, `rejected`, `deleted`. |
| `moderated` | INTEGER NOT NULL DEFAULT 0 | 0/1 mirror of `gameversions.moderated`. |
| `moderation_status` | TEXT NULL | `unreviewed`, `approved`, `soft_reject`, `hard_reject`. |
| `moderator_pubkey_npub` | TEXT NULL | Last moderator who acted. |
| `moderation_notes` | TEXT NULL | Freeform notes. |
| `quality_rating` | TEXT NULL | Optional quality qualifier from moderation. |
| `reject_reason` | TEXT NULL | Optional reject reason (soft/hard). |
| `created_at_utc` | INTEGER NOT NULL | Seconds since epoch. |
| `updated_at_utc` | INTEGER NOT NULL | Auto-updated. |
| `published_gameid` | TEXT NULL | Gameid assigned when approved. |
| `published_version` | INTEGER NULL | Version assigned (default 1 for new games). |
| `published_at_utc` | INTEGER NULL | Timestamp when moved into `gameversions`. |
| `submission_notes` | TEXT NULL | Author notes to moderators. |
| `cooldown_expires_utc` | INTEGER NULL | Rate-limit tracking. |

### 2.2 `game_submission_assets`
| Column | Type | Notes |
|--------|------|-------|
| `asset_id` | TEXT PRIMARY KEY (uuid) | |
| `submission_id` | TEXT NOT NULL REFERENCES `game_submissions` ON DELETE CASCADE | |
| `asset_type` | TEXT NOT NULL | `patch_blob`, `screenshot`, `document`, `other`. |
| `filename` | TEXT NOT NULL | Original filename. |
| `storage_path` | TEXT NOT NULL | Relative path or blob reference. |
| `hash_sha256` | TEXT NOT NULL | For dedupe/validation. |
| `size_bytes` | INTEGER NOT NULL | |
| `metadata_json` | TEXT NULL | e.g., dimensions for screenshots. |
| `created_at_utc` | INTEGER NOT NULL | |

### 2.3 `game_submission_rate_limits`
| Column | Type | Notes |
|--------|------|-------|
| `submitter_pubkey_npub` | TEXT PRIMARY KEY | |
| `last_submission_utc` | INTEGER NOT NULL | |
| `submission_count_24h` | INTEGER NOT NULL | For future sliding window enforcement. |

### 2.4 `game_submission_actions` (moderation log)
| Column | Type | Notes |
|--------|------|-------|
| `action_id` | TEXT PRIMARY KEY (uuid) | |
| `submission_id` | TEXT NOT NULL REFERENCES `game_submissions` ON DELETE CASCADE | |
| `action_type` | TEXT NOT NULL | `create`, `update`, `submit`, `approve`, `reject`, `delete`, `restore`. |
| `actor_pubkey_npub` | TEXT NOT NULL | Moderator/admin performing action. |
| `actor_trust_level` | INTEGER NOT NULL | Snapshot of actor trust. |
| `details_json` | TEXT NULL | Additional context (quality rating, scope). |
| `created_at_utc` | INTEGER NOT NULL | |

## 3. Changes to Existing Tables

### 3.1 `gameversions`
- Add columns:
  - `submission_id` TEXT NULL REFERENCES `game_submissions` (origin link).
  - `submitter_pubkey_npub` TEXT NULL.
  - `moderated` INTEGER NOT NULL DEFAULT 0 (visibility flag).
  - `moderation_status` TEXT NULL (`approved`, `soft_reject`, `hard_reject`).
  - `moderated_at_utc` INTEGER NULL.
  - `moderated_by_pubkey_npub` TEXT NULL.
  - `quality_rating` TEXT NULL.
  - `reject_reason` TEXT NULL.
  - `first_published_at_utc` INTEGER NULL.
  - `submission_notes` TEXT NULL (copied from submission for reference).
- Ensure default `gameid` assigned by tooling (read-only for submitter). For drafts, store placeholder `newYYMMDDHH_<hash>` until approved.

### 3.2 `patchblobs`
- Add optional `submission_id` to link original upload.
- Store `origin_filename`, `submitter_pubkey_npub`, `origin_hash`.
- Enforce size limit (≤4 MiB) during ingest.

### 3.3 `attachments` (patchbin.db)
- Add `submission_id`, `attachment_type` (`patch_blob`, `screenshot`), `metadata_json` (dimensions, etc.).
- Store screenshot constraints (256×224 PNG ≤300 KB).

### 3.4 `gameversion_stats`
- Add `submission_id` to reference original submission data for analytics.

## 4. Business Rules
- Draft creation allowed for all users; publish button disabled unless online profile trust ≥5.
- Rate limit: trust level <12 → maximum one published submission in 24 h; enforce via `game_submission_rate_limits`.
- On approval:
  - Generated `gameid` replaced with final ID (may remain same if deterministic).
  - Copy metadata into `gameversions`, `patchblobs`, `attachments`.
  - Update submission `state='approved'`, link `published_gameid`.
- Rejection:
  - `hard_reject` → mark `state='rejected'`, optionally `state='deleted'` (removes assets).
  - `soft_reject` → remain visible to moderators; submitter can revise and resubmit.
- Moderation scope: extra permission check (`PermissionHelper`) ensures moderator has rights over game’s section.

## 5. UI Considerations
- “Game/Resource Submissions” modal:
  - Lists drafts/published records with state, moderation status, cooldown timer, and action buttons (edit, submit, withdraw).
  - “New Draft Submission” guided wizard for metadata, patch upload, screenshots.
  - Trust warning overlay if user lacks required trust to publish.
- **Submission Form Fields (per draft)**
  - **Patch upload**: BPS file ≤ 4 MiB, validated against base ROM; stored as patch blob + attachment (enforce SHAKE128 filename `pblob_<hash>`).
  - **Screenshots**: up to 5 PNG images, each exactly 256×224 px and ≤ 300 KB; stored with metadata.
  - **Name** (`gameversions.name`): free text, required.
  - **Length** (`gameversions.length` / exit count): integer.
  - **Demo / SA-1 / Collab flags**: boolean toggles.
  - **Difficulty**: dropdown (1 Newcomer, 2 Casual, 3 Skilled, 4 Advanced, 5 Expert, 6 Master, 7 Grandmaster).
  - **Type**: multi-select (Standard, Kaizo, Puzzle, Tool-Assisted, Pit).
  - **Warnings**: multi-select (Suggestive Content or Language, Crude Content or Language, Possible Photosensitivity Triggers, Violence, Mature).
  - **Author** (primary) and **Authors list** (defaults to primary if empty).
  - **Submitter npub**: auto-filled from profile; read-only to user.
  - **Legacy Type** multi-select: (Standard: Easy/Normal/Hard/Very Hard, Kaizo tiers, Tool-Assisted categories, Misc tags: Troll, Puzzle, Joke, etc.).
  - **Combined Type**: computed via `computeCombinedType()` (read-only).
  - **URL / download_url / name_href / author_href**: optional external links.
  - **Obsoleted By**: admin/moderator only.
  - **Description**: rich text/markdown field.
  - **Tags**: comma-separated list (with guidance from `refmaterial/smwtags.txt`; include character/language/environment tags permitted).
  - **Raw Difficulty**: derived numeric difficulty key (e.g., `diff_1`…`diff_5`).
  - **Submission Notes**: freeform text to moderators.
  - **New identifiers (auto)**: `gameid = newYYMMDDHH_<SHAKE128-8>`, `gvuuid` hashed from timestamp + submitter npub, `section` default “Game” plus inferred subsections via tags.
- Moderation view (for scoped admins/moderators):
  - Pending submissions filter, approval/rejection controls, preview of patch (maybe via test apply), view of attached screenshots.
  - Display submitter trust level, cooldown history, and flags (quality rating, tags).

## 6. Nostr Integration & Archival Strategy
- Approved submissions trigger Nostr events (new game `kind` TBD, updates to existing games) with metadata, patch hash references, and moderation scope tags.
- Archive service (HTTP/relay) to host authoritative events (declarations, ratings, game metadata). Clients fetch historical `nostr-data*.json.xz` bundles if relays prune old events.
- Record SHA256 digest of processed archives to avoid duplicate ingest.
- When ingesting historical events, only update local records if incoming event timestamp ≥ existing `updated_at` to avoid overwriting newer data.

## 7. Next Steps
- Draft SQL migrations for new tables and added columns.
- Update ORM/helpers in codebase to read/write new fields.
- Extend `PermissionHelper` with actions for `game.submission.create`, `game.submission.moderate`, `game.submission.publish`.
- Plan UI components (submission modal, moderation queue, admin metadata console).
- Define Nostr event kinds & payload schema for game submissions/approvals.

---

# Metadata Delta Log Proposal (`updategames.js`)

## 1. Goals
- Emit a machine-readable log of every mutation performed by `enode.sh jstools/updategames.js`.
- Include changes to primary tables (`gameversions`, `rhpatches`, `patchblobs`, `attachments`) and ancillary tables populated by follow-up scripts (`gameversion_stats`, `gameversion_levelnames`, `gameversions_translevels`, `levelnames`).
- Support both baseline diff and append-only capture modes.
- Allow optional compression (XZ) and splitting per run for efficient packaging and distribution.

## 2. File Layout & Naming
- Default root: `logs/game_deltas/`.
- File naming: `delta-YYYYMMDD-HHMMSS.json` (UTC). When `--log-xz` enabled, produce `delta-YYYYMMDD-HHMMSS.json.xz`.
- `--log-split-size <MB>` starts new segments (`delta-...-partNN.json`).
- Maintain manifest `delta-manifest.json` tracking file order, SHA256, compression.

## 3. Document Structure
```json
{
  "version": 1,
  "run_id": "2025-11-09T13:05:01Z",
  "mode": "append",
  "source": {
    "script": "jstools/updategames.js",
    "git_commit": "abc123",
    "baseline_db_sha256": "optional"
  },
  "entries": [
    {
      "timestamp": "2025-11-09T13:05:02.345Z",
      "table": "gameversions",
      "action": "insert",
      "primary_key": { "gameid": "new25110913_1a2b3c4d" },
      "diff": {
        "before": null,
        "after": { "...": "..." }
      },
      "artifacts": [
        {
          "type": "patch_blob",
          "path": "patchbin/pblob_deadbeef1234",
          "sha256": "deadbeef...",
          "size_bytes": 102400
        }
      ]
    }
  ],
  "ancillary": {
    "gameversion_stats": [
      {
        "timestamp": "2025-11-09T13:05:10Z",
        "action": "upsert",
        "primary_key": { "gameid": "new...", "version": 1 },
        "diff": { "before": "...", "after": "..." }
      }
    ],
    "gameversion_levelnames": [
      {
        "timestamp": "2025-11-09T13:05:20Z",
        "action": "insert",
        "primary_key": { "level_id": 42, "lang": "en" },
        "diff": { "before": null, "after": { "name": "Example" } }
      }
    ],
    "gameversions_translevels": [
      {
        "timestamp": "2025-11-09T13:05:25Z",
        "action": "insert",
        "primary_key": { "gameid": "new...", "translevel": 45 },
        "diff": { "before": null, "after": { "notes": "..." } }
      }
    ],
    "levelnames": [
      {
        "timestamp": "2025-11-09T13:05:30Z",
        "action": "update",
        "primary_key": { "level_id": 42, "lang": "en" },
        "diff": { "before": { "name": "Old" }, "after": { "name": "New" } }
      }
    ]
  }
}
```

### Entry Fields
- `timestamp`: ISO 8601 UTC.
- `table`: affected table.
- `action`: `insert`, `update`, `delete`.
- `primary_key`: map of columns forming the key.
- `diff.before` / `diff.after`: capture relevant columns (omit raw BLOBs; reference via hashes).
- `artifacts`: optional array linking to files produced (patch blobs, screenshots).

## 4. Capture Modes
- **Append Mode (`--log-append`)**: log each mutation as the script executes.
- **Baseline Diff Mode (`--log-baseline path/to/original.db`)**: compare final DB to baseline; emit entries for new/updated/deleted records.
- Both modes can run together (append for realtime, baseline for verification).

## 5. Compression & Splitting Options
- `--log-xz`: stream entries through XZ compressor.
- `--log-split-size <MB>`: rotate files when size threshold reached; maintain manifest.
- `--log-dir <path>`: override output directory.

## 6. Publishing Hooks
- Provide CLI `enode.sh jstools/export-delta-to-nostr.js` that consumes delta files:
  - Emits Nostr events for each entry (e.g., new game, updated patch, levelname change).
  - Queues events in `nostr_cache_out`.
  - Optionally bundle delta segments into `.json.xz` for distribution via HTTP/relay.
- Offer `--publish-levelnames` flag to send ancillary levelnames/level-id updates once imports complete (after running `lmlevelnames/import_*` scripts).

## 7. Ingest & Verification
- Build validator to replay delta entries on a pristine DB to ensure determinism.
- Record SHA256 per delta file; clients compare before ingest.
- Support resumable ingest by persisting last processed `run_id + entry index`.

## 8. Future Considerations
- Add signatures (admin keypair) to delta manifests for authenticity.
- Extend schema with `notes` / `tags` per entry to group changes (e.g., “SMWC batch 2025-11-09”).
- Provide UI in Nostr admin tools to list delta runs, inspect entries, and trigger re-publish.

