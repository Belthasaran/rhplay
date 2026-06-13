#pragma once

#include <stddef.h>
#include <stdint.h>

#include "map16_reader.h"
#include "map16_text.h"

enum {
  MAP16_LM16_PAGE_SIZE = 0x100u,
  MAP16_LM16_TILE_BYTES = 8,
  MAP16_LM16_ACTS_BYTES = 2,
};

typedef struct {
  uint8_t *data;
  size_t data_len;
  Map16TextHeader header;
  size_t fg_off;
  size_t fg_size;
  size_t bg_off;
  size_t bg_size;
  size_t acts_off;
  size_t acts_size;
  size_t tileset_group_off;
  size_t tileset_group_size;
  size_t normal_pipe_off;
  size_t normal_pipe_size;
  size_t diagonal_pipe_off;
  size_t diagonal_pipe_size;
} Map16Lm16;

void map16_lm16_free(Map16Lm16 *m);

int map16_lm16_load(const char *path, Map16Lm16 *out, char *err, size_t errcap);

int map16_lm16_header_matches_text(const Map16Lm16 *m, const Map16TextHeader *text_hdr, char *err, size_t errcap);

int map16_lm16_fg_tile(const Map16Lm16 *m, uint16_t tile_id, Map16Tile *out);
/* FG text export pages 0-1 use tileset_group blob; pages 2+ use global FG section. */
int map16_lm16_fg_text_tile(const Map16Lm16 *m, uint16_t tile_id, Map16Tile *out);
int map16_lm16_bg_tile(const Map16Lm16 *m, uint16_t tile_id, Map16Tile *out);
int map16_lm16_acts_like(const Map16Lm16 *m, uint16_t tile_id, uint16_t *out);

int map16_lm16_tileset_group_tile(const Map16Lm16 *m, unsigned group, uint16_t tile_id, Map16Tile *out);
int map16_lm16_normal_pipe_tile(const Map16Lm16 *m, unsigned pipe_set, unsigned index_in_set, Map16Tile *out);
int map16_lm16_diagonal_pipe_tile(const Map16Lm16 *m, unsigned index, Map16Tile *out);
