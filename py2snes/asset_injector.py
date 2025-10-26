"""
SNES Asset Injection System

Dynamic injection of graphics, palettes, and other assets
into SNES memory (VRAM, CGRAM, etc.)
"""

import logging

# SNES PPU Memory Addresses
class PPU_ADDRESSES:
    VRAM_START = 0x0000
    VRAM_SIZE = 0x10000  # 64KB
    CGRAM_START = 0x0000
    CGRAM_SIZE = 0x200   # 512 bytes
    OAM_START = 0x0000
    OAM_SIZE = 0x220     # 544 bytes

# SMW-Specific VRAM Addresses
class SMW_VRAM:
    SP1_TILES = 0x0000   # SP1 tileset (4bpp)
    SP2_TILES = 0x1000   # SP2 tileset (4bpp)
    SP3_TILES = 0x2000   # SP3 tileset (2bpp)
    SP4_TILES = 0x3000   # SP4 tileset (2bpp)
    FG_TILES = 0x4000    # Foreground tiles (2bpp)
    BG_TILES = 0x5000    # Background tiles (2bpp)
    MODE7_TILES = 0x0000 # Mode 7

# SMW Palette RAM Addresses
class SMW_PALETTE_RAM:
    BG_PALETTES = 0x7E0703   # Background palettes
    SPR_PALETTES = 0x7E0743  # Sprite palettes

class SNESAssetInjector:
    """SNES asset injection system"""
    
    def __init__(self, snes_instance):
        """
        Args:
            snes_instance: Active py2snes.snes() instance
        """
        self.snes = snes_instance
        self.PPU = PPU_ADDRESSES
        self.SMW_VRAM = SMW_VRAM
        self.SMW_PAL_RAM = SMW_PALETTE_RAM

    # ========================================
    # Graphics Injection (VRAM)
    # ========================================

    async def inject_graphics(self, graphics_data, vram_address, format='4bpp'):
        """
        Upload graphics data to VRAM
        
        Args:
            graphics_data: Graphics data (raw tile data)
            vram_address: Target VRAM address
            format: Format ('2bpp', '4bpp', '8bpp')
        
        Returns:
            Bytes written
        """
        logging.info(f'[AssetInjector] Injecting {len(graphics_data)} bytes to VRAM 0x{vram_address:X} ({format})')
        
        if vram_address < 0 or vram_address >= self.PPU.VRAM_SIZE:
            raise ValueError(f'Invalid VRAM address: 0x{vram_address:X}')
        
        # Upload to staging RAM
        staging_addr = 0x7F9000
        await self.snes.PutAddress([[staging_addr, graphics_data]])
        
        logging.info(f'✓ Graphics staged at RAM 0x{staging_addr:X}')
        logging.info(f'  (Game must DMA transfer to VRAM 0x{vram_address:X})')
        
        return len(graphics_data)

    async def inject_smw_tileset(self, tileset_data, slot):
        """
        Inject tileset for SMW
        
        Args:
            tileset_data: Tileset data
            slot: Slot ('sp1', 'sp2', 'sp3', 'sp4', 'fg', 'bg')
        
        Returns:
            Bytes written
        """
        slot_map = {
            'sp1': {'addr': self.SMW_VRAM.SP1_TILES, 'format': '4bpp'},
            'sp2': {'addr': self.SMW_VRAM.SP2_TILES, 'format': '4bpp'},
            'sp3': {'addr': self.SMW_VRAM.SP3_TILES, 'format': '2bpp'},
            'sp4': {'addr': self.SMW_VRAM.SP4_TILES, 'format': '2bpp'},
            'fg': {'addr': self.SMW_VRAM.FG_TILES, 'format': '2bpp'},
            'bg': {'addr': self.SMW_VRAM.BG_TILES, 'format': '2bpp'}
        }
        
        if slot not in slot_map:
            raise ValueError(f'Invalid slot: {slot}')
        
        info = slot_map[slot]
        logging.info(f'[AssetInjector] Injecting SMW {slot.upper()} tileset ({info["format"]})')
        
        return await self.inject_graphics(tileset_data, info['addr'], info['format'])

    # ========================================
    # Palette Injection
    # ========================================

    def rgb_to_snes(self, r, g, b):
        """
        Convert RGB888 to SNES BGR555 format
        
        Args:
            r: Red (0-255)
            g: Green (0-255)
            b: Blue (0-255)
        
        Returns:
            SNES color (16-bit BGR555)
        """
        r5 = r // 8  # 8-bit to 5-bit
        g5 = g // 8
        b5 = b // 8
        
        return (b5 << 10) | (g5 << 5) | r5

    def snes_to_rgb(self, snes_color):
        """
        Convert SNES BGR555 to RGB888
        
        Args:
            snes_color: SNES color (16-bit)
        
        Returns:
            Dict with r, g, b (0-255 each)
        """
        r5 = snes_color & 0x1F
        g5 = (snes_color >> 5) & 0x1F
        b5 = (snes_color >> 10) & 0x1F
        
        return {
            'r': r5 * 8,  # 5-bit to 8-bit
            'g': g5 * 8,
            'b': b5 * 8
        }

    def create_palette(self, colors):
        """
        Create palette from RGB colors
        
        Args:
            colors: List of dicts with r, g, b (max 16)
        
        Returns:
            Palette data (32 bytes for 16 colors)
        """
        if len(colors) > 16:
            raise ValueError('Palette can have max 16 colors')
        
        palette_bytes = bytearray(32)
        
        for i, color in enumerate(colors):
            snes_color = self.rgb_to_snes(color['r'], color['g'], color['b'])
            
            # Write as little-endian 16-bit
            palette_bytes[i * 2] = snes_color & 0xFF
            palette_bytes[i * 2 + 1] = (snes_color >> 8) & 0xFF
        
        return bytes(palette_bytes)

    async def inject_smw_palette(self, palette_data, palette_num):
        """
        Inject palette to SMW palette RAM
        
        Args:
            palette_data: Palette data (32 bytes = 16 colors)
            palette_num: Palette number (0-7 for BG, 8-15 for sprites)
        """
        if len(palette_data) != 32:
            raise ValueError(f'Invalid palette size: {len(palette_data)} bytes (expected 32)')
        
        if not 0 <= palette_num <= 15:
            raise ValueError(f'Invalid palette number: {palette_num} (must be 0-15)')
        
        # Calculate address
        if palette_num < 8:
            base_addr = self.SMW_PAL_RAM.BG_PALETTES + (palette_num * 32)
            logging.info(f'[AssetInjector] Injecting background palette {palette_num}')
        else:
            base_addr = self.SMW_PAL_RAM.SPR_PALETTES + ((palette_num - 8) * 32)
            logging.info(f'[AssetInjector] Injecting sprite palette {palette_num - 8}')
        
        # Write to RAM
        await self.snes.PutAddress([[base_addr, palette_data]])
        
        logging.info('✓ Palette injected to RAM')

    async def read_smw_palette(self, palette_num):
        """
        Read current palette from SMW RAM
        
        Args:
            palette_num: Palette number (0-15)
        
        Returns:
            Palette data (32 bytes)
        """
        if not 0 <= palette_num <= 15:
            raise ValueError(f'Invalid palette number: {palette_num}')
        
        if palette_num < 8:
            base_addr = self.SMW_PAL_RAM.BG_PALETTES + (palette_num * 32)
        else:
            base_addr = self.SMW_PAL_RAM.SPR_PALETTES + ((palette_num - 8) * 32)
        
        return await self.snes.GetAddress(base_addr, 32)

    def parse_palette(self, palette_data):
        """
        Parse palette data to RGB colors
        
        Args:
            palette_data: Palette data (32 bytes)
        
        Returns:
            List of 16 RGB color dicts
        """
        colors = []
        
        for i in range(16):
            snes_color = palette_data[i * 2] | (palette_data[i * 2 + 1] << 8)
            colors.append(self.snes_to_rgb(snes_color))
        
        return colors

    async def modify_palette_colors(self, palette_num, color_map):
        """
        Modify specific colors in a palette
        
        Args:
            palette_num: Palette number (0-15)
            color_map: Dict of color index to RGB: {0: {'r': 255, 'g': 0, 'b': 0}}
        """
        logging.info(f'[AssetInjector] Modifying palette {palette_num}...')
        
        # Read current palette
        current_palette = await self.read_smw_palette(palette_num)
        new_palette = bytearray(current_palette)
        
        # Modify specified colors
        for color_index, rgb in color_map.items():
            idx = int(color_index)
            if not 0 <= idx <= 15:
                continue
            
            snes_color = self.rgb_to_snes(rgb['r'], rgb['g'], rgb['b'])
            new_palette[idx * 2] = snes_color & 0xFF
            new_palette[idx * 2 + 1] = (snes_color >> 8) & 0xFF
            
            logging.info(f'  Color {idx}: RGB({rgb["r"]}, {rgb["g"]}, {rgb["b"]}) → SNES(0x{snes_color:04X})')
        
        # Write modified palette
        await self.inject_smw_palette(bytes(new_palette), palette_num)
        
        logging.info('✓ Palette colors modified')

    # ========================================
    # Asset File Loading
    # ========================================

    async def load_and_inject_graphics(self, graphics_path, vram_address, format='4bpp'):
        """Load graphics file from SD card and inject"""
        logging.info(f'[AssetInjector] Loading graphics from {graphics_path}...')
        
        graphics_data = await self.snes.GetFile(graphics_path)
        logging.info(f'  ✓ Loaded {len(graphics_data)} bytes')
        
        return await self.inject_graphics(graphics_data, vram_address, format)

    async def load_and_inject_palette(self, palette_path, palette_num):
        """Load palette file from SD card and inject"""
        logging.info(f'[AssetInjector] Loading palette from {palette_path}...')
        
        palette_data = await self.snes.GetFile(palette_path)
        
        if len(palette_data) != 32:
            raise ValueError(f'Invalid palette file size: {len(palette_data)} bytes (expected 32)')
        
        logging.info('  ✓ Loaded 16-color palette')
        
        return await self.inject_smw_palette(palette_data, palette_num)

    # ========================================
    # Palette Utilities
    # ========================================

    def create_grayscale_palette(self, num_colors=16):
        """Create grayscale palette"""
        colors = []
        
        for i in range(num_colors):
            value = int((i / (num_colors - 1)) * 255)
            colors.append({'r': value, 'g': value, 'b': value})
        
        return self.create_palette(colors)

    def create_rainbow_palette(self):
        """Create rainbow palette"""
        colors = [
            {'r': 0, 'g': 0, 'b': 0},       # Black
            {'r': 255, 'g': 0, 'b': 0},     # Red
            {'r': 255, 'g': 127, 'b': 0},   # Orange
            {'r': 255, 'g': 255, 'b': 0},   # Yellow
            {'r': 127, 'g': 255, 'b': 0},   # Lime
            {'r': 0, 'g': 255, 'b': 0},     # Green
            {'r': 0, 'g': 255, 'b': 127},   # Teal
            {'r': 0, 'g': 255, 'b': 255},   # Cyan
            {'r': 0, 'g': 127, 'b': 255},   # Sky blue
            {'r': 0, 'g': 0, 'b': 255},     # Blue
            {'r': 127, 'g': 0, 'b': 255},   # Purple
            {'r': 255, 'g': 0, 'b': 255},   # Magenta
            {'r': 255, 'g': 0, 'b': 127},   # Pink
            {'r': 255, 'g': 255, 'b': 255}, # White
            {'r': 127, 'g': 127, 'b': 127}, # Gray
            {'r': 64, 'g': 64, 'b': 64}     # Dark gray
        ]
        
        return self.create_palette(colors)

    def adjust_palette_brightness(self, palette_data, factor):
        """
        Adjust palette brightness
        
        Args:
            palette_data: Original palette (32 bytes)
            factor: Brightness factor (0.0-2.0, 1.0 = no change)
        
        Returns:
            Modified palette
        """
        colors = self.parse_palette(palette_data)
        adjusted_colors = []
        
        for color in colors:
            adjusted_colors.append({
                'r': min(255, int(color['r'] * factor)),
                'g': min(255, int(color['g'] * factor)),
                'b': min(255, int(color['b'] * factor))
            })
        
        return self.create_palette(adjusted_colors)

    # ========================================
    # Tileset Utilities
    # ========================================

    def get_tile_size(self, format):
        """Calculate tile size based on format"""
        if format == '2bpp':
            return 16   # 8×8 pixels, 2 bits per pixel
        elif format == '4bpp':
            return 32   # 8×8 pixels, 4 bits per pixel
        elif format == '8bpp':
            return 64   # 8×8 pixels, 8 bits per pixel
        else:
            raise ValueError(f'Unknown format: {format}')

    def get_tile_count(self, graphics_data, format):
        """Calculate number of tiles in graphics data"""
        tile_size = self.get_tile_size(format)
        return len(graphics_data) // tile_size

    def extract_tile(self, graphics_data, tile_index, format):
        """Extract a single tile from graphics data"""
        tile_size = self.get_tile_size(format)
        offset = tile_index * tile_size
        
        if offset + tile_size > len(graphics_data):
            raise ValueError(f'Tile {tile_index} out of range')
        
        return graphics_data[offset:offset + tile_size]

