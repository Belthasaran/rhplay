#pragma once

#include <stddef.h>
#include <stdint.h>

#include "map16_reader.h"

/* Callisto human-readable Map16 text format (see refmaterial/callisto/human_map16). */

enum {
  MAP16_TEXT_FMT_NONE = 0,
  MAP16_TEXT_FMT_FG_FULL,
  MAP16_TEXT_FMT_FG_ACTS_ONLY,
  MAP16_TEXT_FMT_TILES_ONLY,
  MAP16_TEXT_FMT_EMPTY,
};

enum {
  MAP16_TEXT_LM_EMPTY_WORD = 0x1004u,
  MAP16_TEXT_LM_EMPTY_ACTS = 0x0130u,
};

typedef struct {
  uint16_t chr;
  uint8_t pal;
  int hflip;
  int vflip;
  int priority;
} Map16TextSub;

typedef struct {
  uint16_t tile_id;
  uint16_t acts_like;
  int format;
  int has_acts_like;
  int is_empty;
  Map16TextSub subs[4];
  Map16Tile words;
} Map16TextTile;

typedef struct {
  uint32_t file_format_version_number;
  uint32_t game_id;
  uint32_t program_version;
  uint32_t program_id;
  uint32_t size_x;
  uint32_t size_y;
  uint32_t base_x;
  uint32_t base_y;
  int is_full_game_export;
  int has_tileset_specific_page_2;
  char comment[256];
} Map16TextHeader;

uint16_t map16_text_encode_sub_word(uint16_t chr, uint8_t pal, int hflip, int vflip, int priority);
void map16_text_decode_sub_word(uint16_t w, Map16TextSub *out);

void map16_text_sub_to_map16_tile(const Map16TextSub subs[4], Map16Tile *out);
int map16_text_tile_words_equal(const Map16Tile *a, const Map16Tile *b);

int map16_text_is_tileset_group_specific(uint16_t tile_id);
int map16_text_normal_pipe_index(uint16_t tile_id, int *pipe_set_out, int *index_in_set_out);
int map16_text_diagonal_pipe_index(uint16_t tile_id, int *index_out);
int map16_text_tileset_group_slot_index(uint16_t tile_id, size_t *out_index);

void map16_text_empty_tile(Map16TextTile *out, uint16_t tile_id, int fg_with_acts);

/* Parse one non-blank line. Returns format enum or 0 on skip/blank. */
int map16_text_parse_line(const char *line, uint16_t expected_id, Map16TextTile *out, char *err, size_t errcap);

int map16_text_load_header(const char *path, Map16TextHeader *out, char *err, size_t errcap);
