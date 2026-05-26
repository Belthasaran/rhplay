#include "map16_rom.h"

#include <string.h>

static int read_block_words_snes(const Rom *rom, uint32_t snes24, Map16Tile *out) {
  if (!rom || !out) return 0;
  for (int i = 0; i < 4; i++) {
    uint16_t w = 0;
    if (!rom_read16_snes(rom, snes24 + (uint32_t)(i * 2), &w)) return 0;
    out->w[i] = w;
  }
  return 1;
}

static int read_block_at_snes_ptr(const Rom *rom, uint16_t ptr16, uint8_t bank, Map16Tile *out) {
  if (!rom || !out || ptr16 < 0x8000u) return 0;
  uint32_t snes24 = ((uint32_t)bank << 16) | (uint32_t)ptr16;
  if (!read_block_words_snes(rom, snes24, out)) return 0;
  if (map16_tile_is_empty(out)) return 0;
  if (map16_tile_needs_resolve(out)) return 0;
  return 1;
}

static int lm_fg_page_base_snes(const Rom *rom, uint8_t page, uint32_t *out_snes24) {
  if (!rom || !out_snes24 || page < 2 || page > 0x7F) return 0;

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
  } else if (page <= 0x3F) {
    if (!rom_read16_snes(rom, 0x06F570u, &lo)) return 0;
    if (!rom_read8_snes(rom, 0x06F574u, &hi)) return 0;
    lo = (uint16_t)(lo + 1u);
    page_in_group = (uint8_t)(page - 0x30u);
  } else if (page <= 0x4F) {
    if (!rom_read16_snes(rom, 0x06F594u, &lo) || !rom_read8_snes(rom, 0x06F598u, &hi)) return 0;
    page_in_group = (uint8_t)(page - 0x40u);
  } else if (page <= 0x5F) {
    if (!rom_read16_snes(rom, 0x06F59Du, &lo) || !rom_read8_snes(rom, 0x06F5A1u, &hi)) return 0;
    page_in_group = (uint8_t)(page - 0x50u);
  } else if (page <= 0x6F) {
    if (!rom_read16_snes(rom, 0x06F5A8u, &lo)) return 0;
    if (!rom_read8_snes(rom, 0x06F5ACu, &hi)) return 0;
    lo = (uint16_t)(lo + 1u);
    page_in_group = (uint8_t)(page - 0x60u);
  } else {
    if (!rom_read16_snes(rom, 0x06F5B1u, &lo)) return 0;
    if (!rom_read8_snes(rom, 0x06F5B5u, &hi)) return 0;
    lo = (uint16_t)(lo + 1u);
    page_in_group = (uint8_t)(page - 0x70u);
  }

  base = ((uint32_t)hi << 16) | (uint32_t)lo;
  if (base == 0) return 0;

  *out_snes24 = base + (uint32_t)page_in_group * 0x800u;
  return 1;
}

static int lm_custom_page_base_snes(const Rom *rom, uint8_t page, uint32_t *out_snes24) {
  return lm_fg_page_base_snes(rom, page, out_snes24);
}

static const uint32_t kVanillaPtrTableBases[] = {
    0x00BE80u,
    0x009326u,
};

static int vanilla_ptr_table_base(const Rom *rom, uint32_t *out_snes24) {
  if (!rom || !out_snes24) return 0;
  for (size_t i = 0; i < sizeof(kVanillaPtrTableBases) / sizeof(kVanillaPtrTableBases[0]); i++) {
    uint16_t ptr0 = 0;
    if (!rom_read16_snes(rom, kVanillaPtrTableBases[i], &ptr0)) continue;
    if (ptr0 >= 0x8000u) {
      *out_snes24 = kVanillaPtrTableBases[i];
      return 1;
    }
  }
  return 0;
}

int map16_rom_read_vanilla_tile_raw(const Rom *rom, uint16_t tile_id, Map16Tile *out) {
  if (!rom || !out) return 0;

  uint8_t page = (uint8_t)((tile_id >> 8) & 0xFF);
  uint8_t low = (uint8_t)(tile_id & 0xFF);
  if (page > 1 || low == 0) return 0;

  uint32_t table_base = 0;
  if (!vanilla_ptr_table_base(rom, &table_base)) return 0;

  uint16_t ptr16 = 0;
  uint32_t ptr_addr = table_base + (uint32_t)tile_id * 2u;
  if (!rom_read16_snes(rom, ptr_addr, &ptr16) || ptr16 < 0x8000u) return 0;

  static const uint8_t kBanks[] = {0x18u, 0x19u, 0x0Du};
  for (size_t bi = 0; bi < sizeof(kBanks) / sizeof(kBanks[0]); bi++) {
    uint32_t snes24 = ((uint32_t)kBanks[bi] << 16) | (uint32_t)ptr16;
    if (read_block_words_snes(rom, snes24, out)) return 1;
  }
  return 0;
}

int map16_rom_read_custom_tile_raw(const Rom *rom, uint16_t tile_id, Map16Tile *out) {
  if (!rom || !out) return 0;

  uint8_t page = (uint8_t)((tile_id >> 8) & 0xFF);
  uint8_t low = (uint8_t)(tile_id & 0xFF);
  if (page < 2 || low == 0) return 0;

  uint32_t page_base = 0;
  if (!lm_custom_page_base_snes(rom, page, &page_base)) return 0;

  uint32_t addr = page_base + (uint32_t)low * 8u;
  return read_block_words_snes(rom, addr, out);
}

int map16_rom_get_vanilla_tile(const Rom *rom, uint16_t tile_id, Map16Tile *out) {
  Map16Tile raw;
  if (!map16_rom_read_vanilla_tile_raw(rom, tile_id, &raw)) return 0;
  if (map16_tile_is_empty(&raw)) return 0;
  if (map16_tile_needs_resolve(&raw)) return 0;
  *out = raw;
  return 1;
}

int map16_rom_get_tile(const Rom *rom, uint16_t tile_id, Map16Tile *out) {
  Map16Tile raw;
  if (!map16_rom_read_custom_tile_raw(rom, tile_id, &raw)) return 0;
  if (map16_tile_is_empty(&raw)) return 0;
  if (map16_tile_needs_resolve(&raw)) return 0;
  *out = raw;
  return 1;
}

int map16_rom_read_acts_like(const Rom *rom, uint16_t tile_id, uint16_t *out_acts_like) {
  if (!rom || !out_acts_like) return 0;

  uint32_t table_base = 0;
  if ((tile_id >> 8) < 0x40) {
    if (!rom_read24_snes(rom, 0x06F624u, &table_base) || table_base == 0) return 0;
  } else {
    if (!rom_read24_snes(rom, 0x06F63Au, &table_base) || table_base == 0) return 0;
  }

  uint16_t w = 0;
  if (!rom_read16_snes(rom, table_base + (uint32_t)tile_id * 2u, &w)) return 0;
  *out_acts_like = w;
  return 1;
}
