#pragma once

#include <stdint.h>

#include "map16_reader.h"
#include "romutil.h"

/* Read 8-byte visual block from ROM without rejecting placeholders. */
int map16_rom_read_vanilla_tile_raw(const Rom *rom, uint16_t tile_id, Map16Tile *out);

int map16_rom_read_custom_tile_raw(const Rom *rom, uint16_t tile_id, Map16Tile *out);

/* Drawable resolve (legacy): skips empty / uniform filler slots. */
int map16_rom_get_tile(const Rom *rom, uint16_t tile_id, Map16Tile *out);

int map16_rom_get_vanilla_tile(const Rom *rom, uint16_t tile_id, Map16Tile *out);

/* Acts-like behavior table (2 bytes per tile); not used for CHR lookup. */
int map16_rom_read_acts_like(const Rom *rom, uint16_t tile_id, uint16_t *out_acts_like);
