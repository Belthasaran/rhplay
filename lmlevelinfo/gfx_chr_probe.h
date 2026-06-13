#pragma once

#include <stddef.h>

/* Regression gate: muncher GFX routing at level 109 tile (74,22). */
int gfx_chr_probe_muncher_regression(const char *rom_path, const char *ref_ppm, unsigned munch_tx, unsigned munch_ty,
                                   char *err, size_t errcap);

/* Regression gate: coin GFX routing at level 109 tile (27,15) for acts-like 0x002B / Map16 0x03AB. */
int gfx_chr_probe_coin_regression(const char *rom_path, const char *ref_ppm, char *err, size_t errcap);
