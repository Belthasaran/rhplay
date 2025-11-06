# Remaining Work Summary

## Overview
This document summarizes what needs to be done for:
1. **WelcomeWizard Framework** - Consolidated startup task management
2. **IPC Handler Refactoring** - Migrate to use OnlineProfileManager

---

## 1. WelcomeWizard Framework

### Purpose
A consolidated modal framework that handles required startup tasks before the user can use the application. Replaces the current ad-hoc approach where Keyguard setup is required before creating the first profile.

### Tasks to Implement

#### A. State Variables (in App.vue)
Add to the script section:
```typescript
// WelcomeWizard state
const welcomeWizardOpen = ref(false);
const welcomeTasks = ref<Array<{
  id: string;
  title: string;
  description: string;
  status: 'pending' | 'in-progress' | 'completed';
  component: string; // 'setup-keyguard' | 'unlock-keyguard' | 'high-security-unlock'
}>>([]);
const currentWelcomeTaskIndex = ref(0);
const welcomeTaskStatus = ref<Record<string, 'pending' | 'in-progress' | 'completed'>>({});
```

#### B. Welcome Task Detection Logic
Create function `checkWelcomeTasks()` that:
1. Checks if Keyguard is set up
   - If not: Add "Setup Keyguard" task
2. Checks if Keyguard is unlocked
   - If not: Add "Unlock Keyguard" task
3. Checks if in high security mode
   - If yes and not unlocked: Add "High Security Mode Unlock" task (with "Forgot passphrase" option)

#### C. WelcomeWizard Modal Template
Add modal template to App.vue:
- Non-dismissible backdrop
- Progress indicator (e.g., "Task 1 of 3")
- Current task page component
- Task-specific dialogs can appear on top of the modal
- "Next" button (disabled until current task completes)

#### D. Task Components
Each task should:
- Display appropriate UI (setup form, unlock prompt, etc.)
- Handle completion logic
- Emit completion event to WelcomeWizard
- WelcomeWizard automatically moves to next task

#### E. Startup Integration
In `onMounted()`:
1. Call `checkWelcomeTasks()`
2. If tasks exist, set `welcomeWizardOpen.value = true`
3. Block app usage until all tasks complete

#### F. Keyguard Setup Changes
- Remove requirement for Keyguard before creating first profile
- Make Keyguard setup a required startup task instead
- Update Profile Guard setup modal to work within WelcomeWizard context

### Files to Modify
- `electron/renderer/src/App.vue` - Add WelcomeWizard state, template, and logic
- `electron/ipc-handlers.js` - Update Keyguard setup handlers if needed

---

## 2. IPC Handler Refactoring

### Purpose
Refactor all profile-related IPC handlers to use `OnlineProfileManager` instead of ad-hoc csettings manipulation. This consolidates profile storage logic and ensures consistency.

### Tasks to Implement

#### A. Update Handler Registration
In `registerDatabaseHandlers()`, create `OnlineProfileManager` instance:
```javascript
const OnlineProfileManager = require('./utils/OnlineProfileManager');

// In each handler that needs it:
const keyguardKey = getKeyguardKey(event);
const profileManager = new OnlineProfileManager(dbManager, keyguardKey);
```

#### B. Refactor Profile Handlers

**Handler: `online:profile:get`**
- Use `profileManager.getCurrentProfile()` instead of loading from csettings
- Return profile with metadata

**Handler: `online:profile:save`**
- Use `profileManager.saveProfile(profileData)`
- Automatically syncs to csettings for backward compatibility
- Saves to `user_profiles` table

**Handler: `online:profile:create-new`**
- Use `profileManager.saveProfile(profileData)`
- Use `profileManager.setCurrentProfileId(profileUuid)` if first profile
- Migrate keypairs to `profile_keypairs` table

**Handler: `online:profile:switch`**
- Use `profileManager.getProfile(profileUuid)` to load target
- Use `profileManager.setCurrentProfileId(profileUuid)` to switch
- Sync to csettings

**Handler: `online:profile:delete`**
- Use `profileManager.deleteProfile(profileUuid)`
- Handle switching to another profile if current was deleted

**Handler: `online:profile:list`**
- Use `profileManager.listProfiles()`
- Return profiles with metadata

#### C. Refactor Keypair Handlers

**Handler: `online:keypair:create`**
- After creating keypair, save to `profile_keypairs` table using `profileManager.saveProfileKeypair()`
- Update profile JSON to reference keypair UUIDs instead of embedding full keypair data

**Handler: `online:keypair:list` (for profile keypairs)**
- Use `profileManager.getProfileKeypairs(profileUuid)`
- Return keypairs from database

**Handler: `online:keypair:delete` (for profile keypairs)**
- Use `profileManager.deleteProfileKeypair(keypairUuid)`
- Update profile JSON to remove keypair reference

#### D. Refactor Publication Handlers

**Handler: `online:publish-profile-to-nostr`**
- Use `profileManager.publishProfileToNostr(profileUuid)`
- Automatically marks profile as published

**Handler: `online:check-profile-for-publishing`**
- Use `profileManager.getCurrentProfile()`
- Check if primary keypair is Nostr type
- Check `profileManager.hasUnpublishedEdits(profileUuid)`

#### E. Migration Helper
Create one-time migration function:
```javascript
async function migrateProfilesFromCsettings(dbManager, keyguardKey) {
  const profileManager = new OnlineProfileManager(dbManager, keyguardKey);
  const currentProfileId = profileManager.getCurrentProfileId();
  
  if (currentProfileId) {
    await profileManager.migrateProfileFromCsettings(currentProfileId);
  }
  
  // Also migrate standby profiles
  // ... (load from standby_profiles and migrate each)
}
```

Call this migration on first startup after migrations are applied.

#### F. Backward Compatibility
- Keep `online_profile` csetting synced (read-only from database)
- Keep `online_current_profile_id` csetting synced
- Existing code that reads from csettings will continue to work
- Gradually migrate all code to use OnlineProfileManager

### Files to Modify
- `electron/ipc-handlers.js` - Refactor all `online:profile:*` and `online:keypair:*` handlers
- `electron/utils/OnlineProfileManager.js` - Already complete ✅

---

## Implementation Order

### Phase 1: Complete OnlineProfileManager ✅
- ✅ Database migrations
- ✅ OnlineProfileManager class
- ✅ Profile CRUD operations
- ✅ Keypair management
- ✅ Nostr publication
- ✅ Migration helpers

### Phase 2: IPC Handler Refactoring
1. Update handler registration to create OnlineProfileManager instances
2. Refactor `online:profile:*` handlers one by one
3. Refactor `online:keypair:*` handlers for profile keypairs
4. Refactor publication handlers
5. Add migration helper and call on startup
6. Test backward compatibility

### Phase 3: WelcomeWizard Framework
1. Add WelcomeWizard state variables
2. Create `checkWelcomeTasks()` function
3. Add WelcomeWizard modal template
4. Create task components
5. Integrate with startup (`onMounted`)
6. Update Keyguard setup to work within WelcomeWizard
7. Test task flow

---

## Testing Checklist

### OnlineProfileManager
- [ ] Profile CRUD operations work correctly
- [ ] Keypair management works correctly
- [ ] Nostr publication works correctly
- [ ] Migration from csettings works correctly
- [ ] Backward compatibility (csettings sync) works correctly

### IPC Handler Refactoring
- [ ] All profile handlers work correctly
- [ ] All keypair handlers work correctly
- [ ] Publication handlers work correctly
- [ ] Migration runs on first startup
- [ ] Existing code still works (backward compatibility)

### WelcomeWizard
- [ ] Detects required tasks correctly
- [ ] Shows modal on startup if tasks exist
- [ ] Blocks app usage until tasks complete
- [ ] Task flow works correctly
- [ ] Keyguard setup works within wizard
- [ ] Keyguard unlock works within wizard
- [ ] High security mode unlock works within wizard
- [ ] "Forgot passphrase" option works correctly

---

## Notes

- **Backward Compatibility**: The `online_profile` csetting will continue to be synced from the database, so existing code that reads from csettings will continue to work during the transition period.

- **Migration**: The migration from csettings to database tables should be automatic and run on first startup after the migrations are applied.

- **WelcomeWizard**: The wizard should be non-dismissible until all tasks are complete, ensuring users can't skip required setup steps.

- **Task Flow**: Tasks can display dialog boxes on top of the modal (like Profile Guard setup/unlock), and the wizard automatically moves to the next task after completion.

