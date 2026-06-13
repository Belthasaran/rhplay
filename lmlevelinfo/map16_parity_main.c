#include "map16_parity.h"

int main(int argc, char **argv) {
  return map16_parity_cli(argc, argv) == 0 ? 0 : 1;
}
