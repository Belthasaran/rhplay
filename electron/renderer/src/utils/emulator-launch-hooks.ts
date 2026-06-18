/**
 * Shared emulator launch helpers (renderer).
 */

export function parseUsb2snesPort(address: string): number | null {
  const raw = String(address || '').trim();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) {
    const port = Number(raw);
    return Number.isFinite(port) ? port : null;
  }
  const match = raw.match(/:(\d+)\s*$/);
  if (!match) return null;
  const port = Number(match[1]);
  return Number.isFinite(port) ? port : null;
}

export function shouldReconnectSniAfterEmulatorLaunch(
  settings: {
    usb2snesEnabled?: string;
    usb2snesHostingMethod?: string;
    usb2snesAddress?: string;
  },
  sniRunning: boolean
): boolean {
  if (settings.usb2snesEnabled !== 'yes') return false;
  if (settings.usb2snesHostingMethod !== 'sni') return false;
  if (!sniRunning) return false;
  return parseUsb2snesPort(settings.usb2snesAddress || '') === 23074;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type Usb2snesReconnectHandlers = {
  refreshStatus: () => Promise<void>;
  disconnect: () => Promise<void>;
  connect: (options: Record<string, unknown>) => Promise<{
    device?: string;
    firmwareVersion?: string;
    versionString?: string;
    romRunning?: string;
  }>;
  buildConnectOptions: () => Record<string, unknown>;
  onConnected: (result: {
    device?: string;
    firmwareVersion?: string;
    versionString?: string;
    romRunning?: string;
  }) => void;
  onDisconnected: () => void;
  startHealthMonitoring: () => void;
  stopHealthMonitoring: () => void;
  onError?: (error: unknown) => void;
};

export async function performUsb2snesReconnectCycle(
  handlers: Usb2snesReconnectHandlers,
  isConnected: boolean
) {
  await handlers.refreshStatus();
  if (isConnected) {
    await handlers.disconnect();
    handlers.onDisconnected();
    await sleep(500);
  }
  const connectOptions = handlers.buildConnectOptions();
  const result = await handlers.connect(connectOptions);
  handlers.onConnected(result);
  handlers.startHealthMonitoring();
  return result;
}

export async function maybeReconnectUsb2snesAfterEmulatorLaunch(
  settings: {
    usb2snesEnabled?: string;
    usb2snesHostingMethod?: string;
    usb2snesAddress?: string;
  },
  sniRunning: boolean,
  isUsb2snesConnected: boolean,
  handlers: Usb2snesReconnectHandlers,
  { postLaunchDelayMs = 1000 } = {}
) {
  if (!shouldReconnectSniAfterEmulatorLaunch(settings, sniRunning)) {
    return false;
  }
  await sleep(postLaunchDelayMs);
  try {
    await performUsb2snesReconnectCycle(handlers, isUsb2snesConnected);
    return true;
  } catch (error) {
    handlers.onError?.(error);
    return false;
  }
}

export async function maybeReconnectUsb2snesAfterEmulatorLaunchViaApi(
  api: {
    usb2snesGetSniStatus?: () => Promise<{ running?: boolean } | null>;
    usb2snesStatus?: () => Promise<{ connected?: boolean } | null>;
    usb2snesDisconnect?: () => Promise<unknown>;
    usb2snesConnect?: (options: Record<string, unknown>) => Promise<unknown>;
  },
  settings: {
    usb2snesEnabled?: string;
    usb2snesHostingMethod?: string;
    usb2snesAddress?: string;
    usb2snesLibrary?: string;
  }
) {
  let sniRunning = false;
  try {
    const sni = await api.usb2snesGetSniStatus?.();
    sniRunning = Boolean(sni?.running);
  } catch {
    // ignore
  }

  let isConnected = false;
  try {
    const status = await api.usb2snesStatus?.();
    isConnected = Boolean(status?.connected);
  } catch {
    // ignore
  }

  return maybeReconnectUsb2snesAfterEmulatorLaunch(
    settings,
    sniRunning,
    isConnected,
    {
      refreshStatus: async () => {},
      disconnect: async () => {
        await api.usb2snesDisconnect?.();
      },
      connect: async (options) => {
        await api.usb2snesConnect?.(options);
        return {};
      },
      buildConnectOptions: () => ({
        library: settings.usb2snesLibrary || 'usb2snes_a',
        address: settings.usb2snesAddress || 'ws://localhost:23074',
        hostingMethod: 'sni',
        proxyMode: 'direct',
      }),
      onDisconnected: () => {},
      onConnected: () => {},
      startHealthMonitoring: () => {},
      stopHealthMonitoring: () => {},
    }
  );
}
