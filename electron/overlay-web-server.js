/**
 * Overlay Web Server Utility Process
 * 
 * Serves runview.html as a static file via Express.js
 * Only responds to GET requests for runview.html and runinfo.css
 * All other requests return 404
 * Other HTTP methods return errors
 */

let express, path, fs;
try {
  express = require('express');
  path = require('path');
  fs = require('fs');
} catch (requireError) {
  if (process.parentPort) {
    process.parentPort.postMessage({ 
      type: 'error', 
      error: `Failed to load required modules: ${requireError.message}` 
    });
  }
  throw requireError;
}

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
  
  // Send log message to main process
  if (process.parentPort) {
    process.parentPort.postMessage({ 
      type: 'log', 
      message: `startServer called with port ${port}, host ${allowRemote ? '0.0.0.0' : '127.0.0.1'}` 
    });
  }
  
  if (server) {
    return { success: false, error: 'Server is already running' };
  }
  
  if (!express) {
    return { success: false, error: 'Express module not loaded' };
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
    
    // Also serve as runinfo.html for compatibility
    app.get('/runinfo.html', (req, res) => {
      const filePath = path.join(userDataPath, 'runview.html');
      if (fs.existsSync(filePath)) {
        res.sendFile(filePath);
      } else {
        res.status(404).send('File Not Found');
      }
    });
    
    // Serve runinfo.css if it exists
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
      server = app.listen(port, host);
      
      const timeout = setTimeout(() => {
        reject(new Error(`Server failed to start within 5 seconds`));
      }, 5000);
      
      server.on('listening', () => {
        clearTimeout(timeout);
        resolve();
      });
      
      server.on('error', (err) => {
        clearTimeout(timeout);
        if (err.code === 'EADDRINUSE') {
          reject(new Error(`Port ${port} is already in use`));
        } else {
          reject(err);
        }
      });
    });
    
    return { success: true, port };
  } catch (error) {
    server = null;
    app = null;
    return { success: false, error: error.message || String(error) };
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
          resolve();
        }
      });
    });
    
    server = null;
    app = null;
    return { success: true };
  } catch (error) {
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
if (process.parentPort) {
  // Set up message handler FIRST
  process.parentPort.on('message', async (message) => {
    // Log ALL messages received for debugging
    process.parentPort.postMessage({ 
      type: 'log', 
      message: `Utility process received message: ${JSON.stringify(message)}` 
    });
    
    if (!message || typeof message !== 'object' || !message.type) {
      process.parentPort.postMessage({ 
        type: 'log', 
        message: 'Utility process: Invalid message format' 
      });
      return;
    }
    
    const { type, options } = message;
    
    try {
      switch (type) {
        case 'start':
          // Immediately acknowledge
          process.parentPort.postMessage({ 
            type: 'start-ack', 
            message: 'Received start command' 
          });
          
          process.parentPort.postMessage({ 
            type: 'log', 
            message: `Starting server with options: ${JSON.stringify(options)}` 
          });
          
          try {
            const result = await startServer(options);
            process.parentPort.postMessage({ type: 'start-result', result });
            process.parentPort.postMessage({ 
              type: 'log', 
              message: `Server start result: ${JSON.stringify(result)}` 
            });
          } catch (startError) {
            process.parentPort.postMessage({ 
              type: 'start-result', 
              result: { 
                success: false, 
                error: startError.message || String(startError)
              } 
            });
            process.parentPort.postMessage({ 
              type: 'log', 
              message: `Server start error: ${startError.message}` 
            });
          }
          break;
        case 'stop':
          const stopResult = await stopServer();
          process.parentPort.postMessage({ type: 'stop-result', result: stopResult });
          break;
        case 'status':
          const status = getStatus();
          process.parentPort.postMessage({ type: 'status-result', result: status });
          break;
      }
    } catch (error) {
      process.parentPort.postMessage({ type: 'error', error: error.message || String(error) });
      process.parentPort.postMessage({ 
        type: 'log', 
        message: `Error in message handler: ${error.message}` 
      });
    }
  });
  
  // Send ready signal after handler is set up
  process.parentPort.postMessage({ type: 'ready' });
  process.parentPort.postMessage({ 
    type: 'log', 
    message: 'Utility process: Message handler set up, ready signal sent' 
  });
} else {
  // Log error if parentPort is not available
  console.error('[Overlay Web Server] process.parentPort is not available');
}

module.exports = {
  startServer,
  stopServer,
  getStatus
};

