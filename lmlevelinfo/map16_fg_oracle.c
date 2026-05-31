#include "map16_fg_oracle.h"

#include <ctype.h>
#include <dirent.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>

static void seterr(char *err, size_t errcap, const char *msg) {
  if (!err || errcap == 0) return;
  snprintf(err, errcap, "%s", msg ? msg : "error");
}

static int parse_hex_u16(const char *s, uint16_t *out) {
  if (!s || !*s || !out) return 0;
  char *end = NULL;
  unsigned long v = strtoul(s, &end, 16);
  if (end == s || v > 0xFFFFu) return 0;
  *out = (uint16_t)v;
  return 1;
}

static void parse_flips(const char *s, int *hflip, int *vflip) {
  if (hflip) *hflip = 0;
  if (vflip) *vflip = 0;
  if (!s) return;
  if (s[0] == 'x' && hflip) *hflip = 1;
  if (s[1] == 'y' && vflip) *vflip = 1;
}

static uint16_t oracle_sub_word(uint16_t chr, uint8_t pal, int hflip, int vflip) {
  uint16_t w = (uint16_t)(chr & 0x03FFu);
  if (hflip) w |= (uint16_t)(1u << 10);
  if (vflip) w |= (uint16_t)(1u << 11);
  w |= (uint16_t)((uint16_t)(pal & 7u) << 13);
  return w;
}

static int path_is_dir(const char *path) {
  struct stat st;
  if (!path || !path[0]) return 0;
  if (stat(path, &st) != 0) return 0;
  return S_ISDIR(st.st_mode);
}

static int parse_oracle_line(const char *line, uint16_t *out_id, Map16Tile *out_tile) {
  if (!line || !out_id || !out_tile) return 0;
  while (*line && isspace((unsigned char)*line)) line++;
  if (!line[0]) return 0;

  const char *colon = strchr(line, ':');
  if (!colon) return 0;
  char idbuf[8];
  size_t idlen = (size_t)(colon - line);
  if (idlen == 0 || idlen >= sizeof(idbuf)) return 0;
  memcpy(idbuf, line, idlen);
  idbuf[idlen] = '\0';
  uint16_t tid = 0;
  if (!parse_hex_u16(idbuf, &tid)) return 0;

  const char *body = colon + 1;
  while (*body && isspace((unsigned char)*body)) body++;
  if (*body == '~') return 0;

  const char *brace = strchr(body, '{');
  if (!brace) return 0;
  const char *end = strchr(brace, '}');
  if (!end) return 0;

  Map16Tile t;
  memset(&t, 0, sizeof(t));
  const char *p = brace + 1;
  for (int si = 0; si < 4; si++) {
    while (p < end && isspace((unsigned char)*p)) p++;
    if (p >= end) return 0;

    char chrbuf[8];
    int ci = 0;
    while (p < end && !isspace((unsigned char)*p) && ci + 1 < (int)sizeof(chrbuf)) {
      chrbuf[ci++] = *p++;
    }
    chrbuf[ci] = '\0';
    if (ci == 0) return 0;
    while (p < end && isspace((unsigned char)*p)) p++;

    char palbuf[8];
    ci = 0;
    while (p < end && !isspace((unsigned char)*p) && ci + 1 < (int)sizeof(palbuf)) {
      palbuf[ci++] = *p++;
    }
    palbuf[ci] = '\0';
    if (ci == 0) return 0;
    while (p < end && isspace((unsigned char)*p)) p++;

    char flipbuf[8];
    ci = 0;
    while (p < end && !isspace((unsigned char)*p) && ci + 1 < (int)sizeof(flipbuf)) {
      flipbuf[ci++] = *p++;
    }
    flipbuf[ci] = '\0';
    if (ci == 0) return 0;

    uint16_t chr = 0;
    if (!parse_hex_u16(chrbuf, &chr)) return 0;
    char *pal_end = NULL;
    unsigned long palv = strtoul(palbuf, &pal_end, 10);
    if (pal_end == palbuf || palv > 7u) return 0;
    int hflip = 0, vflip = 0;
    parse_flips(flipbuf, &hflip, &vflip);
    t.w[si] = oracle_sub_word(chr, (uint8_t)palv, hflip, vflip);
  }

  *out_id = tid;
  *out_tile = t;
  return 1;
}

static int parse_oracle_file(const char *path, Map16Data *m, size_t *loaded_out, char *err, size_t errcap) {
  FILE *fp = fopen(path, "r");
  if (!fp) {
    seterr(err, errcap, "could not open FG oracle page file");
    return 0;
  }

  char line[512];
  size_t loaded = 0;
  while (fgets(line, sizeof(line), fp)) {
    uint16_t tid = 0;
    Map16Tile t;
    if (!parse_oracle_line(line, &tid, &t)) continue;
    if ((size_t)tid >= m->fg_oracle_count) continue;
    m->fg_oracle_tiles[tid] = t;
    m->fg_oracle_valid[tid] = 1;
    loaded++;
  }
  fclose(fp);
  if (loaded_out) *loaded_out += loaded;
  return 1;
}

int map16_try_auto_fg_oracle_dir(const char *map16_path, char *out_dir, size_t outcap) {
  if (!map16_path || !map16_path[0] || !out_dir || outcap == 0) return 0;

  const char *slash = strrchr(map16_path, '/');
  if (!slash) slash = strrchr(map16_path, '\\');
  size_t dirlen = slash ? (size_t)(slash - map16_path) : 0;

  static const char *suffix = "/resources/all_map16/global_pages/FG_pages";
  size_t need = dirlen + strlen(suffix) + 1;
  if (need > outcap) return 0;
  memcpy(out_dir, map16_path, dirlen);
  memcpy(out_dir + dirlen, suffix, strlen(suffix) + 1);
  return path_is_dir(out_dir);
}

int map16_load_fg_oracles(const char *dir, Map16Data *m, char *err, size_t errcap) {
  if (!m) {
    seterr(err, errcap, "null Map16Data");
    return 0;
  }
  if (!dir || !dir[0]) {
    seterr(err, errcap, "empty FG oracle directory");
    return 0;
  }
  if (!path_is_dir(dir)) {
    seterr(err, errcap, "FG oracle path is not a directory");
    return 0;
  }

  if (!m->fg_oracle_tiles) {
    m->fg_oracle_tiles = (Map16Tile *)calloc(MAP16_TILE_CAPACITY, sizeof(Map16Tile));
    m->fg_oracle_valid = (uint8_t *)calloc(MAP16_TILE_CAPACITY, sizeof(uint8_t));
    if (!m->fg_oracle_tiles || !m->fg_oracle_valid) {
      free(m->fg_oracle_tiles);
      free(m->fg_oracle_valid);
      m->fg_oracle_tiles = NULL;
      m->fg_oracle_valid = NULL;
      seterr(err, errcap, "FG oracle alloc failed");
      return 0;
    }
    m->fg_oracle_count = MAP16_TILE_CAPACITY;
  } else {
    memset(m->fg_oracle_tiles, 0, MAP16_TILE_CAPACITY * sizeof(Map16Tile));
    memset(m->fg_oracle_valid, 0, MAP16_TILE_CAPACITY);
  }

  DIR *d = opendir(dir);
  if (!d) {
    seterr(err, errcap, "could not open FG oracle directory");
    return 0;
  }

  size_t loaded = 0;
  struct dirent *ent;
  while ((ent = readdir(d)) != NULL) {
    const char *name = ent->d_name;
    if (strncmp(name, "page_", 5) != 0) continue;
    size_t nlen = strlen(name);
    if (nlen < 10 || strcmp(name + nlen - 4, ".txt") != 0) continue;

    char path[1024];
    if (snprintf(path, sizeof(path), "%s/%s", dir, name) >= (int)sizeof(path)) continue;
    if (!parse_oracle_file(path, m, &loaded, err, errcap)) {
      closedir(d);
      return 0;
    }
  }
  closedir(d);

  m->fg_oracle_loaded_total = loaded;
  return 1;
}

int map16_has_fg_oracle(const Map16Data *m, uint16_t tile_id) {
  if (!m || !m->fg_oracle_valid || (size_t)tile_id >= m->fg_oracle_count) return 0;
  return m->fg_oracle_valid[tile_id] != 0;
}

int map16_get_fg_oracle(const Map16Data *m, uint16_t tile_id, Map16Tile *out) {
  if (!map16_has_fg_oracle(m, tile_id) || !out) return 0;
  *out = m->fg_oracle_tiles[tile_id];
  return 1;
}
