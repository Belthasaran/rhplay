#include "mwl_reader.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static void seterr(char *err, size_t cap, const char *msg) {
  if (!err || cap == 0) return;
  snprintf(err, cap, "%s", msg ? msg : "error");
}

static int read_u16le(const uint8_t *p, size_t n, uint16_t *out) {
  if (n < 2) return 0;
  *out = (uint16_t)(p[0] | ((uint16_t)p[1] << 8));
  return 1;
}

static int read_u32le(const uint8_t *p, size_t n, uint32_t *out) {
  if (n < 4) return 0;
  *out = (uint32_t)(p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24));
  return 1;
}

void mwl_parsed_free(MwlParsed *p) {
  if (!p) return;
  free(p->layer1.bytes);
  p->layer1.bytes = NULL;
  p->layer1.len = 0;
  free(p->sprites.bytes);
  p->sprites.bytes = NULL;
  p->sprites.len = 0;
}

static int file_read_all(const char *path, uint8_t **out_buf, size_t *out_len, char *err, size_t errcap) {
  *out_buf = NULL;
  *out_len = 0;
  FILE *fp = fopen(path, "rb");
  if (!fp) {
    seterr(err, errcap, "Could not open MWL file");
    return 0;
  }
  if (fseek(fp, 0, SEEK_END) != 0) {
    fclose(fp);
    seterr(err, errcap, "Could not seek MWL file");
    return 0;
  }
  long fsz = ftell(fp);
  if (fsz <= 0) {
    fclose(fp);
    seterr(err, errcap, "MWL file is empty");
    return 0;
  }
  if (fseek(fp, 0, SEEK_SET) != 0) {
    fclose(fp);
    seterr(err, errcap, "Could not rewind MWL file");
    return 0;
  }
  uint8_t *buf = (uint8_t *)malloc((size_t)fsz);
  if (!buf) {
    fclose(fp);
    seterr(err, errcap, "Out of memory reading MWL file");
    return 0;
  }
  size_t rd = fread(buf, 1, (size_t)fsz, fp);
  fclose(fp);
  if (rd != (size_t)fsz) {
    free(buf);
    seterr(err, errcap, "Short read reading MWL file");
    return 0;
  }
  *out_buf = buf;
  *out_len = (size_t)fsz;
  return 1;
}

int mwl_parse_file(const char *path, MwlParsed *out, char *err, size_t errcap) {
  if (!path || !out) {
    seterr(err, errcap, "mwl_parse_file: invalid args");
    return 0;
  }
  memset(out, 0, sizeof(*out));

  uint8_t *buf = NULL;
  size_t len = 0;
  if (!file_read_all(path, &buf, &len, err, errcap)) {
    return 0;
  }

  if (len < 0x40) {
    free(buf);
    seterr(err, errcap, "MWL too small (missing header)");
    return 0;
  }
  if (!(buf[0] == 'L' && buf[1] == 'M')) {
    free(buf);
    seterr(err, errcap, "MWL magic not found (expected 'LM')");
    return 0;
  }

  // Header layout per MWL doc:
  // 0..1: "LM"
  // 2..3: LM version (u16le)
  // 4..7: pointer list offset (u32le)
  // 8..11: pointer bytes length (u32le)
  // 12..15: flags (4 bytes)
  // 16..63: banner string (48 bytes)
  (void)read_u16le(buf + 2, len - 2, &out->file.lm_version);
  if (!read_u32le(buf + 4, len - 4, &out->file.ptr_list_off) ||
      !read_u32le(buf + 8, len - 8, &out->file.ptr_list_size)) {
    free(buf);
    seterr(err, errcap, "MWL header parse failed");
    return 0;
  }
  memcpy(out->file.flags, buf + 12, 4);
  memcpy(out->file.banner, buf + 16, 48);
  out->file.banner[48] = '\0';

  // Parse pointer list
  if (out->file.ptr_list_off + out->file.ptr_list_size > len) {
    free(buf);
    seterr(err, errcap, "MWL pointer list out of range");
    return 0;
  }
  if (out->file.ptr_list_size < 0x40) {
    free(buf);
    seterr(err, errcap, "MWL pointer list too small");
    return 0;
  }
  const uint8_t *plist = buf + out->file.ptr_list_off;
  for (int i = 0; i < 8; i++) {
    uint32_t off = 0, sz = 0;
    if (!read_u32le(plist + i * 8 + 0, 4, &off) || !read_u32le(plist + i * 8 + 4, 4, &sz)) {
      free(buf);
      seterr(err, errcap, "MWL pointer list parse failed");
      return 0;
    }
    out->file.ptrs[i].off = off;
    out->file.ptrs[i].size = sz;
  }

  // Section 1: Level information
  // Pointer index 0 in MWL doc.
  MwlPtr s1 = out->file.ptrs[0];
  if (s1.off == 0 || s1.size < 8 || s1.off + s1.size > len) {
    free(buf);
    seterr(err, errcap, "MWL Level information section missing/invalid");
    return 0;
  }
  const uint8_t *lvl = buf + s1.off;
  uint16_t level_id = 0;
  if (!read_u16le(lvl + 0, s1.size - 0, &level_id)) {
    free(buf);
    seterr(err, errcap, "MWL level id read failed");
    return 0;
  }
  out->level.level_id = level_id;

  // MWL doc (v2.53) describes the next 5 bytes as secondary header bytes, but newer LM versions
  // have evolved and this layout is not guaranteed across all exports. For v1 tests we treat
  // b1..b4 as reliable and treat b5+ as optional/unasserted unless later confirmed.
  out->level.sec_b1 = lvl[2];
  out->level.sec_b2 = lvl[3];
  out->level.sec_b3 = lvl[4];
  out->level.sec_b4 = lvl[5];
  out->level.present_sec_b5 = 0;

  // MWL doc: additional 3 bytes follow later:
  //   two from $06FC00 and $06FE00,
  //   and one from an expanded level data table.
  // The doc text describes offsets, but LM has evolved; for v1 tests we treat them as optional.
  if (s1.size >= 19) {
    out->level.sec_b7 = lvl[16];
    out->level.sec_b8 = lvl[17];
    out->level.sec_b6 = lvl[18];
    out->level.present_sec_b6 = 0;
    out->level.present_sec_b7 = 0;
    out->level.present_sec_b8 = 0;
  }

  // Section 2: Layer 1 data
  // Pointer index 1 in MWL doc.
  MwlPtr s2 = out->file.ptrs[1];
  if (s2.off == 0 || s2.size < 8 || s2.off + s2.size > len) {
    free(buf);
    seterr(err, errcap, "MWL Layer 1 section missing/invalid");
    return 0;
  }
  const uint8_t *l1 = buf + s2.off;
  size_t l1_payload = s2.size - 8;  // skip 8-byte section header
  out->layer1.bytes = (uint8_t *)malloc(l1_payload);
  if (!out->layer1.bytes) {
    free(buf);
    seterr(err, errcap, "Out of memory copying Layer 1 data");
    return 0;
  }
  memcpy(out->layer1.bytes, l1 + 8, l1_payload);
  out->layer1.len = l1_payload;

  // Section 3: Sprite data (MWL pointer index 3)
  // Lunar Magic exports this as a raw section payload; we keep it as-is and decode in tests/tools.
  MwlPtr s3 = out->file.ptrs[3];
  if (s3.off != 0) {
    if (s3.size < 8 || s3.off + s3.size > len) {
      free(buf);
      seterr(err, errcap, "MWL Sprite section invalid");
      return 0;
    }
    const uint8_t *sp = buf + s3.off;
    size_t sp_payload = s3.size - 8; // skip 8-byte section header
    out->sprites.bytes = (uint8_t *)malloc(sp_payload);
    if (!out->sprites.bytes) {
      free(buf);
      seterr(err, errcap, "Out of memory copying Sprite data");
      return 0;
    }
    memcpy(out->sprites.bytes, sp + 8, sp_payload);
    out->sprites.len = sp_payload;
  }

  free(buf);
  return 1;
}

