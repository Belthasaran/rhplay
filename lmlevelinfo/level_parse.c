#include "level_parse.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "layer1_validate.h"

static void seterr(char *err, size_t cap, const char *msg) {
  if (!err || cap == 0) return;
  snprintf(err, cap, "%s", msg ? msg : "error");
}

static int read_custom_palette_0ef600(const Rom *rom, uint16_t level_id,
                                      uint8_t out_header8[8],
                                      uint8_t **out_bytes, size_t *out_len,
                                      char *err, size_t errcap) {
  if (!rom || !out_header8 || !out_bytes || !out_len) return 0;
  *out_bytes = NULL;
  *out_len = 0;
  memset(out_header8, 0, 8);

  // Per Level_Data_Format: 24-bit pointer table at $0EF600; $000000 means no custom palette.
  uint32_t p24 = 0;
  uint32_t entry = 0x0EF600u + (uint32_t)level_id * 3u;
  if (!rom_read24_snes(rom, entry, &p24)) {
    // Hack may have moved the table; treat as absent, non-fatal.
    return 1;
  }
  if (p24 == 0) return 1;

  // Custom palettes contain all 257 colors the level uses, first is the back area color.
  const size_t pal_len = 257u * 2u;
  uint32_t pc = 0;
  if (!snes_lorom_to_pc(rom, p24, &pc) || pc + pal_len > rom->size) {
    seterr(err, errcap, "Custom palette pointer out of range");
    return 0;
  }

  uint8_t *bytes = (uint8_t *)malloc(pal_len);
  if (!bytes) {
    seterr(err, errcap, "Out of memory reading custom palette");
    return 0;
  }
  memcpy(bytes, rom->data + pc, pal_len);

  // MWL's 8-byte palette header is LM-defined; for ROM extraction we leave it as zeros and
  // compare payload bytes for logical validation.
  *out_bytes = bytes;
  *out_len = pal_len;
  return 1;
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

static int read_layer2_flags_0ef310(const Rom *rom, uint16_t level_id, uint8_t *out_flags) {
  if (!out_flags) return 0;
  *out_flags = 0;
  if (!rom) return 0;
  // LM places BG tilemap info table at $0EF310 (512 bytes).
  return rom_read8_snes(rom, ((uint32_t)0x0E << 16) | (uint32_t)(0xF310 + level_id), out_flags);
}

static int layer2_is_bg_tilemap_from_flags(uint8_t flags) {
  // Format: bbBBVFCT (wiki). If V or C set, Layer2 uses a BG tilemap.
  // In practice (LM 3.6x exports), the low bit T also indicates tilemap usage.
  uint8_t v = (flags >> 3) & 0x1;
  uint8_t c = (flags >> 1) & 0x1;
  uint8_t t = (flags >> 0) & 0x1;
  return (v || c || t) ? 1 : 0;
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

static int read_midway_byte(const Rom *rom, const LmTables *tables, uint16_t level_id,
                            uint8_t *b1, uint8_t *b2, uint8_t *b3, uint8_t *b4) {
  if (!rom || !tables || !b1 || !b2 || !b3 || !b4) return 0;
  *b1 = *b2 = *b3 = *b4 = 0;
  if (!tables->has_midway_hijack || !tables->midway_byte1 || !tables->midway_byte2 || !tables->midway_byte3) return 0;
  if (!rom_read8_snes(rom, tables->midway_byte1 + level_id, b1)) return 0;
  if (!rom_read8_snes(rom, tables->midway_byte2 + level_id, b2)) return 0;
  if (!rom_read8_snes(rom, tables->midway_byte3 + level_id, b3)) return 0;
  if (tables->has_midway_table4 && tables->midway_byte4) {
    (void)rom_read8_snes(rom, tables->midway_byte4 + level_id, b4);
  }
  return 1;
}

static void decode_midway(LevelInfo *out) {
  // Best-effort decode based on wiki formats.
  // Table1 <3.00: IWIMYAAA; 3.00+: IWHMXAAA
  uint8_t t1 = out->midway_b1;
  uint8_t t2 = out->midway_b2;
  uint8_t t3 = out->midway_b3;
  uint8_t t4 = out->midway_b4;

  out->midway_slippery_i = (t1 >> 7) & 0x1;
  out->midway_water_w = (t1 >> 6) & 0x1;
  out->midway_separate_h = (t1 >> 5) & 0x1;
  out->midway_screen_bit4_m = (t1 >> 4) & 0x1;
  out->midway_action_aaa = t1 & 0x7;

  out->midway_y = (uint16_t)t2;           // low bits only; high bits are LM-dependent
  out->midway_x = (uint8_t)(t2 & 0x0F);   // placeholder; refined below

  // Table2 is yyyyxxxx in both formats (low bits)
  out->midway_y = (uint16_t)((t2 >> 4) & 0x0F);
  out->midway_x = (uint8_t)(t2 & 0x0F);

  // Table3 differs by version; in 3.00+ includes RLE-ffbb.
  out->midway_relative_r = (t3 >> 5) & 0x1;
  out->midway_face_left_l = (t3 >> 4) & 0x1;
  out->midway_redirect_e = (t3 >> 3) & 0x1;
  out->midway_fg_ff = (t3 >> 2) & 0x3;
  out->midway_bg_bb = (t3 & 0x3);
  out->midway_fg_bg_offset_f = (t4 >> 6) & 0x1; // best-effort (3.00+ table4 -FYYYYYY)

  // Redirect target (best-effort): if E set, destination level uses table2 as low8 and bit0 of table3 as high bit.
  if (out->midway_redirect_e) {
    uint16_t dest = (uint16_t)t2;
    dest |= (uint16_t)((t3 & 0x1) << 8);
    out->midway_redirect_target_level = dest;
  }
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

static int sprite_ext_table_enabled(const Rom *rom, uint32_t *out_size_table_snes) {
  if (!out_size_table_snes) return 0;
  *out_size_table_snes = 0;
  if (!rom) return 0;

  uint8_t b = 0;
  if (!rom_read8_snes(rom, ((uint32_t)0x0E << 16) | 0xF30F, &b)) return 0;
  if (b != 0x42) return 0;
  uint32_t p = 0;
  if (!rom_read24_snes(rom, ((uint32_t)0x0E << 16) | 0xF30C, &p)) return 0;
  *out_size_table_snes = p;
  return 1;
}

static int sprite_ext_len_lookup(const Rom *rom, uint32_t size_table_snes, uint8_t extra_bits, uint8_t sprite_id,
                                 uint8_t *out_len) {
  if (!out_len) return 0;
  *out_len = 0;
  if (!rom || !size_table_snes) return 1;
  uint8_t v = 0;
  uint32_t idx = (uint32_t)extra_bits * 0x100u + (uint32_t)sprite_id;
  if (!rom_read8_snes(rom, size_table_snes + idx, &v)) return 0;
  // Table stores total sprite record size (base 3 bytes + extension bytes), up to 15.
  // Convert to extension length, clamping invalid small sizes to 0.
  if (v <= 3) {
    *out_len = 0;
  } else {
    *out_len = (uint8_t)(v - 3);
  }
  return 1;
}

static int parse_sprites_from_buf(const uint8_t *buf, size_t len,
                                  const Rom *rom_for_ext,
                                  SpriteHeader *out_hdr,
                                  LevelSprite **out_sprites, size_t *out_count,
                                  char *err, size_t errcap) {
  if (!buf || len < 1 || !out_hdr || !out_sprites || !out_count) {
    seterr(err, errcap, "parse_sprites_from_buf: invalid args");
    return 0;
  }
  *out_sprites = NULL;
  *out_count = 0;

  decode_sprite_header(buf[0], out_hdr);

  uint32_t size_table_snes = 0;
  (void)sprite_ext_table_enabled(rom_for_ext, &size_table_snes);

  size_t i = 1;
  uint8_t y_jump_high7 = 0;
  uint32_t sprite_index = 0;

  while (i < len) {
    if (sprite_index > 100000) {
      seterr(err, errcap, "Sprite parse runaway");
      return 0;
    }

    uint8_t b0 = buf[i];

    if (!out_hdr->new_sprite_system) {
      if (b0 == 0xFF) break; // legacy terminator
      if (i + 3 > len) {
        seterr(err, errcap, "Truncated sprite record");
        return 0;
      }
      uint8_t b1 = buf[i + 1];
      uint8_t b2 = buf[i + 2];
      size_t rec_off = i;
      i += 3;

      LevelSprite sp;
      memset(&sp, 0, sizeof(sp));
      sp.index = sprite_index++;
      sp.byte_offset = (uint32_t)rec_off;
      sp.raw3[0] = b0; sp.raw3[1] = b1; sp.raw3[2] = b2;

      uint8_t y_low5 = (uint8_t)((((b0 >> 4) & 0xF) << 1) | (b0 & 0x1));
      sp.extra_bits = (uint8_t)((b0 >> 2) & 0x3);
      sp.screen = (uint8_t)((((b0 >> 1) & 0x1) << 4) | (b1 & 0xF));
      sp.x = (uint8_t)((b1 >> 4) & 0xF);
      sp.sprite_id = b2;
      sp.y = y_low5;

      uint8_t ext_len = 0;
      if (!sprite_ext_len_lookup(rom_for_ext, size_table_snes, sp.extra_bits, sp.sprite_id, &ext_len)) {
        seterr(err, errcap, "Failed reading sprite extension length");
        return 0;
      }
      if (ext_len > 12) {
        seterr(err, errcap, "Sprite extension length too large");
        return 0;
      }
      if (i + ext_len > len) {
        seterr(err, errcap, "Truncated sprite extension bytes");
        return 0;
      }
      sp.ext_len = ext_len;
      if (ext_len) memcpy(sp.ext_bytes, buf + i, ext_len);
      i += ext_len;

      LevelSprite *tmp = (LevelSprite *)realloc(*out_sprites, (*out_count + 1) * sizeof(LevelSprite));
      if (!tmp) {
        seterr(err, errcap, "Out of memory parsing sprites");
        return 0;
      }
      *out_sprites = tmp;
      (*out_sprites)[*out_count] = sp;
      (*out_count)++;
      continue;
    }

    // New sprite system commands
    if (b0 == 0xFF) {
      if (i + 2 > len) {
        seterr(err, errcap, "Truncated sprite command");
        return 0;
      }
      uint8_t cmd = buf[i + 1];
      i += 2;
      if (cmd <= 0x7F) {
        y_jump_high7 = cmd;
        continue;
      }
      if (cmd == 0xFE) break;
      if (cmd != 0xFF) continue;

      // cmd == 0xFF means a normal sprite whose first byte is 0xFF.
      b0 = 0xFF;
    } else {
      i += 1; // consume b0 for normal sprite
    }

    if (i + 2 > len) {
      seterr(err, errcap, "Truncated sprite record");
      return 0;
    }
    uint8_t b1 = buf[i + 0];
    uint8_t b2 = buf[i + 1];
    size_t rec_off = i - 1; // start of record (first byte)
    i += 2;

    LevelSprite sp;
    memset(&sp, 0, sizeof(sp));
    sp.index = sprite_index++;
    sp.byte_offset = (uint32_t)rec_off;
    sp.raw3[0] = b0; sp.raw3[1] = b1; sp.raw3[2] = b2;

    uint8_t y_low5 = (uint8_t)((((b0 >> 4) & 0xF) << 1) | (b0 & 0x1));
    sp.extra_bits = (uint8_t)((b0 >> 2) & 0x3);
    sp.screen = (uint8_t)((((b0 >> 1) & 0x1) << 4) | (b1 & 0xF));
    sp.x = (uint8_t)((b1 >> 4) & 0xF);
    sp.sprite_id = b2;
    sp.y = (uint16_t)(((uint16_t)y_jump_high7 << 5) | (uint16_t)y_low5);

    uint8_t ext_len = 0;
    if (!sprite_ext_len_lookup(rom_for_ext, size_table_snes, sp.extra_bits, sp.sprite_id, &ext_len)) {
      seterr(err, errcap, "Failed reading sprite extension length");
      return 0;
    }
    if (ext_len > 12) {
      seterr(err, errcap, "Sprite extension length too large");
      return 0;
    }
    if (i + ext_len > len) {
      seterr(err, errcap, "Truncated sprite extension bytes");
      return 0;
    }
    sp.ext_len = ext_len;
    if (ext_len) memcpy(sp.ext_bytes, buf + i, ext_len);
    i += ext_len;

    LevelSprite *tmp = (LevelSprite *)realloc(*out_sprites, (*out_count + 1) * sizeof(LevelSprite));
    if (!tmp) {
      seterr(err, errcap, "Out of memory parsing sprites");
      return 0;
    }
    *out_sprites = tmp;
    (*out_sprites)[*out_count] = sp;
    (*out_count)++;
  }

  return 1;
}

int parse_level_sprites_from_rom(const Rom *rom, const LmTables *tables, uint16_t level_id,
                                 uint32_t sprite_ptr_snes, SpriteHeader *out_hdr,
                                 LevelSprite **out_sprites, size_t *out_count,
                                 char *err, size_t errcap) {
  (void)tables;
  (void)level_id;
  if (!rom || !rom->data) {
    seterr(err, errcap, "parse_level_sprites_from_rom: invalid rom");
    return 0;
  }
  uint32_t pc = 0;
  if (!snes_lorom_to_pc(rom, sprite_ptr_snes, &pc)) {
    seterr(err, errcap, "Sprite pointer unmappable");
    return 0;
  }
  const size_t HARD_CAP = 0x20000;
  size_t avail = rom->size - pc;
  if (avail > HARD_CAP) avail = HARD_CAP;
  if (avail < 1) {
    seterr(err, errcap, "Sprite data too small");
    return 0;
  }
  return parse_sprites_from_buf(rom->data + pc, avail, rom, out_hdr, out_sprites, out_count, err, errcap);
}

int parse_level_sprites_from_bytes(const uint8_t *bytes, size_t len,
                                   const Rom *rom,
                                   SpriteHeader *out_hdr,
                                   LevelSprite **out_sprites, size_t *out_count,
                                   char *err, size_t errcap) {
  return parse_sprites_from_buf(bytes, len, rom, out_hdr, out_sprites, out_count, err, errcap);
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
  // Most standard objects are 3 bytes. LM adds a few longer ones.
  if (obj_id == 0x22 || obj_id == 0x23) return 4;
  if (obj_id == 0x2D) return 5;
  if (obj_id == 0x27 || obj_id == 0x29) {
    // Need at least 5 bytes to decide.
    if (!buf || avail < 5) return 5;
    // For object 27/29, the variant selector lives in the top 2 bits of byte 3 (0-based):
    //   byte3: 00BBBBBB / 01BBBBBB / 10BBBBBB / 11BBBBBB ...
    // Conditional-direct-map16 is indicated by bit7 of byte2 (1WWWWWWW).
    uint8_t b2 = buf[2];
    uint8_t b3 = buf[3];
    uint8_t mode = (b3 >> 6) & 0x3;
    if (mode == 0x0) return 5;        // single-screen, single tile
    if (mode == 0x1) return 5;        // multiple tiles unstretched
    if (mode == 0x2) return 6;        // single-screen, multiple tiles
    // mode == 3: multi-screen or conditional direct map16
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

int layer1_blob_looks_valid(const uint8_t *p, size_t len) {
  if (!p || len < 6) return 0;
  if (p[0] == 0xFF && p[1] == 0xFF && p[2] == 0xFF && p[3] == 0xFF && p[4] == 0xFF) return 0;

  size_t max = len;
  if (max > 0x20000) max = 0x20000;

  size_t i = 5;
  size_t objs = 0;
  while (i < max) {
    uint8_t b0 = p[i];
    if (b0 == 0xFF) return 1;
    if (i + 3 > max) return 0;

    uint8_t bb = (b0 >> 5) & 0x3;
    uint8_t b1 = p[i + 1];
    uint8_t b2 = p[i + 2];
    uint8_t bbbb = (b1 >> 4) & 0xF;
    uint8_t standard_id = (uint8_t)((bb << 4) | bbbb);

    size_t olen = 0;
    if (standard_id == 0x00) {
      olen = object_len_for_extended(b2);
    } else {
      olen = object_len_for_standard(standard_id, p + i, max - i);
    }
    if (olen == 0) return 0;
    if (i + olen > max) return 0;
    i += olen;
    objs++;
    if (objs > 200000) return 0;
  }
  return 0;
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
  // Minimum viable blob: 5-byte primary header + 0xFF terminator = 6 bytes.
  if (max < 6) {
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
    uint8_t bb = (b0 >> 5) & 0x3;              // BB
    uint8_t y = b0 & 0x1F;                     // YYYYY
    uint8_t b1 = p[i + 1];
    uint8_t b2 = p[i + 2];
    uint8_t bbbb = (b1 >> 4) & 0xF;            // bbbb
    uint8_t x = b1 & 0x0F;                     // XXXX
    uint8_t settings = b2;

    uint8_t standard_id = (uint8_t)((bb << 4) | bbbb); // BBbbbb

    LevelObject obj;
    memset(&obj, 0, sizeof(obj));
    obj.index = (uint32_t)obj_index;
    obj.byte_offset = (uint32_t)i;
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
  // Minimum viable buffer: 5-byte primary header + 0xFF terminator = 6 bytes.
  if (!p || max < 6 || !out) {
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
    uint8_t bb = (b0 >> 5) & 0x3;
    uint8_t y = b0 & 0x1F;
    uint8_t b1 = p[i + 1];
    uint8_t b2 = p[i + 2];
    uint8_t bbbb = (b1 >> 4) & 0xF;

    uint8_t x = b1 & 0x0F;
    uint8_t settings = b2;
    uint8_t standard_id = (uint8_t)((bb << 4) | bbbb);

    LevelObject obj;
    memset(&obj, 0, sizeof(obj));
    obj.index = (uint32_t)obj_index;
    obj.byte_offset = (uint32_t)i;
    obj.new_screen = new_screen;
    obj.x_position = x;
    obj.y_position = y;
    obj.settings = settings;
    obj.xy_swapped = is_vertical ? 1 : 0;

    // Best-effort decode LM-specific objects based on raw bytes once we know the final record length.
    // (Implemented later in this file; safe to call with partial info.)
    // decode_lm_object_best_effort(&obj);

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

      // Decode LM extended objects that act as commands (best-effort)
      if (ext_id == 0x03 && olen >= 3) {
        // Format (per goal/wiki): Half-vertical-subscr + horizontal screen.
        // Our raw is the original 3-byte extended record, so treat raw[0] and raw[1] as payload bytes.
        obj.decoded.present = 1;
        obj.decoded.kind = OBJ_DEC_LM_EXT03_SCREEN_JUMP;
        obj.decoded.u.ext03.half_vert_subscreen_5b = (uint8_t)(obj.raw[0] & 0x1F);
        obj.decoded.u.ext03.horiz_screen_5b = (uint8_t)(obj.raw[1] & 0x1F);
      }

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

      // LM standard object decode (best-effort; uses raw bytes)
      // Common object encoding: byte0 = NbbYYYYY, byte1 = bbbbXXXX, byte2.. = settings/extra
      if (standard_id == 0x22 || standard_id == 0x23) {
        if (olen >= 4) {
          obj.decoded.present = 1;
          obj.decoded.kind = (standard_id == 0x22) ? OBJ_DEC_LM_22_MAP16_PAGE0 : OBJ_DEC_LM_23_MAP16_PAGE1;
          // LM 22/23: Bbbbbbbbb (9-bit) stored across bytes2..3 (per ref).
          uint16_t map16 = (uint16_t)obj.raw[2] | (uint16_t)((obj.raw[3] & 0x01) << 8);
          obj.decoded.u.lm22_23.map16_tile_9b = map16;
          obj.decoded.u.lm22_23.height_4b = (uint8_t)((obj.raw[3] >> 4) & 0x0F);
          obj.decoded.u.lm22_23.width_4b = (uint8_t)(obj.raw[3] & 0x0F);
        }
      } else if (standard_id == 0x24) {
        if (olen >= 3) {
          obj.decoded.present = 1;
          obj.decoded.kind = OBJ_DEC_LM_24_OLD_FGBGSP_BYPASS;
          // obj.raw[0] and obj.raw[1] contain packed SSSSssss bits.
          uint16_t s = (uint16_t)((obj.raw[0] & 0x0F) << 4) | (uint16_t)(obj.raw[1] & 0x0F);
          obj.decoded.u.lm24.sprite_gfx_list_plus1 = s;
          obj.decoded.u.lm24.fgbg_gfx_list_plus1 = obj.raw[2];
        }
      } else if (standard_id == 0x25) {
        if (olen >= 3) {
          obj.decoded.present = 1;
          obj.decoded.kind = OBJ_DEC_LM_25_OLD_AN2_BYPASS;
          uint8_t u = (uint8_t)((obj.raw[0] & 0x0F) << 4) | (uint8_t)(obj.raw[1] & 0x0F);
          obj.decoded.u.lm25.unused_u = u;
          obj.decoded.u.lm25.an2_file_plus1 = obj.raw[2];
        }
      } else if (standard_id == 0x26) {
        if (olen >= 3) {
          obj.decoded.present = 1;
          obj.decoded.kind = OBJ_DEC_LM_26_MUSIC_BYPASS;
          uint8_t u = (uint8_t)((obj.raw[0] & 0x0F) << 4) | (uint8_t)(obj.raw[1] & 0x0F);
          obj.decoded.u.lm26.unused_u = u;
          obj.decoded.u.lm26.song_plus1 = obj.raw[2];
        }
      } else if (standard_id == 0x28) {
        if (olen >= 3) {
          obj.decoded.present = 1;
          obj.decoded.kind = OBJ_DEC_LM_28_TIME_BYPASS;
          obj.decoded.u.lm28.tens_4b = (uint8_t)(obj.raw[0] & 0x0F);
          obj.decoded.u.lm28.ones_4b = (uint8_t)(obj.raw[1] & 0x0F);
          obj.decoded.u.lm28.force_reset_r = (uint8_t)((obj.raw[2] >> 4) & 0x01);
          obj.decoded.u.lm28.hundreds_4b = (uint8_t)(obj.raw[2] & 0x0F);
        }
      } else if (standard_id == 0x2D) {
        if (olen >= 5) {
          obj.decoded.present = 1;
          obj.decoded.kind = OBJ_DEC_LM_2D_USER_DEFINED;
          obj.decoded.u.lm2d.ext_a = obj.raw[3];
          obj.decoded.u.lm2d.ext_b = obj.raw[4];
        }
      } else if (standard_id == 0x27 || standard_id == 0x29) {
        // LM direct Map16 family. Decode core fields and variant-specific extras.
        if (olen >= 5) {
          obj.decoded.present = 1;
          obj.decoded.kind = (standard_id == 0x27) ? OBJ_DEC_LM_27_DIRECT_MAP16_P00_3F : OBJ_DEC_LM_29_DIRECT_MAP16_P40_7F;
          uint8_t b2v = obj.raw[2];
          uint8_t b3v = obj.raw[3];
          uint8_t mode = (b3v >> 6) & 0x3;
          uint16_t base = (uint16_t)(b3v & 0x3F) << 8 | (uint16_t)obj.raw[4];
          obj.decoded.u.lm27_29.base_map16 = base;
          obj.decoded.u.lm27_29.conditional_add_a = 0;
          obj.decoded.u.lm27_29.conditional_flag_7b = 0;
          obj.decoded.u.lm27_29.sel_w_4b = 0;
          obj.decoded.u.lm27_29.sel_h_4b = 0;

          if (mode == 0x0) {
            obj.decoded.u.lm27_29.variant = 0;
            obj.decoded.u.lm27_29.height = (uint16_t)((b2v >> 4) & 0x0F);
            obj.decoded.u.lm27_29.width = (uint16_t)(b2v & 0x0F);
          } else if (mode == 0x1) {
            obj.decoded.u.lm27_29.variant = 1;
            obj.decoded.u.lm27_29.sel_h_4b = (uint8_t)((b2v >> 4) & 0x0F);
            obj.decoded.u.lm27_29.sel_w_4b = (uint8_t)(b2v & 0x0F);
          } else if (mode == 0x2) {
            obj.decoded.u.lm27_29.variant = 2;
            obj.decoded.u.lm27_29.height = (uint16_t)((b2v >> 4) & 0x0F);
            obj.decoded.u.lm27_29.width = (uint16_t)(b2v & 0x0F);
            if (olen >= 6) {
              obj.decoded.u.lm27_29.sel_h_4b = (uint8_t)((obj.raw[5] >> 4) & 0x0F);
              obj.decoded.u.lm27_29.sel_w_4b = (uint8_t)(obj.raw[5] & 0x0F);
            }
          } else {
            // mode == 3: multi-screen or conditional direct map16 (distinguish by bit7 of byte2)
            int conditional = (b2v & 0x80) ? 1 : 0;
            obj.decoded.u.lm27_29.variant = conditional ? 4 : 3;
            obj.decoded.u.lm27_29.width = (uint16_t)(b2v & 0x7F);
            if (olen >= 7) {
              obj.decoded.u.lm27_29.sel_h_4b = (uint8_t)((obj.raw[5] >> 4) & 0x0F);
              obj.decoded.u.lm27_29.sel_w_4b = (uint8_t)(obj.raw[5] & 0x0F);
              obj.decoded.u.lm27_29.height = (uint16_t)obj.raw[6];
            }
            if (conditional && olen >= 8) {
              uint8_t acc = obj.raw[7];
              obj.decoded.u.lm27_29.conditional_add_a = (uint8_t)((acc >> 7) & 0x1);
              obj.decoded.u.lm27_29.conditional_flag_7b = (uint8_t)(acc & 0x7F);
            }
          }
        }
      }

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

static int parse_layer2_objects_from_rom(const Rom *rom, uint32_t layer2_ptr_snes, LevelInfo *out,
                                        char *err, size_t errcap) {
  uint32_t pc;
  if (!snes_lorom_to_pc(rom, layer2_ptr_snes, &pc)) {
    seterr(err, errcap, "Layer2 pointer unmappable");
    return 0;
  }
  const size_t HARD_CAP = 0x20000;
  size_t max = rom->size - pc;
  if (max > HARD_CAP) max = HARD_CAP;
  if (max < 6) {
    seterr(err, errcap, "Layer2 data too small");
    return 0;
  }
  // Layer2 object data includes a 5-byte primary header, but it is skipped/ignored.
  // We still reuse the same object record parsing logic by faking a primary header (the bytes are present),
  // then returning the parsed objects into out->layer2_objects.
  LevelInfo tmp;
  memset(&tmp, 0, sizeof(tmp));
  if (!parse_objects_from_buf(rom->data + pc, max, 0, &tmp, err, errcap)) {
    levelinfo_free(&tmp);
    return 0;
  }
  // Steal parsed objects; discard headers/primary.
  out->layer2_objects = tmp.objects;
  out->layer2_objects_count = tmp.objects_count;
  tmp.objects = NULL;
  tmp.objects_count = 0;
  levelinfo_free(&tmp);
  return 1;
}

static int lc_rle1_decompress(const uint8_t *src, size_t srclen,
                              uint8_t **out_bytes, size_t *out_len,
                              size_t *out_consumed,
                              char *err, size_t errcap) {
  if (!out_bytes || !out_len || !out_consumed) {
    seterr(err, errcap, "lc_rle1_decompress: invalid args");
    return 0;
  }
  *out_bytes = NULL;
  *out_len = 0;
  *out_consumed = 0;
  if (!src || srclen == 0) {
    seterr(err, errcap, "lc_rle1_decompress: empty input");
    return 0;
  }

  size_t cap = 1024;
  uint8_t *dst = (uint8_t *)malloc(cap);
  if (!dst) {
    seterr(err, errcap, "lc_rle1_decompress: out of memory");
    return 0;
  }

  size_t i = 0;
  size_t j = 0;
  while (i < srclen) {
    uint8_t lenb = src[i++];
    if (lenb == 0xFF) break; // end marker (LM convention)
    uint8_t rle = (lenb >> 7) & 0x1;
    size_t len = (size_t)(lenb & 0x7F) + 1u;
    if (!rle) {
      if (i + len > srclen) {
        free(dst);
        seterr(err, errcap, "lc_rle1_decompress: truncated literal");
        return 0;
      }
      if (j + len > cap) {
        while (j + len > cap) cap *= 2;
        uint8_t *tmp = (uint8_t *)realloc(dst, cap);
        if (!tmp) {
          free(dst);
          seterr(err, errcap, "lc_rle1_decompress: out of memory");
          return 0;
        }
        dst = tmp;
      }
      memcpy(dst + j, src + i, len);
      i += len;
      j += len;
    } else {
      if (i >= srclen) {
        free(dst);
        seterr(err, errcap, "lc_rle1_decompress: truncated run byte");
        return 0;
      }
      uint8_t v = src[i++];
      if (j + len > cap) {
        while (j + len > cap) cap *= 2;
        uint8_t *tmp = (uint8_t *)realloc(dst, cap);
        if (!tmp) {
          free(dst);
          seterr(err, errcap, "lc_rle1_decompress: out of memory");
          return 0;
        }
        dst = tmp;
      }
      memset(dst + j, v, len);
      j += len;
    }
    // Safety: avoid runaway on corrupt data.
    if (j > 0x200000u) {
      free(dst);
      seterr(err, errcap, "lc_rle1_decompress: output too large");
      return 0;
    }
  }

  *out_bytes = dst;
  *out_len = j;
  *out_consumed = i;
  return 1;
}

static int parse_layer2_bg_tilemap_from_rom(const Rom *rom, uint32_t layer2_ptr_snes, LevelInfo *out,
                                           char *err, size_t errcap) {
  uint8_t bank = (uint8_t)((layer2_ptr_snes >> 16) & 0xFF);
  if (bank == 0xFF) {
    // Vanilla BG tilemap (no ROM pointer)
    return 1;
  }

  uint32_t pc;
  if (!snes_lorom_to_pc(rom, layer2_ptr_snes, &pc)) {
    seterr(err, errcap, "Layer2 BG pointer unmappable");
    return 0;
  }
  size_t srclen = rom->size - pc;
  if (srclen > 0x20000) srclen = 0x20000;

  uint8_t *low = NULL;
  size_t low_len = 0, c1 = 0;
  if (!lc_rle1_decompress(rom->data + pc, srclen, &low, &low_len, &c1, err, errcap)) return 0;
  if (!(low_len == 864 || low_len == 1024)) {
    free(low);
    seterr(err, errcap, "Layer2 BG tilemap unexpected low-byte size");
    return 0;
  }

  uint8_t *high = NULL;
  size_t high_len = 0, c2 = 0;
  if (pc + c1 < rom->size) {
    size_t rem = rom->size - (pc + c1);
    if (rem > 0x20000) rem = 0x20000;
    // Best-effort: attempt a second LC_RLE1 stream for high bytes.
    (void)lc_rle1_decompress(rom->data + pc + c1, rem, &high, &high_len, &c2, err, errcap);
    if (high && high_len != low_len) {
      free(high);
      high = NULL;
      high_len = 0;
    }
  }

  uint8_t w = 32;
  uint8_t h = (uint8_t)(low_len / 32u);
  out->layer2_bg_width = w;
  out->layer2_bg_height = h;

  size_t tilesN = (size_t)w * (size_t)h;
  out->layer2_bg_tiles = (uint16_t *)calloc(tilesN ? tilesN : 1, sizeof(uint16_t));
  if (!out->layer2_bg_tiles) {
    free(low);
    free(high);
    seterr(err, errcap, "Out of memory building layer2 tilemap");
    return 0;
  }

  // LM stores as left half then right half.
  size_t half = (size_t)16 * (size_t)h;
  uint8_t const_high = (uint8_t)(out->layer2_bg_flags_0ef310 >> 4);
  uint8_t f = (uint8_t)((out->layer2_bg_flags_0ef310 >> 2) & 0x1);

  for (uint8_t yy = 0; yy < h; yy++) {
    for (uint8_t xx = 0; xx < w; xx++) {
      size_t src_i = (xx < 16) ? ((size_t)yy * 16u + (size_t)xx) : (half + (size_t)yy * 16u + (size_t)(xx - 16));
      uint8_t lo = low[src_i];
      uint8_t hi = 0;
      if (high) hi = high[src_i];
      else if (!f) hi = const_high; // only the simple documented case
      // else: legacy/high-byte rules not fully implemented yet

      out->layer2_bg_tiles[(size_t)yy * w + xx] = (uint16_t)lo | ((uint16_t)hi << 8);
    }
  }

  free(low);
  free(high);
  return 1;
}

void levelinfo_free(LevelInfo *info) {
  if (!info) return;
  free(info->objects);
  info->objects = NULL;
  info->objects_count = 0;
  free(info->layer2_objects);
  info->layer2_objects = NULL;
  info->layer2_objects_count = 0;
  free(info->layer2_bg_tiles);
  info->layer2_bg_tiles = NULL;
  free(info->palette_bytes);
  info->palette_bytes = NULL;
  info->palette_len = 0;
  info->palette_present = 0;
  free(info->secondary_entrances_bytes);
  info->secondary_entrances_bytes = NULL;
  info->secondary_entrances_len = 0;
  info->secondary_entrances_present = 0;
  free(info->exanim_bytes);
  info->exanim_bytes = NULL;
  info->exanim_len = 0;
  info->exanim_present = 0;
  free(info->exgfx_bytes);
  info->exgfx_bytes = NULL;
  info->exgfx_len = 0;
  info->exgfx_present = 0;
  free(info->sprites);
  info->sprites = NULL;
  info->sprites_count = 0;
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

  // Layer2 pointer
  uint32_t layer2_ptr = 0;
  if (read_layer_ptr24(rom, tables->layer2_ptr_table, level_id, &layer2_ptr)) {
    out->layer2_data_ptr_snes = layer2_ptr;
    uint8_t l2flags = 0;
    if (read_layer2_flags_0ef310(rom, level_id, &l2flags)) {
      out->layer2_bg_flags_0ef310 = l2flags;
      out->layer2_is_bg_tilemap = layer2_is_bg_tilemap_from_flags(l2flags);
    } else {
      // Vanilla fallback: bank==0xFF indicates BG tilemap
      uint8_t bank = (uint8_t)((layer2_ptr >> 16) & 0xFF);
      out->layer2_is_bg_tilemap = (bank == 0xFF) ? 1 : 0;
    }
  }

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

  // Midway entrance extra settings (optional hijack tables)
  {
    uint8_t mb1 = 0, mb2 = 0, mb3 = 0, mb4 = 0;
    if (read_midway_byte(rom, tables, level_id, &mb1, &mb2, &mb3, &mb4)) {
      out->midway_present = 1;
      out->midway_b1 = mb1;
      out->midway_b2 = mb2;
      out->midway_b3 = mb3;
      out->midway_b4 = mb4;
      decode_midway(out);
    }
  }

  // Sprite header: read sprite blob pointer and decode first byte.
  uint32_t sprite_ptr = 0;
  if (read_sprite_ptr(rom, tables, level_id, &sprite_ptr)) {
    out->sprite_data_ptr_snes = sprite_ptr;
    LevelSprite *sprites = NULL;
    size_t sprites_count = 0;
    SpriteHeader hdr;
    memset(&hdr, 0, sizeof(hdr));
    if (parse_level_sprites_from_rom(rom, tables, level_id, sprite_ptr, &hdr, &sprites, &sprites_count, err, errcap)) {
      out->sprite_header = hdr;
      out->sprites = sprites;
      out->sprites_count = sprites_count;
    } else {
      // If sprite parsing fails, leave sprite header absent and continue.
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

  // Palette (custom palettes only, via $0EF600 table). Best-effort: do not fail the whole parse if absent.
  {
    uint8_t hdr8[8];
    uint8_t *pal = NULL;
    size_t pal_len = 0;
    if (!read_custom_palette_0ef600(rom, level_id, hdr8, &pal, &pal_len, err, errcap)) {
      return 0;
    }
    if (pal && pal_len) {
      out->palette_present = 1;
      memcpy(out->palette_header8, hdr8, 8);
      out->palette_bytes = pal;
      out->palette_len = pal_len;
    }
  }

  // Layer2 object parsing (only when not a BG tilemap)
  if (out->layer2_data_ptr_snes) {
    // Auto-detect: some hacks don’t have readable $0EF310 flags (or move the table), and bank heuristics
    // aren’t sufficient. Try BG-tilemap parsing first; if it succeeds, treat as tilemap, otherwise fall back
    // to object parsing.
    int bg_ok = parse_layer2_bg_tilemap_from_rom(rom, out->layer2_data_ptr_snes, out, err, errcap);
    if (bg_ok && out->layer2_bg_tiles && out->layer2_bg_width && out->layer2_bg_height) {
      out->layer2_is_bg_tilemap = 1;
    } else {
      // Clear any partial BG tilemap artifacts to avoid confusing downstream checks.
      free(out->layer2_bg_tiles);
      out->layer2_bg_tiles = NULL;
      out->layer2_bg_width = 0;
      out->layer2_bg_height = 0;
      out->layer2_is_bg_tilemap = 0;
      (void)parse_layer2_objects_from_rom(rom, out->layer2_data_ptr_snes, out, err, errcap);
    }
    // Best-effort: do not fail the whole parse if layer2 can't be parsed.
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

