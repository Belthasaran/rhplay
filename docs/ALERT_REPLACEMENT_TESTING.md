# Alert/Confirm Replacement Testing Guide

This document lists all instances where system `alert()` and `confirm()` calls have been replaced with custom modal functions (`showAlert()`, `showConfirm()`, `showToastNotification()`) in `electron/renderer/src/App.vue`.

**Total Replacements Made**: 367 instances (Batch 1: 318, Batch 2: 49)

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

## Notes

- **Blocking dialogs** (`showAlert`, `showConfirm`): These use `await` and block execution until user responds
- **Non-blocking notifications** (`showToastNotification`): These appear briefly and auto-dismiss (typically 2-4 seconds)
- **Success messages**: Generally use `showToastNotification` for non-intrusive feedback
- **Error messages**: Generally use `await showAlert` to ensure user sees the error
- **Confirmations**: Always use `await showConfirm` for destructive actions

## Remaining Instances

There are still approximately 174 instances of `alert()` and `confirm()` remaining in the file. These should be replaced in future passes, focusing on:
- Nostr publishing functions
- Profile Guard functions
- Admin keypair management functions (additional instances)
- Secret key management functions
- Game staging and launch functions
- Settings and configuration functions
- Additional profile management functions

