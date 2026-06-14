# Patch Resolver

Multi-source patch and patchblob retrieval for the Electron app and CLI tools.

## Library modules

| Module | Purpose |
|--------|---------|
| `lib/patch-resolver.js` | `resolvePatch`, `resolvePatchblob`, `canResolvePatch` |
| `lib/patchblob-decode.js` | Canonical LZMA/Fernet decode |
| `lib/patch-resolver-paths.js` | App-data directory helpers |
| `lib/patch-resolver-hash.js` | SHA-224/SHA-1 verification |
| `lib/catalog-patch-extract.js` | Catalog 7z lookup and BPS extraction |
| `lib/rhpak-storage.js` | `rhpak-installed/` and `rhpak-removed/` lifecycle |
| `electron/utils/patch-resolver-context.js` | Electron ctx with catalog download hooks |

## Retrieval method chain

Methods are tried in order until integrity verification succeeds:

1. **Database** — `patchbin.attachments.file_data`
2. **Local patch** — `{userData}/patch/`, cache dirs (`patch_name`, `pat_shake_128`, `{result_sha1}.bps`)
3. **Local patchblob** — `{userData}/pblobs/`
4. **Catalog bps7z** — `rhsearch_cat.db` → `index7z_name` / `indexbps_name` (SHA256 or SHA1 lookup)
5. **Installed RHPAK** — `{userData}/rhpak-installed/{rhpakuuid}.rhpak`
6. **Patch archives** — `{userData}/patch-archives/`, `downloads/`, loose or zip/7z `{result_sha1}.bps`
7. **Server URLs** — deferred stub
8. **download_url** — `gameversions.download_url` or attachment URLs; caches to `patch/`
9. **Auto catalog** — install catalog DB/ZIP then retry method 4

## Integrity

Decoded patches must match `patchblobs.pat_sha224` (and `pat_sha1` when present). Encoded patchblobs must match `patchblob1_sha224`.

## App-data layout

```
userData/
  patch/              # verified decoded BPS cache
  pblobs/             # verified encoded patchblob cache
  rhpak-installed/    # copy of each imported RHPAK
  rhpak-removed/      # RHPAKs moved here on uninstall
  downloads/          # catalog bps7z and base files
  patch-archives/     # optional user zip/7z collections
```

## Progress events

Resolver callbacks use:

```js
onProgress({ phase, method, message, current, total, bytesLoaded, bytesTotal })
```

Electron IPC channel: `patch-resolve-progress` (during run/quick-launch staging).

## Environment overrides

- `PATCHBIN_DB_PATH`, `RHDATA_DB_PATH`
- `RHSEARCH_CAT_DB_PATH`
- `PATCH_RESOLVER_USER_DATA`, `PATCH_RESOLVER_PATCH_DIR`, `PATCH_RESOLVER_PBLOBS_DIR`

## Tests

```bash
node tests/test_patch_resolver.js
```
