#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Wrapper for Lunar Compress DLL decompression (LC_LZ2/LC_LZ3).

This module provides Python access to the Lunar Compress DLL for decompressing
LC_LZ2 and LC_LZ3 compressed data, used by Lunar Magic for LevelNumberMap.
"""

import ctypes
import os
import sys
import tempfile
import subprocess
from typing import Optional, Tuple
from pathlib import Path

# Compression format constants (from LunarDLL.def)
LC_LZ2 = 1
LC_LZ3 = 2

# File mode constants
LC_READONLY = 0x00

# ROM type constants
LC_LOROM = 0x01
LC_NOHEADER = 0
LC_HEADER = 1

class LunarCompressWrapper:
    """Wrapper for Lunar Compress DLL decompression."""
    
    def __init__(self, dll_path: Optional[str] = None):
        """
        Initialize the wrapper.
        
        Args:
            dll_path: Path to Lunar Compress.dll. If None, searches for it.
        """
        self.dll = None
        self.dll_path = dll_path
        
        if dll_path is None:
            # Try to find DLL in common locations
            script_dir = os.path.dirname(os.path.abspath(__file__))
            # Prefer x64 DLL for 64-bit Python, but try both
            possible_paths = [
                os.path.join(script_dir, '..', 'lc190', 'x64', 'Lunar Compress.dll'),
                os.path.join(os.path.dirname(script_dir), 'lc190', 'x64', 'Lunar Compress.dll'),
                os.path.join(script_dir, '..', 'lc190', 'Lunar Compress.dll'),
                os.path.join(os.path.dirname(script_dir), 'lc190', 'Lunar Compress.dll'),
                'lc190/x64/Lunar Compress.dll',
                'lc190/Lunar Compress.dll',
                '../lc190/x64/Lunar Compress.dll',
                '../lc190/Lunar Compress.dll',
                'Lunar Compress.dll'
            ]
            
            for path in possible_paths:
                abs_path = os.path.abspath(path)
                if os.path.exists(abs_path):
                    self.dll_path = abs_path
                    break
        
        if self.dll_path and os.path.exists(self.dll_path):
            try:
                # Try loading as WinDLL (stdcall) first
                try:
                    self.dll = ctypes.WinDLL(self.dll_path)
                except OSError:
                    # If that fails, try CDLL (cdecl) - though unlikely for Windows DLL
                    self.dll = ctypes.CDLL(self.dll_path)
                self._setup_dll_functions()
            except Exception as e:
                # DLL found but couldn't load - likely architecture mismatch
                # Will fall back to decomp.exe
                if False:  # Set to True for verbose debugging
                    print(f"Warning: Could not load Lunar Compress DLL: {e}", file=sys.stderr)
                self.dll = None
                self.dll_path = None
    
    def _setup_dll_functions(self):
        """Set up DLL function signatures."""
        if not self.dll:
            return
        
        # LunarLoadDLL
        self.dll.LunarLoadDLL.restype = ctypes.c_bool
        self.dll.LunarLoadDLL.argtypes = []
        
        # LunarUnloadDLL
        self.dll.LunarUnloadDLL.restype = ctypes.c_bool
        self.dll.LunarUnloadDLL.argtypes = []
        
        # LunarOpenFile
        self.dll.LunarOpenFile.restype = ctypes.c_bool
        self.dll.LunarOpenFile.argtypes = [ctypes.c_char_p, ctypes.c_uint]
        
        # LunarCloseFile
        self.dll.LunarCloseFile.restype = ctypes.c_bool
        self.dll.LunarCloseFile.argtypes = []
        
        # LunarDecompress
        self.dll.LunarDecompress.restype = ctypes.c_uint
        self.dll.LunarDecompress.argtypes = [
            ctypes.POINTER(ctypes.c_ubyte),  # Destination
            ctypes.c_uint,                    # AddressToStart
            ctypes.c_uint,                    # MaxDataSize
            ctypes.c_uint,                    # Format
            ctypes.c_uint,                    # Format2
            ctypes.POINTER(ctypes.c_uint)     # LastROMPosition
        ]
    
    def decompress_with_dll(self, rom_data: bytes, offset: int, format_type: int, format2: int = 0, max_size: int = 0x10000) -> Optional[bytes]:
        """
        Decompress data using the DLL directly.
        
        Args:
            rom_data: ROM data containing compressed data
            offset: ROM file offset to start decompression
            format_type: Compression format (LC_LZ2=1, LC_LZ3=2)
            format2: Format2 parameter (usually 0)
            max_size: Maximum decompressed size
            
        Returns:
            Decompressed data or None on failure
        """
        if not self.dll:
            return None
        
        if not self.dll.LunarLoadDLL():
            return None
        
        try:
            # Create temporary file
            with tempfile.NamedTemporaryFile(delete=False, suffix='.sfc') as tmp_file:
                tmp_path = tmp_file.name
                tmp_file.write(rom_data)
            
            # Open file in DLL
            file_path_bytes = tmp_path.encode('utf-8')
            if not self.dll.LunarOpenFile(file_path_bytes, LC_READONLY):
                return None
            
            try:
                # Allocate buffer for decompressed data
                buffer = (ctypes.c_ubyte * max_size)()
                last_pos = ctypes.c_uint()
                
                # Decompress
                size = self.dll.LunarDecompress(
                    buffer,
                    offset,
                    max_size,
                    format_type,
                    format2,
                    ctypes.byref(last_pos)
                )
                
                if size == 0:
                    return None
                
                # Return decompressed data
                return bytes(buffer[:size])
            
            finally:
                self.dll.LunarCloseFile()
                os.unlink(tmp_path)
        
        finally:
            self.dll.LunarUnloadDLL()
    
    def decompress_with_exe(self, rom_data: bytes, offset: int, format_type: int, format2: int = 0) -> Optional[bytes]:
        """
        Decompress data using decomp.exe (via wine on Linux).
        
        Args:
            rom_data: ROM data containing compressed data
            offset: ROM file offset to start decompression
            format_type: Compression format (LC_LZ2=1, LC_LZ3=2)
            format2: Format2 parameter (usually 0)
            
        Returns:
            Decompressed data or None on failure
        """
        # Find decomp.exe
        decomp_exe = None
        script_dir = os.path.dirname(os.path.abspath(__file__))
        possible_paths = [
            os.path.join(script_dir, '..', 'lc190', 'decomp.exe'),
            os.path.join(script_dir, '..', 'lc190', 'x64', 'decomp.exe'),
            os.path.join(os.path.dirname(script_dir), 'lc190', 'decomp.exe'),
            os.path.join(os.path.dirname(script_dir), 'lc190', 'x64', 'decomp.exe'),
            'lc190/decomp.exe',
            'lc190/x64/decomp.exe',
            '../lc190/decomp.exe',
            'decomp.exe'
        ]
        
        for path in possible_paths:
            abs_path = os.path.abspath(path)
            if os.path.exists(abs_path):
                decomp_exe = abs_path
                break
        
        if not decomp_exe:
            return None
        
        # Create temporary files
        with tempfile.NamedTemporaryFile(delete=False, suffix='.sfc') as tmp_rom:
            tmp_rom_path = tmp_rom.name
            tmp_rom.write(rom_data)
        
        with tempfile.NamedTemporaryFile(delete=False, suffix='.bin') as tmp_out:
            tmp_out_path = tmp_out.name
        
        try:
            # Run decomp.exe (via wine on Linux)
            # Format: decomp.exe FileToDecompress FileToSaveAs OffsetToStart(h) Format Format2
            if sys.platform != 'win32':
                # Use wine on Linux/Unix
                cmd = ['wine', decomp_exe, tmp_rom_path, tmp_out_path, f'{offset:X}', str(format_type), str(format2)]
            else:
                cmd = [decomp_exe, tmp_rom_path, tmp_out_path, f'{offset:X}', str(format_type), str(format2)]
            
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=10
            )
            
            if result.returncode != 0:
                return None
            
            # Read decompressed data
            if os.path.exists(tmp_out_path):
                with open(tmp_out_path, 'rb') as f:
                    return f.read()
            
            return None
        
        except Exception as e:
            print(f"Error running decomp.exe: {e}", file=sys.stderr)
            return None
        
        finally:
            # Clean up temp files
            try:
                if os.path.exists(tmp_rom_path):
                    os.unlink(tmp_rom_path)
                if os.path.exists(tmp_out_path):
                    os.unlink(tmp_out_path)
            except:
                pass
    
    def decompress(self, rom_data: bytes, offset: int, format_type: int, format2: int = 0, max_size: int = 0x10000) -> Optional[bytes]:
        """
        Decompress data using DLL if available, otherwise falls back to decomp.exe.
        
        Args:
            rom_data: ROM data containing compressed data
            offset: ROM file offset to start decompression
            format_type: Compression format (LC_LZ2=1, LC_LZ3=2)
            format2: Format2 parameter (usually 0)
            max_size: Maximum decompressed size
            
        Returns:
            Decompressed data or None on failure
        """
        # Try DLL first
        if self.dll:
            result = self.decompress_with_dll(rom_data, offset, format_type, format2, max_size)
            if result:
                return result
        
        # Fall back to decomp.exe
        return self.decompress_with_exe(rom_data, offset, format_type, format2)


def decompress_lc_lz2(rom_data: bytes, offset: int, max_size: int = 0x10000) -> Optional[bytes]:
    """
    Convenience function to decompress LC_LZ2 data.
    
    Args:
        rom_data: ROM data containing compressed data
        offset: ROM file offset to start decompression
        max_size: Maximum decompressed size
        
    Returns:
        Decompressed data or None on failure
    """
    wrapper = LunarCompressWrapper()
    return wrapper.decompress(rom_data, offset, LC_LZ2, 0, max_size)


def decompress_lc_lz3(rom_data: bytes, offset: int, max_size: int = 0x10000) -> Optional[bytes]:
    """
    Convenience function to decompress LC_LZ3 data.
    
    Args:
        rom_data: ROM data containing compressed data
        offset: ROM file offset to start decompression
        max_size: Maximum decompressed size
        
    Returns:
        Decompressed data or None on failure
    """
    wrapper = LunarCompressWrapper()
    return wrapper.decompress(rom_data, offset, LC_LZ3, 0, max_size)


if __name__ == '__main__':
    # Test/debug
    if len(sys.argv) < 3:
        print("Usage: python lc_decompress.py <rom_file> <offset_hex> [format]")
        print("  format: LC_LZ2 (default) or LC_LZ3")
        sys.exit(1)
    
    rom_path = sys.argv[1]
    offset = int(sys.argv[2], 16)
    format_type = LC_LZ2
    if len(sys.argv) > 3:
        if sys.argv[3].upper() == 'LC_LZ3':
            format_type = LC_LZ3
    
    with open(rom_path, 'rb') as f:
        rom_data = f.read()
    
    wrapper = LunarCompressWrapper()
    decompressed = wrapper.decompress(rom_data, offset, format_type)
    
    if decompressed:
        print(f"Decompressed {len(decompressed)} bytes")
        sys.stdout.buffer.write(decompressed)
    else:
        print("Decompression failed", file=sys.stderr)
        sys.exit(1)
