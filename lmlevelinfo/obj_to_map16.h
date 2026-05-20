#pragma once

#include <stdint.h>
#include <stddef.h>

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
} ObjMapResult;

typedef struct {
  uint8_t level_tileset;      // primary byte4 low nibble (vanilla tileset / LM GFX set)
  uint8_t vertical_scroll;    // primary vertical_scroll_set
  uint16_t screens_in_level;  // 1..32
} ObjEmitContext;

// Emit Map16 tiles for an object (LM direct Map16, generic fills, pipes, slopes, etc.).
ObjMapResult object_emit_map16_tiles(const LevelObject *o, const ObjEmitContext *ctx,
                                     emit_map16_fn emit, void *user_ctx);

// Count handled vs unknown without drawing (emit may be NULL to only classify).
void object_emit_count_stats(const LevelObject *objects, size_t count, const ObjEmitContext *ctx,
                             ObjectEmitStats *stats);
