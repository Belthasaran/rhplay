CC ?= gcc
CFLAGS ?= -O2 -Wall -Wextra -std=c99

BIN := level_info1
SRCS := \
  level_info1.c \
  romutil.c \
  lm_tables.c \
  level_parse.c \
  jsonutil.c \
  mwl_writer.c

all: $(BIN)

$(BIN): $(SRCS)
	$(CC) $(CFLAGS) -o $@ $(SRCS)

clean:
	rm -f $(BIN)

.PHONY: all clean

