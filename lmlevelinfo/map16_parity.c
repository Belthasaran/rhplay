#include "map16_parity.h"

#define _POSIX_C_SOURCE 200809L
#include <dirent.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>

#include "gfx_chr_probe.h"
#include "map16_fg_oracle.h"
#include "map16_lm16.h"
#include "map16_reader.h"
#include "map16_text.h"
#include "romutil.h"

static int g_failures = 0;

static void failf(const char *fmt, ...) {
  va_list ap;
  va_start(ap, fmt);
  fprintf(stderr, "FAIL: ");
  vfprintf(stderr, fmt, ap);
  fprintf(stderr, "\n");
  va_end(ap);
  g_failures++;
}

static int path_exists(const char *path) {
  struct stat st;
  return path && path[0] && stat(path, &st) == 0;
}

static int path_is_dir(const char *path) {
  struct stat st;
  if (!path || stat(path, &st) != 0) return 0;
  return S_ISDIR(st.st_mode);
}

static int subs_match_words(const Map16TextSub subs[4], const Map16Tile *tile) {
  Map16Tile enc;
  map16_text_sub_to_map16_tile(subs, &enc);
  return map16_text_tile_words_equal(&enc, tile);
}

static int compare_sub_semantics(const Map16TextSub *text_sub, uint16_t word) {
  Map16TextSub dec;
  map16_text_decode_sub_word(word, &dec);
  return dec.chr == text_sub->chr && dec.pal == text_sub->pal && dec.hflip == text_sub->hflip &&
         dec.vflip == text_sub->vflip && dec.priority == text_sub->priority;
}

typedef struct {
  char name[64];
  char resources[256];
  char map16_path[256];
  int has_binary;
} ParitySuite;

static int discover_suites(ParitySuite *suites, size_t cap, size_t *out_n) {
  if (!suites || !out_n) return 0;
  *out_n = 0;
  DIR *d = opendir("test");
  if (!d) return 0;
  struct dirent *ent;
  while ((ent = readdir(d)) != NULL) {
    if (ent->d_name[0] == '.' || ent->d_name[0] == '_') continue;
    char hdr[512];
    snprintf(hdr, sizeof(hdr), "test/%s/resources/all_map16/header.txt", ent->d_name);
    if (!path_exists(hdr)) continue;
    if (*out_n >= cap) break;
    ParitySuite *s = &suites[(*out_n)++];
    snprintf(s->name, sizeof(s->name), "%s", ent->d_name);
    snprintf(s->resources, sizeof(s->resources), "test/%s/resources/all_map16", ent->d_name);
    snprintf(s->map16_path, sizeof(s->map16_path), "test/%s/AllMap16.map16", ent->d_name);
    s->has_binary = path_exists(s->map16_path);
  }
  closedir(d);
  return 1;
}

static int parse_page_file_line(const char *path, uint16_t expected_id, Map16TextTile *out, char *err, size_t errcap) {
  FILE *fp = fopen(path, "r");
  if (!fp) return 0;
  char line[512];
  while (fgets(line, sizeof(line), fp)) {
    int fmt = map16_text_parse_line(line, expected_id, out, err, errcap);
    if (fmt != 0) {
      fclose(fp);
      return fmt;
    }
  }
  fclose(fp);
  return 0;
}

static int scan_text_file(const char *path, int (*fn)(const char *line, uint16_t expected_id, void *ctx), void *ctx) {
  FILE *fp = fopen(path, "r");
  if (!fp) return 0;
  char line[512];
  uint16_t expect = 0;
  int have_expect = 0;
  while (fgets(line, sizeof(line), fp)) {
    const char *p = line;
    while (*p && (*p == ' ' || *p == '\t')) p++;
    if (!p[0] || p[0] == '\n') continue;
    const char *colon = strchr(p, ':');
    if (!colon) continue;
    char idbuf[8];
    size_t idlen = (size_t)(colon - p);
    if (idlen == 0 || idlen >= sizeof(idbuf)) continue;
    memcpy(idbuf, p, idlen);
    idbuf[idlen] = '\0';
    uint16_t tid = 0;
    char *end = NULL;
    unsigned long v = strtoul(idbuf, &end, 16);
    if (end == idbuf || v > 0xFFFFu) continue;
    tid = (uint16_t)v;
    expect = tid;
    have_expect = 1;
    if (!fn(line, expect, ctx)) {
      fclose(fp);
      return 0;
    }
  }
  fclose(fp);
  (void)have_expect;
  return 1;
}

typedef struct {
  const Map16Lm16 *lm;
  size_t checked;
  size_t mismatch;
  const char *suite;
  const char *kind;
} BinaryCmpCtx;

static int cmp_fg_full_line(const char *line, uint16_t expected_id, void *vctx) {
  BinaryCmpCtx *ctx = (BinaryCmpCtx *)vctx;
  Map16TextTile parsed;
  char err[128];
  int fmt = map16_text_parse_line(line, expected_id, &parsed, err, sizeof(err));
  if (fmt == 0 || fmt == MAP16_TEXT_FMT_EMPTY) return 1;
  if (fmt != MAP16_TEXT_FMT_FG_FULL && fmt != MAP16_TEXT_FMT_TILES_ONLY && fmt != MAP16_TEXT_FMT_FG_ACTS_ONLY) return 1;
  ctx->checked++;

  if (!ctx->lm) return 1;

  if (fmt == MAP16_TEXT_FMT_FG_ACTS_ONLY) {
    uint16_t acts = 0;
    if (!map16_lm16_acts_like(ctx->lm, parsed.tile_id, &acts) || acts != parsed.acts_like) {
      ctx->mismatch++;
      failf("[MAP16_PARITY] suite=%s %s acts-only id=0x%04X text=0x%04X bin=0x%04X", ctx->suite, ctx->kind,
            (unsigned)parsed.tile_id, (unsigned)parsed.acts_like, (unsigned)acts);
    }
    if (map16_text_is_tileset_group_specific(parsed.tile_id)) {
      /* Graphics for these IDs live in tileset_group_N.txt (checked in thorough walk). */
    }
    return 1;
  }

  Map16Tile bin;
  int got = 0;
  if (parsed.tile_id >= 0x8000u) {
    got = map16_lm16_bg_tile(ctx->lm, parsed.tile_id, &bin);
  } else {
    got = map16_lm16_fg_text_tile(ctx->lm, parsed.tile_id, &bin);
  }
  if (fmt == MAP16_TEXT_FMT_FG_FULL && parsed.has_acts_like) {
    uint16_t acts = 0;
    if (!map16_lm16_acts_like(ctx->lm, parsed.tile_id, &acts) || acts != parsed.acts_like) {
      ctx->mismatch++;
      failf("[MAP16_PARITY] suite=%s %s acts id=0x%04X text=0x%04X bin=0x%04X", ctx->suite, ctx->kind,
            (unsigned)parsed.tile_id, (unsigned)parsed.acts_like, (unsigned)acts);
    }
  }
  if (fmt == MAP16_TEXT_FMT_FG_FULL || fmt == MAP16_TEXT_FMT_TILES_ONLY) {
    if (!got) {
      ctx->mismatch++;
      failf("[MAP16_PARITY] suite=%s %s missing binary id=0x%04X", ctx->suite, ctx->kind, (unsigned)parsed.tile_id);
      return 1;
    }
    if (!map16_text_tile_words_equal(&parsed.words, &bin)) {
      ctx->mismatch++;
      failf("[MAP16_PARITY] suite=%s %s tile words id=0x%04X", ctx->suite, ctx->kind, (unsigned)parsed.tile_id);
    }
  }
  return 1;
}

static int run_parse_unit_tests(void) {
  struct {
    const char *line;
    uint16_t id;
    int expect_fmt;
    uint16_t expect_words[4];
    uint16_t expect_acts;
  } cases[] = {
      {"003C: 0130 { 0A0 7 x-p  2A2 3 xyp  3A1 5 -yp  1A3 0 --p }", 0x003C, MAP16_TEXT_FMT_FG_FULL, {0, 0, 0, 0}, 0x0130},
      {"04BD: 012F { 05C 6 ---  05E 6 ---  05D 6 ---  05F 6 --- }", 0x04BD, MAP16_TEXT_FMT_FG_FULL, {0x185C, 0x185E, 0x185D, 0x185F},
       0x012F},
      {"04D2: 0130 { 186 2 -y-  180 2 -y-  193 2 -y-  183 2 -y- }", 0x04D2, MAP16_TEXT_FMT_FG_FULL, {0x8986, 0x8980, 0x8993, 0x8983},
       0x0130},
      {"003C: ~", 0x003C, MAP16_TEXT_FMT_EMPTY, {0x1004, 0x1004, 0x1004, 0x1004}, 0x0130},
      {"0073: 012F", 0x0073, MAP16_TEXT_FMT_FG_ACTS_ONLY, {0, 0, 0, 0}, 0x012F},
      {"8000:      { 0F8 0 ---  0F8 0 ---  0F8 0 ---  0F8 0 --- }", 0x8000, MAP16_TEXT_FMT_TILES_ONLY, {0, 0, 0, 0}, 0},
  };

  for (size_t ci = 0; ci < sizeof(cases) / sizeof(cases[0]); ci++) {
    Map16TextTile t;
    char err[128];
    int fmt = map16_text_parse_line(cases[ci].line, cases[ci].id, &t, err, sizeof(err));
    if (fmt != cases[ci].expect_fmt) {
      failf("[map16_text_parse_unit] case %zu fmt=%d expect=%d (%s)", ci, fmt, cases[ci].expect_fmt, err);
      continue;
    }
    if (fmt == MAP16_TEXT_FMT_FG_FULL || fmt == MAP16_TEXT_FMT_TILES_ONLY || fmt == MAP16_TEXT_FMT_EMPTY) {
      for (int si = 0; si < 4; si++) {
        if (cases[ci].expect_words[si] != 0 && t.words.w[si] != cases[ci].expect_words[si]) {
          failf("[map16_text_parse_unit] case %zu sub=%d word=0x%04X expect=0x%04X", ci, si, (unsigned)t.words.w[si],
                (unsigned)cases[ci].expect_words[si]);
        }
      }
    }
    if (cases[ci].expect_acts != 0 && t.acts_like != cases[ci].expect_acts) {
      failf("[map16_text_parse_unit] case %zu acts=0x%04X expect=0x%04X", ci, (unsigned)t.acts_like,
            (unsigned)cases[ci].expect_acts);
    }
  }
  if (g_failures == 0) printf("PASS: map16_text_parse_unit\n");
  return g_failures == 0;
}

static int run_header_parity_akogare(void) {
  const char *hdr_path = "test/akogare/resources/all_map16/header.txt";
  const char *bin_path = "test/akogare/AllMap16.map16";
  if (!path_exists(hdr_path) || !path_exists(bin_path)) {
    printf("SKIP: map16_text_header_parity (missing akogare fixtures)\n");
    return 1;
  }
  Map16TextHeader text_hdr;
  char err[256];
  if (!map16_text_load_header(hdr_path, &text_hdr, err, sizeof(err))) {
    failf("[map16_text_header_parity] %s", err);
    return 0;
  }
  Map16Lm16 lm;
  if (!map16_lm16_load(bin_path, &lm, err, sizeof(err))) {
    failf("[map16_text_header_parity] %s", err);
    return 0;
  }
  if (!map16_lm16_header_matches_text(&lm, &text_hdr, err, sizeof(err))) {
    failf("[map16_text_header_parity] %s", err);
    map16_lm16_free(&lm);
    return 0;
  }
  map16_lm16_free(&lm);
  printf("PASS: map16_text_header_parity\n");
  return 1;
}

static int run_akogare_spot_tests(void) {
  const char *res = "test/akogare/resources/all_map16";
  const char *bin_path = "test/akogare/AllMap16.map16";
  const char *page04 = "test/akogare/resources/all_map16/global_pages/FG_pages/page_04.txt";
  if (!path_exists(page04) || !path_exists(bin_path)) {
    printf("SKIP: map16_text_akogare_spot (missing fixtures)\n");
    return 1;
  }
  Map16Lm16 lm;
  char err[256];
  if (!map16_lm16_load(bin_path, &lm, err, sizeof(err))) {
    failf("[map16_text_akogare_spot] %s", err);
    return 0;
  }

  struct {
    uint16_t id;
    uint16_t acts;
    uint16_t words[4];
  } spots[] = {
      {0x04BD, 0x012F, {0x185C, 0x185E, 0x185D, 0x185F}},
      {0x04D2, 0x0130, {0x8986, 0x8980, 0x8993, 0x8983}},
      {0x04BE, 0x012F, {0x985E, 0x985C, 0x985F, 0x985D}},
      {0x012F, 0x012F, {0x185C, 0x185E, 0x185D, 0x185F}},
  };

  for (size_t si = 0; si < sizeof(spots) / sizeof(spots[0]); si++) {
    char linepath[512];
    snprintf(linepath, sizeof(linepath), "%s/global_pages/FG_pages/page_%02X.txt", res, (unsigned)(spots[si].id >> 8));
    Map16TextTile parsed;
    int fmt = parse_page_file_line(linepath, spots[si].id, &parsed, err, sizeof(err));
    if (fmt != MAP16_TEXT_FMT_FG_FULL) {
      failf("[map16_text_akogare_spot] parse 0x%04X failed", (unsigned)spots[si].id);
      continue;
    }
    for (int wi = 0; wi < 4; wi++) {
      if (parsed.words.w[wi] != spots[si].words[wi]) {
        failf("[map16_text_akogare_spot] text encode 0x%04X w[%d]=0x%04X expect=0x%04X", (unsigned)spots[si].id, wi,
              (unsigned)parsed.words.w[wi], (unsigned)spots[si].words[wi]);
      }
    }
    Map16Tile bin;
    uint16_t acts = 0;
    if (!map16_lm16_fg_text_tile(&lm, spots[si].id, &bin) || !map16_lm16_acts_like(&lm, spots[si].id, &acts)) {
      failf("[map16_text_akogare_spot] binary read 0x%04X", (unsigned)spots[si].id);
      continue;
    }
    if (!map16_text_tile_words_equal(&parsed.words, &bin) || acts != spots[si].acts) {
      failf("[map16_text_akogare_spot] binary mismatch 0x%04X", (unsigned)spots[si].id);
    }
  }

  /* Pipe cap spot: first entry of pipe_0 */
  const char *pipe0 = "test/akogare/resources/all_map16/pipe_tiles/pipe_0.txt";
  Map16TextTile pipe_tile;
  int pfmt = parse_page_file_line(pipe0, 0x0133, &pipe_tile, err, sizeof(err));
  if (pfmt != MAP16_TEXT_FMT_TILES_ONLY) {
    failf("[map16_text_akogare_spot] pipe_0 parse");
  } else {
    Map16Tile pbin;
    if (!map16_lm16_normal_pipe_tile(&lm, 0, 0, &pbin) || !map16_text_tile_words_equal(&pipe_tile.words, &pbin)) {
      failf("[map16_text_akogare_spot] pipe_0 binary mismatch");
    }
  }

  map16_lm16_free(&lm);
  if (g_failures == 0) printf("PASS: map16_text_akogare_spot\n");
  return g_failures == 0;
}

int map16_parity_run_tier_a(void) {
  g_failures = 0;
  run_parse_unit_tests();
  run_header_parity_akogare();
  run_akogare_spot_tests();
  return g_failures == 0;
}

static int walk_dir_txt(const char *dir, const char *prefix, int (*fn)(const char *path, void *ctx), void *ctx) {
  DIR *d = opendir(dir);
  if (!d) return 1;
  struct dirent *ent;
  while ((ent = readdir(d)) != NULL) {
    if (ent->d_name[0] == '.') continue;
    char path[512];
    snprintf(path, sizeof(path), "%s/%s", dir, ent->d_name);
    if (path_is_dir(path)) {
      if (!walk_dir_txt(path, prefix, fn, ctx)) {
        closedir(d);
        return 0;
      }
      continue;
    }
    size_t nlen = strlen(ent->d_name);
    if (nlen < 5 || strcmp(ent->d_name + nlen - 4, ".txt") != 0) continue;
    if (!fn(path, ctx)) {
      closedir(d);
      return 0;
    }
  }
  closedir(d);
  return 1;
}

static int thorough_file_cb(const char *path, void *vctx) {
  BinaryCmpCtx *ctx = (BinaryCmpCtx *)vctx;
  return scan_text_file(path, cmp_fg_full_line, ctx);
}

static int thorough_tileset_group_cb(const char *path, void *vctx) {
  BinaryCmpCtx *ctx = (BinaryCmpCtx *)vctx;
  if (!ctx->lm) return 1;
  const char *base = strrchr(path, '/');
  if (!base) base = path;
  else base++;
  unsigned group = 0;
  if (sscanf(base, "tileset_group_%u.txt", &group) != 1) return 1;
  FILE *fp = fopen(path, "r");
  if (!fp) return 1;
  char line[512];
  while (fgets(line, sizeof(line), fp)) {
    Map16TextTile parsed;
    char err[128];
    int fmt = map16_text_parse_line(line, 0xFFFFu, &parsed, err, sizeof(err));
    if (fmt != MAP16_TEXT_FMT_TILES_ONLY) continue;
    ctx->checked++;
    Map16Tile bin;
    int got = 0;
    int diag_idx = -1;
    if (group == 0u && map16_text_diagonal_pipe_index(parsed.tile_id, &diag_idx)) {
      got = map16_lm16_diagonal_pipe_tile(ctx->lm, (unsigned)diag_idx, &bin);
    } else {
      got = map16_lm16_tileset_group_tile(ctx->lm, group, parsed.tile_id, &bin);
    }
    if (!got || !map16_text_tile_words_equal(&parsed.words, &bin)) {
      ctx->mismatch++;
      failf("[MAP16_PARITY] suite=%s tileset_group_%u id=0x%04X", ctx->suite, group, (unsigned)parsed.tile_id);
    }
  }
  fclose(fp);
  return 1;
}

static int thorough_pipe_cb(const char *path, void *vctx) {
  BinaryCmpCtx *ctx = (BinaryCmpCtx *)vctx;
  if (!ctx->lm) return 1;
  const char *base = strrchr(path, '/');
  if (!base) base = path;
  else base++;
  unsigned pipe_set = 0;
  if (sscanf(base, "pipe_%u.txt", &pipe_set) != 1) return 1;
  FILE *fp = fopen(path, "r");
  if (!fp) return 1;
  char line[512];
  while (fgets(line, sizeof(line), fp)) {
    Map16TextTile parsed;
    char err[128];
    int fmt = map16_text_parse_line(line, 0xFFFFu, &parsed, err, sizeof(err));
    if (fmt != MAP16_TEXT_FMT_TILES_ONLY) continue;
    int idx = -1;
    if (!map16_text_normal_pipe_index(parsed.tile_id, NULL, &idx)) continue;
    ctx->checked++;
    Map16Tile bin;
    if (!map16_lm16_normal_pipe_tile(ctx->lm, pipe_set, (unsigned)idx, &bin) ||
        !map16_text_tile_words_equal(&parsed.words, &bin)) {
      ctx->mismatch++;
      failf("[MAP16_PARITY] suite=%s pipe_%u id=0x%04X", ctx->suite, pipe_set, (unsigned)parsed.tile_id);
    }
  }
  fclose(fp);
  return 1;
}

int map16_parity_run_tier_b_thorough(void) {
  const char *env = getenv("MAP16_PARITY_THOROUGH");
  if (!env || env[0] != '1') {
    printf("SKIP: map16_parity_thorough (set MAP16_PARITY_THOROUGH=1)\n");
    return 1;
  }
  g_failures = 0;
  ParitySuite suites[32];
  size_t n = 0;
  discover_suites(suites, 32, &n);
  for (size_t si = 0; si < n; si++) {
    BinaryCmpCtx ctx;
    memset(&ctx, 0, sizeof(ctx));
    ctx.suite = suites[si].name;
    ctx.kind = suites[si].resources;
    Map16Lm16 lm;
    char err[256];
    if (suites[si].has_binary) {
      if (!map16_lm16_load(suites[si].map16_path, &lm, err, sizeof(err))) {
        failf("[MAP16_PARITY] suite=%s load %s", suites[si].name, err);
        continue;
      }
      ctx.lm = &lm;
    } else {
      printf("MAP16_PARITY suite=%s SKIP binary parity (no AllMap16.map16)\n", suites[si].name);
    }

    char fgdir[512];
    snprintf(fgdir, sizeof(fgdir), "%s/global_pages/FG_pages", suites[si].resources);
    walk_dir_txt(fgdir, "FG", thorough_file_cb, &ctx);
    char bgdir[512];
    snprintf(bgdir, sizeof(bgdir), "%s/global_pages/BG_pages", suites[si].resources);
    walk_dir_txt(bgdir, "BG", thorough_file_cb, &ctx);
    char tgdir[512];
    snprintf(tgdir, sizeof(tgdir), "%s/tileset_group_specific_tiles", suites[si].resources);
    if (path_is_dir(tgdir)) walk_dir_txt(tgdir, "TG", thorough_tileset_group_cb, &ctx);
    char pipedir[512];
    snprintf(pipedir, sizeof(pipedir), "%s/pipe_tiles", suites[si].resources);
    if (path_is_dir(pipedir)) walk_dir_txt(pipedir, "PIPE", thorough_pipe_cb, &ctx);

    printf("MAP16_PARITY suite=%s fg_checked=%zu fg_mismatch=%zu\n", suites[si].name, ctx.checked, ctx.mismatch);
    if (ctx.lm) map16_lm16_free(&lm);
  }
  if (g_failures == 0) printf("PASS: map16_parity_thorough\n");
  return g_failures == 0;
}

typedef struct {
  Map16Data *m;
  const char *fg_dir;
  size_t checked;
  size_t mismatch;
} ResolveCtx;

static int resolve_line_cb(const char *line, uint16_t expected_id, void *vctx) {
  ResolveCtx *ctx = (ResolveCtx *)vctx;
  Map16TextTile parsed;
  char err[128];
  int fmt = map16_text_parse_line(line, expected_id, &parsed, err, sizeof(err));
  if (fmt != MAP16_TEXT_FMT_FG_FULL) return 1;
  ctx->checked++;
  Map16Tile got;
  int src = 0;
  if (!map16_get_with_src(ctx->m, parsed.tile_id, &got, &src)) {
    ctx->mismatch++;
    failf("[map16_resolve_vs_text] missing 0x%04X", (unsigned)parsed.tile_id);
    return 1;
  }
  for (int si = 0; si < 4; si++) {
    if (!compare_sub_semantics(&parsed.subs[si], got.w[si])) {
      ctx->mismatch++;
      failf("[map16_resolve_vs_text] id=0x%04X sub=%d src=%d", (unsigned)parsed.tile_id, si, src);
      break;
    }
  }
  return 1;
}

static int resolve_page_file(const char *path, void *vctx) {
  return scan_text_file(path, resolve_line_cb, vctx);
}

int map16_parity_run_tier_c_resolve(void) {
  const char *rom_path = "test/akogare/orig_Ako.sfc";
  const char *map16_path = "test/akogare/AllMap16.map16";
  const char *fg_dir = "test/akogare/resources/all_map16/global_pages/FG_pages";
  if (!path_exists(rom_path) || !path_exists(map16_path) || !path_is_dir(fg_dir)) {
    printf("SKIP: map16_resolve_vs_text_oracle (missing akogare ROM/map16/FG)\n");
    return 1;
  }
  Rom rom;
  char err[512];
  if (!rom_load(&rom, rom_path, err, sizeof(err))) {
    failf("[map16_resolve_vs_text] %s", err);
    return 0;
  }
  Map16Data m;
  memset(&m, 0, sizeof(m));
  if (!map16_load_from_rom(&rom, &m, err, sizeof(err))) {
    failf("[map16_resolve_vs_text] %s", err);
    rom_free(&rom);
    return 0;
  }
  if (!map16_merge_file(map16_path, &m, err, sizeof(err))) {
    failf("[map16_resolve_vs_text] merge %s", err);
    map16_free(&m);
    rom_free(&rom);
    return 0;
  }
  if (!map16_load_fg_oracles(fg_dir, &m, err, sizeof(err))) {
    failf("[map16_resolve_vs_text] oracle %s", err);
    map16_free(&m);
    rom_free(&rom);
    return 0;
  }
  map16_attach_rom(&m, &rom);

  g_failures = 0;
  ResolveCtx ctx;
  memset(&ctx, 0, sizeof(ctx));
  ctx.m = &m;
  ctx.fg_dir = fg_dir;
  walk_dir_txt(fg_dir, "FG", resolve_page_file, &ctx);
  printf("MAP16_RESOLVE checked=%zu mismatch=%zu\n", ctx.checked, ctx.mismatch);
  map16_free(&m);
  rom_free(&rom);
  if (g_failures == 0) printf("PASS: map16_resolve_vs_text_oracle\n");
  return g_failures == 0;
}

int map16_parity_run_gfx_muncher_regression(void) {
  char err[512];
  g_failures = 0;
  if (!gfx_chr_probe_muncher_regression("test/akogare/orig_Ako.sfc", "test/akogare/Level109_l1only_gridlines.ppm", 74u, 22u,
                                        err, sizeof(err))) {
    failf("[map16_gfx_muncher_regression] %s", err);
  } else {
    printf("PASS: map16_gfx_muncher_regression\n");
  }
  return g_failures == 0;
}

int map16_parity_run_gfx_coin_regression(void) {
  char err[512];
  g_failures = 0;
  if (!gfx_chr_probe_coin_regression("test/akogare/orig_Ako.sfc", "test/akogare/Level109_l1only_gridlines.ppm", err,
                                     sizeof(err))) {
    failf("[map16_gfx_coin_regression] %s", err);
  } else {
    printf("PASS: map16_gfx_coin_regression\n");
  }
  return g_failures == 0;
}

int map16_parity_cli(int argc, char **argv) {
  int thorough = 0;
  const char *res = NULL;
  const char *bin = NULL;
  for (int i = 1; i < argc; i++) {
    if (strcmp(argv[i], "--thorough") == 0) thorough = 1;
    else if (strcmp(argv[i], "--help") == 0 || strcmp(argv[i], "-h") == 0) {
      printf("Usage: map16-parity [--thorough] <resources/all_map16> [AllMap16.map16]\n");
      return 0;
    } else if (!res) res = argv[i];
    else if (!bin) bin = argv[i];
  }
  if (!res) {
    fprintf(stderr, "map16-parity: missing resources path\n");
    return 1;
  }
  if (thorough) setenv("MAP16_PARITY_THOROUGH", "1", 1);
  g_failures = 0;
  map16_parity_run_tier_a();
  if (thorough) map16_parity_run_tier_b_thorough();
  if (bin && path_exists(bin)) {
    Map16Lm16 lm;
    char err[256];
    if (!map16_lm16_load(bin, &lm, err, sizeof(err))) {
      fprintf(stderr, "load: %s\n", err);
      return 1;
    }
    BinaryCmpCtx ctx = {.lm = &lm, .suite = "cli", .kind = res};
    char fgdir[512];
    snprintf(fgdir, sizeof(fgdir), "%s/global_pages/FG_pages", res);
    walk_dir_txt(fgdir, "FG", thorough_file_cb, &ctx);
    printf("MAP16_PARITY cli checked=%zu mismatch=%zu\n", ctx.checked, ctx.mismatch);
    map16_lm16_free(&lm);
  }
  return g_failures ? 1 : 0;
}
