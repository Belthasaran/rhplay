#pragma once

#include <stdint.h>
#include <stdio.h>

typedef struct {
  uint8_t *data;
  size_t size;
  int has_smc_header;
} Rom;

int rom_load(Rom *rom, const char *path, char *err, size_t errcap);
void rom_free(Rom *rom);

// SNES LoROM mapping helpers
// Accepts a 24-bit SNES address in the form 0xBB:AAAA (bank in high byte).
// Returns 1 and sets *pc_out on success; 0 if unmappable/out of range.
int snes_lorom_to_pc(const Rom *rom, uint32_t snes24, uint32_t *pc_out);

int rom_read8_snes(const Rom *rom, uint32_t snes24, uint8_t *out);
int rom_read16_snes(const Rom *rom, uint32_t snes24, uint16_t *out);   // little-endian
int rom_read24_snes(const Rom *rom, uint32_t snes24, uint32_t *out);   // little-endian 24-bit value

