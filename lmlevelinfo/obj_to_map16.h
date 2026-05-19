#pragma once

#include <stdint.h>
#include <stddef.h>

#include "level_parse.h"

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

// Emit Map16 tiles for an object. Currently supports LM direct-Map16 object decodes.
ObjMapResult object_emit_map16_tiles(const LevelObject *o, emit_map16_fn emit, void *ctx);

