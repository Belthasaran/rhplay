#include "obj_to_map16.h"

#include <string.h>

// snesrev smw_0d.c kStdObjXX_Generic1RepeatedTileObject_Tiles
static const uint8_t kGenericRepeatedTiles[15] = {
    0x02, 0x21, 0x23, 0x2a, 0x2b, 0x3f, 0x03, 0x13, 0x1e, 0x24, 0x2e, 0x2f, 0x30, 0x32, 0x65,
};

static const uint8_t kVertPipeTopL[5] = { 0x33, 0x37, 0x39, 0x00, 0x00 };
static const uint8_t kVertPipeTopR[5] = { 0x34, 0x38, 0x3a, 0x00, 0x00 };
static const uint8_t kVertPipeBotL[5] = { 0x00, 0x00, 0x39, 0x33, 0x37 };
static const uint8_t kVertPipeBotR[5] = { 0x00, 0x00, 0x3a, 0x34, 0x38 };

static const uint8_t kHorizPipeEnd[8] = { 0x3b, 0x3c, 0x3b, 0x3f, 0x3b, 0x3c, 0x3b, 0x3f };
static const uint8_t kHorizPipeShaft[8] = { 0x3d, 0x3e, 0x3d, 0x3e, 0x3d, 0x3e, 0x3d, 0x3e };

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

static int emit_generic_fill(const LevelObject *o, emit_map16_fn emit, void *user_ctx) {
  if (o->kind != OBJ_STANDARD) return 0;
  uint16_t id = o->object_number;
  if (id < 0x01 || id > 0x0E) return 0;
  int k = (int)id - 1;
  if (k == 4) return 0; // coins use item memory in-game; skip for static preview
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
  uint8_t slope_type = (uint8_t)(o->settings & 0x0F);
  if (slope_type > 9) slope_type = 0;
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
  (void)slope_type;
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

static int emit_lm_direct(const LevelObject *o, emit_map16_fn emit, void *user_ctx) {
  if (!o->decoded.present) return 0;

  uint16_t base_tile = 0;
  uint16_t w = 0, h = 0;
  if (o->decoded.kind == OBJ_DEC_LM_22_MAP16_PAGE0 || o->decoded.kind == OBJ_DEC_LM_23_MAP16_PAGE1) {
    base_tile = o->decoded.u.lm22_23.map16_tile_9b;
    if (o->decoded.kind == OBJ_DEC_LM_23_MAP16_PAGE1) base_tile = (uint16_t)(base_tile + 0x200u);
    w = (uint16_t)(o->decoded.u.lm22_23.width_4b ? o->decoded.u.lm22_23.width_4b : 1);
    h = (uint16_t)(o->decoded.u.lm22_23.height_4b ? o->decoded.u.lm22_23.height_4b : 1);
  } else if (o->decoded.kind == OBJ_DEC_LM_27_DIRECT_MAP16_P00_3F ||
             o->decoded.kind == OBJ_DEC_LM_29_DIRECT_MAP16_P40_7F) {
    base_tile = o->decoded.u.lm27_29.base_map16;
    w = (uint16_t)(o->decoded.u.lm27_29.width ? o->decoded.u.lm27_29.width : 1);
    h = (uint16_t)(o->decoded.u.lm27_29.height ? o->decoded.u.lm27_29.height : 1);
  } else {
    return 0;
  }

  uint16_t base_x = (uint16_t)(o->x_position + (uint16_t)o->screen_number * 16u);
  uint16_t base_y = (uint16_t)o->y_position;

  for (uint16_t yy = 0; yy < h; yy++) {
    for (uint16_t xx = 0; xx < w; xx++) {
      if (!emit_one(emit, user_ctx, (uint16_t)(base_tile + xx + (uint16_t)(yy * w)), (uint16_t)(base_x + xx),
                    (uint16_t)(base_y + yy)))
        return 0;
    }
  }
  return 1;
}

ObjMapResult object_emit_map16_tiles(const LevelObject *o, const ObjEmitContext *ctx,
                                     emit_map16_fn emit, void *user_ctx) {
  (void)ctx;
  if (!o) return OBJMAP_UNKNOWN;

  if (emit_lm_direct(o, emit, user_ctx)) return OBJMAP_HANDLED;
  if (emit_generic_fill(o, emit, user_ctx)) return OBJMAP_HANDLED;
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
    if (r == OBJMAP_HANDLED) stats->handled++;
    else stats->unknown++;
  }
}
