#include "map16_fg_oracle.h"
#include "map16_text.h"

#include <dirent.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>

static void seterr(char *err, size_t errcap, const char *msg) {
  if (!err || errcap == 0) return;
  snprintf(err, errcap, "%s", msg ? msg : "error");
}

static int path_is_dir(const char *path) {
  struct stat st;
  if (!path || !path[0]) return 0;
  if (stat(path, &st) != 0) return 0;
  return S_ISDIR(st.st_mode);
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
    Map16TextTile parsed;
    char perr[128];
    int fmt = map16_text_parse_line(line, 0xFFFFu, &parsed, perr, sizeof(perr));
    if (fmt != MAP16_TEXT_FMT_FG_FULL) continue;
    if ((size_t)parsed.tile_id >= m->fg_oracle_count) continue;
    m->fg_oracle_tiles[parsed.tile_id] = parsed.words;
    m->fg_oracle_valid[parsed.tile_id] = 1;
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
