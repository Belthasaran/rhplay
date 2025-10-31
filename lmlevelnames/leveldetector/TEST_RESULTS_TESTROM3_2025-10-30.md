# Level Detector - testrom3/ Batch Test Results (2025-10-30)

## Test Configuration
- **Scope**: All ROMs in `testrom3/` with matching `_levelids.json`.
- **Command**: `python leveldetector/run_detect_batch.py`
- **Vanilla ROM used**: `smw.sfc`

## Summary
- **Total ROMs tested**: 45
- **Matches**: 42
- **JSON Parse Errors**: 3
  - `testrom3/temp_lm361_26194.sfc` - Malformed JSON (nested objects not properly closed)
  - `testrom3/temp_lm361_27264.sfc` - Malformed JSON (nested objects not properly closed)
  - `testrom3/temp_lm361_34478.sfc` - Malformed JSON (nested objects not properly closed)
- **Other Mismatches**: 0

## Analysis
All 42 valid ROM-JSON pairs matched Lunar Magic's exported level lists **perfectly** (100% accuracy).

The 3 "mismatches" were JSON parsing failures due to malformed JSON files containing unclosed nested objects. The detector successfully extracted level IDs from these ROMs, but the JSON files could not be parsed for comparison.

Example malformed JSON structure:
```json
{ "26184": {
"version": "1", 
{ "26187": {
"version": "1", 
{ "26194": {
"levels": ["106", "008", ...],
...
}}}}
```

## Detection Rules Applied
- Reads per-level 24-bit pointers from SNES address $05E000 (Layer 1 pointer table).
- A level is considered modified/used if its pointer differs from vanilla and is not vanilla-empty.
- Vanilla-empty rule: pointers into $06:8000-$06:FFFF (or 0) are treated as empty.
- Special case: level `000` is excluded if its pointer is vanilla-empty.

## Conclusion
The pointer-based detection method successfully replicates Lunar Magic's level detection logic for all valid test cases in testrom3, achieving 100% match rate when JSON files are well-formed.

*** End Patch

