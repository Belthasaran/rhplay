# Twitch Predictions Integration

## Overview

This document describes the Twitch Predictions integration feature that allows users to automatically create and manage Twitch Predictions during challenge runs. The integration uses Twitch's Prediction Management API and EventSub for real-time updates.

**Status:** Partial Implementation (Database schema, UI framework, and OAuth setup complete. Prediction automation TODO.)

**Date:** January 2025

## Architecture

### Components

1. **Database Schema** (`053_clientdata_twitch_integration.sql`)
   - `twitch_integration` table: Stores encrypted OAuth tokens per user profile
   - Encrypted storage using profile guard keys
   - Scope tracking for token management

2. **Vue Components**
   - `TwitchIntegrationSetup.vue`: Modal dialog for OAuth setup and token management
   - Predictions controls in Prepare Run dialog (active mode)

3. **Backend Integration** (TODO)
   - OAuth implicit grant flow implementation
   - Token auto-refresh using `@twurple/auth`
   - Prediction creation/management using `@twurple/api`
   - EventSub subscription handling

## Database Schema

### twitch_integration Table

Stores Twitch OAuth tokens encrypted with profile guard keys:

```sql
CREATE TABLE twitch_integration (
    integration_uuid VARCHAR(255) PRIMARY KEY,
    profile_uuid VARCHAR(255) NOT NULL,
    twitch_user_id VARCHAR(255),
    twitch_username VARCHAR(255),
    encrypted_access_token TEXT NOT NULL,
    encrypted_refresh_token TEXT NOT NULL,
    expires_in INTEGER DEFAULT 0,
    obtainment_timestamp INTEGER DEFAULT 0,
    scopes TEXT NOT NULL,
    is_active INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_used_at TIMESTAMP,
    FOREIGN KEY (profile_uuid) REFERENCES user_profiles(profile_uuid),
    UNIQUE(profile_uuid)
);
```

**Security:**
- Tokens are encrypted using AES-256-CBC with profile guard key
- Format: `IV:CIPHERTEXT` (hex encoded)
- Each profile has one integration record

### Predictions Template Configuration

Stored in `csettings` table:

- `predictionsEnabled`: "On" or "Off" (default: "Off")
- `predictionsType`: "whole_challenge" or "individual_item" (null if not set)
- `predictionsTemplate`: JSON configuration

**Template Structure:**

```json
{
  "type": "whole_challenge" | "individual_item",
  "wholeChallenge": {
    "outcomeCount": 5,  // 3-10
    "predictionWindowMinutes": 10
  },
  "individualItem": {
    "predictionType": "yes_no" | "time_range",
    "timeRange": {
      "outcomeCount": 5,  // 3-7, configurable
      "maxTimeMinutes": 60  // or calculated from win rules
    }
  }
}
```

## OAuth Flow

### Implicit Grant Flow

We use the Implicit Grant Flow because our Electron app does not have a remote server:

1. User clicks "Authorize with Twitch" in Twitch Integration Setup
2. Application opens Twitch OAuth URL in browser window:
   ```
   https://id.twitch.tv/oauth2/authorize?
     response_type=token&
     client_id={CLIENT_ID}&
     redirect_uri={REDIRECT_URI}&
     scope=channel:read:predictions+channel:manage:predictions+channel:read:vips+moderator:read:moderators+user:read:chat+moderator:read:chat_messages+moderator:read:chatters+moderator:read:followers+moderator:read:shoutouts+channel:bot&
     state={RANDOM_STATE}
   ```
3. User authorizes in Twitch
4. Redirect URI receives access token in fragment (`#access_token=...`)
5. Application extracts token and stores encrypted
6. Token validated using `/validate` endpoint to get user info and scopes

**Required Scopes:**
- `channel:read:predictions`: Read prediction data
- `channel:manage:predictions`: Create, lock, and end predictions

### Token Auto-Refresh

Using `@twurple/auth` `RefreshingAuthProvider`:

```typescript
import { RefreshingAuthProvider } from '@twurple/auth';

const authProvider = new RefreshingAuthProvider({
  clientId: CLIENT_ID,
  clientSecret: CLIENT_SECRET  // Not used in implicit flow, but required for refresh
});

authProvider.onRefresh(async (userId, newTokenData) => {
  // Save encrypted tokens to database
  await saveTokensToDatabase(userId, newTokenData);
});

await authProvider.addUserForToken({
  accessToken: decryptedAccessToken,
  refreshToken: decryptedRefreshToken,
  expiresIn: expiresIn,
  obtainmentTimestamp: obtainmentTimestamp
});
```

**Note:** Implicit grant flow does not provide refresh tokens. We need to:
1. Request authorization code flow instead (requires server)
2. OR periodically re-authorize (simpler for Electron app)

**Decision:** Use Authorization Code Flow with local redirect handler.

## Prediction Types

### Whole Challenge Predictions

Predictions apply to all remaining challenges after the current one:

- **Title:** "How many total challenge items will we win?"
- **Outcomes:** Based on number of remaining challenges
  - Always include: 0 wins, All wins
  - Divide range into 3-10 outcomes (user configurable)
  - Ranges must be:
    - Whole number boundaries only
    - Inclusive (e.g., "0 to 3" includes 0, 1, 2, 3)
    - Non-overlapping
    - Approximately equal size (except last range)
  
**Example (10 challenges remaining, 5 outcomes):**
- 0
- 1-3
- 4-6
- 7-9
- 10

**Locking:** Automatically locks when current challenge is completed (Done/Skip)

### Individual Item Predictions

Separate prediction for each challenge:

#### Yes/No Prediction

- **Title:** "Will we win at the current challenge item?"
- **Outcomes:**
  - Yes/Success: Click Done and meet win conditions
  - No/Fail: Click Skip

#### Time Range Prediction

- **Title:** "How many minutes do we spend on the current challenge item?"
- **Outcomes:** Time ranges based on challenge time limit
  - Always include: 0 to X minutes
  - Always include: >Max (fails due to time)
  - Divide range into 3-7 outcomes (user configurable)
  - Maximum time = min(60 minutes, challenge time limit + rollover)

**Example (10 minute limit, 5 outcomes):**
- 0 to 5 minutes
- 6 to 10 minutes
- 11 to 15 minutes
- 16 to 20 minutes
- >20 minutes

**Note:** If win rules specify unlimited time, use 60 minutes as maximum.

## API Integration

### Create Prediction

```typescript
POST https://api.twitch.tv/helix/predictions
Headers:
  Authorization: Bearer {access_token}
  Client-Id: {client_id}
  Content-Type: application/json

Body:
{
  "broadcaster_id": "{twitch_user_id}",
  "title": "How many total challenge items will we win?",
  "outcomes": [
    { "title": "0" },
    { "title": "1-3" },
    { "title": "4-6" },
    { "title": "7-9" },
    { "title": "10" }
  ],
  "prediction_window": 600  // seconds
}
```

### Lock Prediction

```typescript
PATCH https://api.twitch.tv/helix/predictions
Headers:
  Authorization: Bearer {access_token}
  Client-Id: {client_id}
  Content-Type: application/json

Body:
{
  "broadcaster_id": "{twitch_user_id}",
  "id": "{prediction_id}",
  "status": "LOCKED"
}
```

### End Prediction

```typescript
PATCH https://api.twitch.tv/helix/predictions
Headers:
  Authorization: Bearer {access_token}
  Client-Id: {client_id}
  Content-Type: application/json

Body:
{
  "broadcaster_id": "{twitch_user_id}",
  "id": "{prediction_id}",
  "status": "RESOLVED",
  "winning_outcome_id": "{winning_outcome_id}"
}
```

## EventSub Integration

Subscribe to prediction events:

### channel.prediction.lock

Triggered when prediction is locked:

```json
{
  "subscription_type": "channel.prediction.lock",
  "event": {
    "id": "prediction-id",
    "broadcaster_user_id": "123456789",
    "broadcaster_user_login": "broadcaster",
    "broadcaster_user_name": "Broadcaster",
    "title": "Prediction title",
    "outcomes": [...],
    "started_at": "2025-01-01T00:00:00Z",
    "locked_at": "2025-01-01T00:05:00Z"
  }
}
```

### channel.prediction.end

Triggered when prediction ends:

```json
{
  "subscription_type": "channel.prediction.end",
  "event": {
    "id": "prediction-id",
    "broadcaster_user_id": "123456789",
    "broadcaster_user_login": "broadcaster",
    "broadcaster_user_name": "Broadcaster",
    "title": "Prediction title",
    "winning_outcome_id": "outcome-id",
    "status": "resolved",
    "ended_at": "2025-01-01T00:10:00Z"
  }
}
```

**Implementation Notes:**
- EventSub requires webhook endpoint (TODO: Implement local webhook receiver)
- For Electron app, consider using WebSocket transport (if available) or polling
- Alternative: Use Twurple EventSub WebSocket transport

## UI Components

### Twitch Integration Setup Modal

Located: `electron/renderer/src/components/TwitchIntegrationSetup.vue`

**Features:**
- Profile guard requirement check
- OAuth authorization flow
- Token status display
- Token refresh test
- Revoke tokens

**Access:**
- Open Settings → Online → Profile & Keys → "Twitch Integration Setup" button

### Predictions Controls (Active Run)

Located in Prepare Run dialog when run is active:

- Column on right side below action buttons
- "Predictions:" label
- "Setup" button (purple) - Opens Twitch Integration Setup if not configured
- On/Off toggle - Enables/disables prediction automation
- Status message:
  - "Predictions not configured"
  - "Off: Toggle on to create and automate predictions."
  - "On: Prediction automation live"

## TODO: Implementation Tasks

### Phase 1: OAuth and Token Management ✅ (Partially Complete)

- [x] Database migration for twitch_integration table
- [x] Vue component structure for Twitch Integration Setup
- [x] UI elements for predictions controls in active run
- [ ] OAuth implicit grant flow implementation
  - [ ] Generate OAuth URL with correct parameters
  - [ ] Open OAuth window in Electron
  - [ ] Handle redirect URI callback
  - [ ] Extract access token from fragment
  - [ ] Validate token and get user info
  - [ ] Encrypt and store tokens
- [ ] Token refresh implementation
  - [ ] Check token expiry before API calls
  - [ ] Implement refresh logic (may require re-authorization)
  - [ ] Update encrypted tokens in database
- [ ] Token revocation
  - [ ] Call Twitch revoke endpoint
  - [ ] Clear tokens from database

### Phase 2: Prediction Template Configuration

- [ ] Predictions template UI in Twitch Integration Setup
- [ ] Whole challenge template configuration
  - [ ] Outcome count selector (3-10)
  - [ ] Prediction window minutes (default 10)
- [ ] Individual item template configuration
  - [ ] Prediction type selector (Yes/No or Time Range)
  - [ ] Time range outcome count (3-7)
- [ ] Save/load template from csettings
- [ ] Validation of template settings

### Phase 3: Prediction Creation Logic

- [ ] Determine prediction type based on template and run state
- [ ] Calculate outcomes for whole challenge predictions
  - [ ] Algorithm for dividing challenge range into outcomes
  - [ ] Ensure inclusive, non-overlapping ranges
- [ ] Calculate outcomes for time range predictions
  - [ ] Get challenge time limit from win rules
  - [ ] Include rollover time in max calculation
  - [ ] Divide time range into outcomes
- [ ] Create prediction via Twitch API
- [ ] Store prediction ID with run/challenge data
- [ ] Error handling for API failures

### Phase 4: Prediction Management

- [ ] Lock prediction when challenge completes
- [ ] Resolve prediction with winning outcome
  - [ ] Whole challenge: Count actual wins
  - [ ] Individual Yes/No: Based on Done/Skip
  - [ ] Individual Time Range: Based on actual time spent
- [ ] Handle prediction errors gracefully
- [ ] Cancel prediction if run is cancelled

### Phase 5: EventSub Integration (Optional)

- [ ] Set up EventSub webhook receiver
- [ ] Subscribe to channel.prediction.lock
- [ ] Subscribe to channel.prediction.end
- [ ] Handle EventSub callbacks
- [ ] Alternative: Poll prediction status if webhooks not feasible

### Phase 6: Testing and Edge Cases

- [ ] Test OAuth flow end-to-end
- [ ] Test token refresh scenarios
- [ ] Test prediction creation with various templates
- [ ] Test prediction locking/resolution
- [ ] Handle network failures
- [ ] Handle token expiry during run
- [ ] Handle multiple active predictions (should not happen)
- [ ] Test with different win rule configurations
- [ ] Test with rollover time scenarios

## Security Considerations

1. **Token Storage:**
   - Tokens must always be encrypted with profile guard key
   - Never log tokens in plaintext
   - Redact tokens from error messages

2. **OAuth Security:**
   - Use random state parameter to prevent CSRF
   - Validate state on callback
   - Use HTTPS redirect URI (even for localhost)

3. **Scope Management:**
   - Track which scopes are granted
   - Warn user if additional scopes are needed
   - Provide mechanism to re-authorize with new scopes

4. **Profile Guard:**
   - Integration setup requires profile guard to be enabled
   - Tokens cannot be decrypted without profile guard key

## References

- [Twitch OAuth Documentation](https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/)
- [Twitch Predictions API](https://dev.twitch.tv/docs/api/reference#create-prediction)
- [Twitch EventSub Documentation](https://dev.twitch.tv/docs/eventsub/)
- [Twurple.js Documentation](https://twurple.js.org/)
- [Twurple Auth Providers](https://twurple.js.org/docs/auth/providers/refreshing)

## Migration

To apply the database migration:

```bash
# Default location
npm run client:migrate

# Custom location
node jsutils/migratedb.js --db /path/to/clientdata.db
```

Migration file: `electron/sql/migrations/053_clientdata_twitch_integration.sql`

