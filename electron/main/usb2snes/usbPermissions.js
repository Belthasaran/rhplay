const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');

/**
 * Check if the user has necessary permissions to access USB/serial devices
 * @returns {Promise<{hasPermissions: boolean, platform: string, issues: string[], instructions: string[]}>}
 */
async function checkUsbPermissions() {
  const platform = process.platform;
  const result = {
    hasPermissions: true,
    platform: platform,
    issues: [],
    instructions: []
  };

  if (platform === 'linux') {
    // On Linux, we need to check:
    // 1. If dialout group exists
    // 2. If user is in dialout group
    // 3. If /dev/ttyACM* devices are accessible
    
    try {
      // Get current username
      const username = os.userInfo().username;
      
      // Check if dialout group exists
      let dialoutGroupExists = false;
      try {
        const groupsFile = fs.readFileSync('/etc/group', 'utf8');
        dialoutGroupExists = groupsFile.includes('dialout:');
      } catch (error) {
        result.issues.push('Cannot read /etc/group to check dialout group');
        result.instructions.push('Unable to verify group configuration. You may need administrator access.');
        result.hasPermissions = false;
        return result;
      }

      if (!dialoutGroupExists) {
        // dialout group doesn't exist, which is unusual but might be OK
        // Some distributions use different group names or no groups at all
        result.issues.push('dialout group not found (this may be normal on some distributions)');
        result.instructions.push('If you cannot access USB devices, your distribution may use a different permission model.');
      } else {
        // Check if user is in dialout group
        try {
          const groupsOutput = execSync(`groups ${username}`, { encoding: 'utf8', timeout: 5000 }).trim();
          // groups command can output: "username : group1 group2" or "group1 group2 group3"
          // Extract just the group names (skip username and colon if present)
          const groupsParts = groupsOutput.split(':');
          const groupsString = groupsParts.length > 1 ? groupsParts[1].trim() : groupsParts[0].trim();
          const userGroups = groupsString.split(/\s+/).filter(g => g.length > 0);
          
          if (!userGroups.includes('dialout')) {
            result.hasPermissions = false;
            result.issues.push(`User '${username}' is not a member of the 'dialout' group`);
            result.instructions.push(`To add yourself to the dialout group, run:`);
            result.instructions.push(`  sudo usermod -a -G dialout ${username}`);
            result.instructions.push(`Then log out and log back in for the change to take effect.`);
            result.instructions.push(`Or restart your session if using a display manager.`);
          }
        } catch (error) {
          // Couldn't check groups - might be a permission issue itself
          result.issues.push('Cannot check group membership (permission issue)');
          result.instructions.push('Unable to verify group membership. You may need administrator access.');
          result.hasPermissions = false;
          return result;
        }
      }

      // Try to check if serial devices exist and are readable
      // This is a best-effort check
      try {
        const serialPorts = ['/dev/ttyACM0', '/dev/ttyACM1', '/dev/ttyACM2', '/dev/ttyUSB0', '/dev/ttyUSB1'];
        const existingPorts = serialPorts.filter(port => {
          try {
            fs.accessSync(port, fs.constants.F_OK);
            return true;
          } catch {
            return false;
          }
        });

        if (existingPorts.length > 0) {
          // Try to check if we can stat the device (not necessarily read, but see if it exists)
          let accessible = true;
          for (const port of existingPorts) {
            try {
              const stats = fs.statSync(port);
              // If we can stat it, that's a good sign, but we still need the group
            } catch {
              accessible = false;
              break;
            }
          }
          
          if (!accessible && result.hasPermissions) {
            result.issues.push('Serial devices found but may not be accessible');
            result.instructions.push('Even with dialout group membership, you may need to log out and back in.');
          }
        }
      } catch (error) {
        // Ignore serial port check errors - device might not be connected
      }

    } catch (error) {
      result.issues.push(`Error checking permissions: ${error.message}`);
      result.hasPermissions = false;
    }
  } else if (platform === 'win32') {
    // Windows: Usually no special groups needed
    // USB devices are typically accessible to all users (may need drivers)
    // We can't easily check driver installation, so we assume permissions are OK
    // If there are issues, they'll show up when trying to access the device
    result.hasPermissions = true; // Windows doesn't typically require special permissions
    result.instructions.push('Windows typically allows USB device access for all users.');
    result.instructions.push('If you encounter permission errors, check if USB drivers are installed.');
  } else if (platform === 'darwin') {
    // macOS: Usually no special groups needed
    // USB devices are typically accessible to all users
    // macOS may prompt for permission on first access, but no group membership needed
    result.hasPermissions = true; // macOS doesn't require special group membership
    result.instructions.push('macOS typically allows USB device access for all users.');
    result.instructions.push('If you encounter permission errors, check System Preferences > Security & Privacy > Privacy.');
    result.instructions.push('You may be prompted to grant USB access on first connection.');
  }

  return result;
}

/**
 * Quick synchronous check - less thorough but faster
 * @returns {{hasPermissions: boolean, platform: string, needsCheck: boolean}}
 */
function quickCheckUsbPermissions() {
  const platform = process.platform;
  
  if (platform !== 'linux') {
    // Windows and macOS typically don't need special permissions
    return {
      hasPermissions: true,
      platform: platform,
      needsCheck: false
    };
  }

  // On Linux, we need to do a quick check
  // This is just a hint - full check should be done asynchronously
  return {
    hasPermissions: false, // Assume false until checked
    platform: platform,
    needsCheck: true
  };
}

/**
 * Attempt to add current user to dialout group using pkexec
 * @returns {Promise<{success: boolean, message: string, error?: string}>}
 */
async function grantDialoutPermission() {
  const platform = process.platform;
  
  if (platform !== 'linux') {
    return {
      success: false,
      message: 'This operation is only available on Linux',
      error: 'Not supported on this platform'
    };
  }

  try {
    const username = os.userInfo().username;
    
    // Use pkexec to run usermod as root (will show GUI password dialog)
    const command = `pkexec usermod -a -G dialout ${username}`;
    
    return new Promise((resolve) => {
      try {
        execSync(command, { 
          encoding: 'utf8', 
          timeout: 30000, // 30 second timeout
          stdio: 'pipe'
        });
        
        resolve({
          success: true,
          message: `Successfully added ${username} to dialout group. Please restart the application for changes to take effect.`
        });
      } catch (error) {
        // pkexec returns non-zero on user cancel or error
        if (error.status === 126 || error.status === 127) {
          // pkexec not available or permission denied
          resolve({
            success: false,
            message: 'pkexec is not available or permission was denied',
            error: error.message
          });
        } else if (error.status === 1) {
          // User cancelled the password dialog
          resolve({
            success: false,
            message: 'Permission dialog was cancelled',
            error: 'User cancelled'
          });
        } else {
          // Other error
          resolve({
            success: false,
            message: `Error: ${error.message}`,
            error: error.message
          });
        }
      }
    });
  } catch (error) {
    return {
      success: false,
      message: `Failed to grant permission: ${error.message}`,
      error: error.message
    };
  }
}

module.exports = {
  checkUsbPermissions,
  quickCheckUsbPermissions,
  grantDialoutPermission
};

