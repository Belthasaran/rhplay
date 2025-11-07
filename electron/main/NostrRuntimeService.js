const { EventEmitter } = require('events');
const { BrowserWindow } = require('electron');
const { SimplePool, validateEvent, nip19, getEventHash } = require('nostr-tools');
const { NostrLocalDBManager } = require('../utils/NostrLocalDBManager');
const TrustManager = require('../utils/TrustManager');

const DEFAULT_STARTER_RELAYS = [
  {
    relayUrl: 'wss://relay.damus.io',
    label: 'Damus Relay',
    categories: ['trusted-core', 'profiles'],
    priority: 120,
    read: 1,
    write: 1,
    addedBy: 'system'
  },
  {
    relayUrl: 'wss://relay.nostr.band',
    label: 'nostr.band',
    categories: ['trusted-core', 'ratings'],
    priority: 110,
    read: 1,
    write: 1,
    addedBy: 'system'
  },
  {
    relayUrl: 'wss://nos.lol',
    label: 'nos.lol',
    categories: ['profiles', 'ratings'],
    priority: 100,
    read: 1,
    write: 1,
    addedBy: 'system'
  }
];

const DEFAULT_SUBSCRIPTION_KINDS = [0, 3, 31001, 31106, 31107];
const SUBSCRIPTION_REFRESH_INTERVAL_MS = 10 * 60 * 1000;
const DEFAULT_OUTGOING_FLUSH_INTERVAL_MS = 10 * 1000;
const MESSAGE_THROTTLE_COOLDOWN_MS = 60 * 1000;
const NUMERIC_RATING_FIELDS = [
  'user_review_rating',
  'user_difficulty_rating',
  'user_skill_rating',
  'user_skill_rating_when_beat',
  'user_recommendation_rating',
  'user_importance_rating',
  'user_technical_quality_rating',
  'user_gameplay_design_rating',
  'user_originality_rating',
  'user_visual_aesthetics_rating',
  'user_story_rating',
  'user_soundtrack_graphics_rating'
];
const COMMENT_RATING_FIELDS = [
  'user_difficulty_comment',
  'user_skill_comment',
  'user_skill_comment_when_beat',
  'user_review_comment',
  'user_recommendation_comment',
  'user_importance_comment',
  'user_technical_quality_comment',
  'user_gameplay_design_comment',
  'user_originality_comment',
  'user_visual_aesthetics_comment',
  'user_story_comment',
  'user_soundtrack_graphics_comment'
];
const TIMESTAMP_FIELDS = ['created_at_ts', 'updated_at_ts'];

class NostrRuntimeService extends EventEmitter {
  constructor(dbManager, options = {}) {
    super();
    if (!dbManager) {
      throw new Error('NostrRuntimeService requires a DatabaseManager instance');
    }

    this.dbManager = dbManager;
    this.logger = options.logger || console;
    this.statusIntervalMs = options.statusIntervalMs || 15000;
    this.queueIntervalMs = options.queueIntervalMs || 30000;
    this.outgoingFlushIntervalMs = options.outgoingFlushIntervalMs || DEFAULT_OUTGOING_FLUSH_INTERVAL_MS;
    this.subscriptionRefreshMs = options.subscriptionRefreshMs || SUBSCRIPTION_REFRESH_INTERVAL_MS;

    this.localDb = new NostrLocalDBManager({ dbManager, logger: this.logger });
    this.localDb.setDatabaseManager(dbManager);
    this.setupWebSocketPolyfill();

    this.trustManager = new TrustManager(dbManager, { logger: this.logger });

    this.cachedMode = 'offline';
    try {
      this.cachedMode = this.localDb.getOperatingMode();
    } catch (error) {
      this.logger.warn('[NostrRuntimeService] Failed to read initial operating mode:', error.message);
    }

    this.localDb.ensureDefaultRelays(DEFAULT_STARTER_RELAYS);

    if (typeof this.localDb.initialize === 'function') {
      this.localDb.initialize().catch((error) => {
        this.logger.warn('[NostrRuntimeService] Lazy initialization of Nostr databases failed:', error.message);
      });
    }

    this.running = false;
    this.background = false;
    this.lastHeartbeat = null;
    this.lastModeChange = null;
    this.statusTimer = null;
    this.queueTimer = null;
    this.outgoingTimer = null;
    this.subscriptionRefreshTimer = null;
    this.outgoingFlushTimeout = null;
    this.flushingOutgoing = false;
    this.outgoingThrottleUntil = 0;
    this.messageUnitsHistory = [];
    this.lastQueueStats = this.computeQueueStats();

    this.pool = null;
    this.relayUrls = [];
    this.activeSubscription = null;
    this.lastSubscriptionAt = null;
    this.lastSubscriptionFilters = null;
    this.handleIncomingEventBound = (event) => this.handleIncomingEvent(event);

    if (this.isOnline()) {
      this.ensureConnections().catch((error) => {
        this.logger.warn('[NostrRuntimeService] Initial connection attempt failed:', error.message);
      });
    }
  }

  setupWebSocketPolyfill() {
    try {
      if (typeof WebSocket === 'undefined') {
        const ws = require('ws');
        global.WebSocket = ws;
      }
    } catch (error) {
      this.logger.warn('[NostrRuntimeService] Failed to ensure WebSocket polyfill:', error.message);
    }
  }

  start() {
    if (this.running) {
      return this.broadcastStatus();
    }
    this.running = true;
    this.background = false;
    this.lastHeartbeat = Date.now();
    this.refreshQueueStats();
    this.statusTimer = setInterval(() => {
      this.lastHeartbeat = Date.now();
      this.broadcastStatus();
    }, this.statusIntervalMs);
    this.queueTimer = setInterval(() => {
      this.refreshQueueStats();
      this.broadcastStatus();
    }, this.queueIntervalMs);
    if (this.isOnline()) {
      this.ensureConnections().catch((error) => {
        this.logger.warn('[NostrRuntimeService] Connection attempt failed:', error.message);
      });
    }
    return this.broadcastStatus();
  }

  shutdown(options = {}) {
    const keepBackground = !!options.keepBackground;
    if (this.statusTimer) {
      clearInterval(this.statusTimer);
      this.statusTimer = null;
    }
    if (this.queueTimer) {
      clearInterval(this.queueTimer);
      this.queueTimer = null;
    }
    if (!keepBackground) {
      this.disconnectFromRelays();
      this.clearOutgoingTimer();
      this.clearSubscriptionRefreshTimer();
    }
    this.clearFlushTimeout();
    this.running = false;
    this.background = keepBackground;
    return this.broadcastStatus();
  }

  getStatusSnapshot() {
    const snapshot = {
      mode: this.cachedMode,
      resourceLimits: this.safeCall(() => this.localDb.getResourceLimits(), { ...NostrLocalDBManager.DEFAULT_RESOURCE_LIMITS }),
      relayCategories: this.safeCall(() => this.localDb.getRelayCategoryPreference(), []),
      relays: this.safeCall(() => this.localDb.listRelays(), []),
      preferredRelays: this.safeCall(() => this.localDb.selectPreferredRelays(), []),
      manualFollows: this.safeCall(() => this.localDb.getManualFollowEntries(), []),
      queueStats: this.lastQueueStats || this.computeQueueStats(),
      runtime: {
        running: this.running,
        background: this.background,
        lastHeartbeat: this.lastHeartbeat,
        lastModeChange: this.lastModeChange,
        statusIntervalMs: this.statusIntervalMs,
        queueIntervalMs: this.queueIntervalMs,
        outgoingFlushIntervalMs: this.outgoingFlushIntervalMs,
        subscriptionRefreshMs: this.subscriptionRefreshMs,
        connectedRelays: this.relayUrls.length
      },
      timestamp: Date.now(),
      notes: this.isOnline()
        ? 'Nostr runtime service connected. Event networking active.'
        : 'Nostr runtime service is idle. Enable Online Mode to connect.'
    };
    return snapshot;
  }

  broadcastStatus(status) {
    const snapshot = status || this.getStatusSnapshot();
    this.emit('status', snapshot);
    return snapshot;
  }

  safeCall(callback, fallback) {
    try {
      return callback();
    } catch (error) {
      this.logger.warn('[NostrRuntimeService] safeCall fallback:', error.message);
      return fallback;
    }
  }

  isOnline() {
    return this.cachedMode === 'online';
  }

  setMode(mode) {
    if (!mode) {
      throw new Error('Mode is required');
    }
    const normalized = mode === 'online' ? 'online' : 'offline';
    this.localDb.setOperatingMode(normalized);
    this.cachedMode = normalized;
    this.lastModeChange = Date.now();
    if (normalized === 'online') {
      this.ensureConnections(true).catch((error) => {
        this.logger.warn('[NostrRuntimeService] Failed to ensure connections after mode change:', error.message);
      });
    } else {
      this.disconnectFromRelays();
      this.clearOutgoingTimer();
      this.clearSubscriptionRefreshTimer();
    }
    return this.broadcastStatus();
  }

  getResourceLimits() {
    return this.localDb.getResourceLimits();
  }

  setResourceLimits(updates = {}) {
    const limits = this.localDb.setResourceLimits(updates);
    this.refreshQueueStats();
    this.broadcastStatus();
    return limits;
  }

  getRelayCategoryPreference() {
    return this.localDb.getRelayCategoryPreference();
  }

  setRelayCategoryPreference(categories = []) {
    this.localDb.setRelayCategoryPreference(categories);
    if (this.isOnline()) {
      this.ensureConnections(true).catch((error) => {
        this.logger.warn('[NostrRuntimeService] Failed to reconnect after relay category change:', error.message);
      });
    }
    this.broadcastStatus();
    return this.getRelayCategoryPreference();
  }

  listRelays(options = {}) {
    return this.localDb.listRelays(options);
  }

  addRelay(relay) {
    const record = this.localDb.upsertRelay({ ...relay, addedBy: relay?.addedBy || 'user' });
    if (this.isOnline()) {
      this.ensureConnections(true).catch((error) => {
        this.logger.warn('[NostrRuntimeService] Failed to reconnect after adding relay:', error.message);
      });
    }
    this.broadcastStatus();
    return record;
  }

  updateRelay(relayUrl, changes = {}) {
    const record = this.localDb.updateRelay(relayUrl, changes);
    if (this.isOnline()) {
      this.ensureConnections(true).catch((error) => {
        this.logger.warn('[NostrRuntimeService] Failed to reconnect after updating relay:', error.message);
      });
    }
    this.broadcastStatus();
    return record;
  }

  removeRelay(relayUrl, options = {}) {
    const removed = this.localDb.removeRelay(relayUrl, options);
    if (this.isOnline()) {
      this.ensureConnections(true).catch((error) => {
        this.logger.warn('[NostrRuntimeService] Failed to reconnect after removing relay:', error.message);
      });
    }
    this.broadcastStatus();
    return removed;
  }

  getManualFollowEntries() {
    return this.localDb.getManualFollowEntries();
  }

  setManualFollowEntries(entries = []) {
    const list = this.localDb.setManualFollowEntries(entries);
    if (this.isOnline()) {
      this.refreshSubscription().catch((error) => {
        this.logger.warn('[NostrRuntimeService] Failed to refresh subscription after follow update:', error.message);
      });
    }
    this.broadcastStatus();
    return list;
  }

  addManualFollowEntry(entry) {
    const list = this.localDb.addManualFollowEntry(entry);
    if (this.isOnline()) {
      this.refreshSubscription().catch((error) => {
        this.logger.warn('[NostrRuntimeService] Failed to refresh subscription after adding follow:', error.message);
      });
    }
    this.broadcastStatus();
    return list;
  }

  removeManualFollowEntry(pubkey) {
    const list = this.localDb.removeManualFollowEntry(pubkey);
    if (this.isOnline()) {
      this.refreshSubscription().catch((error) => {
        this.logger.warn('[NostrRuntimeService] Failed to refresh subscription after removing follow:', error.message);
      });
    }
    this.broadcastStatus();
    return list;
  }

  async publishEvent(payload = {}) {
    const event = payload.event;
    if (!event || typeof event !== 'object') {
      throw new Error('Payload must include an event object');
    }

    const enrichedEvent = { ...event };
    if (!enrichedEvent.id) {
      enrichedEvent.id = getEventHash(enrichedEvent);
    }

    const tableName = payload.tableName || null;
    const recordUuid = payload.recordUuid || null;
    const userProfileUuid = payload.userProfileUuid || null;
    const keepFor = payload.keepFor || null;

    const added = this.localDb.addEvent('cache_out', enrichedEvent, 0, keepFor, tableName, recordUuid, userProfileUuid);
    if (!added) {
      throw new Error('Failed to enqueue Nostr event for publishing');
    }

    this.refreshQueueStats();
    this.broadcastStatus();
    this.triggerOutgoingFlush(200);
    return { eventId: enrichedEvent.id };
  }

  getQueueSnapshot(limit = 25) {
    return {
      outgoing: {
        pending: this.fetchQueueEntries('cache_out', 0, limit),
        processing: this.fetchQueueEntries('cache_out', 1, limit),
        completed: this.fetchQueueEntries('cache_out', 2, limit),
        failed: this.fetchQueueEntries('cache_out', -1, limit)
      },
      incoming: {
        pending: this.fetchQueueEntries('cache_in', 0, limit)
      },
      generatedAt: Date.now()
    };
  }

  refreshQueueStats() {
    this.lastQueueStats = this.computeQueueStats();
    return this.lastQueueStats;
  }

  computeQueueStats() {
    const nowUnix = Math.floor(Date.now() / 1000);
    return {
      outgoingPending: this.countEvents('cache_out', 'proc_status = 0'),
      outgoingProcessing: this.countEvents('cache_out', 'proc_status = 1'),
      outgoingCompleted: this.countEvents('cache_out', 'proc_status = 2'),
      outgoingFailed: this.countEvents('cache_out', 'proc_status < 0'),
      outgoingSentLastMinute: this.countEvents('cache_out', 'proc_status = 2 AND proc_at IS NOT NULL AND proc_at >= ?', [nowUnix - 60]),
      incomingBacklog: this.countEvents('cache_in', 'proc_status = 0')
    };
  }

  countEvents(dbType, whereClause, params = []) {
    try {
      const db = this.localDb.getConnection(dbType);
      const row = db.prepare(`SELECT COUNT(*) AS count FROM nostr_raw_events WHERE ${whereClause}`).get(...params);
      return row ? row.count : 0;
    } catch (error) {
      this.logger.warn(`[NostrRuntimeService] countEvents failed for ${dbType}: ${error.message}`);
      return 0;
    }
  }

  fetchQueueEntries(dbType, procStatus, limit) {
    try {
      const db = this.localDb.getConnection(dbType);
      const rows = db.prepare(`
        SELECT 
          nostr_event_id,
          nostr_kind,
          nostr_publickey,
          nostr_createdat,
          table_name,
          record_uuid,
          user_profile_uuid,
          proc_status,
          proc_at,
          signature
        FROM nostr_raw_events
        WHERE proc_status = ?
        ORDER BY nostr_createdat ASC
        LIMIT ?
      `).all(procStatus, limit);

      return rows.map((row) => ({
        id: row.nostr_event_id,
        kind: row.nostr_kind,
        pubkey: row.nostr_publickey,
        createdAt: row.nostr_createdat,
        tableName: row.table_name,
        recordUuid: row.record_uuid,
        userProfileUuid: row.user_profile_uuid,
        procStatus: row.proc_status,
        processedAt: row.proc_at,
        signature: row.signature
      }));
    } catch (error) {
      if (error && typeof error.message === 'string' && error.message.includes('no such table')) {
        return [];
      }
      this.logger.warn(`[NostrRuntimeService] fetchQueueEntries failed for ${dbType}: ${error.message}`);
      return [];
    }
  }

  attachWindowListeners() {
    BrowserWindow.getAllWindows().forEach((win) => {
      this.sendStatusToWindow(win, this.getStatusSnapshot());
    });
  }

  sendStatusToWindow(win, status) {
    if (!win || win.isDestroyed()) return;
    try {
      win.webContents.send('nostr:nrs:status', status);
    } catch (error) {
      this.logger.warn('[NostrRuntimeService] Failed to send status to window:', error.message);
    }
  }

  async ensureConnections(force = false) {
    if (!this.isOnline()) {
      this.disconnectFromRelays();
      this.clearOutgoingTimer();
      this.clearSubscriptionRefreshTimer();
      return;
    }

    this.ensureOutgoingTimer();
    this.ensureSubscriptionRefreshTimer();

    const relayUrls = this.getRelayUrlsForConnection();
    if (!relayUrls.length) {
      this.logger.warn('[NostrRuntimeService] No relays available for connection.');
      return;
    }

    const changed =
      force ||
      !this.pool ||
      !this.arraysEqual(relayUrls, this.relayUrls);

    if (!changed) {
      await this.refreshSubscription();
      return;
    }

    await this.connectToRelays(relayUrls);
  }

  async connectToRelays(relayUrls) {
    await this.disconnectFromRelays();
    this.pool = new SimplePool();
    this.relayUrls = relayUrls;
    this.logger.info(`[NostrRuntimeService] Connecting to ${relayUrls.length} relay(s).`);
    await this.subscribeToRelays();
    this.triggerOutgoingFlush(200);
  }

  async disconnectFromRelays() {
    if (this.activeSubscription && typeof this.activeSubscription.close === 'function') {
      try {
        this.activeSubscription.close();
      } catch (error) {
        this.logger.warn('[NostrRuntimeService] Failed to close subscription:', error.message);
      }
    }
    this.activeSubscription = null;
    this.lastSubscriptionAt = null;
    this.lastSubscriptionFilters = null;

    if (this.pool && this.relayUrls.length) {
      try {
        this.pool.close(this.relayUrls);
      } catch (error) {
        this.logger.warn('[NostrRuntimeService] Failed to close relay connections:', error.message);
      }
    }
    this.pool = null;
    this.relayUrls = [];
  }

  async subscribeToRelays(force = false) {
    if (!this.pool || !this.relayUrls.length) {
      return;
    }

    const filters = this.buildSubscriptionFilters();
    const filtersKey = JSON.stringify(filters);
    if (!force && this.lastSubscriptionFilters === filtersKey && this.activeSubscription) {
      return;
    }

    if (this.activeSubscription && typeof this.activeSubscription.close === 'function') {
      try {
        this.activeSubscription.close();
      } catch (error) {
        this.logger.warn('[NostrRuntimeService] Failed to close previous subscription:', error.message);
      }
    }

    this.lastSubscriptionFilters = filtersKey;
    this.lastSubscriptionAt = Date.now();
    this.activeSubscription = this.pool.subscribeMany(this.relayUrls, filters, {
      onevent: this.handleIncomingEventBound,
      oneose: () => {
        this.logger.debug?.('[NostrRuntimeService] Subscription EOSE received.');
      }
    });
  }

  async refreshSubscription() {
    await this.subscribeToRelays(true);
  }

  async reconnectToRelays() {
    await this.ensureConnections(true);
  }

  buildSubscriptionFilters() {
    const authors = this.getFollowPubkeys();
    const baseFilter = { kinds: DEFAULT_SUBSCRIPTION_KINDS, limit: 200 };
    if (authors.length) {
      return [baseFilter, { kinds: DEFAULT_SUBSCRIPTION_KINDS, authors, limit: 200 }];
    }
    return [baseFilter];
  }

  getRelayUrlsForConnection() {
    let relays;
    try {
      relays = this.localDb.listRelays({ read: true });
    } catch (error) {
      this.logger.warn('[NostrRuntimeService] Failed to list relays:', error.message);
      relays = [];
    }
    if (!relays || !relays.length) {
      this.localDb.ensureDefaultRelays(DEFAULT_STARTER_RELAYS);
      relays = this.localDb.listRelays({ read: true });
    }
    const urls = Array.from(new Set(relays.filter((relay) => relay?.relayUrl).map((relay) => relay.relayUrl.trim())));
    return urls;
  }

  getFollowPubkeys() {
    const follows = new Set();

    const manual = this.localDb.getManualFollowEntries();
    manual.forEach((entry) => {
      const hex = this.normalizePubkey(entry.pubkey || entry.npub);
      if (hex) {
        follows.add(hex);
      }
    });

    const db = this.localDb.getClientDb();
    try {
      const adminRows = db.prepare(`
        SELECT public_key_hex, public_key
        FROM admin_keypairs
        WHERE (keypair_type LIKE 'Nostr%' OR LOWER(keypair_type) LIKE '%nostr%')
      `).all();
      adminRows.forEach((row) => {
        const hex = this.normalizePubkey(row.public_key_hex || row.public_key);
        if (hex) {
          follows.add(hex);
        }
      });
    } catch (error) {
      this.logger.warn('[NostrRuntimeService] Failed to enumerate admin keypairs for follow list:', error.message);
    }

    try {
      const profileRows = db.prepare(`
        SELECT public_key_hex, public_key
        FROM profile_keypairs
        WHERE public_key_hex IS NOT NULL OR public_key IS NOT NULL
      `).all();
      profileRows.forEach((row) => {
        const hex = this.normalizePubkey(row.public_key_hex || row.public_key);
        if (hex) {
          follows.add(hex);
        }
      });
    } catch (error) {
      this.logger.warn('[NostrRuntimeService] Failed to enumerate profile keypairs for follow list:', error.message);
    }

    return Array.from(follows);
  }

  normalizePubkey(value) {
    if (!value) {
      return null;
    }
    const trimmed = String(value).trim();
    if (!trimmed) {
      return null;
    }
    if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
      return trimmed.toLowerCase();
    }
    if (trimmed.startsWith('npub')) {
      try {
        const decoded = nip19.decode(trimmed);
        if (decoded && decoded.type === 'npub' && decoded.data) {
          return Buffer.from(decoded.data).toString('hex');
        }
      } catch (error) {
        this.logger.warn(`[NostrRuntimeService] Failed to decode npub: ${trimmed}:`, error.message);
      }
    }
    return null;
  }

  async handleIncomingEvent(event) {
    if (!event || typeof event !== 'object') {
      return;
    }

    if (!validateEvent(event)) {
      this.logger.warn('[NostrRuntimeService] Discarded invalid Nostr event:', event?.id);
      return;
    }

    const limits = this.getResourceLimits();
    if (limits?.incomingBacklogMax && this.lastQueueStats?.incomingBacklog >= limits.incomingBacklogMax) {
      this.logger.warn('[NostrRuntimeService] Incoming backlog limit reached; event dropped.');
      return;
    }

    const tableName = this.mapEventToTable(event);
    const recordUuid = this.extractRecordUuid(event);
    const userProfileUuid = this.extractUserProfileUuid(event);
    const keepFor = this.computeKeepFor(event.kind);

    const stored = this.localDb.addEvent('cache_in', event, 0, keepFor, tableName, recordUuid, userProfileUuid);
    if (!stored) {
      this.logger.warn('[NostrRuntimeService] Failed to store incoming event:', event.id);
      return;
    }

    if (event.kind === 31001) {
      try {
        await this.processRatingEvent(event);
      } catch (error) {
        this.logger.warn(`[NostrRuntimeService] Failed to process rating event ${event.id}:`, error.message);
      }
    }

    this.refreshQueueStats();
    this.broadcastStatus();
  }

  mapEventToTable(event) {
    switch (event.kind) {
      case 0:
        return 'user_profiles';
      case 31106:
        return 'admindeclarations';
      case 31107:
        return 'admin_keypairs';
      case 31001:
        return 'user_game_annotations';
      default:
        return null;
    }
  }

  extractRecordUuid(event) {
    if (!Array.isArray(event.tags)) {
      return null;
    }
    const dTag = event.tags.find((tag) => Array.isArray(tag) && tag[0] === 'd' && tag[1]);
    if (dTag) {
      return String(dTag[1]).trim();
    }
    return null;
  }

  extractUserProfileUuid(event) {
    // Placeholder: we can extend this once event schema encodes profile UUIDs explicitly
    return null;
  }

  computeKeepFor(kind) {
    const ONE_DAY = 86400;
    switch (kind) {
      case 0:
      case 3:
        return 30 * ONE_DAY;
      case 31106:
        return 365 * ONE_DAY;
      case 31107:
        return 90 * ONE_DAY;
      case 31001:
        return 120 * ONE_DAY;
      default:
        return 14 * ONE_DAY;
    }
  }

  async flushOutgoingQueue() {
    if (this.flushingOutgoing) {
      return;
    }
    if (!this.pool || !this.relayUrls.length) {
      return;
    }
    const now = Date.now();
    if (this.outgoingThrottleUntil > now) {
      this.triggerOutgoingFlush(this.outgoingThrottleUntil - now);
      return;
    }

    const limits = this.getResourceLimits();
    const windowMs = (limits?.messageRateWindowSeconds || 120) * 1000;
    this.trimMessageHistory(now, windowMs);

    const pending = this.localDb.getEventsByStatus('cache_out', 0, limits?.outgoingPerMinute || 25);
    if (!pending.length) {
      return;
    }

    this.flushingOutgoing = true;
    let sentCount = 0;
    try {
      for (const row of pending) {
        const event = this.buildEventFromRow(row);
        if (!event.sig) {
          this.logger.warn('[NostrRuntimeService] Skipping outgoing event with no signature:', event.id);
          this.localDb.updateEventStatus('cache_out', event.id, -1);
          continue;
        }

        const eventJsonLength = Buffer.byteLength(JSON.stringify(event), 'utf8');
        const units = this.localDb.estimateMessageUnits(eventJsonLength);
        const usedUnits = this.calculateUsedUnits(now, windowMs);
        if (limits?.messageRateUnits && usedUnits + units > limits.messageRateUnits) {
          this.outgoingThrottleUntil = now + MESSAGE_THROTTLE_COOLDOWN_MS;
          this.logger.warn('[NostrRuntimeService] Outgoing rate limit reached; throttling new publishes.');
          this.triggerOutgoingFlush(this.outgoingThrottleUntil - now);
          break;
        }

        this.localDb.updateEventStatus('cache_out', event.id, 1);
        try {
          await this.pool.publish(this.relayUrls, event);
          this.localDb.updateEventStatus('cache_out', event.id, 2);
          this.localDb.moveEventToStore('cache_out', 'store_out', event.id);
          this.recordMessageUnits(units);
          sentCount += 1;
        } catch (error) {
          this.logger.warn(`[NostrRuntimeService] Failed to publish event ${event.id}:`, error.message);
          this.localDb.updateEventStatus('cache_out', event.id, 0);
        }
      }
    } finally {
      this.flushingOutgoing = false;
      if (sentCount > 0) {
        this.refreshQueueStats();
        this.broadcastStatus();
      }
    }
  }

  async processRatingEvent(event) {
    let content;
    try {
      content = JSON.parse(event.content || '{}');
    } catch (error) {
      this.logger.warn(`[NostrRuntimeService] Invalid rating event content for ${event.id}:`, error.message);
      return;
    }

    const ratingPayload = content?.rating || {};
    const normalizedRating = this.normalizeRatingPayload(ratingPayload);

    const gameId = content?.gameid || this.extractTagValue(event.tags, 'gameid');
    if (!gameId) {
      this.logger.warn(`[NostrRuntimeService] Rating event ${event.id} missing gameid; skipping.`);
      return;
    }

    const raterPubkey = (event.pubkey || '').toLowerCase();
    if (!raterPubkey) {
      this.logger.warn(`[NostrRuntimeService] Rating event ${event.id} missing pubkey; skipping.`);
      return;
    }

    const ratingsDb = this.dbManager.getConnection('ratings');
    const trustLevel = this.trustManager.getTrustLevel(raterPubkey);
    const trustTier = this.trustManager.mapTrustLevelToTier(trustLevel);
    const gvuuid = content?.gvuuid || this.extractTagValue(event.tags, 'gvuuid');
    const version = Number(content?.version || this.extractTagValue(event.tags, 'version') || 1) || 1;
    const status = content?.status || 'Default';
    const createdAtTs = normalizedRating.created_at_ts ?? event.created_at ?? null;
    const updatedAtTs = normalizedRating.updated_at_ts ?? createdAtTs;
    const publishedAt = event.created_at || Math.floor(Date.now() / 1000);
    const receivedAt = Math.floor(Date.now() / 1000);
    const overallRating = normalizedRating.user_review_rating ?? null;
    const difficultyRating = normalizedRating.user_difficulty_rating ?? null;
    const userNotes = content?.user_notes || null;
    const tagsJson = JSON.stringify(event.tags || []);
    const ratingJsonStr = JSON.stringify(normalizedRating);

    const existing = ratingsDb.prepare(`
      SELECT event_id, published_at FROM rating_events WHERE rater_pubkey = ? AND gameid = ?
    `).get(raterPubkey, gameId);

    if (existing) {
      if (existing.event_id === event.id) {
        return; // already stored
      }
      if (existing.published_at && existing.published_at > publishedAt) {
        this.logger.info(`[NostrRuntimeService] Ignoring older rating event ${event.id} for ${raterPubkey}/${gameId}`);
        return;
      }
    }

    ratingsDb.prepare(`
      INSERT INTO rating_events (
        rater_pubkey, gameid, gvuuid, version, status, rating_json, user_notes,
        overall_rating, difficulty_rating, created_at_ts, updated_at_ts,
        published_at, received_at, trust_level, trust_tier, event_id, signature, tags_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(rater_pubkey, gameid) DO UPDATE SET
        gvuuid = excluded.gvuuid,
        version = excluded.version,
        status = excluded.status,
        rating_json = excluded.rating_json,
        user_notes = excluded.user_notes,
        overall_rating = excluded.overall_rating,
        difficulty_rating = excluded.difficulty_rating,
        created_at_ts = excluded.created_at_ts,
        updated_at_ts = excluded.updated_at_ts,
        published_at = excluded.published_at,
        received_at = excluded.received_at,
        trust_level = excluded.trust_level,
        trust_tier = excluded.trust_tier,
        event_id = excluded.event_id,
        signature = excluded.signature,
        tags_json = excluded.tags_json
    `).run(
      raterPubkey,
      gameId,
      gvuuid || null,
      version,
      status,
      ratingJsonStr,
      userNotes,
      overallRating,
      difficultyRating,
      createdAtTs,
      updatedAtTs,
      publishedAt,
      receivedAt,
      trustLevel,
      trustTier,
      event.id,
      event.sig || null,
      tagsJson
    );

    try {
      this.updateRatingSummaries(ratingsDb, gameId);
    } catch (error) {
      this.logger.warn(`[NostrRuntimeService] Failed updating rating summaries for ${gameId}:`, error.message);
    }
  }

  normalizeRatingPayload(payload = {}) {
    const normalized = { ...payload };
    NUMERIC_RATING_FIELDS.forEach((field) => {
      const value = payload[field];
      if (value === null || value === undefined || value === '') {
        normalized[field] = null;
      } else {
        const num = Number(value);
        normalized[field] = Number.isFinite(num) ? num : null;
      }
    });
    COMMENT_RATING_FIELDS.forEach((field) => {
      const value = payload[field];
      if (value === null || value === undefined) {
        normalized[field] = null;
      } else {
        const str = String(value).trim();
        normalized[field] = str.length > 0 ? str : null;
      }
    });
    TIMESTAMP_FIELDS.forEach((field) => {
      const value = payload[field];
      if (value === null || value === undefined || value === '') {
        normalized[field] = null;
      } else {
        const num = Number(value);
        normalized[field] = Number.isFinite(num) ? Math.floor(num) : null;
      }
    });
    return normalized;
  }

  extractTagValue(tags, name) {
    if (!Array.isArray(tags)) {
      return null;
    }
    const entry = tags.find((tag) => Array.isArray(tag) && tag[0] === name && tag[1]);
    return entry ? String(entry[1]).trim() : null;
  }

  updateRatingSummaries(ratingsDb, gameId) {
    const rows = ratingsDb.prepare('SELECT rating_json, trust_tier FROM rating_events WHERE gameid = ?').all(gameId);
    const tierMap = new Map();
    rows.forEach((row) => {
      const tier = row.trust_tier || 'unverified';
      let list = tierMap.get(tier);
      if (!list) {
        list = [];
        tierMap.set(tier, list);
      }
      try {
        list.push(JSON.parse(row.rating_json || '{}'));
      } catch (error) {
        this.logger.warn('[NostrRuntimeService] Failed to parse stored rating_json:', error.message);
      }
    });

    const tiersToProcess = new Set([...tierMap.keys(), ...TrustManager.TRUST_TIERS]);
    const upsert = ratingsDb.prepare(`
      INSERT INTO rating_summaries (
        gameid, rating_category, trust_tier, rating_count,
        rating_average, rating_median, rating_stddev, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(gameid, rating_category, trust_tier) DO UPDATE SET
        rating_count = excluded.rating_count,
        rating_average = excluded.rating_average,
        rating_median = excluded.rating_median,
        rating_stddev = excluded.rating_stddev,
        updated_at = excluded.updated_at
    `);
    const remove = ratingsDb.prepare('DELETE FROM rating_summaries WHERE gameid = ? AND rating_category = ? AND trust_tier = ?');
    const now = Math.floor(Date.now() / 1000);

    for (const tier of tiersToProcess) {
      const ratings = tierMap.get(tier) || [];
      NUMERIC_RATING_FIELDS.forEach((field) => {
        const values = ratings
          .map((entry) => (entry && entry[field] !== undefined ? Number(entry[field]) : null))
          .filter((val) => Number.isFinite(val));
        const stats = this.computeStats(values);
        if (stats.count > 0) {
          upsert.run(
            gameId,
            field,
            tier,
            stats.count,
            stats.average,
            stats.median,
            stats.stddev,
            now
          );
        } else {
          remove.run(gameId, field, tier);
        }
      });
    }
  }

  computeStats(values) {
    const count = values.length;
    if (count === 0) {
      return { count: 0, average: null, median: null, stddev: null };
    }
    const sum = values.reduce((acc, val) => acc + val, 0);
    const average = sum / count;
    const sorted = [...values].sort((a, b) => a - b);
    const median = count % 2 === 1
      ? sorted[(count - 1) / 2]
      : (sorted[count / 2 - 1] + sorted[count / 2]) / 2;
    const variance = values.reduce((acc, val) => acc + Math.pow(val - average, 2), 0) / count;
    const stddev = Math.sqrt(variance);
    return {
      count,
      average,
      median,
      stddev
    };
  }

  buildEventFromRow(row) {
    return {
      id: row.id,
      kind: row.kind,
      pubkey: row.pubkey,
      created_at: row.created_at,
      tags: Array.isArray(row.tags) ? row.tags : JSON.parse(JSON.stringify(row.tags || [])),
      content: row.content,
      sig: row.sig || row.signature
    };
  }

  triggerOutgoingFlush(delay = 0) {
    if (this.outgoingFlushTimeout) {
      return;
    }
    const now = Date.now();
    const wait = Math.max(0, delay, this.outgoingThrottleUntil > now ? this.outgoingThrottleUntil - now : 0);
    this.outgoingFlushTimeout = setTimeout(() => {
      this.outgoingFlushTimeout = null;
      this.flushOutgoingQueue().catch((error) => {
        this.logger.warn('[NostrRuntimeService] Outgoing flush failed:', error.message);
      });
    }, wait);
  }

  ensureOutgoingTimer() {
    if (this.outgoingTimer) {
      return;
    }
    this.outgoingTimer = setInterval(() => {
      this.flushOutgoingQueue().catch((error) => {
        this.logger.warn('[NostrRuntimeService] Periodic outgoing flush failed:', error.message);
      });
    }, this.outgoingFlushIntervalMs);
  }

  ensureSubscriptionRefreshTimer() {
    if (this.subscriptionRefreshTimer) {
      return;
    }
    this.subscriptionRefreshTimer = setInterval(() => {
      this.refreshSubscription().catch((error) => {
        this.logger.warn('[NostrRuntimeService] Subscription refresh failed:', error.message);
      });
    }, this.subscriptionRefreshMs);
  }

  clearOutgoingTimer() {
    if (this.outgoingTimer) {
      clearInterval(this.outgoingTimer);
      this.outgoingTimer = null;
    }
  }

  clearSubscriptionRefreshTimer() {
    if (this.subscriptionRefreshTimer) {
      clearInterval(this.subscriptionRefreshTimer);
      this.subscriptionRefreshTimer = null;
    }
  }

  clearFlushTimeout() {
    if (this.outgoingFlushTimeout) {
      clearTimeout(this.outgoingFlushTimeout);
      this.outgoingFlushTimeout = null;
    }
  }

  trimMessageHistory(now, windowMs) {
    this.messageUnitsHistory = this.messageUnitsHistory.filter((entry) => now - entry.timestamp <= windowMs);
  }

  calculateUsedUnits(now, windowMs) {
    this.trimMessageHistory(now, windowMs);
    return this.messageUnitsHistory.reduce((sum, entry) => sum + entry.units, 0);
  }

  recordMessageUnits(units) {
    const now = Date.now();
    this.messageUnitsHistory.push({ timestamp: now, units });
  }

  arraysEqual(a = [], b = []) {
    if (a.length !== b.length) {
      return false;
    }
    for (let i = 0; i < a.length; i += 1) {
      if (a[i] !== b[i]) {
        return false;
      }
    }
    return true;
  }
}

module.exports = {
  NostrRuntimeService
};

