#pragma once

#include <stdio.h>
#include <stdint.h>

#include "level_parse.h"
#include "lm_tables.h"

// Write a minimal MWL file for the given level.
// Populates:
//  - Level information section
//  - Layer 1 data section (raw blob from ROM)
// Other pointers are written as size 0.
// Returns 1 on success.
int mwl_write_minimal(FILE *fp, const LevelInfo *info, const LmTables *tables, const Rom *rom);

