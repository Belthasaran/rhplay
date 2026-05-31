#include "gfx_route.h"

#include <stdio.h>
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

// LM Super GFX bypass u16: low 12 bits are GFX file or "use vanilla" (0 / 0x7F).
// Values 1..0x0F in SP/FG slots are often 1-based indices into the tileset FG/BG list, not literal file 0x01.
static uint8_t file_id_from_slot_u16(uint16_t raw, uint8_t tileset, int map16_page) {
  uint16_t low12 = (uint16_t)(raw & 0x0FFFu);
  if (low12 == 0 || low12 == 0x7F) return 0;
  if (low12 < 0x10 && map16_page >= 0 && map16_page < 4) {
    return vanilla_file_for_page(tileset, map16_page);
  }
  uint8_t fid = (uint8_t)(raw & 0xFFu);
  if (fid == 0 || fid == 0x7F) return 0;
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
      int page = -1;
      for (int p = 0; p < 4; p++) {
        if (kMap16PageToSlot[p] == s) page = p;
      }
      out->slot_file_id[s] = file_id_from_slot_u16(raw, out->tileset, page);
      out->slot_raw_u16[s] = raw;
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
  return gfx_route_file_for_tile_mode(route, tile8, GFX_ROUTE_MODE_BYPASS);
}

uint8_t gfx_route_file_for_tile_mode(const LevelGfxRoute *route, uint16_t tile8, int route_mode) {
  uint8_t page = (uint8_t)((tile8 >> 8) & 0x03);
  if (!route || !route->valid) {
    return (uint8_t)(0x00 + page);
  }
  if (route_mode == GFX_ROUTE_MODE_VANILLA) {
    uint8_t van = vanilla_file_for_page(route->tileset, page);
    return van ? van : route->file_id_for_page[page];
  }
  return route->file_id_for_page[page];
}

uint8_t gfx_route_file_for_sprite_slot(const LevelGfxRoute *route, int slot_index) {
  return gfx_route_file_for_sprite_slot_mode(route, slot_index, GFX_ROUTE_MODE_BYPASS);
}

uint8_t gfx_route_file_for_sprite_slot_mode(const LevelGfxRoute *route, int slot_index, int route_mode) {
  if (!route || !route->valid || slot_index < 0 || slot_index >= GFX_SLOT_COUNT) {
    return 0;
  }
  if (route_mode == GFX_ROUTE_MODE_VANILLA) {
    for (int p = 0; p < 4; p++) {
      if (kMap16PageToSlot[p] == (uint8_t)slot_index) {
        uint8_t van = vanilla_file_for_page(route->tileset, p);
        if (van) return van;
        break;
      }
    }
  }
  if (route->slot_file_id[slot_index] != 0) {
    return route->slot_file_id[slot_index];
  }
  for (int p = 0; p < 4; p++) {
    if (kMap16PageToSlot[p] == (uint8_t)slot_index) {
      return route->file_id_for_page[p];
    }
  }
  return 0;
}

uint8_t gfx_route_vanilla_file_for_page(const LevelGfxRoute *route, int page) {
  if (!route || page < 0 || page > 3) return 0;
  return vanilla_file_for_page(route->tileset, page);
}

void gfx_route_resolve_subtile(const LevelGfxRoute *route, uint16_t tile8, int route_mode,
                               uint8_t *out_file_id, uint16_t *out_local) {
  uint8_t page = (uint8_t)((tile8 >> 8) & 0x03u);
  uint8_t fid = page;
  if (route && route->valid) {
    fid = gfx_route_file_for_tile_mode(route, tile8, route_mode);
  }

  uint16_t local = (uint16_t)(tile8 & 0x7Fu);
  if (route && route->valid && (tile8 & 0x180u) == 0x180u) {
    uint8_t sp3 = gfx_route_file_for_sprite_slot_mode(route, GFX_SLOT_SP3, route_mode);
    if (sp3 != 0) fid = sp3;
    if (local >= 0x54u) local = (uint16_t)(local - 0x54u);
  }

  if (out_file_id) *out_file_id = fid;
  if (out_local) *out_local = local;
}

static size_t append_unique_id(uint8_t *out_ids, size_t n, size_t max_out, uint8_t fid) {
  if (fid == 0 || !out_ids || n >= max_out) return n;
  for (size_t j = 0; j < n; j++) {
    if (out_ids[j] == fid) return n;
  }
  out_ids[n++] = fid;
  return n;
}

size_t gfx_route_collect_preload_ids(const LevelGfxRoute *route, uint8_t *out_ids, size_t max_out) {
  if (!route || !out_ids || max_out == 0) return 0;
  size_t n = 0;
  for (int p = 0; p < 4; p++) {
    n = append_unique_id(out_ids, n, max_out, route->file_id_for_page[p]);
    n = append_unique_id(out_ids, n, max_out, gfx_route_vanilla_file_for_page(route, p));
  }
  if (route->has_bypass_table) {
    for (int s = 0; s < GFX_SLOT_COUNT; s++) {
      n = append_unique_id(out_ids, n, max_out, route->slot_file_id[s]);
    }
  }
  return n;
}

size_t gfx_route_collect_file_ids(const LevelGfxRoute *route, uint8_t *out_ids, size_t max_out) {
  return gfx_route_collect_preload_ids(route, out_ids, max_out);
}

void gfx_route_print_manifest(const LevelGfxRoute *route, const uint8_t *exgfx_bytes, size_t exgfx_len) {
  if (!route) return;
  fprintf(stderr, "LV_REPORT_GFX tileset=%u\n", (unsigned)route->tileset);
  for (int p = 0; p < 4; p++) {
    fprintf(stderr, "LV_REPORT_GFX page=%d file=0x%02X vanilla=0x%02X slot=%s\n", p,
            (unsigned)route->file_id_for_page[p], (unsigned)gfx_route_vanilla_file_for_page(route, p),
            gfx_route_slot_name(kMap16PageToSlot[p]));
  }
  if (exgfx_bytes && exgfx_len >= 32) {
    for (int s = 0; s < GFX_SLOT_COUNT; s++) {
      uint16_t raw = (uint16_t)(exgfx_bytes[s * 2] | ((uint16_t)exgfx_bytes[s * 2 + 1] << 8));
      fprintf(stderr, "LV_REPORT_GFX slot=%02d name=%s file=0x%02X raw=0x%04X\n", s, gfx_route_slot_name(s),
              (unsigned)route->slot_file_id[s], (unsigned)raw);
    }
  }
}
