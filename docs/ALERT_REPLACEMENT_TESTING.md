# Alert/Confirm Replacement Testing Guide

This document lists all instances where system `alert()` and `confirm()` calls have been replaced with custom modal functions (`showAlert()`, `showConfirm()`, `showToastNotification()`) in `electron/renderer/src/App.vue`.

**Total Replacements Made**: 574 instances (Batch 1: 318, Batch 2: 49, Batch 3: 49, Batch 4: 49, Batch 5: 49, Batch 6: 49, Batch 7: 11)

## Testing Instructions

For each dialog replacement, verify:
1. The dialog appears on top of all other UI elements (z-index check)
2. The dialog is properly centered and visible
3. The dialog text matches the original message
4. For blocking dialogs (`showAlert`, `showConfirm`): The UI is properly blocked until user responds
5. For non-blocking dialogs (`showToastNotification`): The notification appears and auto-dismisses

---

## 1. Game Export/Import Functions

### 1.1 Export Games - No Selection
- **Location**: `exportFull()` function (line ~8132)
- **Original**: `alert('Please select games to export')`
- **Replaced with**: `await showAlert('Please select games to export', 'Export Error')`
- **How to test**: 
  - Go to Games list
  - Click "Export" without selecting any games
  - Verify alert appears with title "Export Error"

### 1.2 Export Games - Success
- **Location**: `exportFull()` function (line ~8154)
- **Original**: `alert('Successfully exported X games...')`
- **Replaced with**: `showToastNotification('Successfully exported X games...', 'success', 3000)`
- **How to test**:
  - Select one or more games
  - Click "Export"
  - Choose export directory
  - Verify success toast notification appears (non-blocking, auto-dismisses after 3 seconds)

### 1.3 Export Games - Failure
- **Location**: `exportFull()` function (line ~8156, 8161)
- **Original**: `alert('Export failed: ...')`
- **Replaced with**: `await showAlert('Export failed: ...', 'Export Failed')`
- **How to test**:
  - Attempt export to a read-only directory (or simulate failure)
  - Verify error alert appears with title "Export Failed"

### 1.4 Import Games - Success
- **Location**: `importGames()` function (line ~8186)
- **Original**: `alert('Successfully imported X games')`
- **Replaced with**: `showToastNotification('Successfully imported X games', 'success', 3000)`
- **How to test**:
  - Click "Import"
  - Select valid game info JSON files
  - Verify success toast notification appears

### 1.5 Import Games - Failure
- **Location**: `importGames()` function (line ~8190, 8195)
- **Original**: `alert('Import failed: ...')`
- **Replaced with**: `await showAlert('Import failed: ...', 'Import Failed')`
- **How to test**:
  - Attempt to import invalid or corrupted JSON files
  - Verify error alert appears

---

## 2. RHPAK Installation

### 2.1 RHPAK Already Running
- **Location**: RHPAK installation handler (line ~8338)
- **Original**: `alert('Another RHPAK installation is already running...')`
- **Replaced with**: `await showAlert('Another RHPAK installation is already running...', 'Installation In Progress')`
- **How to test**:
  - Start installing an RHPAK
  - While installation is in progress, attempt to open another RHPAK
  - Verify alert appears with title "Installation In Progress"

### 2.2 Uninstall RHPAK Confirmation
- **Location**: Uninstall function (line ~8412)
- **Original**: `confirm('Uninstall X rhpak(s)?...')`
- **Replaced with**: `await showConfirm('Uninstall X rhpak(s)?...', 'Uninstall RHPAK')`
- **How to test**:
  - Select one or more installed RHPAKs
  - Click "Uninstall"
  - Verify confirmation dialog appears with title "Uninstall RHPAK"
  - Test both "Yes" and "No" responses

---

## 3. SSH Control Functions

### 3.1 SSH Control - Electron Required
- **Location**: SSH control functions (lines ~8720, 8779, 8813)
- **Original**: `alert('SSH control requires Electron environment')`
- **Replaced with**: `await showAlert('SSH control requires Electron environment', 'Error')`
- **How to test**:
  - Access SSH control features
  - Verify error alert appears (if not in Electron environment)

### 3.2 Clear SSH Console History
- **Location**: `clearSshConsoleHistory()` function (line ~8861)
- **Original**: `confirm('Clear SSH console history? This action cannot be undone.')`
- **Replaced with**: `await showConfirm('Clear SSH console history? This action cannot be undone.', 'Clear Console History')`
- **How to test**:
  - Open SSH console
  - Click "Clear History" button
  - Verify confirmation dialog appears
  - Test both responses

### 3.3 SSH Console History Cleared
- **Location**: `clearSshConsoleHistory()` function (line ~8868)
- **Original**: `alert('Console history cleared from display')`
- **Replaced with**: `showToastNotification('Console history cleared from display', 'success', 2000)`
- **How to test**:
  - Clear SSH console history
  - Verify success toast appears

---

## 4. USB2SNES Functions

### 4.1 USBFXP Server - Electron Required
- **Location**: USBFXP server functions (lines ~8923, 9023)
- **Original**: `alert('USBFXP server requires Electron environment')`
- **Replaced with**: `await showAlert('USBFXP server requires Electron environment', 'Error')`
- **How to test**: Access USBFXP features (if not in Electron)

### 4.2 USB2SNES Connection Reset
- **Location**: USB2SNES handler (line ~9069)
- **Original**: `alert('USB2SNES connection reset')`
- **Replaced with**: `showToastNotification('USB2SNES connection reset', 'info', 2000)`
- **How to test**: Reset USB2SNES connection, verify toast appears

### 4.3 Directory Creation
- **Location**: USB2SNES directory functions (lines ~9081, 9086, 9088)
- **Original**: Various directory-related alerts
- **Replaced with**: `showToastNotification()` for success, `await showAlert()` for errors
- **How to test**: Create/check USB2SNES upload directories

---

## 5. File Selection Errors

### 5.1 File Selection Error
- **Location**: File selection handlers (lines ~9768, 9788, 9803)
- **Original**: `alert('File selection error: ...')`
- **Replaced with**: `await showAlert('File selection error: ...', 'File Selection Error')`
- **How to test**: Trigger file selection errors (cancel dialog, invalid files, etc.)

---

## 6. Profile Management

### 6.1 Switch Profile - Failure
- **Location**: Profile switching (line ~10174)
- **Original**: `alert('Failed to switch profile: ...')`
- **Replaced with**: `await showAlert('Failed to switch profile: ...', 'Profile Switch Failed')`
- **How to test**: Attempt to switch to a corrupted or invalid profile

### 6.2 Import Profile - Overwrite Confirmation
- **Location**: `importProfileFromDetails()` function (line ~10293)
- **Original**: `confirm('This profile already exists. Overwrite it?')`
- **Replaced with**: `await showConfirm('This profile already exists. Overwrite it?', 'Profile Already Exists')`
- **How to test**:
  - Import a profile that already exists
  - Verify confirmation dialog appears
  - Test both "Yes" and "No" responses

### 6.3 Import Profile - Success
- **Location**: `importProfileFromDetails()` function (line ~10307, 10314)
- **Original**: `alert('Profile imported successfully!')`
- **Replaced with**: `showToastNotification('Profile imported successfully!', 'success', 3000)`
- **How to test**: Successfully import a profile, verify toast appears

### 6.4 Import Profile - Failure
- **Location**: `importProfileFromDetails()` function (line ~10309, 10316, 10320)
- **Original**: `alert('Failed to import profile: ...')`
- **Replaced with**: `await showAlert('Failed to import profile: ...', 'Import Failed')`
- **How to test**: Attempt to import invalid/corrupted profile files

### 6.5 Export Profile - Password Mismatch
- **Location**: `exportProfileFromDetails()` function (line ~10337)
- **Original**: `alert('Passwords do not match')`
- **Replaced with**: `await showAlert('Passwords do not match', 'Validation Error')`
- **How to test**: Export profile with mismatched passwords

### 6.6 Export Profile - Success
- **Location**: `exportProfileFromDetails()` function (line ~10349)
- **Original**: `alert('Profile exported successfully!')`
- **Replaced with**: `showToastNotification('Profile exported successfully!', 'success', 3000)`
- **How to test**: Successfully export a profile

### 6.7 Export Profile - Failure
- **Location**: `exportProfileFromDetails()` function (line ~10351, 10355)
- **Original**: `alert('Failed to export profile: ...')`
- **Replaced with**: `await showAlert('Failed to export profile: ...', 'Export Failed')`
- **How to test**: Attempt export to read-only location

### 6.8 Profile Creation - Electron Required
- **Location**: Profile creation (line ~10464)
- **Original**: `alert('Profile creation requires Electron environment')`
- **Replaced with**: `await showAlert('Profile creation requires Electron environment', 'Error')`
- **How to test**: Attempt profile creation outside Electron

### 6.9 Profile Creation - Failure
- **Location**: Profile creation (lines ~10478, 10482)
- **Original**: `alert('Failed to create profile: ...')`
- **Replaced with**: `await showAlert('Failed to create profile: ...', 'Profile Creation Failed')`
- **How to test**: Attempt to create profile with invalid data

---

## 7. Keypair Management

### 7.1 Regenerate Primary Keypair - Confirmation
- **Location**: `regeneratePrimaryKeypair()` function (line ~10518)
- **Original**: `confirm('Are you sure you want to regenerate your primary keypair? ...')`
- **Replaced with**: `await showConfirm('Are you sure you want to regenerate your primary keypair? ...', 'Regenerate Primary Keypair')`
- **How to test**:
  - Open profile keypair settings
  - Click "Regenerate Primary Keypair"
  - Verify confirmation dialog appears
  - Test both responses

### 7.2 Regenerate Primary Keypair - Failure
- **Location**: `regeneratePrimaryKeypair()` function (line ~10532, 10536)
- **Original**: `alert('Failed to regenerate keypair: ...')`
- **Replaced with**: `await showAlert('Failed to regenerate keypair: ...', 'Regeneration Failed')`
- **How to test**: Simulate regeneration failure

### 7.3 Create Keypair - Failure
- **Location**: Keypair creation (lines ~10560, 10564)
- **Original**: `alert('Failed to create keypair: ...')`
- **Replaced with**: `await showAlert('Failed to create keypair: ...', 'Keypair Creation Failed')`
- **How to test**: Attempt keypair creation with invalid parameters

### 7.4 Load Master Keypair - Failure
- **Location**: Master keypair loading (lines ~10619, 10626)
- **Original**: `alert('Failed to load master keypair: ...')`
- **Replaced with**: `await showAlert('Failed to load master keypair: ...', 'Load Failed')`
- **How to test**: Attempt to load corrupted keypair

### 7.5 Master Keypair - Selection Required
- **Location**: Master keypair functions (line ~10635)
- **Original**: `alert('Please select a master keypair first')`
- **Replaced with**: `await showAlert('Please select a master keypair first', 'Selection Required')`
- **How to test**: Attempt keypair operations without selection

### 7.6 Generate Master Keypair - Failure
- **Location**: Master keypair generation (lines ~10674, 10678)
- **Original**: `alert('Failed to generate master keypair: ...')`
- **Replaced with**: `await showAlert('Failed to generate master keypair: ...', 'Generation Failed')`
- **How to test**: Simulate generation failure

### 7.7 Add Master Keypair - Public Key Required
- **Location**: Add master keypair (line ~10688)
- **Original**: `alert('Please provide a public key')`
- **Replaced with**: `await showAlert('Please provide a public key', 'Input Required')`
- **How to test**: Attempt to add keypair without public key

### 7.8 Add Master Keypair - Failure
- **Location**: Add master keypair (lines ~10709, 10713)
- **Original**: `alert('Failed to add master keypair: ...')`
- **Replaced with**: `await showAlert('Failed to add master keypair: ...', 'Add Failed')`
- **How to test**: Attempt to add invalid keypair

### 7.9 Export Master Keypair Backup - Success
- **Location**: Export backup (line ~10737)
- **Original**: `alert('Master keypair backup exported successfully')`
- **Replaced with**: `showToastNotification('Master keypair backup exported successfully', 'success', 3000)`
- **How to test**: Export master keypair backup

### 7.10 Export Master Keypair Backup - Failure
- **Location**: Export backup (lines ~10739, 10743)
- **Original**: `alert('Failed to export backup: ...')`
- **Replaced with**: `await showAlert('Failed to export backup: ...', 'Export Failed')`
- **How to test**: Attempt export to invalid location

### 7.11 Import Master Keypair Backup - Success
- **Location**: Import backup (line ~10776)
- **Original**: `alert('Master keypair imported successfully')`
- **Replaced with**: `showToastNotification('Master keypair imported successfully', 'success', 3000)`
- **How to test**: Import master keypair backup

### 7.12 Import Master Keypair Backup - Failure
- **Location**: Import backup (lines ~10778, 10782)
- **Original**: `alert('Failed to import backup: ...')`
- **Replaced with**: `await showAlert('Failed to import backup: ...', 'Import Failed')`
- **How to test**: Attempt to import invalid backup file

### 7.13 Delete Master Keypair - Confirmation
- **Location**: Delete master keypair (line ~10792)
- **Original**: `confirm('Are you sure you want to delete this master keypair? ...')`
- **Replaced with**: `await showConfirm('Are you sure you want to delete this master keypair? ...', 'Delete Master Keypair')`
- **How to test**:
  - Select a master keypair
  - Click delete
  - Verify confirmation dialog
  - Test both responses

### 7.14 Delete Master Keypair - Failure
- **Location**: Delete master keypair (lines ~10803, 10807)
- **Original**: `alert('Failed to delete master keypair: ...')`
- **Replaced with**: `await showAlert('Failed to delete master keypair: ...', 'Delete Failed')`
- **How to test**: Simulate deletion failure

---

## 8. Admin Keypair Management

### 8.1 Load Admin Keypair - Failure
- **Location**: Load admin keypair (lines ~10855, 10860)
- **Original**: `alert('Failed to load admin keypair: ...')`
- **Replaced with**: `await showAlert('Failed to load admin keypair: ...', 'Load Failed')`
- **How to test**: Attempt to load corrupted admin keypair

### 8.2 Admin Keypair - Selection Required
- **Location**: Admin keypair functions (lines ~10867, 10901)
- **Original**: `alert('Please select a keypair first')` / `alert('Please select a key usage')`
- **Replaced with**: `await showAlert('Please select a keypair first', 'Selection Required')` / `await showAlert('Please select a key usage', 'Selection Required')`
- **How to test**: Attempt operations without selection

### 8.3 Generate Admin Keypair - Success
- **Location**: Generate admin keypair (line ~10923)
- **Original**: `alert('Admin keypair generated successfully!')`
- **Replaced with**: `showToastNotification('Admin keypair generated successfully!', 'success', 3000)`
- **How to test**: Generate new admin keypair

### 8.4 Generate Admin Keypair - Failure
- **Location**: Generate admin keypair (lines ~10928, 10932)
- **Original**: `alert('Failed to generate admin keypair: ...')`
- **Replaced with**: `await showAlert('Failed to generate admin keypair: ...', 'Generation Failed')`
- **How to test**: Simulate generation failure

### 8.5 Add Admin Keypair - Public Key Required
- **Location**: Add admin keypair (line ~10943)
- **Original**: `alert('Please provide a public key or use Generate new Keypair')`
- **Replaced with**: `await showAlert('Please provide a public key or use Generate new Keypair', 'Input Required')`
- **How to test**: Attempt to add keypair without public key

### 8.6 Add Admin Keypair - Success
- **Location**: Add admin keypair (line ~10979)
- **Original**: `alert('Admin keypair added successfully!')`
- **Replaced with**: `showToastNotification('Admin keypair added successfully!', 'success', 3000)`
- **How to test**: Add new admin keypair

### 8.7 Add Admin Keypair - Failure
- **Location**: Add admin keypair (lines ~10984, 10988)
- **Original**: `alert('Failed to add admin keypair: ...')`
- **Replaced with**: `await showAlert('Failed to add admin keypair: ...', 'Add Failed')`
- **How to test**: Attempt to add invalid keypair

### 8.8 Update Storage Status - Secret Key Required
- **Location**: Update storage status (line ~11004)
- **Original**: `alert('Secret key is required for full keypair storage. ...')`
- **Replaced with**: `await showAlert('Secret key is required for full keypair storage. ...', 'Storage Status')`
- **How to test**: Attempt to change storage status without providing secret key

### 8.9 Update Storage Status - Failure
- **Location**: Update storage status (lines ~11021, 11025)
- **Original**: `alert('Failed to update storage status: ...')`
- **Replaced with**: `await showAlert('Failed to update storage status: ...', 'Update Failed')`
- **How to test**: Simulate update failure

---

## 9. Trust Assignment Functions

### 9.1 Submit Trust Assignment - Profile Required
- **Location**: `submitTrustAssignmentForm()` function (line ~11205)
- **Original**: `alert('You must select a profile with a Nostr key to issue trust assignments.')`
- **Replaced with**: `await showAlert('You must select a profile with a Nostr key to issue trust assignments.', 'Selection Required')`
- **How to test**: Attempt to submit trust assignment without selecting profile

### 9.2 Submit Trust Assignment - Subject Required
- **Location**: `submitTrustAssignmentForm()` function (line ~11210)
- **Original**: `alert('Subject public key is required.')`
- **Replaced with**: `await showAlert('Subject public key is required.', 'Input Required')`
- **How to test**: Submit form without subject public key

### 9.3 Submit Trust Assignment - Level Required
- **Location**: `submitTrustAssignmentForm()` function (line ~11215)
- **Original**: `alert('Assigned trust level is required.')`
- **Replaced with**: `await showAlert('Assigned trust level is required.', 'Input Required')`
- **How to test**: Submit form without trust level

### 9.4 Submit Trust Assignment - Invalid Expiration
- **Location**: `submitTrustAssignmentForm()` function (line ~11231)
- **Original**: `alert('Expiration date is invalid.')`
- **Replaced with**: `await showAlert('Expiration date is invalid.', 'Validation Error')`
- **How to test**: Enter invalid expiration date

### 9.5 Submit Trust Assignment - Scope Error
- **Location**: `submitTrustAssignmentForm()` function (line ~11242)
- **Original**: `alert(error?.message || 'Invalid scope configuration.')`
- **Replaced with**: `await showAlert(error?.message || 'Invalid scope configuration.', 'Configuration Error')`
- **How to test**: Submit with invalid scope configuration

### 9.6 Submit Trust Assignment - Creation Error
- **Location**: `submitTrustAssignmentForm()` function (line ~11262)
- **Original**: `alert(error?.message || String(error))`
- **Replaced with**: `await showAlert(error?.message || String(error), 'Error')`
- **How to test**: Simulate creation failure

### 9.7 Delete Trust Assignment - Profile Required
- **Location**: `deleteTrustAssignment()` function (line ~11273)
- **Original**: `alert('You must select a profile with a Nostr key to revoke trust assignments.')`
- **Replaced with**: `await showAlert('You must select a profile with a Nostr key to revoke trust assignments.', 'Selection Required')`
- **How to test**: Attempt deletion without profile

### 9.8 Delete Trust Assignment - Confirmation
- **Location**: `deleteTrustAssignment()` function (line ~11279)
- **Original**: `window.confirm('Revoke this trust assignment?')`
- **Replaced with**: `await showConfirm('Revoke this trust assignment?', 'Revoke Trust Assignment')`
- **How to test**:
  - Select a trust assignment
  - Click delete/revoke
  - Verify confirmation dialog
  - Test both responses

### 9.9 Delete Trust Assignment - Error
- **Location**: `deleteTrustAssignment()` function (line ~11296)
- **Original**: `alert(error?.message || String(error))`
- **Replaced with**: `await showAlert(error?.message || String(error), 'Error')`
- **How to test**: Simulate deletion failure

---

## 10. Trust Declaration Functions

### 10.1 Load Trust Declaration - Failure
- **Location**: `loadSelectedTrustDeclaration()` function (line ~11745)
- **Original**: `alert('Failed to load trust declaration: ...')`
- **Replaced with**: `await showAlert('Failed to load trust declaration: ...', 'Load Failed')`
- **How to test**: Attempt to load corrupted declaration

### 10.2 Open Trust Declaration Details - Selection Required
- **Location**: `openTrustDeclarationDetailsModal()` function (line ~11791)
- **Original**: `alert('Please select a trust declaration first')`
- **Replaced with**: `await showAlert('Please select a trust declaration first', 'Selection Required')`
- **How to test**: Attempt to open details without selection

### 10.3 Finalize Declaration - Validation Failed
- **Location**: `finalizeAndReloadDeclaration()` function (line ~11860)
- **Original**: `alert('Validation failed. Please fix errors before finalizing.')`
- **Replaced with**: `await showAlert('Validation failed. Please fix errors before finalizing.', 'Validation Error')`
- **How to test**: Attempt to finalize invalid declaration

### 10.4 Finalize Declaration - Success
- **Location**: `finalizeAndReloadDeclaration()` function (line ~11874)
- **Original**: `alert('Declaration finalized successfully. All fields are now read-only.')`
- **Replaced with**: `showToastNotification('Declaration finalized successfully. All fields are now read-only.', 'success', 3000)`
- **How to test**: Successfully finalize a declaration

### 10.5 Finalize Declaration - Failure
- **Location**: `finalizeAndReloadDeclaration()` function (line ~11876)
- **Original**: `alert('Failed to finalize declaration: ...')`
- **Replaced with**: `await showAlert('Failed to finalize declaration: ...', 'Finalization Failed')`
- **How to test**: Simulate finalization failure

### 10.6 Sign Declaration - Cannot Sign
- **Location**: `signDeclaration()` function (line ~11927)
- **Original**: `alert('Cannot sign declaration: Issuer keypair not found or private key not available.')`
- **Replaced with**: `await showAlert('Cannot sign declaration: Issuer keypair not found or private key not available.', 'Signing Error')`
- **How to test**: Attempt to sign without issuer keypair

### 10.7 Sign Declaration - No Issuer Keypair
- **Location**: `signDeclaration()` function (line ~11934)
- **Original**: `alert('Declaration has no issuer keypair specified.')`
- **Replaced with**: `await showAlert('Declaration has no issuer keypair specified.', 'Configuration Error')`
- **How to test**: Attempt to sign declaration without issuer keypair specified

### 10.8 Sign Declaration - Keypair Not Found
- **Location**: `signDeclaration()` function (line ~11951)
- **Original**: `alert('Issuer keypair not found. Please ensure the keypair exists and is accessible.')`
- **Replaced with**: `await showAlert('Issuer keypair not found. Please ensure the keypair exists and is accessible.', 'Keypair Not Found')`
- **How to test**: Attempt to sign with missing keypair

### 10.9 Sign Declaration - Success
- **Location**: `signDeclaration()` function (line ~11965)
- **Original**: `alert('Declaration signed successfully. Status changed to "Signed".')`
- **Replaced with**: `showToastNotification('Declaration signed successfully. Status changed to "Signed".', 'success', 3000)`
- **How to test**: Successfully sign a declaration

### 10.10 Sign Declaration - Failure
- **Location**: `signDeclaration()` function (line ~11967)
- **Original**: `alert('Failed to sign declaration: ...')`
- **Replaced with**: `await showAlert('Failed to sign declaration: ...', 'Signing Failed')`
- **How to test**: Simulate signing failure

### 10.11 Add Countersignature - Cannot Add
- **Location**: `addCountersignature()` function (line ~11981)
- **Original**: `alert('Cannot add countersignature: No keypair available or private key not available.')`
- **Replaced with**: `await showAlert('Cannot add countersignature: No keypair available or private key not available.', 'Countersignature Error')`
- **How to test**: Attempt to add countersignature without keypair

### 10.12 Add Countersignature - Not Implemented
- **Location**: `addCountersignature()` function (line ~11987)
- **Original**: `alert('Countersignature functionality will be implemented in a future update.')`
- **Replaced with**: `await showAlert('Countersignature functionality will be implemented in a future update.', 'Not Implemented')`
- **How to test**: Click "Add Countersignature" button

### 10.13 Save Trust Declaration Edits - Not Draft
- **Location**: `saveTrustDeclarationEdits()` function (line ~12071)
- **Original**: `alert('Only draft declarations can be edited')`
- **Replaced with**: `await showAlert('Only draft declarations can be edited', 'Edit Error')`
- **How to test**: Attempt to edit non-draft declaration

### 10.14 Save Trust Declaration Edits - Invalid JSON
- **Location**: `saveTrustDeclarationEdits()` function (line ~12081)
- **Original**: `alert('Invalid JSON in content: ...')`
- **Replaced with**: `await showAlert('Invalid JSON in content: ...', 'JSON Error')`
- **How to test**: Enter invalid JSON in content field

### 10.15 Save Trust Declaration Edits - Success
- **Location**: `saveTrustDeclarationEdits()` function (line ~12135)
- **Original**: `alert('Declaration updated successfully')`
- **Replaced with**: `showToastNotification('Declaration updated successfully', 'success', 3000)`
- **How to test**: Successfully save declaration edits

### 10.16 Save Trust Declaration Edits - Failure
- **Location**: `saveTrustDeclarationEdits()` function (line ~12139)
- **Original**: `alert('Failed to update declaration: ...')`
- **Replaced with**: `await showAlert('Failed to update declaration: ...', 'Update Failed')`
- **How to test**: Simulate update failure

### 10.17 Sign Trust Declaration - Not Implemented
- **Location**: `signTrustDeclaration()` function (line ~12260)
- **Original**: `alert('Signing trust declarations is not yet implemented')`
- **Replaced with**: `await showAlert('Signing trust declarations is not yet implemented', 'Not Implemented')`
- **How to test**: Click "Sign Trust Declaration" button

### 10.18 Publish Trust Declaration - Not Implemented
- **Location**: `publishTrustDeclaration()` function (line ~12270)
- **Original**: `alert('Publishing trust declarations is not yet implemented')`
- **Replaced with**: `await showAlert('Publishing trust declarations is not yet implemented', 'Not Implemented')`
- **How to test**: Click "Publish Trust Declaration" button

### 10.19 Export Trust Declaration - Not Implemented
- **Location**: `exportTrustDeclaration()` function (line ~12310)
- **Original**: `alert('Exporting trust declarations is not yet implemented')`
- **Replaced with**: `await showAlert('Exporting trust declarations is not yet implemented', 'Not Implemented')`
- **How to test**: Click "Export Trust Declaration" button

### 10.20 Export All Trust Declarations - Failure
- **Location**: `exportAllTrustDeclarations()` function (line ~12324)
- **Original**: `alert('Failed to export trust declarations: ...')`
- **Replaced with**: `await showAlert('Failed to export trust declarations: ...', 'Export Failed')`
- **How to test**: Simulate export failure

### 10.21 Export All Trust Declarations - Success
- **Location**: `exportAllTrustDeclarations()` function (line ~12327)
- **Original**: `alert('Exported X admin declarations and Y legacy trust declarations...')`
- **Replaced with**: `showToastNotification('Exported X admin declarations and Y legacy trust declarations...', 'success', 4000)`
- **How to test**: Successfully export all trust declarations

### 10.22 Import Trust Declarations - Failure
- **Location**: `importTrustDeclarations()` function (line ~12345)
- **Original**: `alert('Failed to import trust declarations: ...')`
- **Replaced with**: `await showAlert('Failed to import trust declarations: ...', 'Import Failed')`
- **How to test**: Attempt to import invalid file

### 10.23 Import Trust Declarations - Success
- **Location**: `importTrustDeclarations()` function (line ~12348)
- **Original**: `alert('Imported X admin declarations and Y legacy trust declarations...')`
- **Replaced with**: `showToastNotification('Imported X admin declarations and Y legacy trust declarations...', 'success', 4000)`
- **How to test**: Successfully import trust declarations

### 10.24 Export Admin Keys - Failure
- **Location**: `exportAllAdminPublicKeys()` function (line ~12379)
- **Original**: `alert('Failed to export admin keys: ...')`
- **Replaced with**: `await showAlert('Failed to export admin keys: ...', 'Export Failed')`
- **How to test**: Simulate export failure

### 10.25 Export Admin Keys - Success
- **Location**: `exportAllAdminPublicKeys()` function (line ~12382)
- **Original**: `alert('Exported X master keys, Y admin keypairs...')`
- **Replaced with**: `showToastNotification('Exported X master keys, Y admin keypairs...', 'success', 4000)`
- **How to test**: Successfully export admin keys

### 10.26 Import Admin Keys - Failure
- **Location**: `importAllAdminPublicKeys()` function (line ~12400)
- **Original**: `alert('Failed to import admin keys: ...')`
- **Replaced with**: `await showAlert('Failed to import admin keys: ...', 'Import Failed')`
- **How to test**: Attempt to import invalid file

### 10.27 Import Admin Keys - Success
- **Location**: `importAllAdminPublicKeys()` function (line ~12403)
- **Original**: `alert('Imported X master keys, Y admin keypairs...')`
- **Replaced with**: `showToastNotification('Imported X master keys, Y admin keypairs...', 'success', 4000)`
- **How to test**: Successfully import admin keys

### 10.28 View Trust Summary - Selection Required
- **Location**: Trust summary function (line ~12362)
- **Original**: `alert('Select a profile with an active Nostr key to view trust summary.')`
- **Replaced with**: `await showAlert('Select a profile with an active Nostr key to view trust summary.', 'Selection Required')`
- **How to test**: Attempt to view trust summary without profile

### 10.29 Delete Trust Declaration - Selection Required
- **Location**: `deleteTrustDeclaration()` function (line ~12417)
- **Original**: `alert('Please select a trust declaration first')`
- **Replaced with**: `await showAlert('Please select a trust declaration first', 'Selection Required')`
- **How to test**: Attempt deletion without selection

### 10.30 Delete Trust Declaration - Confirmation
- **Location**: `deleteTrustDeclaration()` function (line ~12421)
- **Original**: `confirm('Are you sure you want to delete this trust declaration? ...')`
- **Replaced with**: `await showConfirm('Are you sure you want to delete this trust declaration? ...', 'Delete Trust Declaration')`
- **How to test**:
  - Select a trust declaration
  - Click delete
  - Verify confirmation dialog
  - Test both responses

### 10.31 Delete Trust Declaration - Success
- **Location**: `deleteTrustDeclaration()` function (line ~12433)
- **Original**: `alert('Trust declaration deleted successfully')`
- **Replaced with**: `showToastNotification('Trust declaration deleted successfully', 'success', 3000)`
- **How to test**: Successfully delete a trust declaration

### 10.32 Delete Trust Declaration - Failure
- **Location**: `deleteTrustDeclaration()` function (line ~12435)
- **Original**: `alert('Failed to delete trust declaration: ...')`
- **Replaced with**: `await showAlert('Failed to delete trust declaration: ...', 'Delete Failed')`
- **How to test**: Simulate deletion failure

### 10.33 Cancel Trust Declaration Wizard - Confirmation
- **Location**: `cancelTrustDeclarationWizard()` function (line ~13387)
- **Original**: `confirm('Are you sure you want to cancel? Any unsaved changes will be lost.')`
- **Replaced with**: `await showConfirm('Are you sure you want to cancel? Any unsaved changes will be lost.', 'Cancel Wizard')`
- **How to test**:
  - Start creating a trust declaration
  - Make some changes
  - Click cancel
  - Verify confirmation dialog
  - Test both responses

### 10.34 Save Draft Trust Declaration - Validation Error
- **Location**: `saveDraftTrustDeclaration()` function (line ~13406)
- **Original**: `alert('Please fix validation errors before saving draft')`
- **Replaced with**: `await showAlert('Please fix validation errors before saving draft', 'Validation Error')`
- **How to test**: Attempt to save draft with validation errors

### 10.35 Save Draft Trust Declaration - Invalid JSON
- **Location**: `saveDraftTrustDeclaration()` function (line ~13412)
- **Original**: `alert('Invalid JSON: ...')`
- **Replaced with**: `await showAlert('Invalid JSON: ...', 'JSON Error')`
- **How to test**: Enter invalid JSON in advanced mode

### 10.36 Save Draft Trust Declaration - JSON Generation Error
- **Location**: `saveDraftTrustDeclaration()` function (line ~13422)
- **Original**: `alert('Error generating JSON from form: ...')`
- **Replaced with**: `await showAlert('Error generating JSON from form: ...', 'JSON Generation Error')`
- **How to test**: Trigger JSON generation error

### 10.37 Save Draft Trust Declaration - Save Failure
- **Location**: `saveDraftTrustDeclaration()` function (line ~13465)
- **Original**: `alert('Failed to save draft: ...')`
- **Replaced with**: `await showAlert('Failed to save draft: ...', 'Save Failed')`
- **How to test**: Simulate draft save failure

### 10.38 Finalize Trust Declaration - Validation Error (First Check)
- **Location**: `finalizeTrustDeclaration()` function (line ~13493)
- **Original**: `alert('Please fix validation errors before finalizing')`
- **Replaced with**: `await showAlert('Please fix validation errors before finalizing', 'Validation Error')`
- **How to test**: Attempt to finalize declaration with validation errors

### 10.39 Finalize Trust Declaration - Validation Error (Advanced Mode)
- **Location**: `finalizeTrustDeclaration()` function (line ~13501)
- **Original**: `alert('Please fix validation errors before finalizing')`
- **Replaced with**: `await showAlert('Please fix validation errors before finalizing', 'Validation Error')`
- **How to test**: Attempt to finalize in advanced mode with JSON validation errors

### 10.40 Finalize Trust Declaration - Save Failed
- **Location**: `finalizeTrustDeclaration()` function (line ~13511)
- **Original**: `alert('Failed to save declaration. Please try again.')`
- **Replaced with**: `await showAlert('Failed to save declaration. Please try again.', 'Save Failed')`
- **How to test**: Simulate save failure during finalization

### 10.41 Finalize Trust Declaration - Success
- **Location**: `finalizeTrustDeclaration()` function (line ~13525)
- **Original**: `alert('Declaration finalized. You can now sign and save it.')`
- **Replaced with**: `showToastNotification('Declaration finalized. You can now sign and save it.', 'success', 3000)`
- **How to test**: Successfully finalize a declaration

### 10.42 Finalize Trust Declaration - Failure
- **Location**: `finalizeTrustDeclaration()` function (line ~13527)
- **Original**: `alert('Failed to finalize declaration: ...')`
- **Replaced with**: `await showAlert('Failed to finalize declaration: ...', 'Finalization Failed')`
- **How to test**: Simulate finalization failure

### 10.43 Save Trust Declaration - Not Finalized
- **Location**: `saveTrustDeclaration()` function (line ~13541)
- **Original**: `alert('Please finalize the declaration before saving')`
- **Replaced with**: `await showAlert('Please finalize the declaration before saving', 'Save Error')`
- **How to test**: Attempt to save declaration that hasn't been finalized

### 10.44 Save Trust Declaration - Invalid JSON
- **Location**: `saveTrustDeclaration()` function (line ~13552)
- **Original**: `alert('Invalid JSON: ...')`
- **Replaced with**: `await showAlert('Invalid JSON: ...', 'JSON Error')`
- **How to test**: Enter invalid JSON in advanced mode before saving

### 10.45 Save Trust Declaration - JSON Generation Error
- **Location**: `saveTrustDeclaration()` function (line ~13561)
- **Original**: `alert('Error generating JSON from form: ...')`
- **Replaced with**: `await showAlert('Error generating JSON from form: ...', 'JSON Generation Error')`
- **How to test**: Trigger JSON generation error during save

### 10.46 Save Trust Declaration - Success
- **Location**: `saveTrustDeclaration()` function (line ~13596)
- **Original**: `alert('Declaration saved successfully')`
- **Replaced with**: `showToastNotification('Declaration saved successfully', 'success', 3000)`
- **How to test**: Successfully save a finalized declaration

### 10.47 Save Trust Declaration - Failure
- **Location**: `saveTrustDeclaration()` function (line ~13608)
- **Original**: `alert('Failed to save declaration: ...')`
- **Replaced with**: `await showAlert('Failed to save declaration: ...', 'Save Failed')`
- **How to test**: Simulate save failure

---

## 11. Encryption Key Management Functions

### 11.1 Load Encryption Key - Failure
- **Location**: `loadSelectedEncryptionKey()` function (line ~13722)
- **Original**: `alert('Failed to load encryption key: ...')`
- **Replaced with**: `await showAlert('Failed to load encryption key: ...', 'Load Failed')`
- **How to test**: Attempt to load corrupted or missing encryption key

### 11.2 Open Encryption Key Details - Selection Required
- **Location**: `openEncryptionKeyDetailsModal()` function (line ~13745)
- **Original**: `alert('Please select an encryption key first')`
- **Replaced with**: `await showAlert('Please select an encryption key first', 'Selection Required')`
- **How to test**: Attempt to open details modal without selecting a key

### 11.3 Generate Encryption Key - Invalid Selection Identifier
- **Location**: `generateEncryptionKey()` function (line ~13772)
- **Original**: `alert('Selection Identifier must be valid JSON')`
- **Replaced with**: `await showAlert('Selection Identifier must be valid JSON', 'Validation Error')`
- **How to test**: Enter invalid JSON in Selection Identifier field when generating key

### 11.4 Generate Encryption Key - Success
- **Location**: `generateEncryptionKey()` function (line ~13811)
- **Original**: `alert('Encryption key generated successfully!')`
- **Replaced with**: `showToastNotification('Encryption key generated successfully!', 'success', 3000)`
- **How to test**: Successfully generate a new encryption key

### 11.5 Generate Encryption Key - Failure
- **Location**: `generateEncryptionKey()` function (line ~13815)
- **Original**: `alert('Failed to generate encryption key: ...')`
- **Replaced with**: `await showAlert('Failed to generate encryption key: ...', 'Generation Failed')`
- **How to test**: Simulate key generation failure

### 11.6 Save Encryption Key Metadata - Success
- **Location**: `saveEncryptionKeyMetadata()` function (line ~13846)
- **Original**: `alert('Metadata saved successfully')`
- **Replaced with**: `showToastNotification('Metadata saved successfully', 'success', 2000)`
- **How to test**: Successfully save encryption key metadata changes

### 11.7 Save Encryption Key Metadata - Failure
- **Location**: `saveEncryptionKeyMetadata()` function (line ~13848)
- **Original**: `alert('Failed to save metadata: ...')`
- **Replaced with**: `await showAlert('Failed to save metadata: ...', 'Save Failed')`
- **How to test**: Simulate metadata save failure

### 11.8 Export Encryption Key - Selection Required
- **Location**: `exportEncryptionKey()` function (line ~13858)
- **Original**: `alert('Please select an encryption key first')`
- **Replaced with**: `await showAlert('Please select an encryption key first', 'Selection Required')`
- **How to test**: Attempt to export without selecting a key

### 11.9 Export Encryption Key - Password Mismatch
- **Location**: `exportEncryptionKey()` function (line ~13869)
- **Original**: `alert('Passwords do not match')`
- **Replaced with**: `await showAlert('Passwords do not match', 'Validation Error')`
- **How to test**: Enter mismatched passwords when exporting key

### 11.10 Export Encryption Key - Success
- **Location**: `exportEncryptionKey()` function (line ~13880)
- **Original**: `alert('Encryption key exported successfully!')`
- **Replaced with**: `showToastNotification('Encryption key exported successfully!', 'success', 3000)`
- **How to test**: Successfully export an encryption key

### 11.11 Export Encryption Key - Failure
- **Location**: `exportEncryptionKey()` function (line ~13882)
- **Original**: `alert('Failed to export encryption key: ...')`
- **Replaced with**: `await showAlert('Failed to export encryption key: ...', 'Export Failed')`
- **How to test**: Simulate export failure

### 11.12 Import Encryption Key - File Read Error
- **Location**: `importEncryptionKeyBackup()` function (line ~13917)
- **Original**: `alert('Failed to read file: ...')`
- **Replaced with**: `await showAlert('Failed to read file: ...', 'File Read Error')`
- **How to test**: Attempt to import from unreadable file

### 11.13 Import Encryption Key - Profile Guard Confirmation
- **Location**: `importEncryptionKeyBackup()` function (line ~13928)
- **Original**: `confirm('Encrypt this key with Profile Guard? (Recommended for Group and Individual keys)')`
- **Replaced with**: `await showConfirm('Encrypt this key with Profile Guard? (Recommended for Group and Individual keys)', 'Encrypt with Profile Guard')`
- **How to test**:
  - Import an encryption key backup
  - Verify confirmation dialog appears asking about Profile Guard encryption
  - Test both "Yes" and "No" responses

### 11.14 Import Encryption Key - Success
- **Location**: `importEncryptionKeyBackup()` function (line ~13940)
- **Original**: `alert('Encryption key imported successfully!')`
- **Replaced with**: `showToastNotification('Encryption key imported successfully!', 'success', 3000)`
- **How to test**: Successfully import an encryption key backup

### 11.15 Import Encryption Key - Failure
- **Location**: `importEncryptionKeyBackup()` function (line ~13944)
- **Original**: `alert('Failed to import encryption key: ...')`
- **Replaced with**: `await showAlert('Failed to import encryption key: ...', 'Import Failed')`
- **How to test**: Attempt to import invalid or corrupted backup file

### 11.16 Delete Encryption Key - Selection Required
- **Location**: `deleteSelectedEncryptionKey()` function (line ~13954)
- **Original**: `alert('Please select an encryption key first')`
- **Replaced with**: `await showAlert('Please select an encryption key first', 'Selection Required')`
- **How to test**: Attempt to delete without selecting a key

### 11.17 Delete Encryption Key - Confirmation
- **Location**: `deleteSelectedEncryptionKey()` function (line ~13958)
- **Original**: `confirm('Are you sure you want to delete this encryption key? This action cannot be undone.')`
- **Replaced with**: `await showConfirm('Are you sure you want to delete this encryption key? This action cannot be undone.', 'Delete Encryption Key')`
- **How to test**:
  - Select an encryption key
  - Click delete
  - Verify confirmation dialog appears
  - Test both responses

### 11.18 Delete Encryption Key - Success
- **Location**: `deleteSelectedEncryptionKey()` function (line ~13970)
- **Original**: `alert('Encryption key deleted successfully')`
- **Replaced with**: `showToastNotification('Encryption key deleted successfully', 'success', 3000)`
- **How to test**: Successfully delete an encryption key

### 11.19 Delete Encryption Key - Failure
- **Location**: `deleteSelectedEncryptionKey()` function (line ~13972)
- **Original**: `alert('Failed to delete encryption key: ...')`
- **Replaced with**: `await showAlert('Failed to delete encryption key: ...', 'Delete Failed')`
- **How to test**: Simulate deletion failure

---

## 12. User Op Keypair Management Functions

### 12.1 Load User Op Keypair - Failure
- **Location**: `loadSelectedUserOpKeypair()` function (line ~14021)
- **Original**: `alert('Failed to load User Op keypair: ...')`
- **Replaced with**: `await showAlert('Failed to load User Op keypair: ...', 'Load Failed')`
- **How to test**: Attempt to load corrupted or missing User Op keypair

### 12.2 Open User Op Keypair Details - Selection Required
- **Location**: `openUserOpKeypairDetailsModal()` function (line ~14033)
- **Original**: `alert('Please select a User Op keypair first')`
- **Replaced with**: `await showAlert('Please select a User Op keypair first', 'Selection Required')`
- **How to test**: Attempt to open details modal without selecting a keypair

### 12.3 Generate User Op Keypair - Profile Required
- **Location**: `generateUserOpKeypair()` function (line ~14046)
- **Original**: `alert('Please select a profile first')`
- **Replaced with**: `await showAlert('Please select a profile first', 'Selection Required')`
- **How to test**: Attempt to generate keypair without selecting a profile

### 12.4 Generate User Op Keypair - Success
- **Location**: `generateUserOpKeypair()` function (line ~14067)
- **Original**: `alert('User Op keypair generated successfully!')`
- **Replaced with**: `showToastNotification('User Op keypair generated successfully!', 'success', 3000)`
- **How to test**: Successfully generate a new User Op keypair

### 12.5 Generate User Op Keypair - Failure
- **Location**: `generateUserOpKeypair()` function (line ~14071)
- **Original**: `alert('Failed to generate User Op keypair: ...')`
- **Replaced with**: `await showAlert('Failed to generate User Op keypair: ...', 'Generation Failed')`
- **How to test**: Simulate keypair generation failure

### 12.6 Add User Op Keypair - Profile Required
- **Location**: `addUserOpKeypair()` function (line ~14081)
- **Original**: `alert('Please select a profile first')`
- **Replaced with**: `await showAlert('Please select a profile first', 'Selection Required')`
- **How to test**: Attempt to add keypair without selecting a profile

### 12.7 Add User Op Keypair - Public Key Required
- **Location**: `addUserOpKeypair()` function (line ~14087)
- **Original**: `alert('Please provide a public key or use Generate new Keypair')`
- **Replaced with**: `await showAlert('Please provide a public key or use Generate new Keypair', 'Input Required')`
- **How to test**: Attempt to add keypair without providing public key

### 12.8 Add User Op Keypair - Success
- **Location**: `addUserOpKeypair()` function (line ~14121)
- **Original**: `alert('User Op keypair added successfully!')`
- **Replaced with**: `showToastNotification('User Op keypair added successfully!', 'success', 3000)`
- **How to test**: Successfully add a User Op keypair

### 12.9 Add User Op Keypair - Failure
- **Location**: `addUserOpKeypair()` function (line ~14125)
- **Original**: `alert('Failed to add User Op keypair: ...')`
- **Replaced with**: `await showAlert('Failed to add User Op keypair: ...', 'Add Failed')`
- **How to test**: Attempt to add invalid keypair

### 12.10 Backup User Op Keypair - Password Mismatch
- **Location**: `backupSelectedUserOpKeypair()` function (line ~14145)
- **Original**: `alert('Passwords do not match')`
- **Replaced with**: `await showAlert('Passwords do not match', 'Validation Error')`
- **How to test**: Enter mismatched passwords when backing up keypair

### 12.11 Backup User Op Keypair - Success
- **Location**: `backupSelectedUserOpKeypair()` function (line ~14152)
- **Original**: `alert('User Op keypair backup exported successfully')`
- **Replaced with**: `showToastNotification('User Op keypair backup exported successfully', 'success', 3000)`
- **How to test**: Successfully export User Op keypair backup

### 12.12 Backup User Op Keypair - Failure
- **Location**: `backupSelectedUserOpKeypair()` function (line ~14154)
- **Original**: `alert('Failed to export backup: ...')`
- **Replaced with**: `await showAlert('Failed to export backup: ...', 'Export Failed')`
- **How to test**: Simulate backup export failure

### 12.13 Import User Op Keypair - Profile Required
- **Location**: `importUserOpKeypairBackup()` function (line ~14164)
- **Original**: `alert('Please select a profile first')`
- **Replaced with**: `await showAlert('Please select a profile first', 'Selection Required')`
- **How to test**: Attempt to import keypair backup without selecting a profile

### 12.14 Import User Op Keypair - Success
- **Location**: `importUserOpKeypairBackup()` function (line ~14189)
- **Original**: `alert('User Op keypair imported successfully')`
- **Replaced with**: `showToastNotification('User Op keypair imported successfully', 'success', 3000)`
- **How to test**: Successfully import User Op keypair backup

### 12.15 Import User Op Keypair - Failure
- **Location**: `importUserOpKeypairBackup()` function (line ~14191)
- **Original**: `alert('Failed to import backup: ...')`
- **Replaced with**: `await showAlert('Failed to import backup: ...', 'Import Failed')`
- **How to test**: Attempt to import invalid or corrupted backup file

### 12.16 Delete User Op Keypair - Confirmation
- **Location**: `deleteSelectedUserOpKeypair()` function (line ~14204)
- **Original**: `confirm('Are you sure you want to delete this User Op keypair? This action cannot be undone.')`
- **Replaced with**: `await showConfirm('Are you sure you want to delete this User Op keypair? This action cannot be undone.', 'Delete User Op Keypair')`
- **How to test**:
  - Select a User Op keypair
  - Click delete
  - Verify confirmation dialog appears
  - Test both responses

### 12.17 Delete User Op Keypair - Success
- **Location**: `deleteSelectedUserOpKeypair()` function (line ~14214)
- **Original**: Success message (implicit, now explicit)
- **Replaced with**: `showToastNotification('User Op keypair deleted successfully', 'success', 3000)`
- **How to test**: Successfully delete a User Op keypair

### 12.18 Delete User Op Keypair - Failure
- **Location**: `deleteSelectedUserOpKeypair()` function (line ~14214)
- **Original**: `alert('Failed to delete User Op keypair: ...')`
- **Replaced with**: `await showAlert('Failed to delete User Op keypair: ...', 'Delete Failed')`
- **How to test**: Simulate deletion failure

---

## 13. Nostr Publishing Functions

### 13.1 Open Publish Keypair Modal - Selection Required
- **Location**: `openPublishKeypairModal()` function (line ~14281)
- **Original**: `alert('Please select a keypair first.')`
- **Replaced with**: `await showAlert('Please select a keypair first.', 'Selection Required')`
- **How to test**: Attempt to open publish modal without selecting a keypair

### 13.2 Load Nostr Signing Keypairs - Failure
- **Location**: `loadAvailableNostrSigningKeypairs()` function (line ~14309)
- **Original**: `alert('Failed to load Nostr signing keypairs: ...')`
- **Replaced with**: `await showAlert('Failed to load Nostr signing keypairs: ...', 'Load Failed')`
- **How to test**: Simulate failure loading Nostr signing keypairs

### 13.3 Generate Event Preview - Failure
- **Location**: `generateEventPreview()` function (line ~14335)
- **Original**: `alert('Failed to generate event preview: ...')`
- **Replaced with**: `await showAlert('Failed to generate event preview: ...', 'Preview Generation Failed')`
- **How to test**: Simulate event preview generation failure

### 13.4 Confirm Publish Keypair - Selection Required
- **Location**: `confirmPublishKeypair()` function (line ~14347)
- **Original**: `alert('Please select a Nostr signing keypair and generate an event preview first.')`
- **Replaced with**: `await showAlert('Please select a Nostr signing keypair and generate an event preview first.', 'Selection Required')`
- **How to test**: Attempt to publish without selecting keypair or generating preview

### 13.5 Confirm Publish Keypair - Confirmation
- **Location**: `confirmPublishKeypair()` function (line ~14351)
- **Original**: `confirm('Are you sure you want to publish this keypair to Nostr? ...')`
- **Replaced with**: `await showConfirm('Are you sure you want to publish this keypair to Nostr? ...', 'Publish Keypair to Nostr')`
- **How to test**:
  - Select keypair and generate preview
  - Click publish
  - Verify confirmation dialog appears
  - Test both responses

### 13.6 Publish Keypair - Success
- **Location**: `confirmPublishKeypair()` function (line ~14364)
- **Original**: `alert('Keypair published successfully! The event has been added to the outgoing cache.')`
- **Replaced with**: `showToastNotification('Keypair published successfully! The event has been added to the outgoing cache.', 'success', 3000)`
- **How to test**: Successfully publish a keypair to Nostr

### 13.7 Publish Keypair - Failure
- **Location**: `confirmPublishKeypair()` function (line ~14376)
- **Original**: `alert('Failed to publish keypair: ...')`
- **Replaced with**: `await showAlert('Failed to publish keypair: ...', 'Publish Failed')`
- **How to test**: Simulate publishing failure

---

## 14. Admin Keypair Backup/Import/Delete Functions

### 14.1 Backup Admin Keypair - Password Mismatch
- **Location**: `backupSelectedAdminKeypair()` function (line ~14397)
- **Original**: `alert('Passwords do not match')`
- **Replaced with**: `await showAlert('Passwords do not match', 'Validation Error')`
- **How to test**: Enter mismatched passwords when backing up admin keypair

### 14.2 Backup Admin Keypair - Success
- **Location**: `backupSelectedAdminKeypair()` function (line ~14409)
- **Original**: `alert('Admin keypair backup exported successfully')`
- **Replaced with**: `showToastNotification('Admin keypair backup exported successfully', 'success', 3000)`
- **How to test**: Successfully export admin keypair backup

### 14.3 Backup Admin Keypair - Failure
- **Location**: `backupSelectedAdminKeypair()` function (line ~14411)
- **Original**: `alert('Failed to export backup: ...')`
- **Replaced with**: `await showAlert('Failed to export backup: ...', 'Export Failed')`
- **How to test**: Simulate backup export failure

### 14.4 Import Admin Keypair - Success
- **Location**: `importAdminKeypairBackup()` function (line ~14466)
- **Original**: `alert('Admin keypair imported successfully')`
- **Replaced with**: `showToastNotification('Admin keypair imported successfully', 'success', 3000)`
- **How to test**: Successfully import admin keypair backup

### 14.5 Import Admin Keypair - Add Failed
- **Location**: `importAdminKeypairBackup()` function (line ~14468)
- **Original**: `alert('Failed to add imported keypair: ...')`
- **Replaced with**: `await showAlert('Failed to add imported keypair: ...', 'Add Failed')`
- **How to test**: Simulate failure adding imported keypair to database

### 14.6 Import Admin Keypair - Import Failed
- **Location**: `importAdminKeypairBackup()` function (line ~14471)
- **Original**: `alert('Failed to import backup: ...')`
- **Replaced with**: `await showAlert('Failed to import backup: ...', 'Import Failed')`
- **How to test**: Attempt to import invalid or corrupted backup file

### 14.7 Delete Admin Keypair - Confirmation
- **Location**: `deleteSelectedAdminKeypair()` function (line ~14484)
- **Original**: `confirm('Are you sure you want to delete this admin keypair? This action cannot be undone.')`
- **Replaced with**: `await showConfirm('Are you sure you want to delete this admin keypair? This action cannot be undone.', 'Delete Admin Keypair')`
- **How to test**:
  - Select an admin keypair
  - Click delete
  - Verify confirmation dialog appears
  - Test both responses

### 14.8 Delete Admin Keypair - Success
- **Location**: `deleteSelectedAdminKeypair()` function (line ~14496)
- **Original**: `alert('Admin keypair deleted successfully')`
- **Replaced with**: `showToastNotification('Admin keypair deleted successfully', 'success', 3000)`
- **How to test**: Successfully delete an admin keypair

### 14.9 Delete Admin Keypair - Failure
- **Location**: `deleteSelectedAdminKeypair()` function (line ~14498)
- **Original**: `alert('Failed to delete admin keypair: ...')`
- **Replaced with**: `await showAlert('Failed to delete admin keypair: ...', 'Delete Failed')`
- **How to test**: Simulate deletion failure

---

## 15. Admin Keypair Metadata and Secret Key Management

### 15.1 Save Admin Keypair Metadata - Selection Required
- **Location**: `saveAdminKeypairMetadata()` function (line ~14515)
- **Original**: `alert('No keypair selected')`
- **Replaced with**: `await showAlert('No keypair selected', 'Selection Required')`
- **How to test**: Attempt to save metadata without selecting a keypair

### 15.2 Save Admin Keypair Metadata - Success
- **Location**: `saveAdminKeypairMetadata()` function (line ~14535)
- **Original**: `alert('Metadata saved successfully')`
- **Replaced with**: `showToastNotification('Metadata saved successfully', 'success', 2000)`
- **How to test**: Successfully save admin keypair metadata

### 15.3 Save Admin Keypair Metadata - Failure
- **Location**: `saveAdminKeypairMetadata()` function (line ~14537)
- **Original**: `alert('Failed to save metadata: ...')`
- **Replaced with**: `await showAlert('Failed to save metadata: ...', 'Save Failed')`
- **How to test**: Simulate metadata save failure

### 15.4 Export Secret Key - Password Mismatch
- **Location**: `exportAdminKeypairSecretPKCS()` function (line ~14557)
- **Original**: `alert('Passwords do not match')`
- **Replaced with**: `await showAlert('Passwords do not match', 'Validation Error')`
- **How to test**: Enter mismatched passwords when exporting secret key

### 15.5 Export Secret Key - Success
- **Location**: `exportAdminKeypairSecretPKCS()` function (line ~14568)
- **Original**: `alert('Secret key exported successfully to: ...')`
- **Replaced with**: `showToastNotification('Secret key exported successfully to: ...', 'success', 3000)`
- **How to test**: Successfully export secret key

### 15.6 Export Secret Key - Failure
- **Location**: `exportAdminKeypairSecretPKCS()` function (line ~14571)
- **Original**: `alert('Failed to export secret key: ...')`
- **Replaced with**: `await showAlert('Failed to export secret key: ...', 'Export Failed')`
- **How to test**: Simulate secret key export failure

### 15.7 Import Secret Key - Success
- **Location**: `importAdminKeypairSecretPKCS()` function (line ~14609)
- **Original**: `alert('Secret key imported successfully')`
- **Replaced with**: `showToastNotification('Secret key imported successfully', 'success', 3000)`
- **How to test**: Successfully import secret key

### 15.8 Import Secret Key - Failure
- **Location**: `importAdminKeypairSecretPKCS()` function (line ~14613)
- **Original**: `alert('Failed to import secret key: ...')`
- **Replaced with**: `await showAlert('Failed to import secret key: ...', 'Import Failed')`
- **How to test**: Attempt to import invalid or corrupted secret key file

### 15.9 Remove Secret Key - Confirmation
- **Location**: `removeAdminKeypairSecret()` function (line ~14626)
- **Original**: `confirm('Are you sure you want to remove the secret key? This action cannot be undone.')`
- **Replaced with**: `await showConfirm('Are you sure you want to remove the secret key? This action cannot be undone.', 'Remove Secret Key')`
- **How to test**:
  - Select an admin keypair with a secret key
  - Click remove secret key
  - Verify confirmation dialog appears
  - Test both responses

### 15.10 Remove Secret Key - Success
- **Location**: `removeAdminKeypairSecret()` function (line ~14634)
- **Original**: `alert('Secret key removed successfully')`
- **Replaced with**: `showToastNotification('Secret key removed successfully', 'success', 3000)`
- **How to test**: Successfully remove secret key from keypair

### 15.11 Remove Secret Key - Failure
- **Location**: `removeAdminKeypairSecret()` function (line ~14638)
- **Original**: `alert('Failed to remove secret key: ...')`
- **Replaced with**: `await showAlert('Failed to remove secret key: ...', 'Remove Failed')`
- **How to test**: Simulate removal failure

---

## 16. Profile Guard Functions

### 16.1 Setup Profile Guard - Electron Required
- **Location**: `confirmSetupProfileGuard()` function (line ~14829)
- **Original**: `alert('Profile Guard setup requires Electron environment')`
- **Replaced with**: `await showAlert('Profile Guard setup requires Electron environment', 'Error')`
- **How to test**: Attempt to setup Profile Guard outside Electron environment

### 16.2 Setup Profile Guard - Password Mismatch
- **Location**: `confirmSetupProfileGuard()` function (line ~14834)
- **Original**: `alert('Passwords do not match')`
- **Replaced with**: `await showAlert('Passwords do not match', 'Validation Error')`
- **How to test**: Enter mismatched passwords when setting up Profile Guard

### 16.3 Setup Profile Guard - Password Too Short
- **Location**: `confirmSetupProfileGuard()` function (line ~14839)
- **Original**: `alert('Password must be at least 8 characters long')`
- **Replaced with**: `await showAlert('Password must be at least 8 characters long', 'Validation Error')`
- **How to test**: Enter password shorter than 8 characters

### 16.4 Setup Profile Guard - Failure
- **Location**: `confirmSetupProfileGuard()` function (line ~14865)
- **Original**: `alert('Failed to set up Profile Guard: ...')`
- **Replaced with**: `await showAlert('Failed to set up Profile Guard: ...', 'Setup Failed')`
- **How to test**: Simulate Profile Guard setup failure

### 16.5 Update Security Mode - Failure
- **Location**: `updateProfileGuardSecurityMode()` function (line ~14903)
- **Original**: `alert('Failed to update security mode: ...')`
- **Replaced with**: `await showAlert('Failed to update security mode: ...', 'Update Failed')`
- **How to test**: Simulate security mode update failure

### 16.6 Delete Profile Guard Secrets - Confirmation
- **Location**: `deleteProfileGuardSecrets()` function (line ~14983)
- **Original**: `confirm('Are you absolutely sure? This will permanently delete:\n\n- Profile Guard keys\n- All encrypted secret keys\n- All protected keypairs\n\nThis action cannot be undone.')`
- **Replaced with**: `await showConfirm('Are you absolutely sure? This will permanently delete:\n\n- Profile Guard keys\n- All encrypted secret keys\n- All protected keypairs\n\nThis action cannot be undone.', 'Delete Profile Guard')`
- **How to test**:
  - Attempt to delete Profile Guard (e.g., via "Forgot Password" flow)
  - Verify confirmation dialog appears with warning
  - Test both responses

### 16.7 Delete Profile Guard Secrets - Success
- **Location**: `deleteProfileGuardSecrets()` function (line ~15004)
- **Original**: `alert('Profile Guard and all protected secrets have been deleted. You can now continue using the application.')`
- **Replaced with**: `await showAlert('Profile Guard and all protected secrets have been deleted. You can now continue using the application.', 'Profile Guard Deleted')`
- **How to test**: Successfully delete Profile Guard and all secrets

### 16.8 Delete Profile Guard Secrets - Failure
- **Location**: `deleteProfileGuardSecrets()` function (line ~15006)
- **Original**: `alert('Failed to delete secrets: ...')`
- **Replaced with**: `await showAlert('Failed to delete secrets: ...', 'Delete Failed')`
- **How to test**: Simulate deletion failure

### 16.9 Change Profile Guard Key - Confirmation
- **Location**: `changeProfileGuardKey()` function (line ~15017)
- **Original**: `confirm('Changing the Profile Guard key will require re-encrypting all your secret keys. Continue?')`
- **Replaced with**: `await showConfirm('Changing the Profile Guard key will require re-encrypting all your secret keys. Continue?', 'Change Profile Guard Key')`
- **How to test**:
  - Click "Change Master Password" or similar
  - Verify confirmation dialog appears
  - Test both responses

### 16.10 Remove Profile Guard - Confirmation
- **Location**: `removeProfileGuard()` function (line ~15029)
- **Original**: `confirm('Removing Profile Guard will decrypt all your secret keys. This is irreversible. Continue?')`
- **Replaced with**: `await showConfirm('Removing Profile Guard will decrypt all your secret keys. This is irreversible. Continue?', 'Remove Profile Guard')`
- **How to test**:
  - Attempt to remove Profile Guard
  - Verify confirmation dialog appears with warning
  - Test both responses

### 16.11 Remove Profile Guard - Failure
- **Location**: `removeProfileGuard()` function (line ~15042)
- **Original**: `alert('Failed to remove Profile Guard: ...')`
- **Replaced with**: `await showAlert('Failed to remove Profile Guard: ...', 'Remove Failed')`
- **How to test**: Simulate removal failure

---

## 17. Profile and Keypair Export/Import Functions

### 17.1 Export Profile - Password Mismatch
- **Location**: `confirmExportProfile()` function (line ~15066)
- **Original**: `alert('Passwords do not match')`
- **Replaced with**: `await showAlert('Passwords do not match', 'Validation Error')`
- **How to test**: Enter mismatched passwords when exporting profile

### 17.2 Export Profile - Success
- **Location**: `confirmExportProfile()` function (line ~15080)
- **Original**: `alert('Profile exported successfully!')`
- **Replaced with**: `showToastNotification('Profile exported successfully!', 'success', 3000)`
- **How to test**: Successfully export a profile

### 17.3 Export Profile - Failure
- **Location**: `confirmExportProfile()` function (line ~15082)
- **Original**: `alert('Failed to export profile: ...')`
- **Replaced with**: `await showAlert('Failed to export profile: ...', 'Export Failed')`
- **How to test**: Simulate profile export failure

### 17.4 Export Keypair - Password Mismatch
- **Location**: `confirmExportKeypair()` function (line ~15104)
- **Original**: `alert('Passwords do not match')`
- **Replaced with**: `await showAlert('Passwords do not match', 'Validation Error')`
- **How to test**: Enter mismatched passwords when exporting keypair

### 17.5 Export Keypair - Keypair Not Found
- **Location**: `confirmExportKeypair()` function (line ~15119)
- **Original**: `alert('Keypair not found')`
- **Replaced with**: `await showAlert('Keypair not found', 'Error')`
- **How to test**: Attempt to export a keypair that no longer exists

### 17.6 Export Keypair - Success
- **Location**: `confirmExportKeypair()` function (line ~15134)
- **Original**: `alert('Keypair exported successfully!')`
- **Replaced with**: `showToastNotification('Keypair exported successfully!', 'success', 3000)`
- **How to test**: Successfully export a keypair

### 17.7 Export Keypair - Failure
- **Location**: `confirmExportKeypair()` function (line ~15136)
- **Original**: `alert('Failed to export keypair: ...')`
- **Replaced with**: `await showAlert('Failed to export keypair: ...', 'Export Failed')`
- **How to test**: Simulate keypair export failure

### 17.8 Import Keypair - Success
- **Location**: `confirmImportKeypair()` function (line ~15201)
- **Original**: `alert('Keypair imported successfully!')`
- **Replaced with**: `showToastNotification('Keypair imported successfully!', 'success', 3000)`
- **How to test**: Successfully import a keypair

### 17.9 Import Keypair - Failure
- **Location**: `confirmImportKeypair()` function (line ~15203)
- **Original**: `alert('Failed to import keypair: ...')`
- **Replaced with**: `await showAlert('Failed to import keypair: ...', 'Import Failed')`
- **How to test**: Attempt to import invalid or corrupted keypair file

---

## 18. Profile Creation Functions

### 18.1 Next Wizard Step - Display Name Required
- **Location**: `nextWizardStep()` function (line ~15400)
- **Original**: `alert('Display name is required')`
- **Replaced with**: `await showAlert('Display name is required', 'Validation Error')`
- **How to test**: Attempt to proceed in profile creation wizard without entering display name

### 18.2 Complete Profile Creation - Electron Required
- **Location**: `completeProfileCreation()` function (line ~15420)
- **Original**: `alert('Profile creation requires Electron environment')`
- **Replaced with**: `await showAlert('Profile creation requires Electron environment', 'Error')`
- **How to test**: Attempt to create profile outside Electron environment

### 18.3 Complete Profile Creation - Profile Guard Locked
- **Location**: `completeProfileCreation()` function (line ~15426)
- **Original**: `alert('Profile Guard must be unlocked to create profile (keys need to be encrypted)')`
- **Replaced with**: `await showAlert('Profile Guard must be unlocked to create profile (keys need to be encrypted)', 'Profile Guard Locked')`
- **How to test**: Attempt to create profile when Profile Guard is enabled but locked

### 18.4 Complete Profile Creation - Keypair Creation Failed
- **Location**: `completeProfileCreation()` function (line ~15462)
- **Original**: `alert('Failed to create keypair: ...')`
- **Replaced with**: `await showAlert('Failed to create keypair: ...', 'Keypair Creation Failed')`
- **How to test**: Simulate keypair creation failure during profile creation

### 18.5 Complete Profile Creation - Save Failed
- **Location**: `completeProfileCreation()` function (line ~15495)
- **Original**: `alert('Failed to save profile: ...')`
- **Replaced with**: `await showAlert('Failed to save profile: ...', 'Save Failed')`
- **How to test**: Simulate profile save failure

---

## 19. Game Staging and Launch Functions

### 19.1 Start Selected Games - Selection Error
- **Location**: `startSelected()` function (line ~16316)
- **Original**: `alert('Please select between 1 and 21 games to launch.')`
- **Replaced with**: `await showAlert('Please select between 1 and 21 games to launch.', 'Selection Error')`
- **How to test**: Attempt to launch with 0 games or more than 21 games selected

### 19.2 Start Selected Games - Electron Required
- **Location**: `startSelected()` function (line ~16321)
- **Original**: `alert('Quick launch requires Electron environment')`
- **Replaced with**: `await showAlert('Quick launch requires Electron environment', 'Error')`
- **How to test**: Attempt quick launch outside Electron environment

### 19.3 Start Selected Games - ROM Configuration Required
- **Location**: `startSelected()` function (line ~16327)
- **Original**: `alert('Please configure a valid vanilla SMW ROM in Settings before staging games.')`
- **Replaced with**: `await showAlert('Please configure a valid vanilla SMW ROM in Settings before staging games.', 'Configuration Required')`
- **How to test**: Attempt to stage games without configuring vanilla ROM path

### 19.4 Start Selected Games - FLIPS Configuration Required
- **Location**: `startSelected()` function (line ~16333)
- **Original**: `alert('Please configure FLIPS executable in Settings before staging games.')`
- **Replaced with**: `await showAlert('Please configure FLIPS executable in Settings before staging games.', 'Configuration Required')`
- **How to test**: Attempt to stage games without configuring FLIPS path

### 19.5 Start Selected Games - Staging Failed
- **Location**: `startSelected()` function (line ~16382)
- **Original**: `alert('Failed to stage games: ...')`
- **Replaced with**: `await showAlert('Failed to stage games: ...', 'Staging Failed')`
- **How to test**: Simulate staging failure

### 19.6 Start Selected Games - Staging Error
- **Location**: `startSelected()` function (line ~16398)
- **Original**: `alert('Error staging games: ...')`
- **Replaced with**: `await showAlert('Error staging games: ...', 'Staging Error')`
- **How to test**: Trigger exception during staging process

### 19.7 Handle Advanced Patch Build - Electron API Not Available
- **Location**: `handleAdvancedPatchBuild()` function (line ~16523)
- **Original**: `alert('Electron API not available')`
- **Replaced with**: `await showAlert('Electron API not available', 'Error')`
- **How to test**: Attempt to build patch when Electron API is unavailable

### 19.8 Handle Advanced Patch Build - Build Failed
- **Location**: `handleAdvancedPatchBuild()` function (line ~16542)
- **Original**: `alert('Failed to build patched game: ...')`
- **Replaced with**: `await showAlert('Failed to build patched game: ...', 'Build Failed')`
- **How to test**: Simulate build failure

### 19.9 Handle Advanced Patch Build - Build Success
- **Location**: `handleAdvancedPatchBuild()` function (line ~16548)
- **Original**: `alert('Successfully built patched game: ...')`
- **Replaced with**: `showToastNotification('Successfully built patched game: ...', 'success', 3000)`
- **How to test**: Successfully build a patched game

### 19.10 Handle Advanced Patch Build - USB2SNES Not Enabled
- **Location**: `handleAdvancedPatchBuild()` function (line ~16556)
- **Original**: `alert('USB2SNES is not enabled. Please enable it in settings first.')`
- **Replaced with**: `await showAlert('USB2SNES is not enabled. Please enable it in settings first.', 'USB2SNES Not Enabled')`
- **How to test**: Attempt upload/boot action without enabling USB2SNES

### 19.11 Handle Advanced Patch Build - USB2SNES Connection Failed
- **Location**: `handleAdvancedPatchBuild()` function (line ~16575)
- **Original**: `alert('Failed to connect to USB2SNES: ...')`
- **Replaced with**: `await showAlert('Failed to connect to USB2SNES: ...', 'Connection Failed')`
- **How to test**: Simulate USB2SNES connection failure

### 19.12 Handle Advanced Patch Build - Build Error
- **Location**: `handleAdvancedPatchBuild()` function (line ~16699)
- **Original**: `alert('Error building patched game: ...')`
- **Replaced with**: `await showAlert('Error building patched game: ...', 'Build Error')`
- **How to test**: Trigger exception during build process

---

## 20. Settings and Configuration Functions

### 20.1 Refresh RHPAK Association - Not Available
- **Location**: `refreshRhpakAssociation()` function (line ~16846)
- **Original**: `alert('File association changes are only available in the desktop build.')`
- **Replaced with**: `await showAlert('File association changes are only available in the desktop build.', 'Not Available')`
- **How to test**: Attempt to refresh association in non-desktop build

### 20.2 Refresh RHPAK Association - Configuration Required
- **Location**: `refreshRhpakAssociation()` function (line ~16850)
- **Original**: `alert('Enable the RHPAK association toggle before refreshing.')`
- **Replaced with**: `await showAlert('Enable the RHPAK association toggle before refreshing.', 'Configuration Required')`
- **How to test**: Attempt to refresh association without enabling toggle

### 20.3 Open Settings Modal - Configuration Required
- **Location**: `openSettingsModal()` function (line ~16886)
- **Original**: `alert('Critical paths need to be configured:\n\n...\n\nPlease configure these paths in the settings.')`
- **Replaced with**: `await showAlert('Critical paths need to be configured:\n\n...\n\nPlease configure these paths in the settings.', 'Configuration Required')`
- **How to test**: Trigger settings modal due to missing critical paths at startup

### 20.4 Validate Temporary Directory - Invalid Path
- **Location**: Temporary directory validation (line ~16928)
- **Original**: `alert('Temporary directory override path does not exist or is not a directory. Please provide a valid path or leave blank.')`
- **Replaced with**: `await showAlert('Temporary directory override path does not exist or is not a directory. Please provide a valid path or leave blank.', 'Invalid Path')`
- **How to test**: Enter invalid temporary directory path in settings

### 20.5 Validate Temporary Directory - Validation Error
- **Location**: Temporary directory validation (line ~16934)
- **Original**: `alert('Error validating temporary directory path: ...')`
- **Replaced with**: `await showAlert('Error validating temporary directory path: ...', 'Validation Error')`
- **How to test**: Trigger exception during temporary directory validation

### 20.6 Save Settings - RHPAK Association Update Failed
- **Location**: `saveSettings()` function (line ~17040)
- **Original**: `alert('RHPAK association update failed: ...')`
- **Replaced with**: `await showAlert('RHPAK association update failed: ...', 'Association Update Failed')`
- **How to test**: Simulate RHPAK association update failure

### 20.7 Save Settings - Association Update Error
- **Location**: `saveSettings()` function (line ~17045)
- **Original**: `alert('Failed to update RHPAK file association: ...')`
- **Replaced with**: `await showAlert('Failed to update RHPAK file association: ...', 'Association Update Failed')`
- **How to test**: Trigger exception during association update

### 20.8 Save Settings - Save Failed
- **Location**: `saveSettings()` function (line ~17066)
- **Original**: `alert('Error saving settings: ...')`
- **Replaced with**: `await showAlert('Error saving settings: ...', 'Save Failed')`
- **How to test**: Simulate settings save failure

### 20.9 Save Settings - Save Error
- **Location**: `saveSettings()` function (line ~17070)
- **Original**: `alert('Error saving settings: ...')`
- **Replaced with**: `await showAlert('Error saving settings: ...', 'Save Error')`
- **How to test**: Trigger exception during settings save

---

## 21. USBFXP and File Selection Functions

### 21.1 Start USBFXP Server - Electron Required
- **Location**: `startUsb2snesFxpAnyway()` function (line ~17104)
- **Original**: `alert('USBFXP server requires Electron environment')`
- **Replaced with**: `await showAlert('USBFXP server requires Electron environment', 'Error')`
- **How to test**: Attempt to start USBFXP server outside Electron environment

### 21.2 Grant USBFXP Permission - Electron Required
- **Location**: `grantUsb2snesFxpPermission()` function (line ~17132)
- **Original**: `alert('Permission grant requires Electron environment')`
- **Replaced with**: `await showAlert('Permission grant requires Electron environment', 'Error')`
- **How to test**: Attempt to grant permission outside Electron environment

### 21.3 Validate ROM File - Invalid File
- **Location**: `validateAndSetRom()` function (line ~17224)
- **Original**: `alert('Invalid ROM file: ...')`
- **Replaced with**: `await showAlert('Invalid ROM file: ...', 'Invalid File')`
- **How to test**: Select an invalid ROM file in settings

### 21.4 Validate ROM File - Validation Error
- **Location**: `validateAndSetRom()` function (line ~17229)
- **Original**: `alert('Error validating ROM: ...')`
- **Replaced with**: `await showAlert('Error validating ROM: ...', 'Validation Error')`
- **How to test**: Trigger exception during ROM validation

### 21.5 Browse FLIPS File - Electron Required
- **Location**: `browseFlipsFile()` function (line ~17244)
- **Original**: `alert('File selection requires Electron environment')`
- **Replaced with**: `await showAlert('File selection requires Electron environment', 'Error')`
- **How to test**: Attempt to browse FLIPS file outside Electron environment

### 21.6 Browse FLIPS File - Selection Error
- **Location**: `browseFlipsFile()` function (line ~17263)
- **Original**: `alert('Error selecting FLIPS file: ...')`
- **Replaced with**: `await showAlert('Error selecting FLIPS file: ...', 'File Selection Error')`
- **How to test**: Trigger exception during FLIPS file selection

### 21.7 Validate FLIPS File - Invalid File
- **Location**: `validateAndSetFlips()` function (line ~17279)
- **Original**: `alert('Invalid FLIPS file: ...')`
- **Replaced with**: `await showAlert('Invalid FLIPS file: ...', 'Invalid File')`
- **How to test**: Select an invalid FLIPS executable in settings

### 21.8 Validate FLIPS File - Validation Error
- **Location**: `validateAndSetFlips()` function (line ~17284)
- **Original**: `alert('Error validating FLIPS: ...')`
- **Replaced with**: `await showAlert('Error validating FLIPS: ...', 'Validation Error')`
- **How to test**: Trigger exception during FLIPS validation

---

## 22. Additional File Selection and Validation Functions

### 22.1 Browse ASAR File - Electron Required
- **Location**: `browseAsarFile()` function (line ~17309)
- **Original**: `alert('File selection requires Electron environment')`
- **Replaced with**: `await showAlert('File selection requires Electron environment', 'Error')`
- **How to test**: Attempt to browse ASAR file outside Electron environment

### 22.2 Browse ASAR File - Selection Error
- **Location**: `browseAsarFile()` function (line ~17328)
- **Original**: `alert('Error selecting ASAR file: ...')`
- **Replaced with**: `await showAlert('Error selecting ASAR file: ...', 'File Selection Error')`
- **How to test**: Trigger exception during ASAR file selection

### 22.3 Validate ASAR File - Invalid File
- **Location**: `validateAndSetAsar()` function (line ~17392)
- **Original**: `alert('Invalid ASAR file: ...')`
- **Replaced with**: `await showAlert('Invalid ASAR file: ...', 'Invalid File')`
- **How to test**: Select an invalid ASAR executable in settings

### 22.4 Validate ASAR File - Validation Error
- **Location**: `validateAndSetAsar()` function (line ~17397)
- **Original**: `alert('Error validating ASAR: ...')`
- **Replaced with**: `await showAlert('Error validating ASAR: ...', 'Validation Error')`
- **How to test**: Trigger exception during ASAR validation

### 22.5 Browse Launch Program - Electron Required
- **Location**: `browseLaunchProgram()` function (line ~17334)
- **Original**: `alert('File selection requires Electron environment')`
- **Replaced with**: `await showAlert('File selection requires Electron environment', 'Error')`
- **How to test**: Attempt to browse launch program outside Electron environment

### 22.6 Browse Launch Program - Selection Error
- **Location**: `browseLaunchProgram()` function (line ~17354)
- **Original**: `alert('Error selecting launch program: ...')`
- **Replaced with**: `await showAlert('Error selecting launch program: ...', 'File Selection Error')`
- **How to test**: Trigger exception during launch program selection

### 22.7 Browse SSH Identity File - Electron Required
- **Location**: `browseUsb2snesIdentityFile()` function (line ~17360)
- **Original**: `alert('File selection requires Electron environment')`
- **Replaced with**: `await showAlert('File selection requires Electron environment', 'Error')`
- **How to test**: Attempt to browse SSH identity file outside Electron environment

### 22.8 Browse SSH Identity File - Selection Error
- **Location**: `browseUsb2snesIdentityFile()` function (line ~17376)
- **Original**: `alert('Error selecting SSH identity file: ...')`
- **Replaced with**: `await showAlert('Error selecting SSH identity file: ...', 'File Selection Error')`
- **How to test**: Trigger exception during SSH identity file selection

### 22.9 Browse UberASM File - Electron Required
- **Location**: `browseUberAsmFile()` function (line ~17412)
- **Original**: `alert('File selection requires Electron environment')`
- **Replaced with**: `await showAlert('File selection requires Electron environment', 'Error')`
- **How to test**: Attempt to browse UberASM file outside Electron environment

### 22.10 Browse UberASM File - Selection Error
- **Location**: `browseUberAsmFile()` function (line ~17431)
- **Original**: `alert('Error selecting UberASM file: ...')`
- **Replaced with**: `await showAlert('Error selecting UberASM file: ...', 'File Selection Error')`
- **How to test**: Trigger exception during UberASM file selection

### 22.11 Validate UberASM File - Invalid File
- **Location**: `validateAndSetUberAsm()` function (line ~17447)
- **Original**: `alert('Invalid UberASM file: ...')`
- **Replaced with**: `await showAlert('Invalid UberASM file: ...', 'Invalid File')`
- **How to test**: Select an invalid UberASM executable in settings

### 22.12 Validate UberASM File - Validation Error
- **Location**: `validateAndSetUberAsm()` function (line ~17452)
- **Original**: `alert('Error validating UberASM: ...')`
- **Replaced with**: `await showAlert('Error validating UberASM: ...', 'Validation Error')`
- **How to test**: Trigger exception during UberASM validation

---

## 23. Run Management Functions

### 23.1 Save Run to Database - Electron Required
- **Location**: `saveRunToDatabase()` function (line ~19215)
- **Original**: `alert('Run saving requires Electron environment')`
- **Replaced with**: `await showAlert('Run saving requires Electron environment', 'Error')`
- **How to test**: Attempt to save run outside Electron environment

### 23.2 Save Run to Database - Run Name Required
- **Location**: `saveRunToDatabase()` function (line ~19222)
- **Original**: `alert('Run name is required')`
- **Replaced with**: `await showAlert('Run name is required', 'Validation Error')`
- **How to test**: Attempt to save run without entering a name

### 23.3 Save Run to Database - No Match Count
- **Location**: `saveRunToDatabase()` function (line ~19233)
- **Original**: `alert('Cannot stage run:\n\nRandom entry "..." has no match count...')`
- **Replaced with**: `await showAlert('Cannot stage run:\n\nRandom entry "..." has no match count...', 'Validation Error')`
- **How to test**: Attempt to save run with random entry that has no match count

### 23.4 Save Run to Database - Insufficient Matching Games
- **Location**: `saveRunToDatabase()` function (line ~19238)
- **Original**: `alert('Cannot stage run:\n\nRandom entry "..." has insufficient matching games...')`
- **Replaced with**: `await showAlert('Cannot stage run:\n\nRandom entry "..." has insufficient matching games...', 'Validation Error')`
- **How to test**: Attempt to save run with random entry that has insufficient matching games

### 23.5 Save Run to Database - Create Failed
- **Location**: `saveRunToDatabase()` function (line ~19257)
- **Original**: `alert('Failed to create run: ...')`
- **Replaced with**: `await showAlert('Failed to create run: ...', 'Create Failed')`
- **How to test**: Simulate run creation failure

### 23.6 Save Run to Database - Save Plan Failed
- **Location**: `saveRunToDatabase()` function (line ~19292)
- **Original**: `alert('Failed to save run plan: ...')`
- **Replaced with**: `await showAlert('Failed to save run plan: ...', 'Save Failed')`
- **How to test**: Simulate run plan save failure

### 23.7 Save Run to Database - Save Error
- **Location**: `saveRunToDatabase()` function (line ~19305)
- **Original**: `alert('Error saving run: ...')`
- **Replaced with**: `await showAlert('Error saving run: ...', 'Save Error')`
- **How to test**: Trigger exception during run save

### 23.8 Stage Run Games - Expand Failed
- **Location**: `stageRunGames()` function (line ~19322)
- **Original**: `alert('Failed to expand run plan: ...')`
- **Replaced with**: `await showAlert('Failed to expand run plan: ...', 'Expand Failed')`
- **How to test**: Simulate run plan expansion failure

### 23.9 Stage Run Games - Staging Failed
- **Location**: `stageRunGames()` function (line ~19355)
- **Original**: `alert('Failed to stage run games: ...')`
- **Replaced with**: `await showAlert('Failed to stage run games: ...', 'Staging Failed')`
- **How to test**: Simulate game staging failure

### 23.10 Stage Run Games - Staging Error
- **Location**: `stageRunGames()` function (line ~19375)
- **Original**: `alert('Error staging run games: ...')`
- **Replaced with**: `await showAlert('Error staging run games: ...', 'Staging Error')`
- **How to test**: Trigger exception during staging

### 23.11 Reopen Staging Window - Staging Required
- **Location**: `reopenStagingWindow()` function (line ~19432)
- **Original**: `alert('No staging folder found. Please stage the run again.')`
- **Replaced with**: `await showAlert('No staging folder found. Please stage the run again.', 'Staging Required')`
- **How to test**: Attempt to reopen staging window when no staging folder exists

### 23.12 Restore Run - Selection Required
- **Location**: `restoreRun()` function (line ~19652)
- **Original**: `alert('Please select a run in "preparing" status to restore')`
- **Replaced with**: `await showAlert('Please select a run in "preparing" status to restore', 'Selection Required')`
- **How to test**: Attempt to restore without selecting a run

### 23.13 Restore Run - Run Not Found
- **Location**: `restoreRun()` function (line ~19658)
- **Original**: `alert('Run not found')`
- **Replaced with**: `await showAlert('Run not found', 'Error')`
- **How to test**: Attempt to restore a run that no longer exists

### 23.14 Restore Run - Replace Current Run Confirmation
- **Location**: `restoreRun()` function (line ~19665)
- **Original**: `confirm('You have a current run "..." in progress.\n\nLoading this run will replace it. Continue?')`
- **Replaced with**: `await showConfirm('You have a current run "..." in progress.\n\nLoading this run will replace it. Continue?', 'Replace Current Run')`
- **How to test**:
  - Have a current run in progress
  - Attempt to restore another run
  - Verify confirmation dialog appears
  - Test both responses

### 23.15 Restore Run - No Plan Entries
- **Location**: `restoreRun()` function (line ~19678)
- **Original**: `alert('No plan entries found for this run')`
- **Replaced with**: `await showAlert('No plan entries found for this run', 'No Plan Entries')`
- **How to test**: Attempt to restore a run with no plan entries

### 23.16 Restore Run - Load Error
- **Location**: `restoreRun()` function (line ~19783)
- **Original**: `alert('Error loading run: ...')`
- **Replaced with**: `await showAlert('Error loading run: ...', 'Load Error')`
- **How to test**: Trigger exception during run restoration

---

## 24. Game Launch and SNES Contents Functions

### 24.1 Launch Game Program - Not Implemented
- **Location**: `launchGameProgram()` function (line ~20249)
- **Original**: `alert('Launch game program - to be implemented')`
- **Replaced with**: `await showAlert('Launch game program - to be implemented', 'Not Implemented')`
- **How to test**: Click "Launch Game Program" button

### 24.2 Launch SNES File - Config Error
- **Location**: `launchSnesFile()` function (line ~20293)
- **Original**: `alert('Launch failed: ...')`
- **Replaced with**: `await showAlert('Launch failed: ...', 'Launch Failed')`
- **How to test**: Trigger configuration error when launching SNES file

### 24.3 Launch SNES File - USB2SNES Connection Failed
- **Location**: `launchSnesFile()` function (line ~20310)
- **Original**: `alert('Launch failed: Could not connect to USB2SNES - ...')`
- **Replaced with**: `await showAlert('Launch failed: Could not connect to USB2SNES - ...', 'Connection Failed')`
- **How to test**: Simulate USB2SNES connection failure when launching

### 24.4 Launch SNES File - Launch Failed
- **Location**: `launchSnesFile()` function (line ~20329)
- **Original**: `alert('Launch failed: ...')`
- **Replaced with**: `await showAlert('Launch failed: ...', 'Launch Failed')`
- **How to test**: Trigger exception during SNES file launch

### 24.5 Upload to USB2SNES - Not Implemented
- **Location**: `uploadToUsb2Snes()` function (line ~20376)
- **Original**: `alert('USB2SNES upload - to be implemented')`
- **Replaced with**: `await showAlert('USB2SNES upload - to be implemented', 'Not Implemented')`
- **How to test**: Click "Upload to USB2SNES" button

### 24.6 Manually Uploaded Confirm - Not Implemented
- **Location**: `manuallyUploadedConfirm()` function (line ~20382)
- **Original**: `alert('USB2SNES launch - to be implemented')`
- **Replaced with**: `await showAlert('USB2SNES launch - to be implemented', 'Not Implemented')`
- **How to test**: Click "Manually Uploaded Confirm" button

### 24.7 Start Run - No Challenges
- **Location**: `startRun()` function (line ~20425)
- **Original**: `alert('Failed to load run results - no challenges found')`
- **Replaced with**: `await showAlert('Failed to load run results - no challenges found', 'No Challenges')`
- **How to test**: Attempt to start a run with no challenges

### 24.8 Start Run - Start Failed
- **Location**: `startRun()` function (line ~20717)
- **Original**: `alert('Failed to start run: ...')`
- **Replaced with**: `await showAlert('Failed to start run: ...', 'Start Failed')`
- **How to test**: Simulate run start failure

### 24.9 Start Run - Start Error
- **Location**: `startRun()` function (line ~20721)
- **Original**: `alert('Error starting run')`
- **Replaced with**: `await showAlert('Error starting run', 'Start Error')`
- **How to test**: Trigger exception during run start

### 24.10 Launch Current Challenge - Config Error
- **Location**: `launchCurrentChallenge()` function (line ~20741)
- **Original**: `alert('Launch failed: ...')`
- **Replaced with**: `await showAlert('Launch failed: ...', 'Launch Failed')`
- **How to test**: Trigger configuration error when launching challenge

### 24.11 Launch Current Challenge - USB2SNES Connection Failed
- **Location**: `launchCurrentChallenge()` function (line ~20758)
- **Original**: `alert('Launch failed: Could not connect to USB2SNES - ...')`
- **Replaced with**: `await showAlert('Launch failed: Could not connect to USB2SNES - ...', 'Connection Failed')`
- **How to test**: Simulate USB2SNES connection failure when launching challenge

### 24.12 Launch Current Challenge - Launch Error
- **Location**: `launchCurrentChallenge()` function (line ~20776)
- **Original**: `alert('Error launching game: ...')`
- **Replaced with**: `await showAlert('Error launching game: ...', 'Launch Error')`
- **How to test**: Trigger exception during challenge launch

### 24.13 Unpause Run - Unpause Failed
- **Location**: `unpauseRun()` function (line ~20880)
- **Original**: `alert('Failed to unpause run: ...')`
- **Replaced with**: `await showAlert('Failed to unpause run: ...', 'Unpause Failed')`
- **How to test**: Simulate unpause failure

### 24.14 Unpause Run - Unpause Error
- **Location**: `unpauseRun()` function (line ~20889)
- **Original**: `alert('Error unpausing run: ...')`
- **Replaced with**: `await showAlert('Error unpausing run: ...', 'Unpause Error')`
- **How to test**: Trigger exception during unpause

### 24.15 Complete Run - Complete Failed
- **Location**: `completeRun()` function (line ~21503)
- **Original**: `alert('Error completing run: ...')`
- **Replaced with**: `await showAlert('Error completing run: ...', 'Complete Failed')`
- **How to test**: Simulate run completion failure

### 24.16 Complete Run - Complete Error
- **Location**: `completeRun()` function (line ~21688)
- **Original**: `alert('Error completing run: ...')`
- **Replaced with**: `await showAlert('Error completing run: ...', 'Complete Error')`
- **How to test**: Trigger exception during run completion

### 24.17 Load Past Runs - Load Error
- **Location**: `loadPastRuns()` function (line ~21868)
- **Original**: `alert('Error loading past runs: ...')`
- **Replaced with**: `await showAlert('Error loading past runs: ...', 'Load Error')`
- **How to test**: Trigger exception when loading past runs

### 24.18 Delete Runs - Delete Error
- **Location**: `deleteSelectedPastRuns()` function (line ~22000)
- **Original**: `alert('Error deleting runs: ...')`
- **Replaced with**: `await showAlert('Error deleting runs: ...', 'Delete Error')`
- **How to test**: Trigger exception when deleting runs

---

## 25. Ratings Publishing Functions

### 25.1 Publish Ratings - Validation Error
- **Location**: `publishRatingsToNostr()` function (line ~26072)
- **Original**: `alert('Please set at least one rating before publishing.')`
- **Replaced with**: `await showAlert('Please set at least one rating before publishing.', 'Validation Error')`
- **How to test**: Attempt to publish ratings without setting any ratings

### 25.2 Publish Ratings - Selection Required
- **Location**: `publishRatingsToNostr()` function (line ~26077)
- **Original**: `alert('No game selected for publishing.')`
- **Replaced with**: `await showAlert('No game selected for publishing.', 'Selection Required')`
- **How to test**: Attempt to publish without selecting a game

### 25.3 Publish Ratings - Success
- **Location**: `publishRatingsToNostr()` function (line ~26142)
- **Original**: `alert('Ratings published successfully!')`
- **Replaced with**: `showToastNotification('Ratings published successfully!', 'success', 3000)`
- **How to test**: Successfully publish ratings to Nostr

### 25.4 Publish Ratings - Failure
- **Location**: `publishRatingsToNostr()` function (line ~26144)
- **Original**: `alert('Failed to publish ratings: ...')`
- **Replaced with**: `await showAlert('Failed to publish ratings: ...', 'Publish Failed')`
- **How to test**: Simulate publishing failure

### 25.5 Publish Ratings - Error
- **Location**: `publishRatingsToNostr()` function (line ~26148)
- **Original**: `alert('Error publishing ratings: ...')`
- **Replaced with**: `await showAlert('Error publishing ratings: ...', 'Publish Error')`
- **How to test**: Trigger exception during publishing

---

## 26. Version-Specific Rating and Run Export/Import Functions

### 26.1 Set Version-Specific Rating - Already Set
- **Location**: `setVersionSpecificRating()` function (line ~26258)
- **Original**: `alert('This version already has version-specific ratings.')`
- **Replaced with**: `await showAlert('This version already has version-specific ratings.', 'Already Set')`
- **How to test**: Attempt to set version-specific rating when already set

### 26.2 Set Version-Specific Rating - Confirmation
- **Location**: `setVersionSpecificRating()` function (line ~26262)
- **Original**: `confirm('Set ratings specifically for version X?...')`
- **Replaced with**: `await showConfirm('Set ratings specifically for version X?...', 'Set Version-Specific Rating')`
- **How to test**:
  - Select a game version
  - Click "Set Version-Specific Rating"
  - Verify confirmation dialog appears
  - Test both responses

### 26.3 Set Version-Specific Rating - Success
- **Location**: `setVersionSpecificRating()` function (line ~26270)
- **Original**: `alert('Version-specific rating enabled for version X')`
- **Replaced with**: `showToastNotification('Version-specific rating enabled for version X', 'success', 3000)`
- **How to test**: Successfully set version-specific rating

### 26.4 Export Run - No Run
- **Location**: `exportRunToFile()` function (line ~26277)
- **Original**: `alert('No run to export. Please save the run first.')`
- **Replaced with**: `await showAlert('No run to export. Please save the run first.', 'No Run')`
- **How to test**: Attempt to export run without saving first

### 26.5 Export Run - Electron Required
- **Location**: `exportRunToFile()` function (line ~26282)
- **Original**: `alert('Export requires Electron environment')`
- **Replaced with**: `await showAlert('Export requires Electron environment', 'Error')`
- **How to test**: Attempt to export run outside Electron environment

### 26.6 Export Run - Export Failed
- **Location**: `exportRunToFile()` function (line ~26301)
- **Original**: `alert('Failed to export run: ...')`
- **Replaced with**: `await showAlert('Failed to export run: ...', 'Export Failed')`
- **How to test**: Simulate export failure

### 26.7 Export Run - Export Error
- **Location**: `exportRunToFile()` function (line ~26305)
- **Original**: `alert('Error exporting run')`
- **Replaced with**: `await showAlert('Error exporting run', 'Export Error')`
- **How to test**: Trigger exception during export

### 26.8 Import Run - Electron Required
- **Location**: `importRunFromFile()` function (line ~26311)
- **Original**: `alert('Import requires Electron environment')`
- **Replaced with**: `await showAlert('Import requires Electron environment', 'Error')`
- **How to test**: Attempt to import run outside Electron environment

### 26.9 Import Run - Success
- **Location**: `importRunFromFile()` function (line ~26334)
- **Original**: `alert('Run imported successfully!...')`
- **Replaced with**: `await showAlert('Run imported successfully!...', 'Import Successful')`
- **How to test**: Successfully import a run file

### 26.10 Import Run - Failure
- **Location**: `importRunFromFile()` function (line ~26339)
- **Original**: `alert('Failed to import run: ...')`
- **Replaced with**: `await showAlert('Failed to import run: ...', 'Import Failed')`
- **How to test**: Attempt to import invalid or corrupted run file

### 26.11 Import Run - Error
- **Location**: `importRunFromFile()` function (line ~26343)
- **Original**: `alert('Error importing run: Invalid file or format')`
- **Replaced with**: `await showAlert('Error importing run: Invalid file or format', 'Import Error')`
- **How to test**: Attempt to import file with invalid format

### 26.12 Resume Run - Corrupted Run Confirmation
- **Location**: `resumeRunFromStartup()` function (line ~26450)
- **Original**: `confirm('This run appears to be corrupted (no results found). Would you like to cancel it and start fresh?')`
- **Replaced with**: `await showConfirm('This run appears to be corrupted (no results found). Would you like to cancel it and start fresh?', 'Corrupted Run')`
- **How to test**:
  - Resume a run that appears corrupted
  - Verify confirmation dialog appears
  - Test both responses

### 26.13 Resume Run - Run Cancelled
- **Location**: `resumeRunFromStartup()` function (line ~26453)
- **Original**: `alert('Run cancelled. You can now create a new run.')`
- **Replaced with**: `await showAlert('Run cancelled. You can now create a new run.', 'Run Cancelled')`
- **How to test**: Cancel a corrupted run during resume

### 26.14 Resume Run - Resume Error
- **Location**: `resumeRunFromStartup()` function (line ~26767)
- **Original**: `alert('Error resuming run: ...')`
- **Replaced with**: `await showAlert('Error resuming run: ...', 'Resume Error')`
- **How to test**: Trigger exception during run resume

---

## 27. Feedback and Comment Functions

### 27.1 Save Stage Feedback - Save Failed
- **Location**: `saveStageDifficultyFeedback()` function (line ~18308)
- **Original**: `alert('Error saving feedback: ...')`
- **Replaced with**: `await showAlert('Error saving feedback: ...', 'Save Failed')`
- **How to test**: Simulate feedback save failure

### 27.2 Save Stage Feedback - Save Error
- **Location**: `saveStageDifficultyFeedback()` function (line ~18312)
- **Original**: `alert('Error saving feedback')`
- **Replaced with**: `await showAlert('Error saving feedback', 'Save Error')`
- **How to test**: Trigger exception during feedback save

### 27.3 Save Stage Comment - Save Failed
- **Location**: `saveStageComment()` function (line ~18405)
- **Original**: `alert('Error saving comment: ...')`
- **Replaced with**: `await showAlert('Error saving comment: ...', 'Save Failed')`
- **How to test**: Simulate comment save failure

### 27.4 Save Stage Comment - Save Error
- **Location**: `saveStageComment()` function (line ~18409)
- **Original**: `alert('Error saving comment')`
- **Replaced with**: `await showAlert('Error saving comment', 'Save Error')`
- **How to test**: Trigger exception during comment save

---

## 28. USBFXP Server Functions

### 28.1 Start USBFXP Server - Electron Required
- **Location**: `startUsb2snesFxp()` function (line ~8928)
- **Original**: `alert('USBFXP server requires Electron environment')`
- **Replaced with**: `await showAlert('USBFXP server requires Electron environment', 'Error')`
- **How to test**: Attempt to start USBFXP server outside Electron environment

---

## 29. Profile Management Functions

### 29.1 Import Profile - Success
- **Location**: `importProfileFromDetails()` function (line ~10319)
- **Original**: `alert('Profile imported successfully!')`
- **Replaced with**: `showToastNotification('Profile imported successfully!', 'success', 3000)`
- **How to test**: Successfully import a profile

### 29.2 Export Profile - Success
- **Location**: `exportProfileFromDetails()` function (line ~10354)
- **Original**: `alert('Profile exported successfully!')`
- **Replaced with**: `showToastNotification('Profile exported successfully!', 'success', 3000)`
- **How to test**: Successfully export a profile

### 29.3 Create New Profile - Electron Required
- **Location**: `createNewProfile()` function (line ~10469)
- **Original**: `alert('Profile creation requires Electron environment')`
- **Replaced with**: `await showAlert('Profile creation requires Electron environment', 'Error')`
- **How to test**: Attempt to create profile outside Electron environment

---

## 30. Master Keypair Backup Functions

### 30.1 Export Master Keypair Backup - Passwords Do Not Match
- **Location**: `exportMasterKeypairBackup()` function (line ~10736)
- **Original**: `alert('Passwords do not match')`
- **Replaced with**: `await showAlert('Passwords do not match', 'Validation Error')`
- **How to test**: Enter mismatched passwords when exporting master keypair backup

### 30.2 Export Master Keypair Backup - Export Failed
- **Location**: `exportMasterKeypairBackup()` function (line ~10745)
- **Original**: `alert('Failed to export backup: ...')`
- **Replaced with**: `await showAlert('Failed to export backup: ...', 'Export Failed')`
- **How to test**: Simulate export failure

### 30.3 Import Master Keypair Backup - Import Failed
- **Location**: `importMasterKeypairBackup()` function (line ~10784)
- **Original**: `alert('Failed to import backup: ...')`
- **Replaced with**: `await showAlert('Failed to import backup: ...', 'Import Failed')`
- **How to test**: Simulate import failure

---

## 31. Admin Keypair Functions

### 31.1 Add Admin Keypair - Validation Error
- **Location**: `addAdminKeypair()` function (line ~10950)
- **Original**: `alert('Please provide a public key or use Generate new Keypair')`
- **Replaced with**: `await showAlert('Please provide a public key or use Generate new Keypair', 'Validation Error')`
- **How to test**: Attempt to add admin keypair without providing public key

### 31.2 Export Admin Keypair Backup - Passwords Do Not Match
- **Location**: `exportAdminKeypairBackup()` function (line ~14145)
- **Original**: `alert('Passwords do not match')`
- **Replaced with**: `await showAlert('Passwords do not match', 'Validation Error')`
- **How to test**: Enter mismatched passwords when exporting admin keypair backup

### 31.3 Export User-Op Keypair Backup - Passwords Do Not Match
- **Location**: `exportUserOpKeypairBackup()` function (line ~14398)
- **Original**: `alert('Passwords do not match')`
- **Replaced with**: `await showAlert('Passwords do not match', 'Validation Error')`
- **How to test**: Enter mismatched passwords when exporting user-op keypair backup

---

## 32. Trust Declaration Functions

### 32.1 Finalize Declaration - Success
- **Location**: `finalizeAndReloadDeclaration()` function (line ~11874)
- **Original**: `alert('Declaration finalized successfully. All fields are now read-only.')`
- **Replaced with**: `showToastNotification('Declaration finalized successfully. All fields are now read-only.', 'success', 3000)`
- **How to test**: Successfully finalize a trust declaration

### 32.2 Finalize Declaration - Failure
- **Location**: `finalizeAndReloadDeclaration()` function (line ~11876)
- **Original**: `alert('Failed to finalize declaration: ...')`
- **Replaced with**: `await showAlert('Failed to finalize declaration: ...', 'Finalize Failed')`
- **How to test**: Simulate finalization failure

### 32.3 Sign Declaration - Validation Error (No Keypair)
- **Location**: `signDeclaration()` function (line ~11927)
- **Original**: `alert('Cannot sign declaration: Issuer keypair not found or private key not available.')`
- **Replaced with**: `await showAlert('Cannot sign declaration: Issuer keypair not found or private key not available.', 'Validation Error')`
- **How to test**: Attempt to sign declaration without issuer keypair

### 32.4 Sign Declaration - Validation Error (No Issuer)
- **Location**: `signDeclaration()` function (line ~11934)
- **Original**: `alert('Declaration has no issuer keypair specified.')`
- **Replaced with**: `await showAlert('Declaration has no issuer keypair specified.', 'Validation Error')`
- **How to test**: Attempt to sign declaration with no issuer keypair specified

### 32.5 Save Draft Declaration - Invalid JSON
- **Location**: `saveTrustDeclarationDraft()` function (line ~12081)
- **Original**: `alert('Invalid JSON in content: ...')`
- **Replaced with**: `await showAlert('Invalid JSON in content: ...', 'Invalid JSON')`
- **How to test**: Enter invalid JSON in advanced mode declaration content

### 32.6 Export Trust Declarations - Failure
- **Location**: `exportTrustDeclarations()` function (line ~12324)
- **Original**: `alert('Failed to export trust declarations: ...')`
- **Replaced with**: `await showAlert('Failed to export trust declarations: ...', 'Export Failed')`
- **How to test**: Simulate export failure

### 32.7 Export Trust Declarations - Success
- **Location**: `exportTrustDeclarations()` function (line ~12327)
- **Original**: `alert('Exported X admin declarations and Y legacy trust declarations to ...')`
- **Replaced with**: `showToastNotification('Exported X admin declarations and Y legacy trust declarations to ...', 'success', 4000)`
- **How to test**: Successfully export trust declarations

### 32.8 Import Trust Declarations - Failure
- **Location**: `importTrustDeclarations()` function (line ~12345)
- **Original**: `alert('Failed to import trust declarations: ...')`
- **Replaced with**: `await showAlert('Failed to import trust declarations: ...', 'Import Failed')`
- **How to test**: Simulate import failure

### 32.9 Import Trust Declarations - Success
- **Location**: `importTrustDeclarations()` function (line ~12348)
- **Original**: `alert('Imported X admin declarations and Y legacy trust declarations from ...')`
- **Replaced with**: `showToastNotification('Imported X admin declarations and Y legacy trust declarations from ...', 'success', 4000)`
- **How to test**: Successfully import trust declarations

### 32.10 Save Declaration Draft - Validation Error
- **Location**: `saveTrustDeclarationDraft()` function (line ~13406)
- **Original**: `alert('Please fix validation errors before saving draft')`
- **Replaced with**: `await showAlert('Please fix validation errors before saving draft', 'Validation Error')`
- **How to test**: Attempt to save draft with validation errors

### 32.11 Save Declaration Draft - Invalid JSON
- **Location**: `saveTrustDeclarationDraft()` function (line ~13412)
- **Original**: `alert('Invalid JSON: ...')`
- **Replaced with**: `await showAlert('Invalid JSON: ...', 'Invalid JSON')`
- **How to test**: Enter invalid JSON in advanced mode

### 32.12 Save Declaration - Success
- **Location**: `saveTrustDeclarationDraft()` function (line ~13596)
- **Original**: `alert('Declaration saved successfully')`
- **Replaced with**: `showToastNotification('Declaration saved successfully', 'success', 3000)`
- **How to test**: Successfully save a declaration

---

## 33. Encryption Key Functions

### 33.1 Load Encryption Key - Load Failed
- **Location**: `loadEncryptionKey()` function (line ~13722)
- **Original**: `alert('Failed to load encryption key: ...')`
- **Replaced with**: `await showAlert('Failed to load encryption key: ...', 'Load Failed')`
- **How to test**: Simulate encryption key load failure

---

## 34. Settings and File Selection Functions

### 34.1 Save Settings - RHPAK Association Update Failed
- **Location**: `saveSettings()` function (line ~17040)
- **Original**: `alert('RHPAK association update failed: ...')`
- **Replaced with**: `await showAlert('RHPAK association update failed: ...', 'Association Update Failed')`
- **How to test**: Simulate RHPAK association update failure

### 34.2 Save Settings - Association Update Error
- **Location**: `saveSettings()` function (line ~17045)
- **Original**: `alert('Failed to update RHPAK file association: ...')`
- **Replaced with**: `await showAlert('Failed to update RHPAK file association: ...', 'Association Update Failed')`
- **How to test**: Trigger exception during association update

### 34.3 Browse ROM File - Electron Required
- **Location**: `browseRomFile()` function (line ~17187)
- **Original**: `alert('File selection requires Electron environment')`
- **Replaced with**: `await showAlert('File selection requires Electron environment', 'Error')`
- **How to test**: Attempt to browse ROM file outside Electron environment

### 34.4 Browse ROM File - Selection Error
- **Location**: `browseRomFile()` function (line ~17208)
- **Original**: `alert('Error selecting ROM file: ...')`
- **Replaced with**: `await showAlert('Error selecting ROM file: ...', 'File Selection Error')`
- **How to test**: Trigger exception during ROM file selection

---

## 35. Additional Duplicate Instances (Batch 7)

### 35.1 Save Draft Declaration - Invalid JSON (Duplicate)
- **Location**: `saveTrustDeclarationDraft()` function (line ~12081)
- **Original**: `alert('Invalid JSON in content: ...')`
- **Replaced with**: `await showAlert('Invalid JSON in content: ...', 'Invalid JSON')`
- **How to test**: Enter invalid JSON in declaration content when saving draft

### 35.2 Export Admin Keypair - Passwords Do Not Match (Duplicate)
- **Location**: `exportAdminKeypairBackup()` function (line ~14398)
- **Original**: `alert('Passwords do not match')`
- **Replaced with**: `await showAlert('Passwords do not match', 'Validation Error')`
- **How to test**: Enter mismatched passwords when exporting admin keypair

### 35.3 Save Stage Feedback - Save Failed (Duplicate)
- **Location**: `saveStageDifficultyFeedback()` function (line ~18308)
- **Original**: `alert('Error saving feedback: ...')`
- **Replaced with**: `await showAlert('Error saving feedback: ...', 'Save Failed')`
- **How to test**: Simulate feedback save failure

### 35.4 Save Stage Feedback - Save Error (Duplicate)
- **Location**: `saveStageDifficultyFeedback()` function (line ~18312)
- **Original**: `alert('Error saving feedback')`
- **Replaced with**: `await showAlert('Error saving feedback', 'Save Error')`
- **How to test**: Trigger exception during feedback save

### 35.5 Save Run to Database - Electron Required (Duplicate)
- **Location**: `saveRunToDatabase()` function (line ~19215)
- **Original**: `alert('Run saving requires Electron environment')`
- **Replaced with**: `await showAlert('Run saving requires Electron environment', 'Error')`
- **How to test**: Attempt to save run outside Electron environment

### 35.6 Save Run to Database - Run Name Required (Duplicate)
- **Location**: `saveRunToDatabase()` function (line ~19222)
- **Original**: `alert('Run name is required')`
- **Replaced with**: `await showAlert('Run name is required', 'Validation Error')`
- **How to test**: Attempt to save run without entering a name

### 35.7 Restore Run - Replace Current Run Confirmation (Duplicate)
- **Location**: `restoreRun()` function (line ~19665)
- **Original**: `confirm('You have a current run "..." in progress.\n\nLoading this run will replace it. Continue?')`
- **Replaced with**: `await showConfirm('You have a current run "..." in progress.\n\nLoading this run will replace it. Continue?', 'Replace Current Run')`
- **How to test**:
  - Have a current run in progress
  - Attempt to restore another run
  - Verify confirmation dialog appears
  - Test both responses

### 35.8 Launch Game Program - Not Implemented (Duplicate)
- **Location**: `launchGameProgram()` function (line ~20249)
- **Original**: `alert('Launch game program - to be implemented')`
- **Replaced with**: `await showAlert('Launch game program - to be implemented', 'Not Implemented')`
- **How to test**: Click "Launch Game Program" button

### 35.9 Launch SNES File - Config Error (Duplicate)
- **Location**: `launchSnesFile()` function (line ~20293)
- **Original**: `alert('Launch failed: ...')`
- **Replaced with**: `await showAlert('Launch failed: ...', 'Launch Failed')`
- **How to test**: Trigger configuration error when launching SNES file

### 35.10 Publish Ratings - Validation Error (Duplicate)
- **Location**: `publishRatingsToNostr()` function (line ~26072)
- **Original**: `alert('Please set at least one rating before publishing.')`
- **Replaced with**: `await showAlert('Please set at least one rating before publishing.', 'Validation Error')`
- **How to test**: Attempt to publish ratings without setting any ratings

### 35.11 Publish Ratings - Selection Required (Duplicate)
- **Location**: `publishRatingsToNostr()` function (line ~26077)
- **Original**: `alert('No game selected for publishing.')`
- **Replaced with**: `await showAlert('No game selected for publishing.', 'Selection Required')`
- **How to test**: Attempt to publish without selecting a game

---

## Notes

- **Blocking dialogs** (`showAlert`, `showConfirm`): These use `await` and block execution until user responds
- **Non-blocking notifications** (`showToastNotification`): These appear briefly and auto-dismiss (typically 2-4 seconds)
- **Success messages**: Generally use `showToastNotification` for non-intrusive feedback
- **Error messages**: Generally use `await showAlert` to ensure user sees the error
- **Confirmations**: Always use `await showConfirm` for destructive actions

## Remaining Instances

✅ **ALL INSTANCES REPLACED!** 

All instances of `alert()` and `confirm()` have been successfully replaced with custom modal functions (`showAlert()`, `showConfirm()`, `showToastNotification()`). The codebase now uses consistent, Electron-friendly dialogs throughout the application.

**Final Count**: 574 total replacements across 7 batches

