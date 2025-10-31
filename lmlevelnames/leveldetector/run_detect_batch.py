#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os
import subprocess


def find_pairs(root: str):
    pairs = []
    for name in os.listdir(root):
        if not name.endswith('.sfc'):
            continue
        if not name.startswith('temp_lm361_'):
            continue
        stem = name[len('temp_lm361_'):-4]
        json_name = f"{stem}_levelids.json"
        json_path = os.path.join(root, json_name)
        rom_path = os.path.join(root, name)
        if os.path.exists(json_path):
            pairs.append((rom_path, json_path))
    return sorted(pairs)


def main():
    root = 'testrom2'
    vanilla = 'smw.sfc' if os.path.exists('smw.sfc') else 'smw_lm.sfc'
    pairs = find_pairs(root)
    total = len(pairs)
    ok = 0
    fail = 0
    mismatches = []

    for rom_path, json_path in pairs:
        cmd = [
            'python', os.path.join('leveldetector', 'detect_modified_by_pointers.py'),
            '--romfile', rom_path,
            '--vanillarom', vanilla,
            '--start', '000', '--end', '1FF',
            '--json', json_path,
        ]
        res = subprocess.run(cmd, capture_output=True, text=True)
        out = (res.stdout or '') + (res.stderr or '')
        if 'MATCH: pointer-based detection equals JSON' in out:
            ok += 1
        else:
            fail += 1
            mismatches.append((rom_path, out))

    print(f"Total: {total}  Match: {ok}  Mismatch: {fail}")
    if mismatches:
        print("\nFirst 5 mismatches (truncated):")
        for rom_path, out in mismatches[:5]:
            print(f"- {rom_path}")
            lines = out.strip().splitlines()
            for line in lines[-5:]:
                print('  ' + line)


if __name__ == '__main__':
    main()


