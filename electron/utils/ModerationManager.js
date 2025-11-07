const { randomUUID } = require('crypto');
const TrustManager = require('./TrustManager');

class ModerationManager {
  constructor(dbManager, options = {}) {
    if (!dbManager) {
      throw new Error('ModerationManager requires a DatabaseManager instance');
    }
    this.dbManager = dbManager;
    this.logger = options.logger || console;
    this.trustManager = options.trustManager || new TrustManager(dbManager, { logger: this.logger });
    this.minimumModerationLevel = options.minimumModerationLevel ?? 7;
  }

  createModerationAction({ actorPubkey, actionType, target, scope, reason, content = {} }) {
    if (!actorPubkey || !actionType || !target || !scope) {
      throw new Error('actorPubkey, actionType, target, and scope are required');
    }

    const trustLevel = this.trustManager.getTrustLevel(actorPubkey);
    const trustTier = this.trustManager.mapTrustLevelToTier(trustLevel);
    const requiredLevel = this.getRequiredTrustLevel(actionType);

    if (trustLevel < requiredLevel) {
      return {
        success: false,
        error: `Insufficient trust level. Requires ${requiredLevel}+ to perform ${actionType}.`,
        trust_level: trustLevel,
        trust_tier: trustTier,
        required_level: requiredLevel
      };
    }

    const moderationDb = this.dbManager.getConnection('moderation');
    const actionId = this.generateActionId(actionType, target, scope);
    const issuedAt = Math.floor(Date.now() / 1000);

    const record = {
      action_id: actionId,
      action_type: actionType,
      target_type: target.type,
      target_identifier: target.identifier,
      scope_type: scope.type,
      scope_identifier: scope.target || scope.identifier,
      content_json: JSON.stringify(content),
      reason: reason || null,
      issued_by_pubkey: actorPubkey,
      issued_by_trust_level: trustLevel,
      issued_at: issuedAt,
      expires_at: content.expires_at || null,
      trust_level: trustLevel,
      trust_tier: trustTier,
      event_id: content.event_id || null,
      signature: content.signature || null,
      status: 'active'
    };

    moderationDb.prepare(`
      INSERT INTO moderation_actions (
        action_id, action_type, target_type, target_identifier,
        scope_type, scope_identifier, content_json, reason,
        issued_by_pubkey, issued_by_trust_level, issued_at, expires_at,
        trust_level, trust_tier, event_id, signature, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.action_id,
      record.action_type,
      record.target_type,
      record.target_identifier,
      record.scope_type,
      record.scope_identifier,
      record.content_json,
      record.reason,
      record.issued_by_pubkey,
      record.issued_by_trust_level,
      record.issued_at,
      record.expires_at,
      record.trust_level,
      record.trust_tier,
      record.event_id,
      record.signature,
      record.status
    );

    this.logModerationEvent(moderationDb, {
      action_id: record.action_id,
      log_type: 'create',
      details_json: JSON.stringify({ actorPubkey, actionType, target, scope })
    });

    return { success: true, action_id: record.action_id, record };
  }

  revokeModerationAction({ actorPubkey, actionId, reason }) {
    if (!actorPubkey || !actionId) {
      throw new Error('actorPubkey and actionId are required');
    }

    const moderationDb = this.dbManager.getConnection('moderation');
    const row = moderationDb.prepare('SELECT * FROM moderation_actions WHERE action_id = ?').get(actionId);
    if (!row) {
      return { success: false, error: 'Action not found' };
    }
    if (row.status !== 'active') {
      return { success: false, error: 'Action is not active' };
    }

    const trustLevel = this.trustManager.getTrustLevel(actorPubkey);
    const trustTier = this.trustManager.mapTrustLevelToTier(trustLevel);
    const requiredLevel = this.getRequiredTrustLevel(row.action_type);

    if (trustLevel < requiredLevel) {
      return {
        success: false,
        error: `Insufficient trust level. Requires ${requiredLevel}+ to revoke ${row.action_type}.`,
        trust_level: trustLevel,
        trust_tier: trustTier,
        required_level: requiredLevel
      };
    }

    const revokedAt = Math.floor(Date.now() / 1000);
    moderationDb.prepare(`
      UPDATE moderation_actions
      SET status = 'revoked', revoked_by_pubkey = ?, revoked_at = ?, reason = COALESCE(?, reason)
      WHERE action_id = ?
    `).run(actorPubkey, revokedAt, reason || null, actionId);

    this.logModerationEvent(moderationDb, {
      action_id: actionId,
      log_type: 'revoke',
      details_json: JSON.stringify({ actorPubkey, reason })
    });

    return { success: true };
  }

  listModerationActions({ target, status = 'active' } = {}) {
    const moderationDb = this.dbManager.getConnection('moderation');
    let query = 'SELECT * FROM moderation_actions';
    const params = [];
    const conditions = [];

    if (status) {
      conditions.push('status = ?');
      params.push(status);
    }
    if (target && target.type && target.identifier) {
      conditions.push('target_type = ?');
      conditions.push('target_identifier = ?');
      params.push(target.type, target.identifier);
    }

    if (conditions.length) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }
    query += ' ORDER BY issued_at DESC';

    return moderationDb.prepare(query).all(...params).map((row) => ({
      action_id: row.action_id,
      action_type: row.action_type,
      target_type: row.target_type,
      target_identifier: row.target_identifier,
      scope_type: row.scope_type,
      scope_identifier: row.scope_identifier,
      reason: row.reason,
      issued_by_pubkey: row.issued_by_pubkey,
      issued_by_trust_level: row.issued_by_trust_level,
      issued_at: row.issued_at,
      expires_at: row.expires_at,
      trust_level: row.trust_level,
      trust_tier: row.trust_tier,
      status: row.status,
      revoked_by_pubkey: row.revoked_by_pubkey,
      revoked_at: row.revoked_at,
      content: this.safeParse(row.content_json)
    }));
  }

  getRequiredTrustLevel(actionType) {
    const levelMap = {
      'block-user': Math.max(this.minimumModerationLevel, 8),
      'mute-user': Math.max(this.minimumModerationLevel, 7),
      'freeze-channel': Math.max(this.minimumModerationLevel, 9),
      'warn-user': Math.max(this.minimumModerationLevel, 5),
      'delete-post': Math.max(this.minimumModerationLevel, 8)
    };
    return levelMap[actionType] || this.minimumModerationLevel;
  }

  logModerationEvent(db, { action_id, log_type, details_json }) {
    db.prepare(`
      INSERT INTO moderation_logs (action_id, log_type, details_json)
      VALUES (?, ?, ?)
    `).run(action_id, log_type, details_json || null);
  }

  generateActionId(actionType, target, scope) {
    const uuid = randomUUID();
    const targetId = target.identifier || target.target || 'unknown';
    const scopeId = scope.target || scope.identifier || 'global';
    return `${actionType}:${target.type}:${targetId}:${scope.type}:${scopeId}:${uuid}`;
  }

  safeParse(value) {
    if (!value) {
      return null;
    }
    try {
      return JSON.parse(value);
    } catch (error) {
      this.logger.warn('[ModerationManager] Failed to parse JSON:', error.message);
      return null;
    }
  }
}

module.exports = ModerationManager;
