#pragma once

#include <stddef.h>
#include <stdint.h>

#define LV_PPM_GRID_R 206u
#define LV_PPM_GRID_G 200u
#define LV_PPM_GRID_B 204u
/* LM tile-grid export paints a light corner dot at each 16x16 tile (15,15), not the grid line color. */
#define LV_PPM_GRID_CORNER_R 241u
#define LV_PPM_GRID_CORNER_G 240u
#define LV_PPM_GRID_CORNER_B 241u

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

void lv_ppm_draw_gridlines(uint8_t *rgb, unsigned w, unsigned h, uint8_t back_r, uint8_t back_g, uint8_t back_b);

void lv_ppm_draw_grid_corners(uint8_t *rgb, unsigned w, unsigned h, uint8_t back_r, uint8_t back_g,
                              uint8_t back_b);

/* Compare two same-size RGB buffers tile-by-tile (16x16). Exact RGB match per pixel. */
LvTileCmpStatus lv_ppm_tile_compare_bufs(const uint8_t *got, const uint8_t *ref, unsigned w, unsigned h,
                                         const LvTileCmpOpts *opts, LvTileCmpReport *report);

/* Load paths and compare; logs LV_TILE_CMP / LV_TILE_MISMATCH to stderr. */
int lv_ppm_tile_compare_files(const char *got_path, const char *ref_path, const LvTileCmpOpts *opts,
                              LvTileCmpReport *report);

void lv_ppm_tile_compare_print_report(const LvTileCmpReport *report, unsigned ref_w, unsigned ref_h);

/* Compare one 16x16 tile; return 1 if mismatch pixel count <= max_diff_pixels. */
int lv_ppm_spot_tile_match(const char *got_path, const char *ref_path, unsigned tx, unsigned ty,
                           unsigned max_diff_pixels);

/* Compare one 8x8 sub-corner within a 16x16 tile (corner 0=TL,1=TR,2=BL,3=BR). */
int lv_ppm_spot_sub8_match(const char *got_path, const char *ref_path, unsigned tx, unsigned ty, int corner,
                           unsigned max_diff_pixels);

/* Log all four 8x8 corners for a Map16 tile (LV_SPOT_SUB8). */
void lv_ppm_report_spot_sub8_tiles(const char *got_path, const char *ref_path, unsigned tx, unsigned ty);

/* Log per-tile OK/mismatch for akogare 0x109 std 0x27 pipe stack (screen 4 cols 7-8, rows A-G). */
void lv_ppm_report_pipe_stack_tiles(const char *got_path, const char *ref_path);
