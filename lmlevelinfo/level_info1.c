#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>

#include "romutil.h"
#include "lm_tables.h"
#include "level_parse.h"
#include "jsonutil.h"
#include "mwl_writer.h"
#include "lc_lz2.h"

#include <sys/stat.h>
#include <errno.h>

static void usage(FILE *fp) {
  fprintf(fp,
          "level_info1 [--help] [--json|-j] [--mwl|-m] [--data=...] [--export-exgfx=<DIR>] <ROMFILE> <LEVEL_ID> [-o <OUTFILE>]\n"
          "\n"
          "LEVEL_ID can be like 0x10A or 10A.\n"
          "\n"
          "Modes:\n"
          "  (default) human-readable\n"
          "  -j, --json   JSON output (use -o to write to a file)\n"
          "  -m, --mwl    MWL export (requires -o)\n"
          "\n"
          "Data selection:\n"
          "  default: objects included (same as --data=objects)\n"
          "  --data=none          headers only\n"
          "  --data=objects       include object lists\n"
          "  --data=allobjects    alias of objects\n"
          "  --data=midway        include Midway entrance tables (if present)\n"
          "  --data=layer2        include Layer2 objects or BG tilemap summary\n"
          "  --data=fulldata      include large raw data (e.g., full BG tilemap grid)\n"
          "  You can combine keys with commas, e.g. --data=objects,midway,layer2\n"
          "\n"
          "Exports:\n"
          "  --export-exgfx=<DIR>   Export used ExGFX .bin (decompressed LC_LZ2, SNES 4bpp)\n");
}

static int parse_level_id(const char *s, uint16_t *out) {
  if (!s || !*s) return 0;
  char *end = NULL;
  unsigned long v = 0;
  if (s[0] == '0' && (s[1] == 'x' || s[1] == 'X')) {
    v = strtoul(s + 2, &end, 16);
  } else {
    // If it contains any A-F, treat as hex, else allow decimal.
    int is_hex = 0;
    for (const char *p = s; *p; p++) {
      if ((*p >= 'a' && *p <= 'f') || (*p >= 'A' && *p <= 'F')) {
        is_hex = 1;
        break;
      }
    }
    v = strtoul(s, &end, is_hex ? 16 : 10);
  }
  if (!end || *end != '\0') return 0;
  if (v > 0x1FF) return 0; // LM levels are 0..0x1FF for base tables
  *out = (uint16_t)v;
  return 1;
}

static const char *yesno(int v) { return v ? "Yes" : "No"; }

static const char *decoded_kind_name(ObjectDecodedKind k) {
  switch (k) {
    case OBJ_DEC_LM_22_MAP16_PAGE0: return "lm_obj22_map16_page0";
    case OBJ_DEC_LM_23_MAP16_PAGE1: return "lm_obj23_map16_page1";
    case OBJ_DEC_LM_24_OLD_FGBGSP_BYPASS: return "lm_obj24_old_fgbgsp_bypass";
    case OBJ_DEC_LM_25_OLD_AN2_BYPASS: return "lm_obj25_old_an2_bypass";
    case OBJ_DEC_LM_26_MUSIC_BYPASS: return "lm_obj26_music_bypass";
    case OBJ_DEC_LM_27_DIRECT_MAP16_P00_3F: return "lm_obj27_direct_map16_p00_3f";
    case OBJ_DEC_LM_28_TIME_BYPASS: return "lm_obj28_time_bypass";
    case OBJ_DEC_LM_29_DIRECT_MAP16_P40_7F: return "lm_obj29_direct_map16_p40_7f";
    case OBJ_DEC_LM_2D_USER_DEFINED: return "lm_obj2d_user_defined";
    case OBJ_DEC_LM_EXT03_SCREEN_JUMP: return "lm_ext03_screen_jump";
    case OBJ_DEC_NONE:
    default: return "none";
  }
}

static void json_emit_object_decoded(JsonW *w, const LevelObject *o) {
  jsonw_key(w, "decoded");
  jsonw_obj_begin(w);
  jsonw_key(w, "present"); jsonw_bool(w, o->decoded.present);
  if (!o->decoded.present) {
    jsonw_obj_end(w);
    return;
  }
  jsonw_key(w, "kind"); jsonw_str(w, decoded_kind_name(o->decoded.kind));
  switch (o->decoded.kind) {
    case OBJ_DEC_LM_22_MAP16_PAGE0:
    case OBJ_DEC_LM_23_MAP16_PAGE1:
      jsonw_key(w, "map16_tile_9b"); jsonw_uint(w, o->decoded.u.lm22_23.map16_tile_9b);
      jsonw_key(w, "height_4b"); jsonw_uint(w, o->decoded.u.lm22_23.height_4b);
      jsonw_key(w, "width_4b"); jsonw_uint(w, o->decoded.u.lm22_23.width_4b);
      break;
    case OBJ_DEC_LM_24_OLD_FGBGSP_BYPASS:
      jsonw_key(w, "sprite_gfx_list_plus1"); jsonw_uint(w, o->decoded.u.lm24.sprite_gfx_list_plus1);
      jsonw_key(w, "fgbg_gfx_list_plus1"); jsonw_uint(w, o->decoded.u.lm24.fgbg_gfx_list_plus1);
      break;
    case OBJ_DEC_LM_25_OLD_AN2_BYPASS:
      jsonw_key(w, "unused_u"); jsonw_uint(w, o->decoded.u.lm25.unused_u);
      jsonw_key(w, "an2_file_plus1"); jsonw_uint(w, o->decoded.u.lm25.an2_file_plus1);
      break;
    case OBJ_DEC_LM_26_MUSIC_BYPASS:
      jsonw_key(w, "unused_u"); jsonw_uint(w, o->decoded.u.lm26.unused_u);
      jsonw_key(w, "song_plus1"); jsonw_uint(w, o->decoded.u.lm26.song_plus1);
      break;
    case OBJ_DEC_LM_27_DIRECT_MAP16_P00_3F:
    case OBJ_DEC_LM_29_DIRECT_MAP16_P40_7F:
      jsonw_key(w, "variant"); jsonw_uint(w, o->decoded.u.lm27_29.variant);
      jsonw_key(w, "base_map16"); jsonw_uint(w, o->decoded.u.lm27_29.base_map16);
      jsonw_key(w, "width"); jsonw_uint(w, o->decoded.u.lm27_29.width);
      jsonw_key(w, "height"); jsonw_uint(w, o->decoded.u.lm27_29.height);
      jsonw_key(w, "sel_w_4b"); jsonw_uint(w, o->decoded.u.lm27_29.sel_w_4b);
      jsonw_key(w, "sel_h_4b"); jsonw_uint(w, o->decoded.u.lm27_29.sel_h_4b);
      jsonw_key(w, "conditional_flag_7b"); jsonw_uint(w, o->decoded.u.lm27_29.conditional_flag_7b);
      jsonw_key(w, "conditional_add_a"); jsonw_uint(w, o->decoded.u.lm27_29.conditional_add_a);
      break;
    case OBJ_DEC_LM_28_TIME_BYPASS:
      jsonw_key(w, "ones_4b"); jsonw_uint(w, o->decoded.u.lm28.ones_4b);
      jsonw_key(w, "tens_4b"); jsonw_uint(w, o->decoded.u.lm28.tens_4b);
      jsonw_key(w, "hundreds_4b"); jsonw_uint(w, o->decoded.u.lm28.hundreds_4b);
      jsonw_key(w, "force_reset_r"); jsonw_uint(w, o->decoded.u.lm28.force_reset_r);
      break;
    case OBJ_DEC_LM_2D_USER_DEFINED:
      jsonw_key(w, "ext_a"); jsonw_uint(w, o->decoded.u.lm2d.ext_a);
      jsonw_key(w, "ext_b"); jsonw_uint(w, o->decoded.u.lm2d.ext_b);
      break;
    case OBJ_DEC_LM_EXT03_SCREEN_JUMP:
      jsonw_key(w, "horiz_screen_5b"); jsonw_uint(w, o->decoded.u.ext03.horiz_screen_5b);
      jsonw_key(w, "half_vert_subscreen_5b"); jsonw_uint(w, o->decoded.u.ext03.half_vert_subscreen_5b);
      break;
    default:
      break;
  }
  jsonw_obj_end(w);
}

static void print_primary(const PrimaryLevelHeader *h) {
  printf("  Primary_Level_Header\n");
  printf("    BG_Palette: %u\n", h->bg_palette);
  printf("    Length_in_Screens: %d\n", h->length_in_screens);
  printf("    Back_Area_Color: %u\n", h->back_area_color);
  printf("    Level_Mode: %u\n", h->level_mode);
  printf("    Layer3_Priority: %u\n", h->layer3_priority);
  printf("    Music_MMM: %u\n", h->music_mmm);
  printf("    Sprite_GFX: %u\n", h->sprite_gfx);
  printf("    Timer_Setting: %u\n", h->timer_setting);
  printf("    Sprite_Palette: %u\n", h->sprite_palette);
  printf("    FG_Palette: %u\n", h->fg_palette);
  printf("    Item_Memory_Set: %u\n", h->item_memory_set);
  printf("    Vertical_Scroll_Set: %u\n", h->vertical_scroll_set);
  printf("    FGBG_GFX_Setting: %u\n", h->fgbg_gfx_setting);
}

static void print_secondary(const SecondaryLevelHeader *h, const LmTables *t) {
  printf("  Secondary_Level_Header: %s\n", h->present ? "Found" : "Missing");
  if (!h->present) return;
  printf("    Byte1_05F000: 0x%02X\n", h->b1);
  printf("    Byte2_05F200: 0x%02X\n", h->b2);
  printf("    Byte3_05F400: 0x%02X\n", h->b3);
  printf("    Byte4_05F600: 0x%02X\n", h->b4);
  if (t->sec_byte5) printf("    Byte5_LM: 0x%02X\n", h->b5);
  if (t->sec_byte6) printf("    Byte6_06FA00: 0x%02X\n", h->b6);
  if (t->sec_byte7) printf("    Byte7_06FC00: 0x%02X\n", h->b7);
  if (t->sec_byte8) printf("    Byte8_06FE00: 0x%02X\n", h->b8);
}

static void print_secondary_decoded(const SecondaryDecoded *d) {
  if (!d || !d->present) return;
  printf("    Decoded\n");
  printf("      L2_Scroll_H: 0x%X\n", d->l2_scroll_h);
  printf("      Main_Entrance_Y_low4: 0x%X\n", d->main_y_low4);
  printf("      Main_Entrance_X: 0x%X\n", d->main_x_3b);
  printf("      Main_Action: 0x%X\n", d->main_action_3b);
  printf("      Main_ScreenNum: 0x%X\n", d->main_screen_5b);
  printf("      Midway_Screen_nibble: 0x%X\n", d->midway_screen_4b);
  printf("      No_Yoshi_Intro: %u\n", d->no_yoshi_intro);
  printf("      VPOS_Flag: %u\n", d->vpos_flag_v);
  if (d->shc_s || d->shc_h || d->shc_c || d->l2_vertical_vvvvv) {
    printf("      Expanded_Format_Header\n");
    printf("        LMExp_L2orL3_S: %u\n", d->shc_s);
    printf("        LMExp_BottomRow_H: %u\n", d->shc_h);
    printf("        LMExp_Horizontal_C: %u\n", d->shc_c);
    printf("        LMExp_L2_VerticalScroll_vvvvv: 0x%X\n", d->l2_vertical_vvvvv);
  }
}

static void print_sprite_header(const SpriteHeader *h) {
  if (!h->present) {
    printf("  Level_Sprite_Header: Missing\n");
    return;
  }
  printf("  Level_Sprite_Header: Found\n");
  printf("    Sprite_Buoyancy_S: %u\n", h->buoyancy_s);
  printf("    Sprite_Buoyancy_B: %u\n", h->buoyancy_b);
  printf("    New_Sprite_System: %u\n", h->new_sprite_system);
  printf("    Sprite_Memory: %u\n", h->sprite_memory);
}

static void print_midway(const LevelInfo *info) {
  if (!info->midway_present) {
    printf("  Midway_Entrance: Missing\n");
    return;
  }
  printf("  Midway_Entrance: Found\n");
  printf("    Raw: b1=0x%02X b2=0x%02X b3=0x%02X", info->midway_b1, info->midway_b2, info->midway_b3);
  if (info->midway_b4) printf(" b4=0x%02X\n", info->midway_b4);
  else printf("\n");
  printf("    Decoded\n");
  printf("      Slippery_I: %u\n", info->midway_slippery_i);
  printf("      Water_W: %u\n", info->midway_water_w);
  printf("      Separate_H: %u\n", info->midway_separate_h);
  printf("      ScreenBit4_M: %u\n", info->midway_screen_bit4_m);
  printf("      Action_AAA: %u\n", info->midway_action_aaa);
  printf("      X_low4: %u\n", info->midway_x);
  printf("      Y_low4: %u\n", info->midway_y);
  printf("      Relative_R: %u\n", info->midway_relative_r);
  printf("      FG_FF: %u\n", info->midway_fg_ff);
  printf("      BG_BB: %u\n", info->midway_bg_bb);
  printf("      FaceLeft_L: %u\n", info->midway_face_left_l);
  printf("      Redirect_E: %u\n", info->midway_redirect_e);
  if (info->midway_redirect_e) {
    printf("      Redirect_Target_Level: 0x%03X\n", info->midway_redirect_target_level);
  }
}

static void print_layer2(const LevelInfo *info, int full) {
  if (!info->layer2_data_ptr_snes) {
    printf("  Layer2_Data: Missing\n");
    return;
  }
  printf("  Layer2_Data\n");
  printf("    layer2_data_ptr_snes: 0x%06X\n", info->layer2_data_ptr_snes);
  if (info->layer2_bg_flags_0ef310) {
    printf("    bg_flags_0ef310: 0x%02X\n", info->layer2_bg_flags_0ef310);
  }
  if (info->layer2_is_bg_tilemap) {
    printf("    kind: bg_tilemap\n");
    if (info->layer2_bg_tiles && info->layer2_bg_width && info->layer2_bg_height) {
      printf("    tilemap: %ux%u Map16 tiles\n", info->layer2_bg_width, info->layer2_bg_height);
      if (full) {
        for (uint8_t y = 0; y < info->layer2_bg_height; y++) {
          printf("    row%02u:", y);
          for (uint8_t x = 0; x < info->layer2_bg_width; x++) {
            uint16_t t = info->layer2_bg_tiles[(size_t)y * info->layer2_bg_width + x];
            printf(" %04X", (unsigned)t);
          }
          printf("\n");
        }
      }
    } else {
      printf("    tilemap: (not available)\n");
    }
  } else {
    printf("    kind: objects\n");
    printf("    objects_count: %zu\n", info->layer2_objects_count);
  }
}

static void print_sprites(const LevelInfo *info) {
  printf("  Level_Sprite_Data\n");
  for (size_t i = 0; i < info->sprites_count; i++) {
    const LevelSprite *s = &info->sprites[i];
    printf("    Sprite %zu: Y=%u Extra_Bits=%u X=%u Screen=%u Sprite_ID=0x%02X XY_Swapped=%u",
           i, (unsigned)s->y, (unsigned)s->extra_bits, (unsigned)s->x, (unsigned)s->screen,
           (unsigned)s->sprite_id, (unsigned)s->xy_swapped);
    if (s->ext_len) {
      printf(" Ext=[");
      for (uint8_t k = 0; k < s->ext_len; k++) {
        if (k) printf(" ");
        printf("%02X", s->ext_bytes[k]);
      }
      printf("]");
    }
    printf("\n");
  }
}

static void print_objects(const LevelInfo *info) {
  printf("  Layer1_Object_Data\n");
  for (size_t i = 0; i < info->objects_count; i++) {
    const LevelObject *o = &info->objects[i];
    if (o->kind == OBJ_STANDARD) {
      printf("    Standard_Object %zu: New_Screen=%u Object_Number=0x%02X Y=%u X=%u Settings=0x%02X XY_Swapped=%u\n",
             i, o->new_screen, (unsigned)o->object_number, o->y_position, o->x_position, o->settings, o->xy_swapped);
    } else if (o->kind == OBJ_EXTENDED) {
      printf("    Extended_Object %zu: New_Screen=%u Ext_Object_Number=0x%02X Y=%u X=%u XY_Swapped=%u\n",
             i, o->new_screen, (unsigned)o->object_number, o->y_position, o->x_position, o->xy_swapped);
    } else if (o->kind == OBJ_SCREEN_EXIT) {
      printf("    Screen_Exit %zu: Screen_Number=%u LM_Midway_Water=%u LM_Modified=%u Secondary_Exit_Flag=%u Secondary_Exit_ID_or_Dest=0x%03X\n",
             i, o->screen_number, o->lm_midway_water, o->lm_modified, o->secondary_exit_flag,
             (unsigned)o->secondary_exit_id_or_dest);
    } else {
      printf("    Object %zu: kind=unknown raw_len=%zu\n", i, o->raw_len);
    }
    if (o->decoded.present) {
      printf("      Decoded: %s", decoded_kind_name(o->decoded.kind));
      switch (o->decoded.kind) {
        case OBJ_DEC_LM_22_MAP16_PAGE0:
        case OBJ_DEC_LM_23_MAP16_PAGE1:
          printf(" map16_tile_9b=0x%03X height_4b=%u width_4b=%u",
                 (unsigned)o->decoded.u.lm22_23.map16_tile_9b,
                 (unsigned)o->decoded.u.lm22_23.height_4b,
                 (unsigned)o->decoded.u.lm22_23.width_4b);
          break;
        case OBJ_DEC_LM_24_OLD_FGBGSP_BYPASS:
          printf(" sprite_gfx_list_plus1=%u fgbg_gfx_list_plus1=%u",
                 (unsigned)o->decoded.u.lm24.sprite_gfx_list_plus1,
                 (unsigned)o->decoded.u.lm24.fgbg_gfx_list_plus1);
          break;
        case OBJ_DEC_LM_25_OLD_AN2_BYPASS:
          printf(" unused_u=0x%02X an2_file_plus1=%u",
                 (unsigned)o->decoded.u.lm25.unused_u,
                 (unsigned)o->decoded.u.lm25.an2_file_plus1);
          break;
        case OBJ_DEC_LM_26_MUSIC_BYPASS:
          printf(" unused_u=0x%02X song_plus1=%u",
                 (unsigned)o->decoded.u.lm26.unused_u,
                 (unsigned)o->decoded.u.lm26.song_plus1);
          break;
        case OBJ_DEC_LM_27_DIRECT_MAP16_P00_3F:
        case OBJ_DEC_LM_29_DIRECT_MAP16_P40_7F:
          printf(" variant=%u base_map16=0x%04X w=%u h=%u sel=%ux%u cond_flag=%u cond_add=%u",
                 (unsigned)o->decoded.u.lm27_29.variant,
                 (unsigned)o->decoded.u.lm27_29.base_map16,
                 (unsigned)o->decoded.u.lm27_29.width,
                 (unsigned)o->decoded.u.lm27_29.height,
                 (unsigned)o->decoded.u.lm27_29.sel_w_4b,
                 (unsigned)o->decoded.u.lm27_29.sel_h_4b,
                 (unsigned)o->decoded.u.lm27_29.conditional_flag_7b,
                 (unsigned)o->decoded.u.lm27_29.conditional_add_a);
          break;
        case OBJ_DEC_LM_28_TIME_BYPASS:
          printf(" time=%u%u%u force_reset=%u",
                 (unsigned)o->decoded.u.lm28.hundreds_4b,
                 (unsigned)o->decoded.u.lm28.tens_4b,
                 (unsigned)o->decoded.u.lm28.ones_4b,
                 (unsigned)o->decoded.u.lm28.force_reset_r);
          break;
        case OBJ_DEC_LM_2D_USER_DEFINED:
          printf(" ext_a=0x%02X ext_b=0x%02X",
                 (unsigned)o->decoded.u.lm2d.ext_a,
                 (unsigned)o->decoded.u.lm2d.ext_b);
          break;
        case OBJ_DEC_LM_EXT03_SCREEN_JUMP:
          printf(" horiz_screen_5b=%u half_vert_subscreen_5b=%u",
                 (unsigned)o->decoded.u.ext03.horiz_screen_5b,
                 (unsigned)o->decoded.u.ext03.half_vert_subscreen_5b);
          break;
        default:
          break;
      }
      printf("\n");
    }
  }
}

static void json_emit_level(JsonW *w, const LevelInfo *info, const LmTables *tables, int include_objects) {
  jsonw_obj_begin(w);

  jsonw_key(w, "level_id");
  jsonw_uint(w, info->level_id);

  jsonw_key(w, "layer1_data_ptr_snes");
  jsonw_uint(w, info->layer1_data_ptr_snes);

  jsonw_key(w, "layer2_data_ptr_snes");
  jsonw_uint(w, info->layer2_data_ptr_snes);

  jsonw_key(w, "sprite_data_ptr_snes");
  jsonw_uint(w, info->sprite_data_ptr_snes);

  // layer1
  jsonw_key(w, "layer1");
  jsonw_obj_begin(w);

  jsonw_key(w, "primary_level_header");
  jsonw_obj_begin(w);
  jsonw_key(w, "bg_palette"); jsonw_uint(w, info->primary.bg_palette);
  jsonw_key(w, "length_in_screens"); jsonw_int(w, info->primary.length_in_screens);
  jsonw_key(w, "back_area_color"); jsonw_uint(w, info->primary.back_area_color);
  jsonw_key(w, "level_mode"); jsonw_uint(w, info->primary.level_mode);
  jsonw_key(w, "layer3_priority"); jsonw_uint(w, info->primary.layer3_priority);
  jsonw_key(w, "music_mmm"); jsonw_uint(w, info->primary.music_mmm);
  jsonw_key(w, "sprite_gfx"); jsonw_uint(w, info->primary.sprite_gfx);
  jsonw_key(w, "timer_setting"); jsonw_uint(w, info->primary.timer_setting);
  jsonw_key(w, "sprite_palette"); jsonw_uint(w, info->primary.sprite_palette);
  jsonw_key(w, "fg_palette"); jsonw_uint(w, info->primary.fg_palette);
  jsonw_key(w, "item_memory_set"); jsonw_uint(w, info->primary.item_memory_set);
  jsonw_key(w, "vertical_scroll_set"); jsonw_uint(w, info->primary.vertical_scroll_set);
  jsonw_key(w, "fgbg_gfx_setting"); jsonw_uint(w, info->primary.fgbg_gfx_setting);
  jsonw_obj_end(w);

  jsonw_key(w, "secondary_level_header");
  jsonw_obj_begin(w);
  jsonw_key(w, "present"); jsonw_bool(w, info->secondary.present);
  jsonw_key(w, "byte1_05f000"); jsonw_uint(w, info->secondary.b1);
  jsonw_key(w, "byte2_05f200"); jsonw_uint(w, info->secondary.b2);
  jsonw_key(w, "byte3_05f400"); jsonw_uint(w, info->secondary.b3);
  jsonw_key(w, "byte4_05f600"); jsonw_uint(w, info->secondary.b4);
  if (tables->sec_byte5) { jsonw_key(w, "byte5_lm"); jsonw_uint(w, info->secondary.b5); }
  if (tables->sec_byte6) { jsonw_key(w, "byte6_06fa00"); jsonw_uint(w, info->secondary.b6); }
  if (tables->sec_byte7) { jsonw_key(w, "byte7_06fc00"); jsonw_uint(w, info->secondary.b7); }
  if (tables->sec_byte8) { jsonw_key(w, "byte8_06fe00"); jsonw_uint(w, info->secondary.b8); }
  jsonw_key(w, "decoded");
  jsonw_obj_begin(w);
  jsonw_key(w, "l2_scroll_h"); jsonw_uint(w, info->secondary_decoded.l2_scroll_h);
  jsonw_key(w, "main_y_low4"); jsonw_uint(w, info->secondary_decoded.main_y_low4);
  jsonw_key(w, "main_x"); jsonw_uint(w, info->secondary_decoded.main_x_3b);
  jsonw_key(w, "main_action"); jsonw_uint(w, info->secondary_decoded.main_action_3b);
  jsonw_key(w, "main_screen_num"); jsonw_uint(w, info->secondary_decoded.main_screen_5b);
  jsonw_key(w, "midway_screen_nibble"); jsonw_uint(w, info->secondary_decoded.midway_screen_4b);
  jsonw_key(w, "no_yoshi_intro"); jsonw_uint(w, info->secondary_decoded.no_yoshi_intro);
  jsonw_key(w, "vpos_flag"); jsonw_uint(w, info->secondary_decoded.vpos_flag_v);
  if (tables->sec_byte6) {
    jsonw_key(w, "expanded_format_header");
    jsonw_obj_begin(w);
    jsonw_key(w, "lmexp_l2orl3"); jsonw_uint(w, info->secondary_decoded.shc_s);
    jsonw_key(w, "lmexp_bottom_row"); jsonw_uint(w, info->secondary_decoded.shc_h);
    jsonw_key(w, "lmexp_horizontal"); jsonw_uint(w, info->secondary_decoded.shc_c);
    jsonw_key(w, "l2_vertical_scroll"); jsonw_uint(w, info->secondary_decoded.l2_vertical_vvvvv);
    jsonw_obj_end(w);
  }
  jsonw_obj_end(w);
  jsonw_obj_end(w);

  if (include_objects) {
    jsonw_key(w, "objects");
    jsonw_obj_begin(w);

    // standard list, extended list, screen exits
    jsonw_key(w, "standard");
    jsonw_arr_begin(w);
    for (size_t i = 0; i < info->objects_count; i++) {
      const LevelObject *o = &info->objects[i];
      if (o->kind != OBJ_STANDARD) continue;
      jsonw_obj_begin(w);
      jsonw_key(w, "new_screen"); jsonw_uint(w, o->new_screen);
      jsonw_key(w, "object_number"); jsonw_uint(w, o->object_number);
      jsonw_key(w, "y_position"); jsonw_uint(w, o->y_position);
      jsonw_key(w, "x_position"); jsonw_uint(w, o->x_position);
      jsonw_key(w, "settings"); jsonw_uint(w, o->settings);
      jsonw_key(w, "xy_swapped"); jsonw_uint(w, o->xy_swapped);
      json_emit_object_decoded(w, o);
      jsonw_obj_end(w);
    }
    jsonw_arr_end(w);

    jsonw_key(w, "extended");
    jsonw_arr_begin(w);
    for (size_t i = 0; i < info->objects_count; i++) {
      const LevelObject *o = &info->objects[i];
      if (o->kind != OBJ_EXTENDED) continue;
      jsonw_obj_begin(w);
      jsonw_key(w, "new_screen"); jsonw_uint(w, o->new_screen);
      jsonw_key(w, "ext_object_number"); jsonw_uint(w, o->object_number);
      jsonw_key(w, "y_position"); jsonw_uint(w, o->y_position);
      jsonw_key(w, "x_position"); jsonw_uint(w, o->x_position);
      jsonw_key(w, "xy_swapped"); jsonw_uint(w, o->xy_swapped);
      json_emit_object_decoded(w, o);
      jsonw_obj_end(w);
    }
    jsonw_arr_end(w);

    jsonw_key(w, "screen_exits");
    jsonw_arr_begin(w);
    for (size_t i = 0; i < info->objects_count; i++) {
      const LevelObject *o = &info->objects[i];
      if (o->kind != OBJ_SCREEN_EXIT) continue;
      jsonw_obj_begin(w);
      jsonw_key(w, "screen_number"); jsonw_uint(w, o->screen_number);
      jsonw_key(w, "lm_midway_water"); jsonw_uint(w, o->lm_midway_water);
      jsonw_key(w, "lm_modified"); jsonw_uint(w, o->lm_modified);
      jsonw_key(w, "secondary_exit_flag"); jsonw_uint(w, o->secondary_exit_flag);
      jsonw_key(w, "secondary_exit_id_or_dest"); jsonw_uint(w, o->secondary_exit_id_or_dest);
      json_emit_object_decoded(w, o);
      jsonw_obj_end(w);
    }
    jsonw_arr_end(w);

    jsonw_obj_end(w);
  }

  jsonw_obj_end(w); // layer1

  // midway (optional)
  jsonw_key(w, "midway_entrance");
  jsonw_obj_begin(w);
  jsonw_key(w, "present"); jsonw_bool(w, info->midway_present);
  if (info->midway_present) {
    jsonw_key(w, "b1"); jsonw_uint(w, info->midway_b1);
    jsonw_key(w, "b2"); jsonw_uint(w, info->midway_b2);
    jsonw_key(w, "b3"); jsonw_uint(w, info->midway_b3);
    jsonw_key(w, "b4"); jsonw_uint(w, info->midway_b4);
    jsonw_key(w, "decoded");
    jsonw_obj_begin(w);
    jsonw_key(w, "slippery_i"); jsonw_uint(w, info->midway_slippery_i);
    jsonw_key(w, "water_w"); jsonw_uint(w, info->midway_water_w);
    jsonw_key(w, "separate_h"); jsonw_uint(w, info->midway_separate_h);
    jsonw_key(w, "screen_bit4_m"); jsonw_uint(w, info->midway_screen_bit4_m);
    jsonw_key(w, "action_aaa"); jsonw_uint(w, info->midway_action_aaa);
    jsonw_key(w, "x_low4"); jsonw_uint(w, info->midway_x);
    jsonw_key(w, "y_low4"); jsonw_uint(w, info->midway_y);
    jsonw_key(w, "relative_r"); jsonw_uint(w, info->midway_relative_r);
    jsonw_key(w, "fg_ff"); jsonw_uint(w, info->midway_fg_ff);
    jsonw_key(w, "bg_bb"); jsonw_uint(w, info->midway_bg_bb);
    jsonw_key(w, "face_left_l"); jsonw_uint(w, info->midway_face_left_l);
    jsonw_key(w, "redirect_e"); jsonw_uint(w, info->midway_redirect_e);
    if (info->midway_redirect_e) {
      jsonw_key(w, "redirect_target_level"); jsonw_uint(w, info->midway_redirect_target_level);
    }
    jsonw_obj_end(w);
  }
  jsonw_obj_end(w);

  // layer2 (optional)
  jsonw_key(w, "layer2");
  jsonw_obj_begin(w);
  jsonw_key(w, "present"); jsonw_bool(w, info->layer2_data_ptr_snes != 0);
  if (info->layer2_data_ptr_snes) {
    jsonw_key(w, "is_bg_tilemap"); jsonw_bool(w, info->layer2_is_bg_tilemap);
    jsonw_key(w, "bg_flags_0ef310"); jsonw_uint(w, info->layer2_bg_flags_0ef310);
    if (info->layer2_is_bg_tilemap) {
      jsonw_key(w, "width"); jsonw_uint(w, info->layer2_bg_width);
      jsonw_key(w, "height"); jsonw_uint(w, info->layer2_bg_height);
    } else {
      jsonw_key(w, "objects_count"); jsonw_uint(w, info->layer2_objects_count);
    }
  }
  jsonw_obj_end(w);

  // sprite header
  jsonw_key(w, "sprite_header");
  jsonw_obj_begin(w);
  jsonw_key(w, "present"); jsonw_bool(w, info->sprite_header.present);
  if (info->sprite_header.present) {
    jsonw_key(w, "sprite_buoyancy_s"); jsonw_uint(w, info->sprite_header.buoyancy_s);
    jsonw_key(w, "sprite_buoyancy_b"); jsonw_uint(w, info->sprite_header.buoyancy_b);
    jsonw_key(w, "new_sprite_system"); jsonw_uint(w, info->sprite_header.new_sprite_system);
    jsonw_key(w, "sprite_memory"); jsonw_uint(w, info->sprite_header.sprite_memory);
  }
  jsonw_obj_end(w);

  jsonw_key(w, "sprite_data");
  jsonw_obj_begin(w);
  jsonw_key(w, "sprites");
  jsonw_arr_begin(w);
  for (size_t i = 0; i < info->sprites_count; i++) {
    const LevelSprite *s = &info->sprites[i];
    jsonw_obj_begin(w);
    jsonw_key(w, "y"); jsonw_uint(w, s->y);
    jsonw_key(w, "extra_bits"); jsonw_uint(w, s->extra_bits);
    jsonw_key(w, "x"); jsonw_uint(w, s->x);
    jsonw_key(w, "screen"); jsonw_uint(w, s->screen);
    jsonw_key(w, "sprite_id"); jsonw_uint(w, s->sprite_id);
    jsonw_key(w, "xy_swapped"); jsonw_uint(w, s->xy_swapped);
    jsonw_key(w, "ext_bytes");
    jsonw_arr_begin(w);
    for (uint8_t k = 0; k < s->ext_len; k++) {
      jsonw_uint(w, s->ext_bytes[k]);
    }
    jsonw_arr_end(w);
    jsonw_obj_end(w);
  }
  jsonw_arr_end(w);
  jsonw_obj_end(w);

  jsonw_obj_end(w);
}

static int mkdir_p(const char *path) {
  if (!path || !*path) return 0;
  // Minimal: single-level mkdir; tests use simple dirs.
  if (mkdir(path, 0777) == 0) return 1;
  if (errno == EEXIST) return 1;
  return 0;
}

static int export_exgfx_bins(const Rom *rom, const LevelInfo *info, const char *out_dir) {
  if (!rom || !info || !out_dir) return 0;
  if (!mkdir_p(out_dir)) {
    fprintf(stderr, "Could not create output directory: %s\n", out_dir);
    return 0;
  }
  if (!info->exgfx_present || !info->exgfx_bytes || info->exgfx_len < 32) {
    fprintf(stderr, "No ExGFX/bypass data present for level.\n");
    return 0;
  }

  // ExGFX list is 16 u16 values (little-endian) from read3($0FF7FF) table.
  // For now we only export entries whose file id is in 0x80-0xFF (ExGFX files table at $0FF600).
  int wrote = 0;
  for (int slot = 0; slot < 16; slot++) {
    uint16_t v = (uint16_t)(info->exgfx_bytes[slot * 2 + 0] | ((uint16_t)info->exgfx_bytes[slot * 2 + 1] << 8));
    uint8_t file_id = (uint8_t)(v & 0xFF);
    if (file_id < 0x80) continue;

    uint32_t p24 = 0;
    uint32_t entry = 0x0FF600u + (uint32_t)(file_id - 0x80u) * 3u;
    if (!rom_read24_snes(rom, entry, &p24) || p24 == 0) {
      fprintf(stderr, "ExGFX 0x%02X: pointer missing\n", file_id);
      continue;
    }
    uint32_t pc = 0;
    if (!snes_lorom_to_pc(rom, p24, &pc) || pc >= rom->size) {
      fprintf(stderr, "ExGFX 0x%02X: pointer out of range\n", file_id);
      continue;
    }

    // Decompress from ROM bytes at pc.
    const uint8_t *src = rom->data + pc;
    size_t srclen = rom->size - pc;
    uint8_t *dec = NULL;
    size_t declen = 0;
    char err[256];
    if (!lc_lz2_decompress(src, srclen, &dec, &declen, 0x2000u, NULL, err, sizeof(err))) {
      fprintf(stderr, "ExGFX 0x%02X: decompress failed: %s\n", file_id, err);
      continue;
    }

    char out_path[512];
    snprintf(out_path, sizeof(out_path), "%s/ExGFX%02X_slot%02d.bin", out_dir, file_id, slot);
    FILE *fp = fopen(out_path, "wb");
    if (!fp) {
      fprintf(stderr, "Could not write %s\n", out_path);
      free(dec);
      continue;
    }
    fwrite(dec, 1, declen, fp);
    fclose(fp);
    free(dec);
    wrote++;
  }

  printf("Exported %d ExGFX file(s) to %s\n", wrote, out_dir);
  return wrote ? 1 : 0;
}

int main(int argc, char **argv) {
  int want_json = 0;
  int want_mwl = 0;
  int data_none = 0;
  int include_midway = 0;
  int include_layer2 = 0;
  int include_fulldata = 0;
  const char *out_path = NULL;
  const char *export_exgfx_dir = NULL;

  const char *rom_path = NULL;
  const char *level_s = NULL;

  for (int i = 1; i < argc; i++) {
    const char *a = argv[i];
    if (!strcmp(a, "--help") || !strcmp(a, "-h")) {
      usage(stdout);
      return 0;
    } else if (!strcmp(a, "--json") || !strcmp(a, "-j")) {
      want_json = 1;
    } else if (!strcmp(a, "--mwl") || !strcmp(a, "-m")) {
      want_mwl = 1;
    } else if (!strncmp(a, "--export-exgfx=", 15)) {
      export_exgfx_dir = a + 15;
    } else if (!strncmp(a, "--data=", 7)) {
      const char *v = a + 7;
      if (!strcmp(v, "none")) {
        data_none = 1;
        include_midway = 0;
        include_layer2 = 0;
        include_fulldata = 0;
      } else if (!strcmp(v, "objects") || !strcmp(v, "allobjects") || !strcmp(v, "all")) {
        data_none = 0;
        include_midway = 0;
        include_layer2 = 0;
        include_fulldata = 0;
      } else {
        // Comma-separated keys
        data_none = 0;
        const char *p = v;
        while (*p) {
          while (*p == ',' ) p++;
          const char *q = p;
          while (*q && *q != ',') q++;
          size_t n = (size_t)(q - p);
          if (n == 6 && !strncmp(p, "midway", n)) include_midway = 1;
          else if (n == 6 && !strncmp(p, "layer2", n)) include_layer2 = 1;
          else if (n == 8 && !strncmp(p, "fulldata", n)) include_fulldata = 1;
          else if (n == 7 && !strncmp(p, "objects", n)) {/* already default */}
          p = q;
        }
      }
    } else if (!strcmp(a, "-o")) {
      if (i + 1 >= argc) {
        fprintf(stderr, "Missing value after -o\n");
        return 2;
      }
      out_path = argv[++i];
    } else if (!rom_path) {
      rom_path = a;
    } else if (!level_s) {
      level_s = a;
    } else {
      fprintf(stderr, "Unexpected argument: %s\n", a);
      return 2;
    }
  }

  if (!rom_path || !level_s) {
    usage(stderr);
    return 2;
  }

  if (want_mwl && !out_path) {
    fprintf(stderr, "--mwl requires -o <output.mwl>\n");
    return 2;
  }

  uint16_t level_id = 0;
  if (!parse_level_id(level_s, &level_id)) {
    fprintf(stderr, "Invalid LEVEL_ID: %s\n", level_s);
    return 2;
  }

  Rom rom;
  char err[512];
  if (!rom_load(&rom, rom_path, err, sizeof(err))) {
    fprintf(stderr, "ROM load failed: %s\n", err);
    return 1;
  }

  LmTables tables;
  if (!lm_resolve_tables(&rom, &tables, err, sizeof(err))) {
    fprintf(stderr, "Table resolve failed: %s\n", err);
    rom_free(&rom);
    return 1;
  }

  LevelInfo info;
  if (!parse_level_info(&rom, &tables, level_id, &info, err, sizeof(err))) {
    fprintf(stderr, "Parse failed: %s\n", err);
    rom_free(&rom);
    return 1;
  }

  if (export_exgfx_dir) {
    (void)export_exgfx_bins(&rom, &info, export_exgfx_dir);
  }

  if (want_mwl) {
    FILE *fp = fopen(out_path, "wb");
    if (!fp) {
      fprintf(stderr, "Could not open output file for write: %s\n", out_path);
      levelinfo_free(&info);
      rom_free(&rom);
      return 1;
    }
    int ok = mwl_write_minimal(fp, &info, &tables, &rom);
    fclose(fp);
    if (!ok) {
      fprintf(stderr, "MWL export failed\n");
      levelinfo_free(&info);
      rom_free(&rom);
      return 1;
    }
    printf("Wrote MWL: %s\n", out_path);
    levelinfo_free(&info);
    rom_free(&rom);
    return 0;
  }

  if (want_json) {
    FILE *fp = stdout;
    if (out_path) {
      fp = fopen(out_path, "wb");
      if (!fp) {
        fprintf(stderr, "Could not open output file for write: %s\n", out_path);
        levelinfo_free(&info);
        rom_free(&rom);
        return 1;
      }
    }
    JsonW w;
    jsonw_init(&w, fp, 1);
    json_emit_level(&w, &info, &tables, data_none ? 0 : 1);
    if (out_path) fclose(fp);
    levelinfo_free(&info);
    rom_free(&rom);
    return 0;
  }

  // Human readable
  printf("Level 0x%03X\n", (unsigned)info.level_id);
  printf("Layer1_Data\n");
  print_primary(&info.primary);
  print_secondary(&info.secondary, &tables);
  print_secondary_decoded(&info.secondary_decoded);
  print_sprite_header(&info.sprite_header);

  if (!data_none) {
    print_sprites(&info);
    print_objects(&info);
  }
  if (include_midway) {
    print_midway(&info);
  }
  if (include_layer2) {
    print_layer2(&info, include_fulldata);
  }

  printf("\n[Table detection]\n");
  printf("  Secondary header expansion: %s\n", yesno(tables.has_secondary_expansion));
  printf("  Midway hijack: %s\n", yesno(tables.has_midway_hijack));
  printf("  Sprite bank table: %s\n", yesno(tables.has_sprite_bank_table));

  levelinfo_free(&info);
  rom_free(&rom);
  return 0;
}

