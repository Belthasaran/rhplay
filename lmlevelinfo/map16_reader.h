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

typedef struct {
  Map16Tile *tiles;
  size_t tiles_count;
  int is_lm16;
  int synth_vanilla;
  size_t muncher_full_quad_index; /* SIZE_MAX if unknown/unavailable */
  size_t synth_count;
  size_t alias_hit_count;
  size_t rom_hit_count;
  size_t rom_vanilla_hit_count;
  size_t alias_table_count;
  size_t *alias_index; /* tiles_count entries: alias target index, SIZE_MAX=none */
  size_t canonical_table_count;
  size_t *canonical_index; /* tiles_count entries: canonical file index, SIZE_MAX=none */
  Rom *rom;
} Map16Data;

void map16_free(Map16Data *m);

int map16_load_file(const char *path, Map16Data *out, char *err, size_t errcap);

void map16_set_synth_vanilla(Map16Data *m, int enable);

void map16_attach_rom(Map16Data *m, Rom *rom);

int map16_get(Map16Data *m, uint16_t tile_id, Map16Tile *out);

int map16_get_with_src(Map16Data *m, uint16_t tile_id, Map16Tile *out, int *src_out);

int map16_get_raw(const Map16Data *m, uint16_t tile_id, Map16Tile *out);

int map16_get_alias_index(const Map16Data *m, uint16_t tile_id, size_t *out_idx);

int map16_get_canonical_index(const Map16Data *m, uint16_t tile_id, size_t *out_idx);

int map16_tile_is_empty(const Map16Tile *t);

int map16_tile_needs_resolve(const Map16Tile *t);

void map16_print_alias_debug(const Map16Data *m, int top_n);

void map16_debug_synthesize(uint16_t tile_id, Map16Tile *out);
