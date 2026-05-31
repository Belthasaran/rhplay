#pragma once

#include <stdint.h>

#include "level_parse.h"
#include "romutil.h"

typedef enum {
  PAL_SOURCE_CUSTOM = 0,
  PAL_SOURCE_ROM = 1,
  PAL_SOURCE_FALLBACK = 2,
} PaletteSource;

// Fill 256-entry RGB palette and background color from ROM FG/BG tables or fallback.
// Returns palette source used.
PaletteSource palette_build_for_level(const Rom *rom, const LevelInfo *info, uint8_t pal256[256][3],
                                      uint8_t *out_back_r, uint8_t *out_back_g, uint8_t *out_back_b);

const char *palette_source_name(PaletteSource src);

/* SNES 15-bit BGR (BBBBBGGGGGRRRRR) to 8-bit RGB via (c<<3)|(c>>2) expansion. */
void palette_snes15_to_rgb(uint16_t c, uint8_t *r, uint8_t *g, uint8_t *b);
