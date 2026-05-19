#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>

#include "romutil.h"
#include "lm_tables.h"
#include "level_parse.h"
#include "mwl_reader.h"
#include "map16_reader.h"
#include "gfx_reader.h"
#include "obj_to_map16.h"

static void usage(const char *argv0) {
  fprintf(stderr,
          "usage:\n"
          "  %s <ROMFILE> <LEVEL_ID> --export-ppm=<OUT.ppm> [--map16=<AllMap16.map16>] [--suite=<NAME>] [--layers=all|layer1|layer2]\n"
          "  %s --mwl <LEVEL.mwl> --export-ppm=<OUT.ppm> [--layers=all|layer1|layer2]\n"
          "\n"
          "notes:\n"
          "  - PNG/APNG/WebP/GIF output is not implemented yet. Use --export-ppm.\n",
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

static void snes15_to_rgb(uint16_t c, uint8_t *r, uint8_t *g, uint8_t *b) {
  // SMW uses 0bbbbbgggggrrrrr (15-bit).
  uint8_t rr = (uint8_t)(c & 0x1F);
  uint8_t gg = (uint8_t)((c >> 5) & 0x1F);
  uint8_t bb = (uint8_t)((c >> 10) & 0x1F);
  // scale 0..31 -> 0..255
  *r = (uint8_t)((rr * 255u) / 31u);
  *g = (uint8_t)((gg * 255u) / 31u);
  *b = (uint8_t)((bb * 255u) / 31u);
}

static void build_fallback_palette(uint8_t pal256[256][3], uint8_t fg_pal, uint8_t bg_pal, uint8_t sprite_pal) {
  // Fallback when ROM does not provide a custom palette blob.
  // We still incorporate the level's palette indices (fg/bg/sprite) so different levels look distinct.
  // This is intentionally simple and deterministic; it is NOT meant to match SMW's full default palette.
  static const uint8_t base8[8][3] = {
    { 200, 200, 200 }, // 0 gray
    { 220, 120, 120 }, // 1 red-ish
    { 120, 220, 120 }, // 2 green-ish
    { 120, 160, 240 }, // 3 blue-ish
    { 220, 200, 120 }, // 4 yellow-ish
    { 200, 120, 220 }, // 5 purple-ish
    { 120, 220, 220 }, // 6 cyan-ish
    { 220, 160, 120 }, // 7 orange-ish
  };
  uint8_t f = (uint8_t)(fg_pal & 7);
  uint8_t b = (uint8_t)(bg_pal & 7);
  uint8_t s = (uint8_t)(sprite_pal & 7);
  for (int p = 0; p < 16; p++) {
    uint8_t hue = (uint8_t)((p + f + b + (s * 3)) & 7);
    uint8_t br = base8[hue][0], bg = base8[hue][1], bb = base8[hue][2];
    for (int i = 0; i < 16; i++) {
      // Create 16 shades by mixing toward black.
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
                       const uint8_t px64[64],
                       const uint8_t pal_rgb[16][3],
                       int hflip, int vflip) {
  for (uint32_t yy = 0; yy < 8; yy++) {
    uint32_t y = y0 + yy;
    if (y >= h) continue;
    for (uint32_t xx = 0; xx < 8; xx++) {
      uint32_t x = x0 + xx;
      if (x >= w) continue;
      uint32_t sx = (uint32_t)(hflip ? (7 - (int)xx) : (int)xx);
      uint32_t sy = (uint32_t)(vflip ? (7 - (int)yy) : (int)yy);
      uint8_t c = px64[sy * 8 + sx] & 0x0F;
      if (c == 0) continue; // transparent
      uint32_t idx = (y * w + x) * 3u;
      rgb[idx + 0] = pal_rgb[c][0];
      rgb[idx + 1] = pal_rgb[c][1];
      rgb[idx + 2] = pal_rgb[c][2];
    }
  }
}

typedef struct {
  uint8_t *rgb;
  uint32_t W, H;
  const Map16Data *map16;
  const uint8_t (*pal256)[3];
  Rom *rom;
  GfxCache *gfxc;
  char *err;
  size_t errcap;
} RenderCtx;

static void draw_map16_at(RenderCtx *rc, uint16_t map16_id, uint32_t x_tile, uint32_t y_tile) {
  if (!rc || !rc->rgb || !rc->map16 || !rc->pal256 || !rc->rom || !rc->gfxc) return;

  Map16Tile t;
  if (!map16_get(rc->map16, map16_id, &t)) {
    draw_missing_tile(rc->rgb, rc->W, rc->H, x_tile * 16u, y_tile * 16u, 16u, 0, 0, 0);
    return;
  }
  for (int si = 0; si < 4; si++) {
    uint16_t w0 = t.w[si];
    uint16_t tile8 = (uint16_t)(w0 & 0x03FFu);
    int hflip = (w0 >> 10) & 1;
    int vflip = (w0 >> 11) & 1;
    uint8_t pal = (uint8_t)((w0 >> 13) & 0x7);
    uint8_t palrgb[16][3];
    for (int c = 0; c < 16; c++) {
      int idx = (int)pal * 16 + c;
      palrgb[c][0] = rc->pal256[idx & 0xFF][0];
      palrgb[c][1] = rc->pal256[idx & 0xFF][1];
      palrgb[c][2] = rc->pal256[idx & 0xFF][2];
    }

    uint8_t px64[64];
    int okpx = 0;
    const GfxBlob *gfx = NULL;
    uint8_t page = (uint8_t)((tile8 >> 8) & 0x03);
    uint8_t file_id = (uint8_t)(0x00 + page);
    uint16_t local_tile = (uint16_t)(tile8 & 0x00FFu);
    if (gfxcache_get(rc->rom, rc->gfxc, file_id, &gfx, rc->err, rc->errcap) && gfx && gfx->bytes && gfx->len) {
      okpx = snes4bpp_decode_tile(gfx->bytes, gfx->len, local_tile, px64);
    }
    uint32_t px = x_tile * 16u + (uint32_t)(si == 1 || si == 3 ? 8 : 0);
    uint32_t py = y_tile * 16u + (uint32_t)(si >= 2 ? 8 : 0);
    if (!okpx) {
      draw_missing_tile(rc->rgb, rc->W, rc->H, px, py, 8u, palrgb[1][0], palrgb[1][1], palrgb[1][2]);
      continue;
    }
    blit_tile8(rc->rgb, rc->W, rc->H, px, py, px64, palrgb, hflip, vflip);
  }
}

static int emit_draw_fn(const EmittedMap16 *t, void *ctx) {
  if (!t || !ctx) return 0;
  RenderCtx *rc = (RenderCtx *)ctx;
  draw_map16_at(rc, t->map16_tile, t->x_tile, t->y_tile);
  return 1;
}

enum {
  LV_LAYERS_LAYER1 = 1,
  LV_LAYERS_LAYER2 = 2,
};

static int render_level_ppm_from_rom(const char *rom_path, uint16_t level_id,
                                     const char *map16_path,
                                     const char *out_ppm,
                                     int layers_mask) {
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

  Map16Data map16;
  memset(&map16, 0, sizeof(map16));
  if (!map16_path || !*map16_path) {
    fprintf(stderr, "Missing Map16 path (--map16= or --suite=)\n");
    levelinfo_free(&info);
    rom_free(&rom);
    return 0;
  }
  if (!map16_load_file(map16_path, &map16, err, sizeof(err))) {
    fprintf(stderr, "Map16 load failed: %s\n", err);
    levelinfo_free(&info);
    rom_free(&rom);
    return 0;
  }

  // GFX cache + a simple tile-number->GFX mapping.
  // Assumption for MVP: 8x8 tile indices 0x000..0x3FF map to four 256-tile pages:
  // page0->GFX00, page1->GFX01, page2->GFX02, page3->GFX03.
  // This is NOT a full SMW/LM VRAM simulation (bypass lists, FG/BG sets, sprites, etc.).
  GfxCache gfxc;
  memset(&gfxc, 0, sizeof(gfxc));
  if (!gfxcache_init(&gfxc, 8, err, sizeof(err))) {
    fprintf(stderr, "GFX cache init failed: %s\n", err);
    map16_free(&map16);
    levelinfo_free(&info);
    rom_free(&rom);
    return 0;
  }

  // Build palette: use custom palette when present, else grayscale fallback.
  uint8_t pal256[256][3];
  for (int i = 0; i < 256; i++) { pal256[i][0] = (uint8_t)i; pal256[i][1] = (uint8_t)i; pal256[i][2] = (uint8_t)i; }
  uint8_t back_r = 0, back_g = 0, back_b = 0;
  if (info.palette_present && info.palette_bytes && info.palette_len >= 514) {
    // payload is 257 u16 colors (LE); first is back area color.
    uint16_t back = (uint16_t)(info.palette_bytes[0] | ((uint16_t)info.palette_bytes[1] << 8));
    snes15_to_rgb(back, &back_r, &back_g, &back_b);
    for (int i = 0; i < 256; i++) {
      size_t off = (size_t)(1 + i) * 2u;
      uint16_t c = (uint16_t)(info.palette_bytes[off] | ((uint16_t)info.palette_bytes[off + 1] << 8));
      snes15_to_rgb(c, &pal256[i][0], &pal256[i][1], &pal256[i][2]);
    }
  } else {
    build_fallback_palette(pal256, info.primary.fg_palette, info.primary.bg_palette, info.primary.sprite_palette);
  }

  // Canvas size: show the whole level width (by screens), with a stable default height.
  uint32_t screens = 1;
  if (info.primary.length_in_screens == -1) screens = 32;
  else if (info.primary.length_in_screens > 0) screens = (uint32_t)info.primary.length_in_screens;
  uint32_t tiles_h = 27; // common LM horizontal level height
  if (info.primary.vertical_scroll_set) tiles_h = 32;
  uint32_t W = screens * 16u * 16u; // screens * 256px
  uint32_t H = tiles_h * 16u;
  uint8_t *rgb = (uint8_t *)malloc((size_t)W * (size_t)H * 3u);
  if (!rgb) {
    fprintf(stderr, "Out of memory allocating canvas\n");
    gfxcache_free(&gfxc);
    map16_free(&map16);
    levelinfo_free(&info);
    rom_free(&rom);
    return 0;
  }
  for (size_t p = 0, n = (size_t)W * (size_t)H; p < n; p++) {
    rgb[p * 3 + 0] = back_r;
    rgb[p * 3 + 1] = back_g;
    rgb[p * 3 + 2] = back_b;
  }

  RenderCtx rc;
  memset(&rc, 0, sizeof(rc));
  rc.rgb = rgb;
  rc.W = W;
  rc.H = H;
  rc.map16 = &map16;
  rc.pal256 = pal256;
  rc.rom = &rom;
  rc.gfxc = &gfxc;
  rc.err = err;
  rc.errcap = sizeof(err);

  // Render layer2 first (under layer1).
  if ((layers_mask & LV_LAYERS_LAYER2) && info.layer2_data_ptr_snes) {
    if (info.layer2_is_bg_tilemap && info.layer2_bg_tiles && info.layer2_bg_width && info.layer2_bg_height) {
      uint8_t w2 = info.layer2_bg_width;
      uint8_t h2 = info.layer2_bg_height;
      for (uint8_t yy = 0; yy < h2; yy++) {
        for (uint8_t xx = 0; xx < w2; xx++) {
          uint16_t tid = info.layer2_bg_tiles[(size_t)yy * (size_t)w2 + xx];
          if (tid == 0) continue;
          draw_map16_at(&rc, tid, xx, yy);
        }
      }
    } else if (info.layer2_objects && info.layer2_objects_count) {
      for (size_t i = 0; i < info.layer2_objects_count; i++) {
        const LevelObject *o = &info.layer2_objects[i];
        uint32_t absx = (uint32_t)o->x_position + (uint32_t)o->screen_number * 16u;
        uint32_t y = (uint32_t)o->y_position;
        if (object_emit_map16_tiles(o, emit_draw_fn, &rc) != OBJMAP_HANDLED) {
          draw_missing_tile(rgb, W, H, absx * 16u, y * 16u, 16u, 0, 0, 255);
        }
      }
    }
  }

  // Render objects:
  // - LM direct-map16 objects (decoded) use real Map16 + (baseline) graphics.
  // - everything else is at least marked with a missing-visual box at its placement.
  if (layers_mask & LV_LAYERS_LAYER1) {
    for (size_t i = 0; i < info.objects_count; i++) {
      const LevelObject *o = &info.objects[i];
      uint32_t absx = (uint32_t)o->x_position + (uint32_t)o->screen_number * 16u;
      uint32_t y = (uint32_t)o->y_position;

      if (object_emit_map16_tiles(o, emit_draw_fn, &rc) != OBJMAP_HANDLED) {
        draw_missing_tile(rgb, W, H, absx * 16u, y * 16u, 16u, 0, 0, 0);
      }
    }
  }

  int ok = write_ppm(out_ppm, rgb, W, H);
  if (!ok) fprintf(stderr, "Failed writing %s\n", out_ppm);

  free(rgb);
  gfxcache_free(&gfxc);
  map16_free(&map16);
  levelinfo_free(&info);
  rom_free(&rom);
  return ok;
}

int main(int argc, char **argv) {
  if (argc < 2) {
    usage(argv[0]);
    return 2;
  }

  const char *rom_path = NULL;
  const char *mwl_path = NULL;
  const char *gfx_in_dir = NULL;
  const char *exgfx_in_dir = NULL;
  const char *palette_in_file = NULL;
  const char *layers = "all";
  const char *export_png = NULL;
  const char *export_ppm = NULL;
  const char *map16_path = NULL;
  const char *suite = NULL;

  uint16_t level_id = 0;
  int have_level_id = 0;

  // Input mode:
  // - ROM mode: argv[1]=rom, argv[2]=level_id
  // - MWL mode: --mwl <file>
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
    if (strncmp(a, "--gfx-in=", 9) == 0) gfx_in_dir = a + 9;
    else if (strncmp(a, "--exgfx-in=", 11) == 0) exgfx_in_dir = a + 11;
    else if (strncmp(a, "--palette-in=", 13) == 0) palette_in_file = a + 13;
    else if (strncmp(a, "--layers=", 9) == 0) layers = a + 9;
    else if (strncmp(a, "--export-png=", 13) == 0) export_png = a + 13;
    else if (strncmp(a, "--export-ppm=", 13) == 0) export_ppm = a + 13;
    else if (strncmp(a, "--map16=", 8) == 0) map16_path = a + 8;
    else if (strncmp(a, "--suite=", 8) == 0) suite = a + 8;
    else if (strcmp(a, "--help") == 0 || strcmp(a, "-h") == 0) {
      usage(argv[0]);
      return 0;
    } else {
      fprintf(stderr, "Unknown option: %s\n", a);
      return 2;
    }
  }

  if (!export_ppm || !*export_ppm) {
    fprintf(stderr, "Missing required --export-ppm=<OUT.ppm>\n");
    return 2;
  }

  // Load input.
  char err[512];
  if (mwl_path) {
    MwlParsed mwl;
    memset(&mwl, 0, sizeof(mwl));
    if (!mwl_parse_file(mwl_path, &mwl, err, sizeof(err))) {
      fprintf(stderr, "MWL parse failed: %s\n", err);
      return 1;
    }
    // For skeleton: ensure Layer1 exists.
    if (!mwl.layer1.bytes || mwl.layer1.len == 0) {
      fprintf(stderr, "MWL missing Layer1 payload\n");
      mwl_parsed_free(&mwl);
      return 1;
    }
    mwl_parsed_free(&mwl);
    fprintf(stderr, "MWL rendering not implemented yet.\n");
    return 1;
  } else {
    if (!rom_path || !have_level_id) {
      usage(argv[0]);
      return 2;
    }
  }

  int layers_mask = LV_LAYERS_LAYER1 | LV_LAYERS_LAYER2;
  if (strcmp(layers, "all") == 0) {
    layers_mask = LV_LAYERS_LAYER1 | LV_LAYERS_LAYER2;
  } else if (strcmp(layers, "layer1") == 0) {
    layers_mask = LV_LAYERS_LAYER1;
  } else if (strcmp(layers, "layer2") == 0) {
    layers_mask = LV_LAYERS_LAYER2;
  } else {
    fprintf(stderr, "Invalid --layers=%s (expected all|layer1|layer2)\n", layers);
    return 2;
  }

  (void)gfx_in_dir;
  (void)exgfx_in_dir;
  (void)palette_in_file;
  (void)export_png;

  // Determine map16 path.
  char suite_map16[256];
  if ((!map16_path || !*map16_path) && suite && *suite) {
    snprintf(suite_map16, sizeof(suite_map16), "test/%s/AllMap16.map16", suite);
    map16_path = suite_map16;
  }

  if (!render_level_ppm_from_rom(rom_path, level_id, map16_path, export_ppm, layers_mask)) return 1;
  return 0;
}

