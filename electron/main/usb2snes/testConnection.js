/**
 * Ephemeral USB2SNES WebSocket connection test.
 * Does not use SNESWrapper singleton — safe to call while a session is active.
 */

const WebSocket = require('ws');
const { SocksProxyAgent } = require('socks-proxy-agent');

const DEFAULT_TIMEOUT_MS = 4000;

/**
 * @param {Object} options
 * @param {string} options.address - WebSocket URL (e.g. ws://localhost:64213)
 * @param {'direct'|'socks'} [options.proxyMode='direct']
 * @param {string} [options.socksProxyUrl]
 * @param {number} [options.timeoutMs=4000]
 * @returns {Promise<{ status: 'success'|'warning'|'failure', devices?: string[], error?: string }>}
 */
async function testUsb2snesConnection(options = {}) {
  const {
    address,
    proxyMode = 'direct',
    socksProxyUrl = '',
    timeoutMs = DEFAULT_TIMEOUT_MS
  } = options;

  if (!address || typeof address !== 'string') {
    return { status: 'failure', error: 'WebSocket address is required' };
  }

  if (proxyMode === 'socks' && !socksProxyUrl) {
    return { status: 'failure', error: 'SOCKS proxy URL is required' };
  }

  const wsOptions = { perMessageDeflate: false };
  if (proxyMode === 'socks' && socksProxyUrl) {
    wsOptions.agent = new SocksProxyAgent(socksProxyUrl);
  }

  let ws = null;

  const cleanup = () => {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      try {
        ws.close();
      } catch (_err) {
        // ignore close errors during cleanup
      }
    }
    ws = null;
  };

  try {
    ws = new WebSocket(address, wsOptions);

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Connection timeout'));
      }, timeoutMs);

      ws.on('open', () => {
        clearTimeout(timeout);
        resolve();
      });

      ws.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });

    const message = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('DeviceList timeout'));
      }, timeoutMs);

      ws.once('message', (data) => {
        clearTimeout(timeout);
        try {
          resolve(JSON.parse(data.toString()));
        } catch (parseError) {
          reject(parseError);
        }
      });

      ws.send(JSON.stringify({ Opcode: 'DeviceList', Space: 'SNES' }));
    });

    cleanup();

    if (!message || !Array.isArray(message.Results)) {
      return { status: 'failure', error: 'Invalid DeviceList response' };
    }

    if (message.Results.length >= 1) {
      return { status: 'success', devices: message.Results };
    }

    return { status: 'warning', devices: [] };
  } catch (error) {
    cleanup();
    return {
      status: 'failure',
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

module.exports = {
  testUsb2snesConnection,
  DEFAULT_TIMEOUT_MS
};
