# Component Dialog Replacement Plan

**Date**: Created for systematic replacement of `alert()`, `confirm()`, and `prompt()` in Vue components  
**Status**: 📋 Planning Phase

**Important Note**: The utility module `utils/dialogs.ts` already exists and provides all necessary functions (`showAlert`, `showConfirm`, `showPrompt`). No new utility module needs to be created. Components should import directly from `@/utils/dialogs`.

---

## Overview

This document outlines the plan to replace all system dialog functions (`alert()`, `confirm()`, `prompt()`) in Vue components located in `~/rhplay/electron/renderer/src/components/` with custom modal functions.

---

## Current State Analysis

### Components with System Dialogs

Based on grep analysis, the following components contain system dialog calls:

1. **GameStagesDialog.vue** - 24 instances
   - `alert()`: 22 instances
   - `confirm()`: 1 instance
   - `prompt()`: 0 instances

2. **submit/GameSubmissionDashboard.vue** - 40 instances
   - `alert()`: 37 instances
   - `confirm()`: 2 instances
   - `prompt()`: 1 instance

3. **AdvancedPatchModal.vue** - 20 instances
   - `alert()`: 18 instances
   - `confirm()`: 2 instances
   - `prompt()`: 0 instances

4. **publish/PublishingQueueDashboard.vue** - 6 instances
   - `alert()`: 4 instances
   - `confirm()`: 2 instances
   - `prompt()`: 0 instances

5. **publish/ProfilePublishingDashboard.vue** - 3 instances
   - `alert()`: 3 instances
   - `confirm()`: 0 instances
   - `prompt()`: 0 instances

6. **relay/RelayHealthDashboard.vue** - 6 instances
   - `alert()`: 6 instances
   - `confirm()`: 0 instances
   - `prompt()`: 0 instances

**Total**: 99 instances across 6 components

---

## Custom Modal Functions Availability

### Current Implementation

The custom modal functions are defined in `electron/renderer/src/utils/dialogs.ts`:
- `showAlert(message: string, title?: string): Promise<void>`
- `showConfirm(message: string, title?: string, confirmText?: string, cancelText?: string): Promise<boolean>`
- `showPrompt(message: string, defaultValue?: string, title?: string, placeholder?: string, inputType?: string, required?: boolean, confirmText?: string, cancelText?: string): Promise<string | null>`

**Note**: `showToastNotification` is handled separately in `App.vue` via the `ToastNotification` component ref. Components can either:
1. Use `showAlert` for success messages (simpler)
2. Include their own `ToastNotification` component instance (if they need non-blocking notifications)

### Modal Components

The following modal components exist:
- `AlertDialog.vue` - For alert dialogs
- `ConfirmDialog.vue` - For confirmation dialogs
- `PromptDialog.vue` - For prompt/input dialogs
- `ToastNotification.vue` - For non-blocking notifications

### Z-Index Hierarchy

Current z-index values found in components:
- **ToastNotification**: `z-index: 99999` (highest)
- **Custom Modals** (AlertDialog, ConfirmDialog, PromptDialog): Should use `z-index: 70000` (as referenced in TwitchIntegrationSetup.vue)
- **TwitchIntegrationSetup**: `z-index: 30001` and `30000`
- **GameStagesDialog modals**: `z-index: 25000`
- **DetectedLevelsDialog**: `z-index: 25000`
- **GameDetailsInspector**: `z-index: 20000`
- **WinRulesDropdown**: `z-index: 20011` and `20010`
- **AdvancedPatchModal**: `z-index: 2001`, `2000`, `1001`, `1000`
- **Trust components**: `z-index: 1000`, `100`, `1`

**Issue**: Some component modals use z-index values (25000, 20000) that are higher than the custom modal z-index (70000), but this should be fine as long as custom modals are always on top.

---

## Implementation Plan

### Phase 1: Verify Utility Module ✅

**Status**: ✅ **ALREADY EXISTS**

The utility module already exists at `electron/renderer/src/utils/dialogs.ts` and provides:
- `showAlert(message: string, title?: string): Promise<void>`
- `showConfirm(message: string, title?: string, confirmText?: string, cancelText?: string): Promise<boolean>`
- `showPrompt(message: string, defaultValue?: string, title?: string, placeholder?: string, inputType?: string, required?: boolean, confirmText?: string, cancelText?: string): Promise<string | null>`

**Action Required**: Components just need to import these functions.

### Phase 2: Verify Modal Components in Components

**Goal**: Ensure components can access the modal dialogs.

**Status**: ✅ **ALREADY EXISTS**

The modal components exist:
- `AlertDialog.vue` - Already in components directory
- `ConfirmDialog.vue` - Already in components directory  
- `PromptDialog.vue` - Already in components directory
- `ToastNotification.vue` - Already in components directory

**Action Required**: Components need to:
1. Import the dialog functions from `@/utils/dialogs`
2. Include the modal components in their template (or ensure they're available globally)
3. Bind to the reactive state from `utils/dialogs.ts`

**Note**: Since the dialogs use global reactive state, components can import and use the functions directly. However, the modal components themselves need to be included in the component tree (either in each component or in a parent provider).

### Phase 3: Add Modal Components to Each Component

**Goal**: Ensure each component that needs dialogs includes the modal components.

**Steps**:
1. For each component that will use dialogs, add the modal components to the template
2. Bind to the reactive state from `utils/dialogs.ts`
3. Ensure proper z-index stacking

**Example Template Addition**:
```vue
<template>
  <!-- Component content -->
  
  <!-- Modal dialogs -->
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
</template>

<script setup lang="ts">
import { 
  showAlert, 
  showConfirm, 
  showPrompt,
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
} from '@/utils/dialogs';
import AlertDialog from '@/components/AlertDialog.vue';
import ConfirmDialog from '@/components/ConfirmDialog.vue';
import PromptDialog from '@/components/PromptDialog.vue';
</script>
```

### Phase 4: Replace System Dialogs in Components

**Order of Replacement** (by complexity and usage):

1. **relay/RelayHealthDashboard.vue** (6 instances - simplest)
   - All `alert()` calls
   - Low complexity, good starting point

2. **publish/ProfilePublishingDashboard.vue** (3 instances)
   - All `alert()` calls
   - Simple success/error messages

3. **publish/PublishingQueueDashboard.vue** (6 instances)
   - `alert()` and `confirm()` calls
   - Moderate complexity

4. **AdvancedPatchModal.vue** (20 instances)
   - `alert()` and `confirm()` calls
   - Higher complexity, validation messages

5. **submit/GameSubmissionDashboard.vue** (40 instances)
   - `alert()`, `confirm()`, and `prompt()` calls
   - Highest complexity, includes prompt replacement

6. **GameStagesDialog.vue** (24 instances)
   - `alert()` and `confirm()` calls
   - High complexity, many validation messages

### Phase 5: Z-Index Verification

**Steps**:
1. Verify all custom modals use `z-index: 70000` or higher
2. Ensure component modals don't conflict
3. Test modal stacking in various scenarios

---

## Replacement Patterns

### Pattern 1: Simple Alert Replacement

**Before**:
```typescript
alert('Error message');
```

**After**:
```typescript
import { showAlert } from '@/utils/dialogs';
await showAlert('Error message', 'Error');
```

### Pattern 2: Success Alert → Toast

**Before**:
```typescript
alert('Operation completed successfully');
```

**After**:
```typescript
// Note: Toast notifications require the ToastNotification component to be included
// For now, use showAlert for success messages, or include ToastNotification component
import { showAlert } from '@/utils/dialogs';
await showAlert('Operation completed successfully', 'Success');
// OR if ToastNotification component is available:
// showToastNotification('Operation completed successfully', 'success', 3000);
```

### Pattern 3: Confirm Replacement

**Before**:
```typescript
if (confirm('Are you sure?')) {
  // action
}
```

**After**:
```typescript
import { showConfirm } from '@/utils/dialogs';
const confirmed = await showConfirm('Are you sure?', 'Confirm');
if (confirmed) {
  // action
}
```

### Pattern 4: Prompt Replacement

**Before**:
```typescript
const input = prompt('Enter value:', 'default');
if (input) {
  // use input
}
```

**After**:
```typescript
import { showPrompt } from '@/utils/dialogs';
// showPrompt(message, defaultValue, title?, placeholder?, inputType?, required?, confirmText?, cancelText?)
const input = await showPrompt('Enter value:', 'default', 'Input', 'Enter value...');
if (input) {
  // use input
}
```

---

## Testing Checklist

For each component replacement:

- [ ] All `alert()` calls replaced
- [ ] All `confirm()` calls replaced
- [ ] All `prompt()` calls replaced
- [ ] Modal z-indexes verified (custom modals appear on top)
- [ ] Success messages use toast notifications where appropriate
- [ ] Error messages use blocking alerts
- [ ] Confirmations use blocking confirm dialogs
- [ ] Prompts use blocking prompt dialogs
- [ ] Keyboard shortcuts work (Enter, Escape)
- [ ] Modal focus management works correctly
- [ ] No linting errors
- [ ] Manual testing of all dialog triggers

---

## Component-Specific Notes

### GameStagesDialog.vue
- Many validation messages
- CSV import/export dialogs
- Stage deletion confirmations
- Consider grouping related alerts

### submit/GameSubmissionDashboard.vue
- Most complex component
- Includes prompt for draft selection
- Many validation steps
- Package preparation workflow
- Submission workflow

### AdvancedPatchModal.vue
- Patch validation messages
- Delete confirmations
- Preset management
- JSON validation errors

### Publishing Components
- Queue management
- Success/error notifications
- Retry confirmations

### Relay Components
- Connection status messages
- Error handling

---

## Estimated Effort

- **Phase 1** (Verify Utility Module): ✅ Complete (already exists)
- **Phase 2** (Verify Modal Components): ✅ Complete (already exist)
- **Phase 3** (Add Modal Components to Each Component): 3-4 hours
  - Add modal components to 6 components
  - Import and bind reactive state
- **Phase 4** (Component Replacements): 
  - Simple components (3): 2-3 hours
  - Moderate components (2): 4-6 hours
  - Complex components (2): 6-8 hours
- **Phase 5** (Z-Index Verification): 1 hour
- **Testing**: 4-6 hours

**Total Estimated Time**: 20-28 hours

---

## Next Steps

1. ✅ Create this plan document
2. ✅ Verify utility module exists (`utils/dialogs.ts`)
3. ✅ Verify modal components exist
4. ⏳ Add modal components to each component that needs them
5. ⏳ Begin component replacements starting with simplest components
6. ⏳ Document each replacement in a testing log
7. ⏳ Verify z-index hierarchy
8. ⏳ Final testing and cleanup

## Z-Index Verification Summary

**Current Z-Index Hierarchy**:
- **Custom Modals** (AlertDialog, ConfirmDialog, PromptDialog): `z-index: 70000` ✅ (highest for dialogs)
- **ToastNotification**: `z-index: 99999` ✅ (highest overall)
- **Component Modals**:
  - GameStagesDialog: `z-index: 25000` ✅ (below custom modals)
  - DetectedLevelsDialog: `z-index: 25000` ✅ (below custom modals)
  - GameDetailsInspector: `z-index: 20000` ✅ (below custom modals)
  - TwitchIntegrationSetup: `z-index: 30001, 30000` ✅ (below custom modals)
  - WinRulesDropdown: `z-index: 20011, 20010` ✅ (below custom modals)
  - AdvancedPatchModal: `z-index: 2001, 2000, 1001, 1000` ✅ (below custom modals)
  - Trust components: `z-index: 1000, 100, 1` ✅ (below custom modals)

**Conclusion**: ✅ All component modals have z-index values below the custom modal z-index (70000), so custom modals will always appear on top. No conflicts detected.

---

## Related Documentation

- `docs/ALERT_REPLACEMENT_TESTING.md` - Testing guide for App.vue replacements
- `docs/BUGFIX_prompt_not_supported.md` - Background on prompt() issues in Electron

