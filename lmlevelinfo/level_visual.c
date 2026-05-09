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

static void usage(const char *argv0) {
  fprintf(stderr,
          "usage:\n"
          "  %s <ROMFILE> <LEVEL_ID> --export-ppm=<OUT.ppm> [--map16=<AllMap16.map16>] [--suite=<NAME>] [--layers=all|layer1]\n"
          "  %s --mwl <LEVEL.mwl> --export-ppm=<OUT.ppm> [--layers=all|layer1]\n"
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

static int render_layer1_ppm_from_rom(const char *rom_path, uint16_t level_id,
                                      const char *map16_path,
                                      const char *out_ppm) {
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

  // Load a baseline GFX blob for MVP (GFX00). This is not a full VRAM simulation yet.
  GfxBlob gfx00;
  memset(&gfx00, 0, sizeof(gfx00));
  (void)gfx_load_from_rom(&rom, 0x00, &gfx00, err, sizeof(err));

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
  }

  // Determine canvas extents from decoded direct-map16 objects (MVP coverage).
  uint32_t max_tx = 16, max_ty = 16;
  for (size_t i = 0; i < info.objects_count; i++) {
    const LevelObject *o = &info.objects[i];
    if (!o->decoded.present) continue;
    uint32_t absx = (uint32_t)o->x_position + (uint32_t)o->screen_number * 16u;
    uint32_t y = (uint32_t)o->y_position;
    uint32_t wtiles = 0, htiles = 0;
    if (o->decoded.kind == OBJ_DEC_LM_22_MAP16_PAGE0 || o->decoded.kind == OBJ_DEC_LM_23_MAP16_PAGE1) {
      wtiles = o->decoded.u.lm22_23.width_4b ? o->decoded.u.lm22_23.width_4b : 1;
      htiles = o->decoded.u.lm22_23.height_4b ? o->decoded.u.lm22_23.height_4b : 1;
    } else if (o->decoded.kind == OBJ_DEC_LM_27_DIRECT_MAP16_P00_3F || o->decoded.kind == OBJ_DEC_LM_29_DIRECT_MAP16_P40_7F) {
      wtiles = (uint32_t)o->decoded.u.lm27_29.width;
      htiles = (uint32_t)o->decoded.u.lm27_29.height;
      if (!wtiles) wtiles = 1;
      if (!htiles) htiles = 1;
    } else {
      continue;
    }
    uint32_t ex = absx + wtiles;
    uint32_t ey = y + htiles;
    if (ex > max_tx) max_tx = ex;
    if (ey > max_ty) max_ty = ey;
  }
  // Add a small border.
  max_tx += 2;
  max_ty += 2;

  uint32_t W = max_tx * 16u;
  uint32_t H = max_ty * 16u;
  uint8_t *rgb = (uint8_t *)malloc((size_t)W * (size_t)H * 3u);
  if (!rgb) {
    fprintf(stderr, "Out of memory allocating canvas\n");
    gfxblob_free(&gfx00);
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

  // Render decoded Map16 objects (MVP).
  for (size_t i = 0; i < info.objects_count; i++) {
    const LevelObject *o = &info.objects[i];
    if (!o->decoded.present) continue;
    uint32_t absx = (uint32_t)o->x_position + (uint32_t)o->screen_number * 16u;
    uint32_t y = (uint32_t)o->y_position;
    uint16_t base_tile = 0;
    uint32_t wtiles = 0, htiles = 0;
    if (o->decoded.kind == OBJ_DEC_LM_22_MAP16_PAGE0 || o->decoded.kind == OBJ_DEC_LM_23_MAP16_PAGE1) {
      base_tile = o->decoded.u.lm22_23.map16_tile_9b;
      if (o->decoded.kind == OBJ_DEC_LM_23_MAP16_PAGE1) base_tile = (uint16_t)(base_tile + 0x200u);
      wtiles = o->decoded.u.lm22_23.width_4b ? o->decoded.u.lm22_23.width_4b : 1;
      htiles = o->decoded.u.lm22_23.height_4b ? o->decoded.u.lm22_23.height_4b : 1;
    } else if (o->decoded.kind == OBJ_DEC_LM_27_DIRECT_MAP16_P00_3F || o->decoded.kind == OBJ_DEC_LM_29_DIRECT_MAP16_P40_7F) {
      base_tile = o->decoded.u.lm27_29.base_map16;
      wtiles = (uint32_t)o->decoded.u.lm27_29.width;
      htiles = (uint32_t)o->decoded.u.lm27_29.height;
      if (!wtiles) wtiles = 1;
      if (!htiles) htiles = 1;
    } else {
      continue;
    }

    for (uint32_t ty = 0; ty < htiles; ty++) {
      for (uint32_t tx = 0; tx < wtiles; tx++) {
        uint16_t tid = base_tile; // repeat base tile for now
        Map16Tile t;
        if (!map16_get(&map16, tid, &t)) {
          draw_missing_tile(rgb, W, H, (absx + tx) * 16u, (y + ty) * 16u, 16u, 0, 0, 0);
          continue;
        }
        // Draw four 8x8 subtiles.
        for (int si = 0; si < 4; si++) {
          uint16_t w0 = t.w[si];
          uint16_t tile8 = (uint16_t)(w0 & 0x03FFu);
          int hflip = (w0 >> 10) & 1;
          int vflip = (w0 >> 11) & 1;
          uint8_t pal = (uint8_t)((w0 >> 13) & 0x7);
          uint8_t palrgb[16][3];
          for (int c = 0; c < 16; c++) {
            int idx = (int)pal * 16 + c;
            palrgb[c][0] = pal256[idx & 0xFF][0];
            palrgb[c][1] = pal256[idx & 0xFF][1];
            palrgb[c][2] = pal256[idx & 0xFF][2];
          }

          uint8_t px64[64];
          int okpx = 0;
          if (gfx00.bytes && gfx00.len) okpx = snes4bpp_decode_tile(gfx00.bytes, gfx00.len, tile8, px64);
          if (!okpx) {
            // fallback: colored block based on palette
            uint32_t px = (absx + tx) * 16u + (uint32_t)(si == 1 || si == 3 ? 8 : 0);
            uint32_t py = (y + ty) * 16u + (uint32_t)(si >= 2 ? 8 : 0);
            draw_missing_tile(rgb, W, H, px, py, 8u, palrgb[1][0], palrgb[1][1], palrgb[1][2]);
            continue;
          }
          uint32_t px = (absx + tx) * 16u + (uint32_t)(si == 1 || si == 3 ? 8 : 0);
          uint32_t py = (y + ty) * 16u + (uint32_t)(si >= 2 ? 8 : 0);
          blit_tile8(rgb, W, H, px, py, px64, palrgb, hflip, vflip);
        }
      }
    }
  }

  int ok = write_ppm(out_ppm, rgb, W, H);
  if (!ok) fprintf(stderr, "Failed writing %s\n", out_ppm);

  free(rgb);
  gfxblob_free(&gfx00);
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
    Rom rom;
    if (!rom_load(&rom, rom_path, err, sizeof(err))) {
      fprintf(stderr, "ROM load failed: %s\n", err);
      return 1;
    }
    LmTables tables;
    if (!lm_resolve_tables(&rom, &tables, err, sizeof(err))) {
      fprintf(stderr, "ROM table resolve failed: %s\n", err);
      rom_free(&rom);
      return 1;
    }
    LevelInfo info;
    memset(&info, 0, sizeof(info));
    if (!parse_level_info(&rom, &tables, level_id, &info, err, sizeof(err))) {
      fprintf(stderr, "ROM level parse failed: %s\n", err);
      rom_free(&rom);
      return 1;
    }
    levelinfo_free(&info);
    rom_free(&rom);
  }

  (void)gfx_in_dir;
  (void)exgfx_in_dir;
  (void)palette_in_file;
  (void)layers;
  (void)export_png;

  // Determine map16 path.
  char suite_map16[256];
  if ((!map16_path || !*map16_path) && suite && *suite) {
    snprintf(suite_map16, sizeof(suite_map16), "test/%s/AllMap16.map16", suite);
    map16_path = suite_map16;
  }

  if (!render_layer1_ppm_from_rom(rom_path, level_id, map16_path, export_ppm)) return 1;
  return 0;
}

