#!/usr/bin/env python3
"""Test script to verify JSON output format."""
import json
import subprocess
import sys

result = subprocess.run(
    [sys.executable, 'find_translevels.py', '--romfile', '../testrom2/temp_lm361_13836.sfc'],
    capture_output=True,
    text=True,
    cwd='findtranslevels'
)

data = json.loads(result.stdout)

print("Sample translevel entries:")
for i, t in enumerate(data['translevels'][:5]):
    print(f"  Entry {i+1}: translevel={t['translevel']} (type: {type(t['translevel']).__name__}), level_number={t['level_number']} (type: {type(t['level_number']).__name__})")

# Check translevel 25 (should map to level 101/0x101)
t25 = [t for t in data['translevels'] if t['translevel'] == '25']
if t25:
    print(f"\nTranslevel 25 (should map to level 0x101): translevel={t25[0]['translevel']}, level_number={t25[0]['level_number']}")
    assert t25[0]['level_number'] == '101', f"Expected level_number '101', got '{t25[0]['level_number']}'"

# Verify they're strings
assert isinstance(data['translevels'][0]['translevel'], str), "translevel should be a string"
assert isinstance(data['translevels'][0]['level_number'], str), "level_number should be a string"
assert data['translevels'][0]['translevel'].isupper() or data['translevels'][0]['translevel'].isdigit(), "translevel should be uppercase hex"
assert data['translevels'][0]['level_number'].isupper() or data['translevels'][0]['level_number'].isdigit(), "level_number should be uppercase hex"

print("\nOK: All format checks passed!")

