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
} Map16Data;

void map16_free(Map16Data *m);

// Load Lunar Magic binary AllMap16.map16 format (best-effort).
// This parser assumes each tile is 8 bytes (4x u16 little endian).
// Returns 1 on success, 0 on failure (err filled).
int map16_load_file(const char *path, Map16Data *out, char *err, size_t errcap);

// Return 1 if tile_id is present and *out is filled.
int map16_get(const Map16Data *m, uint16_t tile_id, Map16Tile *out);

