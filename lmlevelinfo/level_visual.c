#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>

#include "romutil.h"
#include "lm_tables.h"
#include "level_parse.h"
#include "mwl_reader.h"

static void usage(const char *argv0) {
  fprintf(stderr,
          "usage:\n"
          "  %s <ROMFILE> <LEVEL_ID> --export-png=<OUT.png> [--layers=all|layer1|layer2|sprites]\n"
          "  %s --mwl <LEVEL.mwl> [--gfx-in=DIR] [--exgfx-in=DIR] [--palette-in=FILE] --export-png=<OUT.png> [--layers=...]\n"
          "\n"
          "notes:\n"
          "  - This is a skeleton: it loads ROM/MWL and validates inputs, but does not render yet.\n"
          "  - For now, --export-png returns an error explaining the missing renderer.\n",
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
    else if (strcmp(a, "--help") == 0 || strcmp(a, "-h") == 0) {
      usage(argv[0]);
      return 0;
    } else {
      fprintf(stderr, "Unknown option: %s\n", a);
      return 2;
    }
  }

  if (!export_png || !*export_png) {
    fprintf(stderr, "Missing required --export-png=<OUT.png>\n");
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

  fprintf(stderr, "level_visual: rendering not implemented yet (requested %s)\n", export_png);
  return 1;
}

