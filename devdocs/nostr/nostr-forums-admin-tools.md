# Forums, Admin Tools & Moderation Components (Continuation)

This document continues from the main Chat, Forums & Moderation System Design.

## Table of Contents
1. [Forum Manager Implementation](#forum-manager-implementation)
2. [Admin Tools](#admin-tools)
3. [Moderation Panel Components](#moderation-panel-components)
4. [Delegation Management](#delegation-management)
5. [Complete Example Workflows](#complete-example-workflows)

---

## Forum Manager Implementation

### Forum Manager Class

```javascript
// forum-manager.js
import { getEventHash, signEvent } from 'nostr-tools';

class ForumManager {
  constructor(client, permissionManager) {
    this.client = client;
    this.permissionManager = permissionManager;
    this.forums = new Map();
    this.posts = new Map();      // forumId -> posts[]
    this.replies = new Map();    // postId -> replies[]
    this.subscriptions = new Map();
  }

  async loadForums() {
    // Load forum definitions
    const events = await this.client.pool.querySync(
      this.client.relays,
      {
        kinds: [31101],  // Forum definitions
        authors: [this.client.CONFIG.ADMIN_PUBKEY],
        '#app': [this.client.CONFIG.APP_NAME]
      }
    );

    for (const event of events) {
      try {
        const data = this.client.decryptContent(event, this.client.userPrivkey);
        if (!data) continue;

        if (data.forum_id) {
          // Single forum definition
          this.forums.set(data.forum_id, data);
        } else if (data.forums) {
          // Forum list
          for (const forum of data.forums) {
            if (!this.forums.has(forum.forum_id)) {
              await this.loadForumDetails(forum.forum_id);
            }
          }
        }
      } catch (err) {
        console.error('Failed to decrypt forum definition:', err);
      }
    }

    // Auto-generate game-specific forums
    await this.generateGameForums();
  }

  async generateGameForums() {
    // Get all games
    const games = this.client.getGameList();

    for (const game of games) {
      const forumId = `game:${game.gameid}`;
      
      if (!this.forums.has(forumId)) {
        // Create auto-generated forum
        this.forums.set(forumId, {
          forum_id: forumId,
          name: `${game.name} - Discussion`,
          description: `Discussion forum for ${game.name}`,
          type: 'game-specific',
          gameid: game.gameid,
          settings: {
            read_access: 'public',
            post_access: 'verified',
            reply_access: 'verified',
            encryption: 'public'
          },
          metadata: {
            auto_generated: true,
            position: 1000 + parseInt(game.gameid)
          }
        });
      }
    }
  }

  getAccessibleForums(userPubkey) {
    const accessible = [];

    for (const [forumId, forum] of this.forums) {
      if (this.permissionManager.canRead(userPubkey, 'forum', forumId)) {
        accessible.push(forum);
      }
    }

    // Sort by category and position
    return accessible.sort((a, b) => {
      if (a.metadata.category !== b.metadata.category) {
        return (a.metadata.category || '').localeCompare(b.metadata.category || '');
      }
      return (a.metadata.position || 0) - (b.metadata.position || 0);
    });
  }

  async loadForumPosts(forumId, limit = 50, since = null) {
    const query = {
      kinds: [30024],  // Long-form posts
      '#h': [forumId],
      limit: limit
    };

    if (since) {
      query.since = since;
    }

    const events = await this.client.pool.querySync(
      this.client.relays,
      query
    );

    const posts = [];
    for (const event of events) {
      // Filter blocked content
      if (this.permissionManager.isContentHidden(event)) {
        continue;
      }

      // Decrypt if needed
      const forum = this.forums.get(forumId);
      if (forum?.settings.encryption !== 'public') {
        try {
          const decrypted = this.client.decryptContent(event, this.client.userPrivkey);
          if (decrypted) {
            posts.push({
              ...event,
              content: decrypted,
              title: this.getTitleFromTags(event.tags) || 'Untitled'
            });
          }
        } catch (err) {
          continue;
        }
      } else {
        posts.push({
          ...event,
          title: this.getTitleFromTags(event.tags) || 'Untitled'
        });
      }
    }

    // Load reply counts for each post
    for (const post of posts) {
      post.replyCount = await this.getReplyCount(post.id);
      post.lastActivity = await this.getLastActivityTime(post.id);
    }

    // Sort by last activity (most recent first)
    posts.sort((a, b) => b.lastActivity - a.lastActivity);

    this.posts.set(forumId, posts);
    return posts;
  }

  async loadPostReplies(postId) {
    const events = await this.client.pool.querySync(
      this.client.relays,
      {
        kinds: [1111],  // Forum replies
        '#e': [postId]
      }
    );

    const replies = [];
    for (const event of events) {
      if (this.permissionManager.isContentHidden(event)) {
        continue;
      }

      // Build reply tree
      const rootTag = event.tags.find(t => t[0] === 'e' && t[3] === 'root');
      const replyTag = event.tags.find(t => t[0] === 'e' && t[3] === 'reply');

      replies.push({
        ...event,
        rootId: rootTag ? rootTag[1] : null,
        parentId: replyTag ? replyTag[1] : postId,
        depth: this.calculateReplyDepth(event, events)
      });
    }

    // Sort by timestamp
    replies.sort((a, b) => a.created_at - b.created_at);

    this.replies.set(postId, replies);
    return replies;
  }

  async createPost(forumId, title, content, tags, userPubkey, userPrivkey) {
    // Check permission
    if (!this.permissionManager.canWrite(userPubkey, 'forum', forumId)) {
      throw new Error('No permission to post in this forum');
    }

    const forum = this.forums.get(forumId);
    if (!forum) {
      throw new Error('Forum not found');
    }

    // Generate unique post ID
    const postId = `post:${forumId}:${Date.now()}`;

    // Prepare content
    const postData = {
      title: title,
      content: content,
      created_at: Math.floor(Date.now() / 1000)
    };

    // Encrypt if needed
    let eventContent;
    let eventTitle;

    if (forum.settings.encryption === 'public') {
      eventContent = content;
      eventTitle = title;
    } else if (forum.settings.encryption === 'shared') {
      eventContent = this.client.encrypt(
        postData,
        forum.settings.encryption_key || this.client.CONFIG.ACCESS_LEVELS.PUBLIC.key
      );
      eventTitle = this.client.encrypt(
        { title: title },
        forum.settings.encryption_key || this.client.CONFIG.ACCESS_LEVELS.PUBLIC.key
      );
    }

    const eventTags = [
      ['d', postId],
      ['h', forumId],
      ['title', eventTitle],
      ['published_at', String(Math.floor(Date.now() / 1000))],
      ['app', this.client.CONFIG.APP_NAME]
    ];

    // Add content tags
    for (const tag of tags) {
      eventTags.push(['t', tag]);
    }

    const event = {
      kind: 30024,
      pubkey: userPubkey,
      created_at: Math.floor(Date.now() / 1000),
      tags: eventTags,
      content: eventContent
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

  async createReply(postId, content, parentReplyId, userPubkey, userPrivkey) {
    // Get post to find forum
    const post = await this.getPost(postId);
    if (!post) {
      throw new Error('Post not found');
    }

    const forumTag = post.tags.find(t => t[0] === 'h');
    const forumId = forumTag ? forumTag[1] : null;

    if (!forumId) {
      throw new Error('Could not determine forum');
    }

    // Check permission
    if (!this.permissionManager.canReply(userPubkey, 'forum', forumId)) {
      throw new Error('No permission to reply in this forum');
    }

    const eventTags = [
      ['e', postId, '', 'root'],
      ['h', forumId],
      ['p', post.pubkey],  // Notify post author
      ['app', this.client.CONFIG.APP_NAME]
    ];

    if (parentReplyId) {
      eventTags.push(['e', parentReplyId, '', 'reply']);
      // Get parent author for notification
      const parentReply = await this.getReply(parentReplyId);
      if (parentReply) {
        eventTags.push(['p', parentReply.pubkey]);
      }
    }

    const event = {
      kind: 1111,
      pubkey: userPubkey,
      created_at: Math.floor(Date.now() / 1000),
      tags: eventTags,
      content: content
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

  async getPost(postId) {
    const events = await this.client.pool.querySync(
      this.client.relays,
      {
        kinds: [30024],
        ids: [postId],
        limit: 1
      }
    );

    return events[0] || null;
  }

  async getReply(replyId) {
    const events = await this.client.pool.querySync(
      this.client.relays,
      {
        kinds: [1111],
        ids: [replyId],
        limit: 1
      }
    );

    return events[0] || null;
  }

  async getReplyCount(postId) {
    const events = await this.client.pool.querySync(
      this.client.relays,
      {
        kinds: [1111],
        '#e': [postId],
        limit: 1000  // Max to count
      }
    );

    return events.filter(e => !this.permissionManager.isContentHidden(e)).length;
  }

  async getLastActivityTime(postId) {
    const events = await this.client.pool.querySync(
      this.client.relays,
      {
        kinds: [1111],
        '#e': [postId],
        limit: 1
      }
    );

    if (events.length > 0) {
      return Math.max(...events.map(e => e.created_at));
    }

    // No replies, return post creation time
    const post = await this.getPost(postId);
    return post ? post.created_at : 0;
  }

  getTitleFromTags(tags) {
    const titleTag = tags.find(t => t[0] === 'title');
    return titleTag ? titleTag[1] : null;
  }

  calculateReplyDepth(reply, allReplies) {
    let depth = 0;
    let current = reply;

    while (current) {
      const replyTag = current.tags.find(t => t[0] === 'e' && t[3] === 'reply');
      if (!replyTag) break;

      const parent = allReplies.find(r => r.id === replyTag[1]);
      if (!parent) break;

      depth++;
      current = parent;
    }

    return depth;
  }

  buildReplyTree(replies) {
    const tree = [];
    const replyMap = new Map();

    // Index all replies
    for (const reply of replies) {
      replyMap.set(reply.id, { ...reply, children: [] });
    }

    // Build tree structure
    for (const reply of replies) {
      const node = replyMap.get(reply.id);
      
      if (reply.parentId && replyMap.has(reply.parentId)) {
        // Add to parent's children
        replyMap.get(reply.parentId).children.push(node);
      } else {
        // Top-level reply
        tree.push(node);
      }
    }

    return tree;
  }
}

export default ForumManager;
```

---

## Admin Tools

### Admin Client Extensions

```javascript
// admin-tools.js
import { getEventHash, signEvent } from 'nostr-tools';
import { encrypt, encryptForUser } from './crypto-utils';

class AdminTools {
  constructor(adminClient) {
    this.client = adminClient;
    this.adminPrivkey = adminClient.adminPrivkey;
    this.adminPubkey = adminClient.adminPubkey;
  }

  /**
   * Channel Management
   */
  async createChannel(channelData) {
    const channelId = channelData.channel_id;

    const event = {
      kind: 31100,
      pubkey: this.adminPubkey,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['d', `channel:${channelId}`],
        ['app', this.client.CONFIG.APP_NAME],
        ['v', '1.0']
      ],
      content: encrypt(channelData, this.client.CONFIG.ACCESS_LEVELS.PUBLIC.key)
    };

    event.id = getEventHash(event);
    event.sig = signEvent(event, this.adminPrivkey);

    await this.publishToAllRelays(event);
    return event;
  }

  async updateChannel(channelId, updates) {
    // Load existing channel
    const existing = await this.loadChannel(channelId);
    if (!existing) {
      throw new Error('Channel not found');
    }

    const updated = {
      ...existing,
      ...updates,
      updated_at: Math.floor(Date.now() / 1000)
    };

    return await this.createChannel(updated);  // Replaceable event
  }

  async deleteChannel(channelId) {
    // Mark as archived
    return await this.updateChannel(channelId, {
      metadata: {
        ...existing.metadata,
        archived: true
      }
    });
  }

  async updateChannelList(channels) {
    const channelList = {
      channel_list: channels.map(c => ({
        channel_id: c.channel_id,
        name: c.name,
        description: c.description,
        position: c.metadata.position
      }))
    };

    const event = {
      kind: 31100,
      pubkey: this.adminPubkey,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['d', 'channel:_list'],
        ['app', this.client.CONFIG.APP_NAME]
      ],
      content: encrypt(channelList, this.client.CONFIG.ACCESS_LEVELS.PUBLIC.key)
    };

    event.id = getEventHash(event);
    event.sig = signEvent(event, this.adminPrivkey);

    await this.publishToAllRelays(event);
    return event;
  }

  /**
   * Forum Management
   */
  async createForum(forumData) {
    const forumId = forumData.forum_id;

    const event = {
      kind: 31101,
      pubkey: this.adminPubkey,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['d', `forum:${forumId}`],
        ['app', this.client.CONFIG.APP_NAME],
        ['v', '1.0']
      ],
      content: encrypt(forumData, this.client.CONFIG.ACCESS_LEVELS.PUBLIC.key)
    };

    event.id = getEventHash(event);
    event.sig = signEvent(event, this.adminPrivkey);

    await this.publishToAllRelays(event);
    return event;
  }

  async updateForum(forumId, updates) {
    const existing = await this.loadForum(forumId);
    if (!existing) {
      throw new Error('Forum not found');
    }

    const updated = {
      ...existing,
      ...updates,
      updated_at: Math.floor(Date.now() / 1000)
    };

    return await this.createForum(updated);
  }

  /**
   * Permission Management
   */
  async setPermissions(scope, targetId, rules) {
    const permissionData = {
      rule_id: `permissions:${scope}:${targetId}`,
      scope: scope,
      target: targetId,
      created_at: Math.floor(Date.now() / 1000),
      updated_at: Math.floor(Date.now() / 1000),
      rules: rules
    };

    const event = {
      kind: 31102,
      pubkey: this.adminPubkey,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['d', `permissions:${scope}:${targetId}`],
        ['scope', scope],
        ['target', targetId],
        ['app', this.client.CONFIG.APP_NAME],
        ['v', '1.0']
      ],
      content: encrypt(permissionData, this.client.CONFIG.ACCESS_LEVELS.PUBLIC.key)
    };

    event.id = getEventHash(event);
    event.sig = signEvent(event, this.adminPrivkey);

    await this.publishToAllRelays(event);
    return event;
  }

  /**
   * Moderation Actions
   */
  async blockUser(userPubkey, scope, targetId, options = {}) {
    const moderationData = {
      moderation_id: `block:user:${userPubkey}:${Date.now()}`,
      action: 'block',
      target_type: 'user',
      target_id: userPubkey,
      scope: scope || 'global',
      
      timing: {
        start_time: options.startTime || Math.floor(Date.now() / 1000),
        end_time: options.endTime || null,
        duration_seconds: options.duration || null
      },
      
      details: {
        reason: options.reason || 'Violating community guidelines',
        moderator: this.adminPubkey,
        moderator_name: 'Admin',
        evidence: options.evidence || [],
        severity: options.severity || 'medium',
        public_reason: options.publicReason || 'Violating community guidelines',
        private_notes: options.privateNotes || ''
      },
      
      restrictions: {
        block_posting: true,
        block_reading: options.blockReading || false,
        hide_history: options.hideHistory || false,
        auto_delete: options.autoDelete || false
      },
      
      appeal: {
        can_appeal: options.canAppeal !== false,
        appeal_after: options.appealAfter || (Math.floor(Date.now() / 1000) + 86400),
        appeal_contact: options.appealContact || null
      }
    };

    const event = {
      kind: 31103,
      pubkey: this.adminPubkey,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['d', moderationData.moderation_id],
        ['action', 'block'],
        ['target_type', 'user'],
        ['target_id', userPubkey],
        ['scope', scope || 'global'],
        ['app', this.client.CONFIG.APP_NAME],
        ['v', '1.0']
      ],
      content: encrypt(moderationData, this.client.CONFIG.ACCESS_LEVELS.PUBLIC.key)
    };

    event.id = getEventHash(event);
    event.sig = signEvent(event, this.adminPrivkey);

    await this.publishToAllRelays(event);
    return event;
  }

  async freezeChannel(channelId, options = {}) {
    const moderationData = {
      moderation_id: `freeze:channel:${channelId}:${Date.now()}`,
      action: 'freeze',
      target_type: 'channel',
      target_id: channelId,
      scope: 'channel',
      
      timing: {
        start_time: options.startTime || Math.floor(Date.now() / 1000),
        end_time: options.endTime || null
      },
      
      details: {
        reason: options.reason || 'Maintenance',
        moderator: this.adminPubkey,
        public_reason: options.publicReason || 'Channel temporarily unavailable'
      }
    };

    const event = {
      kind: 31103,
      pubkey: this.adminPubkey,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['d', moderationData.moderation_id],
        ['action', 'freeze'],
        ['target_type', 'channel'],
        ['target_id', channelId],
        ['scope', 'channel'],
        ['app', this.client.CONFIG.APP_NAME]
      ],
      content: encrypt(moderationData, this.client.CONFIG.ACCESS_LEVELS.PUBLIC.key)
    };

    event.id = getEventHash(event);
    event.sig = signEvent(event, this.adminPrivkey);

    await this.publishToAllRelays(event);
    return event;
  }

  async unblock(moderationId) {
    // Load existing block
    const block = await this.loadModerationAction(moderationId);
    if (!block) {
      throw new Error('Block not found');
    }

    // Update with end time = now
    const updated = {
      ...block,
      timing: {
        ...block.timing,
        end_time: Math.floor(Date.now() / 1000)
      }
    };

    const event = {
      kind: 31103,
      pubkey: this.adminPubkey,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['d', moderationId],
        ['action', updated.action],
        ['target_type', updated.target_type],
        ['target_id', updated.target_id],
        ['scope', updated.scope],
        ['app', this.client.CONFIG.APP_NAME]
      ],
      content: encrypt(updated, this.client.CONFIG.ACCESS_LEVELS.PUBLIC.key)
    };

    event.id = getEventHash(event);
    event.sig = signEvent(event, this.adminPrivkey);

    await this.publishToAllRelays(event);
    return event;
  }

  /**
   * Delegation Management
   */
  async delegateModerator(userPubkey, scope, powers, validUntil) {
    const delegationData = {
      delegation_id: `moderator:${userPubkey}`,
      delegated_to: userPubkey,
      delegated_by: this.adminPubkey,
      created_at: Math.floor(Date.now() / 1000),
      
      validity: {
        valid_from: Math.floor(Date.now() / 1000),
        valid_until: validUntil,
        duration_seconds: validUntil - Math.floor(Date.now() / 1000)
      },
      
      scope: scope,
      powers: powers
    };

    const event = {
      kind: 31104,
      pubkey: this.adminPubkey,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['d', delegationData.delegation_id],
        ['delegated_to', userPubkey],
        ['app', this.client.CONFIG.APP_NAME],
        ['v', '1.0']
      ],
      content: encrypt(delegationData, this.client.CONFIG.ACCESS_LEVELS.PUBLIC.key)
    };

    event.id = getEventHash(event);
    event.sig = signEvent(event, this.adminPrivkey);

    await this.publishToAllRelays(event);
    return event;
  }

  async delegateUpdater(userPubkey, gameScope, fieldRestrictions, validUntil) {
    const delegationData = {
      delegation_id: `updater:${userPubkey}`,
      delegated_to: userPubkey,
      delegated_by: this.adminPubkey,
      created_at: Math.floor(Date.now() / 1000),
      
      validity: {
        valid_from: Math.floor(Date.now() / 1000),
        valid_until: validUntil,
        duration_seconds: validUntil - Math.floor(Date.now() / 1000)
      },
      
      scope: gameScope,
      field_restrictions: fieldRestrictions
    };

    const event = {
      kind: 31105,
      pubkey: this.adminPubkey,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['d', delegationData.delegation_id],
        ['delegated_to', userPubkey],
        ['app', this.client.CONFIG.APP_NAME],
        ['v', '1.0']
      ],
      content: encrypt(delegationData, this.client.CONFIG.ACCESS_LEVELS.PUBLIC.key)
    };

    event.id = getEventHash(event);
    event.sig = signEvent(event, this.adminPrivkey);

    await this.publishToAllRelays(event);
    return event;
  }

  async revokeDelegation(delegationId) {
    // Set valid_until to now
    const delegation = await this.loadDelegation(delegationId);
    if (!delegation) {
      throw new Error('Delegation not found');
    }

    delegation.validity.valid_until = Math.floor(Date.now() / 1000);

    const kind = delegationId.startsWith('moderator:') ? 31104 : 31105;

    const event = {
      kind: kind,
      pubkey: this.adminPubkey,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['d', delegationId],
        ['delegated_to', delegation.delegated_to],
        ['app', this.client.CONFIG.APP_NAME]
      ],
      content: encrypt(delegation, this.client.CONFIG.ACCESS_LEVELS.PUBLIC.key)
    };

    event.id = getEventHash(event);
    event.sig = signEvent(event, this.adminPrivkey);

    await this.publishToAllRelays(event);
    return event;
  }

  /**
   * Helper Methods
   */
  async publishToAllRelays(event) {
    const results = await Promise.allSettled(
      this.client.relays.map(relay =>
        this.client.pool.publish([relay], event)
      )
    );

    const succeeded = results.filter(r => r.status === 'fulfilled').length;
    console.log(`Published to ${succeeded}/${this.client.relays.length} relays`);

    return { succeeded, total: this.client.relays.length };
  }

  async loadChannel(channelId) {
    const events = await this.client.pool.querySync(
      this.client.relays,
      {
        kinds: [31100],
        authors: [this.adminPubkey],
        '#d': [`channel:${channelId}`],
        limit: 1
      }
    );

    if (events.length === 0) return null;

    try {
      return this.client.decryptContent(events[0], null);
    } catch (err) {
      return null;
    }
  }

  async loadForum(forumId) {
    const events = await this.client.pool.querySync(
      this.client.relays,
      {
        kinds: [31101],
        authors: [this.adminPubkey],
        '#d': [`forum:${forumId}`],
        limit: 1
      }
    );

    if (events.length === 0) return null;

    try {
      return this.client.decryptContent(events[0], null);
    } catch (err) {
      return null;
    }
  }

  async loadModerationAction(moderationId) {
    const events = await this.client.pool.querySync(
      this.client.relays,
      {
        kinds: [31103],
        '#d': [moderationId],
        limit: 1
      }
    );

    if (events.length === 0) return null;

    try {
      return this.client.decryptContent(events[0], null);
    } catch (err) {
      return null;
    }
  }

  async loadDelegation(delegationId) {
    const kind = delegationId.startsWith('moderator:') ? 31104 : 31105;

    const events = await this.client.pool.querySync(
      this.client.relays,
      {
        kinds: [kind],
        authors: [this.adminPubkey],
        '#d': [delegationId],
        limit: 1
      }
    );

    if (events.length === 0) return null;

    try {
      return this.client.decryptContent(events[0], null);
    } catch (err) {
      return null;
    }
  }
}

export default AdminTools;
```

---

## Moderation Panel Components

### Moderation Panel Vue Component

```vue
<!-- ModerationPanel.vue -->
<template>
  <div class="moderation-panel-overlay" @click.self="$emit('close')">
    <div class="moderation-panel">
      <div class="panel-header">
        <h2>🛡️ Moderation Panel</h2>
        <button class="close-btn" @click="$emit('close')">×</button>
      </div>

      <div class="panel-tabs">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          :class="['tab-btn', { active: activeTab === tab.id }]"
          @click="activeTab = tab.id"
        >
          {{ tab.name }}
        </button>
      </div>

      <div class="panel-content">
        <!-- Block User Tab -->
        <div v-if="activeTab === 'block-user'" class="tab-content">
          <h3>Block User</h3>
          
          <div class="form-group">
            <label>User Public Key:</label>
            <input v-model="blockForm.userPubkey" placeholder="npub1..." />
          </div>

          <div class="form-group">
            <label>Scope:</label>
            <select v-model="blockForm.scope">
              <option value="global">Global (All channels/forums)</option>
              <option value="global-chat">All Chat Channels</option>
              <option value="global-forum">All Forums</option>
              <option value="channel">This Channel Only</option>
              <option value="forum">This Forum Only</option>
            </select>
          </div>

          <div class="form-group">
            <label>Duration:</label>
            <select v-model="blockForm.duration">
              <option :value="null">Indefinite</option>
              <option :value="3600">1 Hour</option>
              <option :value="86400">24 Hours</option>
              <option :value="604800">7 Days</option>
              <option :value="2592000">30 Days</option>
            </select>
          </div>

          <div class="form-group">
            <label>Reason (Public):</label>
            <textarea v-model="blockForm.publicReason" rows="2"></textarea>
          </div>

          <div class="form-group">
            <label>Private Notes:</label>
            <textarea v-model="blockForm.privateNotes" rows="3"></textarea>
          </div>

          <div class="form-group">
            <label>
              <input type="checkbox" v-model="blockForm.hideHistory" />
              Hide User's Message History
            </label>
          </div>

          <button class="action-btn danger" @click="handleBlockUser">
            Block User
          </button>
        </div>

        <!-- Active Blocks Tab -->
        <div v-if="activeTab === 'active-blocks'" class="tab-content">
          <h3>Active Blocks</h3>

          <div v-if="activeBlocks.length === 0" class="empty-state">
            No active blocks
          </div>

          <div v-else class="blocks-list">
            <div
              v-for="block in activeBlocks"
              :key="block.moderation_id"
              class="block-item"
            >
              <div class="block-header">
                <span class="block-target">
                  {{ block.target_type }}: {{ formatTargetId(block.target_id) }}
                </span>
                <span class="block-scope">{{ block.scope }}</span>
              </div>

              <div class="block-details">
                <p><strong>Reason:</strong> {{ block.details.public_reason }}</p>
                <p><strong>Started:</strong> {{ formatDate(block.timing.start_time) }}</p>
                <p v-if="block.timing.end_time">
                  <strong>Expires:</strong> {{ formatDate(block.timing.end_time) }}
                </p>
                <p v-else><strong>Duration:</strong> Indefinite</p>
              </div>

              <button
                class="action-btn small"
                @click="handleUnblock(block.moderation_id)"
              >
                Unblock
              </button>
            </div>
          </div>
        </div>

        <!-- Freeze Channel/Forum Tab -->
        <div v-if="activeTab === 'freeze'" class="tab-content">
          <h3>Freeze Channel/Forum</h3>

          <div class="form-group">
            <label>Target Type:</label>
            <select v-model="freezeForm.targetType">
              <option value="channel">Channel</option>
              <option value="forum">Forum</option>
            </select>
          </div>

          <div class="form-group">
            <label>Target ID:</label>
            <input v-model="freezeForm.targetId" />
          </div>

          <div class="form-group">
            <label>Duration:</label>
            <select v-model="freezeForm.duration">
              <option :value="null">Indefinite</option>
              <option :value="3600">1 Hour</option>
              <option :value="86400">24 Hours</option>
              <option :value="604800">7 Days</option>
            </select>
          </div>

          <div class="form-group">
            <label>Reason:</label>
            <textarea v-model="freezeForm.reason" rows="3"></textarea>
          </div>

          <button class="action-btn warning" @click="handleFreeze">
            Freeze
          </button>
        </div>

        <!-- Moderators Tab -->
        <div v-if="activeTab === 'moderators'" class="tab-content">
          <h3>Manage Moderators</h3>

          <div class="moderators-list">
            <div
              v-for="mod in moderators"
              :key="mod.delegation_id"
              class="moderator-item"
            >
              <div class="mod-info">
                <strong>{{ formatPubkey(mod.delegated_to) }}</strong>
                <span class="mod-scope">{{ mod.scope.type }}</span>
              </div>
              <div class="mod-expires">
                Expires: {{ formatDate(mod.validity.valid_until) }}
              </div>
              <button
                class="action-btn small danger"
                @click="handleRevokeModerator(mod.delegation_id)"
              >
                Revoke
              </button>
            </div>
          </div>

          <hr />

          <h4>Add New Moderator</h4>

          <div class="form-group">
            <label>User Public Key:</label>
            <input v-model="modForm.userPubkey" placeholder="npub1..." />
          </div>

          <div class="form-group">
            <label>Scope:</label>
            <select v-model="modForm.scope">
              <option value="global">Global</option>
              <option value="global-chat">All Chat Channels</option>
              <option value="global-forum">All Forums</option>
              <option value="specific">Specific Channels/Forums</option>
            </select>
          </div>

          <div v-if="modForm.scope === 'specific'" class="form-group">
            <label>Targets (comma-separated IDs):</label>
            <input v-model="modForm.targets" placeholder="general, help" />
          </div>

          <div class="form-group">
            <label>Valid Until:</label>
            <input type="datetime-local" v-model="modForm.validUntil" />
          </div>

          <div class="form-group">
            <label>Powers:</label>
            <div class="checkbox-group">
              <label><input type="checkbox" v-model="modForm.powers.can_block_users" /> Block Users</label>
              <label><input type="checkbox" v-model="modForm.powers.can_delete_messages" /> Delete Messages</label>
              <label><input type="checkbox" v-model="modForm.powers.can_freeze_threads" /> Freeze Threads</label>
              <label><input type="checkbox" v-model="modForm.powers.can_warn_users" /> Warn Users</label>
              <label><input type="checkbox" v-model="modForm.powers.can_mute_users" /> Mute Users</label>
            </div>
          </div>

          <button class="action-btn" @click="handleAddModerator">
            Add Moderator
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, computed, onMounted } from 'vue';
import AdminTools from './admin-tools';

export default {
  name: 'ModerationPanel',
  props: {
    channel: Object,
    permissionManager: Object,
    adminClient: Object
  },
  emits: ['close'],
  setup(props) {
    const activeTab = ref('block-user');
    const adminTools = ref(null);
    const activeBlocks = ref([]);
    const moderators = ref([]);

    const tabs = [
      { id: 'block-user', name: 'Block User' },
      { id: 'active-blocks', name: 'Active Blocks' },
      { id: 'freeze', name: 'Freeze' },
      { id: 'moderators', name: 'Moderators' }
    ];

    const blockForm = ref({
      userPubkey: '',
      scope: 'channel',
      duration: null,
      publicReason: '',
      privateNotes: '',
      hideHistory: false
    });

    const freezeForm = ref({
      targetType: 'channel',
      targetId: '',
      duration: null,
      reason: ''
    });

    const modForm = ref({
      userPubkey: '',
      scope: 'global-chat',
      targets: '',
      validUntil: '',
      powers: {
        can_block_users: true,
        can_delete_messages: true,
        can_freeze_threads: false,
        can_warn_users: true,
        can_mute_users: true
      }
    });

    onMounted(async () => {
      adminTools.value = new AdminTools(props.adminClient);
      await loadActiveBlocks();
      await loadModerators();
    });

    async function loadActiveBlocks() {
      // Load from permission manager
      const blocks = Array.from(props.permissionManager.moderationBlocks.values());
      activeBlocks.value = blocks.filter(b => {
        const now = Math.floor(Date.now() / 1000);
        return b.timing.start_time <= now && (!b.timing.end_time || b.timing.end_time >= now);
      });
    }

    async function loadModerators() {
      const delegations = Array.from(props.permissionManager.delegations.values());
      moderators.value = delegations.filter(d => d.delegation_id.startsWith('moderator:'));
    }

    async function handleBlockUser() {
      try {
        const options = {
          reason: blockForm.value.privateNotes,
          publicReason: blockForm.value.publicReason,
          duration: blockForm.value.duration,
          hideHistory: blockForm.value.hideHistory,
          endTime: blockForm.value.duration
            ? Math.floor(Date.now() / 1000) + blockForm.value.duration
            : null
        };

        const targetId = blockForm.value.scope === 'channel'
          ? props.channel?.channel_id
          : null;

        await adminTools.value.blockUser(
          blockForm.value.userPubkey,
          blockForm.value.scope,
          targetId,
          options
        );

        alert('User blocked successfully');
        await loadActiveBlocks();

        // Reset form
        blockForm.value = {
          userPubkey: '',
          scope: 'channel',
          duration: null,
          publicReason: '',
          privateNotes: '',
          hideHistory: false
        };
      } catch (err) {
        alert('Failed to block user: ' + err.message);
      }
    }

    async function handleUnblock(moderationId) {
      if (!confirm('Are you sure you want to unblock this user?')) return;

      try {
        await adminTools.value.unblock(moderationId);
        alert('User unblocked successfully');
        await loadActiveBlocks();
      } catch (err) {
        alert('Failed to unblock: ' + err.message);
      }
    }

    async function handleFreeze() {
      try {
        const options = {
          reason: freezeForm.value.reason,
          duration: freezeForm.value.duration,
          endTime: freezeForm.value.duration
            ? Math.floor(Date.now() / 1000) + freezeForm.value.duration
            : null
        };

        await adminTools.value.freezeChannel(freezeForm.value.targetId, options);
        
        alert(`${freezeForm.value.targetType} frozen successfully`);
        
        freezeForm.value = {
          targetType: 'channel',
          targetId: '',
          duration: null,
          reason: ''
        };
      } catch (err) {
        alert('Failed to freeze: ' + err.message);
      }
    }

    async function handleAddModerator() {
      try {
        const validUntil = new Date(modForm.value.validUntil).getTime() / 1000;

        const scope = {
          type: modForm.value.scope,
          targets: modForm.value.scope === 'specific'
            ? modForm.value.targets.split(',').map(s => s.trim())
            : [],
          exclude: []
        };

        await adminTools.value.delegateModerator(
          modForm.value.userPubkey,
          scope,
          modForm.value.powers,
          validUntil
        );

        alert('Moderator added successfully');
        await loadModerators();

        // Reset form
        modForm.value = {
          userPubkey: '',
          scope: 'global-chat',
          targets: '',
          validUntil: '',
          powers: {
            can_block_users: true,
            can_delete_messages: true,
            can_freeze_threads: false,
            can_warn_users: true,
            can_mute_users: true
          }
        };
      } catch (err) {
        alert('Failed to add moderator: ' + err.message);
      }
    }

    async function handleRevokeModerator(delegationId) {
      if (!confirm('Are you sure you want to revoke this moderator?')) return;

      try {
        await adminTools.value.revokeDelegation(delegationId);
        alert('Moderator revoked successfully');
        await loadModerators();
      } catch (err) {
        alert('Failed to revoke moderator: ' + err.message);
      }
    }

    function formatTargetId(id) {
      if (id.length > 16) {
        return id.slice(0, 8) + '...' + id.slice(-8);
      }
      return id;
    }

    function formatPubkey(pubkey) {
      return pubkey.slice(0, 8) + '...';
    }

    function formatDate(timestamp) {
      return new Date(timestamp * 1000).toLocaleString();
    }

    return {
      activeTab,
      tabs,
      blockForm,
      freezeForm,
      modForm,
      activeBlocks,
      moderators,
      handleBlockUser,
      handleUnblock,
      handleFreeze,
      handleAddModerator,
      handleRevokeModerator,
      formatTargetId,
      formatPubkey,
      formatDate
    };
  }
};
</script>

<style scoped>
.moderation-panel-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.8);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.moderation-panel {
  background: #1a1a1a;
  border-radius: 12px;
  width: 90%;
  max-width: 800px;
  max-height: 90vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.panel-header {
  padding: 20px;
  background: #222;
  border-bottom: 2px solid #333;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.panel-header h2 {
  margin: 0;
}

.close-btn {
  background: none;
  border: none;
  color: #fff;
  font-size: 2rem;
  cursor: pointer;
  padding: 0;
  width: 40px;
  height: 40px;
}

.panel-tabs {
  display: flex;
  gap: 5px;
  padding: 10px;
  background: #222;
  border-bottom: 2px solid #333;
}

.tab-btn {
  padding: 10px 20px;
  background: #2a2a2a;
  border: none;
  border-radius: 6px;
  color: #fff;
  cursor: pointer;
  transition: background 0.2s;
}

.tab-btn:hover {
  background: #333;
}

.tab-btn.active {
  background: #0084ff;
}

.panel-content {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}

.tab-content {
  max-width: 600px;
  margin: 0 auto;
}

.form-group {
  margin-bottom: 20px;
}

.form-group label {
  display: block;
  margin-bottom: 5px;
  color: #ccc;
}

.form-group input[type="text"],
.form-group input[type="datetime-local"],
.form-group select,
.form-group textarea {
  width: 100%;
  padding: 10px;
  background: #2a2a2a;
  border: 1px solid #444;
  border-radius: 6px;
  color: #fff;
  font-family: inherit;
}

.checkbox-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.checkbox-group label {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.action-btn {
  padding: 12px 24px;
  background: #0084ff;
  color: #fff;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-weight: bold;
  font-size: 1rem;
}

.action-btn:hover {
  background: #0066cc;
}

.action-btn.danger {
  background: #ff4444;
}

.action-btn.danger:hover {
  background: #cc0000;
}

.action-btn.warning {
  background: #ffa500;
}

.action-btn.warning:hover {
  background: #cc8400;
}

.action-btn.small {
  padding: 6px 12px;
  font-size: 0.9rem;
}

.blocks-list,
.moderators-list {
  display: flex;
  flex-direction: column;
  gap: 15px;
}

.block-item,
.moderator-item {
  background: #2a2a2a;
  padding: 15px;
  border-radius: 8px;
  border-left: 4px solid #ff4444;
}

.moderator-item {
  border-left-color: #0084ff;
}

.block-header,
.mod-info {
  display: flex;
  justify-content: space-between;
  margin-bottom: 10px;
}

.block-scope,
.mod-scope {
  background: #444;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 0.8rem;
}

.block-details {
  margin-bottom: 10px;
  font-size: 0.9rem;
  line-height: 1.6;
}

.empty-state {
  text-align: center;
  padding: 40px;
  color: #888;
}
</style>
```

This is Part 1 of the continuation. The document includes:
1. Complete ForumManager implementation
2. AdminTools class with all management functions
3. Full ModerationPanel Vue component

Would you like me to create Part 2 with:
- Forum UI components
- Admin dashboard interface
- Complete workflow examples
- Testing strategies
