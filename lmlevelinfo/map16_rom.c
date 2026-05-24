#include "map16_rom.h"

#include <string.h>

static int lm_custom_page_base_snes(const Rom *rom, uint8_t page, uint32_t *out_snes24) {
  if (!rom || !out_snes24 || page < 2 || page > 0x3F) return 0;

  uint16_t lo = 0;
  uint8_t hi = 0;
  uint32_t base = 0;
  uint8_t page_in_group = 0;

  if (page <= 0x0F) {
    if (!rom_read16_snes(rom, 0x06F553u, &lo) || !rom_read8_snes(rom, 0x06F557u, &hi)) return 0;
    page_in_group = (uint8_t)(page - 2u);
  } else if (page <= 0x1F) {
    if (!rom_read16_snes(rom, 0x06F55Cu, &lo) || !rom_read8_snes(rom, 0x06F560u, &hi)) return 0;
    page_in_group = (uint8_t)(page - 0x10u);
  } else if (page <= 0x2F) {
    if (!rom_read16_snes(rom, 0x06F567u, &lo)) return 0;
    if (!rom_read8_snes(rom, 0x06F56Bu, &hi)) return 0;
    lo = (uint16_t)(lo + 1u);
    page_in_group = (uint8_t)(page - 0x20u);
  } else {
    if (!rom_read16_snes(rom, 0x06F570u, &lo)) return 0;
    if (!rom_read8_snes(rom, 0x06F574u, &hi)) return 0;
    lo = (uint16_t)(lo + 1u);
    page_in_group = (uint8_t)(page - 0x30u);
  }

  base = ((uint32_t)hi << 16) | (uint32_t)lo;
  if (base == 0) return 0;

  *out_snes24 = base + (uint32_t)page_in_group * 0x800u;
  return 1;
}

int map16_rom_get_tile(const Rom *rom, uint16_t tile_id, Map16Tile *out) {
  if (!rom || !out) return 0;

  uint8_t page = (uint8_t)((tile_id >> 8) & 0xFF);
  uint8_t low = (uint8_t)(tile_id & 0xFF);
  if (page < 2 || low == 0) return 0;

  uint32_t page_base = 0;
  if (!lm_custom_page_base_snes(rom, page, &page_base)) return 0;

  uint32_t addr = page_base + (uint32_t)low * 8u;
  for (int i = 0; i < 4; i++) {
    uint16_t w = 0;
    if (!rom_read16_snes(rom, addr + (uint32_t)(i * 2), &w)) return 0;
    out->w[i] = w;
  }

  if (map16_tile_is_empty(out)) return 0;
  if (map16_tile_needs_resolve(out)) return 0;
  return 1;
}
