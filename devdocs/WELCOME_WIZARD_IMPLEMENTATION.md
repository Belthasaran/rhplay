# WelcomeWizard Implementation Plan

## Overview
The WelcomeWizard is a consolidated modal framework that handles required startup tasks before the user can use the application. It replaces the current ad-hoc approach where Keyguard setup is required before creating the first profile.

## Key Changes

### 1. Database Migrations
- ✅ Created `user_profiles` table (migration 028)
- ✅ Created `profile_keypairs` table (migration 029)
- Both migrations registered in `migratedb.js`

### 2. OnlineProfileManager Class
- ✅ Created `OnlineProfileManager` class in `electron/utils/OnlineProfileManager.js`
- Handles all profile storage operations
- Manages profile_keypairs
- Syncs with csettings for backward compatibility

### 3. WelcomeWizard Framework
**Status: In Progress**

#### State Variables Needed:
- `welcomeWizardOpen` - Controls visibility of welcome wizard modal
- `welcomeTasks` - Array of tasks that need to be completed
- `currentWelcomeTaskIndex` - Index of current task being displayed
- `welcomeTaskStatus` - Status of each task (pending, in-progress, completed)

#### Welcome Tasks:
1. **Setup Keyguard** - If Keyguard is not set up
2. **Unlock Keyguard** - If Keyguard is set up but not unlocked
3. **High Security Mode Unlock** - If in high security mode, unlock OR use "Forgot passphrase" to reset

#### Task Flow:
- On app startup, check for required welcome tasks
- If tasks exist, show WelcomeWizard modal (non-dismissible)
- Display current task page
- Tasks can show dialog boxes on top of the modal
- After task completes successfully, move to next task
- When all tasks complete, close wizard and allow app usage

### 4. Startup Logic Changes
- Check for welcome tasks in `onMounted`
- Show WelcomeWizard if tasks are required
- Block app usage until tasks complete

### 5. IPC Handler Refactoring
**Status: Pending**

- Refactor `online:profile:*` handlers to use `OnlineProfileManager`
- Update handlers to save to database tables instead of csettings
- Reload `online_profile` csetting from database after saves

## Implementation Steps

1. ✅ Create database migrations
2. ✅ Create OnlineProfileManager class
3. ⏳ Add WelcomeWizard state variables to App.vue
4. ⏳ Add WelcomeWizard modal template to App.vue
5. ⏳ Add welcome task checking logic
6. ⏳ Integrate with startup (onMounted)
7. ⏳ Refactor IPC handlers to use OnlineProfileManager
8. ⏳ Update Keyguard setup to be required on startup

## Notes

- WelcomeWizard should be non-dismissible until all tasks complete
- Tasks can display dialog boxes (like Profile Guard setup/unlock) on top of the modal
- After a task completes, the wizard automatically moves to the next task
- The wizard should show progress (e.g., "Task 1 of 3")

