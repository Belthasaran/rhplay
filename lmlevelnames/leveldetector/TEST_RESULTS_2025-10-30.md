# Level Detector - Batch Test Results (2025-10-30)

- Scope: All ROMs in `testrom2/` with matching `_levelids.json`.
- Command: `python leveldetector/run_detect_batch.py`
- Vanilla ROM used: `smw.sfc`

## Summary
- Total ROMs tested: 93
- Matches: 93
- Mismatches: 0

## Notes
- Detection based on Layer 1 pointer table at SNES $05E000.
- Vanilla-empty logic excludes pointers into $06:8000-$06:FFFF (and 0) and excludes slot `000` when empty.
- Canonicalization: JSON level IDs normalized to 3-digit uppercase hex (no `0x`).
