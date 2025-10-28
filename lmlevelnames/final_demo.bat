@echo off
echo === FINAL DEMONSTRATION ===
echo.
echo Test 1: Extract level 0x13B
python levelname_extractor_enhanced_2025_10_28.py --romfile Akogare_lm333_edited.sfc --range 0x13B 0x13B
echo.
echo Test 2: Filtering custom levels only
python levelname_extractor_enhanced_2025_10_28.py --romfile smw_lm2.sfc --range 0x001 0x010 --novanilla --withwords
echo.
echo === ALL TESTS COMPLETE ===

