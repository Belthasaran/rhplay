#pragma once

#include <stdio.h>
#include <stdint.h>

#include "level_parse.h"
#include "lm_tables.h"

// Write an LM 3.63-style MWL file for the given level (best-effort).
// Populates:
//  - Level information section
//  - Layer 1 data section (raw blob from ROM)
//  - Layer 2 section (tilemap or object stream when available)
//  - Sprite section (raw sprite stream when available)
//  - Palette / secondary entrances / ExAnimation / ExGFX-bypass when present in `LevelInfo`
// Some header semantics may vary across hacks/LM versions; tests gate strictness accordingly.
// Returns 1 on success.
int mwl_write_minimal(FILE *fp, const LevelInfo *info, const LmTables *tables, const Rom *rom);

