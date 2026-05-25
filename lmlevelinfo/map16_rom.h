#pragma once

#include <stdint.h>

#include "map16_reader.h"
#include "romutil.h"

int map16_rom_get_tile(const Rom *rom, uint16_t tile_id, Map16Tile *out);

int map16_rom_get_vanilla_tile(const Rom *rom, uint16_t tile_id, Map16Tile *out);
