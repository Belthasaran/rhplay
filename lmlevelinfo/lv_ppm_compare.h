#pragma once

#include <stddef.h>
#include <stdint.h>

#define LV_PPM_GRID_R 206u
#define LV_PPM_GRID_G 200u
#define LV_PPM_GRID_B 204u

#define LV_TILE_CMP_MAX_MISMATCH_LOG 20u

typedef enum {
  LV_TILE_CMP_OK = 0,
  LV_TILE_CMP_ERR_READ = 1,
  LV_TILE_CMP_ERR_DIMENSION = 2,
  LV_TILE_CMP_ERR_MISMATCH = 3,
} LvTileCmpStatus;

typedef struct {
  unsigned w;
  unsigned h;
  size_t tiles_total;
  size_t tiles_matched;
  size_t tiles_mismatched;
  size_t mismatch_pixels_logged;
  LvTileCmpStatus status;
} LvTileCmpReport;

typedef struct {
  const char *mismatch_ppm_path;
  unsigned max_mismatch_log;
} LvTileCmpOpts;

int lv_ppm_read_rgb(const char *path, unsigned *out_w, unsigned *out_h, uint8_t **out_px);

void lv_ppm_draw_gridlines(uint8_t *rgb, unsigned w, unsigned h);

/* Compare two same-size RGB buffers tile-by-tile (16x16). Exact RGB match per pixel. */
LvTileCmpStatus lv_ppm_tile_compare_bufs(const uint8_t *got, const uint8_t *ref, unsigned w, unsigned h,
                                         const LvTileCmpOpts *opts, LvTileCmpReport *report);

/* Load paths and compare; logs LV_TILE_CMP / LV_TILE_MISMATCH to stderr. */
int lv_ppm_tile_compare_files(const char *got_path, const char *ref_path, const LvTileCmpOpts *opts,
                              LvTileCmpReport *report);

void lv_ppm_tile_compare_print_report(const LvTileCmpReport *report, unsigned ref_w, unsigned ref_h);
