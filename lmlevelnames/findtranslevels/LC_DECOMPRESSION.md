# LC_LZ2/LC_LZ3 Decompression Implementation

## Overview

LC_LZ2 and LC_LZ3 decompression is now implemented using the Lunar Compress library (lc190) via a Python wrapper.

## Implementation

### `lc_decompress.py`

Python wrapper that interfaces with the Lunar Compress DLL through `decomp.exe`.

**Functions:**
- `decompress_lc_lz2_exe()` - Decompress LC_LZ2 data
- `decompress_lc_lz3_exe()` - Decompress LC_LZ3 data  
- `decompress_lc_lz2_or_lz3()` - Try LC_LZ2 first, then LC_LZ3

**Method:**
1. Creates temporary input file with compressed data
2. Runs `decomp.exe` as subprocess
3. Reads decompressed output file
4. Cleans up temporary files

### Integration

The `find_translevels.py` script automatically uses the LC decompression wrapper when:
- LevelNumberMap is detected as compressed
- `decomp.exe` is found in `lc190/` directory

## Requirements

- `lc190/decomp.exe` (or `lc190/x64/decomp.exe`) must be available
- `lc190/Lunar Compress.dll` must be in the same directory as `decomp.exe`

## Usage

The decompression is automatically called when needed. To test manually:

```bash
python findtranslevels/lc_decompress.py <compressed_file> [format]
# format: 1 for LC_LZ2, 2 for LC_LZ3, or omit to try both
```

## Format Constants

From `LunarDLL.def`:
- `LC_LZ2 = 1` - Super Mario World format
- `LC_LZ3 = 2` - Pokemon Gold/Silver format (enhanced LZ2)

## Notes

- The wrapper uses temporary files (subprocess method)
- Future optimization: Could use DLL directly via ctypes for better performance
- Both LC_LZ2 and LC_LZ3 are supported
- The wrapper automatically tries both formats if format is not specified

