/**
 * Serial port non-blocking module
 * Provides native functions to set O_NONBLOCK flag on file descriptors
 */

const binding = require('./build/Release/serialport_nonblock.node');

/**
 * Set O_NONBLOCK flag on a file descriptor
 * @param {number} fd - File descriptor
 * @returns {number} 0 on success, throws error on failure
 */
function setNonBlocking(fd) {
  return binding.setNonBlocking(fd);
}

/**
 * Get current file descriptor flags (for debugging)
 * @param {number} fd - File descriptor
 * @returns {number} Flags value
 */
function getFlags(fd) {
  return binding.getFlags(fd);
}

/**
 * Set TIOCEXCL (exclusive lock) on a file descriptor
 * @param {number} fd - File descriptor
 * @returns {number} 0 on success, throws error on failure
 */
function setExclusive(fd) {
  return binding.setExclusive(fd);
}

/**
 * Clear TIOCEXCL (release exclusive lock) on a file descriptor
 * @param {number} fd - File descriptor
 * @returns {number} 0 on success, throws error on failure
 */
function clearExclusive(fd) {
  return binding.clearExclusive(fd);
}

/**
 * Flush serial port buffers using TCFLSH with TCIOFLUSH
 * @param {number} fd - File descriptor
 * @returns {number} 0 on success, throws error on failure
 */
function flushBuffers(fd) {
  return binding.flushBuffers(fd);
}

/**
 * Drain output buffer (wait until all data has been transmitted)
 * CRITICAL: This ensures data written with writeSync is actually transmitted
 * before returning, especially important for NORESP commands
 * @param {number} fd - File descriptor
 * @returns {number} 0 on success, throws error on failure
 */
function drainOutput(fd) {
  return binding.drainOutput(fd);
}

/**
 * Get modem control state (TIOCMGET)
 * @param {number} fd - File descriptor
 * @returns {number} Modem control bits (TIOCM_DTR, TIOCM_RTS, etc.)
 */
function getModemControl(fd) {
  return binding.getModemControl(fd);
}

/**
 * Clear modem control bits (TIOCMBIC)
 * Used to clear DTR for reset: clearModemControl(fd, TIOCM_DTR)
 * @param {number} fd - File descriptor
 * @param {number} bits - Bits to clear (e.g., TIOCM_DTR)
 * @returns {number} 0 on success, throws error on failure
 */
function clearModemControl(fd, bits) {
  return binding.clearModemControl(fd, bits);
}

/**
 * Set modem control bits (TIOCMBIS)
 * Used to set DTR: setModemControl(fd, TIOCM_DTR)
 * @param {number} fd - File descriptor
 * @param {number} bits - Bits to set (e.g., TIOCM_DTR)
 * @returns {number} 0 on success, throws error on failure
 */
function setModemControl(fd, bits) {
  return binding.setModemControl(fd, bits);
}

/**
 * Disable all flow control on serial port
 * CRITICAL: Ensures the TTY does not wait for RTS/CTS or XON/XOFF signals
 * that don't exist on the USB2SNES device
 * @param {number} fd - File descriptor
 * @returns {number} 0 on success, throws error on failure
 */
function disableFlowControl(fd) {
  return binding.disableFlowControl(fd);
}

/**
 * Poll file descriptor for data using poll() system call (like QUSB2Snes)
 * @param {number} fd - File descriptor
 * @param {number} timeoutMs - Timeout in milliseconds
 * @returns {number} 0 if data is ready, 1 if timeout, -1 on error
 */
function pollForData(fd, timeoutMs) {
  return binding.pollForData(fd, timeoutMs);
}

module.exports = {
  setNonBlocking,
  getFlags,
  setExclusive,
  clearExclusive,
  flushBuffers,
  drainOutput,
  getModemControl,
  clearModemControl,
  setModemControl,
  disableFlowControl,
  pollForData,
  // Export constants
  TIOCM_DTR: binding.TIOCM_DTR,
  TIOCM_RTS: binding.TIOCM_RTS,
  TIOCM_CTS: binding.TIOCM_CTS
};

