#pragma once

#include <stddef.h>
#include <stdint.h>

#include "gfx_reader.h"
#include "gfx_route.h"
#include "level_parse.h"
#include "romutil.h"

typedef struct {
  size_t sprites_total;
  size_t sprites_drawn;
  size_t sprites_unknown;
  size_t sprites_gfx_miss;
} SpriteDrawStats;

typedef struct {
  uint8_t *rgb;
  uint32_t W;
  uint32_t H;
  Rom *rom;
  GfxCache *gfxc;
  const LevelGfxRoute *gfx_route;
  const uint8_t (*pal256)[3];
  uint8_t sprite_pal_base; // palette row 8-11 base from header
  uint8_t back_r;
  uint8_t back_g;
  uint8_t back_b;
  int sprite_debug;
  SpriteDrawStats *stats;
  char *err;
  size_t errcap;
} SpriteDrawCtx;

void sprite_draw_stats_reset(SpriteDrawStats *s);
void sprite_draw_stats_print_line(const SpriteDrawStats *s);

// Draw all level sprites on top of the canvas (call after Layer1).
void sprite_draw_level(const LevelInfo *info, SpriteDrawCtx *ctx);

// Log LV_REPORT_SPRITE_UNKNOWN lines for ids without GFX tables.
void sprite_draw_log_unknown_ids(const LevelInfo *info, FILE *fp);
