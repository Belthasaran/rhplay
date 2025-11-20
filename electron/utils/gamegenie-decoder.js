/**
 * SNES GameGenie Code Decoder
 * Based on decodeSNES from refmaterial/ggencoder.js
 * 
 * Decodes SNES GameGenie codes (format: XXXX-XXXX) into address/value pairs
 * for generating ASAR patches.
 */

// SNES GameGenie alphabet
const ALPHABET_SNES = [
  'D', 'F', '4', '7', '0', '9', '1', '5',
  '6', 'B', 'C', '8', 'A', '2', '3', 'E'
];

/**
 * Validates a SNES GameGenie code
 * @param {string} code - The GameGenie code to validate
 * @returns {boolean} - True if valid
 */
function isValidSNESCode(code) {
  if (!code || typeof code !== 'string') {
    return false;
  }
  
  // Make string upper case for easier comparison
  code = code.toUpperCase().trim();
  
  // SNES codes are 9 characters
  if (code.length !== 9) {
    return false;
  }
  
  // The middle character must be a dash
  if (code.charAt(4) !== '-') {
    return false;
  }
  
  // Check all characters are in the SNES alphabet
  for (let i = 0; i < code.length; i++) {
    if (i === 4) {
      continue; // Skip the dash
    }
    
    if (ALPHABET_SNES.indexOf(code.charAt(i)) === -1) {
      return false;
    }
  }
  
  return true;
}

/**
 * Decodes a SNES GameGenie code into address and value
 * @param {string} code - The GameGenie code (e.g., "C222-D4DD")
 * @returns {{address: number, value: number} | null} - Decoded address and value, or null if invalid
 */
function decodeSNESCode(code) {
  if (!isValidSNESCode(code)) {
    return null;
  }
  
  code = code.toUpperCase().trim();
  let bitString = 0;
  
  // Convert code to bit string
  for (let i = 0; i < code.length; i++) {
    if (i === 4) {
      continue; // Skip the dash
    }
    
    const letter = code.charAt(i);
    bitString <<= 4;
    bitString |= ALPHABET_SNES.indexOf(letter);
  }
  
  // Extract value (byte to write)
  const value = (bitString >> 24) & 0xFF;
  
  // Extract address (24-bit)
  let address = ((bitString >> 10) & 0xC) | ((bitString >> 10) & 0x3);
  
  let temp = ((bitString >> 2) & 0xC) | ((bitString >> 2) & 0x3);
  address <<= 4;
  address |= temp;
  
  temp = (bitString >> 20) & 0xF;
  address <<= 4;
  address |= temp;
  
  temp = ((bitString << 2) & 0xC) | ((bitString >> 14) & 0x3);
  address <<= 4;
  address |= temp;
  
  temp = (bitString >> 16) & 0xF;
  address <<= 4;
  address |= temp;
  
  temp = ((bitString >> 6) & 0xC) | ((bitString >> 6) & 0x3);
  address <<= 4;
  address |= temp;
  
  return { address, value };
}

/**
 * Validates a list of GameGenie codes (one per line)
 * @param {string} codesText - Text containing GameGenie codes, one per line
 * @returns {{valid: boolean, errors: string[], codes: string[]}} - Validation result
 */
function validateGameGenieCodes(codesText) {
  const errors = [];
  const codes = [];
  
  if (!codesText || typeof codesText !== 'string') {
    return { valid: false, errors: ['No codes provided'], codes: [] };
  }
  
  const lines = codesText.split('\n').map(line => line.trim()).filter(line => line.length > 0);
  
  if (lines.length === 0) {
    return { valid: false, errors: ['No codes found'], codes: [] };
  }
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;
    
    if (!isValidSNESCode(line)) {
      errors.push(`Line ${lineNum}: Invalid GameGenie code "${line}"`);
    } else {
      codes.push(line.toUpperCase());
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
    codes
  };
}

/**
 * Converts GameGenie codes to ASAR script
 * @param {string[]} codes - Array of valid GameGenie codes
 * @returns {string} - ASAR script content
 */
function gameGenieCodesToAsar(codes) {
  const lines = [];
  
  for (const code of codes) {
    const decoded = decodeSNESCode(code);
    if (decoded) {
      const addressHex = `$${decoded.address.toString(16).toUpperCase().padStart(6, '0')}`;
      const valueHex = `$${decoded.value.toString(16).toUpperCase().padStart(2, '0')}`;
      lines.push(`org ${addressHex}`);
      lines.push(`db ${valueHex}`);
    }
  }
  
  return lines.join('\n');
}

module.exports = {
  isValidSNESCode,
  decodeSNESCode,
  validateGameGenieCodes,
  gameGenieCodesToAsar
};

