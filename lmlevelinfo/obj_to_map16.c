#include "obj_to_map16.h"

#include <string.h>

// snesrev smw_0d.c kStdObjXX_Generic1RepeatedTileObject_Tiles (grassland/castle/underground share StdObj05).
static const uint8_t kGenericRepeatedTiles[15] = {
    0x02, 0x21, 0x23, 0x2a, 0x2b, 0x3f, 0x03, 0x13, 0x1e, 0x24, 0x2e, 0x2f, 0x30, 0x32, 0x65,
};

// Tileset-specific 0x2E-0x3F fallback low bytes (page 0 unless noted).
static const uint8_t kTilesetSpecLow[18] = {
    0x3f, 0x3f, 0x3f, 0x3f, 0x3f, 0x3f, 0x3f, 0x3f, 0x3f, 0x3f, 0x3f, 0x3f,
    0x1e, 0x1e, 0x1e, 0x1e, 0x1e, 0x1e,
};
static const uint8_t kTilesetSpecPage[18] = {
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1,
};

static const uint8_t kVertPipeTopL[5] = { 0x33, 0x37, 0x39, 0x00, 0x00 };
static const uint8_t kVertPipeTopR[5] = { 0x34, 0x38, 0x3a, 0x00, 0x00 };
static const uint8_t kVertPipeBotL[5] = { 0x00, 0x00, 0x39, 0x33, 0x37 };
static const uint8_t kVertPipeBotR[5] = { 0x00, 0x00, 0x3a, 0x34, 0x38 };

static const uint8_t kHorizPipeEnd[8] = { 0x3b, 0x3c, 0x3b, 0x3f, 0x3b, 0x3c, 0x3b, 0x3f };
static const uint8_t kHorizPipeShaft[8] = { 0x3d, 0x3e, 0x3d, 0x3e, 0x3d, 0x3e, 0x3d, 0x3e };

// snesrev smw_0d.c kExtObjXX_Generic1TileObject_Tiles
static const uint8_t kExtGenericTiles[51] = {
    0x1f, 0x22, 0x24, 0x42, 0x43, 0x27, 0x29, 0x25, 0x6e, 0x6f, 0x70, 0x71, 0x72, 0x45, 0x46,
    0x47, 0x48, 0x36, 0x37, 0x11, 0x12, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b, 0x1c,
    0x29, 0x1d, 0x1f, 0x20, 0x21, 0x22, 0x23, 0x25, 0x26, 0x27, 0x28, 0x2a, 0xde, 0xe0, 0xe2, 0xe4,
    0xec, 0xed, 0x2c, 0x25, 0x2d,
};

static const uint8_t kWaterTopTiles[4] = { 0x00, 0x01, 0x04, 0x08 };
static const uint8_t kWaterBottomTiles[4] = { 0x02, 0x03, 0x05, 0x0b };

typedef struct {
  uint32_t key;
  size_t unknown_count;
  size_t handled_count;
} HistEntry;

static uint32_t hist_key(const LevelObject *o) {
  if (!o) return 0;
  return ((uint32_t)o->kind << 16) | (uint32_t)o->object_number;
}

ObjMapResult object_emit_classify(const LevelObject *o) {
  if (!o) return OBJMAP_UNKNOWN;
  if (o->kind == OBJ_SCREEN_EXIT) return OBJMAP_NONVISUAL;
  if (o->kind == OBJ_EXTENDED) {
    if (o->object_number == 0x01 || o->object_number == 0x02 || o->object_number == 0x03) return OBJMAP_NONVISUAL;
    if (o->object_number >= 0x55 && o->object_number <= 0x5A) return OBJMAP_NONVISUAL;
    if (o->object_number == 0x84 || o->object_number == 0x8B) return OBJMAP_NONVISUAL;
    return OBJMAP_UNKNOWN;
  }
  if (o->kind == OBJ_STANDARD) {
    if (o->object_number == 0x24 || o->object_number == 0x25 || o->object_number == 0x26 ||
        o->object_number == 0x28 || o->object_number == 0x2D) {
      return OBJMAP_NONVISUAL;
    }
  }
  return OBJMAP_UNKNOWN;
}

static int emit_one(emit_map16_fn emit, void *user_ctx, uint16_t map16_id, uint16_t x, uint16_t y) {
  if (!emit) return 1;
  EmittedMap16 t;
  t.map16_tile = map16_id;
  t.x_tile = x;
  t.y_tile = y;
  return emit(&t, user_ctx) ? 1 : 0;
}

static uint16_t map16_from_page_low(uint8_t page, uint8_t low) {
  return (uint16_t)((uint16_t)page * 0x100u + (uint16_t)low);
}

static int emit_rect_fill(emit_map16_fn emit, void *user_ctx, uint16_t base_x, uint16_t base_y,
                          uint16_t w, uint16_t h, uint8_t page, uint8_t low_tile) {
  uint16_t tid = map16_from_page_low(page, low_tile);
  for (uint16_t yy = 0; yy < h; yy++) {
    for (uint16_t xx = 0; xx < w; xx++) {
      if (!emit_one(emit, user_ctx, tid, (uint16_t)(base_x + xx), (uint16_t)(base_y + yy))) return 0;
    }
  }
  return 1;
}

static int uses_generic_fill_table(uint16_t id) {
  if (id >= 0x01 && id <= 0x04) return 1;
  if (id == 0x05) return 0;
  if (id >= 0x06 && id <= 0x0E) return 1;
  if (id == 0x10 || id == 0x12) return 1;
  if (id >= 0x16 && id <= 0x1B) return 1;
  return 0;
}

static int emit_generic_fill(const LevelObject *o, emit_map16_fn emit, void *user_ctx) {
  if (o->kind != OBJ_STANDARD) return 0;
  uint16_t id = o->object_number;
  if (!uses_generic_fill_table(id)) return 0;
  int k = (int)id - 1;
  if (k < 0 || k >= 15) return 0;

  uint8_t low = kGenericRepeatedTiles[k];
  uint8_t page = (k >= 7) ? 1u : 0u;
  uint8_t settings = o->settings;
  uint16_t w = (uint16_t)((settings & 0x0F) ? (settings & 0x0F) : 1);
  uint16_t h = (uint16_t)((settings >> 4) ? (settings >> 4) : 1);
  uint16_t bx = (uint16_t)(o->x_position + (uint16_t)o->screen_number * 16u);
  uint16_t by = (uint16_t)o->y_position;
  return emit_rect_fill(emit, user_ctx, bx, by, w, h, page, low);
}

static int emit_ground_ledge(const LevelObject *o, emit_map16_fn emit, void *user_ctx) {
  if (o->kind != OBJ_STANDARD || o->object_number != 0x14) return 0;
  uint16_t w = (uint16_t)((o->settings & 0x0F) ? (o->settings & 0x0F) : 1);
  uint16_t h = (uint16_t)((o->settings >> 4) ? (o->settings >> 4) : 1);
  uint16_t bx = (uint16_t)(o->x_position + (uint16_t)o->screen_number * 16u);
  uint16_t by = (uint16_t)o->y_position;
  (void)h;
  for (uint16_t xx = 0; xx < w; xx++) {
    if (!emit_one(emit, user_ctx, map16_from_page_low(1, 0x79), (uint16_t)(bx + xx), by)) return 0;
  }
  return 1;
}

static int emit_ground_edges(const LevelObject *o, emit_map16_fn emit, void *user_ctx) {
  if (o->kind != OBJ_STANDARD || o->object_number != 0x13) return 0;
  uint16_t h = (uint16_t)((o->settings >> 4) ? (o->settings >> 4) : 1);
  uint16_t bx = (uint16_t)(o->x_position + (uint16_t)o->screen_number * 16u);
  uint16_t by = (uint16_t)o->y_position;
  for (uint16_t row = 0; row < h; row++) {
    if (!emit_one(emit, user_ctx, map16_from_page_low(1, 0x75), bx, (uint16_t)(by + row))) return 0;
  }
  return 1;
}

static int emit_wide_ledge(const LevelObject *o, emit_map16_fn emit, void *user_ctx) {
  if (o->kind != OBJ_STANDARD || o->object_number != 0x21) return 0;
  uint16_t w = (uint16_t)((o->settings & 0x0F) ? (o->settings & 0x0F) : 1);
  uint16_t bx = (uint16_t)(o->x_position + (uint16_t)o->screen_number * 16u);
  uint16_t by = (uint16_t)o->y_position;
  for (uint16_t xx = 0; xx < w; xx++) {
    if (!emit_one(emit, user_ctx, map16_from_page_low(1, 0x7A), (uint16_t)(bx + xx), by)) return 0;
  }
  return 1;
}

static int emit_extended_generic(const LevelObject *o, emit_map16_fn emit, void *user_ctx) {
  if (o->kind != OBJ_EXTENDED) return 0;
  uint16_t id = o->object_number;
  if (id == 0x41 || id == 0x46) return 0;
  uint8_t low;
  if (id < 51) {
    low = kExtGenericTiles[id];
  } else {
    low = 0x3f;
  }
  uint16_t w = (uint16_t)((o->settings & 0x0F) ? (o->settings & 0x0F) : 1);
  uint16_t h = (uint16_t)((o->settings >> 4) ? (o->settings >> 4) : 1);
  uint16_t bx = (uint16_t)(o->x_position + (uint16_t)o->screen_number * 16u);
  uint16_t by = (uint16_t)o->y_position;
  uint8_t page = (id >= 0x40) ? 1u : 0u;
  return emit_rect_fill(emit, user_ctx, bx, by, w, h, page, low);
}

static int emit_yoshi_coin(const LevelObject *o, emit_map16_fn emit, void *user_ctx) {
  if (o->kind != OBJ_EXTENDED || o->object_number != 0x41) return 0;
  uint16_t bx = (uint16_t)(o->x_position + (uint16_t)o->screen_number * 16u);
  uint16_t by = (uint16_t)o->y_position;
  if (!emit_one(emit, user_ctx, map16_from_page_low(0, 0x2D), bx, by)) return 0;
  return emit_one(emit, user_ctx, map16_from_page_low(0, 0x2E), bx, (uint16_t)(by + 1));
}

static int emit_midway_bar_ext(const LevelObject *o, emit_map16_fn emit, void *user_ctx) {
  if (o->kind != OBJ_EXTENDED || o->object_number != 0x46) return 0;
  uint16_t bx = (uint16_t)(o->x_position + (uint16_t)o->screen_number * 16u);
  uint16_t by = (uint16_t)o->y_position;
  return emit_one(emit, user_ctx, map16_from_page_low(0, 0x38), bx, by);
}

static int emit_water_surface(const LevelObject *o, emit_map16_fn emit, void *user_ctx) {
  if (o->kind != OBJ_STANDARD || o->object_number != 0x18) return 0;
  uint8_t variant = (uint8_t)(o->settings & 0x03);
  if (variant > 3) variant = 0;
  uint16_t w = (uint16_t)((o->settings & 0x0F) ? (o->settings & 0x0F) : 1);
  uint16_t h = (uint16_t)((o->settings >> 4) ? (o->settings >> 4) : 1);
  uint16_t bx = (uint16_t)(o->x_position + (uint16_t)o->screen_number * 16u);
  uint16_t by = (uint16_t)o->y_position;
  uint8_t top = kWaterTopTiles[variant];
  uint8_t bot = kWaterBottomTiles[variant];
  for (uint16_t xx = 0; xx < w; xx++) {
    if (!emit_one(emit, user_ctx, map16_from_page_low(0, top), (uint16_t)(bx + xx), by)) return 0;
  }
  for (uint16_t yy = 1; yy < h; yy++) {
    for (uint16_t xx = 0; xx < w; xx++) {
      if (!emit_one(emit, user_ctx, map16_from_page_low(0, bot), (uint16_t)(bx + xx), (uint16_t)(by + yy)))
        return 0;
    }
  }
  return 1;
}

static int emit_midway_point(const LevelObject *o, emit_map16_fn emit, void *user_ctx) {
  if (o->kind != OBJ_STANDARD || o->object_number != 0x15) return 0;
  uint16_t bx = (uint16_t)(o->x_position + (uint16_t)o->screen_number * 16u);
  uint16_t by = (uint16_t)o->y_position;
  return emit_one(emit, user_ctx, map16_from_page_low(1, 0x71), bx, by);
}

static int emit_tileset_specific(const LevelObject *o, emit_map16_fn emit, void *user_ctx) {
  if (o->kind != OBJ_STANDARD) return 0;
  uint16_t id = o->object_number;
  if (id < 0x2E || id > 0x3F) return 0;
  int idx = (int)id - 0x2E;
  uint8_t low = kTilesetSpecLow[idx];
  uint8_t page = kTilesetSpecPage[idx];
  uint8_t settings = o->settings;
  uint16_t w = (uint16_t)((settings & 0x0F) ? (settings & 0x0F) : 1);
  uint16_t h = (uint16_t)((settings >> 4) ? (settings >> 4) : 1);
  uint16_t bx = (uint16_t)(o->x_position + (uint16_t)o->screen_number * 16u);
  uint16_t by = (uint16_t)o->y_position;
  return emit_rect_fill(emit, user_ctx, bx, by, w, h, page, low);
}

static int emit_vertical_pipe(const LevelObject *o, emit_map16_fn emit, void *user_ctx) {
  if (o->kind != OBJ_STANDARD || o->object_number != 0x0F) return 0;
  uint8_t pipe_type = (uint8_t)(o->settings & 0x0F);
  if (pipe_type > 4) pipe_type = 0;
  uint16_t height = (uint16_t)((o->settings >> 4) ? (o->settings >> 4) : 1);
  uint16_t bx = (uint16_t)(o->x_position + (uint16_t)o->screen_number * 16u);
  uint16_t by = (uint16_t)o->y_position;
  const uint8_t page = 1;

  if (!emit_one(emit, user_ctx, map16_from_page_low(page, kVertPipeTopL[pipe_type]), bx, by)) return 0;
  if (!emit_one(emit, user_ctx, map16_from_page_low(page, kVertPipeTopR[pipe_type]), (uint16_t)(bx + 1), by))
    return 0;
  for (uint16_t row = 1; row + 1 < height; row++) {
    if (!emit_one(emit, user_ctx, map16_from_page_low(page, 0x35), bx, (uint16_t)(by + row))) return 0;
    if (!emit_one(emit, user_ctx, map16_from_page_low(page, 0x36), (uint16_t)(bx + 1), (uint16_t)(by + row)))
      return 0;
  }
  if (height > 1) {
    uint16_t bot = (uint16_t)(by + height - 1);
    if (!emit_one(emit, user_ctx, map16_from_page_low(page, kVertPipeBotL[pipe_type]), bx, bot)) return 0;
    if (!emit_one(emit, user_ctx, map16_from_page_low(page, kVertPipeBotR[pipe_type]), (uint16_t)(bx + 1), bot))
      return 0;
  }
  return 1;
}

static int emit_horizontal_pipe(const LevelObject *o, emit_map16_fn emit, void *user_ctx) {
  if (o->kind != OBJ_STANDARD || o->object_number != 0x10) return 0;
  uint8_t pipe_type = (uint8_t)((o->settings >> 4) & 0x0F);
  if (pipe_type > 7) pipe_type = 0;
  uint16_t width = (uint16_t)((o->settings & 0x0F) ? (o->settings & 0x0F) : 1);
  uint16_t bx = (uint16_t)(o->x_position + (uint16_t)o->screen_number * 16u);
  uint16_t by = (uint16_t)o->y_position;
  const uint8_t page = 1;

  for (uint16_t col = 0; col < width; col++) {
    uint8_t low = (col + 1 == width) ? kHorizPipeEnd[pipe_type] : kHorizPipeShaft[pipe_type];
    if (!emit_one(emit, user_ctx, map16_from_page_low(page, low), (uint16_t)(bx + col), by)) return 0;
  }
  return 1;
}

static int emit_slope_left(const LevelObject *o, emit_map16_fn emit, void *user_ctx) {
  if (o->kind != OBJ_STANDARD || o->object_number != 0x12) return 0;
  uint16_t height = (uint16_t)((o->settings >> 4) ? (o->settings >> 4) : 1);
  uint16_t bx = (uint16_t)(o->x_position + (uint16_t)o->screen_number * 16u);
  uint16_t by = (uint16_t)o->y_position;
  const uint8_t page = 1;

  for (uint16_t row = 0; row < height; row++) {
    if (!emit_one(emit, user_ctx, map16_from_page_low(page, 0x96), bx, (uint16_t)(by + row))) return 0;
    if (!emit_one(emit, user_ctx, map16_from_page_low(page, 0x9B), (uint16_t)(bx + 1), (uint16_t)(by + row)))
      return 0;
    for (uint16_t col = 2; col < (uint16_t)(row + 2); col++) {
      if (!emit_one(emit, user_ctx, map16_from_page_low(0, 0x3F), (uint16_t)(bx + col), (uint16_t)(by + row)))
        return 0;
    }
  }
  return 1;
}

static int emit_bullet_shooter(const LevelObject *o, emit_map16_fn emit, void *user_ctx) {
  if (o->kind != OBJ_STANDARD || o->object_number != 0x11) return 0;
  uint16_t h = (uint16_t)((o->settings >> 4) ? (o->settings >> 4) : 1);
  uint16_t bx = (uint16_t)(o->x_position + (uint16_t)o->screen_number * 16u);
  uint16_t by = (uint16_t)o->y_position;
  const uint8_t page = 1;
  static const uint8_t tiles[3] = { 0x41, 0x42, 0x43 };
  for (uint16_t row = 0; row < h && row < 3; row++) {
    if (!emit_one(emit, user_ctx, map16_from_page_low(page, tiles[row < h ? row : 2]), bx, (uint16_t)(by + row)))
      return 0;
  }
  return 1;
}

static int emit_lm_direct_rect(emit_map16_fn emit, void *user_ctx, uint16_t base_tile, uint16_t w, uint16_t h,
                               uint16_t base_x, uint16_t base_y, int tile_stride_row_major) {
  if (w == 0) w = 1;
  if (h == 0) h = 1;
  for (uint16_t yy = 0; yy < h; yy++) {
    for (uint16_t xx = 0; xx < w; xx++) {
      uint16_t tid;
      if (tile_stride_row_major) {
        tid = (uint16_t)(base_tile + xx + (uint16_t)(yy * w));
      } else {
        uint16_t row_base = base_tile;
        tid = (uint16_t)((row_base & 0xFF00u) | (((row_base & 0xFFu) + xx) & 0xFFu));
      }
      if (!emit_one(emit, user_ctx, tid, (uint16_t)(base_x + xx), (uint16_t)(base_y + yy))) return 0;
    }
  }
  return 1;
}

static int emit_lm_direct(const LevelObject *o, emit_map16_fn emit, void *user_ctx) {
  if (!o->decoded.present) return 0;

  uint16_t base_x = (uint16_t)(o->x_position + (uint16_t)o->screen_number * 16u);
  uint16_t base_y = (uint16_t)o->y_position;

  if (o->decoded.kind == OBJ_DEC_LM_22_MAP16_PAGE0 || o->decoded.kind == OBJ_DEC_LM_23_MAP16_PAGE1) {
    uint16_t base_tile = o->decoded.u.lm22_23.map16_tile_9b;
    if (o->decoded.kind == OBJ_DEC_LM_23_MAP16_PAGE1) base_tile = (uint16_t)(base_tile + 0x200u);
    uint16_t w = (uint16_t)(o->decoded.u.lm22_23.width_4b ? o->decoded.u.lm22_23.width_4b : 1);
    uint16_t h = (uint16_t)(o->decoded.u.lm22_23.height_4b ? o->decoded.u.lm22_23.height_4b : 1);
    return emit_lm_direct_rect(emit, user_ctx, base_tile, w, h, base_x, base_y, 1);
  }

  if (o->decoded.kind != OBJ_DEC_LM_27_DIRECT_MAP16_P00_3F && o->decoded.kind != OBJ_DEC_LM_29_DIRECT_MAP16_P40_7F) {
    return 0;
  }

  const LevelObjectDecoded *d = &o->decoded;
  uint16_t base_tile = d->u.lm27_29.base_map16;

  switch (d->u.lm27_29.variant) {
    case 0:
      return emit_lm_direct_rect(emit, user_ctx, base_tile,
                                 (uint16_t)(d->u.lm27_29.width ? d->u.lm27_29.width : 1),
                                 (uint16_t)(d->u.lm27_29.height ? d->u.lm27_29.height : 1), base_x, base_y, 1);
    case 1: {
      uint16_t w = (uint16_t)(d->u.lm27_29.sel_w_4b + 1u);
      uint16_t h = (uint16_t)(d->u.lm27_29.sel_h_4b + 1u);
      return emit_lm_direct_rect(emit, user_ctx, base_tile, w, h, base_x, base_y, 0);
    }
    case 2:
      return emit_lm_direct_rect(emit, user_ctx, base_tile,
                                 (uint16_t)(d->u.lm27_29.width ? d->u.lm27_29.width : 1),
                                 (uint16_t)(d->u.lm27_29.height ? d->u.lm27_29.height : 1), base_x, base_y, 1);
    case 3:
    case 4:
      return emit_lm_direct_rect(emit, user_ctx, base_tile,
                                 (uint16_t)(d->u.lm27_29.width ? d->u.lm27_29.width : 1),
                                 (uint16_t)(d->u.lm27_29.height ? d->u.lm27_29.height : 1), base_x, base_y, 1);
    default:
      return 0;
  }
}

ObjMapResult object_emit_map16_tiles(const LevelObject *o, const ObjEmitContext *ctx,
                                     emit_map16_fn emit, void *user_ctx) {
  (void)ctx;
  if (!o) return OBJMAP_UNKNOWN;

  if (object_emit_classify(o) == OBJMAP_NONVISUAL) return OBJMAP_NONVISUAL;

  if (emit_lm_direct(o, emit, user_ctx)) return OBJMAP_HANDLED;
  if (emit_yoshi_coin(o, emit, user_ctx)) return OBJMAP_HANDLED;
  if (emit_midway_bar_ext(o, emit, user_ctx)) return OBJMAP_HANDLED;
  if (emit_extended_generic(o, emit, user_ctx)) return OBJMAP_HANDLED;
  if (emit_water_surface(o, emit, user_ctx)) return OBJMAP_HANDLED;
  if (emit_generic_fill(o, emit, user_ctx)) return OBJMAP_HANDLED;
  if (emit_ground_edges(o, emit, user_ctx)) return OBJMAP_HANDLED;
  if (emit_ground_ledge(o, emit, user_ctx)) return OBJMAP_HANDLED;
  if (emit_wide_ledge(o, emit, user_ctx)) return OBJMAP_HANDLED;
  if (emit_midway_point(o, emit, user_ctx)) return OBJMAP_HANDLED;
  if (emit_tileset_specific(o, emit, user_ctx)) return OBJMAP_HANDLED;
  if (emit_vertical_pipe(o, emit, user_ctx)) return OBJMAP_HANDLED;
  if (emit_horizontal_pipe(o, emit, user_ctx)) return OBJMAP_HANDLED;
  if (emit_slope_left(o, emit, user_ctx)) return OBJMAP_HANDLED;
  if (emit_bullet_shooter(o, emit, user_ctx)) return OBJMAP_HANDLED;

  return OBJMAP_UNKNOWN;
}

void object_emit_count_stats(const LevelObject *objects, size_t count, const ObjEmitContext *ctx,
                             ObjectEmitStats *stats) {
  if (!stats) return;
  emit_stats_reset(stats);
  if (!objects) return;
  for (size_t i = 0; i < count; i++) {
    stats->total_objects++;
    if (objects[i].decoded.present) stats->decoded_present++;
    ObjMapResult r = object_emit_map16_tiles(&objects[i], ctx, NULL, NULL);
    if (r == OBJMAP_NONVISUAL) stats->skipped_nonvisual++;
    else if (r == OBJMAP_HANDLED) stats->handled++;
    else stats->unknown++;
  }
}

void object_emit_print_histogram(const LevelObject *objects, size_t count, const ObjEmitContext *ctx,
                                 FILE *fp, int top_n) {
  if (!fp || !objects || top_n <= 0) return;
  HistEntry entries[256];
  size_t nentries = 0;
  memset(entries, 0, sizeof(entries));

  for (size_t i = 0; i < count; i++) {
    ObjMapResult cls = object_emit_classify(&objects[i]);
    if (cls == OBJMAP_NONVISUAL) continue;
    ObjMapResult r = object_emit_map16_tiles(&objects[i], ctx, NULL, NULL);
    uint32_t key = hist_key(&objects[i]);
    size_t j;
    for (j = 0; j < nentries; j++) {
      if (entries[j].key == key) break;
    }
    if (j == nentries && nentries < 256) {
      entries[j].key = key;
      nentries++;
    }
    if (j < nentries) {
      if (r == OBJMAP_HANDLED) entries[j].handled_count++;
      else entries[j].unknown_count++;
    }
  }

  for (int out = 0; out < top_n; out++) {
    size_t best = 0;
    size_t best_unknown = 0;
    for (size_t j = 0; j < nentries; j++) {
      if (entries[j].unknown_count > best_unknown) {
        best_unknown = entries[j].unknown_count;
        best = j;
      }
    }
    if (best_unknown == 0) break;
    uint32_t key = entries[best].key;
    fprintf(fp, "unknown kind=%u id=0x%03X count=%zu\n", (unsigned)((key >> 16) & 0xFF),
            (unsigned)(key & 0xFFFF), entries[best].unknown_count);
    entries[best].unknown_count = 0;
  }
}
