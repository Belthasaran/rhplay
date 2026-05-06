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
  uint16_t y;
  uint8_t x;
  uint8_t screen;
  uint8_t extra_bits;
  uint8_t sprite_id;
  uint8_t ext_len;
  uint8_t ext_bytes[12];
} NormSprite;

static int norm_sprite_cmp(const void *aa, const void *bb) {
  const NormSprite *a = (const NormSprite *)aa;
  const NormSprite *b = (const NormSprite *)bb;
  if (a->sprite_id != b->sprite_id) return (int)a->sprite_id - (int)b->sprite_id;
  if (a->extra_bits != b->extra_bits) return (int)a->extra_bits - (int)b->extra_bits;
  if (a->screen != b->screen) return (int)a->screen - (int)b->screen;
  if (a->x != b->x) return (int)a->x - (int)b->x;
  if (a->y != b->y) return (int)a->y - (int)b->y;
  if (a->ext_len != b->ext_len) return (int)a->ext_len - (int)b->ext_len;
  return memcmp(a->ext_bytes, b->ext_bytes, a->ext_len);
}

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
    // Treat extended 0x02 (15-bit exit) as a screen exit for comparison purposes.
    // LM sometimes re-encodes exits differently between ROM and MWL exports, and these
    // objects don't have meaningful map coordinates.
    if (o->kind == OBJ_EXTENDED && o->object_number == 0x02 && o->raw_len >= 5) {
      no.kind = OBJ_SCREEN_EXIT;
    } else {
      no.kind = o->kind;
    }
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

    if (no.kind == OBJ_SCREEN_EXIT) {
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

static int build_normalized_objects_from_array(const LevelObject *objs, size_t objs_count, NormList *out) {
  LevelInfo tmp;
  memset(&tmp, 0, sizeof(tmp));
  tmp.objects = (LevelObject *)objs; // read-only use
  tmp.objects_count = objs_count;
  return build_normalized_objects(&tmp, out);
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

static int cmp_objects_arrays(const LevelObject *a, size_t aN, const LevelObject *b, size_t bN, const char *label) {
  NormList na = {0}, nb = {0};
  if (!build_normalized_objects_from_array(a, aN, &na) || !build_normalized_objects_from_array(b, bN, &nb)) {
    failf("[%s] Out of memory building normalized object list", label ? label : "objects");
    normlist_free(&na);
    normlist_free(&nb);
    return 0;
  }
  int ok = 1;
  if (na.len != nb.len) {
    failf("[%s] Object count mismatch: %zu != %zu", label ? label : "objects", na.len, nb.len);
    ok = 0;
  }
  size_t n = na.len < nb.len ? na.len : nb.len;
  for (size_t i = 0; i < n; i++) {
    if (norm_cmp(&na.items[i], &nb.items[i]) != 0) {
      failf("[%s] Object mismatch at %zu", label ? label : "objects", i);
      ok = 0;
      break;
    }
  }
  normlist_free(&na);
  normlist_free(&nb);
  return ok;
}

static int cmp_sprites(const LevelInfo *rom, const LevelInfo *mwl) {
  if (rom->sprite_header.present != mwl->sprite_header.present) {
    failf("Mismatch sprite_header.present: %d != %d", rom->sprite_header.present, mwl->sprite_header.present);
    return 0;
  }
  if (rom->sprite_header.present && rom->sprite_header.raw != mwl->sprite_header.raw) {
    failf("Mismatch sprite_header.raw: 0x%02X != 0x%02X", rom->sprite_header.raw, mwl->sprite_header.raw);
  }

  if (rom->sprites_count != mwl->sprites_count) {
    failf("Mismatch sprites_count: %zu != %zu", rom->sprites_count, mwl->sprites_count);
    return 0;
  }
  size_t n = rom->sprites_count;
  NormSprite *a = (NormSprite *)calloc(n ? n : 1, sizeof(NormSprite));
  NormSprite *b = (NormSprite *)calloc(n ? n : 1, sizeof(NormSprite));
  if (!a || !b) {
    free(a);
    free(b);
    failf("Out of memory comparing sprites");
    return 0;
  }

  for (size_t i = 0; i < n; i++) {
    const LevelSprite *s = &rom->sprites[i];
    a[i].y = s->y;
    a[i].x = s->x;
    a[i].screen = s->screen;
    a[i].extra_bits = s->extra_bits;
    a[i].sprite_id = s->sprite_id;
    a[i].ext_len = s->ext_len;
    memcpy(a[i].ext_bytes, s->ext_bytes, s->ext_len);
  }
  for (size_t i = 0; i < n; i++) {
    const LevelSprite *s = &mwl->sprites[i];
    b[i].y = s->y;
    b[i].x = s->x;
    b[i].screen = s->screen;
    b[i].extra_bits = s->extra_bits;
    b[i].sprite_id = s->sprite_id;
    b[i].ext_len = s->ext_len;
    memcpy(b[i].ext_bytes, s->ext_bytes, s->ext_len);
  }

  qsort(a, n, sizeof(NormSprite), norm_sprite_cmp);
  qsort(b, n, sizeof(NormSprite), norm_sprite_cmp);
  int ok = 1;
  for (size_t i = 0; i < n; i++) {
    if (norm_sprite_cmp(&a[i], &b[i]) != 0) {
      failf("NormSprite[%zu] mismatch: id=0x%02X eb=%u scr=%u x=%u y=%u ext_len=%u", i,
            a[i].sprite_id, a[i].extra_bits, a[i].screen, a[i].x, a[i].y, a[i].ext_len);
      ok = 0;
      break;
    }
  }

  free(a);
  free(b);
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

  // Decode MWL sprite bytes (requires ROM for extension-size lookup parity with ROM decode).
  if (mwl.sprites.bytes && mwl.sprites.len) {
    LevelSprite *mwl_sprites = NULL;
    size_t mwl_sprites_count = 0;
    SpriteHeader mwl_hdr;
    memset(&mwl_hdr, 0, sizeof(mwl_hdr));
    if (!parse_level_sprites_from_bytes(mwl.sprites.bytes, mwl.sprites.len, &rom, &mwl_hdr,
                                        &mwl_sprites, &mwl_sprites_count, err, sizeof(err))) {
      failf("[%s] Parse MWL sprite data failed: %s", label, err);
      rom_free(&rom);
      levelinfo_free(&mwl_dec);
      mwl_parsed_free(&mwl);
      return 0;
    }
    mwl_dec.sprite_header = mwl_hdr;
    mwl_dec.sprites = mwl_sprites;
    mwl_dec.sprites_count = mwl_sprites_count;
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

  // Optional fields (b5+): assert only when the MWL version/layout is expected to match the v2.53 doc.
  // Many fixtures are exported by newer LM; avoid brittleness by gating on a nonzero <= 2.53 version.
  if (mwl.file.lm_version && mwl.file.lm_version <= 0x0253) {
    if (mwl.level.present_sec_b5) cmp_u8("secondary.b5", rom_dec.secondary.b5, mwl.level.sec_b5);
    if (mwl.level.present_sec_b6) cmp_u8("secondary.b6", rom_dec.secondary.b6, mwl.level.sec_b6);
    if (mwl.level.present_sec_b7) cmp_u8("secondary.b7", rom_dec.secondary.b7, mwl.level.sec_b7);
    if (mwl.level.present_sec_b8) cmp_u8("secondary.b8", rom_dec.secondary.b8, mwl.level.sec_b8);
  }

  // Layer2: compare header flags and (where possible) summary/dimensions or object list.
  if (mwl.layer2.present && rom_dec.layer2_data_ptr_snes) {
    uint8_t mwl_flags = mwl.layer2.header[0];
    // ROM may not be able to read flags (0 if not readable); only compare when nonzero.
    if (rom_dec.layer2_bg_flags_0ef310) cmp_u8("layer2.bg_flags_0ef310", rom_dec.layer2_bg_flags_0ef310, mwl_flags);

    // If MWL payload looks like tilemap (16-bit tiles, width=32), compare inferred dimensions.
    if (mwl.layer2.len >= 64 && (mwl.layer2.len % 2) == 0) {
      size_t tilesN = mwl.layer2.len / 2;
      if (tilesN % 32 == 0) {
        uint8_t h = (uint8_t)(tilesN / 32);
        if (h == 27 || h == 32) {
          if (rom_dec.layer2_is_bg_tilemap && rom_dec.layer2_bg_width && rom_dec.layer2_bg_height) {
            if (rom_dec.layer2_bg_width != 32 || rom_dec.layer2_bg_height != h) {
              failf("[%s] layer2 tilemap dims mismatch ROM=%ux%u MWL=32x%u",
                    label, rom_dec.layer2_bg_width, rom_dec.layer2_bg_height, (unsigned)h);
            }
          }
        }
      }
    }

    // If ROM parsed layer2 as objects and MWL has a non-empty payload, parse MWL layer2 objects and compare.
    if (!rom_dec.layer2_is_bg_tilemap && rom_dec.layer2_objects && rom_dec.layer2_objects_count && mwl.layer2.len >= 6) {
      LevelInfo mwl_l2;
      memset(&mwl_l2, 0, sizeof(mwl_l2));
      if (!parse_level_info_from_layer1_bytes(mwl.layer2.bytes, mwl.layer2.len, level_id, &mwl_l2, err, sizeof(err))) {
        failf("[%s] Could not parse MWL layer2 as objects: %s", label, err);
      } else {
        (void)cmp_objects_arrays(rom_dec.layer2_objects, rom_dec.layer2_objects_count, mwl_l2.objects, mwl_l2.objects_count, "layer2");
      }
      levelinfo_free(&mwl_l2);
    }
  }

  // Objects/screen exits
  cmp_objects(&rom_dec, &mwl_dec);
  // Sprites
  cmp_sprites(&rom_dec, &mwl_dec);

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

static int run_akogare_suite(void) {
  const char *rom_path = "test/akogare/orig_Ako.sfc";
  const char *dir_path = "test/akogare";

  DIR *d = opendir(dir_path);
  if (!d) {
    failf("[akogare] Could not open test directory");
    return 0;
  }

  int total = 0;
  int failed = 0;

  struct dirent *de;
  while ((de = readdir(d)) != NULL) {
    const char *name = de->d_name;
    // Accept both the historical name and the batch-export naming scheme.
    int ok_prefix = (strncmp(name, "ako_", 4) == 0);
    if (!ok_prefix) continue;
    size_t nlen = strlen(name);
    if (nlen < 5) continue;
    if (strcmp(name + (nlen - 4), ".mwl") != 0) continue;

    char path[512];
    snprintf(path, sizeof(path), "%s/%s", dir_path, name);

    char label[512];
    snprintf(label, sizeof(label), "akogare %s", name);

    int before = failures;
    (void)run_case(rom_path, path, label, 0);
    total++;
    if (failures != before) {
      failed++;
      fprintf(stderr, "FAIL: akogare/%s\n", name);
    } else {
      printf("PASS: akogare/%s\n", name);
    }
  }
  closedir(d);

  if (total == 0) {
    failf("[akogare] No ako_*.mwl files found");
    return 0;
  }
  if (failed) {
    fprintf(stderr, "akogare suite: %d/%d failed\n", failed, total);
    return 0;
  }
  printf("akogare suite: %d/%d passed\n", total, total);
  return 1;
}

static int run_layer2_midway_sanity(void) {
  const char *rom_path = "test/akogare/orig_Ako.sfc";
  const uint16_t level_id = 0x109;
  char err[512];

  Rom rom;
  if (!rom_load(&rom, rom_path, err, sizeof(err))) {
    failf("[sanity] ROM load failed: %s", err);
    return 0;
  }
  LmTables tables;
  if (!lm_resolve_tables(&rom, &tables, err, sizeof(err))) {
    failf("[sanity] ROM table resolve failed: %s", err);
    rom_free(&rom);
    return 0;
  }
  LevelInfo info;
  if (!parse_level_info(&rom, &tables, level_id, &info, err, sizeof(err))) {
    failf("[sanity] ROM decode failed: %s", err);
    rom_free(&rom);
    return 0;
  }

  int ok = 1;
  if (!info.layer2_data_ptr_snes) {
    failf("[sanity] expected layer2_data_ptr_snes to be nonzero");
    ok = 0;
  }
  if (info.layer2_is_bg_tilemap && info.layer2_bg_tiles) {
    if (info.layer2_bg_width != 32 || (info.layer2_bg_height != 27 && info.layer2_bg_height != 32)) {
      failf("[sanity] unexpected layer2 tilemap dimensions: %ux%u", info.layer2_bg_width, info.layer2_bg_height);
      ok = 0;
    }
    size_t wantN = (size_t)info.layer2_bg_width * (size_t)info.layer2_bg_height;
    if (wantN == 0) {
      failf("[sanity] layer2 tilemap has zero dimensions");
      ok = 0;
    }
    // Quick invariant check: not all tiles should be 0 for real tilemaps.
    if (wantN) {
      int any_nonzero = 0;
      size_t probe = wantN < 256 ? wantN : 256;
      for (size_t i = 0; i < probe; i++) {
        if (info.layer2_bg_tiles[i] != 0) { any_nonzero = 1; break; }
      }
      if (!any_nonzero) {
        failf("[sanity] layer2 tilemap appears all-zero (first %zu tiles)", probe);
        ok = 0;
      }
    }
  } else if (!info.layer2_is_bg_tilemap) {
    // If it isn't a tilemap, we expect object parsing to have produced some list (best-effort).
    if (info.layer2_objects_count == 0 || !info.layer2_objects) {
      failf("[sanity] layer2 objects not available (count=%zu)", info.layer2_objects_count);
      ok = 0;
    }
  }
  if (tables.has_midway_hijack && !info.midway_present) {
    // Not all levels have meaningful midway settings; but if tables exist, we should at least be able to read them.
    failf("[sanity] expected midway_present when midway hijack tables exist");
    ok = 0;
  }
  if (info.midway_present) {
    // Basic invariant checks: decoded bits should match raw b1 for the stable flags.
    uint8_t b1 = info.midway_b1;
    if (((b1 >> 7) & 1) != info.midway_slippery_i) { failf("[sanity] midway slippery bit mismatch"); ok = 0; }
    if (((b1 >> 6) & 1) != info.midway_water_w) { failf("[sanity] midway water bit mismatch"); ok = 0; }
    if (((b1 >> 5) & 1) != info.midway_separate_h) { failf("[sanity] midway separate bit mismatch"); ok = 0; }
  }

  levelinfo_free(&info);

  rom_free(&rom);
  if (ok) printf("PASS: sanity layer2+midway\n");
  return ok;
}

static int run_lm_object_decode_sanity(void) {
  char err[512];
  LevelInfo out;
  int ok = 1;

#define LM_SANITY_PARSE(buf, label) \
  do { \
    if (!parse_level_info_from_layer1_bytes((buf), sizeof(buf), 0x000, &out, err, sizeof(err))) { \
      failf("[sanity] parse_level_info_from_layer1_bytes failed (%s): %s", (label), err); \
      ok = 0; \
    } \
  } while (0)

#define LM_SANITY_EXPECT_COUNT(n, label) \
  do { \
    if (ok && out.objects_count != (size_t)(n)) { \
      failf("[sanity] %s: expected %d objects, got %zu", (label), (n), out.objects_count); \
      ok = 0; \
    } \
  } while (0)

  // Primary header (5 bytes) + objects + terminator.
  // Standard object: b0 NbbYYYYY, b1 bbbbXXXX, b2+ payload per LM wiki.

  // Extended LM screen jump 03: N00YYYYY 0000XXXX ext_id
  {
    uint8_t buf[] = {
      0, 0, 0, 0, 0,
      0x0A,       // y=10, bb=0
      0x0C,       // x=12
      0x03,
      0xFF
    };
    LM_SANITY_PARSE(buf, "ext03");
    LM_SANITY_EXPECT_COUNT(1, "ext03");
    if (ok) {
      const LevelObject *o = &out.objects[0];
      if (o->kind != OBJ_EXTENDED || o->object_number != 0x03) {
        failf("[sanity] ext03: wrong kind/id");
        ok = 0;
      } else if (!o->decoded.present || o->decoded.kind != OBJ_DEC_LM_EXT03_SCREEN_JUMP) {
        failf("[sanity] ext03: expected decoded");
        ok = 0;
      } else if (o->decoded.u.ext03.half_vert_subscreen_5b != (0x0A & 0x1F) ||
                 o->decoded.u.ext03.horiz_screen_5b != (0x0C & 0x1F)) {
        failf("[sanity] ext03: field mismatch");
        ok = 0;
      }
    }
    levelinfo_free(&out);
  }

  // Object 0x22 Map16 page0, 4 bytes (decoder bit layout in level_parse.c)
  {
    uint8_t buf[] = {
      0, 0, 0, 0, 0,
      0x40 | 0x03, // bb=2, y=3
      0x20 | 0x04, // bbbb=2, x=4
      0x2A,
      0x35, // H=3 W=5, map16 bit8 from bit0
      0xFF
    };
    LM_SANITY_PARSE(buf, "obj22");
    LM_SANITY_EXPECT_COUNT(1, "obj22");
    if (ok) {
      const LevelObject *o = &out.objects[0];
      if (!o->decoded.present || o->decoded.kind != OBJ_DEC_LM_22_MAP16_PAGE0) {
        failf("[sanity] obj22: expected decoded");
        ok = 0;
      } else if (o->decoded.u.lm22_23.map16_tile_9b != (uint16_t)(0x2A | ((0x35 & 1) << 8)) ||
                 o->decoded.u.lm22_23.height_4b != 3 || o->decoded.u.lm22_23.width_4b != 5) {
        failf("[sanity] obj22: map16/H/W mismatch");
        ok = 0;
      }
    }
    levelinfo_free(&out);
  }

  // Object 0x23 Map16 page1
  {
    uint8_t buf[] = {
      0, 0, 0, 0, 0,
      0x40 | 0x00,
      0x30 | 0x01, // bbbb=3 -> 0x23
      0x10,
      0x42,
      0xFF
    };
    LM_SANITY_PARSE(buf, "obj23");
    LM_SANITY_EXPECT_COUNT(1, "obj23");
    if (ok) {
      const LevelObject *o = &out.objects[0];
      if (!o->decoded.present || o->decoded.kind != OBJ_DEC_LM_23_MAP16_PAGE1) {
        failf("[sanity] obj23: expected decoded");
        ok = 0;
      }
    }
    levelinfo_free(&out);
  }

  // Object 0x24 old FG/BG/SP bypass (deprecated), 3 bytes
  {
    uint8_t buf[] = {
      0, 0, 0, 0, 0,
      0x43,       // N10-SSSS -> SSSS=3
      0x45,       // 0100ssss -> ssss=5  -> sprite list+1 = 0x35
      0x7E,       // FG/BG list+1
      0xFF
    };
    LM_SANITY_PARSE(buf, "obj24");
    LM_SANITY_EXPECT_COUNT(1, "obj24");
    if (ok) {
      const LevelObject *o = &out.objects[0];
      if (!o->decoded.present || o->decoded.kind != OBJ_DEC_LM_24_OLD_FGBGSP_BYPASS) {
        failf("[sanity] obj24: expected decoded");
        ok = 0;
      } else if (o->decoded.u.lm24.sprite_gfx_list_plus1 != 0x35 ||
                 o->decoded.u.lm24.fgbg_gfx_list_plus1 != 0x7E) {
        failf("[sanity] obj24: gfx fields mismatch");
        ok = 0;
      }
    }
    levelinfo_free(&out);
  }

  // Object 0x25 old AN2 bypass
  {
    uint8_t buf[] = {
      0, 0, 0, 0, 0,
      0x4A,
      0x5B,
      0x33,
      0xFF
    };
    LM_SANITY_PARSE(buf, "obj25");
    LM_SANITY_EXPECT_COUNT(1, "obj25");
    if (ok) {
      const LevelObject *o = &out.objects[0];
      if (!o->decoded.present || o->decoded.kind != OBJ_DEC_LM_25_OLD_AN2_BYPASS) {
        failf("[sanity] obj25: expected decoded");
        ok = 0;
      } else if (o->decoded.u.lm25.unused_u != (uint8_t)(((0x4A & 0x0F) << 4) | (0x5B & 0x0F)) ||
                 o->decoded.u.lm25.an2_file_plus1 != 0x33) {
        failf("[sanity] obj25: field mismatch");
        ok = 0;
      }
    }
    levelinfo_free(&out);
  }

  // Object 0x26 music bypass
  {
    uint8_t buf[] = {
      0, 0, 0, 0, 0,
      0x41,
      0x62,       // bbbb=6 for standard id 0x26
      0x05,
      0xFF
    };
    LM_SANITY_PARSE(buf, "obj26");
    LM_SANITY_EXPECT_COUNT(1, "obj26");
    if (ok) {
      const LevelObject *o = &out.objects[0];
      if (!o->decoded.present || o->decoded.kind != OBJ_DEC_LM_26_MUSIC_BYPASS) {
        failf("[sanity] obj26: expected decoded");
        ok = 0;
      } else if (o->decoded.u.lm26.song_plus1 != 0x05) {
        failf("[sanity] obj26: song mismatch");
        ok = 0;
      }
    }
    levelinfo_free(&out);
  }

  // Object 0x27 mode 0 (single-screen single tile), 5 bytes
  {
    uint8_t buf[] = {
      0, 0, 0, 0, 0,
      0x40 | 0x02,
      0x70 | 0x03, // bbbb=7 -> 0x27
      0x23,        // H=2 W=3
      0x05,        // 00BBBBBB (mode bits 6-7 = 0)
      0x67,
      0xFF
    };
    LM_SANITY_PARSE(buf, "obj27m0");
    LM_SANITY_EXPECT_COUNT(1, "obj27m0");
    if (ok) {
      const LevelObject *o = &out.objects[0];
      if (!o->decoded.present || o->decoded.kind != OBJ_DEC_LM_27_DIRECT_MAP16_P00_3F) {
        failf("[sanity] obj27m0: expected decoded");
        ok = 0;
      } else if (o->decoded.u.lm27_29.variant != 0 || o->decoded.u.lm27_29.height != 2 ||
                 o->decoded.u.lm27_29.width != 3) {
        failf("[sanity] obj27m0: variant/H/W mismatch");
        ok = 0;
      }
    }
    levelinfo_free(&out);
  }

  // Object 0x27 mode 1 (multiple tiles unstretched), 5 bytes
  {
    uint8_t buf[] = {
      0, 0, 0, 0, 0,
      0x40 | 0x00,
      0x70 | 0x00,
      0xFE,        // sel_h=0xF sel_w=0xE
      0x41,        // 01BBBBBB -> mode 1
      0x00,
      0xFF
    };
    LM_SANITY_PARSE(buf, "obj27m1");
    LM_SANITY_EXPECT_COUNT(1, "obj27m1");
    if (ok) {
      const LevelObject *o = &out.objects[0];
      if (!o->decoded.present || o->decoded.u.lm27_29.variant != 1 ||
          o->decoded.u.lm27_29.sel_h_4b != 0x0F || o->decoded.u.lm27_29.sel_w_4b != 0x0E) {
        failf("[sanity] obj27m1: variant/sel mismatch");
        ok = 0;
      }
    }
    levelinfo_free(&out);
  }

  // Object 0x29 mode 0 (page 40-7F), second byte high nibble 9
  {
    uint8_t buf[] = {
      0, 0, 0, 0, 0,
      0x40 | 0x00,
      0x90 | 0x0E, // bbbb=9 -> 0x29
      0x11,
      0x02,
      0xAB,
      0xFF
    };
    LM_SANITY_PARSE(buf, "obj29m0");
    LM_SANITY_EXPECT_COUNT(1, "obj29m0");
    if (ok) {
      const LevelObject *o = &out.objects[0];
      if (!o->decoded.present || o->decoded.kind != OBJ_DEC_LM_29_DIRECT_MAP16_P40_7F) {
        failf("[sanity] obj29m0: expected decoded");
        ok = 0;
      } else if (o->decoded.u.lm27_29.variant != 0) {
        failf("[sanity] obj29m0: variant mismatch");
        ok = 0;
      }
    }
    levelinfo_free(&out);
  }

  // Object 0x28 (time limit bypass): standard_id=0x28 -> bb=2, bbbb=8
  {
    uint8_t buf[] = {
      0, 0, 0, 0, 0,
      0x40 | 0x00,
      0x80 | 0x00,
      0x12,
      0xFF
    };
    LM_SANITY_PARSE(buf, "obj28");
    LM_SANITY_EXPECT_COUNT(1, "obj28");
    if (ok) {
      const LevelObject *o = &out.objects[0];
      if (!o->decoded.present || o->decoded.kind != OBJ_DEC_LM_28_TIME_BYPASS) {
        failf("[sanity] expected decoded obj28");
        ok = 0;
      }
    }
    levelinfo_free(&out);
  }

  // Object 0x2D (user-defined): standard_id=0x2D -> bb=2, bbbb=0xD
  {
    uint8_t buf[] = {
      0, 0, 0, 0, 0,
      0x40 | 0x01,
      0xD0 | 0x02,
      0x7F,
      0xAA,
      0x55,
      0xFF
    };
    LM_SANITY_PARSE(buf, "obj2d");
    LM_SANITY_EXPECT_COUNT(1, "obj2d");
    if (ok) {
      const LevelObject *o = &out.objects[0];
      if (!o->decoded.present || o->decoded.kind != OBJ_DEC_LM_2D_USER_DEFINED) {
        failf("[sanity] expected decoded obj2d");
        ok = 0;
      } else if (o->decoded.u.lm2d.ext_a != 0xAA || o->decoded.u.lm2d.ext_b != 0x55) {
        failf("[sanity] obj2d ext bytes mismatch");
        ok = 0;
      }
    }
    levelinfo_free(&out);
  }

  // Two LM objects in one stream (ordering + lengths)
  {
    uint8_t buf[] = {
      0, 0, 0, 0, 0,
      0x40 | 0x00,
      0x20 | 0x00, // 0x22, 4 bytes
      0x00,
      0x00,
      0x40 | 0x01,
      0x80 | 0x00, // 0x28, 3 bytes
      0x34,
      0xFF
    };
    LM_SANITY_PARSE(buf, "chain22+28");
    LM_SANITY_EXPECT_COUNT(2, "chain22+28");
    if (ok) {
      if (out.objects[0].decoded.kind != OBJ_DEC_LM_22_MAP16_PAGE0 ||
          out.objects[1].decoded.kind != OBJ_DEC_LM_28_TIME_BYPASS) {
        failf("[sanity] chain22+28: decoded kinds");
        ok = 0;
      }
    }
    levelinfo_free(&out);
  }

#undef LM_SANITY_PARSE
#undef LM_SANITY_EXPECT_COUNT

  if (ok) printf("PASS: sanity lm_object_decode\n");
  return ok;
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
  int ok1b = run_akogare_suite();
  int okS = run_layer2_midway_sanity();
  int okLm = run_lm_object_decode_sanity();
  int ok2 = run_quickieworld_suite();
  int ok3 = run_suite_dir("teamaat", "test/teamaat/teamaat.sfc", "test/teamaat", "teamaat ");
  int ok4 = run_suite_dir("acidtapes", "test/acidtapes/acidtapes.sfc", "test/acidtapes", "acidtapes ");
  int ok5 = run_suite_dir("albatros", "test/albatros/albatros.sfc", "test/albatros", "albatros ");
  int ok6 = run_suite_dir("mania", "test/mania/mania.sfc", "test/mania", "mania ");
  int ok7 = run_suite_dir("mq2", "test/mq2/mq2.sfc", "test/mq2", "mq2 ");
  int ok8 = run_suite_dir("myth", "test/myth/myth.sfc", "test/myth", "myth ");
  int ok9 = run_suite_dir("sakaya", "test/sakaya/sakaya.sfc", "test/sakaya", "sakaya ");
  int ok10 = run_suite_dir("pineapple", "test/pineapple/pineapple.sfc", "test/pineapple", "pineapple ");
  if (failures == 0 && ok1 && ok1b && okS && okLm && ok2 && ok3 && ok4 && ok5 && ok6 && ok7 && ok8 && ok9 && ok10) {
    printf("ALL PASS\n");
    return 0;
  }
  printf("FAIL: %d mismatches\n", failures);
  return 1;
}

