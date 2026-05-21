#pragma once

#include <stddef.h>
#include <stdint.h>

#include "gfx_route.h"

typedef struct {
  size_t total_objects;
  size_t handled;
  size_t unknown;
  size_t skipped_nonvisual;
  size_t decoded_present;
  size_t map16_miss;
  size_t gfx_miss;
  size_t gfx_load_fail;
  size_t gfx_tile_oob;
  size_t gfx_fallback_ok;
  size_t subtiles_drawn;
  uint32_t gfx_miss_by_file[256];
  uint16_t gfx_page_max_local[4];
  size_t gfx_page_subtiles[4];
} ObjectEmitStats;

void emit_stats_reset(ObjectEmitStats *s);
void emit_stats_print_human(const ObjectEmitStats *s, const char *label);
void emit_stats_print_line(const ObjectEmitStats *s);

// Print top N file ids by gfx_miss count.
void emit_stats_print_top_gfx_miss(const ObjectEmitStats *s, int top_n);

void emit_stats_print_gfx_miss_reasons(const ObjectEmitStats *s);
void emit_stats_print_gfx_page_debug(const ObjectEmitStats *s, const LevelGfxRoute *route);
