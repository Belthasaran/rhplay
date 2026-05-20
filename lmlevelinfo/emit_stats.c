#include "emit_stats.h"

#include <stdio.h>
#include <string.h>

void emit_stats_reset(ObjectEmitStats *s) {
  if (!s) return;
  s->total_objects = 0;
  s->handled = 0;
  s->unknown = 0;
  s->skipped_nonvisual = 0;
  s->decoded_present = 0;
  s->map16_miss = 0;
  s->gfx_miss = 0;
  s->subtiles_drawn = 0;
  for (int i = 0; i < 256; i++) s->gfx_miss_by_file[i] = 0;
}

void emit_stats_print_human(const ObjectEmitStats *s, const char *label) {
  if (!s) return;
  const char *lbl = label && *label ? label : "level";
  fprintf(stderr,
          "%s emit: total=%zu handled=%zu unknown=%zu skipped_nonvisual=%zu decoded=%zu "
          "map16_miss=%zu gfx_miss=%zu subtiles=%zu\n",
          lbl, s->total_objects, s->handled, s->unknown, s->skipped_nonvisual, s->decoded_present,
          s->map16_miss, s->gfx_miss, s->subtiles_drawn);
}

void emit_stats_print_line(const ObjectEmitStats *s) {
  if (!s) return;
  size_t visual_total = s->total_objects > s->skipped_nonvisual ? s->total_objects - s->skipped_nonvisual : 0;
  fprintf(stderr,
          "LV_STATS handled=%zu unknown=%zu total=%zu skipped_nonvisual=%zu visual_total=%zu "
          "decoded=%zu map16_miss=%zu gfx_miss=%zu subtiles=%zu\n",
          s->handled, s->unknown, s->total_objects, s->skipped_nonvisual, visual_total, s->decoded_present,
          s->map16_miss, s->gfx_miss, s->subtiles_drawn);
}

void emit_stats_print_top_gfx_miss(const ObjectEmitStats *s, int top_n) {
  if (!s || top_n <= 0) return;
  uint8_t used[256];
  memset(used, 0, sizeof(used));
  for (int n = 0; n < top_n; n++) {
    uint32_t best = 0;
    int best_id = -1;
    for (int fid = 0; fid < 256; fid++) {
      if (used[fid]) continue;
      if (s->gfx_miss_by_file[fid] > best) {
        best = s->gfx_miss_by_file[fid];
        best_id = fid;
      }
    }
    if (best_id < 0 || best == 0) break;
    fprintf(stderr, "LV_GFX_MISS_TOP file=0x%02X count=%u\n", (unsigned)best_id, best);
    used[best_id] = 1;
  }
}
