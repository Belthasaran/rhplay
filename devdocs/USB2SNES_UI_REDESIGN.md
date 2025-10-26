# USB2SNES UI Redesign

## Overview
Major redesign of USB2SNES interface to provide quick access through a dropdown menu with status indicators and health monitoring.

## Components

### 1. USB2SNES Dropdown Button (Header)
- **Location**: Next to "Open Settings" button
- **Appearance**: Button with down arrow (▼)
- **Function**: Opens dropdown menu with quick access

### 2. Dropdown Content Structure

#### Top Section - Status & Connection
- **Connection Status Indicator**: Green (connected) / Red (disconnected)
- **Health Indicator**: Green (healthy) / Yellow (slow/3s) / Red (hung/7s+)
- **Brief Info Display**:
  - COM port number
  - SD2SNES Firmware version
  - Active ROM name
- **Connect/Disconnect Button**: Quick toggle
- **USB2SNES Diagnostics Button**: Opens full tools modal

#### Middle Section - Quick Actions
**Compact button layout**:
- Reconnect
- Reboot
- Menu
- Upload (opens upload modal)
- Cheats (opens cheats modal)
- Challenges (opens challenges modal)

#### Bottom Section - Mini Chat
- Smaller chat history (3-5 lines)
- Chat input box
- "Open Full Chat" button

### 3. Connection Health Monitoring System
**Health States**:
- `Green`: Connected, last command answered
- `Yellow`: Ping unanswered for 3+ seconds
- `Red`: Connection hung, no response for 7+ seconds

**Monitoring Logic**:
- Every 15 seconds: Send ping (GetAddress) if no activity
- Track last command time and last response time
- Update health indicator based on response delays

### 4. Standalone Modals

#### Upload Modal
- File browser/selector
- Progress bar with percentage
- Upload status
- "Launch File on SNES" button after upload

#### Cheats Modal
- Grant Cape
- Grant 1-Up (lives++)
- Grant Star (star timer)
- Each button sends appropriate memory write

#### Challenges Modal
- Timer Challenge (existing)
- Future challenges can be added here

#### Full Chat Modal
- **Top Section**:
  - Connection status indicator
  - Health indicator
  - Active ROM display
- **Quick Command Buttons** (4-5):
  - `!r` - Read command
  - `!w` - Write command
  - `!powerup`
  - `!lives`
  - `!freeze_everything`
  - Clicking appends text and focuses input
- **Full Chat Interface**:
  - Full-size chat history
  - Chat input
  - Command help button

## Implementation Notes

### State Management
```typescript
// Dropdown state
const usb2snesDropdownOpen = ref(false);

// Health monitoring
const connectionHealth = ref<'green' | 'yellow' | 'red'>('red');
const lastCommandTime = ref(0);
const lastResponseTime = ref(0);
const healthCheckInterval = ref<NodeJS.Timeout | null>(null);

// Modal states
const uploadModalOpen = ref(false);
const cheatsModalOpen = ref(false);
const challengesModalOpen = ref(false);
const fullChatModalOpen = ref(false);
```

### Health Monitoring Implementation
```typescript
function startHealthMonitoring() {
  healthCheckInterval.value = setInterval(async () => {
    const now = Date.now();
    const timeSinceLastCommand = now - lastCommandTime.value;
    
    // Ping if no activity for 15 seconds
    if (timeSinceLastCommand > 15000) {
      await sendHealthPing();
    }
    
    // Update health indicator
    updateHealthIndicator();
  }, 1000); // Check every second
}

async function sendHealthPing() {
  try {
    lastCommandTime.value = Date.now();
    await window.electronAPI.usb2snesReadMemory(0xF50000, 1); // Ping
    lastResponseTime.value = Date.now();
  } catch (error) {
    console.error('Health ping failed:', error);
  }
}

function updateHealthIndicator() {
  const now = Date.now();
  const responseDelay = now - lastResponseTime.value;
  
  if (responseDelay < 3000) {
    connectionHealth.value = 'green';
  } else if (responseDelay < 7000) {
    connectionHealth.value = 'yellow';
  } else {
    connectionHealth.value = 'red';
  }
}
```

## UI Layout

```
Toolbar:
[Open Settings] [USB2SNES ▼] [Search/Filters ▼] ...

USB2SNES Dropdown:
┌─────────────────────────────────────┐
│ ● Connected  ● Healthy              │
│ COM4 | FW 1.10.3 | SMW.sfc          │
│ [Disconnect]  [USB2SNES Diagnostics]│
├─────────────────────────────────────┤
│ [Reconnect] [Reboot] [Menu]         │
│ [Upload] [Cheats] [Challenges]      │
├─────────────────────────────────────┤
│ Mini Chat History (3 lines)         │
│ [input box]  [Open Full Chat]       │
└─────────────────────────────────────┘
```

## Testing Checklist
- [ ] Dropdown opens/closes correctly
- [ ] Status indicators show correct colors
- [ ] Health monitoring updates every second
- [ ] Ping sent every 15 seconds during idle
- [ ] Connect/Disconnect works from dropdown
- [ ] All modals open/close correctly
- [ ] Upload modal shows progress
- [ ] Cheats send correct memory writes
- [ ] Full chat modal has all features
- [ ] Quick command buttons work
- [ ] Mini chat syncs with full chat

