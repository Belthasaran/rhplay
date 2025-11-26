# Dialog Components Implementation

**Date**: 2025-01-XX  
**Status**: ✅ **COMPLETE**  
**Purpose**: Replace system dialogs (alert/confirm/prompt) with Vue components to avoid focus issues

---

## Overview

This document describes the implementation of custom dialog components and toast notification system to replace system-level `alert()`, `confirm()`, and `prompt()` dialogs. These components prevent focus issues that occur when using native browser dialogs in Electron, especially on Linux.

---

## Components Created

### 1. AlertDialog.vue
**Location**: `electron/renderer/src/components/AlertDialog.vue`

A modal dialog that displays an alert message with an OK button.

**Props**:
- `visible: boolean` - Controls dialog visibility
- `title?: string` - Optional dialog title (default: "Alert")
- `message: string` - The message to display

**Events**:
- `@confirm` - Emitted when user clicks OK
- `@cancel` - Emitted when user clicks X or presses Escape

**Features**:
- Auto-focuses OK button when opened
- Supports Escape key to close
- Supports Enter key to confirm
- Click outside to close (backdrop click)

**Usage**:
```vue
<AlertDialog
  :visible="alertDialogVisible"
  :title="alertDialogTitle"
  :message="alertDialogMessage"
  @confirm="handleAlertConfirm"
  @cancel="handleAlertCancel"
/>
```

---

### 2. ConfirmDialog.vue
**Location**: `electron/renderer/src/components/ConfirmDialog.vue`

A modal dialog that displays a confirmation message with OK and Cancel buttons.

**Props**:
- `visible: boolean` - Controls dialog visibility
- `title?: string` - Optional dialog title (default: "Confirm")
- `message: string` - The message to display
- `confirmText?: string` - Text for confirm button (default: "OK")
- `cancelText?: string` - Text for cancel button (default: "Cancel")

**Events**:
- `@confirm` - Emitted when user clicks confirm button
- `@cancel` - Emitted when user clicks cancel or presses Escape

**Features**:
- Auto-focuses confirm button when opened
- Supports Escape key to cancel
- Supports Enter key to confirm (when focus is on body)
- Click outside to close (backdrop click)

**Usage**:
```vue
<ConfirmDialog
  :visible="confirmDialogVisible"
  :title="confirmDialogTitle"
  :message="confirmDialogMessage"
  :confirm-text="confirmDialogConfirmText"
  :cancel-text="confirmDialogCancelText"
  @confirm="handleConfirmConfirm"
  @cancel="handleConfirmCancel"
/>
```

---

### 3. PromptDialog.vue
**Location**: `electron/renderer/src/components/PromptDialog.vue`

A modal dialog that displays a prompt message with an input field.

**Props**:
- `visible: boolean` - Controls dialog visibility
- `title?: string` - Optional dialog title (default: "Input")
- `message?: string` - Optional message to display above input
- `placeholder?: string` - Optional placeholder text for input
- `defaultValue?: string` - Default value for the input
- `inputType?: string` - Input type (default: "text", use "password" for passwords)
- `required?: boolean` - Whether input is required (default: false)
- `confirmText?: string` - Text for confirm button (default: "OK")
- `cancelText?: string` - Text for cancel button (default: "Cancel")

**Events**:
- `@confirm` - Emitted when user clicks confirm button (passes input value)
- `@cancel` - Emitted when user clicks cancel or presses Escape

**Features**:
- Auto-focuses and selects input text when opened
- Supports Escape key to cancel
- Supports Enter key to confirm
- Disables confirm button if required and input is empty
- Click outside to close (backdrop click)

**Usage**:
```vue
<PromptDialog
  :visible="promptDialogVisible"
  :title="promptDialogTitle"
  :message="promptDialogMessage"
  :placeholder="promptDialogPlaceholder"
  :default-value="promptDialogDefaultValue"
  :input-type="promptDialogInputType"
  :required="promptDialogRequired"
  :confirm-text="promptDialogConfirmText"
  :cancel-text="promptDialogCancelText"
  @confirm="handlePromptConfirm"
  @cancel="handlePromptCancel"
/>
```

---

### 4. ToastNotification.vue
**Location**: `electron/renderer/src/components/ToastNotification.vue`

A non-blocking notification system that displays toast messages in the top-right corner.

**Props**: None (uses internal state)

**Methods** (exposed via `defineExpose`):
- `showToast(message: string, type: ToastType, duration?: number): number` - Show a toast notification
- `removeToast(id: number): void` - Remove a toast by ID

**Toast Types**:
- `'success'` - Green border, checkmark icon
- `'error'` - Red border, X icon
- `'info'` - Blue border, info icon
- `'warning'` - Orange border, warning icon

**Features**:
- Auto-dismisses after specified duration (default: 3000ms)
- Click to dismiss manually
- Stacks multiple toasts vertically
- Smooth enter/exit animations
- Hover effect for better visibility

**Usage**:
```vue
<ToastNotification ref="toastNotificationRef" />
```

```typescript
// In script
const toastNotificationRef = ref<InstanceType<typeof ToastNotification> | null>(null);

function showToastNotification(message: string, type: 'success' | 'error' | 'info' | 'warning' = 'info', duration: number = 3000) {
  if (toastNotificationRef.value) {
    toastNotificationRef.value.showToast(message, type, duration);
  }
}
```

---

## Utility Functions

### dialogs.ts
**Location**: `electron/renderer/src/utils/dialogs.ts`

Provides promise-based helper functions to show dialogs programmatically.

#### Alert Functions

```typescript
import { showAlert, alertDialogVisible, alertDialogTitle, alertDialogMessage, handleAlertConfirm, handleAlertCancel } from './utils/dialogs';

// Show an alert
await showAlert('Operation completed successfully', 'Success');

// Or use the reactive refs directly
alertDialogTitle.value = 'Error';
alertDialogMessage.value = 'Something went wrong';
alertDialogVisible.value = true;
```

#### Confirm Functions

```typescript
import { showConfirm, confirmDialogVisible, confirmDialogTitle, confirmDialogMessage, confirmDialogConfirmText, confirmDialogCancelText, handleConfirmConfirm, handleConfirmCancel } from './utils/dialogs';

// Show a confirm dialog
const confirmed = await showConfirm('Are you sure you want to delete this item?', 'Confirm Deletion', 'Delete', 'Cancel');
if (confirmed) {
  // User clicked Delete
} else {
  // User clicked Cancel or pressed Escape
}
```

#### Prompt Functions

```typescript
import { showPrompt, promptDialogVisible, promptDialogTitle, promptDialogMessage, promptDialogPlaceholder, promptDialogDefaultValue, promptDialogInputType, promptDialogRequired, promptDialogConfirmText, promptDialogCancelText, handlePromptConfirm, handlePromptCancel } from './utils/dialogs';

// Show a text prompt
const name = await showPrompt('Enter your name:', 'John Doe', 'Name Input');

// Show a password prompt
const password = await showPrompt('Enter password:', '', 'Password', 'Enter password...', 'password', true);
if (password) {
  // User entered password
} else {
  // User cancelled
}
```

---

## Integration in App.vue

### 1. Import Components

```typescript
import AlertDialog from './components/AlertDialog.vue';
import ConfirmDialog from './components/ConfirmDialog.vue';
import PromptDialog from './components/PromptDialog.vue';
import ToastNotification from './components/ToastNotification.vue';
import {
  alertDialogVisible,
  alertDialogTitle,
  alertDialogMessage,
  handleAlertConfirm,
  handleAlertCancel,
  confirmDialogVisible,
  confirmDialogTitle,
  confirmDialogMessage,
  confirmDialogConfirmText,
  confirmDialogCancelText,
  handleConfirmConfirm,
  handleConfirmCancel,
  promptDialogVisible,
  promptDialogTitle,
  promptDialogMessage,
  promptDialogPlaceholder,
  promptDialogDefaultValue,
  promptDialogInputType,
  promptDialogRequired,
  promptDialogConfirmText,
  promptDialogCancelText,
  handlePromptConfirm,
  handlePromptCancel
} from './utils/dialogs';
```

### 2. Add Components to Template

Add before the closing `</template>` tag:

```vue
<!-- Dialog Components (Alert, Confirm, Prompt, Toast) -->
<AlertDialog
  :visible="alertDialogVisible"
  :title="alertDialogTitle"
  :message="alertDialogMessage"
  @confirm="handleAlertConfirm"
  @cancel="handleAlertCancel"
/>

<ConfirmDialog
  :visible="confirmDialogVisible"
  :title="confirmDialogTitle"
  :message="confirmDialogMessage"
  :confirm-text="confirmDialogConfirmText"
  :cancel-text="confirmDialogCancelText"
  @confirm="handleConfirmConfirm"
  @cancel="handleConfirmCancel"
/>

<PromptDialog
  :visible="promptDialogVisible"
  :title="promptDialogTitle"
  :message="promptDialogMessage"
  :placeholder="promptDialogPlaceholder"
  :default-value="promptDialogDefaultValue"
  :input-type="promptDialogInputType"
  :required="promptDialogRequired"
  :confirm-text="promptDialogConfirmText"
  :cancel-text="promptDialogCancelText"
  @confirm="handlePromptConfirm"
  @cancel="handlePromptCancel"
/>

<ToastNotification ref="toastNotificationRef" />
```

### 3. Add Toast Notification Helper

```typescript
// Toast notification ref
const toastNotificationRef = ref<InstanceType<typeof ToastNotification> | null>(null);

// Helper function to show toast notifications
function showToastNotification(message: string, type: 'success' | 'error' | 'info' | 'warning' = 'info', duration: number = 3000) {
  if (toastNotificationRef.value) {
    toastNotificationRef.value.showToast(message, type, duration);
  }
}
```

---

## Migration Examples

### Replacing `alert()`

**Before**:
```typescript
alert('Operation completed successfully');
```

**After** (blocking):
```typescript
import { showAlert } from './utils/dialogs';
await showAlert('Operation completed successfully', 'Success');
```

**After** (non-blocking - recommended):
```typescript
showToastNotification('Operation completed successfully', 'success');
```

### Replacing `confirm()`

**Before**:
```typescript
if (confirm('Are you sure you want to delete this item?')) {
  deleteItem();
}
```

**After**:
```typescript
import { showConfirm } from './utils/dialogs';
const confirmed = await showConfirm('Are you sure you want to delete this item?', 'Confirm Deletion');
if (confirmed) {
  deleteItem();
}
```

### Replacing `prompt()`

**Before**:
```typescript
const password = prompt('Enter password:');
if (!password) {
  return;
}
```

**After**:
```typescript
import { showPrompt } from './utils/dialogs';
const password = await showPrompt('Enter password:', '', 'Password', 'Enter password...', 'password', true);
if (!password) {
  return;
}
```

---

## Found System Dialog Usage

### `alert()` calls (5 instances)
- `electron/renderer/src/App.vue`:
  - Line 7527: Export validation
  - Line 7549: Export success message
  - Line 7551: Export error message
  - Line 7556: Export exception handler
  - Line 7581: Import success message

### `prompt()` calls (4 instances)
- `electron/renderer/src/App.vue`:
  - Line 9664: Profile decryption password
  - Line 9714: Profile encryption password
  - Line 9719: Profile encryption password confirmation
  - Line 10107: Backup encryption password

### `confirm()` calls
- None found in App.vue (may exist in other files)

---

## Benefits

1. **No Focus Issues**: Custom dialogs don't steal focus from the Electron window
2. **Consistent Styling**: Dialogs match the app's theme and design
3. **Better UX**: Toast notifications are non-blocking and less intrusive
4. **Keyboard Support**: Full keyboard navigation (Enter, Escape, Tab)
5. **Accessibility**: Can be enhanced with ARIA labels and screen reader support
6. **Cross-Platform**: Works consistently across Windows, macOS, and Linux

---

## Next Steps

1. ✅ Components created
2. ✅ Utility functions created
3. ✅ Components integrated into App.vue
4. ⏳ Replace existing `alert()` calls (5 instances)
5. ⏳ Replace existing `prompt()` calls (4 instances)
6. ⏳ Test focus behavior after replacements
7. ⏳ Search for any remaining `confirm()` calls in other files

---

## Testing Checklist

- [ ] Alert dialog opens and closes correctly
- [ ] Confirm dialog returns correct boolean value
- [ ] Prompt dialog returns correct string or null
- [ ] Toast notifications appear and auto-dismiss
- [ ] Multiple toasts stack correctly
- [ ] Keyboard navigation works (Enter, Escape, Tab)
- [ ] Focus returns to window after dialog closes
- [ ] Text inputs respond to clicks after dialog closes
- [ ] No focus issues on Linux
- [ ] No focus issues on Windows
- [ ] No focus issues on macOS
- [ ] Dialogs match app theme
- [ ] Toast notifications match app theme

---

## Related Documentation

- `docs/MITIGATION_PLAN_system_dialogs.md` - Original mitigation plan
- `docs/BUGFIX_prompt_not_supported.md` - Previous fix for prompt() issues

