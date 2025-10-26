/**
 * flips-finder.js - Locate Flips Binary
 * 
 * DEPRECATED: This module is maintained for backwards compatibility.
 * Please use binary-finder.js for new code.
 * 
 * This module re-exports flips-finding functionality from binary-finder.js
 */

const { BinaryFinder, getFlipsPath, findFlips } = require('./binary-finder');

// For backwards compatibility, export FlipsFinder as an alias
class FlipsFinder extends BinaryFinder {
  constructor(options = {}) {
    super(options);
  }
  
  // Keep the same interface
  findFlips() {
    return super.findFlips();
  }
  
  getFlipsPathOrThrow() {
    return super.getFlipsPathOrThrow();
  }
  
  validateFlipsBinary(flipsPath) {
    return super.validateBinary(flipsPath, 'flips');
  }
  
  generateErrorMessage() {
    return super.generateErrorMessage('flips', 'FLIPS_BIN_PATH', 'flips_path');
  }
}

module.exports = {
  FlipsFinder,
  getFlipsPath,
  findFlips
};
