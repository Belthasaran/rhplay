/**
 * SNI server process manager for USB2SNES (ws://localhost:23074).
 * Binary expected under program data:
 *   Linux:   {userData}/sni-linux-amd64/sni
 *   Windows: {userData}/sni-windows-amd64/sni.exe
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { testUsb2snesConnection } = require('./testConnection');

const DEFAULT_WS_ADDRESS = 'ws://localhost:23074';
const HEALTH_CHECK_INTERVAL_MS = 5000;
const RESTART_DELAY_MS = 15000;
const MAX_RESTART_ATTEMPTS = 4;

class SniManager extends EventEmitter {
  constructor() {
    super();
    this.process = null;
    this.desired = false;
    this.config = null;
    this.restartAttempts = 0;
    this.restartTimer = null;
    this.healthTimer = null;
    this.state = {
      running: false,
      desired: false,
      status: 'stopped',
      health: 'red',
      restartAttempts: 0,
      lastError: '',
      lastChange: new Date().toISOString(),
      binaryPath: '',
      wsAddress: DEFAULT_WS_ADDRESS,
    };
  }

  _getProgramDataDir() {
    const manifestResolver = require('../../utils/manifest-resolver');
    return manifestResolver.getUserDataDir();
  }

  _resolveBinaryPath() {
    const programDataDir = this._getProgramDataDir();
    if (process.platform === 'win32') {
      const winPath = path.join(programDataDir, 'sni-windows-amd64', 'sni.exe');
      if (fs.existsSync(winPath)) return winPath;
      const alt = path.join(programDataDir, 'sni-windows-amd64', 'sni');
      if (fs.existsSync(alt)) return alt;
      return winPath;
    }
    if (process.platform === 'linux') {
      const linuxPath = path.join(programDataDir, 'sni-linux-amd64', 'sni');
      if (fs.existsSync(linuxPath)) return linuxPath;
      const alt = path.join(programDataDir, 'sni-linux-amd64', 'sni.exe');
      if (fs.existsSync(alt)) return alt;
      return linuxPath;
    }
    return '';
  }

  _setState(patch) {
    this.state = {
      ...this.state,
      ...patch,
      lastChange: new Date().toISOString(),
    };
    this.emit('status', this.getStatus());
  }

  getStatus() {
    return {
      running: this.state.running,
      desired: this.state.desired,
      status: this.state.status,
      health: this.state.health,
      restartAttempts: this.state.restartAttempts,
      lastError: this.state.lastError,
      lastChange: this.state.lastChange,
      binaryPath: this.state.binaryPath,
      wsAddress: this.state.wsAddress,
    };
  }

  async _probeHealth() {
    if (!this.state.running) {
      this._setState({ health: 'red' });
      return;
    }
    try {
      const result = await testUsb2snesConnection({
        address: this.state.wsAddress,
        proxyMode: 'direct',
        timeoutMs: 3000,
      });
      if (result.status === 'success') {
        this._setState({ health: 'green', lastError: '' });
      } else if (result.status === 'warning') {
        this._setState({ health: 'yellow', lastError: 'Server reachable but no devices found' });
      } else {
        this._setState({ health: 'red', lastError: result.error || 'Connection test failed' });
      }
    } catch (error) {
      this._setState({
        health: 'red',
        lastError: error instanceof Error ? error.message : String(error),
      });
    }
  }

  _startHealthMonitor() {
    this._stopHealthMonitor();
    this.healthTimer = setInterval(() => {
      this._probeHealth().catch(() => {});
    }, HEALTH_CHECK_INTERVAL_MS);
    this._probeHealth().catch(() => {});
  }

  _stopHealthMonitor() {
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
  }

  _scheduleRestart() {
    if (!this.desired) return;
    if (this.restartAttempts >= MAX_RESTART_ATTEMPTS) {
      this._setState({
        status: 'error',
        health: 'red',
        lastError: `SNI server failed after ${MAX_RESTART_ATTEMPTS} restart attempts`,
      });
      return;
    }
    this.restartAttempts += 1;
    this._setState({
      status: 'restarting',
      restartAttempts: this.restartAttempts,
    });
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (this.desired) {
        this._spawnProcess().catch((error) => {
          this._setState({
            status: 'error',
            health: 'red',
            lastError: error.message,
          });
        });
      }
    }, RESTART_DELAY_MS);
  }

  async _spawnProcess() {
    const binaryPath = this._resolveBinaryPath();
    this._setState({ binaryPath, status: 'starting' });

    if (!binaryPath || !fs.existsSync(binaryPath)) {
      throw new Error(
        `SNI server binary not found. Install to ${binaryPath || '(unknown path)'}`
      );
    }

    if (this.process) {
      try {
        this.process.kill();
      } catch (_err) {
        // ignore
      }
      this.process = null;
    }

    const cwd = path.dirname(binaryPath);
  // SNI listens on 23074 by default; no extra flags unless manifest provisioning specifies otherwise.
    this.process = spawn(binaryPath, [], {
      cwd,
      detached: false,
      stdio: 'ignore',
    });

    this.process.on('error', (error) => {
      this._setState({
        running: false,
        status: 'error',
        health: 'red',
        lastError: error.message,
      });
      this.process = null;
      this._scheduleRestart();
    });

    this.process.on('exit', (code) => {
      const wasRunning = this.state.running;
      this.process = null;
      this._setState({
        running: false,
        health: 'red',
        lastError: wasRunning ? `SNI server exited with code ${code}` : this.state.lastError,
      });
      this._stopHealthMonitor();
      if (this.desired) {
        this._scheduleRestart();
      } else {
        this._setState({ status: 'stopped' });
      }
    });

    this._setState({
      running: true,
      status: 'running',
      health: 'yellow',
      lastError: '',
      restartAttempts: 0,
    });
    this._startHealthMonitor();
    return this.getStatus();
  }

  async start(config = {}) {
    this.desired = true;
    this.config = config || {};
    this.state.wsAddress = config.wsAddress || DEFAULT_WS_ADDRESS;
    this.restartAttempts = 0;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    return this._spawnProcess();
  }

  stop() {
    this.desired = false;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    this._stopHealthMonitor();
    if (this.process) {
      try {
        this.process.kill();
      } catch (_err) {
        // ignore
      }
      this.process = null;
    }
    this._setState({
      running: false,
      desired: false,
      status: 'stopped',
      health: 'red',
      restartAttempts: 0,
      lastError: '',
    });
    return { success: true, status: this.getStatus() };
  }
}

const sniManager = new SniManager();

module.exports = sniManager;
