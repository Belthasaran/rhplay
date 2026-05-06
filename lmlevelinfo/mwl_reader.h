#pragma once

#include <stdint.h>
#include <stddef.h>

typedef struct {
  uint32_t off;
  uint32_t size;
} MwlPtr;

typedef struct {
  uint16_t lm_version;       // raw from header (unknown meaning beyond LM)
  uint32_t ptr_list_off;
  uint32_t ptr_list_size;
  uint8_t flags[4];
  char banner[49];           // 48 bytes + NUL
  MwlPtr ptrs[8];            // 8 pointers
} MwlFileInfo;

typedef struct {
  uint16_t level_id;
  // Secondary header bytes as available in MWL Level Information.
  // We guarantee b1..b4 exist if the file is well-formed.
  uint8_t sec_b1;
  uint8_t sec_b2;
  uint8_t sec_b3;
  uint8_t sec_b4;
  // Optional/extra bytes. present_* indicates whether value is available.
  int present_sec_b5;
  uint8_t sec_b5;
  int present_sec_b6;
  uint8_t sec_b6;
  int present_sec_b7;
  uint8_t sec_b7;
  int present_sec_b8;
  uint8_t sec_b8;

  // Midway table bytes as stored in MWL "Level information" section (4 bytes).
  // These correspond to the per-level midway entrance table bytes.
  int present_midway;
  uint8_t midway_b1;
  uint8_t midway_b2;
  uint8_t midway_b3;
  uint8_t midway_b4;
} MwlLevelInfo;

typedef struct {
  // Raw Layer 1 bytes: primary header + object stream (including 0xFF terminator and any trailing bytes in section)
  uint8_t *bytes;
  size_t len;
} MwlLayer1;

typedef struct {
  // Raw sprite bytes for the level (section payload).
  uint8_t *bytes;
  size_t len;
} MwlSprites;

typedef struct {
  // Raw Layer 2 bytes (section payload) plus the 8-byte section header.
  // If the section is missing, `present` is 0 and buffers are NULL/0.
  int present;
  uint8_t header[8];
  uint8_t *bytes;
  size_t len;
} MwlLayer2;

typedef struct {
  MwlFileInfo file;
  MwlLevelInfo level;
  MwlLayer1 layer1;
  MwlLayer2 layer2;
  MwlSprites sprites;
} MwlParsed;

void mwl_parsed_free(MwlParsed *p);

// Parse an MWL file from disk (mallocs buffers in MwlParsed).
// Returns 1 on success, 0 on failure (err filled).
int mwl_parse_file(const char *path, MwlParsed *out, char *err, size_t errcap);

