#pragma once

#include <stddef.h>
#include <stdint.h>

typedef struct {
  size_t total_objects;
  size_t handled;
  size_t unknown;
  size_t decoded_present;
  size_t map16_miss;
  size_t gfx_miss;
} ObjectEmitStats;

void emit_stats_reset(ObjectEmitStats *s);
void emit_stats_print_human(const ObjectEmitStats *s, const char *label);
void emit_stats_print_line(const ObjectEmitStats *s);
