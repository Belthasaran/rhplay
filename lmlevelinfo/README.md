# lmlevelinfo

Utilities for inspecting **Lunar Magic level data** inside SMW `.sfc` ROMs (including ROMhacks).

## `level_info1`

Reads level headers and Layer 1 object data for a given Lunar Magic **Level ID** (e.g. `0x10A` / `10A`).

### Build

```bash
cd lmlevelinfo
make
```

### Usage

```bash
./level_info1 [--help] [--json|-j] [--mwl|-m] [--data=...] <ROMFILE.sfc> <LEVEL_ID> [-o <OUTFILE>]
```

Examples:

```bash
./level_info1 example.sfc 0x100
./level_info1 --json example.sfc 10A -o out.json
./level_info1 --mwl example.sfc 0x100 -o level_0100.mwl
```

### Notes

- Object lists are included by default (same as `--data=objects`).
- The tool detects common Lunar Magic hijacks/moved tables (see `refmaterial/SMW-Data/Misc/LevelTables.asm`) so it can read the correct tables in ROMhacks.
- `--mwl` writes a **minimal** MWL file with the Level Information and Layer 1 sections populated; other sections are present but may be empty (size 0) in v1.

