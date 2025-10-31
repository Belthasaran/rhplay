# Level Detector (Pointer-Based)

This folder contains a pointer-table-based level modification detector for SMW ROMs (LM 3.61+ compatible), plus batch test tooling.

## Scripts
- `detect_modified_by_pointers.py`: Core detector. Reads the Layer 1 level pointer table (SNES $05E000), compares pointers against a vanilla ROM, and outputs the list of level IDs deemed modified/used.
- `run_detect_batch.py`: Runs the detector across all ROMs in `testrom2/` and compares the result to each ROM's `_levelids.json`.
- `analyze_lm_pointer_table.py`: Utility to print sample pointer entries for a ROM vs. vanilla for quick inspection.

## Requirements
- Python 3.x
- Vanilla ROM path: `smw.sfc` (unheadered) or `smw_lm.sfc` (headered) at project root.

## Usage

Detect modified levels for a single ROM and print CSV of 3-digit hex level IDs:
```
python leveldetector/detect_modified_by_pointers.py --romfile testrom2/temp_lm361_13836.sfc --vanillarom smw.sfc --start 000 --end 1FF
```

Compare result to a JSON with an attribute `levels`:
```
python leveldetector/detect_modified_by_pointers.py --romfile testrom2/temp_lm361_13836.sfc --vanillarom smw.sfc --start 000 --end 1FF --json testrom2/13836_levelids.json
```

Batch run across all `testrom2/` ROMs:
```
python leveldetector/run_detect_batch.py
```

## Detection Rules (Summary)
- Reads per-level 24-bit pointers from SNES address $05E000 (Layer 1 pointer table).
- A level is considered modified/used if its pointer differs from vanilla and is not vanilla-empty.
- Vanilla-empty rule: pointers into $06:8000-$06:FFFF (or 0) are treated as empty, i.e., not modified.
- Special case: level `000` is excluded if its pointer is vanilla-empty.

## Notes
- Header detection is automatic; offsets are adjusted by +0x200 when header is present.
- Optional deep compare (`--compare-bytes`) can be used to compare a small window of pointed-to data if pointers are equal.
