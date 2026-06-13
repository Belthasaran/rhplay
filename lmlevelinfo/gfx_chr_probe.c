/* Scan GFX files to match LM reference muncher subtiles — ground truth for CHR routing. */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "gfx_chr_probe.h"
#include "gfx_reader.h"
#include "gfx_route.h"
#include "level_parse.h"
#include "lm_tables.h"
#include "lv_ppm_compare.h"
#include "palette_rom.h"
#include "romutil.h"

typedef struct {
  uint8_t r, g, b;
} Rgb;

static Rgb pal_color(const uint8_t pal256[256][3], uint8_t row, uint8_t idx) {
  Rgb c = {0, 0, 0};
  if (row >= 8) return c;
  int i = (int)row * 16 + (int)(idx & 0x0Fu);
  c.r = pal256[i][0];
  c.g = pal256[i][1];
  c.b = pal256[i][2];
  return c;
}

static void blit_idx8_rgb(uint8_t out[64][3], const uint8_t idx[64], const uint8_t pal256[256][3], uint8_t pal_row,
                          int hflip, int vflip) {
  for (int y = 0; y < 8; y++) {
    for (int x = 0; x < 8; x++) {
      int sx = hflip ? (7 - x) : x;
      int sy = vflip ? (7 - y) : y;
      uint8_t pi = idx[sy * 8 + sx];
      if (pi == 0) {
        out[y * 8 + x][0] = 0;
        out[y * 8 + x][1] = 0;
        out[y * 8 + x][2] = 0;
        continue;
      }
      Rgb c = pal_color(pal256, pal_row, pi);
      out[y * 8 + x][0] = c.r;
      out[y * 8 + x][1] = c.g;
      out[y * 8 + x][2] = c.b;
    }
  }
}

static int rgb_diff_inner(const uint8_t got[64][3], const Rgb ref[64]) {
  int n = 0;
  for (int i = 0; i < 64; i++) {
    if (got[i][0] != ref[i].r || got[i][1] != ref[i].g || got[i][2] != ref[i].b) n++;
  }
  return n;
}

static void extract_ref_sub(const uint8_t *rgb, unsigned w, unsigned tx, unsigned ty, int corner, Rgb out[64]) {
  unsigned cx = tx * 16u + (unsigned)((corner == 1 || corner == 3) ? 8u : 0u);
  unsigned cy = ty * 16u + (unsigned)(corner >= 2 ? 8u : 0u);
  for (int y = 0; y < 8; y++) {
    for (int x = 0; x < 8; x++) {
      size_t o = ((size_t)(cy + (unsigned)y) * (size_t)w + (size_t)(cx + (unsigned)x)) * 3u;
      out[y * 8 + x].r = rgb[o + 0];
      out[y * 8 + x].g = rgb[o + 1];
      out[y * 8 + x].b = rgb[o + 2];
    }
  }
}

static uint8_t effective_pal_row(uint8_t pal_raw, int custom_palette) {
  uint8_t pal = (uint8_t)(pal_raw & 7u);
  if (custom_palette && pal <= 3u) return (uint8_t)(4u + pal);
  if (!custom_palette && pal <= 3u) return (uint8_t)(4u + pal);
  return pal;
}

typedef struct {
  int diff;
  uint8_t file_id;
  uint16_t local;
  uint8_t pal_row;
  int hflip;
  int vflip;
  uint16_t route_tile8;
} Match;

static int match_better(const Match *a, const Match *b) {
  if (a->diff != b->diff) return a->diff < b->diff;
  return a->local < b->local;
}

static void try_candidate(const GfxBlob *blob, uint16_t route_tile8, uint16_t local, uint8_t file_id, uint8_t pal_row,
                          const uint8_t pal256[256][3], const Rgb ref[64], Match *best) {
  uint8_t idx[64];
  if (!snes4bpp_decode_tile(blob->bytes, blob->len, local, idx)) return;
  for (int hf = 0; hf <= 1; hf++) {
    for (int vf = 0; vf <= 1; vf++) {
      uint8_t rgb64[64][3];
      blit_idx8_rgb(rgb64, idx, pal256, pal_row, hf, vf);
      Match m;
      m.diff = rgb_diff_inner(rgb64, ref);
      m.file_id = file_id;
      m.local = local;
      m.pal_row = pal_row;
      m.hflip = hf;
      m.vflip = vf;
      m.route_tile8 = route_tile8;
      if (match_better(&m, best)) *best = m;
    }
  }
}

static void scan_routed_pair(const GfxBlob *blob, uint8_t file_id, uint16_t route_tile8, uint16_t routed_local,
                             uint8_t pal_row, const uint8_t pal256[256][3], const Rgb ref[64], Match *best) {
  if (!blob || !blob->bytes) return;
  try_candidate(blob, route_tile8, routed_local, file_id, pal_row, pal256, ref, best);
  uint16_t idx_local = gfx_local_tile_index(blob->len, route_tile8);
  if (idx_local != routed_local) {
    try_candidate(blob, route_tile8, idx_local, file_id, pal_row, pal256, ref, best);
  }
}

static void report_routed(const LevelGfxRoute *route, int route_mode, uint16_t chr, uint8_t pal_row,
                          const uint8_t pal256[256][3], Rom *rom, const Rgb ref[64], const char *tag) {
  uint8_t fid = 0;
  uint16_t local = 0;
  gfx_route_resolve_lm_oracle_chr(route, chr, route_mode, &fid, &local);
  Match m = {999, 0, 0, 0, 0, 0, 0};
  GfxBlob blob;
  memset(&blob, 0, sizeof(blob));
  char err[256];
  if (gfx_load_from_rom(rom, fid, &blob, err, sizeof(err))) {
    scan_routed_pair(&blob, fid, chr, local, pal_row, pal256, ref, &m);
    gfxblob_free(&blob);
  }
  uint8_t van_page = (uint8_t)((chr >> 8) & 0x03u);
  uint8_t van_fid = gfx_route_vanilla_file_for_page(route, van_page);
  if (van_fid != 0 && van_fid != fid) {
    GfxBlob vb;
    memset(&vb, 0, sizeof(vb));
    if (gfx_load_from_rom(rom, van_fid, &vb, err, sizeof(err))) {
      scan_routed_pair(&vb, van_fid, chr, (uint16_t)(chr & 0x7Fu), pal_row, pal256, ref, &m);
      gfxblob_free(&vb);
    }
  }
  printf("  %s chr=0x%03X route_mode=%d best_routed diff=%d file=0x%02X local=0x%03X hf=%d vf=%d\n", tag,
         (unsigned)chr, route_mode, m.diff, (unsigned)m.file_id, (unsigned)m.local, m.hflip, m.vflip);
}

static void scan_file_for_ref(const GfxBlob *blob, uint8_t file_id, uint16_t route_tile8, uint8_t pal_row,
                              const uint8_t pal256[256][3], const Rgb ref[64], Match *best) {
  if (!blob || !blob->bytes || blob->len < 32u) return;
  size_t ntiles = blob->len / 32u;
  uint16_t locals[4];
  size_t nloc = 0;
  locals[nloc++] = (uint16_t)(route_tile8 & 0x7Fu);
  locals[nloc++] = gfx_local_tile_index(blob->len, route_tile8);
  if ((route_tile8 & 0xFFu) != locals[1]) locals[nloc++] = (uint16_t)(route_tile8 & 0xFFu);
  for (size_t li = 0; li < ntiles && li < 512u; li++) {
    int known = 0;
    for (size_t k = 0; k < nloc; k++) {
      if (locals[k] == li) {
        known = 1;
        break;
      }
    }
    if (!known && li > 0xFFu) continue;
    if (!known && ntiles <= 128u && li >= 128u) continue;
    try_candidate(blob, route_tile8, (uint16_t)li, file_id, pal_row, pal256, ref, best);
  }
}

static void print_match(int si, const char *label, const Match *m) {
  printf("  sub=%d %s diff=%d file=0x%02X local=0x%03X route_tile8=0x%03X pal_row=%u hf=%d vf=%d\n", si, label,
         m->diff, (unsigned)m->file_id, (unsigned)m->local, (unsigned)m->route_tile8, (unsigned)m->pal_row, m->hflip,
         m->vflip);
}

static void route_oracle_subtile(const LevelGfxRoute *route, uint16_t chr, uint8_t *fid, uint16_t *local) {
  gfx_route_resolve_lm_oracle_chr(route, chr, GFX_ROUTE_MODE_BYPASS, fid, local);
}

static void route_map16_subtile(const LevelGfxRoute *route, uint16_t tile8, uint8_t *fid, uint16_t *local) {
  gfx_route_resolve_subtile(route, tile8, GFX_ROUTE_MODE_BYPASS, fid, local);
}

int main(int argc, char **argv) {
  const char *rom_path = "test/akogare/orig_Ako.sfc";
  const char *ref_ppm = "test/akogare/Level109_l1only_gridlines.ppm";
  unsigned munch_tx = 74u, munch_ty = 22u;
  if (argc >= 2) rom_path = argv[1];
  if (argc >= 3) ref_ppm = argv[2];

  Rom rom;
  char err[512];
  if (!rom_load(&rom, rom_path, err, sizeof(err))) {
    fprintf(stderr, "rom_load: %s\n", err);
    return 1;
  }
  LmTables tables;
  if (!lm_resolve_tables(&rom, &tables, err, sizeof(err))) {
    fprintf(stderr, "tables: %s\n", err);
    rom_free(&rom);
    return 1;
  }
  LevelInfo info;
  memset(&info, 0, sizeof(info));
  if (!parse_level_info(&rom, &tables, 0x109, &info, err, sizeof(err))) {
    fprintf(stderr, "parse: %s\n", err);
    rom_free(&rom);
    return 1;
  }

  LevelGfxRoute route;
  gfx_route_build(&route, &info.primary, info.exgfx_bytes, info.exgfx_len);

  uint8_t pal256[256][3];
  uint8_t br = 0, bg = 0, bb = 0;
  palette_build_for_level(&rom, &info, pal256, &br, &bg, &bb);
  int custom_palette = info.palette_present ? 1 : 0;

  unsigned ref_w = 0, ref_h = 0;
  uint8_t *ref_rgb = NULL;
  if (!lv_ppm_read_rgb(ref_ppm, &ref_w, &ref_h, &ref_rgb)) {
    fprintf(stderr, "ppm read failed: %s\n", ref_ppm);
    levelinfo_free(&info);
    rom_free(&rom);
    return 1;
  }

  Rgb ref_sub[4][64];
  /* Screen corners: 0=TL, 1=TR, 2=BL, 3=BR.
   * Muncher FG_pages subs are listed in screen order (05C 05E 05D 05F). */
  static const int oracle_to_screen[4] = {0, 1, 2, 3};
  for (int si = 0; si < 4; si++) {
    extract_ref_sub(ref_rgb, ref_w, munch_tx, munch_ty, oracle_to_screen[si], ref_sub[si]);
  }

  static const uint16_t oracle_chr[4] = {0x186, 0x180, 0x193, 0x183};
  static const uint16_t vanilla_chr[4] = {0x05C, 0x05E, 0x05D, 0x05F};
  static const uint8_t oracle_pal_raw = 2u;
  static const uint8_t vanilla_pal_raw = 6u;
  uint8_t oracle_pal = effective_pal_row(oracle_pal_raw, custom_palette);
  uint8_t vanilla_pal = effective_pal_row(vanilla_pal_raw, custom_palette);

  uint8_t file_ids[64];
  size_t nf = gfx_route_collect_preload_ids(&route, file_ids, sizeof(file_ids));

  printf("GFX_CHR_PROBE level=0x109 tile=(%u,%u) custom_palette=%d oracle_pal_row=%u vanilla_pal_row=%u\n",
         munch_tx, munch_ty, custom_palette, (unsigned)oracle_pal, (unsigned)vanilla_pal);
  printf("GFX_CHR_PROBE route pages:");
  for (int p = 0; p < 4; p++) printf(" p%d=0x%02X", p, (unsigned)route.file_id_for_page[p]);
  printf("\n");
  for (int s = 0; s < GFX_SLOT_COUNT; s++) {
    if (route.slot_file_id[s] != 0) {
      printf("GFX_CHR_PROBE slot=%2d %8s file=0x%02X raw=0x%04X\n", s, gfx_route_slot_name(s),
             (unsigned)route.slot_file_id[s], (unsigned)route.slot_raw_u16[s]);
    }
  }
  printf("GFX_CHR_PROBE lm_linear (chr>>8 page, chr&0xFF local on slot file):\n");
  static const uint8_t kLmPageSlot[4] = {GFX_SLOT_SP1, GFX_SLOT_SP2, GFX_SLOT_FG1, GFX_SLOT_FG2};
  for (int si = 0; si < 4; si++) {
    uint16_t chr = oracle_chr[si];
    int lm_page = (int)((chr >> 8) & 0x03u);
    uint16_t lm_local = (uint16_t)(chr & 0xFFu);
    uint8_t slot = kLmPageSlot[lm_page];
    uint8_t bypass_fid = gfx_route_file_for_sprite_slot_mode(&route, (int)slot, GFX_ROUTE_MODE_BYPASS);
    uint8_t van_fid = gfx_route_vanilla_file_for_page(&route, lm_page);
    Match bypass_m = {999, 0, 0, 0, 0, 0, 0};
    Match van_m = {999, 0, 0, 0, 0, 0, 0};
    if (bypass_fid) {
      GfxBlob blob;
      memset(&blob, 0, sizeof(blob));
      if (gfx_load_from_rom(&rom, bypass_fid, &blob, err, sizeof(err))) {
        scan_routed_pair(&blob, bypass_fid, chr, lm_local, oracle_pal, pal256, ref_sub[si], &bypass_m);
        gfxblob_free(&blob);
      }
    }
    if (van_fid) {
      GfxBlob blob;
      memset(&blob, 0, sizeof(blob));
      if (gfx_load_from_rom(&rom, van_fid, &blob, err, sizeof(err))) {
        scan_routed_pair(&blob, van_fid, chr, lm_local, oracle_pal, pal256, ref_sub[si], &van_m);
        gfxblob_free(&blob);
      }
    }
    printf("  si=%d chr=0x%03X lm_page=%d slot=%s bypass_fid=0x%02X van_fid=0x%02X lm_local=0x%02X\n", si,
           (unsigned)chr, lm_page, gfx_route_slot_name((int)slot), (unsigned)bypass_fid, (unsigned)van_fid,
           (unsigned)lm_local);
    print_match(si, "lm_bypass", &bypass_m);
    print_match(si, "lm_vanilla", &van_m);

    unsigned hi = (unsigned)((chr >> 8) & 0x0Fu);
    int slot2 = (int)hi + (int)GFX_SLOT_BG2;
    uint8_t slot2_fid = gfx_route_file_for_sprite_slot_mode(&route, slot2, GFX_ROUTE_MODE_BYPASS);
    Match slot2_m = {999, 0, 0, 0, 0, 0, 0};
    if (slot2_fid) {
      GfxBlob blob;
      memset(&blob, 0, sizeof(blob));
      if (gfx_load_from_rom(&rom, slot2_fid, &blob, err, sizeof(err))) {
        uint16_t low = (uint16_t)(chr & 0xFFu);
        uint16_t loc2 = (low >= 0x80u) ? (uint16_t)(low - 0x80u) : (uint16_t)(low & 0x7Fu);
        scan_routed_pair(&blob, slot2_fid, chr, loc2, oracle_pal, pal256, ref_sub[si], &slot2_m);
        scan_routed_pair(&blob, slot2_fid, chr, low, oracle_pal, pal256, ref_sub[si], &slot2_m);
        gfxblob_free(&blob);
      }
    }
    printf("  si=%d chr=0x%03X slot2=%s fid=0x%02X\n", si, (unsigned)chr, gfx_route_slot_name(slot2),
           (unsigned)slot2_fid);
    print_match(si, "slot2_route", &slot2_m);
  }

  for (int si = 0; si < 4; si++) {
    Match best = {999, 0, 0, 0, 0, 0, 0};
    uint8_t rf = 0;
    uint16_t rl = 0;
    route_oracle_subtile(&route, oracle_chr[si], &rf, &rl);
    printf("GFX_CHR_PROBE oracle si=%d chr=0x%03X bypass_route file=0x%02X local=0x%02X\n", si, (unsigned)oracle_chr[si],
           (unsigned)rf, (unsigned)rl);
    report_routed(&route, GFX_ROUTE_MODE_BYPASS, oracle_chr[si], oracle_pal, pal256, &rom, ref_sub[si], "bypass");
    report_routed(&route, GFX_ROUTE_MODE_VANILLA, oracle_chr[si], oracle_pal, pal256, &rom, ref_sub[si], "vanilla");

    for (size_t fi = 0; fi < nf; fi++) {
      GfxBlob blob;
      memset(&blob, 0, sizeof(blob));
      if (!gfx_load_from_rom(&rom, file_ids[fi], &blob, err, sizeof(err))) continue;
      scan_file_for_ref(&blob, file_ids[fi], oracle_chr[si], oracle_pal, pal256, ref_sub[si], &best);
      gfxblob_free(&blob);
    }
    print_match(si, "oracle_best", &best);

    Match vbest = {999, 0, 0, 0, 0, 0, 0};
    route_map16_subtile(&route, vanilla_chr[si], &rf, &rl);
    printf("GFX_CHR_PROBE vanilla si=%d chr=0x%03X current_route file=0x%02X local=0x%03X\n", si, (unsigned)vanilla_chr[si],
           (unsigned)rf, (unsigned)rl);
    for (size_t fi = 0; fi < nf; fi++) {
      GfxBlob blob;
      memset(&blob, 0, sizeof(blob));
      if (!gfx_load_from_rom(&rom, file_ids[fi], &blob, err, sizeof(err))) continue;
      scan_file_for_ref(&blob, file_ids[fi], vanilla_chr[si], vanilla_pal, pal256, ref_sub[si], &vbest);
      gfxblob_free(&blob);
    }
    print_match(si, "vanilla_best", &vbest);
  }

  /* Full-tile compose using oracle_best locals */
  printf("GFX_CHR_PROBE compose_oracle_best:\n");
  Match picks[4];
  for (int si = 0; si < 4; si++) {
    Match best = {999, 0, 0, 0, 0, 0, 0};
    for (size_t fi = 0; fi < nf; fi++) {
      GfxBlob blob;
      memset(&blob, 0, sizeof(blob));
      if (!gfx_load_from_rom(&rom, file_ids[fi], &blob, err, sizeof(err))) continue;
      scan_file_for_ref(&blob, file_ids[fi], oracle_chr[si], oracle_pal, pal256, ref_sub[si], &best);
      gfxblob_free(&blob);
    }
    picks[si] = best;
    print_match(si, "pick", &best);
  }

  uint8_t van2 = gfx_route_vanilla_file_for_page(&route, 2);
  printf("GFX_CHR_PROBE vanilla_page2_file=0x%02X explicit 0x25C-0x25F:\n", (unsigned)van2);
  for (int si = 0; si < 4; si++) {
    uint16_t t8 = (uint16_t)(0x0200u | (vanilla_chr[si] & 0xFFu));
    Match m = {999, 0, 0, 0, 0, 0, 0};
    GfxBlob blob;
    memset(&blob, 0, sizeof(blob));
    if (gfx_load_from_rom(&rom, van2, &blob, err, sizeof(err))) {
      uint8_t rf = 0;
      uint16_t rl = 0;
      gfx_route_resolve_subtile(&route, t8, GFX_ROUTE_MODE_VANILLA, &rf, &rl);
      scan_routed_pair(&blob, van2, t8, rl, oracle_pal, pal256, ref_sub[si], &m);
      gfxblob_free(&blob);
    }
    print_match(si, "van2_t8", &m);
  }

  int full_diff = 0;
  for (int si = 0; si < 4; si++) {
    GfxBlob blob;
    memset(&blob, 0, sizeof(blob));
    if (!gfx_load_from_rom(&rom, picks[si].file_id, &blob, err, sizeof(err))) continue;
    uint8_t idx[64];
    if (!snes4bpp_decode_tile(blob.bytes, blob.len, picks[si].local, idx)) {
      gfxblob_free(&blob);
      continue;
    }
    uint8_t rgb64[64][3];
    blit_idx8_rgb(rgb64, idx, pal256, picks[si].pal_row, picks[si].hflip, picks[si].vflip);
    int corner = oracle_to_screen[si];
    unsigned cx = (unsigned)((corner == 1 || corner == 3) ? 8u : 0u);
    unsigned cy = (unsigned)(corner >= 2 ? 8u : 0u);
    for (int y = 0; y < 8; y++) {
      for (int x = 0; x < 8; x++) {
        size_t o = ((size_t)(munch_ty * 16u + cy + (unsigned)y) * ref_w + (size_t)(munch_tx * 16u + cx + (unsigned)x)) * 3u;
        if (ref_rgb[o] != rgb64[y * 8 + x][0] || ref_rgb[o + 1] != rgb64[y * 8 + x][1] ||
            ref_rgb[o + 2] != rgb64[y * 8 + x][2]) {
          full_diff++;
        }
      }
    }
    gfxblob_free(&blob);
  }
  printf("GFX_CHR_PROBE compose_scan_best full_tile_diff=%d\n", full_diff);

  free(ref_rgb);
  levelinfo_free(&info);
  rom_free(&rom);
  return 0;
}
