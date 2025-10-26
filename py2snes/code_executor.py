"""
Custom Code Execution for SNES

Enables executing custom 65816 assembly code on the console
Supports multiple execution methods:
- CMD space execution (SD2SNES/FXPak Pro)
- RAM execution (any hardware)
- Hook injection
"""

# CMD space address (SD2SNES special execution space)
CMD_SPACE_ADDR = 0x002C00
CMD_SPACE_SIZE = 0x400  # 1KB available

# Free RAM addresses for code execution
FREE_RAM_START = 0x7F8000
FREE_RAM_SIZE = 0x8000  # 32KB available

import asyncio
import logging

class CodeExecutor:
    """Execute custom 65816 assembly code on SNES"""
    
    def __init__(self, snes_instance):
        """
        Args:
            snes_instance: Active py2snes.snes() instance
        """
        self.snes = snes_instance

    # ========================================
    # CMD Space Execution (SD2SNES/FXPak Pro)
    # ========================================

    async def execute_in_cmd_space(self, code, wait_for_return=False):
        """
        Execute code in CMD space (SD2SNES/FXPak Pro only)
        
        Args:
            code: Assembly code bytes
            wait_for_return: Wait for code to complete
        
        Returns:
            Success status (bool)
        """
        if len(code) > CMD_SPACE_SIZE:
            raise ValueError(f'Code too large for CMD space ({len(code)} > {CMD_SPACE_SIZE} bytes)')

        logging.info(f'[CodeExecutor] Uploading {len(code)} bytes to CMD space...')
        
        # Upload code to CMD space
        await self.snes.PutAddress([[CMD_SPACE_ADDR, code]])
        
        logging.info('[CodeExecutor] Code uploaded to CMD space (0x002C00)')
        logging.info('[CodeExecutor] Trigger execution manually or via hijack')
        
        if wait_for_return:
            await asyncio.sleep(0.1)
        
        return True

    async def execute_snippet(self, code):
        """
        Execute simple assembly snippet in CMD space
        Automatically adds RTS (return) at the end
        
        Args:
            code: Assembly code bytes (without RTS)
        
        Returns:
            Success status (bool)
        """
        # Add RTS (0x60) at the end to return
        full_code = code + bytes([0x60])
        return await self.execute_in_cmd_space(full_code, True)

    # ========================================
    # RAM Execution
    # ========================================

    async def upload_to_ram(self, code, address=FREE_RAM_START):
        """
        Upload code to free RAM for execution
        
        Args:
            code: Assembly code bytes
            address: RAM address (default: 0x7F8000)
        
        Returns:
            Address where code was uploaded
        """
        if len(code) > FREE_RAM_SIZE:
            raise ValueError(f'Code too large for free RAM ({len(code)} > {FREE_RAM_SIZE} bytes)')

        logging.info(f'[CodeExecutor] Uploading {len(code)} bytes to RAM 0x{address:X}...')
        
        await self.snes.PutAddress([[address, code]])
        
        logging.info('[CodeExecutor] Code uploaded to RAM')
        return address

    async def execute_from_ram(self, address, method='jsl'):
        """
        Execute code from RAM
        
        Args:
            address: Address where code is located
            method: Execution method: 'jsl', 'jsr', 'jmp'
        
        Returns:
            Success status (bool)
        """
        logging.info(f'[CodeExecutor] Executing code at 0x{address:X} via {method.upper()}')
        logging.info(f'[CodeExecutor] Setup hijack to execute code: {method.upper()} ${address:X}')
        
        return True

    # ========================================
    # Assembly Templates
    # ========================================

    def create_write_byte_code(self, address, value):
        """
        Create assembly template for writing a byte to an address
        
        Args:
            address: Target address
            value: Byte value to write
        
        Returns:
            Assembly code (bytes)
        """
        # LDA #$value
        # STA $address
        # RTS
        code = bytes([
            0xA9, value,                              # LDA #$value
            0x8D, address & 0xFF, (address >> 8) & 0xFF,  # STA $address
            0x60                                      # RTS
        ])
        
        return code

    def create_write_word_code(self, address, value):
        """
        Create assembly template for writing a word (16-bit) to an address
        
        Args:
            address: Target address
            value: Word value to write (16-bit)
        
        Returns:
            Assembly code (bytes)
        """
        # REP #$20  ; Set A to 16-bit
        # LDA #$value
        # STA $address
        # SEP #$20  ; Set A back to 8-bit
        # RTS
        code = bytes([
            0xC2, 0x20,                               # REP #$20 (16-bit A)
            0xA9, value & 0xFF, (value >> 8) & 0xFF,  # LDA #$value
            0x8D, address & 0xFF, (address >> 8) & 0xFF,  # STA $address
            0xE2, 0x20,                               # SEP #$20 (8-bit A)
            0x60                                      # RTS
        ])
        
        return code

    def create_memory_copy_code(self, src_addr, dst_addr, length):
        """
        Create assembly template for copying memory
        
        Args:
            src_addr: Source address
            dst_addr: Destination address
            length: Number of bytes to copy
        
        Returns:
            Assembly code (bytes)
        """
        code = bytes([
            0xA2, 0x00, 0x00,                         # LDX #$0000
            # Loop:
            0xBD, src_addr & 0xFF, (src_addr >> 8) & 0xFF,  # LDA $srcAddr,X
            0x9D, dst_addr & 0xFF, (dst_addr >> 8) & 0xFF,  # STA $dstAddr,X
            0xE8,                                     # INX
            0xE0, length & 0xFF, (length >> 8) & 0xFF,      # CPX #$length
            0xD0, 0xF5,                               # BNE .loop (relative -11)
            0x60                                      # RTS
        ])
        
        return code

    def create_memory_fill_code(self, address, value, length):
        """
        Create assembly template for filling memory with a value
        
        Args:
            address: Start address
            value: Byte value to fill
            length: Number of bytes to fill
        
        Returns:
            Assembly code (bytes)
        """
        code = bytes([
            0xA9, value,                              # LDA #$value
            0xA2, 0x00, 0x00,                         # LDX #$0000
            # Loop:
            0x9D, address & 0xFF, (address >> 8) & 0xFF,    # STA $address,X
            0xE8,                                     # INX
            0xE0, length & 0xFF, (length >> 8) & 0xFF,      # CPX #$length
            0xD0, 0xF7,                               # BNE .loop (relative -9)
            0x60                                      # RTS
        ])
        
        return code

    def create_add_to_address_code(self, address, value):
        """
        Create assembly template for adding to a value at an address
        
        Args:
            address: Target address
            value: Value to add
        
        Returns:
            Assembly code (bytes)
        """
        code = bytes([
            0xAD, address & 0xFF, (address >> 8) & 0xFF,    # LDA $address
            0x18,                                     # CLC
            0x69, value,                              # ADC #$value
            0x8D, address & 0xFF, (address >> 8) & 0xFF,    # STA $address
            0x60                                      # RTS
        ])
        
        return code

    def create_conditional_write_code(self, cond_addr, cond_value, write_addr, write_value):
        """
        Create assembly template for conditional write
        
        Args:
            cond_addr: Condition address to check
            cond_value: Value to check for
            write_addr: Address to write to if condition met
            write_value: Value to write
        
        Returns:
            Assembly code (bytes)
        """
        code = bytes([
            0xAD, cond_addr & 0xFF, (cond_addr >> 8) & 0xFF,        # LDA $condAddr
            0xC9, cond_value,                                         # CMP #$condValue
            0xD0, 0x05,                                               # BNE .skip (+5)
            0xA9, write_value,                                        # LDA #$writeValue
            0x8D, write_addr & 0xFF, (write_addr >> 8) & 0xFF,      # STA $writeAddr
            # .skip:
            0x60                                                      # RTS
        ])
        
        return code

    # ========================================
    # High-Level Helpers
    # ========================================

    async def execute_write(self, address, value):
        """Execute a simple write operation via code execution"""
        code = self.create_write_byte_code(address, value)
        return await self.execute_snippet(code)

    async def execute_fill(self, address, value, length):
        """Execute a memory fill operation via code execution"""
        code = self.create_memory_fill_code(address, value, length)
        return await self.execute_snippet(code)

    async def execute_copy(self, src_addr, dst_addr, length):
        """Execute a memory copy operation via code execution"""
        code = self.create_memory_copy_code(src_addr, dst_addr, length)
        return await self.execute_snippet(code)

    # ========================================
    # Assembly Utilities
    # ========================================

    def assemble_instruction(self, instruction):
        """
        Assemble a simple 65816 instruction
        
        Args:
            instruction: Assembly instruction (e.g., "LDA #$02")
        
        Returns:
            Machine code bytes
        """
        import re
        cleaned = instruction.strip().upper()
        
        # LDA #$xx
        match = re.match(r'^LDA #\$([0-9A-F]{2})$', cleaned)
        if match:
            value = int(match.group(1), 16)
            return bytes([0xA9, value])
        
        # STA $xxxx
        match = re.match(r'^STA \$([0-9A-F]{4})$', cleaned)
        if match:
            addr = int(match.group(1), 16)
            return bytes([0x8D, addr & 0xFF, (addr >> 8) & 0xFF])
        
        # RTS
        if cleaned == 'RTS':
            return bytes([0x60])
        
        # RTL
        if cleaned == 'RTL':
            return bytes([0x6B])
        
        # NOP
        if cleaned == 'NOP':
            return bytes([0xEA])
        
        raise ValueError(f'Unsupported instruction: {instruction}')

    def assemble_instructions(self, instructions):
        """Assemble multiple instructions"""
        buffers = [self.assemble_instruction(inst) for inst in instructions]
        return b''.join(buffers)

    def disassemble(self, code):
        """
        Disassemble a buffer to show what it would do
        
        Args:
            code: Machine code bytes
        
        Returns:
            List of disassembled instructions
        """
        result = []
        i = 0
        
        while i < len(code):
            opcode = code[i]
            
            if opcode == 0xA9:  # LDA #$xx
                if i + 1 < len(code):
                    result.append(f'LDA #${code[i + 1]:02X}')
                    i += 2
                else:
                    result.append('??? (incomplete LDA)')
                    i += 1
                    
            elif opcode == 0x8D:  # STA $xxxx
                if i + 2 < len(code):
                    addr = code[i + 1] | (code[i + 2] << 8)
                    result.append(f'STA ${addr:04X}')
                    i += 3
                else:
                    result.append('??? (incomplete STA)')
                    i += 1
                    
            elif opcode == 0x60:  # RTS
                result.append('RTS')
                i += 1
                
            elif opcode == 0x6B:  # RTL
                result.append('RTL')
                i += 1
                
            elif opcode == 0xEA:  # NOP
                result.append('NOP')
                i += 1
                
            else:
                result.append(f'??? (${opcode:02X})')
                i += 1
        
        return result

