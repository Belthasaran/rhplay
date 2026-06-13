#include "map16_text.h"

#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static const uint16_t kTilesetGroupSpecificTiles[] = {
    0x0073, 0x0074, 0x0075, 0x0076, 0x0077, 0x0078, 0x0079, 0x007a, 0x007b, 0x007c, 0x007d, 0x007e, 0x007f, 0x0080,
    0x0081, 0x0082, 0x0083, 0x0084, 0x0085, 0x0086, 0x0087, 0x0088, 0x0089, 0x008a, 0x008b, 0x008c, 0x008d, 0x008e,
    0x008f, 0x0090, 0x0091, 0x0092, 0x0093, 0x0094, 0x0095, 0x0096, 0x0097, 0x0098, 0x0099, 0x009a, 0x009b, 0x009c,
    0x009d, 0x009e, 0x009f, 0x00a0, 0x00a1, 0x00a2, 0x00a3, 0x00a4, 0x00a5, 0x00a6, 0x00a7, 0x00a8, 0x00a9, 0x00aa,
    0x00ab, 0x00ac, 0x00ad, 0x00ae, 0x00af, 0x00b0, 0x00b1, 0x00b2, 0x00b3, 0x00b4, 0x00b5, 0x00b6, 0x00b7, 0x00b8,
    0x00b9, 0x00ba, 0x00bb, 0x00bc, 0x00bd, 0x00be, 0x00bf, 0x00c0, 0x00c1, 0x00c2, 0x00c3, 0x00c4, 0x00c5, 0x00c6,
    0x00c7, 0x00c8, 0x00c9, 0x00ca, 0x00cb, 0x00cc, 0x00cd, 0x00ce, 0x00cf, 0x00d0, 0x00d1, 0x00d2, 0x00d3, 0x00d4,
    0x00d5, 0x00d6, 0x00d7, 0x00d8, 0x00d9, 0x00da, 0x00db, 0x00dc, 0x00dd, 0x00de, 0x00df, 0x00e0, 0x00e1, 0x00e2,
    0x00e3, 0x00e4, 0x00e5, 0x00e6, 0x00e7, 0x00e8, 0x00e9, 0x00ea, 0x00eb, 0x00ec, 0x00ed, 0x00ee, 0x00ef, 0x00f0,
    0x00f1, 0x00f2, 0x00f3, 0x00f4, 0x00f5, 0x00f6, 0x00f7, 0x00f8, 0x00f9, 0x00fa, 0x00fb, 0x00fc, 0x00fd, 0x00fe,
    0x00ff, 0x0107, 0x0108, 0x0109, 0x010a, 0x010b, 0x010c, 0x010d, 0x010e, 0x010f, 0x0110, 0x0153, 0x0154, 0x0155,
    0x0156, 0x0157, 0x0158, 0x0159, 0x015a, 0x015b, 0x015c, 0x015d, 0x015e, 0x015f, 0x0160, 0x0161, 0x0162, 0x0163,
    0x0164, 0x0165, 0x0166, 0x0167, 0x0168, 0x0169, 0x016a, 0x016b, 0x016c, 0x016d,
};

static const uint16_t kNormalPipeTiles[] = {0x0133, 0x0134, 0x0135, 0x0136, 0x0137, 0x0138, 0x0139, 0x013a};

static const uint16_t kDiagonalPipeTiles[] = {0x01c4, 0x01c5, 0x01c6, 0x01c7, 0x01ec, 0x01ed, 0x01ee, 0x01ef};

static void seterr(char *err, size_t errcap, const char *msg) {
  if (!err || errcap == 0) return;
  snprintf(err, errcap, "%s", msg ? msg : "error");
}

static int parse_hex_u16(const char *s, uint16_t *out) {
  if (!s || !*s || !out) return 0;
  char *end = NULL;
  unsigned long v = strtoul(s, &end, 16);
  if (end == s || v > 0xFFFFu) return 0;
  *out = (uint16_t)v;
  return 1;
}

static void parse_flip_field(const char *s, int *hflip, int *vflip, int *priority) {
  if (hflip) *hflip = 0;
  if (vflip) *vflip = 0;
  if (priority) *priority = 0;
  if (!s) return;
  if (strchr(s, 'x')) {
    if (hflip) *hflip = 1;
  }
  if (strchr(s, 'y')) {
    if (vflip) *vflip = 1;
  }
  if (strchr(s, 'p')) {
    if (priority) *priority = 1;
  }
}

uint16_t map16_text_encode_sub_word(uint16_t chr, uint8_t pal, int hflip, int vflip, int priority) {
  return (uint16_t)((chr & 0x03FFu) | ((uint16_t)(pal & 7u) << 10) | ((uint16_t)(priority & 1) << 13) |
                    ((uint16_t)(hflip & 1) << 14) | ((uint16_t)(vflip & 1) << 15));
}

void map16_text_decode_sub_word(uint16_t w, Map16TextSub *out) {
  if (!out) return;
  out->chr = (uint16_t)(w & 0x03FFu);
  out->pal = (uint8_t)((w >> 10) & 7u);
  out->priority = (w >> 13) & 1;
  out->hflip = (w >> 14) & 1;
  out->vflip = (w >> 15) & 1;
}

void map16_text_sub_to_map16_tile(const Map16TextSub subs[4], Map16Tile *out) {
  if (!subs || !out) return;
  for (int si = 0; si < 4; si++) {
    out->w[si] = map16_text_encode_sub_word(subs[si].chr, subs[si].pal, subs[si].hflip, subs[si].vflip, subs[si].priority);
  }
}

int map16_text_tile_words_equal(const Map16Tile *a, const Map16Tile *b) {
  if (!a || !b) return 0;
  for (int si = 0; si < 4; si++) {
    if (a->w[si] != b->w[si]) return 0;
  }
  return 1;
}

int map16_text_is_tileset_group_specific(uint16_t tile_id) {
  for (size_t i = 0; i < sizeof(kTilesetGroupSpecificTiles) / sizeof(kTilesetGroupSpecificTiles[0]); i++) {
    if (kTilesetGroupSpecificTiles[i] == tile_id) return 1;
  }
  return 0;
}

int map16_text_tileset_group_slot_index(uint16_t tile_id, size_t *out_index) {
  if (!out_index) return 0;
  for (size_t i = 0; i < sizeof(kTilesetGroupSpecificTiles) / sizeof(kTilesetGroupSpecificTiles[0]); i++) {
    if (kTilesetGroupSpecificTiles[i] == tile_id) {
      *out_index = i;
      return 1;
    }
  }
  return 0;
}

int map16_text_normal_pipe_index(uint16_t tile_id, int *pipe_set_out, int *index_in_set_out) {
  for (size_t i = 0; i < 8u; i++) {
    if (kNormalPipeTiles[i] == tile_id) {
      if (index_in_set_out) *index_in_set_out = (int)i;
      return 1;
    }
  }
  (void)pipe_set_out;
  return 0;
}

int map16_text_diagonal_pipe_index(uint16_t tile_id, int *index_out) {
  for (size_t i = 0; i < 8u; i++) {
    if (kDiagonalPipeTiles[i] == tile_id) {
      if (index_out) *index_out = (int)i;
      return 1;
    }
  }
  return 0;
}

void map16_text_empty_tile(Map16TextTile *out, uint16_t tile_id, int fg_with_acts) {
  if (!out) return;
  memset(out, 0, sizeof(*out));
  out->tile_id = tile_id;
  out->format = MAP16_TEXT_FMT_EMPTY;
  out->is_empty = 1;
  out->has_acts_like = fg_with_acts;
  out->acts_like = MAP16_TEXT_LM_EMPTY_ACTS;
  for (int si = 0; si < 4; si++) {
    out->words.w[si] = MAP16_TEXT_LM_EMPTY_WORD;
  }
}

static int parse_four_subs(const char *brace, const char *end, Map16TextSub subs[4], char *err, size_t errcap) {
  const char *p = brace + 1;
  for (int si = 0; si < 4; si++) {
    while (p < end && isspace((unsigned char)*p)) p++;
    if (p >= end) {
      seterr(err, errcap, "truncated sub list");
      return 0;
    }
    char chrbuf[8];
    int ci = 0;
    while (p < end && !isspace((unsigned char)*p) && ci + 1 < (int)sizeof(chrbuf)) chrbuf[ci++] = *p++;
    chrbuf[ci] = '\0';
    if (ci == 0) return 0;
    while (p < end && isspace((unsigned char)*p)) p++;
    char palbuf[8];
    ci = 0;
    while (p < end && !isspace((unsigned char)*p) && ci + 1 < (int)sizeof(palbuf)) palbuf[ci++] = *p++;
    palbuf[ci] = '\0';
    if (ci == 0) return 0;
    while (p < end && isspace((unsigned char)*p)) p++;
    char flipbuf[8];
    ci = 0;
    while (p < end && !isspace((unsigned char)*p) && ci + 1 < (int)sizeof(flipbuf)) flipbuf[ci++] = *p++;
    flipbuf[ci] = '\0';
    if (ci == 0) return 0;
    uint16_t chr = 0;
    if (!parse_hex_u16(chrbuf, &chr)) {
      seterr(err, errcap, "bad chr hex");
      return 0;
    }
    char *pal_end = NULL;
    unsigned long palv = strtoul(palbuf, &pal_end, 10);
    if (pal_end == palbuf || palv > 7u) {
      seterr(err, errcap, "bad palette");
      return 0;
    }
    subs[si].chr = chr;
    subs[si].pal = (uint8_t)palv;
    parse_flip_field(flipbuf, &subs[si].hflip, &subs[si].vflip, &subs[si].priority);
  }
  return 1;
}

int map16_text_parse_line(const char *line, uint16_t expected_id, Map16TextTile *out, char *err, size_t errcap) {
  if (!line || !out) {
    seterr(err, errcap, "invalid args");
    return 0;
  }
  memset(out, 0, sizeof(*out));
  while (*line && isspace((unsigned char)*line)) line++;
  if (!line[0]) return 0;

  const char *colon = strchr(line, ':');
  if (!colon) {
    seterr(err, errcap, "missing colon");
    return 0;
  }
  char idbuf[8];
  size_t idlen = (size_t)(colon - line);
  if (idlen == 0 || idlen >= sizeof(idbuf)) return 0;
  memcpy(idbuf, line, idlen);
  idbuf[idlen] = '\0';
  uint16_t tid = 0;
  if (!parse_hex_u16(idbuf, &tid)) {
    seterr(err, errcap, "bad tile id");
    return 0;
  }
  if (expected_id != 0xFFFFu && tid != expected_id) {
    seterr(err, errcap, "tile id mismatch");
    return 0;
  }
  out->tile_id = tid;

  const char *body = colon + 1;
  while (*body && isspace((unsigned char)*body)) body++;
  if (*body == '~') {
    map16_text_empty_tile(out, tid, 1);
    return MAP16_TEXT_FMT_EMPTY;
  }

  const char *brace = strchr(body, '{');
  if (!brace) {
    /* acts-like only: TTTT: AAAA */
    char actbuf[8];
    size_t alen = 0;
    while (body[alen] && !isspace((unsigned char)body[alen]) && alen + 1 < sizeof(actbuf)) {
      actbuf[alen] = body[alen];
      alen++;
    }
    actbuf[alen] = '\0';
    if (!parse_hex_u16(actbuf, &out->acts_like)) {
      seterr(err, errcap, "bad acts-like");
      return 0;
    }
    out->format = MAP16_TEXT_FMT_FG_ACTS_ONLY;
    out->has_acts_like = 1;
    return MAP16_TEXT_FMT_FG_ACTS_ONLY;
  }

  char actbuf[8];
  size_t alen = 0;
  while (body + alen < brace && !isspace((unsigned char)body[alen]) && alen + 1 < sizeof(actbuf)) {
    actbuf[alen] = body[alen];
    alen++;
  }
  actbuf[alen] = '\0';
  const char *end = strchr(brace, '}');
  if (!end) {
    seterr(err, errcap, "missing closing brace");
    return 0;
  }
  if (!parse_four_subs(brace, end, out->subs, err, errcap)) return 0;
  map16_text_sub_to_map16_tile(out->subs, &out->words);

  if (alen > 0) {
    if (!parse_hex_u16(actbuf, &out->acts_like)) {
      seterr(err, errcap, "bad acts-like");
      return 0;
    }
    out->has_acts_like = 1;
    out->format = MAP16_TEXT_FMT_FG_FULL;
    return MAP16_TEXT_FMT_FG_FULL;
  }

  out->format = MAP16_TEXT_FMT_TILES_ONLY;
  return MAP16_TEXT_FMT_TILES_ONLY;
}

int map16_text_load_header(const char *path, Map16TextHeader *out, char *err, size_t errcap) {
  if (!path || !out) {
    seterr(err, errcap, "invalid args");
    return 0;
  }
  memset(out, 0, sizeof(*out));
  FILE *fp = fopen(path, "r");
  if (!fp) {
    seterr(err, errcap, "could not open header.txt");
    return 0;
  }
  unsigned int full = 0, page2 = 0;
  if (fscanf(fp,
             "file_format_version_number: %X\n"
             "game_id: %X\n"
             "program_version: %X\n"
             "program_id: %X\n"
             "size_x: %X\n"
             "size_y: %X\n"
             "base_x: %X\n"
             "base_y: %X\n"
             "is_full_game_export: %X\n"
             "has_tileset_specific_page_2: %X\n",
             &out->file_format_version_number, &out->game_id, &out->program_version, &out->program_id, &out->size_x,
             &out->size_y, &out->base_x, &out->base_y, &full, &page2) != 10) {
    fclose(fp);
    seterr(err, errcap, "header.txt parse failed");
    return 0;
  }
  out->is_full_game_export = (int)full;
  out->has_tileset_specific_page_2 = (int)page2;

  char line[512];
  while (fgets(line, sizeof(line), fp)) {
    const char *prefix = "comment_field: \"";
    const char *p = strstr(line, prefix);
    if (!p) continue;
    p += strlen(prefix);
    const char *endq = strrchr(p, '"');
    if (!endq || endq <= p) continue;
    size_t n = (size_t)(endq - p);
    if (n >= sizeof(out->comment)) n = sizeof(out->comment) - 1;
    memcpy(out->comment, p, n);
    out->comment[n] = '\0';
    break;
  }
  fclose(fp);
  return 1;
}
