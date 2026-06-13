#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>

#include "romutil.h"
#include "lm_tables.h"
#include "level_parse.h"
#include "mwl_reader.h"
#include "map16_reader.h"
#include "map16_fg_oracle.h"
#include "map16_rom.h"
#include "gfx_reader.h"
#include "obj_to_map16.h"
#include "gfx_route.h"
#include "palette_rom.h"
#include "emit_stats.h"
#include "sprite_draw.h"
#include "lv_ppm_compare.h"

static void usage(const char *argv0) {
  fprintf(stderr,
          "usage:\n"
          "  %s <ROMFILE> <LEVEL_ID> --export-ppm=<OUT.ppm> [--map16=<AllMap16.map16>] [--suite=<NAME>] [--layers=all|layer1|layer2] [--stats]\n"
          "  %s --mwl <LEVEL.mwl> --export-ppm=<OUT.ppm> [--map16=<AllMap16.map16>] [--layers=all|layer1|layer2] [--stats]\n"
          "\n"
          "notes:\n"
          "  - PNG/APNG/WebP/GIF output is not implemented yet. Use --export-ppm.\n"
          "  - --stats prints LV_STATS line to stderr (handled/unknown/gfx_miss).\n"
          "  - --emit-histogram prints top unknown object ids before rendering.\n"
          "  - --gfx-debug prints per-page GFX routing and miss breakdown after render.\n"
          "  - --report prints palette/layer2/canvas/GFX manifest, top Map16 ids, block audit (stderr).\n"
          "  - --map16-audit with --report dumps subtile/GFX details for top Map16 blocks.\n"
          "  - --palette-debug dumps palette rows 0-15; --palette-debug-ppm=<FILE> exports strip.\n"
          "  - --gfx-route-mode=bypass|vanilla|try-both (default bypass).\n"
          "  - --export-diff-stats compares OUT.ppm to --lm-ref=<FILE> (full pixels; LM is in-game ground truth).\n"
          "  - --export-gridlines draws LM-style white gridlines (RGB 206,200,204 at x%%16==15, y%%16==15).\n"
          "  - --lm-tile-ref=<FILE> strict 16x16 tile compare vs ref; exit 1 on size mismatch or any tile diff.\n"
          "  - --lm-tile-mismatch-ppm=<FILE> optional diff heatmap when --lm-tile-ref fails.\n"
          "  - --layers=all|layer1|layer2|sprites (sprites included in all).\n"
          "  - --sprite-debug draws green markers for unknown sprite ids only in our output (not in LM ref).\n"
          "  - --map16-synth-vanilla fills empty AllMap16 export slots from tile id (default on).\n"
          "  - --no-map16-synth-vanilla disables empty-slot synthesis.\n"
          "  - --map16-alias-debug logs top alias (tile_id -> file index) mappings to stderr.\n"
          "  - --map16-probe-id=0xNNNN dumps resolve path and optional 16x16 --map16-probe-ppm=probe.ppm\n"
          "  - --map16-synth-debug logs top Map16 ids resolved via synthesis fallback.\n",
          argv0 ? argv0 : "level_visual",
          argv0 ? argv0 : "level_visual");
}

static int parse_level_id(const char *s, uint16_t *out) {
  if (!s || !out) return 0;
  while (*s == ' ' || *s == '\t') s++;
  if (s[0] == '0' && (s[1] == 'x' || s[1] == 'X')) s += 2;
  char *ep = NULL;
  unsigned long v = strtoul(s, &ep, 16);
  if (!ep || *ep != '\0') return 0;
  if (v > 0x1FF) return 0;
  *out = (uint16_t)v;
  return 1;
}

static int parse_map16_id(const char *s, uint16_t *out) {
  if (!s || !out) return 0;
  while (*s == ' ' || *s == '\t') s++;
  if (s[0] == '0' && (s[1] == 'x' || s[1] == 'X')) s += 2;
  char *ep = NULL;
  unsigned long v = strtoul(s, &ep, 16);
  if (!ep || *ep != '\0') return 0;
  if (v > 0xFFFFu) return 0;
  *out = (uint16_t)v;
  return 1;
}

static void build_fallback_palette(uint8_t pal256[256][3], uint8_t fg_pal, uint8_t bg_pal, uint8_t sprite_pal) {
  static const uint8_t base8[8][3] = {
      { 200, 200, 200 }, { 220, 120, 120 }, { 120, 220, 120 }, { 120, 160, 240 },
      { 220, 200, 120 }, { 200, 120, 220 }, { 120, 220, 220 }, { 220, 160, 120 },
  };
  uint8_t f = (uint8_t)(fg_pal & 7);
  uint8_t b = (uint8_t)(bg_pal & 7);
  uint8_t s = (uint8_t)(sprite_pal & 7);
  for (int p = 0; p < 16; p++) {
    uint8_t hue = (uint8_t)((p + f + b + (s * 3)) & 7);
    uint8_t br = base8[hue][0], bg = base8[hue][1], bb = base8[hue][2];
    for (int i = 0; i < 16; i++) {
      uint8_t k = (uint8_t)(255u - (uint32_t)i * 10u);
      int idx = p * 16 + i;
      pal256[idx][0] = (uint8_t)((br * k) / 255u);
      pal256[idx][1] = (uint8_t)((bg * k) / 255u);
      pal256[idx][2] = (uint8_t)((bb * k) / 255u);
    }
  }
}

static int write_ppm(const char *path, const uint8_t *rgb, uint32_t w, uint32_t h) {
  if (!path || !rgb || !w || !h) return 0;
  FILE *fp = fopen(path, "wb");
  if (!fp) return 0;
  fprintf(fp, "P6\n%u %u\n255\n", (unsigned)w, (unsigned)h);
  size_t n = (size_t)w * (size_t)h * 3u;
  int ok = (fwrite(rgb, 1, n, fp) == n);
  fclose(fp);
  return ok;
}

static int rgb_is_bg(uint8_t r, uint8_t g, uint8_t b, uint8_t br, uint8_t bg, uint8_t bb, int tol) {
  return abs((int)r - (int)br) <= tol && abs((int)g - (int)bg) <= tol && abs((int)b - (int)bb) <= tol;
}

// SMW/LM Layer2 is 32 tiles (512px) wide; tile horizontally across the level canvas (non-bg pixels only).
static void repeat_layer2_strip_horiz(uint8_t *rgb, uint32_t w, uint32_t h, uint32_t strip_px, uint8_t br, uint8_t bg,
                                      uint8_t bb) {
  if (!rgb || strip_px == 0 || strip_px >= w) return;
  for (uint32_t y = 0; y < h; y++) {
    const uint8_t *row = rgb + (size_t)y * (size_t)w * 3u;
    uint8_t *out_row = rgb + (size_t)y * (size_t)w * 3u;
    for (uint32_t x = strip_px; x < w; x++) {
      uint32_t src_x = x % strip_px;
      size_t di = (size_t)x * 3u;
      size_t si = (size_t)src_x * 3u;
      if (rgb_is_bg(row[si + 0], row[si + 1], row[si + 2], br, bg, bb, 3)) continue;
      out_row[di + 0] = row[si + 0];
      out_row[di + 1] = row[si + 1];
      out_row[di + 2] = row[si + 2];
    }
  }
}

static void draw_missing_tile(uint8_t *rgb, uint32_t w, uint32_t h, uint32_t x0, uint32_t y0, uint32_t s,
                              uint8_t r, uint8_t g, uint8_t b) {
  for (uint32_t yy = 0; yy < s; yy++) {
    uint32_t y = y0 + yy;
    if (y >= h) continue;
    for (uint32_t xx = 0; xx < s; xx++) {
      uint32_t x = x0 + xx;
      if (x >= w) continue;
      uint32_t idx = (y * w + x) * 3u;
      int border = (yy == 0 || xx == 0 || yy + 1 == s || xx + 1 == s);
      int diag = (xx == yy) || (xx + yy + 1 == s);
      if (border || diag) {
        rgb[idx + 0] = r;
        rgb[idx + 1] = g;
        rgb[idx + 2] = b;
      }
    }
  }
}

static void blit_tile8(uint8_t *rgb, uint32_t w, uint32_t h, uint32_t x0, uint32_t y0,
                       const uint8_t px64[64], const uint8_t pal_rgb[16][3], int hflip, int vflip) {
  for (uint32_t yy = 0; yy < 8; yy++) {
    uint32_t y = y0 + yy;
    if (y >= h) continue;
    for (uint32_t xx = 0; xx < 8; xx++) {
      uint32_t x = x0 + xx;
      if (x >= w) continue;
      uint32_t sx = (uint32_t)(hflip ? (7 - (int)xx) : (int)xx);
      uint32_t sy = (uint32_t)(vflip ? (7 - (int)yy) : (int)yy);
      uint8_t c = px64[sy * 8 + sx] & 0x0F;
      if (c == 0) continue;
      uint32_t idx = (y * w + x) * 3u;
      rgb[idx + 0] = pal_rgb[c][0];
      rgb[idx + 1] = pal_rgb[c][1];
      rgb[idx + 2] = pal_rgb[c][2];
    }
  }
}

typedef struct {
  uint32_t map16_id;
  size_t count;
} Map16HistEntry;

typedef struct {
  int gfx_route_mode;
  int map16_audit;
  int map16_synth_debug;
  int is_layer2;
  int custom_palette;
  uint8_t bg_palette_row;
  uint8_t fg_palette_row;
  const char *audit_layer;
  uint8_t *rgb;
  uint32_t W, H;
  Map16Data *map16;
  const uint8_t (*pal256)[3];
  Rom *rom;
  GfxCache *gfxc;
  const LevelGfxRoute *gfx_route;
  ObjectEmitStats *stats;
  Map16HistEntry map16_hist[256];
  size_t map16_hist_n;
  Map16HistEntry map16_synth_hist[256];
  size_t map16_synth_hist_n;
  size_t gfx_file_subtiles[256];
  size_t pal_row_subtiles[8];
  size_t pal_row_oob_count;
  uint8_t back_r;
  uint8_t back_g;
  uint8_t back_b;
  char *err;
  size_t errcap;
} RenderCtx;

typedef struct {
  int gfx_route_mode;
  int map16_audit;
  int map16_synth_vanilla;
  int map16_alias_debug;
  int map16_synth_debug;
  int export_diff_stats;
  int export_gridlines;
  const char *palette_debug_ppm;
  const char *lm_ref_ppm;
  const char *lm_tile_ref_ppm;
  const char *lm_tile_mismatch_ppm;
  const char *map16_fg_oracle_dir;
} LvRenderOpts;

static int parse_gfx_route_mode(const char *s) {
  if (!s || !*s) return GFX_ROUTE_MODE_BYPASS;
  if (strcmp(s, "bypass") == 0) return GFX_ROUTE_MODE_BYPASS;
  if (strcmp(s, "vanilla") == 0) return GFX_ROUTE_MODE_VANILLA;
  if (strcmp(s, "try-both") == 0 || strcmp(s, "try_both") == 0) return GFX_ROUTE_MODE_TRY_BOTH;
  return -1;
}

static int tile_px64_has_opaque(const uint8_t px64[64]) {
  for (int i = 0; i < 64; i++) {
    if ((px64[i] & 0x0F) != 0) return 1;
  }
  return 0;
}

static void map16_hist_bump(RenderCtx *rc, uint16_t map16_id) {
  if (!rc) return;
  for (size_t i = 0; i < rc->map16_hist_n; i++) {
    if (rc->map16_hist[i].map16_id == (uint32_t)map16_id) {
      rc->map16_hist[i].count++;
      return;
    }
  }
  if (rc->map16_hist_n < 256) {
    rc->map16_hist[rc->map16_hist_n].map16_id = map16_id;
    rc->map16_hist[rc->map16_hist_n].count = 1;
    rc->map16_hist_n++;
  }
}

static const char *map16_src_label(int src) {
  switch (src) {
    case MAP16_SRC_FILE:
      return "file";
    case MAP16_SRC_ALIAS:
      return "alias";
    case MAP16_SRC_ROM:
      return "rom";
    case MAP16_SRC_SYNTH:
      return "synth";
    case MAP16_SRC_ROM_VANILLA:
      return "rom_van";
    case MAP16_SRC_CANONICAL:
      return "canonical";
    case MAP16_SRC_DEF_REDIRECT:
      return "def_redirect";
    case MAP16_SRC_FG_ORACLE:
      return "fg_oracle";
    default:
      return "?";
  }
}

static uint8_t map16_effective_palette(uint8_t pal_raw, int is_layer2, int custom_palette,
                                      uint8_t bg_palette_row, uint8_t fg_palette_row) {
  uint8_t pal = (uint8_t)(pal_raw & 7u);
  if (is_layer2) {
    pal = (uint8_t)(pal & 3u);
    return (uint8_t)(bg_palette_row & 7u);
  }
  if (custom_palette) {
    (void)fg_palette_row;
    /* Custom blob stores FG lines in rows 4-7 (header fg_palette already applied). */
    if (pal <= 3u) {
      return (uint8_t)(4u + (pal & 3u));
    }
    return pal;
  }
  /* ROM tables: Map16 pal 0-3 are FG lines stored in pal256 rows 4-7. */
  if (pal <= 3u) {
    return (uint8_t)(4u + (pal & 3u));
  }
  return pal;
}

static void map16_audit_print_block(Map16Data *map16, const LevelGfxRoute *route, int gfx_route_mode,
                                    const char *layer_label, uint16_t map16_id, int is_layer2,
                                    int custom_palette, uint8_t bg_palette_row, uint8_t fg_palette_row) {
  if (!map16 || !layer_label) return;
  Map16Tile raw;
  Map16Tile t;
  if (!map16_get_raw(map16, map16_id, &raw)) {
    fprintf(stderr, "LV_REPORT_MAP16_BLOCK layer=%s id=0x%04X missing\n", layer_label, (unsigned)map16_id);
    return;
  }
  int src = MAP16_SRC_FILE;
  if (!map16_get_with_src(map16, map16_id, &t, &src)) return;
  int synth = (src == MAP16_SRC_SYNTH);
  int alias = (src == MAP16_SRC_ALIAS);
  int rom_fb = (src == MAP16_SRC_ROM || src == MAP16_SRC_ROM_VANILLA);
  int rom_van = (src == MAP16_SRC_ROM_VANILLA);
  size_t alias_idx = SIZE_MAX;
  size_t can_idx = SIZE_MAX;
  int have_alias_idx = alias && map16_get_alias_index(map16, map16_id, &alias_idx);
  int have_can_idx = (src == MAP16_SRC_CANONICAL) && map16_get_canonical_index(map16, map16_id, &can_idx);
  for (int si = 0; si < 4; si++) {
    uint16_t w0 = t.w[si];
    uint16_t tile8 = (uint16_t)(w0 & 0x03FFu);
    uint8_t page = (uint8_t)((tile8 >> 8) & 0x03);
    uint8_t pal_raw = (uint8_t)((w0 >> 13) & 0x7);
    uint8_t eff_pal = map16_effective_palette(pal_raw, is_layer2, custom_palette, bg_palette_row, fg_palette_row);
    uint8_t file_id = 0;
    uint16_t local_tile = 0;
    if (src == MAP16_SRC_FG_ORACLE) {
      gfx_route_resolve_lm_oracle_chr(route, tile8, gfx_route_mode, &file_id, &local_tile);
    } else {
      gfx_route_resolve_subtile(route, tile8, gfx_route_mode, &file_id, &local_tile);
    }
    uint8_t van = route ? gfx_route_vanilla_file_for_page(route, page) : 0;
    if (have_alias_idx || have_can_idx) {
      fprintf(stderr,
              "LV_REPORT_MAP16_BLOCK layer=%s id=0x%04X sub=%d src=%s alias_idx=0x%04zX can_idx=0x%04zX tile8=0x%03X page=%u "
              "pal=%u eff_pal=%u h=%d v=%d file=0x%02X vanilla=0x%02X local=0x%02X synth=%d alias=%d rom=%d rom_van=%d\n",
              layer_label, (unsigned)map16_id, si, map16_src_label(src),
              have_alias_idx ? alias_idx : (size_t)SIZE_MAX, have_can_idx ? can_idx : (size_t)SIZE_MAX,
              (unsigned)tile8, (unsigned)page, (unsigned)pal_raw, (unsigned)eff_pal, (w0 >> 10) & 1, (w0 >> 11) & 1,
              (unsigned)file_id, (unsigned)van, (unsigned)local_tile, synth, alias, rom_fb, rom_van);
    } else {
      fprintf(stderr,
              "LV_REPORT_MAP16_BLOCK layer=%s id=0x%04X sub=%d src=%s tile8=0x%03X page=%u pal=%u eff_pal=%u h=%d v=%d "
              "file=0x%02X vanilla=0x%02X local=0x%02X synth=%d alias=%d rom=%d rom_van=%d\n",
              layer_label, (unsigned)map16_id, si, map16_src_label(src), (unsigned)tile8, (unsigned)page,
              (unsigned)pal_raw, (unsigned)eff_pal, (w0 >> 10) & 1, (w0 >> 11) & 1, (unsigned)file_id,
              (unsigned)van, (unsigned)local_tile, synth, alias, rom_fb, rom_van);
    }
  }
}

static const uint16_t kPipeMap16AuditIds[] = {
    0x0133, 0x0134, 0x0135, 0x0136, 0x0137, 0x0138, 0x0139, 0x013A, 0x013B, 0x013C, 0x013D, 0x013E, 0x013F,
    0x0153, 0x0154, 0x0155,
};

static const uint16_t kMuncherMap16AuditIds[] = { 0x04BD, 0x04BE, 0x012F };

static void map16_audit_ids(RenderCtx *rc, const uint16_t *ids, size_t n_ids) {
  if (!rc || !rc->map16_audit || !rc->map16 || !ids) return;
  const char *layer = rc->audit_layer ? rc->audit_layer : "layer1";
  for (size_t i = 0; i < n_ids; i++) {
    uint16_t pid = ids[i];
    Map16Tile t;
    if (!map16_get(rc->map16, pid, &t) || map16_tile_is_empty(&t)) continue;
    map16_audit_print_block(rc->map16, rc->gfx_route, rc->gfx_route_mode, layer, pid, rc->is_layer2,
                            rc->custom_palette, rc->bg_palette_row, rc->fg_palette_row);
  }
}

static void map16_audit_pipe_blocks(RenderCtx *rc) {
  map16_audit_ids(rc, kPipeMap16AuditIds, sizeof(kPipeMap16AuditIds) / sizeof(kPipeMap16AuditIds[0]));
}

static void map16_audit_muncher_blocks(RenderCtx *rc) {
  map16_audit_ids(rc, kMuncherMap16AuditIds, sizeof(kMuncherMap16AuditIds) / sizeof(kMuncherMap16AuditIds[0]));
}

static void emit_report_pipe_objects(const LevelObject *objects, size_t count) {
  if (!objects) return;
  size_t n0f = 0, n10 = 0, n1f = 0;
  for (size_t i = 0; i < count; i++) {
    if (objects[i].kind != OBJ_STANDARD) continue;
    if (objects[i].object_number == 0x0F) n0f++;
    else if (objects[i].object_number == 0x10) n10++;
    else if (objects[i].object_number == 0x1F) n1f++;
  }
  if (n0f || n10 || n1f) {
    fprintf(stderr, "LV_REPORT_EMIT_OBJ pipe_std id=0x0F count=%zu id=0x10 count=%zu id=0x1F count=%zu\n", n0f,
            n10, n1f);
  }
}

static void emit_report_lm_direct_map16_objects(const LevelObject *objects, size_t count) {
  if (!objects) return;
  size_t n27 = 0, n29 = 0;
  for (size_t i = 0; i < count; i++) {
    if (!objects[i].decoded.present) continue;
    if (objects[i].decoded.kind == OBJ_DEC_LM_27_DIRECT_MAP16_P00_3F) n27++;
    else if (objects[i].decoded.kind == OBJ_DEC_LM_29_DIRECT_MAP16_P40_7F) n29++;
  }
  if (n27 || n29) {
    fprintf(stderr, "LV_REPORT_EMIT_OBJ lm_direct_map16 std_id=0x27 count=%zu std_id=0x29 count=%zu\n", n27, n29);
  }
}

static void map16_hist_print_top(RenderCtx *rc, const char *layer_label, int top_n) {
  if (!rc || !layer_label || top_n <= 0) return;
  for (int out = 0; out < top_n; out++) {
    size_t best = 0;
    size_t best_count = 0;
    for (size_t i = 0; i < rc->map16_hist_n; i++) {
      if (rc->map16_hist[i].count > best_count) {
        best_count = rc->map16_hist[i].count;
        best = i;
      }
    }
    if (best_count == 0) break;
    uint16_t mid = (uint16_t)rc->map16_hist[best].map16_id;
    fprintf(stderr, "LV_REPORT_MAP16_TOP layer=%s rank=%d id=0x%04X count=%zu\n", layer_label, out + 1,
            (unsigned)mid, best_count);
    if (rc->map16_audit && out < 3) {
      map16_audit_print_block(rc->map16, rc->gfx_route, rc->gfx_route_mode, layer_label, mid, rc->is_layer2,
                              rc->custom_palette, rc->bg_palette_row, rc->fg_palette_row);
    }
    rc->map16_hist[best].count = 0;
  }
}

static void gfx_file_hist_print(RenderCtx *rc, const char *layer_label) {
  if (!rc || !layer_label) return;
  for (int out = 0; out < 8; out++) {
    size_t best_f = 0;
    size_t best_n = 0;
    for (size_t f = 0; f < 256; f++) {
      if (rc->gfx_file_subtiles[f] > best_n) {
        best_n = rc->gfx_file_subtiles[f];
        best_f = f;
      }
    }
    if (best_n == 0) break;
    fprintf(stderr, "LV_REPORT_GFX_FILE layer=%s rank=%d file=0x%02X subtiles=%zu\n", layer_label, out + 1,
            (unsigned)best_f, best_n);
    rc->gfx_file_subtiles[best_f] = 0;
  }
}

static void pal_row_hist_print(const RenderCtx *rc, const char *layer_label) {
  if (!rc || !layer_label) return;
  for (int row = 0; row < 8; row++) {
    if (rc->pal_row_subtiles[row]) {
      fprintf(stderr, "LV_REPORT_PAL_ROW layer=%s row=%d subtiles=%zu\n", layer_label, row,
              rc->pal_row_subtiles[row]);
    }
  }
  if (rc->pal_row_oob_count) {
    fprintf(stderr, "LV_REPORT_PAL_ROW layer=%s sprite_row_refs=%zu\n", layer_label, rc->pal_row_oob_count);
  }
}

// 0 = ok, -1 = load fail, -2 = tile index out of range
static int decode_gfx_subtile(Rom *rom, GfxCache *gfxc, const LevelGfxRoute *route, int route_mode, int map16_src,
                              uint16_t tile8, uint8_t file_override, uint8_t out_px64[64], char *err, size_t errcap) {
  const GfxBlob *gfx = NULL;
  uint8_t file_id = 0;
  uint16_t local_tile = 0;
  if (map16_src == MAP16_SRC_FG_ORACLE) {
    gfx_route_resolve_lm_oracle_chr(route, tile8, route_mode, &file_id, &local_tile);
  } else {
    gfx_route_resolve_subtile(route, tile8, route_mode, &file_id, &local_tile);
  }
  if (file_override != 0) file_id = file_override;
  if (!gfxcache_get(rom, gfxc, file_id, &gfx, err, errcap) || !gfx || !gfx->bytes || !gfx->len) {
    return -1;
  }
  if (!snes4bpp_decode_tile(gfx->bytes, gfx->len, local_tile, out_px64)) {
    return -2;
  }
  return 0;
}

static void map16_synth_hist_bump(RenderCtx *rc, uint16_t map16_id) {
  if (!rc) return;
  for (size_t i = 0; i < rc->map16_synth_hist_n; i++) {
    if (rc->map16_synth_hist[i].map16_id == (uint32_t)map16_id) {
      rc->map16_synth_hist[i].count++;
      return;
    }
  }
  if (rc->map16_synth_hist_n < 256) {
    rc->map16_synth_hist[rc->map16_synth_hist_n].map16_id = map16_id;
    rc->map16_synth_hist[rc->map16_synth_hist_n].count = 1;
    rc->map16_synth_hist_n++;
  }
}

static void map16_synth_hist_print_top(RenderCtx *rc, int top_n) {
  if (!rc || top_n <= 0) return;
  fprintf(stderr, "LV_REPORT_MAP16_SYNTH_TOP count=%zu\n", rc->map16->synth_count);
  for (int out = 0; out < top_n; out++) {
    size_t best = 0;
    size_t best_count = 0;
    for (size_t i = 0; i < rc->map16_synth_hist_n; i++) {
      if (rc->map16_synth_hist[i].count > best_count) {
        best_count = rc->map16_synth_hist[i].count;
        best = i;
      }
    }
    if (best_count == 0) break;
    fprintf(stderr, "LV_REPORT_MAP16_SYNTH_TOP rank=%d id=0x%04X count=%zu\n", out + 1,
            (unsigned)rc->map16_synth_hist[best].map16_id, best_count);
    rc->map16_synth_hist[best].count = 0;
  }
}

static uint16_t map16_pipe_body_visual_id(uint16_t map16_id) {
  /* LM static export: stretched pipe shaft rows (03BE..03C9) render the same art as the
   * first body pair 03BC/03BD; -y- / mixed-flip oracle entries encode in-game behavior only. */
  if (map16_id >= 0x03BEu && map16_id <= 0x03C9u) {
    return (uint16_t)(0x03BCu + (map16_id & 1u));
  }
  return map16_id;
}

static int tile_uses_extended_oracle_chr(const Map16Tile *t) {
  if (!t) return 0;
  for (int si = 0; si < 4; si++) {
    if ((t->w[si] & 0x03FFu) >= 0x100u) return 1;
  }
  return 0;
}

static void draw_map16_at(RenderCtx *rc, uint16_t map16_id, uint32_t x_tile, uint32_t y_tile) {
  if (!rc || !rc->rgb || !rc->map16 || !rc->pal256 || !rc->rom || !rc->gfxc) return;

  uint16_t draw_id = map16_pipe_body_visual_id(map16_id);
  Map16Tile t;
  int src = MAP16_SRC_FILE;
  if (!map16_get_with_src(rc->map16, draw_id, &t, &src)) {
    if (rc->stats) rc->stats->map16_miss++;
    draw_missing_tile(rc->rgb, rc->W, rc->H, x_tile * 16u, y_tile * 16u, 16u, 0, 0, 0);
    return;
  }
  int ext_oracle = (src == MAP16_SRC_FG_ORACLE) && tile_uses_extended_oracle_chr(&t);
  if (src == MAP16_SRC_SYNTH && rc->map16_synth_debug) map16_synth_hist_bump(rc, map16_id);

  for (int si = 0; si < 4; si++) {
    uint16_t w0 = t.w[si];
    uint16_t tile8 = (uint16_t)(w0 & 0x03FFu);
    if ((tile8 & 0x03FFu) == 0) continue;
    int hflip = (w0 >> 10) & 1;
    int vflip = (w0 >> 11) & 1;
    uint8_t pal_raw = (uint8_t)((w0 >> 13) & 0x7);
    uint8_t pal = map16_effective_palette(pal_raw, rc->is_layer2, rc->custom_palette, rc->bg_palette_row,
                                          rc->fg_palette_row);
    if (pal >= 8) rc->pal_row_oob_count++;
    if (pal < 8) rc->pal_row_subtiles[pal]++;
    uint8_t palrgb[16][3];
    for (int c = 0; c < 16; c++) {
      int idx = (int)pal * 16 + c;
      palrgb[c][0] = rc->pal256[idx & 0xFF][0];
      palrgb[c][1] = rc->pal256[idx & 0xFF][1];
      palrgb[c][2] = rc->pal256[idx & 0xFF][2];
    }
    uint8_t px64[64];
    int okpx = 0;
    uint8_t page = (uint8_t)((tile8 >> 8) & 0x03);
    uint16_t local_tile = 0;
    uint8_t file_id = page;
    uint8_t used_file = file_id;
    if (src == MAP16_SRC_FG_ORACLE) {
      gfx_route_resolve_lm_oracle_chr(rc->gfx_route, tile8, rc->gfx_route_mode, &file_id, &local_tile);
    } else {
      gfx_route_resolve_subtile(rc->gfx_route, tile8, rc->gfx_route_mode, &file_id, &local_tile);
    }
    used_file = file_id;

    if (rc->stats) {
      rc->stats->subtiles_drawn++;
      rc->stats->gfx_page_subtiles[page]++;
      if (local_tile > rc->stats->gfx_page_max_local[page]) {
        rc->stats->gfx_page_max_local[page] = local_tile;
      }
    }

    int dr = decode_gfx_subtile(rc->rom, rc->gfxc, rc->gfx_route, rc->gfx_route_mode, src, tile8, 0, px64, rc->err,
                                rc->errcap);
    int fail_reason = dr;
    if (dr == 0) {
      if (rc->gfx_route_mode == GFX_ROUTE_MODE_TRY_BOTH && !tile_px64_has_opaque(px64) && rc->gfx_route) {
        uint8_t van = gfx_route_vanilla_file_for_page(rc->gfx_route, page);
        if (van != 0 && van != file_id) {
          uint8_t px_van[64];
          if (decode_gfx_subtile(rc->rom, rc->gfxc, rc->gfx_route, rc->gfx_route_mode, src, tile8, van, px_van, rc->err,
                                 rc->errcap) == 0 &&
              tile_px64_has_opaque(px_van)) {
            memcpy(px64, px_van, sizeof(px64));
            used_file = van;
            if (rc->stats) rc->stats->gfx_fallback_ok++;
          }
        }
      }
      okpx = 1;
    } else if (rc->gfx_route) {
      uint8_t van = gfx_route_vanilla_file_for_page(rc->gfx_route, page);
      if (van != 0 && van != file_id) {
        int dr2 = decode_gfx_subtile(rc->rom, rc->gfxc, rc->gfx_route, rc->gfx_route_mode, src, tile8, van, px64, rc->err,
                                     rc->errcap);
        if (dr2 == 0) {
          okpx = 1;
          used_file = van;
          if (rc->stats) rc->stats->gfx_fallback_ok++;
        } else {
          fail_reason = dr2;
        }
      }
    }

    if (used_file < 256) rc->gfx_file_subtiles[used_file]++;

    int corner = si;
    int blit_vflip = vflip;
    if (src == MAP16_SRC_FG_ORACLE) {
      /* FG_pages column order TL,BL,TR,BR -> screen TL,TR,BL,BR */
      if (corner == 1) corner = 2;
      else if (corner == 2) corner = 1;
      /* Extended CHR (0x100+): FG_pages -y- is priority, not static vflip for L1 export. */
      if (ext_oracle) blit_vflip = 0;
    }
    uint32_t px = x_tile * 16u + (uint32_t)(corner == 1 || corner == 3 ? 8 : 0);
    uint32_t py = y_tile * 16u + (uint32_t)(corner >= 2 ? 8 : 0);
    if (!okpx) {
      if (rc->stats) {
        rc->stats->gfx_miss++;
        rc->stats->gfx_miss_by_file[file_id]++;
        if (fail_reason == -1) rc->stats->gfx_load_fail++;
        else if (fail_reason == -2) rc->stats->gfx_tile_oob++;
      }
      draw_missing_tile(rc->rgb, rc->W, rc->H, px, py, 8u, palrgb[1][0], palrgb[1][1], palrgb[1][2]);
      continue;
    }
    blit_tile8(rc->rgb, rc->W, rc->H, px, py, px64, palrgb, hflip, blit_vflip);
  }
}

static int emit_draw_fn(const EmittedMap16 *t, void *ctx) {
  if (!t || !ctx) return 0;
  RenderCtx *rc = (RenderCtx *)ctx;
  map16_hist_bump(rc, t->map16_tile);
  draw_map16_at(rc, t->map16_tile, t->x_tile, t->y_tile);
  return 1;
}

static void palette_debug_print(const uint8_t pal256[256][3]) {
  if (!pal256) return;
  for (int row = 0; row < 16; row++) {
    fprintf(stderr, "LV_PALETTE_DEBUG row=%d", row);
    for (int c = 0; c < 16; c++) {
      int idx = row * 16 + c;
      fprintf(stderr, " %u,%u,%u", (unsigned)pal256[idx][0], (unsigned)pal256[idx][1], (unsigned)pal256[idx][2]);
    }
    fputc('\n', stderr);
  }
}

static int palette_debug_write_ppm(const char *path, const uint8_t pal256[256][3]) {
  if (!path || !pal256) return 0;
  uint8_t *rgb = (uint8_t *)malloc(256u * 16u * 3u);
  if (!rgb) return 0;
  for (int row = 0; row < 16; row++) {
    for (int c = 0; c < 16; c++) {
      int idx = row * 16 + c;
      size_t di = ((size_t)row * 16u + (size_t)c) * 3u;
      rgb[di + 0] = pal256[idx][0];
      rgb[di + 1] = pal256[idx][1];
      rgb[di + 2] = pal256[idx][2];
    }
  }
  int ok = write_ppm(path, rgb, 256u, 16u);
  free(rgb);
  return ok;
}

static void export_diff_stats(const char *out_ppm, const char *lm_ref, uint8_t br, uint8_t bg, uint8_t bb) {
  if (!out_ppm || !lm_ref) return;
  unsigned w = 0, h = 0, lw = 0, lh = 0;
  uint8_t *px = NULL;
  uint8_t *lm = NULL;
  if (!lv_ppm_read_rgb(out_ppm, &w, &h, &px) || !lv_ppm_read_rgb(lm_ref, &lw, &lh, &lm)) {
    fprintf(stderr, "LV_DIFF_STATS error=ppm_read_failed\n");
    free(px);
    free(lm);
    return;
  }
  if (w != lw || h != lh) {
    fprintf(stderr, "LV_DIFF_STATS error=dimension_mismatch %ux%u vs %ux%u\n", w, h, lw, lh);
    free(px);
    free(lm);
    return;
  }
  size_t total = (size_t)w * (size_t)h;
  size_t compared = 0;
  size_t close = 0;
  size_t tan_lm = 0;
  size_t tan_miss = 0;
  long long dr_sum = 0, dg_sum = 0, db_sum = 0;
  size_t bucket_count[5];
  memset(bucket_count, 0, sizeof(bucket_count));

  for (size_t i = 0; i < total; i++) {
    size_t oi = i * 3u;
    compared++;
    int lm_tan = (abs((int)lm[oi] - 214) <= 12 && abs((int)lm[oi + 1] - 181) <= 12 && abs((int)lm[oi + 2] - 140) <= 12);
    if (lm_tan) {
      tan_lm++;
      if (abs((int)px[oi] - (int)br) <= 3 && abs((int)px[oi + 1] - (int)bg) <= 3 && abs((int)px[oi + 2] - (int)bb) <= 3) {
        tan_miss++;
      }
    }
    int dr = abs((int)px[oi] - (int)lm[oi]);
    int dg = abs((int)px[oi + 1] - (int)lm[oi + 1]);
    int db = abs((int)px[oi + 2] - (int)lm[oi + 2]);
    dr_sum += dr;
    dg_sum += dg;
    db_sum += db;
    int mx = dr > dg ? dr : dg;
    if (db > mx) mx = db;
    if (mx <= 32) close++;
    int bi = mx <= 64 ? (mx <= 32 ? (mx <= 16 ? 0 : 1) : 2) : (mx <= 128 ? 3 : 4);
    bucket_count[bi]++;
  }

  double sim = compared ? (double)close / (double)compared : 0.0;
  double tan_miss_pct = tan_lm ? (double)tan_miss / (double)tan_lm : 0.0;
  double mean_dr = compared ? (double)dr_sum / (double)compared : 0.0;
  double mean_dg = compared ? (double)dg_sum / (double)compared : 0.0;
  double mean_db = compared ? (double)db_sum / (double)compared : 0.0;
  fprintf(stderr, "LV_DIFF_STATS compared=%zu similarity_32=%.3f mean_drgb=%.1f,%.1f,%.1f\n", compared, sim, mean_dr,
          mean_dg, mean_db);
  fprintf(stderr,
          "LV_DIFF_STATS buckets_le16=%zu le32=%zu le64=%zu le128=%zu gt128=%zu\n", bucket_count[0], bucket_count[1],
          bucket_count[2], bucket_count[3], bucket_count[4]);
  fprintf(stderr, "LV_DIFF_STATS tan_lm=%zu tan_miss=%zu tan_miss_pct=%.3f\n", tan_lm, tan_miss, tan_miss_pct);

  free(px);
  free(lm);
}

enum {
  LV_LAYERS_LAYER1 = 1,
  LV_LAYERS_LAYER2 = 2,
  LV_LAYERS_SPRITES = 4,
};

static void process_object_emit(const LevelObject *o, const ObjEmitContext *emit_ctx, RenderCtx *rc,
                                ObjectEmitStats *stats, int layer2_marker) {
  if (!o || !stats) return;
  stats->total_objects++;
  if (o->decoded.present) stats->decoded_present++;
  ObjMapResult r = object_emit_map16_tiles(o, emit_ctx, emit_draw_fn, rc);
  if (r == OBJMAP_NONVISUAL) {
    stats->skipped_nonvisual++;
    return;
  }
  if (r == OBJMAP_HANDLED) {
    stats->handled++;
    return;
  }
  stats->unknown++;
  uint32_t absx = (uint32_t)o->x_position + (uint32_t)o->screen_number * 16u;
  uint32_t y = (uint32_t)o->y_position;
  if (layer2_marker) draw_missing_tile(rc->rgb, rc->W, rc->H, absx * 16u, y * 16u, 16u, 0, 0, 255);
  else draw_missing_tile(rc->rgb, rc->W, rc->H, absx * 16u, y * 16u, 16u, 0, 0, 0);
}

static uint32_t compute_canvas_screens(const LevelInfo *info) {
  if (!info) return 1;
  uint32_t screens = 1;
  if (info->primary.length_in_screens == -1) screens = 32;
  else if (info->primary.length_in_screens > 0) screens = (uint32_t)info->primary.length_in_screens;
  if (info->secondary_decoded.present && info->secondary_decoded.shc_c && screens > 0 && screens < 32) {
    screens++;
  }
  return screens;
}

static ObjEmitContext make_emit_ctx(const LevelInfo *info) {
  ObjEmitContext ctx;
  memset(&ctx, 0, sizeof(ctx));
  if (!info) return ctx;
  ctx.level_tileset = (uint8_t)(info->primary.fgbg_gfx_setting & 0x0F);
  ctx.vertical_scroll = info->primary.vertical_scroll_set;
  ctx.screens_in_level = (uint16_t)compute_canvas_screens(info);
  if (ctx.screens_in_level == 0) ctx.screens_in_level = 1;
  return ctx;
}

static void print_level_report(const LevelInfo *info, Rom *rom, uint32_t W, uint32_t H, PaletteSource ps,
                               uint8_t back_r, uint8_t back_g, uint8_t back_b, const LevelGfxRoute *route) {
  if (!info) return;
  fprintf(stderr, "LV_REPORT palette_source=%s custom_present=%d back_rgb=%u,%u,%u\n",
          palette_source_name(ps), info->palette_present, (unsigned)back_r, (unsigned)back_g, (unsigned)back_b);
  fprintf(stderr, "LV_REPORT length_in_screens=%d canvas_screens=%u size=%ux%u lmexp_horizontal=%u\n",
          info->primary.length_in_screens, (unsigned)(W / 256u), (unsigned)W, (unsigned)H,
          info->secondary_decoded.present ? (unsigned)info->secondary_decoded.shc_c : 0u);
  if (info->layer2_data_ptr_snes) {
    if (info->layer2_is_bg_tilemap) {
      fprintf(stderr, "LV_REPORT layer2=bg_tilemap %ux%u flags=0x%02X\n", info->layer2_bg_width,
              info->layer2_bg_height, info->layer2_bg_flags_0ef310);
    } else {
      fprintf(stderr, "LV_REPORT layer2=objects count=%zu flags=0x%02X\n", info->layer2_objects_count,
              info->layer2_bg_flags_0ef310);
    }
  } else {
    fprintf(stderr, "LV_REPORT layer2=none\n");
  }
  if (route) gfx_route_print_manifest(route, info->exgfx_bytes, info->exgfx_len);
  (void)rom;
}

static int map16_load_fg_oracles_for_render(const char *map16_path, const char *fg_oracle_dir, Map16Data *map16,
                                            char *err, size_t errcap) {
  const char *dir = fg_oracle_dir;
  char auto_dir[512];
  int explicit = (dir && dir[0]);
  if (!explicit && map16_path && map16_try_auto_fg_oracle_dir(map16_path, auto_dir, sizeof(auto_dir))) {
    dir = auto_dir;
  }
  if (!dir || !dir[0]) return 1;
  if (!map16_load_fg_oracles(dir, map16, err, errcap)) {
    if (explicit) return 0;
    err[0] = '\0';
    return 1;
  }
  fprintf(stderr, "LV_MAP16 fg_oracle dir=%s entries=%zu\n", dir, map16->fg_oracle_loaded_total);
  return 1;
}

static int map16_load_for_render(Rom *rom, const char *map16_path, const char *fg_oracle_dir, Map16Data *map16,
                                 char *err, size_t errcap) {
  memset(map16, 0, sizeof(*map16));
  if (rom) {
    if (!map16_load_from_rom(rom, map16, err, errcap)) return 0;
    map16_attach_rom(map16, rom);
    if (map16_path && map16_path[0]) {
      if (!map16_merge_file(map16_path, map16, err, errcap)) return 0;
      if (!map16_load_fg_oracles_for_render(map16_path, fg_oracle_dir, map16, err, errcap)) return 0;
    }
    return 1;
  }
  if (!map16_path || !map16_path[0]) {
    snprintf(err, errcap, "Map16: need ROM or --map16=file");
    return 0;
  }
  if (!map16_load_file(map16_path, map16, err, errcap)) return 0;
  if (!map16_load_fg_oracles_for_render(map16_path, fg_oracle_dir, map16, err, errcap)) return 0;
  return 1;
}

static int render_level_ppm(const LevelInfo *info, Rom *rom, const char *map16_path, const char *out_ppm,
                            int layers_mask, int print_stats, int print_histogram, int gfx_debug, int print_report,
                            int palette_debug, int sprite_debug, const LvRenderOpts *opts) {
  char err[512];
  if (!info || !out_ppm) return 0;
  if (!rom && (!map16_path || !*map16_path)) return 0;

  Map16Data map16;
  const char *fg_oracle_dir = (opts && opts->map16_fg_oracle_dir) ? opts->map16_fg_oracle_dir : NULL;
  if (!map16_load_for_render(rom, map16_path, fg_oracle_dir, &map16, err, sizeof(err))) {
    fprintf(stderr, "Map16 load failed: %s\n", err);
    return 0;
  }
  if (rom) map16_attach_rom(&map16, rom);
  if (opts && opts->map16_alias_debug) map16_print_alias_debug(&map16, 10);

  GfxCache gfxc;
  memset(&gfxc, 0, sizeof(gfxc));
  if (!gfxcache_init(&gfxc, 96, err, sizeof(err))) {
    fprintf(stderr, "GFX cache init failed: %s\n", err);
    map16_free(&map16);
    return 0;
  }

  LevelGfxRoute gfx_route;
  gfx_route_build(&gfx_route, &info->primary, info->exgfx_bytes, info->exgfx_len);

  if (rom) {
    uint8_t preload_ids[64];
    size_t npreload = gfx_route_collect_preload_ids(&gfx_route, preload_ids, sizeof(preload_ids));
    gfxcache_preload_ids(rom, &gfxc, preload_ids, npreload, err, sizeof(err));
  }

  uint8_t pal256[256][3];
  uint8_t back_r = 0, back_g = 0, back_b = 0;

  ObjEmitContext emit_ctx = make_emit_ctx(info);
  if (print_histogram) {
    object_emit_print_histogram(info->objects, info->objects_count, &emit_ctx, stderr, 20);
    object_emit_print_obj_histogram(info->objects, info->objects_count, stderr, 15);
    if (info->layer2_objects && info->layer2_objects_count) {
      fprintf(stderr, "LV_HIST layer2 unknown:\n");
      object_emit_print_histogram(info->layer2_objects, info->layer2_objects_count, &emit_ctx, stderr, 10);
      fprintf(stderr, "LV_HIST layer2 objects:\n");
      object_emit_print_obj_histogram(info->layer2_objects, info->layer2_objects_count, stderr, 15);
    }
  }

  uint32_t screens = compute_canvas_screens(info);
  uint32_t tiles_h = info->primary.vertical_scroll_set ? 32u : 27u;
  uint32_t W = screens * 16u * 16u;
  uint32_t H = tiles_h * 16u;

  PaletteSource ps_report = palette_build_for_level(rom, info, pal256, &back_r, &back_g, &back_b);
  if (print_report) {
    print_level_report(info, rom, W, H, ps_report, back_r, back_g, back_b, &gfx_route);
  }
  if (palette_debug) {
    palette_debug_print(pal256);
  }
  if (opts && opts->palette_debug_ppm && opts->palette_debug_ppm[0]) {
    if (!palette_debug_write_ppm(opts->palette_debug_ppm, pal256)) {
      fprintf(stderr, "Failed writing palette debug %s\n", opts->palette_debug_ppm);
    }
  }

  uint8_t *rgb = (uint8_t *)malloc((size_t)W * (size_t)H * 3u);
  if (!rgb) {
    fprintf(stderr, "Out of memory allocating canvas\n");
    gfxcache_free(&gfxc);
    map16_free(&map16);
    return 0;
  }
  for (size_t p = 0, n = (size_t)W * (size_t)H; p < n; p++) {
    rgb[p * 3 + 0] = back_r;
    rgb[p * 3 + 1] = back_g;
    rgb[p * 3 + 2] = back_b;
  }
  ObjectEmitStats stats;
  emit_stats_reset(&stats);

  RenderCtx rc;
  memset(&rc, 0, sizeof(rc));
  rc.rgb = rgb;
  rc.W = W;
  rc.H = H;
  rc.map16 = &map16;
  if (opts && !opts->map16_synth_vanilla) map16_set_synth_vanilla(&map16, 0);
  rc.pal256 = pal256;
  rc.rom = rom;
  rc.gfxc = &gfxc;
  rc.gfx_route = &gfx_route;
  rc.stats = &stats;
  rc.err = err;
  rc.errcap = sizeof(err);
  rc.bg_palette_row = info->primary.bg_palette & 7u;
  rc.fg_palette_row = info->primary.fg_palette & 7u;
  rc.custom_palette = info->palette_present ? 1 : 0;
  rc.back_r = back_r;
  rc.back_g = back_g;
  rc.back_b = back_b;
  if (opts) {
    rc.gfx_route_mode = opts->gfx_route_mode;
    rc.map16_audit = opts->map16_audit;
    rc.map16_synth_debug = opts->map16_synth_debug;
  }

  if ((layers_mask & LV_LAYERS_LAYER2) && info->layer2_data_ptr_snes) {
    memset(rc.gfx_file_subtiles, 0, sizeof(rc.gfx_file_subtiles));
    memset(rc.pal_row_subtiles, 0, sizeof(rc.pal_row_subtiles));
    rc.pal_row_oob_count = 0;
    rc.map16_hist_n = 0;
    rc.map16_synth_hist_n = 0;
    rc.is_layer2 = 1;
    rc.bg_palette_row = info->primary.bg_palette & 7u;
    if (info->layer2_is_bg_tilemap && info->layer2_bg_tiles && info->layer2_bg_width && info->layer2_bg_height) {
      uint8_t w2 = info->layer2_bg_width;
      uint8_t h2 = info->layer2_bg_height;
      for (uint8_t yy = 0; yy < h2; yy++) {
        for (uint8_t xx = 0; xx < w2; xx++) {
          uint16_t tid = info->layer2_bg_tiles[(size_t)yy * (size_t)w2 + xx];
          if (tid == 0) continue;
          map16_hist_bump(&rc, tid);
          draw_map16_at(&rc, tid, xx, yy);
        }
      }
    } else if (info->layer2_objects && info->layer2_objects_count) {
      for (size_t i = 0; i < info->layer2_objects_count; i++) {
        process_object_emit(&info->layer2_objects[i], &emit_ctx, &rc, &stats, 1);
      }
    }
    if (info->layer2_is_bg_tilemap && info->layer2_bg_tiles) {
      repeat_layer2_strip_horiz(rgb, W, H, 32u * 16u, back_r, back_g, back_b);
    }
    if (print_report) {
      rc.audit_layer = "layer2";
      map16_hist_print_top(&rc, "layer2", 10);
      gfx_file_hist_print(&rc, "layer2");
      pal_row_hist_print(&rc, "layer2");
    }
  }

  if (layers_mask & LV_LAYERS_LAYER1) {
    memset(rc.gfx_file_subtiles, 0, sizeof(rc.gfx_file_subtiles));
    memset(rc.pal_row_subtiles, 0, sizeof(rc.pal_row_subtiles));
    rc.pal_row_oob_count = 0;
    rc.map16_hist_n = 0;
    rc.map16_synth_hist_n = 0;
    rc.is_layer2 = 0;
    if (print_report) {
      emit_report_pipe_objects(info->objects, info->objects_count);
      emit_report_lm_direct_map16_objects(info->objects, info->objects_count);
    }
    for (size_t i = 0; i < info->objects_count; i++) {
      process_object_emit(&info->objects[i], &emit_ctx, &rc, &stats, 0);
    }
    if (print_report) {
      rc.audit_layer = "layer1";
      map16_hist_print_top(&rc, "layer1", 10);
      gfx_file_hist_print(&rc, "layer1");
      pal_row_hist_print(&rc, "layer1");
      if (rc.map16_audit) {
        map16_audit_pipe_blocks(&rc);
        map16_audit_muncher_blocks(&rc);
      }
    }
  }

  SpriteDrawStats sp_stats;
  sprite_draw_stats_reset(&sp_stats);
  if ((layers_mask & LV_LAYERS_SPRITES) && info->sprites && info->sprites_count && rom) {
    SpriteDrawCtx spctx;
    memset(&spctx, 0, sizeof(spctx));
    spctx.rgb = rgb;
    spctx.W = W;
    spctx.H = H;
    spctx.rom = rom;
    spctx.gfxc = &gfxc;
    spctx.gfx_route = &gfx_route;
    spctx.pal256 = pal256;
    spctx.sprite_pal_base = (uint8_t)(info->primary.sprite_palette & 7u);
    spctx.sprite_gfx = (uint8_t)(info->primary.sprite_gfx & 0xFu);
    spctx.gfx_route_mode = rc.gfx_route_mode;
    spctx.print_report = print_report;
    spctx.back_r = back_r;
    spctx.back_g = back_g;
    spctx.back_b = back_b;
    spctx.sprite_debug = sprite_debug;
    spctx.stats = &sp_stats;
    spctx.err = err;
    spctx.errcap = sizeof(err);
    sprite_draw_level(info, &spctx);
    if (print_report) {
      sprite_draw_log_unknown_ids(info, stderr);
      sprite_draw_pal_row_hist_print(&spctx, stderr);
    }
  }

  if (print_report) {
    fprintf(stderr,
            "LV_REPORT map16_alias_hits=%zu map16_rom_hits=%zu map16_rom_vanilla_hits=%zu map16_alias_table=%zu "
            "map16_synth_fallback=%zu map16_def_redirect=%zu lm16=%d loaded_from_rom=%d\n",
            map16.alias_hit_count, map16.rom_hit_count, map16.rom_vanilla_hit_count, map16.alias_table_count,
            map16.synth_count, map16.def_redirect_count, map16.is_lm16, map16.loaded_from_rom);
    if (opts && opts->map16_synth_debug) map16_synth_hist_print_top(&rc, 10);
  }

  if (print_stats) {
    emit_stats_print_line(&stats);
    if (sp_stats.sprites_total) sprite_draw_stats_print_line(&sp_stats);
    emit_stats_print_gfx_miss_reasons(&stats);
    emit_stats_print_top_gfx_miss(&stats, 5);
  }
  if (gfx_debug) {
    emit_stats_print_gfx_page_debug(&stats, &gfx_route);
  }

  if (opts && opts->export_gridlines) {
    lv_ppm_draw_gridlines(rgb, (unsigned)W, (unsigned)H, back_r, back_g, back_b);
    lv_ppm_draw_grid_corners(rgb, (unsigned)W, (unsigned)H, back_r, back_g, back_b);
  }

  int ok = write_ppm(out_ppm, rgb, W, H);
  if (!ok) fprintf(stderr, "Failed writing %s\n", out_ppm);

  if (ok && opts && opts->export_diff_stats && opts->lm_ref_ppm && opts->lm_ref_ppm[0]) {
    export_diff_stats(out_ppm, opts->lm_ref_ppm, back_r, back_g, back_b);
  }

  int tile_ok = 1;
  if (ok && opts && opts->lm_tile_ref_ppm && opts->lm_tile_ref_ppm[0]) {
    LvTileCmpOpts tcmp;
    LvTileCmpReport trep;
    memset(&tcmp, 0, sizeof(tcmp));
    memset(&trep, 0, sizeof(trep));
    tcmp.max_mismatch_log = LV_TILE_CMP_MAX_MISMATCH_LOG;
    tcmp.mismatch_ppm_path = opts->lm_tile_mismatch_ppm;
    if (!lv_ppm_tile_compare_files(out_ppm, opts->lm_tile_ref_ppm, &tcmp, &trep)) {
      tile_ok = 0;
    }
    lv_ppm_report_pipe_stack_tiles(out_ppm, opts->lm_tile_ref_ppm);
  }

  free(rgb);
  gfxcache_free(&gfxc);
  map16_free(&map16);
  return ok && tile_ok;
}

static int run_map16_probe_from_rom(const char *rom_path, uint16_t level_id, const char *map16_path,
                                    uint16_t probe_id, const char *probe_ppm, int gfx_route_mode,
                                    const char *fg_oracle_dir) {
  char err[512];
  Rom rom;
  if (!rom_load(&rom, rom_path, err, sizeof(err))) {
    fprintf(stderr, "map16_probe: ROM load failed: %s\n", err);
    return 0;
  }
  LmTables tables;
  if (!lm_resolve_tables(&rom, &tables, err, sizeof(err))) {
    fprintf(stderr, "map16_probe: tables failed: %s\n", err);
    rom_free(&rom);
    return 0;
  }
  LevelInfo info;
  memset(&info, 0, sizeof(info));
  if (!parse_level_info(&rom, &tables, level_id, &info, err, sizeof(err))) {
    fprintf(stderr, "map16_probe: level parse failed: %s\n", err);
    rom_free(&rom);
    return 0;
  }

  Map16Data map16;
  if (!map16_load_for_render(&rom, map16_path, fg_oracle_dir, &map16, err, sizeof(err))) {
    fprintf(stderr, "map16_probe: map16 load failed: %s\n", err);
    levelinfo_free(&info);
    rom_free(&rom);
    return 0;
  }
  map16_attach_rom(&map16, &rom);

  Map16Tile raw;
  if (map16_get_raw(&map16, probe_id, &raw)) {
    fprintf(stderr, "LV_PROBE id=0x%04X raw sub=(0x%03X,0x%03X,0x%03X,0x%03X) needs_resolve=%d\n", (unsigned)probe_id,
            (unsigned)(raw.w[0] & 0x03FFu), (unsigned)(raw.w[1] & 0x03FFu), (unsigned)(raw.w[2] & 0x03FFu),
            (unsigned)(raw.w[3] & 0x03FFu), map16_tile_needs_resolve(&raw));
  }

  size_t can_idx = SIZE_MAX, alias_idx = SIZE_MAX;
  if (map16_get_canonical_index(&map16, probe_id, &can_idx)) {
    fprintf(stderr, "LV_PROBE id=0x%04X canonical_index=0x%04zX\n", (unsigned)probe_id, can_idx);
  }
  if (map16_get_alias_index(&map16, probe_id, &alias_idx)) {
    fprintf(stderr, "LV_PROBE id=0x%04X alias_index=0x%04zX\n", (unsigned)probe_id, alias_idx);
  }

  Map16Tile rom_van;
  if (map16_rom_get_vanilla_tile(&rom, probe_id, &rom_van)) {
    fprintf(stderr, "LV_PROBE id=0x%04X rom_vanilla sub=(0x%03X,0x%03X,0x%03X,0x%03X)\n", (unsigned)probe_id,
            (unsigned)(rom_van.w[0] & 0x03FFu), (unsigned)(rom_van.w[1] & 0x03FFu), (unsigned)(rom_van.w[2] & 0x03FFu),
            (unsigned)(rom_van.w[3] & 0x03FFu));
  }

  Map16Tile got;
  int src = -1;
  uint16_t acts_like = 0;
  if (map16_get_acts_like(&map16, probe_id, &acts_like)) {
    fprintf(stderr, "LV_PROBE id=0x%04X acts_like=0x%04X (behavior only)\n", (unsigned)probe_id, (unsigned)acts_like);
  }

  if (map16_get_with_src(&map16, probe_id, &got, &src)) {
    fprintf(stderr, "LV_PROBE id=0x%04X resolved src=%s sub=(0x%03X,0x%03X,0x%03X,0x%03X)\n", (unsigned)probe_id,
            map16_src_label(src), (unsigned)(got.w[0] & 0x03FFu), (unsigned)(got.w[1] & 0x03FFu),
            (unsigned)(got.w[2] & 0x03FFu), (unsigned)(got.w[3] & 0x03FFu));
  } else {
    fprintf(stderr, "LV_PROBE id=0x%04X resolved=FAIL\n", (unsigned)probe_id);
  }

  if (probe_ppm && probe_ppm[0]) {
    GfxCache gfxc;
    memset(&gfxc, 0, sizeof(gfxc));
    if (gfxcache_init(&gfxc, 32, err, sizeof(err))) {
      LevelGfxRoute gfx_route;
      gfx_route_build(&gfx_route, &info.primary, info.exgfx_bytes, info.exgfx_len);
      uint8_t preload_ids[64];
      size_t npreload = gfx_route_collect_preload_ids(&gfx_route, preload_ids, sizeof(preload_ids));
      gfxcache_preload_ids(&rom, &gfxc, preload_ids, npreload, err, sizeof(err));

      uint8_t pal256[256][3];
      uint8_t br = 0, bg = 0, bb = 0;
      palette_build_for_level(&rom, &info, pal256, &br, &bg, &bb);

      uint32_t W = 16u, H = 16u;
      uint8_t *rgb = (uint8_t *)calloc((size_t)W * (size_t)H * 3u, 1);
      if (rgb) {
        for (size_t i = 0; i < (size_t)W * (size_t)H * 3u; i += 3) {
          rgb[i] = br;
          rgb[i + 1] = bg;
          rgb[i + 2] = bb;
        }
        RenderCtx rc;
        memset(&rc, 0, sizeof(rc));
        rc.rgb = rgb;
        rc.W = W;
        rc.H = H;
        rc.rom = &rom;
        rc.gfxc = &gfxc;
        rc.map16 = &map16;
        rc.pal256 = pal256;
        rc.gfx_route = &gfx_route;
        rc.gfx_route_mode = gfx_route_mode;
        rc.is_layer2 = 0;
        rc.bg_palette_row = info.primary.bg_palette & 7u;
        rc.fg_palette_row = info.primary.fg_palette & 7u;
        rc.custom_palette = info.palette_present ? 1 : 0;
        rc.back_r = br;
        rc.back_g = bg;
        rc.back_b = bb;
        draw_map16_at(&rc, probe_id, 0, 0);
        if (write_ppm(probe_ppm, rgb, W, H)) {
          fprintf(stderr, "LV_PROBE wrote %s (16x16)\n", probe_ppm);
        }
        free(rgb);
      }
      gfxcache_free(&gfxc);
    }
  }

  map16_free(&map16);
  levelinfo_free(&info);
  rom_free(&rom);
  return 1;
}

static int render_level_ppm_from_rom(const char *rom_path, uint16_t level_id, const char *map16_path,
                                     const char *out_ppm, int layers_mask, int print_stats,
                                     int print_histogram, int gfx_debug, int print_report, int palette_debug,
                                     int sprite_debug, const LvRenderOpts *opts) {
  char err[512];
  Rom rom;
  if (!rom_load(&rom, rom_path, err, sizeof(err))) {
    fprintf(stderr, "ROM load failed: %s\n", err);
    return 0;
  }
  LmTables tables;
  if (!lm_resolve_tables(&rom, &tables, err, sizeof(err))) {
    fprintf(stderr, "ROM table resolve failed: %s\n", err);
    rom_free(&rom);
    return 0;
  }
  LevelInfo info;
  memset(&info, 0, sizeof(info));
  if (!parse_level_info(&rom, &tables, level_id, &info, err, sizeof(err))) {
    fprintf(stderr, "ROM level parse failed: %s\n", err);
    rom_free(&rom);
    return 0;
  }
  int ok = render_level_ppm(&info, &rom, map16_path, out_ppm, layers_mask, print_stats, print_histogram, gfx_debug,
                            print_report, palette_debug, sprite_debug, opts);
  levelinfo_free(&info);
  rom_free(&rom);
  return ok;
}

static int render_level_ppm_from_mwl(const char *mwl_path, const char *map16_path, const char *out_ppm,
                                     int layers_mask, int print_stats, int print_histogram, int gfx_debug,
                                     int print_report, int palette_debug, int sprite_debug,
                                     const LvRenderOpts *opts) {
  char err[512];
  MwlParsed mwl;
  memset(&mwl, 0, sizeof(mwl));
  if (!mwl_parse_file(mwl_path, &mwl, err, sizeof(err))) {
    fprintf(stderr, "MWL parse failed: %s\n", err);
    return 0;
  }
  if (!mwl.layer1.bytes || mwl.layer1.len == 0) {
    fprintf(stderr, "MWL missing Layer1 payload\n");
    mwl_parsed_free(&mwl);
    return 0;
  }

  LevelInfo info;
  memset(&info, 0, sizeof(info));
  if (!parse_level_info_from_layer1_bytes(mwl.layer1.bytes, mwl.layer1.len, mwl.level.level_id, &info, err,
                                          sizeof(err))) {
    fprintf(stderr, "MWL layer1 parse failed: %s\n", err);
    mwl_parsed_free(&mwl);
    return 0;
  }

  if (mwl.palette.present && mwl.palette.bytes && mwl.palette.len) {
    info.palette_present = 1;
    info.palette_len = mwl.palette.len;
    info.palette_bytes = (uint8_t *)malloc(mwl.palette.len);
    if (info.palette_bytes) memcpy(info.palette_bytes, mwl.palette.bytes, mwl.palette.len);
  }
  if (mwl.exgfx.present && mwl.exgfx.bytes && mwl.exgfx.len) {
    info.exgfx_present = 1;
    info.exgfx_len = mwl.exgfx.len;
    info.exgfx_bytes = (uint8_t *)malloc(mwl.exgfx.len);
    if (info.exgfx_bytes) memcpy(info.exgfx_bytes, mwl.exgfx.bytes, mwl.exgfx.len);
  }

  if (mwl.layer2.present && mwl.layer2.bytes && mwl.layer2.len > 8) {
    size_t payload = mwl.layer2.len - 8u;
    int looks_tilemap = (payload == (size_t)(32 * 27 * 2) || payload == (size_t)(32 * 32 * 2));
    if (looks_tilemap) {
      info.layer2_is_bg_tilemap = 1;
      info.layer2_bg_width = 32;
      info.layer2_bg_height = (uint8_t)(payload / (32 * 2));
      size_t ntiles = (size_t)info.layer2_bg_width * (size_t)info.layer2_bg_height;
      info.layer2_bg_tiles = (uint16_t *)calloc(ntiles, sizeof(uint16_t));
      if (info.layer2_bg_tiles) {
        const uint8_t *p = mwl.layer2.bytes + 8;
        for (size_t ti = 0; ti < ntiles; ti++) {
          info.layer2_bg_tiles[ti] = (uint16_t)(p[ti * 2] | ((uint16_t)p[ti * 2 + 1] << 8));
        }
      }
      info.layer2_data_ptr_snes = 1;
    } else {
      LevelInfo l2info;
      memset(&l2info, 0, sizeof(l2info));
      int ok_l2 = parse_level_info_from_layer1_bytes(mwl.layer2.bytes, mwl.layer2.len, mwl.level.level_id, &l2info,
                                                     err, sizeof(err));
      if (!ok_l2 && mwl.layer2.len >= 1) {
        uint8_t *tmp = (uint8_t *)malloc(mwl.layer2.len + 5u);
        if (tmp) {
          memset(tmp, 0, 5);
          memcpy(tmp + 5, mwl.layer2.bytes, mwl.layer2.len);
          ok_l2 = parse_level_info_from_layer1_bytes(tmp, mwl.layer2.len + 5u, mwl.level.level_id, &l2info, err,
                                                     sizeof(err));
          free(tmp);
        }
      }
      if (ok_l2 && l2info.objects_count) {
        info.layer2_objects = l2info.objects;
        info.layer2_objects_count = l2info.objects_count;
        l2info.objects = NULL;
        l2info.objects_count = 0;
        info.layer2_data_ptr_snes = 1;
      }
      levelinfo_free(&l2info);
    }
  }

  int ok = render_level_ppm(&info, NULL, map16_path, out_ppm, layers_mask, print_stats, print_histogram, gfx_debug,
                            print_report, palette_debug, sprite_debug, opts);
  levelinfo_free(&info);
  mwl_parsed_free(&mwl);
  return ok;
}

int main(int argc, char **argv) {
  if (argc < 2) {
    usage(argv[0]);
    return 2;
  }

  const char *rom_path = NULL;
  const char *mwl_path = NULL;
  const char *layers = "all";
  const char *export_ppm = NULL;
  const char *map16_path = NULL;
  const char *suite = NULL;
  int print_stats = 0;
  int print_histogram = 0;
  int gfx_debug = 0;
  int print_report = 0;
  int palette_debug = 0;
  int sprite_debug = 0;
  int map16_audit = 0;
  int map16_synth_vanilla = 1;
  int map16_alias_debug = 0;
  int map16_synth_debug = 0;
  int export_diff_stats = 0;
  int export_gridlines = 0;
  int gfx_route_mode = GFX_ROUTE_MODE_BYPASS;
  const char *palette_debug_ppm = NULL;
  const char *lm_ref_ppm = NULL;
  const char *lm_tile_ref_ppm = NULL;
  const char *lm_tile_mismatch_ppm = NULL;
  const char *map16_probe_ppm = "probe.ppm";
  const char *map16_fg_oracle_dir = NULL;
  uint16_t map16_probe_id = 0;
  int have_map16_probe = 0;

  uint16_t level_id = 0;
  int have_level_id = 0;

  int i = 1;
  if (strcmp(argv[i], "--help") == 0 || strcmp(argv[i], "-h") == 0) {
    usage(argv[0]);
    return 0;
  }

  if (strcmp(argv[i], "--mwl") == 0) {
    if (i + 1 >= argc) {
      fprintf(stderr, "Missing value after --mwl\n");
      return 2;
    }
    mwl_path = argv[i + 1];
    i += 2;
  } else {
    if (i + 1 >= argc) {
      usage(argv[0]);
      return 2;
    }
    rom_path = argv[i];
    if (!parse_level_id(argv[i + 1], &level_id)) {
      fprintf(stderr, "Invalid LEVEL_ID: %s\n", argv[i + 1]);
      return 2;
    }
    have_level_id = 1;
    i += 2;
  }

  for (; i < argc; i++) {
    const char *a = argv[i];
    if (strncmp(a, "--layers=", 9) == 0) layers = a + 9;
    else if (strncmp(a, "--export-ppm=", 13) == 0) export_ppm = a + 13;
    else if (strncmp(a, "--map16=", 8) == 0) map16_path = a + 8;
    else if (strncmp(a, "--map16-fg-oracles=", 19) == 0) map16_fg_oracle_dir = a + 19;
    else if (strncmp(a, "--suite=", 8) == 0) suite = a + 8;
    else if (strcmp(a, "--stats") == 0) print_stats = 1;
    else if (strcmp(a, "--emit-histogram") == 0) print_histogram = 1;
    else if (strcmp(a, "--gfx-debug") == 0) gfx_debug = 1;
    else if (strcmp(a, "--report") == 0) print_report = 1;
    else if (strcmp(a, "--palette-debug") == 0) palette_debug = 1;
    else if (strncmp(a, "--palette-debug-ppm=", 20) == 0) palette_debug_ppm = a + 20;
    else if (strcmp(a, "--map16-audit") == 0) map16_audit = 1;
    else if (strcmp(a, "--map16-synth-vanilla") == 0) map16_synth_vanilla = 1;
    else if (strcmp(a, "--no-map16-synth-vanilla") == 0) map16_synth_vanilla = 0;
    else if (strcmp(a, "--map16-alias-debug") == 0) map16_alias_debug = 1;
    else if (strcmp(a, "--map16-synth-debug") == 0) map16_synth_debug = 1;
    else if (strcmp(a, "--export-diff-stats") == 0) export_diff_stats = 1;
    else if (strcmp(a, "--export-gridlines") == 0) export_gridlines = 1;
    else if (strncmp(a, "--gfx-route-mode=", 17) == 0) {
      int m = parse_gfx_route_mode(a + 17);
      if (m < 0) {
        fprintf(stderr, "Invalid --gfx-route-mode (use bypass|vanilla|try-both)\n");
        return 2;
      }
      gfx_route_mode = m;
    } else if (strncmp(a, "--lm-ref=", 9) == 0) lm_ref_ppm = a + 9;
    else if (strncmp(a, "--lm-tile-ref=", 14) == 0) lm_tile_ref_ppm = a + 14;
    else if (strncmp(a, "--lm-tile-mismatch-ppm=", 23) == 0) lm_tile_mismatch_ppm = a + 23;
    else if (strncmp(a, "--map16-probe-id=", 17) == 0) {
      if (!parse_map16_id(a + 17, &map16_probe_id)) {
        fprintf(stderr, "Invalid --map16-probe-id\n");
        return 2;
      }
      have_map16_probe = 1;
    } else if (strncmp(a, "--map16-probe-ppm=", 18) == 0) map16_probe_ppm = a + 18;
    else if (strcmp(a, "--sprite-debug") == 0) sprite_debug = 1;
    else if (strcmp(a, "--help") == 0 || strcmp(a, "-h") == 0) {
      usage(argv[0]);
      return 0;
    } else {
      fprintf(stderr, "Unknown option: %s\n", a);
      return 2;
    }
  }

  if ((!export_ppm || !*export_ppm) && !have_map16_probe) {
    fprintf(stderr, "Missing required --export-ppm=<OUT.ppm>\n");
    return 2;
  }

  int layers_mask = LV_LAYERS_LAYER1 | LV_LAYERS_LAYER2 | LV_LAYERS_SPRITES;
  if (strcmp(layers, "all") == 0) {
    layers_mask = LV_LAYERS_LAYER1 | LV_LAYERS_LAYER2 | LV_LAYERS_SPRITES;
  } else if (strcmp(layers, "layer1") == 0) {
    layers_mask = LV_LAYERS_LAYER1;
  } else if (strcmp(layers, "layer2") == 0) {
    layers_mask = LV_LAYERS_LAYER2;
  } else if (strcmp(layers, "sprites") == 0) {
    layers_mask = LV_LAYERS_SPRITES;
  } else {
    fprintf(stderr, "Invalid --layers=%s (expected all|layer1|layer2|sprites)\n", layers);
    return 2;
  }

  char suite_map16[256];
  if ((!map16_path || !*map16_path) && suite && *suite) {
    snprintf(suite_map16, sizeof(suite_map16), "test/%s/AllMap16.map16", suite);
    map16_path = suite_map16;
  }

  const char *gfx_env = getenv("LEVEL_VISUAL_GFX_MODE");
  if (gfx_env && gfx_env[0]) {
    int m = parse_gfx_route_mode(gfx_env);
    if (m >= 0) gfx_route_mode = m;
  }
  if (!map16_fg_oracle_dir) {
    const char *oracle_env = getenv("MAP16_FG_ORACLE_DIR");
    if (oracle_env && oracle_env[0]) map16_fg_oracle_dir = oracle_env;
  }

  LvRenderOpts ropts;
  memset(&ropts, 0, sizeof(ropts));
  ropts.gfx_route_mode = gfx_route_mode;
  ropts.map16_audit = map16_audit || print_report;
  ropts.map16_synth_vanilla = map16_synth_vanilla;
  ropts.map16_alias_debug = map16_alias_debug;
  ropts.map16_synth_debug = map16_synth_debug;
  ropts.export_diff_stats = export_diff_stats;
  ropts.export_gridlines = export_gridlines;
  ropts.palette_debug_ppm = palette_debug_ppm;
  ropts.lm_ref_ppm = lm_ref_ppm;
  ropts.lm_tile_ref_ppm = lm_tile_ref_ppm;
  ropts.lm_tile_mismatch_ppm = lm_tile_mismatch_ppm;
  ropts.map16_fg_oracle_dir = map16_fg_oracle_dir;

  if (mwl_path) {
    if (!render_level_ppm_from_mwl(mwl_path, map16_path, export_ppm, layers_mask, print_stats, print_histogram,
                                   gfx_debug, print_report, palette_debug, sprite_debug, &ropts))
      return 1;
    return 0;
  }

  if (!rom_path || !have_level_id) {
    usage(argv[0]);
    return 2;
  }
  if (have_map16_probe) {
    if (!run_map16_probe_from_rom(rom_path, level_id, map16_path, map16_probe_id, map16_probe_ppm, gfx_route_mode,
                                  map16_fg_oracle_dir))
      return 1;
    if (!export_ppm || !*export_ppm) return 0;
  }
  if (!render_level_ppm_from_rom(rom_path, level_id, map16_path, export_ppm, layers_mask, print_stats,
                                print_histogram, gfx_debug, print_report, palette_debug, sprite_debug, &ropts))
    return 1;
  return 0;
}
