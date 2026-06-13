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

void gfx_route_resolve_lm_oracle_chr(const LevelGfxRoute *route, uint16_t chr, int route_mode,
                                     uint8_t *out_file_id, uint16_t *out_local) {
  /* FG_pages 3-digit CHR: values 0x1F0+ use LM bypass slot (hi digit + BG2), e.g. 0x1FA -> FG3.
   * Values 0x100-0x1EF use SMW tile8 page bits (same as AllMap16 pool words), e.g. 0x190 -> page 1. */
  if (chr >= 0x100u && (chr & 0xFFu) < 0xF0u) {
    gfx_route_resolve_subtile(route, chr, route_mode, out_file_id, out_local);
    return;
  }

  uint8_t fid = 0;
  if (route && route->valid) {
    if (chr >= 0x100u) {
      unsigned hi = (unsigned)((chr >> 8) & 0x0Fu);
      int slot = (int)hi + (int)GFX_SLOT_BG2;
      if (slot >= 0 && slot < GFX_SLOT_COUNT) {
        fid = gfx_route_file_for_sprite_slot_mode(route, slot, route_mode);
      }
    }
    if (fid == 0) {
      uint8_t page = (uint8_t)((chr >> 8) & 0x03u);
      fid = gfx_route_file_for_tile_mode(route, (uint16_t)((unsigned)page << 8), route_mode);
    }
  }
  uint16_t low = (uint16_t)(chr & 0xFFu);
  uint16_t local = (low >= 0x80u) ? (uint16_t)(low - 0x80u) : (uint16_t)(low & 0x7Fu);
  if (out_file_id) *out_file_id = fid;
  if (out_local) *out_local = local;
}

void gfx_route_resolve_subtile(const LevelGfxRoute *route, uint16_t tile8, int route_mode,
                               uint8_t *out_file_id, uint16_t *out_local) {
  uint8_t page = (uint8_t)((tile8 >> 8) & 0x03u);
  uint8_t fid = page;
  if (route && route->valid) {
    fid = gfx_route_file_for_tile_mode(route, tile8, route_mode);
  }
  uint16_t local = (uint16_t)(tile8 & 0x7Fu);
  if (out_file_id) *out_file_id = fid;
  if (out_local) *out_local = local;
}

int gfx_route_tile8_is_vanilla_muncher_local(uint16_t tile8) {
  uint16_t local = (uint16_t)(tile8 & 0x7Fu);
  return ((tile8 >> 8) & 0x03u) == 0u && local >= 0x5Cu && local <= 0x5Fu;
}

int gfx_route_resolve_012f_muncher(const LevelGfxRoute *route, int corner_si, int route_mode,
                                   uint8_t *out_file_id, uint16_t *out_local) {
  static const struct {
    int slot;
    uint16_t local;
  } kRoute[4] = {
      {GFX_SLOT_BG1, 0x000},
      {GFX_SLOT_BG1, 0x004},
      {GFX_SLOT_LG3, 0x017},
      {GFX_SLOT_BG1, 0x004},
  };
  if (corner_si < 0 || corner_si > 3) return 0;
  uint8_t fid = 0;
  if (route && route->valid) {
    fid = gfx_route_file_for_sprite_slot_mode(route, kRoute[corner_si].slot, route_mode);
  }
  if (fid == 0) return 0;
  if (out_file_id) *out_file_id = fid;
  if (out_local) *out_local = kRoute[corner_si].local;
  return 1;
}

void gfx_route_012f_muncher_blit_flips(int corner_si, int *hflip, int *vflip) {
  static const struct {
    int hflip;
    int vflip;
  } kFlips[4] = {
      {0, 1},
      {0, 0},
      {0, 1},
      {1, 0},
  };
  if (corner_si < 0 || corner_si > 3) return;
  if (hflip) *hflip = kFlips[corner_si].hflip;
  if (vflip) *vflip = kFlips[corner_si].vflip;
}

void gfx_route_012f_muncher_blit_flips_oracle(int oracle_si, int *hflip, int *vflip) {
  static const int oracle_to_screen[4] = {0, 2, 1, 3};
  if (oracle_si < 0 || oracle_si > 3) return;
  gfx_route_012f_muncher_blit_flips(oracle_to_screen[oracle_si], hflip, vflip);
}

int gfx_route_012f_muncher_template_si(int oracle_si, int down_facing) {
  static const int kDownFacing[4] = {1, 0, 3, 2};
  if (oracle_si < 0 || oracle_si > 3) return oracle_si;
  return down_facing ? kDownFacing[oracle_si] : oracle_si;
}

int gfx_route_resolve_002b_coin(const LevelGfxRoute *route, int oracle_si, int route_mode,
                                uint8_t *out_file_id, uint16_t *out_local) {
  static const struct {
    int slot;
    uint16_t local;
  } kRoute[4] = {
      {GFX_SLOT_SP1, 0x058},
      {GFX_SLOT_SP4, 0x012},
      {GFX_SLOT_LG3, 0x01A},
      {GFX_SLOT_LG1, 0x019},
  };
  if (oracle_si < 0 || oracle_si > 3) return 0;
  uint8_t fid = 0;
  if (route && route->valid) {
    fid = gfx_route_file_for_sprite_slot_mode(route, kRoute[oracle_si].slot, route_mode);
  }
  if (fid == 0) return 0;
  if (out_file_id) *out_file_id = fid;
  if (out_local) *out_local = kRoute[oracle_si].local;
  return 1;
}

void gfx_route_002b_coin_blit_flips(int corner_si, int *hflip, int *vflip) {
  static const int screen_to_oracle[4] = {0, 2, 1, 3};
  if (corner_si < 0 || corner_si > 3) return;
  gfx_route_002b_coin_blit_flips_oracle(screen_to_oracle[corner_si], hflip, vflip);
}

void gfx_route_002b_coin_blit_flips_oracle(int oracle_si, int *hflip, int *vflip) {
  static const struct {
    int hflip;
    int vflip;
  } kFlips[4] = {
      {0, 0},
      {1, 1},
      {1, 1},
      {0, 1},
  };
  if (oracle_si < 0 || oracle_si > 3) return;
  if (hflip) *hflip = kFlips[oracle_si].hflip;
  if (vflip) *vflip = kFlips[oracle_si].vflip;
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
