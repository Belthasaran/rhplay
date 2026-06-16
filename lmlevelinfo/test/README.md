# lmlevelinfo tests

This directory holds fixtures exported from Lunar Magic and the associated regression tests for `lmlevelinfo/level_info1`.

## Run

From `lmlevelinfo/`:

```bash
make
./levelinfo_tests
```

## Fixture resources layout (new)

Many suites now include a `resources/` subfolder with additional Lunar Magic exports and patch deltas:

- `test/<suite>/resources/levels/`: MWL exports for levels in that hack (authoritative MWL location going forward)
- `test/<suite>/resources/*.bps`: delta patches intended to be applied to a clean base ROM to produce a suite ROM
- other exports (optional): `*.map16`, `*.pal`, etc.

### Base ROM + BPS workflow used by tests

`levelinfo_tests` can build per-suite ROM work copies under `test/_work/<suite>/<suite>.sfc` by:

- copying a clean base ROM from `PATH_BASE_ROM`
- applying the main hack patch `test/<suite>/<suite>.bps` using `flips`

Environment variables:

- `PATH_BASE_ROM`: **required** for the BPS-based suite workflow. Should point to a clean SMW base ROM.
  - Supported base sizes:
    - unheadered `0x80000` (preferred)
    - headered `0x80200` (tests will skip the 0x200-byte header)
    - expanded ROMs larger than `0x80000` (tests will use the first `0x80000` bytes)
- `FLIPS_PATH` (optional): override the `flips` executable path used to apply `.bps` patches. Default is `flips`.

## `level_visual` smoke (optional)

When `PATH_BASE_ROM` is set and the akogare suite can apply `test/akogare/akogare.bps`, the test runner also executes `./level_visual` against the built work ROM (level `0x109`) with `--stats` and checks:

- PPM begins with `P6`, width **3840** (15 screens), and non-zero height
- Drawn content spans the level: **x_max >= 3000** and non-background pixel ratio **>= 20%** (uses `LV_REPORT back_rgb` from `--report`; **0.32** is logged as aspirational toward LM ~49%)
- `run_level_visual_lm_compare`: logs **full-pixel** similarity vs `test/akogare/lm_Level109.ppm` (in-game LM export; no green-pixel skip)
- `run_sprite_render_sanity`: `--layers=sprites` draws akogare 0x109 sprites (`LV_SPRITE_STATS`)
- `LV_STATS` reports `handled>=1`, at least **40%** coverage of visual objects (`visual_total`, excluding screen jumps/LM bypass), and `gfx_miss/subtiles < 25%` when enough subtiles are drawn. `LV_GFX_MISS_REASON` breaks down load vs tile-index failures.
- `run_screen_assign_sanity`: synthetic `new_screen` stream assigns `screen_number` and emit uses `screen*16+x`

Requires `test/akogare/AllMap16.map16` in the tree.

### Golden PPM hash (optional)

Set `LEVEL_VISUAL_GOLDEN=1` to compare the smoke PPM SHA-256 against `test/akogare/golden/level109.ppm.sha256`. See [`test/akogare/golden/README.txt`](akogare/golden/README.txt) to regenerate the golden hash after intentional visual changes.

## Visual coverage / object emit (synthetic)

`run_lm_object_decode_sanity` includes synthetic **0x0D cement** generic-fill emit checks (6 tiles, Map16 `0x130` corner) in addition to LM `0x22` multi-tile stride tests.

## GFX route (optional)

When `PATH_BASE_ROM` is set, `run_gfx_route_slot_test` prints the `0x109` bypass manifest and validates page GFX files load; `run_gfx_tile_index_sanity` checks tile 0 / last-tile decode per page.

GFX decode uses the low **7 bits** of the Map16 subtile word (128 tiles per GFX file). Slot u16 low byte `0x7F` is treated as unused (vanilla fallback). Bypass slot values **&lt; 0x10** (e.g. SP2 `0x0001`) map to the **vanilla tileset** file for that Map16 page, not literal GFX01.

## Screen index and Layer2 repeat (increment 4–6)

Object streams assign a cumulative horizontal screen in parse order (`level_assign_object_screens`): ext `0x01`/`0x03` set the running screen; `new_screen` advances before the next object; emit/draw use `screen_number * 16 + x_position`.

`level_visual` repeats the first **32 tiles (512px)** of Layer2 across the canvas width only when Layer2 is a **bg tilemap** (`layer2_is_bg_tilemap`). **Object-based Layer2** (e.g. akogare 0x109) does not use strip repeat — screen-placed objects provide full-width hills/clouds without duplicating a partial strip.

## L1 FG palette + LM compare (increment 11)

Increment 11 remaps **Layer1** Map16 palette indices 0–3 to **FG rows 4–7** in `pal256` (header `fg_palette` is already baked into those rows). Layer2 still uses `bg_palette_row` for pal 0–3. **`--export-diff-stats` and `lm_similarity` compare every pixel** in `lm_Level109.ppm` — bright green pipes and sprite tiles are level art, not editor markers.

Sprites: `sprite_palette & 7`, `gfx_route_file_for_sprite_slot_mode` respects `--gfx-route-mode`; `LV_REPORT_SPRITE` / `LV_REPORT_PAL_ROW layer=sprites` with `--report`. `run_l1_palette_remap_sanity` unit test.

Inc11 NOTES: lm_similarity **≥0.45** baseline (full compare), stretch **≥0.55** after palette fix.

## L1 Map16 ROM-default + visual def pool (increment 18)

Layer 1 terrain is drawn from the **object stream** (including LM std `0x27`/`0x29` direct Map16); there is no separate L1 tilemap pass.

**Sources:** `level_visual ROM LEVEL` loads Map16 from the **ROM** by default (`map16_load_from_rom`). Optional `--map16=AllMap16.map16` **merges** drawable LM16 export slots over ROM placement stubs. When merging, **`test/<suite>/resources/all_map16/global_pages/FG_pages/page_*.txt`** are loaded automatically (or via `--map16-fg-oracles=` / `MAP16_FG_ORACLE_DIR`) and override CHR resolve for visual render — raw AllMap16 words are often placement indices, not LM draw subs.

**Acts-like vs CHR:** ROM acts-like (`$06F624`, e.g. akogare `0x04BD → 0x012F`) is **behavior only**. Visual blocks use 8-byte Map16 words; hack **placement** rows are often `0x1004` stubs. `map16_get` applies **visual def_redirect** (`+21` pool, nearest full muncher quad, merged file CHR) before returning raw stubs.

**Resolve policy:** **FG_pages oracle** (when present) → placement-id FG oracle for **page ≥2 placement stubs** → def_redirect pool file → if oracle is a **turn-block template** but file has **extended CHR** (hill `0x03BA`), prefer file → **page 0–1** alias / ROM vanilla / canonical → synth. Muncher GFX uses acts-like `0x012F` template route, not pool `+21` extended CHR.

```bash
./level_visual test/akogare/orig_Ako.sfc 0x109 --map16=test/akogare/AllMap16.map16 \
  --map16-probe-id=0x04BD --map16-probe-ppm=probe_4bd.ppm
./level_visual test/akogare/orig_Ako.sfc 0x109 --map16-probe-id=0x03BE
```

Akogare: file index **`0x04BD`** is a placement stub; visual uses placement FG oracle (`0x05C` pal 6) with acts-like **`0x012F`** GFX template. Pipe **`0x03BE`** uses cap subs `0x10/0x00/0x11/0x01`. `./levelinfo_tests` includes `map16_rom_def_redirect`. Regen golden: `LEVEL_VISUAL_GOLDEN=1 ./levelinfo_tests`.

## L1 tile oracle + LM gridlines (increment 19)

Strict **16×16 tile** comparison vs Lunar Magic exports (exact RGB per pixel). Canvas for akogare 0x109 must be **3840×432** (15 screens × 256px, 27 rows × 16px) — same as LM.

**Reference PPMs (akogare):**

| File | Use |
|------|-----|
| `test/akogare/Level109_l1only_gridlines.ppm` | **L1 strict gate** — Layer 1 only + white gridlines |
| `test/akogare/lm_level109_gridlines.ppm` | Full LM view + gridlines (L2/entrances; future) |
| `test/akogare/lm_Level109.ppm` | In-game export without gridlines (loose `similarity_32` only) |

LM gridlines: RGB **(206, 200, 204)** on pixels where **`x % 16 == 15`** or **`y % 16 == 15`**.

```bash
./level_visual test/akogare/orig_Ako.sfc 0x109 \
  --map16=test/akogare/AllMap16.map16 \
  --export-ppm=out.ppm --layers=layer1 --gfx-route-mode=bypass \
  --export-gridlines \
  --lm-tile-ref=test/akogare/Level109_l1only_gridlines.ppm
```

- `--lm-tile-ref` → exit **1** on dimension mismatch or any tile mismatch; stderr: `LV_TILE_CMP` / `LV_TILE_MISMATCH tx=… ty=…`
- Optional `--lm-tile-mismatch-ppm=diff.ppm` — red pixels where tiles differ
- `./levelinfo_tests` runs `level_visual_tile_compare_l1` (**6480** tiles at 3840×432; **100%** match required; fails until rendering matches LM)

## Map16 block shape fidelity (increment 15)

Increment 15 fixes **16×16 block geometry** (not palette): synth tile8 uses GFX page bits 8–9; resolve order is **file → ROM vanilla (shape-validated) → canonical file index → alias → ROM custom → synth**; pipe blocks reject 2-tile checker repeats; `--map16-probe-id=0x0133` dumps resolve path and writes a 16×16 probe PPM.

```bash
./level_visual orig_Ako.sfc 0x109 --map16=test/akogare/AllMap16.map16 \
  --map16-probe-id=0x0133 --map16-probe-ppm=probe.ppm --gfx-route-mode=bypass
```

## Map16 alias GFX page (increment 14)

Increment 14 aligns alias scoring with GFX routing: Map16 **bits 8–9** select SP1/SP2/FG1/FG2 (not bit 7). All alias candidates must have every non-zero sub on the id’s GFX page. Page-0 `0x0002` rejects candidates with ≥3 subs at local tile `0x02`. `--report` adds `alias_idx=0xXXXX` when `src=alias`.

Inc14 audit: `0x0133` subs all `page=1` / `file=0x17`; `0x006F` all `page=0`; `0x0002` at most two subs with `local=0x02`.

## Hack Map16 resolve + pipes (increment 13)

Increment 13 stops **ROM vanilla** from replacing page-0 AllMap16 slots (e.g. `0x0002` StdObj01 generic fill — was drawing vanilla SMW block geometry with wrong GFX pages). Resolve order: **file → alias → ROM custom → ROM vanilla (page-1 only, GFX-page validated) → synth**. Layer2 draws clamp palette to BG row (`pal & 3` → `bg_palette`). `--report` adds `LV_REPORT_EMIT_OBJ` for pipe std objects (`0x0F`/`0x10`/`0x1F`) and audits pipe Map16 ids (`0x0133`…).

```bash
./level_visual orig_Ako.sfc 0x109 --map16=test/akogare/AllMap16.map16 --export-ppm=out.ppm \
  --gfx-route-mode=bypass --layers=layer1 --report   # pipe-only check
```

Inc13: expect `0x0002` `src=alias`, page-0 subtiles, `map16_rom_vanilla_hits` near 0 on akogare 0x109.

## Map16 shape fidelity (increment 12)

Increment 12 fixes degenerate Map16 **block geometry** (e.g. `0x0002` aliased to four identical `0x082` subs): resolve order is **file → ROM vanilla (page≤1, partial/degenerate raw only) → alias → ROM custom → synth** (fully empty slots such as `0x0021` still use alias). Alias candidates must not be uniform 4-sub tiles unless the raw slot is too; partial raw slots with ≥2 distinct `tile8` require a diverse alias target. Block audit adds `src=file|alias|rom|rom_van|synth`.

**LM compare and smoke tests use `--gfx-route-mode=bypass`** (matches LM ExGFX routing; vanilla differs on FG pages 2–3).

```bash
./level_visual orig_Ako.sfc 0x109 --map16=test/akogare/AllMap16.map16 --export-ppm=out.ppm \
  --gfx-route-mode=bypass --layers=all --report \
  --export-diff-stats --lm-ref=test/akogare/lm_Level109.ppm
# Expect map16_rom_vanilla_hits>0, 0x0002 block with src=rom_van and >=2 distinct tile8
```

Inc12 NOTES: lm_similarity stretch **≥0.55** with bypass + ROM vanilla shapes.

## Map16 alias + ROM + L2 palette (increment 10)

Increment 10 tightens alias matching (degenerate `0x0002`-style slots, tiered page-0 exact-low byte, threshold 4), skips the **8-byte LM16** header when loading `AllMap16.map16`, adds **ROM vanilla Map16** for pages 0–1, **page-aware synth** for page-1 ids, and **Layer2 palette remap** to the level `bg_palette` row. Diagnostics: `--map16-synth-debug`, `LV_REPORT map16_rom_vanilla_hits`, `LV_DIFF_STATS tan_miss_pct`.

## Map16 alias lookup + ROM fallback (increment 9)

`AllMap16.map16` is indexed by **flat file position** (`tile_id` = export index). Vanilla-low ids (e.g. `0x0021`) are often **empty** at that index while the real 16×16 block lives elsewhere (e.g. index `0x502` = subtiles `0x20/0x20/0x21/0x21`).

At load, `map16_load_file` builds an **alias table**: for each empty/placeholder slot, scan the file for the best matching block for `(page, low)` and store `alias_index[tile_id]`. Resolve order updated in increment 12 (see above).

```bash
./level_visual orig_Ako.sfc 0x109 --map16=test/akogare/AllMap16.map16 --export-ppm=out.ppm \
  --gfx-route-mode=bypass --layers=all --report
# LV_REPORT map16_alias_hits=N map16_rom_vanilla_hits=M map16_synth_fallback=K
# LV_REPORT_MAP16_BLOCK ... id=0x0021 ... src=alias tile8=0x020/0x021
```

`--map16-alias-debug` logs sample alias mappings. `--no-map16-synth-vanilla` disables only the last-resort 4× identical subtile fallback.

Inc9 targets (NOTES in tests): nonbg **≥0.30** (stretch **0.35**), lm_similarity **≥0.52** (stretch **0.55**); hard floor nonbg **≥0.19**.

## Map16 empty-slot synthesis (increment 8)

When alias and ROM lookup both fail, `map16_get` (default on) builds a 4-subtile block from the tile id low byte on **page 0 CHR** (last resort).

Extended generic emit uses snesrev page rule: ext `0x13–0x50` → Map16 page 1, `0x51–0x6A` → page 0.

## CHR / palette parity (increment 7)

`--report` (with optional `--map16-audit`) logs top Map16 ids plus **subtile audit** for the top 3 blocks per layer (`LV_REPORT_MAP16_BLOCK`), GFX file usage (`LV_REPORT_GFX_FILE`), and palette rows (`LV_REPORT_PAL_ROW`).

GFX routing experiments:

```bash
./level_visual orig_Ako.sfc 0x109 --map16=test/akogare/AllMap16.map16 --export-ppm=out_bypass.ppm --gfx-route-mode=bypass --report
./level_visual orig_Ako.sfc 0x109 --map16=test/akogare/AllMap16.map16 --export-ppm=out_vanilla.ppm --gfx-route-mode=vanilla --report
./level_visual orig_Ako.sfc 0x109 --map16=test/akogare/AllMap16.map16 --export-ppm=out_tryboth.ppm --gfx-route-mode=try-both --report
```

Compare to LM (use **bypass**, not vanilla):

```bash
./level_visual orig_Ako.sfc 0x109 --map16=test/akogare/AllMap16.map16 --export-ppm=out.ppm --layers=all \
  --gfx-route-mode=bypass --export-diff-stats --lm-ref=test/akogare/lm_Level109.ppm --report --stats 2>&1 | tee lv109.txt
```

`--emit-histogram` on layer2 also prints `LV_HIST_OBJ` (object id counts). Inc7 targets: nonbg **≥0.25**, lm_similarity **≥0.55** (logged as NOTES until routing improves).

## Layer2 cloud emit and sprites (increment 6)

Extended objects `0x68`/`0x6B` and grass std `0x3D`/`0x3E` (tileset 7) emit snesrev cloud-fringe Map16 lows (`0x91+` on page 0). Extended `0x51–0x6A` use page-0 cloud tile tables (not page-1 `0x3f` cement).

Sprites: known ids use snesrev tile/prop tables; **unknown ids are not drawn** (no generic `(id*3)&0x7F` blit). Use `--sprite-debug` only for our debug overlay (not present in LM `lm_Level109.ppm`). `LV_REPORT_SPRITE_UNKNOWN` lines with `--report`.

Synthetic tests: `ext68_cloud_emit`, `sprite_no_generic_fallback`.

## Sprites (increment 5)

`--layers=all` includes a sprite GFX pass after Layer1 (ROM mode). Uses ExGFX bypass SP1–SP4 slots and sprite palette rows 8–11. `--sprite-debug` draws green markers for sprite ids without a tile table entry.

## Visual validation (akogare 0x109)

Compare against Lunar Magic export (`test/akogare/lm_Level109.ppm` or `lm_Level109.png`):

```bash
cd lmlevelinfo
./level_info1 test/akogare/orig_Ako.sfc 0x109 --report --dump-palette 2>&1 | tee /tmp/li109.txt
./level_visual test/akogare/orig_Ako.sfc 0x109 --map16=test/akogare/AllMap16.map16 \
  --export-ppm=out.ppm --layers=all --stats --report --gfx-debug 2>&1 | tee /tmp/lv109.txt
```

Expect: `palette_source=custom`, `layer2=objects`, `canvas_screens=15` (3840px wide), `page=1 file=0x17`, `unknown=0`.

## ROM / Map16 alignment

Use the **same ROM** as the `AllMap16.map16` export (e.g. `orig_Ako.sfc` or BPS-built `test/_work/akogare/akogare.sfc`). Mismatch causes correct Map16 lookup with wrong GFX colors/tiles.

## Layer1 LM decode

Layer1 objects are parsed via `parse_objects_from_buf` (same path as Layer2) so LM `0x27`/`0x29` direct-Map16 records populate `LevelObject.decoded` for emit.

## What is asserted (v1)

Using `test/akogare/ako_Level109.mwl` and `test/akogare/orig_Ako.sfc`:

- **Primary header**: byte-for-byte equality (first 5 bytes of Layer 1 payload).
- **Secondary header b1..b4**: ROM table bytes match MWL Level Information bytes.
- **Secondary header optional bytes b5..b8**: compared only for MWLs that report an LM version \(\(\le\) 2.53\) where the classic layout is expected to match the MWL v2.53 doc.
- **Layer 1 objects**: normalized object list matches, including **screen exits**.
- **Sprite data**: sprite header byte matches, and a normalized sprite list matches (order-insensitive), including any LM per-sprite extension bytes when enabled by the ROM.
- **LM object decoding**: an internal sanity test feeds synthetic Layer1 buffers covering LM standard objects `0x22`–`0x24`, `0x25`, `0x26`, `0x27` (modes 0–1), `0x28`, `0x29` (mode 0), `0x2D`, extended `0x03` (screen jump), plus a two-object stream. It asserts `LevelObject.decoded` is populated so decode logic stays exercised even when fixtures omit those objects.

## QuickieWorld suite

Fixtures under `test/quickieworld/` include `QuickieWorld_v1.12.sfc` and multiple MWL exports named `quick <LEVEL>.mwl`.
`levelinfo_tests` automatically discovers and runs all of them.

## Teamaat suite

Fixtures under `test/teamaat/` include `teamaat.sfc` and multiple MWL exports named `teamaat <LEVEL>.mwl`.
`levelinfo_tests` automatically discovers and runs all of them.

## Acidtapes suite

Fixtures under `test/acidtapes/` include `acidtapes.sfc` and multiple MWL exports named `acidtapes <LEVEL>.mwl`.
`levelinfo_tests` automatically discovers and runs all of them.

## Map16 text export parity (Callisto-aligned)

Suites with `test/<suite>/resources/all_map16/` (and optional `test/<suite>/AllMap16.map16`) are checked by tiered gates in `./levelinfo_tests`:

| Tier | Env / trigger | What it checks |
|------|----------------|----------------|
| A (default CI) | always | `map16_text_parse_unit`, `map16_text_header_parity`, `map16_text_akogare_spot` (`0x04BD`, `0x04D2`, pipe cap, …) |
| B (thorough) | `MAP16_PARITY_THOROUGH=1` | Every non-`~` line in FG/BG/tileset_group/pipe text vs `AllMap16.map16` when present |
| C | always (akogare) | `map16_resolve_vs_text_oracle` — `map16_get_with_src` CHR/pal/flips vs FG_pages full lines |
| D | always (akogare) | `map16_gfx_muncher_regression` — bypass GFX route vs scan-best manifest (`0x1B`/`0x2A`); **fails until GFX routing lands** |

Binary oracle today: **akogare** [`test/akogare/AllMap16.map16`](akogare/AllMap16.map16). Other suites run parse/self-consistency only until a matching binary is added.

Local debug tool:

```bash
make map16-parity
./map16-parity test/akogare/resources/all_map16 test/akogare/AllMap16.map16
MAP16_PARITY_THOROUGH=1 ./map16-parity --thorough test/akogare/resources/all_map16 test/akogare/AllMap16.map16
```

## Not asserted yet (planned expansion)

- Optional/newer LM secondary bytes (b5..b8) for newer LM exports: still **not asserted** yet; assertions are gated to classic MWL layouts until a reliable per-version mapping is confirmed.
- Layer 2 tile contents (beyond basic dimension/format checks), full palette parity (including non-custom palettes), and strict MWL-vs-ROM equality for some newer MWL sections (secondary entrances / ExAnimation / ExGFX-bypass) where header semantics still vary across hacks.

