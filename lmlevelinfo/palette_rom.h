#pragma once

#include <stdint.h>

#include "level_parse.h"
#include "romutil.h"

// Fill 256-entry RGB palette (pal256[i][0..2]) from vanilla SMW ROM tables when no custom palette blob.
// Uses fg_palette / bg_palette / sprite_palette indices from the primary header.
int palette_build_from_rom(const Rom *rom, const PrimaryLevelHeader *primary, uint8_t pal256[256][3],
                           uint8_t *out_back_r, uint8_t *out_back_g, uint8_t *out_back_b);
