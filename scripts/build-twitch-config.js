/**
 * Build Script: Generate Twitch Config File
 * 
 * This script generates twitch-config.json from the RHPLAY_TW_CLIENT_ID environment variable.
 * The client ID is base64-encoded for basic obscurity (not security).
 * 
 * Usage:
 *   RHPLAY_TW_CLIENT_ID=your_client_id node scripts/build-twitch-config.js
 */

const fs = require('fs');
const path = require('path');

const clientId = process.env.RHPLAY_TW_CLIENT_ID;

if (!clientId) {
  console.error('Error: RHPLAY_TW_CLIENT_ID environment variable not set');
  console.error('Usage: RHPLAY_TW_CLIENT_ID=your_client_id node scripts/build-twitch-config.js');
  process.exit(1);
}

// Base64 encode the client ID for basic obscurity
const encodedClientId = Buffer.from(clientId).toString('base64');

const config = {
  clientId: encodedClientId,
  redirectUri: 'https://localhost',
  // Add timestamp for reference
  generatedAt: new Date().toISOString()
};

const outputPath = path.join(__dirname, '..', 'electron', 'twitch-config.json');
const configJson = JSON.stringify(config, null, 2);

fs.writeFileSync(outputPath, configJson, 'utf8');

console.log(`✓ Twitch config file generated at: ${outputPath}`);
console.log('  (Client ID is base64-encoded for obscurity)');

