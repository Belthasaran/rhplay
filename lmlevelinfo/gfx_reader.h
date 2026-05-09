#pragma once

#include <stddef.h>
#include <stdint.h>

#include "romutil.h"

typedef struct {
  uint8_t *bytes;
  size_t len;
} GfxBlob;

void gfxblob_free(GfxBlob *b);

// Load and LC_LZ2-decompress a GFX/ExGFX file from the ROM by file id.
// Supported ids:
// - 0x00..0x31 via vanilla pointer tables ($00B992/$00B9C4/$00B9F6)
// - 0x60..0x63 via 24-bit pointers at $03BCC0
// - 0x80..0xFF via 24-bit pointers at $0FF600
// Returns 1 on success, 0 on failure (err filled). If the pointer is missing, returns 0.
int gfx_load_from_rom(const Rom *rom, uint8_t file_id, GfxBlob *out, char *err, size_t errcap);

// Decode one SNES 4bpp 8x8 tile into 64 pixel indices (0..15).
// Returns 1 on success, 0 if out-of-range.
int snes4bpp_decode_tile(const uint8_t *gfx, size_t gfx_len, uint16_t tile_index, uint8_t out_px64[64]);

