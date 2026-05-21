#pragma once

#include <stddef.h>
#include <stdint.h>

typedef struct {
  // raw words for a Map16 tile (4 subtiles). Word bit layout is LM/SMW-defined.
  // We keep raw so higher layers can interpret palette/flip/priority bits.
  uint16_t w[4]; // TL, TR, BL, BR (conventional order)
} Map16Tile;

typedef struct {
  Map16Tile *tiles;
  size_t tiles_count; // number of tiles present in file
  int is_lm16;       // file began with LM16 magic
  int synth_vanilla; // synthesize empty export slots from tile_id page/low (default on load)
  size_t synth_count;
} Map16Data;

void map16_free(Map16Data *m);

// Load Lunar Magic binary AllMap16.map16 (LM16 container or raw 8-byte tiles).
// Flat tile_id indexing: tiles[tile_id] (matches LM export for custom ids e.g. 0x07EC).
// Returns 1 on success, 0 on failure (err filled).
int map16_load_file(const char *path, Map16Data *out, char *err, size_t errcap);

void map16_set_synth_vanilla(Map16Data *m, int enable);

// Return 1 if tile_id is present and *out is filled (applies vanilla synth when enabled).
int map16_get(Map16Data *m, uint16_t tile_id, Map16Tile *out);

// Lookup without synthesizing empty blocks.
int map16_get_raw(const Map16Data *m, uint16_t tile_id, Map16Tile *out);

// 1 if export slot exists but all subtile words are zero.
int map16_tile_is_empty(const Map16Tile *t);
