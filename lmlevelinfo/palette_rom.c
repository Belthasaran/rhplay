#include "palette_rom.h"

#include <string.h>

// snesrev smw_00.c kBufferPalettesRoutines_DATA_00ABD3
static const uint8_t kPalWordOffset[12] = {
    0x00, 0x18, 0x30, 0x48, 0x60, 0x78, 0x90, 0xa8, 0x00, 0x14, 0x28, 0x3c,
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

int palette_build_from_rom(const Rom *rom, const PrimaryLevelHeader *primary, uint8_t pal256[256][3],
                           uint8_t *out_back_r, uint8_t *out_back_g, uint8_t *out_back_b) {
  if (!rom || !primary || !pal256) return 0;

  uint32_t fg_base = 0x00B190u;
  uint32_t bg_base = 0x00B0B0u;
  uint32_t fg_off = (uint32_t)(kPalWordOffset[primary->fg_palette & 7] >> 1);
  uint32_t bg_off = (uint32_t)(kPalWordOffset[primary->bg_palette & 7] >> 1);

  uint16_t back_c = 0;
  if (!read_rom_u16_le(rom, bg_base + bg_off * 2u, &back_c)) return 0;
  if (out_back_r && out_back_g && out_back_b) snes15_to_rgb(back_c, out_back_r, out_back_g, out_back_b);

  for (int i = 0; i < 256; i++) {
    uint32_t widx = (fg_off + (uint32_t)i) % 96u;
    uint16_t c = 0;
    if (!read_rom_u16_le(rom, fg_base + widx * 2u, &c)) return 0;
    snes15_to_rgb(c, &pal256[i][0], &pal256[i][1], &pal256[i][2]);
  }
  return 1;
}
