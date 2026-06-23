# Adding Database Support to the Provisioner

This guide explains how to add support for new databases to the database provisioner system (`electron/installer/prepare_databases.js`). The provisioner handles both **embedded databases** (bundled with the installer) and **manifest-based databases** (downloaded from ArDrive/IPFS).

## Overview

The provisioner supports two types of databases:

1. **Embedded Databases**: Pre-compressed database files bundled with the installer (e.g., `clientdata.db`, `screenshot.db`, `resource.db`)
2. **Manifest-Based Databases**: Databases defined in `dbmanifest.json` that are downloaded, extracted, and patched (e.g., `rhdata.db`, `patchbin.db`)

## Current Supported Databases

- `clientdata.db` - Embedded (user-specific data)
- `rhdata.db` - Manifest-based (public game metadata)
- `patchbin.db` - Manifest-based (binary patch data)
- `screenshot.db` - Embedded (screenshot storage)
- `resource.db` - Embedded (resource storage)

## Step-by-Step: Adding a New Database

### Step 1: Add Database to DATABASES Array

Edit `electron/installer/prepare_databases.js` and add your database to the `DATABASES` array:

```javascript
const DATABASES = [
  { name: 'clientdata.db', manifestKey: 'clientdata.db', embedded: true },
  { name: 'rhdata.db', manifestKey: 'rhdata.db', embedded: false },
  { name: 'patchbin.db', manifestKey: 'patchbin.db', embedded: false },
  { name: 'resource.db', manifestKey: 'resource.db', embedded: true },
  { name: 'screenshot.db', manifestKey: 'screenshot.db', embedded: true },
  // Add your new database here:
  { name: 'yournew.db', manifestKey: 'yournew.db', embedded: true }, // or false
];
```

**Parameters:**
- `name`: The database filename (must end with `.db`)
- `manifestKey`: The key used in `dbmanifest.json` (usually same as `name`)
- `embedded`: `true` if bundled with installer, `false` if downloaded from manifest

### Step 2A: For Embedded Databases

If your database is **embedded** (bundled with the installer):

1. **Create the compressed seed file:**
   - Place your initial database file in `electron/packed_db/`
   - Compress it: `xz yournew.db` → `yournew.db.initial.xz`
   - Or rename existing: `mv yournew.db.initial.xz electron/packed_db/`

2. **Add to package.json extraResources:**
   Edit `package.json` and add to the `extraResources` array:
   ```json
   {
     "from": "electron/packed_db/yournew.db.initial.xz",
     "to": "db/yournew.db.initial.xz"
   }
   ```

3. **Add to main.js DATABASE_FILES:**
   Edit `electron/main.js` and add to the `DATABASE_FILES` array:
   ```javascript
   const DATABASE_FILES = ['clientdata.db', 'rhdata.db', 'patchbin.db', 
                          'resource.db', 'screenshot.db', 'yournew.db'];
   ```

4. **Update database-manager.js (if needed):**
   If your database needs special handling, add it to `electron/database-manager.js` in the `getDatabasePaths()` method.

### Step 2B: For Manifest-Based Databases

If your database is **manifest-based** (downloaded from ArDrive/IPFS):

**Dual provisioning chains:** Each target may define a **full** chain (`version`, `base`, `sqlpatches`) and an optional **light** chain (`version:light`, `base:light`, `sqlpatches:light`). When `base:light` is not configured (both `file_name` and `sha256` required), light provisioning uses the **shared-chain shortcut** and inherits full-chain `base`/`sqlpatches` unless `sqlpatches:light` is explicitly listed. `version` always aliases (`version:light ?? version`). RHPlay records which chain was used in `provisioned.json` per database (`chain`: omitted = legacy implicit full, `"full"` = explicit full, `"light"` = light). Use `prepare_databases.js --db-chain light` or the Provisioner checkbox for new installs. See `rhserver/devdocs/LIGHT_CHAIN_PROVISIONER_PHASE6.md`.

1. **Add entry to dbmanifest.json:**
   Edit `electron/db_temp/dbmanifest.json` (or the active manifest) and add:
   ```json
   {
     "yournew.db": {
       "base": {
         "file_name": "yournew_2025_01_01.tar.xz",
         "format": "tar+xz",
         "extract_file": "yournew.db",
         "sha256": "...",
         "ipfs_cidv1": "...",
         "ardrive_file_path": "/SMWRH/db/yournew_2025_01_01.tar.xz",
         "size": "..."
       },
       "sqlpatches": [
         {
           "file_name": "yournew_2025_01_01-patch001.sql.xz",
           "format": "xz",
           "type": "sql",
           "sha256": "...",
           "ipfs_cidv1": "...",
           "size": "..."
         }
       ]
     }
   }
   ```

### Provisioning bundles (7z/zip + provindex.json)

Thick-chain updates may use **`type: "bundle"`** instead of a single `.sql.xz` patch:

```json
{
  "file_name": "pbin14_to_15_bundle.7z",
  "version_before": "14",
  "type": "bundle",
  "format": "7z",
  "sha256": "..."
}
```

Base databases may also use bundles:

```json
"base": {
  "file_name": "resource_15.7z",
  "type": "bundle",
  "format": "7z",
  "extract_file": "resource.db",
  "sha256": "..."
}
```

Each bundle contains `provindex.json` (ordered JSON array) plus payload files. Instruction types:

| type | purpose |
|------|---------|
| `EXTRACT_DB` | Copy a `.db` member to the staging database (base bundles) |
| `SQL_PATCH` | Apply a `.sql` file (`PRAGMA foreign_keys=OFF`) |
| `ADDITEM` | Copy artifact into `{userData}/artifacts/` and upsert index CSV |
| `CLEANUP` | Append cleanup hint (no file deletion during provision) |

Legacy `format: "xz"` / `tar+xz` patches and `file_data` in SQLite remain supported as fallback.

2. **Add to main.js DATABASE_FILES:**
   Same as Step 2A, item 3.

3. **Update database-manager.js (if needed):**
   Same as Step 2A, item 4.

### Step 3: Update Documentation

1. **Update this file** (`docs/ADDING_DATABASE_SUPPORT.md`) to list your new database.

2. **Update relevant docs:**
   - `docs/ELECTRON_APP_DATABASES.md` - Database purpose and schema
   - `docs/PROGRAMS.MD` - If database requires CLI tools
   - `docs/CHANGELOG.md` - Log the addition

### Step 4: Test

1. **Test embedded database:**
   ```bash
   # Run the provisioner in plan mode
   node electron/installer/prepare_databases.js --user-data-dir /tmp/test-db
   
   # Verify it detects your database
   # Then test provisioning
   node electron/installer/prepare_databases.js --user-data-dir /tmp/test-db --provision
   ```

2. **Test manifest-based database:**
   ```bash
   # Same as above, but ensure manifest entry exists
   # Verify download/extract/patch workflow
   ```

3. **Test in installer:**
   - Build installer: `npm run build:installer:win` (or linux/mac)
   - Run installer and verify database is provisioned correctly

## How the Provisioner Works

### Embedded Database Flow

1. **Detection**: `inspectDatabases()` checks if database exists in user data directory
2. **Action**: If missing or `--overwrite` specified, sets `action: 'copy-embedded'`
3. **Staging**: `stageEmbeddedDb()` locates seed file using `locateEmbeddedSeed()`
4. **Decompression**: If seed is `.xz`, decompresses to temporary file
5. **Copy**: Moves final database to user data directory

### Manifest-Based Database Flow

1. **Detection**: `inspectDatabases()` checks if database exists
2. **Action**: If missing or `--overwrite` specified, sets `action: 'provision-from-manifest'`
3. **Download**: `ensureArtifact()` downloads base archive (IPFS → ArDrive fallback)
4. **Extract**: Decompresses `.tar.xz`, extracts database file
5. **Patch**: Applies SQL patches in lexicographical order
6. **Finalize**: Moves completed database to user data directory

## File Locations

### Development
- Embedded seeds: `electron/packed_db/*.db.initial.xz`
- Manifest: `electron/db_temp/dbmanifest.json` or `electron/dbmanifest.json`
- Provisioner: `electron/installer/prepare_databases.js`

### Packaged (Installer)
- Embedded seeds: `resources/db/*.db.initial.xz`
- Manifest: `resources/db/dbmanifest.json`
- Provisioner: `resources/db/prepare_databases.js`

### Runtime
- Databases: OS-specific user data directory
  - Windows: `%APPDATA%\RHTools\`
  - macOS: `~/Library/Application Support/RHTools/`
  - Linux: `$XDG_CONFIG_HOME/RHTools/` or `~/.config/RHTools/`

## Troubleshooting

### "Embedded seed not found"
- Check `package.json` `extraResources` includes your seed file
- Verify seed file exists in `electron/packed_db/`
- Check file naming: should be `yournew.db.initial.xz` (not `yournew.initial.xz`)

### "Manifest entry missing"
- Verify entry exists in `dbmanifest.json` with correct `manifestKey`
- Check `manifestKey` in `DATABASES` array matches JSON key

### "SHA-256 mismatch"
- For embedded: Re-compress seed file and verify hash
- For manifest: Verify `sha256` in manifest matches actual file hash

### Database not detected
- Ensure database name ends with `.db`
- Check `DATABASE_FILES` in `main.js` includes your database
- Verify `DATABASES` array entry is correct

## Advanced: Adding SQL Patches to Embedded Databases

If you need to add SQL patches to an embedded database later:

1. Convert embedded database to manifest-based (set `embedded: false`)
2. Add base archive to manifest
3. Add SQL patches array to manifest entry
4. Update `package.json` to remove embedded seed from `extraResources`

## See Also

- `electron/installer/prepare_databases.js` - Main provisioner implementation
- `electron/db_temp/dbmanifest.json` - Manifest structure reference
- `docs/INSTALLER_BUILD_AND_DB_PROVISION_PLAN.md` - Overall provisioning architecture

