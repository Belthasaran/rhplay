#pragma once

#include <stddef.h>
#include <stdint.h>

#include "romutil.h"

typedef struct {
  uint16_t w[4];
} Map16Tile;

#define MAP16_SRC_FILE 0
#define MAP16_SRC_ALIAS 1
#define MAP16_SRC_ROM 2
#define MAP16_SRC_SYNTH 3
#define MAP16_SRC_ROM_VANILLA 4
#define MAP16_SRC_CANONICAL 5
#define MAP16_SRC_DEF_REDIRECT 6
#define MAP16_SRC_FG_ORACLE 7

/* Standard LM hack Map16 index space (pages 00-7F x 256). */
#define MAP16_TILE_CAPACITY 0x8000u

typedef struct {
  Map16Tile *tiles;
  size_t tiles_count;
  uint16_t *acts_like; /* parallel behavior table; SIZE_MAX slot = unavailable */
  size_t acts_like_count;
  int is_lm16;
  int loaded_from_rom;
  int synth_vanilla;
  size_t def_redirect_count;
  size_t synth_count;
  size_t alias_hit_count;
  size_t rom_hit_count;
  size_t rom_vanilla_hit_count;
  size_t alias_table_count;
  size_t *alias_index;
  size_t canonical_table_count;
  size_t *canonical_index;
  Rom *rom;
  Map16Tile *fg_oracle_tiles;
  uint8_t *fg_oracle_valid;
  size_t fg_oracle_count;
  size_t fg_oracle_loaded_total;
} Map16Data;

void map16_free(Map16Data *m);

int map16_load_file(const char *path, Map16Data *out, char *err, size_t errcap);

/* Load visual tiles[] and acts_like[] from ROM (primary path for level_visual). */
int map16_load_from_rom(Rom *rom, Map16Data *out, char *err, size_t errcap);

/* Merge drawable slots from an LM16 AllMap16 file (definition pool / stubs). */
int map16_merge_file(const char *path, Map16Data *m, char *err, size_t errcap);

void map16_set_synth_vanilla(Map16Data *m, int enable);

void map16_attach_rom(Map16Data *m, Rom *rom);

int map16_get(Map16Data *m, uint16_t tile_id, Map16Tile *out);

int map16_get_with_src(Map16Data *m, uint16_t tile_id, Map16Tile *out, int *src_out);

int map16_get_raw(const Map16Data *m, uint16_t tile_id, Map16Tile *out);

int map16_get_alias_index(const Map16Data *m, uint16_t tile_id, size_t *out_idx);

int map16_get_canonical_index(const Map16Data *m, uint16_t tile_id, size_t *out_idx);

/* Acts-like is behavior only (not used for CHR resolve). */
int map16_get_acts_like(const Map16Data *m, uint16_t tile_id, uint16_t *out_acts_like);

/* Follow acts-like chain to terminal vanilla behavior id (< 0x200). */
int map16_resolve_acts_like_chain(const Map16Data *m, uint16_t tile_id, uint16_t *out_terminal);

int map16_tile_is_empty(const Map16Tile *t);

int map16_tile_needs_resolve(const Map16Tile *t);

/* Full muncher quad: page-0 locals 0x5C-0x5F (one per corner). */
int map16_tile_is_full_muncher_quad(const Map16Tile *t);

/* Acts-like 0x012F + full muncher quad locals → BG1/LG3 GFX template in level_visual. */
int map16_tile_uses_012f_muncher_gfx(const Map16Data *m, uint16_t tile_id, const Map16Tile *resolved);

/* Acts-like 0x002B + coin quad locals 0x6C-0x6F → SP1/SP4/LG3/LG1 GFX template in level_visual. */
int map16_tile_uses_002b_coin_gfx(const Map16Data *m, uint16_t tile_id, const Map16Tile *resolved);

/* Hack-page placement row: 0x78 corners + 0x4C-0x4F stripe locals (LM L1 static draw). */
int map16_tile_is_hack_muncher_placement_stub(const Map16Tile *t);

void map16_print_alias_debug(const Map16Data *m, int top_n);

void map16_debug_synthesize(uint16_t tile_id, Map16Tile *out);
