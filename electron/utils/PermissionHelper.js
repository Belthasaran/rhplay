const TrustManager = require('./TrustManager');

class PermissionHelper {
  constructor(dbManager, options = {}) {
    if (!dbManager) {
      throw new Error('PermissionHelper requires a DatabaseManager instance');
    }
    this.dbManager = dbManager;
    this.logger = options.logger || console;
    this.trustManager = options.trustManager || new TrustManager(dbManager, { logger: this.logger });
  }

  /**
   * Check if a pubkey can perform an action within a scope hierarchy.
   * @param {Object} params
   * @param {string} params.pubkey - acting user's pubkey
   * @param {string} params.action - canonical action identifier (e.g., 'moderation.delete-post')
   * @param {Object} params.scope - { type, target } representing the target scope
   * @returns {Object} { allowed: boolean, trust_level, trust_tier, reason?, permissions?, declarations? }
   */
  canPerform({ pubkey, action, scope }) {
    if (!pubkey) {
      return { allowed: false, reason: 'Missing pubkey' };
    }
    if (!action) {
      return { allowed: false, reason: 'Missing action' };
    }
    if (!scope || !scope.type) {
      return { allowed: false, reason: 'Missing scope' };
    }

    const trustDetails = this.trustManager.getEffectivePermissions(pubkey);
    const trustLevel = trustDetails.trust_level;
    const trustTier = trustDetails.trust_tier;
    const permissions = trustDetails.permissions || [];

    const required = this.mapActionToPermission(action);
    if (!required) {
      return {
        allowed: false,
        trust_level: trustLevel,
        trust_tier: trustTier,
        reason: `Unknown action: ${action}`
      };
    }

    const matches = this.matchPermissionsAgainstScopes(permissions, required, scope);
    if (!matches.allowed) {
      return {
        allowed: false,
        trust_level: trustLevel,
        trust_tier: trustTier,
        reason: matches.reason || 'No permission for scope',
        required_permissions: required,
        trust_details: trustDetails
      };
    }

    if (required.minTrustLevel !== undefined && trustLevel < required.minTrustLevel) {
      return {
        allowed: false,
        trust_level: trustLevel,
        trust_tier: trustTier,
        reason: `Requires trust level ${required.minTrustLevel}+`,
        required_permissions: required,
        trust_details: trustDetails
      };
    }

    return {
      allowed: true,
      trust_level: trustLevel,
      trust_tier: trustTier,
      required_permissions: required,
      trust_details: trustDetails
    };
  }

  mapActionToPermission(action) {
    const map = {
      'moderation.delete-post': { permissionKeys: ['can_moderate', 'can_delegate_moderators'], minTrustLevel: 7 },
      'moderation.mute-user': { permissionKeys: ['can_moderate'], minTrustLevel: 7 },
      'moderation.review-report': { permissionKeys: ['can_moderate'], minTrustLevel: 5 },
      'metadata.update-channel': { permissionKeys: ['can_update_metadata'], minTrustLevel: 6 },
      'metadata.update-game': { permissionKeys: ['can_update_metadata'], minTrustLevel: 6 },
      'trust.assign': { permissionKeys: ['can_sign_trust_declarations'], minTrustLevel: 11 },
      'trust.delegate': { permissionKeys: ['can_delegate_moderators', 'can_delegate_updaters'], minTrustLevel: 8 },
      'ratings.review': { permissionKeys: [], minTrustLevel: 0 }
    };
    return map[action] || null;
  }

  matchPermissionsAgainstScopes(permissions, required, targetScope) {
    const hierarchy = this.buildScopeHierarchy(targetScope);

    for (const permEntry of permissions) {
      if (!permEntry || !permEntry.permissions) {
        continue;
      }
      const enabledKeys = Object.entries(permEntry.permissions)
        .filter(([, value]) => !!value)
        .map(([key]) => key);
      const hasPermission = required.permissionKeys.every((key) => enabledKeys.includes(key));
      if (!hasPermission) {
        continue;
      }

      for (const scopeNode of hierarchy) {
        if (this.scopeMatches(permEntry.scope || {}, scopeNode)) {
          return { allowed: true };
        }
      }
    }

    return { allowed: false };
  }

  buildScopeHierarchy(scope) {
    const nodes = [];
    const resolvedScope = Array.isArray(scope) ? scope[0] : scope;
    if (!resolvedScope || !resolvedScope.type) {
      return nodes;
    }

    const type = resolvedScope.type;
    const target = resolvedScope.target || '*';
    nodes.push({ type, target });

    if (type === 'channel') {
      nodes.push({ type: 'section', target: `channel:${target}` });
      const section = target.split(':')[0];
      if (section) {
        nodes.push({ type: 'section', target: section });
      }
    } else if (type === 'forum') {
      nodes.push({ type: 'section', target: `forum:${target}` });
      const section = target.split(':')[0];
      if (section) {
        nodes.push({ type: 'section', target: section });
      }
    } else if (type === 'game') {
      nodes.push({ type: 'section', target: `game:${target}` });
      const parts = target.split(':');
      if (parts.length > 1) {
        nodes.push({ type: 'section', target: parts[0] });
      }
    }

    nodes.push({ type: 'global', target: '*' });
    return nodes;
  }

  scopeMatches(permissionScope, targetScope) {
    const permType = (permissionScope.type || 'global').toLowerCase();
    const permTargets = permissionScope.targets || [];
    const permExclude = permissionScope.exclude || [];
    const targetType = targetScope.type.toLowerCase();
    const targetIdentifier = targetScope.target;

    if (permExclude.includes(targetIdentifier) || permExclude.includes(`${targetType}:${targetIdentifier}`)) {
      return false;
    }

    if (permType === 'global') {
      return true;
    }

    if (permType === targetType) {
      if (!permTargets || permTargets.length === 0 || permTargets.includes('*')) {
        return true;
      }
      if (permTargets.includes(targetIdentifier)) {
        return true;
      }
      if (targetIdentifier.includes(':')) {
        const parent = targetIdentifier.split(':')[0];
        if (permTargets.includes(`${targetType}:${parent}`) || permTargets.includes(parent)) {
          return true;
        }
      }
    }

    if (permType === 'section') {
      const sectionTarget = targetType === 'section' ? targetIdentifier : `${targetType}:${targetIdentifier}`;
      if (!permTargets || permTargets.length === 0 || permTargets.includes('*')) {
        return true;
      }
      if (permTargets.includes(sectionTarget)) {
        return true;
      }
      if (sectionTarget.includes(':')) {
        const parent = sectionTarget.split(':')[0];
        if (permTargets.includes(parent)) {
          return true;
        }
      }
    }

    return false;
  }

  serializeScope(scope) {
    if (!scope || typeof scope !== 'object') {
      return String(scope);
    }
    const type = scope.type || 'unknown';
    const target = scope.target || scope.targets || '*';
    if (Array.isArray(target)) {
      return `${type}:${target.join(',')}`;
    }
    return `${type}:${target}`;
  }
}

module.exports = PermissionHelper;
