#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import argparse
import json
import os
from typing import List


def snes_to_rom_offset(snes_addr: int, has_header: bool) -> int:
    return ((snes_addr & 0x7F0000) >> 1) | (snes_addr & 0x7FFF) + (0x200 if has_header else 0)


def is_headered(path: str) -> bool:
    size = os.path.getsize(path)
    return (size % 0x8000) != 0


def read_pointer_table(rom: bytes, rom_path: str, sn_ptr_tbl_snes: int) -> int:
    headered = is_headered(rom_path)
    return snes_to_rom_offset(sn_ptr_tbl_snes, headered)


def detect_modified_levels_by_pointers(
    rom: bytes,
    rom_path: str,
    vrom: bytes,
    vrom_path: str,
    start_id: int,
    end_id: int,
    compare_bytes: int = 0,
    verbose: bool = False,
) -> List[int]:
    sn_ptr_tbl_snes = 0x05E000
    tbl_off = read_pointer_table(rom, rom_path, sn_ptr_tbl_snes)
    vtbl_off = read_pointer_table(vrom, vrom_path, sn_ptr_tbl_snes)

    modified: List[int] = []
    for slot in range(start_id, end_id + 1):
        p = int.from_bytes(rom[tbl_off + slot * 3: tbl_off + slot * 3 + 3], 'little')
        vp = int.from_bytes(vrom[vtbl_off + slot * 3: vtbl_off + slot * 3 + 3], 'little')

        # Heuristic: treat $06:8000-$06:FFFF (or 0) as vanilla-empty/null
        def is_vanilla_empty(ptr: int) -> bool:
            if ptr == 0:
                return True
            return (ptr & 0xFF0000) == 0x060000 and (ptr & 0x00FFFF) >= 0x8000

        is_null_p = is_vanilla_empty(p)
        is_null_vp = is_vanilla_empty(vp)

        changed = (p != vp) and (not is_null_p)

        if compare_bytes > 0 and not changed and not is_null_p and not is_null_vp:
            hdr = is_headered(rom_path)
            vhdr = is_headered(vrom_path)
            roff = snes_to_rom_offset(p, hdr)
            voff = snes_to_rom_offset(vp, vhdr)
            data = rom[roff: roff + compare_bytes]
            vdata = vrom[voff: voff + compare_bytes]
            changed = (data != vdata)

        # Exclude slot 000 if pointer is vanilla-empty
        if slot == 0 and (is_null_p or is_null_vp):
            changed = False

        if changed:
            modified.append(slot)
            if verbose:
                print("{:03X}: PTR {} -> {}{}".format(
                    slot,
                    hex(vp),
                    hex(p),
                    " (null->set)" if is_null_vp and not is_null_p else ""
                ))
        elif verbose:
            print("{:03X}: unchanged".format(slot))

    return modified


def main() -> None:
    ap = argparse.ArgumentParser(description="Detect modified levels by LM pointer table")
    ap.add_argument('--romfile', required=True)
    ap.add_argument('--vanillarom', required=True)
    ap.add_argument('--start', type=lambda x: int(x, 16), default=int('000', 16))
    ap.add_argument('--end', type=lambda x: int(x, 16), default=int('1FF', 16))
    ap.add_argument('--compare-bytes', type=int, default=0)
    ap.add_argument('--verbose', action='store_true')
    ap.add_argument('--json', help='Optional JSON with expected {"levels": [...]} to compare')
    args = ap.parse_args()

    with open(args.romfile, 'rb') as f:
        rom = f.read()
    with open(args.vanillarom, 'rb') as f:
        vrom = f.read()

    modified = detect_modified_levels_by_pointers(
        rom, args.romfile, vrom, args.vanillarom,
        args.start, args.end,
        compare_bytes=args.compare_bytes,
        verbose=args.verbose,
    )

    print(",".join("{:03X}".format(x) for x in modified))

    if args.json and os.path.exists(args.json):
        with open(args.json, 'r', encoding='utf-8') as f:
            data = json.load(f)
        if 'levels' in data:
            expected = data['levels']
        else:
            expected = None
            for v in data.values():
                if isinstance(v, dict) and 'levels' in v:
                    expected = v['levels']
                    break
        if expected is not None:
            def canon_list(lst):
                out = []
                for s in lst:
                    if not isinstance(s, str):
                        s = str(s)
                    s = s.strip().upper().lstrip('0X')
                    if s == '':
                        continue
                    s = s.zfill(3)
                    out.append(s)
                return set(out)

            exp_set = canon_list(expected)
            got_set = set("{:03X}".format(x) for x in modified)
            if exp_set == got_set:
                print("MATCH: pointer-based detection equals JSON 'levels'")
            else:
                only_json = sorted(exp_set - got_set)
                only_script = sorted(got_set - exp_set)
                print("MISMATCH")
                print("Only in JSON:", only_json)
                print("Only in script:", only_script)


if __name__ == '__main__':
    main()


