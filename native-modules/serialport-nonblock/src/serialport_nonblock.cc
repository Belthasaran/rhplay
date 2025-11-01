#include <napi.h>
#include <fcntl.h>
#include <errno.h>
#include <cstring>

#ifdef _WIN32
#include <io.h>
#include <windows.h>
#else
#include <unistd.h>
#include <sys/ioctl.h>
#include <sys/poll.h>
#include <termios.h>
// TIOCM_* constants are defined in <termios.h> on Linux and macOS
// On some systems they might be in <sys/ioctl.h>, but termios.h should have them
// tcdrain() is defined in <termios.h> on Unix systems
// poll() is defined in <sys/poll.h> on Linux
#endif

// Set O_NONBLOCK flag on a file descriptor
// Returns 0 on success, -1 on error (with errno set)
Napi::Value SetNonBlocking(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  // Validate arguments
  if (info.Length() < 1 || !info[0].IsNumber()) {
    Napi::TypeError::New(env, "Expected file descriptor (number) as first argument")
        .ThrowAsJavaScriptException();
    return env.Null();
  }

  int fd = info[0].As<Napi::Number>().Int32Value();

#ifdef _WIN32
  // On Windows, serial ports use overlapped I/O for non-blocking behavior
  // Windows doesn't have O_NONBLOCK like Unix systems
  // The serialport library handles this internally with overlapped I/O
  // For now, we'll just return success as Windows handles non-blocking differently
  // Note: Windows file handles obtained from _get_osfhandle can't be made non-blocking
  // the same way Unix systems can - they require overlapped I/O which is handled
  // at a different layer (by the serialport library)
  return Napi::Number::New(env, 0);
#else
  // On Unix-like systems (Linux, macOS), use fcntl to set O_NONBLOCK
  int flags = fcntl(fd, F_GETFL);
  if (flags == -1) {
    Napi::Error::New(env, "Failed to get file descriptor flags: " + std::string(strerror(errno)))
        .ThrowAsJavaScriptException();
    return env.Null();
  }

  // Set O_NONBLOCK flag
  flags |= O_NONBLOCK;
  int result = fcntl(fd, F_SETFL, flags);
  
  if (result == -1) {
    Napi::Error::New(env, "Failed to set O_NONBLOCK flag: " + std::string(strerror(errno)))
        .ThrowAsJavaScriptException();
    return env.Null();
  }

  return Napi::Number::New(env, 0);
#endif
}

// Get current flags (for debugging)
Napi::Value GetFlags(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 1 || !info[0].IsNumber()) {
    Napi::TypeError::New(env, "Expected file descriptor (number) as first argument")
        .ThrowAsJavaScriptException();
    return env.Null();
  }

  int fd = info[0].As<Napi::Number>().Int32Value();

#ifdef _WIN32
  // Windows doesn't have fcntl, return a placeholder
  return Napi::Number::New(env, 0);
#else
  int flags = fcntl(fd, F_GETFL);
  if (flags == -1) {
    Napi::Error::New(env, "Failed to get file descriptor flags: " + std::string(strerror(errno)))
        .ThrowAsJavaScriptException();
    return env.Null();
  }

  return Napi::Number::New(env, flags);
#endif
}

// Set TIOCEXCL (exclusive lock) on a file descriptor
// Returns 0 on success, -1 on error (with errno set)
Napi::Value SetExclusive(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 1 || !info[0].IsNumber()) {
    Napi::TypeError::New(env, "Expected file descriptor as a number").ThrowAsJavaScriptException();
    return env.Null();
  }

  int fd = info[0].As<Napi::Number>().Int32Value();

#ifdef _WIN32
  // On Windows, exclusive access is handled differently
  // For now, just return success
  return Napi::Number::New(env, 0);
#else
  // Set TIOCEXCL to acquire exclusive lock on the device
  int result = ioctl(fd, TIOCEXCL);
  if (result == -1) {
    Napi::Error::New(env, "Failed to set TIOCEXCL: " + std::string(strerror(errno)))
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  return Napi::Number::New(env, 0);
#endif
}

// Clear TIOCEXCL (release exclusive lock) on a file descriptor
// Returns 0 on success, -1 on error (with errno set)
Napi::Value ClearExclusive(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 1 || !info[0].IsNumber()) {
    Napi::TypeError::New(env, "Expected file descriptor as a number").ThrowAsJavaScriptException();
    return env.Null();
  }

  int fd = info[0].As<Napi::Number>().Int32Value();

#ifdef _WIN32
  // On Windows, exclusive access is handled differently
  // For now, just return success
  return Napi::Number::New(env, 0);
#else
  // Set TIOCNXCL to release exclusive lock on the device
  int result = ioctl(fd, TIOCNXCL);
  if (result == -1) {
    Napi::Error::New(env, "Failed to set TIOCNXCL: " + std::string(strerror(errno)))
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  return Napi::Number::New(env, 0);
#endif
}

// Flush serial port buffers (TCFLSH with TCIOFLUSH)
// Returns 0 on success, -1 on error (with errno set)
Napi::Value FlushBuffers(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 1 || !info[0].IsNumber()) {
    Napi::TypeError::New(env, "Expected file descriptor as a number").ThrowAsJavaScriptException();
    return env.Null();
  }

  int fd = info[0].As<Napi::Number>().Int32Value();

#ifdef _WIN32
  // On Windows, use FlushFileBuffers or similar
  // For now, just return success
  return Napi::Number::New(env, 0);
#else
  // TCFLSH with TCIOFLUSH flushes both input and output buffers
  // This is what QUSB2Snes does after writing a command
  int result = ioctl(fd, TCFLSH, TCIOFLUSH);
  if (result == -1) {
    Napi::Error::New(env, "Failed to flush buffers (TCFLSH): " + std::string(strerror(errno)))
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  return Napi::Number::New(env, 0);
#endif
}

// Get modem control state (TIOCMGET)
// Returns the modem control bits (TIOCM_DTR, TIOCM_RTS, etc.)
Napi::Value GetModemControl(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 1 || !info[0].IsNumber()) {
    Napi::TypeError::New(env, "Expected file descriptor as a number").ThrowAsJavaScriptException();
    return env.Null();
  }

  int fd = info[0].As<Napi::Number>().Int32Value();

#ifdef _WIN32
  // Windows uses different mechanisms for DTR/RTS control
  return Napi::Number::New(env, 0);
#else
  int status;
  int result = ioctl(fd, TIOCMGET, &status);
  if (result == -1) {
    Napi::Error::New(env, "Failed to get modem control (TIOCMGET): " + std::string(strerror(errno)))
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  return Napi::Number::New(env, status);
#endif
}

// Clear modem control bits (TIOCMBIC)
// Used to clear DTR for reset: ioctl(fd, TIOCMBIC, TIOCM_DTR)
Napi::Value ClearModemControl(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsNumber()) {
    Napi::TypeError::New(env, "Expected file descriptor and control bits (numbers)").ThrowAsJavaScriptException();
    return env.Null();
  }

  int fd = info[0].As<Napi::Number>().Int32Value();
  int bits = info[1].As<Napi::Number>().Int32Value();

#ifdef _WIN32
  // Windows uses different mechanisms for DTR/RTS control
  return Napi::Number::New(env, 0);
#else
  // TIOCMBIC clears the specified modem control bits
  int result = ioctl(fd, TIOCMBIC, &bits);
  if (result == -1) {
    Napi::Error::New(env, "Failed to clear modem control (TIOCMBIC): " + std::string(strerror(errno)))
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  return Napi::Number::New(env, 0);
#endif
}

// Set modem control bits (TIOCMBIS)
// Used to set DTR: ioctl(fd, TIOCMBIS, TIOCM_DTR)
Napi::Value SetModemControl(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsNumber()) {
    Napi::TypeError::New(env, "Expected file descriptor and control bits (numbers)").ThrowAsJavaScriptException();
    return env.Null();
  }

  int fd = info[0].As<Napi::Number>().Int32Value();
  int bits = info[1].As<Napi::Number>().Int32Value();

#ifdef _WIN32
  // Windows uses different mechanisms for DTR/RTS control
  return Napi::Number::New(env, 0);
#else
  // TIOCMBIS sets the specified modem control bits
  int result = ioctl(fd, TIOCMBIS, &bits);
  if (result == -1) {
    Napi::Error::New(env, "Failed to set modem control (TIOCMBIS): " + std::string(strerror(errno)))
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  return Napi::Number::New(env, 0);
#endif
}

// Drain serial port output (wait until all data has been transmitted)
// Returns 0 on success, -1 on error (with errno set)
// CRITICAL: This ensures that data written with writeSync is actually transmitted
// before returning, especially important for NORESP commands
Napi::Value DrainOutput(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 1 || !info[0].IsNumber()) {
    Napi::TypeError::New(env, "Expected file descriptor as a number").ThrowAsJavaScriptException();
    return env.Null();
  }

  int fd = info[0].As<Napi::Number>().Int32Value();

#ifdef _WIN32
  // On Windows, use FlushFileBuffers to ensure data is written
  HANDLE hFile = (HANDLE)_get_osfhandle(fd);
  if (hFile == INVALID_HANDLE_VALUE) {
    Napi::Error::New(env, "Invalid file descriptor").ThrowAsJavaScriptException();
    return env.Null();
  }
  if (!FlushFileBuffers(hFile)) {
    Napi::Error::New(env, "Failed to flush file buffers: " + std::to_string(GetLastError()))
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  return Napi::Number::New(env, 0);
#else
  // On Unix systems, use tcdrain() to wait until all output has been transmitted
  int result = tcdrain(fd);
  if (result == -1) {
    Napi::Error::New(env, "Failed to drain output (tcdrain): " + std::string(strerror(errno)))
        .ThrowAsJavaScriptException();
    return env.Null();
  }

  return Napi::Number::New(env, 0);
#endif
}

// Disable all flow control on serial port
// CRITICAL: Ensures the TTY does not wait for RTS/CTS or XON/XOFF signals
// that don't exist on the USB2SNES device
Napi::Value DisableFlowControl(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 1 || !info[0].IsNumber()) {
    Napi::TypeError::New(env, "Expected file descriptor as a number").ThrowAsJavaScriptException();
    return env.Null();
  }

  int fd = info[0].As<Napi::Number>().Int32Value();

#ifdef _WIN32
  // Windows flow control is configured differently
  // For now, just return success
  return Napi::Number::New(env, 0);
#else
  // Get current termios settings
  struct termios tios;
  if (tcgetattr(fd, &tios) == -1) {
    Napi::Error::New(env, "Failed to get termios settings: " + std::string(strerror(errno)))
        .ThrowAsJavaScriptException();
    return env.Null();
  }

  // Disable hardware flow control (RTS/CTS)
  tios.c_cflag &= ~CRTSCTS;
  
  // Disable software flow control (XON/XOFF)
  tios.c_iflag &= ~(IXON | IXOFF | IXANY);
  
  // Set CLOCAL to indicate local connection (no modem control)
  tios.c_cflag |= CLOCAL;
  
  // Apply the new settings
  if (tcsetattr(fd, TCSANOW, &tios) == -1) {
    Napi::Error::New(env, "Failed to set termios settings: " + std::string(strerror(errno)))
        .ThrowAsJavaScriptException();
    return env.Null();
  }

  return Napi::Number::New(env, 0);
#endif
}

// Poll file descriptor for data (using poll() system call like QUSB2Snes)
// Returns 0 if data is ready, 1 if timeout, -1 on error
Napi::Value PollForData(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsNumber()) {
    Napi::TypeError::New(env, "Expected file descriptor and timeout (numbers)").ThrowAsJavaScriptException();
    return env.Null();
  }

  int fd = info[0].As<Napi::Number>().Int32Value();
  int timeoutMs = info[1].As<Napi::Number>().Int32Value();

#ifdef _WIN32
  // Windows doesn't have poll(), use a placeholder
  return Napi::Number::New(env, -1);
#else
  // Use poll() to wait for data (matching QUSB2Snes behavior)
  struct pollfd pfd;
  pfd.fd = fd;
  pfd.events = POLLIN | POLLOUT; // Wait for input or output ready
  pfd.revents = 0;
  
  // poll() timeout is in milliseconds
  int result = poll(&pfd, 1, timeoutMs);
  
  if (result == -1) {
    // Error occurred
    Napi::Error::New(env, "poll() failed: " + std::string(strerror(errno)))
        .ThrowAsJavaScriptException();
    return env.Null();
  } else if (result == 0) {
    // Timeout - no data available
    return Napi::Number::New(env, 1);
  } else {
    // Data is ready - check revents
    if (pfd.revents & POLLIN) {
      // Input data available
      return Napi::Number::New(env, 0);
    } else if (pfd.revents & POLLOUT) {
      // Output ready (write can proceed)
      // This means write completed, but no input yet
      return Napi::Number::New(env, 1); // Still waiting for input
    } else {
      // Other event (error, etc.)
      return Napi::Number::New(env, -1);
    }
  }
#endif
}

// Initialize the module
Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set(Napi::String::New(env, "setNonBlocking"),
              Napi::Function::New(env, SetNonBlocking));
  exports.Set(Napi::String::New(env, "getFlags"),
              Napi::Function::New(env, GetFlags));
  exports.Set(Napi::String::New(env, "setExclusive"),
              Napi::Function::New(env, SetExclusive));
  exports.Set(Napi::String::New(env, "clearExclusive"),
              Napi::Function::New(env, ClearExclusive));
  exports.Set(Napi::String::New(env, "flushBuffers"),
              Napi::Function::New(env, FlushBuffers));
  exports.Set(Napi::String::New(env, "drainOutput"),
              Napi::Function::New(env, DrainOutput));
  exports.Set(Napi::String::New(env, "getModemControl"),
              Napi::Function::New(env, GetModemControl));
  exports.Set(Napi::String::New(env, "clearModemControl"),
              Napi::Function::New(env, ClearModemControl));
  exports.Set(Napi::String::New(env, "setModemControl"),
              Napi::Function::New(env, SetModemControl));
  exports.Set(Napi::String::New(env, "disableFlowControl"),
              Napi::Function::New(env, DisableFlowControl));
  exports.Set(Napi::String::New(env, "pollForData"),
              Napi::Function::New(env, PollForData));
  
  // Export TIOCM_* constants for use in JavaScript
#ifdef _WIN32
  // Windows doesn't have TIOCM_* constants, provide placeholders
  exports.Set(Napi::String::New(env, "TIOCM_DTR"), Napi::Number::New(env, 2));
  exports.Set(Napi::String::New(env, "TIOCM_RTS"), Napi::Number::New(env, 4));
  exports.Set(Napi::String::New(env, "TIOCM_CTS"), Napi::Number::New(env, 32));
#else
  exports.Set(Napi::String::New(env, "TIOCM_DTR"), Napi::Number::New(env, TIOCM_DTR));
  exports.Set(Napi::String::New(env, "TIOCM_RTS"), Napi::Number::New(env, TIOCM_RTS));
  exports.Set(Napi::String::New(env, "TIOCM_CTS"), Napi::Number::New(env, TIOCM_CTS));
#endif
  
  return exports;
}

NODE_API_MODULE(serialport_nonblock, Init)

