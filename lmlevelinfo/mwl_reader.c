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
  free(p->layer2.bytes);
  p->layer2.bytes = NULL;
  p->layer2.len = 0;
  p->layer2.present = 0;
  free(p->palette.bytes);
  p->palette.bytes = NULL;
  p->palette.len = 0;
  p->palette.present = 0;
  free(p->sec_entrances.bytes);
  p->sec_entrances.bytes = NULL;
  p->sec_entrances.len = 0;
  p->sec_entrances.present = 0;
  free(p->exanim.bytes);
  p->exanim.bytes = NULL;
  p->exanim.len = 0;
  p->exanim.present = 0;
  free(p->exgfx.bytes);
  p->exgfx.bytes = NULL;
  p->exgfx.len = 0;
  p->exgfx.present = 0;
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
  out->level.present_midway = 0;

  // Per MWL doc (LM v2.53): b5 is stored as the 5th secondary header byte.
  if (s1.size >= 7) {
    out->level.present_sec_b5 = 1;
    out->level.sec_b5 = lvl[6];
  }

  // Midway table bytes: after secondary bytes + 2 unused bytes.
  // Layout: [0..1]=level_id, [2..6]=sec b1..b5, [7..8]=unused, [9..12]=midway bytes, [13]=unused.
  if (s1.size >= 13) {
    out->level.present_midway = 1;
    out->level.midway_b1 = lvl[9];
    out->level.midway_b2 = lvl[10];
    out->level.midway_b3 = lvl[11];
    out->level.midway_b4 = lvl[12];
  }

  // MWL doc: additional 3 bytes follow later:
  //   two from $06FC00 and $06FE00,
  //   and one from an expanded level data table.
  // The doc text describes offsets, but LM has evolved; for v1 tests we treat them as optional.
  if (s1.size >= 19) {
    out->level.sec_b7 = lvl[16];
    out->level.sec_b8 = lvl[17];
    out->level.sec_b6 = lvl[18];
    out->level.present_sec_b6 = 1;
    out->level.present_sec_b7 = 1;
    out->level.present_sec_b8 = 1;
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

  // Section 2b: Layer 2 data (MWL pointer index 2)
  // We keep the raw payload and store the 8-byte header (byte0 is $0EF310 value).
  MwlPtr s2b = out->file.ptrs[2];
  out->layer2.present = 0;
  memset(out->layer2.header, 0, sizeof(out->layer2.header));
  out->layer2.bytes = NULL;
  out->layer2.len = 0;
  if (s2b.off != 0) {
    if (s2b.size < 8 || s2b.off + s2b.size > len) {
      free(buf);
      seterr(err, errcap, "MWL Layer 2 section invalid");
      return 0;
    }
    const uint8_t *l2 = buf + s2b.off;
    memcpy(out->layer2.header, l2, 8);
    size_t l2_payload = s2b.size - 8;
    out->layer2.bytes = (uint8_t *)malloc(l2_payload ? l2_payload : 1);
    if (!out->layer2.bytes) {
      free(buf);
      seterr(err, errcap, "Out of memory copying Layer 2 data");
      return 0;
    }
    if (l2_payload) memcpy(out->layer2.bytes, l2 + 8, l2_payload);
    out->layer2.len = l2_payload;
    out->layer2.present = 1;
  }

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

  // Section 4: Palette data (MWL pointer index 4)
  // 8-byte header + payload of 16-bit SNES RGB values.
  MwlPtr s4 = out->file.ptrs[4];
  out->palette.present = 0;
  memset(out->palette.header, 0, sizeof(out->palette.header));
  out->palette.bytes = NULL;
  out->palette.len = 0;
  if (s4.off != 0) {
    if (s4.size < 8 || s4.off + s4.size > len) {
      free(buf);
      seterr(err, errcap, "MWL Palette section invalid");
      return 0;
    }
    const uint8_t *pal = buf + s4.off;
    memcpy(out->palette.header, pal, 8);
    size_t pal_payload = s4.size - 8;
    out->palette.bytes = (uint8_t *)malloc(pal_payload ? pal_payload : 1);
    if (!out->palette.bytes) {
      free(buf);
      seterr(err, errcap, "Out of memory copying Palette data");
      return 0;
    }
    if (pal_payload) memcpy(out->palette.bytes, pal + 8, pal_payload);
    out->palette.len = pal_payload;
    out->palette.present = 1;
  }

  // Section 5: Secondary entrances (MWL pointer index 5)
  // 8-byte header + N * 8 bytes.
  MwlPtr s5 = out->file.ptrs[5];
  out->sec_entrances.present = 0;
  memset(out->sec_entrances.header, 0, sizeof(out->sec_entrances.header));
  out->sec_entrances.bytes = NULL;
  out->sec_entrances.len = 0;
  if (s5.off != 0) {
    if (s5.size < 8 || s5.off + s5.size > len) {
      free(buf);
      seterr(err, errcap, "MWL Secondary entrances section invalid");
      return 0;
    }
    const uint8_t *se = buf + s5.off;
    memcpy(out->sec_entrances.header, se, 8);
    size_t se_payload = s5.size - 8;
    out->sec_entrances.bytes = (uint8_t *)malloc(se_payload ? se_payload : 1);
    if (!out->sec_entrances.bytes) {
      free(buf);
      seterr(err, errcap, "Out of memory copying Secondary entrances data");
      return 0;
    }
    if (se_payload) memcpy(out->sec_entrances.bytes, se + 8, se_payload);
    out->sec_entrances.len = se_payload;
    out->sec_entrances.present = 1;
  }

  // Section 6: ExAnimation (MWL pointer index 6)
  // 8-byte header + raw bytes.
  MwlPtr s6 = out->file.ptrs[6];
  out->exanim.present = 0;
  memset(out->exanim.header, 0, sizeof(out->exanim.header));
  out->exanim.bytes = NULL;
  out->exanim.len = 0;
  if (s6.off != 0) {
    if (s6.size < 8 || s6.off + s6.size > len) {
      free(buf);
      seterr(err, errcap, "MWL ExAnimation section invalid");
      return 0;
    }
    const uint8_t *ex = buf + s6.off;
    memcpy(out->exanim.header, ex, 8);
    size_t ex_payload = s6.size - 8;
    out->exanim.bytes = (uint8_t *)malloc(ex_payload ? ex_payload : 1);
    if (!out->exanim.bytes) {
      free(buf);
      seterr(err, errcap, "Out of memory copying ExAnimation data");
      return 0;
    }
    if (ex_payload) memcpy(out->exanim.bytes, ex + 8, ex_payload);
    out->exanim.len = ex_payload;
    out->exanim.present = 1;
  }

  // Section 7: ExGFX and bypass info (MWL pointer index 7)
  // No 8-byte header per doc; payload is at least 16 u16 values.
  MwlPtr s7 = out->file.ptrs[7];
  out->exgfx.present = 0;
  out->exgfx.bytes = NULL;
  out->exgfx.len = 0;
  if (s7.off != 0) {
    if (s7.size == 0 || s7.off + s7.size > len) {
      free(buf);
      seterr(err, errcap, "MWL ExGFX/bypass section invalid");
      return 0;
    }
    const uint8_t *eg = buf + s7.off;
    out->exgfx.bytes = (uint8_t *)malloc(s7.size ? s7.size : 1);
    if (!out->exgfx.bytes) {
      free(buf);
      seterr(err, errcap, "Out of memory copying ExGFX/bypass data");
      return 0;
    }
    memcpy(out->exgfx.bytes, eg, s7.size);
    out->exgfx.len = s7.size;
    out->exgfx.present = 1;
  }

  free(buf);
  return 1;
}

