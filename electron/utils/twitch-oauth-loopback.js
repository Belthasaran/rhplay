'use strict';

const http = require('http');
const {
  TWITCH_OAUTH_LOOPBACK_PORTS,
  getTwitchLoopbackRedirectUri,
} = require('../twitch-config');

const DEFAULT_OAUTH_TIMEOUT_MS = 5 * 60 * 1000;

/** @type {import('http').Server|null} */
let activeServer = null;

/** @type {Promise<unknown>|null} */
let activeOAuthPromise = null;

const TWITCH_DEFAULT_SCOPES = [
  'channel:read:predictions',
  'channel:manage:predictions',
  'channel:read:vips',
  'moderator:read:moderators',
  'user:read:chat',
  'moderator:read:chat_messages',
  'moderator:read:chatters',
  'moderator:read:followers',
  'moderator:read:shoutouts',
  'channel:bot',
].join(' ');

const CALLBACK_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Twitch Authorization</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 2rem; color: #18181b; }
    .ok { color: #15803d; }
    .err { color: #b91c1c; }
  </style>
</head>
<body>
  <p id="status">Completing authorization...</p>
  <script>
    (function () {
      var statusEl = document.getElementById('status');
      var hash = window.location.hash ? window.location.hash.substring(1) : '';
      if (!hash) {
        statusEl.textContent = 'Waiting for authorization...';
        return;
      }
      fetch('/callback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fragment: hash })
      }).then(function (res) {
        return res.json().then(function (data) {
          if (!res.ok) throw new Error(data.error || 'Authorization failed');
          statusEl.innerHTML = '<span class="ok"><strong>Authorization complete.</strong> You can close this window and return to RHTools.</span>';
        });
      }).catch(function (err) {
        statusEl.innerHTML = '<span class="err">' + (err.message || 'Authorization failed') + '</span>';
      });
    })();
  </script>
</body>
</html>`;

const SUCCESS_HTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Done</title></head>
<body><p style="font-family:system-ui,sans-serif;color:#15803d"><strong>Authorization complete.</strong> You can close this window.</p></body></html>`;

/**
 * @param {import('http').Server} server
 * @param {number} port
 * @param {string} host
 * @returns {Promise<void>}
 */
function listenOnPort(server, port, host) {
  return new Promise((resolve, reject) => {
    const onError = (err) => {
      server.removeListener('listening', onListening);
      reject(err);
    };
    const onListening = () => {
      server.removeListener('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

/**
 * @param {{ clientId: string, redirectUri: string, state: string, scopes?: string }} params
 * @returns {string}
 */
function buildTwitchImplicitAuthUrl({ clientId, redirectUri, state, scopes }) {
  const scopeList = scopes || TWITCH_DEFAULT_SCOPES;
  const params = new URLSearchParams({
    response_type: 'token',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: scopeList,
    state,
  });
  return `https://id.twitch.tv/oauth2/authorize?${params.toString()}`;
}

/**
 * @param {string} hashOrUrl
 * @param {string} expectedState
 * @returns {{ accessToken: string|null, tokenType: string|null, state: string|null, error: string|null, errorDescription: string|null }}
 */
function parseImplicitGrantFragment(hashOrUrl, expectedState) {
  let hash = hashOrUrl || '';
  if (hash.includes('#')) {
    hash = hash.split('#')[1] || '';
  }
  if (hash.startsWith('#')) {
    hash = hash.substring(1);
  }

  const params = new URLSearchParams(hash);
  const accessToken = params.get('access_token');
  const tokenType = params.get('token_type');
  const state = params.get('state');
  const error = params.get('error');
  const errorDescription = params.get('error_description');

  if (error) {
    return {
      accessToken: null,
      tokenType: null,
      state,
      error,
      errorDescription: errorDescription || null,
    };
  }

  if (state !== expectedState) {
    throw new Error('OAuth state mismatch - possible CSRF attack');
  }

  if (!accessToken) {
    return {
      accessToken: null,
      tokenType: tokenType || null,
      state,
      error: null,
      errorDescription: null,
    };
  }

  return {
    accessToken,
    tokenType: tokenType || 'bearer',
    state,
    error: null,
    errorDescription: null,
  };
}

function stopActiveServer() {
  if (activeServer) {
    try {
      activeServer.close();
    } catch (error) {
      console.warn('[twitch-oauth-loopback] Error closing server:', error);
    }
    activeServer = null;
  }
}

/**
 * @param {number[]} ports
 * @returns {Promise<{ server: import('http').Server, port: number }>}
 */
async function bindFirstAvailableLoopbackPort(ports) {
  const errors = [];

  for (const port of ports) {
    const server = http.createServer();
    try {
      await listenOnPort(server, port, 'localhost');
      console.log(`[twitch-oauth-loopback] Listening on localhost:${port}`);
      return { server, port };
    } catch (error) {
      errors.push({ port, code: error.code, message: error.message });
      try {
        server.close();
      } catch (_) {
        // ignore
      }
      if (error.code !== 'EADDRINUSE' && error.code !== 'EACCES') {
        throw error;
      }
      console.warn(`[twitch-oauth-loopback] Port ${port} unavailable (${error.code}), trying next`);
    }
  }

  const tried = ports.join(', ');
  throw new Error(
    `Unable to bind Twitch OAuth loopback server. Ports tried: ${tried}. `
    + 'Another application may be using these ports — close it or restart RHTools.'
  );
}

/**
 * Start loopback server; resolves when bound with redirectUri matching the chosen port.
 * @param {{ expectedState: string, timeoutMs?: number, ports?: number[] }} options
 * @returns {Promise<{ port: number, redirectUri: string, waitForCallback: () => Promise<{ accessToken: string, tokenType: string }> }>}
 */
async function startTwitchOAuthLoopbackServer({
  expectedState,
  timeoutMs = DEFAULT_OAUTH_TIMEOUT_MS,
  ports = TWITCH_OAUTH_LOOPBACK_PORTS,
}) {
  if (activeOAuthPromise) {
    throw new Error('Another Twitch OAuth flow is already in progress');
  }

  let settled = false;
  let timeoutId = null;

  const finish = (fn, value) => {
    if (settled) return;
    settled = true;
    if (timeoutId) clearTimeout(timeoutId);
    stopActiveServer();
    activeOAuthPromise = null;
    fn(value);
  };

  let tokenResolve;
  let tokenReject;
  const callbackPromise = new Promise((resolve, reject) => {
    tokenResolve = resolve;
    tokenReject = reject;
  });
  activeOAuthPromise = callbackPromise;

  const requestHandler = (req, res) => {
    const remote = req.socket.remoteAddress || '';
    if (remote !== '127.0.0.1' && remote !== '::1' && remote !== '::ffff:127.0.0.1') {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden');
      return;
    }

    if (req.method === 'GET' && (req.url === '/' || req.url === '/callback' || (req.url && req.url.startsWith('/?')))) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(CALLBACK_HTML);
      return;
    }

    if (req.method === 'POST' && req.url === '/callback') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        try {
          const payload = JSON.parse(body || '{}');
          const parsed = parseImplicitGrantFragment(payload.fragment || '', expectedState);

          if (parsed.error) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              error: `OAuth error: ${parsed.error}${parsed.errorDescription ? ` - ${parsed.errorDescription}` : ''}`,
            }));
            finish(tokenReject, new Error(`OAuth error: ${parsed.error}`));
            return;
          }

          if (!parsed.accessToken) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'No access token in callback' }));
            finish(tokenReject, new Error('No access token received'));
            return;
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
          finish(tokenResolve, {
            accessToken: parsed.accessToken,
            tokenType: parsed.tokenType || 'bearer',
          });
        } catch (error) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: error.message || 'Invalid callback' }));
          finish(tokenReject, error);
        }
      });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  };

  let bound;
  try {
    bound = await bindFirstAvailableLoopbackPort(ports);
  } catch (error) {
    activeOAuthPromise = null;
    throw error;
  }

  bound.server.on('request', requestHandler);
  bound.server.on('error', (error) => {
    finish(tokenReject, error);
  });

  activeServer = bound.server;
  const redirectUri = getTwitchLoopbackRedirectUri(bound.port);

  timeoutId = setTimeout(() => {
    finish(tokenReject, new Error('Twitch OAuth timed out waiting for browser authorization'));
  }, timeoutMs);

  return {
    port: bound.port,
    redirectUri,
    waitForCallback: () => callbackPromise,
  };
}

function cancelActiveTwitchOAuthLoopback() {
  stopActiveServer();
  activeOAuthPromise = null;
}

module.exports = {
  TWITCH_DEFAULT_SCOPES,
  DEFAULT_OAUTH_TIMEOUT_MS,
  buildTwitchImplicitAuthUrl,
  parseImplicitGrantFragment,
  bindFirstAvailableLoopbackPort,
  startTwitchOAuthLoopbackServer,
  cancelActiveTwitchOAuthLoopback,
  CALLBACK_HTML,
  SUCCESS_HTML,
};
