/**
 * Dialog Utilities
 * 
 * Provides promise-based replacements for window.alert(), window.confirm(), and window.prompt()
 * These utilities work with Vue components to avoid focus issues caused by system dialogs.
 */

import { ref, Ref } from 'vue';

// ============================================================================
// Alert Dialog State
// ============================================================================

export const alertDialogVisible = ref(false);
export const alertDialogTitle = ref('');
export const alertDialogMessage = ref('');
let alertDialogResolve: ((value: void) => void) | null = null;

/**
 * Show an alert dialog (replaces window.alert())
 * @param message - The message to display
 * @param title - Optional title for the dialog
 * @returns Promise that resolves when user clicks OK
 */
export function showAlert(message: string, title?: string): Promise<void> {
  const dialogTitle = title || 'Alert';
  console.log(`[Alert Dialog] ${dialogTitle}: ${message}`);
  return new Promise((resolve) => {
    alertDialogTitle.value = dialogTitle;
    alertDialogMessage.value = message;
    alertDialogResolve = resolve;
    alertDialogVisible.value = true;
  });
}

/**
 * Handle alert dialog confirmation
 * Called by AlertDialog component when user clicks OK
 */
export function handleAlertConfirm() {
  console.log(`[Alert Dialog] User confirmed`);
  alertDialogVisible.value = false;
  if (alertDialogResolve) {
    alertDialogResolve();
    alertDialogResolve = null;
  }
}

/**
 * Handle alert dialog cancellation
 * Called by AlertDialog component when user clicks X or presses Escape
 */
export function handleAlertCancel() {
  console.log(`[Alert Dialog] User cancelled`);
  alertDialogVisible.value = false;
  if (alertDialogResolve) {
    alertDialogResolve();
    alertDialogResolve = null;
  }
  // Also handle sync alerts
  syncAlertDismissed = true;
}

// Flag to track if sync alert is dismissed
let syncAlertDismissed = false;

/**
 * Show an alert dialog synchronously (blocking, like window.alert())
 * Blocks execution until the user dismisses the dialog
 * 
 * Note: This uses a busy-wait loop that checks a flag. While this blocks execution,
 * it allows the UI to remain responsive because Vue's reactivity system and event
 * handlers run on the same thread and can update the flag.
 * 
 * @param message - The message to display
 * @param title - Optional title for the dialog
 */
export function showAlertSync(message: string, title?: string): void {
  const dialogTitle = title || 'Alert';
  console.log(`[Alert Dialog Sync] ${dialogTitle}: ${message}`);
  
  // If there's a pending async alert, resolve it first to avoid conflicts
  if (alertDialogResolve) {
    alertDialogResolve();
    alertDialogResolve = null;
  }
  
  // Set up the dialog
  alertDialogTitle.value = dialogTitle;
  alertDialogMessage.value = message;
  syncAlertDismissed = false;
  
  // Set up a resolve handler that sets the flag
  alertDialogResolve = () => {
    syncAlertDismissed = true;
    alertDialogResolve = null;
  };
  
  // Show the dialog
  alertDialogVisible.value = true;
  
  // Block execution until dialog is dismissed
  // Use a busy-wait loop that periodically checks the flag
  // The flag will be set by handleAlertConfirm/handleAlertCancel when user dismisses
  const startTime = Date.now();
  const maxWaitTime = 5 * 60 * 1000; // 5 minutes max wait (safety timeout)
  
  // Check flag in a loop, with small delays to avoid 100% CPU usage
  while (!syncAlertDismissed && (Date.now() - startTime) < maxWaitTime) {
    // Small delay to avoid consuming 100% CPU
    // This still blocks execution but allows the event loop to process UI updates
    const checkStart = Date.now();
    while (Date.now() - checkStart < 5) {
      // Busy wait for ~5ms, then check flag again
      // This is necessary because we can't use async/await in a sync function
    }
  }
  
  // Clean up
  alertDialogVisible.value = false;
  syncAlertDismissed = false;
  alertDialogResolve = null;
  
  if ((Date.now() - startTime) >= maxWaitTime) {
    console.warn('[Alert Dialog Sync] Timeout waiting for user response');
  }
}

// ============================================================================
// Confirm Dialog State
// ============================================================================

export const confirmDialogVisible = ref(false);
export const confirmDialogTitle = ref('');
export const confirmDialogMessage = ref('');
export const confirmDialogConfirmText = ref('OK');
export const confirmDialogCancelText = ref('Cancel');
let confirmDialogResolve: ((value: boolean) => void) | null = null;

/**
 * Show a confirm dialog (replaces window.confirm())
 * @param message - The message to display
 * @param title - Optional title for the dialog
 * @param confirmText - Text for the confirm button (default: "OK")
 * @param cancelText - Text for the cancel button (default: "Cancel")
 * @returns Promise that resolves to true if confirmed, false if cancelled
 */
export function showConfirm(
  message: string,
  title?: string,
  confirmText: string = 'OK',
  cancelText: string = 'Cancel'
): Promise<boolean> {
  const dialogTitle = title || 'Confirm';
  console.log(`[Confirm Dialog] ${dialogTitle}: ${message}`);
  return new Promise((resolve) => {
    confirmDialogTitle.value = dialogTitle;
    confirmDialogMessage.value = message;
    confirmDialogConfirmText.value = confirmText;
    confirmDialogCancelText.value = cancelText;
    confirmDialogResolve = resolve;
    confirmDialogVisible.value = true;
  });
}

/**
 * Handle confirm dialog confirmation
 * Called by ConfirmDialog component when user clicks confirm button
 */
export function handleConfirmConfirm() {
  console.log(`[Confirm Dialog] User confirmed`);
  confirmDialogVisible.value = false;
  if (confirmDialogResolve) {
    confirmDialogResolve(true);
    confirmDialogResolve = null;
  }
}

/**
 * Handle confirm dialog cancellation
 * Called by ConfirmDialog component when user clicks cancel or presses Escape
 */
export function handleConfirmCancel() {
  console.log(`[Confirm Dialog] User cancelled`);
  confirmDialogVisible.value = false;
  if (confirmDialogResolve) {
    confirmDialogResolve(false);
    confirmDialogResolve = null;
  }
}

// ============================================================================
// Prompt Dialog State
// ============================================================================

export const promptDialogVisible = ref(false);
export const promptDialogTitle = ref('');
export const promptDialogMessage = ref('');
export const promptDialogPlaceholder = ref('');
export const promptDialogDefaultValue = ref('');
export const promptDialogInputType = ref('text');
export const promptDialogRequired = ref(false);
export const promptDialogConfirmText = ref('OK');
export const promptDialogCancelText = ref('Cancel');
let promptDialogResolve: ((value: string | null) => void) | null = null;

/**
 * Show a prompt dialog (replaces window.prompt())
 * @param message - The message to display
 * @param defaultValue - Default value for the input
 * @param title - Optional title for the dialog
 * @param placeholder - Optional placeholder text
 * @param inputType - Input type (default: 'text', use 'password' for passwords)
 * @param required - Whether input is required (default: false)
 * @param confirmText - Text for the confirm button (default: "OK")
 * @param cancelText - Text for the cancel button (default: "Cancel")
 * @returns Promise that resolves to the input value, or null if cancelled
 */
export function showPrompt(
  message: string,
  defaultValue: string = '',
  title?: string,
  placeholder?: string,
  inputType: string = 'text',
  required: boolean = false,
  confirmText: string = 'OK',
  cancelText: string = 'Cancel'
): Promise<string | null> {
  const dialogTitle = title || 'Input';
  const inputTypeLabel = inputType === 'password' ? 'password' : 'text';
  console.log(`[Prompt Dialog] ${dialogTitle}: ${message} (type: ${inputTypeLabel}, default: "${defaultValue}")`);
  return new Promise((resolve) => {
    promptDialogTitle.value = dialogTitle;
    promptDialogMessage.value = message;
    promptDialogPlaceholder.value = placeholder || '';
    promptDialogDefaultValue.value = defaultValue;
    promptDialogInputType.value = inputType;
    promptDialogRequired.value = required;
    promptDialogConfirmText.value = confirmText;
    promptDialogCancelText.value = cancelText;
    promptDialogResolve = resolve;
    promptDialogVisible.value = true;
  });
}

/**
 * Handle prompt dialog confirmation
 * Called by PromptDialog component when user clicks confirm button
 */
export function handlePromptConfirm(value: string) {
  console.log(`[Prompt Dialog] User confirmed with value: "${value}"`);
  promptDialogVisible.value = false;
  if (promptDialogResolve) {
    promptDialogResolve(value);
    promptDialogResolve = null;
  }
  // Also handle sync prompts
  syncPromptDismissed = true;
  syncPromptResult = value;
}

/**
 * Handle prompt dialog cancellation
 * Called by PromptDialog component when user clicks cancel or presses Escape
 */
export function handlePromptCancel() {
  console.log(`[Prompt Dialog] User cancelled`);
  promptDialogVisible.value = false;
  if (promptDialogResolve) {
    promptDialogResolve(null);
    promptDialogResolve = null;
  }
  // Also handle sync prompts
  syncPromptDismissed = true;
  syncPromptResult = null;
}

// Flag to track if sync prompt is dismissed
let syncPromptDismissed = false;
let syncPromptResult: string | null = null;

/**
 * Show a prompt dialog synchronously (blocking, like window.prompt())
 * Blocks execution until the user dismisses the dialog
 * 
 * @param message - The message to display
 * @param defaultValue - Default value for the input
 * @param title - Optional title for the dialog
 * @param placeholder - Optional placeholder text
 * @param inputType - Input type (default: 'text', use 'password' for passwords)
 * @param required - Whether input is required (default: false)
 * @param confirmText - Text for the confirm button (default: "OK")
 * @param cancelText - Text for the cancel button (default: "Cancel")
 * @param options - Optional options object with `blocking: true` to enable blocking behavior
 * @returns The input value, or null if cancelled (blocking) or undefined (non-blocking)
 */
export function showPromptSync(
  message: string,
  defaultValue: string = '',
  title?: string,
  placeholder?: string,
  inputType: string = 'text',
  required: boolean = false,
  confirmText: string = 'OK',
  cancelText: string = 'Cancel',
  options?: { blocking?: boolean }
): string | null | undefined {
  const dialogTitle = title || 'Input';
  const inputTypeLabel = inputType === 'password' ? 'password' : 'text';
  const blocking = options?.blocking !== false; // Default to blocking if not specified
  console.log(`[Prompt Dialog Sync] ${dialogTitle}: ${message} (type: ${inputTypeLabel}, default: "${defaultValue}", blocking: ${blocking})`);
  
  // If there's a pending async prompt, resolve it first to avoid conflicts
  if (promptDialogResolve) {
    promptDialogResolve(null);
    promptDialogResolve = null;
  }
  
  // Set up the dialog
  promptDialogTitle.value = dialogTitle;
  promptDialogMessage.value = message;
  promptDialogPlaceholder.value = placeholder || '';
  promptDialogDefaultValue.value = defaultValue;
  promptDialogInputType.value = inputType;
  promptDialogRequired.value = required;
  promptDialogConfirmText.value = confirmText;
  promptDialogCancelText.value = cancelText;
  syncPromptDismissed = false;
  syncPromptResult = null;
  
  // Set up a resolve handler that sets the flag and result
  promptDialogResolve = (value: string | null) => {
    syncPromptResult = value;
    syncPromptDismissed = true;
    promptDialogResolve = null;
  };
  
  // Show the dialog
  promptDialogVisible.value = true;
  
  // If blocking, wait for user response
  if (blocking) {
    // Block execution until dialog is dismissed
    // Use a busy-wait loop that periodically checks the flag
    // The flag will be set by handlePromptConfirm/handlePromptCancel when user dismisses
    const startTime = Date.now();
    const maxWaitTime = 5 * 60 * 1000; // 5 minutes max wait (safety timeout)
    
    // Check flag in a loop, with small delays to avoid 100% CPU usage
    while (!syncPromptDismissed && (Date.now() - startTime) < maxWaitTime) {
      // Small delay to avoid consuming 100% CPU
      // This still blocks execution but allows the event loop to process UI updates
      const checkStart = Date.now();
      while (Date.now() - checkStart < 5) {
        // Busy wait for ~5ms, then check flag again
        // This is necessary because we can't use async/await in a sync function
      }
    }
    
    // Clean up
    promptDialogVisible.value = false;
    const result = syncPromptResult;
    syncPromptDismissed = false;
    syncPromptResult = null;
    promptDialogResolve = null;
    
    if ((Date.now() - startTime) >= maxWaitTime) {
      console.warn('[Prompt Dialog Sync] Timeout waiting for user response');
      return null;
    }
    
    return result;
  } else {
    // Non-blocking: return undefined immediately
    promptDialogResolve = null;
    return undefined;
  }
}

// ============================================================================
// Toast Notification State
// ============================================================================

// Toast notifications are handled directly by the ToastNotification component
// This is just a type export for convenience
export type ToastType = 'success' | 'error' | 'info' | 'warning';

