#pragma once

#include <stdint.h>
#include <stddef.h>

#include "romutil.h"
#include "lm_tables.h"

typedef struct {
  // Primary header decoded fields
  uint8_t raw[5];
  uint8_t bg_palette;
  int length_in_screens; // -1 means 32 (per wiki “-1” meaning)
  uint8_t back_area_color;
  uint8_t level_mode;
  uint8_t layer3_priority;
  uint8_t music_mmm;
  uint8_t sprite_gfx;
  uint8_t timer_setting;
  uint8_t sprite_palette;
  uint8_t fg_palette;
  uint8_t item_memory_set;
  uint8_t vertical_scroll_set;
  uint8_t fgbg_gfx_setting;
} PrimaryLevelHeader;

typedef struct {
  int present;
  uint8_t b1, b2, b3, b4;
  uint8_t b5, b6, b7, b8; // optional, 0 if not present
} SecondaryLevelHeader;

typedef struct {
  int present;

  // Derived from b1..b4 (and b5..b8 when present), per Level_Data_Format.
  uint8_t l2_scroll_h;       // (H)hhhh (high bit H indicates bit5 behavior)
  uint8_t main_y_low4;       // yyyy
  uint8_t main_y_high6;      // YYYYYY (from b7 when present)
  uint8_t layer3_setting_2b; // 33
  uint8_t main_action_3b;    // AAA
  uint8_t main_x_3b;         // xxx
  uint8_t midway_screen_4b;  // MMMM (lower bits; bit4 may come from b5 in some LM configs)
  uint8_t fg_initial_2b;     // ff
  uint8_t bg_initial_2b;     // bb
  uint8_t no_yoshi_intro;    // N
  uint8_t vpos_unknown_u;    // U
  uint8_t vpos_flag_v;       // V
  uint8_t main_screen_5b;    // EEEEE

  // LM extra flags from b5..b8 when present
  uint8_t slippery_i;        // I
  uint8_t water_w;           // W
  uint8_t xy2_p;             // P
  uint8_t smartspawn_t;      // t
  uint8_t sprite_spawn_tt;   // TT
  uint8_t l2_split_s;        // S
  uint8_t autoset_screens_c; // C
  uint8_t l2_vertical_vvvvv; // vvvvv
  uint8_t bg_relative_o;     // O
  uint8_t relative_to_player_r; // R
  uint8_t face_left_l;       // L
  uint8_t bg_height_or_offset_ooooo; // ooooo

  // From b6 (LM 3.40+): SHCvvvvv
  uint8_t shc_s;
  uint8_t shc_h;
  uint8_t shc_c;
} SecondaryDecoded;

typedef struct {
  int present;
  uint8_t raw;
  uint8_t buoyancy_s;
  uint8_t buoyancy_b;
  uint8_t new_sprite_system;
  uint8_t sprite_memory;
} SpriteHeader;

typedef struct {
  uint32_t index;
  uint32_t byte_offset; // offset within sprite payload where this sprite begins (after sprite header)

  // Raw base record bytes (3 bytes: yyyyEESY, XXXXssss, id)
  uint8_t raw3[3];

  // Decoded fields
  uint16_t y;         // includes y-jump high bits when new sprite system is active
  uint8_t x;          // 0..15
  uint8_t screen;     // 0..31
  uint8_t extra_bits; // 0..3
  uint8_t sprite_id;  // 0..255
  uint8_t xy_swapped; // best-effort heuristic (0/1)

  // Optional Lunar Magic extension bytes (0..12)
  uint8_t ext_len;
  uint8_t ext_bytes[12];
} LevelSprite;

typedef struct {
  uint32_t pc_offset;
  uint8_t bytes[16];
  size_t len;
} RawBlob;

typedef enum {
  OBJ_STANDARD = 1,
  OBJ_EXTENDED = 2,
  OBJ_SCREEN_EXIT = 3,
  OBJ_UNKNOWN = 4
} ObjectKind;

typedef enum {
  OBJ_DEC_NONE = 0,
  OBJ_DEC_LM_22_MAP16_PAGE0,
  OBJ_DEC_LM_23_MAP16_PAGE1,
  OBJ_DEC_LM_24_OLD_FGBGSP_BYPASS,
  OBJ_DEC_LM_25_OLD_AN2_BYPASS,
  OBJ_DEC_LM_26_MUSIC_BYPASS,
  OBJ_DEC_LM_27_DIRECT_MAP16_P00_3F,
  OBJ_DEC_LM_28_TIME_BYPASS,
  OBJ_DEC_LM_29_DIRECT_MAP16_P40_7F,
  OBJ_DEC_LM_2D_USER_DEFINED,
  OBJ_DEC_LM_EXT03_SCREEN_JUMP
} ObjectDecodedKind;

typedef struct {
  int present;
  ObjectDecodedKind kind;
  union {
    struct {
      uint16_t map16_tile_9b; // low 9-bit Map16 tile number
      uint8_t height_4b;
      uint8_t width_4b;
    } lm22_23;
    struct {
      uint16_t sprite_gfx_list_plus1; // SSSSssss
      uint8_t fgbg_gfx_list_plus1;    // FFFFFFFF
    } lm24;
    struct {
      uint8_t unused_u;       // UUUUuuuu
      uint8_t an2_file_plus1; // AAAAAAAA
    } lm25;
    struct {
      uint8_t unused_u;   // UUUUuuuu
      uint8_t song_plus1; // MMMMMMMM
    } lm26;
    struct {
      uint8_t variant; // 0..4 (single, unstretched, stretched, multi, conditional)
      uint16_t base_map16; // BBBBBBbbbbbbbb
      uint16_t width;
      uint16_t height;
      uint8_t sel_w_4b;
      uint8_t sel_h_4b;
      uint8_t conditional_flag_7b;
      uint8_t conditional_add_a;
    } lm27_29;
    struct {
      uint8_t ones_4b;
      uint8_t tens_4b;
      uint8_t hundreds_4b;
      uint8_t force_reset_r;
    } lm28;
    struct {
      uint8_t ext_a;
      uint8_t ext_b;
    } lm2d;
    struct {
      uint8_t horiz_screen_5b;
      uint8_t half_vert_subscreen_5b;
    } ext03;
  } u;
} LevelObjectDecoded;

typedef struct {
  ObjectKind kind;
  uint32_t index;
  uint32_t byte_offset;      // offset within Layer1 payload where this object begins
  uint8_t raw[8];
  size_t raw_len;

  // decoded common bits
  uint8_t new_screen;
  uint16_t object_number;     // standard ID (0..0x3F) or extended id (0..0xFF)
  uint8_t x_position;
  uint8_t y_position;
  uint8_t settings;
  uint8_t xy_swapped;

  // screen exit extras
  uint8_t screen_number;
  uint8_t lm_midway_water;
  uint8_t lm_modified;
  uint8_t secondary_exit_flag;
  uint16_t secondary_exit_id_or_dest;

  LevelObjectDecoded decoded;
} LevelObject;

typedef struct {
  uint16_t level_id;

  // Midway entrance extra settings (optional, LM hijack)
  int midway_present;
  // Raw bytes (when present)
  uint8_t midway_b1;
  uint8_t midway_b2;
  uint8_t midway_b3;
  uint8_t midway_b4; // optional (LM 3.00+), 0 if unavailable

  // Decoded (best-effort; fields overlap between <3.00 and 3.00+)
  uint8_t midway_slippery_i;
  uint8_t midway_water_w;
  uint8_t midway_separate_h;
  uint8_t midway_screen_bit4_m;
  uint8_t midway_action_aaa;
  uint16_t midway_y; // (YYYYYY)yyyy if available; else low bits
  uint8_t midway_x;  // xxxxx
  uint8_t midway_relative_r;
  uint8_t midway_fg_ff;
  uint8_t midway_bg_bb;
  uint8_t midway_fg_bg_offset_f;
  uint8_t midway_face_left_l;
  uint8_t midway_redirect_e;
  uint16_t midway_redirect_target_level;

  // resolved pointers
  uint32_t layer1_data_ptr_snes;
  uint32_t layer2_data_ptr_snes;
  uint32_t sprite_data_ptr_snes;

  PrimaryLevelHeader primary;
  SecondaryLevelHeader secondary;
  SecondaryDecoded secondary_decoded;
  SpriteHeader sprite_header;

  // raw layer1 data (for MWL export)
  RawBlob layer1_blob;

  // raw layer2 data (for MWL export). For object-type layer2, this captures the raw
  // stream bytes from ROM (including the 5-byte header that exists in ROM storage).
  // For bg-tilemap layer2, this may be left empty since MWL stores an uncompressed
  // 16-bit tile list instead.
  RawBlob layer2_blob;

  // raw sprite data (for MWL export). Captures the stream starting at the sprite header byte
  // through the terminator command/byte.
  RawBlob sprite_blob;

  // objects
  LevelObject *objects;
  size_t objects_count;

  // layer2 objects (when layer2 interpreted as objects)
  LevelObject *layer2_objects;
  size_t layer2_objects_count;

  // layer2 background tilemap (when interpreted as BG)
  int layer2_is_bg_tilemap;
  uint8_t layer2_bg_flags_0ef310; // LM per-level flags (0 if not readable)
  uint8_t layer2_bg_width;  // tiles, typically 32
  uint8_t layer2_bg_height; // 27 or 32
  uint16_t *layer2_bg_tiles; // width*height Map16 tiles (16-bit)

  // ---- Future MWL/ROM parity sections (LM 3.63 MWL pointers 4..7) ----
  // Palette section payload (MWL ptr[4]) — raw 16-bit SNES colors in file order.
  // We keep bytes for parity/rewriting; higher-level helpers can decode to RGB later.
  int palette_present;
  uint8_t palette_header8[8];
  uint8_t *palette_bytes;
  size_t palette_len;

  // Secondary entrances section (MWL ptr[5]) — raw records, 8 bytes each after header.
  int secondary_entrances_present;
  uint8_t secondary_entrances_header8[8];
  uint8_t *secondary_entrances_bytes;
  size_t secondary_entrances_len;

  // ExAnimation section (MWL ptr[6]) — raw payload after header.
  int exanim_present;
  uint8_t exanim_header8[8];
  uint8_t *exanim_bytes;
  size_t exanim_len;

  // ExGFX/bypass section (MWL ptr[7]) — raw payload (typically 16x u16 slots).
  int exgfx_present;
  uint8_t *exgfx_bytes;
  size_t exgfx_len;

  // sprites
  LevelSprite *sprites;
  size_t sprites_count;
} LevelInfo;

void levelinfo_free(LevelInfo *info);

// Parse layer1 header + objects, plus secondary header tables and sprite header byte.
// Returns 1 on success; 0 on failure with message in err.
int parse_level_info(const Rom *rom, const LmTables *tables, uint16_t level_id, LevelInfo *out,
                     char *err, size_t errcap);

// Parse headers+objects from a raw Layer1 buffer (as in MWL Layer1 section payload).
// `layer1_bytes` must start with the primary header and include the object stream.
int parse_level_info_from_layer1_bytes(const uint8_t *layer1_bytes, size_t layer1_len, uint16_t level_id,
                                      LevelInfo *out, char *err, size_t errcap);

// Parse sprite stream from ROM at `sprite_ptr_snes` (points to sprite header byte).
// Decodes sprite header and sprite records (including LM commands and extension bytes when enabled).
int parse_level_sprites_from_rom(const Rom *rom, const LmTables *tables, uint16_t level_id,
                                 uint32_t sprite_ptr_snes, SpriteHeader *out_hdr,
                                 LevelSprite **out_sprites, size_t *out_count,
                                 char *err, size_t errcap);

// Parse sprite stream from an in-memory buffer (must start with sprite header byte).
// Uses `rom` only for optional LM extension size table lookup (may be NULL to disable extensions).
int parse_level_sprites_from_bytes(const uint8_t *bytes, size_t len,
                                   const Rom *rom,
                                   SpriteHeader *out_hdr,
                                   LevelSprite **out_sprites, size_t *out_count,
                                   char *err, size_t errcap);

// Assign cumulative horizontal screen index (0..31) from LM new_screen and ext 0x01/0x03 jumps.
void level_assign_object_screens(LevelObject *objects, size_t count);

