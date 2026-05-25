#include "sprite_draw.h"

#include <stdio.h>
#include <string.h>

#include "gfx_reader.h"
#include "gfx_route.h"

typedef struct {
  int8_t x;
  int8_t y;
  uint8_t tile;
  uint8_t pal_sub;
  uint8_t hflip;
  uint8_t vflip;
} SpriteTilePart;

typedef struct {
  uint8_t sprite_id;
  uint8_t sp_slot;
  uint8_t n;
  SpriteTilePart parts[16];
} SpriteGfxDef;

// snesrev draw tables; OAM palette in low bits of Prop -> pal_sub (row offset within 8-11).
static const SpriteGfxDef kSpriteGfxTable[] = {
    {0xBA, GFX_SLOT_SP2, 3,
     {{0, 0, 0xB4, 0, 0, 0}, {0x10, 0, 0xB5, 0, 0, 0}, {0xC, 0x4, 0xC4, 0, 0, 0}}},
    {0xAB, GFX_SLOT_SP2, 4,
     {{0xFC, 0xF1, 0x8A, 3, 0, 0},
      {0, 0, 0xAA, 1, 0, 0},
      {0, 0, 0x8C, 1, 0, 0},
      {0, 0, 0xA8, 0, 0, 0}}},
    {0x35, GFX_SLOT_SP2, 2,
     {{0, 0, 0x5D, 2, 0, 0}, {0, 0, 0xC6, 2, 0, 0}}},
    {0x9F, GFX_SLOT_SP2, 4,
     {{0, 0, 0x80, 3, 0, 0},
      {0x10, 0, 0x82, 3, 0, 0},
      {0, 0x10, 0xA0, 3, 0, 0},
      {0x10, 0x10, 0x88, 3, 0, 0}}},
    {0x4F, GFX_SLOT_SP2, 2,
     {{0, 0, 0xA6, 0, 0, 0}, {0, 0, 0xA8, 0, 0, 0}}},
    {0xC4, GFX_SLOT_SP2, 4,
     {{0, 0, 0x60, 0, 0, 0},
      {0x10, 0, 0x61, 0, 0, 0},
      {0x20, 0, 0x61, 0, 0, 0},
      {0x30, 0, 0x62, 0, 0, 0}}},
    {0x7B, GFX_SLOT_SP2, 1, {{0, 0, 0x24, 0, 0, 0}}},
    {0x7C, GFX_SLOT_SP2, 1, {{0, 0, 0x24, 0, 0, 0}}},
    {0xC5, GFX_SLOT_SP2, 1, {{0, 0, 0x60, 0, 0, 0}}},
    {0xC6, GFX_SLOT_SP2, 1, {{0, 0, 0x62, 0, 0, 0}}},
    {0xC7, GFX_SLOT_SP2, 1, {{0, 0, 0x64, 0, 0, 0}}},
    {0xD8, GFX_SLOT_SP2, 1, {{0, 0, 0x00, 0, 0, 0}}},
    {0xE0, GFX_SLOT_SP2, 2, {{0, 0, 0x88, 0, 0, 0}, {0, 0, 0x8A, 0, 0, 0}}},
    {0xE6, GFX_SLOT_SP2, 1, {{0, 0, 0x3C, 0, 0, 0}}},
    {0xE7, GFX_SLOT_SP2, 1, {{0, 0, 0x3E, 0, 0, 0}}},
    {0xDB, GFX_SLOT_SP2, 1, {{0, 0, 0xA0, 0, 0, 0}}},
    {0xDC, GFX_SLOT_SP2, 1, {{0, 0, 0xA2, 0, 0, 0}}},
    {0xDD, GFX_SLOT_SP2, 1, {{0, 0, 0xA4, 0, 0, 0}}},
    {0xDF, GFX_SLOT_SP2, 1, {{0, 0, 0xA6, 0, 0, 0}}},
};

static void blit_tile8(uint8_t *rgb, uint32_t w, uint32_t h, uint32_t x0, uint32_t y0, const uint8_t px64[64],
                       const uint8_t pal_rgb[16][3], int hflip, int vflip) {
  for (uint32_t yy = 0; yy < 8; yy++) {
    uint32_t y = y0 + yy;
    if (y >= h) continue;
    for (uint32_t xx = 0; xx < 8; xx++) {
      uint32_t x = x0 + xx;
      if (x >= w) continue;
      uint32_t sx = (uint32_t)(hflip ? (7 - (int)xx) : (int)xx);
      uint32_t sy = (uint32_t)(vflip ? (7 - (int)yy) : (int)yy);
      uint8_t c = px64[sy * 8 + sx] & 0x0F;
      if (c == 0) continue;
      uint32_t idx = (y * w + x) * 3u;
      rgb[idx + 0] = pal_rgb[c][0];
      rgb[idx + 1] = pal_rgb[c][1];
      rgb[idx + 2] = pal_rgb[c][2];
    }
  }
}

static void draw_marker(uint8_t *rgb, uint32_t w, uint32_t h, uint32_t x0, uint32_t y0) {
  for (uint32_t dy = 0; dy < 14 && y0 + dy < h; dy++) {
    for (uint32_t dx = 0; dx < 14 && x0 + dx < w; dx++) {
      int edge = (dy == 0 || dx == 0 || dy == 13 || dx == 13);
      if (!edge) continue;
      uint32_t idx = ((y0 + dy) * w + (x0 + dx)) * 3u;
      rgb[idx + 0] = 0;
      rgb[idx + 1] = 200;
      rgb[idx + 2] = 0;
    }
  }
}

static const SpriteGfxDef *lookup_sprite_def(uint8_t sprite_id) {
  for (size_t i = 0; i < sizeof(kSpriteGfxTable) / sizeof(kSpriteGfxTable[0]); i++) {
    if (kSpriteGfxTable[i].sprite_id == sprite_id) return &kSpriteGfxTable[i];
  }
  return NULL;
}

static int decode_sprite_tile(Rom *rom, GfxCache *gfxc, uint8_t file_id, uint16_t local_tile, uint8_t out_px64[64],
                              char *err, size_t errcap) {
  const GfxBlob *gfx = NULL;
  if (!gfxcache_get(rom, gfxc, file_id, &gfx, err, errcap) || !gfx || !gfx->bytes || !gfx->len) {
    return -1;
  }
  if (!snes4bpp_decode_tile(gfx->bytes, gfx->len, local_tile, out_px64)) {
    return -2;
  }
  return 0;
}

void sprite_draw_stats_reset(SpriteDrawStats *s) {
  if (!s) return;
  memset(s, 0, sizeof(*s));
}

void sprite_draw_stats_print_line(const SpriteDrawStats *s) {
  if (!s) return;
  fprintf(stderr, "LV_SPRITE_STATS drawn=%zu unknown=%zu gfx_miss=%zu total=%zu\n", s->sprites_drawn,
          s->sprites_unknown, s->sprites_gfx_miss, s->sprites_total);
}

void sprite_draw_pal_row_hist_print(const SpriteDrawCtx *ctx, FILE *fp) {
  if (!ctx || !fp) return;
  for (int row = 0; row < 16; row++) {
    if (ctx->pal_row_subtiles[row]) {
      fprintf(fp, "LV_REPORT_PAL_ROW layer=sprites row=%d subtiles=%zu\n", row, ctx->pal_row_subtiles[row]);
    }
  }
}

static int sprite_px64_has_opaque(const uint8_t px64[64]) {
  for (int i = 0; i < 64; i++) {
    if ((px64[i] & 0x0F) != 0) return 1;
  }
  return 0;
}

static int sprite_slot_map16_page(int slot_index) {
  if (slot_index == GFX_SLOT_SP1) return GFX_MAP16_PAGE_SP1;
  if (slot_index == GFX_SLOT_SP2) return GFX_MAP16_PAGE_SP2;
  if (slot_index == GFX_SLOT_FG1) return GFX_MAP16_PAGE_FG1;
  if (slot_index == GFX_SLOT_FG2) return GFX_MAP16_PAGE_FG2;
  return -1;
}

static uint8_t sprite_resolve_file_id(SpriteDrawCtx *ctx, const SpriteGfxDef *def) {
  uint8_t file_id =
      gfx_route_file_for_sprite_slot_mode(ctx->gfx_route, def->sp_slot, ctx->gfx_route_mode);
  if (file_id == 0 && ctx->gfx_route) {
    int page = sprite_slot_map16_page(def->sp_slot);
    if (page >= 0) {
      file_id = gfx_route_file_for_tile_mode(ctx->gfx_route, (uint16_t)((unsigned)page << 8),
                                             ctx->gfx_route_mode);
    }
    if (file_id == 0) {
      file_id = ctx->gfx_route->file_id_for_page[GFX_MAP16_PAGE_SP2];
    }
  }
  if (file_id == 0) file_id = 0x17;
  return file_id;
}

static void draw_sprite_parts(SpriteDrawCtx *ctx, const SpriteGfxDef *def, const LevelSprite *sp) {
  if (!ctx || !def || !sp) return;
  uint8_t file_id = sprite_resolve_file_id(ctx, def);
  int map_page = sprite_slot_map16_page(def->sp_slot);

  uint32_t base_x = (uint32_t)sp->screen * 256u + (uint32_t)sp->x * 16u;
  uint32_t base_y = (uint32_t)sp->y * 16u;
  uint8_t pal_line = (uint8_t)(8u + ((ctx->sprite_pal_base + (sp->extra_bits & 3u)) & 7u));

  if (ctx->print_report) {
    fprintf(stderr,
            "LV_REPORT_SPRITE id=0x%02X slot=%s file=0x%02X pal_line=%u sprite_gfx=%u sprite_pal=%u\n",
            (unsigned)sp->sprite_id, gfx_route_slot_name(def->sp_slot), (unsigned)file_id,
            (unsigned)pal_line, (unsigned)ctx->sprite_gfx, (unsigned)ctx->sprite_pal_base);
  }

  int any = 0;
  for (uint8_t ti = 0; ti < def->n; ti++) {
    const SpriteTilePart *p = &def->parts[ti];
    uint8_t palrgb[16][3];
    uint8_t sub = (uint8_t)((pal_line + (p->pal_sub & 3u)) & 0x0F);
    if (sub < 16) ctx->pal_row_subtiles[sub]++;
    for (int c = 0; c < 16; c++) {
      int idx = (int)sub * 16 + c;
      palrgb[c][0] = ctx->pal256[idx & 0xFF][0];
      palrgb[c][1] = ctx->pal256[idx & 0xFF][1];
      palrgb[c][2] = ctx->pal256[idx & 0xFF][2];
    }

    uint8_t px64[64];
    uint16_t local = (uint16_t)(p->tile & 0x7Fu);
    uint8_t used_file = file_id;
    int ok = decode_sprite_tile(ctx->rom, ctx->gfxc, file_id, local, px64, ctx->err, ctx->errcap) == 0;
    if (ok && ctx->gfx_route_mode == GFX_ROUTE_MODE_TRY_BOTH && ctx->gfx_route && !sprite_px64_has_opaque(px64) &&
        map_page >= 0) {
      uint8_t van = gfx_route_vanilla_file_for_page(ctx->gfx_route, map_page);
      if (van != 0 && van != file_id) {
        uint8_t px_van[64];
        if (decode_sprite_tile(ctx->rom, ctx->gfxc, van, local, px_van, ctx->err, ctx->errcap) == 0 &&
            sprite_px64_has_opaque(px_van)) {
          memcpy(px64, px_van, sizeof(px64));
          used_file = van;
        }
      }
    }
    if (!ok) {
      if (ctx->stats) ctx->stats->sprites_gfx_miss++;
      continue;
    }
    int x0 = (int)base_x + (int)p->x;
    int y0 = (int)base_y + (int)p->y;
    if (x0 < 0 || y0 < 0) continue;
    (void)used_file;
    blit_tile8(ctx->rgb, ctx->W, ctx->H, (uint32_t)x0, (uint32_t)y0, px64, palrgb, p->hflip, p->vflip);
    any = 1;
  }
  if (any && ctx->stats) ctx->stats->sprites_drawn++;
}

void sprite_draw_level(const LevelInfo *info, SpriteDrawCtx *ctx) {
  if (!info || !ctx || !ctx->rgb || !ctx->rom || !ctx->gfxc) return;
  if (!info->sprites || info->sprites_count == 0) return;

  if (ctx->stats) ctx->stats->sprites_total = info->sprites_count;

  for (size_t i = 0; i < info->sprites_count; i++) {
    const LevelSprite *sp = &info->sprites[i];
    const SpriteGfxDef *def = lookup_sprite_def(sp->sprite_id);
    if (def) {
      draw_sprite_parts(ctx, def, sp);
    } else if (ctx->sprite_debug) {
      uint32_t base_x = (uint32_t)sp->screen * 256u + (uint32_t)sp->x * 16u;
      uint32_t base_y = (uint32_t)sp->y * 16u;
      draw_marker(ctx->rgb, ctx->W, ctx->H, base_x, base_y);
      if (ctx->stats) {
        ctx->stats->sprites_unknown++;
        ctx->stats->sprites_drawn++;
      }
    } else {
      if (ctx->stats) ctx->stats->sprites_unknown++;
    }
  }
}

void sprite_draw_log_unknown_ids(const LevelInfo *info, FILE *fp) {
  if (!info || !fp || !info->sprites) return;
  for (size_t i = 0; i < info->sprites_count; i++) {
    uint8_t id = info->sprites[i].sprite_id;
    if (!lookup_sprite_def(id)) {
      fprintf(fp, "LV_REPORT_SPRITE_UNKNOWN id=0x%02X\n", (unsigned)id);
    }
  }
}
