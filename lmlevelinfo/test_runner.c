#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <stdarg.h>
#include <dirent.h>

#include "romutil.h"
#include "lm_tables.h"
#include "level_parse.h"
#include "mwl_reader.h"

static int failures = 0;

static void failf(const char *fmt, ...) {
  failures++;
  va_list ap;
  va_start(ap, fmt);
  vfprintf(stderr, fmt, ap);
  va_end(ap);
  fputc('\n', stderr);
}

static int cmp_u8(const char *name, uint8_t a, uint8_t b) {
  if (a != b) {
    failf("Mismatch %s: 0x%02X != 0x%02X", name, a, b);
    return 0;
  }
  return 1;
}

static int cmp_primary(const PrimaryLevelHeader *a, const PrimaryLevelHeader *b) {
  int ok = 1;
  for (int i = 0; i < 5; i++) {
    char n[64];
    snprintf(n, sizeof(n), "primary.raw[%d]", i);
    ok &= cmp_u8(n, a->raw[i], b->raw[i]);
  }
  return ok;
}

typedef struct {
  ObjectKind kind;
  uint16_t object_number;
  uint16_t abs_x;     // (screen*16 + x_position) for placed objects
  uint8_t y;
  uint8_t settings;
  uint16_t screen;
  uint32_t src_index;
  uint32_t src_byte_offset;
  uint8_t raw[8];
  uint8_t raw_len;
  uint8_t is_command;
  // screen exits
  uint8_t screen_number;
  uint8_t lm_midway_water;
  uint8_t lm_modified;
  uint8_t secondary_exit_flag;
  uint16_t secondary_exit_id_or_dest;
} NormObj;

typedef struct {
  NormObj *items;
  size_t len;
} NormList;

static int norm_cmp(const void *aa, const void *bb) {
  const NormObj *a = (const NormObj *)aa;
  const NormObj *b = (const NormObj *)bb;
  if (a->kind != b->kind) return (int)a->kind - (int)b->kind;
  if (a->object_number != b->object_number) return (int)a->object_number - (int)b->object_number;
  if (a->kind == OBJ_SCREEN_EXIT) {
    if (a->screen_number != b->screen_number) return (int)a->screen_number - (int)b->screen_number;
    if (a->secondary_exit_id_or_dest != b->secondary_exit_id_or_dest)
      return (int)a->secondary_exit_id_or_dest - (int)b->secondary_exit_id_or_dest;
    if (a->secondary_exit_flag != b->secondary_exit_flag) return (int)a->secondary_exit_flag - (int)b->secondary_exit_flag;
    if (a->lm_midway_water != b->lm_midway_water) return (int)a->lm_midway_water - (int)b->lm_midway_water;
    if (a->lm_modified != b->lm_modified) return (int)a->lm_modified - (int)b->lm_modified;
    return 0;
  }
  if (a->is_command || b->is_command) {
    // Compare raw bytes for command objects.
    if (a->raw_len != b->raw_len) return (int)a->raw_len - (int)b->raw_len;
    int c = memcmp(a->raw, b->raw, a->raw_len);
    return c;
  }
  if (a->abs_x != b->abs_x) return (int)a->abs_x - (int)b->abs_x;
  if (a->y != b->y) return (int)a->y - (int)b->y;
  if (a->kind == OBJ_STANDARD && a->settings != b->settings) return (int)a->settings - (int)b->settings;
  return 0;
}

static void normlist_free(NormList *l) {
  free(l->items);
  l->items = NULL;
  l->len = 0;
}

static int normlist_push(NormList *l, const NormObj *o) {
  size_t n = l->len + 1;
  NormObj *p = (NormObj *)realloc(l->items, n * sizeof(NormObj));
  if (!p) return 0;
  l->items = p;
  l->items[l->len] = *o;
  l->len = n;
  return 1;
}

static int is_command_standard_object(uint16_t obj) {
  // Objects whose bytes are not map coordinates; compare by raw bytes rather than abs_x/y.
  // (From Level_Data_Format: music bypass, timer bypass, old gfx bypass)
  return obj == 0x26 || obj == 0x28 || obj == 0x24 || obj == 0x25;
}

static int build_normalized_objects(const LevelInfo *src, NormList *out) {
  memset(out, 0, sizeof(*out));
  uint16_t screen = 0;
  for (size_t i = 0; i < src->objects_count; i++) {
    const LevelObject *o = &src->objects[i];

    // Control objects: screen jumps (extended object 01 / 03) change the current screen.
    if (o->kind == OBJ_EXTENDED && o->object_number == 0x01 && o->raw_len >= 3) {
      // 000HHHHH 0000VVVV 00000001
      screen = (uint16_t)(o->raw[0] & 0x1F);
      continue;
    }
    if (o->kind == OBJ_EXTENDED && o->object_number == 0x03 && o->raw_len >= 3) {
      // Alternative screen jump (mode 1C). Swap usage of H and V bits.
      // In practice, treating byte0 low 5 bits as the screen gives correct behavior for mode 1C exports.
      screen = (uint16_t)(o->raw[0] & 0x1F);
      continue;
    }

    if (o->new_screen) {
      screen++;
    }

    NormObj no;
    memset(&no, 0, sizeof(no));
    no.kind = o->kind;
    no.object_number = (uint16_t)o->object_number;
    no.screen = screen;
    no.is_command = (o->kind == OBJ_STANDARD && is_command_standard_object((uint16_t)o->object_number)) ? 1 : 0;
    no.raw_len = (uint8_t)(o->raw_len > 8 ? 8 : o->raw_len);
    memcpy(no.raw, o->raw, no.raw_len);
    if (no.is_command) {
      no.abs_x = 0;
      no.y = 0;
      no.settings = 0;
    } else {
      no.abs_x = (uint16_t)(screen * 16u + (uint16_t)o->x_position);
      no.y = o->y_position;
      no.settings = o->settings;
    }
    no.src_index = (uint32_t)i;
    no.src_byte_offset = o->byte_offset;

    if (o->kind == OBJ_SCREEN_EXIT) {
      no.screen_number = o->screen_number;
      no.lm_midway_water = o->lm_midway_water;
      no.lm_modified = o->lm_modified;
      no.secondary_exit_flag = o->secondary_exit_flag;
      no.secondary_exit_id_or_dest = o->secondary_exit_id_or_dest;
      // For exits, abs_x/y are not meaningful; keep computed but compare exit fields primarily.
    }

    if (!normlist_push(out, &no)) {
      normlist_free(out);
      return 0;
    }
  }
  return 1;
}

static int cmp_objects(const LevelInfo *rom, const LevelInfo *mwl) {
  NormList a = {0}, b = {0};
  if (!build_normalized_objects(rom, &a) || !build_normalized_objects(mwl, &b)) {
    failf("Out of memory building normalized object list");
    normlist_free(&a);
    normlist_free(&b);
    return 0;
  }
  if (a.len != b.len) {
    failf("Mismatch normalized_objects_count: %zu != %zu", a.len, b.len);
    normlist_free(&a);
    normlist_free(&b);
    return 0;
  }
  qsort(a.items, a.len, sizeof(NormObj), norm_cmp);
  qsort(b.items, b.len, sizeof(NormObj), norm_cmp);
  int ok = 1;
  for (size_t i = 0; i < a.len; i++) {
    const NormObj *x = &a.items[i];
    const NormObj *y = &b.items[i];
    if (x->kind != y->kind) {
      failf("NormObj[%zu] kind mismatch: %d != %d", i, x->kind, y->kind);
      ok = 0;
      continue;
    }
    if (x->object_number != y->object_number) {
      failf("NormObj[%zu] object_number mismatch: 0x%X != 0x%X", i, x->object_number, y->object_number);
      ok = 0;
    }
    if (x->kind == OBJ_SCREEN_EXIT) {
      if (x->screen_number != y->screen_number ||
          x->lm_midway_water != y->lm_midway_water ||
          x->lm_modified != y->lm_modified ||
          x->secondary_exit_flag != y->secondary_exit_flag ||
          x->secondary_exit_id_or_dest != y->secondary_exit_id_or_dest) {
        failf("NormObj[%zu] screen_exit mismatch", i);
        ok = 0;
      }
    } else {
      if ((x->is_command || y->is_command)) {
        if (x->raw_len != y->raw_len || memcmp(x->raw, y->raw, x->raw_len) != 0) {
          failf("NormObj[%zu] command raw mismatch for obj=0x%X", i, x->object_number);
          ok = 0;
        }
      } else if (x->abs_x != y->abs_x || x->y != y->y) {
        failf("NormObj[%zu] pos mismatch: (%u,%u) != (%u,%u)", i, x->abs_x, x->y, y->abs_x, y->y);
        failf("  rom: screen=%u src_index=%u byte_off=%u obj=0x%X", x->screen, x->src_index, x->src_byte_offset, x->object_number);
        failf("  mwl: screen=%u src_index=%u byte_off=%u obj=0x%X", y->screen, y->src_index, y->src_byte_offset, y->object_number);
        ok = 0;
      }
      if (x->kind == OBJ_STANDARD && !x->is_command && x->settings != y->settings) {
        failf("NormObj[%zu] settings mismatch: 0x%02X != 0x%02X", i, x->settings, y->settings);
        ok = 0;
      }
    }
  }
  normlist_free(&a);
  normlist_free(&b);
  return ok;
}

static int run_case(const char *rom_path, const char *mwl_path, const char *label, uint16_t expected_level_id_or_0) {
  char err[512];

  // Parse MWL
  MwlParsed mwl;
  if (!mwl_parse_file(mwl_path, &mwl, err, sizeof(err))) {
    failf("[%s] MWL parse failed: %s", label, err);
    return 0;
  }
  uint16_t level_id = mwl.level.level_id;
  if (expected_level_id_or_0 && level_id != expected_level_id_or_0) {
    failf("[%s] MWL level id mismatch: 0x%03X != 0x%03X", label, level_id, expected_level_id_or_0);
  }

  // Decode MWL layer1 bytes using our parser
  LevelInfo mwl_dec;
  if (!parse_level_info_from_layer1_bytes(mwl.layer1.bytes, mwl.layer1.len, level_id, &mwl_dec, err, sizeof(err))) {
    failf("[%s] Parse MWL layer1 failed: %s", label, err);
    mwl_parsed_free(&mwl);
    return 0;
  }

  // Decode ROM
  Rom rom;
  if (!rom_load(&rom, rom_path, err, sizeof(err))) {
    failf("[%s] ROM load failed: %s", label, err);
    levelinfo_free(&mwl_dec);
    mwl_parsed_free(&mwl);
    return 0;
  }
  LmTables tables;
  if (!lm_resolve_tables(&rom, &tables, err, sizeof(err))) {
    failf("[%s] ROM table resolve failed: %s", label, err);
    rom_free(&rom);
    levelinfo_free(&mwl_dec);
    mwl_parsed_free(&mwl);
    return 0;
  }
  LevelInfo rom_dec;
  if (!parse_level_info(&rom, &tables, level_id, &rom_dec, err, sizeof(err))) {
    failf("[%s] ROM decode failed: %s", label, err);
    rom_free(&rom);
    levelinfo_free(&mwl_dec);
    mwl_parsed_free(&mwl);
    return 0;
  }

  // Compare: primary header raw bytes
  cmp_primary(&rom_dec.primary, &mwl_dec.primary);

  // Compare: secondary bytes b1..b4 from ROM tables vs MWL level info
  cmp_u8("secondary.b1", rom_dec.secondary.b1, mwl.level.sec_b1);
  cmp_u8("secondary.b2", rom_dec.secondary.b2, mwl.level.sec_b2);
  cmp_u8("secondary.b3", rom_dec.secondary.b3, mwl.level.sec_b3);
  cmp_u8("secondary.b4", rom_dec.secondary.b4, mwl.level.sec_b4);

  // Optional fields (b5+): intentionally not asserted yet for LM 3.61 MWL exports.
  // See lmlevelinfo/test/README.md for future expansion notes.

  // Objects/screen exits
  cmp_objects(&rom_dec, &mwl_dec);

  levelinfo_free(&rom_dec);
  rom_free(&rom);
  levelinfo_free(&mwl_dec);
  mwl_parsed_free(&mwl);

  return failures == 0;
}

static int run_akogare_level109(void) {
  return run_case(
    "test/akogare/orig_Ako.sfc",
    "test/akogare/ako_Level109.mwl",
    "akogare Level109",
    0x109
  );
}

static int run_quickieworld_suite(void) {
  const char *rom_path = "test/quickieworld/QuickieWorld_v1.12.sfc";
  const char *dir_path = "test/quickieworld";

  DIR *d = opendir(dir_path);
  if (!d) {
    failf("[quickieworld] Could not open test directory");
    return 0;
  }

  int total = 0;
  int failed = 0;

  struct dirent *de;
  while ((de = readdir(d)) != NULL) {
    const char *name = de->d_name;
    if (strncmp(name, "quick ", 6) != 0) continue;
    size_t nlen = strlen(name);
    if (nlen < 5) continue;
    if (strcmp(name + (nlen - 4), ".mwl") != 0) continue;

    char path[512];
    snprintf(path, sizeof(path), "%s/%s", dir_path, name);

    char label[512];
    snprintf(label, sizeof(label), "quickieworld %s", name);

    int before = failures;
    (void)run_case(rom_path, path, label, 0);
    total++;
    if (failures != before) {
      failed++;
      fprintf(stderr, "FAIL: %s\n", name);
    } else {
      printf("PASS: %s\n", name);
    }
  }
  closedir(d);

  if (total == 0) {
    failf("[quickieworld] No quick *.mwl files found");
    return 0;
  }

  if (failed) {
    fprintf(stderr, "quickieworld suite: %d/%d failed\n", failed, total);
    return 0;
  }

  printf("quickieworld suite: %d/%d passed\n", total, total);
  return 1;
}

static int run_suite_dir(const char *suite_name, const char *rom_path, const char *dir_path, const char *prefix) {
  DIR *d = opendir(dir_path);
  if (!d) {
    failf("[%s] Could not open test directory: %s", suite_name, dir_path);
    return 0;
  }

  int total = 0;
  int failed = 0;

  struct dirent *de;
  while ((de = readdir(d)) != NULL) {
    const char *name = de->d_name;
    if (strncmp(name, prefix, strlen(prefix)) != 0) continue;
    size_t nlen = strlen(name);
    if (nlen < 5) continue;
    if (strcmp(name + (nlen - 4), ".mwl") != 0) continue;

    char path[512];
    snprintf(path, sizeof(path), "%s/%s", dir_path, name);

    char label[512];
    snprintf(label, sizeof(label), "%s %s", suite_name, name);

    int before = failures;
    (void)run_case(rom_path, path, label, 0);
    total++;
    if (failures != before) {
      failed++;
      fprintf(stderr, "FAIL: %s/%s\n", suite_name, name);
    } else {
      printf("PASS: %s/%s\n", suite_name, name);
    }
  }
  closedir(d);

  if (total == 0) {
    failf("[%s] No MWL files found (prefix '%s')", suite_name, prefix);
    return 0;
  }

  if (failed) {
    fprintf(stderr, "%s suite: %d/%d failed\n", suite_name, failed, total);
    return 0;
  }

  printf("%s suite: %d/%d passed\n", suite_name, total, total);
  return 1;
}

int main(void) {
  int ok1 = run_akogare_level109();
  int ok2 = run_quickieworld_suite();
  int ok3 = run_suite_dir("teamaat", "test/teamaat/teamaat.sfc", "test/teamaat", "teamaat ");
  int ok4 = run_suite_dir("acidtapes", "test/acidtapes/acidtapes.sfc", "test/acidtapes", "acidtapes ");
  if (failures == 0 && ok1 && ok2 && ok3 && ok4) {
    printf("ALL PASS\n");
    return 0;
  }
  printf("FAIL: %d mismatches\n", failures);
  return 1;
}

