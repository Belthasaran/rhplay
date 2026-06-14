# GFX muncher CHR probe findings (level 109 / 0x04BD)

Date: 2026-06-13. Tool: `lmlevelinfo/gfx_chr_probe` (scan all preload GFX files vs LM ref at tile 74,22).

## Map16 sources (akogare FG_pages)

| Index | Acts-like | Oracle CHR | Notes |
|-------|-----------|------------|-------|
| `0x04BD` placement | `012F` | `05C 05E 05D 05F` pal 6 | LM L1 export visual |
| `0x04D2` pool (+21) | `0130` | `186 180 193 183` pal 2, `-y-` | LM editor pool / extended |
| `0x04D2` binary | — | `0x185C 0x185E 0x185D 0x185F` | page 1 (SP2), locals 0x5C–0x5F, vflip |

Pool extended CHR and placement vanilla CHR **scan to identical GFX locations** when searching all preload files.

## Level 109 GFX route (bypass)

| Map16 page | Bypass file | Vanilla file |
|------------|-------------|--------------|
| p0 SP1 | `0x14` | `0x14` |
| p1 SP2 | `0x17` | `0x17` |
| p2 FG1 | `0x14` | `0x1B` |
| p3 FG2 | `0x17` | `0x17` |

Notable slots: **BG1 → `0x1B`**, **LG3 → `0x2A`**, FG3 → `0x15`.

## Current routing vs ground truth (per sub, pal row 6)

| Sub | Oracle CHR | Vanilla CHR | **Wrong** bypass route | **Scan-best** file:local (flips) |
|-----|------------|-------------|------------------------|----------------------------------|
| TL | `0x186` | `0x05C` | `0x17:0x006` diff ~45 | **`0x1B:0x000` vf** diff 38 |
| BL | `0x180` | `0x05E` | `0x17:0x000` diff ~52 | **`0x1B:0x004`** diff 37 |
| TR | `0x193` | `0x05D` | `0x17:0x013` diff ~44 | **`0x2A:0x017` vf** diff 42 |
| BR | `0x183` | `0x05F` | `0x17:0x003` diff ~53 | **`0x1B:0x004` hf** diff 38 |

Also tested and rejected:

- LM linear page bits → slot file with full-byte local (same as page-bit route for these CHR).
- Slot2 route (`hi + GFX_SLOT_BG2`, e.g. `0x186` → FG3 `0x15`) — worse diffs.
- Vanilla page-2 tile8 `0x25C–0x25F` on file `0x1B` — worse diffs.
- Bypass SP1/SP2 at Map16 locals `0x5C` — 64 opaque px but **wrong pattern** (not ref art).

## Root causes

1. **Map16 resolve**: Pool `+21` extended oracle (`0x186`, acts-like `0130`) was used for render; LM ref uses **placement oracle** (`0x05C`, acts-like `012F`, pal 6). Fixed: prefer placement FG oracle when present.

2. **GFX file selection**: `gfx_route_resolve_subtile` / `gfx_route_resolve_lm_oracle_chr` map CHR page bits → bypass page files (`0x14`/`0x17`). Customized muncher art lives in **BG1 (`0x1B`) and LG3 (`0x2A`)**, not those page files at the routed locals.

3. **Tile index**: `decode_gfx_subtile` did not call `gfx_local_tile_index` (sprite path already did). Fixed.

4. **Open**: General rule from CHR / acts-like → `{file, local, flips}` without per-tile scan. Extended CHR `0x100–0x1EF` is LM 8x8 index range, not a reliable direct map to bypass page file + `& 0x7F` local for customized tiles.

## Commands

```bash
cd lmlevelinfo
make gfx-probe && ./gfx_chr_probe
./level_visual test/akogare/orig_Ako.sfc 0x109 --map16=test/akogare/AllMap16.map16 \
  --map16-probe-id=0x04BD --gfx-route-mode=bypass --layers=layer1
# Expect: resolved sub=(0x05C,0x05E,0x05D,0x05F) not 0x186...
```

## Next step for GFX routing

Derive CHR → file from LM slot layout (which GFX files are loaded and in what order in the 8x8 selector), or acts-like template id (`012F` vs `0130`) + CHR, using `gfx_chr_probe` scan results as regression oracle for `0x04BD` subs until the rule is known.
