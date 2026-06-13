#include "gfx_chr_probe.h"

#include <stdio.h>
#include <string.h>

#include "gfx_route.h"
#include "level_parse.h"
#include "lm_tables.h"
#include "map16_text.h"
#include "romutil.h"

int gfx_chr_probe_muncher_regression(const char *rom_path, const char *ref_ppm, unsigned munch_tx, unsigned munch_ty,
                                   char *err, size_t errcap) {
  (void)ref_ppm;
  (void)munch_tx;
  (void)munch_ty;
  if (!rom_path) {
    if (err && errcap) snprintf(err, errcap, "invalid args");
    return 0;
  }
  static const struct {
    uint8_t file_id;
    uint16_t local;
    int hflip;
    int vflip;
  } expect[4] = {
      {0x1B, 0x000, 0, 1},
      {0x1B, 0x004, 0, 0},
      {0x2A, 0x017, 0, 1},
      {0x1B, 0x004, 1, 0},
  };

  Rom rom;
  if (!rom_load(&rom, rom_path, err, errcap)) return 0;
  LmTables tables;
  if (!lm_resolve_tables(&rom, &tables, err, errcap)) {
    rom_free(&rom);
    return 0;
  }
  LevelInfo info;
  memset(&info, 0, sizeof(info));
  if (!parse_level_info(&rom, &tables, 0x109, &info, err, errcap)) {
    rom_free(&rom);
    return 0;
  }
  LevelGfxRoute route;
  gfx_route_build(&route, &info.primary, info.exgfx_bytes, info.exgfx_len);

  int ok = 1;
  for (int si = 0; si < 4; si++) {
    uint8_t fid = 0;
    uint16_t local = 0;
    if (!gfx_route_resolve_012f_muncher(&route, si, GFX_ROUTE_MODE_BYPASS, &fid, &local)) {
      if (err && errcap) snprintf(err, errcap, "sub=%d resolve_012f_muncher failed", si);
      ok = 0;
      break;
    }
    int hf = 0, vf = 0;
    gfx_route_012f_muncher_blit_flips(si, &hf, &vf);
    if (fid != expect[si].file_id || local != expect[si].local || hf != expect[si].hflip || vf != expect[si].vflip) {
      if (err && errcap) {
        snprintf(err, errcap, "sub=%d route file=0x%02X local=0x%03X hf=%d vf=%d expect file=0x%02X local=0x%03X hf=%d vf=%d", si,
                 (unsigned)fid, (unsigned)local, hf, vf, (unsigned)expect[si].file_id, (unsigned)expect[si].local,
                 expect[si].hflip, expect[si].vflip);
      }
      ok = 0;
      break;
    }
  }

  levelinfo_free(&info);
  rom_free(&rom);
  return ok;
}
