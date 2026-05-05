#include "lm_tables.h"

#include <stdio.h>
#include <string.h>

static void seterr(char *err, size_t cap, const char *msg) {
  if (!err || cap == 0) return;
  snprintf(err, cap, "%s", msg ? msg : "error");
}

static uint32_t snes(uint8_t bank, uint16_t addr) {
  return ((uint32_t)bank << 16) | (uint32_t)addr;
}

int lm_resolve_tables(const Rom *rom, LmTables *out, char *err, size_t errcap) {
  if (!rom || !rom->data || !out) {
    seterr(err, errcap, "lm_resolve_tables: invalid args");
    return 0;
  }
  memset(out, 0, sizeof(*out));

  // These pointer tables are literally never moved (per LevelTables.asm).
  out->layer1_ptr_table = snes(0x05, 0xE000);
  out->layer2_ptr_table = snes(0x05, 0xE600);
  out->sprite_ptr_table = snes(0x05, 0xEC00);

  // Secondary header base tables (vanilla fixed).
  out->sec_byte1 = snes(0x05, 0xF000);
  out->sec_byte2 = snes(0x05, 0xF200);
  out->sec_byte3 = snes(0x05, 0xF400);
  out->sec_byte4 = snes(0x05, 0xF600);

  // Optional sprite bank table: present if read1($0EF100) != $00
  // (LM adds a 512-byte table for the bank byte at $0EF100)
  uint8_t b = 0;
  if (rom_read8_snes(rom, snes(0x0E, 0xF100), &b) && b != 0x00) {
    out->sprite_bank_table = snes(0x0E, 0xF100);
    out->has_sprite_bank_table = 1;
  }

  // ---- Secondary header expansion (byte 5) ----
  // LevelTables.asm:
  // if read1($05D97D) == $22
  //   org $05<<16+read2(read3($05D97E)+5) ; $05DE00
  uint8_t op = 0;
  if (!rom_read8_snes(rom, snes(0x05, 0xD97D), &op)) {
    seterr(err, errcap, "Failed to read secondary header hijack probe");
    return 0;
  }
  if (op == 0x22) {
    uint32_t p = 0;
    uint16_t off = 0;
    if (rom_read24_snes(rom, snes(0x05, 0xD97E), &p) &&
        rom_read16_snes(rom, p + 5, &off)) {
      out->sec_byte5 = snes(0x05, (uint16_t)off);
      out->has_secondary_expansion = 1;
    }
  }

  // ---- Midway entrance hijack ----
  // LevelTables.asm:
  // if read1($05D9E3) == $22
  //   org read3(read3($05D9E4)+$0A) ; byte1
  //   org read3(read3($05D9E4)+$29) ; byte2
  //   org read3(read3($05D9E4)+$39) ; byte3
  if (rom_read8_snes(rom, snes(0x05, 0xD9E3), &op) && op == 0x22) {
    uint32_t p1 = 0;
    if (rom_read24_snes(rom, snes(0x05, 0xD9E4), &p1)) {
      uint32_t base = 0;
      if (rom_read24_snes(rom, p1 + 0x0A, &base)) out->midway_byte1 = base;
      if (rom_read24_snes(rom, p1 + 0x29, &base)) out->midway_byte2 = base;
      if (rom_read24_snes(rom, p1 + 0x39, &base)) out->midway_byte3 = base;
      if (out->midway_byte1 && out->midway_byte2 && out->midway_byte3) {
        out->has_midway_hijack = 1;
      }
    }
  }

  // ---- Secondary header extra bytes (LM 3.00+/3.40+) ----
  // From Level_Data_Format: additional per-level bytes at $06FA00, $06FC00, $06FE00.
  // These are fixed addresses when present. We treat them as present if mapping works and ROM is large enough.
  // If a hack is smaller than expected (rare), reads will fail and we leave them 0.
  uint8_t tmp = 0;
  if (rom_read8_snes(rom, snes(0x06, 0xFA00), &tmp)) out->sec_byte6 = snes(0x06, 0xFA00);
  if (rom_read8_snes(rom, snes(0x06, 0xFC00), &tmp)) out->sec_byte7 = snes(0x06, 0xFC00);
  if (rom_read8_snes(rom, snes(0x06, 0xFE00), &tmp)) out->sec_byte8 = snes(0x06, 0xFE00);

  return 1;
}

