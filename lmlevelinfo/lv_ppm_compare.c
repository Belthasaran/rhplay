#include "lv_ppm_compare.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int lv_ppm_read_rgb(const char *path, unsigned *out_w, unsigned *out_h, uint8_t **out_px) {
  if (!path || !out_w || !out_h || !out_px) return 0;
  *out_px = NULL;
  FILE *pf = fopen(path, "rb");
  if (!pf) return 0;
  char magic[8];
  if (!fgets(magic, sizeof(magic), pf) || strncmp(magic, "P6", 2) != 0) {
    fclose(pf);
    return 0;
  }
  char dimline[64];
  if (!fgets(dimline, sizeof(dimline), pf)) {
    fclose(pf);
    return 0;
  }
  unsigned pw = 0, ph = 0;
  if (sscanf(dimline, "%u %u", &pw, &ph) != 2) {
    fclose(pf);
    return 0;
  }
  char maxline[32];
  if (!fgets(maxline, sizeof(maxline), pf)) {
    fclose(pf);
    return 0;
  }
  size_t npix = (size_t)pw * (size_t)ph;
  uint8_t *px = (uint8_t *)malloc(npix * 3u);
  if (!px || fread(px, 1, npix * 3u, pf) != npix * 3u) {
    free(px);
    fclose(pf);
    return 0;
  }
  fclose(pf);
  *out_w = pw;
  *out_h = ph;
  *out_px = px;
  return 1;
}

void lv_ppm_draw_gridlines(uint8_t *rgb, unsigned w, unsigned h) {
  if (!rgb || w == 0 || h == 0) return;
  for (unsigned y = 0; y < h; y++) {
    for (unsigned x = 0; x < w; x++) {
      if ((x & 15u) != 15u && (y & 15u) != 15u) continue;
      /* Corner (15,15) per tile is finished in lv_ppm_draw_grid_corners. */
      if ((x & 15u) == 15u && (y & 15u) == 15u) continue;
      size_t o = ((size_t)y * (size_t)w + (size_t)x) * 3u;
      rgb[o + 0] = LV_PPM_GRID_R;
      rgb[o + 1] = LV_PPM_GRID_G;
      rgb[o + 2] = LV_PPM_GRID_B;
    }
  }
}

void lv_ppm_draw_grid_corners(uint8_t *rgb, unsigned w, unsigned h, uint8_t back_r, uint8_t back_g,
                              uint8_t back_b) {
  if (!rgb || w < 16u || h < 16u) return;
  (void)back_r;
  (void)back_g;
  (void)back_b;
  unsigned tiles_x = w / 16u;
  unsigned tiles_y = h / 16u;
  for (unsigned ty = 0; ty < tiles_y; ty++) {
    for (unsigned tx = 0; tx < tiles_x; tx++) {
      unsigned x = tx * 16u + 15u;
      unsigned y = ty * 16u + 15u;
      size_t o = ((size_t)y * (size_t)w + (size_t)x) * 3u;
      rgb[o + 0] = LV_PPM_GRID_CORNER_R;
      rgb[o + 1] = LV_PPM_GRID_CORNER_G;
      rgb[o + 2] = LV_PPM_GRID_CORNER_B;
    }
  }
}

static int write_ppm_rgb(const char *path, const uint8_t *rgb, unsigned w, unsigned h) {
  if (!path || !rgb || w == 0 || h == 0) return 0;
  FILE *fp = fopen(path, "wb");
  if (!fp) return 0;
  fprintf(fp, "P6\n%u %u\n255\n", w, h);
  size_t n = (size_t)w * (size_t)h * 3u;
  int ok = fwrite(rgb, 1, n, fp) == n;
  fclose(fp);
  return ok;
}

static void report_init(LvTileCmpReport *report, unsigned w, unsigned h) {
  if (!report) return;
  memset(report, 0, sizeof(*report));
  report->w = w;
  report->h = h;
  if (w >= 16 && h >= 16) {
    report->tiles_total = (size_t)(w / 16u) * (size_t)(h / 16u);
  }
}

void lv_ppm_tile_compare_print_report(const LvTileCmpReport *report, unsigned ref_w, unsigned ref_h) {
  if (!report) return;
  if (report->status == LV_TILE_CMP_ERR_DIMENSION) {
    fprintf(stderr, "LV_TILE_CMP error=dimension_mismatch our=%ux%u ref=%ux%u\n", report->w, report->h, ref_w, ref_h);
    return;
  }
  if (report->status == LV_TILE_CMP_ERR_READ) {
    fprintf(stderr, "LV_TILE_CMP error=ppm_read_failed\n");
    return;
  }
  fprintf(stderr, "LV_TILE_CMP size=%ux%u tiles=%zu matched=%zu mismatched=%zu\n", report->w, report->h,
          report->tiles_total, report->tiles_matched, report->tiles_mismatched);
}

LvTileCmpStatus lv_ppm_tile_compare_bufs(const uint8_t *got, const uint8_t *ref, unsigned w, unsigned h,
                                         const LvTileCmpOpts *opts, LvTileCmpReport *report) {
  if (!got || !ref || !report) return LV_TILE_CMP_ERR_READ;
  report_init(report, w, h);

  unsigned max_log = opts ? opts->max_mismatch_log : LV_TILE_CMP_MAX_MISMATCH_LOG;
  if (max_log == 0) max_log = LV_TILE_CMP_MAX_MISMATCH_LOG;

  uint8_t *diff = NULL;
  if (opts && opts->mismatch_ppm_path && opts->mismatch_ppm_path[0]) {
    diff = (uint8_t *)malloc((size_t)w * (size_t)h * 3u);
    if (diff) {
      for (size_t i = 0; i < (size_t)w * (size_t)h; i++) {
        size_t o = i * 3u;
        diff[o + 0] = got[o + 0];
        diff[o + 1] = got[o + 1];
        diff[o + 2] = got[o + 2];
      }
    }
  }

  if (w < 16 || h < 16 || (w % 16) != 0 || (h % 16) != 0) {
    fprintf(stderr, "LV_TILE_CMP error=invalid_canvas_size %ux%u (must be multiple of 16)\n", w, h);
    free(diff);
    report->status = LV_TILE_CMP_ERR_MISMATCH;
    return report->status;
  }

  unsigned tiles_x = w / 16u;
  unsigned tiles_y = h / 16u;

  for (unsigned ty = 0; ty < tiles_y; ty++) {
    for (unsigned tx = 0; tx < tiles_x; tx++) {
      int tile_ok = 1;
      for (unsigned py = 0; py < 16u && tile_ok; py++) {
        for (unsigned px = 0; px < 16u; px++) {
          unsigned x = tx * 16u + px;
          unsigned y = ty * 16u + py;
          size_t o = ((size_t)y * (size_t)w + (size_t)x) * 3u;
          if (got[o + 0] != ref[o + 0] || got[o + 1] != ref[o + 1] || got[o + 2] != ref[o + 2]) {
            tile_ok = 0;
            if (diff) {
              diff[o + 0] = 255u;
              diff[o + 1] = 0;
              diff[o + 2] = 0;
            }
            if (report->mismatch_pixels_logged < max_log) {
              fprintf(stderr,
                      "LV_TILE_MISMATCH tx=%u ty=%u px=%u py=%u got_rgb=%u,%u,%u ref_rgb=%u,%u,%u\n", tx, ty, px, py,
                      (unsigned)got[o + 0], (unsigned)got[o + 1], (unsigned)got[o + 2], (unsigned)ref[o + 0],
                      (unsigned)ref[o + 1], (unsigned)ref[o + 2]);
              report->mismatch_pixels_logged++;
            }
            break;
          }
        }
      }
      if (tile_ok) {
        report->tiles_matched++;
      } else {
        report->tiles_mismatched++;
      }
    }
  }

  if (opts && opts->mismatch_ppm_path && opts->mismatch_ppm_path[0] && diff) {
    if (!write_ppm_rgb(opts->mismatch_ppm_path, diff, w, h)) {
      fprintf(stderr, "LV_TILE_CMP warning=failed_writing_mismatch_ppm path=%s\n", opts->mismatch_ppm_path);
    }
  }
  free(diff);

  report->status = report->tiles_mismatched == 0 ? LV_TILE_CMP_OK : LV_TILE_CMP_ERR_MISMATCH;
  return report->status;
}

int lv_ppm_tile_compare_files(const char *got_path, const char *ref_path, const LvTileCmpOpts *opts,
                              LvTileCmpReport *report) {
  if (!got_path || !ref_path || !report) return 0;

  unsigned gw = 0, gh = 0, rw = 0, rh = 0;
  uint8_t *got = NULL;
  uint8_t *ref = NULL;

  if (!lv_ppm_read_rgb(got_path, &gw, &gh, &got)) {
    report_init(report, 0, 0);
    report->status = LV_TILE_CMP_ERR_READ;
    lv_ppm_tile_compare_print_report(report, 0, 0);
    return 0;
  }
  if (!lv_ppm_read_rgb(ref_path, &rw, &rh, &ref)) {
    free(got);
    report_init(report, gw, gh);
    report->status = LV_TILE_CMP_ERR_READ;
    lv_ppm_tile_compare_print_report(report, rw, rh);
    return 0;
  }

  if (gw != rw || gh != rh) {
    report_init(report, gw, gh);
    report->status = LV_TILE_CMP_ERR_DIMENSION;
    lv_ppm_tile_compare_print_report(report, rw, rh);
    free(got);
    free(ref);
    return 0;
  }

  LvTileCmpStatus st = lv_ppm_tile_compare_bufs(got, ref, gw, gh, opts, report);
  lv_ppm_tile_compare_print_report(report, rw, rh);
  free(got);
  free(ref);
  return st == LV_TILE_CMP_OK;
}
