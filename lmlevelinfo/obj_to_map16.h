#pragma once

#include <stdint.h>
#include <stddef.h>
#include <stdio.h>

#include "level_parse.h"
#include "emit_stats.h"

typedef struct {
  uint16_t map16_tile;
  uint16_t x_tile;
  uint16_t y_tile;
} EmittedMap16;

typedef int (*emit_map16_fn)(const EmittedMap16 *t, void *ctx);

typedef enum {
  OBJMAP_UNKNOWN = 0,
  OBJMAP_HANDLED = 1,
  OBJMAP_NONVISUAL = 2,
} ObjMapResult;

typedef struct {
  uint8_t level_tileset;
  uint8_t vertical_scroll;
  uint16_t screens_in_level;
} ObjEmitContext;

ObjMapResult object_emit_classify(const LevelObject *o);

ObjMapResult object_emit_map16_tiles(const LevelObject *o, const ObjEmitContext *ctx,
                                     emit_map16_fn emit, void *user_ctx);

void object_emit_count_stats(const LevelObject *objects, size_t count, const ObjEmitContext *ctx,
                             ObjectEmitStats *stats);

// Print top unknown object ids (kind<<8 | id) to fp.
void object_emit_print_histogram(const LevelObject *objects, size_t count, const ObjEmitContext *ctx,
                                 FILE *fp, int top_n);
