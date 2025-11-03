# USB2SNES Core - Rust Implementation Plan

## Overview

This Rust native module ports the `Core` implementation to provide cross-platform USB2SNES communication that works on Linux, macOS, and Windows.

## Key Advantages

1. **Direct port**: Mirrors the exact packet format and serial port configuration from the working implementation
2. **Cross-platform**: Rust `serialport` crate provides native support for all platforms
3. **Memory safety**: No GC overhead, guaranteed memory safety
4. **Direct system calls**: Better access to serial port ioctl operations, termios settings, etc.
5. **No flow control issues**: Properly disables flow control at the system level

## Implementation Status

### ✅ Created Structure
- Cargo.toml with dependencies
- Basic Rust implementation with N-API bindings
- Serial port configuration matching C exactly

### 🔄 Needs Completion

1. **Argument Encoding**: Port the full argument encoding format from `SendCommand`:
   - GET/PUT: Address/size encoding at bytes 252-255
   - LS/MKDIR/RM/MV/BOOT: String encoding at bytes 8+
   - VGET/VPUT: Multiple (address, size) pairs at bytes 32+
   - INFO/RESET: No arguments

2. **Response Parsing**: Port the response format:
   - INFO response parsing (firmware version, ROM name, flags)
   - LS response parsing (file listings)
   - GET/VGET response handling
   - Error response detection

3. **Error Handling**: Proper timeout handling, connection errors

4. **NORESP Flag Handling**: Commands with NORESP flag (like RESET) don't wait for response

5. **Integration**: Replace JavaScript `usbDeviceHandler.js` calls with Rust module calls

## Reference Configuration

From `Core` lines 360-369:
```
safeSerialPort.BaudRate = 9600;
safeSerialPort.Parity = Parity.None;
safeSerialPort.DataBits = 8;
safeSerialPort.StopBits = StopBits.One;
safeSerialPort.Handshake = Handshake.None;  // NO FLOW CONTROL!
safeSerialPort.ReadTimeout = 5000;
safeSerialPort.WriteTimeout = 5000;
safeSerialPort.DtrEnable = true;
```

## Packet Format

512-byte packets (line 440):
- Bytes 0-3: "USBA" magic (0x55, 0x53, 0x42, 0x41)
- Byte 4: opcode
- Byte 5: space  
- Byte 6: flags
- Bytes 7-511: arguments/padding

## Next Steps

1. Complete argument encoding for all opcodes
2. Implement response parsing
3. Add async support if needed for Node.js
4. Test with real hardware
5. Integrate into main application

