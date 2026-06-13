#pragma once

#include <stddef.h>

/* Regression gate: muncher GFX routing at level 109 tile (74,22). */
int gfx_chr_probe_muncher_regression(const char *rom_path, const char *ref_ppm, unsigned munch_tx, unsigned munch_ty,
                                   char *err, size_t errcap);
