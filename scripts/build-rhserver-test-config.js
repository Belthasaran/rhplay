/**
 * Build Script: Generate RHServer test mode build policy file.
 *
 * When RHPLAY_TEST_STATUS=disabled is set at build time, embeds that policy
 * so production builds force rhserver_testmode to Disabled on startup.
 *
 * Usage:
 *   RHPLAY_TEST_STATUS=disabled node scripts/build-rhserver-test-config.js
 */

const fs = require('fs');
const path = require('path');

const testStatus = process.env.RHPLAY_TEST_STATUS || null;

const config = {
  testStatus: testStatus === 'disabled' ? 'disabled' : null,
  generatedAt: new Date().toISOString()
};

const outputPath = path.join(__dirname, '..', 'electron', 'rhserver-test-config.json');
fs.writeFileSync(outputPath, JSON.stringify(config, null, 2), 'utf8');

if (config.testStatus === 'disabled') {
  console.log(`✓ RHServer test config: test mode disabled (embedded at ${outputPath})`);
} else {
  console.log(`✓ RHServer test config: no build-time override (${outputPath})`);
}
