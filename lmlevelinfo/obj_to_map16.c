#include "obj_to_map16.h"

ObjMapResult object_emit_map16_tiles(const LevelObject *o, emit_map16_fn emit, void *ctx) {
  if (!o || !emit) return OBJMAP_UNKNOWN;

  if (!o->decoded.present) return OBJMAP_UNKNOWN;

  uint16_t base_tile = 0;
  uint16_t w = 0, h = 0;
  if (o->decoded.kind == OBJ_DEC_LM_22_MAP16_PAGE0 || o->decoded.kind == OBJ_DEC_LM_23_MAP16_PAGE1) {
    base_tile = o->decoded.u.lm22_23.map16_tile_9b;
    if (o->decoded.kind == OBJ_DEC_LM_23_MAP16_PAGE1) base_tile = (uint16_t)(base_tile + 0x200u);
    w = (uint16_t)(o->decoded.u.lm22_23.width_4b ? o->decoded.u.lm22_23.width_4b : 1);
    h = (uint16_t)(o->decoded.u.lm22_23.height_4b ? o->decoded.u.lm22_23.height_4b : 1);
  } else if (o->decoded.kind == OBJ_DEC_LM_27_DIRECT_MAP16_P00_3F || o->decoded.kind == OBJ_DEC_LM_29_DIRECT_MAP16_P40_7F) {
    base_tile = o->decoded.u.lm27_29.base_map16;
    w = (uint16_t)(o->decoded.u.lm27_29.width ? o->decoded.u.lm27_29.width : 1);
    h = (uint16_t)(o->decoded.u.lm27_29.height ? o->decoded.u.lm27_29.height : 1);
  } else {
    return OBJMAP_UNKNOWN;
  }

  uint16_t base_x = (uint16_t)o->x_position;
  uint16_t base_y = (uint16_t)o->y_position;
  uint16_t scr = (uint16_t)o->screen_number;

  for (uint16_t yy = 0; yy < h; yy++) {
    for (uint16_t xx = 0; xx < w; xx++) {
      EmittedMap16 t;
      t.map16_tile = (uint16_t)(base_tile + xx + (uint16_t)(yy * w));
      t.x_tile = (uint16_t)(base_x + xx + (uint16_t)(scr * 16u));
      t.y_tile = (uint16_t)(base_y + yy);
      if (!emit(&t, ctx)) return OBJMAP_HANDLED;
    }
  }
  return OBJMAP_HANDLED;
}

