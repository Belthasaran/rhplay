#include "jsonutil.h"

#include <string.h>

static void put_indent(JsonW *w) {
  if (!w->pretty) return;
  fputc('\n', w->fp);
  for (int i = 0; i < w->indent; i++) fputc(' ', w->fp);
}

static void maybe_comma(JsonW *w) {
  if (w->depth <= 0) return;
  if (w->need_comma_stack[w->depth - 1]) {
    fputc(',', w->fp);
  }
  if (w->pretty) put_indent(w);
  w->need_comma_stack[w->depth - 1] = 1;
}

void jsonw_init(JsonW *w, FILE *fp, int pretty) {
  memset(w, 0, sizeof(*w));
  w->fp = fp;
  w->pretty = pretty ? 1 : 0;
  w->indent = 0;
  w->depth = 0;
}

void jsonw_obj_begin(JsonW *w) {
  maybe_comma(w);
  fputc('{', w->fp);
  w->need_comma_stack[w->depth] = 0;
  w->depth++;
  if (w->pretty) w->indent += 2;
}

void jsonw_obj_end(JsonW *w) {
  if (w->pretty) {
    w->indent -= 2;
    if (w->need_comma_stack[w->depth - 1]) put_indent(w);
  }
  w->depth--;
  fputc('}', w->fp);
}

void jsonw_arr_begin(JsonW *w) {
  maybe_comma(w);
  fputc('[', w->fp);
  w->need_comma_stack[w->depth] = 0;
  w->depth++;
  if (w->pretty) w->indent += 2;
}

void jsonw_arr_end(JsonW *w) {
  if (w->pretty) {
    w->indent -= 2;
    if (w->need_comma_stack[w->depth - 1]) put_indent(w);
  }
  w->depth--;
  fputc(']', w->fp);
}

void jsonw_key(JsonW *w, const char *k) {
  maybe_comma(w);
  fputc('"', w->fp);
  for (const unsigned char *p = (const unsigned char *)k; *p; p++) {
    if (*p == '"' || *p == '\\') {
      fputc('\\', w->fp);
      fputc(*p, w->fp);
    } else {
      fputc(*p, w->fp);
    }
  }
  fputc('"', w->fp);
  fputc(':', w->fp);
  if (w->pretty) fputc(' ', w->fp);
  // Next value should not emit comma at this depth; we already did it for the key.
  w->need_comma_stack[w->depth - 1] = 0;
}

static void json_escape(JsonW *w, const char *s) {
  fputc('"', w->fp);
  for (const unsigned char *p = (const unsigned char *)s; p && *p; p++) {
    unsigned char c = *p;
    switch (c) {
      case '"': fputs("\\\"", w->fp); break;
      case '\\': fputs("\\\\", w->fp); break;
      case '\b': fputs("\\b", w->fp); break;
      case '\f': fputs("\\f", w->fp); break;
      case '\n': fputs("\\n", w->fp); break;
      case '\r': fputs("\\r", w->fp); break;
      case '\t': fputs("\\t", w->fp); break;
      default:
        if (c <= 0x1F) {
          fprintf(w->fp, "\\u%04x", (unsigned int)c);
        } else {
          fputc(c, w->fp);
        }
    }
  }
  fputc('"', w->fp);
}

void jsonw_str(JsonW *w, const char *s) {
  maybe_comma(w);
  json_escape(w, s ? s : "");
}

void jsonw_int(JsonW *w, int64_t v) {
  maybe_comma(w);
  fprintf(w->fp, "%lld", (long long)v);
}

void jsonw_uint(JsonW *w, uint64_t v) {
  maybe_comma(w);
  fprintf(w->fp, "%llu", (unsigned long long)v);
}

void jsonw_bool(JsonW *w, int v) {
  maybe_comma(w);
  fputs(v ? "true" : "false", w->fp);
}

void jsonw_null(JsonW *w) {
  maybe_comma(w);
  fputs("null", w->fp);
}

