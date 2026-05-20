#include "gfx_route.h"

#include <string.h>

// snesrev smw_00.c kUploadGraphicsFiles_FGAndBGGFXList
static const uint8_t kFGAndBGGFXList[104] = {
    0x14, 0x17, 0x19, 0x15, 0x14, 0x17, 0x1b, 0x18, 0x14, 0x17, 0x1b, 0x16, 0x14, 0x17, 0x0c, 0x1a,
    0x14, 0x17, 0x1b, 0x08, 0x14, 0x17, 0x0c, 0x07, 0x14, 0x17, 0x0c, 0x16, 0x14, 0x17, 0x1b, 0x15,
    0x14, 0x17, 0x19, 0x16, 0x14, 0x17, 0x0d, 0x1a, 0x14, 0x17, 0x1b, 0x08, 0x14, 0x17, 0x1b, 0x18,
    0x14, 0x17, 0x19, 0x1f, 0x14, 0x17, 0x0d, 0x07, 0x14, 0x17, 0x19, 0x1a, 0x14, 0x17, 0x14, 0x14,
    0x0e, 0x0f, 0x17, 0x17, 0x1c, 0x1d, 0x08, 0x1e, 0x1c, 0x1d, 0x08, 0x1e, 0x1c, 0x1d, 0x08, 0x1e,
    0x1c, 0x1d, 0x08, 0x1e, 0x1c, 0x1d, 0x08, 0x1e, 0x1c, 0x1d, 0x08, 0x1e, 0x1c, 0x1d, 0x08, 0x1e,
    0x14, 0x17, 0x19, 0x2c, 0x19, 0x17, 0x1b, 0x18,
};

// Map16 page bits -> LM bypass table slot (SP1, SP2, FG1, FG2).
static const uint8_t kMap16PageToSlot[4] = {
    GFX_SLOT_SP1,
    GFX_SLOT_SP2,
    GFX_SLOT_FG1,
    GFX_SLOT_FG2,
};

static const char *kSlotNames[GFX_SLOT_COUNT] = {
    "AN2", "LT3", "BG3", "BG2", "FG3", "BG1", "FG2", "FG1",
    "SP4", "SP3", "SP2", "SP1", "LG4", "LG3", "LG2", "LG1",
};

const char *gfx_route_slot_name(int slot_index) {
  if (slot_index < 0 || slot_index >= GFX_SLOT_COUNT) return "?";
  return kSlotNames[slot_index];
}

static uint8_t vanilla_file_for_page(uint8_t tileset, int page) {
  if (tileset >= 26) tileset = 0;
  uint32_t idx = (uint32_t)tileset * 4u + (uint32_t)page;
  return kFGAndBGGFXList[idx < 104 ? idx : 0];
}

static uint8_t file_id_from_slot_u16(uint16_t raw) {
  uint8_t fid = (uint8_t)(raw & 0xFFu);
  if (fid == 0) return 0;
  return fid;
}

void gfx_route_build(LevelGfxRoute *out, const PrimaryLevelHeader *primary,
                     const uint8_t *exgfx_bytes, size_t exgfx_len) {
  if (!out) return;
  memset(out, 0, sizeof(*out));
  out->tileset = primary ? (uint8_t)(primary->fgbg_gfx_setting & 0x0F) : 0;

  for (int p = 0; p < 4; p++) {
    out->file_id_for_page[p] = vanilla_file_for_page(out->tileset, p);
  }

  if (exgfx_bytes && exgfx_len >= 32) {
    out->has_bypass_table = 1;
    for (int s = 0; s < GFX_SLOT_COUNT; s++) {
      uint16_t raw = (uint16_t)(exgfx_bytes[s * 2] | ((uint16_t)exgfx_bytes[s * 2 + 1] << 8));
      out->slot_file_id[s] = file_id_from_slot_u16(raw);
    }
    for (int p = 0; p < 4; p++) {
      uint8_t slot = kMap16PageToSlot[p];
      if (out->slot_file_id[slot] != 0) {
        out->file_id_for_page[p] = out->slot_file_id[slot];
      }
    }
  }

  out->valid = 1;
}

uint8_t gfx_route_file_for_tile(const LevelGfxRoute *route, uint16_t tile8) {
  uint8_t page = (uint8_t)((tile8 >> 8) & 0x03);
  if (!route || !route->valid) {
    return (uint8_t)(0x00 + page);
  }
  return route->file_id_for_page[page];
}

size_t gfx_route_collect_file_ids(const LevelGfxRoute *route, uint8_t *out_ids, size_t max_out) {
  if (!route || !out_ids || max_out == 0) return 0;
  size_t n = 0;
  for (int p = 0; p < 4; p++) {
    uint8_t fid = route->file_id_for_page[p];
    if (fid == 0) continue;
    size_t j;
    for (j = 0; j < n; j++) {
      if (out_ids[j] == fid) break;
    }
    if (j == n && n < max_out) out_ids[n++] = fid;
  }
  if (route->has_bypass_table) {
    for (int s = 0; s < GFX_SLOT_COUNT; s++) {
      uint8_t fid = route->slot_file_id[s];
      if (fid == 0) continue;
      size_t j;
      for (j = 0; j < n; j++) {
        if (out_ids[j] == fid) break;
      }
      if (j == n && n < max_out) out_ids[n++] = fid;
    }
  }
  return n;
}
