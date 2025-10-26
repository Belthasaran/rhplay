# USB2SNES UI Changes - Visual Reference

## Settings Dialog - New Section

**Location:** Settings Dialog (Opened with "Open Settings" button)

**Position:** Above "USB2snes Websocket address" setting

```
┌─────────────────────────────────────────────────────────┐
│  Settings                                          ✕    │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ... other settings above ...                          │
│                                                         │
│  ┌───────────────────────────────────────────────────┐ │
│  │ Default usb2snes library                          │ │
│  │                                                   │ │
│  │  [usb2snes_a (Type A - Python port)          ▼] │ │
│  │   ├─ usb2snes_a (Type A - Python port)          │ │
│  │   ├─ usb2snes_b (Type B - 3rd party JS)         │ │
│  │   ├─ Qusb2snes (Local server)                   │ │
│  │   └─ node-usb (Direct hardware)                 │ │
│  └───────────────────────────────────────────────────┘ │
│                                                         │
│  ┌───────────────────────────────────────────────────┐ │
│  │ USB2snes Websocket address                        │ │
│  │                                                   │ │
│  │  [ ws://localhost:64213                        ] │ │
│  │                                                   │ │
│  │  ⚠ USB2SNES launch requires a USB2SNES server    │ │
│  │    running. https://usb2snes.com/                │ │
│  └───────────────────────────────────────────────────┘ │
│                                                         │
│  ... more settings below ...                           │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

## USB2SNES Tools Modal - Enhanced Layout

**Location:** Opened by clicking "USB2SNES Tools" button (when USB2SNES Enabled = Yes)

### Before (Old Layout):
```
┌─────────────────────────────────────────────────────────┐
│  USB2SNES Tools & Diagnostics                      ✕   │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Connection Status                                      │
│  ─────────────────────────────────────────────────────  │
│  WebSocket Address:  ws://localhost:64213               │
│  Connection Status:  ✗ Disconnected                     │
│  Device:             N/A                                │
│                                                         │
│  [ Test Connection ]                                    │
│                                                         │
│  ... other sections ...                                 │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### After (New Layout):
```
┌─────────────────────────────────────────────────────────────────┐
│  USB2SNES Tools & Diagnostics                              ✕   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  USB2SNES Implementation                                        │
│  ─────────────────────────────────────────────────────────────  │
│  USB2SNES Library:                                              │
│  [usb2snes_a (Type A - Python port)                         ▼] │
│   ├─ usb2snes_a (Type A - Python port)                         │
│   ├─ usb2snes_b (Type B - 3rd party JS)                        │
│   ├─ Qusb2snes (Local server)                                  │
│   └─ node-usb (Direct hardware)                                │
│                                                                 │
│  [When connected:]                                              │
│  ⚠ Disconnect to change library implementation                 │
│                                                                 │
│  Connection Status                                              │
│  ─────────────────────────────────────────────────────────────  │
│  WebSocket Address:  ws://localhost:64213                       │
│  Connection Status:  ✓ Connected  [or]  ✗ Disconnected         │
│  Device:             SD2SNES      [or]  N/A                     │
│                                                                 │
│  [When connected, additional fields shown:]                     │
│  Firmware:           8.0                                        │
│  Version String:     sd2snes mk.III                             │
│  ROM Running:        /path/to/rom.sfc                           │
│                                                                 │
│  [When disconnected:]                                           │
│  [ Connect ]                                                    │
│                                                                 │
│  [When connected:]                                              │
│  [ Disconnect ]  ← Red button                                   │
│                                                                 │
│  Upload Settings                                                │
│  ─────────────────────────────────────────────────────────────  │
│  Upload Directory:    /work                                     │
│  Upload Preference:   Manual Transfer                           │
│  Launch Preference:   Launch Automatically                      │
│                                                                 │
│  Diagnostics                                                    │
│  ─────────────────────────────────────────────────────────────  │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │ Last Connection Attempt: 10/13/2025, 2:30:45 PM           │ │
│  │ Last Error: None                                           │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                 │
│  [ Clear Error Log ]                                            │
│                                                                 │
│  Quick Actions                                                  │
│  ─────────────────────────────────────────────────────────────  │
│  [ Reset Connection ]  [ Open USB2SNES Website ]                │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Key UI Behaviors

### Library Selection
- **In Settings:** Always editable, sets default for new connections
- **In Modal:** Editable only when disconnected
- **When Connected:** Dropdown is disabled (grayed out)
- **Sync:** Modal initializes from Settings default when opened

### Connection States

#### Disconnected State:
```
Library Selector:  [Enabled - can change]
Connect Button:    [Visible - green]
Disconnect Button: [Hidden]
Extra Fields:      [Hidden] (firmware, version, ROM)
```

#### Connected State:
```
Library Selector:  [Disabled - locked]
Warning:           [Visible] "⚠ Disconnect to change library"
Connect Button:    [Hidden]
Disconnect Button: [Visible - red]
Extra Fields:      [Visible] (firmware, version, ROM)
```

### Error Handling

When selecting unimplemented library (usb2snes_b, qusb2snes, node-usb):
```
Alert: "Connection failed: usb2snes_b is not implemented yet. 
        Only usb2snes_a is currently available."

Connection Status: ✗ Disconnected
Last Error: "usb2snes_b is not implemented yet..."
```

## Color Scheme

### Connection Indicators:
- **Connected:** Green background (#10b981), white text, "✓ Connected"
- **Disconnected:** Red background (#ef4444), white text, "✗ Disconnected"

### Buttons:
- **Connect:** Primary button (blue/theme color)
- **Disconnect:** Red button (#ef4444, hover: #dc2626)
- **Secondary:** Gray background (theme-dependent)

### Disabled Elements:
- **Opacity:** 50%
- **Cursor:** not-allowed
- **Select Dropdown:** Grayed out when connected

## Implementation Details

### Vue Reactive State:
```javascript
// Settings (persistent)
settings.usb2snesLibrary = 'usb2snes_a'  // Default library

// Modal state (temporary)
usb2snesCurrentLibrary = ref('usb2snes_a')  // Current selection

// Connection status
usb2snesStatus = {
  connected: false,
  device: '',
  firmwareVersion: '',      // NEW
  versionString: '',        // NEW
  romRunning: '',          // NEW
  lastAttempt: '',
  lastError: ''
}
```

### Key Functions:
```javascript
// When modal opens:
openUsb2snesTools() {
  usb2snesCurrentLibrary.value = settings.usb2snesLibrary;
  usb2snesToolsModalOpen.value = true;
}

// When connecting:
connectUsb2snes() {
  // Check library implementation
  if (library !== 'usb2snes_a') {
    throw new Error(`${library} is not implemented yet`);
  }
  // Update all status fields
  usb2snesStatus.connected = true;
  usb2snesStatus.device = ...;
  usb2snesStatus.firmwareVersion = ...;
  // etc.
}

// When disconnecting:
disconnectUsb2snes() {
  // Clear all status fields
  usb2snesStatus.connected = false;
  usb2snesStatus.device = '';
  usb2snesStatus.firmwareVersion = '';
  // etc.
}
```

## User Workflow

### Setting Default Library:
1. Click "Open settings" button
2. Locate "Default usb2snes library" setting (above Websocket address)
3. Select desired library from dropdown
4. Click "Save Changes and Close"
5. Setting persists for future sessions

### Connecting to USB2SNES:
1. Click "USB2SNES Tools" button (only visible when USB2SNES Enabled)
2. Library selector shows default from settings
3. Change library if desired (only usb2snes_a works currently)
4. Click "Connect" button
5. If successful:
   - Status changes to "✓ Connected" (green)
   - Device name appears
   - Firmware/version/ROM info appears
   - Connect button hidden, Disconnect button shown (red)
   - Library selector becomes disabled

### Disconnecting:
1. Click "Disconnect" button (red)
2. Status changes to "✗ Disconnected" (red)
3. Device/firmware/version/ROM info clears
4. Disconnect button hidden, Connect button shown
5. Library selector becomes enabled again

### Changing Library:
1. Must disconnect first if connected
2. Select new library from dropdown
3. Connect with new library
4. If unimplemented, shows error and stays disconnected

## Files Modified

```
electron/renderer/src/App.vue
├── Lines 700-710:   Added "Default usb2snes library" setting
├── Lines 843-891:   Restructured USB2SNES Tools modal
├── Lines 1164:      Added usb2snesCurrentLibrary ref
├── Lines 1165-1173: Enhanced usb2snesStatus with new fields
├── Lines 1451-1524: Updated connection functions
├── Lines 1644:      Added usb2snesLibrary to settings
└── Lines 4635-4664: Added new CSS styles
```

---

**Summary:** Complete UI infrastructure for multi-library USB2SNES support with proper state management, connection control, and user feedback. Ready for backend protocol implementation.

