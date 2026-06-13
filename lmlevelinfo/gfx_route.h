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

enum {
  GFX_ROUTE_MODE_BYPASS = 0,
  GFX_ROUTE_MODE_VANILLA = 1,
  GFX_ROUTE_MODE_TRY_BOTH = 2,
};

typedef struct {
  uint8_t file_id_for_page[4];
  uint8_t slot_file_id[GFX_SLOT_COUNT]; // 0 = unused
  uint16_t slot_raw_u16[GFX_SLOT_COUNT];
  uint8_t tileset;
  int has_bypass_table;
  int valid;
} LevelGfxRoute;

void gfx_route_build(LevelGfxRoute *out, const PrimaryLevelHeader *primary,
                     const uint8_t *exgfx_bytes, size_t exgfx_len);

uint8_t gfx_route_file_for_tile(const LevelGfxRoute *route, uint16_t tile8);

// Resolve GFX file for a subtile word (page from tile8 bits 8-9).
uint8_t gfx_route_file_for_tile_mode(const LevelGfxRoute *route, uint16_t tile8, int route_mode);

// LM bypass slot index (GFX_SLOT_SP1..GFX_SLOT_SP4) -> GFX file id.
uint8_t gfx_route_file_for_sprite_slot(const LevelGfxRoute *route, int slot_index);

uint8_t gfx_route_file_for_sprite_slot_mode(const LevelGfxRoute *route, int slot_index, int route_mode);

// Vanilla FG/BG list entry for Map16 page (ignores bypass overrides).
uint8_t gfx_route_vanilla_file_for_page(const LevelGfxRoute *route, int page);

// Resolve ExGFX file + local 8x8 for a Map16 subtile CHR word (SMW 10-bit tile8).
void gfx_route_resolve_subtile(const LevelGfxRoute *route, uint16_t tile8, int route_mode,
                               uint8_t *out_file_id, uint16_t *out_local);

/* Acts-like 0x012F vanilla muncher quad (page-0 locals 0x5C-0x5F): BG1/LG3 slot GFX. */
int gfx_route_tile8_is_vanilla_muncher_local(uint16_t tile8);
int gfx_route_resolve_012f_muncher(const LevelGfxRoute *route, int corner_si, int route_mode,
                                   uint8_t *out_file_id, uint16_t *out_local);
void gfx_route_012f_muncher_blit_flips(int corner_si, int *hflip, int *vflip);
/* FG_pages oracle column order (TL,BL,TR,BR) -> screen corner (TL,TR,BL,BR) for 012F blit flips. */
void gfx_route_012f_muncher_blit_flips_oracle(int oracle_si, int *hflip, int *vflip);

/* Acts-like 0x002B coin quad (oracle CHR 0x06C-0x06F): SP1/SP4/LG3/LG1 slot GFX (akogare scan-best). */
int gfx_route_resolve_002b_coin(const LevelGfxRoute *route, int oracle_si, int route_mode,
                                uint8_t *out_file_id, uint16_t *out_local);
void gfx_route_002b_coin_blit_flips(int corner_si, int *hflip, int *vflip);
void gfx_route_002b_coin_blit_flips_oracle(int oracle_si, int *hflip, int *vflip);

// FG_pages oracle CHR (3-digit LM hex, e.g. 0x1FA): bypass slot (hi digit + BG2) + local (low>=0x80 -> -0x80).
void gfx_route_resolve_lm_oracle_chr(const LevelGfxRoute *route, uint16_t chr, int route_mode,
                                   uint8_t *out_file_id, uint16_t *out_local);

// Collect distinct GFX file ids for preload: pages, slots, and vanilla fallbacks per page.
size_t gfx_route_collect_preload_ids(const LevelGfxRoute *route, uint8_t *out_ids, size_t max_out);

// Collect distinct GFX file ids needed for this route (pages + any non-zero slots).
size_t gfx_route_collect_file_ids(const LevelGfxRoute *route, uint8_t *out_ids, size_t max_out);

// Slot name for logging/tests.
const char *gfx_route_slot_name(int slot_index);

// Human-readable manifest on stderr (LV_REPORT_GFX).
void gfx_route_print_manifest(const LevelGfxRoute *route, const uint8_t *exgfx_bytes, size_t exgfx_len);
