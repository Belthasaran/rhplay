#include "lc_lz2.h"

#include <stdlib.h>
#include <string.h>
#include <stdio.h>

static void seterr(char *err, size_t cap, const char *msg) {
  if (!err || cap == 0) return;
  snprintf(err, cap, "%s", msg ? msg : "error");
}

int lc_lz2_decompress(const uint8_t *src, size_t srclen,
                      uint8_t **out_bytes, size_t *out_len,
                      size_t max_out,
                      size_t *out_consumed,
                      char *err, size_t errcap) {
  if (!src || !out_bytes || !out_len) {
    seterr(err, errcap, "lc_lz2_decompress: invalid args");
    return 0;
  }
  *out_bytes = NULL;
  *out_len = 0;
  if (out_consumed) *out_consumed = 0;
  if (srclen == 0) {
    seterr(err, errcap, "lc_lz2_decompress: empty input");
    return 0;
  }
  if (max_out == 0) max_out = 0x10000u;

  uint8_t *out = (uint8_t *)malloc(max_out);
  if (!out) {
    seterr(err, errcap, "lc_lz2_decompress: out of memory");
    return 0;
  }
  size_t ip = 0;
  size_t op = 0;

  while (ip < srclen) {
    uint8_t h0 = src[ip++];
    if (h0 == 0xFF) break;

    uint8_t cmd = (h0 >> 5) & 0x7;
    uint32_t len = (uint32_t)(h0 & 0x1F);
    if (cmd == 0x7) {
      // Long length: 111CCCLL LLLLLLLL
      if (ip >= srclen) {
        free(out);
        seterr(err, errcap, "lc_lz2_decompress: truncated long header");
        return 0;
      }
      uint8_t h1 = src[ip++];
      cmd = (h0 >> 2) & 0x7;
      len = (uint32_t)(((uint32_t)(h0 & 0x3) << 8) | (uint32_t)h1);
    }
    uint32_t count = len + 1u;
    if (op + count > max_out) {
      free(out);
      seterr(err, errcap, "lc_lz2_decompress: output too large");
      return 0;
    }

    switch (cmd) {
      case 0x0: { // Direct copy
        if (ip + count > srclen) {
          free(out);
          seterr(err, errcap, "lc_lz2_decompress: truncated direct copy");
          return 0;
        }
        memcpy(out + op, src + ip, count);
        ip += count;
        op += count;
        break;
      }
      case 0x1: { // Byte fill
        if (ip >= srclen) {
          free(out);
          seterr(err, errcap, "lc_lz2_decompress: truncated byte fill");
          return 0;
        }
        uint8_t v = src[ip++];
        memset(out + op, v, count);
        op += count;
        break;
      }
      case 0x2: { // Word fill
        if (ip + 2 > srclen) {
          free(out);
          seterr(err, errcap, "lc_lz2_decompress: truncated word fill");
          return 0;
        }
        uint8_t a = src[ip++];
        uint8_t b = src[ip++];
        for (uint32_t i = 0; i < count; i++) {
          out[op++] = (i & 1u) ? b : a;
        }
        break;
      }
      case 0x3: { // Increasing fill
        if (ip >= srclen) {
          free(out);
          seterr(err, errcap, "lc_lz2_decompress: truncated inc fill");
          return 0;
        }
        uint8_t v = src[ip++];
        for (uint32_t i = 0; i < count; i++) {
          out[op++] = (uint8_t)(v + (uint8_t)i);
        }
        break;
      }
      case 0x4: { // Repeat from output (big-endian address)
        if (ip + 2 > srclen) {
          free(out);
          seterr(err, errcap, "lc_lz2_decompress: truncated repeat addr");
          return 0;
        }
        uint16_t addr = (uint16_t)((uint16_t)src[ip] << 8) | (uint16_t)src[ip + 1];
        ip += 2;
        if ((size_t)addr >= op) {
          free(out);
          seterr(err, errcap, "lc_lz2_decompress: repeat addr beyond output");
          return 0;
        }
        for (uint32_t i = 0; i < count; i++) {
          out[op++] = out[(size_t)addr + (size_t)i];
        }
        break;
      }
      default:
        free(out);
        seterr(err, errcap, "lc_lz2_decompress: unsupported command");
        return 0;
    }
  }

  uint8_t *shrink = (uint8_t *)realloc(out, op ? op : 1);
  if (shrink) out = shrink;
  *out_bytes = out;
  *out_len = op;
  if (out_consumed) *out_consumed = ip;
  return 1;
}

