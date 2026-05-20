#include "gfx_reader.h"

#include <stdlib.h>
#include <string.h>

#include "lc_lz2.h"

static void seterr(char *err, size_t errcap, const char *msg) {
  if (!err || errcap == 0) return;
  snprintf(err, errcap, "%s", msg ? msg : "error");
}

void gfxblob_free(GfxBlob *b) {
  if (!b) return;
  free(b->bytes);
  b->bytes = NULL;
  b->len = 0;
}

static int gfx_ptr24_for_id(const Rom *rom, uint8_t file_id, uint32_t *out_p24) {
  if (!rom || !out_p24) return 0;
  *out_p24 = 0;

  if (file_id <= 0x31) {
    uint8_t lo = 0, hi = 0, bank = 0;
    if (!rom_read8_snes(rom, 0x00B992u + (uint32_t)file_id, &lo) ||
        !rom_read8_snes(rom, 0x00B9C4u + (uint32_t)file_id, &hi) ||
        !rom_read8_snes(rom, 0x00B9F6u + (uint32_t)file_id, &bank)) {
      return 0;
    }
    uint32_t snes = ((uint32_t)bank << 16) | (uint32_t)((uint16_t)lo | ((uint16_t)hi << 8));
    if ((snes & 0xFFFFu) < 0x8000u) return 0;
    *out_p24 = snes;
    return 1;
  }

  if (file_id >= 0x60 && file_id <= 0x63) {
    uint32_t p24 = 0;
    uint32_t entry = 0x03BCC0u + (uint32_t)(file_id - 0x60u) * 3u;
    if (!rom_read24_snes(rom, entry, &p24) || p24 == 0) return 0;
    *out_p24 = p24;
    return 1;
  }

  if (file_id >= 0x80) {
    uint32_t p24 = 0;
    uint32_t entry = 0x0FF600u + (uint32_t)(file_id - 0x80u) * 3u;
    if (!rom_read24_snes(rom, entry, &p24) || p24 == 0) return 0;
    *out_p24 = p24;
    return 1;
  }

  return 0;
}

int gfx_load_from_rom(const Rom *rom, uint8_t file_id, GfxBlob *out, char *err, size_t errcap) {
  if (!rom || !out) {
    seterr(err, errcap, "gfx_load_from_rom: invalid args");
    return 0;
  }
  out->bytes = NULL;
  out->len = 0;

  uint32_t p24 = 0;
  if (!gfx_ptr24_for_id(rom, file_id, &p24) || p24 == 0) {
    seterr(err, errcap, "GFX pointer missing");
    return 0;
  }
  uint32_t pc = 0;
  if (!snes_lorom_to_pc(rom, p24, &pc) || pc >= rom->size) {
    seterr(err, errcap, "GFX pointer out of range");
    return 0;
  }

  uint8_t *dec = NULL;
  size_t declen = 0;
  char derr[256];
  if (!lc_lz2_decompress(rom->data + pc, rom->size - pc, &dec, &declen, 0x2000u, NULL, derr, sizeof(derr))) {
    seterr(err, errcap, "LC_LZ2 decompress failed");
    return 0;
  }
  out->bytes = dec;
  out->len = declen;
  return 1;
}

int snes4bpp_decode_tile(const uint8_t *gfx, size_t gfx_len, uint16_t tile_index, uint8_t out_px64[64]) {
  if (!gfx || !out_px64) return 0;
  size_t off = (size_t)tile_index * 32u;
  if (off + 32u > gfx_len) return 0;
  const uint8_t *p = gfx + off;

  for (int y = 0; y < 8; y++) {
    uint8_t b0 = p[y * 2 + 0];
    uint8_t b1 = p[y * 2 + 1];
    uint8_t b2 = p[16 + y * 2 + 0];
    uint8_t b3 = p[16 + y * 2 + 1];
    for (int x = 0; x < 8; x++) {
      int bit = 7 - x;
      uint8_t c =
        (uint8_t)(((b0 >> bit) & 1u) |
                  (((b1 >> bit) & 1u) << 1) |
                  (((b2 >> bit) & 1u) << 2) |
                  (((b3 >> bit) & 1u) << 3));
      out_px64[y * 8 + x] = c;
    }
  }
  return 1;
}

void gfxcache_free(GfxCache *c) {
  if (!c) return;
  if (c->entries) {
    for (size_t i = 0; i < c->entries_cap; i++) {
      if (c->entries[i].valid) gfxblob_free(&c->entries[i].blob);
    }
    free(c->entries);
  }
  c->entries = NULL;
  c->entries_cap = 0;
  c->use_counter = 0;
}

int gfxcache_init(GfxCache *c, size_t cap, char *err, size_t errcap) {
  if (!c || cap == 0) {
    seterr(err, errcap, "gfxcache_init: invalid args");
    return 0;
  }
  memset(c, 0, sizeof(*c));
  c->entries = (GfxCacheEntry *)calloc(cap, sizeof(GfxCacheEntry));
  if (!c->entries) {
    seterr(err, errcap, "Out of memory creating gfx cache");
    return 0;
  }
  c->entries_cap = cap;
  c->use_counter = 1;
  return 1;
}

static GfxCacheEntry *gfxcache_find(GfxCache *c, uint8_t file_id) {
  if (!c || !c->entries) return NULL;
  for (size_t i = 0; i < c->entries_cap; i++) {
    if (c->entries[i].valid && c->entries[i].file_id == file_id) return &c->entries[i];
  }
  return NULL;
}

static GfxCacheEntry *gfxcache_choose_victim(GfxCache *c) {
  if (!c || !c->entries) return NULL;
  // Prefer empty slots.
  for (size_t i = 0; i < c->entries_cap; i++) {
    if (!c->entries[i].valid) return &c->entries[i];
  }
  // Else LRU.
  size_t best = 0;
  uint32_t best_use = c->entries[0].last_use;
  for (size_t i = 1; i < c->entries_cap; i++) {
    if (c->entries[i].last_use < best_use) {
      best_use = c->entries[i].last_use;
      best = i;
    }
  }
  return &c->entries[best];
}

int gfxcache_get(const Rom *rom, GfxCache *c, uint8_t file_id, const GfxBlob **out, char *err, size_t errcap) {
  if (!rom || !c || !out) {
    seterr(err, errcap, "gfxcache_get: invalid args");
    return 0;
  }
  *out = NULL;

  GfxCacheEntry *e = gfxcache_find(c, file_id);
  if (e) {
    e->last_use = c->use_counter++;
    *out = &e->blob;
    return 1;
  }

  e = gfxcache_choose_victim(c);
  if (!e) {
    seterr(err, errcap, "gfxcache_get: internal error");
    return 0;
  }
  if (e->valid) {
    gfxblob_free(&e->blob);
    e->valid = 0;
  }

  GfxBlob b;
  memset(&b, 0, sizeof(b));
  if (!gfx_load_from_rom(rom, file_id, &b, err, errcap)) {
    // propagate err from gfx_load_from_rom
    return 0;
  }

  e->file_id = file_id;
  e->blob = b;
  e->valid = 1;
  e->last_use = c->use_counter++;
  *out = &e->blob;
  return 1;
}

void gfxcache_preload_ids(const Rom *rom, GfxCache *c, const uint8_t *file_ids, size_t count,
                          char *err, size_t errcap) {
  if (!rom || !c || !file_ids) return;
  char local_err[256];
  for (size_t i = 0; i < count; i++) {
    const GfxBlob *blob = NULL;
    (void)gfxcache_get(rom, c, file_ids[i], &blob, err ? err : local_err,
                       err ? errcap : sizeof(local_err));
  }
}

