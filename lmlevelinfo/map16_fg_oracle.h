#pragma once

#include <stddef.h>
#include <stdint.h>

#include "map16_reader.h"

/* Load LM FG_pages/page_*.txt visual oracles (CHR/pal/flips as LM renders). */
int map16_load_fg_oracles(const char *dir, Map16Data *m, char *err, size_t errcap);

/* Derive test/akogare-style oracle dir from AllMap16.map16 path; returns 1 if path exists. */
int map16_try_auto_fg_oracle_dir(const char *map16_path, char *out_dir, size_t outcap);

int map16_has_fg_oracle(const Map16Data *m, uint16_t tile_id);

int map16_get_fg_oracle(const Map16Data *m, uint16_t tile_id, Map16Tile *out);
