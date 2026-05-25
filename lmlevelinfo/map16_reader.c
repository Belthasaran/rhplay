#include "map16_reader.h"
#include "map16_rom.h"

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

static int map16_tile_zero_sub_count(const Map16Tile *t) {
  int z = 0;
  for (int i = 0; i < 4; i++) {
    if (((uint16_t)(t->w[i] & 0x03FFu)) == 0) z++;
  }
  return z;
}

int map16_tile_needs_resolve(const Map16Tile *t) {
  if (!t || map16_tile_is_empty(t)) return 1;
  if (map16_tile_zero_sub_count(t) >= 2) return 1;
  if (t->w[0] != t->w[1] || t->w[0] != t->w[2] || t->w[0] != t->w[3]) return 0;
  uint16_t tile8 = (uint16_t)(t->w[0] & 0x03FFu);
  if (tile8 == 0) return 1;
  if (tile8 == 0x1004u) return 1;
  return 0;
}

static void map16_synthesize_from_tile_id(uint16_t tile_id, Map16Tile *out) {
  if (!out) return;
  uint8_t page = (uint8_t)((tile_id >> 8) & 0x01);
  uint8_t low = (uint8_t)(tile_id & 0xFF);
  memset(out, 0, sizeof(*out));
  if (low == 0) return;
  uint16_t w = (uint16_t)low;
  if (page) w = (uint16_t)(w | 0x0080u);
  out->w[0] = w;
  out->w[1] = w;
  out->w[2] = w;
  out->w[3] = w;
}

static int subtile_matches_page_low(uint16_t w, uint8_t page, uint8_t low) {
  uint16_t tile8 = (uint16_t)(w & 0x03FFu);
  uint8_t wpage = (uint8_t)((tile8 >> 7) & 1u);
  uint8_t wlow = (uint8_t)(tile8 & 0x7Fu);
  if (page == 0) {
    return wlow == low;
  }
  return wpage == (page & 1u) && wlow == low;
}

static int block_alias_exact_hits(const Map16Tile *t, uint8_t page, uint8_t low) {
  if (!t || low == 0) return 0;
  int exact = 0;
  for (int i = 0; i < 4; i++) {
    uint16_t tile8 = (uint16_t)(t->w[i] & 0x03FFu);
    uint8_t wlow = (uint8_t)(tile8 & 0x7Fu);
    if (page == 0) {
      if (wlow == low) exact++;
    } else if (subtile_matches_page_low(t->w[i], page, low)) {
      exact++;
    }
  }
  return exact;
}

static int block_alias_score(const Map16Tile *t, uint8_t page, uint8_t low, uint16_t *out_max_w) {
  if (!t || low == 0) {
    if (out_max_w) *out_max_w = 0;
    return 0;
  }

  int score = 0;
  uint16_t max_w = 0;
  for (int i = 0; i < 4; i++) {
    uint16_t w = t->w[i];
    if (w > max_w) max_w = w;
    uint16_t tile8 = (uint16_t)(w & 0x03FFu);
    uint8_t wlow = (uint8_t)(tile8 & 0x7Fu);
    if (page == 0) {
      if (wlow == low)
        score += 4;
      else if (wlow + 1u == low)
        score += 2;
      else if (wlow == low + 1u)
        score += 1;
    } else if (subtile_matches_page_low(w, page, low)) {
      score += 4;
    }
  }
  if (out_max_w) *out_max_w = max_w;
  return score;
}

static int block_alias_better(int score, uint16_t max_w, size_t idx, int best_score, uint16_t best_max_w,
                              size_t best_idx) {
  if (score > best_score) return 1;
  if (score < best_score) return 0;
  if (max_w < best_max_w) return 1;
  if (max_w > best_max_w) return 0;
  return idx < best_idx;
}

static int map16_tile_uniform_tile8(const Map16Tile *t, uint16_t *out_tile8) {
  if (!t) return 0;
  uint16_t t0 = (uint16_t)(t->w[0] & 0x03FFu);
  for (int i = 1; i < 4; i++) {
    if ((uint16_t)(t->w[i] & 0x03FFu) != t0) return 0;
  }
  if (out_tile8) *out_tile8 = t0;
  return 1;
}

static int map16_distinct_tile8_count(const Map16Tile *t) {
  if (!t) return 0;
  uint16_t vals[4];
  int n = 0;
  for (int i = 0; i < 4; i++) {
    uint16_t v = (uint16_t)(t->w[i] & 0x03FFu);
    if (v == 0) continue;
    int found = 0;
    for (int j = 0; j < n; j++) {
      if (vals[j] == v) {
        found = 1;
        break;
      }
    }
    if (!found) vals[n++] = v;
  }
  return n;
}

static int map16_alias_cand_ok(const Map16Tile *slot, const Map16Tile *cand) {
  if (!slot || !cand) return 0;
  uint16_t slot_uni = 0, cand_uni = 0;
  int slot_uniform = map16_tile_uniform_tile8(slot, &slot_uni);
  int cand_uniform = map16_tile_uniform_tile8(cand, &cand_uni);
  if (cand_uniform && !slot_uniform) return 0;
  if (cand_uniform && slot_uniform && cand_uni != slot_uni) return 0;
  int raw_distinct = map16_distinct_tile8_count(slot);
  int cand_distinct = map16_distinct_tile8_count(cand);
  if (raw_distinct >= 2 && cand_distinct < 2) return 0;
  return 1;
}

static int map16_build_alias_table(Map16Data *m) {
  if (!m || !m->tiles || m->tiles_count == 0) return 0;

  size_t n = m->tiles_count;
  m->alias_index = (size_t *)malloc(n * sizeof(size_t));
  if (!m->alias_index) return 0;
  for (size_t i = 0; i < n; i++) m->alias_index[i] = SIZE_MAX;

  size_t filled = 0;
  for (size_t tid = 0; tid < n; tid++) {
    const Map16Tile *slot = &m->tiles[tid];
    if (!map16_tile_needs_resolve(slot)) continue;

    uint8_t page = (uint8_t)((tid >> 8) & 0xFF);
    uint8_t low = (uint8_t)(tid & 0xFF);
    if (low == 0) continue;

    int best_score = 0;
    uint16_t best_max_w = 0xFFFFu;
    size_t best_idx = 0;
    int have_best = 0;

    for (size_t j = 0; j < n; j++) {
      if (j == tid) continue;
      const Map16Tile *cand = &m->tiles[j];
      if (map16_tile_needs_resolve(cand)) continue;
      uint16_t max_w = 0;
      int score = block_alias_score(cand, page, low, &max_w);
      if (score < 4) continue;
      /* Page-0 exact-low match avoids false positives (e.g. 0x0002 -> filler 0x1004).
       * Empty/degenerate/page>=1 slots may alias via near-match scoring only (e.g. 0x013D checker). */
      if (page == 0 && !map16_tile_is_empty(slot) && map16_tile_zero_sub_count(slot) < 2 &&
          block_alias_exact_hits(cand, page, low) < 1)
        continue;
      if (!map16_alias_cand_ok(slot, cand)) continue;
      if (!have_best || block_alias_better(score, max_w, j, best_score, best_max_w, best_idx)) {
        best_score = score;
        best_max_w = max_w;
        best_idx = j;
        have_best = 1;
      }
    }

    if (have_best && best_score >= 4 && !map16_tile_needs_resolve(&m->tiles[best_idx])) {
      m->alias_index[tid] = best_idx;
      filled++;
    }
  }

  m->alias_table_count = filled;
  return 1;
}

void map16_free(Map16Data *m) {
  if (!m) return;
  free(m->tiles);
  free(m->alias_index);
  m->tiles = NULL;
  m->alias_index = NULL;
  m->tiles_count = 0;
  m->is_lm16 = 0;
  m->synth_vanilla = 0;
  m->synth_count = 0;
  m->alias_hit_count = 0;
  m->rom_hit_count = 0;
  m->rom_vanilla_hit_count = 0;
  m->alias_table_count = 0;
  m->rom = NULL;
}

void map16_set_synth_vanilla(Map16Data *m, int enable) {
  if (!m) return;
  m->synth_vanilla = enable ? 1 : 0;
}

void map16_attach_rom(Map16Data *m, Rom *rom) {
  if (!m) return;
  m->rom = rom;
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

  size_t data_off = out->is_lm16 ? 8u : 0u;
  if (sz <= data_off) {
    fclose(fp);
    seterr(err, errcap, "Empty map16 file");
    return 0;
  }
  size_t data_sz = sz - data_off;
  if ((data_sz % 8u) != 0) {
    fclose(fp);
    seterr(err, errcap, "AllMap16.map16 size not multiple of 8");
    return 0;
  }

  if (data_off != 0 && fseek(fp, (long)data_off, SEEK_SET) != 0) {
    fclose(fp);
    seterr(err, errcap, "Could not seek map16 file");
    return 0;
  }

  size_t tilesN = data_sz / 8u;
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
  if (!map16_build_alias_table(out)) {
    map16_free(out);
    seterr(err, errcap, "Out of memory building map16 alias table");
    return 0;
  }
  return 1;
}

int map16_get_raw(const Map16Data *m, uint16_t tile_id, Map16Tile *out) {
  if (!m || !out || !m->tiles) return 0;
  if ((size_t)tile_id >= m->tiles_count) return 0;
  *out = m->tiles[tile_id];
  return 1;
}

int map16_get_with_src(Map16Data *m, uint16_t tile_id, Map16Tile *out, int *src_out) {
  if (!m || !out) return 0;
  if (src_out) *src_out = MAP16_SRC_FILE;

  Map16Tile raw;
  int have_raw = map16_get_raw(m, tile_id, &raw);
  if (have_raw && !map16_tile_needs_resolve(&raw)) {
    *out = raw;
    return 1;
  }

  if (m->rom && have_raw && !map16_tile_is_empty(&raw)) {
    Map16Tile rom_tile;
    uint8_t page = (uint8_t)((tile_id >> 8) & 0xFF);
    /* Partial/degenerate export slots (e.g. 0x0002): prefer ROM vanilla shape.
     * Fully empty slots (e.g. 0x0021) keep alias — hack ROM pointer tables often differ from AllMap16. */
    if (page <= 1 && map16_tile_needs_resolve(&raw) &&
        map16_rom_get_vanilla_tile(m->rom, tile_id, &rom_tile)) {
      *out = rom_tile;
      m->rom_vanilla_hit_count++;
      if (src_out) *src_out = MAP16_SRC_ROM_VANILLA;
      return 1;
    }
  }

  if (m->alias_index && (size_t)tile_id < m->tiles_count) {
    size_t alias_idx = m->alias_index[tile_id];
    if (alias_idx != SIZE_MAX && alias_idx < m->tiles_count) {
      const Map16Tile *at = &m->tiles[alias_idx];
      if (!map16_tile_needs_resolve(at)) {
        *out = *at;
        m->alias_hit_count++;
        if (src_out) *src_out = MAP16_SRC_ALIAS;
        return 1;
      }
    }
  }

  if (m->rom) {
    Map16Tile rom_tile;
    if (map16_rom_get_tile(m->rom, tile_id, &rom_tile)) {
      *out = rom_tile;
      m->rom_hit_count++;
      if (src_out) *src_out = MAP16_SRC_ROM;
      return 1;
    }
  }

  if (!m->synth_vanilla) {
    if (have_raw) {
      *out = raw;
      return 1;
    }
    return 0;
  }

  map16_synthesize_from_tile_id(tile_id, out);
  if (!map16_tile_is_empty(out)) {
    m->synth_count++;
    if (src_out) *src_out = MAP16_SRC_SYNTH;
  }
  return 1;
}

int map16_get(Map16Data *m, uint16_t tile_id, Map16Tile *out) {
  return map16_get_with_src(m, tile_id, out, NULL);
}

void map16_print_alias_debug(const Map16Data *m, int top_n) {
  if (!m || !m->alias_index || top_n <= 0) return;
  fprintf(stderr, "map16 alias table: %zu entries\n", m->alias_table_count);
  int printed = 0;
  for (size_t tid = 0; tid < m->tiles_count && printed < top_n; tid++) {
    size_t alias_idx = m->alias_index[tid];
    if (alias_idx == SIZE_MAX) continue;
    fprintf(stderr, "  tile_id=0x%04X -> alias_index=0x%zX\n", (unsigned)tid, alias_idx);
    printed++;
  }
}
