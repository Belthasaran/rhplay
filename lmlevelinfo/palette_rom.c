#include "palette_rom.h"

#include <string.h>

// snesrev smw_00.c
static const uint8_t kPalWordOffset[12] = {
    0x00, 0x18, 0x30, 0x48, 0x60, 0x78, 0x90, 0xa8, 0x00, 0x14, 0x28, 0x3c,
};

static const uint16_t kGlobalPalettes_Sky[8] = {
    0x7FFF, 0x7AB4, 0x6B94, 0x5A71, 0x494E, 0x382B, 0x2708, 0x15E5,
};

static void snes15_to_rgb(uint16_t c, uint8_t *r, uint8_t *g, uint8_t *b) {
  uint8_t rr = (uint8_t)(c & 0x1F);
  uint8_t gg = (uint8_t)((c >> 5) & 0x1F);
  uint8_t bb = (uint8_t)((c >> 10) & 0x1F);
  *r = (uint8_t)((rr * 255u) / 31u);
  *g = (uint8_t)((gg * 255u) / 31u);
  *b = (uint8_t)((bb * 255u) / 31u);
}

static int read_rom_u16_le(const Rom *rom, uint32_t snes_addr, uint16_t *out) {
  uint32_t pc = 0;
  if (!rom || !out) return 0;
  if (!snes_lorom_to_pc(rom, snes_addr, &pc) || pc + 1 >= rom->size) return 0;
  *out = (uint16_t)rom->data[pc] | ((uint16_t)rom->data[pc + 1] << 8);
  return 1;
}

static void build_fallback_palette(uint8_t pal256[256][3], uint8_t fg_pal, uint8_t bg_pal, uint8_t sprite_pal) {
  static const uint8_t base8[8][3] = {
      { 200, 200, 200 }, { 220, 120, 120 }, { 120, 220, 120 }, { 120, 160, 240 },
      { 220, 200, 120 }, { 200, 120, 220 }, { 120, 220, 220 }, { 220, 160, 120 },
  };
  uint8_t f = (uint8_t)(fg_pal & 7);
  uint8_t b = (uint8_t)(bg_pal & 7);
  uint8_t s = (uint8_t)(sprite_pal & 7);
  for (int p = 0; p < 16; p++) {
    uint8_t hue = (uint8_t)((p + f + b + (s * 3)) & 7);
    uint8_t br = base8[hue][0], bg = base8[hue][1], bb = base8[hue][2];
    for (int i = 0; i < 16; i++) {
      uint8_t k = (uint8_t)(255u - (uint32_t)i * 10u);
      int idx = p * 16 + i;
      pal256[idx][0] = (uint8_t)((br * k) / 255u);
      pal256[idx][1] = (uint8_t)((bg * k) / 255u);
      pal256[idx][2] = (uint8_t)((bb * k) / 255u);
    }
  }
}

const char *palette_source_name(PaletteSource src) {
  switch (src) {
    case PAL_SOURCE_CUSTOM: return "custom";
    case PAL_SOURCE_ROM: return "rom";
    default: return "fallback";
  }
}

static PaletteSource palette_from_custom(const LevelInfo *info, uint8_t pal256[256][3],
                                         uint8_t *out_back_r, uint8_t *out_back_g, uint8_t *out_back_b) {
  uint16_t back = (uint16_t)(info->palette_bytes[0] | ((uint16_t)info->palette_bytes[1] << 8));
  snes15_to_rgb(back, out_back_r, out_back_g, out_back_b);
  for (int i = 0; i < 256; i++) {
    size_t off = (size_t)(1 + i) * 2u;
    uint16_t c = (uint16_t)(info->palette_bytes[off] | ((uint16_t)info->palette_bytes[off + 1] << 8));
    snes15_to_rgb(c, &pal256[i][0], &pal256[i][1], &pal256[i][2]);
  }
  // Map16 may reference palette rows 8-15; mirror rows 0-7 like ROM table path.
  for (int pal_line = 8; pal_line < 16; pal_line++) {
    for (int c = 0; c < 16; c++) {
      int src = (pal_line & 7) * 16 + c;
      int dst = pal_line * 16 + c;
      pal256[dst][0] = pal256[src][0];
      pal256[dst][1] = pal256[src][1];
      pal256[dst][2] = pal256[src][2];
    }
  }
  return PAL_SOURCE_CUSTOM;
}

static PaletteSource palette_from_rom_tables(const Rom *rom, const PrimaryLevelHeader *primary,
                                             uint8_t pal256[256][3], uint8_t *out_back_r, uint8_t *out_back_g,
                                             uint8_t *out_back_b) {
  uint32_t fg_base = 0x00B190u;
  uint32_t bg_base = 0x00B0B0u;
  uint32_t fg_word_off = (uint32_t)(kPalWordOffset[primary->fg_palette & 7] >> 1);
  uint32_t bg_word_off = (uint32_t)(kPalWordOffset[primary->bg_palette & 7] >> 1);

  uint8_t sky_idx = (uint8_t)(primary->back_area_color & 7);
  uint16_t back_c = kGlobalPalettes_Sky[sky_idx];
  snes15_to_rgb(back_c, out_back_r, out_back_g, out_back_b);

  // Map16 palette lines 0-3: BG rows; 4-7: FG rows (16 colors each from ROM tables).
  for (int pal_line = 0; pal_line < 8; pal_line++) {
    uint32_t base = (pal_line < 4) ? bg_base : fg_base;
    uint32_t off = (pal_line < 4) ? bg_word_off : fg_word_off;
    uint32_t row = (uint32_t)(pal_line < 4 ? pal_line : (pal_line - 4));
    for (int c = 0; c < 16; c++) {
      uint32_t widx = off + row * 16u + (uint32_t)c;
      if (widx >= 96u) widx %= 96u;
      uint16_t col = 0;
      if (!read_rom_u16_le(rom, base + widx * 2u, &col)) {
        return PAL_SOURCE_FALLBACK;
      }
      int idx = pal_line * 16 + c;
      snes15_to_rgb(col, &pal256[idx][0], &pal256[idx][1], &pal256[idx][2]);
    }
  }
  // Duplicate lines 0-7 into 8-15 for Map16 palettes that reference higher rows.
  for (int pal_line = 8; pal_line < 16; pal_line++) {
    for (int c = 0; c < 16; c++) {
      int src = (pal_line & 7) * 16 + c;
      int dst = pal_line * 16 + c;
      pal256[dst][0] = pal256[src][0];
      pal256[dst][1] = pal256[src][1];
      pal256[dst][2] = pal256[src][2];
    }
  }
  return PAL_SOURCE_ROM;
}

PaletteSource palette_build_for_level(const Rom *rom, const LevelInfo *info, uint8_t pal256[256][3],
                                      uint8_t *out_back_r, uint8_t *out_back_g, uint8_t *out_back_b) {
  if (!info || !pal256) return PAL_SOURCE_FALLBACK;

  if (info->palette_present && info->palette_bytes && info->palette_len >= 514) {
    return palette_from_custom(info, pal256, out_back_r, out_back_g, out_back_b);
  }

  if (rom && palette_from_rom_tables(rom, &info->primary, pal256, out_back_r, out_back_g, out_back_b) ==
              PAL_SOURCE_ROM) {
    return PAL_SOURCE_ROM;
  }

  build_fallback_palette(pal256, info->primary.fg_palette, info->primary.bg_palette, info->primary.sprite_palette);
  if (out_back_r && out_back_g && out_back_b) {
    *out_back_r = 0;
    *out_back_g = 0;
    *out_back_b = 80;
  }
  return PAL_SOURCE_FALLBACK;
}
