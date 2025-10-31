#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os


def snes_to_rom_offset(snes_addr, has_header):
    return ((snes_addr & 0x7F0000) >> 1) | (snes_addr & 0x7FFF) + (0x200 if has_header else 0)


def is_headered(path):
    size = os.path.getsize(path)
    return (size % 0x8000) != 0


def main():
    rom_path = 'testrom2/temp_lm361_13836.sfc'
    vanilla_path = 'smw.sfc'
    sn_pointer_table_snes = 0x05E000

    with open(rom_path, 'rb') as f:
        rom = f.read()
    with open(vanilla_path, 'rb') as f:
        vrom = f.read()

    headered = is_headered(rom_path)
    vheadered = is_headered(vanilla_path)

    ptr_tbl_offset = snes_to_rom_offset(sn_pointer_table_snes, headered)
    vptr_tbl_offset = snes_to_rom_offset(sn_pointer_table_snes, vheadered)

    print("LM ROM pointer table @ {} (headered: {})".format(hex(ptr_tbl_offset), headered))
    print("Vanilla pointer table @ {} (headered: {})".format(hex(vptr_tbl_offset), vheadered))

    sample_slots = [0, 1, 105, 0x13B, 255, 510]
    for slot in sample_slots:
        p = int.from_bytes(rom[ptr_tbl_offset + slot * 3: ptr_tbl_offset + slot * 3 + 3], 'little')
        vp = int.from_bytes(vrom[vptr_tbl_offset + slot * 3: vptr_tbl_offset + slot * 3 + 3], 'little')
        print("Slot {:03X}: LM PTR ${:06X}  -  vanilla PTR ${:06X}".format(slot, p, vp))


if __name__ == '__main__':
    main()


