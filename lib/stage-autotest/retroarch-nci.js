'use strict';

const dgram = require('dgram');

function sendNciCommand(command, host = '127.0.0.1', port = 55355, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    const payload = Buffer.from(String(command));
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error(`NCI command timeout: ${command}`));
    }, timeoutMs);

    socket.send(payload, port, host, (err) => {
      clearTimeout(timer);
      socket.close();
      if (err) reject(err);
      else resolve({ command, host, port });
    });
  });
}

function formatNciCommand(command, host, port) {
  if (host && port) return `${command};${host};${port}`;
  if (host) return `${command};${host}`;
  return command;
}

module.exports = {
  sendNciCommand,
  formatNciCommand,
};
