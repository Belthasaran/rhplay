/**
 * Load native binding for usb2snes-core
 */
let binding;

try {
  // Try to load the compiled native module
  binding = require('./index.node');
} catch (err) {
  console.error('Failed to load usb2snes-core native module:', err);
  throw err;
}

module.exports = binding;

