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

// Map16 tile8 (10-bit CHR + page bits 8-9) to local 8x8 index within a GFX file.
// Vanilla slots use 128 tiles (low 7 bits); ExGFX often has 256 (low 8 bits when bit 7 set).
uint16_t gfx_local_tile_index(size_t gfx_len, uint16_t tile8);

typedef struct {
  uint8_t file_id;
  uint32_t last_use;
  int valid;
  GfxBlob blob;
} GfxCacheEntry;

typedef struct {
  GfxCacheEntry *entries;
  size_t entries_cap;
  uint32_t use_counter;
} GfxCache;

void gfxcache_free(GfxCache *c);
int gfxcache_init(GfxCache *c, size_t cap, char *err, size_t errcap);

// Get a decompressed blob for file_id, using a simple LRU cache.
// On success, returns 1 and *out points to owned cached storage (valid until gfxcache_free()).
int gfxcache_get(const Rom *rom, GfxCache *c, uint8_t file_id, const GfxBlob **out, char *err, size_t errcap);

// Preload a list of file ids into the cache (best-effort; ignores failures).
void gfxcache_preload_ids(const Rom *rom, GfxCache *c, const uint8_t *file_ids, size_t count,
                          char *err, size_t errcap);

