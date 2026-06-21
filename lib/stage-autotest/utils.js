'use strict';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** SNES WRAM 0x7Exxxx → USB2SNES protocol 0xF5xxxx */
function snesRamToUsb2snes(snesAddr) {
  const addr = Number(snesAddr);
  if (addr >= 0x7e0000 && addr <= 0x7fffff) {
    return 0xf50000 + (addr - 0x7e0000);
  }
  return addr;
}

function parseHexByte(value) {
  if (value === null || value === undefined || value === '') return null;
  const s = String(value).trim().replace(/^0x/i, '');
  const n = parseInt(s, 16);
  return Number.isNaN(n) ? null : n & 0xff;
}

function resolveExpectedTranslevel(stage) {
  const direct = parseHexByte(stage?.translevel_13bf);
  if (direct !== null) return direct;
  const levelStr = stage?.levelnumber;
  if (!levelStr) return null;
  const levelnum = parseInt(String(levelStr).trim(), 16);
  if (Number.isNaN(levelnum)) return null;
  if (levelnum <= 0x24) return levelnum;
  if (levelnum >= 0x101) {
    const trans = levelnum - 0xdc;
    if (trans >= 0x25 && trans <= 0xff) return trans;
  }
  return null;
}

function formatHexByte(n) {
  return `0x${(Number(n) & 0xff).toString(16).toUpperCase().padStart(2, '0')}`;
}

const VALID_USB2SNES_LIBRARIES = ['usb2snes_a', 'usb2snes_b', 'qusb2snes', 'node-usb'];

/**
 * Build USB2SNES connect options from app csettings, with tester_config fallbacks.
 * App settings (usb2snesLibrary, usb2snesAddress, etc.) take precedence over sni.* config.
 */
function buildUsb2snesConnectOptions(settings = {}, sniCfg = {}) {
  const library = settings.usb2snesLibrary || sniCfg.library || 'usb2snes_a';
  if (!VALID_USB2SNES_LIBRARIES.includes(library)) {
    throw new Error(
      `Invalid USB2SNES library: ${library}. Must be one of: ${VALID_USB2SNES_LIBRARIES.join(', ')}`
    );
  }

  const sniAutoStart = sniCfg.autoStart !== false;
  const sniAddress = sniCfg.wsAddress || 'ws://localhost:23074';
  const hostingMethod = settings.usb2snesHostingMethod || (sniAutoStart ? 'sni' : 'external');

  let address = settings.usb2snesAddress || sniAddress;
  if (sniAutoStart && hostingMethod === 'sni') {
    address = sniAddress;
  }

  const rawProxy = settings.usb2snesProxyMode || 'direct';
  const proxyMode = rawProxy === 'none' ? 'direct' : rawProxy;

  const connectOptions = {
    library,
    address,
    hostingMethod,
    proxyMode,
  };

  if (proxyMode === 'socks' && settings.usb2snesSocksProxyUrl) {
    connectOptions.socksProxyUrl = settings.usb2snesSocksProxyUrl;
  }
  if (proxyMode === 'ssh' || proxyMode === 'direct-with-ssh') {
    connectOptions.ssh = {
      host: settings.usb2snesSshHost,
      username: settings.usb2snesSshUsername,
      localPort: settings.usb2snesSshLocalPort || 64213,
      remotePort: settings.usb2snesSshRemotePort || 64213,
      identityFile: settings.usb2snesSshIdentityFile,
    };
  }

  return connectOptions;
}

module.exports = {
  sleep,
  snesRamToUsb2snes,
  parseHexByte,
  resolveExpectedTranslevel,
  formatHexByte,
  buildUsb2snesConnectOptions,
  VALID_USB2SNES_LIBRARIES,
};
