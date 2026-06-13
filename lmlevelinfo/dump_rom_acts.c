#include <stdio.h>
#include "romutil.h"
#include "map16_rom.h"
int main(void) {
  Rom rom;
  char err[256];
  rom_load(&rom, "test/akogare/orig_Ako.sfc", err, sizeof(err));
  uint16_t acts;
  map16_rom_read_acts_like(&rom, 0x04BD, &acts);
  printf("rom acts 04BD=%04X\n", acts);
  rom_free(&rom);
  return 0;
}
