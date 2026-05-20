#include "emit_stats.h"

#include <stdio.h>

void emit_stats_reset(ObjectEmitStats *s) {
  if (!s) return;
  s->total_objects = 0;
  s->handled = 0;
  s->unknown = 0;
  s->decoded_present = 0;
  s->map16_miss = 0;
  s->gfx_miss = 0;
}

void emit_stats_print_human(const ObjectEmitStats *s, const char *label) {
  if (!s) return;
  const char *lbl = label && *label ? label : "level";
  fprintf(stderr, "%s emit: total=%zu handled=%zu unknown=%zu decoded=%zu map16_miss=%zu gfx_miss=%zu\n",
          lbl, s->total_objects, s->handled, s->unknown, s->decoded_present, s->map16_miss, s->gfx_miss);
}

void emit_stats_print_line(const ObjectEmitStats *s) {
  if (!s) return;
  fprintf(stderr,
          "LV_STATS handled=%zu unknown=%zu total=%zu decoded=%zu map16_miss=%zu gfx_miss=%zu\n",
          s->handled, s->unknown, s->total_objects, s->decoded_present, s->map16_miss, s->gfx_miss);
}
