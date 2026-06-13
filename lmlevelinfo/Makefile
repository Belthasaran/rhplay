CC ?= gcc
CFLAGS ?= -O2 -Wall -Wextra -std=c99

BIN := level_info1
VISBIN := level_visual
TESTBIN := levelinfo_tests
SRCS := \
  level_info1.c \
  romutil.c \
  lm_tables.c \
  level_parse.c \
  lc_lz2.c \
  jsonutil.c \
  map16_reader.c \
  map16_fg_oracle.c \
  map16_rom.c \
  gfx_reader.c \
  obj_to_map16.c \
  emit_stats.c \
  gfx_route.c \
  palette_rom.c \
  mwl_writer.c \
  mwl_reader.c

all: $(BIN) $(VISBIN) $(TESTBIN)

$(BIN): $(SRCS)
	$(CC) $(CFLAGS) -o $@ $(SRCS)

$(VISBIN): level_visual.c lv_ppm_compare.c romutil.c lm_tables.c level_parse.c mwl_reader.c map16_reader.c map16_fg_oracle.c map16_rom.c gfx_reader.c obj_to_map16.c gfx_route.c palette_rom.c emit_stats.c sprite_draw.c lc_lz2.c
	$(CC) $(CFLAGS) -o $@ level_visual.c lv_ppm_compare.c romutil.c lm_tables.c level_parse.c mwl_reader.c map16_reader.c map16_fg_oracle.c map16_rom.c gfx_reader.c obj_to_map16.c gfx_route.c palette_rom.c emit_stats.c sprite_draw.c lc_lz2.c

$(TESTBIN): test_runner.c lv_ppm_compare.c romutil.c lm_tables.c level_parse.c mwl_reader.c mwl_writer.c lc_lz2.c map16_reader.c map16_fg_oracle.c map16_rom.c obj_to_map16.c emit_stats.c gfx_route.c gfx_reader.c palette_rom.c sprite_draw.c
	$(CC) $(CFLAGS) -o $@ test_runner.c lv_ppm_compare.c romutil.c lm_tables.c level_parse.c mwl_reader.c mwl_writer.c lc_lz2.c map16_reader.c map16_fg_oracle.c map16_rom.c obj_to_map16.c emit_stats.c gfx_route.c gfx_reader.c palette_rom.c sprite_draw.c

GFXPROBE := gfx_chr_probe
$(GFXPROBE): gfx_chr_probe.c romutil.c lm_tables.c level_parse.c lc_lz2.c gfx_reader.c gfx_route.c palette_rom.c lv_ppm_compare.c
	$(CC) $(CFLAGS) -o $@ gfx_chr_probe.c romutil.c lm_tables.c level_parse.c lc_lz2.c gfx_reader.c gfx_route.c palette_rom.c lv_ppm_compare.c

.PHONY: all clean gfx-probe
gfx-probe: $(GFXPROBE)

clean:
	rm -f $(BIN) $(VISBIN) $(TESTBIN) $(GFXPROBE)

.PHONY: all clean

