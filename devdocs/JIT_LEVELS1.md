# JITLevels1 — Just-In-Time Level Detection

## Overview

When the **Detected Levels** dialog opens in Game Stages edit mode, the app builds a patched SFC and runs on-demand analyzers in `lib/jit-levels/`, merging results with existing DB sources (`lmlevels`, `detect`, `trans`, `levelnames`).

## Source tags

| Tag | Module | Description |
|-----|--------|-------------|
| `jitnames` | `jit-names.js` | Level names from LM hijack table; vanilla names excluded |
| `jitnames2` | `jit-names2.js` | MT-compat level name reader (`mtcompat-levelreader.js`); vanilla names excluded |
| `jitmt` | `jit-mt.js` | MT-compat inclusion set (pipe/vanilla-name rules); sets `mtIncluded`, `mtIsPipe`, `mtIsVanillaName` |
| `jitow` | `jit-ow.js` | Overworld placement scan (STAR RLE + translevel opcodes) |
| `jittrans` | `jit-trans.js` | Overworld translevel scan (vanilla tilemap or LM LevelNumberMap) |
| `jitlmfilter` | `jit-lmfilter.js` | Level IDs from `gameversions.lmlevels`, catalog `lmfilter`, or Calisto/LM363 export |
| `jitlevelinfo` | `levelinfo/` | Full `level_info1` parse — headers, objects, sprites, gfx route |
| `jitscore` | `jit-score/` | Originality, internal similarity, completeness scores |

## Detected Levels UI

`DetectedLevelsDialog.vue` filters and display options:

- **Name reader toggle** — `JITNames` (default) vs `JITNames2` (MT-compat reader). Red ★ when `levelnameJitnames` and `levelnameJitnames2` disagree.
- **Show Sources** — checkboxes per tag; `jitnames2`, `jitmt`, `jitow` default **off**; others default **on**. Preset menu: All / None / DB Only / JIT Only / MT Only.
- **Exclude filters** (default off): PipeKeywords, EndKeywords, MTExclude (hide rows where `mtIncluded !== true`), Exclude-NonLM (active when any row has `lmlevels` or `jitlmfilter`).

Merged level fields from MT-compat sources: `levelnameJitnames`, `levelnameJitnames2`, `mtIncluded`, `mtIsPipe`, `mtIsVanillaName`.

## IPC

- `gamestages:run-jit-detection` — build ROM + run pipeline
- Progress events: `gamestages:jit-detection-progress`

## Calisto / LM363 fallback

If LMFilter data is missing, the UI prompts to run Calisto via Wine (Linux). Requires:

- `refmaterial/jitlevels.zip` extracted to temp (`jitlevels/lm363.exe`, Calisto)
- Valid vanilla `smw.sfc` in program data
- Wine installed on Linux

## Fingerprints

- Format: `v1:{hex}` per screen (Layer1 16×16 tile numbers)
- Corpus: `electron/data/level_fingerprints.txt`
- CLI: `./enode.sh jstools/level_fingerprint.js --rom file.sfc`

## Parity tests

When `level_info1` changes, run:

```bash
npm run test:jit-names2
npm run test:jit-mt
npm run test:jit-ow
npm run test:jit-levelinfo-parity
```

Compares JS `parseLevelInfo` vs C `level_info1 --json` on akogare `0x109`.

## Related files

- `lib/jit-levels/mtcompat-levelreader.js` — MT-compat name/inclusion/OW helpers
- `lib/jit-levels/orchestrator.js` — pipeline entry
- `electron/ipc-handlers.js` — IPC handler
- `electron/renderer/src/components/DetectedLevelsDialog.vue` — UI
