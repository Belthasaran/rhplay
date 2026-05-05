#include "romutil.h"

#include <stdlib.h>
#include <string.h>

static void seterr(char *err, size_t cap, const char *msg) {
  if (!err || cap == 0) return;
  snprintf(err, cap, "%s", msg ? msg : "error");
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
  if (addr < 0x8000) return 0;

  // Same mapping used by snesrev_smw/assets/util.py:
  // ea = ((ea >> 16) & 0x7f) * 0x8000 + (ea & 0x7fff)
  uint32_t pc = (bank & 0x7F) * 0x8000u + (addr & 0x7FFFu);
  if (pc >= rom->size) return 0;
  *pc_out = pc;
  return 1;
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

