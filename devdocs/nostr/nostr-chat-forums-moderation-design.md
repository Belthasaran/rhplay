# IRC Chat, Forums & Moderation System Design for Nostr

## Table of Contents
1. [Architecture Overview](#architecture-overview)
2. [IRC-Style Chat System](#irc-style-chat-system)
3. [Forum System](#forum-system)
4. [Permission System](#permission-system)
5. [Moderation System](#moderation-system)
6. [Delegation System](#delegation-system)
7. [Client Implementation](#client-implementation)
8. [Admin Tools](#admin-tools)
9. [Complete Code Examples](#complete-code-examples)

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│                    ADMIN PUBLISHED METADATA                   │
│  • Channel Definitions (kind 31100)                          │
│  • Forum Definitions (kind 31101)                            │
│  • Permission Rules (kind 31102)                             │
│  • Moderation Actions (kind 31103)                           │
│  • Moderator Delegations (kind 31104)                        │
│  • Update Delegations (kind 31105)                           │
└────────────────────┬─────────────────────────────────────────┘
                     │
                     ↓
┌──────────────────────────────────────────────────────────────┐
│                    USER CONTENT EVENTS                        │
│  • Chat Messages (kind 42)                                   │
│  • Forum Posts (kind 30024)                                  │
│  • Forum Replies (kind 1111)                                 │
└────────────────────┬─────────────────────────────────────────┘
                     │
                     ↓
┌──────────────────────────────────────────────────────────────┐
│                    CLIENT-SIDE FILTERING                      │
│  1. Load all admin metadata                                  │
│  2. Check user permissions                                   │
│  3. Apply moderation blocks                                  │
│  4. Filter/hide unauthorized content                         │
│  5. Prevent submission of blocked content                    │
└──────────────────────────────────────────────────────────────┘
```

### Design Principles

1. **Admin Authority**: All system configuration via admin-signed events
2. **Client Enforcement**: Clients enforce rules (can't trust everyone)
3. **Fail-Secure**: Unknown/unparseable rules = deny access
4. **Time-Based**: All permissions and blocks support time ranges
5. **Hierarchical**: Permissions cascade (global → specific)
6. **Transparent**: All moderation actions are visible (signed events)

---

## IRC-Style Chat System

### Event Structures

#### Channel Definition (Kind 31100)

Admin-published event defining a chat channel.

```json
{
  "kind": 31100,
  "pubkey": "admin_pubkey",
  "created_at": 1699123456,
  "tags": [
    ["d", "channel:general"],
    ["app", "gameratings"],
    ["v", "1.0"]
  ],
  "content": "ENCRYPTED_CONTENT",
  "sig": "admin_signature"
}
```

**Encrypted Content:**
```json
{
  "channel_id": "general",
  "name": "#general",
  "topic": "General discussion about all games",
  "description": "Main chat for the community",
  "created_at": 1699123456,
  "updated_at": 1699123456,
  
  "settings": {
    "read_access": "public",      // public, premium, private, custom
    "write_access": "verified",    // verified, premium, moderator, custom
    "encryption": "public",        // public, premium, private, per-user
    "encryption_key": null,        // If using shared key encryption
    "allowed_users": [],           // If private/custom: list of pubkeys
    "rate_limit": {
      "messages_per_minute": 10,
      "burst": 3
    },
    "max_message_length": 500,
    "allow_markdown": true,
    "allow_mentions": true,
    "allow_links": true,
    "slow_mode": null              // Seconds between messages (null = disabled)
  },
  
  "metadata": {
    "color": "#0084ff",
    "icon": "💬",
    "position": 1,                 // Display order
    "parent_category": null,       // For organizing channels
    "archived": false
  }
}
```

#### Channel List Event (Kind 31100)

Special channel definition that lists all channels.

```json
{
  "kind": 31100,
  "pubkey": "admin_pubkey",
  "tags": [
    ["d", "channel:_list"],        // Special _list identifier
    ["app", "gameratings"]
  ],
  "content": "ENCRYPTED_CONTENT"
}
```

**Encrypted Content:**
```json
{
  "channel_list": [
    {
      "channel_id": "general",
      "name": "#general",
      "description": "General discussion",
      "position": 1
    },
    {
      "channel_id": "help",
      "name": "#help",
      "description": "Get help with games",
      "position": 2
    },
    {
      "channel_id": "game:9671",
      "name": "#another-mario-hack",
      "description": "Chat for Another Mario Hack",
      "position": 100,
      "game_specific": true,
      "gameid": "9671"
    }
  ],
  "categories": [
    {
      "id": "main",
      "name": "Main Channels",
      "position": 1
    },
    {
      "id": "games",
      "name": "Game Channels",
      "position": 2
    }
  ]
}
```

#### Chat Message (Kind 42 - Standard Nostr Channel Message)

```json
{
  "kind": 42,
  "pubkey": "user_pubkey",
  "created_at": 1699123456,
  "tags": [
    ["e", "channel_create_event_id", "", "root"],  // Channel root
    ["h", "general"],                               // Channel ID for filtering
    ["p", "mentioned_user_pubkey"],                 // Mentions
    ["app", "gameratings"]
  ],
  "content": "Hey everyone! Just finished level 3!",
  "sig": "user_signature"
}
```

**For Encrypted Channels:**
```json
{
  "kind": 42,
  "tags": [
    ["e", "channel_create_event_id", "", "root"],
    ["h", "premium-members"],
    ["encryption", "shared"],       // or "per-user"
    ["app", "gameratings"]
  ],
  "content": "ENCRYPTED_MESSAGE"
}
```

---

## Forum System

### Event Structures

#### Forum Definition (Kind 31101)

Admin-published event defining a forum.

```json
{
  "kind": 31101,
  "pubkey": "admin_pubkey",
  "created_at": 1699123456,
  "tags": [
    ["d", "forum:strategy"],
    ["app", "gameratings"],
    ["v", "1.0"]
  ],
  "content": "ENCRYPTED_CONTENT",
  "sig": "admin_signature"
}
```

**Encrypted Content:**
```json
{
  "forum_id": "strategy",
  "name": "Strategy & Tips",
  "description": "Share your strategies and tips for all games",
  "created_at": 1699123456,
  "updated_at": 1699123456,
  
  "settings": {
    "read_access": "public",       // public, premium, private, custom
    "post_access": "verified",     // verified, premium, moderator, custom
    "reply_access": "verified",    // Who can reply to posts
    "encryption": "public",        // public, premium, private, per-user
    "encryption_key": null,
    "allowed_posters": [],         // If custom: list of pubkeys
    "allowed_readers": [],         // If private: list of pubkeys
    
    "moderation": {
      "require_approval": false,   // New posts need mod approval
      "allow_anonymous": false,    // Allow unverified users
      "max_post_length": 10000,
      "max_reply_length": 5000,
      "allow_images": true,
      "allow_attachments": false
    }
  },
  
  "metadata": {
    "color": "#00ff00",
    "icon": "🎮",
    "position": 1,
    "category": "main",
    "pinned_posts": [],            // List of pinned post event IDs
    "archived": false
  },
  
  "type": "global"                 // "global" or "game-specific"
}
```

#### Game-Specific Forum (Auto-Generated)

```json
{
  "forum_id": "game:9671",
  "name": "Another Mario Hack - Discussion",
  "description": "Discussion forum for Another Mario Hack",
  "type": "game-specific",
  "gameid": "9671",
  "settings": {
    "read_access": "public",
    "post_access": "verified",
    "reply_access": "verified"
  }
}
```

#### Forum List Event (Kind 31101)

```json
{
  "kind": 31101,
  "pubkey": "admin_pubkey",
  "tags": [
    ["d", "forum:_list"],
    ["app", "gameratings"]
  ],
  "content": "ENCRYPTED_CONTENT"
}
```

**Encrypted Content:**
```json
{
  "forums": [
    {
      "forum_id": "general",
      "name": "General Discussion",
      "description": "General gaming topics",
      "category": "main",
      "position": 1
    },
    {
      "forum_id": "strategy",
      "name": "Strategy & Tips",
      "description": "Game strategies",
      "category": "main",
      "position": 2
    },
    {
      "forum_id": "showcases",
      "name": "Showcases",
      "description": "Show off your gameplay",
      "category": "community",
      "position": 3
    }
  ],
  "categories": [
    {
      "id": "main",
      "name": "Main Forums",
      "position": 1
    },
    {
      "id": "community",
      "name": "Community",
      "position": 2
    },
    {
      "id": "games",
      "name": "Game-Specific Forums",
      "position": 3,
      "auto_generated": true
    }
  ]
}
```

#### Forum Post (Kind 30024 - Long-form Content)

```json
{
  "kind": 30024,
  "pubkey": "user_pubkey",
  "created_at": 1699123456,
  "tags": [
    ["d", "post:strategy:uuid"],
    ["h", "strategy"],                    // Forum ID
    ["title", "Best strategies for speedrunning"],
    ["t", "speedrun"],                    // Tags
    ["t", "strategy"],
    ["published_at", "1699123456"],
    ["app", "gameratings"]
  ],
  "content": "# Speedrunning Tips\n\nHere are my top strategies...",
  "sig": "user_signature"
}
```

**Encrypted Post:**
```json
{
  "kind": 30024,
  "tags": [
    ["d", "post:premium:uuid"],
    ["h", "premium-forum"],
    ["encryption", "shared"],
    ["title", "ENCRYPTED"],              // Encrypt title too
    ["app", "gameratings"]
  ],
  "content": "ENCRYPTED_MARKDOWN_CONTENT"
}
```

#### Forum Reply (Kind 1111 - Custom Reply Type)

```json
{
  "kind": 1111,
  "pubkey": "user_pubkey",
  "created_at": 1699123456,
  "tags": [
    ["e", "post_event_id", "", "root"],   // Original post
    ["e", "parent_reply_id", "", "reply"], // Parent comment (if nested)
    ["h", "strategy"],                     // Forum ID
    ["p", "post_author_pubkey"],           // Notify post author
    ["p", "parent_author_pubkey"],         // Notify parent author
    ["app", "gameratings"]
  ],
  "content": "Great tips! I also found that...",
  "sig": "user_signature"
}
```

---

## Permission System

### Permission Rule Event (Kind 31102)

Admin-published event defining permission rules.

```json
{
  "kind": 31102,
  "pubkey": "admin_pubkey",
  "created_at": 1699123456,
  "tags": [
    ["d", "permissions:chat:general"],
    ["scope", "channel"],              // channel, forum, post, global-chat, global-forum
    ["target", "general"],             // Channel/forum/post ID
    ["app", "gameratings"],
    ["v", "1.0"]
  ],
  "content": "ENCRYPTED_CONTENT",
  "sig": "admin_signature"
}
```

**Encrypted Content:**
```json
{
  "rule_id": "permissions:chat:general",
  "scope": "channel",
  "target": "general",
  "created_at": 1699123456,
  "updated_at": 1699123456,
  "valid_from": null,                // Unix timestamp or null (immediate)
  "valid_until": null,               // Unix timestamp or null (indefinite)
  
  "rules": {
    "read": {
      "default": "allow",            // allow, deny, require
      "require": [],                 // Empty = no requirements
      "allowed_users": [],           // Whitelist (if not empty, only these)
      "denied_users": []             // Blacklist
    },
    
    "write": {
      "default": "require",
      "require": ["verified"],       // ["verified", "premium", "moderator"]
      "allowed_users": [],
      "denied_users": []
    },
    
    "encryption": {
      "type": "public",              // public, shared, per-user
      "key": null,                   // Shared key if type=shared
      "allowed_readers": []          // Pubkeys if type=per-user
    }
  }
}
```

#### Permission Levels

```javascript
const PERMISSION_LEVELS = {
  // Built-in levels
  PUBLIC: {
    id: 'public',
    name: 'Public',
    description: 'Everyone can access'
  },
  
  VERIFIED: {
    id: 'verified',
    name: 'Verified',
    description: 'Must have verified external identity',
    check: (user, client) => client.isUserVerified(user.pubkey)
  },
  
  PREMIUM: {
    id: 'premium',
    name: 'Premium Member',
    description: 'Must have premium subscription',
    check: (user, client) => user.accessLevel >= 1
  },
  
  MODERATOR: {
    id: 'moderator',
    name: 'Moderator',
    description: 'Designated moderator',
    check: (user, client) => client.isUserModerator(user.pubkey)
  },
  
  // Custom levels (admin-defined)
  STAFF: {
    id: 'staff',
    name: 'Staff',
    description: 'Staff members',
    check: (user, client) => {
      const staffList = client.getStaffList();
      return staffList.includes(user.pubkey);
    }
  },
  
  CONTRIBUTOR: {
    id: 'contributor',
    name: 'Contributor',
    description: 'Game contributors',
    check: (user, client) => {
      const contributors = client.getContributorList();
      return contributors.includes(user.pubkey);
    }
  }
};
```

#### Permission Check Example

```javascript
/**
 * Check if user has permission to perform action
 */
function checkPermission(user, action, scope, target, client) {
  // action: 'read', 'write', 'reply'
  // scope: 'channel', 'forum', 'post'
  // target: ID of channel/forum/post
  
  // 1. Load permission rules for this target
  const rules = client.getPermissionRules(scope, target);
  if (!rules) {
    // No rules = deny by default (fail-secure)
    return false;
  }
  
  // 2. Check time validity
  const now = Math.floor(Date.now() / 1000);
  if (rules.valid_from && now < rules.valid_from) return false;
  if (rules.valid_until && now > rules.valid_until) return false;
  
  const actionRules = rules.rules[action];
  if (!actionRules) return false;
  
  // 3. Check blacklist
  if (actionRules.denied_users.includes(user.pubkey)) {
    return false;
  }
  
  // 4. Check whitelist (if present)
  if (actionRules.allowed_users.length > 0) {
    if (!actionRules.allowed_users.includes(user.pubkey)) {
      return false;
    }
  }
  
  // 5. Check requirements
  if (actionRules.require && actionRules.require.length > 0) {
    for (const requirement of actionRules.require) {
      const level = PERMISSION_LEVELS[requirement.toUpperCase()];
      if (!level) continue;
      
      if (level.check && !level.check(user, client)) {
        return false;
      }
    }
  }
  
  // 6. Check default
  if (actionRules.default === 'deny') {
    return false;
  }
  
  return true;
}
```

---

## Moderation System

### Moderation Action Event (Kind 31103)

Admin or moderator-published event for moderation actions.

```json
{
  "kind": 31103,
  "pubkey": "moderator_pubkey",
  "created_at": 1699123456,
  "tags": [
    ["d", "block:user:abcd1234"],
    ["action", "block"],               // block, freeze, warn, delete
    ["target_type", "user"],           // user, post, channel, forum
    ["target_id", "user_pubkey_hex"],
    ["scope", "global"],               // global, channel, forum, post
    ["app", "gameratings"],
    ["v", "1.0"]
  ],
  "content": "ENCRYPTED_CONTENT",
  "sig": "moderator_signature"
}
```

**Encrypted Content:**
```json
{
  "moderation_id": "block:user:abcd1234",
  "action": "block",
  "target_type": "user",
  "target_id": "user_pubkey_hex",
  "scope": "global",                   // or specific channel/forum ID
  
  "timing": {
    "start_time": 1699123456,          // When block starts
    "end_time": null,                  // null = indefinite
    "duration_seconds": null           // Alternative to end_time
  },
  
  "details": {
    "reason": "Spam posting",
    "moderator": "moderator_pubkey",
    "moderator_name": "Admin",
    "evidence": ["event_id1", "event_id2"],  // Related events
    "severity": "high",                // low, medium, high, critical
    "public_reason": "Violating community guidelines",  // Shown to users
    "private_notes": "Pattern of spam links in multiple channels"
  },
  
  "restrictions": {
    "block_posting": true,
    "block_reading": false,
    "hide_history": true,              // Hide past posts
    "auto_delete": false               // Auto-delete future posts
  },
  
  "appeal": {
    "can_appeal": true,
    "appeal_after": 1699123456 + 86400,  // Can appeal after 24 hours
    "appeal_contact": "admin@example.com"
  }
}
```

#### Types of Moderation Actions

```javascript
const MODERATION_ACTIONS = {
  BLOCK: {
    id: 'block',
    name: 'Block',
    description: 'Prevent user from posting',
    affects: ['posting']
  },
  
  FREEZE: {
    id: 'freeze',
    name: 'Freeze',
    description: 'Temporarily disable channel/forum/thread',
    affects: ['reading', 'posting']
  },
  
  HIDE: {
    id: 'hide',
    name: 'Hide',
    description: 'Hide specific posts/messages',
    affects: ['visibility']
  },
  
  WARN: {
    id: 'warn',
    name: 'Warning',
    description: 'Issue warning to user (logged)',
    affects: ['record']
  },
  
  DELETE: {
    id: 'delete',
    name: 'Delete',
    description: 'Mark content for deletion',
    affects: ['visibility']
  },
  
  MUTE: {
    id: 'mute',
    name: 'Mute',
    description: 'Prevent user from posting for short period',
    affects: ['posting']
  },
  
  SLOW_MODE: {
    id: 'slow_mode',
    name: 'Slow Mode',
    description: 'Rate limit specific user',
    affects: ['rate_limit']
  }
};
```

#### Scope of Moderation

```javascript
const MODERATION_SCOPES = {
  GLOBAL_CHAT: 'global-chat',        // All chat channels
  GLOBAL_FORUM: 'global-forum',      // All forums
  CHANNEL: 'channel',                // Specific chat channel
  FORUM: 'forum',                    // Specific forum
  POST: 'post',                      // Specific forum thread
  USER: 'user'                       // Specific user (across all)
};
```

#### Moderation List Event (Kind 31103)

```json
{
  "kind": 31103,
  "pubkey": "admin_pubkey",
  "tags": [
    ["d", "moderation:_active"],       // Special _active identifier
    ["app", "gameratings"]
  ],
  "content": "ENCRYPTED_CONTENT"
}
```

**Encrypted Content:**
```json
{
  "active_blocks": [
    {
      "moderation_id": "block:user:abc123",
      "target_id": "user_pubkey",
      "target_type": "user",
      "scope": "global",
      "start_time": 1699123456,
      "end_time": null,
      "reason": "Spam"
    },
    {
      "moderation_id": "freeze:channel:help",
      "target_id": "help",
      "target_type": "channel",
      "scope": "channel",
      "start_time": 1699123456,
      "end_time": 1699209856,
      "reason": "Maintenance"
    }
  ],
  "last_updated": 1699123456
}
```

#### Client-Side Enforcement

```javascript
/**
 * Check if content is blocked by moderation
 */
function isContentBlocked(content, client) {
  const now = Math.floor(Date.now() / 1000);
  const blocks = client.getModerationBlocks();
  
  for (const block of blocks) {
    // Check if block is active
    if (block.start_time > now) continue;
    if (block.end_time && block.end_time < now) continue;
    
    // Check if block applies to this content
    switch (block.target_type) {
      case 'user':
        if (content.pubkey === block.target_id) {
          return true;
        }
        break;
        
      case 'channel':
        const channelTag = content.tags.find(t => t[0] === 'h');
        if (channelTag && channelTag[1] === block.target_id) {
          return true;
        }
        break;
        
      case 'forum':
        const forumTag = content.tags.find(t => t[0] === 'h');
        if (forumTag && forumTag[1] === block.target_id) {
          return true;
        }
        break;
        
      case 'post':
        const postTag = content.tags.find(t => t[0] === 'e' && t[3] === 'root');
        if (postTag && postTag[1] === block.target_id) {
          return true;
        }
        break;
    }
  }
  
  return false;
}

/**
 * Check if user can post to target
 */
function canUserPost(user, scope, target, client) {
  const now = Math.floor(Date.now() / 1000);
  const blocks = client.getModerationBlocks();
  
  // Check user-specific blocks
  for (const block of blocks) {
    if (block.target_type !== 'user') continue;
    if (block.target_id !== user.pubkey) continue;
    
    // Check if block is active
    if (block.start_time > now) continue;
    if (block.end_time && block.end_time < now) continue;
    
    // Check if block applies to this scope
    if (block.scope === 'global' || 
        block.scope === 'global-chat' || 
        block.scope === 'global-forum' ||
        block.scope === target) {
      return false;
    }
  }
  
  // Check target-specific blocks (frozen channels/forums)
  for (const block of blocks) {
    if (block.target_type === scope && block.target_id === target) {
      if (block.start_time <= now && 
          (!block.end_time || block.end_time >= now)) {
        return false;
      }
    }
  }
  
  return true;
}
```

---

## Delegation System

### Moderator Delegation (Kind 31104)

Admin-published event delegating moderator powers.

```json
{
  "kind": 31104,
  "pubkey": "admin_pubkey",
  "created_at": 1699123456,
  "tags": [
    ["d", "moderator:user123"],
    ["delegated_to", "moderator_pubkey"],
    ["app", "gameratings"],
    ["v", "1.0"]
  ],
  "content": "ENCRYPTED_CONTENT",
  "sig": "admin_signature"
}
```

**Encrypted Content:**
```json
{
  "delegation_id": "moderator:user123",
  "delegated_to": "moderator_pubkey",
  "delegated_by": "admin_pubkey",
  "created_at": 1699123456,
  
  "validity": {
    "valid_from": 1699123456,
    "valid_until": 1699209856,         // Time-limited
    "duration_seconds": 86400
  },
  
  "scope": {
    "type": "channel",                 // global, global-chat, global-forum, channel, forum, post
    "targets": ["general", "help"],    // Specific channels/forums
    "exclude": []                      // Excluded targets
  },
  
  "powers": {
    "can_block_users": true,
    "can_delete_messages": true,
    "can_freeze_threads": true,
    "can_warn_users": true,
    "can_mute_users": true,
    "can_pin_messages": false,
    "can_edit_channel_settings": false,
    
    "max_block_duration": 86400,      // 24 hours max
    "requires_reason": true,
    "actions_logged": true
  },
  
  "metadata": {
    "name": "Community Moderator",
    "role": "Channel Moderator",
    "contact": "mod@example.com",
    "public_identity": "ModUsername"
  }
}
```

### Update Delegation (Kind 31105)

Admin-published event delegating game metadata update powers.

```json
{
  "kind": 31105,
  "pubkey": "admin_pubkey",
  "created_at": 1699123456,
  "tags": [
    ["d", "updater:user456"],
    ["delegated_to", "updater_pubkey"],
    ["app", "gameratings"],
    ["v", "1.0"]
  ],
  "content": "ENCRYPTED_CONTENT",
  "sig": "admin_signature"
}
```

**Encrypted Content:**
```json
{
  "delegation_id": "updater:user456",
  "delegated_to": "updater_pubkey",
  "delegated_by": "admin_pubkey",
  "created_at": 1699123456,
  
  "validity": {
    "valid_from": 1699123456,
    "valid_until": 1702123456,         // Valid for 30 days
    "duration_seconds": 2592000
  },
  
  "scope": {
    "game_scope": "specific",          // all, new, specific
    "gameids": ["9671", "9672"],       // If specific
    "versions": "all"                  // all, latest, specific
  },
  
  "allowed_operations": {
    "can_create_new_games": false,
    "can_update_existing": true,
    "can_publish_versions": false,
    "can_delete": false
  },
  
  "field_restrictions": {
    "type": "whitelist",               // whitelist, blacklist, all
    "allowed_fields": [
      "moderated",
      "featured",
      "description",
      "tags"
    ],
    "restricted_fields": []            // If blacklist
  },
  
  "metadata": {
    "role": "Content Moderator",
    "reason": "Reviewing submissions",
    "contact": "moderator@example.com"
  }
}
```

### Delegation Verification

```javascript
/**
 * Verify if user has delegation to perform action
 */
function verifyDelegation(user, delegationType, action, target, client) {
  // delegationType: 'moderator' or 'updater'
  
  const delegations = client.getDelegations(delegationType);
  const now = Math.floor(Date.now() / 1000);
  
  for (const delegation of delegations) {
    // Check if delegation is for this user
    if (delegation.delegated_to !== user.pubkey) continue;
    
    // Check validity
    if (delegation.validity.valid_from > now) continue;
    if (delegation.validity.valid_until < now) continue;
    
    // Check scope
    if (delegationType === 'moderator') {
      if (!checkModeratorScope(delegation, action, target)) continue;
      if (!checkModeratorPowers(delegation, action)) continue;
    } else if (delegationType === 'updater') {
      if (!checkUpdaterScope(delegation, action, target)) continue;
      if (!checkUpdaterPowers(delegation, action)) continue;
    }
    
    // Valid delegation found
    return delegation;
  }
  
  return null;
}

function checkModeratorScope(delegation, action, target) {
  const scope = delegation.scope;
  
  // Global moderator
  if (scope.type === 'global') return true;
  if (scope.type === 'global-chat' && target.type === 'channel') return true;
  if (scope.type === 'global-forum' && target.type === 'forum') return true;
  
  // Specific targets
  if (scope.targets.includes(target.id)) {
    if (scope.exclude.includes(target.id)) return false;
    return true;
  }
  
  return false;
}

function checkModeratorPowers(delegation, action) {
  const powers = delegation.powers;
  
  switch (action.type) {
    case 'block_user':
      if (!powers.can_block_users) return false;
      if (action.duration > powers.max_block_duration) return false;
      return true;
      
    case 'delete_message':
      return powers.can_delete_messages;
      
    case 'freeze_thread':
      return powers.can_freeze_threads;
      
    case 'warn_user':
      return powers.can_warn_users;
      
    case 'mute_user':
      return powers.can_mute_users;
      
    default:
      return false;
  }
}
```

---

## Client Implementation

### Permission Manager

```javascript
// permission-manager.js
class PermissionManager {
  constructor(client) {
    this.client = client;
    this.permissionRules = new Map();
    this.moderationBlocks = new Map();
    this.delegations = new Map();
  }

  async loadPermissions() {
    // Load all permission-related events
    await this.loadPermissionRules();
    await this.loadModerationBlocks();
    await this.loadDelegations();
  }

  async loadPermissionRules() {
    const events = await this.client.pool.querySync(
      this.client.relays,
      {
        kinds: [31102],  // Permission rules
        authors: [this.client.CONFIG.ADMIN_PUBKEY],
        '#app': [this.client.CONFIG.APP_NAME]
      }
    );

    for (const event of events) {
      try {
        const data = this.client.decryptContent(event, this.client.userPrivkey);
        if (data) {
          const key = `${data.scope}:${data.target}`;
          this.permissionRules.set(key, data);
        }
      } catch (err) {
        console.error('Failed to decrypt permission rule:', err);
      }
    }
  }

  async loadModerationBlocks() {
    const events = await this.client.pool.querySync(
      this.client.relays,
      {
        kinds: [31103],  // Moderation actions
        '#app': [this.client.CONFIG.APP_NAME]
      }
    );

    const now = Math.floor(Date.now() / 1000);

    for (const event of events) {
      try {
        const data = this.client.decryptContent(event, this.client.userPrivkey);
        if (!data) continue;

        // Only keep active blocks
        if (data.timing.start_time > now) continue;
        if (data.timing.end_time && data.timing.end_time < now) continue;

        this.moderationBlocks.set(data.moderation_id, data);
      } catch (err) {
        console.error('Failed to decrypt moderation block:', err);
      }
    }
  }

  async loadDelegations() {
    const moderatorEvents = await this.client.pool.querySync(
      this.client.relays,
      {
        kinds: [31104],  // Moderator delegations
        authors: [this.client.CONFIG.ADMIN_PUBKEY],
        '#app': [this.client.CONFIG.APP_NAME]
      }
    );

    const updaterEvents = await this.client.pool.querySync(
      this.client.relays,
      {
        kinds: [31105],  // Update delegations
        authors: [this.client.CONFIG.ADMIN_PUBKEY],
        '#app': [this.client.CONFIG.APP_NAME]
      }
    );

    const now = Math.floor(Date.now() / 1000);

    for (const event of [...moderatorEvents, ...updaterEvents]) {
      try {
        const data = this.client.decryptContent(event, this.client.userPrivkey);
        if (!data) continue;

        // Only keep valid delegations
        if (data.validity.valid_from > now) continue;
        if (data.validity.valid_until < now) continue;

        this.delegations.set(data.delegation_id, data);
      } catch (err) {
        console.error('Failed to decrypt delegation:', err);
      }
    }
  }

  canRead(userPubkey, scope, targetId) {
    return this.checkPermission(userPubkey, 'read', scope, targetId);
  }

  canWrite(userPubkey, scope, targetId) {
    // First check moderation blocks
    if (this.isUserBlocked(userPubkey, scope, targetId)) {
      return false;
    }

    // Then check permissions
    return this.checkPermission(userPubkey, 'write', scope, targetId);
  }

  canReply(userPubkey, scope, targetId) {
    if (this.isUserBlocked(userPubkey, scope, targetId)) {
      return false;
    }

    return this.checkPermission(userPubkey, 'reply', scope, targetId);
  }

  checkPermission(userPubkey, action, scope, targetId) {
    const key = `${scope}:${targetId}`;
    const rules = this.permissionRules.get(key);

    if (!rules) {
      // No rules = deny by default
      return false;
    }

    const actionRules = rules.rules[action];
    if (!actionRules) return false;

    // Check denied list
    if (actionRules.denied_users.includes(userPubkey)) {
      return false;
    }

    // Check allowed list (whitelist)
    if (actionRules.allowed_users.length > 0) {
      return actionRules.allowed_users.includes(userPubkey);
    }

    // Check requirements
    if (actionRules.require && actionRules.require.length > 0) {
      for (const requirement of actionRules.require) {
        if (!this.checkRequirement(userPubkey, requirement)) {
          return false;
        }
      }
    }

    // Check default
    if (actionRules.default === 'deny') {
      return false;
    }

    return true;
  }

  checkRequirement(userPubkey, requirement) {
    switch (requirement) {
      case 'verified':
        return this.client.isUserVerified(userPubkey);
        
      case 'premium':
        return this.client.userAccessLevel >= 1;
        
      case 'moderator':
        return this.isUserModerator(userPubkey);
        
      default:
        // Custom requirement
        return this.checkCustomRequirement(userPubkey, requirement);
    }
  }

  isUserBlocked(userPubkey, scope, targetId) {
    const now = Math.floor(Date.now() / 1000);

    for (const block of this.moderationBlocks.values()) {
      // Check if block is active
      if (block.timing.start_time > now) continue;
      if (block.timing.end_time && block.timing.end_time < now) continue;

      // Check if block applies to this user
      if (block.target_type === 'user' && block.target_id === userPubkey) {
        // Check if block applies to this scope
        if (block.scope === 'global' ||
            block.scope === `global-${scope}` ||
            block.scope === targetId) {
          return true;
        }
      }

      // Check if target itself is frozen
      if (block.target_type === scope && block.target_id === targetId) {
        if (block.action === 'freeze') {
          return true;
        }
      }
    }

    return false;
  }

  isUserModerator(userPubkey, scope = null, targetId = null) {
    for (const delegation of this.delegations.values()) {
      if (delegation.delegated_to !== userPubkey) continue;
      if (!delegation.delegation_id.startsWith('moderator:')) continue;

      // If checking specific scope
      if (scope && targetId) {
        if (delegation.scope.type === 'global') return true;
        if (delegation.scope.type === `global-${scope}`) return true;
        if (delegation.scope.targets.includes(targetId)) return true;
      } else {
        return true;  // Just checking if user is a moderator at all
      }
    }

    return false;
  }

  isContentHidden(event) {
    const blocks = Array.from(this.moderationBlocks.values());
    
    for (const block of blocks) {
      if (!block.restrictions.hide_history) continue;

      // Check if this content should be hidden
      if (block.target_type === 'user' && event.pubkey === block.target_id) {
        return true;
      }

      // Check specific message blocks
      if (block.target_type === 'message' && event.id === block.target_id) {
        return true;
      }
    }

    return false;
  }
}

export default PermissionManager;
```

### Chat Manager

```javascript
// chat-manager.js
class ChatManager {
  constructor(client, permissionManager) {
    this.client = client;
    this.permissionManager = permissionManager;
    this.channels = new Map();
    this.messages = new Map();  // channelId -> messages[]
    this.subscriptions = new Map();
  }

  async loadChannels() {
    // Load channel definitions
    const events = await this.client.pool.querySync(
      this.client.relays,
      {
        kinds: [31100],  // Channel definitions
        authors: [this.client.CONFIG.ADMIN_PUBKEY],
        '#app': [this.client.CONFIG.APP_NAME]
      }
    );

    for (const event of events) {
      try {
        const data = this.client.decryptContent(event, this.client.userPrivkey);
        if (!data) continue;

        if (data.channel_id) {
          // Single channel definition
          this.channels.set(data.channel_id, data);
        } else if (data.channel_list) {
          // Channel list
          for (const channel of data.channel_list) {
            if (!this.channels.has(channel.channel_id)) {
              // Load full definition
              await this.loadChannelDetails(channel.channel_id);
            }
          }
        }
      } catch (err) {
        console.error('Failed to decrypt channel definition:', err);
      }
    }
  }

  async loadChannelDetails(channelId) {
    const events = await this.client.pool.querySync(
      this.client.relays,
      {
        kinds: [31100],
        authors: [this.client.CONFIG.ADMIN_PUBKEY],
        '#d': [`channel:${channelId}`],
        '#app': [this.client.CONFIG.APP_NAME]
      }
    );

    if (events.length > 0) {
      const data = this.client.decryptContent(events[0], this.client.userPrivkey);
      if (data) {
        this.channels.set(channelId, data);
      }
    }
  }

  getAccessibleChannels(userPubkey) {
    const accessible = [];

    for (const [channelId, channel] of this.channels) {
      if (this.permissionManager.canRead(userPubkey, 'channel', channelId)) {
        accessible.push(channel);
      }
    }

    return accessible.sort((a, b) => 
      (a.metadata.position || 0) - (b.metadata.position || 0)
    );
  }

  async joinChannel(channelId, userPubkey) {
    // Check permission
    if (!this.permissionManager.canRead(userPubkey, 'channel', channelId)) {
      throw new Error('No permission to read this channel');
    }

    // Load recent messages
    await this.loadChannelMessages(channelId);

    // Subscribe to new messages
    this.subscribeToChannel(channelId, userPubkey);
  }

  async loadChannelMessages(channelId, limit = 100) {
    const since = Math.floor(Date.now() / 1000) - 3600;  // Last hour

    const events = await this.client.pool.querySync(
      this.client.relays,
      {
        kinds: [42],  // Channel messages
        '#h': [channelId],
        since: since,
        limit: limit
      }
    );

    const messages = [];
    for (const event of events) {
      // Filter out blocked content
      if (this.permissionManager.isContentHidden(event)) {
        continue;
      }

      // Decrypt if needed
      const channel = this.channels.get(channelId);
      if (channel?.settings.encryption !== 'public') {
        try {
          const decrypted = this.client.decryptContent(event, this.client.userPrivkey);
          if (decrypted) {
            messages.push({ ...event, content: decrypted.message || decrypted });
          }
        } catch (err) {
          // Can't decrypt, skip
          continue;
        }
      } else {
        messages.push(event);
      }
    }

    // Sort by timestamp
    messages.sort((a, b) => a.created_at - b.created_at);

    this.messages.set(channelId, messages);
    return messages;
  }

  subscribeToChannel(channelId, userPubkey) {
    if (this.subscriptions.has(channelId)) {
      // Already subscribed
      return;
    }

    const subscription = this.client.pool.subscribeMany(
      this.client.relays,
      [{
        kinds: [42],
        '#h': [channelId],
        since: Math.floor(Date.now() / 1000)
      }],
      {
        onevent: (event) => {
          this.handleNewMessage(channelId, event, userPubkey);
        }
      }
    );

    this.subscriptions.set(channelId, subscription);
  }

  handleNewMessage(channelId, event, userPubkey) {
    // Filter blocked content
    if (this.permissionManager.isContentHidden(event)) {
      return;
    }

    // Decrypt if needed
    const channel = this.channels.get(channelId);
    let message = event;

    if (channel?.settings.encryption !== 'public') {
      try {
        const decrypted = this.client.decryptContent(event, this.client.userPrivkey);
        if (decrypted) {
          message = { ...event, content: decrypted.message || decrypted };
        } else {
          return;  // Can't decrypt
        }
      } catch (err) {
        return;
      }
    }

    // Add to messages
    const messages = this.messages.get(channelId) || [];
    messages.push(message);
    this.messages.set(channelId, messages);

    // Emit event for UI update
    this.emit('new-message', { channelId, message });
  }

  async sendMessage(channelId, content, userPubkey, userPrivkey) {
    // Check permission
    if (!this.permissionManager.canWrite(userPubkey, 'channel', channelId)) {
      throw new Error('No permission to post in this channel');
    }

    const channel = this.channels.get(channelId);
    if (!channel) {
      throw new Error('Channel not found');
    }

    // Prepare message
    const messageData = {
      message: content,
      timestamp: Math.floor(Date.now() / 1000)
    };

    // Encrypt if needed
    let messageContent;
    if (channel.settings.encryption === 'public') {
      messageContent = content;
    } else if (channel.settings.encryption === 'shared') {
      messageContent = this.client.encrypt(
        messageData,
        channel.settings.encryption_key || this.client.CONFIG.ACCESS_LEVELS.PUBLIC.key
      );
    } else if (channel.settings.encryption === 'per-user') {
      // For per-user, we'd need to send multiple events (one per allowed user)
      throw new Error('Per-user encryption not yet implemented for chat');
    }

    // Get channel root event ID
    const channelRootId = await this.getChannelRootEventId(channelId);

    const event = {
      kind: 42,
      pubkey: userPubkey,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['e', channelRootId, '', 'root'],
        ['h', channelId],
        ['app', this.client.CONFIG.APP_NAME]
      ],
      content: messageContent
    };

    event.id = getEventHash(event);
    event.sig = signEvent(event, userPrivkey);

    // Publish
    await Promise.allSettled(
      this.client.relays.map(relay =>
        this.client.pool.publish([relay], event)
      )
    );

    return event;
  }

  async getChannelRootEventId(channelId) {
    // In a real implementation, this would query for the channel creation event
    // For now, use a deterministic ID
    return `channel:${channelId}:root`;
  }

  leaveChannel(channelId) {
    const subscription = this.subscriptions.get(channelId);
    if (subscription) {
      subscription.close();
      this.subscriptions.delete(channelId);
    }
  }

  emit(eventName, data) {
    // Simple event emitter for UI updates
    if (this.eventHandlers && this.eventHandlers[eventName]) {
      for (const handler of this.eventHandlers[eventName]) {
        handler(data);
      }
    }
  }

  on(eventName, handler) {
    if (!this.eventHandlers) this.eventHandlers = {};
    if (!this.eventHandlers[eventName]) this.eventHandlers[eventName] = [];
    this.eventHandlers[eventName].push(handler);
  }
}

export default ChatManager;
```

---

## Complete Code Examples

### Vue Component: Chat Interface

```vue
<!-- ChatInterface.vue -->
<template>
  <div class="chat-interface">
    <!-- Channel List Sidebar -->
    <div class="channel-list">
      <div class="channel-list-header">
        <h3>Channels</h3>
        <button v-if="isAdmin" @click="showChannelManager = true">⚙️</button>
      </div>

      <div v-for="category in channelCategories" :key="category.id" class="channel-category">
        <div class="category-name">{{ category.name }}</div>
        <div
          v-for="channel in getChannelsByCategory(category.id)"
          :key="channel.channel_id"
          :class="['channel-item', { active: activeChannel === channel.channel_id }]"
          @click="joinChannel(channel.channel_id)"
        >
          <span class="channel-icon">{{ channel.metadata.icon }}</span>
          <span class="channel-name">{{ channel.name }}</span>
          <span v-if="channel.unread > 0" class="unread-badge">{{ channel.unread }}</span>
        </div>
      </div>
    </div>

    <!-- Chat Area -->
    <div class="chat-area">
      <div v-if="activeChannel" class="chat-content">
        <!-- Channel Header -->
        <div class="chat-header">
          <div class="channel-info">
            <h3>{{ activeChannelData.name }}</h3>
            <p class="channel-topic">{{ activeChannelData.topic }}</p>
          </div>
          <div class="channel-actions">
            <button @click="showChannelInfo = true">ℹ️</button>
            <button v-if="isModerator" @click="showModerationPanel = true">🛡️</button>
          </div>
        </div>

        <!-- Messages -->
        <div class="messages-container" ref="messagesContainer">
          <div
            v-for="message in displayedMessages"
            :key="message.id"
            :class="['message', { 'own-message': message.pubkey === userPubkey }]"
          >
            <div class="message-avatar">
              {{ getUserInitials(message.pubkey) }}
            </div>
            <div class="message-content-wrapper">
              <div class="message-header">
                <span class="message-author">{{ getUserName(message.pubkey) }}</span>
                <span v-if="isUserVerified(message.pubkey)" class="verified-badge">✓</span>
                <span class="message-timestamp">{{ formatTimestamp(message.created_at) }}</span>
              </div>
              <div class="message-content" v-html="renderMarkdown(message.content)"></div>
            </div>
          </div>
        </div>

        <!-- Input Area -->
        <div class="chat-input-area">
          <div v-if="canPostInChannel" class="chat-input">
            <textarea
              v-model="messageInput"
              @keydown.enter.exact.prevent="sendMessage"
              @keydown.enter.shift="addNewline"
              placeholder="Type a message... (Shift+Enter for new line)"
              rows="1"
            />
            <button @click="sendMessage" :disabled="!messageInput.trim()">Send</button>
          </div>
          <div v-else class="chat-input-blocked">
            <p>{{ getBlockedReason() }}</p>
          </div>
        </div>
      </div>

      <div v-else class="no-channel-selected">
        <h3>Select a channel to start chatting</h3>
      </div>
    </div>

    <!-- Moderation Panel Modal -->
    <ModerationPanel
      v-if="showModerationPanel"
      :channel="activeChannelData"
      :permissionManager="permissionManager"
      @close="showModerationPanel = false"
    />

    <!-- Channel Info Modal -->
    <ChannelInfo
      v-if="showChannelInfo"
      :channel="activeChannelData"
      @close="showChannelInfo = false"
    />
  </div>
</template>

<script>
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue';
import { marked } from 'marked';
import ChatManager from './chat-manager';
import PermissionManager from './permission-manager';

export default {
  name: 'ChatInterface',
  props: {
    client: Object,
    userPubkey: String,
    userPrivkey: String,
    isAdmin: Boolean
  },
  setup(props) {
    const chatManager = ref(null);
    const permissionManager = ref(null);
    const channels = ref([]);
    const activeChannel = ref(null);
    const activeChannelData = ref(null);
    const messages = ref([]);
    const messageInput = ref('');
    const messagesContainer = ref(null);
    const showModerationPanel = ref(false);
    const showChannelInfo = ref(false);
    const showChannelManager = ref(false);

    onMounted(async () => {
      await initialize();
    });

    onUnmounted(() => {
      cleanup();
    });

    async function initialize() {
      // Initialize managers
      permissionManager.value = new PermissionManager(props.client);
      await permissionManager.value.loadPermissions();

      chatManager.value = new ChatManager(props.client, permissionManager.value);
      await chatManager.value.loadChannels();

      // Get accessible channels
      channels.value = chatManager.value.getAccessibleChannels(props.userPubkey);

      // Listen for new messages
      chatManager.value.on('new-message', handleNewMessage);

      // Auto-join first channel
      if (channels.value.length > 0) {
        await joinChannel(channels.value[0].channel_id);
      }
    }

    function cleanup() {
      if (activeChannel.value) {
        chatManager.value.leaveChannel(activeChannel.value);
      }
    }

    async function joinChannel(channelId) {
      // Leave current channel
      if (activeChannel.value) {
        chatManager.value.leaveChannel(activeChannel.value);
      }

      // Join new channel
      activeChannel.value = channelId;
      activeChannelData.value = chatManager.value.channels.get(channelId);

      try {
        await chatManager.value.joinChannel(channelId, props.userPubkey);
        messages.value = chatManager.value.messages.get(channelId) || [];
        nextTick(() => scrollToBottom());
      } catch (err) {
        console.error('Failed to join channel:', err);
        alert('Failed to join channel: ' + err.message);
      }
    }

    function handleNewMessage({ channelId, message }) {
      if (channelId === activeChannel.value) {
        messages.value.push(message);
        nextTick(() => scrollToBottom());
      }
    }

    async function sendMessage() {
      if (!messageInput.value.trim()) return;

      try {
        await chatManager.value.sendMessage(
          activeChannel.value,
          messageInput.value,
          props.userPubkey,
          props.userPrivkey
        );

        messageInput.value = '';
      } catch (err) {
        console.error('Failed to send message:', err);
        alert('Failed to send message: ' + err.message);
      }
    }

    function addNewline() {
      messageInput.value += '\n';
    }

    const canPostInChannel = computed(() => {
      if (!activeChannel.value || !permissionManager.value) return false;
      return permissionManager.value.canWrite(
        props.userPubkey,
        'channel',
        activeChannel.value
      );
    });

    const isModerator = computed(() => {
      if (!activeChannel.value || !permissionManager.value) return false;
      return permissionManager.value.isUserModerator(
        props.userPubkey,
        'channel',
        activeChannel.value
      );
    });

    const displayedMessages = computed(() => {
      return messages.value.filter(msg =>
        !permissionManager.value.isContentHidden(msg)
      );
    });

    const channelCategories = computed(() => {
      // Group channels by category
      const categories = new Map();
      
      for (const channel of channels.value) {
        const categoryId = channel.metadata.parent_category || 'main';
        if (!categories.has(categoryId)) {
          categories.set(categoryId, {
            id: categoryId,
            name: categoryId === 'main' ? 'Main Channels' : categoryId,
            channels: []
          });
        }
        categories.get(categoryId).channels.push(channel);
      }

      return Array.from(categories.values());
    });

    function getChannelsByCategory(categoryId) {
      const category = channelCategories.value.find(c => c.id === categoryId);
      return category ? category.channels : [];
    }

    function getUserName(pubkey) {
      const verification = props.client.getUserVerificationInfo(pubkey);
      if (verification?.verified_identities?.[0]) {
        return verification.verified_identities[0].handle;
      }
      return pubkey.slice(0, 8) + '...';
    }

    function getUserInitials(pubkey) {
      const name = getUserName(pubkey);
      return name.slice(0, 2).toUpperCase();
    }

    function isUserVerified(pubkey) {
      return props.client.isUserVerified(pubkey);
    }

    function formatTimestamp(timestamp) {
      const date = new Date(timestamp * 1000);
      const now = new Date();
      
      if (date.toDateString() === now.toDateString()) {
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      } else {
        return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      }
    }

    function renderMarkdown(content) {
      if (activeChannelData.value?.settings.allow_markdown) {
        return marked.parse(content);
      }
      return content.replace(/\n/g, '<br>');
    }

    function getBlockedReason() {
      if (!permissionManager.value.canWrite(props.userPubkey, 'channel', activeChannel.value)) {
        if (permissionManager.value.isUserBlocked(props.userPubkey, 'channel', activeChannel.value)) {
          return 'You are blocked from posting in this channel';
        }
        return 'You do not have permission to post in this channel';
      }
      return 'Cannot post';
    }

    function scrollToBottom() {
      if (messagesContainer.value) {
        messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
      }
    }

    return {
      channels,
      activeChannel,
      activeChannelData,
      messages,
      messageInput,
      messagesContainer,
      showModerationPanel,
      showChannelInfo,
      showChannelManager,
      canPostInChannel,
      isModerator,
      displayedMessages,
      channelCategories,
      joinChannel,
      sendMessage,
      addNewline,
      getChannelsByCategory,
      getUserName,
      getUserInitials,
      isUserVerified,
      formatTimestamp,
      renderMarkdown,
      getBlockedReason
    };
  }
};
</script>

<style scoped>
.chat-interface {
  display: flex;
  height: 100vh;
  background: #1a1a1a;
  color: #fff;
}

.channel-list {
  width: 250px;
  background: #222;
  border-right: 2px solid #333;
  display: flex;
  flex-direction: column;
}

.channel-list-header {
  padding: 15px;
  border-bottom: 2px solid #333;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.channel-list-header h3 {
  margin: 0;
}

.channel-category {
  padding: 10px 0;
}

.category-name {
  padding: 5px 15px;
  font-size: 0.8rem;
  color: #888;
  text-transform: uppercase;
  font-weight: bold;
}

.channel-item {
  padding: 8px 15px;
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  transition: background 0.2s;
}

.channel-item:hover {
  background: #2a2a2a;
}

.channel-item.active {
  background: #0084ff;
}

.channel-icon {
  font-size: 1.2rem;
}

.channel-name {
  flex: 1;
}

.unread-badge {
  background: #ff4444;
  color: #fff;
  padding: 2px 6px;
  border-radius: 10px;
  font-size: 0.75rem;
  font-weight: bold;
}

.chat-area {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.chat-content {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.chat-header {
  padding: 15px;
  background: #222;
  border-bottom: 2px solid #333;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.channel-info h3 {
  margin: 0 0 5px 0;
}

.channel-topic {
  margin: 0;
  color: #888;
  font-size: 0.9rem;
}

.channel-actions {
  display: flex;
  gap: 10px;
}

.channel-actions button {
  padding: 8px 12px;
  background: #333;
  border: none;
  border-radius: 6px;
  color: #fff;
  cursor: pointer;
  font-size: 1.2rem;
}

.channel-actions button:hover {
  background: #444;
}

.messages-container {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 15px;
}

.message {
  display: flex;
  gap: 12px;
}

.message.own-message {
  flex-direction: row-reverse;
}

.message.own-message .message-content-wrapper {
  align-items: flex-end;
}

.message.own-message .message-content {
  background: #0084ff;
}

.message-avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: #444;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: bold;
  font-size: 0.9rem;
  flex-shrink: 0;
}

.message-content-wrapper {
  flex: 1;
  display: flex;
  flex-direction: column;
  max-width: 70%;
}

.message-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 5px;
  font-size: 0.9rem;
}

.message-author {
  font-weight: bold;
}

.verified-badge {
  color: #00ff00;
}

.message-timestamp {
  color: #888;
  font-size: 0.8rem;
}

.message-content {
  background: #2a2a2a;
  padding: 10px 15px;
  border-radius: 12px;
  word-wrap: break-word;
}

.chat-input-area {
  padding: 15px;
  background: #222;
  border-top: 2px solid #333;
}

.chat-input {
  display: flex;
  gap: 10px;
}

.chat-input textarea {
  flex: 1;
  padding: 10px;
  background: #2a2a2a;
  border: 1px solid #444;
  border-radius: 8px;
  color: #fff;
  font-family: inherit;
  font-size: 1rem;
  resize: none;
  max-height: 150px;
}

.chat-input button {
  padding: 10px 20px;
  background: #0084ff;
  color: #fff;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-weight: bold;
}

.chat-input button:hover:not(:disabled) {
  background: #0066cc;
}

.chat-input button:disabled {
  background: #444;
  cursor: not-allowed;
}

.chat-input-blocked {
  padding: 15px;
  background: #2a2a2a;
  border-radius: 8px;
  text-align: center;
  color: #ff4444;
}

.no-channel-selected {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #888;
}
</style>
```

This is a comprehensive start to the system. Would you like me to:
1. Continue with the Forum implementation code?
2. Add the Admin Tools for managing channels, forums, permissions, and moderation?
3. Create the Moderation Panel component?
4. Provide more code examples for specific features?

The design is complete but I can expand on any section you'd like more detail on.
