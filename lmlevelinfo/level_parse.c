#include "level_parse.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static void seterr(char *err, size_t cap, const char *msg) {
  if (!err || cap == 0) return;
  snprintf(err, cap, "%s", msg ? msg : "error");
}

static int read_table_byte(const Rom *rom, uint32_t base_snes, uint16_t level_id, uint8_t *out) {
  if (!base_snes) return 0;
  return rom_read8_snes(rom, base_snes + (uint32_t)level_id, out);
}

static int read_layer_ptr24(const Rom *rom, uint32_t table_snes, uint16_t level_id, uint32_t *out_ptr_snes) {
  // table entry is 3 bytes per level (little endian)
  uint32_t entry = table_snes + (uint32_t)level_id * 3u;
  uint32_t p = 0;
  if (!rom_read24_snes(rom, entry, &p)) return 0;
  *out_ptr_snes = p;
  return 1;
}

static int read_sprite_ptr(const Rom *rom, const LmTables *tables, uint16_t level_id, uint32_t *out_ptr_snes) {
  // Sprite pointer table is 2 bytes per level. Bank byte is either from bank table, or default 0x07.
  uint32_t entry = tables->sprite_ptr_table + (uint32_t)level_id * 2u;
  uint16_t off = 0;
  if (!rom_read16_snes(rom, entry, &off)) return 0;
  uint8_t bank = 0x07;
  if (tables->sprite_bank_table) {
    uint8_t b = 0;
    if (rom_read8_snes(rom, tables->sprite_bank_table + (uint32_t)level_id, &b)) {
      bank = b;
    }
  }
  *out_ptr_snes = ((uint32_t)bank << 16) | (uint32_t)off;
  return 1;
}

static void decode_primary(const uint8_t raw[5], PrimaryLevelHeader *h) {
  memset(h, 0, sizeof(*h));
  memcpy(h->raw, raw, 5);
  // Byte 0: BBBLLLLL
  h->bg_palette = (raw[0] >> 5) & 0x7;
  uint8_t l = raw[0] & 0x1F;
  h->length_in_screens = (l == 0x1F) ? -1 : (int)l;
  // Byte 1: CCCOOOOO
  h->back_area_color = (raw[1] >> 5) & 0x7;
  h->level_mode = raw[1] & 0x1F;
  // Byte 2: 3MMMSSSS
  h->layer3_priority = (raw[2] >> 7) & 0x1;
  h->music_mmm = (raw[2] >> 4) & 0x7;
  h->sprite_gfx = raw[2] & 0xF;
  // Byte 3: TTPPPFFF
  h->timer_setting = (raw[3] >> 6) & 0x3;
  h->sprite_palette = (raw[3] >> 3) & 0x7;
  h->fg_palette = raw[3] & 0x7;
  // Byte 4: IIVVZZZZ
  h->item_memory_set = (raw[4] >> 6) & 0x3;
  h->vertical_scroll_set = (raw[4] >> 4) & 0x3;
  h->fgbg_gfx_setting = raw[4] & 0xF;
}

static void decode_sprite_header(uint8_t b, SpriteHeader *h) {
  memset(h, 0, sizeof(*h));
  h->present = 1;
  h->raw = b;
  // Layout in prompt: S, B, N, MMMMM (we interpret as bit7=S, bit6=B, bit5=N, bits0-4=mem)
  h->buoyancy_s = (b >> 7) & 0x1;
  h->buoyancy_b = (b >> 6) & 0x1;
  h->new_sprite_system = (b >> 5) & 0x1;
  h->sprite_memory = b & 0x1F;
}

static void decode_secondary(const SecondaryLevelHeader *h, SecondaryDecoded *d) {
  memset(d, 0, sizeof(*d));
  if (!h || !h->present) return;
  d->present = 1;

  // b1: hhhhyyyy
  d->l2_scroll_h = (h->b1 >> 4) & 0xF;
  d->main_y_low4 = h->b1 & 0xF;

  // b2: 33AAAxxx
  d->layer3_setting_2b = (h->b2 >> 6) & 0x3;
  d->main_action_3b = (h->b2 >> 3) & 0x7;
  d->main_x_3b = h->b2 & 0x7;

  // b3: MMMMffbb
  d->midway_screen_4b = (h->b3 >> 4) & 0xF;
  d->fg_initial_2b = (h->b3 >> 2) & 0x3;
  d->bg_initial_2b = h->b3 & 0x3;

  // b4: NUVEEEEE
  d->no_yoshi_intro = (h->b4 >> 7) & 0x1;
  d->vpos_unknown_u = (h->b4 >> 6) & 0x1;
  d->vpos_flag_v = (h->b4 >> 5) & 0x1;
  d->main_screen_5b = h->b4 & 0x1F;

  // b5 (LM expansion): IWPXXtTT
  if (h->b5) {
    d->slippery_i = (h->b5 >> 7) & 0x1;
    d->water_w = (h->b5 >> 6) & 0x1;
    d->xy2_p = (h->b5 >> 5) & 0x1;
    d->smartspawn_t = (h->b5 >> 2) & 0x1;
    d->sprite_spawn_tt = h->b5 & 0x3;
    // XX bits are reserved for MWL / x high bits and are not decoded in v1.
  }

  // b6: SHCvvvvv (LM 3.40+ expanded format header byte)
  if (h->b6) {
    d->shc_s = (h->b6 >> 7) & 0x1;
    d->shc_h = (h->b6 >> 6) & 0x1;
    d->shc_c = (h->b6 >> 5) & 0x1;
    d->l2_vertical_vvvvv = h->b6 & 0x1F;
  }

  // b7: OFYYYYYY
  if (h->b7) {
    d->bg_relative_o = (h->b7 >> 7) & 0x1;
    d->fg_initial_2b = (h->b7 >> 6) & 0x1; // F (only when O bit is set) - keep as raw
    d->main_y_high6 = h->b7 & 0x3F;
  }

  // b8: RL-ooooo
  if (h->b8) {
    d->relative_to_player_r = (h->b8 >> 7) & 0x1;
    d->face_left_l = (h->b8 >> 6) & 0x1;
    d->bg_height_or_offset_ooooo = h->b8 & 0x1F;
  }
}

static size_t object_len_for_standard(uint8_t obj_id, const uint8_t *buf, size_t avail) {
  (void)avail;
  // Most standard objects are 3 bytes. LM adds a few longer ones.
  if (obj_id == 0x22 || obj_id == 0x23) return 4;
  if (obj_id == 0x2D) return 5;
  if (obj_id == 0x27 || obj_id == 0x29) {
    // Need at least 5 bytes to decide.
    if (!buf) return 5;
    uint8_t b2 = buf[2];
    uint8_t mode = (b2 >> 6) & 0x3;
    if (mode == 0x0) return 5;        // single-screen, single tile
    if (mode == 0x1) return 5;        // multiple tiles unstretched
    if (mode == 0x2) return 6;        // single-screen, multiple tiles
    // mode == 3: multi-screen or conditional direct map16
    // If bit7 of b2 is set, it's conditional direct map16 (adds 1 byte)
    return (b2 & 0x80) ? 8 : 7;
  }
  // Object 28 is 3 bytes (time bypass) in wiki format.
  return 3;
}

static size_t object_len_for_extended(uint8_t ext_id) {
  if (ext_id == 0x00) return 4; // screen exit
  if (ext_id == 0x02) return 5; // 15-bit screen exit
  return 3;
}

static int parse_objects(const Rom *rom, uint32_t layer1_ptr_snes, int is_vertical,
                         LevelInfo *out, char *err, size_t errcap) {
  uint32_t pc;
  if (!snes_lorom_to_pc(rom, layer1_ptr_snes, &pc)) {
    seterr(err, errcap, "Layer1 pointer unmappable");
    return 0;
  }

  // Capture raw layer1 blob until terminator 0xFF in first byte of object record (after header).
  // We hard-cap to avoid runaway if pointer is wrong.
  const size_t HARD_CAP = 0x20000;
  size_t max = rom->size - pc;
  if (max > HARD_CAP) max = HARD_CAP;
  if (max < 8) {
    seterr(err, errcap, "Layer1 data too small");
    return 0;
  }

  const uint8_t *p = rom->data + pc;
  size_t i = 0;
  // Primary header is 5 bytes, stored only for layer1.
  decode_primary(p, &out->primary);
  // Heuristic vertical detection based on common SMW level modes.
  // This is not perfect for all hacks, but is sufficient to decide the "XY swapped" flag.
  if (!is_vertical) {
    switch (out->primary.level_mode) {
      case 0x08:
      case 0x09:
      case 0x0A:
      case 0x0B:
      case 0x0C:
      case 0x0D:
      case 0x1A:
      case 0x1B:
        is_vertical = 1;
        break;
      default:
        break;
    }
  }
  i += 5;

  // Object stream begins immediately after primary header.
  size_t obj_index = 0;
  out->objects = NULL;
  out->objects_count = 0;

  while (i < max) {
    uint8_t b0 = p[i];
    if (b0 == 0xFF) {
      i += 1;
      break;
    }
    if (i + 3 > max) break;

    uint8_t new_screen = (b0 >> 7) & 0x1;
    uint8_t obj_id = (b0 >> 5) & 0x3;          // BB
    uint8_t obj_low = b0 & 0x1F;               // bbbbb
    uint8_t b1 = p[i + 1];
    uint8_t b2 = p[i + 2];

    uint8_t x = b1 & 0x0F;
    uint8_t y = b0 & 0x1F;
    uint8_t settings = b2;

    uint8_t standard_id = (uint8_t)((obj_id << 5) | obj_low);

    LevelObject obj;
    memset(&obj, 0, sizeof(obj));
    obj.index = (uint32_t)obj_index;
    obj.new_screen = new_screen;
    obj.x_position = x;
    obj.y_position = y;
    obj.settings = settings;
    obj.xy_swapped = is_vertical ? 1 : 0;

    if (standard_id == 0x00) {
      // Extended object: format N00YYYYY 0000XXXX BBBBBBBB
      uint8_t ext_id = b2;
      size_t olen = object_len_for_extended(ext_id);
      if (i + olen > max) {
        seterr(err, errcap, "Truncated extended object");
        return 0;
      }
      obj.kind = (ext_id == 0x00) ? OBJ_SCREEN_EXIT : OBJ_EXTENDED;
      obj.object_number = ext_id;
      obj.raw_len = olen;
      memcpy(obj.raw, p + i, olen);

      if (ext_id == 0x00 && olen >= 4) {
        // Screen exit: 000ppppp 0000wush 00000000 dddddddd
        uint8_t e0 = p[i + 0];
        uint8_t e1 = p[i + 1];
        uint8_t e3 = p[i + 3];
        obj.screen_number = e0 & 0x1F;
        obj.lm_midway_water = (e1 >> 3) & 0x1;
        obj.lm_modified = (e1 >> 2) & 0x1;
        obj.secondary_exit_flag = (e1 >> 1) & 0x1;
        obj.secondary_exit_id_or_dest = (uint16_t)((e1 & 0x1) << 8) | e3;
      } else if (ext_id == 0x02 && olen >= 5) {
        // 15-bit screen exit (extended object 02)
        uint8_t e0 = p[i + 0];
        uint8_t e4 = p[i + 4];
        obj.screen_number = e0 & 0x1F;
        obj.lm_midway_water = (e4 >> 2) & 0x1; // 'w' in format ends up in this packed byte
        obj.secondary_exit_flag = 1;
        obj.secondary_exit_id_or_dest = (uint16_t)((e4 & 0x1) << 8) | p[i + 3];
      }

      i += olen;
    } else {
      // Standard object (may be longer for certain LM objects).
      size_t olen = object_len_for_standard(standard_id, p + i, max - i);
      if (i + olen > max) {
        seterr(err, errcap, "Truncated standard object");
        return 0;
      }
      obj.kind = OBJ_STANDARD;
      obj.object_number = standard_id;
      obj.raw_len = olen;
      memcpy(obj.raw, p + i, olen);
      i += olen;
    }

    // Append to list (simple grow-by-realloc with over-allocation via ensure_objects_capacity)
    size_t want = out->objects_count + 1;
    LevelObject *tmp = (LevelObject *)realloc(out->objects, want * sizeof(LevelObject));
    if (!tmp) {
      seterr(err, errcap, "Out of memory parsing objects");
      return 0;
    }
    out->objects = tmp;
    out->objects[out->objects_count] = obj;
    out->objects_count = want;
    obj_index++;

    // Prevent infinite loops
    if (obj_index > 200000) {
      seterr(err, errcap, "Object parse runaway");
      return 0;
    }
  }

  // Save blob bytes (from start pointer up to i)
  out->layer1_blob.pc_offset = pc;
  out->layer1_blob.len = i;
  size_t copyN = i;
  if (copyN > sizeof(out->layer1_blob.bytes)) copyN = sizeof(out->layer1_blob.bytes);
  memcpy(out->layer1_blob.bytes, p, copyN);
  return 1;
}

static int parse_objects_from_buf(const uint8_t *p, size_t max, int is_vertical,
                                  LevelInfo *out, char *err, size_t errcap) {
  if (!p || max < 8 || !out) {
    seterr(err, errcap, "Layer1 buffer too small");
    return 0;
  }

  size_t i = 0;
  decode_primary(p, &out->primary);
  if (!is_vertical) {
    switch (out->primary.level_mode) {
      case 0x08:
      case 0x09:
      case 0x0A:
      case 0x0B:
      case 0x0C:
      case 0x0D:
      case 0x1A:
      case 0x1B:
        is_vertical = 1;
        break;
      default:
        break;
    }
  }
  i += 5;

  size_t obj_index = 0;
  out->objects = NULL;
  out->objects_count = 0;

  while (i < max) {
    uint8_t b0 = p[i];
    if (b0 == 0xFF) {
      i += 1;
      break;
    }
    if (i + 3 > max) break;

    uint8_t new_screen = (b0 >> 7) & 0x1;
    uint8_t obj_id = (b0 >> 5) & 0x3;
    uint8_t obj_low = b0 & 0x1F;
    uint8_t b1 = p[i + 1];
    uint8_t b2 = p[i + 2];

    uint8_t x = b1 & 0x0F;
    uint8_t y = b0 & 0x1F;
    uint8_t settings = b2;
    uint8_t standard_id = (uint8_t)((obj_id << 5) | obj_low);

    LevelObject obj;
    memset(&obj, 0, sizeof(obj));
    obj.index = (uint32_t)obj_index;
    obj.new_screen = new_screen;
    obj.x_position = x;
    obj.y_position = y;
    obj.settings = settings;
    obj.xy_swapped = is_vertical ? 1 : 0;

    if (standard_id == 0x00) {
      uint8_t ext_id = b2;
      size_t olen = object_len_for_extended(ext_id);
      if (i + olen > max) {
        seterr(err, errcap, "Truncated extended object");
        return 0;
      }
      obj.kind = (ext_id == 0x00) ? OBJ_SCREEN_EXIT : OBJ_EXTENDED;
      obj.object_number = ext_id;
      obj.raw_len = olen;
      memcpy(obj.raw, p + i, olen);

      if (ext_id == 0x00 && olen >= 4) {
        uint8_t e0 = p[i + 0];
        uint8_t e1 = p[i + 1];
        uint8_t e3 = p[i + 3];
        obj.screen_number = e0 & 0x1F;
        obj.lm_midway_water = (e1 >> 3) & 0x1;
        obj.lm_modified = (e1 >> 2) & 0x1;
        obj.secondary_exit_flag = (e1 >> 1) & 0x1;
        obj.secondary_exit_id_or_dest = (uint16_t)((e1 & 0x1) << 8) | e3;
      } else if (ext_id == 0x02 && olen >= 5) {
        uint8_t e0 = p[i + 0];
        uint8_t e4 = p[i + 4];
        obj.screen_number = e0 & 0x1F;
        obj.lm_midway_water = (e4 >> 2) & 0x1;
        obj.secondary_exit_flag = 1;
        obj.secondary_exit_id_or_dest = (uint16_t)((e4 & 0x1) << 8) | p[i + 3];
      }

      i += olen;
    } else {
      size_t olen = object_len_for_standard(standard_id, p + i, max - i);
      if (i + olen > max) {
        seterr(err, errcap, "Truncated standard object");
        return 0;
      }
      obj.kind = OBJ_STANDARD;
      obj.object_number = standard_id;
      obj.raw_len = olen;
      memcpy(obj.raw, p + i, olen);
      i += olen;
    }

    size_t want = out->objects_count + 1;
    LevelObject *tmp = (LevelObject *)realloc(out->objects, want * sizeof(LevelObject));
    if (!tmp) {
      seterr(err, errcap, "Out of memory parsing objects");
      return 0;
    }
    out->objects = tmp;
    out->objects[out->objects_count] = obj;
    out->objects_count = want;
    obj_index++;

    if (obj_index > 200000) {
      seterr(err, errcap, "Object parse runaway");
      return 0;
    }
  }

  // For MWL, layer1_blob is not used.
  out->layer1_blob.pc_offset = 0;
  out->layer1_blob.len = i;
  return 1;
}

void levelinfo_free(LevelInfo *info) {
  if (!info) return;
  free(info->objects);
  info->objects = NULL;
  info->objects_count = 0;
}

int parse_level_info(const Rom *rom, const LmTables *tables, uint16_t level_id, LevelInfo *out,
                     char *err, size_t errcap) {
  if (!rom || !tables || !out) {
    seterr(err, errcap, "parse_level_info: invalid args");
    return 0;
  }
  memset(out, 0, sizeof(*out));
  out->level_id = level_id;

  uint32_t layer1_ptr = 0;
  if (!read_layer_ptr24(rom, tables->layer1_ptr_table, level_id, &layer1_ptr)) {
    seterr(err, errcap, "Failed to read Layer1 pointer table entry");
    return 0;
  }
  out->layer1_data_ptr_snes = layer1_ptr;

  // Secondary header tables
  out->secondary.present = 1;
  if (!read_table_byte(rom, tables->sec_byte1, level_id, &out->secondary.b1) ||
      !read_table_byte(rom, tables->sec_byte2, level_id, &out->secondary.b2) ||
      !read_table_byte(rom, tables->sec_byte3, level_id, &out->secondary.b3) ||
      !read_table_byte(rom, tables->sec_byte4, level_id, &out->secondary.b4)) {
    seterr(err, errcap, "Failed reading secondary header tables");
    return 0;
  }
  if (tables->sec_byte5) {
    (void)read_table_byte(rom, tables->sec_byte5, level_id, &out->secondary.b5);
  }
  if (tables->sec_byte6) {
    (void)read_table_byte(rom, tables->sec_byte6, level_id, &out->secondary.b6);
  }
  if (tables->sec_byte7) {
    (void)read_table_byte(rom, tables->sec_byte7, level_id, &out->secondary.b7);
  }
  if (tables->sec_byte8) {
    (void)read_table_byte(rom, tables->sec_byte8, level_id, &out->secondary.b8);
  }
  decode_secondary(&out->secondary, &out->secondary_decoded);

  // Sprite header: read sprite blob pointer and decode first byte.
  uint32_t sprite_ptr = 0;
  if (read_sprite_ptr(rom, tables, level_id, &sprite_ptr)) {
    out->sprite_data_ptr_snes = sprite_ptr;
    uint8_t sh = 0;
    if (rom_read8_snes(rom, sprite_ptr, &sh)) {
      decode_sprite_header(sh, &out->sprite_header);
    } else {
      out->sprite_header.present = 0;
    }
  }

  // Determine vertical mode from primary header? We don't have it until we parse layer1.
  // As a proxy, use level_mode from primary header after parsing, and decide vertical by known SMW modes:
  // In SMW, vertical levels are usually mode 0x08..0x0B, 0x1A.. etc; but this is hack-dependent.
  // For v1: mark as vertical if level_mode has bit4 set and not 0x1C? Too error-prone.
  // We'll use a conservative heuristic: treat mode 0x0A,0x0B,0x0C,0x0D,0x1A,0x1B as vertical-ish.
  int is_vertical = 0;

  if (!parse_objects(rom, layer1_ptr, is_vertical, out, err, errcap)) {
    return 0;
  }

  return 1;
}

int parse_level_info_from_layer1_bytes(const uint8_t *layer1_bytes, size_t layer1_len, uint16_t level_id,
                                      LevelInfo *out, char *err, size_t errcap) {
  if (!layer1_bytes || !out) {
    seterr(err, errcap, "parse_level_info_from_layer1_bytes: invalid args");
    return 0;
  }
  memset(out, 0, sizeof(*out));
  out->level_id = level_id;
  out->layer1_data_ptr_snes = 0;
  out->sprite_data_ptr_snes = 0;
  out->secondary.present = 0;
  out->sprite_header.present = 0;
  out->secondary_decoded.present = 0;

  return parse_objects_from_buf(layer1_bytes, layer1_len, 0, out, err, errcap);
}

