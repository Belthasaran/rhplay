# Wrap-up: Map16 `0x04BD` muncher + Layer1 rendering concerns (2026-05-25)

This document is a handoff summary so work can continue cleanly in a new agent session.

## Context and goals (as stated by user)

- **Bug report**: In Lunar Magic’s 16×16 tile editor, Map16 **`0x04BD`** shows as a **full muncher**, but our 16×16 probe / renderer showed a “half muncher”.
- **User priority**: **Correct tile shapes** (munchers, pipes, hills). Palette is secondary.
- **Bigger concern (still unresolved)**: “**Layer1 tile rendering still is not working**” — user indicates the broader objective (accurate Layer1) is still not met.
- **Concern about approach**: The implemented fix felt **muncher-specific / hardcoded**, akin to baking one test case into the renderer.

## Ground truth discovered (why `0x04BD` looked wrong)

Files:
- `lmlevelinfo/test/akogare/AllMap16.map16`
- `lmlevelinfo/test/akogare/4bd.map16` (single-tile LM export provided by user)
- `lmlevelinfo/test/akogare/resources/all_map16/global_pages/FG_pages/page_04.txt`

Binary reality (LM16 format with an 8-byte header):
- `AllMap16.map16` **flat index `0x04BD`** contains a **placement stub**:
  - Subtiles: `0x0F8, 0x04C, 0x0F8, 0x04D` (locals `0x78, 0x4C, 0x78, 0x4D`) → renders as half muncher.
- `4bd.map16` contains a **full muncher quad** (`tile8` locals `0x5C–0x5F`, pal 6) at its **last slot** (index 21).
- That exact full quad also exists in `AllMap16.map16` at **index `0x04D2`** (which equals `0x04BD + 21` in akogare).

LM text export indicates a definition indirection:
- `page_04.txt` shows:
  - `04BD: 012F { 05C 6 ---  05E 6 ---  05D 6 ---  05F 6 --- }`
- `page_01.txt` shows:
  - `012F: 012F { 05C 6 ---  05E 6 ---  05D 6 ---  05F 6 --- }`
- But in the binary, `AllMap16[0x012F]` is empty; the “definition content” lives elsewhere (e.g. `0x04D2`).

**Interpretation**: LM’s “tile number” in the editor can behave like a *definition reference*, while the bulk `AllMap16.map16` slot at that index may be a **stub** that needs redirecting to the actual definition content.

## What was implemented in this session

### 1) Added a “definition redirect” path for muncher stubs

Files changed:
- `lmlevelinfo/map16_reader.h`
- `lmlevelinfo/map16_reader.c`
- `lmlevelinfo/level_visual.c`

Changes:
- Added `MAP16_SRC_DEF_REDIRECT` and a `Map16Data.muncher_full_quad_index`.
- On `map16_load_file`, we now **scan the Map16 file** once to find a tile that has all locals `{0x5C,0x5D,0x5E,0x5F}` on page 0 (prefer pal 6 if available) and store that index.
- In `map16_get_with_src`, before returning “raw file slot”, we check for:
  - `tile_id == 0x04BD` or `0x04BE`, or
  - `tile_id == 0x012F` when raw is empty, or
  - any page≥2 `0x??BD/0x??BE` whose raw slot matches a **partial stub detector**
  - …and then return the stored full quad as `src=def_redirect`.
- For `0x04BE`, we **preserve h/v flip bits** from the stub by copying the `0x0C00` bits per corner.

This produces the desired probe behavior:
- `LV_PROBE id=0x04BD resolved src=def_redirect sub=(0x05E,0x05C,0x05F,0x05D)`

### 2) Hardened tests to prevent regression back to half-stub

File changed:
- `lmlevelinfo/test_runner.c`

Changes:
- Updated Map16 tests for `0x04BD`, `0x04BE`, and `0x012F` to require the resolved tile contains **all** of `0x5C–0x5F` on page 0 (not merely “>=3 muncher-ish locals”).

### 3) Updated golden hash for visual smoke

File changed:
- `lmlevelinfo/test/akogare/golden/level109.ppm.sha256`

Reason:
- The visual smoke test compares a `level_visual_smoke.ppm` sha256 against this golden file when `LEVEL_VISUAL_GOLDEN=1`.
- Since the muncher pixels changed (intentionally), the golden hash had to be regenerated to make tests pass.

### 4) Documentation updates

- `lmlevelinfo/test/README.md` updated to document the `4bd.map16` ground truth and the `0x04BD` stub vs `0x04D2` full quad relationship.
- `docs/CHANGELOG.md` appended a one-line note about the muncher redirect + golden update.

## Repro / verification commands (known-good now)

From `lmlevelinfo/`:

```bash
make
./levelinfo_tests
```

Probe `0x04BD`:

```bash
./level_visual test/akogare/orig_Ako.sfc 0x109 \
  --map16=test/akogare/AllMap16.map16 \
  --gfx-route-mode=bypass \
  --layers=layer1 --report \
  --map16-probe-id=0x04BD --map16-probe-ppm=test/_work/akogare/probe_4bd.ppm \
  2>test/_work/akogare/probe_4bd.stderr
```

Expected in stderr:
- `LV_PROBE ... resolved src=def_redirect ...` (not `src=file`)

## Why the current approach “feels wrong” (and what to do instead)

Your critique is valid: the current code is “muncher-specific” in multiple ways:
- Special-cases `tile_id` values (`0x04BD`, `0x04BE`, `0x012F`).
- Detects a particular stub shape (`0x78/0x7C` + `0x4C–0x4F` mix).
- Scans for a particular full quad (`0x5C–0x5F`).

This fixed the immediate correctness issue for akogare munchers, but it is **not a general solution** for LM definition indirections.

### Recommended refactor: general “Map16 definition redirect” support

Replace the current muncher-specific mechanism with a generic redirect pipeline:

1. **Build a redirect map** during `map16_load_file`:
   - Inputs could be any of:
     - LM page text exports in `resources/all_map16/.../page_XX.txt` (parse `AAAA: BBBB { ... }` lines).
     - A compact redirect sidecar file (e.g. `AllMap16.redirects.txt`).
     - Or (least desirable) heuristic detection of stubs + best-match search.
2. When `map16_get_with_src(tile_id)` is called:
   - If `tile_id` exists in redirect map, resolve to the **definition target**.
3. Resolve definition target by **content**, not by “tile_id happens to exist elsewhere”:
   - If the definition id (`BBBB`) is empty in the bulk file, search for a tile whose 4 subtiles match the definition’s expected locals/props as reported by LM text export.
4. Track provenance with a non-hardcoded source label:
   - Keep `MAP16_SRC_DEF_REDIRECT`, but make it apply to any redirect entry, not munchers only.

For akogare, this would mean:
- `redirect[0x04BD] = 0x012F`, `redirect[0x04BE] = 0x012F`
- Then “definition resolution” finds the full quad at `0x04D2` by matching `0x5C/0x5E/0x5D/0x5F` and palette 6.

This makes the renderer behave more like LM *without embedding hack-specific ids*.

## The bigger unresolved issue: “Layer1 tile rendering still not working”

This session **only** fixed the specific “`0x04BD` looks half” problem; it did **not** solve general Layer1 rendering parity.

Important notes for whoever continues:

- The current renderer draws Layer1 primarily from the **object stream** (LM std objects including `0x27/0x29` direct Map16). If the hack’s Layer1 is not fully representable via the object stream we decode, parity will remain low.
- The test output still shows low similarity and coverage (these are logged as NOTE-level today), indicating major remaining differences:
  - `lm_similarity` remains around ~0.466 and nonbg around ~0.213 in the current baseline.

### Concrete next investigation steps (for a new session)

1. **Clarify what “Layer1 tile rendering” means in this context**
   - Does the user mean LM’s *final layer1 tilemap* (post object processing), rather than objects?
   - If yes, we likely need to **produce the final tilemap** the same way the game/LM does, not just emit objects.
2. **Determine whether the ROM has a prebuilt Layer1 tilemap**
   - Many SMW levels are object-driven; if the hack uses custom systems, there may be additional data sources.
3. **Instrument what is actually being drawn**
   - Extend `--report` to print top Map16 ids, plus counts of `src=def_redirect` usage, plus unresolved/stub usage rates.
4. **Replace more LM stubs generally**
   - Munchers are likely not the only place LM uses indirection; until definition redirects are generalized, other tiles may silently remain “stubby”.

## Files changed (the ones that matter)

- `lmlevelinfo/map16_reader.h`
- `lmlevelinfo/map16_reader.c`
- `lmlevelinfo/level_visual.c`
- `lmlevelinfo/test_runner.c`
- `lmlevelinfo/test/README.md`
- `lmlevelinfo/test/akogare/golden/level109.ppm.sha256`
- `docs/CHANGELOG.md`

## Workspace hygiene notes (for the next session)

The repository currently has a lot of untracked files unrelated to this work (logs, dumps, build outputs, etc.). For reviewability:
- Focus on `git diff` for the files listed above.
- Consider adding/using a `.gitignore` for local scratch artifacts under `lmlevelinfo/test/_work/` (some already exist) and for ad-hoc logs in `lmlevelinfo/`.

## Summary

- **Fixed**: Map16 `0x04BD`/`0x04BE` now resolve to a full muncher quad in probes and renders, using `4bd.map16` as evidence.
- **But**: The current implementation is **too specific** (muncher-centric) and should be replaced with a **general Map16 definition redirect** mechanism.
- **Still open**: The user’s primary objective (“Layer1 tile rendering still not working”) likely requires a deeper change than Map16 stub redirecting: either missing decode coverage or a need to render from the final tilemap rather than only the object stream.

