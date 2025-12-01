# Twitch Predictions Workflow Design

**Date**: 2025-01-XX  
**Status**: Design Document

---

## Overview

This document describes the workflow for managing Twitch predictions during active challenge runs. The system supports both whole-run predictions and per-item predictions with multiple operational modes.

---

## UI Components

### Prediction Control Button

**Location**: Prepare Run dialog (Active Run Mode), right column below action buttons

**States**:

1. **Not Setup / Not Enabled**:
   - Button text: `"Off: Press Setup First"`
   - Disabled (non-clickable)
   - Status message: "Predictions not configured"

2. **Setup Complete / Off**:
   - Button text: `"Manage Predictions (Off)"`
   - Clickable, opens dropdown menu
   - Status message: "Off: Toggle on to create and automate predictions."

3. **Setup Complete / On**:
   - Button text: `"Manage Predictions (On)"`
   - Clickable, opens dropdown menu
   - Status message: "On: Prediction automation live"

---

## Dropdown Menu Options

### When Status is "Off"

The dropdown shows three options:

1. **Create full Run predictions**
   - Creates a single prediction for the entire run
   - Title: "How many total challenge items will we win?"
   - Outcomes: Based on total challenges (2 outcomes: Less/More, or 3-10 range outcomes)
   - Window: Configurable (default 10 minutes, can be 30 seconds+)
   - Auto-locks when run completes or when Done/Skip is clicked on final challenge

2. **Create Item Predictions (same items)**
   - Creates predictions for the current active challenge item
   - When turned On: Immediately creates prediction for current item
   - Prediction locks after short time (configurable window)
   - Resolves when Done or Skip is clicked on that item
   - After item completes, automatically creates prediction for next item when it becomes active
   - All items can have predictions (no alternation)

3. **Create Item Predictions (next item, alternates)**
   - Creates predictions for the **next** challenge item (not current)
   - When turned On: Creates prediction for the item after the current one
   - Clicking Done/Skip on current item does NOT resolve the prediction (it's about the next item)
   - Prediction resolves when Done/Skip is clicked on the item it pertains to
   - After resolution, creates prediction for the item following the just-completed one
   - **Tradeoff**: Only half the challenge items can have predictions (alternates)
   - **Benefit**: Longer prediction window, greater fairness (prediction open during previous challenge)

### When Status is "On"

The dropdown shows three options:

1. **Turn off and cancel prediction**
   - Cancels current active prediction (if any)
   - Refunds channel points
   - Stops further prediction automation

2. **Turn off and resolve (closest match)**
   - Resolves current active prediction to closest matching outcome
   - Stops further prediction automation
   - Leaves prediction resolved on Twitch

3. **Turn off and leave prediction open**
   - Stops further prediction automation
   - Leaves prediction active on Twitch (user manages manually)

---

## Prediction Lifecycle Management

### Database Persistence

**Tables Used**:
- `twitch_predictions`: Tracks prediction metadata, status, and associations
- `csettings`: Stores prediction template configuration

**Key Fields**:
- `prediction_uuid`: Local UUID for tracking
- `twitch_prediction_id`: Twitch's prediction ID
- `run_uuid`: Associated run (for whole challenge predictions)
- `challenge_sequence_number`: Associated challenge (for item predictions)
- `local_status`: Our desired status ('created', 'locked', 'resolved', 'cancelled', 'released')
- `twitch_status`: Actual Twitch API status ('ACTIVE', 'LOCKED', 'RESOLVED', 'CANCELED')
- `prediction_type`: 'whole_challenge' or 'individual_item'
- `prediction_subtype`: 'yes_no' or 'time_range' (for individual_item)

### Status Synchronization

**When to Reload Status**:
- When run starts
- When Done/Skip is clicked
- When prediction management is toggled
- On application startup/resume

**Process**:
1. Load prediction status from local database
2. Query Twitch API for current status of active prediction
3. Compare local vs. Twitch status
4. If mismatch:
   - If Twitch says prediction doesn't exist: Abandon local tracking
   - If Twitch status is ahead: Update local status (not to overwrite our desired status)
   - If local has pending action: Attempt to apply action

### Action Queueing

**Maximum Queue Size**:
- One resolve/cancel/lock action per prediction
- One create action (pending until current prediction is resolved/cancelled)

**Error Handling**:
- **Temporary errors** (network, rate limit): Queue action for retry
- **Permanent errors** (prediction doesn't exist): Abandon prediction, clear queue
- **Twitch reports prediction cancelled/resolved externally**: Update local status, clear queue

### Prediction Creation Workflow

**Before Creating**:
1. Check Twitch API for existing active predictions
2. If prediction exists that we don't manage:
   - Prompt user: "A prediction exists on Twitch that we don't manage. Cancel it to proceed?"
   - If user confirms: Cancel external prediction
   - If user declines: Block creation until external prediction is resolved
3. If prediction exists that we manage:
   - Verify it matches our expected state
   - If mismatch: Update local status, handle accordingly

**Creation Process**:
1. Verify no unmanaged predictions exist
2. Get prediction template from csettings
3. Calculate outcomes based on template type
4. Create prediction via Twitch API
5. Store prediction metadata in database
6. Set local status to 'created'
7. Begin monitoring lifecycle

### Prediction Resolution Workflow

**When Done/Skip is Clicked**:

1. **Reload Status**:
   - Load from database
   - Query Twitch API for current status

2. **Determine Action**:
   - If prediction is for current item (same item mode):
     - Lock if window hasn't expired
     - Resolve to outcome based on result
   - If prediction is for next item (next item mode):
     - Do nothing (prediction is about next item)
   - If prediction is for previous item:
     - Resolve to outcome based on result

3. **Apply Action**:
   - Update database with desired outcome
   - Call Twitch API to lock/resolve
   - If temporary error: Queue for retry
   - If permanent error: Abandon prediction

4. **Create Next Prediction** (if applicable):
   - If "same item" mode: Create for next item when it becomes active
   - If "next item" mode: Create for item after the one that just completed

### Item-Specific Prediction Cancellation

**When to Cancel**:
- User clicks Done/Skip before prediction window expires
- User moves to next challenge before prediction window expires
- Prediction is for an item that is no longer active

**Process**:
- Cancel and refund prediction
- Clear pending creation for that item
- If in "next item" mode: Create prediction for new next item

---

## Prediction Title and Metadata

**Title Format**:
- Include game ID and stage ID (if applicable) in prediction titles
- Example: "Will we win at challenge item 3 (Game: 12345, Stage: 001)?"
- Example: "How many minutes on challenge item 5 (Game: 12345, Stage: 002)?"

**Database Tracking**:
- Store `gameid` and `stageid` (if applicable) with prediction
- Link prediction to specific `challenge_sequence_number`
- Enable querying predictions by run or challenge

---

## Operational Modes Comparison

### Same Item Mode

**Pros**:
- All challenge items can have predictions
- Immediate feedback (prediction about current challenge)
- Simpler logic (prediction always matches active challenge)

**Cons**:
- Shorter prediction window (opens when challenge starts)
- Less time for viewers to participate

### Next Item Mode

**Pros**:
- Longer prediction window (opens during previous challenge)
- More time for viewers to participate
- Greater fairness (prediction open before challenge starts)

**Cons**:
- Only half the items can have predictions (alternates)
- More complex logic (prediction about next item, not current)
- Some challenges cannot have predictions

---

## Error Recovery

### Prediction State Mismatch

**Scenario**: Local database says prediction is 'created', but Twitch API says it's 'RESOLVED'

**Action**:
1. Update local status to 'resolved'
2. Clear any pending actions for that prediction
3. Continue with next prediction creation (if applicable)

### External Prediction Exists

**Scenario**: Twitch has an active prediction we didn't create

**Action**:
1. Block all prediction operations
2. Prompt user to cancel external prediction
3. Once cancelled, resume normal operation

### Temporary API Errors

**Scenario**: Network error or rate limit when resolving prediction

**Action**:
1. Queue the resolution action in database
2. Retry on next status check
3. Clear queue after successful resolution or permanent error

---

## Implementation Notes

### Key Functions Needed

1. **`checkTwitchForActivePredictions()`**: Query Twitch API for active predictions
2. **`createPredictionForRun()`**: Create whole challenge prediction
3. **`createPredictionForItem()`**: Create item prediction (same or next)
4. **`resolvePredictionForItem()`**: Resolve prediction based on challenge result
5. **`cancelPredictionForItem()`**: Cancel prediction if item becomes inactive
6. **`syncPredictionStatus()`**: Synchronize local and Twitch status
7. **`queuePredictionAction()`**: Queue action for retry on error

### Database Schema Extensions

**`twitch_predictions` table** (already exists):
- Add `gameid` field (VARCHAR) - Game ID for item predictions
- Add `stageid` field (VARCHAR) - Stage ID for item predictions (nullable)
- Add `operational_mode` field (VARCHAR) - 'same_item' or 'next_item' (for item predictions)
- Add `pending_action` field (TEXT) - JSON of pending action to retry
- Add `pending_action_retry_count` field (INTEGER) - Number of retry attempts

---

## Future Enhancements

1. **Prediction Analytics**: Track prediction accuracy, viewer participation
2. **Custom Outcome Names**: Allow streamer to customize outcome names per prediction
3. **Prediction Templates**: Save and reuse prediction configurations
4. **Multi-Prediction Support**: Support multiple simultaneous predictions (when Twitch allows)
5. **EventSub Integration**: Real-time updates via Twitch EventSub for prediction status changes

---

## Testing Checklist

- [ ] Create whole challenge prediction on run start
- [ ] Create item prediction (same item) when enabled
- [ ] Create item prediction (next item) when enabled
- [ ] Resolve prediction when Done clicked
- [ ] Resolve prediction when Skip clicked
- [ ] Cancel prediction when item becomes inactive
- [ ] Handle external prediction conflict
- [ ] Handle temporary API errors with retry
- [ ] Handle permanent API errors (prediction doesn't exist)
- [ ] Persist prediction status across app restarts
- [ ] Sync status from database and Twitch API
- [ ] Queue actions for retry on error
- [ ] Alternate predictions in "next item" mode

