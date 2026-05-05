#include "romutil.h"

#include <stdlib.h>
#include <string.h>

static void seterr(char *err, size_t cap, const char *msg) {
  if (!err || cap == 0) return;
  snprintf(err, cap, "%s", msg ? msg : "error");
}

static uint8_t guess_map_mode(const Rom *rom) {
  // Best-effort guess: prefer a sane value from the likely header location.
  // LoROM header at 0x7FD5, HiROM at 0xFFD5, ExHiROM at 0x40FFD5.
  static const uint8_t sane[] = { 0x20, 0x21, 0x23, 0x30, 0x31, 0x32, 0x35 };
  if (!rom || !rom->data) return 0;
  uint8_t cands[3] = { 0, 0, 0 };
  if (rom->size > 0x7FD5) cands[0] = rom->data[0x7FD5];
  if (rom->size > 0xFFD5) cands[1] = rom->data[0xFFD5];
  if (rom->size > 0x40FFD5) cands[2] = rom->data[0x40FFD5];
  for (size_t i = 0; i < sizeof(cands); i++) {
    for (size_t j = 0; j < sizeof(sane); j++) {
      if (cands[i] == sane[j]) return cands[i];
    }
  }
  return cands[0] ? cands[0] : cands[1];
}

int rom_load(Rom *rom, const char *path, char *err, size_t errcap) {
  if (!rom || !path) {
    seterr(err, errcap, "rom_load: invalid args");
    return 0;
  }
  memset(rom, 0, sizeof(*rom));

  FILE *fp = fopen(path, "rb");
  if (!fp) {
    seterr(err, errcap, "Could not open ROM file");
    return 0;
  }
  if (fseek(fp, 0, SEEK_END) != 0) {
    fclose(fp);
    seterr(err, errcap, "Could not seek ROM file");
    return 0;
  }
  long fsz = ftell(fp);
  if (fsz <= 0) {
    fclose(fp);
    seterr(err, errcap, "ROM file is empty");
    return 0;
  }
  if (fseek(fp, 0, SEEK_SET) != 0) {
    fclose(fp);
    seterr(err, errcap, "Could not rewind ROM file");
    return 0;
  }

  rom->data = (uint8_t *)malloc((size_t)fsz);
  if (!rom->data) {
    fclose(fp);
    seterr(err, errcap, "Out of memory reading ROM");
    return 0;
  }
  size_t rd = fread(rom->data, 1, (size_t)fsz, fp);
  fclose(fp);
  if (rd != (size_t)fsz) {
    free(rom->data);
    rom->data = NULL;
    seterr(err, errcap, "Short read reading ROM");
    return 0;
  }
  rom->size = (size_t)fsz;

  // Detect 0x200-byte SMC header (common for .smc/.sfc dumps)
  // Heuristic: size mod 0x10000 == 0x200.
  rom->has_smc_header = ((rom->size & 0xFFFF) == 0x200);
  if (rom->has_smc_header) {
    // Strip header by shifting pointer window (copy for simplicity).
    size_t newSize = rom->size - 0x200;
    uint8_t *trim = (uint8_t *)malloc(newSize);
    if (!trim) {
      rom_free(rom);
      seterr(err, errcap, "Out of memory stripping SMC header");
      return 0;
    }
    memcpy(trim, rom->data + 0x200, newSize);
    free(rom->data);
    rom->data = trim;
    rom->size = newSize;
  }
  rom->map_mode = guess_map_mode(rom);
  return 1;
}

void rom_free(Rom *rom) {
  if (!rom) return;
  free(rom->data);
  rom->data = NULL;
  rom->size = 0;
  rom->has_smc_header = 0;
}

int snes_lorom_to_pc(const Rom *rom, uint32_t snes24, uint32_t *pc_out) {
  if (!rom || !rom->data || rom->size == 0 || !pc_out) return 0;
  uint32_t bank = (snes24 >> 16) & 0xFF;
  uint32_t addr = snes24 & 0xFFFF;

  // SA-1 / ExROM LoROM mapping (common in large SMW hacks).
  // - Banks 00-3F and 80-BF:8000-FFFF map as LoROM into the first 4MB.
  // - Banks C0-FF:0000-FFFF map as HiROM-style mirror into the upper half (when present).
  if (rom->map_mode == 0x23) {
    if (addr >= 0x8000 && ((bank <= 0x3F) || (bank >= 0x80 && bank <= 0xBF))) {
      uint32_t pc = (bank & 0x3Fu) * 0x8000u + (addr & 0x7FFFu);
      // Many SA-1 hacks use $80-$BF for an alternate ROM window; empirically this maps
      // to +0x200000 relative to the $00-$3F LoROM window for SMW hacks we test.
      if (bank >= 0x80 && bank <= 0xBF) pc += 0x200000u;
      if (pc < rom->size) {
        *pc_out = pc;
        return 1;
      }
      return 0;
    }
    if (bank >= 0xC0) {
      uint32_t pc = (bank & 0x3Fu) * 0x10000u + addr;
      if (rom->size > 0x400000) {
        uint32_t pc2 = pc + 0x400000u;
        if (pc2 < rom->size) {
          *pc_out = pc2;
          return 1;
        }
      }
      if (pc < rom->size) {
        *pc_out = pc;
        return 1;
      }
      return 0;
    }
    return 0;
  }

  // Primary path: LoROM mapping (and ExLoROM extension for > 4MB ROMs).
  if (addr >= 0x8000) {
    // Mirror high bit first (00-7F == 80-FF for standard LoROM).
    uint32_t bank7 = bank & 0x7Fu;

    // ExLoROM for >4MB:
    //   pc = ((bank7 & 0x3F) * 0x8000) + (addr & 0x7FFF) + (bank7 >= 0x40 ? 0x400000 : 0)
    // Classic LoROM (<=4MB):
    //   pc = (bank7 * 0x8000) + (addr & 0x7FFF)
    uint32_t pc = 0;
    if (rom->size > 0x400000) {
      pc = (bank7 & 0x3Fu) * 0x8000u + (addr & 0x7FFFu);
      if (bank7 >= 0x40) pc += 0x400000u;
    } else {
      pc = bank7 * 0x8000u + (addr & 0x7FFFu);
    }
    if (pc >= rom->size) return 0;
    *pc_out = pc;
    return 1;
  }

  // Fallback path: some ROMs (notably SA-1 / ExROM variants) place ROM mirrors
  // into HiROM-style banks, where pointers may land in $C0-FF:0000-7FFF.
  if (bank >= 0xC0) {
    uint32_t pc = (bank & 0x3Fu) * 0x10000u + addr;
    if (rom->size > 0x400000) {
      uint32_t pc2 = pc + 0x400000u;
      if (pc2 < rom->size) {
        *pc_out = pc2;
        return 1;
      }
    }
    if (pc < rom->size) {
      *pc_out = pc;
      return 1;
    }
  }

  return 0;
}

static int rom_read_pc(const Rom *rom, uint32_t pc, uint8_t *out, size_t n) {
  if (!rom || !rom->data || !out) return 0;
  if (pc + n > rom->size) return 0;
  memcpy(out, rom->data + pc, n);
  return 1;
}

int rom_read8_snes(const Rom *rom, uint32_t snes24, uint8_t *out) {
  uint32_t pc;
  if (!snes_lorom_to_pc(rom, snes24, &pc)) return 0;
  return rom_read_pc(rom, pc, out, 1);
}

int rom_read16_snes(const Rom *rom, uint32_t snes24, uint16_t *out) {
  uint32_t pc;
  uint8_t b[2];
  if (!snes_lorom_to_pc(rom, snes24, &pc)) return 0;
  if (!rom_read_pc(rom, pc, b, 2)) return 0;
  *out = (uint16_t)(b[0] | (uint16_t)b[1] << 8);
  return 1;
}

int rom_read24_snes(const Rom *rom, uint32_t snes24, uint32_t *out) {
  uint32_t pc;
  uint8_t b[3];
  if (!snes_lorom_to_pc(rom, snes24, &pc)) return 0;
  if (!rom_read_pc(rom, pc, b, 3)) return 0;
  *out = (uint32_t)(b[0] | ((uint32_t)b[1] << 8) | ((uint32_t)b[2] << 16));
  return 1;
}

