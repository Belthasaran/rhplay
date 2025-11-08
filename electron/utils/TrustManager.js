const { nip19 } = require('nostr-tools');

const TRUST_TIERS = ['restricted', 'unverified', 'verified', 'trusted'];
const TRUST_LEVEL_MIN = -2;
const TRUST_LEVEL_MAX = 30;
const TRUST_LEVEL_TRUSTED_THRESHOLD = 8;
const TRUST_LEVEL_VERIFIED_THRESHOLD = 5;
const DEFAULT_TRUST_LEVEL = 1;
const DECLARATION_TRUST_LEVELS = {
  'master-admin': 30,
  'operating-admin': 20,
  'authorized-admin': 11,
  'moderator': 8,
  'trusted-member': 8,
  'updater': 6,
  'contributor': 5,
  'verified': 5,
  'trusted': 8,
  'reviewer': 5,
  'user': 4
};

class TrustManager {
  constructor(dbManager, options = {}) {
    if (!dbManager) {
      throw new Error('TrustManager requires a DatabaseManager instance');
    }
    this.dbManager = dbManager;
    this.logger = options.logger || console;
  }

  getTrustLevel(pubkey) {
    if (!pubkey) {
      return DEFAULT_TRUST_LEVEL;
    }
    const variants = this.expandPubkeyVariants(pubkey);
    if (!variants.length) {
      return DEFAULT_TRUST_LEVEL;
    }

    let effectiveLevel = DEFAULT_TRUST_LEVEL;

    const adminLevel = this.lookupAdminTrustLevel(variants);
    if (adminLevel !== null) {
      effectiveLevel = Math.max(effectiveLevel, adminLevel);
    }

    const declarationInfo = this.lookupDeclarationTrustLevel(variants);
    if (declarationInfo.level !== null && declarationInfo.level !== undefined) {
      effectiveLevel = Math.max(effectiveLevel, declarationInfo.level);
    }

    if (declarationInfo.trust_limit !== null && declarationInfo.trust_limit !== undefined) {
      effectiveLevel = Math.min(effectiveLevel, declarationInfo.trust_limit);
    }

    const assignments = this.getActiveTrustAssignments(variants);
    let trustLimit = null;
    assignments.forEach((assignment) => {
      const level = assignment.assigned_trust_level;
      if (Number.isFinite(level)) {
        if (level <= 0) {
          effectiveLevel = Math.min(effectiveLevel, level);
        } else {
          effectiveLevel = Math.max(effectiveLevel, level);
        }
      }
      const limit = assignment.trust_limit;
      if (Number.isFinite(limit)) {
        trustLimit = trustLimit === null ? limit : Math.min(trustLimit, limit);
      }
    });

    if (trustLimit !== null) {
      effectiveLevel = Math.min(effectiveLevel, trustLimit);
    }

    if (effectiveLevel > TRUST_LEVEL_MAX) {
      effectiveLevel = TRUST_LEVEL_MAX;
    } else if (effectiveLevel < TRUST_LEVEL_MIN) {
      effectiveLevel = TRUST_LEVEL_MIN;
    }

    return effectiveLevel;
  }

  mapTrustLevelToTier(level) {
    if (level <= 0) {
      return 'restricted';
    }
    if (level >= TRUST_LEVEL_TRUSTED_THRESHOLD) {
      return 'trusted';
    }
    if (level >= TRUST_LEVEL_VERIFIED_THRESHOLD) {
      return 'verified';
    }
    return 'unverified';
  }

  getActiveTrustAssignments(pubkeyVariants) {
    try {
      const ratingsDb = this.dbManager.getConnection('ratings');
      const now = Math.floor(Date.now() / 1000);
      const placeholders = pubkeyVariants.map(() => '?').join(', ');
      const rows = ratingsDb.prepare(`
        SELECT assignment_id, pubkey, assigned_trust_level, trust_limit,
               assigned_by_pubkey, assigned_by_trust_level, scope,
               source, reason, expires_at, created_at
        FROM trust_assignments
        WHERE LOWER(pubkey) IN (${placeholders})
      `).all(...pubkeyVariants.map((v) => v.toLowerCase()));
      return rows.filter((row) => {
        if (row.expires_at === null || row.expires_at === undefined) {
          return true;
        }
        return Number(row.expires_at) > now;
      }).map((row) => ({
        assignment_id: row.assignment_id,
        pubkey: row.pubkey,
        assigned_trust_level: this.toNumberOrNull(row.assigned_trust_level),
        trust_limit: this.toNumberOrNull(row.trust_limit),
        assigned_by_pubkey: row.assigned_by_pubkey,
        assigned_by_trust_level: this.toNumberOrNull(row.assigned_by_trust_level),
        scope: row.scope,
        source: row.source,
        reason: row.reason,
        expires_at: this.toNumberOrNull(row.expires_at),
        created_at: this.toNumberOrNull(row.created_at)
      }));
    } catch (error) {
      this.logger.warn('[TrustManager] Failed to load trust assignments:', error.message);
      return [];
    }
  }

  saveTrustAssignment(entry) {
    const ratingsDb = this.dbManager.getConnection('ratings');
    const now = Math.floor(Date.now() / 1000);
    const fields = {
      pubkey: entry.pubkey,
      assigned_trust_level: entry.assigned_trust_level,
      trust_limit: entry.trust_limit,
      assigned_by_pubkey: entry.assigned_by_pubkey || null,
      assigned_by_trust_level: entry.assigned_by_trust_level || null,
      scope: entry.scope || null,
      source: entry.source || null,
      reason: entry.reason || null,
      expires_at: entry.expires_at || null,
      created_at: entry.created_at || now
    };
    ratingsDb.prepare(`
      INSERT INTO trust_assignments (
        pubkey, assigned_trust_level, trust_limit, assigned_by_pubkey,
        assigned_by_trust_level, scope, source, reason, expires_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      fields.pubkey,
      fields.assigned_trust_level,
      fields.trust_limit,
      fields.assigned_by_pubkey,
      fields.assigned_by_trust_level,
      fields.scope,
      fields.source,
      fields.reason,
      fields.expires_at,
      fields.created_at
    );
    return ratingsDb.prepare('SELECT last_insert_rowid() AS id').get().id;
  }

  deleteTrustAssignment(assignmentId) {
    const ratingsDb = this.dbManager.getConnection('ratings');
    ratingsDb.prepare('DELETE FROM trust_assignments WHERE assignment_id = ?').run(assignmentId);
  }

  listTrustAssignments(pubkey) {
    const ratingsDb = this.dbManager.getConnection('ratings');
    if (pubkey) {
      return ratingsDb.prepare('SELECT * FROM trust_assignments WHERE LOWER(pubkey) = ? ORDER BY created_at DESC').all(pubkey.toLowerCase());
    }
    return ratingsDb.prepare('SELECT * FROM trust_assignments ORDER BY created_at DESC').all();
  }

  lookupAdminTrustLevel(pubkeyVariants) {
    try {
      const db = this.dbManager.getConnection('clientdata');
      const placeholders = pubkeyVariants.map(() => '?').join(', ');
      const rows = db.prepare(`
        SELECT key_usage, trust_level
        FROM admin_keypairs
        WHERE LOWER(public_key_hex) IN (${placeholders}) OR LOWER(public_key) IN (${placeholders})
      `).all(...pubkeyVariants.map((v) => v.toLowerCase()), ...pubkeyVariants.map((v) => v.toLowerCase()));
      if (!rows || rows.length === 0) {
        return null;
      }
      let maxLevel = null;
      rows.forEach((row) => {
        if (row.trust_level !== null && row.trust_level !== undefined) {
          const level = this.toNumberOrNull(row.trust_level);
          if (Number.isFinite(level)) {
            maxLevel = maxLevel === null ? level : Math.max(maxLevel, level);
            return;
          }
        }
        const usage = (row.key_usage || '').toLowerCase();
        let mapped = null;
        if (usage === 'master-admin-signing') {
          mapped = 30;
        } else if (usage === 'operating-admin-signing') {
          mapped = 20;
        } else if (usage === 'authorized-admin') {
          mapped = 11;
        }
        if (mapped !== null) {
          maxLevel = maxLevel === null ? mapped : Math.max(maxLevel, mapped);
        }
      });
      return maxLevel;
    } catch (error) {
      this.logger.warn('[TrustManager] lookupAdminTrustLevel failed:', error.message);
      return null;
    }
  }

  lookupDeclarationTrustLevel(pubkeyVariants, options = {}) {
    try {
      const db = this.dbManager.getConnection('clientdata');
      const now = Math.floor(Date.now() / 1000);
      const rows = db.prepare(`
        SELECT declaration_uuid,
               content_json,
               status,
               valid_from,
               valid_until,
               signing_keypair_uuid,
               signing_keypair_fingerprint,
               target_keypair_uuid,
               target_keypair_fingerprint,
               target_keypair_canonical_name,
               target_keypair_public_hex,
               target_user_profile_id,
               required_countersignatures,
               current_countersignatures,
               is_local,
               is_revoked,
               created_at,
               updated_at
        FROM admindeclarations
        WHERE declaration_type = 'trust-declaration'
          AND status IN ('Published', 'Active', 'Signed')
      `).all();

      let highestLevel = null;
      let trustLimit = null;
      const matchedDeclarations = [];

      rows.forEach((row) => {
        if (!row) {
          return;
        }

        const status = (row.status || '').toLowerCase();
        if (row.is_revoked) {
          return;
        }

        if (status === 'signed') {
          const required = this.toNumberOrNull(row.required_countersignatures) || 0;
          const current = this.toNumberOrNull(row.current_countersignatures) || 0;
          if (current < required) {
            return;
          }
        }

        let content = null;
        if (row.content_json) {
          try {
            content = JSON.parse(row.content_json);
          } catch (error) {
            this.logger.warn('[TrustManager] Failed to parse trust declaration:', error.message);
          }
        }

        const subject = content?.subject || {};

        const candidateTargets = [
          subject.canonical_name,
          subject.pubkey,
          subject.fingerprint,
          subject.keypair_uuid,
          subject.profile_uuid,
          row.target_keypair_canonical_name,
          row.target_keypair_public_hex,
          row.target_keypair_fingerprint,
          row.target_keypair_uuid,
          row.target_user_profile_id
        ]
          .filter(Boolean)
          .map((value) => String(value).toLowerCase());

        const matches = pubkeyVariants.some((variant) => candidateTargets.includes(variant.toLowerCase()));

        if (!matches) {
          return;
        }

        const validFrom = this.toUnixTimestamp(row.valid_from);
        const validUntil = this.toUnixTimestamp(row.valid_until);
        if ((validFrom && now < validFrom) || (validUntil && now > validUntil)) {
          return;
        }

        const declarationLevel = this.parseDeclarationTrustLevel(content?.content?.trust_level);
        if (declarationLevel !== null && declarationLevel !== undefined) {
          highestLevel = highestLevel === null ? declarationLevel : Math.max(highestLevel, declarationLevel);
        }

        const declarationLimit = this.parseDeclarationTrustLimit(content?.content?.trust_limit);
        if (declarationLimit !== null && declarationLimit !== undefined) {
          trustLimit = trustLimit === null ? declarationLimit : Math.min(trustLimit, declarationLimit);
        }

        if (options.includeDetails) {
          matchedDeclarations.push({
            declaration_uuid: row.declaration_uuid,
            derived_trust_level: declarationLevel,
            declared_trust_level: content?.content?.trust_level ?? null,
            trust_limit: declarationLimit,
            scopes: this.normalizeScopes(content?.content?.scopes),
            usage_types: Array.isArray(content?.content?.usage_types) ? content.content.usage_types : [],
            permissions: content?.content?.permissions || {},
            issuer: content?.issuer || {},
            subject,
            valid_from: this.toUnixTimestamp(row.valid_from),
            valid_until: this.toUnixTimestamp(row.valid_until),
            status: row.status,
            created_at: this.toUnixTimestamp(row.created_at),
            updated_at: this.toUnixTimestamp(row.updated_at),
            signing_keypair_uuid: row.signing_keypair_uuid,
            signing_keypair_fingerprint: row.signing_keypair_fingerprint,
            target_keypair_uuid: row.target_keypair_uuid,
            target_keypair_fingerprint: row.target_keypair_fingerprint,
            target_keypair_canonical_name: row.target_keypair_canonical_name,
            target_keypair_public_hex: row.target_keypair_public_hex,
            target_user_profile_id: row.target_user_profile_id,
            required_countersignatures: this.toNumberOrNull(row.required_countersignatures),
            current_countersignatures: this.toNumberOrNull(row.current_countersignatures),
            is_local: row.is_local,
            content
          });
        }
      });

      return {
        level: highestLevel,
        trust_limit: trustLimit,
        declarations: matchedDeclarations
      };
    } catch (error) {
      this.logger.warn('[TrustManager] lookupDeclarationTrustLevel failed:', error.message);
      return { level: null, trust_limit: null, declarations: [] };
    }
  }

  parseDeclarationTrustLevel(value) {
    if (value === null || value === undefined || value === '') {
      return null;
    }
    if (Number.isFinite(value)) {
      return value;
    }
    const str = String(value).trim().toLowerCase();
    if (!str) {
      return null;
    }
    if (DECLARATION_TRUST_LEVELS[str] !== undefined) {
      return DECLARATION_TRUST_LEVELS[str];
    }
    const numeric = Number(str);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
    return null;
  }

  parseDeclarationTrustLimit(value) {
    if (value === null || value === undefined || value === '') {
      return null;
    }
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  }

  toUnixTimestamp(value) {
    if (!value) {
      return null;
    }
    if (Number.isFinite(value)) {
      return Number(value);
    }
    const parsed = Date.parse(value);
    if (Number.isNaN(parsed)) {
      return null;
    }
    return Math.floor(parsed / 1000);
  }

  expandPubkeyVariants(pubkey) {
    const variants = new Set();
    if (!pubkey) {
      return [];
    }
    const trimmed = String(pubkey).trim();
    if (!trimmed) {
      return [];
    }
    variants.add(trimmed.toLowerCase());
    if (trimmed.startsWith('npub')) {
      try {
        const decoded = nip19.decode(trimmed);
        if (decoded && decoded.type === 'npub' && decoded.data) {
          variants.add(Buffer.from(decoded.data).toString('hex'));
        }
      } catch (error) {
        this.logger.warn('[TrustManager] Failed to decode npub variant:', error.message);
      }
    } else if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
      try {
        const encoded = nip19.npubEncode(Buffer.from(trimmed, 'hex'));
        variants.add(encoded.toLowerCase());
      } catch (error) {
        this.logger.warn('[TrustManager] Failed to encode npub variant:', error.message);
      }
    }
    return Array.from(variants);
  }

  toNumberOrNull(value) {
    if (value === null || value === undefined || value === '') {
      return null;
    }
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  }

  normalizeScopes(scopes) {
    if (!scopes) {
      return [];
    }
    if (Array.isArray(scopes)) {
      return scopes.map((scope) => this.normalizeScopeObject(scope));
    }
    if (typeof scopes === 'object') {
      return [this.normalizeScopeObject(scopes)];
    }
    return [];
  }

  normalizeScopeObject(scope) {
    if (!scope || typeof scope !== 'object') {
      return {};
    }
    const targets = Array.isArray(scope.targets) ? scope.targets : (scope.target ? [scope.target] : []);
    const exclude = Array.isArray(scope.exclude) ? scope.exclude : [];
    return {
      type: scope.type || null,
      targets,
      exclude
    };
  }

  inspectTrust(pubkey) {
    const variants = this.expandPubkeyVariants(pubkey);
    const trustLevel = this.getTrustLevel(pubkey);
    const trustTier = this.mapTrustLevelToTier(trustLevel);
    const adminLevel = this.lookupAdminTrustLevel(variants);
    const declarationInfo = this.lookupDeclarationTrustLevel(variants, { includeDetails: true });
    const assignments = this.getActiveTrustAssignments(variants);
    const permissions = this.aggregatePermissionsFromDeclarations(declarationInfo.declarations);

    return {
      pubkey,
      variants,
      trust_level: trustLevel,
      trust_tier: trustTier,
      admin_level: adminLevel,
      declaration_level: declarationInfo.level,
      declaration_trust_limit: declarationInfo.trust_limit,
      declarations: declarationInfo.declarations,
      assignments,
      permissions
    };
  }

  getEffectivePermissions(pubkey) {
    const details = this.inspectTrust(pubkey);
    return {
      pubkey: details.pubkey,
      trust_level: details.trust_level,
      trust_tier: details.trust_tier,
      permissions: details.permissions,
      declarations: details.declarations
    };
  }

  aggregatePermissionsFromDeclarations(declarations = []) {
    const result = [];
    declarations.forEach((decl) => {
      const scopes = Array.isArray(decl.scopes) && decl.scopes.length ? decl.scopes : [{ type: 'global', targets: [], exclude: [] }];
      const permissions = decl.permissions || {};
      scopes.forEach((scope) => {
        result.push({
          declaration_uuid: decl.declaration_uuid,
          scope,
          permissions,
          derived_trust_level: decl.derived_trust_level ?? null,
          trust_limit: decl.trust_limit ?? null,
          issuer: decl.issuer || {},
          subject: decl.subject || {},
          valid_from: decl.valid_from || null,
          valid_until: decl.valid_until || null
        });
      });
    });
    return result;
  }
}

TrustManager.TRUST_TIERS = TRUST_TIERS;
TrustManager.TRUST_LEVEL_MIN = TRUST_LEVEL_MIN;
TrustManager.TRUST_LEVEL_MAX = TRUST_LEVEL_MAX;
TrustManager.TRUST_LEVEL_TRUSTED_THRESHOLD = TRUST_LEVEL_TRUSTED_THRESHOLD;
TrustManager.TRUST_LEVEL_VERIFIED_THRESHOLD = TRUST_LEVEL_VERIFIED_THRESHOLD;
TrustManager.DEFAULT_TRUST_LEVEL = DEFAULT_TRUST_LEVEL;
TrustManager.DECLARATION_TRUST_LEVELS = DECLARATION_TRUST_LEVELS;

module.exports = TrustManager;
