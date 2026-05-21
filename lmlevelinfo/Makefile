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

$(VISBIN): level_visual.c romutil.c lm_tables.c level_parse.c mwl_reader.c map16_reader.c gfx_reader.c obj_to_map16.c gfx_route.c palette_rom.c emit_stats.c sprite_draw.c lc_lz2.c
	$(CC) $(CFLAGS) -o $@ level_visual.c romutil.c lm_tables.c level_parse.c mwl_reader.c map16_reader.c gfx_reader.c obj_to_map16.c gfx_route.c palette_rom.c emit_stats.c sprite_draw.c lc_lz2.c

$(TESTBIN): test_runner.c romutil.c lm_tables.c level_parse.c mwl_reader.c mwl_writer.c lc_lz2.c obj_to_map16.c emit_stats.c gfx_route.c gfx_reader.c sprite_draw.c
	$(CC) $(CFLAGS) -o $@ test_runner.c romutil.c lm_tables.c level_parse.c mwl_reader.c mwl_writer.c lc_lz2.c obj_to_map16.c emit_stats.c gfx_route.c gfx_reader.c sprite_draw.c

clean:
	rm -f $(BIN) $(VISBIN) $(TESTBIN)

.PHONY: all clean

