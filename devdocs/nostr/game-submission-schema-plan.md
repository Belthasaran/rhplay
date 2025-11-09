# Game & Resource Submission Schema Plan

## 1. Objectives
- Allow trusted end users (default: trust level ≥5) to draft and submit new games/resources with required metadata, patch blobs, and screenshots.
- Support moderation workflow before public visibility: submissions start unmoderated, require moderator/admin approval, or rejection with optional deletion.
- Track submission provenance (submitter npub, timestamps, trust tier), moderation decisions, and publish history.
- Enforce rate limiting (≤1 submission per 24 h for trust <12).
- Prepare the schema for publishing corresponding Nostr events and distributing historical archives.

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

