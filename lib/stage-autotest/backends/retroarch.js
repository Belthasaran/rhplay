'use strict';

const { BaseStageAutoTestBackend } = require('./base');
const { RETROPAD, pressRetropad, sendRetropadState } = require('../retroarch-retropad');
const { sendNciCommand } = require('../retroarch-nci');
const { readSmwRamSnapshot } = require('../smw-ram-snapshot');
const { snesRamToUsb2snes, sleep, buildUsb2snesConnectOptions } = require('../utils');
const { mergeAppendConfigRetropad, mergeHeadlessAppend } = require('../append-config-merge');
const {
  buildRetroarchLaunchArgs,
  detectRetroarchPaths,
} = require('../../emulator-paths');

class RetroArchBackend extends BaseStageAutoTestBackend {
  constructor(deps) {
    super('retroarch');
    this.deps = deps;
    this.config = deps.config;
    this.sessionId = null;
    this.program = null;
    this.launchSessions = deps.launchSessions;
    this.snesWrapper = null;
    this.appendOverlayPath = null;
  }

  _resolvePaths() {
    const settings = this.deps.settings || {};
    const programDataDir = this.deps.userDataDir;
    let retroarch_path = settings.launchProgram || '';
    let retroarch_core_path = settings.retroarch_core_path || '';

    if (this.config.retroarch?.useAppSettings !== false) {
      const detected = detectRetroarchPaths(settings, programDataDir);
      retroarch_path = retroarch_path || detected.retroarch_path;
      retroarch_core_path = retroarch_core_path || detected.retroarch_core_path;
    }

    if (!retroarch_path) {
      throw new Error('RetroArch path not configured. Set launch program in Settings.');
    }
    return { retroarch_path, retroarch_core_path };
  }

  async _ensureSniRunning() {
    const sniCfg = this.config.sni || {};
    if (sniCfg.autoStart !== false) {
      await this.deps.sniManager.start({ wsAddress: sniCfg.wsAddress });
      await sleep(1500);
    }
  }

  _buildConnectOptions() {
    const sniCfg = this.config.sni || {};
    const settings = this.deps.settings || {};
    const sniOverrides = { ...sniCfg };
    if (this.config.retroarch?.useAppSettings !== false) {
      delete sniOverrides.library;
    }
    return buildUsb2snesConnectOptions(settings, sniOverrides);
  }

  /**
   * SNI only exposes a device after RetroArch loads the ROM. Connect with retry post-launch.
   */
  async _connectSniAfterLaunch(timeoutMs) {
    const wrapper = this.deps.getSnesWrapper();
    this.snesWrapper = wrapper;
    const connectOptions = this._buildConnectOptions();
    const start = Date.now();
    let lastError = null;

    while (Date.now() - start < timeoutMs) {
      try {
        if (wrapper.isAttached()) {
          return wrapper;
        }
        if (wrapper.isConnected()) {
          await wrapper.disconnect();
          await sleep(200);
        }
        await wrapper.fullConnect(connectOptions.library, connectOptions);
        return wrapper;
      } catch (error) {
        lastError = error;
        try {
          if (wrapper.isConnected()) {
            await wrapper.disconnect();
          }
        } catch (_e) {
          /* ignore cleanup errors */
        }
        await sleep(500);
      }
    }

    throw lastError || new Error('SNI connect timeout: no devices found after emulator launch');
  }

  async _prepareAppendConfig() {
    const retroarchAppend = require('../../../electron/utils/retroarch-append-config');
    const basePath = retroarchAppend.ensureAppendConfig();
    let content = retroarchAppend.readAppendConfig().content;

    if (this.config.headless) {
      content = mergeHeadlessAppend(content);
    } else if (this.config.retroarch?.appendNetworkRetropad !== false) {
      content = mergeAppendConfigRetropad(content);
    }

    const fs = require('fs');
    const path = require('path');
    const overlayDir = path.join(this.deps.userDataDir, 'stage-autotest');
    if (!fs.existsSync(overlayDir)) fs.mkdirSync(overlayDir, { recursive: true });
    this.appendOverlayPath = path.join(overlayDir, 'append-autotest.cfg');
    fs.writeFileSync(this.appendOverlayPath, content, 'utf8');
    return this.appendOverlayPath;
  }

  async launchRom(romPath, opts = {}) {
    const { retroarch_path, retroarch_core_path } = this._resolvePaths();
    const appendPath = await this._prepareAppendConfig();
    const launchArgs = buildRetroarchLaunchArgs(retroarch_core_path, appendPath);
    const launchFn = this.deps.launchProgram;
    if (!launchFn) throw new Error('launchProgram dependency missing');

    await this._ensureSniRunning();

    const result = await launchFn(retroarch_path, launchArgs, romPath);
    this.sessionId = result.sessionId;
    this.program = retroarch_path;

    const connectTimeoutMs = (this.config.timeoutsSec?.sniConnect || 30) * 1000;
    await this._connectSniAfterLaunch(connectTimeoutMs);
    await sleep(opts.launchSettleMs || 1000);
    return result;
  }

  async isRunning() {
    if (!this.sessionId || !this.deps.isLaunchRunning) return false;
    return this.deps.isLaunchRunning(this.sessionId);
  }

  async shutdown() {
    try {
      await sendNciCommand('QUIT', '127.0.0.1', this.config.retroarch?.nciPort || 55355);
    } catch (_e) {
      /* ignore */
    }
    if (this.program && this.deps.stopProgram) {
      await this.deps.stopProgram(this.program);
    }
  }

  async pressButtons(bitmask, holdMs = 100) {
    const port = this.config.retroarch?.retropadPort || 55400;
    const interval = this.config.inputPlan?.buttonIntervalMs || 100;
    await pressRetropad(bitmask, holdMs, Math.min(interval, holdMs), '127.0.0.1', port);
  }

  async readRamSnapshot() {
    const wrapper = this.snesWrapper || this.deps.getSnesWrapper();
    return readSmwRamSnapshot(wrapper);
  }

  async writeRamByte(snesAddr, value) {
    const wrapper = this.snesWrapper || this.deps.getSnesWrapper();
    const addr = snesRamToUsb2snes(snesAddr);
    await wrapper.PutAddress([[addr, Buffer.from([value & 0xff])]]);
  }
}

module.exports = { RetroArchBackend, RETROPAD };
