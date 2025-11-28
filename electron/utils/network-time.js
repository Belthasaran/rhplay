/**
 * Network Time Utility
 * Fetches network time from reliable sources and compares with system time
 */

const https = require('https');
const http = require('http');

/**
 * Fetch network time from multiple sources and return the most reliable result
 * @returns {Promise<{success: boolean, networkTime?: number, offsetMs?: number, error?: string}>}
 */
async function fetchNetworkTime() {
  const sources = [
    {
      name: 'worldtimeapi.org',
      url: 'https://worldtimeapi.org/api/timezone/UTC',
      parser: (data) => {
        const parsed = JSON.parse(data);
        return new Date(parsed.utc_datetime).getTime();
      }
    },
    {
      name: 'timeapi.io',
      url: 'https://timeapi.io/api/Time/current/zone?timeZone=UTC',
      parser: (data) => {
        const parsed = JSON.parse(data);
        return new Date(parsed.dateTime).getTime();
      }
    }
  ];

  const timeouts = [];
  const promises = sources.map((source) => {
    return new Promise((resolve) => {
      const startTime = Date.now();
      
      // Parse URL
      const url = new URL(source.url);
      const client = url.protocol === 'https:' ? https : http;
      
      const req = client.get({
        hostname: url.hostname,
        path: url.pathname + url.search,
        timeout: 2000 // 2 second timeout per source
      }, (res) => {
        let data = '';
        
        res.on('data', (chunk) => {
          data += chunk;
        });
        
        res.on('end', () => {
          try {
            if (res.statusCode === 200) {
              const networkTime = source.parser(data);
              const requestLatency = Date.now() - startTime;
              
              // Adjust network time by half the latency (estimate of actual network time)
              const adjustedNetworkTime = networkTime + (requestLatency / 2);
              
              resolve({
                success: true,
                networkTime: adjustedNetworkTime,
                source: source.name,
                latency: requestLatency
              });
            } else {
              resolve({
                success: false,
                error: `HTTP ${res.statusCode} from ${source.name}`
              });
            }
          } catch (error) {
            resolve({
              success: false,
              error: `Parse error from ${source.name}: ${error.message}`
            });
          }
        });
      });
      
      req.on('error', (error) => {
        resolve({
          success: false,
          error: `Network error from ${source.name}: ${error.message}`
        });
      });
      
      req.on('timeout', () => {
        req.destroy();
        resolve({
          success: false,
          error: `Timeout from ${source.name}`
        });
      });
      
      // Overall timeout
      const timeoutId = setTimeout(() => {
        req.destroy();
        resolve({
          success: false,
          error: `Overall timeout from ${source.name}`
        });
      }, 3000);
      
      timeouts.push(timeoutId);
    });
  });

  try {
    // Wait for first successful response or all to fail
    const results = await Promise.all(promises);
    
    // Clear all timeouts
    timeouts.forEach(clearTimeout);
    
    // Find first successful result
    const successResult = results.find(r => r.success);
    
    if (successResult) {
      const systemTime = Date.now();
      const offsetMs = successResult.networkTime - systemTime;
      
      return {
        success: true,
        networkTime: successResult.networkTime,
        systemTime: systemTime,
        offsetMs: offsetMs,
        source: successResult.source,
        latency: successResult.latency
      };
    } else {
      // All sources failed, collect errors
      const errors = results.map(r => r.error).filter(Boolean);
      return {
        success: false,
        error: `All time sources failed: ${errors.join('; ')}`
      };
    }
  } catch (error) {
    // Clear timeouts on exception
    timeouts.forEach(clearTimeout);
    
    return {
      success: false,
      error: `Exception fetching network time: ${error.message}`
    };
  }
}

/**
 * Determine run validity status based on clock offset
 * @param {number} offsetMs - Clock offset in milliseconds (positive = system ahead, negative = system behind)
 * @returns {string} - 'valid', 'invalid', 'unverified', or 'suspicious'
 */
function determineRunValidity(offsetMs) {
  if (offsetMs === null || offsetMs === undefined) {
    return 'unverified';
  }
  
  const offsetSeconds = Math.abs(offsetMs) / 1000;
  
  // Thresholds:
  // - < 5 seconds: valid (normal clock drift)
  // - 5-60 seconds: suspicious (possible minor clock issue)
  // - > 60 seconds: invalid (significant clock issue)
  
  if (offsetSeconds < 5) {
    return 'valid';
  } else if (offsetSeconds < 60) {
    return 'suspicious';
  } else {
    return 'invalid';
  }
}

module.exports = {
  fetchNetworkTime,
  determineRunValidity
};

