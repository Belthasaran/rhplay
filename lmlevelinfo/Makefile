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
  mwl_writer.c \
  mwl_reader.c

all: $(BIN) $(VISBIN) $(TESTBIN)

$(BIN): $(SRCS)
	$(CC) $(CFLAGS) -o $@ $(SRCS)

$(VISBIN): level_visual.c romutil.c lm_tables.c level_parse.c mwl_reader.c
	$(CC) $(CFLAGS) -o $@ level_visual.c romutil.c lm_tables.c level_parse.c mwl_reader.c

$(TESTBIN): test_runner.c romutil.c lm_tables.c level_parse.c mwl_reader.c mwl_writer.c lc_lz2.c
	$(CC) $(CFLAGS) -o $@ test_runner.c romutil.c lm_tables.c level_parse.c mwl_reader.c mwl_writer.c lc_lz2.c

clean:
	rm -f $(BIN) $(VISBIN) $(TESTBIN)

.PHONY: all clean

