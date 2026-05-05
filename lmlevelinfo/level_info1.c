#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>

#include "romutil.h"
#include "lm_tables.h"
#include "level_parse.h"
#include "jsonutil.h"
#include "mwl_writer.h"

static void usage(FILE *fp) {
  fprintf(fp,
          "level_info1 [--help] [--json|-j] [--mwl|-m] [--data=...] <ROMFILE> <LEVEL_ID> [-o <OUTFILE>]\n"
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
          "  --data=allobjects    alias of objects\n");
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
  }
}

static void json_emit_level(JsonW *w, const LevelInfo *info, const LmTables *tables, int include_objects) {
  jsonw_obj_begin(w);

  jsonw_key(w, "level_id");
  jsonw_uint(w, info->level_id);

  jsonw_key(w, "layer1_data_ptr_snes");
  jsonw_uint(w, info->layer1_data_ptr_snes);

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
      jsonw_obj_end(w);
    }
    jsonw_arr_end(w);

    jsonw_obj_end(w);
  }

  jsonw_obj_end(w); // layer1

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

int main(int argc, char **argv) {
  int want_json = 0;
  int want_mwl = 0;
  int data_none = 0;
  const char *out_path = NULL;

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
    } else if (!strncmp(a, "--data=", 7)) {
      const char *v = a + 7;
      if (!strcmp(v, "none")) data_none = 1;
      else if (!strcmp(v, "objects") || !strcmp(v, "allobjects") || !strcmp(v, "all")) {
        data_none = 0;
      } else {
        // accept future keys without failing
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

  printf("\n[Table detection]\n");
  printf("  Secondary header expansion: %s\n", yesno(tables.has_secondary_expansion));
  printf("  Midway hijack: %s\n", yesno(tables.has_midway_hijack));
  printf("  Sprite bank table: %s\n", yesno(tables.has_sprite_bank_table));

  levelinfo_free(&info);
  rom_free(&rom);
  return 0;
}

