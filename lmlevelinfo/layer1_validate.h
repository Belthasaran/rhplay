#pragma once

#include <stddef.h>
#include <stdint.h>

// Lightweight plausibility check for a Layer1 blob starting at primary header byte 0.
// Returns 1 if the stream appears parseable by our object rules (terminator found,
// no truncation), 0 otherwise.
int layer1_blob_looks_valid(const uint8_t *p, size_t len);

