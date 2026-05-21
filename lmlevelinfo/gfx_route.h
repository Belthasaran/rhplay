#pragma once

#include <stddef.h>
#include <stdint.h>

#include "level_parse.h"

// LM Super GFX bypass slot indices (16 x u16 LE in 32-byte level table).
enum {
  GFX_SLOT_AN2 = 0,
  GFX_SLOT_LT3 = 1,
  GFX_SLOT_BG3 = 2,
  GFX_SLOT_BG2 = 3,
  GFX_SLOT_FG3 = 4,
  GFX_SLOT_BG1 = 5,
  GFX_SLOT_FG2 = 6,
  GFX_SLOT_FG1 = 7,
  GFX_SLOT_SP4 = 8,
  GFX_SLOT_SP3 = 9,
  GFX_SLOT_SP2 = 10,
  GFX_SLOT_SP1 = 11,
  GFX_SLOT_LG4 = 12,
  GFX_SLOT_LG3 = 13,
  GFX_SLOT_LG2 = 14,
  GFX_SLOT_LG1 = 15,
  GFX_SLOT_COUNT = 16,
};

// Map16 10-bit page (bits 8-9) -> LM bypass slot index.
enum {
  GFX_MAP16_PAGE_SP1 = 0,
  GFX_MAP16_PAGE_SP2 = 1,
  GFX_MAP16_PAGE_FG1 = 2,
  GFX_MAP16_PAGE_FG2 = 3,
};

typedef struct {
  uint8_t file_id_for_page[4];
  uint8_t slot_file_id[GFX_SLOT_COUNT]; // 0 = unused
  uint8_t tileset;
  int has_bypass_table;
  int valid;
} LevelGfxRoute;

void gfx_route_build(LevelGfxRoute *out, const PrimaryLevelHeader *primary,
                     const uint8_t *exgfx_bytes, size_t exgfx_len);

uint8_t gfx_route_file_for_tile(const LevelGfxRoute *route, uint16_t tile8);

// Vanilla FG/BG list entry for Map16 page (ignores bypass overrides).
uint8_t gfx_route_vanilla_file_for_page(const LevelGfxRoute *route, int page);

// Collect distinct GFX file ids for preload: pages, slots, and vanilla fallbacks per page.
size_t gfx_route_collect_preload_ids(const LevelGfxRoute *route, uint8_t *out_ids, size_t max_out);

// Collect distinct GFX file ids needed for this route (pages + any non-zero slots).
size_t gfx_route_collect_file_ids(const LevelGfxRoute *route, uint8_t *out_ids, size_t max_out);

// Slot name for logging/tests.
const char *gfx_route_slot_name(int slot_index);
