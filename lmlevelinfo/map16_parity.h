#pragma once

/* Map16 text export parity tests (Callisto-aligned). */

int map16_parity_run_tier_a(void);
int map16_parity_run_tier_b_thorough(void);
int map16_parity_run_tier_c_resolve(void);
int map16_parity_run_gfx_muncher_regression(void);

/* CLI entry: compare resources dir vs optional AllMap16.map16 */
int map16_parity_cli(int argc, char **argv);
