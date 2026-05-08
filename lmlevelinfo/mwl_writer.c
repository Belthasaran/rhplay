#include "mwl_writer.h"

#include <string.h>

static void write_u32le(FILE *fp, uint32_t v) {
  fputc((int)(v & 0xFF), fp);
  fputc((int)((v >> 8) & 0xFF), fp);
  fputc((int)((v >> 16) & 0xFF), fp);
  fputc((int)((v >> 24) & 0xFF), fp);
}

int mwl_write_minimal(FILE *fp, const LevelInfo *info, const LmTables *tables, const Rom *rom) {
  (void)tables;
  if (!fp || !info || !rom) return 0;

  // MWL header: 0x40 bytes
  // "LM" + version (2 bytes). We don't know exact LM version; use 0x0000.
  // Next: pointer list offset (u32) and pointer bytes length (u32).
  // We'll place pointer list immediately after header: offset 0x40, length 0x40.
  // Then 4 bytes flags (0) and 48-byte title string.
  uint8_t header[0x40];
  memset(header, 0, sizeof(header));
  header[0] = 'L';
  header[1] = 'M';
  // version u16 at [2..3] = 0x0363 (LM 3.63)
  header[2] = 0x63;
  header[3] = 0x03;
  // pointer list offset u32 at [4..7] = 0x40
  header[4] = 0x40;
  // pointer bytes u32 at [8..11] = 0x40
  header[8] = 0x40;
  // flags at [12..15] = 0
  const char *tag =
    "Lunar Magic x.xx\0"
    "  @yyyy Fusoya  \0"
    "Defender of Relm\0";
  memcpy(&header[16], tag, 48);
  if (fwrite(header, 1, sizeof(header), fp) != sizeof(header)) return 0;

  // Pointer list: 8 pointers, each 8 bytes: (offset u32, size u32)
  // We'll write data sections consecutively after pointer list.
  const uint32_t ptr_list_off = 0x40;
  const uint32_t ptr_list_len = 0x40;
  (void)ptr_list_off;
  (void)ptr_list_len;

  // Precompute section payloads:
  // Section 1: Level information (we keep it 0x40 bytes like LM tends to do, but format allows padding)
  uint8_t level_info[0x40];
  memset(level_info, 0, sizeof(level_info));
  // First two bytes: source level number (little endian)
  level_info[0] = (uint8_t)(info->level_id & 0xFF);
  level_info[1] = (uint8_t)((info->level_id >> 8) & 0xFF);
  // Next: first five bytes of secondary header (MWL doc); we approximate with our b1..b5.
  level_info[2] = info->secondary.b1;
  level_info[3] = info->secondary.b2;
  level_info[4] = info->secondary.b3;
  level_info[5] = info->secondary.b4;
  level_info[6] = info->secondary.b5;
  // 2 bytes padding at [7..8] already zero.
  // Midway tables (4 bytes) + a fifth unused byte. We don't currently extract those ROM tables directly here.
  // Leave zeros.
  // Additional 3 bytes from secondary header: $06FC00/$06FE00 + expanded table byte.
  // We'll store b7,b8,b6 respectively (best-effort).
  level_info[16] = info->secondary.b7;
  level_info[17] = info->secondary.b8;
  level_info[18] = info->secondary.b6;

  // Section 2: Layer1 data = 8-byte header + raw blob from ROM.
  // MWL doc says bytes 4-6 in header are original source address; we store the SNES pointer.
  uint8_t l1hdr[8];
  memset(l1hdr, 0, sizeof(l1hdr));
  // byte0: bit0 indicates custom palette (unknown here); leave 0.
  // bytes4-6: source address (24-bit)
  l1hdr[4] = (uint8_t)(info->layer1_data_ptr_snes & 0xFF);
  l1hdr[5] = (uint8_t)((info->layer1_data_ptr_snes >> 8) & 0xFF);
  l1hdr[6] = (uint8_t)((info->layer1_data_ptr_snes >> 16) & 0xFF);

  // Section 4: palette (if present) = 8-byte header + payload
  uint8_t palhdr[8];
  memset(palhdr, 0, sizeof(palhdr));
  if (info->palette_present) {
    memcpy(palhdr, info->palette_header8, 8);
  }

  // Section 5: secondary entrances (if present) = 8-byte header + payload
  uint8_t sehdr[8];
  memset(sehdr, 0, sizeof(sehdr));
  if (info->secondary_entrances_present) {
    memcpy(sehdr, info->secondary_entrances_header8, 8);
  }

  // Section 6: exanim (if present) = 8-byte header + payload
  uint8_t exh[8];
  memset(exh, 0, sizeof(exh));
  if (info->exanim_present) {
    memcpy(exh, info->exanim_header8, 8);
  }

  // For blob: find pc offset and length from parsing.
  uint32_t pc = info->layer1_blob.pc_offset;
  size_t len = info->layer1_blob.len;
  if (pc + len > rom->size) return 0;

  // Layout file:
  // header (0x40) + ptrlist (0x40) + sections...
  uint32_t cur_off = 0x80;

  // Build pointer entries
  struct Ptr { uint32_t off; uint32_t size; } ptrs[8];
  for (int i = 0; i < 8; i++) { ptrs[i].off = 0; ptrs[i].size = 0; }

  // 1) level info
  ptrs[0].off = cur_off;
  ptrs[0].size = (uint32_t)sizeof(level_info);
  cur_off += (uint32_t)sizeof(level_info);

  // 2) layer1 data
  ptrs[1].off = cur_off;
  ptrs[1].size = (uint32_t)(sizeof(l1hdr) + len);
  cur_off += ptrs[1].size;

  // 3) layer2 data (not yet available for writing in this tool)
  // ptrs[2] = 0

  // 4) sprites (not yet available for writing in this tool)
  // ptrs[3] = 0

  // 5) palette
  if (info->palette_present && info->palette_bytes && info->palette_len) {
    ptrs[4].off = cur_off;
    ptrs[4].size = (uint32_t)(sizeof(palhdr) + info->palette_len);
    cur_off += ptrs[4].size;
  }

  // 6) secondary entrances
  if (info->secondary_entrances_present && info->secondary_entrances_bytes && info->secondary_entrances_len) {
    ptrs[5].off = cur_off;
    ptrs[5].size = (uint32_t)(sizeof(sehdr) + info->secondary_entrances_len);
    cur_off += ptrs[5].size;
  }

  // 7) exanim
  if (info->exanim_present && info->exanim_bytes && info->exanim_len) {
    ptrs[6].off = cur_off;
    ptrs[6].size = (uint32_t)(sizeof(exh) + info->exanim_len);
    cur_off += ptrs[6].size;
  }

  // 8) exgfx/bypass (payload only)
  if (info->exgfx_present && info->exgfx_bytes && info->exgfx_len) {
    ptrs[7].off = cur_off;
    ptrs[7].size = (uint32_t)info->exgfx_len;
    cur_off += ptrs[7].size;
  }

  // write pointer list now
  for (int i = 0; i < 8; i++) {
    write_u32le(fp, ptrs[i].off);
    write_u32le(fp, ptrs[i].size);
  }

  // write sections
  if (fwrite(level_info, 1, sizeof(level_info), fp) != sizeof(level_info)) return 0;
  if (fwrite(l1hdr, 1, sizeof(l1hdr), fp) != sizeof(l1hdr)) return 0;
  if (fwrite(rom->data + pc, 1, len, fp) != len) return 0;

  if (ptrs[4].off) {
    if (fwrite(palhdr, 1, sizeof(palhdr), fp) != sizeof(palhdr)) return 0;
    if (fwrite(info->palette_bytes, 1, info->palette_len, fp) != info->palette_len) return 0;
  }
  if (ptrs[5].off) {
    if (fwrite(sehdr, 1, sizeof(sehdr), fp) != sizeof(sehdr)) return 0;
    if (fwrite(info->secondary_entrances_bytes, 1, info->secondary_entrances_len, fp) != info->secondary_entrances_len) return 0;
  }
  if (ptrs[6].off) {
    if (fwrite(exh, 1, sizeof(exh), fp) != sizeof(exh)) return 0;
    if (fwrite(info->exanim_bytes, 1, info->exanim_len, fp) != info->exanim_len) return 0;
  }
  if (ptrs[7].off) {
    if (fwrite(info->exgfx_bytes, 1, info->exgfx_len, fp) != info->exgfx_len) return 0;
  }

  // Done. No trailing requirement.
  return 1;
}

