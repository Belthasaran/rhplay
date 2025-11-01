# serialport-nonblock

Native Node.js module to set `O_NONBLOCK` flag on file descriptors for non-blocking I/O.

## Purpose

This module provides a cross-platform way to set file descriptors to non-blocking mode, which is required for efficient serial port communication on Linux/macOS systems.

## Installation

The module will be automatically built when installed via npm:

```bash
npm install
```

## Usage

```javascript
const { setNonBlocking, getFlags } = require('serialport-nonblock');

// Open a file descriptor
const fs = require('fs');
const fd = fs.openSync('/dev/ttyACM0', 'r+');

// Set to non-blocking mode
try {
  setNonBlocking(fd);
  console.log('File descriptor set to non-blocking mode');
} catch (err) {
  console.error('Failed to set non-blocking:', err);
}

// Get current flags (for debugging)
const flags = getFlags(fd);
console.log('Current flags:', flags.toString(16));
```

## Platform Support

- ✅ Linux - Uses `fcntl()` with `O_NONBLOCK`
- ✅ macOS - Uses `fcntl()` with `O_NONBLOCK`
- ⚠️ Windows - Serial ports use overlapped I/O instead (best-effort implementation)

## Requirements

- Node.js >= 16.0.0
- node-gyp (installed automatically)
- C++ compiler (gcc/clang on Linux/macOS, Visual Studio on Windows)

## Building

The module uses `node-gyp` for building and is automatically compiled during `npm install`.

## License

MIT

