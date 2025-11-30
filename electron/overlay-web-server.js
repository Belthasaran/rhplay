/**
 * Overlay Web Server Utility Process
 * 
 * Serves runview.html as a static file via Express.js
 * Only responds to GET requests for runview.html and runinfo.css
 * All other requests return 404
 * Other HTTP methods return errors
 */

const express = require('express');
const path = require('path');
const fs = require('fs');

let server = null;
let app = null;

/**
 * Start the overlay web server
 * @param {Object} options
 * @param {string} options.userDataPath - Path to user data directory (where runview.html is located)
 * @param {number} options.port - Port to listen on (default: 2599)
 * @param {boolean} options.allowRemote - Allow remote connections (default: false, only localhost)
 * @returns {Promise<{success: boolean, error?: string, port?: number}>}
 */
async function startServer(options) {
  const { userDataPath, port = 2599, allowRemote = false } = options;
  
  if (server) {
    return { success: false, error: 'Server is already running' };
  }
  
  try {
    app = express();
    
    // Only allow GET requests
    app.use((req, res, next) => {
      if (req.method !== 'GET') {
        return res.status(405).send('Method Not Allowed');
      }
      next();
    });
    
    // Serve runview.html
    app.get('/runview.html', (req, res) => {
      const filePath = path.join(userDataPath, 'runview.html');
      if (fs.existsSync(filePath)) {
        res.sendFile(filePath);
      } else {
        res.status(404).send('File Not Found');
      }
    });
    
    // Serve runinfo.css if it exists (for future use)
    app.get('/runinfo.css', (req, res) => {
      const filePath = path.join(userDataPath, 'runinfo.css');
      if (fs.existsSync(filePath)) {
        res.sendFile(filePath);
      } else {
        res.status(404).send('File Not Found');
      }
    });
    
    // All other routes return 404
    app.use((req, res) => {
      res.status(404).send('Not Found');
    });
    
    // Start server
    const host = allowRemote ? '0.0.0.0' : '127.0.0.1';
    await new Promise((resolve, reject) => {
      server = app.listen(port, host, (err) => {
        if (err) {
          reject(err);
        } else {
          console.log(`[Overlay Web Server] Started on ${host}:${port}`);
          resolve();
        }
      });
      
      server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          reject(new Error(`Port ${port} is already in use`));
        } else {
          reject(err);
        }
      });
    });
    
    return { success: true, port };
  } catch (error) {
    console.error('[Overlay Web Server] Error starting server:', error);
    server = null;
    app = null;
    return { success: false, error: error.message };
  }
}

/**
 * Stop the overlay web server
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function stopServer() {
  if (!server) {
    return { success: true };
  }
  
  try {
    await new Promise((resolve, reject) => {
      server.close((err) => {
        if (err) {
          reject(err);
        } else {
          console.log('[Overlay Web Server] Stopped');
          resolve();
        }
      });
    });
    
    server = null;
    app = null;
    return { success: true };
  } catch (error) {
    console.error('[Overlay Web Server] Error stopping server:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get server status
 * @returns {{running: boolean, port?: number}}
 */
function getStatus() {
  return {
    running: server !== null,
    port: server ? server.address()?.port : undefined
  };
}

// Handle IPC messages from main process (UtilityProcess)
// In Electron UtilityProcess, process.parentPort is available as a MessagePort
if (process.parentPort) {
  // UtilityProcess communication
  process.parentPort.on('message', async (message) => {
    const { type, options } = message;
    
    try {
      let result;
      switch (type) {
        case 'start':
          result = await startServer(options);
          process.parentPort.postMessage({ type: 'start-result', result });
          break;
        case 'stop':
          result = await stopServer();
          process.parentPort.postMessage({ type: 'stop-result', result });
          break;
        case 'status':
          result = getStatus();
          process.parentPort.postMessage({ type: 'status-result', result });
          break;
        default:
          process.parentPort.postMessage({ type: 'error', error: 'Unknown message type' });
      }
    } catch (error) {
      process.parentPort.postMessage({ type: 'error', error: error.message });
    }
  });
  
  // Send ready signal
  process.parentPort.postMessage({ type: 'ready' });
}

module.exports = {
  startServer,
  stopServer,
  getStatus
};

