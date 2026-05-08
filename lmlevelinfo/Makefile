CC ?= gcc
CFLAGS ?= -O2 -Wall -Wextra -std=c99

BIN := level_info1
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

all: $(BIN) $(TESTBIN)

$(BIN): $(SRCS)
	$(CC) $(CFLAGS) -o $@ $(SRCS)

$(TESTBIN): test_runner.c romutil.c lm_tables.c level_parse.c mwl_reader.c lc_lz2.c
	$(CC) $(CFLAGS) -o $@ test_runner.c romutil.c lm_tables.c level_parse.c mwl_reader.c lc_lz2.c

clean:
	rm -f $(BIN) $(TESTBIN)

.PHONY: all clean

