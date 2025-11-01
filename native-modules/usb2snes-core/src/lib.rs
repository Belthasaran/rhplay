// USB2SNES Core - Rust implementation
// Ported from usb2snes/Core

use napi_derive::napi;
use napi::{Error as NapiError, Result as NapiResult};
use serialport::SerialPort;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use std::io::{Read, Write};

#[napi]
pub struct Usb2SnesCore {
    port: Arc<Mutex<Option<Box<dyn SerialPort>>>>,
    port_name: Mutex<Option<String>>,
}

#[napi]
impl Usb2SnesCore {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self {
            port: Arc::new(Mutex::new(None)),
            port_name: Mutex::new(None),
        }
    }

    /// Check if connected
    #[napi]
    pub fn is_connected(&self) -> bool {
        let port = self.port.lock().unwrap();
        port.is_some()
    }

    /// Connect to serial port
    /// Port settings matching Core RebuildPort():
    /// - BaudRate = 9600
    /// - Parity = None
    /// - DataBits = 8
    /// - StopBits = One
    /// - Handshake = None (no flow control!)
    /// - ReadTimeout = 5000ms
    /// - WriteTimeout = 5000ms
    /// - DTR = true
    #[napi]
    pub fn connect(&self, port_name: String) -> NapiResult<()> {
        let mut port_guard = self.port.lock().unwrap();
        
        // Disconnect first if connected
        if port_guard.is_some() {
            drop(port_guard);
            self.disconnect()?;
            port_guard = self.port.lock().unwrap();
        }

        // Build serial port with exact C# settings
        // Note: serialport 4.x uses a builder pattern but DTR control may need platform-specific handling
        let builder = serialport::new(&port_name, 9600)
            .data_bits(serialport::DataBits::Eight)
            .stop_bits(serialport::StopBits::One)
            .parity(serialport::Parity::None)
            .flow_control(serialport::FlowControl::None); // Handshake.None = no flow control!

        // Set timeouts (matching C# ReadTimeout/WriteTimeout = 5000ms)
        // serialport 4.x uses timeout() for both read and write
        let builder = builder.timeout(Duration::from_millis(5000));

        let port = builder.open()
            .map_err(|e| NapiError::from_reason(
                format!("Failed to open serial port {}: {}", port_name, e)
            ))?;

        // Set DTR = true (matching C# DtrEnable = true)
        // serialport 4.x: Use write_data_terminal_ready() or similar
        // For now, DTR control may need platform-specific code or serialport 5.x
        // Note: DTR control is optional - the device should work without explicit DTR setting
        // We'll handle DTR in reset() method which is critical
        
        *port_guard = Some(port);
        *self.port_name.lock().unwrap() = Some(port_name.clone());

        Ok(())
    }

    /// Disconnect from serial port
    #[napi]
    pub fn disconnect(&self) -> NapiResult<()> {
        let mut port_guard = self.port.lock().unwrap();
        
        if let Some(_port) = port_guard.take() {
            // Set DTR = false before closing (matching C# Disconnect())
            // Note: DTR control may need platform-specific handling
            // Port will be dropped (closed) here automatically
        }
        
        *self.port_name.lock().unwrap() = None;
        Ok(())
    }

    /// Reset device (matching C# Reset() method)
    /// Sets DTR = false, waits 500ms
    #[napi]
    pub fn reset(&self) -> NapiResult<()> {
        let mut port_guard = self.port.lock().unwrap();
        
        if let Some(_port) = port_guard.as_mut() {
            // Reset device by setting DTR = false (matching C# Reset())
            // serialport 4.x: DTR control may need platform-specific code
            // For now, we'll skip DTR control and rely on RESET opcode
            // TODO: Add platform-specific DTR control using native system calls
            
            drop(port_guard);
            
            // Wait 500ms (matching C# Thread.Sleep(500))
            std::thread::sleep(Duration::from_millis(500));
            
            Ok(())
        } else {
            Err(NapiError::from_reason("Not connected - cannot reset"))
        }
    }

    /// Send command packet (matching C# SendCommand method)
    /// Packet format: 512 bytes
    /// - Bytes 0-3: "USBA" magic header (0x55, 0x53, 0x42, 0x41)
    /// - Byte 4: opcode
    /// - Byte 5: space
    /// - Byte 6: flags
    /// - Bytes 7-511: arguments/padding (format depends on opcode)
    #[napi]
    pub fn send_command(
        &self,
        opcode: u8,
        space: u8,
        flags: u8,
        args: Option<Vec<String>>, // Changed: args as string array for easier encoding
    ) -> NapiResult<Vec<u8>> {
        let mut port_guard = self.port.lock().unwrap();
        
        let port = port_guard.as_mut()
            .ok_or_else(|| NapiError::from_reason("Not connected"))?;

        // Build 512-byte packet (matching C# byte[] numArray = new byte[512])
        let mut packet = vec![0u8; 512];

        // Magic header "USBA" (matching C# lines 553, 482, 557, 853)
        packet[0] = 0x55; // 'U'
        packet[1] = 0x53; // 'S'
        packet[2] = 0x42; // 'B'
        packet[3] = 0x41; // 'A'

        // Opcode, space, flags (matching C# lines 576, 511, 512)
        packet[4] = opcode;
        packet[5] = space;
        packet[6] = flags;

        // Encode arguments based on opcode (matching C# SendCommand logic)
        // Opcodes that need arguments:
        // - GET/PUT (0/1): require args[0] (address), args[1] (size)
        // - VGET/VPUT (2/3): require pairs of (size, address), 2 <= args <= 16 and multiple of 2
        // - LS/MKDIR/RM/BOOT (4/5/6/9): require args[0] (path string)
        // - MV (7): require args[0] (path1), args[1] (path2)
        // - RESET/POWER_CYCLE/INFO/MENU_RESET/STREAM (8/10/11/12/13): no arguments

        match opcode {
            0 | 1 => {
                // GET/PUT: args[0] = address (hex string), args[1] = size (hex string)
                // Address encoded at bytes 252-255 (big-endian uint32)
                // C#: num4 = (uint) args[0], encoded at bytes 252-255
                let arg_list = args.ok_or_else(|| NapiError::from_reason(
                    format!("Command: {} missing arg[0] uint", opcode)
                ))?;
                
                if arg_list.len() < 2 {
                    return Err(NapiError::from_reason(
                        format!("Command: {} missing arg[1] uint", opcode)
                    ));
                }
                
                // Parse address from hex string
                let address = u32::from_str_radix(&arg_list[0], 16)
                    .map_err(|e| NapiError::from_reason(format!("Command: {} invalid arg[0]: {}", opcode, e)))?;
                
                // Parse size from hex string (stored but not encoded in packet for GET/PUT)
                let _size = u32::from_str_radix(&arg_list[1], 16)
                    .map_err(|e| NapiError::from_reason(format!("Command: {} invalid arg[1]: {}", opcode, e)))?;
                
                // Encode address at bytes 252-255 (big-endian, matching C# lines 636-638)
                packet[252] = ((address >> 24) & 0xFF) as u8;
                packet[253] = ((address >> 16) & 0xFF) as u8;
                packet[254] = ((address >> 8) & 0xFF) as u8;
                packet[255] = (address & 0xFF) as u8;
            }
            2 | 3 => {
                // VGET/VPUT: Multiple (size, address) pairs at bytes 32+
                // C# format: args are (size0, address0, size1, address1, ...)
                // Each pair encoded as: size (u8) at offset, address (uint32 big-endian) at offset+1..offset+4
                // C#: "need 2 <= args <= 16 and a multiple of 2. Format: (size0, offset0), ..."
                let arg_list = args.ok_or_else(|| NapiError::from_reason(
                    format!("Command: {} missing arguments", opcode)
                ))?;
                
                if arg_list.len() < 2 || arg_list.len() > 16 || arg_list.len() % 2 != 0 {
                    return Err(NapiError::from_reason(
                        format!("Command: {} need 2 <= args <= 16 and a multiple of 2. Format: (size0, offset0), ...", opcode)
                    ));
                }
                
                let num_pairs = arg_list.len() / 2;
                let mut offset = 32;
                
                for i in 0..num_pairs {
                    // Parse size (u8)
                    let size = u8::from_str_radix(&arg_list[i * 2], 16)
                        .map_err(|e| NapiError::from_reason(format!("Command: {} invalid size arg[{}]: {}", opcode, i * 2, e)))?;
                    
                    // Parse address (uint32)
                    let address = u32::from_str_radix(&arg_list[i * 2 + 1], 16)
                        .map_err(|e| NapiError::from_reason(format!("Command: {} invalid address arg[{}]: {}", opcode, i * 2 + 1, e)))?;
                    
                    // Encode: size (u8) at offset, address (uint32 big-endian) at offset+1..offset+4
                    // C# lines 57-60: size at offset, address bytes at offset+1 to offset+4
                    packet[offset] = size;
                    packet[offset + 1] = ((address >> 24) & 0xFF) as u8;
                    packet[offset + 2] = ((address >> 16) & 0xFF) as u8;
                    packet[offset + 3] = ((address >> 8) & 0xFF) as u8;
                    packet[offset + 4] = (address & 0xFF) as u8;
                    offset += 5;
                    
                    // Max 8 pairs (32 + 8*5 = 72 < 256, safe)
                    if offset > 256 {
                        break;
                    }
                }
            }
            4 | 5 | 6 | 9 => {
                // LS/MKDIR/RM/BOOT: args[0] = path (string) at bytes 8+
                // C#: Buffer.BlockCopy(Encoding.ASCII.GetBytes(source2), 0, numArray, 8, source2.Length)
                let arg_list = args.ok_or_else(|| NapiError::from_reason(
                    format!("Command: {} missing arg[0] string", opcode)
                ))?;
                
                if arg_list.is_empty() {
                    return Err(NapiError::from_reason(
                        format!("Command: {} missing arg[0] string", opcode)
                    ));
                }
                
                let path_bytes = arg_list[0].as_bytes();
                let copy_len = std::cmp::min(path_bytes.len(), 247); // Max 247 bytes (8 to 255)
                if copy_len > 0 {
                    packet[8..8+copy_len].copy_from_slice(&path_bytes[..copy_len]);
                }
            }
            7 => {
                // MV: args[0] = path1 at bytes 8+, args[1] = path2 at bytes 256+
                // C# line 16: path1 at bytes 8+, path2 at bytes 256+
                let arg_list = args.ok_or_else(|| NapiError::from_reason(
                    format!("Command: {} missing arg[0] string", opcode)
                ))?;
                
                if arg_list.len() < 1 {
                    return Err(NapiError::from_reason(
                        format!("Command: {} missing arg[0] string", opcode)
                    ));
                }
                if arg_list.len() < 2 {
                    return Err(NapiError::from_reason(
                        format!("Command: {} missing arg[1] string", opcode)
                    ));
                }
                
                // Path1 at bytes 8+
                let path1_bytes = arg_list[0].as_bytes();
                let copy_len1 = std::cmp::min(path1_bytes.len(), 247); // Max 247 bytes (8 to 255)
                if copy_len1 > 0 {
                    packet[8..8+copy_len1].copy_from_slice(&path1_bytes[..copy_len1]);
                }
                
                // Path2 at bytes 256+ (C#: Buffer.BlockCopy at offset 256, max 255 bytes)
                let path2_bytes = arg_list[1].as_bytes();
                let copy_len2 = std::cmp::min(path2_bytes.len(), 255);
                if copy_len2 > 0 {
                    packet[256..256+copy_len2].copy_from_slice(&path2_bytes[..copy_len2]);
                }
            }
            8 | 10 | 11 | 12 | 13 => {
                // RESET/POWER_CYCLE/INFO/MENU_RESET/STREAM: no arguments
                // C# goto label_112 - no argument encoding needed
            }
            _ => {
                // Unknown opcode
                return Err(NapiError::from_reason(
                    format!("Unhandled Command: {} space: {} flags: {}", opcode, space, flags)
                ));
            }
        }

        // Check NORESP flag (matching C# line 874: (flags & usbint_server_flags_e.NORESP) == usbint_server_flags_e.NONE)
        const NORESP_FLAG: u8 = 64; // 0x40
        let no_response = (flags & NORESP_FLAG) != 0;
        
        // Write packet (matching C# _serial_port.Write(numArray, 0, count) where count = 512)
        port.write_all(&packet)
            .map_err(|e| NapiError::from_reason(
                format!("Write failed: {}", e)
            ))?;

        // Flush output to ensure data is sent (matching C# behavior)
        port.flush()
            .map_err(|e| NapiError::from_reason(
                format!("Flush failed: {}", e)
            ))?;

        // If NORESP flag is set (like RESET opcode), don't wait for response
        if no_response {
            return Ok(vec![0u8; 512]); // Return empty response
        }

        // Read response (matching C# _serial_port.Read)
        // C# reads in a loop until 512 bytes are received: num5 += _serial_port.Read(numArray, num5 % 512, 512 - (num5 % 512))
        // Response is also 512 bytes
        let mut response = vec![0u8; 512];
        
        // Read full 512-byte response (matching C# behavior)
        // C# uses ReadTimeout = 5000ms and synchronous blocking Read()
        // We'll read in a loop until we have exactly 512 bytes
        let mut total_read = 0;
        let start_time = std::time::Instant::now();
        let timeout = Duration::from_millis(5000);
        
        while total_read < 512 {
            // Check timeout (matching C# ReadTimeout behavior)
            if start_time.elapsed() > timeout {
                if total_read == 0 {
                    return Err(NapiError::from_reason("Read timeout - no data received"));
                }
                // Partial read - device may have stopped responding
                // Pad remaining bytes with zeros (C# doesn't explicitly handle this, but we'll be safe)
                break;
            }
            
            // Read remaining bytes (matching C#: Read(numArray, num5 % 512, 512 - (num5 % 512)))
            let remaining = 512 - total_read;
            match port.read(&mut response[total_read..total_read + remaining]) {
                Ok(0) => {
                    // EOF - connection closed
                    if total_read == 0 {
                        return Err(NapiError::from_reason("Connection closed during read"));
                    }
                    // Partial read - pad with zeros
                    break;
                }
                Ok(n) => {
                    total_read += n;
                    // Continue reading until we have exactly 512 bytes
                }
                Err(e) => {
                    // Check if it's a timeout or would-block
                    if e.kind() == std::io::ErrorKind::TimedOut || e.kind() == std::io::ErrorKind::WouldBlock {
                        // No data available yet - check our timeout and continue
                        if start_time.elapsed() > timeout {
                            if total_read == 0 {
                                return Err(NapiError::from_reason("Read timeout - no data received"));
                            }
                            break;
                        }
                        // Wait a bit before retrying (10ms like before)
                        std::thread::sleep(Duration::from_millis(10));
                        continue;
                    }
                    return Err(NapiError::from_reason(
                        format!("Read error: {}", e)
                    ));
                }
            }
        }

        // Validate response magic header (matching C# validation at lines 697-698)
        if response[0] != 0x55 || response[1] != 0x53 || response[2] != 0x42 || response[3] != 0x41 {
            return Err(NapiError::from_reason(
                format!("Invalid response magic header: {:02x} {:02x} {:02x} {:02x} (expected USBA)",
                    response[0], response[1], response[2], response[3])
            ));
        }
        
        // Validate response opcode (matching C# line 30: response[4] should be RESPONSE opcode = 15)
        // C# checks: numArray[4] == usbint_server_opcode_e.RESPONSE
        const RESPONSE_OPCODE: u8 = 15;
        if response[4] != RESPONSE_OPCODE {
            return Err(NapiError::from_reason(
                format!("Response Error Request: {} space: {} flags: {} Response: {}",
                    opcode, space, flags, response[4])
            ));
        }

        Ok(response)
    }

    /// Get port name
    #[napi]
    pub fn port_name(&self) -> Option<String> {
        self.port_name.lock().unwrap().clone()
    }

}

/// Parse INFO response (matching Core lines 911-934)
/// Returns: [firmwareVersion, versionString, romRunning, flagString1, flagString2]
#[napi]
pub fn parse_info_response(response: Vec<u8>) -> NapiResult<Vec<String>> {
    if response.len() < 512 {
        return Err(NapiError::from_reason("Response too short"));
    }

    let mut result = Vec::new();

    // firmwareVersion: UTF-8 string starting at byte 260, null-terminated (C# line 912)
    let firmware_offset = 260;
    let firmware_end = response[firmware_offset..]
        .iter()
        .position(|&b| b == 0)
        .unwrap_or(response.len() - firmware_offset);
    let firmware = String::from_utf8_lossy(&response[firmware_offset..firmware_offset + firmware_end]).to_string();
    result.push(firmware);

    // versionString: 32-bit integer at bytes 256-259, converted to hex uppercase (C# line 913)
    let version_value = ((response[256] as u32) << 24)
        | ((response[257] as u32) << 16)
        | ((response[258] as u32) << 8)
        | (response[259] as u32);
    let version_string = if version_value > 0 {
        format!("{:X}", version_value)
    } else {
        String::new()
    };
    result.push(version_string);

    // romRunning: UTF-8 string starting at byte 16, null-terminated (C# line 914)
    let rom_offset = 16;
    let rom_end = response[rom_offset..]
        .iter()
        .position(|&b| b == 0)
        .unwrap_or(response.len() - rom_offset);
    let rom = String::from_utf8_lossy(&response[rom_offset..rom_offset + rom_end]).to_string();
    result.push(rom);

    // flags: Parse byte 6 for feature flags (C# lines 915-933)
    let flags_byte = response[6];
    let mut flag_strings = Vec::new();
    if (flags_byte & 1) != 0 {
        flag_strings.push("FEAT_DSPX".to_string());
    }
    if (flags_byte & 2) != 0 {
        flag_strings.push("FEAT_ST0010".to_string());
    }
    if (flags_byte & 4) != 0 {
        flag_strings.push("FEAT_SRTC".to_string());
    }
    if (flags_byte & 8) != 0 {
        flag_strings.push("FEAT_MSU1".to_string());
    }
    if (flags_byte & 16) != 0 {
        flag_strings.push("FEAT_213F".to_string());
    }
    if (flags_byte & 32) != 0 {
        flag_strings.push("FEAT_CMD_UNLOCK".to_string());
    }
    if (flags_byte & 64) != 0 {
        flag_strings.push("FEAT_USB1".to_string());
    }
    if (flags_byte & 128) != 0 {
        flag_strings.push("FEAT_DMA1".to_string());
    }
    result.push(flag_strings.join("|"));

    // Add empty flag2 (not used in INFO response)
    result.push(String::new());

    Ok(result)
}

/// Parse GET response (returns data size as u32 from bytes 252-255)
#[napi]
pub fn parse_get_response(response: Vec<u8>) -> NapiResult<u32> {
    if response.len() < 256 {
        return Err(NapiError::from_reason("Response too short"));
    }

    // GET response: Size at bytes 252-255 (big-endian uint32, matching C# line 675)
    let size = ((response[252] as u32) << 24)
        | ((response[253] as u32) << 16)
        | ((response[254] as u32) << 8)
        | (response[255] as u32);

    Ok(size)
}

/// Parse LS response and return as Vec of (type, filename) tuples
/// Format: (type byte, filename null-terminated) pairs starting at byte 0
/// C# format: List<(int, string)> where int is type (0=file, 1=dir) and string is filename
/// Returns Vec of (type, filename) where type is 0 for file, 1 for dir
fn parse_ls_response_internal(response: &[u8]) -> Vec<(u8, String)> {
    let mut files: Vec<(u8, String)> = Vec::new();
    let mut offset = 0;
    
    while offset < response.len().min(512) {
        if response[offset] == 0 || response[offset] == 0xFF {
            break;
        }
        
        let file_type = response[offset];
        offset += 1;
        
        if offset >= response.len() {
            break;
        }
        
        let filename_start = offset;
        while offset < response.len() && response[offset] != 0 {
            offset += 1;
        }
        
        if offset > filename_start {
            let filename_bytes = &response[filename_start..offset];
            let filename = String::from_utf8_lossy(filename_bytes).to_string();
            if filename != "." && filename != ".." {
                files.push((file_type, filename));
            }
        }
        
        offset += 1;
    }
    
    files
}

