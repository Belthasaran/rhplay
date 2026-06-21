'use strict';

/**
 * @typedef {object} StageAutoTestBackend
 * @property {string} name
 * @property {(romPath: string, opts: object) => Promise<{sessionId?: string, pid?: number}>} launchRom
 * @property {() => Promise<boolean>} isRunning
 * @property {() => Promise<void>} shutdown
 * @property {(bitmask: number, holdMs?: number) => Promise<void>} pressButtons
 * @property {() => Promise<object>} readRamSnapshot
 * @property {(snesAddr: number, value: number) => Promise<void>} writeRamByte
 */

class BaseStageAutoTestBackend {
  constructor(name) {
    this.name = name;
  }

  async launchRom(_romPath, _opts) {
    throw new Error(`${this.name}: launchRom not implemented`);
  }

  async isRunning() {
    return false;
  }

  async shutdown() {
    /* noop */
  }

  async pressButtons(_bitmask, _holdMs = 100) {
    throw new Error(`${this.name}: pressButtons not implemented`);
  }

  async readRamSnapshot() {
    throw new Error(`${this.name}: readRamSnapshot not implemented`);
  }

  async writeRamByte(_snesAddr, _value) {
    throw new Error(`${this.name}: writeRamByte not implemented`);
  }
}

module.exports = { BaseStageAutoTestBackend };
