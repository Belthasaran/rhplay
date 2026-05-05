#pragma once

#include <stdint.h>

#include "romutil.h"

typedef struct {
  // Pointer tables (these are normally fixed, but we still keep in the struct for reporting)
  uint32_t layer1_ptr_table;   // SNES address
  uint32_t layer2_ptr_table;   // SNES address
  uint32_t sprite_ptr_table;   // SNES address (2-byte offsets)
  uint32_t sprite_bank_table;  // SNES address (bank bytes), 0 if not present

  // Secondary header per-level tables (1 byte per level, indexed by level id)
  uint32_t sec_byte1;
  uint32_t sec_byte2;
  uint32_t sec_byte3;
  uint32_t sec_byte4;
  uint32_t sec_byte5;  // optional (LM expansion)
  uint32_t sec_byte6;  // optional (LM 3.40+; $06FA00)
  uint32_t sec_byte7;  // optional (LM 3.00+; $06FC00)
  uint32_t sec_byte8;  // optional (LM 3.00+; $06FE00)

  // Midway entrance extra tables (optional hijack)
  uint32_t midway_byte1;
  uint32_t midway_byte2;
  uint32_t midway_byte3;

  // Misc flags useful for printing/debug
  int has_secondary_expansion;
  int has_midway_hijack;
  int has_sprite_bank_table;
} LmTables;

// Resolve key table addresses (including common LM hijacks/moved tables).
// Returns 1 on success, 0 on failure.
int lm_resolve_tables(const Rom *rom, LmTables *out, char *err, size_t errcap);

