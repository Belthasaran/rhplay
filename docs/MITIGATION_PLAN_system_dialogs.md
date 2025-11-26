# Mitigation Plan: Replace System Dialogs (alert/confirm/prompt)

**Date**: 2025-01-XX  
**Issue**: System-level `alert()`, `confirm()`, and `prompt()` dialogs cause focus issues in Electron  
**Status**: 📋 **PLAN**

---

## Problem Description

### Why System Dialogs Cause Focus Issues

System dialogs (`alert()`, `confirm()`, `prompt()`) in Electron can cause focus problems, especially on Linux:

1. **Event Loop Blocking**: System dialogs block the JavaScript event loop, preventing the UI from updating
2. **Focus Stealing**: The native OS dialog steals focus from the Electron window
3. **Focus Restoration Failure**: After the dialog closes, focus may not properly return to the Electron window
4. **Input Field Issues**: Text inputs may stop responding to click events until focus is manually restored (user must tab out and back in)

### Root Cause

- Electron uses Chromium's implementation of these dialogs
- On Linux, these dialogs are rendered by the window manager, not Electron
- The window manager may not properly restore focus to the Electron window after the dialog closes
- This is a known Electron/Chromium issue, especially on Linux with certain window managers

---

## Current Usage in Codebase

### Found Instances

1. **`alert()` calls** (5 instances):
   - `electron/renderer/src/App.vue`:
     - Line 7527: Export validation
     - Line 7549: Export success message
     - Line 7551: Export error message
     - Line 7556: Export exception handler
     - Line 7581: Import success message

2. **`confirm()` calls**: None found (may be in other files)

3. **`prompt()` calls**: Already replaced (see `docs/BUGFIX_prompt_not_supported.md`)

---

## Mitigation Strategy

### Phase 1: Create Reusable Dialog Components

#### 1.1 Create Alert Dialog Component

**File**: `electron/renderer/src/components/AlertDialog.vue`

```vue
<template>
  <div v-if="visible" class="modal-backdrop" @click.self="handleCancel">
    <div class="modal alert-dialog">
      <header class="modal-header">
        <h3>{{ title || 'Alert' }}</h3>
        <button class="close" @click="handleCancel">✕</button>
      </header>
      <section class="modal-body">
        <p>{{ message }}</p>
      </section>
      <footer class="modal-footer">
        <button @click="handleConfirm" class="btn-primary" autofocus>OK</button>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';

const props = defineProps<{
  visible: boolean;
  title?: string;
  message: string;
}>();

const emit = defineEmits<{
  (e: 'confirm'): void;
  (e: 'cancel'): void;
}>();

function handleConfirm() {
  emit('confirm');
}

function handleCancel() {
  emit('cancel');
}

// Auto-focus OK button when dialog opens
watch(() => props.visible, (newVal) => {
  if (newVal) {
    // Focus will be handled by autofocus attribute
  }
});
</script>
```

#### 1.2 Create Confirm Dialog Component

**File**: `electron/renderer/src/components/ConfirmDialog.vue`

```vue
<template>
  <div v-if="visible" class="modal-backdrop" @click.self="handleCancel">
    <div class="modal confirm-dialog">
      <header class="modal-header">
        <h3>{{ title || 'Confirm' }}</h3>
        <button class="close" @click="handleCancel">✕</button>
      </header>
      <section class="modal-body">
        <p>{{ message }}</p>
      </section>
      <footer class="modal-footer">
        <button @click="handleCancel" class="btn-secondary">Cancel</button>
        <button @click="handleConfirm" class="btn-primary" autofocus>{{ confirmText || 'OK' }}</button>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';

const props = defineProps<{
  visible: boolean;
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
}>();

const emit = defineEmits<{
  (e: 'confirm'): void;
  (e: 'cancel'): void;
}>();

function handleConfirm() {
  emit('confirm');
}

function handleCancel() {
  emit('cancel');
}
</script>
```

#### 1.3 Create Toast Notification System (Alternative to alerts)

**File**: `electron/renderer/src/components/ToastNotification.vue`

```vue
<template>
  <TransitionGroup name="toast" tag="div" class="toast-container">
    <div
      v-for="toast in toasts"
      :key="toast.id"
      :class="['toast', `toast-${toast.type}`]"
    >
      <span class="toast-message">{{ toast.message }}</span>
      <button class="toast-close" @click="removeToast(toast.id)">✕</button>
    </div>
  </TransitionGroup>
</template>

<script setup lang="ts">
import { ref } from 'vue';

interface Toast {
  id: number;
  message: string;
  type: 'success' | 'error' | 'info' | 'warning';
  duration?: number;
}

const toasts = ref<Toast[]>([]);
let nextId = 0;

function showToast(message: string, type: Toast['type'] = 'info', duration: number = 3000) {
  const id = nextId++;
  toasts.value.push({ id, message, type, duration });
  
  if (duration > 0) {
    setTimeout(() => removeToast(id), duration);
  }
}

function removeToast(id: number) {
  const index = toasts.value.findIndex(t => t.id === id);
  if (index !== -1) {
    toasts.value.splice(index, 1);
  }
}

// Expose for use in parent
defineExpose({ showToast });
</script>

<style scoped>
.toast-container {
  position: fixed;
  top: 20px;
  right: 20px;
  z-index: 10000;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.toast {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: var(--bg-primary);
  border: 1px solid var(--border-primary);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  min-width: 300px;
  max-width: 500px;
}

.toast-success {
  border-left: 4px solid #4caf50;
}

.toast-error {
  border-left: 4px solid #f44336;
}

.toast-info {
  border-left: 4px solid #2196f3;
}

.toast-warning {
  border-left: 4px solid #ff9800;
}

.toast-message {
  flex: 1;
}

.toast-close {
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px;
  color: var(--text-secondary);
}

.toast-enter-active,
.toast-leave-active {
  transition: all 0.3s ease;
}

.toast-enter-from {
  opacity: 0;
  transform: translateX(100%);
}

.toast-leave-to {
  opacity: 0;
  transform: translateX(100%);
}
</style>
```

### Phase 2: Create Helper Functions

**File**: `electron/renderer/src/utils/dialogs.ts`

```typescript
import { ref, Ref } from 'vue';

// Global state for dialogs
const alertDialogVisible = ref(false);
const alertDialogTitle = ref('');
const alertDialogMessage = ref('');
const alertDialogResolve = ref<((value: void) => void) | null>(null);

const confirmDialogVisible = ref(false);
const confirmDialogTitle = ref('');
const confirmDialogMessage = ref('');
const confirmDialogConfirmText = ref('OK');
const confirmDialogResolve = ref<((value: boolean) => void) | null>(null);

// Alert function (replaces window.alert)
export function showAlert(message: string, title?: string): Promise<void> {
  return new Promise((resolve) => {
    alertDialogTitle.value = title || 'Alert';
    alertDialogMessage.value = message;
    alertDialogResolve.value = resolve;
    alertDialogVisible.value = true;
  });
}

// Confirm function (replaces window.confirm)
export function showConfirm(
  message: string,
  title?: string,
  confirmText: string = 'OK',
  cancelText: string = 'Cancel'
): Promise<boolean> {
  return new Promise((resolve) => {
    confirmDialogTitle.value = title || 'Confirm';
    confirmDialogMessage.value = message;
    confirmDialogConfirmText.value = confirmText;
    confirmDialogResolve.value = resolve;
    confirmDialogVisible.value = true;
  });
}

// Toast notification (non-blocking alternative to alert)
export function showToast(
  message: string,
  type: 'success' | 'error' | 'info' | 'warning' = 'info',
  duration: number = 3000
): void {
  // This would call the toast component's showToast method
  // Implementation depends on how you expose the toast component
}

// Export reactive refs for use in components
export {
  alertDialogVisible,
  alertDialogTitle,
  alertDialogMessage,
  alertDialogResolve,
  confirmDialogVisible,
  confirmDialogTitle,
  confirmDialogMessage,
  confirmDialogConfirmText,
  confirmDialogResolve
};
```

### Phase 3: Replace Existing alert() Calls

#### 3.1 Update App.vue

1. **Import dialog utilities**:
```typescript
import { showAlert, showToast } from './utils/dialogs';
```

2. **Replace alert() calls**:

**Before**:
```typescript
alert('Please select games to export');
```

**After** (blocking):
```typescript
await showAlert('Please select games to export', 'Export');
```

**After** (non-blocking - recommended):
```typescript
showToast('Please select games to export', 'warning');
```

3. **For success messages** (use toast):
```typescript
// Before
alert(`Successfully exported ${exportResult.exportedCount} games to ${exportDir}`);

// After
showToast(`Successfully exported ${exportResult.exportedCount} games to ${exportDir}`, 'success');
```

4. **For error messages** (use toast or alert):
```typescript
// Before
alert(`Export failed: ${exportResult.error}`);

// After (non-blocking - recommended)
showToast(`Export failed: ${exportResult.error}`, 'error', 5000);

// Or (blocking if user must acknowledge)
await showAlert(`Export failed: ${exportResult.error}`, 'Export Error');
```

### Phase 4: Integration Steps

1. **Add dialog components to App.vue**:
```vue
<template>
  <!-- ... existing content ... -->
  
  <!-- Alert Dialog -->
  <AlertDialog
    :visible="alertDialogVisible"
    :title="alertDialogTitle"
    :message="alertDialogMessage"
    @confirm="handleAlertConfirm"
    @cancel="handleAlertCancel"
  />
  
  <!-- Confirm Dialog -->
  <ConfirmDialog
    :visible="confirmDialogVisible"
    :title="confirmDialogTitle"
    :message="confirmDialogMessage"
    :confirm-text="confirmDialogConfirmText"
    @confirm="handleConfirmConfirm"
    @cancel="handleConfirmCancel"
  />
  
  <!-- Toast Notifications -->
  <ToastNotification ref="toastRef" />
</template>

<script setup lang="ts">
import AlertDialog from './components/AlertDialog.vue';
import ConfirmDialog from './components/ConfirmDialog.vue';
import ToastNotification from './components/ToastNotification.vue';
import {
  alertDialogVisible,
  alertDialogTitle,
  alertDialogMessage,
  alertDialogResolve,
  confirmDialogVisible,
  confirmDialogTitle,
  confirmDialogMessage,
  confirmDialogConfirmText,
  confirmDialogResolve
} from './utils/dialogs';

const toastRef = ref<InstanceType<typeof ToastNotification>>();

function handleAlertConfirm() {
  alertDialogVisible.value = false;
  if (alertDialogResolve.value) {
    alertDialogResolve.value();
    alertDialogResolve.value = null;
  }
}

function handleAlertCancel() {
  alertDialogVisible.value = false;
  if (alertDialogResolve.value) {
    alertDialogResolve.value();
    alertDialogResolve.value = null;
  }
}

function handleConfirmConfirm() {
  confirmDialogVisible.value = false;
  if (confirmDialogResolve.value) {
    confirmDialogResolve.value(true);
    confirmDialogResolve.value = null;
  }
}

function handleConfirmCancel() {
  confirmDialogVisible.value = false;
  if (confirmDialogResolve.value) {
    confirmDialogResolve.value(false);
    confirmDialogResolve.value = null;
  }
}
</script>
```

---

## Implementation Priority

### High Priority (Immediate)
1. ✅ Replace `alert()` calls in export/import functions (5 instances)
2. ✅ Test focus behavior after replacement

### Medium Priority (Next Sprint)
1. Create reusable dialog components
2. Create toast notification system
3. Add helper functions for easy migration

### Low Priority (Future)
1. Search for any remaining `confirm()` calls
2. Add keyboard shortcuts (Enter/Escape) to dialogs
3. Add animation/transition effects
4. Consider accessibility improvements (ARIA labels, screen reader support)

---

## Testing Checklist

After implementing replacements:

- [ ] Text inputs respond to clicks immediately after dialog closes
- [ ] Focus returns to the Electron window after dialog closes
- [ ] No focus issues on Linux (test with different window managers)
- [ ] No focus issues on Windows
- [ ] No focus issues on macOS
- [ ] Keyboard navigation works (Tab, Enter, Escape)
- [ ] Dialogs are styled consistently with app theme
- [ ] Toast notifications don't block UI interaction
- [ ] Multiple toasts stack correctly
- [ ] Toast auto-dismiss works correctly

---

## Best Practices Going Forward

### ✅ DO:
- Use custom modal dialogs for user interaction
- Use toast notifications for non-critical messages
- Use blocking dialogs only when user action is required
- Test focus behavior after any dialog implementation
- Use Vue's `autofocus` attribute for primary buttons

### ❌ DON'T:
- Use `window.alert()`, `window.confirm()`, or `window.prompt()`
- Block the UI unnecessarily
- Create dialogs that steal focus permanently
- Forget to restore focus after dialog closes

---

## Migration Example

### Before (Problematic):
```typescript
async function exportGames() {
  if (selectedIds.size === 0) {
    alert('Please select games to export');  // ❌ Causes focus issues
    return;
  }
  
  const result = await electronAPI.exportGames(...);
  if (result.success) {
    alert(`Successfully exported ${result.count} games`);  // ❌ Causes focus issues
  } else {
    alert(`Export failed: ${result.error}`);  // ❌ Causes focus issues
  }
}
```

### After (Fixed):
```typescript
import { showToast, showAlert } from './utils/dialogs';

async function exportGames() {
  if (selectedIds.size === 0) {
    showToast('Please select games to export', 'warning');  // ✅ Non-blocking
    return;
  }
  
  const result = await electronAPI.exportGames(...);
  if (result.success) {
    showToast(`Successfully exported ${result.count} games`, 'success');  // ✅ Non-blocking
  } else {
    showToast(`Export failed: ${result.error}`, 'error', 5000);  // ✅ Non-blocking, longer duration
  }
}
```

---

## Additional Notes

### Why Toast Notifications Are Preferred

For most messages, toast notifications are better than blocking dialogs:

1. **Non-blocking**: User can continue working while message is shown
2. **No focus issues**: Doesn't steal focus from the window
3. **Better UX**: Modern, unobtrusive notifications
4. **Auto-dismiss**: Messages disappear automatically
5. **Stackable**: Multiple messages can be shown at once

### When to Use Blocking Dialogs

Use blocking dialogs (Alert/Confirm) only when:
- User action is **required** before continuing
- The message is **critical** and must be acknowledged
- The operation cannot proceed without user confirmation

---

## References

- [Electron Dialog Best Practices](https://www.electronjs.org/docs/latest/api/dialog)
- [Vue Modal Patterns](https://vuejs.org/guide/components/transitions.html)
- Related fix: `docs/BUGFIX_prompt_not_supported.md`

