#include "map16_lm16.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

enum {
  MAP16_LM16_OFFSET_TABLE_SIZE = 0x40u,
  MAP16_LM16_COMMENT_FIELD_OFFSET = 0x40u,
};

static void seterr(char *err, size_t errcap, const char *msg) {
  if (!err || errcap == 0) return;
  snprintf(err, errcap, "%s", msg ? msg : "error");
}

static uint32_t read_u32le(const uint8_t *p) {
  return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}

static uint16_t read_u16le(const uint8_t *p) {
  return (uint16_t)p[0] | (uint16_t)((uint16_t)p[1] << 8);
}

static int read_tile_words(const uint8_t *p, Map16Tile *out) {
  if (!p || !out) return 0;
  for (int si = 0; si < 4; si++) {
    out->w[si] = read_u16le(p + si * 2);
  }
  return 1;
}

void map16_lm16_free(Map16Lm16 *m) {
  if (!m) return;
  free(m->data);
  memset(m, 0, sizeof(*m));
}

int map16_lm16_load(const char *path, Map16Lm16 *out, char *err, size_t errcap) {
  if (!path || !out) {
    seterr(err, errcap, "invalid args");
    return 0;
  }
  memset(out, 0, sizeof(*out));

  FILE *fp = fopen(path, "rb");
  if (!fp) {
    seterr(err, errcap, "could not open AllMap16.map16");
    return 0;
  }
  if (fseek(fp, 0, SEEK_END) != 0) {
    fclose(fp);
    seterr(err, errcap, "seek failed");
    return 0;
  }
  long fsize = ftell(fp);
  if (fsize < 0) {
    fclose(fp);
    seterr(err, errcap, "size query failed");
    return 0;
  }
  if (fseek(fp, 0, SEEK_SET) != 0) {
    fclose(fp);
    seterr(err, errcap, "rewind failed");
    return 0;
  }
  out->data = (uint8_t *)malloc((size_t)fsize);
  if (!out->data) {
    fclose(fp);
    seterr(err, errcap, "alloc failed");
    return 0;
  }
  if (fread(out->data, 1, (size_t)fsize, fp) != (size_t)fsize) {
    fclose(fp);
    map16_lm16_free(out);
    seterr(err, errcap, "read failed");
    return 0;
  }
  fclose(fp);
  out->data_len = (size_t)fsize;

  if (out->data_len < 0x80u || memcmp(out->data, "LM16", 4) != 0) {
    map16_lm16_free(out);
    seterr(err, errcap, "not LM16");
    return 0;
  }

  out->header.file_format_version_number = read_u16le(out->data + 4);
  out->header.game_id = read_u16le(out->data + 6);
  out->header.program_version = read_u16le(out->data + 8);
  out->header.program_id = read_u16le(out->data + 10);
  uint32_t off_tbl_off = read_u32le(out->data + 16);
  uint32_t off_tbl_size = read_u32le(out->data + 20);
  out->header.size_x = read_u32le(out->data + 24);
  out->header.size_y = read_u32le(out->data + 28);
  out->header.base_x = read_u32le(out->data + 32);
  out->header.base_y = read_u32le(out->data + 36);
  uint32_t flags = read_u32le(out->data + 40);
  out->header.has_tileset_specific_page_2 = (int)(flags & 1u);
  out->header.is_full_game_export = (int)((flags >> 1) & 1u);

  if (off_tbl_off >= out->data_len || off_tbl_size < 16u || off_tbl_off + off_tbl_size > out->data_len) {
    map16_lm16_free(out);
    seterr(err, errcap, "bad offset table");
    return 0;
  }

  size_t comment_len = 0;
  if (off_tbl_off > MAP16_LM16_COMMENT_FIELD_OFFSET) {
    comment_len = (size_t)(off_tbl_off - MAP16_LM16_COMMENT_FIELD_OFFSET);
    if (MAP16_LM16_COMMENT_FIELD_OFFSET + comment_len <= out->data_len) {
      size_t n = comment_len;
      if (n >= sizeof(out->header.comment)) n = sizeof(out->header.comment) - 1;
      memcpy(out->header.comment, out->data + MAP16_LM16_COMMENT_FIELD_OFFSET, n);
      out->header.comment[n] = '\0';
    }
  }

  size_t npairs = (size_t)(off_tbl_size / 8u);
  if (npairs < 8u) {
    map16_lm16_free(out);
    seterr(err, errcap, "offset table too small");
    return 0;
  }
  uint32_t pairs[8][2];
  for (size_t i = 0; i < 8u; i++) {
    pairs[i][0] = read_u32le(out->data + off_tbl_off + i * 8u);
    pairs[i][1] = read_u32le(out->data + off_tbl_off + i * 8u + 4u);
  }
  out->fg_off = pairs[2][0];
  out->fg_size = pairs[2][1];
  out->bg_off = pairs[3][0];
  out->bg_size = pairs[3][1];
  out->acts_off = pairs[1][0];
  out->acts_size = pairs[1][1];
  out->tileset_group_off = pairs[5][0];
  out->tileset_group_size = pairs[5][1];
  out->normal_pipe_off = pairs[6][0];
  out->normal_pipe_size = pairs[6][1];
  out->diagonal_pipe_off = pairs[7][0];
  out->diagonal_pipe_size = pairs[7][1];
  return 1;
}

int map16_lm16_header_matches_text(const Map16Lm16 *m, const Map16TextHeader *text_hdr, char *err, size_t errcap) {
  if (!m || !text_hdr) {
    seterr(err, errcap, "invalid args");
    return 0;
  }
  const Map16TextHeader *b = &m->header;
  if (b->file_format_version_number != text_hdr->file_format_version_number ||
      b->game_id != text_hdr->game_id || b->program_version != text_hdr->program_version ||
      b->program_id != text_hdr->program_id || b->size_x != text_hdr->size_x || b->size_y != text_hdr->size_y ||
      b->base_x != text_hdr->base_x || b->base_y != text_hdr->base_y ||
      b->is_full_game_export != text_hdr->is_full_game_export ||
      b->has_tileset_specific_page_2 != text_hdr->has_tileset_specific_page_2) {
    seterr(err, errcap, "header field mismatch");
    return 0;
  }
  if (text_hdr->comment[0] && b->comment[0] && strcmp(b->comment, text_hdr->comment) != 0) {
    seterr(err, errcap, "comment mismatch");
    return 0;
  }
  return 1;
}

int map16_lm16_fg_tile(const Map16Lm16 *m, uint16_t tile_id, Map16Tile *out) {
  if (!m || !out || !m->data) return 0;
  size_t off = m->fg_off + (size_t)tile_id * MAP16_LM16_TILE_BYTES;
  if (off + MAP16_LM16_TILE_BYTES > m->data_len) return 0;
  return read_tile_words(m->data + off, out);
}

int map16_lm16_fg_text_tile(const Map16Lm16 *m, uint16_t tile_id, Map16Tile *out) {
  if (!m || !out || !m->data) return 0;
  if (tile_id >= 0x0200u) {
    return map16_lm16_fg_tile(m, tile_id, out);
  }
  if (map16_text_is_tileset_group_specific(tile_id)) {
    memset(out, 0, sizeof(*out));
    return 1;
  }
  size_t off = m->tileset_group_off + (size_t)MAP16_LM16_PAGE_SIZE * MAP16_LM16_TILE_BYTES * 2u + (size_t)tile_id * MAP16_LM16_TILE_BYTES;
  if (off + MAP16_LM16_TILE_BYTES > m->data_len) return 0;
  return read_tile_words(m->data + off, out);
}

int map16_lm16_bg_tile(const Map16Lm16 *m, uint16_t tile_id, Map16Tile *out) {
  if (!m || !out || !m->data) return 0;
  size_t bg_id = (size_t)tile_id - 0x8000u;
  size_t off = m->bg_off + bg_id * MAP16_LM16_TILE_BYTES;
  if (off + MAP16_LM16_TILE_BYTES > m->data_len) return 0;
  return read_tile_words(m->data + off, out);
}

int map16_lm16_acts_like(const Map16Lm16 *m, uint16_t tile_id, uint16_t *out) {
  if (!m || !out || !m->data) return 0;
  size_t off = m->acts_off + (size_t)tile_id * MAP16_LM16_ACTS_BYTES;
  if (off + MAP16_LM16_ACTS_BYTES > m->data_len) return 0;
  *out = read_u16le(m->data + off);
  return 1;
}

int map16_lm16_tileset_group_tile(const Map16Lm16 *m, unsigned group, uint16_t tile_id, Map16Tile *out) {
  if (!m || !out || !m->data || group > 4u) return 0;
  if (!map16_text_is_tileset_group_specific(tile_id)) return 0;
  size_t off = m->tileset_group_off + (size_t)MAP16_LM16_PAGE_SIZE * MAP16_LM16_TILE_BYTES * 2u * (size_t)group +
               (size_t)tile_id * MAP16_LM16_TILE_BYTES;
  if (off + MAP16_LM16_TILE_BYTES > m->data_len) return 0;
  return read_tile_words(m->data + off, out);
}

int map16_lm16_normal_pipe_tile(const Map16Lm16 *m, unsigned pipe_set, unsigned index_in_set, Map16Tile *out) {
  if (!m || !out || !m->data || pipe_set > 3u || index_in_set > 7u) return 0;
  size_t off = m->normal_pipe_off + ((size_t)pipe_set * 8u + (size_t)index_in_set) * MAP16_LM16_TILE_BYTES;
  if (off + MAP16_LM16_TILE_BYTES > m->data_len) return 0;
  return read_tile_words(m->data + off, out);
}

int map16_lm16_diagonal_pipe_tile(const Map16Lm16 *m, unsigned index, Map16Tile *out) {
  if (!m || !out || !m->data || index > 7u) return 0;
  size_t off = m->diagonal_pipe_off + (size_t)index * MAP16_LM16_TILE_BYTES;
  if (off + MAP16_LM16_TILE_BYTES > m->data_len) return 0;
  return read_tile_words(m->data + off, out);
}
