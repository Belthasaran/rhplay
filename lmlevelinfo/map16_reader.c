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

static int map16_distinct_tile8_count(const Map16Tile *t);
static int map16_tile_is_partial_hack_muncher_stub(const Map16Tile *t);
static int map16_build_canonical_table(Map16Data *m);
static int map16_build_alias_table(Map16Data *m);
int map16_get_acts_like(const Map16Data *m, uint16_t tile_id, uint16_t *out_acts_like);

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

static int map16_tile_is_uniform_filler(const Map16Tile *t) {
  if (!t) return 0;
  if (t->w[0] != t->w[1] || t->w[0] != t->w[2] || t->w[0] != t->w[3]) return 0;
  uint16_t tile8 = (uint16_t)(t->w[0] & 0x03FFu);
  if (tile8 == 0 || tile8 == 0x1004u) return 1;
  /* LM export placeholders: four identical 0x0F8 (or pal-variant) filler subs. */
  if (tile8 == 0x0F8u) return 1;
  return 0;
}

int map16_tile_needs_resolve(const Map16Tile *t) {
  if (!t || map16_tile_is_empty(t)) return 1;
  if (map16_tile_zero_sub_count(t) >= 2) return 1;
  if (map16_tile_is_uniform_filler(t)) return 1;
  if (t->w[0] != t->w[1] || t->w[0] != t->w[2] || t->w[0] != t->w[3]) return 0;
  uint16_t tile8 = (uint16_t)(t->w[0] & 0x03FFu);
  if (tile8 == 0) return 1;
  if (tile8 == 0x1004u) return 1;
  return 0;
}

static int map16_tile8s_equal(const Map16Tile *a, const Map16Tile *b) {
  if (!a || !b) return 0;
  for (int i = 0; i < 4; i++) {
    if ((a->w[i] & 0x03FFu) != (b->w[i] & 0x03FFu)) return 0;
  }
  return 1;
}

static int map16_tile_is_drawable(const Map16Tile *t) {
  if (!t || map16_tile_is_empty(t)) return 0;
  if (map16_tile_is_uniform_filler(t)) return 0;
  if (map16_tile_needs_resolve(t)) return 0;
  if (map16_distinct_tile8_count(t) < 2) return 0;
  return 1;
}

static int map16_tile_is_placement_stub(const Map16Data *m, uint16_t tile_id, const Map16Tile *placement) {
  if (!placement || map16_tile_is_empty(placement)) return 0;
  uint8_t page = (uint8_t)((tile_id >> 8) & 0xFF);
  /* Pages 0-1: alias / canonical / ROM vanilla — not LM placement→definition pool. */
  if (page < 2u) return 0;
  if (map16_tile_is_uniform_filler(placement)) return 1;
  if (map16_tile_is_partial_hack_muncher_stub(placement)) return 1;
  if (map16_tile_needs_resolve(placement)) return 1;
  if (m && m->tiles && (size_t)tile_id + 21u < m->tiles_count) {
    const Map16Tile *pool = &m->tiles[tile_id + 21u];
    if (map16_tile_is_drawable(pool) && !map16_tile8s_equal(placement, pool)) return 1;
  }
  return 0;
}

static void map16_merge_flip_from_placement(const Map16Tile *placement, const Map16Tile *visual, Map16Tile *out) {
  if (!out) return;
  *out = *visual;
  if (!placement) return;
  for (int si = 0; si < 4; si++) {
    out->w[si] = (uint16_t)((visual->w[si] & (uint16_t)~0x0C00u) | (placement->w[si] & 0x0C00u));
  }
}

/* LM16 definition pool at placement+21 carries authoritative CHR/pal; merge flips from placement stub. */
static void map16_copy_def_pool_visual(const Map16Tile *placement, const Map16Tile *visual, Map16Tile *out,
                                       int from_lm_pool_offset) {
  if (!out || !visual) return;
  if (!placement) {
    *out = *visual;
    return;
  }
  if (from_lm_pool_offset && !map16_tile_is_partial_hack_muncher_stub(placement) &&
      !map16_tile_is_uniform_filler(placement)) {
    *out = *visual;
    for (int si = 0; si < 4; si++) {
      uint16_t pt = (uint16_t)(placement->w[si] & 0x03FFu);
      uint16_t vt = (uint16_t)(visual->w[si] & 0x03FFu);
      if (pt != vt && pt != 0u && pt != 0x1004u) {
        out->w[si] = (uint16_t)((visual->w[si] & (uint16_t)~0x0C00u) | (placement->w[si] & 0x0C00u));
      }
    }
    return;
  }
  map16_merge_flip_from_placement(placement, visual, out);
}

static int map16_grow(Map16Data *m, size_t new_count) {
  if (!m || new_count <= m->tiles_count) return 1;
  Map16Tile *nt = (Map16Tile *)realloc(m->tiles, new_count * sizeof(Map16Tile));
  if (!nt) return 0;
  for (size_t i = m->tiles_count; i < new_count; i++) memset(&nt[i], 0, sizeof(Map16Tile));
  m->tiles = nt;

  uint16_t *na = (uint16_t *)realloc(m->acts_like, new_count * sizeof(uint16_t));
  if (!na) return 0;
  for (size_t i = m->acts_like_count; i < new_count; i++) na[i] = 0xFFFFu;
  m->acts_like = na;
  m->tiles_count = new_count;
  m->acts_like_count = new_count;
  return 1;
}

static void map16_rebuild_tables(Map16Data *m) {
  if (!m) return;
  free(m->alias_index);
  free(m->canonical_index);
  m->alias_index = NULL;
  m->canonical_index = NULL;
  m->alias_table_count = 0;
  m->canonical_table_count = 0;
  if (m->tiles && m->tiles_count > 0) {
    (void)map16_build_canonical_table(m);
    (void)map16_build_alias_table(m);
  }
}

static void map16_synthesize_from_tile_id(uint16_t tile_id, Map16Tile *out) {
  if (!out) return;
  uint8_t page = (uint8_t)((tile_id >> 8) & 3u);
  uint8_t low = (uint8_t)(tile_id & 0xFF);
  memset(out, 0, sizeof(*out));
  if (low == 0) return;
  uint16_t tile8 = (uint16_t)(low | ((uint16_t)(page & 3u) << 8));
  out->w[0] = tile8;
  out->w[1] = tile8;
  out->w[2] = tile8;
  out->w[3] = tile8;
}

static uint8_t map16_sub_gfx_page(uint16_t w) {
  return (uint8_t)(((uint16_t)(w & 0x03FFu)) >> 8) & 0x03u;
}

static int subtile_matches_page_low(uint16_t w, uint8_t page, uint8_t low) {
  uint16_t tile8 = (uint16_t)(w & 0x03FFu);
  if (tile8 == 0) return 0;
  if (map16_sub_gfx_page(w) != (page & 3u)) return 0;
  return (uint8_t)(tile8 & 0x7Fu) == low;
}

static int block_alias_exact_hits(const Map16Tile *t, uint8_t page, uint8_t low) {
  if (!t || low == 0) return 0;
  int exact = 0;
  for (int i = 0; i < 4; i++) {
    if (subtile_matches_page_low(t->w[i], page, low)) exact++;
  }
  return exact;
}

static int map16_sub_local_is_muncher_chr(uint8_t local) {
  if (local == 0) return 0;
  if (local >= 0x5Cu && local <= 0x5Fu) return 1;
  if (local >= 0x4Cu && local <= 0x4Fu) return 1;
  if (local == 0x78u || local == 0x7Cu) return 1;
  return 0;
}

static int map16_tile_is_partial_hack_muncher_stub(const Map16Tile *t) {
  if (!t) return 0;
  int stub = 0;
  int stripe = 0;
  for (int i = 0; i < 4; i++) {
    uint16_t tile8 = (uint16_t)(t->w[i] & 0x03FFu);
    if (tile8 == 0) continue;
    if (map16_sub_gfx_page(t->w[i]) != 0u) continue;
    uint8_t local = (uint8_t)(tile8 & 0x7Fu);
    if (local == 0x78u || local == 0x7Cu) stub++;
    if (local >= 0x4Cu && local <= 0x4Fu) stripe++;
  }
  return stub >= 2 && stripe >= 2;
}

static int map16_shape_ok_hack_muncher_block(const Map16Tile *t) {
  if (!t) return 0;
  if (map16_distinct_tile8_count(t) < 3) return 0;
  int munch = 0;
  int any = 0;
  for (int i = 0; i < 4; i++) {
    uint16_t tile8 = (uint16_t)(t->w[i] & 0x03FFu);
    if (tile8 == 0) continue;
    any = 1;
    if (map16_sub_local_is_muncher_chr((uint8_t)(tile8 & 0x7Fu))) munch++;
  }
  return any && munch >= 3;
}

static int map16_tile_has_full_muncher_quad_locals(const Map16Tile *t) {
  if (!t) return 0;
  uint8_t want_mask = 0;
  for (int i = 0; i < 4; i++) {
    uint16_t tile8 = (uint16_t)(t->w[i] & 0x03FFu);
    if (tile8 == 0) return 0;
    if (map16_sub_gfx_page(t->w[i]) != 0u) return 0;
    uint8_t local = (uint8_t)(tile8 & 0x7Fu);
    if (local == 0x5Cu) want_mask |= 1u;
    else if (local == 0x5Du) want_mask |= 2u;
    else if (local == 0x5Eu) want_mask |= 4u;
    else if (local == 0x5Fu) want_mask |= 8u;
  }
  return want_mask == 0x0Fu;
}

static int block_alias_score(const Map16Tile *t, uint8_t page, uint8_t low, uint16_t *out_max_w) {
  if (!t || low == 0) {
    if (out_max_w) *out_max_w = 0;
    return 0;
  }

  if (page >= 2u && (low == 0xBDu || low == 0xBEu) && map16_shape_ok_hack_muncher_block(t)) {
    if (out_max_w) {
      uint16_t max_w = 0;
      for (int i = 0; i < 4; i++) {
        if (t->w[i] > max_w) max_w = t->w[i];
      }
      *out_max_w = max_w;
    }
    return 8;
  }

  int score = 0;
  uint16_t max_w = 0;
  for (int i = 0; i < 4; i++) {
    uint16_t w = t->w[i];
    if (w > max_w) max_w = w;
    uint16_t tile8 = (uint16_t)(w & 0x03FFu);
    if (tile8 == 0) continue;
    if (map16_sub_gfx_page(w) != (page & 3u)) continue;
    uint8_t wlow = (uint8_t)(tile8 & 0x7Fu);
    if (subtile_matches_page_low(w, page, low)) {
      score += 4;
    } else if (page == 0) {
      if (wlow + 1u == low)
        score += 2;
      else if (wlow == low + 1u)
        score += 1;
    }
  }
  if (out_max_w) *out_max_w = max_w;
  return score;
}

static int block_alias_better(int score, int exact_hits, uint16_t max_w, size_t idx, int best_score,
                              int best_exact, uint16_t best_max_w, size_t best_idx) {
  if (score > best_score) return 1;
  if (score < best_score) return 0;
  if (exact_hits > best_exact) return 1;
  if (exact_hits < best_exact) return 0;
  if (max_w < best_max_w) return 1;
  if (max_w > best_max_w) return 0;
  return idx < best_idx;
}

static int map16_count_subs_local_low(const Map16Tile *t, uint8_t local) {
  if (!t) return 0;
  int n = 0;
  for (int i = 0; i < 4; i++) {
    uint16_t tile8 = (uint16_t)(t->w[i] & 0x03FFu);
    if (tile8 == 0) continue;
    if ((uint8_t)(tile8 & 0x7Fu) == local) n++;
  }
  return n;
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

static int map16_block_gfx_pages_match_id(const Map16Tile *t, uint8_t id_page) {
  if (!t) return 0;
  int any = 0;
  for (int i = 0; i < 4; i++) {
    uint16_t tile8 = (uint16_t)(t->w[i] & 0x03FFu);
    if (tile8 == 0) continue;
    any = 1;
    if (map16_sub_gfx_page(t->w[i]) != (id_page & 3u)) return 0;
  }
  return any;
}

static int map16_tile_two_checker_repeat(const Map16Tile *t) {
  if (!t) return 0;
  int distinct = map16_distinct_tile8_count(t);
  if (distinct != 2) return 0;
  uint16_t t0 = (uint16_t)(t->w[0] & 0x03FFu);
  uint16_t t1 = (uint16_t)(t->w[1] & 0x03FFu);
  uint16_t t2 = (uint16_t)(t->w[2] & 0x03FFu);
  uint16_t t3 = (uint16_t)(t->w[3] & 0x03FFu);
  return t0 == t2 && t1 == t3;
}

static int map16_shape_ok_pipe_block_loose(const Map16Tile *t) {
  if (!t) return 0;
  int on_p1 = 0;
  for (int i = 0; i < 4; i++) {
    uint16_t tile8 = (uint16_t)(t->w[i] & 0x03FFu);
    if (tile8 && map16_sub_gfx_page(t->w[i]) == 1u) on_p1++;
  }
  if (on_p1 < 3) return 0;
  if (map16_distinct_tile8_count(t) < 3) return 0;
  if (map16_tile_two_checker_repeat(t)) return 0;
  return 1;
}

static int map16_shape_ok_pipe_block(const Map16Tile *t) {
  if (!map16_shape_ok_pipe_block_loose(t)) return 0;
  for (int i = 0; i < 4; i++) {
    uint16_t tile8 = (uint16_t)(t->w[i] & 0x03FFu);
    if (tile8 == 0) continue;
    if (map16_sub_gfx_page(t->w[i]) != 1u) continue;
    uint8_t local = (uint8_t)(tile8 & 0x7Fu);
    if (local < 0x33u || local > 0x5Fu) return 0;
  }
  return 1;
}

static int map16_shape_ok_muncher_block(const Map16Tile *t) {
  if (!t || !map16_block_gfx_pages_match_id(t, 0)) return 0;
  if (map16_shape_ok_hack_muncher_block(t)) return 1;
  return map16_distinct_tile8_count(t) >= 3;
}

static int map16_shape_ok_generic02_block(const Map16Tile *t) {
  if (!t || !map16_block_gfx_pages_match_id(t, 0)) return 0;
  if (map16_count_subs_local_low(t, 0x02) >= 3) return 0;
  return map16_distinct_tile8_count(t) >= 3;
}

static int map16_id_is_pipe_low(uint8_t id_page, uint8_t id_low) {
  return (id_page == 0u || id_page == 1u) && id_low >= 0x33u && id_low <= 0x5Fu;
}

static int map16_shape_ok_for_id(uint8_t id_page, uint8_t id_low, const Map16Tile *cand) {
  if (!cand) return 0;
  if (id_low == 0xBDu || id_low == 0xBEu) {
    if (map16_shape_ok_hack_muncher_block(cand)) return 1;
  }
  if (map16_id_is_pipe_low(id_page, id_low)) return map16_shape_ok_pipe_block_loose(cand);
  if (!map16_block_gfx_pages_match_id(cand, id_page)) return 0;
  if (id_page == 1 && id_low >= 0x33u && id_low <= 0x5Fu) return map16_shape_ok_pipe_block(cand);
  if (id_page == 0 && id_low == 0x6Fu) return map16_shape_ok_muncher_block(cand);
  if (id_page == 0 && id_low == 0x02u) return map16_shape_ok_generic02_block(cand);
  return map16_distinct_tile8_count(cand) >= 2;
}

static int map16_tile_all_subs_local(const Map16Tile *t, uint8_t local) {
  if (!t) return 0;
  int any = 0;
  for (int i = 0; i < 4; i++) {
    uint16_t tile8 = (uint16_t)(t->w[i] & 0x03FFu);
    if (tile8 == 0) return 0;
    any = 1;
    if ((uint8_t)(tile8 & 0x7Fu) != local) return 0;
  }
  return any;
}

static int map16_alias_cand_ok(const Map16Tile *slot, const Map16Tile *cand, uint8_t id_page, uint8_t id_low) {
  if (!slot || !cand) return 0;
  for (int i = 0; i < 4; i++) {
    if (((uint16_t)(cand->w[i] & 0x03FFu)) == 0) return 0;
  }
  uint16_t slot_uni = 0, cand_uni = 0;
  int slot_uniform = map16_tile_uniform_tile8(slot, &slot_uni);
  int cand_uniform = map16_tile_uniform_tile8(cand, &cand_uni);
  if (cand_uniform && !slot_uniform) return 0;
  if (cand_uniform && slot_uniform && cand_uni != slot_uni) return 0;
  int raw_distinct = map16_distinct_tile8_count(slot);
  int cand_distinct = map16_distinct_tile8_count(cand);
  if (raw_distinct >= 2 && cand_distinct < 2) return 0;
  if (map16_id_is_pipe_low(id_page, id_low)) {
    if (!map16_shape_ok_pipe_block_loose(cand)) return 0;
  } else if (!map16_block_gfx_pages_match_id(cand, id_page)) {
    return 0;
  }
  if (id_page == 0 && id_low == 0x02) {
    if (map16_count_subs_local_low(cand, 0x02) >= 3) return 0;
    if (map16_tile_all_subs_local(cand, 0x82u)) return 0;
  }
  if (!map16_shape_ok_for_id(id_page, id_low, cand)) return 0;
  return 1;
}

static int map16_try_canonical_index(const Map16Data *m, size_t idx, uint8_t page, uint8_t low) {
  if (!m || !m->tiles || idx >= m->tiles_count) return 0;
  const Map16Tile *cand = &m->tiles[idx];
  if (map16_tile_needs_resolve(cand)) return 0;
  return map16_shape_ok_for_id(page, low, cand);
}

static int map16_try_canonical_muncher_index(const Map16Data *m, size_t idx) {
  if (!m || !m->tiles || idx >= m->tiles_count) return 0;
  const Map16Tile *cand = &m->tiles[idx];
  if (map16_tile_needs_resolve(cand)) return 0;
  if (map16_tile_has_full_muncher_quad_locals(cand)) return 1;
  return map16_shape_ok_hack_muncher_block(cand);
}

static int map16_tile_words_equal(const Map16Tile *a, const Map16Tile *b) {
  if (!a || !b) return 0;
  return a->w[0] == b->w[0] && a->w[1] == b->w[1] && a->w[2] == b->w[2] && a->w[3] == b->w[3];
}

static int map16_pick_canonical_for_tid(Map16Data *m, size_t tid, uint8_t page, uint8_t low) {
  if (!m || !m->tiles || low == 0) return 0;

  uint16_t candidates[16];
  int nc = 0;
  candidates[nc++] = (uint16_t)tid;
  if (page == 0) {
    if (low == 0x21u) candidates[nc++] = 0x0501u;
    if (low == 0x6Fu) candidates[nc++] = 0x002Bu;
    candidates[nc++] = (uint16_t)(0x0500u | (uint16_t)low);
  } else if (page == 1 && low == 0x2Fu) {
    candidates[nc++] = 0x04D2u; /* LM16 def pool: 0x04BD placement + 21 */
    candidates[nc++] = 0x04BDu;
    candidates[nc++] = 0x04BEu;
  } else if (page == 4 && low == 0xBDu) {
    candidates[nc++] = 0x04BDu;
    candidates[nc++] = 0x012Fu;
  } else if (page == 4 && low == 0xBEu) {
    candidates[nc++] = 0x04BEu;
    candidates[nc++] = 0x012Fu;
    candidates[nc++] = 0x04BDu;
  } else {
    candidates[nc++] = (uint16_t)(0x0500u | ((uint16_t)page << 8) | (uint16_t)low);
    candidates[nc++] = (uint16_t)(0x0500u | (uint16_t)low);
  }

  for (int ci = 0; ci < nc; ci++) {
    uint16_t cid = candidates[ci];
    if ((size_t)cid >= m->tiles_count) continue;
    if (cid == tid) continue;
    if (low == 0xBDu || low == 0xBEu || (page == 1 && low == 0x2Fu)) {
      if (map16_try_canonical_muncher_index(m, (size_t)cid)) return (int)cid;
    }
    if (map16_try_canonical_index(m, (size_t)cid, page, low)) return (int)cid;
  }

  /* Content alias: find a filled slot with matching block words or hack muncher geometry. */
  if (tid < m->tiles_count && map16_tile_needs_resolve(&m->tiles[tid])) {
    const Map16Tile *slot = &m->tiles[tid];
    int slot_has_words = !map16_tile_is_empty(slot) && !map16_tile_is_uniform_filler(slot);
    for (size_t j = 0; j < m->tiles_count; j++) {
      if (j == tid) continue;
      if (map16_tile_needs_resolve(&m->tiles[j])) continue;
      if (slot_has_words && map16_tile_words_equal(slot, &m->tiles[j])) return (int)j;
    }
    if (low == 0xBDu || low == 0xBEu || (page == 1 && low == 0x2Fu)) {
      for (size_t j = 0; j < m->tiles_count; j++) {
        if (j == tid) continue;
        if (map16_try_canonical_muncher_index(m, j)) return (int)j;
      }
    }
  }

  int best_score = 0;
  int best_exact = 0;
  size_t best_idx = SIZE_MAX;
  for (size_t j = 0; j < m->tiles_count; j++) {
    if (j == tid) continue;
    if (!map16_try_canonical_index(m, j, page, low)) continue;
    uint16_t max_w = 0;
    int score = block_alias_score(&m->tiles[j], page, low, &max_w);
    int exact = block_alias_exact_hits(&m->tiles[j], page, low);
    if (score < 4) continue;
    if (best_idx == SIZE_MAX || block_alias_better(score, exact, max_w, j, best_score, best_exact, 0xFFFFu, best_idx)) {
      best_score = score;
      best_exact = exact;
      best_idx = j;
    }
  }
  if (best_idx != SIZE_MAX) return (int)best_idx;
  return 0;
}

static int map16_build_canonical_table(Map16Data *m) {
  if (!m || !m->tiles || m->tiles_count == 0) return 0;

  size_t n = m->tiles_count;
  m->canonical_index = (size_t *)malloc(n * sizeof(size_t));
  if (!m->canonical_index) return 0;
  for (size_t i = 0; i < n; i++) m->canonical_index[i] = SIZE_MAX;

  size_t filled = 0;
  for (size_t tid = 0; tid < n; tid++) {
    if (!map16_tile_needs_resolve(&m->tiles[tid])) continue;
    uint8_t page = (uint8_t)((tid >> 8) & 0xFF);
    uint8_t low = (uint8_t)(tid & 0xFF);
    if (low == 0) continue;
    int picked = map16_pick_canonical_for_tid(m, tid, page, low);
    if (picked >= 0 && (size_t)picked < n) {
      m->canonical_index[tid] = (size_t)picked;
      filled++;
    }
  }
  m->canonical_table_count = filled;
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
    int best_exact = 0;
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
      int exact = block_alias_exact_hits(cand, page, low);
      /* Page-0 exact-low match avoids false positives (e.g. 0x0002 -> filler 0x1004).
       * Empty/degenerate/page>=1 slots may alias via near-match scoring only (e.g. 0x013D checker). */
      if (map16_id_is_pipe_low(page, low)) {
        if (!map16_shape_ok_pipe_block_loose(cand)) continue;
        if (exact < 1 && score < 8) continue;
        if ((j >> 8) != (tid >> 8) && exact < 2) continue;
      } else if (page == 0 && !map16_tile_is_empty(slot) && map16_tile_zero_sub_count(slot) < 2 &&
                 exact < 1 && score < 8) {
        continue;
      }
      if (page >= 2u && (low == 0xBDu || low == 0xBEu) && score >= 8) {
        if (!map16_shape_ok_hack_muncher_block(cand)) continue;
      } else if (!map16_alias_cand_ok(slot, cand, page, low)) {
        continue;
      }
      if (!have_best || block_alias_better(score, exact, max_w, j, best_score, best_exact, best_max_w, best_idx)) {
        best_score = score;
        best_exact = exact;
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

static int map16_try_visual_pool_lookup(Map16Data *m, uint16_t tile_id, const Map16Tile *placement,
                                        Map16Tile *out, int *src_out) {
  if (!m || !out) return 0;

  static const int k_pool_offsets[] = {21, -21, 42, -42};
  for (size_t oi = 0; oi < sizeof(k_pool_offsets) / sizeof(k_pool_offsets[0]); oi++) {
    int off = k_pool_offsets[oi];
    int64_t idx = (int64_t)tile_id + (int64_t)off;
    if (idx < 0 || (size_t)idx >= m->tiles_count) continue;
    const Map16Tile *cand = &m->tiles[(size_t)idx];
    if (!map16_tile_is_drawable(cand)) continue;
    if (placement && map16_tile8s_equal(placement, cand)) continue;
    map16_copy_def_pool_visual(placement, cand, out, off == 21 || off == -21);
    if (src_out) *src_out = MAP16_SRC_DEF_REDIRECT;
    m->def_redirect_count++;
    return 1;
  }

  /* Acts-like may correlate with definition id; use only as a hint to try another tiles[] index. */
  uint16_t acts = 0;
  if (map16_get_acts_like(m, tile_id, &acts) && acts != 0) {
    if (acts != tile_id && (size_t)acts < m->tiles_count) {
      const Map16Tile *cand = &m->tiles[acts];
      if (map16_tile_is_drawable(cand) && (!placement || !map16_tile8s_equal(placement, cand))) {
        map16_copy_def_pool_visual(placement, cand, out, 0);
        if (src_out) *src_out = MAP16_SRC_DEF_REDIRECT;
        m->def_redirect_count++;
        return 1;
      }
    }
    if ((size_t)acts + 21u < m->tiles_count) {
      const Map16Tile *cand = &m->tiles[acts + 21u];
      if (map16_tile_is_drawable(cand) && (!placement || !map16_tile8s_equal(placement, cand))) {
        map16_copy_def_pool_visual(placement, cand, out, 1);
        if (src_out) *src_out = MAP16_SRC_DEF_REDIRECT;
        m->def_redirect_count++;
        return 1;
      }
    }
  }

  uint8_t pg = (uint8_t)((tile_id >> 8) & 0xFF);
  uint8_t lo = (uint8_t)(tile_id & 0xFF);
  int prefer_full_muncher =
      (placement && map16_tile_is_partial_hack_muncher_stub(placement)) || (pg == 1u && lo == 0x2Fu);
  if (prefer_full_muncher) {
    size_t best_m = SIZE_MAX;
    int best_m_dist = 0x7FFFFFFF;
    for (size_t j = 0; j < m->tiles_count; j++) {
      if (j == (size_t)tile_id) continue;
      const Map16Tile *cand = &m->tiles[j];
      if (!map16_tile_is_drawable(cand) || !map16_tile_has_full_muncher_quad_locals(cand)) continue;
      if (placement && map16_tile8s_equal(placement, cand)) continue;
      int dist = (j > (size_t)tile_id) ? (int)(j - (size_t)tile_id) : (int)((size_t)tile_id - j);
      if (best_m == SIZE_MAX || dist < best_m_dist) {
        best_m = j;
        best_m_dist = dist;
      }
    }
    if (best_m != SIZE_MAX) {
      map16_copy_def_pool_visual(placement, &m->tiles[best_m], out, 0);
      if (src_out) *src_out = MAP16_SRC_DEF_REDIRECT;
      m->def_redirect_count++;
      return 1;
    }
  }

  return 0;
}

static int map16_try_visual_def_redirect(Map16Data *m, uint16_t tile_id, const Map16Tile *placement,
                                         Map16Tile *out, int *src_out) {
  if (!placement) return 0;
  uint8_t page = (uint8_t)((tile_id >> 8) & 0xFF);
  uint8_t low = (uint8_t)(tile_id & 0xFF);
  if (page == 1u && low == 0x2Fu) {
    return map16_try_visual_pool_lookup(m, tile_id, placement, out, src_out);
  }
  if (page < 2u) return 0;
  if (!map16_tile_is_placement_stub(m, tile_id, placement)) return 0;
  return map16_try_visual_pool_lookup(m, tile_id, placement, out, src_out);
}

void map16_free(Map16Data *m) {
  if (!m) return;
  free(m->tiles);
  free(m->acts_like);
  free(m->alias_index);
  free(m->canonical_index);
  m->tiles = NULL;
  m->acts_like = NULL;
  m->alias_index = NULL;
  m->canonical_index = NULL;
  m->tiles_count = 0;
  m->acts_like_count = 0;
  m->is_lm16 = 0;
  m->loaded_from_rom = 0;
  m->synth_vanilla = 0;
  m->def_redirect_count = 0;
  m->synth_count = 0;
  m->alias_hit_count = 0;
  m->rom_hit_count = 0;
  m->rom_vanilla_hit_count = 0;
  m->alias_table_count = 0;
  m->canonical_table_count = 0;
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
  if (!map16_build_canonical_table(out)) {
    map16_free(out);
    seterr(err, errcap, "Out of memory building map16 canonical table");
    return 0;
  }
  if (!map16_build_alias_table(out)) {
    map16_free(out);
    seterr(err, errcap, "Out of memory building map16 alias table");
    return 0;
  }
  return 1;
}

int map16_load_from_rom(Rom *rom, Map16Data *out, char *err, size_t errcap) {
  if (!rom || !out) {
    seterr(err, errcap, "map16_load_from_rom: invalid args");
    return 0;
  }
  map16_free(out);
  memset(out, 0, sizeof(*out));
  out->synth_vanilla = 1;
  out->loaded_from_rom = 1;

  size_t n = MAP16_TILE_CAPACITY;
  out->tiles = (Map16Tile *)calloc(n, sizeof(Map16Tile));
  out->acts_like = (uint16_t *)malloc(n * sizeof(uint16_t));
  if (!out->tiles || !out->acts_like) {
    map16_free(out);
    seterr(err, errcap, "Out of memory loading map16 from ROM");
    return 0;
  }
  for (size_t i = 0; i < n; i++) out->acts_like[i] = 0xFFFFu;
  out->tiles_count = n;
  out->acts_like_count = n;

  for (uint16_t page = 0; page <= 0x7F; page++) {
    for (uint16_t low = 1; low <= 0xFF; low++) {
      uint16_t tid = (uint16_t)((uint16_t)page << 8) | low;
      Map16Tile t;
      memset(&t, 0, sizeof(t));
      if (page <= 1u) {
        (void)map16_rom_read_vanilla_tile_raw(rom, tid, &t);
      } else {
        (void)map16_rom_read_custom_tile_raw(rom, tid, &t);
      }
      out->tiles[tid] = t;

      uint16_t acts = 0;
      if (map16_rom_read_acts_like(rom, tid, &acts)) out->acts_like[tid] = acts;
    }
  }

  out->rom = rom;
  map16_rebuild_tables(out);
  return 1;
}

int map16_merge_file(const char *path, Map16Data *m, char *err, size_t errcap) {
  if (!path || !m) {
    seterr(err, errcap, "map16_merge_file: invalid args");
    return 0;
  }

  Map16Data file;
  memset(&file, 0, sizeof(file));
  if (!map16_load_file(path, &file, err, errcap)) return 0;

  size_t need = m->tiles_count;
  if (file.tiles_count > need) need = file.tiles_count;
  if (need < MAP16_TILE_CAPACITY) need = MAP16_TILE_CAPACITY;
  if (!map16_grow(m, need)) {
    map16_free(&file);
    seterr(err, errcap, "Out of memory growing map16 for merge");
    return 0;
  }

  for (size_t i = 0; i < file.tiles_count; i++) {
    const Map16Tile *fs = &file.tiles[i];
    if (!map16_tile_is_drawable(fs)) continue;
    Map16Tile *dst = &m->tiles[i];
    int force_pool = 0;
    if (i >= 21u) {
      const Map16Tile *place = &m->tiles[i - 21u];
      if (map16_tile_is_placement_stub(m, (uint16_t)(i - 21u), place)) force_pool = 1;
    }
    if (!map16_tile_is_drawable(dst) || map16_tile_is_placement_stub(m, (uint16_t)i, dst) || force_pool) {
      *dst = *fs;
    }
  }

  /* Keep LM16 placement rows (stub words + flip hints); ROM rows are often wrong CHR. */
  for (size_t i = 0; i < file.tiles_count; i++) {
    const Map16Tile *fs = &file.tiles[i];
    if (map16_tile_is_empty(fs)) continue;
    Map16Tile tmp;
    memset(&tmp, 0, sizeof(tmp));
    Map16Data stub_probe;
    memset(&stub_probe, 0, sizeof(stub_probe));
    stub_probe.tiles = (Map16Tile *)fs;
    stub_probe.tiles_count = file.tiles_count;
    if (map16_tile_is_placement_stub(&stub_probe, (uint16_t)i, fs) ||
        map16_tile_is_uniform_filler(fs) || map16_tile_is_partial_hack_muncher_stub(fs)) {
      m->tiles[i] = *fs;
    }
  }

  m->is_lm16 |= file.is_lm16;
  map16_free(&file);
  map16_rebuild_tables(m);
  return 1;
}

int map16_get_acts_like(const Map16Data *m, uint16_t tile_id, uint16_t *out_acts_like) {
  if (!m || !out_acts_like) return 0;
  if (m->acts_like && (size_t)tile_id < m->acts_like_count && m->acts_like[tile_id] != 0xFFFFu) {
    *out_acts_like = m->acts_like[tile_id];
    return 1;
  }
  if (m->rom) return map16_rom_read_acts_like(m->rom, tile_id, out_acts_like);
  return 0;
}

int map16_resolve_acts_like_chain(const Map16Data *m, uint16_t tile_id, uint16_t *out_terminal) {
  if (!m || !out_terminal) return 0;
  uint16_t cur = tile_id;
  for (int step = 0; step < 32; step++) {
    uint16_t acts = 0;
    if (!map16_get_acts_like(m, cur, &acts)) return 0;
    if (acts == 0 || acts == cur || acts < 0x200u) {
      *out_terminal = acts ? acts : cur;
      return 1;
    }
    cur = acts;
  }
  return 0;
}

int map16_get_raw(const Map16Data *m, uint16_t tile_id, Map16Tile *out) {
  if (!m || !out || !m->tiles) return 0;
  if ((size_t)tile_id >= m->tiles_count) return 0;
  *out = m->tiles[tile_id];
  return 1;
}

int map16_get_alias_index(const Map16Data *m, uint16_t tile_id, size_t *out_idx) {
  if (!m || !out_idx || !m->alias_index) return 0;
  if ((size_t)tile_id >= m->tiles_count) return 0;
  size_t idx = m->alias_index[tile_id];
  if (idx == SIZE_MAX) return 0;
  *out_idx = idx;
  return 1;
}

int map16_get_canonical_index(const Map16Data *m, uint16_t tile_id, size_t *out_idx) {
  if (!m || !out_idx || !m->canonical_index) return 0;
  if ((size_t)tile_id >= m->tiles_count) return 0;
  size_t idx = m->canonical_index[tile_id];
  if (idx == SIZE_MAX) return 0;
  *out_idx = idx;
  return 1;
}

static int map16_try_canonical_resolve(Map16Data *m, uint16_t tile_id, Map16Tile *out, int *src_out) {
  if (!m->canonical_index || (size_t)tile_id >= m->tiles_count) return 0;
  size_t can_idx = m->canonical_index[tile_id];
  if (can_idx == SIZE_MAX || can_idx >= m->tiles_count) return 0;
  const Map16Tile *at = &m->tiles[can_idx];
  if (map16_tile_needs_resolve(at)) return 0;
  if (tile_id == 0x012Fu && !map16_tile_has_full_muncher_quad_locals(at)) return 0;
  *out = *at;
  if (src_out) *src_out = MAP16_SRC_CANONICAL;
  return 1;
}

static int map16_try_alias_resolve(Map16Data *m, uint16_t tile_id, Map16Tile *out, int *src_out) {
  if (!m->alias_index || (size_t)tile_id >= m->tiles_count) return 0;
  size_t alias_idx = m->alias_index[tile_id];
  if (alias_idx == SIZE_MAX || alias_idx >= m->tiles_count) return 0;
  const Map16Tile *at = &m->tiles[alias_idx];
  if (map16_tile_needs_resolve(at)) return 0;
  if (tile_id == 0x012Fu && !map16_tile_has_full_muncher_quad_locals(at)) return 0;
  *out = *at;
  m->alias_hit_count++;
  if (src_out) *src_out = MAP16_SRC_ALIAS;
  return 1;
}

static int map16_try_rom_custom_resolve(Map16Data *m, uint16_t tile_id, Map16Tile *out, int *src_out) {
  if (!m->rom) return 0;
  Map16Tile rom_tile;
  if (!map16_rom_get_tile(m->rom, tile_id, &rom_tile)) return 0;
  *out = rom_tile;
  m->rom_hit_count++;
  if (src_out) *src_out = MAP16_SRC_ROM;
  return 1;
}

static int map16_try_rom_vanilla_resolve(Map16Data *m, uint16_t tile_id, uint8_t page, uint8_t low,
                                         Map16Tile *out, int *src_out) {
  if (!m->rom) return 0;
  int is_pipe = map16_id_is_pipe_low(page, low);
  if (page > 1u || (page == 0u && !is_pipe)) return 0;
  Map16Tile rom_tile;
  if (!map16_rom_get_vanilla_tile(m->rom, tile_id, &rom_tile)) return 0;
  int rom_shape_ok = 0;
  if (is_pipe) {
    rom_shape_ok = map16_shape_ok_pipe_block_loose(&rom_tile);
  } else {
    rom_shape_ok = map16_block_gfx_pages_match_id(&rom_tile, page) && map16_shape_ok_for_id(page, low, &rom_tile);
  }
  if (!rom_shape_ok) return 0;
  *out = rom_tile;
  m->rom_vanilla_hit_count++;
  if (src_out) *src_out = MAP16_SRC_ROM_VANILLA;
  return 1;
}

int map16_get_with_src(Map16Data *m, uint16_t tile_id, Map16Tile *out, int *src_out) {
  if (!m || !out) return 0;
  if (src_out) *src_out = MAP16_SRC_FILE;

  uint8_t page = (uint8_t)((tile_id >> 8) & 0xFF);
  uint8_t low = (uint8_t)(tile_id & 0xFF);

  Map16Tile raw;
  int have_raw = map16_get_raw(m, tile_id, &raw);

  if (have_raw && map16_tile_is_empty(&raw)) {
    uint16_t acts = 0;
    int def_visual_slot = (page == 1u && low == 0x2Fu) &&
                          map16_get_acts_like(m, tile_id, &acts) && acts == tile_id;
    if (page >= 2u || def_visual_slot) {
      if (map16_try_visual_pool_lookup(m, tile_id, NULL, out, src_out)) return 1;
    }
  }

  if (have_raw && map16_try_visual_def_redirect(m, tile_id, &raw, out, src_out)) return 1;

  if (have_raw && map16_tile_is_drawable(&raw) && !map16_tile_is_placement_stub(m, tile_id, &raw)) {
    *out = raw;
    if (src_out) *src_out = MAP16_SRC_FILE;
    return 1;
  }

  if (page >= 2u) {
    /* Hack pages: prefer visual def pool over alias guessing. */
    if (map16_try_rom_custom_resolve(m, tile_id, out, src_out)) return 1;
    if (map16_try_canonical_resolve(m, tile_id, out, src_out)) return 1;
    if (have_raw && map16_try_visual_def_redirect(m, tile_id, &raw, out, src_out)) return 1;
    if (map16_try_alias_resolve(m, tile_id, out, src_out)) return 1;
    if (have_raw && !map16_tile_is_empty(&raw)) {
      *out = raw;
      if (src_out) *src_out = MAP16_SRC_FILE;
      return 1;
    }
    return 0;
  }

  /* Pages 0-1: pipe blocks (GFX page 1 subs) may use ROM vanilla before alias guessing. */
  if (map16_id_is_pipe_low(page, low)) {
    if (map16_try_rom_vanilla_resolve(m, tile_id, page, low, out, src_out)) return 1;
  }
  if (have_raw && map16_try_visual_def_redirect(m, tile_id, &raw, out, src_out)) return 1;
  if (map16_try_alias_resolve(m, tile_id, out, src_out)) return 1;
  if (map16_try_rom_custom_resolve(m, tile_id, out, src_out)) return 1;
  if (map16_id_is_pipe_low(page, low)) {
    /* pipe ROM vanilla already tried above */
  } else if (page == 1u) {
    if (map16_try_rom_vanilla_resolve(m, tile_id, page, low, out, src_out)) return 1;
  }
  if (map16_try_canonical_resolve(m, tile_id, out, src_out)) return 1;

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

void map16_debug_synthesize(uint16_t tile_id, Map16Tile *out) {
  map16_synthesize_from_tile_id(tile_id, out);
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
