#include "map16_reader.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static void seterr(char *err, size_t errcap, const char *msg) {
  if (!err || errcap == 0) return;
  snprintf(err, errcap, "%s", msg ? msg : "error");
}

static uint16_t read_u16le(const uint8_t *p) {
  return (uint16_t)p[0] | (uint16_t)((uint16_t)p[1] << 8);
}

static int file_starts_with_lm16(FILE *fp) {
  uint8_t sig[4];
  if (fread(sig, 1, 4, fp) != 4) return 0;
  if (fseek(fp, 0, SEEK_SET) != 0) return 0;
  return sig[0] == 'L' && sig[1] == 'M' && sig[2] == '1' && sig[3] == '6';
}

int map16_tile_is_empty(const Map16Tile *t) {
  if (!t) return 1;
  return t->w[0] == 0 && t->w[1] == 0 && t->w[2] == 0 && t->w[3] == 0;
}

static int map16_tile_needs_synth(const Map16Tile *t) {
  if (!t || map16_tile_is_empty(t)) return 1;
  if (t->w[0] != t->w[1] || t->w[0] != t->w[2] || t->w[0] != t->w[3]) return 0;
  uint16_t tile8 = (uint16_t)(t->w[0] & 0x03FFu);
  if (tile8 == 0) return 1;
  // LM export filler words seen in empty vanilla slots (e.g. index 0x221).
  if (tile8 == 0x1004u) return 1;
  return 0;
}

static void map16_synthesize_from_tile_id(uint16_t tile_id, Map16Tile *out) {
  if (!out) return;
  uint8_t low = (uint8_t)(tile_id & 0xFF);
  memset(out, 0, sizeof(*out));
  if (low == 0) return;
  // Empty AllMap16 export slots: use page-0 CHR indexed by low byte (vanilla/LM fallback).
  uint16_t w = (uint16_t)low;
  out->w[0] = w;
  out->w[1] = w;
  out->w[2] = w;
  out->w[3] = w;
}

void map16_free(Map16Data *m) {
  if (!m) return;
  free(m->tiles);
  m->tiles = NULL;
  m->tiles_count = 0;
  m->is_lm16 = 0;
  m->synth_vanilla = 0;
  m->synth_count = 0;
}

void map16_set_synth_vanilla(Map16Data *m, int enable) {
  if (!m) return;
  m->synth_vanilla = enable ? 1 : 0;
}

int map16_load_file(const char *path, Map16Data *out, char *err, size_t errcap) {
  if (!path || !out) {
    seterr(err, errcap, "map16_load_file: invalid args");
    return 0;
  }
  memset(out, 0, sizeof(*out));

  FILE *fp = fopen(path, "rb");
  if (!fp) {
    seterr(err, errcap, "Could not open map16 file");
    return 0;
  }
  out->is_lm16 = file_starts_with_lm16(fp);
  out->synth_vanilla = 1;

  if (fseek(fp, 0, SEEK_END) != 0) {
    fclose(fp);
    seterr(err, errcap, "Could not seek map16 file");
    return 0;
  }
  long szl = ftell(fp);
  if (szl < 0) {
    fclose(fp);
    seterr(err, errcap, "Could not stat map16 file");
    return 0;
  }
  size_t sz = (size_t)szl;
  if (fseek(fp, 0, SEEK_SET) != 0) {
    fclose(fp);
    seterr(err, errcap, "Could not seek map16 file");
    return 0;
  }
  if (sz == 0) {
    fclose(fp);
    seterr(err, errcap, "Empty map16 file");
    return 0;
  }
  if ((sz % 8u) != 0) {
    fclose(fp);
    seterr(err, errcap, "AllMap16.map16 size not multiple of 8");
    return 0;
  }

  size_t tilesN = sz / 8u;
  Map16Tile *tiles = (Map16Tile *)calloc(tilesN ? tilesN : 1, sizeof(Map16Tile));
  if (!tiles) {
    fclose(fp);
    seterr(err, errcap, "Out of memory loading map16");
    return 0;
  }

  uint8_t buf[8];
  for (size_t i = 0; i < tilesN; i++) {
    if (fread(buf, 1, 8, fp) != 8) {
      free(tiles);
      fclose(fp);
      seterr(err, errcap, "Truncated map16 file");
      return 0;
    }
    tiles[i].w[0] = read_u16le(buf + 0);
    tiles[i].w[1] = read_u16le(buf + 2);
    tiles[i].w[2] = read_u16le(buf + 4);
    tiles[i].w[3] = read_u16le(buf + 6);
  }

  fclose(fp);
  out->tiles = tiles;
  out->tiles_count = tilesN;
  return 1;
}

int map16_get_raw(const Map16Data *m, uint16_t tile_id, Map16Tile *out) {
  if (!m || !out || !m->tiles) return 0;
  if ((size_t)tile_id >= m->tiles_count) return 0;
  *out = m->tiles[tile_id];
  return 1;
}

int map16_get(Map16Data *m, uint16_t tile_id, Map16Tile *out) {
  if (!map16_get_raw(m, tile_id, out)) return 0;
  if (!m->synth_vanilla || !map16_tile_needs_synth(out)) return 1;
  map16_synthesize_from_tile_id(tile_id, out);
  if (!map16_tile_is_empty(out)) m->synth_count++;
  return 1;
}
