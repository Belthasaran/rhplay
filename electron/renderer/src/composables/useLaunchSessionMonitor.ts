import { ref, type Ref } from 'vue';

export type LaunchMonitorState = 'idle' | 'waiting_start' | 'running';
export type LaunchFinishReason = 'exit' | 'rom_changed' | 'paused' | 'reset';

export interface LaunchMonitorOptions {
  mode: 'program' | 'usb2snes';
  expectedRomBasename?: string;
  launchSessionId?: string;
  pollIntervalMs?: number;
  usbConnectOptions?: Record<string, unknown>;
  onStarted?: () => void;
  onFinished?: (reason: LaunchFinishReason) => void;
}

function basenameFromRomPath(romPath: string): string {
  if (!romPath) return '';
  const parts = romPath.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || '';
}

export function createLaunchSessionMonitor(getApi: () => any) {
  const state: Ref<LaunchMonitorState> = ref('idle');
  let intervalId: ReturnType<typeof setInterval> | null = null;
  let exitCleanup: (() => void) | null = null;
  let romMismatchCount = 0;
  let activeOptions: LaunchMonitorOptions | null = null;
  let startedNotified = false;
  let activeSessionId: string | null = null;

  function stopMonitoring() {
    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
    if (exitCleanup) {
      exitCleanup();
      exitCleanup = null;
    }
    state.value = 'idle';
    romMismatchCount = 0;
    startedNotified = false;
    activeSessionId = null;
    activeOptions = null;
  }

  function finishMonitoring(reason: LaunchFinishReason) {
    const opts = activeOptions;
    stopMonitoring();
    opts?.onFinished?.(reason);
  }

  async function ensureUsbConnected(connectOptions?: Record<string, unknown>) {
    const api = getApi();
    if (!api?.usb2snesStatus) return false;
    const status = await api.usb2snesStatus();
    if (status?.connected && status?.attached) return true;
    if (!api.usb2snesConnect || !connectOptions) return false;
    try {
      await api.usb2snesConnect(connectOptions);
      return true;
    } catch {
      return false;
    }
  }

  async function pollUsbCycle() {
    if (!activeOptions) return;
    const api = getApi();
    if (!api?.usb2snesInfo) return;

    await ensureUsbConnected(activeOptions.usbConnectOptions);
    let info;
    try {
      info = await api.usb2snesInfo();
    } catch {
      return;
    }

    const romRunning = info?.romrunning || info?.romRunning || '';
    const currentBasename = basenameFromRomPath(romRunning);
    const expected = activeOptions.expectedRomBasename || '';

    if (!startedNotified) {
      if (expected && currentBasename && currentBasename.toLowerCase() === expected.toLowerCase()) {
        startedNotified = true;
        state.value = 'running';
        activeOptions.onStarted?.();
      }
      return;
    }

    if (!expected || !currentBasename) return;

    if (currentBasename.toLowerCase() !== expected.toLowerCase()) {
      romMismatchCount += 1;
      if (romMismatchCount >= 2) {
        finishMonitoring('rom_changed');
      }
    } else {
      romMismatchCount = 0;
    }
  }

  async function pollProgramCycle() {
    if (!activeOptions?.launchSessionId) return;
    const api = getApi();
    if (!api?.isLaunchProcessRunning) return;

    const result = await api.isLaunchProcessRunning(activeOptions.launchSessionId);
    const running = !!result?.running;

    if (!startedNotified && running) {
      startedNotified = true;
      state.value = 'running';
      activeOptions.onStarted?.();
      return;
    }

    if (startedNotified && !running) {
      finishMonitoring('exit');
    }
  }

  function startMonitoring(options: LaunchMonitorOptions) {
    stopMonitoring();
    activeOptions = options;
    activeSessionId = options.launchSessionId || null;
    state.value = 'waiting_start';
    romMismatchCount = 0;
    startedNotified = false;

    const pollMs = options.pollIntervalMs ?? 3500;
    const api = getApi();

    if (options.mode === 'program') {
      if (!options.launchSessionId) {
        console.warn('[LaunchMonitor] program mode requires launchSessionId; monitoring not started');
        return;
      }
      if (api?.onLaunchProcessExited) {
        exitCleanup = api.onLaunchProcessExited((data: { sessionId: string }) => {
          if (!activeOptions || data.sessionId !== activeSessionId) return;
          if (!startedNotified) {
            startedNotified = true;
            state.value = 'running';
            activeOptions.onStarted?.();
          }
          finishMonitoring('exit');
        });
        intervalId = setInterval(() => {
          pollProgramCycle().catch((err) => console.warn('[LaunchMonitor] program poll error:', err));
        }, pollMs);
        pollProgramCycle().catch(() => {});
      }
      return;
    }

    if (options.mode === 'usb2snes') {
      intervalId = setInterval(() => {
        pollUsbCycle().catch((err) => console.warn('[LaunchMonitor] usb poll error:', err));
      }, pollMs);
      pollUsbCycle().catch(() => {});
    }
  }

  return {
    state,
    startMonitoring,
    stopMonitoring
  };
}
