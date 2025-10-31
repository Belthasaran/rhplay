//
#include <stdio.h>
#include <string.h>
#include <stdlib.h>

const int BV_SMCHEADER = 0x1;
const int BV_LOROM = 0x2;

struct openrom_h {
        FILE *fp;
        long adj;
	int modes;
} openroms[100] = {
};
int openroms_count=0;

struct openrom_h* get_openrom(FILE *fp){
	int i;

	for(i = 0; i < openroms_count; i++)
		if (openroms[i].fp == fp)
			return &openroms[i];
	return NULL;
}

int j_to_levelid(int j)
{
	 if (j >= 0x0 && j <= 0x24) 
		 return j;
	 if (j > 0x24 && j <= 0x5F) {
		 return 0x100 + j - 0x24;
	 }
abort();
}

const char* vanilla_name(int j)
{
	switch(j) {
case 0x001: return "MY SECRET 1";
case 0x002: return "my secret 2";
case 0x003: return "really cool secret";
case 0x004: return "not donut mansion";
case 0x005: return "plains de donut 3";
case 0x006: return "plain donut 3";
case 0x007: return "Morton place";
case 0x008: return "green house";
case 0x009: return "plain donut 2";
case 0x00A: return "secret donut 1";
case 0x00B: return "fortress de vanill";
case 0x00C: return "bridge de beur 1";
case 0x00D: return "bridge de beur 2";
case 0x00E: return "ludwig hidoeut";
case 0x00F: return "cheesy bridge";
case 0x010: return "mountain of cookie";
case 0x011: return "pepsi lake";
case 0x012: return "yellow star rod";
case 0x013: return "super secret donut";
case 0x014: return "Yellow custom pala";
case 0x015: return "DONUT PLAINS 1";
case 0x016: return "STAR ROAD";
case 0x017: return "#2 MORTON'S PLAINS";
case 0x018: return "SUNKEN GHOST SHIP";
case 0x019: return "#2 MORTON'S PLAINS";
case 0x01A: return "#6 WENDY'S CASTLE";
case 0x01B: return "CHOCOLATE FORTRESS";
case 0x01C: return "CHOCOLATE ISLAND 5";
case 0x01D: return "CHOCOLATE ISLAND 4";
case 0x01E: return "STAR ROAD";
case 0x01F: return "FOREST FORTRESS";
case 0x020: return "#5 ROY'S CASTLE";
case 0x021: return "CHOCO-GHOST HOUSE";
case 0x022: return "CHOCOLATE ISLAND 1";
case 0x023: return "CHOCOLATE ISLAND 3";
case 0x024: return "CHOCOLATE ISLAND 2";
case 0x101: return "#1 IGGY'S CASTLE";
case 0x102: return "YOSHI'S ISLAND 4";
case 0x103: return "YOSHI'S ISLAND 3";
case 0x104: return "YOSHI'S HOUSE";
case 0x105: return "YOSHI'S ISLAND 1";
case 0x106: return "YOSHI'S ISLAND 2";
case 0x107: return "VANILLA GHOST HOUS";
case 0x108: return "STAR ROAD";
case 0x109: return "VANILLA SECRET 1";
case 0x10A: return "VANILLA DOME 3";
case 0x10B: return "DONUT SECRET 2";
case 0x10C: return "STAR ROAD";
case 0x10D: return "FRONT DOOR";
case 0x10E: return "BACK DOOR";
case 0x10F: return "VALLEY OF BOWSER 4";
case 0x110: return "#7 LARRY'S CASTLE";
case 0x111: return "VALLEY FORTRESS";
case 0x112: return "";
case 0x113: return "VALLEY OF BOWSER 3";
case 0x114: return "VALLEY GHOST HOUSE";
case 0x115: return "VALLEY OF BOWSER 2";
case 0x116: return "VALLEY OF BOWSER 1";
case 0x117: return "CHOCOLATE SECRET";
case 0x118: return "VANILLA DOME 2";
case 0x119: return "VANILLA DOME 4";
case 0x11A: return "VANILLA DOME 1";
case 0x11B: return "RED SWITCH PALACE";
case 0x11C: return "#3 LEMMY'S CASTLE";
case 0x11D: return "FOREST GHOST HOUSE";
case 0x11E: return "FOREST OFILLUSION";
case 0x11F: return "FOREST OFILLUSION";
case 0x120: return "FOREST OFILLUSION";
case 0x121: return "BLUE SWITCH PALACE";
case 0x122: return "FOREST SECRET AREA";
case 0x123: return "FOREST OFILLUSION";
case 0x124: return "STAR ROAD";
case 0x125: return "FUNKY";
case 0x126: return "OUTRAGEOUS";
case 0x127: return "MONDO";
case 0x128: return "GROOVY";
case 0x129: return "STAR ROAD";
case 0x12A: return "GNARLY";
case 0x12B: return "TUBULAR";
case 0x12C: return "WAY COOL";
case 0x12D: return "AWESOME";
case 0x12E: return "STAR ROAD";
case 0x12F: return "STAR ROAD";
case 0x130: return "STAR WORLD 2";
case 0x131: return "STAR ROAD";
case 0x132: return "STAR WORLD 3";
case 0x133: return "STAR ROAD";
case 0x134: return "STAR WORLD 1";
case 0x135: return "STAR WORLD 4";
case 0x136: return "STAR WORLD 5";
case 0x137: return "STAR ROAD";
case 0x138: return "STAR ROAD";
	}
	return NULL;
}



int escape_json_string_static(const char *input, char *output, size_t output_buffer_size) {
    if (input == NULL || output == NULL || output_buffer_size == 0) {
        return -1; // Invalid input
    }

    size_t input_len = strlen(input);
    size_t output_idx = 0;

    for (size_t i = 0; i < input_len; ++i) {
        char c = input[i];

        // Check if there's enough space for the current character (or escaped sequence) + null terminator
        if (output_idx + 1 >= output_buffer_size) { // +1 for null terminator
            return -1; // Output buffer too small
        }

        switch (c) {
            case '"': // Double quote
                if (output_idx + 2 >= output_buffer_size) return -1;
                output[output_idx++] = '\\';
                output[output_idx++] = '"';
                break;
            case '\\': // Backslash
                if (output_idx + 2 >= output_buffer_size) return -1;
                output[output_idx++] = '\\';
                output[output_idx++] = '\\';
                break;
            case '\b': // Backspace
                if (output_idx + 2 >= output_buffer_size) return -1;
                output[output_idx++] = '\\';
                output[output_idx++] = 'b';
                break;
            case '\f': // Form feed
                if (output_idx + 2 >= output_buffer_size) return -1;
                output[output_idx++] = '\\';
                output[output_idx++] = 'f';
                break;
            case '\n': // Newline
                if (output_idx + 2 >= output_buffer_size) return -1;
                output[output_idx++] = '\\';
                output[output_idx++] = 'n';
                break;
            case '\r': // Carriage return
                if (output_idx + 2 >= output_buffer_size) return -1;
                output[output_idx++] = '\\';
                output[output_idx++] = 'r';
                break;
            case '\t': // Tab
                if (output_idx + 2 >= output_buffer_size) return -1;
                output[output_idx++] = '\\';
                output[output_idx++] = 't';
                break;
            default:
                // For other control characters (0x00-0x1F), escape as \uXXXX
                if (c >= 0x00 && c <= 0x1F) {
                    if (output_idx + 6 >= output_buffer_size) return -1; // \uXXXX + null
                    sprintf(&output[output_idx], "\\u%04x", (unsigned char)c);
                    output_idx += 6;
                } else {
                    output[output_idx++] = c;
                }
                break;
        }
    }

    output[output_idx] = '\0'; // Null-terminate the output string
    return output_idx;
}

int get_filesize(FILE *fp)
{
	long file_size, pos;

        pos = ftell(fp);
	if ( fseek(fp, 0, SEEK_END) != 0 ) {
		perror("fseek");
		return EOF;
	}
	file_size = ftell(fp);

	if ( fseek(fp, pos, SEEK_SET) != 0 ) {
		perror("fseek");
		return EOF;
	}
	return file_size;
}

long lorom_to_offset( long addr )
{
	int bank_n = addr  >> 16;
        int bank_a = (addr & 0xFFFF);

	if (addr < 0x8000) {
		return (bank_n * 0x8000) + (bank_a & 0x7FFF );
		return -1;
	}

	//return (bank_n & 0x7F) * 0x8000 + (bank_a & 0x7FFF);
	return ((bank_n & 0x7f) << 15) | (bank_a & 0x7FFF);
}

int read1(FILE *fp, long orig_addr, int direct = 0)
{
	long addr = orig_addr;
	int result;
	struct openrom_h* h = get_openrom(fp);

	if (!direct && h) {
		if ( h->modes & BV_LOROM )
		    addr = lorom_to_offset(addr);

		if (addr == -1) {
			fprintf(stderr,"read1(%X) -> invalid address\n", (unsigned int)orig_addr);
			return EOF;
		}
		if (h->adj) {
               //fprintf(stderr, "%X -> %X\n", (unsigned int)addr, (unsigned int)(addr + h->adj));
		addr += h->adj;
		}
	}

	if (fseek(fp, addr + 0, SEEK_SET) != 0) {
		perror("fseek");
		return EOF;
	}
	result = fgetc(fp);
	//fprintf(stdout, "read1(0x%.2X :: 0x%.2X) -> 0x%.2X\n", (unsigned int)orig_addr, (unsigned int)addr, result);
	return result;
}

int read3(FILE *fp, long addr, int direct=0)
{
        int a, b, c, result;
	struct openrom_h* h = get_openrom(fp);

	if(!direct && h) {
		if ( h->modes & BV_LOROM )
			addr = lorom_to_offset(addr);
		if (h->adj) {
		    addr += h->adj;
		}
	}

        if (fseek(fp, addr, SEEK_SET) != 0) {
                perror("fseek");
                return EOF;
        }
        a = fgetc(fp);
	if (a == EOF) {
		return EOF;
	}
	b = fgetc(fp);
	if (b == EOF) {
		return EOF;
	}
	c = fgetc(fp);
	if (c == EOF) {
		return EOF;
	}

	result = 0;
	result |= (c & 0xFF) << 16;
	result |= (b & 0xFF) << 8;
	result |= (a & 0xFF);
	//fprintf(stderr, "read3(0x%X) %X %X %6X -> %X\n", (unsigned int)addr, a, b, c, result);
        return result;
}

#include "default_tile_map.h"

 char smw_character_lookup(int charcode) {
	 switch(charcode) {
		     case 0x00: return 'A'; case 0x01: return 'B'; case 0x02: return 'C';
                     case 0x03: return 'D'; case 0x04: return 'E'; case 0x05: return 'F';
		     case 0x06: return 'G'; case 0x07: return 'H'; case 0x08: return 'I';
		     case 0x09: return 'J'; case 0x0A: return 'K'; case 0x0B: return 'L';
		     case 0x0C: return 'M'; case 0x0D: return 'N'; case 0x0E: return 'O';
		     case 0x0F: return 'P'; case 0x10: return 'Q'; case 0x11: return 'R';
		     case 0x12: return 'S'; case 0x13: return 'T'; case 0x14: return 'U';
		     case 0x15: return 'V'; case 0x16: return 'W'; case 0x17: return 'X';
		     case 0x18: return 'Y'; case 0x19: return 'Z';

		     case 0x1A: return '!'; case 0x1B: return '.'; case 0x1C: return '-';
		     case 0x1D: return ','; case 0x1E: return '?'; case 0x1F: return ' ';
		     case 0x5A: return '#';
		 
		     case 0x5B: return '('; case 0x5C: return ')'; //case 0x5C: return '\'';
		     //case 0x5D: return '\''; 
		     case 0x64: return '1'; case 0x65: return '2'; case 0x66: return '3';
		     case 0x67: return '4'; case 0x68: return '5'; case 0x69: return '6';
		     case 0x6A: return '7'; case 0x6B: return '8'; case 0x6C: return '9';
		     case 0x9F: return ' '; case 0xFC: return ' ';
	 }

	 return                         (char)tile_to_ascii_byte(charcode);
 }







int main(int argc, char *argv[])
{
	FILE *fp = NULL;
	long file_size = 0;
	int headerless = 0;
	long levelnames_addr = 0x0;
        char xb[25*6] = {0}, xa[100] = {0}, x0[100] = {0}; // level name buffers
        int i,j,k, need_comma=0; // loop iterators and need_comma? appended flag

	if ( argc < 2 )  {
		fprintf(stdout, "Usage: %s <filename>\n", argv[0]);
		return 1;
	}

	fp = fopen(argv[1], "rb");
	if ( !fp ) {
		perror("fopen");
		return 1;
	}
	file_size = get_filesize(fp);

        if (file_size % 1024 == 0) {
                headerless = 1;
		openroms[openroms_count].adj = 0x0;
		openroms[openroms_count].modes = 0;
		//printf("set adj=0x0, file_size=%ld\n", file_size);
        } else if (file_size % 1024 == 512) {
                headerless = 0;
		openroms[openroms_count].adj = 0x200;
		openroms[openroms_count].modes |= BV_SMCHEADER;
		//printf("set adj=0x200\n");
        } else {
                fprintf(stderr, "Error: %s has an invalid ROM size\n", argv[1]);
        }
	openroms[openroms_count++].fp = fp;

	if ( read1(fp, 0x7FD5) == 0x20 ) {
		//fprintf(stderr,"LoROM Found\n");
		openroms[openroms_count-1].modes |= BV_LOROM;
	} else if ( read1(fp, 0x7FD5) == 0x30 ) {
		//fprintf(stderr,"LoROM Found\n");
		openroms[openroms_count-1].modes |= BV_LOROM;
	}


	if (read1(fp, 0x049549) == 0x22) {
		// 0x049549 = 0x22 indicates that Lunar Magic level names hijack applies

		levelnames_addr = read3(fp, 0x03BB57);

		//printf("deref 0x03BB57 -> %X\n", (unsigned int)levelnames_addr);
		//printf("---\n");
		//printf("%X %X %X %X\n", (unsigned int)read1(fp, levelnames_addr+0x13+0), 
		//		        (unsigned int)read1(fp, levelnames_addr+0x13+1),
		//                        (unsigned int)read1(fp, levelnames_addr+0x13+2),
		//                        (unsigned int)read1(fp, levelnames_addr+0x13+3)  );
//0x03BB57
//
//{
//  "38406": {
//    "version": "1",
//    "levelnames": {
//      "0x001": "Medlar",
//      "0x002": "Night City",
//      "0x003": "Eterna Forest",
//      "0x004": "Bridge Interlude",


	}  else {
                  levelnames_addr = 0x049AC5;
                  fprintf(stderr, "-> %X\n", 0x049AC5);
                  exit(1);
	}



	 if ( 1 ) 
	 {
		printf (" \"levelnames\" : {\n");
		for(j=1;j<96;j++) {
			memset(xb, 0, sizeof(xb));
		for(i = 0 ; i < 18; i++) {
			long z = read1(fp, levelnames_addr + 19*(j) + i);
			//printf("j=x %ld\n", z);
                        //xb[i] = (char)smw_character_lookup(z);
			xb[i] = (char)smw_character_lookup(z);
		}

                while(strlen(xb) > 0 && strlen(xb) < 19 && xb[strlen(xb) - 1] == ' ' ) {
			xb[strlen(xb) - 1] = '\0';
		}

		if( vanilla_name( (unsigned int)j_to_levelid(j)  ) && !strcasecmp(xb,  vanilla_name( (unsigned int) j_to_levelid(j)  ))  ){
			xb[0] = '-';
			xb[1] = '\0';
		}

		//int escape_json_string_static(const char *input, char *output, size_t output_buffer_size) {
		escape_json_string_static(xb, x0, sizeof(x0));

                if ( j == 95 )  {
			need_comma = 0;
		} else {
			need_comma = 1;
		}


		printf("      \"%.3X\": \"%s\"%s\n", (unsigned int)j_to_levelid(j), x0, need_comma ? "," : "");


		//printf("j=%-2d  0x%-3X: [%s]\n", j, j_to_levelid(j), xb);
		}
		printf ("}\n");
		//smw_character_lookup
	} 
}
