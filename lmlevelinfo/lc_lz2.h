#pragma once

#include <stdint.h>
#include <stddef.h>

// Decompress LC_LZ2 (aka SMW "LZ2") stream.
// - `src` points at the compressed stream start (ROM bytes).
// - Decompression stops when 0xFF header encountered or output hits max_out.
// Returns 1 on success, 0 on failure (err filled).
int lc_lz2_decompress(const uint8_t *src, size_t srclen,
                      uint8_t **out_bytes, size_t *out_len,
                      size_t max_out,
                      size_t *out_consumed,
                      char *err, size_t errcap);

