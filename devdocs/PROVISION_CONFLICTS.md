# Provision conflict resolution

When manifest bundle patches overlap with user-installed RHPAKs or per-game feed rows, RHPlay reconciles before applying SQL patches.

## Flow

1. **Conflict scan** (`lib/provision-conflict-checker.js`) reads `patch_declarations` from bundle `provindex.json`.
2. **Equivalence** — identical local rows (feed-preinstalled) are skipped.
3. **Reconcile** (`lib/provision-reconcile.js`) — uninstall overlapping RHPAKs, backup/remove true conflicts, write `gv_migrations.csv` and `conflicts-{dbname}.json`.
4. **Apply bundle** — `REPLACE INTO` SQL + ADDITEM (thick chain).
5. **Remap** (`lib/gv-migration-remapper.js`) — update `clientdata.db` gameid references.
6. **Orphan cleanup** (`lib/provision-orphan-cleanup.js`) — final integrity pass; archive to `{userData}/provision-backup/{timestamp}/`.

## GUI surfaces that write manifest DBs

| Surface | DBs |
|---------|-----|
| Install RHPAK (`App.vue`) | rhdata, patchbin, resource, screenshot |
| Load Manual / share code | same |
| `newgame.js --import` | same |
| Game Stages editor | rhdata.gamestages |
| Database Update / Provisioner | manifest DB apply |

## CLI

```bash
./enode.sh jstools/provision-conflicts.js --bundle patch.7z --db-name rhdata.db --user-data-dir /path/to/userdata
```

## rhserver bundles

All thick+light SQL patches ship as `type: "bundle"` with `patch_declarations` and `REPLACE INTO` SQL. Thick bundles include ADDITEM artifact bytes; light bundles are SQL+metadata only.
