#pragma once

#include <stdint.h>

#include "level_parse.h"
#include "romutil.h"

// Maps Map16 subtile VRAM page (bits 8-9 of 10-bit tile index) to GFX file id.
typedef struct {
  uint8_t file_id_for_page[4];
  int valid;
} LevelGfxRoute;

// Build FG/BG GFX file ids for pages 0..3 from primary header and optional 32-byte ExGFX bypass table.
void gfx_route_build(LevelGfxRoute *out, const PrimaryLevelHeader *primary,
                     const uint8_t *exgfx_bytes, size_t exgfx_len);

// Resolve GFX file id for a 10-bit tile index (uses page bits when route valid).
uint8_t gfx_route_file_for_tile(const LevelGfxRoute *route, uint16_t tile8);
