#!/bin/bash
# Bulk import helper for level metadata artifacts
#
# Runs the JSON/CSV importers against every file in lmlevelnames/temp/
# respecting optional --db, --version, and --verbose flags.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMP_DIR="${SCRIPT_DIR}/temp"

if [[ ! -d "${TEMP_DIR}" ]]; then
  echo "Error: temp directory not found (${TEMP_DIR})" >&2
  exit 1
fi

DB_PATH=""
VERSION=""
VERBOSE=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --db=*)
      DB_PATH="${1#*=}"
      shift
      ;;
    --db)
      DB_PATH="$2"
      shift 2
      ;;
    --version=*)
      VERSION="${1#*=}"
      shift
      ;;
    --version)
      VERSION="$2"
      shift 2
      ;;
    --verbose|-v)
      VERBOSE=true
      shift
      ;;
    --help|-h)
      cat <<EOF
Usage: $(basename "$0") [options]

Options:
  --db PATH        Path to rhdata.db (passed to import scripts)
  --version N      Specific version number to target (default: highest)
  --verbose        Enable verbose output
  --help           Show this help message
EOF
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

shopt -s nullglob

LEVELID_FILES=("${TEMP_DIR}"/*_levelids.json)
DETECT_FILES=("${TEMP_DIR}"/*_detect.csv)
TRANS_FILES=("${TEMP_DIR}"/*_translevs.json)

run_import() {
  local script="$1"
  local file="$2"
  shift 2

  local cmd=(python3 "${SCRIPT_DIR}/${script}" "$file")
  if [[ -n "${DB_PATH}" ]]; then
    cmd+=(--db "${DB_PATH}")
  fi
  if [[ -n "${VERSION}" ]]; then
    cmd+=(--version "${VERSION}")
  fi
  if [[ "${VERBOSE}" == true ]]; then
    cmd+=(--verbose)
  fi

  "${cmd[@]}"
}

if [[ ${#LEVELID_FILES[@]} -eq 0 && ${#DETECT_FILES[@]} -eq 0 && ${#TRANS_FILES[@]} -eq 0 ]]; then
  echo "No importable files found under ${TEMP_DIR}" >&2
  exit 0
fi

echo "\n=== Importing level name JSON files ==="
for file in "${LEVELID_FILES[@]}"; do
  echo "-> $(basename "$file")"
  run_import import_levelids.py "$file"
done

echo "\n=== Importing detected level CSV files ==="
for file in "${DETECT_FILES[@]}"; do
  echo "-> $(basename "$file")"
  run_import import_detectlevels.py "$file"
done

echo "\n=== Importing translevel JSON files ==="
for file in "${TRANS_FILES[@]}"; do
  echo "-> $(basename "$file")"
  run_import import_translevels.py "$file"
done

echo "\nBulk import complete."
