#include "lm_tables.h"

#include <stdio.h>
#include <string.h>

#include "layer1_validate.h"

static void seterr(char *err, size_t cap, const char *msg) {
  if (!err || cap == 0) return;
  snprintf(err, cap, "%s", msg ? msg : "error");
}

static uint32_t snes(uint8_t bank, uint16_t addr) {
  return ((uint32_t)bank << 16) | (uint32_t)addr;
}

static int pc_to_snes_lorom_guess(const Rom *rom, uint32_t pc, uint32_t *out_snes24) {
  if (!rom || !out_snes24) return 0;
  if (pc >= rom->size) return 0;

  // This is the inverse of the LoROM/ExLoROM mapping used in snes_lorom_to_pc().
  // It is not a full SNES mapper; it only covers the ROM regions we care about
  // for locating pointer table blocks.
  uint32_t bank = 0;
  uint32_t addr = 0;
  if (rom->map_mode == 0x23) {
    // SA-1 ExROM: upper half is commonly addressed via $C0-FF:0000-FFFF.
    if (rom->size > 0x400000 && pc >= 0x400000) {
      uint32_t pc2 = pc - 0x400000;
      bank = 0xC0 + (pc2 / 0x10000u);
      addr = pc2 % 0x10000u;
    } else {
      bank = (pc / 0x8000u) & 0x3Fu;
      addr = 0x8000u + (pc % 0x8000u);
    }
    *out_snes24 = ((bank & 0xFFu) << 16) | (addr & 0xFFFFu);
    return 1;
  }
  if (rom->size > 0x400000 && pc >= 0x400000) {
    uint32_t pc2 = pc - 0x400000;
    bank = 0x40 + (pc2 / 0x8000u);
    addr = 0x8000u + (pc2 % 0x8000u);
  } else {
    bank = (pc / 0x8000u) & 0x7Fu;
    addr = 0x8000u + (pc % 0x8000u);
  }
  if (bank > 0xFF || addr > 0xFFFF) return 0;
  *out_snes24 = ((bank & 0xFFu) << 16) | (addr & 0xFFFFu);
  return 1;
}

static int pc_to_snes_hirom_guess(const Rom *rom, uint32_t pc, uint32_t *out_snes24) {
  if (!rom || !out_snes24) return 0;
  if (pc >= rom->size) return 0;

  // HiROM-style mirror: banks $C0-FF map 64KB chunks directly.
  // For >4MB ROMs this only covers the first 4MB; SA-1/ExROM is handled separately
  // by pc_to_snes_lorom_guess().
  uint32_t bank = 0xC0u + ((pc / 0x10000u) & 0x3Fu);
  uint32_t addr = pc % 0x10000u;
  *out_snes24 = (bank << 16) | addr;
  return 1;
}

static int looks_like_layer1_blob_at_ptr(const Rom *rom, uint32_t ptr_snes24) {
  uint32_t pc = 0;
  if (!snes_lorom_to_pc(rom, ptr_snes24, &pc)) return 0;
  if (pc + 6 >= rom->size) return 0;

  const uint8_t *p = rom->data + pc;
  size_t avail = rom->size - pc;
  return layer1_blob_looks_valid(p, avail);
}

static int validate_layer1_ptr_table_block(const Rom *rom, uint32_t layer1_table_snes24) {
  // Validate the "table block" by checking a handful of entries for plausibility.
  int ok = 0;
  int total = 0;
  for (uint16_t i = 0; i < 0x200; i += 0x11) { // 0x11 is relatively prime to 0x200
    uint16_t id = i & 0x1FF;
    uint32_t entry = layer1_table_snes24 + (uint32_t)id * 3u;
    uint32_t ptr = 0;
    total++;
    if (!rom_read24_snes(rom, entry, &ptr)) continue;
    if (looks_like_layer1_blob_at_ptr(rom, ptr)) ok++;
    if (total >= 32) break;
  }
  return ok >= 24;
}

static int find_layer1_ptr_table_block(const Rom *rom, uint32_t *out_layer1_table_snes24) {
  if (!rom || !out_layer1_table_snes24) return 0;

  // Search in 8KB-aligned chunks first; pointer table blocks are usually bank-aligned.
  // The Layer1 pointer table itself is 0x600 bytes.
  const uint32_t step = 0x20;  // small-ish stride to handle unusual placements
  const uint32_t max_pc = (rom->size > 0x600) ? (uint32_t)(rom->size - 0x600) : 0;
  for (uint32_t pc = 0; pc <= max_pc; pc += step) {
    uint32_t snes24 = 0;
    if (pc_to_snes_lorom_guess(rom, pc, &snes24) && validate_layer1_ptr_table_block(rom, snes24)) {
      *out_layer1_table_snes24 = snes24;
      return 1;
    }
    // Some hacks store the table block in a HiROM-mirrored region (addr < 0x8000).
    if (pc_to_snes_hirom_guess(rom, pc, &snes24) && validate_layer1_ptr_table_block(rom, snes24)) {
      *out_layer1_table_snes24 = snes24;
      return 1;
    }
  }
  return 0;
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

  // Some hacks (e.g. SA-1 / ExROM) relocate the entire level table block.
  // If the default layer1 pointer table doesn't look plausible, attempt a scan.
  if (!validate_layer1_ptr_table_block(rom, out->layer1_ptr_table)) {
    uint32_t layer1_found = 0;
    if (find_layer1_ptr_table_block(rom, &layer1_found)) {
      // Preserve the standard intra-block layout offsets.
      out->layer1_ptr_table = layer1_found;
      out->layer2_ptr_table = layer1_found + 0x600;
      out->sprite_ptr_table = layer1_found + 0xC00;
      out->sec_byte1 = layer1_found + 0x1000;
      out->sec_byte2 = layer1_found + 0x1200;
      out->sec_byte3 = layer1_found + 0x1400;
      out->sec_byte4 = layer1_found + 0x1600;
    }
  }

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

