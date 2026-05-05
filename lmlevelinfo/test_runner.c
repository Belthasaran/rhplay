#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <stdarg.h>

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

static int cmp_objects(const LevelInfo *rom, const LevelInfo *mwl) {
  if (rom->objects_count != mwl->objects_count) {
    failf("Mismatch objects_count: %zu != %zu", rom->objects_count, mwl->objects_count);
    return 0;
  }
  int ok = 1;
  for (size_t i = 0; i < rom->objects_count; i++) {
    const LevelObject *a = &rom->objects[i];
    const LevelObject *b = &mwl->objects[i];
    if (a->kind != b->kind) {
      failf("Object[%zu] kind mismatch: %d != %d", i, a->kind, b->kind);
      ok = 0;
      continue;
    }
    if (a->new_screen != b->new_screen) {
      failf("Object[%zu] new_screen mismatch: %u != %u", i, a->new_screen, b->new_screen);
      ok = 0;
    }
    if (a->object_number != b->object_number) {
      failf("Object[%zu] object_number mismatch: 0x%X != 0x%X", i, a->object_number, b->object_number);
      ok = 0;
    }
    if (a->x_position != b->x_position || a->y_position != b->y_position) {
      failf("Object[%zu] pos mismatch: (%u,%u) != (%u,%u)", i, a->x_position, a->y_position, b->x_position, b->y_position);
      ok = 0;
    }
    // settings only for standard objects and some LM objects; still compare raw settings for standard.
    if (a->kind == OBJ_STANDARD && a->settings != b->settings) {
      failf("Object[%zu] settings mismatch: 0x%02X != 0x%02X", i, a->settings, b->settings);
      ok = 0;
    }
    if (a->kind == OBJ_SCREEN_EXIT) {
      if (a->screen_number != b->screen_number ||
          a->lm_midway_water != b->lm_midway_water ||
          a->lm_modified != b->lm_modified ||
          a->secondary_exit_flag != b->secondary_exit_flag ||
          a->secondary_exit_id_or_dest != b->secondary_exit_id_or_dest) {
        failf("Object[%zu] screen_exit mismatch", i);
        ok = 0;
      }
    }
  }
  return ok;
}

static int run_akogare_level109(void) {
  const char *rom_path = "test/akogare/orig_Ako.sfc";
  const char *mwl_path = "test/akogare/ako_Level109.mwl";
  uint16_t level_id = 0x109;

  char err[512];

  // Parse MWL
  MwlParsed mwl;
  if (!mwl_parse_file(mwl_path, &mwl, err, sizeof(err))) {
    failf("MWL parse failed: %s", err);
    return 0;
  }
  if (mwl.level.level_id != level_id) {
    failf("MWL level id mismatch: 0x%03X != 0x%03X", mwl.level.level_id, level_id);
  }

  // Decode MWL layer1 bytes using our parser
  LevelInfo mwl_dec;
  if (!parse_level_info_from_layer1_bytes(mwl.layer1.bytes, mwl.layer1.len, level_id, &mwl_dec, err, sizeof(err))) {
    failf("Parse MWL layer1 failed: %s", err);
    mwl_parsed_free(&mwl);
    return 0;
  }

  // Decode ROM
  Rom rom;
  if (!rom_load(&rom, rom_path, err, sizeof(err))) {
    failf("ROM load failed: %s", err);
    levelinfo_free(&mwl_dec);
    mwl_parsed_free(&mwl);
    return 0;
  }
  LmTables tables;
  if (!lm_resolve_tables(&rom, &tables, err, sizeof(err))) {
    failf("ROM table resolve failed: %s", err);
    rom_free(&rom);
    levelinfo_free(&mwl_dec);
    mwl_parsed_free(&mwl);
    return 0;
  }
  LevelInfo rom_dec;
  if (!parse_level_info(&rom, &tables, level_id, &rom_dec, err, sizeof(err))) {
    failf("ROM decode failed: %s", err);
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

int main(void) {
  int ok = run_akogare_level109();
  if (failures == 0 && ok) {
    printf("PASS: akogare Level109\n");
    return 0;
  }
  printf("FAIL: %d mismatches\n", failures);
  return 1;
}

