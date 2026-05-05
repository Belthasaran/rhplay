#pragma once

#include <stdio.h>
#include <stdint.h>

typedef struct {
  FILE *fp;
  int pretty;
  int indent;
  int need_comma_stack[64];
  int depth;
} JsonW;

void jsonw_init(JsonW *w, FILE *fp, int pretty);
void jsonw_obj_begin(JsonW *w);
void jsonw_obj_end(JsonW *w);
void jsonw_arr_begin(JsonW *w);
void jsonw_arr_end(JsonW *w);

void jsonw_key(JsonW *w, const char *k);
void jsonw_str(JsonW *w, const char *s);
void jsonw_int(JsonW *w, int64_t v);
void jsonw_uint(JsonW *w, uint64_t v);
void jsonw_bool(JsonW *w, int v);
void jsonw_null(JsonW *w);

