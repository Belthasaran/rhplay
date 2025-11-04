/**
 * Host Fingerprint Generator
 * 
 * Generates a unique fingerprint for a host system based on:
 * - UUID value
 * - Key hash (hex string)
 * - HDD serial number
 * - Machine ID
 * 
 * Returns a base64-encoded string combining 3 SHA1 hashes (10 bytes each = 30 bytes total)
 */

class HostFP {
  constructor() {
  }

  /**
   * Get fingerprint value
   * @param {string} uuidvalue - UUID string
   * @param {string} keyhash - Key hash (hex string)
   * @returns {Promise<string>} Base64-encoded fingerprint
   */
  async getv(uuidvalue, keyhash) {
    const crypto = require('crypto');
    const hddserial = require('hddserial');
    const machid = require('node-machine-id');
    
    // Convert keyhash to string if it's a Buffer or hex string
    const keyhashStr = Buffer.isBuffer(keyhash) ? keyhash.toString('hex') : String(keyhash || '');
    
    // Get HDD serial (async callback)
    return new Promise((resolve, reject) => {
      hddserial.one(0, (err, serial) => {
        try {
          let buffer1;
          const hash = crypto.createHash('sha1');
          
          if (err || serial == null) {
            // If serial is null, use empty buffer
            buffer1 = Buffer.alloc(20);
          } else {
            hash.update(uuidvalue + serial);
            buffer1 = hash.digest();
          }

          // Get machine ID (synchronous)
          const id = machid.machineIdSync(true);
          const hash2 = crypto.createHash('sha1');
          hash2.update(uuidvalue + id);
          const buffer2 = hash2.digest();

          // Hash with keyhash
          const hash3 = crypto.createHash('sha1');
          hash3.update(uuidvalue + keyhashStr);
          const buffer3 = hash3.digest();

          // Combine first 10 bytes of each hash (30 bytes total)
          const resultBuffer = Buffer.concat([
            buffer1.slice(0, 10),
            buffer2.slice(0, 10),
            buffer3.slice(0, 10)
          ]);
          
          const result = resultBuffer.toString('base64');
          console.log('HostFP.getv result:', result);
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });
    });
  }

  /**
   * Get the 3 underlying values used for hashing
   * @param {string} uuidvalue - UUID string
   * @param {string} keyhash - Key hash (hex string)
   * @returns {Promise<{hddSerial: string, machineId: string, keyhash: string}>}
   */
  async getUnderlyingValues(uuidvalue, keyhash) {
    const hddserial = require('hddserial');
    const machid = require('node-machine-id');
    
    // Convert keyhash to string if it's a Buffer or hex string
    const keyhashStr = Buffer.isBuffer(keyhash) ? keyhash.toString('hex') : String(keyhash || '');
    
    return new Promise((resolve, reject) => {
      hddserial.one(0, (err, serial) => {
        try {
          const hddSerial = err || serial == null ? null : serial;
          const machineId = machid.machineIdSync(true);
          
          resolve({
            hddSerial: hddSerial,
            machineId: machineId,
            keyhash: keyhashStr,
            uuid: uuidvalue
          });
        } catch (error) {
          reject(error);
        }
      });
    });
  }
}

module.exports = { HostFP };

