# USB2SNES Core - Rust Native Module

This is a Rust-based native module that ports the `Core` implementation to provide cross-platform USB2SNES communication.

## Features

- **Exact compatibility**: Ports the exact packet format and serial port configuration from `Core`
- **Cross-platform**: Works on Linux, macOS, and Windows
- **Native performance**: Rust provides memory safety without GC overhead
- **Direct serial access**: Uses `serialport` crate for direct system-level serial port control
- **No flow control**: Properly disables flow control (matching C# `Handshake.None`)

## Serial Port Configuration

Matches C# `RebuildPort()` settings exactly:
- BaudRate: 9600
- Parity: None
- DataBits: 8
- StopBits: One
- Handshake: None (no flow control!)
- ReadTimeout: 5000ms
- WriteTimeout: 5000ms
- DTR: true (enabled)

## Packet Format

512-byte packets:
- Bytes 0-3: "USBA" magic header (0x55, 0x53, 0x42, 0x41)
- Byte 4: opcode
- Byte 5: space
- Byte 6: flags
- Bytes 7-511: arguments/padding

## Build

```bash
npm install
npm run build
```

## Usage

```javascript
const { Usb2SnesCore } = require('./index.js');

const core = new Usb2SnesCore();
await core.connect('/dev/ttyACM0');

const response = await core.sendCommand(11, 1, 0, null); // INFO opcode
console.log('Response:', response);

await core.reset(); // Reset SNES
await core.disconnect();
```

