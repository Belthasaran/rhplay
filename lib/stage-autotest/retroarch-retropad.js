'use strict';

const dgram = require('dgram');

/** Libretro retropad bitmask (matches RetroArch network remote input). */
const RETROPAD = {
  B: 1 << 0,
  Y: 1 << 1,
  SELECT: 1 << 2,
  START: 1 << 3,
  UP: 1 << 4,
  DOWN: 1 << 5,
  LEFT: 1 << 6,
  RIGHT: 1 << 7,
  A: 1 << 8,
  X: 1 << 9,
  L: 1 << 10,
  R: 1 << 11,
};

function sendRetropadState(bitmask, host = '127.0.0.1', port = 55400) {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    const payload = Buffer.from(String(bitmask & 0xffff));
    socket.send(payload, port, host, (err) => {
      socket.close();
      if (err) reject(err);
      else resolve({ bitmask, host, port });
    });
  });
}

/** Hold buttons by re-sending each interval (RetroArch #12611 workaround). */
async function pressRetropad(bitmask, holdMs, intervalMs, host, port) {
  const end = Date.now() + holdMs;
  while (Date.now() < end) {
    await sendRetropadState(bitmask, host, port);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  await sendRetropadState(0, host, port);
}

module.exports = {
  RETROPAD,
  sendRetropadState,
  pressRetropad,
};
