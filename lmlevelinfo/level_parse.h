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

typedef struct {
  ObjectKind kind;
  uint32_t index;
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
} LevelObject;

typedef struct {
  uint16_t level_id;

  // resolved pointers
  uint32_t layer1_data_ptr_snes;
  uint32_t sprite_data_ptr_snes;

  PrimaryLevelHeader primary;
  SecondaryLevelHeader secondary;
  SecondaryDecoded secondary_decoded;
  SpriteHeader sprite_header;

  // raw layer1 data (for MWL export)
  RawBlob layer1_blob;

  // objects
  LevelObject *objects;
  size_t objects_count;
} LevelInfo;

void levelinfo_free(LevelInfo *info);

// Parse layer1 header + objects, plus secondary header tables and sprite header byte.
// Returns 1 on success; 0 on failure with message in err.
int parse_level_info(const Rom *rom, const LmTables *tables, uint16_t level_id, LevelInfo *out,
                     char *err, size_t errcap);

