const { spawn, spawnSync } = require('child_process');
const { EventEmitter } = require('events');

const MAX_RESTART_ATTEMPTS = 4;
const RESTART_DELAY_MS = 15_000;

function shellEscapeArg(arg) {
  if (arg === undefined || arg === null) {
    return "''";
  }
  const str = String(arg);
  if (str.length === 0) {
    return "''";
  }
  return `'${str.replace(/'/g, `'\\''`)}'`;
}

function isCommandAvailable(command) {
  try {
    const result = spawnSync('which', [command], { stdio: 'ignore' });
    return result.status === 0;
  } catch (error) {
    return false;
  }
}

class Usb2snesSshManager extends EventEmitter {
  constructor() {
    super();
    this.process = null;
    this.desired = false;
    this.restartAttempts = 0;
    this.restartTimer = null;
    this.config = null;
    this.lastCommand = '';
    this.consoleHistory = []; // Track console history: {timestamp, event, message, exitCode, command}
    this.maxHistorySize = 100; // Limit history size
    this.state = {
      running: false,
      desired: false,
      status: 'stopped',
      health: 'red',
      restartAttempts: 0,
      lastError: '',
      lastChange: ''
    };
  }

  _addHistoryEntry(event, message, exitCode = null, command = null) {
    const entry = {
      timestamp: new Date().toISOString(),
      event, // 'start', 'stop', 'error', 'exit', 'restart'
      message,
      exitCode,
      command
    };
    this.consoleHistory.push(entry);
    
    // Limit history size
    if (this.consoleHistory.length > this.maxHistorySize) {
      this.consoleHistory.shift();
    }
    
    this.emit('history-update', this.consoleHistory);
  }

  getConsoleHistory() {
    return [...this.consoleHistory]; // Return a copy
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
      command: this.lastCommand
    };
  }

  async start(config = {}) {
    if (process.platform !== 'linux') {
      throw new Error('SSH client management is currently supported on Linux hosts only.');
    }

    this.config = this._normalizeConfig(config);
    this.desired = true;
    this.restartAttempts = 0;
    this._clearRestartTimer();

    const result = await this._launch(true);
    return result;
  }

  async _launch(isManualStart) {
    if (!this.config) {
      throw new Error('SSH configuration not provided.');
    }

    const terminal = this._selectTerminal();
    if (!terminal) {
      const message = 'Unable to locate a terminal emulator to launch the SSH client. Install xterm or another terminal.';
      this.desired = false;
      this._updateStatus({
        running: false,
        status: 'error',
        health: 'red',
        lastError: message,
        lastChange: new Date().toISOString()
      });
      throw new Error(message);
    }

    const commandString = this._buildSshCommand();
    this.lastCommand = commandString;
    this._addHistoryEntry('start', `Starting SSH client${isManualStart ? '' : ' (auto-restart)'}`, null, commandString);
    this._updateStatus({
      running: false,
      desired: true,
      status: 'starting',
      health: 'yellow',
      lastError: '',
      restartAttempts: this.restartAttempts,
      lastChange: new Date().toISOString()
    });

    return new Promise((resolve, reject) => {
      let resolved = false;
      try {
        const child = spawn(terminal.command, terminal.args(commandString), {
          detached: false,
          stdio: 'ignore'
        });

        this.process = child;

        child.once('spawn', () => {
          this.restartAttempts = 0;
          this._addHistoryEntry('start', 'SSH client started successfully', 0, commandString);
          this._updateStatus({
            running: true,
            desired: true,
            status: 'running',
            health: 'green',
            lastError: '',
            lastChange: new Date().toISOString(),
            restartAttempts: 0
          });
          if (!resolved) {
            resolved = true;
            resolve({ success: true, manual: isManualStart, status: this.getStatus() });
          }
        });

        child.once('error', (error) => {
          this.process = null;
          this.restartAttempts += 1;
          this._addHistoryEntry('error', `SSH client spawn error: ${error.message}`, null, commandString);
          this._updateStatus({
            running: false,
            desired: this.desired,
            status: 'error',
            health: 'red',
            lastError: error.message,
            lastChange: new Date().toISOString(),
            restartAttempts: this.restartAttempts
          });

          if (!resolved) {
            resolved = true;
            reject(error);
          }

          this._handleExit(true);
        });

        child.once('exit', (code, signal) => {
          this.process = null;
          const hadError = code !== 0 && code !== null;
          const message = hadError
            ? `SSH client exited with code ${code !== null ? code : signal}`
            : 'SSH client stopped';
          this._addHistoryEntry('exit', message, code, commandString);

          if (!hadError && !this.desired) {
            this._updateStatus({
              running: false,
              desired: false,
              status: 'stopped',
              health: 'red',
              lastError: '',
              lastChange: new Date().toISOString(),
              restartAttempts: 0
            });
          } else if (hadError) {
            this.restartAttempts += 1;
            this._updateStatus({
              running: false,
              desired: this.desired,
              status: this.desired ? 'restarting' : 'error',
              health: this.desired ? 'yellow' : 'red',
              lastError: message,
              lastChange: new Date().toISOString(),
              restartAttempts: this.restartAttempts
            });
          }

          if (!resolved) {
            resolved = true;
            if (hadError) {
              reject(new Error(message));
            } else {
              resolve({ success: true, manual: isManualStart, status: this.getStatus() });
            }
          }

          this._handleExit(hadError);
        });
      } catch (error) {
        if (!resolved) {
          resolved = true;
          this._addHistoryEntry('error', `Failed to launch SSH client: ${error.message}`, null, commandString);
          this._updateStatus({
            running: false,
            desired: false,
            status: 'error',
            health: 'red',
            lastError: error.message,
            lastChange: new Date().toISOString(),
            restartAttempts: this.restartAttempts
          });
          reject(error);
        }
      }
    });
  }

  stop() {
    this.desired = false;
    this.restartAttempts = 0;
    this._clearRestartTimer();

    if (this.process) {
      try {
        this.process.kill();
      } catch (error) {
        // Ignore kill errors
      }
      this.process = null;
    }

    this._addHistoryEntry('stop', 'SSH client stopped by user', null, this.lastCommand);
    this._updateStatus({
      running: false,
      desired: false,
      status: 'stopped',
      health: 'red',
      lastError: '',
      restartAttempts: 0,
      lastChange: new Date().toISOString()
    });

    return { success: true, status: this.getStatus() };
  }

  _handleExit(hadError) {
    if (!this.desired) {
      return;
    }

    if (!hadError) {
      // Process exited cleanly but tunnel should remain active. Attempt restart.
      this.restartAttempts += 1;
      if (this.restartAttempts <= MAX_RESTART_ATTEMPTS) {
        this._updateStatus({
          running: false,
          desired: true,
          status: 'restarting',
          health: 'yellow',
          restartAttempts: this.restartAttempts,
          lastChange: new Date().toISOString()
        });
        this._scheduleRestart();
      } else {
        this.desired = false;
        this._updateStatus({
          running: false,
          desired: false,
          status: 'stopped',
          health: 'red',
          lastError: 'SSH client stopped repeatedly. Manual intervention required.',
          lastChange: new Date().toISOString()
        });
      }
      return;
    }

    if (this.restartAttempts <= MAX_RESTART_ATTEMPTS) {
      // Set status to 'restarting' before scheduling restart
      this._updateStatus({
        running: false,
        desired: this.desired,
        status: 'restarting',
        health: 'yellow',
        restartAttempts: this.restartAttempts,
        lastChange: new Date().toISOString()
      });
      this._scheduleRestart();
    } else {
      this.desired = false;
      this._updateStatus({
        running: false,
        desired: false,
        status: 'stopped',
        health: 'red',
        lastError: `Failed to restart SSH client after ${this.restartAttempts} attempts. Manual intervention required.`,
        lastChange: new Date().toISOString(),
        restartAttempts: this.restartAttempts
      });
    }
  }

  _scheduleRestart() {
    this._clearRestartTimer();
    this._addHistoryEntry('restart', `Scheduling restart in ${RESTART_DELAY_MS / 1000} seconds (attempt ${this.restartAttempts})`, null, this.lastCommand);
    this.restartTimer = setTimeout(() => {
      this._launch(false).catch((error) => {
        this._addHistoryEntry('error', `Restart failed: ${error.message}`, null, this.lastCommand);
        this._updateStatus({
          running: false,
          desired: this.desired,
          status: 'error',
          health: 'red',
          lastError: error.message,
          lastChange: new Date().toISOString(),
          restartAttempts: this.restartAttempts
        });
      });
    }, RESTART_DELAY_MS);
  }

  _clearRestartTimer() {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
  }

  _normalizeConfig(config) {
    const host = config.host || config.hostname;
    const username = config.username || config.user;

    if (!host) {
      throw new Error('SSH host is required.');
    }

    if (!username) {
      throw new Error('SSH username is required.');
    }

    const localPort = parseInt(config.localPort ?? config.localport ?? config.local_port ?? 64213, 10);
    const remotePort = parseInt(config.remotePort ?? config.remoteport ?? config.remote_port ?? 64213, 10);

    return {
      host,
      username,
      localPort: Number.isFinite(localPort) ? localPort : 64213,
      remotePort: Number.isFinite(remotePort) ? remotePort : 64213,
      identityFile: config.identityFile || config.identity || null
    };
  }

  _buildSshCommand() {
    const args = ['ssh', '-l', this.config.username];

    if (this.config.identityFile) {
      args.push('-i', this.config.identityFile);
    }

    args.push(
      '-oServerAliveInterval=5',
      '-oServerAliveCountMax=3',
      '-oExitOnForwardFailure=yes',
      '-a',
      '-k',
      '-L',
      `${this.config.localPort}:localhost:${this.config.remotePort}`,
      this.config.host,
      '-N'
    );

    return args.map(shellEscapeArg).join(' ');
  }

  _selectTerminal() {
    const candidates = [
      { command: 'x-terminal-emulator', args: (cmd) => ['-e', 'bash', '-lc', cmd] },
      { command: 'gnome-terminal', args: (cmd) => ['--', 'bash', '-lc', cmd] },
      { command: 'konsole', args: (cmd) => ['-e', 'bash', '-lc', cmd] },
      { command: 'xfce4-terminal', args: (cmd) => ['-e', 'bash', '-lc', cmd] },
      { command: 'lxterminal', args: (cmd) => ['-e', 'bash', '-lc', cmd] },
      { command: 'xterm', args: (cmd) => ['-hold', '-e', 'bash', '-lc', cmd] }
    ];

    for (const candidate of candidates) {
      if (isCommandAvailable(candidate.command)) {
        return candidate;
      }
    }
    return null;
  }

  _updateStatus(patch) {
    this.state = {
      ...this.state,
      ...patch
    };
    this.emit('status', this.getStatus());
  }
}

module.exports = new Usb2snesSshManager();

