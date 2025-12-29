/**
 * IPC Handlers for RHTools Electron App
 * 
 * Handles communication between renderer process (Vue.js) and main process (Node.js)
 * Provides database access, game data, user annotations, and settings
 */

const { ipcMain, dialog, BrowserWindow, shell } = require('electron');
const crypto = require('crypto');
const { app } = require('electron');
const { ensureRhpakAssociation, removeRhpakAssociation } = require('./rhpak-association');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const {
  handleImportPackage: newgameHandleImportPackage,
  handleListInstalled: newgameHandleListInstalled,
  handleUninstall: newgameHandleUninstall,
} = require('../jstools/newgame.js');
const { registerNostrRuntimeIPC } = require('./main/NostrRuntimeIPC');
const seedManager = require('./seed-manager');
const gameStager = require('./game-stager');
const { generateRunview } = require('./runview-generator');
const { matchesDifficultyFilter } = require('./utils/difficulty-mapper');
const GameVersionBanManager = require('./gameversion-banmanager');
const { matchesFilter } = require('./shared-filter-utils');
const { fetchNetworkTime, determineRunValidity } = require('./utils/network-time');
const sshManager = require('./main/usb2snes/sshManager');
const usbfxpServer = require('./main/usb2snes/usbfxpServer');
const { HostFP } = require('./main/HostFP');
const TrustManager = require('./utils/TrustManager');
const { getTwitchClientId, getTwitchRedirectUri } = require('./twitch-config');
const PermissionHelper = require('./utils/PermissionHelper');
const ModerationManager = require('./utils/ModerationManager');
const { NostrLocalDBManager } = require('./utils/NostrLocalDBManager');

/**
 * Get keyguard key from session (for encryption/decryption)
 * @param {Object} event - IPC event object
 * @returns {Buffer|null} Keyguard key or null if not available
 */
function getKeyguardKey(event) {
  return event?.sender?.session?.keyguardKey || null;
}

/**
 * Register all IPC handlers with the database manager
 * @param {DatabaseManager} dbManager - Database manager instance
 */
function registerDatabaseHandlers(dbManager) {
  // Initialize default runview settings if not set
  try {
    const db = dbManager.getConnection('clientdata');
    const runviewcount = db.prepare('SELECT csetting_value FROM csettings WHERE csetting_name = ?').get('runviewcount');
    if (!runviewcount) {
      db.prepare(`
        INSERT INTO csettings (csettinguid, csetting_name, csetting_value)
        VALUES (?, ?, ?)
        ON CONFLICT(csetting_name) DO NOTHING
      `).run(crypto.randomUUID(), 'runviewcount', '3');
    }
    const runviewwidth = db.prepare('SELECT csetting_value FROM csettings WHERE csetting_name = ?').get('runviewwidth');
    if (!runviewwidth) {
      db.prepare(`
        INSERT INTO csettings (csettinguid, csetting_name, csetting_value)
        VALUES (?, ?, ?)
        ON CONFLICT(csetting_name) DO NOTHING
      `).run(crypto.randomUUID(), 'runviewwidth', '500');
    }
    // Initialize default overlay web server settings
    const overlayWebServerEnabled = db.prepare('SELECT csetting_value FROM csettings WHERE csetting_name = ?').get('overlayWebServerEnabled');
    if (!overlayWebServerEnabled) {
      db.prepare(`
        INSERT INTO csettings (csettinguid, csetting_name, csetting_value)
        VALUES (?, ?, ?)
        ON CONFLICT(csetting_name) DO NOTHING
      `).run(crypto.randomUUID(), 'overlayWebServerEnabled', 'Off');
    }
    const overlayWebServerPort = db.prepare('SELECT csetting_value FROM csettings WHERE csetting_name = ?').get('overlayWebServerPort');
    if (!overlayWebServerPort) {
      db.prepare(`
        INSERT INTO csettings (csettinguid, csetting_name, csetting_value)
        VALUES (?, ?, ?)
        ON CONFLICT(csetting_name) DO NOTHING
      `).run(crypto.randomUUID(), 'overlayWebServerPort', '2599');
    }
    const overlayRemoteConnectionsEnabled = db.prepare('SELECT csetting_value FROM csettings WHERE csetting_name = ?').get('overlayRemoteConnectionsEnabled');
    if (!overlayRemoteConnectionsEnabled) {
      db.prepare(`
        INSERT INTO csettings (csettinguid, csetting_name, csetting_value)
        VALUES (?, ?, ?)
        ON CONFLICT(csetting_name) DO NOTHING
      `).run(crypto.randomUUID(), 'overlayRemoteConnectionsEnabled', 'Off');
    }
  } catch (error) {
    console.warn('[runview] Failed to initialize default settings:', error);
  }
  // Import OnlineProfileManager for profile management
  const OnlineProfileManager = require('./utils/OnlineProfileManager');
  const trustManager = new TrustManager(dbManager, { logger: console });
  const permissionHelper = new PermissionHelper(dbManager, { trustManager, logger: console });
  const moderationManager = new ModerationManager(dbManager, { trustManager, permissionHelper, logger: console });
  const broadcastTrustChange = (payload = {}) => {
    BrowserWindow.getAllWindows()
      .filter((win) => !win.isDestroyed())
      .forEach((win) => {
        try {
          win.webContents.send('trust:changed', payload);
        } catch (error) {
          console.warn('[trust:changed] Broadcast failed:', error.message);
        }
      });
  };
  
  const RATING_FIELD_METADATA = [
    { field: 'user_review_rating', label: 'Overall Review' },
    { field: 'user_difficulty_rating', label: 'Difficulty' },
    { field: 'user_skill_rating', label: 'Skill Level' },
    { field: 'user_recommendation_rating', label: 'Recommendation' }
  ];
  const RATING_TIER_ORDER = ['trusted', 'verified', 'unverified', 'restricted', 'all'];
  const RATING_TIER_LABELS = {
    trusted: 'Trusted',
    verified: 'Verified',
    unverified: 'Unverified',
    restricted: 'Restricted',
    all: 'All Tiers'
  };
  const RHPAK_ENABLED_SETTING = 'enableRhpakFileAssociation';
  const RHPAK_HASH_SETTING = 'rhpakAssociationExeHash';

  function getClientSetting(name) {
    try {
      const db = dbManager.getConnection('clientdata');
      const row = db.prepare('SELECT csetting_value FROM csettings WHERE csetting_name = ?').get(name);
      return row ? row.csetting_value : null;
    } catch (error) {
      console.warn(`[settings] Failed to read ${name}:`, error.message);
      return null;
    }
  }

  function setClientSetting(name, value) {
    try {
      const db = dbManager.getConnection('clientdata');
      db.prepare(`
        INSERT INTO csettings (csettinguid, csetting_name, csetting_value)
        VALUES (?, ?, ?)
        ON CONFLICT(csetting_name) DO UPDATE SET csetting_value = excluded.csetting_value
      `).run(crypto.randomUUID(), name, value);
    } catch (error) {
      console.warn(`[settings] Failed to update ${name}:`, error.message);
    }
  }

  const projectRoot = path.resolve(__dirname, '..');

  const getAuxDbPath = (fileName) => {
    const envOverride = fileName === 'resource.db'
      ? process.env.RESOURCE_DB_PATH
      : process.env.SCREENSHOT_DB_PATH;
    if (envOverride) {
      return envOverride;
    }
    const rhdataPath = dbManager.paths?.rhdata;
    const baseDir = rhdataPath ? path.dirname(rhdataPath) : path.join(projectRoot, 'electron');
    return path.join(baseDir, fileName);
  };

  const getResourceDbPath = () => getAuxDbPath('resource.db');
  const getScreenshotDbPath = () => getAuxDbPath('screenshot.db');

  function buildNewgameConfig(overrides = {}) {
    const packageInput = overrides.packageInput ? path.resolve(overrides.packageInput) : null;
    return {
      jsonPath: overrides.jsonPath || null,
      packageInput,
      packageBaseDir: overrides.packageBaseDir || (packageInput ? path.dirname(packageInput) : null),
      packageOutput: overrides.packageOutput || null,
      outputJson: overrides.outputJson || null,
      baseDir: overrides.baseDir || null,
      force: !!overrides.force,
      purgeFiles: !!overrides.purgeFiles,
      uninstallUuid: overrides.uninstallUuid || null,
      rhdataPath: overrides.rhdataPath || dbManager.paths?.rhdata,
      patchbinPath: overrides.patchbinPath || dbManager.paths?.patchbin,
      resourcePath: overrides.resourcePath || getResourceDbPath(),
      screenshotPath: overrides.screenshotPath || getScreenshotDbPath(),
      clientDbPath: overrides.clientDbPath || dbManager.paths?.clientdata
    };
  }

  const isFiniteNumber = (value) => {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  };

  const computeRatingStats = (values) => {
    if (!values || values.length === 0) {
      return { count: 0, average: null, median: null, stddev: null };
    }
    const sorted = [...values].sort((a, b) => a - b);
    const count = sorted.length;
    const sum = sorted.reduce((acc, val) => acc + val, 0);
    const average = sum / count;
    const median = count % 2 === 1
      ? sorted[(count - 1) / 2]
      : (sorted[count / 2 - 1] + sorted[count / 2]) / 2;
    const variance = values.reduce((acc, val) => acc + Math.pow(val - average, 2), 0) / count;
    const stddev = Math.sqrt(variance);
    return { count, average, median, stddev };
  };

  const parseAssignmentScopeInput = (scope) => {
    if (!scope) {
      return null;
    }
    if (typeof scope === 'string') {
      const trimmed = scope.trim();
      if (!trimmed) {
        return null;
      }
      try {
        return JSON.parse(trimmed);
      } catch {
        return { type: 'custom', value: trimmed };
      }
    }
    if (typeof scope === 'object' && !Array.isArray(scope)) {
      return scope;
    }
    return { type: 'custom', value: scope };
  };

  const serializeAssignmentScope = (scope) => {
    if (!scope) {
      return null;
    }
    if (typeof scope === 'string') {
      return scope;
    }
    try {
      return JSON.stringify(scope);
    } catch (error) {
      console.warn('[trust:assignments] Failed to serialize scope:', error.message);
      return null;
    }
  };

  const buildPermissionScope = (scope) => {
    const parsed = parseAssignmentScopeInput(scope);
    if (parsed && typeof parsed === 'object' && parsed.type) {
      return parsed;
    }
    return { type: 'global', target: '*' };
  };

  ipcMain.handle('trust:assignments:list', (_event, { pubkey } = {}) => {
    try {
      const assignments = trustManager.listTrustAssignments(pubkey || undefined);
      return { success: true, assignments };
    } catch (error) {
      console.error('[trust:assignments:list] Failed:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('trust:assignments:create', (_event, payload = {}) => {
    try {
      const { actorPubkey, assignment } = payload;
      if (!actorPubkey) {
        return { success: false, error: 'actorPubkey is required' };
      }
      if (!assignment || !assignment.pubkey) {
        return { success: false, error: 'assignment.pubkey is required' };
      }

      const permission = permissionHelper.canPerform({
        pubkey: actorPubkey,
        action: 'trust.assign',
        scope: buildPermissionScope(assignment.scope)
      });
      if (!permission.allowed) {
        return { success: false, error: permission.reason || 'Permission denied', details: permission };
      }

      const targetPubkey = String(assignment.pubkey).trim().toLowerCase();
      if (!targetPubkey) {
        return { success: false, error: 'Target pubkey is empty' };
      }

      const assignedTrustLevel = assignment.assigned_trust_level !== undefined && assignment.assigned_trust_level !== null
        ? Number(assignment.assigned_trust_level)
        : null;
      const trustLimit = assignment.trust_limit !== undefined && assignment.trust_limit !== null
        ? Number(assignment.trust_limit)
        : null;
      const expiresAt = assignment.expires_at !== undefined && assignment.expires_at !== null
        ? Number(assignment.expires_at)
        : null;

      const entry = {
        pubkey: targetPubkey,
        assigned_trust_level: assignedTrustLevel,
        trust_limit: trustLimit,
        assigned_by_pubkey: actorPubkey,
        assigned_by_trust_level: trustManager.getTrustLevel(actorPubkey),
        scope: serializeAssignmentScope(assignment.scope),
        source: assignment.source || 'manual',
        reason: assignment.reason || null,
        expires_at: Number.isFinite(expiresAt) ? expiresAt : null,
        created_at: assignment.created_at || Math.floor(Date.now() / 1000)
      };

      const assignmentId = trustManager.saveTrustAssignment(entry);
      broadcastTrustChange({
        type: 'assignment',
        action: 'create',
        pubkey: entry.pubkey,
        actorPubkey,
        assignmentId
      });
      return { success: true, assignmentId };
    } catch (error) {
      console.error('[trust:assignments:create] Failed:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('trust:assignments:delete', (_event, { assignmentId, actorPubkey } = {}) => {
    try {
      if (!assignmentId) {
        return { success: false, error: 'assignmentId is required' };
      }
      if (!actorPubkey) {
        return { success: false, error: 'actorPubkey is required' };
      }

      const assignments = trustManager.listTrustAssignments();
      const target = assignments.find((row) => Number(row.assignment_id) === Number(assignmentId));
      if (!target) {
        return { success: false, error: 'Assignment not found' };
      }

      const permission = permissionHelper.canPerform({
        pubkey: actorPubkey,
        action: 'trust.assign',
        scope: buildPermissionScope(target.scope)
      });
      if (!permission.allowed) {
        return { success: false, error: permission.reason || 'Permission denied', details: permission };
      }

      trustManager.deleteTrustAssignment(assignmentId);
      broadcastTrustChange({
        type: 'assignment',
        action: 'delete',
        pubkey: target.pubkey,
        actorPubkey,
        assignmentId
      });
      return { success: true };
    } catch (error) {
      console.error('[trust:assignments:delete] Failed:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('moderation:block-target', (_event, payload = {}) => {
    try {
      const result = moderationManager.createModerationAction({
        actorPubkey: payload.actorPubkey,
        actionType: payload.actionType || 'block-user',
        target: payload.target,
        scope: payload.scope,
        reason: payload.reason,
        content: payload.content || {}
      });
      return result;
    } catch (error) {
      console.error('[moderation:block-target] Failed:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('moderation:revoke-action', (_event, payload = {}) => {
    try {
      const result = moderationManager.revokeModerationAction({
        actorPubkey: payload.actorPubkey,
        actionId: payload.actionId,
        reason: payload.reason
      });
      return result;
    } catch (error) {
      console.error('[moderation:revoke-action] Failed:', error);
      return { success: false, error: error.message };
    }
  });
  ipcMain.handle('moderation:list-actions', (_event, payload = {}) => {
    try {
      const actions = moderationManager.listModerationActions({ target: payload.target, status: payload.status });
      return { success: true, actions };
    } catch (error) {
      console.error('[moderation:list-actions] Failed:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('trust:permissions:get', (_event, { pubkey, scope } = {}) => {
    try {
      if (!pubkey) {
        return { success: false, error: 'Missing pubkey' };
      }
      const details = trustManager.inspectTrust(pubkey);
      const response = {
        success: true,
        pubkey: details.pubkey,
        trust_level: details.trust_level,
        trust_tier: details.trust_tier,
        permissions: details.permissions,
        declarations: details.declarations,
        assignments: details.assignments
      };
      if (scope) {
        response.scope = scope;
      }
      return response;
    } catch (error) {
      console.error('[trust:permissions:get] Failed:', error);
      return { success: false, error: error.message };
    }
  });

  const broadcastUsb2snesSshStatus = (status) => {
    try {
      const windows = BrowserWindow.getAllWindows();
      windows.forEach((win) => {
        if (!win.isDestroyed()) {
          win.webContents.send('usb2snes:ssh-status', status);
        }
      });
    } catch (error) {
      console.warn('[USB2SNES][SSH] Failed to broadcast status:', error);
    }
  };

  sshManager.on('status', broadcastUsb2snesSshStatus);
  broadcastUsb2snesSshStatus(sshManager.getStatus());

  const broadcastUsb2snesFxpStatus = (status) => {
    try {
      const windows = BrowserWindow.getAllWindows();
      windows.forEach((win) => {
        if (!win.isDestroyed()) {
          win.webContents.send('usb2snes:fxp-status', status);
        }
      });
    } catch (error) {
      console.warn('[USB2SNES][FXP] Failed to broadcast status:', error);
    }
  };

  usbfxpServer.on('status', broadcastUsb2snesFxpStatus);
  broadcastUsb2snesFxpStatus(usbfxpServer.getStatus());

  // Initialize Nostr runtime IPC stubs
  registerNostrRuntimeIPC(dbManager);

  // =============================
  // Tag data (SMW) - categories and tag map
  // =============================
  ipcMain.handle('tags:category-tree:get', async () => {
    try {
      const fs = require('fs');
      const path = require('path');
      const filePath = path.resolve(projectRoot, 'electron', 'main', 'tags', 'smw_tag_category_tree.json');
      const content = fs.readFileSync(filePath, 'utf-8');
      const json = JSON.parse(content);
      return { success: true, tree: json };
    } catch (error) {
      console.error('[tags:category-tree:get] Failed:', error);
      return { success: false, error: error.message };
    }
  });

  // =============================
  // Difficulty Mapping (rhdata)
  // =============================
  ipcMain.handle('db:difficulty-map:get', (_event, { mapType, mapString } = {}) => {
    try {
      const db = dbManager.getConnection('rhdata');
      const result = db.prepare(`
        SELECT difficulty_number
        FROM game_difficulty_map
        WHERE map_type = ? AND map_string = ?
        LIMIT 1
      `).get(mapType, mapString);
      
      return { success: true, difficultyNumber: result ? result.difficulty_number : null };
    } catch (error) {
      console.error('[db:difficulty-map:get] Failed:', error);
      return { success: false, error: error.message, difficultyNumber: null };
    }
  });

  // =============================
  // Submission Drafts (clientdata)
  // =============================
  function ensureSubmissionDraftsTable() {
    try {
      const db = dbManager.getConnection('clientdata');
      db.prepare(`
        CREATE TABLE IF NOT EXISTS game_submission_drafts (
          draft_uuid TEXT PRIMARY KEY,
          submitter_pubkey_npub TEXT,
          draft_name TEXT,
          draft_data_json TEXT NOT NULL,
          created_at_utc INTEGER NOT NULL,
          updated_at_utc INTEGER NOT NULL,
          prepared_at_utc INTEGER NULL,
          packaged_at_utc INTEGER NULL,
          rhpak_path TEXT NULL,
          state TEXT NOT NULL DEFAULT 'draft'
        )
      `).run();
      return db;
    } catch (error) {
      console.error('[drafts] ensure table failed:', error);
      throw error;
    }
  }
  function getDraftsColumnSet(db) {
    try {
      const cols = db.prepare(`PRAGMA table_info(game_submission_drafts)`).all().map(r => String(r.name || '').toLowerCase());
      const hasDraftDataJson = cols.includes('draft_data_json');
      const hasPayloadJson = cols.includes('payload_json');
      return {
        hasDraftDataJson,
        hasPayloadJson,
        id: cols.includes('draft_uuid') ? 'draft_uuid' : 'draft_id',
        title: cols.includes('draft_name') ? 'draft_name' : 'title',
        data: hasDraftDataJson ? 'draft_data_json' : 'payload_json',
        created: isNew ? 'created_at_utc' : 'created_at_utc',
        updated: isNew ? 'updated_at_utc' : 'updated_at_utc',
        state: cols.includes('state') ? 'state' : null,
        rhpak: cols.includes('rhpak_path') ? 'rhpak_path' : null,
      };
    } catch {
      return { hasDraftDataJson: true, hasPayloadJson: false, id: 'draft_uuid', title: 'draft_name', data: 'draft_data_json', created: 'created_at_utc', updated: 'updated_at_utc', state: 'state', rhpak: 'rhpak_path' };
    }
  }

  ipcMain.handle('submission:drafts:list', async () => {
    try {
      const db = ensureSubmissionDraftsTable();
      const cols = getDraftsColumnSet(db);
      const select = `
        SELECT ${cols.id} AS draft_uuid,
               ${cols.title} AS draft_name,
               ${cols.created} AS created_at_utc,
               ${cols.updated} AS updated_at_utc
               ${cols.state ? `, ${cols.state} AS state` : ''}
        FROM game_submission_drafts
        ORDER BY ${cols.updated} DESC`;
      const rows = db.prepare(select).all();
      return { success: true, drafts: rows };
    } catch (error) {
      console.error('[submission:drafts:list] Failed:', error);
      return { success: false, error: error.message, drafts: [] };
    }
  });

  ipcMain.handle('submission:drafts:get', async (_event, { draftId }) => {
    try {
      if (!draftId) return { success: false, error: 'Missing draftId' };
      const db = ensureSubmissionDraftsTable();
      const cols = getDraftsColumnSet(db);
      const select = `
        SELECT ${cols.id} AS draft_uuid,
               ${cols.title} AS draft_name,
               ${cols.data} AS draft_data_json,
               ${cols.created} AS created_at_utc,
               ${cols.updated} AS updated_at_utc
               ${cols.state ? `, ${cols.state} AS state` : ''}
               ${cols.rhpak ? `, ${cols.rhpak} AS rhpak_path` : ''}
        FROM game_submission_drafts
        WHERE ${cols.id} = ?`;
      const row = db.prepare(select).get(draftId);
      if (!row) return { success: false, error: 'Not found' };
      return { success: true, draft: row };
    } catch (error) {
      console.error('[submission:drafts:get] Failed:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('submission:drafts:save', async (_event, { draftId, title, payload }) => {
    try {
      if (!payload) return { success: false, error: 'Missing payload' };
      const db = ensureSubmissionDraftsTable();
      const cols = getDraftsColumnSet(db);
      const now = Math.floor(Date.now() / 1000);
      const id = draftId || `draft_${now}_${Math.random().toString(36).slice(2, 8)}`;
      let json;
      try {
        json = typeof payload === 'string' ? payload : JSON.stringify(payload);
      } catch (e) {
        // As a last resort, store minimal shape with error
        json = JSON.stringify({ error: 'serialization_failed', message: String(e) });
      }
      if (json == null) json = '{}';
      if (typeof json !== 'string') {
        try { json = JSON.stringify(json || {}); } catch { json = '{}'; }
      }
      if (json === 'null') json = '{}';
      if (json.trim().length === 0) json = '{}';
      if (typeof json !== 'string') {
        json = JSON.stringify(json || {});
      }
      // Log values being written for precise diagnostics
      try {
        const preview = typeof json === 'string' ? json.slice(0, 200) : '';
        console.log('[submission:drafts:save] Using columns:', cols);
        console.log('[submission:drafts:save] Writing id:', id, 'title:', title || 'Untitled Submission');
        console.log('[submission:drafts:save] JSON length:', json.length, 'preview:', preview);
      } catch {}
      // Explicit insert-or-update (write both JSON columns if they exist)
      const exists = db.prepare(`SELECT 1 FROM game_submission_drafts WHERE ${cols.id} = ?`).get(id);
      try {
        if (exists) {
          // Build dynamic SET clause
          const sets = [`${cols.title} = ?`, `${cols.updated} = ?`];
          const params = [title || 'Untitled Submission', now];
          if (cols.hasDraftDataJson) { sets.push(`draft_data_json = ?`); params.push(json); }
          if (cols.hasPayloadJson) { sets.push(`payload_json = ?`); params.push(json); }
          const upd = `UPDATE game_submission_drafts SET ${sets.join(', ')} WHERE ${cols.id} = ?`;
          params.push(id);
          db.prepare(upd).run(...params);
        } else {
          // Build dynamic columns/values
          const columns = [cols.id, cols.title, cols.created, cols.updated];
          const values = [id, title || 'Untitled Submission', now, now];
          if (cols.hasDraftDataJson) { columns.push('draft_data_json'); values.push(json); }
          if (cols.hasPayloadJson) { columns.push('payload_json'); values.push(json); }
          const placeholders = columns.map(() => '?').join(', ');
          const ins = `INSERT INTO game_submission_drafts (${columns.join(', ')}) VALUES (${placeholders})`;
          db.prepare(ins).run(...values);
        }
      } catch (writeErr) {
        // Force minimal JSON on constraint errors and retry once
        console.error('[submission:drafts:save] Write failed; retrying with minimal JSON:', writeErr?.message);
        const minimal = '{}';
        if (exists) {
          const sets = [`${cols.title} = ?`, `${cols.updated} = ?`];
          const params = [title || 'Untitled Submission', now];
          if (cols.hasDraftDataJson) { sets.push(`draft_data_json = ?`); params.push(minimal); }
          if (cols.hasPayloadJson) { sets.push(`payload_json = ?`); params.push(minimal); }
          const upd = `UPDATE game_submission_drafts SET ${sets.join(', ')} WHERE ${cols.id} = ?`;
          params.push(id);
          db.prepare(upd).run(...params);
        } else {
          const columns = [cols.id, cols.title, cols.created, cols.updated];
          const values = [id, title || 'Untitled Submission', now, now];
          if (cols.hasDraftDataJson) { columns.push('draft_data_json'); values.push(minimal); }
          if (cols.hasPayloadJson) { columns.push('payload_json'); values.push(minimal); }
          const placeholders = columns.map(() => '?').join(', ');
          const ins = `INSERT INTO game_submission_drafts (${columns.join(', ')}) VALUES (${placeholders})`;
          db.prepare(ins).run(...values);
        }
      }
      return { success: true, draftId: id };
    } catch (error) {
      console.error('[submission:drafts:save] Failed:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('submission:drafts:delete', async (_event, { draftId }) => {
    try {
      if (!draftId) return { success: false, error: 'Missing draftId' };
      const db = ensureSubmissionDraftsTable();
      db.prepare(`DELETE FROM game_submission_drafts WHERE draft_uuid = ?`).run(draftId);
      return { success: true };
    } catch (error) {
      console.error('[submission:drafts:delete] Failed:', error);
      return { success: false, error: error.message };
    }
  });

  // =============================
  // Submission preparation/packaging (newgame.js)
  // =============================
  ipcMain.handle('submission:validate-screenshot', async (_event, { filePath } = {}) => {
    try {
      if (!filePath) return { success: false, error: 'Missing filePath' };
      const fs = require('fs');
      const { nativeImage } = require('electron');
      if (!fs.existsSync(filePath)) {
        return { success: false, error: `File not found: ${filePath}` };
      }
      const stat = fs.statSync(filePath);
      const img = nativeImage.createFromPath(filePath);
      const size = img.getSize();
      if (!size || !size.width || !size.height) {
        return { success: false, error: 'Unable to read image dimensions', sizeBytes: stat.size || 0 };
      }
      return {
        success: true,
        width: size.width,
        height: size.height,
        sizeBytes: stat.size || 0
      };
    } catch (error) {
      console.error('[submission:validate-screenshot] Failed:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('submission:prepare', async (_event, { configPath, draftUuid } = {}) => {
    try {
      if (!configPath) return { success: false, error: 'Missing configPath' };
      const fs = require('fs');
      const os = require('os');
      const newgame = require(path.resolve(projectRoot, 'jstools', 'newgame.js'));
      if (!newgame || typeof newgame.handlePrepare !== 'function') {
        return { success: false, error: 'newgame.handlePrepare is unavailable' };
      }
      // Detect if provided JSON is a newgame skeleton; if not, map our draft shape to skeleton
      let jsonText = fs.readFileSync(configPath, 'utf8');
      let parsed;
      try { parsed = JSON.parse(jsonText); } catch { parsed = null; }
      let skeletonPath = configPath;
      if (!parsed || !parsed.gameversion) {
        // Map from draft { files, meta } to skeleton expected by newgame.js
        const draft = parsed || {};
        const meta = draft.meta || {};
        const files = draft.files || {};
        const patch = files.patch || {};
        const screenshots = Array.isArray(files.screenshots) ? files.screenshots : [];
        const diffMap = {
          1: 'Newcomer', 2: 'Casual', 3: 'Skilled', 4: 'Advanced',
          5: 'Expert', 6: 'Master', 7: 'Grandmaster'
        };
        const draftName = (meta.name || '').toString();
        const safe = (s) => (s || '').toString().toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
        // Do not overwrite existing meta.gameid; only generate if missing
        const genId = (meta.gameid && String(meta.gameid)) || (safe(meta.name) || ('subm-' + Math.random().toString(36).slice(2, 10)));
        const gv = {
          gvuuid: (typeof crypto.randomUUID === 'function') ? crypto.randomUUID() : `${Date.now().toString(16)}${Math.random().toString(16).slice(2,10)}`,
          gameid: genId,
          section: meta.section || 'smwhacks',
          based_against: meta.based_against || 'SMW',
          version: meta.version || 1,
          removed: 0,
          obsoleted: 0,
          moderated: 0,
          featured: 0,
          name: draftName,
          gametype: Array.isArray(meta.types) ? meta.types.join(', ') : (meta.type || ''),
          difficulty: (typeof meta.difficulty === 'number') ? (diffMap[meta.difficulty] || '') : (meta.difficulty || ''),
          raw_difficulty: (typeof meta.difficulty === 'number') ? (`diff_${meta.difficulty}`) : (meta.raw_difficulty || ''),
          type: Array.isArray(meta.types) ? meta.types.join(', ') : (meta.type || ''),
          warnings: Array.isArray(meta.warnings) ? meta.warnings : [],
          tags: typeof meta.tags === 'string' ? meta.tags.split(',').map(s => s.trim()).filter(Boolean) : (Array.isArray(meta.tags) ? meta.tags : []),
          author: meta.author || '',
          authors: meta.authors || '',
          submitter: '', // will be set during publishing
          legacy_type: '',
          url: meta.url || '',
          download_url: meta.download_url || '',
          name_href: '',
          author_href: '',
          obsoleted_by: '',
          description: meta.description || '',
          length: (meta.length != null) ? String(meta.length) : '',
          demo: meta.demo ? 'Yes' : 'No',
          sa1: meta.sa1 ? 'Yes' : 'No',
          collab: meta.collab ? 'Yes' : 'No',
          // Pass screenshot source paths to newgame for staging
          screenshots: screenshots
            .filter(s => s && s.path)
            .map(s => String(s.path)),
          patch_filename: patch.name || (patch.path ? path.basename(patch.path) : ''),
          patch_local_path: patch.path || '',
          patch_notes: '',
          submission_notes: meta.submission_notes || ''
        };
        const skel = {
          metadata: {
            script: 'newgame.js',
            version: 'ui-submit',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            prepared: false,
            prepared_at: null,
            added_at: null
          },
          artifacts: { patch: null },
          gameversion: gv,
          gameversion_stats: {
            download_count: 0,
            view_count: 0,
            comment_count: 0,
            rating_value: null,
            rating_count: 0,
            favorite_count: 0,
            hof_status: null,
            featured_status: null
          },
          patchblob: { pbuuid: (typeof crypto.randomUUID === 'function') ? crypto.randomUUID() : `${Date.now().toString(16)}${Math.random().toString(16).slice(2,10)}` },
          attachment: { auuid: (typeof crypto.randomUUID === 'function') ? crypto.randomUUID() : `${Date.now().toString(16)}${Math.random().toString(16).slice(2,10)}` },
          resources: []
        };
        // Include gamestages if present in draft
        if (meta.gamestages && Array.isArray(meta.gamestages) && meta.gamestages.length > 0) {
          skel.gamestages = meta.gamestages.map((stage) => ({
            gameid: genId,
            levelnumber: stage.levelnumber || null,
            levelname: stage.levelname || 'New Stage',
            versions: stage.versions || '*',
            submapid: stage.submapid || null,
            translevel_13bf: stage.translevel_13bf || null,
            tile_x: stage.tile_x || null,
            tile_y: stage.tile_y || null,
            requisites: stage.requisites || null,
            playable: stage.playable ?? 1,
            rando: stage.rando ?? 1,
            difficulty: stage.difficulty ?? 0,
            mainexit: stage.mainexit ?? 1,
            keyhole: stage.keyhole ?? 0,
            credits: stage.credits ?? 0,
            water: stage.water ?? 0,
            ghouse: stage.ghouse ?? 0,
            spalace: stage.spalace ?? 0,
            castle: stage.castle ?? 0,
            boss: stage.boss ?? 0,
            secret: stage.secret ?? 0,
            troll: stage.troll ?? 0,
            final: stage.final ?? 0,
            lock: stage.lock ?? 0,
            playlevel_patch_code: stage.playlevel_patch_code || null,
            excluded_patchcodes: stage.excluded_patchcodes || null,
            extradescription: stage.extradescription || null,
	    stagetags: stage.stagetags || null
          }));
        }
        // Save to temp path so newgame can load it
        const tmp = path.join(os.tmpdir(), `submission_skeleton_${Date.now()}_${Math.random().toString(36).slice(2,8)}.json`);
        fs.writeFileSync(tmp, JSON.stringify(skel, null, 2), 'utf8');
        skeletonPath = tmp;
      }
      await newgame.handlePrepare(skeletonPath);
      // Read prepared skeleton (returned to renderer; draft persistence handled in renderer Save Draft)
      let prepared = null;
      try {
        const preparedTxt = fs.readFileSync(skeletonPath, 'utf8');
        prepared = JSON.parse(preparedTxt);
      } catch {}
      return { success: true, skeleton: prepared || null, draftUuid: draftUuid || null };
    } catch (error) {
      console.error('[submission:prepare] Failed:', error);
      return { success: false, error: error.message };
    }
  });
  ipcMain.handle('submission:package', async (event, { configPath, outPath, options } = {}) => {
    try {
      if (!configPath) return { success: false, error: 'Missing configPath' };
      const out = outPath || '';
      const newgame = require(path.resolve(projectRoot, 'jstools', 'newgame.js'));
      if (!newgame || typeof newgame.handlePackage !== 'function') {
        return { success: false, error: 'newgame.handlePackage is unavailable' };
      }
      const fs = require('fs');
      const os = require('os');
      // Ensure we are packaging a prepared skeleton; if not, map/prepare first
      let txt = fs.readFileSync(configPath, 'utf8');
      let data;
      try { data = JSON.parse(txt); } catch { data = null; }
      let skeletonPath = configPath;
      if (!data || !data.gameversion) {
        // Map draft → skeleton
        const draft = data || {};
        const meta = draft.meta || {};
        const files = draft.files || {};
        const patch = files.patch || {};
        const screenshots = Array.isArray(files.screenshots) ? files.screenshots : [];
        const diffMap = {1:'Newcomer',2:'Casual',3:'Skilled',4:'Advanced',5:'Expert',6:'Master',7:'Grandmaster'};
        const draftName = (meta.name || '').toString();
        const safe = (s) => (s || '').toString().toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
        const gameIdSlug = safe((meta.gameid || meta.name) || '');
        const genId = gameIdSlug || ('subm-' + Math.random().toString(36).slice(2,10));
        const gv = {
          gvuuid: (typeof crypto.randomUUID === 'function') ? crypto.randomUUID() : `${Date.now().toString(16)}${Math.random().toString(16).slice(2,10)}`,
          gameid: genId,
          section: 'smwhacks',
          based_against: meta.based_against || 'SMW',
          version: meta.version || 1,
          removed: 0,
          obsoleted: 0,
          moderated: 0,
          featured: 0,
          name: draftName,
          gametype: Array.isArray(meta.types) ? meta.types.join(', ') : (meta.type || ''),
          difficulty: (typeof meta.difficulty === 'number') ? (diffMap[meta.difficulty] || '') : (meta.difficulty || ''),
          raw_difficulty: (typeof meta.difficulty === 'number') ? (`diff_${meta.difficulty}`) : (meta.raw_difficulty || ''),
          type: Array.isArray(meta.types) ? meta.types.join(', ') : (meta.type || ''),
          warnings: Array.isArray(meta.warnings) ? meta.warnings : [],
          tags: typeof meta.tags === 'string' ? meta.tags.split(',').map(s => s.trim()).filter(Boolean) : (Array.isArray(meta.tags) ? meta.tags : []),
          author: meta.author || '',
          authors: meta.authors || '',
          submitter: '',
          legacy_type: '',
          url: meta.url || '',
          download_url: meta.download_url || '',
          name_href: '',
          author_href: '',
          obsoleted_by: '',
          description: meta.description || '',
          length: (meta.length != null) ? String(meta.length) : '',
          demo: meta.demo ? 'Yes' : 'No',
          sa1: meta.sa1 ? 'Yes' : 'No',
          collab: meta.collab ? 'Yes' : 'No',
          screenshots: screenshots
            .filter(s => s && s.path)
            .map(s => String(s.path)),
          patch_filename: patch.name || (patch.path ? path.basename(patch.path) : ''),
          patch_local_path: patch.path || '',
          patch_notes: '',
          submission_notes: meta.submission_notes || ''
        };
        const skel = {
          metadata: {
            script: 'newgame.js',
            version: 'ui-submit',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            prepared: false,
            prepared_at: null,
            added_at: null
          },
          artifacts: { patch: null },
          gameversion: gv,
          gameversion_stats: {
            download_count: 0,
            view_count: 0,
            comment_count: 0,
            rating_value: null,
            rating_count: 0,
            favorite_count: 0,
            hof_status: null,
            featured_status: null
          },
          patchblob: { pbuuid: (typeof crypto.randomUUID === 'function') ? crypto.randomUUID() : `${Date.now().toString(16)}${Math.random().toString(16).slice(2,10)}` },
          attachment: { auuid: (typeof crypto.randomUUID === 'function') ? crypto.randomUUID() : `${Date.now().toString(16)}${Math.random().toString(16).slice(2,10)}` },
          resources: []
        };
        // Include gamestages if present in draft
        if (meta.gamestages && Array.isArray(meta.gamestages) && meta.gamestages.length > 0) {
          skel.gamestages = meta.gamestages.map((stage) => ({
            gameid: genId,
            levelnumber: stage.levelnumber || null,
            levelname: stage.levelname || 'New Stage',
            versions: stage.versions || '*',
            submapid: stage.submapid || null,
            translevel_13bf: stage.translevel_13bf || null,
            tile_x: stage.tile_x || null,
            tile_y: stage.tile_y || null,
            requisites: stage.requisites || null,
            playable: stage.playable ?? 1,
            rando: stage.rando ?? 1,
            difficulty: stage.difficulty ?? 0,
            mainexit: stage.mainexit ?? 1,
            keyhole: stage.keyhole ?? 0,
            credits: stage.credits ?? 0,
            water: stage.water ?? 0,
            ghouse: stage.ghouse ?? 0,
            spalace: stage.spalace ?? 0,
            castle: stage.castle ?? 0,
            boss: stage.boss ?? 0,
            secret: stage.secret ?? 0,
            troll: stage.troll ?? 0,
            final: stage.final ?? 0,
            lock: stage.lock ?? 0,
            playlevel_patch_code: stage.playlevel_patch_code || null,
            excluded_patchcodes: stage.excluded_patchcodes || null,
            extradescription: stage.extradescription || null,
	    stagetags: stage.stagetags || null
          }));
        }
        const tmp = path.join(os.tmpdir(), `submission_skeleton_${Date.now()}_${Math.random().toString(36).slice(2,8)}.json`);
        fs.writeFileSync(tmp, JSON.stringify(skel, null, 2), 'utf8');
        skeletonPath = tmp;
        data = skel;
      }

      // If not yet prepared, run prepare implicitly before packaging
      let preparedData;
      try {
        const txt2 = fs.readFileSync(skeletonPath, 'utf8');
        preparedData = JSON.parse(txt2);
      } catch {}
      if (!preparedData || !preparedData.metadata || !preparedData.metadata.prepared) {
        await newgame.handlePrepare(skeletonPath);
        // Reload prepared skeleton
        try {
          const txt3 = fs.readFileSync(skeletonPath, 'utf8');
          preparedData = JSON.parse(txt3);
        } catch {}
      }
      
      // After prepare, inject packager_profile + packager_signatures if online profile is active
      if (preparedData) {
        try {
          const keyguardKey = getKeyguardKey(event);
          if (keyguardKey) {
            const profileManager = new OnlineProfileManager(dbManager, keyguardKey);
            const profileUuid = profileManager.getCurrentProfileId();
            const profile = profileUuid ? profileManager.getProfile(profileUuid) : null;
            if (profileUuid && profile) {
              const primaryKeypair = profileManager.getDecryptedPrimaryKeypair(profileUuid);
              if (primaryKeypair && primaryKeypair.privateKey) {
                const crypto = require('crypto');
                // Compute hash of skeleton.json (the prepared skeleton)
                const skeletonJson = JSON.stringify(preparedData, null, 2);
                const hashBuf = crypto.createHash('sha256').update(skeletonJson, 'utf8').digest();
                let privHex = primaryKeypair.privateKey;
                if (Buffer.isBuffer(privHex)) {
                  privHex = privHex.toString('hex');
                }
                if (typeof privHex === 'string' && /^[0-9a-fA-F]{64}$/.test(privHex)) {
                  // Sign hash using Schnorr signature (Nostr-compatible)
                  // Use nostr-tools finalizeEvent to create a signed event, then extract the signature
                  // This works because Nostr events use Schnorr signatures
                  let sigHex = '';
                  let signedEvent = null;
                  try {
                    const { finalizeEvent } = require('nostr-tools');
                    const privBytes = new Uint8Array(Buffer.from(privHex, 'hex'));
                    // Create an event with clear metadata identifying it as a rhpak skeleton signature
                    const eventTemplate = {
                      kind: 0,
                      created_at: Math.floor(Date.now() / 1000),
                      tags: [
                        ['purpose', 'rhpak-skeleton-signature'],
                        ['file', 'skeleton.json'],
                        ['hash', hashBuf.toString('hex')],
                        ['rhpak-version', '1']
                      ],
                      content: hashBuf.toString('hex')
                    };
                    signedEvent = finalizeEvent(eventTemplate, privBytes);
                    // Extract signature from the signed event (64-byte hex string)
                    sigHex = signedEvent.sig;
                  } catch (err) {
                    console.warn('[submission:package] Failed to create signature using nostr-tools:', err?.message || err);
                    // If signing fails, we'll skip adding the signature but still add the profile
                    sigHex = '';
                    signedEvent = null;
                  }
                  
                  const signerPubHex = primaryKeypair.publicKeyHex || primaryKeypair.publicKey || '';
                  const fp = await calculateProfileFp(profileUuid);
                  const metadata = preparedData.metadata || (preparedData.metadata = {});
                  const metaInfo = profile._metadata || {};
                  // CRITICAL: Keypairs are NOT stored in profile_json - get from database table
                  // primaryKeypair already obtained from getDecryptedPrimaryKeypair above
                  
                  // Always add packager_profile when online profile is active
                  metadata.packager_profile = {
                    profileId: profile.profileId || metaInfo.profileUuid || profileUuid,
                    username: profile.username || '',
                    displayName: profile.displayName || '',
                    bio: profile.bio || '',
                    socialIds: profile.socialIds || [],
                    pictureUrl: profile.pictureUrl || '',
                    bannerUrl: profile.bannerUrl || '',
                    fp,
                    public_nostr_version: metaInfo.publicNostrVersion || null,
                    primaryKeypair: {
                      // Only include public key details (no private key)
                      canonicalName: primaryKeypair.canonicalName || primaryKeypair.publicKey || '',
                      publicKeyHex: primaryKeypair.publicKeyHex || primaryKeypair.publicKey || '',
                      fingerprint: primaryKeypair.fingerprint || '',
                      createdAt: metaInfo.createdAt || null
                    }
                  };
                  
                  // Only add signatures if we successfully created a signature
                  if (sigHex && signedEvent) {
                    metadata.packager_signatures = [
                      {
                        file_path: 'skeleton.json',
                        signer: signerPubHex,
                        hashvalue: hashBuf.toString('hex'),
                        signature: sigHex
                      }
                    ];
                    // Store the full signed event for inclusion in rhpak.json
                    metadata.packager_signing_event = signedEvent;
                  } else {
                    metadata.packager_signatures = [];
                    metadata.packager_signing_event = null;
                  }
                  
                  // Update skeleton file with packager metadata
                  fs.writeFileSync(skeletonPath, JSON.stringify(preparedData, null, 2), 'utf8');
                }
              }
            }
          }
        } catch (sigErr) {
          console.warn('[submission:package] Failed to attach packager signature:', sigErr?.message || sigErr);
        }
      }
      
      await newgame.handlePackage(skeletonPath, out);
      return { success: true };
    } catch (error) {
      console.error('[submission:package] Failed:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('submission:calculate-file-hash', async (_event, { filePath } = {}) => {
    try {
      if (!filePath) return { success: false, error: 'Missing filePath' };
      const fs = require('fs');
      const crypto = require('crypto');
      if (!fs.existsSync(filePath)) {
        return { success: false, error: `File not found: ${filePath}` };
      }
      const stat = fs.statSync(filePath);
      const fileBuffer = fs.readFileSync(filePath);
      const hash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
      return {
        success: true,
        sha256: hash,
        sizeBytes: stat.size || 0
      };
    } catch (error) {
      console.error('[submission:calculate-file-hash] Failed:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('submission:verify-rhpak-download', async (_event, { expectedSha256, ipfsCid, downloadUrl } = {}) => {
    try {
      if (!expectedSha256) return { success: false, error: 'Missing expectedSha256' };
      if (!ipfsCid && !downloadUrl) {
        return { success: false, error: 'Must provide either ipfsCid or downloadUrl' };
      }
      if (ipfsCid && downloadUrl) {
        return { success: false, error: 'Provide either ipfsCid or downloadUrl, not both' };
      }
      
      const https = require('https');
      const http = require('http');
      const crypto = require('crypto');
      const { URL } = require('url');
      
      let fileUrl;
      if (ipfsCid) {
        // Validate IPFS CID format (v1 should start with 'bafy')
        if (!ipfsCid.trim().startsWith('bafy')) {
          return { success: false, error: 'IPFS CID must be v1 format (starts with "bafy")' };
        }
        // Use a public IPFS gateway (user can configure this later)
        fileUrl = `https://ipfs.io/ipfs/${ipfsCid.trim()}`;
      } else {
        fileUrl = downloadUrl.trim();
        try {
          const parsed = new URL(fileUrl);
          if (!['http:', 'https:'].includes(parsed.protocol)) {
            return { success: false, error: 'Download URL must use HTTP or HTTPS' };
          }
        } catch {
          return { success: false, error: 'Invalid download URL format' };
        }
      }
      
      // Download the file
      return new Promise((resolve) => {
        const protocol = fileUrl.startsWith('https:') ? https : http;
        protocol.get(fileUrl, (res) => {
          if (res.statusCode !== 200) {
            resolve({ success: false, error: `HTTP ${res.statusCode}: ${res.statusMessage || 'Failed to download'}` });
            return;
          }
          const chunks = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () => {
            try {
              const fileBuffer = Buffer.concat(chunks);
              const actualHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
              if (actualHash.toLowerCase() !== expectedSha256.toLowerCase()) {
                resolve({ success: false, error: `Hash mismatch. Expected: ${expectedSha256}, Got: ${actualHash}` });
                return;
              }
              resolve({ success: true, sizeBytes: fileBuffer.length });
            } catch (err) {
              resolve({ success: false, error: `Failed to verify hash: ${err.message}` });
            }
          });
          res.on('error', (err) => {
            resolve({ success: false, error: `Download error: ${err.message}` });
          });
        }).on('error', (err) => {
          resolve({ success: false, error: `Connection error: ${err.message}` });
        });
      });
    } catch (error) {
      console.error('[submission:verify-rhpak-download] Failed:', error);
      return { success: false, error: error.message };
    }
  });

  // =============================
  // Utility: Save text to file (Save As...) and write temp text file
  // =============================
  ipcMain.handle('dialog:saveTextFile', async (_event, { defaultPath, content } = {}) => {
    try {
      const { dialog } = require('electron');
      const fs = require('fs');
      const path = require('path');
      const res = await dialog.showSaveDialog({
        title: 'Save File',
        defaultPath: defaultPath || 'submission.json',
        filters: [{ name: 'JSON', extensions: ['json'] }, { name: 'All Files', extensions: ['*'] }],
      });
      if (res.canceled || !res.filePath) {
        return { success: false, canceled: true };
      }
      fs.writeFileSync(res.filePath, String(content ?? ''), 'utf-8');
      return { success: true, filePath: res.filePath };
    } catch (error) {
      console.error('[dialog:saveTextFile] Failed:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('dialog:chooseSavePath', async (_event, { title, defaultPath, filters } = {}) => {
    try {
      const { dialog } = require('electron');
      const res = await dialog.showSaveDialog({
        title: title || 'Save As',
        defaultPath: defaultPath || '',
        filters: Array.isArray(filters) && filters.length ? filters : undefined,
        properties: []
      });
      if (res.canceled || !res.filePath) {
        return { success: false, canceled: true };
      }
      return { success: true, filePath: res.filePath };
    } catch (error) {
      console.error('[dialog:chooseSavePath] Failed:', error);
      return { success: false, error: error.message };
    }
  });
  ipcMain.handle('fs:writeTempText', async (_event, { prefix, suffix, content } = {}) => {
    try {
      const fs = require('fs');
      const path = require('path');
      const os = require('os');
      const dir = os.tmpdir();
      const name = `${prefix || 'rhtmp_'}${Date.now()}_${Math.random().toString(36).slice(2,8)}${suffix || ''}`;
      const filePath = path.join(dir, name);
      fs.writeFileSync(filePath, String(content ?? ''), 'utf-8');
      return { success: true, filePath };
    } catch (error) {
      console.error('[fs:writeTempText] Failed:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('fs:writeFile', async (_event, { filePath, content } = {}) => {
    try {
      if (!filePath) {
        return { success: false, error: 'filePath is required' };
      }
      const fs = require('fs');
      fs.writeFileSync(filePath, String(content ?? ''), 'utf-8');
      return { success: true, filePath };
    } catch (error) {
      console.error('[fs:writeFile] Failed:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('fs:readFile', async (_event, { filePath } = {}) => {
    try {
      if (!filePath) {
        return { success: false, error: 'filePath is required' };
      }
      const fs = require('fs');
      const content = fs.readFileSync(filePath, 'utf-8');
      return { success: true, content };
    } catch (error) {
      console.error('[fs:readFile] Failed:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('tags:map:get', async () => {
    try {
      const fs = require('fs');
      const path = require('path');
      const filePath = path.resolve(projectRoot, 'electron', 'main', 'tags', 'smw_tags.json');
      const content = fs.readFileSync(filePath, 'utf-8');
      const json = JSON.parse(content);
      const tags = json?.tags || {};
      return { success: true, tags };
    } catch (error) {
      console.error('[tags:map:get] Failed:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('tags:suggest', async (_event, { query = '', selected = [], contextTypes = [], limit = 12 } = {}) => {
    try {
      const fs = require('fs');
      const path = require('path');
      const tagsPath = path.resolve(projectRoot, 'electron', 'main', 'tags', 'smw_tags.json');
      const usagePath = path.resolve(projectRoot, 'electron', 'main', 'tags', 'smw_tag_usage.json');
      const pairsPath = path.resolve(projectRoot, 'electron', 'main', 'tags', 'smw_tag_pairs.json');
      const content = fs.readFileSync(tagsPath, 'utf-8');
      const json = JSON.parse(content);
      const tagMap = json?.tags || {};
      let usage = {};
      try {
        const usageContent = fs.readFileSync(usagePath, 'utf-8');
        const usageJson = JSON.parse(usageContent);
        usage = usageJson || {};
      } catch {}
      let pairs = {};
      try {
        const pairsContent = fs.readFileSync(pairsPath, 'utf-8');
        const pairsJson = JSON.parse(pairsContent);
        pairs = pairsJson || {};
      } catch {}
      const q = String(query || '').toLowerCase();
      const selectedSet = new Set((selected || []).map(s => String(s).toLowerCase()));
      const allTags = Object.keys(tagMap);
      let pool = q ? allTags.filter(t => t.toLowerCase().includes(q)) : allTags;
      const typeBased = new Set();
      if ((contextTypes || []).includes('Kaizo')) typeBased.add('kaizo');
      if ((contextTypes || []).includes('Troll')) typeBased.add('troll');
      const notSelected = (t) => !selectedSet.has(String(t).toLowerCase());
      // Rank candidates by: type bonus, pair co-occurrence with selected, usage count, and simple query match score
      const selectedLower = (selected || []).map(s => String(s).toLowerCase());
      const scoreFor = (tag) => {
        const lower = String(tag).toLowerCase();
        let score = 0;
        if (typeBased.has(lower)) score += 50;
        // Pair bonuses
        for (const s of selectedLower) {
          const a = s < lower ? `${s}||${lower}` : `${lower}||${s}`;
          const pairCount = pairs[a] || pairs[`${s},${lower}`] || 0;
          if (pairCount) score += Math.min(30, Math.log10(1 + pairCount) * 10);
        }
        // Usage bonus
        const u = usage[lower] || usage[tag] || 0;
        if (u) score += Math.min(40, Math.log10(1 + u) * 12);
        // Query proximity
        if (q) {
          if (lower.startsWith(q)) score += 20;
          else if (lower.includes(q)) score += 8;
        }
        return score;
      };
      const candidates = pool.filter(notSelected);
      candidates.sort((a, b) => scoreFor(b) - scoreFor(a));
      const suggestions = candidates.slice(0, limit || 12);
      return { success: true, suggestions };
    } catch (error) {
      console.error('[tags:suggest] Failed:', error);
      return { success: false, error: error.message, suggestions: [] };
    }
  });

  ipcMain.handle('tags:by-category', async (_event, { categoryPath } = {}) => {
    try {
      const fs = require('fs');
      const path = require('path');
      const tagsPath = path.resolve(projectRoot, 'electron', 'main', 'tags', 'smw_tags.json');
      const content = fs.readFileSync(tagsPath, 'utf-8');
      const json = JSON.parse(content);
      const tagMap = json?.tags || {};
      const cp = String(categoryPath || '').trim();
      if (!cp) return { success: true, tags: [] };
      const tags = Object.keys(tagMap).filter((t) => {
        const paths = tagMap[t] || [];
        return paths.some((p) => String(p).startsWith(cp));
      }).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
      return { success: true, tags };
    } catch (error) {
      console.error('[tags:by-category] Failed:', error);
      return { success: false, error: error.message, tags: [] };
    }
  });
  
  // ===========================================================================
  // GAME DATA OPERATIONS (rhdata.db)
  // ===========================================================================
  
  /**
   * Get authors by year with game counts
   * Channel: db:rhdata:get:authors-by-year
   */
  ipcMain.handle('db:rhdata:get:authors-by-year', async (event, { year }) => {
    try {
      return dbManager.withClientData('rhdata', (db) => {
        let query;
        if (year === 'all' || !year) {
          // Get all authors across all years, sorted by total game count
          query = db.prepare(`
            SELECT 
              gv.author as author,
              COUNT(*) as game_count
            FROM gameversions gv
            WHERE gv.removed = 0
              AND gv.author IS NOT NULL
              AND gv.author != ''
              AND gv.version = (
                SELECT MAX(version) FROM gameversions gv2 
                WHERE gv2.gameid = gv.gameid
              )
            GROUP BY gv.author
            ORDER BY game_count DESC, gv.author ASC
          `);
        } else {
          // Get authors for a specific year
          query = db.prepare(`
            SELECT 
              gv.author as author,
              COUNT(*) as game_count
            FROM gameversions gv
            WHERE gv.removed = 0
              AND gv.author IS NOT NULL
              AND gv.author != ''
              AND gv.added LIKE ?
              AND gv.version = (
                SELECT MAX(version) FROM gameversions gv2 
                WHERE gv2.gameid = gv.gameid
              )
            GROUP BY gv.author
            ORDER BY game_count DESC, gv.author ASC
          `);
        }
        
        var results = year === 'all' || !year 
          ? query.all()
          : query.all(`${year}%`);

        results = results.filter(r => r.author && r.author.length <= 30);
        
        return { success: true, authors: results };
      });
    } catch (error) {
      console.error('Error getting authors by year:', error);
      return { success: false, error: error.message, authors: [] };
    }
  });

  /**
   * Get all games (latest versions only) with user annotations
   * Channel: db:rhdata:get:games
   */
  ipcMain.handle('db:rhdata:get:games', async () => {
    try {
      return dbManager.withClientData('rhdata', (db) => {
        const games = db.prepare(`
          SELECT 
            gv.gameid as Id,
            gv.name as Name,
            gv.author as Author,
            gv.length as Length,
            gv.combinedtype as Type,
            gv.legacy_type as LegacyType,
            gv.fields_type as FieldsType,
            gv.gametype as GameType,
            gv.difficulty as PublicDifficulty,
            gv.raw_difficulty as RawDifficulty,
            gv.combinedtype as CombinedType,
            gv.racelevel as Racelevel,
            gv.sa1 as Sa1,
            gv.version as CurrentVersion,
            gv.local_runexcluded as LocalRunExcluded,
            gv.gvjsondata as JsonData,
            COALESCE(uga.status, 'Default') as Status,
            uga.user_difficulty_rating as MyDifficultyRating,
            uga.user_review_rating as MyReviewRating,
            uga.user_skill_rating as MySkillRating,
            uga.user_skill_rating_when_beat as MySkillRatingWhenBeat,
            uga.user_recommendation_rating as MyRecommendationRating,
            uga.user_importance_rating as MyImportanceRating,
            uga.user_technical_quality_rating as MyTechnicalQualityRating,
            uga.user_gameplay_design_rating as MyGameplayDesignRating,
            uga.user_fairness_rating as MyFairnessRating,
            uga.user_challenge_quality_rating as MyChallengeQualityRating,
            uga.user_originality_rating as MyOriginalityRating,
            uga.user_visual_aesthetics_rating as MyVisualAestheticsRating,
            uga.user_story_rating as MyStoryRating,
            uga.user_soundtrack_graphics_rating as MySoundtrackGraphicsRating,
            uga.user_accessibility_rating as MyAccessibilityRating,
            uga.user_length_pacing as MyLengthPacing,
            uga.user_progression_rating as MyProgressionRating,
            uga.user_consistency_rating as MyConsistencyRating,
            uga.user_overworld_rating as MyOverworldRating,
            uga.user_education_rating as MyEducationRating,
            uga.user_custom_rating as MyCustomRating,
            uga.user_puzzle_rating as MyPuzzleRating,
            uga.user_polish_rating as MyPolishRating,
            uga.user_boss_rating as MyBossRating,
            uga.user_difficulty_comment as MyDifficultyComment,
            uga.user_skill_comment as MySkillComment,
            uga.user_skill_comment_when_beat as MySkillCommentWhenBeat,
            uga.user_review_comment as MyReviewComment,
            uga.user_recommendation_comment as MyRecommendationComment,
            uga.user_importance_comment as MyImportanceComment,
            uga.user_technical_quality_comment as MyTechnicalQualityComment,
            uga.user_gameplay_design_comment as MyGameplayDesignComment,
            uga.user_fairness_comment as MyFairnessComment,
            uga.user_challenge_quality_comment as MyChallengeQualityComment,
            uga.user_originality_comment as MyOriginalityComment,
            uga.user_visual_aesthetics_comment as MyVisualAestheticsComment,
            uga.user_story_comment as MyStoryComment,
            uga.user_soundtrack_graphics_comment as MySoundtrackGraphicsComment,
            uga.user_accessibility_comment as MyAccessibilityComment,
            uga.user_length_pacing_comment as MyLengthPacingComment,
            uga.user_progression_comment as MyProgressionComment,
            uga.user_consistency_comment as MyConsistencyComment,
            uga.user_overworld_comment as MyOverworldComment,
            uga.user_education_comment as MyEducationComment,
            uga.user_custom_comment as MyCustomComment,
            uga.user_puzzle_comment as MyPuzzleComment,
            uga.user_polish_comment as MyPolishComment,
            uga.user_boss_comment as MyBossComment,
            COALESCE(uga.hidden, 0) as Hidden,
            COALESCE(uga.exclude_from_random, 0) as ExcludeFromRandom,
            uga.user_notes as Mynotes
          FROM gameversions gv
          LEFT JOIN clientdata.user_game_annotations uga ON gv.gameid = uga.gameid
          WHERE gv.removed = 0
            AND gv.version = (
              SELECT MAX(version) FROM gameversions gv2 
              WHERE gv2.gameid = gv.gameid
            )
          ORDER BY gv.name
        `).all();
        
        // Parse JSON data and convert booleans
        return games.map(g => ({
          ...g,
          JsonData: g.JsonData ? JSON.parse(g.JsonData) : null,
          Hidden: Boolean(g.Hidden),
          ExcludeFromRandom: Boolean(g.ExcludeFromRandom),
          LocalRunExcluded: Boolean(g.LocalRunExcluded),
        }));
      });
    } catch (error) {
      console.error('Error getting games:', error);
      throw error;
    }
  });

  /**
   * Get all available versions for a specific game
   * Channel: db:rhdata:get:versions
   */
  ipcMain.handle('db:rhdata:get:versions', async (event, { gameid }) => {
    try {
      const db = dbManager.getConnection('rhdata');
      
      const versions = db.prepare(`
        SELECT DISTINCT version 
        FROM gameversions 
        WHERE gameid = ?
        ORDER BY version DESC
      `).all(gameid);
      
      return versions.map(v => v.version);
    } catch (error) {
      console.error('Error getting versions:', error);
      throw error;
    }
  });

  /**
   * Get specific game version with annotations
   * Channel: db:rhdata:get:game
   */
  ipcMain.handle('db:rhdata:get:game', async (event, { gameid, version }) => {
    try {
      return dbManager.withClientData('rhdata', (db) => {
        const game = db.prepare(`
          SELECT 
            gv.gameid as Id,
            gv.name as Name,
            gv.author as Author,
            gv.length as Length,
            gv.combinedtype as Type,
            gv.legacy_type as LegacyType,
            gv.difficulty as PublicDifficulty,
            gv.version as CurrentVersion,
            gv.gvjsondata as JsonData,
            gv.demo as Demo,
            gv.contest as Contest,
            gv.racelevel as Racelevel,
            gv.sa1 as Sa1,
            gv.tags as Tags,
            gv.description as Description,
            -- Check for version-specific annotation first, fall back to game-wide
            COALESCE(ugva.status, uga.status, 'Default') as Status,
            COALESCE(ugva.user_difficulty_rating, uga.user_difficulty_rating) as MyDifficultyRating,
            COALESCE(ugva.user_review_rating, uga.user_review_rating) as MyReviewRating,
            COALESCE(ugva.user_skill_rating, uga.user_skill_rating) as MySkillRating,
            COALESCE(ugva.user_skill_rating_when_beat, uga.user_skill_rating_when_beat) as MySkillRatingWhenBeat,
            COALESCE(ugva.user_recommendation_rating, uga.user_recommendation_rating) as MyRecommendationRating,
            COALESCE(ugva.user_importance_rating, uga.user_importance_rating) as MyImportanceRating,
            COALESCE(ugva.user_technical_quality_rating, uga.user_technical_quality_rating) as MyTechnicalQualityRating,
            COALESCE(ugva.user_gameplay_design_rating, uga.user_gameplay_design_rating) as MyGameplayDesignRating,
            COALESCE(ugva.user_fairness_rating, uga.user_fairness_rating) as MyFairnessRating,
            COALESCE(ugva.user_challenge_quality_rating, uga.user_challenge_quality_rating) as MyChallengeQualityRating,
            COALESCE(ugva.user_originality_rating, uga.user_originality_rating) as MyOriginalityRating,
            COALESCE(ugva.user_visual_aesthetics_rating, uga.user_visual_aesthetics_rating) as MyVisualAestheticsRating,
            COALESCE(ugva.user_story_rating, uga.user_story_rating) as MyStoryRating,
            COALESCE(ugva.user_soundtrack_graphics_rating, uga.user_soundtrack_graphics_rating) as MySoundtrackGraphicsRating,
            COALESCE(ugva.user_difficulty_comment, uga.user_difficulty_comment) as MyDifficultyComment,
            COALESCE(ugva.user_skill_comment, uga.user_skill_comment) as MySkillComment,
            COALESCE(ugva.user_skill_comment_when_beat, uga.user_skill_comment_when_beat) as MySkillCommentWhenBeat,
            COALESCE(ugva.user_review_comment, uga.user_review_comment) as MyReviewComment,
            COALESCE(ugva.user_recommendation_comment, uga.user_recommendation_comment) as MyRecommendationComment,
            COALESCE(ugva.user_importance_comment, uga.user_importance_comment) as MyImportanceComment,
            COALESCE(ugva.user_technical_quality_comment, uga.user_technical_quality_comment) as MyTechnicalQualityComment,
            COALESCE(ugva.user_gameplay_design_comment, uga.user_gameplay_design_comment) as MyGameplayDesignComment,
            COALESCE(ugva.user_fairness_comment, uga.user_fairness_comment) as MyFairnessComment,
            COALESCE(ugva.user_challenge_quality_comment, uga.user_challenge_quality_comment) as MyChallengeQualityComment,
            COALESCE(ugva.user_originality_comment, uga.user_originality_comment) as MyOriginalityComment,
            COALESCE(ugva.user_visual_aesthetics_comment, uga.user_visual_aesthetics_comment) as MyVisualAestheticsComment,
            COALESCE(ugva.user_story_comment, uga.user_story_comment) as MyStoryComment,
            COALESCE(ugva.user_soundtrack_graphics_comment, uga.user_soundtrack_graphics_comment) as MySoundtrackGraphicsComment,
            COALESCE(ugva.user_accessibility_comment, uga.user_accessibility_comment) as MyAccessibilityComment,
            COALESCE(ugva.user_length_pacing_comment, uga.user_length_pacing_comment) as MyLengthPacingComment,
            COALESCE(ugva.user_progression_comment, uga.user_progression_comment) as MyProgressionComment,
            COALESCE(ugva.user_consistency_comment, uga.user_consistency_comment) as MyConsistencyComment,
            COALESCE(ugva.user_overworld_comment, uga.user_overworld_comment) as MyOverworldComment,
            COALESCE(ugva.user_education_comment, uga.user_education_comment) as MyEducationComment,
            COALESCE(ugva.user_custom_comment, uga.user_custom_comment) as MyCustomComment,
            COALESCE(ugva.user_puzzle_comment, uga.user_puzzle_comment) as MyPuzzleComment,
            COALESCE(ugva.user_polish_comment, uga.user_polish_comment) as MyPolishComment,
            COALESCE(ugva.user_boss_comment, uga.user_boss_comment) as MyBossComment,
            COALESCE(uga.hidden, 0) as Hidden,
            COALESCE(uga.exclude_from_random, 0) as ExcludeFromRandom,
            COALESCE(ugva.user_notes, uga.user_notes) as Mynotes,
            -- Flag if this has version-specific annotations
            -- Check gameid instead of annotation_key since ugva could be NULL from LEFT JOIN
            CASE WHEN ugva.gameid IS NOT NULL THEN 1 ELSE 0 END as HasVersionSpecific
          FROM gameversions gv
          LEFT JOIN clientdata.user_game_annotations uga ON gv.gameid = uga.gameid
          LEFT JOIN clientdata.user_game_version_annotations ugva 
            ON gv.gameid = ugva.gameid AND gv.version = ugva.version
          WHERE gv.gameid = ? AND gv.version = ?
        `).get(gameid, version);
        
        if (!game) return null;
        
        // Parse tags if it's a JSON string
        let tagsParsed = null;
        if (game.Tags) {
          try {
            tagsParsed = JSON.parse(game.Tags);
          } catch (e) {
            // If not JSON, treat as string
            tagsParsed = game.Tags;
          }
        }
        
        return {
          ...game,
          JsonData: game.JsonData ? JSON.parse(game.JsonData) : null,
          Tags: tagsParsed,
          Hidden: Boolean(game.Hidden),
          ExcludeFromRandom: Boolean(game.ExcludeFromRandom),
          HasVersionSpecific: Boolean(game.HasVersionSpecific),
        };
      });
    } catch (error) {
      console.error('Error getting game:', error);
      throw error;
    }
  });

  // ===========================================================================
  // USER ANNOTATION OPERATIONS (clientdata.db)
  // ===========================================================================

  /**
   * Save game annotation (game-wide)
   * Channel: db:clientdata:set:annotation
   */
  ipcMain.handle('db:clientdata:set:annotation', async (event, annotation) => {
    try {
      const db = dbManager.getConnection('clientdata');
      
      const {
        gameid,
        status,
        myDifficultyRating,
        myReviewRating,
        mySkillRating,
        mySkillRatingWhenBeat,
        hidden,
        excludeFromRandom,
        mynotes,
        myRecommendationRating,
        myImportanceRating,
        myTechnicalQualityRating,
        myGameplayDesignRating,
        myFairnessRating,
        myChallengeQualityRating,
        myOriginalityRating,
        myVisualAestheticsRating,
        myStoryRating,
        mySoundtrackGraphicsRating,
        myAccessibilityRating,
        myLengthPacing,
        myProgressionRating,
        myConsistencyRating,
        myOverworldRating,
        myEducationRating,
        myCustomRating,
        myPuzzleRating,
        myPolishRating,
        myBossRating,
        myDifficultyComment,
        mySkillComment,
        mySkillCommentWhenBeat,
        myReviewComment,
        myRecommendationComment,
        myImportanceComment,
        myTechnicalQualityComment,
        myGameplayDesignComment,
        myFairnessComment,
        myChallengeQualityComment,
        myOriginalityComment,
        myVisualAestheticsComment,
        myStoryComment,
        mySoundtrackGraphicsComment,
        myAccessibilityComment,
        myLengthPacingComment,
        myProgressionComment,
        myConsistencyComment,
        myOverworldComment,
        myEducationComment,
        myCustomComment,
        myPuzzleComment,
        myPolishComment,
        myBossComment
      } = annotation;
      
      // Validate inputs
      if (!gameid || typeof gameid !== 'string') {
        throw new Error('Invalid gameid');
      }
      
      if (myDifficultyRating !== null && myDifficultyRating !== undefined) {
        if (myDifficultyRating < 0 || myDifficultyRating > 5) {
          throw new Error('Difficulty rating must be 0-5');
        }
      }
      
      if (myReviewRating !== null && myReviewRating !== undefined) {
        if (myReviewRating < 0 || myReviewRating > 5) {
          throw new Error('Review rating must be 0-5');
        }
      }
      
      if (mySkillRating !== null && mySkillRating !== undefined) {
        if (mySkillRating < 0 || mySkillRating > 10) {
          throw new Error('Skill rating must be 0-10');
        }
      }
      
      if (mySkillRatingWhenBeat !== null && mySkillRatingWhenBeat !== undefined) {
        if (mySkillRatingWhenBeat < 0 || mySkillRatingWhenBeat > 10) {
          throw new Error('Skill rating when beat must be 0-10');
        }
      }
      
      // Validate star ratings (0-5)
      const starRatings = [
        { value: myRecommendationRating, name: 'Recommendation' },
        { value: myImportanceRating, name: 'Importance' },
        { value: myTechnicalQualityRating, name: 'Technical Quality' },
        { value: myGameplayDesignRating, name: 'Gameplay Design' },
        { value: myFairnessRating, name: 'Fairness' },
        { value: myChallengeQualityRating, name: 'Challenge Quality' },
        { value: myOriginalityRating, name: 'Originality' },
        { value: myVisualAestheticsRating, name: 'Visual Aesthetics' },
        { value: myStoryRating, name: 'Story' },
        { value: mySoundtrackGraphicsRating, name: 'Soundtrack Graphics' },
        { value: myAccessibilityRating, name: 'Accessibility' },
        { value: myLengthPacing, name: 'Length Pacing' },
        { value: myProgressionRating, name: 'Progression' },
        { value: myConsistencyRating, name: 'Consistency' },
        { value: myOverworldRating, name: 'Overworld' },
        { value: myEducationRating, name: 'Education' },
        { value: myCustomRating, name: 'Custom' },
        { value: myPuzzleRating, name: 'Puzzle' },
        { value: myPolishRating, name: 'Polish' },
        { value: myBossRating, name: 'Boss' }
      ];
      
      for (const rating of starRatings) {
        if (rating.value !== null && rating.value !== undefined) {
          if (rating.value < 0 || rating.value > 5) {
            throw new Error(`${rating.name} rating must be 0-5`);
          }
        }
      }
      
      // Log the values being saved for debugging
      console.log('[Save Annotation] Saving for gameid:', gameid);
      console.log('[Save Annotation] Ratings:', {
        myDifficultyRating,
        myReviewRating,
        mySkillRating,
        mySkillRatingWhenBeat,
        myRecommendationRating,
        myImportanceRating,
        myTechnicalQualityRating,
        myGameplayDesignRating,
        myFairnessRating,
        myChallengeQualityRating,
        myOriginalityRating,
        myVisualAestheticsRating,
        myStoryRating,
        mySoundtrackGraphicsRating,
        myAccessibilityRating,
        myLengthPacing,
        myProgressionRating,
        myConsistencyRating,
        myOverworldRating,
        myEducationRating,
        myCustomRating,
        myPuzzleRating,
        myPolishRating,
        myBossRating
      });
      
      const result = db.prepare(`
        INSERT OR REPLACE INTO user_game_annotations
          (gameid, status, user_difficulty_rating, user_review_rating, user_skill_rating, user_skill_rating_when_beat,
           user_recommendation_rating, user_importance_rating, user_technical_quality_rating,
           user_gameplay_design_rating, user_fairness_rating, user_challenge_quality_rating,
           user_originality_rating, user_visual_aesthetics_rating,
           user_story_rating, user_soundtrack_graphics_rating,
           user_accessibility_rating, user_length_pacing, user_progression_rating,
           user_consistency_rating, user_overworld_rating, user_education_rating,
           user_custom_rating, user_puzzle_rating, user_polish_rating, user_boss_rating,
           user_difficulty_comment, user_skill_comment, user_skill_comment_when_beat,
           user_review_comment, user_recommendation_comment, user_importance_comment,
           user_technical_quality_comment, user_gameplay_design_comment, user_fairness_comment,
           user_challenge_quality_comment, user_originality_comment,
           user_visual_aesthetics_comment, user_story_comment, user_soundtrack_graphics_comment,
           user_accessibility_comment, user_length_pacing_comment, user_progression_comment,
           user_consistency_comment, user_overworld_comment, user_education_comment,
           user_custom_comment, user_puzzle_comment, user_polish_comment, user_boss_comment,
           hidden, exclude_from_random, user_notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        gameid,
        status || 'Default',
        myDifficultyRating ?? null,
        myReviewRating ?? null,
        mySkillRating ?? null,
        mySkillRatingWhenBeat ?? null,
        myRecommendationRating ?? null,
        myImportanceRating ?? null,
        myTechnicalQualityRating ?? null,
        myGameplayDesignRating ?? null,
        myFairnessRating ?? null,
        myChallengeQualityRating ?? null,
        myOriginalityRating ?? null,
        myVisualAestheticsRating ?? null,
        myStoryRating ?? null,
        mySoundtrackGraphicsRating ?? null,
        myAccessibilityRating ?? null,
        myLengthPacing ?? null,
        myProgressionRating ?? null,
        myConsistencyRating ?? null,
        myOverworldRating ?? null,
        myEducationRating ?? null,
        myCustomRating ?? null,
        myPuzzleRating ?? null,
        myPolishRating ?? null,
        myBossRating ?? null,
        myDifficultyComment || null,
        mySkillComment || null,
        mySkillCommentWhenBeat || null,
        myReviewComment || null,
        myRecommendationComment || null,
        myImportanceComment || null,
        myTechnicalQualityComment || null,
        myGameplayDesignComment || null,
        myFairnessComment || null,
        myChallengeQualityComment || null,
        myOriginalityComment || null,
        myVisualAestheticsComment || null,
        myStoryComment || null,
        mySoundtrackGraphicsComment || null,
        myAccessibilityComment || null,
        myLengthPacingComment || null,
        myProgressionComment || null,
        myConsistencyComment || null,
        myOverworldComment || null,
        myEducationComment || null,
        myCustomComment || null,
        myPuzzleComment || null,
        myPolishComment || null,
        myBossComment || null,
        hidden ? 1 : 0,
        excludeFromRandom ? 1 : 0,
        mynotes || null
      );
      
      console.log('[Save Annotation] Database write result:', result);
      console.log('[Save Annotation] Changes:', result.changes);
      
      return { success: true };
    } catch (error) {
      console.error('Error saving annotation:', error);
      console.error('Error stack:', error.stack);
      return { success: false, error: error.message };
    }
  });
  /**
   * Save version-specific annotation
   * Channel: db:clientdata:set:version-annotation
   */
  ipcMain.handle('db:clientdata:set:version-annotation', async (event, annotation) => {
    try {
      const db = dbManager.getConnection('clientdata');
      
      const {
        gameid,
        version,
        status,
        myDifficultyRating,
        myReviewRating,
        mySkillRating,
        mySkillRatingWhenBeat,
        myRecommendationRating,
        myImportanceRating,
        myTechnicalQualityRating,
        myGameplayDesignRating,
        myFairnessRating,
        myChallengeQualityRating,
        myOriginalityRating,
        myVisualAestheticsRating,
        myStoryRating,
        mySoundtrackGraphicsRating,
        myAccessibilityRating,
        myLengthPacing,
        myProgressionRating,
        myConsistencyRating,
        myOverworldRating,
        myEducationRating,
        myCustomRating,
        myPuzzleRating,
        myPolishRating,
        myBossRating,
        myReviewComment,
        myRecommendationComment,
        myImportanceComment,
        myTechnicalQualityComment,
        myGameplayDesignComment,
        myFairnessComment,
        myChallengeQualityComment,
        myOriginalityComment,
        myVisualAestheticsComment,
        myStoryComment,
        mySoundtrackGraphicsComment,
        myAccessibilityComment,
        myLengthPacingComment,
        myProgressionComment,
        myConsistencyComment,
        myOverworldComment,
        myEducationComment,
        myCustomComment,
        myPuzzleComment,
        myPolishComment,
        myBossComment,
        mynotes
      } = annotation;
      
      if (!gameid || version === null || version === undefined) {
        throw new Error('Invalid gameid or version');
      }
      
      // Note: annotation_key column was removed in migration 027
      // The table now uses (gameid, version) as the primary key
      
      db.prepare(`
        INSERT OR REPLACE INTO user_game_version_annotations
          (gameid, version, status, 
           user_difficulty_rating, user_review_rating, user_skill_rating, user_skill_rating_when_beat,
           user_recommendation_rating, user_importance_rating, user_technical_quality_rating,
           user_gameplay_design_rating, user_fairness_rating, user_challenge_quality_rating,
           user_originality_rating, user_visual_aesthetics_rating,
           user_story_rating, user_soundtrack_graphics_rating,
           user_accessibility_rating, user_length_pacing, user_progression_rating,
           user_consistency_rating, user_overworld_rating, user_education_rating,
           user_custom_rating, user_puzzle_rating, user_polish_rating, user_boss_rating,
           user_review_comment, user_recommendation_comment, user_importance_comment,
           user_technical_quality_comment, user_gameplay_design_comment, user_fairness_comment,
           user_challenge_quality_comment, user_originality_comment,
           user_visual_aesthetics_comment, user_story_comment, user_soundtrack_graphics_comment,
           user_accessibility_comment, user_length_pacing_comment, user_progression_comment,
           user_consistency_comment, user_overworld_comment, user_education_comment,
           user_custom_comment, user_puzzle_comment, user_polish_comment, user_boss_comment,
           user_notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        gameid,
        version,
        status,
        myDifficultyRating,
        myReviewRating,
        mySkillRating,
        mySkillRatingWhenBeat,
        myRecommendationRating,
        myImportanceRating,
        myTechnicalQualityRating,
        myGameplayDesignRating,
        myFairnessRating,
        myChallengeQualityRating,
        myOriginalityRating,
        myVisualAestheticsRating,
        myStoryRating,
        mySoundtrackGraphicsRating,
        myAccessibilityRating ?? null,
        myLengthPacing ?? null,
        myProgressionRating ?? null,
        myConsistencyRating ?? null,
        myOverworldRating ?? null,
        myEducationRating ?? null,
        myCustomRating ?? null,
        myPuzzleRating ?? null,
        myPolishRating ?? null,
        myBossRating ?? null,
        myReviewComment || null,
        myRecommendationComment || null,
        myImportanceComment || null,
        myTechnicalQualityComment || null,
        myGameplayDesignComment || null,
        myFairnessComment || null,
        myChallengeQualityComment || null,
        myOriginalityComment || null,
        myVisualAestheticsComment || null,
        myStoryComment || null,
        mySoundtrackGraphicsComment || null,
        myAccessibilityComment || null,
        myLengthPacingComment || null,
        myProgressionComment || null,
        myConsistencyComment || null,
        myOverworldComment || null,
        myEducationComment || null,
        myCustomComment || null,
        myPuzzleComment || null,
        myPolishComment || null,
        myBossComment || null,
        mynotes || null
      );
      
      return { success: true };
    } catch (error) {
      console.error('Error saving version annotation:', error);
      return { success: false, error: error.message };
    }
  });

  // ===========================================================================
  // STAGE OPERATIONS (clientdata.db)
  // ===========================================================================

  /**
   * Get stages for a game with user annotations
   * Channel: db:clientdata:get:stages
   */
  ipcMain.handle('db:clientdata:get:stages', async (event, { gameid }) => {
    try {
      const db = dbManager.getConnection('clientdata');
      
      const stages = db.prepare(`
        SELECT 
          gs.stage_key as key,
          gs.gameid as parentId,
          gs.exit_number as exitNumber,
          gs.description,
          gs.public_rating as publicRating,
          usa.user_difficulty_rating as myDifficultyRating,
          usa.user_review_rating as myReviewRating,
          usa.user_skill_rating as mySkillRating,
          usa.user_notes as myNotes
        FROM game_stages gs
        LEFT JOIN user_stage_annotations usa ON gs.stage_key = usa.stage_key
        WHERE gs.gameid = ?
        ORDER BY gs.exit_number
      `).all(gameid);
      
      return stages;
    } catch (error) {
      console.error('Error getting stages:', error);
      return [];
    }
  });
  /**
   * Save stage annotation
   * Channel: db:clientdata:set:stage-annotation
   */
  ipcMain.handle('db:clientdata:set:stage-annotation', async (event, annotation) => {
    try {
      const db = dbManager.getConnection('clientdata');
      
      const {
        gameid,
        exitNumber,
        myDifficultyRating,
        myReviewRating,
        mySkillRating,
        myNotes
      } = annotation;
      
      if (!gameid || !exitNumber) {
        throw new Error('Invalid gameid or exitNumber');
      }
      
      const stageKey = `${gameid}-${exitNumber}`;
      
      db.prepare(`
        INSERT OR REPLACE INTO user_stage_annotations
          (stage_key, gameid, exit_number, user_difficulty_rating, 
           user_review_rating, user_skill_rating, user_notes)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        stageKey,
        gameid,
        exitNumber,
        myDifficultyRating,
        myReviewRating,
        mySkillRating,
        myNotes
      );
      
      return { success: true };
    } catch (error) {
      console.error('Error saving stage annotation:', error);
      return { success: false, error: error.message };
    }
  });
  /**
   * Bulk save stage annotations
   * Channel: db:clientdata:set:stage-annotations-bulk
   */
  ipcMain.handle('db:clientdata:set:stage-annotations-bulk', async (event, { annotations }) => {
    try {
      const db = dbManager.getConnection('clientdata');
      
      const transaction = db.transaction((annotationList) => {
        const stmt = db.prepare(`
          INSERT OR REPLACE INTO user_stage_annotations
            (stage_key, gameid, exit_number, user_difficulty_rating, 
             user_review_rating, user_skill_rating, user_notes)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        
        for (const ann of annotationList) {
          const stageKey = `${ann.gameid}-${ann.exitNumber}`;
          stmt.run(
            stageKey,
            ann.gameid,
            ann.exitNumber,
            ann.myDifficultyRating,
            ann.myReviewRating,
            ann.mySkillRating,
            ann.myNotes
          );
        }
      });
      
      transaction(annotations);
      
      return { success: true };
    } catch (error) {
      console.error('Error saving stage annotations:', error);
      return { success: false, error: error.message };
    }
  });

  // ===========================================================================
  // SETTINGS OPERATIONS (clientdata.db csettings table)
  // ===========================================================================

  /**
   * Get all settings
   * Channel: db:settings:get:all
   */
  ipcMain.handle('db:settings:get:all', async () => {
    try {
      const db = dbManager.getConnection('clientdata');
      
      const rows = db.prepare(`
        SELECT csetting_name, csetting_value
        FROM csettings
      `).all();
      
      // Convert to object
      const settings = {};
      rows.forEach(row => {
        settings[row.csetting_name] = row.csetting_value;
      });
      
      return settings;
    } catch (error) {
      console.error('Error getting settings:', error);
      return {};
    }
  });

  /**
   * Get a single client setting value
   * Channel: db:settings:get:value
   * Note: require_reauth defaults to '1' if not set
   */
  ipcMain.handle('db:settings:get:value', async (event, { name }) => {
    try {
      const db = dbManager.getConnection('clientdata');
      
      const row = db.prepare(`
        SELECT csetting_value
        FROM csettings
        WHERE csetting_name = ?
      `).get(name);
      
      let value = row ? row.csetting_value : null;
      
      // Default require_reauth to '1' if not set
      if (name === 'require_reauth' && value === null) {
        value = '1';
      }
      
      return { success: true, value: value };
    } catch (error) {
      console.error('[db:settings:get:value] Error:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Set a single setting
   * Channel: db:settings:set:value
   */
  ipcMain.handle('db:settings:set:value', async (event, { name, value }) => {
    try {
      const db = dbManager.getConnection('clientdata');
      
      const uuid = crypto.randomUUID();
      
      db.prepare(`
        INSERT INTO csettings (csettinguid, csetting_name, csetting_value)
        VALUES (?, ?, ?)
        ON CONFLICT(csetting_name) DO UPDATE SET csetting_value = excluded.csetting_value
      `).run(uuid, name, value);
      
      return { success: true };
    } catch (error) {
      console.error('Error setting value:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Save multiple settings at once
   * Channel: db:settings:set:bulk
   */
  ipcMain.handle('db:settings:set:bulk', async (event, { settings }) => {
    try {
      const db = dbManager.getConnection('clientdata');
      
      const transaction = db.transaction((settingsObj) => {
        const stmt = db.prepare(`
          INSERT INTO csettings (csettinguid, csetting_name, csetting_value)
          VALUES (?, ?, ?)
          ON CONFLICT(csetting_name) DO UPDATE SET csetting_value = excluded.csetting_value
        `);
        
        Object.entries(settingsObj).forEach(([name, value]) => {
          const uuid = crypto.randomUUID();
          stmt.run(uuid, name, String(value));
        });
      });
      
      transaction(settings);
      
      return { success: true };
    } catch (error) {
      console.error('Error saving settings:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('rhpak:configure-association', async (_event, { enabled = true } = {}) => {
    try {
      if (!enabled) {
        const result = await removeRhpakAssociation();
        if (result.success) {
          setClientSetting(RHPAK_ENABLED_SETTING, 'false');
          setClientSetting(RHPAK_HASH_SETTING, '');
        }
        return result;
      }

      const exePath = process.execPath;
      const exeHash = crypto.createHash('sha256').update(exePath).digest('hex');
      const storedHash = getClientSetting(RHPAK_HASH_SETTING);
      if (storedHash && storedHash === exeHash) {
        setClientSetting(RHPAK_ENABLED_SETTING, 'true');
        return { success: true, skipped: true };
      }

      const result = await ensureRhpakAssociation(exePath);
      if (result.success) {
        setClientSetting(RHPAK_ENABLED_SETTING, 'true');
        setClientSetting(RHPAK_HASH_SETTING, exeHash);
      }
      return result;
    } catch (error) {
      console.error('[rhpak:configure-association] Failed:', error);
      return { success: false, error: error.message };
    }
  });

  // ===========================================================================
  // RUN SYSTEM OPERATIONS (clientdata.db)
  // ===========================================================================

  /**
   * Create a new run
   * Channel: db:runs:create
   */
  ipcMain.handle('db:runs:create', async (event, { runName, runDescription, globalConditions, globalPatchCodes }) => {
    try {
      const db = dbManager.getConnection('clientdata');
      const runUuid = crypto.randomUUID();
      
      // Store global patch codes in config_json field
      const configJson = {
        globalPatchCodes: globalPatchCodes || []
      };
      
      db.prepare(`
        INSERT INTO runs (run_uuid, run_name, run_description, status, global_conditions, config_json)
        VALUES (?, ?, ?, 'preparing', ?, ?)
      `).run(
        runUuid, 
        runName, 
        runDescription, 
        JSON.stringify(globalConditions || []),
        JSON.stringify(configJson)
      );
      
      return { success: true, runUuid };
    } catch (error) {
      console.error('Error creating run:', error);
      return { success: false, error: error.message };
    }
  });
  /**
   * Save run plan entries
   * Channel: db:runs:save-plan
   */
  ipcMain.handle('db:runs:save-plan', async (event, { runUuid, entries, winRulesJson }) => {
    try {
      console.log(`[db:runs:save-plan] Called with runUuid: ${runUuid}, entries: ${entries?.length || 0}, winRulesJson: ${winRulesJson ? 'present' : 'null'}`);
      const db = dbManager.getConnection('clientdata');
      
      // CRITICAL: ALWAYS save winRulesJson if provided, even if it's an empty string or "null"
      // This ensures win rules are persisted when saving the run plan
      if (winRulesJson !== undefined && winRulesJson !== null && winRulesJson !== '') {
        const nowMs = Date.now();
        const updateStmt = db.prepare(`
          UPDATE runs 
          SET win_rules_json = ?,
              updated_at = CURRENT_TIMESTAMP,
              updated_at_ms = ?
          WHERE run_uuid = ?
        `);
        const updateResult = updateStmt.run(winRulesJson, nowMs, runUuid);
        console.log(`[db:runs:save-plan] Updated win_rules_json for run ${runUuid}, changes: ${updateResult.changes}`);
        
        // Verify the update worked
        const verify = db.prepare('SELECT win_rules_json FROM runs WHERE run_uuid = ?').get(runUuid);
        if (verify && verify.win_rules_json) {
          console.log(`[db:runs:save-plan] ✓ Verification SUCCESS - win_rules_json saved to DB`);
          try {
            const parsed = JSON.parse(verify.win_rules_json);
            console.log(`[db:runs:save-plan] Parsed win rules - challengeTime enabled: ${parsed?.challengeTime?.enabled}, runTimeLimit enabled: ${parsed?.runTimeLimit?.enabled}`);
          } catch (e) {
            console.warn(`[db:runs:save-plan] Could not parse win_rules_json for verification`);
          }
        } else {
          console.error(`[db:runs:save-plan] ✗ Verification FAILED - win_rules_json NOT found in DB after update!`);
        }
      } else {
        console.log(`[db:runs:save-plan] No winRulesJson provided, skipping win rules update`);
      }
      
      const transaction = db.transaction((runId, entryList) => {
        // Clear existing entries
        db.prepare(`DELETE FROM run_plan_entries WHERE run_uuid = ?`).run(runId);
        
        // Insert new entries
        const stmt = db.prepare(`
          INSERT INTO run_plan_entries
            (entry_uuid, run_uuid, sequence_number, entry_type, gameid, exit_number,
             count, filter_difficulty, filter_type, filter_pattern, filter_seed, conditions,
             trans_level, stage_filter_min_difficulty, stage_filter_max_difficulty,
             stage_filter_include_flags, stage_filter_exclude_flags,
             stage_filter_include_any_of_flags, stage_filter_exclude_only_flags,
             stage_filter_has_tags, stage_filter_exclude_tags,
             game_filter_min_difficulty, game_filter_max_difficulty)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        
        entryList.forEach((entry, idx) => {
          const entryUuid = crypto.randomUUID();
          stmt.run(
            entryUuid,
            runId,
            idx + 1,
            entry.entryType,
            entry.id !== '(random)' ? entry.id : null,
            entry.stageNumber || null,
            entry.count || 1,
            entry.filterDifficulty || null,
            entry.filterType || null,
            entry.filterPattern || null,
            entry.seed || null,
            JSON.stringify(entry.conditions || []),
            entry.transLevel || null,
            entry.stageFilterMinDifficulty !== undefined ? entry.stageFilterMinDifficulty : null,
            entry.stageFilterMaxDifficulty !== undefined ? entry.stageFilterMaxDifficulty : null,
            entry.stageFilterIncludeFlags && Array.isArray(entry.stageFilterIncludeFlags) ? JSON.stringify(entry.stageFilterIncludeFlags) : null,
            entry.stageFilterExcludeFlags && Array.isArray(entry.stageFilterExcludeFlags) ? JSON.stringify(entry.stageFilterExcludeFlags) : null,
            entry.stageFilterIncludeAnyOfFlags && Array.isArray(entry.stageFilterIncludeAnyOfFlags) ? JSON.stringify(entry.stageFilterIncludeAnyOfFlags) : null,
            entry.stageFilterExcludeOnlyFlags && Array.isArray(entry.stageFilterExcludeOnlyFlags) ? JSON.stringify(entry.stageFilterExcludeOnlyFlags) : null,
            entry.stageFilterHasTags && Array.isArray(entry.stageFilterHasTags) ? JSON.stringify(entry.stageFilterHasTags) : null,
            entry.stageFilterExcludeTags && Array.isArray(entry.stageFilterExcludeTags) ? JSON.stringify(entry.stageFilterExcludeTags) : null,
            entry.gameFilterMinDifficulty !== undefined ? entry.gameFilterMinDifficulty : null,
            entry.gameFilterMaxDifficulty !== undefined ? entry.gameFilterMaxDifficulty : null
          );
        });
      });
      
      transaction(runUuid, entries);
      
      // Generate runview.html
      try {
        const userDataPath = app.getPath('userData');
        await generateRunview({ dbManager, runUuid, userDataPath });
      } catch (error) {
        console.warn('[runview] Failed to generate after save-plan:', error);
      }
      
      return { success: true };
    } catch (error) {
      console.error('Error saving run plan:', error);
      return { success: false, error: error.message };
    }
  });
  /**
   * Start a run (change status to active, expand plan to results)
   * Channel: db:runs:start
   */
  ipcMain.handle('db:runs:start', async (event, { runUuid }) => {
    try {
      const db = dbManager.getConnection('clientdata');
      
      // Check if run_results exist (from staging)
      const resultsCount = db.prepare(`SELECT COUNT(*) as count FROM run_results WHERE run_uuid = ?`).get(runUuid);
      
      if (!resultsCount || resultsCount.count === 0) {
        return { success: false, error: 'Run has not been staged yet. Please save and stage the run first.' };
      }
      
      const transaction = db.transaction((runId) => {
        // Cancel any other active runs (only one run can be active at a time)
        db.prepare(`
          UPDATE runs 
          SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
          WHERE status = 'active' AND run_uuid != ?
        `).run(runId);
        
        // Update run status to active (run_results already exist from staging)
        // IMPORTANT: Only set started_at if it's NULL (first start)
        // If resuming, preserve the original started_at timestamp
        // started_at represents the exact wall-clock time the run started and must NEVER be modified
        db.prepare(`
          UPDATE runs 
          SET status = 'active', 
              started_at = COALESCE(started_at, CURRENT_TIMESTAMP),
              started_at_ms = COALESCE(started_at_ms, CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)),
              updated_at = CURRENT_TIMESTAMP,
              updated_at_ms = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
          WHERE run_uuid = ?
        `).run(runId);
        
        // run_results were already created during staging, just set timestamps for FIRST challenge only
        // According to RUN_TIMING_REVIEW.md, only the first challenge gets started_at/started_at_ms when run starts
        // Subsequent challenges will get started_at/started_at_ms when they actually begin (when previous completes)
        // Use millisecond precision
        const nowMs = Date.now();
        
        // Get win rules to set initial rollover for first challenge
        // Always set rollover when challengeTime is enabled (even if 0)
        const runData = db.prepare(`SELECT win_rules_json FROM runs WHERE run_uuid = ?`).get(runId);
        let winRules = null;
        let initialRolloverMs = null;
        if (runData && runData.win_rules_json) {
          try {
            winRules = JSON.parse(runData.win_rules_json);
            if (winRules && winRules.challengeTime && winRules.challengeTime.enabled) {
              // Always set rollover (0 or starting value) when challengeTime is enabled
              initialRolloverMs = (winRules.challengeTime.rolloverStartMinutes || 0) * 60 * 1000;
            }
          } catch (e) {
            console.warn('[start-run] Failed to parse win rules:', e);
          }
        }
        
        // Get the first pending challenge (lowest sequence_number)
        const firstPending = db.prepare(`
          SELECT result_uuid FROM run_results
          WHERE run_uuid = ? AND status = 'pending'
          ORDER BY sequence_number
          LIMIT 1
        `).get(runId);
        
        if (firstPending) {
          // Only set started_at and started_at_ms for the first pending challenge
          // All other challenges remain NULL until they actually start
          // Also set initial rollover time if win rules are enabled
          db.prepare(`
            UPDATE run_results
            SET started_at = CURRENT_TIMESTAMP,
                started_at_ms = ?,
                rollover_time_remaining_start_ms = ?
            WHERE result_uuid = ?
          `).run(nowMs, initialRolloverMs, firstPending.result_uuid);
        }
        
        // Update total challenges count (should already be set, but update to be sure)
        const total = db.prepare(`SELECT COUNT(*) as count FROM run_results WHERE run_uuid = ?`).get(runId);
        db.prepare(`UPDATE runs SET total_challenges = ? WHERE run_uuid = ?`).run(total.count, runId);
        
        console.log(`Started run with ${total.count} challenges`);
      });
      
      try {
        transaction(runUuid);
        console.log('Transaction completed successfully');
      } catch (transactionError) {
        console.error('Transaction failed:', transactionError);
        throw transactionError;
      }
      
      // Verify results were inserted
      const verifyCount = db.prepare(`SELECT COUNT(*) as count FROM run_results WHERE run_uuid = ?`).get(runUuid);
      console.log('Verification: run_results count =', verifyCount.count);
      
      if (verifyCount.count === 0) {
        throw new Error('Failed to create run results - no entries inserted');
      }
      
      // Asynchronously validate clock accuracy (non-blocking, doesn't delay run start)
      // This runs in the background and updates the run record when complete
      fetchNetworkTime().then((timeResult) => {
        try {
          if (timeResult.success) {
            const validityStatus = determineRunValidity(timeResult.offsetMs);
            const networkTimeMs = Math.floor(timeResult.networkTime);
            
            console.log(`[Network Time] Clock offset: ${timeResult.offsetMs}ms (${(timeResult.offsetMs / 1000).toFixed(1)}s), Status: ${validityStatus}`);
            
            // Update run with network time validation results
            db.prepare(`
              UPDATE runs
              SET clock_offset_ms = ?,
                  clock_validated = 1,
                  network_time_ms = ?,
                  run_validity_status = ?,
                  updated_at_ms = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
              WHERE run_uuid = ?
            `).run(
              Math.round(timeResult.offsetMs),
              networkTimeMs,
              validityStatus,
              runUuid
            );
          } else {
            console.warn(`[Network Time] Failed to validate clock: ${timeResult.error}`);
            
            // Mark as unverified if network time fetch failed
            db.prepare(`
              UPDATE runs
              SET clock_validated = 0,
                  run_validity_status = 'unverified',
                  updated_at_ms = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
              WHERE run_uuid = ?
            `).run(runUuid);
          }
        } catch (updateError) {
          console.error('[Network Time] Error updating run with clock validation:', updateError);
          // Non-fatal error, continue
        }
      }).catch((error) => {
        console.error('[Network Time] Error in clock validation promise:', error);
        // Non-fatal error, continue
      });
      
      // Generate runview.html
      try {
        const userDataPath = app.getPath('userData');
        await generateRunview({ dbManager, runUuid, userDataPath });
      } catch (error) {
        console.warn('[runview] Failed to generate after start:', error);
      }
      
      return { success: true };
    } catch (error) {
      console.error('Error starting run:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Record challenge result
   * Channel: db:runs:record-result
   */
  ipcMain.handle('db:runs:record-result', async (event, { runUuid, challengeIndex, status }) => {
    try {
      const db = dbManager.getConnection('clientdata');
      
      // Get the result at this index, including current status
      const result = db.prepare(`
        SELECT result_uuid, status as old_status, sequence_number FROM run_results 
        WHERE run_uuid = ? 
        ORDER BY sequence_number 
        LIMIT 1 OFFSET ?
      `).get(runUuid, challengeIndex);
      
      if (!result) {
        throw new Error('Challenge not found');
      }
      
      const oldStatus = result.old_status || 'pending';
      
      // Get pause information for this challenge
      const challenge = db.prepare(`
        SELECT pause_seconds, pause_milliseconds, started_at, started_at_ms FROM run_results WHERE result_uuid = ?
      `).get(result.result_uuid);
      
      // Use pause_milliseconds if available, otherwise fall back to pause_seconds * 1000
      const pauseMilliseconds = challenge?.pause_milliseconds ?? ((challenge?.pause_seconds || 0) * 1000);
      const pauseSeconds = Math.floor(pauseMilliseconds / 1000);
      
      // Calculate duration: (completed_at - started_at - pause_milliseconds)
      // Use millisecond precision if available
      let durationSeconds;
      let durationMilliseconds;
      const nowMs = Date.now();
      
      if (challenge?.started_at_ms) {
        // Use millisecond precision
        durationMilliseconds = nowMs - challenge.started_at_ms - pauseMilliseconds;
        durationSeconds = Math.floor(durationMilliseconds / 1000);
      } else if (challenge?.started_at) {
        // Fall back to second precision - convert SQLite timestamp to milliseconds
        const startedAtMs = new Date(challenge.started_at).getTime();
        durationMilliseconds = nowMs - startedAtMs - pauseMilliseconds;
        durationSeconds = Math.floor(durationMilliseconds / 1000);
      } else {
        // No start time - should not happen, but set to 0
        durationSeconds = 0;
        durationMilliseconds = 0;
      }
      
      // Get win rules from run
      const run = db.prepare(`SELECT win_rules_json FROM runs WHERE run_uuid = ?`).get(runUuid);
      let winRules = null;
      if (run && run.win_rules_json) {
        try {
          winRules = JSON.parse(run.win_rules_json);
        } catch (e) {
          console.warn('[record-result] Failed to parse win rules:', e);
        }
      }
      
      // Calculate win rule tracking values (rollover, allocated time, grace time)
      let rolloverTimeRemainingStartMs = null;
      let rolloverTimeRemainingEndMs = null;
      let allocatedTimeMs = null;
      let graceTimeMs = null;
      
      if (winRules && winRules.challengeTime && winRules.challengeTime.enabled) {
        const challengeTime = winRules.challengeTime;
        const limitMinutes = challengeTime.minutes || 10;
        const limitMs = limitMinutes * 60 * 1000;
        
        // Calculate grace time (1% of limit, min 2s, max 60s)
        const gracePercent = challengeTime.gracePeriodPercent || 1.0;
        const graceMinSeconds = challengeTime.gracePeriodMinSeconds || 2;
        const graceMaxSeconds = challengeTime.gracePeriodMaxSeconds || 60;
        const graceSeconds = Math.max(graceMinSeconds, Math.min(graceMaxSeconds, limitMinutes * 60 * gracePercent / 100));
        graceTimeMs = graceSeconds * 1000;
        
        // Get rollover time remaining at start of this challenge
        // For first challenge, use starting rollover; for subsequent challenges, use previous challenge's end rollover
        let rolloverAtStart = 0;
        if (result.sequence_number === 1) {
          // First challenge: use starting rollover
          rolloverAtStart = (challengeTime.rolloverStartMinutes || 0) * 60 * 1000;
        } else {
          // Get previous challenge's rollover_time_remaining_end_ms
          const previousChallenge = db.prepare(`
            SELECT rollover_time_remaining_end_ms FROM run_results
            WHERE run_uuid = ? AND sequence_number = ?
          `).get(runUuid, result.sequence_number - 1);
          
          if (previousChallenge && previousChallenge.rollover_time_remaining_end_ms !== null) {
            rolloverAtStart = previousChallenge.rollover_time_remaining_end_ms;
          } else {
            // Previous challenge didn't have rollover tracking, use starting rollover
            rolloverAtStart = (challengeTime.rolloverStartMinutes || 0) * 60 * 1000;
          }
        }
        
        rolloverTimeRemainingStartMs = rolloverAtStart;
        
        // Calculate allocated time (limit + rollover at start)
        allocatedTimeMs = limitMs + rolloverAtStart;
        
        // If challenge is being completed (not reset to pending), calculate rollover at end
        if (status !== 'pending' && challenge?.started_at_ms) {
          // Calculate if challenge was completed early or late
          const timeSpent = durationMilliseconds;
          const timeOverLimit = timeSpent - limitMs;
          
          // Calculate rollover at end
          let rolloverAtEnd = rolloverAtStart;
          const maxRolloverMs = (challengeTime.rolloverMaxMinutes || 0) * 60 * 1000;
          
          if (timeOverLimit < 0) {
            // Completed early - add to rollover (up to max)
            const earlyBy = -timeOverLimit;
            rolloverAtEnd = Math.min(maxRolloverMs, rolloverAtStart + earlyBy);
          } else if (timeOverLimit <= graceTimeMs) {
            // Completed on time or slightly late within grace period - no change to rollover (grace time doesn't add to rollover)
            rolloverAtEnd = rolloverAtStart;
          } else {
            // Completed late (beyond grace) - deduct from rollover
            const lateBy = timeOverLimit - graceTimeMs; // Grace period doesn't count against rollover
            rolloverAtEnd = Math.max(0, rolloverAtStart - lateBy);
          }
          
          rolloverTimeRemainingEndMs = rolloverAtEnd;
        }
      }
      
      // If resetting to 'pending', clear timestamps and duration (but don't calculate duration)
      // Otherwise, calculate and set completion timestamp and duration
      if (status === 'pending') {
        // Reset to pending: clear completion data but keep started_at if it exists
        db.prepare(`
          UPDATE run_results
          SET status = ?,
              completed_at = NULL,
              completed_at_ms = NULL,
              duration_seconds = NULL,
              duration_milliseconds = NULL,
              rollover_time_remaining_start_ms = NULL,
              rollover_time_remaining_end_ms = NULL,
              allocated_time_ms = NULL,
              grace_time_ms = NULL
          WHERE result_uuid = ?
        `).run(status, result.result_uuid);
      } else {
        // Ensure non-negative duration
        durationMilliseconds = Math.max(0, durationMilliseconds);
        durationSeconds = Math.max(0, durationSeconds);
        
        // Update result with completion timestamp, duration, and win rule tracking
        db.prepare(`
          UPDATE run_results
          SET status = ?,
              completed_at = CURRENT_TIMESTAMP,
              completed_at_ms = ?,
              duration_seconds = ?,
              duration_milliseconds = ?,
              rollover_time_remaining_start_ms = ?,
              rollover_time_remaining_end_ms = ?,
              allocated_time_ms = ?,
              grace_time_ms = ?
          WHERE result_uuid = ?
        `).run(
          status, 
          nowMs, 
          durationSeconds, 
          durationMilliseconds,
          rolloverTimeRemainingStartMs,
          rolloverTimeRemainingEndMs,
          allocatedTimeMs,
          graceTimeMs,
          result.result_uuid
        );
        
        // When a challenge completes (status changes to success/ok/skipped/failed),
        // the NEXT pending challenge should start.
        // Set its started_at_ms to NOW (when this challenge completed).
        // This ensures each challenge's timer starts when it actually begins.
        // According to RUN_TIMING_REVIEW.md, each challenge's started_at_ms should be
        // the exact time when that challenge actually started.
        if ((status === 'success' || status === 'ok' || status === 'skipped' || status === 'failed') && 
            oldStatus !== status) {
          const nextChallenge = db.prepare(`
            SELECT result_uuid, sequence_number FROM run_results
            WHERE run_uuid = ? 
            AND sequence_number > (
              SELECT sequence_number FROM run_results WHERE result_uuid = ?
            )
            AND status = 'pending'
            ORDER BY sequence_number
            LIMIT 1
          `).get(runUuid, result.result_uuid);
          
          if (nextChallenge) {
            // Set the next challenge's start time to now (when previous challenge completed)
            // Also set initial rollover time for the next challenge (always set when challengeTime is enabled, even if 0)
            let nextRolloverStart = null;
            if (winRules && winRules.challengeTime && winRules.challengeTime.enabled) {
              nextRolloverStart = rolloverTimeRemainingEndMs !== null ? rolloverTimeRemainingEndMs : 0;
            }
            
            db.prepare(`
              UPDATE run_results
              SET started_at = CURRENT_TIMESTAMP,
                  started_at_ms = ?,
                  rollover_time_remaining_start_ms = ?
              WHERE result_uuid = ?
            `).run(nowMs, nextRolloverStart, nextChallenge.result_uuid);
          }
        }
      }
      
      // Update run counts based on status change
      // Only update if the status actually changed
      if (oldStatus !== status) {
        // Decrement old status counts if they were completed/skipped
        if (oldStatus === 'success' || oldStatus === 'ok') {
          db.prepare(`
            UPDATE runs 
            SET completed_challenges = MAX(0, completed_challenges - 1),
                updated_at = CURRENT_TIMESTAMP
            WHERE run_uuid = ?
          `).run(runUuid);
        } else if (oldStatus === 'skipped') {
          db.prepare(`
            UPDATE runs 
            SET skipped_challenges = MAX(0, skipped_challenges - 1),
                updated_at = CURRENT_TIMESTAMP
            WHERE run_uuid = ?
          `).run(runUuid);
        }
        
        // Increment new status counts if they are completed/skipped
        if (status === 'success' || status === 'ok') {
          db.prepare(`
            UPDATE runs 
            SET completed_challenges = completed_challenges + 1,
                updated_at = CURRENT_TIMESTAMP
            WHERE run_uuid = ?
          `).run(runUuid);
        } else if (status === 'skipped') {
          db.prepare(`
            UPDATE runs 
            SET skipped_challenges = skipped_challenges + 1,
                updated_at = CURRENT_TIMESTAMP
            WHERE run_uuid = ?
          `).run(runUuid);
        }
      }
      
      // Generate runview.html
      try {
        const userDataPath = app.getPath('userData');
        await generateRunview({ dbManager, runUuid, userDataPath });
      } catch (error) {
        console.warn('[runview] Failed to generate after record-result:', error);
      }
      
      return { success: true };
    } catch (error) {
      console.error('Error recording challenge result:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Generate runview.html file
   * Channel: db:runs:generate-runview
   */
  ipcMain.handle('db:runs:generate-runview', async (event, { runUuid }) => {
    try {
      const userDataPath = app.getPath('userData');
      const result = await generateRunview({ dbManager, runUuid, userDataPath });
      return result;
    } catch (error) {
      console.error('[generate-runview] Error:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Undo a challenge (transfer time to previous challenge and reset timestamps)
   * Channel: db:runs:undo-challenge
   */
  ipcMain.handle('db:runs:undo-challenge', async (event, { runUuid, challengeIndex }) => {
    try {
      const db = dbManager.getConnection('clientdata');
      
      // Get all results for this run, ordered by sequence
      const allResults = db.prepare(`
        SELECT result_uuid, sequence_number, status, 
               pause_seconds, pause_milliseconds,
               started_at, started_at_ms, completed_at, completed_at_ms,
               duration_seconds, duration_milliseconds
        FROM run_results 
        WHERE run_uuid = ? 
        ORDER BY sequence_number
      `).all(runUuid);
      
      if (challengeIndex >= allResults.length || challengeIndex < 0) {
        throw new Error('Challenge index out of range');
      }
      
      const undoneChallenge = allResults[challengeIndex];
      if (!undoneChallenge) {
        throw new Error('Challenge not found');
      }
      
      // CRITICAL RULES - MUST NEVER VIOLATE:
      // challengeIndex = the challenge BEFORE the active one (N-1) - we clear its completed_at
      // challengeIndex + 1 = the ACTIVE challenge (N) - we MUST clear its started_at_ms
      // The highest sequence_number with no completed time shall ALWAYS be the active challenge
      
      // Step 1: Clear the completed time of challengeIndex (N-1) and make it active
      // CRITICAL: We MUST preserve started_at and started_at_ms of challengeIndex (N-1)
      // It will continue timing from its original start time
      // Clear completed_at and completed_at_ms, but KEEP started_at_ms
      // Clear duration so it will be recalculated dynamically from started_at_ms
      const oldStatus = undoneChallenge.status;
      
      db.prepare(`
        UPDATE run_results
        SET status = 'pending',
            completed_at = NULL,
            completed_at_ms = NULL,
            duration_seconds = NULL,
            duration_milliseconds = NULL
            -- started_at and started_at_ms are NOT in the SET clause - they remain unchanged
            -- pause_milliseconds and pause_seconds are NOT in the SET clause - they remain unchanged
        WHERE result_uuid = ?
      `).run(undoneChallenge.result_uuid);
      
      // Step 2: Clear the start time of the ACTIVE challenge (challengeIndex + 1)
      // The challenge that was active when Undo was pressed MUST have its started_at_ms cleared
      const activeChallengeIndex = challengeIndex + 1;
      if (activeChallengeIndex < allResults.length) {
        const activeChallenge = allResults[activeChallengeIndex];
        if (activeChallenge) {
          db.prepare(`
            UPDATE run_results
            SET started_at = NULL,
                started_at_ms = NULL
            WHERE result_uuid = ?
          `).run(activeChallenge.result_uuid);
        }
      }
      
      // Step 3: Clear started_at_ms of ALL pending challenges AFTER the active one
      // The highest sequence_number with no completed time shall ALWAYS be the active challenge
      // So any challenges after challengeIndex + 1 that are pending should have no started_at_ms
      for (let i = activeChallengeIndex + 1; i < allResults.length; i++) {
        const laterChallenge = allResults[i];
        if (laterChallenge && !laterChallenge.completed_at_ms && laterChallenge.started_at_ms) {
          // This challenge is pending but has a started_at_ms - clear it
          db.prepare(`
            UPDATE run_results
            SET started_at = NULL,
                started_at_ms = NULL
            WHERE result_uuid = ?
          `).run(laterChallenge.result_uuid);
        }
      }
      
      // Step 4: NEVER touch challenges before challengeIndex (challengeIndex - 1 or earlier)
      // Their started_at_ms, completed_at, etc. remain completely unchanged
      
      // Update run counts (decrement completed/skipped counts if applicable)
      if (oldStatus === 'success' || oldStatus === 'ok') {
        db.prepare(`
          UPDATE runs 
          SET completed_challenges = MAX(0, completed_challenges - 1),
              updated_at = CURRENT_TIMESTAMP,
              updated_at_ms = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
          WHERE run_uuid = ?
        `).run(runUuid);
      } else if (oldStatus === 'skipped') {
        db.prepare(`
          UPDATE runs 
          SET skipped_challenges = MAX(0, skipped_challenges - 1),
              updated_at = CURRENT_TIMESTAMP,
              updated_at_ms = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
          WHERE run_uuid = ?
        `).run(runUuid);
      }
      
      // Generate runview.html
      try {
        const userDataPath = app.getPath('userData');
        await generateRunview({ dbManager, runUuid, userDataPath });
      } catch (error) {
        console.warn('[runview] Failed to generate after undo-challenge:', error);
      }
      
      return { 
        success: true
      };
    } catch (error) {
      console.error('Error undoing challenge:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Repair challenge start time (fix corrupted data)
   * Channel: db:runs:repair-challenge-start-time
   * CRITICAL: Only repairs the specified challenge - NEVER touches challenges after it
   */
  ipcMain.handle('db:runs:repair-challenge-start-time', async (event, { runUuid, resultUuid, startedAtMs, sequenceNumber }) => {
    try {
      const db = dbManager.getConnection('clientdata');
      
      // Verify the result belongs to this run
      const result = db.prepare(`
        SELECT result_uuid, run_uuid, sequence_number, status, started_at_ms, completed_at_ms
        FROM run_results
        WHERE result_uuid = ? AND run_uuid = ?
      `).get(resultUuid, runUuid);
      
      if (!result) {
        throw new Error('Challenge not found or does not belong to this run');
      }
      
      // Verify sequence number matches (additional safety check)
      if (sequenceNumber !== undefined && result.sequence_number !== sequenceNumber) {
        throw new Error(`Sequence number mismatch: expected ${sequenceNumber}, got ${result.sequence_number}`);
      }
      
      // Verify this challenge should have a start time:
      // 1. It should not be completed
      // 2. It should not already have a start time
      if (result.completed_at_ms) {
        throw new Error(`Cannot repair: challenge ${result.sequence_number} is already completed`);
      }
      
      if (result.started_at_ms) {
        console.log(`[repair-challenge-start-time] Challenge ${result.sequence_number} already has started_at_ms, no repair needed`);
        return { success: true, repaired: false };
      }
      
      // CRITICAL: Verify that no challenges AFTER this one have started_at_ms
      // If they do, this repair might be incorrect
      const laterChallenges = db.prepare(`
        SELECT sequence_number, started_at_ms, completed_at_ms
        FROM run_results
        WHERE run_uuid = ? AND sequence_number > ? AND started_at_ms IS NOT NULL
        ORDER BY sequence_number
        LIMIT 1
      `).get(runUuid, result.sequence_number);
      
      if (laterChallenges) {
        console.warn(`[repair-challenge-start-time] WARNING: Challenge ${result.sequence_number} comes before challenge ${laterChallenges.sequence_number} which already has started_at_ms. This may indicate incorrect active challenge detection.`);
        // Continue anyway - the frontend determined this is the active challenge
      }
      
      // Set the start time - ONLY for this specific challenge
      const startedAt = new Date(startedAtMs).toISOString().replace('T', ' ').substring(0, 19);
      db.prepare(`
        UPDATE run_results
        SET started_at = ?,
            started_at_ms = ?
        WHERE result_uuid = ?
      `).run(startedAt, startedAtMs, resultUuid);
      
      console.log(`[repair-challenge-start-time] Repaired started_at_ms for challenge ${result.sequence_number} (result_uuid: ${resultUuid}): ${startedAtMs}`);
      
      return { success: true, repaired: true, sequenceNumber: result.sequence_number };
    } catch (error) {
      console.error('Error repairing challenge start time:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Clear challenge start time (remove incorrect start time from challenges that haven't been reached)
   * Channel: db:runs:clear-challenge-start-time
   */
  ipcMain.handle('db:runs:clear-challenge-start-time', async (event, { runUuid, resultUuid }) => {
    try {
      const db = dbManager.getConnection('clientdata');
      
      // Verify the result belongs to this run
      const result = db.prepare(`
        SELECT result_uuid, run_uuid, sequence_number, status, started_at_ms, completed_at_ms
        FROM run_results
        WHERE result_uuid = ? AND run_uuid = ?
      `).get(resultUuid, runUuid);
      
      if (!result) {
        throw new Error('Challenge not found or does not belong to this run');
      }
      
      // Only clear if it's not completed and has a started_at_ms
      if (result.completed_at_ms) {
        console.log(`[clear-challenge-start-time] Challenge ${result.sequence_number} is completed, skipping clear`);
        return { success: true, cleared: false };
      }
      
      if (!result.started_at_ms) {
        console.log(`[clear-challenge-start-time] Challenge ${result.sequence_number} has no started_at_ms, nothing to clear`);
        return { success: true, cleared: false };
      }
      
      // Clear the start time
      db.prepare(`
        UPDATE run_results
        SET started_at = NULL,
            started_at_ms = NULL
        WHERE result_uuid = ?
      `).run(resultUuid);
      
      console.log(`[clear-challenge-start-time] Cleared started_at_ms for challenge ${result.sequence_number} (result_uuid: ${resultUuid})`);
      
      return { success: true, cleared: true, sequenceNumber: result.sequence_number };
    } catch (error) {
      console.error('Error clearing challenge start time:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Cancel a run
   * Channel: db:runs:cancel
   */
  ipcMain.handle('db:runs:cancel', async (event, { runUuid }) => {
    try {
      const db = dbManager.getConnection('clientdata');
      
      db.prepare(`
        UPDATE runs 
        SET status = 'cancelled',
            completed_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE run_uuid = ?
      `).run(runUuid);
      
      return { success: true };
    } catch (error) {
      console.error('Error cancelling run:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Complete a run (mark as finished)
   * Channel: db:runs:complete
   */
  ipcMain.handle('db:runs:complete', async (event, { runUuid }) => {
    try {
      const db = dbManager.getConnection('clientdata');
      
      // Update run status to completed
      const nowMs = Date.now();
      db.prepare(`
        UPDATE runs 
        SET status = 'completed',
            completed_at = CURRENT_TIMESTAMP,
            completed_at_ms = ?,
            updated_at = CURRENT_TIMESTAMP,
            updated_at_ms = ?
        WHERE run_uuid = ?
      `).run(nowMs, nowMs, runUuid);
      
      // Generate runview.html for finished run
      try {
        const userDataPath = app.getPath('userData');
        await generateRunview({ dbManager, runUuid, userDataPath });
      } catch (error) {
        console.warn('[runview] Failed to generate after completion:', error);
      }
      
      console.log(`Run ${runUuid} marked as completed`);
      return { success: true };
    } catch (error) {
      console.error('Error completing run:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Update win rules for a run
   * Channel: db:runs:update-win-rules
   */
  ipcMain.handle('db:runs:update-win-rules', async (event, { runUuid, winRulesJson }) => {
    try {
      console.log(`[db:runs:update-win-rules] Called with runUuid: ${runUuid}, winRulesJson:`, winRulesJson);
      const db = dbManager.getConnection('clientdata');
      
      // Verify run exists
      const run = db.prepare('SELECT run_uuid FROM runs WHERE run_uuid = ?').get(runUuid);
      if (!run) {
        console.error(`[db:runs:update-win-rules] Run not found: ${runUuid}`);
        return { success: false, error: 'Run not found' };
      }
      
      // Update win rules JSON
      const nowMs = Date.now();
      const stmt = db.prepare(`
        UPDATE runs 
        SET win_rules_json = ?,
            updated_at = CURRENT_TIMESTAMP,
            updated_at_ms = ?
        WHERE run_uuid = ?
      `);
      const result = stmt.run(winRulesJson, nowMs, runUuid);
      
      console.log(`[db:runs:update-win-rules] Updated win rules for run ${runUuid}, changes: ${result.changes}`);
      
      // Verify the update worked
      const verify = db.prepare('SELECT win_rules_json FROM runs WHERE run_uuid = ?').get(runUuid);
      console.log(`[db:runs:update-win-rules] Verification - win_rules_json in DB:`, verify?.win_rules_json);
      
      // Regenerate runview.html
      try {
        const userDataPath = app.getPath('userData');
        await generateRunview({ dbManager, runUuid, userDataPath });
      } catch (error) {
        console.warn('[db:runs:update-win-rules] Failed to generate runview after win rules update:', error);
      }
      
      return { success: true };
    } catch (error) {
      console.error('[db:runs:update-win-rules] Error updating win rules:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Get run results (expanded challenges)
   * Channel: db:runs:get-results
   */
  ipcMain.handle('db:runs:get-results', async (event, { runUuid }) => {
    try {
      const db = dbManager.getConnection('clientdata');
      
      // Join with run_plan_entries to get entry_type
      // Include millisecond precision columns and rollover time tracking
      const results = db.prepare(`
        SELECT 
          rr.result_uuid,
          rr.run_uuid,
          rr.plan_entry_uuid,
          rr.sequence_number,
          rr.gameid,
          rr.game_name,
          rr.exit_number,
          rr.stage_description,
          rr.was_random,
          rr.revealed_early,
          rr.status,
          rr.started_at,
          rr.started_at_ms,
          rr.completed_at,
          rr.completed_at_ms,
          rr.duration_seconds,
          rr.duration_milliseconds,
          rr.pause_seconds,
          rr.pause_milliseconds,
          rr.rollover_time_remaining_start_ms,
          rr.rollover_time_remaining_end_ms,
          rr.allocated_time_ms,
          rr.grace_time_ms,
          rr.conditions,
          rr.sfcpath,
          rr.levelnumber,
          rr.translevel,
          rr.levelname,
          rpe.entry_type
        FROM run_results rr
        LEFT JOIN run_plan_entries rpe ON rr.plan_entry_uuid = rpe.entry_uuid
        WHERE rr.run_uuid = ?
        ORDER BY rr.sequence_number
      `).all(runUuid);
      
      return results;
    } catch (error) {
      console.error('Error getting run results:', error);
      throw error;
    }
  });

  /**
   * Get run plan entries
   * Channel: db:runs:get-plan-entries
   */
  ipcMain.handle('db:runs:get-plan-entries', async (event, { runUuid }) => {
    try {
      const db = dbManager.getConnection('clientdata');
      
      const entries = db.prepare(`
        SELECT * FROM run_plan_entries
        WHERE run_uuid = ?
        ORDER BY sequence_number
      `).all(runUuid);
      
      return entries;
    } catch (error) {
      console.error('Error getting run plan entries:', error);
      throw error;
    }
  });

  /**
   * Get run staging info (folder path and SFC count)
   * Channel: db:runs:get-staging-info
   */
  ipcMain.handle('db:runs:get-staging-info', async (event, { runUuid }) => {
    try {
      const db = dbManager.getConnection('clientdata');
      
      const run = db.prepare(`SELECT staging_folder FROM runs WHERE run_uuid = ?`).get(runUuid);
      if (!run) {
        return { success: false, error: 'Run not found' };
      }
      
      const folderPath = run.staging_folder || null;
      let sfcCount = 0;
      
      if (folderPath) {
        // Count results for this run
        const countResult = db.prepare(`SELECT COUNT(*) as count FROM run_results WHERE run_uuid = ?`).get(runUuid);
        sfcCount = countResult?.count || 0;
      }
      
      return {
        success: true,
        folderPath: folderPath,
        sfcCount: sfcCount
      };
    } catch (error) {
      console.error('Error getting run staging info:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Check if a path exists
   * Channel: fs:checkPathExists
   */
  ipcMain.handle('fs:checkPathExists', async (event, { path }) => {
    try {
      const fs = require('fs');
      return fs.existsSync(path);
    } catch (error) {
      console.error('Error checking path existence:', error);
      return false;
    }
  });

  /**
   * Get active run (for startup check)
   * Channel: db:runs:get-active
   */
  ipcMain.handle('db:runs:get-active', async (event) => {
    try {
      const activeRun = gameStager.getActiveRun(dbManager);
      
      if (!activeRun) {
        return null;
      }
      
      // Calculate elapsed time
      const elapsedSeconds = gameStager.calculateRunElapsed(activeRun);
      const isPaused = gameStager.isRunPaused(activeRun);
      
      return {
        ...activeRun,
        elapsedSeconds,
        isPaused
      };
    } catch (error) {
      console.error('Error getting active run:', error);
      return null;
    }
  });

  /**
   * Pause a run
   * Channel: db:runs:pause
   */
  ipcMain.handle('db:runs:pause', async (event, { runUuid }) => {
    try {
      const db = dbManager.getConnection('clientdata');
      
      // Set pause_start for run (with millisecond precision)
      const nowMs = Date.now();
      db.prepare(`
        UPDATE runs
        SET pause_start = CURRENT_TIMESTAMP,
            pause_start_ms = ?,
            pause_end = NULL,
            pause_end_ms = NULL,
            updated_at = CURRENT_TIMESTAMP,
            updated_at_ms = ?
        WHERE run_uuid = ? AND status = 'active'
      `).run(nowMs, nowMs, runUuid);
      
      // Get current challenge index and set pause_start for it
      const currentResult = db.prepare(`
        SELECT result_uuid FROM run_results
        WHERE run_uuid = ? AND status = 'pending'
        ORDER BY sequence_number
        LIMIT 1
      `).get(runUuid);
      
      if (currentResult) {
        db.prepare(`
          UPDATE run_results
          SET pause_start = CURRENT_TIMESTAMP,
              pause_start_ms = ?,
              pause_end = NULL,
              pause_end_ms = NULL
          WHERE result_uuid = ?
        `).run(nowMs, currentResult.result_uuid);
      }
      
      return { success: true };
    } catch (error) {
      console.error('Error pausing run:', error);
      return { success: false, error: error.message };
    }
  });
  /**
   * Unpause a run
   * Channel: db:runs:unpause
   */
  ipcMain.handle('db:runs:unpause', async (event, { runUuid }) => {
    try {
      const db = dbManager.getConnection('clientdata');
      
      // Calculate pause duration for run (using millisecond precision)
      const nowMs = Date.now();
      const run = db.prepare(`
        SELECT pause_start, pause_start_ms, pause_seconds, pause_milliseconds 
        FROM runs WHERE run_uuid = ?
      `).get(runUuid);
      
      if (run && (run.pause_start || run.pause_start_ms)) {
        // Use millisecond precision if available, otherwise fall back to timestamp
        let pauseStartMs;
        if (run.pause_start_ms) {
          pauseStartMs = run.pause_start_ms;
        } else if (run.pause_start) {
          pauseStartMs = new Date(run.pause_start).getTime();
        } else {
          pauseStartMs = nowMs; // Fallback
        }
        
        const pauseDurationMs = nowMs - pauseStartMs;
        const existingPauseMs = run.pause_milliseconds || ((run.pause_seconds || 0) * 1000);
        const totalPausedMs = existingPauseMs + pauseDurationMs;
        const totalPausedSeconds = Math.floor(totalPausedMs / 1000);
        
        // Update run with millisecond precision
        db.prepare(`
          UPDATE runs
          SET pause_milliseconds = ?,
              pause_seconds = ?,
              pause_start = NULL,
              pause_start_ms = NULL,
              pause_end = CURRENT_TIMESTAMP,
              pause_end_ms = ?,
              updated_at = CURRENT_TIMESTAMP,
              updated_at_ms = ?
          WHERE run_uuid = ?
        `).run(totalPausedMs, totalPausedSeconds, nowMs, nowMs, runUuid);
      }
      
      // Calculate pause duration for current challenge
      const currentResult = db.prepare(`
        SELECT result_uuid, pause_start, pause_start_ms, pause_seconds, pause_milliseconds 
        FROM run_results
        WHERE run_uuid = ? AND status = 'pending'
        ORDER BY sequence_number
        LIMIT 1
      `).get(runUuid);
      
      if (currentResult && (currentResult.pause_start || currentResult.pause_start_ms)) {
        // Use millisecond precision if available
        let pauseStartMs;
        if (currentResult.pause_start_ms) {
          pauseStartMs = currentResult.pause_start_ms;
        } else if (currentResult.pause_start) {
          pauseStartMs = new Date(currentResult.pause_start).getTime();
        } else {
          pauseStartMs = nowMs; // Fallback
        }
        
        const pauseDurationMs = nowMs - pauseStartMs;
        const existingPauseMs = currentResult.pause_milliseconds || ((currentResult.pause_seconds || 0) * 1000);
        const totalPausedMs = existingPauseMs + pauseDurationMs;
        const totalPausedSeconds = Math.floor(totalPausedMs / 1000);
        
        db.prepare(`
          UPDATE run_results
          SET pause_milliseconds = ?,
              pause_seconds = ?,
              pause_start = NULL,
              pause_start_ms = NULL,
              pause_end = CURRENT_TIMESTAMP,
              pause_end_ms = ?
          WHERE result_uuid = ?
        `).run(totalPausedMs, totalPausedSeconds, nowMs, currentResult.result_uuid);
      }
      
      // Get updated pause_seconds to return (for backwards compatibility)
      const updatedRun = db.prepare(`
        SELECT pause_seconds, pause_milliseconds FROM runs WHERE run_uuid = ?
      `).get(runUuid);
      
      return { 
        success: true, 
        pauseSeconds: updatedRun ? (updatedRun.pause_seconds || Math.floor((updatedRun.pause_milliseconds || 0) / 1000)) : 0 
      };
    } catch (error) {
      console.error('Error unpausing run:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Get unique filter values for random game selection
   * Channel: db:get-random-filter-values
   */
  ipcMain.handle('db:get-random-filter-values', async () => {
    try {
      const db = dbManager.getConnection('rhdata');
      
      // Get unique difficulties
      const difficulties = db.prepare(`
        SELECT DISTINCT difficulty 
        FROM gameversions 
        WHERE difficulty IS NOT NULL AND difficulty != '' AND removed = 0
        ORDER BY difficulty
      `).all().map(row => row.difficulty);
      
      // Get unique types from both gametype and legacy_type
      const types = db.prepare(`
        SELECT DISTINCT gametype AS type
        FROM gameversions
        WHERE gametype IS NOT NULL AND gametype != '' AND removed = 0
        UNION
        SELECT DISTINCT legacy_type AS type
        FROM gameversions
        WHERE legacy_type IS NOT NULL AND legacy_type != '' AND removed = 0
        ORDER BY type
      `).all().map(row => row.type);
      
      return { success: true, difficulties, types };
    } catch (error) {
      console.error('Error getting filter values:', error);
      return { success: false, error: error.message };
    }
  });
  /**
   * Count games matching random filter criteria
   * Channel: db:count-random-matches
   */
  ipcMain.handle('db:count-random-matches', async (event, { filterType, filterDifficulty, filterPattern, minDifficulty, maxDifficulty }) => {
    try {
      const db = dbManager.getConnection('rhdata');
      
      // First get all games with basic filters (type only, difficulty filtering happens after)
      let query = `
        SELECT gv.gameid, gv.version, gv.name, gv.combinedtype, gv.difficulty, gv.gametype, gv.legacy_type, gv.author, gv.length, gv.description, gv.demo, gv.featured, gv.obsoleted, gv.removed, gv.moderated, gvs.rating_value
        FROM gameversions gv
        LEFT JOIN gameversion_stats gvs ON gv.gameid = gvs.gameid
        WHERE gv.removed = 0 AND gv.obsoleted = 0
      `;
      const queryParams = [];
      
      // Apply type filter (matches either gametype OR legacy_type)
      if (filterType && filterType !== '' && filterType !== 'any') {
        query += ` AND (gv.gametype = ? OR gv.legacy_type = ?)`;
        queryParams.push(filterType, filterType);
      }
      
      // Note: Legacy filterDifficulty is kept for backwards compatibility but ignored if minDifficulty/maxDifficulty are provided
      // If only filterDifficulty is provided (old behavior), we'll handle it below
      
      const games = db.prepare(query).all(...queryParams);
      
      // Apply difficulty filter using numeric difficulty mapping
      let filteredGames = games;
      
      // If minDifficulty or maxDifficulty are provided, use numeric filtering
      if (minDifficulty !== null && minDifficulty !== undefined || maxDifficulty !== null && maxDifficulty !== undefined) {
        filteredGames = filteredGames.filter(game => 
          matchesDifficultyFilter(game, minDifficulty, maxDifficulty)
        );
      } else if (filterDifficulty && filterDifficulty !== '' && filterDifficulty !== 'any') {
        // Legacy behavior: exact match on difficulty string
        filteredGames = filteredGames.filter(game => 
          game.difficulty === filterDifficulty
        );
      }
      
      // Apply advanced pattern filter using shared filter logic
      if (filterPattern && filterPattern !== '') {
        filteredGames = filteredGames.filter(game => matchesFilter(game, filterPattern));
      }
      
      // Apply ban filter - exclude games banned from random game selection
      const banManager = new GameVersionBanManager(dbManager);
      filteredGames = filteredGames.filter(game => {
        return !banManager.isGameBanned(game.gameid, 'run_random_game', game);
      });
      
      return { success: true, count: filteredGames.length };
    } catch (error) {
      console.error('Error counting random matches:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Check if a game is banned for a specific action
   * Channel: db:ban:is-game-banned
   * Uses session-only cache in thumbnail_cache.db for image_title and image_preview
   * Cache expires after 30 minutes to allow real-time ban list updates
   */
  ipcMain.handle('db:ban:is-game-banned', async (event, { gameid, action, gameData = null }) => {
    try {
      const CACHE_EXPIRY_MS = 30 * 60 * 1000; // 30 minutes
      const now = Date.now();
      
      // Check session cache for image_title and image_preview bans
      if (action === 'image_title' || action === 'image_preview') {
        try {
          const thumbnailCacheDb = dbManager.getConnection('thumbnail_cache');
          const cacheColumn = action === 'image_title' ? 'image_title_banned' : 'image_preview_banned';
          const timestampColumn = action === 'image_title' ? 'image_title_banned_at' : 'image_preview_banned_at';
          
          // Check if cache columns exist (migration may not have run yet)
          const tableInfo = thumbnailCacheDb.prepare("PRAGMA table_info(thumbnail_cache)").all();
          const hasColumn = tableInfo.some(col => col.name === cacheColumn);
          const hasTimestampColumn = tableInfo.some(col => col.name === timestampColumn);
          
          if (hasColumn) {
            const gameidStr = String(gameid);
            const cached = thumbnailCacheDb.prepare(`
              SELECT ${cacheColumn}, ${hasTimestampColumn ? timestampColumn : 'NULL as ' + timestampColumn}
              FROM thumbnail_cache WHERE gameid = ?
            `).get(gameidStr);
            
            if (cached && cached[cacheColumn] === 1) {
              // Check if cache is still valid (within 30 minutes)
              if (hasTimestampColumn && cached[timestampColumn]) {
                const cachedAt = new Date(cached[timestampColumn]).getTime();
                const age = now - cachedAt;
                
                if (age < CACHE_EXPIRY_MS) {
                  // Cache is still valid
                  return { success: true, isBanned: true, cached: true };
                }
                // Cache expired, fall through to ban manager check
              } else {
                // No timestamp column yet, but ban is cached - return cached result
                // (for backwards compatibility during migration)
                return { success: true, isBanned: true, cached: true };
              }
            }
            // If cached as 0 (not banned) or expired, we still check the ban manager to ensure accuracy
          }
        } catch (cacheError) {
          // Cache check failed, fall through to ban manager check
          console.warn('[db:ban:is-game-banned] Cache check failed:', cacheError);
        }
      }
      
      const banManager = new GameVersionBanManager(dbManager);
      
      // Ensure gameid is a string for consistent matching
      const gameidStr = String(gameid);
      
      // If gameData is provided, use it; otherwise construct minimal game object
      const game = gameData || { gameid: gameidStr, Id: gameidStr };
      
      // Ensure game object has gameid as string
      if (game.gameid) game.gameid = String(game.gameid);
      if (game.Id) game.Id = String(game.Id);
      
      //console.log(`[db:ban:is-game-banned] Checking ban for gameid=${gameidStr}, action=${action}, gameData=`, game);
      const isBanned = banManager.isGameBanned(gameidStr, action, game);
      //console.log(`[db:ban:is-game-banned] Result: isBanned=${isBanned}`);
      
      // Cache the result for image_title and image_preview (session-only, with timestamp)
      if (action === 'image_title' || action === 'image_preview') {
        try {
          const thumbnailCacheDb = dbManager.getConnection('thumbnail_cache');
          const cacheColumn = action === 'image_title' ? 'image_title_banned' : 'image_preview_banned';
          const timestampColumn = action === 'image_title' ? 'image_title_banned_at' : 'image_preview_banned_at';
          
          // Check if cache columns exist
          const tableInfo = thumbnailCacheDb.prepare("PRAGMA table_info(thumbnail_cache)").all();
          const hasColumn = tableInfo.some(col => col.name === cacheColumn);
          const hasTimestampColumn = tableInfo.some(col => col.name === timestampColumn);
          
          if (hasColumn) {
            // Ensure gameid is treated as TEXT
            const gameidStr = String(gameid);
            const timestamp = new Date(now).toISOString();
            
            // Check if record exists first
            const existing = thumbnailCacheDb.prepare(`
              SELECT gameid FROM thumbnail_cache WHERE gameid = ?
            `).get(gameidStr);
            
            if (existing) {
              // Record exists - UPDATE only (don't require thumbnail_data_url)
              if (hasTimestampColumn) {
                thumbnailCacheDb.prepare(`
                  UPDATE thumbnail_cache 
                  SET ${cacheColumn} = ?,
                      ${timestampColumn} = ?,
                      updated_at = CURRENT_TIMESTAMP
                  WHERE gameid = ?
                `).run(isBanned ? 1 : 0, timestamp, gameidStr);
              } else {
                thumbnailCacheDb.prepare(`
                  UPDATE thumbnail_cache 
                  SET ${cacheColumn} = ?,
                      updated_at = CURRENT_TIMESTAMP
                  WHERE gameid = ?
                `).run(isBanned ? 1 : 0, gameidStr);
              }
            } else {
              // Record doesn't exist - skip cache update (can't INSERT without thumbnail_data_url)
              // The ban check result is still returned, just not cached
              // Cache will be populated when thumbnail is actually loaded
            }
          }
        } catch (cacheError) {
          // Cache update failed, but ban check succeeded, so continue
          // Don't log - too noisy when checking many games
        }
      }
      
      return { success: true, isBanned };
    } catch (error) {
      console.error('[db:ban:is-game-banned] Error:', error);
      return { success: false, error: error.message, isBanned: false };
    }
  });

  /**
   * Batch check bans for multiple games
   * Channel: db:ban:batch-check
   * Optimized for checking many games at once (e.g., for list/tile views)
   */
  ipcMain.handle('db:ban:batch-check', async (event, { gameids, action, gamesData = [] }) => {
    try {
      const CACHE_EXPIRY_MS = 30 * 60 * 1000; // 30 minutes
      const now = Date.now();
      const results = {};
      
      // Only support image_title, image_preview, list_title, list_any for batch operations
      if (action !== 'image_title' && action !== 'image_preview' && action !== 'list_title' && action !== 'list_any') {
        return { success: false, error: 'Batch check only supports image_title, image_preview, list_title, list_any' };
      }
      
      const banManager = new GameVersionBanManager(dbManager);
      
      // Check session cache for image_title and image_preview bans
      if (action === 'image_title' || action === 'image_preview') {
        try {
          const thumbnailCacheDb = dbManager.getConnection('thumbnail_cache');
          const cacheColumn = action === 'image_title' ? 'image_title_banned' : 'image_preview_banned';
          const timestampColumn = action === 'image_title' ? 'image_title_banned_at' : 'image_preview_banned_at';
          
          const tableInfo = thumbnailCacheDb.prepare("PRAGMA table_info(thumbnail_cache)").all();
          const hasColumn = tableInfo.some(col => col.name === cacheColumn);
          const hasTimestampColumn = tableInfo.some(col => col.name === timestampColumn);
          
          if (hasColumn && gameids.length > 0) {
            // Batch fetch cached results
            const placeholders = gameids.map(() => '?').join(',');
            const cached = thumbnailCacheDb.prepare(`
              SELECT gameid, ${cacheColumn}, ${hasTimestampColumn ? timestampColumn : 'NULL as ' + timestampColumn}
              FROM thumbnail_cache 
              WHERE gameid IN (${placeholders})
            `).all(...gameids.map(id => String(id)));
            
            const cachedMap = new Map();
            const toCheck = [];
            
            for (const row of cached) {
              const gameidStr = String(row.gameid);
              if (row[cacheColumn] === 1) {
                // Check if cache is still valid
                if (hasTimestampColumn && row[timestampColumn]) {
                  const cachedAt = new Date(row[timestampColumn]).getTime();
                  const age = now - cachedAt;
                  if (age < CACHE_EXPIRY_MS) {
                    results[gameidStr] = true;
                    cachedMap.set(gameidStr, true);
                    continue;
                  }
                } else {
                  results[gameidStr] = true;
                  cachedMap.set(gameidStr, true);
                  continue;
                }
              }
              toCheck.push(gameidStr);
            }
            
            // Add uncached gameids to check list
            for (const gameidStr of gameids.map(id => String(id))) {
              if (!cachedMap.has(gameidStr)) {
                toCheck.push(gameidStr);
              }
            }
            
            // Batch check uncached games
            for (const gameidStr of toCheck) {
              const gameData = gamesData.find(g => String(g.gameid || g.Id) === gameidStr) || { gameid: gameidStr, Id: gameidStr };
              const isBanned = banManager.isGameBanned(gameidStr, action, gameData);
              results[gameidStr] = isBanned;
              
              // Cache the result (UPDATE only if record exists - don't require thumbnail_data_url)
              try {
                const existing = thumbnailCacheDb.prepare(`
                  SELECT gameid FROM thumbnail_cache WHERE gameid = ?
                `).get(gameidStr);
                
                if (existing) {
                  const timestamp = new Date(now).toISOString();
                  if (hasTimestampColumn) {
                    thumbnailCacheDb.prepare(`
                      UPDATE thumbnail_cache 
                      SET ${cacheColumn} = ?,
                          ${timestampColumn} = ?,
                          updated_at = CURRENT_TIMESTAMP
                      WHERE gameid = ?
                    `).run(isBanned ? 1 : 0, timestamp, gameidStr);
                  } else {
                    thumbnailCacheDb.prepare(`
                      UPDATE thumbnail_cache 
                      SET ${cacheColumn} = ?,
                          updated_at = CURRENT_TIMESTAMP
                      WHERE gameid = ?
                    `).run(isBanned ? 1 : 0, gameidStr);
                  }
                }
              } catch (cacheError) {
                // Cache update failed, but ban check succeeded - silently continue
              }
            }
            
            return { success: true, results };
          }
        } catch (cacheError) {
          // Cache check failed, fall through to ban manager check
        }
      }
      
      // For list_title and list_any, or if cache check failed, check all games
      for (const gameidStr of gameids.map(id => String(id))) {
        const gameData = gamesData.find(g => String(g.gameid || g.Id) === gameidStr) || { gameid: gameidStr, Id: gameidStr };
        results[gameidStr] = banManager.isGameBanned(gameidStr, action, gameData);
      }
      
      return { success: true, results };
    } catch (error) {
      console.error('[db:ban:batch-check] Error:', error);
      return { success: false, error: error.message, results: {} };
    }
  });

  /**
   * Get ban details for a game and action
   * Channel: db:ban:get-details
   */
  ipcMain.handle('db:ban:get-details', async (event, { gameid, action, gameData = null }) => {
    try {
      const banManager = new GameVersionBanManager(dbManager);
      
      // If gameData is provided, use it; otherwise construct minimal game object
      const game = gameData || { gameid, Id: gameid };
      
      const banDetails = banManager.getBanDetails(gameid, action, game);
      return { success: true, banDetails };
    } catch (error) {
      console.error('[db:ban:get-details] Error:', error);
      return { success: false, error: error.message, banDetails: null };
    }
  });

  /**
   * Invalidate ban cache for specific gameids or all games
   * Channel: db:ban:invalidate-cache
   * @param {Array<string>|null} gameids - Array of gameids to invalidate, or null to invalidate all
   * @param {string|null} action - Specific action to invalidate ('image_title', 'image_preview'), or null for all
   */
  ipcMain.handle('db:ban:invalidate-cache', async (event, { gameids = null, action = null }) => {
    try {
      const thumbnailCacheDb = dbManager.getConnection('thumbnail_cache');
      
      // Check if timestamp columns exist
      const tableInfo = thumbnailCacheDb.prepare("PRAGMA table_info(thumbnail_cache)").all();
      const hasTitleTimestamp = tableInfo.some(col => col.name === 'image_title_banned_at');
      const hasPreviewTimestamp = tableInfo.some(col => col.name === 'image_preview_banned_at');
      
      if (!hasTitleTimestamp && !hasPreviewTimestamp) {
        // No timestamp columns yet, clear the ban status columns instead
        if (gameids && Array.isArray(gameids) && gameids.length > 0) {
          const placeholders = gameids.map(() => '?').join(',');
          const gameidStrs = gameids.map(gid => String(gid));
          
          if (action === 'image_title' || action === null) {
            thumbnailCacheDb.prepare(`
              UPDATE thumbnail_cache 
              SET image_title_banned = 0 
              WHERE gameid IN (${placeholders})
            `).run(...gameidStrs);
          }
          
          if (action === 'image_preview' || action === null) {
            thumbnailCacheDb.prepare(`
              UPDATE thumbnail_cache 
              SET image_preview_banned = 0 
              WHERE gameid IN (${placeholders})
            `).run(...gameidStrs);
          }
        } else {
          // Invalidate all
          if (action === 'image_title' || action === null) {
            thumbnailCacheDb.prepare(`
              UPDATE thumbnail_cache SET image_title_banned = 0
            `).run();
          }
          
          if (action === 'image_preview' || action === null) {
            thumbnailCacheDb.prepare(`
              UPDATE thumbnail_cache SET image_preview_banned = 0
            `).run();
          }
        }
      } else {
        // Use timestamp columns - set to NULL to force expiration
        if (gameids && Array.isArray(gameids) && gameids.length > 0) {
          const placeholders = gameids.map(() => '?').join(',');
          const gameidStrs = gameids.map(gid => String(gid));
          
          if (action === 'image_title' || action === null) {
            if (hasTitleTimestamp) {
              thumbnailCacheDb.prepare(`
                UPDATE thumbnail_cache 
                SET image_title_banned_at = NULL, image_title_banned = 0
                WHERE gameid IN (${placeholders})
              `).run(...gameidStrs);
            }
          }
          
          if (action === 'image_preview' || action === null) {
            if (hasPreviewTimestamp) {
              thumbnailCacheDb.prepare(`
                UPDATE thumbnail_cache 
                SET image_preview_banned_at = NULL, image_preview_banned = 0
                WHERE gameid IN (${placeholders})
              `).run(...gameidStrs);
            }
          }
        } else {
          // Invalidate all
          if (action === 'image_title' || action === null) {
            if (hasTitleTimestamp) {
              thumbnailCacheDb.prepare(`
                UPDATE thumbnail_cache 
                SET image_title_banned_at = NULL, image_title_banned = 0
              `).run();
            }
          }
          
          if (action === 'image_preview' || action === null) {
            if (hasPreviewTimestamp) {
              thumbnailCacheDb.prepare(`
                UPDATE thumbnail_cache 
                SET image_preview_banned_at = NULL, image_preview_banned = 0
              `).run();
            }
          }
        }
      }
      
      return { success: true };
    } catch (error) {
      console.error('[db:ban:invalidate-cache] Error:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Count stages matching random filter criteria (both game filters and stage filters)
   * Channel: db:count-random-stage-matches
   */
  ipcMain.handle('db:count-random-stage-matches', async (event, { 
    filterType, 
    filterDifficulty, 
    filterPattern,
    minDifficulty,
    maxDifficulty,
    stageMinDifficulty,
    stageMaxDifficulty,
    stageIncludeFlags,
    stageExcludeFlags,
    stageIncludeAnyOfFlags,
    stageExcludeOnlyFlags,
    stageHasTags,
    stageExcludeTags
  }) => {
    try {
      console.log('[count-random-stage-matches] Called with params:', {
        filterType, filterDifficulty, filterPattern,
        stageMinDifficulty, stageMaxDifficulty,
        stageIncludeFlags, stageExcludeFlags
      });
      const rhdataDb = dbManager.getConnection('rhdata');
      
      // First, get all games matching game filters (same logic as countRandomMatches)
      let gameQuery = `
        SELECT gv.gameid, gv.version, gv.name, gv.combinedtype, gv.difficulty, gv.gametype, gv.legacy_type, gv.author, gv.length, gv.description, gv.demo, gv.featured, gv.obsoleted, gv.removed, gv.moderated, gvs.rating_value
        FROM gameversions gv
        LEFT JOIN gameversion_stats gvs ON gv.gameid = gvs.gameid
        WHERE gv.removed = 0 AND gv.obsoleted = 0
      `;
      const gameQueryParams = [];
      
      // Apply type filter (matches either gametype OR legacy_type)
      if (filterType && filterType !== '' && filterType !== 'any') {
        gameQuery += ` AND (gv.gametype = ? OR gv.legacy_type = ?)`;
        gameQueryParams.push(filterType, filterType);
      }
      
      // Note: Legacy filterDifficulty is kept for backwards compatibility but ignored if minDifficulty/maxDifficulty are provided
      
      const games = rhdataDb.prepare(gameQuery).all(...gameQueryParams);
      
      // Apply difficulty filter using numeric difficulty mapping
      let filteredGames = games;
      
      // If minDifficulty or maxDifficulty are provided, use numeric filtering
      if (minDifficulty !== null && minDifficulty !== undefined || maxDifficulty !== null && maxDifficulty !== undefined) {
        filteredGames = filteredGames.filter(game => 
          matchesDifficultyFilter(game, minDifficulty, maxDifficulty)
        );
      } else if (filterDifficulty && filterDifficulty !== '' && filterDifficulty !== 'any') {
        // Legacy behavior: exact match on difficulty string
        filteredGames = filteredGames.filter(game => 
          game.difficulty === filterDifficulty
        );
      }
      
      // Apply advanced pattern filter using shared filter logic
      if (filterPattern && filterPattern !== '') {
        filteredGames = filteredGames.filter(game => matchesFilter(game, filterPattern));
      }
      
      // Apply ban filter - exclude games banned from random stage selection
      // Also exclude games banned from random game selection (since stages come from games)
      const banManager = new GameVersionBanManager(dbManager);
      filteredGames = filteredGames.filter(game => {
        // Exclude if banned from random game selection
        if (banManager.isGameBanned(game.gameid, 'run_random_game', game)) {
          return false;
        }
        // Exclude if banned from random stage selection
        if (banManager.isGameBanned(game.gameid, 'run_random_stage', game)) {
          return false;
        }
        return true;
      });
      
      if (filteredGames.length === 0) {
        return { success: true, count: 0 };
      }
      
      // Get all stages for matching games
      const gameids = filteredGames.map(g => g.gameid);
      const placeholders = gameids.map(() => '?').join(',');
      
      let stageQuery = `
        SELECT gs.*, gv.version
        FROM gamestages gs
        INNER JOIN gameversions gv ON gs.gameid = gv.gameid
        WHERE gs.gameid IN (${placeholders})
          AND gs.playable = 1
          AND gs.rando = 1
          AND gs.difficulty >= 0
          AND gs.difficulty <= 9
      `;
      const stageQueryParams = [...gameids];
      
      // Apply stage difficulty filters
      // Note: When minDifficulty is null, difficulty 0 is allowed (user explicitly set to "Any")
      if (stageMinDifficulty !== null && stageMinDifficulty !== undefined) {
        stageQuery += ` AND gs.difficulty >= ?`;
        stageQueryParams.push(stageMinDifficulty);
      }
      // If minDifficulty is null, we don't add a filter, so difficulty 0 is allowed
      
      if (stageMaxDifficulty !== null && stageMaxDifficulty !== undefined) {
        stageQuery += ` AND gs.difficulty <= ?`;
        stageQueryParams.push(stageMaxDifficulty);
      }
      
      const allStages = rhdataDb.prepare(stageQuery).all(...stageQueryParams);
      
      // Filter by include/exclude flags
      let filteredStages = allStages;
      
      // Helper function to check if a stage has a specific flag
      const hasFlag = (stage, flag) => {
        switch (flag) {
          case 'M': return stage.mainexit === 1;
          case 'K': return stage.keyhole === 1;
          case 'W': return stage.water === 1;
          case 'G': return stage.ghouse === 1;
          case 'S': return stage.spalace === 1;
          case 'Ca': return stage.castle === 1;
          case 'Bo': return stage.boss === 1;
          default: return false;
        }
      };
      
      // Apply MustInclude flags (stages must have ALL of the included flags)
      if (stageIncludeFlags && Array.isArray(stageIncludeFlags) && stageIncludeFlags.length > 0) {
        filteredStages = filteredStages.filter(stage => {
          // Check if stage has ALL of the included flags
          return stageIncludeFlags.every(flag => hasFlag(stage, flag));
        });
      }
      
      // Apply Exclude flags (stages must NOT have ANY of the excluded flags)
      if (stageExcludeFlags && Array.isArray(stageExcludeFlags) && stageExcludeFlags.length > 0) {
        filteredStages = filteredStages.filter(stage => {
          // Check if stage has none of the excluded flags
          return !stageExcludeFlags.some(flag => hasFlag(stage, flag));
        });
      }
      
      // Apply IncludeAnyOf flags (stages must have at least ONE of the included flags)
      if (stageIncludeAnyOfFlags && Array.isArray(stageIncludeAnyOfFlags) && stageIncludeAnyOfFlags.length > 0) {
        filteredStages = filteredStages.filter(stage => {
          // Check if stage has at least one of the included flags
          return stageIncludeAnyOfFlags.some(flag => hasFlag(stage, flag));
        });
      }
      
      // Apply ExcludeOnly flags (stages must have ALL of the excluded flags to be excluded)
      if (stageExcludeOnlyFlags && Array.isArray(stageExcludeOnlyFlags) && stageExcludeOnlyFlags.length > 0) {
        filteredStages = filteredStages.filter(stage => {
          // Check if stage has ALL of the excluded flags (if so, exclude it)
          return !stageExcludeOnlyFlags.every(flag => hasFlag(stage, flag));
        });
      }
      
      // Helper function to parse comma-separated tags
      const parseStageTags = (stagetags) => {
        if (!stagetags || typeof stagetags !== 'string') return [];
        return stagetags.split(',')
          .map(tag => tag.trim())
          .filter(tag => tag.length > 0);
      };
      
      // Apply Has Tags filter (stages must have ALL of the selected tags)
      if (stageHasTags && Array.isArray(stageHasTags) && stageHasTags.length > 0) {
        filteredStages = filteredStages.filter(stage => {
          const stageTags = parseStageTags(stage.stagetags);
          // Check if stage has ALL of the required tags
          return stageHasTags.every(requiredTag => stageTags.includes(requiredTag));
        });
      }
      
      // Apply Exclude Tags filter (stages with ANY of the excluded tags are excluded)
      if (stageExcludeTags && Array.isArray(stageExcludeTags) && stageExcludeTags.length > 0) {
        filteredStages = filteredStages.filter(stage => {
          const stageTags = parseStageTags(stage.stagetags);
          // Check if stage has none of the excluded tags
          return !stageExcludeTags.some(excludedTag => stageTags.includes(excludedTag));
        });
      }
      
      console.log(`[count-random-stage-matches] Found ${filteredStages.length} matching stages`);
      return { success: true, count: filteredStages.length };
    } catch (error) {
      console.error('Error counting random stage matches:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Expand run plan and prepare for staging (select & reveal all random games)
   * Channel: db:runs:expand-and-prepare
   */
  ipcMain.handle('db:runs:expand-and-prepare', async (event, { runUuid }) => {
    try {
      const db = dbManager.getConnection('clientdata');
      
      // Get run to retrieve global patch codes for filtering
      const run = db.prepare(`
        SELECT config_json FROM runs WHERE run_uuid = ?
      `).get(runUuid);
      
      let globalPatchCodes = [];
      if (run && run.config_json) {
        try {
          const config = JSON.parse(run.config_json);
          globalPatchCodes = config.globalPatchCodes || [];
        } catch (e) {
          console.warn('Error parsing run config_json:', e);
        }
      }
      
      // Capture globalPatchCodes in a const for use in transaction callback
      // This ensures it's accessible and not accidentally reassigned
      const capturedGlobalPatchCodes = globalPatchCodes;
      
      const transaction = db.transaction((runId) => {
        // Clean up any existing run_results (in case of re-staging)
        db.prepare(`DELETE FROM run_results WHERE run_uuid = ?`).run(runId);
        
        // Get plan entries
        const planEntries = db.prepare(`
          SELECT * FROM run_plan_entries 
          WHERE run_uuid = ? 
          ORDER BY sequence_number
        `).all(runId);
        
        // Expand plan entries to run_results
        const insertStmt = db.prepare(`
          INSERT INTO run_results
            (result_uuid, run_uuid, plan_entry_uuid, sequence_number, 
             gameid, game_name, exit_number, stage_description,
             was_random, revealed_early, status, conditions,
             levelnumber, translevel, levelname)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)
        `);
        
        let resultSequence = 1;
        const usedGameids = [];
        const usedStageUuids = [];
        
        planEntries.forEach((planEntry) => {
          const count = planEntry.count || 1;
          const isRandomGame = planEntry.entry_type === 'random_game';
          const isRandomStage = planEntry.entry_type === 'random_stage';
          const isStage = planEntry.entry_type === 'stage';
          const isRandom = isRandomGame || isRandomStage;
          
          // Create multiple results if count > 1
          // Get rhdata connection once per plan entry (used in multiple branches)
          const rhdb = dbManager.getConnection('rhdata');
          
          for (let i = 0; i < count; i++) {
            const resultUuid = crypto.randomUUID();
            let gameName = '???';
            let gameid = null;
            let exitNumber = planEntry.exit_number;
            let stageDescription = null;
            let levelnumber = null;
            let translevel = null;
            let levelname = null;
            
            if (isRandomStage) {
              // Select random stage and REVEAL it immediately (for staging)
              try {
                // Parse stage filter flags from JSON
                let stageIncludeFlags = null;
                let stageExcludeFlags = null;
                let stageIncludeAnyOfFlags = null;
                let stageExcludeOnlyFlags = null;
                let stageHasTags = null;
                let stageExcludeTags = null;
                
                if (planEntry.stage_filter_include_flags) {
                  try {
                    stageIncludeFlags = JSON.parse(planEntry.stage_filter_include_flags);
                  } catch (e) {
                    console.warn('Error parsing stage_filter_include_flags:', e);
                  }
                }
                if (planEntry.stage_filter_exclude_flags) {
                  try {
                    stageExcludeFlags = JSON.parse(planEntry.stage_filter_exclude_flags);
                  } catch (e) {
                    console.warn('Error parsing stage_filter_exclude_flags:', e);
                  }
                }
                if (planEntry.stage_filter_include_any_of_flags) {
                  try {
                    stageIncludeAnyOfFlags = JSON.parse(planEntry.stage_filter_include_any_of_flags);
                  } catch (e) {
                    console.warn('Error parsing stage_filter_include_any_of_flags:', e);
                  }
                }
                if (planEntry.stage_filter_exclude_only_flags) {
                  try {
                    stageExcludeOnlyFlags = JSON.parse(planEntry.stage_filter_exclude_only_flags);
                  } catch (e) {
                    console.warn('Error parsing stage_filter_exclude_only_flags:', e);
                  }
                }
                if (planEntry.stage_filter_has_tags) {
                  try {
                    stageHasTags = JSON.parse(planEntry.stage_filter_has_tags);
                  } catch (e) {
                    console.warn('Error parsing stage_filter_has_tags:', e);
                  }
                }
                if (planEntry.stage_filter_exclude_tags) {
                  try {
                    stageExcludeTags = JSON.parse(planEntry.stage_filter_exclude_tags);
                  } catch (e) {
                    console.warn('Error parsing stage_filter_exclude_tags:', e);
                  }
                }
                
                const selectedStage = seedManager.selectRandomStage({
                  dbManager,
                  seed: planEntry.filter_seed,
                  challengeIndex: resultSequence,
                  filterType: planEntry.filter_type,
                  filterDifficulty: planEntry.filter_difficulty,
                  filterPattern: planEntry.filter_pattern,
                  stageMinDifficulty: planEntry.stage_filter_min_difficulty,
                  stageMaxDifficulty: planEntry.stage_filter_max_difficulty,
                  stageIncludeFlags: stageIncludeFlags,
                  stageExcludeFlags: stageExcludeFlags,
                  stageIncludeAnyOfFlags: stageIncludeAnyOfFlags,
                  stageExcludeOnlyFlags: stageExcludeOnlyFlags,
                  stageHasTags: stageHasTags,
                  stageExcludeTags: stageExcludeTags,
                  excludeGameids: usedGameids,
                  excludeStageUuids: usedStageUuids,
                  globalPatchCodes: capturedGlobalPatchCodes  // Pass global patch codes for filtering
                });
                
                // Store the ACTUAL stage data in database (UI will mask it based on was_random flag)
                gameid = selectedStage.gameid;
                gameName = selectedStage.gameName;
                levelnumber = selectedStage.levelnumber;
                translevel = selectedStage.translevel_13bf;
                levelname = selectedStage.levelname;
                stageDescription = levelname;
                usedGameids.push(selectedStage.gameid);
                usedStageUuids.push(selectedStage.stage_uuid);
                
              } catch (error) {
                console.error('Error selecting random stage:', error);
                throw error;  // Fail staging if we can't select a stage
              }
            } else if (isRandomGame) {
              // Select random game and REVEAL it immediately (for staging)
              try {
                // Parse game filter difficulty from plan entry
                // For backwards compatibility, if game_filter_min_difficulty/game_filter_max_difficulty exist, use those
                // Otherwise, fall back to filter_difficulty for exact match
                let gameMinDifficulty = null;
                let gameMaxDifficulty = null;
                
                if (planEntry.game_filter_min_difficulty !== null && planEntry.game_filter_min_difficulty !== undefined) {
                  gameMinDifficulty = planEntry.game_filter_min_difficulty;
                }
                if (planEntry.game_filter_max_difficulty !== null && planEntry.game_filter_max_difficulty !== undefined) {
                  gameMaxDifficulty = planEntry.game_filter_max_difficulty;
                }
                
                const selectedGame = seedManager.selectRandomGame({
                  dbManager,
                  seed: planEntry.filter_seed,
                  challengeIndex: resultSequence,
                  filterType: planEntry.filter_type,
                  filterDifficulty: planEntry.filter_difficulty, // Legacy, kept for backwards compatibility
                  filterPattern: planEntry.filter_pattern,
                  minDifficulty: gameMinDifficulty,
                  maxDifficulty: gameMaxDifficulty,
                  excludeGameids: usedGameids
                });
                
                // Store the ACTUAL game data in database (UI will mask it based on was_random flag)
                gameid = selectedGame.gameid;
                gameName = selectedGame.name;  // Store actual name, UI will mask it
                exitNumber = selectedGame.exit_number;
                stageDescription = selectedGame.stageName || null;
                usedGameids.push(selectedGame.gameid);
                
              } catch (error) {
                console.error('Error selecting random game:', error);
                throw error;  // Fail staging if we can't select a game
              }
            } else if (isStage) {
              // For specific stage entries, load stage info from gamestages table
              gameid = planEntry.gameid;
              exitNumber = planEntry.exit_number;
              usedGameids.push(gameid);
              
              // Fetch game name (rhdb already declared above)
              const game = rhdb.prepare(`
                SELECT name FROM gameversions 
                WHERE gameid = ? AND version = (
                  SELECT MAX(version) FROM gameversions WHERE gameid = ?
                )
              `).get(gameid, gameid);
              
              gameName = game ? game.name : 'Unknown';
              
              // Fetch stage info from gamestages table
              if (exitNumber) {
                // Try to find stage by levelnumber (exit_number might be levelnumber for stage entries)
                const stage = rhdb.prepare(`
                  SELECT levelnumber, translevel_13bf, levelname
                  FROM gamestages
                  WHERE gameid = ? AND levelnumber = ?
                `).get(gameid, exitNumber);
                
                if (stage) {
                  levelnumber = stage.levelnumber;
                  translevel = stage.translevel_13bf;
                  levelname = stage.levelname;
                  stageDescription = stage.levelname;
                } else {
                  // Fallback to exits table
                  const exitInfo = rhdb.prepare(`
                    SELECT description FROM exits 
                    WHERE gameid = ? AND exit_number = ?
                  `).get(gameid, exitNumber);
                  stageDescription = exitInfo ? exitInfo.description : null;
                }
              }
              
              // Also check if trans_level is set in plan entry (for stage entries)
              if (planEntry.trans_level) {
                translevel = planEntry.trans_level;
              }
            } else {
              // For specific game entries, use the gameid from plan
              gameid = planEntry.gameid;
              exitNumber = planEntry.exit_number;
              usedGameids.push(gameid);
              
              // Fetch game name (rhdb already declared above)
              const game = rhdb.prepare(`
                SELECT name FROM gameversions 
                WHERE gameid = ? AND version = (
                  SELECT MAX(version) FROM gameversions WHERE gameid = ?
                )
              `).get(gameid, gameid);
              
              gameName = game ? game.name : 'Unknown';
              
              // Fetch stage description if exit specified
              if (exitNumber) {
                const exitInfo = rhdb.prepare(`
                  SELECT description FROM exits 
                  WHERE gameid = ? AND exit_number = ?
                `).get(gameid, exitNumber);
                stageDescription = exitInfo ? exitInfo.description : null;
              }
            }
            
            // Insert result
            insertStmt.run(
              resultUuid,
              runId,
              planEntry.entry_uuid,
              resultSequence,
              gameid,
              gameName,
              exitNumber,
              stageDescription,
              isRandom ? 1 : 0,
              0,  // revealed_early: false (not revealed yet)
              JSON.stringify(planEntry.conditions || []),
              levelnumber,
              translevel,
              levelname
            );
            
            resultSequence++;
          }
        });
        
        console.log(`Expanded ${planEntries.length} plan entries to ${resultSequence - 1} results`);
      });
      
      try {
        transaction(runUuid);
      } catch (transactionError) {
        console.error('Transaction error:', transactionError);
        console.error('Transaction error stack:', transactionError.stack);
        throw transactionError; // Re-throw to be caught by outer catch
      }
      
      // Generate runview.html after expansion
      try {
        const userDataPath = app.getPath('userData');
        await generateRunview({ dbManager, runUuid, userDataPath });
      } catch (error) {
        console.warn('[runview] Failed to generate after expand-and-prepare:', error);
      }
      
      return { success: true };
    } catch (error) {
      console.error('Error expanding run plan:', error);
      console.error('Error name:', error.name);
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
      // Check if it's a const assignment error and provide more context
      if (error.message && (error.message.includes('constant') || error.message.includes('Assignment to constant'))) {
        console.error('Const assignment error detected. This may be due to variable shadowing or reassignment in a nested scope.');
        console.error('Run UUID:', runUuid);
        console.error('Global patch codes:', globalPatchCodes);
      }
      return { success: false, error: error.message };
    }
  });
  /**
   * Stage run games (create SFC files)
   * Channel: db:runs:stage-games
   */
  ipcMain.handle('db:runs:stage-games', async (event, { runUuid, vanillaRomPath, flipsPath }) => {
    try {
      const db = dbManager.getConnection('clientdata');
      const userDataPath = app.getPath('userData');
      
      // Get run to retrieve global patch codes
      const run = db.prepare(`
        SELECT config_json FROM runs WHERE run_uuid = ?
      `).get(runUuid);
      
      let globalPatchCodes = [];
      if (run && run.config_json) {
        try {
          const config = JSON.parse(run.config_json);
          globalPatchCodes = config.globalPatchCodes || [];
        } catch (e) {
          console.warn('Error parsing run config_json:', e);
        }
      }
      
      // Fetch run_results (already expanded with all games revealed)
      const expandedResults = db.prepare(`
        SELECT 
          result_uuid,
          run_uuid,
          plan_entry_uuid,
          sequence_number,
          gameid,
          game_name,
          exit_number,
          stage_description,
          was_random,
          status,
          conditions,
          levelnumber,
          translevel,
          levelname
        FROM run_results
        WHERE run_uuid = ?
        ORDER BY sequence_number
      `).all(runUuid);
      
      // Add version field to each result (needed for staging)
      const rhdb = dbManager.getConnection('rhdata');
      for (const result of expandedResults) {
        if (result.gameid) {
          const gameVersion = rhdb.prepare(`
            SELECT MAX(version) as version FROM gameversions WHERE gameid = ?
          `).get(result.gameid);
          result.version = gameVersion ? gameVersion.version : 1;
        }
        // Add global patch codes to each result
        result.globalPatchCodes = globalPatchCodes;
      }
      
      if (expandedResults.length === 0) {
        return { success: false, error: 'No games found in run results. Please expand run plan first.' };
      }
      
      // Get ASAR path from settings
      const asarPath = getClientSetting('asarPath') || null;
      console.log('[stage-games] ASAR path from settings:', asarPath);
      
      const result = await gameStager.stageRunGames({
        dbManager,
        runUuid,
        expandedResults,
        userDataPath,
        vanillaRomPath,
        flipsPath,
        asarPath,
        onProgress: (current, total, gameName) => {
          // Send progress updates to renderer
          event.sender.send('staging-progress', { current, total, gameName });
        }
      });
      
      // Generate runview.html after staging
      if (result.success) {
        try {
          await generateRunview({ dbManager, runUuid, userDataPath });
        } catch (error) {
          console.warn('[runview] Failed to generate after staging:', error);
        }
      }
      
      return result;
    } catch (error) {
      console.error('[db:runs:stage-games] Error:', error);
      console.error('[db:runs:stage-games] Error name:', error.name);
      console.error('[db:runs:stage-games] Error message:', error.message);
      console.error('[db:runs:stage-games] Error stack:', error.stack);
      if (error.message && (error.message.includes('constant') || error.message.includes('Assignment to constant'))) {
        console.error('[db:runs:stage-games] Const assignment error detected!');
        console.error('[db:runs:stage-games] Full error details:', JSON.stringify(error, Object.getOwnPropertyNames(error)));
      }
      return { success: false, error: error.message };
    }
  });
  /**
   * Stage games for quick launch (direct launch without creating a run)
   * Channel: db:games:quick-launch-stage
   */
  ipcMain.handle('db:games:quick-launch-stage', async (event, { gameIds, vanillaRomPath, flipsPath, tempDirOverride }) => {
    try {
      const result = await gameStager.stageQuickLaunchGames({
        dbManager,
        gameIds,
        vanillaRomPath,
        flipsPath,
        tempDirOverride,
        onProgress: (current, total, gameName) => {
          // Send progress updates to renderer
          event.sender.send('quick-launch-progress', { current, total, gameName });
        }
      });
      
      return result;
    } catch (error) {
      console.error('Error staging games for quick launch:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Get available extra patches for a game
   * Channel: extra-patches:get-available
   */
  ipcMain.handle('extra-patches:get-available', async (_event, { gameId, gameVersion }) => {
    try {
      const result = await gameStager.getAvailableExtraPatches({
        dbManager,
        gameId,
        gameVersion
      });
      return result;
    } catch (error) {
      console.error('Error getting available extra patches:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Build plus-patched game with extra patches
   * Channel: extra-patches:build-plus
   */
  ipcMain.handle('extra-patches:build-plus', async (_event, params) => {
    try {
      const result = await gameStager.buildPlusPatchedGame({
        dbManager,
        ...params
      });
      return result;
    } catch (error) {
      console.error('Error building plus-patched game:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Get all extra patches (for editor)
   * Channel: extra-patches:get-all
   */
  ipcMain.handle('extra-patches:get-all', async () => {
    try {
      const db = dbManager.getConnection('rhdata');
      const patches = db.prepare(`
        SELECT * FROM extrapatches 
        ORDER BY priority ASC, name ASC
      `).all();
      return { success: true, patches };
    } catch (error) {
      console.error('Error getting all extra patches:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Check if DEVADMIN mode is enabled
   */
  function isDevAdmin() {
    // Check environment variable first
    if (process.env.DEVADMIN === '1') {
      return true;
    }
    // Also check csettings table
    const csettingDevAdmin = getClientSetting('DEVADMIN');
    return csettingDevAdmin === '1';
  }

  /**
   * Save extra patch (create or update)
   * Channel: extra-patches:save
   */
  ipcMain.handle('extra-patches:save', async (_event, params) => {
    try {
      const {
        epuuid,
        patch_code,
        name,
        description,
        patch_type,
        priority,
        requires_parameters,
        template_text,
        file_data,
        parameter_mappings,
        restrictions,
        conflicts,
        dependencies,
        is_system
      } = params;

      if (!patch_code || !name || !patch_type) {
        return { success: false, error: 'Missing required fields: patch_code, name, patch_type' };
      }

      const db = dbManager.getConnection('rhdata');
      
      // Check if editing an existing system patch
      if (epuuid) {
        const existing = db.prepare('SELECT is_system FROM extrapatches WHERE epuuid = ?').get(epuuid);
        if (existing && existing.is_system && !isDevAdmin()) {
          return { success: false, error: 'Cannot modify system patches. Set DEVADMIN=1 to enable editing.' };
        }
      }

      // Check if trying to set is_system without DEVADMIN
      if (is_system && !isDevAdmin()) {
        return { success: false, error: 'Cannot create system patches. Set DEVADMIN=1 to enable.' };
      }

      // Convert file_data array to Buffer if provided
      let fileDataBuffer = null;
      if (file_data && Array.isArray(file_data)) {
        fileDataBuffer = Buffer.from(file_data);
      }
      
      if (epuuid) {
        // Update existing patch
        const existingPatch = db.prepare('SELECT * FROM extrapatches WHERE epuuid = ?').get(epuuid);
        if (!existingPatch) {
          return { success: false, error: 'Patch not found' };
        }

        // Preserve existing file_data if no new file is provided
        if (!fileDataBuffer) {
          const existingFile = db.prepare('SELECT file_data FROM extrapatches WHERE epuuid = ?').get(epuuid);
          fileDataBuffer = existingFile?.file_data || null;
        }

        // Only allow is_system changes if DEVADMIN
        const finalIsSystem = (isDevAdmin() && is_system !== undefined) ? (is_system ? 1 : 0) : (existingPatch.is_system || 0);

        // Only update file_data if new file_data is provided
        if (fileDataBuffer) {
          const stmt = db.prepare(`
            UPDATE extrapatches SET
              name = ?,
              description = ?,
              patch_type = ?,
              priority = ?,
              requires_parameters = ?,
              template_text = ?,
              file_data = ?,
              parameter_mappings = ?,
              restrictions = ?,
              conflicts = ?,
              dependencies = ?,
              is_system = ?,
              updated_at = CURRENT_TIMESTAMP
            WHERE epuuid = ?
          `);
          
          stmt.run(
            name,
            description || null,
            patch_type,
            priority || 100,
            requires_parameters || 0,
            template_text || null,
            fileDataBuffer,
            parameter_mappings || null,
            restrictions || null,
            conflicts || null,
            dependencies || null,
            finalIsSystem,
            epuuid
          );
        } else {
          // Don't update file_data if not provided (keep existing)
          const stmt = db.prepare(`
            UPDATE extrapatches SET
              name = ?,
              description = ?,
              patch_type = ?,
              priority = ?,
              requires_parameters = ?,
              template_text = ?,
              parameter_mappings = ?,
              restrictions = ?,
              conflicts = ?,
              dependencies = ?,
              is_system = ?,
              updated_at = CURRENT_TIMESTAMP
            WHERE epuuid = ?
          `);
          
          stmt.run(
            name,
            description || null,
            patch_type,
            priority || 100,
            requires_parameters || 0,
            template_text || null,
            parameter_mappings || null,
            restrictions || null,
            conflicts || null,
            dependencies || null,
            finalIsSystem,
            epuuid
          );
        }
      } else {
        // Insert new patch
        const finalIsSystem = (isDevAdmin() && is_system) ? 1 : 0;
        const stmt = db.prepare(`
          INSERT INTO extrapatches (
            patch_code, name, description, patch_type, priority,
            requires_parameters, template_text, file_data,
            parameter_mappings, restrictions, conflicts, dependencies, is_system
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        
        stmt.run(
          patch_code,
          name,
          description || null,
          patch_type,
          priority || 100,
          requires_parameters || 0,
          template_text || null,
          fileDataBuffer,
          parameter_mappings || null,
          restrictions || null,
          conflicts || null,
          dependencies || null,
          finalIsSystem
        );
      }

      return { success: true };
    } catch (error) {
      console.error('Error saving extra patch:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Delete extra patch
   * Channel: extra-patches:delete
   */
  ipcMain.handle('extra-patches:delete', async (_event, { epuuid }) => {
    try {
      if (!epuuid) {
        return { success: false, error: 'Missing epuuid' };
      }

      const db = dbManager.getConnection('rhdata');
      
      // Check if it's a system patch
      const patch = db.prepare('SELECT is_system FROM extrapatches WHERE epuuid = ?').get(epuuid);
      if (!patch) {
        return { success: false, error: 'Patch not found' };
      }
      
      if (patch.is_system && !isDevAdmin()) {
        return { success: false, error: 'Cannot delete system patches. Set DEVADMIN=1 to enable deletion.' };
      }

      const stmt = db.prepare('DELETE FROM extrapatches WHERE epuuid = ?');
      const result = stmt.run(epuuid);

      if (result.changes === 0) {
        return { success: false, error: 'Patch not found' };
      }

      return { success: true };
    } catch (error) {
      console.error('Error deleting extra patch:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Check if DEVADMIN mode is enabled
   * Channel: extra-patches:is-dev-admin
   */
  ipcMain.handle('extra-patches:is-dev-admin', async () => {
    const result = isDevAdmin();
    console.log('[isDevAdmin] Checking DEVADMIN:', {
      env: process.env.DEVADMIN,
      csetting: getClientSetting('DEVADMIN'),
      result
    });
    return { isDevAdmin: result };
  });

  /**
   * Get all presets (user and system)
   * Channel: extra-patches:get-presets
   */
  ipcMain.handle('extra-patches:get-presets', async () => {
    try {
      const db = dbManager.getConnection('clientdata');
      const presets = db.prepare(`
        SELECT * FROM extrapatchpresets 
        ORDER BY is_system DESC, preset_name ASC
      `).all();
      return { success: true, presets };
    } catch (error) {
      console.error('Error getting presets:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Save preset (create or update)
   * Channel: extra-patches:save-preset
   */
  ipcMain.handle('extra-patches:save-preset', async (_event, params) => {
    try {
      const {
        preset_uuid,
        preset_name,
        selected_patches,
        global_onoffv,
        patch_variables,
        is_system
      } = params;

      if (!preset_name) {
        return { success: false, error: 'Missing preset_name' };
      }

      // Only allow system presets if DEVADMIN
      const finalIsSystem = (isDevAdmin() && is_system) ? 1 : 0;

      const db = dbManager.getConnection('clientdata');
      
      if (preset_uuid) {
        // Update existing preset
        const existing = db.prepare('SELECT is_system FROM extrapatchpresets WHERE preset_uuid = ?').get(preset_uuid);
        if (existing && existing.is_system && !isDevAdmin()) {
          return { success: false, error: 'Cannot modify system presets. Set DEVADMIN=1 to enable editing.' };
        }

        const stmt = db.prepare(`
          UPDATE extrapatchpresets SET
            preset_name = ?,
            selected_patches = ?,
            global_onoffv = ?,
            patch_variables = ?,
            is_system = ?,
            updated_at = CURRENT_TIMESTAMP
          WHERE preset_uuid = ?
        `);
        
        stmt.run(
          preset_name,
          JSON.stringify(selected_patches || []),
          JSON.stringify(global_onoffv || []),
          JSON.stringify(patch_variables || {}),
          finalIsSystem,
          preset_uuid
        );
      } else {
        // Insert new preset
        const stmt = db.prepare(`
          INSERT INTO extrapatchpresets (
            preset_name, selected_patches, global_onoffv, patch_variables, is_system
          ) VALUES (?, ?, ?, ?, ?)
        `);
        
        stmt.run(
          preset_name,
          JSON.stringify(selected_patches || []),
          JSON.stringify(global_onoffv || []),
          JSON.stringify(patch_variables || {}),
          finalIsSystem
        );
      }

      return { success: true };
    } catch (error) {
      console.error('Error saving preset:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Delete preset
   * Channel: extra-patches:delete-preset
   */
  ipcMain.handle('extra-patches:delete-preset', async (_event, { preset_uuid }) => {
    try {
      if (!preset_uuid) {
        return { success: false, error: 'Missing preset_uuid' };
      }

      const db = dbManager.getConnection('clientdata');
      
      // Check if it's a system preset
      const preset = db.prepare('SELECT is_system FROM extrapatchpresets WHERE preset_uuid = ?').get(preset_uuid);
      if (!preset) {
        return { success: false, error: 'Preset not found' };
      }
      
      if (preset.is_system && !isDevAdmin()) {
        return { success: false, error: 'Cannot delete system presets. Set DEVADMIN=1 to enable deletion.' };
      }

      const stmt = db.prepare('DELETE FROM extrapatchpresets WHERE preset_uuid = ?');
      const result = stmt.run(preset_uuid);

      if (result.changes === 0) {
        return { success: false, error: 'Preset not found' };
      }

      return { success: true };
    } catch (error) {
      console.error('Error deleting preset:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Get game stages for a game
   * Channel: gamestages:get
   */
  ipcMain.handle('gamestages:get', async (_event, { gameid, version }) => {
    try {
      const db = dbManager.getConnection('rhdata');
      
      // Get stages for this gameid that match the version pattern
      const stages = db.prepare(`
        SELECT * FROM gamestages 
        WHERE gameid = ?
        ORDER BY levelnumber ASC, levelname ASC
      `).all(gameid);
      
      // Filter by version if provided
      let filteredStages = stages;
      if (version !== undefined && version !== null) {
        filteredStages = stages.filter(stage => {
          const versionPattern = stage.versions || '*';
          return matchesVersionPattern(version, versionPattern);
        });
      }
      
      return { success: true, stages: filteredStages };
    } catch (error) {
      console.error('[gamestages:get] Failed:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Save game stage (create or update)
   * Channel: gamestages:save
   */
  ipcMain.handle('gamestages:save', async (_event, params) => {
    try {
      const {
        stage_uuid,
        gameid,
        levelnumber,
        levelname,
        versions,
        submapid,
        translevel_13bf,
        tile_x,
        tile_y,
        tile_value,
        requisites,
        playable,
        rando,
        difficulty,
        mainexit,
        keyhole,
        credits,
        water,
        ghouse,
        spalace,
        castle,
        boss,
        secret,
        troll,
        final,
        lock,
        playlevel_patch_code,
        extradescription,
        stagetags,
        isDraftSubmission
      } = params;

      if (!gameid || !levelname) {
        return { success: false, error: 'Missing required fields: gameid, levelname' };
      }

      // Check DEVADMIN mode - only skip check if saving for a draft submission (though draft submissions
      // should not be calling this handler anymore since they work exclusively with draft data)
      if (1 || !isDraftSubmission) {
        const isDevAdmin = process.env.DEVADMIN === '1' || getClientSetting('DEVADMIN') === '1';
        if (!isDevAdmin) {
          return { success: false, error: 'Gamestages can only be edited in DEVADMIN mode. Set DEVADMIN=1 or set csetting DEVADMIN=1' };
        }
      }

      const db = dbManager.getConnection('rhdata');
      
      // Normalize levelnumber and translevel as hex strings
      let normalizedLevelnumber = levelnumber;
      if (normalizedLevelnumber && typeof normalizedLevelnumber === 'string') {
        // Ensure it's a valid hex string, normalize format
        const parsed = parseInt(normalizedLevelnumber.trim(), 16);
        if (!isNaN(parsed)) {
          // Clamp to valid range 0-0x14C
          const clamped = Math.max(0, Math.min(0x14C, parsed));
          normalizedLevelnumber = clamped.toString(16).toUpperCase().padStart(3, '0');
        } else {
          normalizedLevelnumber = null;
        }
      } else if (normalizedLevelnumber !== null && normalizedLevelnumber !== undefined) {
        // Handle legacy numeric values (shouldn't happen, but be safe)
        const num = typeof normalizedLevelnumber === 'number' ? normalizedLevelnumber : parseInt(String(normalizedLevelnumber), 10);
        if (!isNaN(num)) {
          const clamped = Math.max(0, Math.min(0x14C, num));
          normalizedLevelnumber = clamped.toString(16).toUpperCase().padStart(3, '0');
        } else {
          normalizedLevelnumber = null;
        }
      }

      // Calculate translevel_13bf from levelnumber if not provided
      // Inverse of: if translevel > 0x24, then level number = translevel + 0xDC
      // So the mapping is:
      //   - translevel 0x00-0x24 -> level number 0x00-0x24
      //   - translevel 0x25-0xFF -> level number 0x101-0x1DB (translevel + 0xDC)
      // The inverse mapping:
      //   - If level number <= 0x24, then translevel = level number
      //   - If level number >= 0x101, then translevel = level number - 0xDC
      //   - Level numbers 0x25-0x100 are not valid (gap in mapping)
      let calculatedTranslevel = translevel_13bf;
      if (!calculatedTranslevel && normalizedLevelnumber) {
        // Parse hex string to number for calculation
        const levelnum = parseInt(normalizedLevelnumber, 16);
        if (!isNaN(levelnum)) {
          let translevel;
          if (levelnum <= 0x24) {
            // Level number <= 0x24: translevel = level number
            translevel = levelnum;
            calculatedTranslevel = translevel.toString(16).toUpperCase().padStart(2, '0');
          } else if (levelnum >= 0x101) {
            // Level number >= 0x101: translevel = level number - 0xDC
            translevel = levelnum - 0xDC;
            // Ensure translevel is valid (0x25 to 0xFF)
            if (translevel >= 0x25 && translevel <= 0xFF) {
              // Return as hex string, padded to 2 digits
              calculatedTranslevel = translevel.toString(16).toUpperCase().padStart(2, '0');
            } else {
              // Invalid mapping, use null
              calculatedTranslevel = null;
            }
          } else {
            // Level numbers 0x25-0x100 are in the gap and don't map to valid translevels
            calculatedTranslevel = null;
          }
        }
      } else if (calculatedTranslevel && typeof calculatedTranslevel === 'string') {
        // Normalize translevel hex string
        const parsed = parseInt(calculatedTranslevel.trim(), 16);
        if (!isNaN(parsed)) {
          calculatedTranslevel = parsed.toString(16).toUpperCase().padStart(2, '0');
        } else {
          calculatedTranslevel = null;
        }
      }

      if (stage_uuid) {
        // Update existing stage
        const stmt = db.prepare(`
          UPDATE gamestages SET
            gameid = ?,
            levelnumber = ?,
            levelname = ?,
            versions = ?,
            submapid = ?,
            translevel_13bf = ?,
            tile_x = ?,
            tile_y = ?,
            tile_value = ?,
            requisites = ?,
            playable = ?,
            rando = ?,
            difficulty = ?,
            mainexit = ?,
            keyhole = ?,
            credits = ?,
            water = ?,
            ghouse = ?,
            spalace = ?,
            castle = ?,
            boss = ?,
            secret = ?,
            troll = ?,
            final = ?,
            lock = ?,
            playlevel_patch_code = ?,
            extradescription = ?,
	    stagetags = ?,
            updated_at = CURRENT_TIMESTAMP
          WHERE stage_uuid = ?
        `);
        
        stmt.run(
          gameid,
          normalizedLevelnumber || null,
          levelname,
          versions || '*',
          submapid || null,
          calculatedTranslevel || null,
          tile_x || null,
          tile_y || null,
          tile_value || null,
          requisites || null,
          playable ? 1 : 0,
          rando ? 1 : 0,
          difficulty || 0,
          mainexit ? 1 : 0,
          keyhole ? 1 : 0,
          credits ? 1 : 0,
          water !== undefined ? (water ? 1 : 0) : 0,
          ghouse ? 1 : 0,
          spalace ? 1 : 0,
          castle ? 1 : 0,
          boss ? 1 : 0,
          secret ? 1 : 0,
          troll ? 1 : 0,
          final ? 1 : 0,
          lock ? 1 : 0,
          playlevel_patch_code || null,
          extradescription || null,
          stagetags || null,
          stage_uuid
        );
      } else {
        // Insert new stage
        const stmt = db.prepare(`
          INSERT INTO gamestages (
            gameid, levelnumber, levelname, versions, submapid, translevel_13bf,
            tile_x, tile_y, tile_value,
            requisites, playable, rando, difficulty,
            mainexit, keyhole, credits, water, ghouse, spalace, castle, boss, secret, troll, final, lock, playlevel_patch_code, extradescription, stagetags
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        
        stmt.run(
          gameid,
          normalizedLevelnumber || null,
          levelname,
          versions || '*',
          submapid || null,
          calculatedTranslevel || null,
          tile_x || null,
          tile_y || null,
          tile_value || null,
          requisites || null,
          playable ? 1 : 0,
          rando ? 1 : 0,
          difficulty || 0,
          mainexit ? 1 : 0,
          keyhole ? 1 : 0,
          credits ? 1 : 0,
          water !== undefined ? (water ? 1 : 0) : 0,
          ghouse ? 1 : 0,
          spalace ? 1 : 0,
          castle ? 1 : 0,
          boss ? 1 : 0,
          secret ? 1 : 0,
          troll ? 1 : 0,
          final ? 1 : 0,
          lock ? 1 : 0,
          playlevel_patch_code || null,
          extradescription || null,
	  stagetags || null
        );
      }

      return { success: true };
    } catch (error) {
      console.error('[gamestages:save] Failed:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Get detected levels for a game
   * Channel: gamestages:get-detected-levels
   */
  ipcMain.handle('gamestages:get-detected-levels', async (_event, { gameid, version }) => {
    try {
      const db = dbManager.getConnection('rhdata');
      
      // Get game info
      const gameInfo = db.prepare(`
        SELECT gvuuid, name, lmlevels, detectedlevels
        FROM gameversions
        WHERE gameid = ? AND (version = ? OR ? IS NULL)
        ORDER BY version DESC
        LIMIT 1
      `).get(gameid, version || null, version || null);
      
      if (!gameInfo) {
        return { success: false, error: 'Game not found' };
      }
      
      const detectedLevelsMap = new Map();
      
      // Source 1: Parse lmlevels JSON array (most reliable)
      if (gameInfo.lmlevels) {
        try {
          const lmlevelsArray = JSON.parse(gameInfo.lmlevels);
          if (Array.isArray(lmlevelsArray)) {
            for (const levelHex of lmlevelsArray) {
              // Remove "0x" prefix if present and normalize to 3-digit hex
              const normalized = levelHex.replace(/^0x/i, '').trim().toUpperCase().padStart(3, '0');
              if (!detectedLevelsMap.has(normalized)) {
                detectedLevelsMap.set(normalized, {
                  levelnumber: normalized,
                  levelname: null,
                  translevel: null,
                  submapid: null,
                  tile_x: null,
                  tile_y: null,
                  tile_value: null,
                  sources: [],
                  sourceCount: 0,
                });
              }
              const level = detectedLevelsMap.get(normalized);
              if (!level.sources.includes('lmlevels')) {
                level.sources.push('lmlevels');
                level.sourceCount++;
              }
            }
          }
        } catch (e) {
          console.warn('[gamestages:get-detected-levels] Failed to parse lmlevels:', e);
        }
      }
      
      // Source 2: Parse detectedlevels JSON array
      if (gameInfo.detectedlevels) {
        try {
          const detectedArray = JSON.parse(gameInfo.detectedlevels);
          if (Array.isArray(detectedArray)) {
            for (const levelHex of detectedArray) {
              const normalized = levelHex.replace(/^0x/i, '').trim().toUpperCase().padStart(3, '0');
              if (!detectedLevelsMap.has(normalized)) {
                detectedLevelsMap.set(normalized, {
                  levelnumber: normalized,
                  levelname: null,
                  translevel: null,
                  submapid: null,
                  tile_x: null,
                  tile_y: null,
                  tile_value: null,
                  sources: [],
                  sourceCount: 0,
                });
              }
              const level = detectedLevelsMap.get(normalized);
              if (!level.sources.includes('detect')) {
                level.sources.push('detect');
                level.sourceCount++;
              }
            }
          }
        } catch (e) {
          console.warn('[gamestages:get-detected-levels] Failed to parse detectedlevels:', e);
        }
      }
      
      // Source 3: Fetch from gameversions_translevels table
      const translevels = db.prepare(`
        SELECT DISTINCT t.translevel, t.level_number, t.locations
        FROM gameversions_translevels t
        JOIN gameversions gv ON t.gvuuid = gv.gvuuid
        WHERE gv.gameid = ? AND (gv.version = ? OR ? IS NULL)
      `).all(gameid, version || null, version || null);
      
      for (const trans of translevels) {
        if (trans.level_number) {
          const normalized = trans.level_number.replace(/^0x/i, '').trim().toUpperCase().padStart(3, '0');
          if (!detectedLevelsMap.has(normalized)) {
            detectedLevelsMap.set(normalized, {
              levelnumber: normalized,
              levelname: null,
              translevel: trans.translevel || null,
              submapid: null,
              tile_x: null,
              tile_y: null,
              tile_value: null,
              sources: [],
              sourceCount: 0,
            });
          }
          const level = detectedLevelsMap.get(normalized);
          if (!level.sources.includes('trans')) {
            level.sources.push('trans');
            level.sourceCount++;
          }
          // Update translevel if available
          if (trans.translevel && !level.translevel) {
            level.translevel = trans.translevel;
          }
          // Parse locations for tile_x and tile_y if available
          if (trans.locations) {
            try {
              const locations = JSON.parse(trans.locations);
              if (Array.isArray(locations) && locations.length > 0) {
                const firstLoc = locations[0];
                if (firstLoc.x !== undefined && !level.tile_x) {
                  level.tile_x = String(firstLoc.x);
                }
                if (firstLoc.y !== undefined && !level.tile_y) {
                  level.tile_y = String(firstLoc.y);
                }
              }
            } catch (e) {
              // Ignore parsing errors
            }
          }
        }
      }
      
      // Source 4: Fetch from levelnames table
      const levelnames = db.prepare(`
        SELECT ln.levelid, ln.levelname
        FROM levelnames ln
        JOIN gameversion_levelnames gvn ON ln.lvluuid = gvn.lvluuid
        JOIN gameversions gv ON gvn.gvuuid = gv.gvuuid
        WHERE gv.gameid = ? AND (gv.version = ? OR ? IS NULL)
      `).all(gameid, version || null, version || null);
      
      for (const ln of levelnames) {
        if (ln.levelid) {
          const normalized = ln.levelid.replace(/^0x/i, '').trim().toUpperCase().padStart(3, '0');
          if (!detectedLevelsMap.has(normalized)) {
            detectedLevelsMap.set(normalized, {
              levelnumber: normalized,
              levelname: null,
              translevel: null,
              submapid: null,
              tile_x: null,
              tile_y: null,
              tile_value: null,
              sources: [],
              sourceCount: 0,
            });
          }
          const level = detectedLevelsMap.get(normalized);
          if (!level.sources.includes('levelnames')) {
            level.sources.push('levelnames');
            level.sourceCount++;
          }
          // Update levelname if available
          if (ln.levelname && !level.levelname) {
            level.levelname = ln.levelname;
          }
        }
      }
      
      // Convert map to array and sort by levelnumber
      const levelsArray = Array.from(detectedLevelsMap.values()).sort((a, b) => {
        const aNum = parseInt(a.levelnumber, 16);
        const bNum = parseInt(b.levelnumber, 16);
        return aNum - bNum;
      });
      
      return { 
        success: true, 
        levels: levelsArray,
        gameName: gameInfo.name || ''
      };
    } catch (error) {
      console.error('[gamestages:get-detected-levels] Failed:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Delete game stage
   * Channel: gamestages:delete
   */
  ipcMain.handle('gamestages:delete', async (_event, { stage_uuid }) => {
    try {
      if (!stage_uuid) {
        return { success: false, error: 'Missing stage_uuid' };
      }

      // Check DEVADMIN mode
      const isDevAdmin = process.env.DEVADMIN === '1' || getClientSetting('DEVADMIN') === '1';
      if (!isDevAdmin) {
        return { success: false, error: 'Gamestages can only be deleted in DEVADMIN mode. Set DEVADMIN=1 or set csetting DEVADMIN=1' };
      }

      const db = dbManager.getConnection('rhdata');
      const stmt = db.prepare('DELETE FROM gamestages WHERE stage_uuid = ?');
      const result = stmt.run(stage_uuid);

      if (result.changes === 0) {
        return { success: false, error: 'Stage not found' };
      }

      return { success: true };
    } catch (error) {
      console.error('[gamestages:delete] Failed:', error);
      return { success: false, error: error.message };
    }
  });

  // Helper function to match version patterns
  function matchesVersionPattern(version, pattern) {
    if (!pattern || pattern === '*') {
      return true;
    }
    
    const patterns = pattern.split(',').map(p => p.trim());
    
    for (const p of patterns) {
      if (p === '*') {
        return true;
      }
      
      if (p.startsWith('!')) {
        // Exclusion pattern: !3 means not version 3
        const excludeVersion = parseInt(p.slice(1), 10);
        if (version === excludeVersion) {
          return false;
        }
      } else if (p.startsWith('>')) {
        // Greater than: >3 means versions greater than 3
        const minVersion = parseInt(p.slice(1), 10);
        if (version > minVersion) {
          return true;
        }
      } else {
        // Exact match
        const exactVersion = parseInt(p, 10);
        if (version === exactVersion) {
          return true;
        }
      }
    }
    
    return false;
  }

  /**
   * Upload run files to USB2SNES subdirectory
   * Channel: db:runs:upload-to-snes
   */
  ipcMain.handle('db:runs:upload-to-snes', async (event, { runUuid, runFolderPath }) => {
    try {
      const fs = require('fs');
      const path = require('path');
      const db = dbManager.getConnection('clientdata');
      
      // Get run info
      const run = db.prepare(`SELECT run_name FROM runs WHERE run_uuid = ?`).get(runUuid);
      if (!run) {
        return { success: false, error: 'Run not found' };
      }
      
      // Generate subdirectory name: runYYMMDD_HHMM
      const now = new Date();
      const dateStr = now.toISOString().slice(2, 10).replace(/-/g, '');  // YYMMDD
      const timeStr = now.toTimeString().slice(0, 5).replace(/:/g, '');  // HHMM
      const subDirName = `run${dateStr}_${timeStr}`;
      const snesPath = `/work/${subDirName}`;
      
      // Get USB2SNES wrapper
      let wrapper = getSnesWrapper();
      
      console.log('[Upload Run] Wrapper:', !!wrapper);
      console.log('[Upload Run] isAttached:', wrapper ? wrapper.isAttached() : 'N/A');
      console.log('[Upload Run] getState:', wrapper ? wrapper.getState() : 'N/A');
      console.log('[Upload Run] hasImplementation:', wrapper ? wrapper.hasImplementation() : 'N/A');
      
      // Check connection status - attempt reconnect if not connected
      if (!wrapper || !wrapper.isAttached()) {
        console.log('[Upload Run] USB2SNES not connected, attempting to reconnect...');
        
        // Get USB2SNES settings
        const usb2snesEnabled = getClientSetting('usb2snesEnabled') === '1';
        if (!usb2snesEnabled) {
          return { success: false, error: 'USB2SNES is disabled in settings' };
        }
        
        const usb2snesLibrary = getClientSetting('usb2snesLibrary') || 'usb2snes_a';
        const usb2snesAddress = getClientSetting('usb2snesAddress') || 'ws://localhost:64213';
        const proxyMode = getClientSetting('usb2snesProxyMode') || 'none';
        
        // Build connection options
        const connectOptions = {
          library: usb2snesLibrary,
          address: usb2snesAddress,
          proxyMode: proxyMode !== 'none' ? proxyMode : undefined
        };
        
        // Add proxy-specific options if needed
        if (proxyMode === 'ssh') {
          const sshRemotePort = getClientSetting('usb2snesSshRemotePort');
          if (sshRemotePort) {
            connectOptions.ssh = { remotePort: parseInt(sshRemotePort, 10) };
          }
        } else if (proxyMode === 'socks') {
          const socksProxyUrl = getClientSetting('usb2snesSocksProxyUrl');
          if (socksProxyUrl) {
            connectOptions.socksProxyUrl = socksProxyUrl;
          }
        }
        
        try {
          // Attempt to connect
          await wrapper.fullConnect(usb2snesLibrary, connectOptions);
          
          // Wait a moment for connection to establish
          await new Promise(resolve => setTimeout(resolve, 500));
          
          // Re-check connection status
          wrapper = getSnesWrapper();
          if (!wrapper || !wrapper.isAttached()) {
            return { success: false, error: `USB2SNES reconnection failed. State: ${wrapper ? wrapper.getState() : 'no wrapper'}, Attached: ${wrapper ? wrapper.isAttached() : 'N/A'}` };
          }
          
          console.log('[Upload Run] USB2SNES reconnected successfully');
        } catch (connectError) {
          console.error('[Upload Run] Reconnection error:', connectError);
          return { success: false, error: `USB2SNES reconnection failed: ${connectError.message}` };
        }
      }
      
      // Create the run subdirectory ONCE before uploading files
      // First check if it already exists by listing parent directory
      console.log(`[Upload Run] Checking if directory exists: ${snesPath}`);
      try {
        const workListing = await wrapper.List('/work');
        const dirExists = workListing && workListing.some(item => 
          item.type === 1 && item.filename === subDirName
        );
        
        if (dirExists) {
          console.log(`[Upload Run] Directory already exists: ${snesPath}`);
          // Add to cache even if it already exists
          if (wrapper.implementationInstance && wrapper.implementationInstance.createdDirectories) {
            wrapper.implementationInstance.createdDirectories.add(snesPath);
            console.log(`[Upload Run] Added existing directory to cache: ${snesPath}`);
          }
        } else {
          console.log(`[Upload Run] Creating directory: ${snesPath}`);
          
          // Access _mkdir through the implementation
          if (!wrapper.implementationInstance || !wrapper.implementationInstance._mkdir) {
            return { success: false, error: 'USB2SNES implementation not available' };
          }
          
          await wrapper.implementationInstance._mkdir(snesPath);
          console.log(`[Upload Run] Directory creation command sent`);
          
          // Wait a bit for the command to process
          await new Promise(resolve => setTimeout(resolve, 200));
          
          // Check if connection survived
          if (!wrapper.isAttached()) {
            return { success: false, error: `Failed to create directory ${snesPath} - server closed connection` };
          }
          
          console.log(`[Upload Run] Directory created: ${snesPath}`);
        }
      } catch (dirError) {
        console.error(`[Upload Run] Directory setup failed:`, dirError);
        return { success: false, error: `Cannot prepare directory: ${dirError.message}` };
      }
      
      // Get list of SFC files to upload
      const files = fs.readdirSync(runFolderPath).filter(f => f.endsWith('.sfc')).sort();
      
      if (files.length === 0) {
        return { success: false, error: 'No .sfc files found in run folder' };
      }
      
      // Add directory to cache so preemptiveDirCreate skips it (even after reconnects)
      if (wrapper.implementationInstance && wrapper.implementationInstance.createdDirectories) {
        wrapper.implementationInstance.createdDirectories.add(snesPath);
        console.log(`[Upload Run] Added ${snesPath} to directory cache`);
      }
      
      console.log(`[Upload Run] Uploading ${files.length} files to ${snesPath}`);
      
      // Upload each file with progress tracking
      let uploadedCount = 0;
      for (let i = 0; i < files.length; i++) {
        const filename = files[i];
        const srcPath = path.join(runFolderPath, filename);
        const dstPath = `${snesPath}/${filename}`;
        
        console.log(`[Upload Run] Uploading ${i + 1}/${files.length}: ${filename}`);
        console.log(`[Upload Run]   Source: ${srcPath}`);
        console.log(`[Upload Run]   Destination: ${dstPath}`);
        event.sender.send('run-upload-progress', { current: i + 1, total: files.length, filename });
        
        // Check connection before each upload
        if (!wrapper.isAttached()) {
          console.warn(`[Upload Run]   Connection lost before file ${i + 1}, attempting reconnect...`);
          
          // Try to reconnect
          try {
            const library = wrapper.getImplementationType() || 'usb2snes_a';
            const address = 'ws://localhost:64213';
            await wrapper.fullConnect(library, address);
            console.log(`[Upload Run]   ✓ Reconnected successfully`);
            
            // After reconnect, re-add directory to cache to prevent re-creation attempts
            if (wrapper.implementationInstance && wrapper.implementationInstance.createdDirectories) {
              wrapper.implementationInstance.createdDirectories.add(snesPath);
              console.log(`[Upload Run]   Re-added ${snesPath} to directory cache after reconnect`);
            }
          } catch (reconnectError) {
            console.error(`[Upload Run]   ✗ Reconnect failed:`, reconnectError);
            return {
              success: false,
              error: `Connection lost before file ${i + 1}/${files.length} and reconnect failed. Uploaded ${uploadedCount}/${files.length} files.`,
              filesUploaded: uploadedCount
            };
          }
        }
        
        try {
          const uploadResult = await wrapper.PutFile(srcPath, dstPath);
          console.log(`[Upload Run]   Result:`, uploadResult);
          
          if (uploadResult === false || uploadResult === null) {
            // Upload failed, connection might be lost
            console.error(`[Upload Run]   Upload returned false/null for ${filename}`);
            return { 
              success: false, 
              error: `Upload failed at file ${i + 1}/${files.length}: ${filename}. PutFile returned ${uploadResult}.`,
              filesUploaded: uploadedCount
            };
          }
          
          console.log(`[Upload Run]   ✓ Upload successful for ${filename}`);
          uploadedCount++;
        } catch (uploadError) {
          console.error(`[Upload Run]   Upload threw error for ${filename}:`, uploadError);
          return {
            success: false,
            error: `Upload error at file ${i + 1}/${files.length}: ${filename}. ${uploadError.message}`,
            filesUploaded: uploadedCount
          };
        }
      }
      
      // Update run_results with sfcpath (relative path for each game)
      const expandedResults = db.prepare(`
        SELECT result_uuid, sequence_number FROM run_results 
        WHERE run_uuid = ? 
        ORDER BY sequence_number
      `).all(runUuid);
      
      const updateStmt = db.prepare(`UPDATE run_results SET sfcpath = ? WHERE result_uuid = ?`);
      expandedResults.forEach((result, idx) => {
        if (idx < files.length) {
          const sfcpath = `${subDirName}/${files[idx]}`;
          updateStmt.run(sfcpath, result.result_uuid);
        }
      });
      
      console.log(`[Upload Run] Upload complete: ${uploadedCount} files to ${snesPath}`);
      
      return { 
        success: true, 
        filesUploaded: uploadedCount,
        snesPath: snesPath
      };
    } catch (error) {
      console.error('[Upload Run] Error:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Update sfcPath in run_results based on file mappings from USB2SNES
   * Channel: db:runs:update-sfcpath
   */
  ipcMain.handle('db:runs:update-sfcpath', async (event, { runUuid, fileMappings }) => {
    try {
      const db = dbManager.getConnection('clientdata');
      
      // Get expanded results to match filenames
      const results = db.prepare(`
        SELECT result_uuid, sequence_number FROM run_results 
        WHERE run_uuid = ? 
        ORDER BY sequence_number
      `).all(runUuid);
      
      if (results.length === 0) {
        return { success: false, error: 'No run results found' };
      }
      
      // Get current sfcpath values to check what's already set
      const currentSfcPaths = db.prepare(`
        SELECT result_uuid, sfcpath FROM run_results 
        WHERE run_uuid = ?
      `).all(runUuid);
      
      const currentSfcPathMap = new Map(currentSfcPaths.map((r) => [r.result_uuid, r.sfcpath]));
      const usedPaths = new Set();
      
      const updateStmt = db.prepare(`UPDATE run_results SET sfcpath = ? WHERE result_uuid = ?`);
      let updatedCount = 0;
      
      // Try to match files by sequence number (assuming files are named like 01.sfc, 02.sfc, etc.)
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const seqNum = i + 1;
        
        // Try to find matching file by sequence number pattern
        const seqPatterns = [
          String(seqNum).padStart(2, '0') + '.sfc',
          String(seqNum).padStart(3, '0') + '.sfc',
          seqNum + '.sfc'
        ];
        
        let matched = false;
        for (const pattern of seqPatterns) {
          if (fileMappings[pattern] && !usedPaths.has(fileMappings[pattern])) {
            updateStmt.run(fileMappings[pattern], result.result_uuid);
            usedPaths.add(fileMappings[pattern]);
            updatedCount++;
            matched = true;
            break;
          }
        }
        
        // If no match by sequence, try to match by any unmatched file
        if (!matched) {
          for (const [filename, path] of Object.entries(fileMappings)) {
            if (!usedPaths.has(path)) {
              updateStmt.run(path, result.result_uuid);
              usedPaths.add(path);
              updatedCount++;
              break;
            }
          }
        }
      }
      
      console.log(`[Update SfcPath] Updated ${updatedCount} of ${results.length} results`);
      
      return { 
        success: true, 
        updatedCount: updatedCount,
        totalResults: results.length
      };
    } catch (error) {
      console.error('[Update SfcPath] Error:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Reveal a random challenge (select and update with actual game)
   * Channel: db:runs:reveal-challenge
   */
  ipcMain.handle('db:runs:reveal-challenge', async (event, { runUuid, resultUuid, revealedEarly }) => {
    try {
      const db = dbManager.getConnection('clientdata');
      
      // Get the result and its plan entry
      const result = db.prepare(`
        SELECT rr.*, rpe.filter_type, rpe.filter_difficulty, rpe.filter_pattern, rpe.filter_seed
        FROM run_results rr
        JOIN run_plan_entries rpe ON rr.plan_entry_uuid = rpe.entry_uuid
        WHERE rr.result_uuid = ?
      `).get(resultUuid);
      
      if (!result) {
        throw new Error('Challenge not found');
      }
      
      if (!result.was_random) {
        // Not a random challenge, nothing to reveal
        return { 
          success: true, 
          gameid: result.gameid, 
          gameName: result.game_name 
        };
      }
      
      if (result.gameid) {
        // Already revealed
        return { 
          success: true, 
          gameid: result.gameid, 
          gameName: result.game_name,
          alreadyRevealed: true
        };
      }
      
      // Get already used gameids in this run to avoid duplicates
      const usedGames = db.prepare(`
        SELECT gameid FROM run_results 
        WHERE run_uuid = ? AND gameid IS NOT NULL
      `).all(runUuid).map(r => r.gameid);
      
      // Select random game
      // Parse game filter difficulty from plan entry
      // For backwards compatibility, if game_filter_min_difficulty/game_filter_max_difficulty exist, use those
      // Otherwise, fall back to filter_difficulty for exact match
      let gameMinDifficulty = null;
      let gameMaxDifficulty = null;
      
      // Get plan entry to check for game filter values
      const planEntry = db.prepare(`
        SELECT game_filter_min_difficulty, game_filter_max_difficulty, filter_difficulty
        FROM run_plan_entries
        WHERE run_uuid = ? AND sequence_number = ?
      `).get(runUuid, result.sequence_number);
      
      if (planEntry) {
        if (planEntry.game_filter_min_difficulty !== null && planEntry.game_filter_min_difficulty !== undefined) {
          gameMinDifficulty = planEntry.game_filter_min_difficulty;
        }
        if (planEntry.game_filter_max_difficulty !== null && planEntry.game_filter_max_difficulty !== undefined) {
          gameMaxDifficulty = planEntry.game_filter_max_difficulty;
        }
      }
      
      const selected = seedManager.selectRandomGame({
        dbManager,
        seed: result.filter_seed,
        challengeIndex: result.sequence_number,
        filterType: result.filter_type,
        filterDifficulty: result.filter_difficulty, // Legacy, kept for backwards compatibility
        filterPattern: result.filter_pattern,
        minDifficulty: gameMinDifficulty,
        maxDifficulty: gameMaxDifficulty,
        excludeGameids: usedGames
      });
      
      // Update run_results with selected game
      db.prepare(`
        UPDATE run_results
        SET gameid = ?,
            game_name = ?,
            revealed_early = ?,
            started_at = CURRENT_TIMESTAMP
        WHERE result_uuid = ?
      `).run(selected.gameid, selected.name, revealedEarly ? 1 : 0, resultUuid);
      
      console.log(`Revealed random challenge: ${selected.name} (${selected.gameid}), early=${revealedEarly}`);
      
      return { 
        success: true, 
        gameid: selected.gameid, 
        gameName: selected.name,
        gameType: selected.type,
        gameDifficulty: selected.difficulty
      };
    } catch (error) {
      console.error('Error revealing challenge:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Mark a challenge as revealed early (after using Back button)
   * Channel: db:runs:mark-revealed-early
   */
  ipcMain.handle('db:runs:mark-revealed-early', async (event, { runUuid, challengeIndex, revealedEarly }) => {
    try {
      const db = dbManager.getConnection('clientdata');
      
      // Get the result at this index
      const result = db.prepare(`
        SELECT result_uuid FROM run_results 
        WHERE run_uuid = ? 
        ORDER BY sequence_number 
        LIMIT 1 OFFSET ?
      `).get(runUuid, challengeIndex);
      
      if (!result) {
        throw new Error('Challenge not found at index ' + challengeIndex);
      }
      
      // Update revealed_early flag
      db.prepare(`
        UPDATE run_results
        SET revealed_early = ?
        WHERE result_uuid = ?
      `).run(revealedEarly ? 1 : 0, result.result_uuid);
      
      console.log(`Marked challenge ${challengeIndex + 1} as revealed_early=${revealedEarly}`);
      
      return { success: true };
    } catch (error) {
      console.error('Error marking challenge as revealed early:', error);
      return { success: false, error: error.message };
    }
  });

  // ===========================================================================
  // SEED MANAGEMENT OPERATIONS
  // ===========================================================================

  /**
   * Generate a new random seed with default mapping
   * Channel: db:seeds:generate
   */
  ipcMain.handle('db:seeds:generate', async (event) => {
    try {
      const defaultMapping = seedManager.getOrCreateDefaultMapping(dbManager);
      const seed = seedManager.generateSeedWithMap(defaultMapping.mapId);
      
      return { 
        success: true, 
        seed,
        mapId: defaultMapping.mapId,
        gameCount: defaultMapping.gameCount
      };
    } catch (error) {
      console.error('Error generating seed:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Get all available seed mappings
   * Channel: db:seeds:get-mappings
   */
  ipcMain.handle('db:seeds:get-mappings', async (event) => {
    try {
      const mappings = seedManager.getAllSeedMappings(dbManager);
      return mappings;
    } catch (error) {
      console.error('Error getting mappings:', error);
      throw error;
    }
  });
  /**
   * Validate a seed
   * Channel: db:seeds:validate
   */
  ipcMain.handle('db:seeds:validate', async (event, { seed }) => {
    try {
      const isValid = seedManager.validateSeed(dbManager, seed);
      
      if (isValid) {
        const { mapId } = seedManager.parseSeed(seed);
        const mapping = seedManager.getSeedMapping(dbManager, mapId);
        return { 
          valid: true, 
          mapId,
          gameCount: mapping ? mapping.gameCount : 0
        };
      }
      
      return { valid: false };
    } catch (error) {
      return { valid: false, error: error.message };
    }
  });

  /**
   * Export run with seed mappings
   * Channel: db:runs:export
   */
  ipcMain.handle('db:runs:export', async (event, { runUuid }) => {
    try {
      const exportData = seedManager.exportRun(dbManager, runUuid);
      return { success: true, data: exportData };
    } catch (error) {
      console.error('Error exporting run:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Import run with seed mappings
   * Channel: db:runs:import
   */
  ipcMain.handle('db:runs:import', async (event, { importData }) => {
    try {
      const result = seedManager.importRun(dbManager, importData);
      return result;
    } catch (error) {
      console.error('Error importing run:', error);
      return { success: false, error: error.message };
    }
  });

  // ===========================================================================
  // File Selection and Validation
  // ===========================================================================

  /**
   * Open file selection dialog
   * Channel: file:select
   */
  ipcMain.handle('file:select', async (event, options) => {
    console.log('[file:select] Handler called with options:', options);
    try {
      const { dialog, BrowserWindow } = require('electron');
      const win = BrowserWindow.fromWebContents(event.sender);
      
      console.log('[file:select] Showing dialog...');
      
      // Try with no parent first (for Linux compatibility)
      let result = await dialog.showOpenDialog(options);
      
      // If that didn't work and we have a window, try with parent
      if (!result || (result.canceled && result.filePaths.length === 0)) {
        console.log('[file:select] First attempt got no result, trying with parent window...');
        if (win) {
          result = await dialog.showOpenDialog(win, options);
        }
      }
      
      console.log('[file:select] Dialog result:', result);
      
      if (!result || result.canceled || result.filePaths.length === 0) {
        return { success: false, canceled: true };
      }
      
      return { success: true, filePath: result.filePaths[0] };
    } catch (error) {
      console.error('[file:select] Error selecting file:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Validate ROM file (SHA-224 hash check)
   * Channel: file:validate-rom
   */
  ipcMain.handle('file:validate-rom', async (event, { filePath }) => {
    try {
      const fs = require('fs');
      const crypto = require('crypto');
      
      if (!fs.existsSync(filePath)) {
        return { valid: false, error: 'File not found' };
      }
      
      // Expected SHA-224 hash for valid SMW ROM
      const EXPECTED_SHA224 = 'fdc4c00e09a8e08d395003e9c8a747f45a9e5e94cbfedc508458eb08';
      
      // Calculate SHA-224 hash
      const fileBuffer = fs.readFileSync(filePath);
      const hash = crypto.createHash('sha224').update(fileBuffer).digest('hex');
      
      if (hash === EXPECTED_SHA224) {
        return { valid: true, hash, filePath };
      } else {
        return { valid: false, error: `Invalid ROM hash. Expected: ${EXPECTED_SHA224}, Got: ${hash}` };
      }
    } catch (error) {
      console.error('Error validating ROM:', error);
      return { valid: false, error: error.message };
    }
  });

  /**
   * Validate FLIPS executable
   * Channel: file:validate-flips
   */
  ipcMain.handle('file:validate-flips', async (event, { filePath }) => {
    try {
      const fs = require('fs');
      const path = require('path');
      
      if (!fs.existsSync(filePath)) {
        return { valid: false, error: 'File not found' };
      }
      
      // Check if file is executable (Unix) or has .exe extension (Windows)
      const stats = fs.statSync(filePath);
      const isExecutable = (stats.mode & 0o111) !== 0 || path.extname(filePath).toLowerCase() === '.exe';
      
      if (!isExecutable) {
        return { valid: false, error: 'File is not executable' };
      }
      
      // Basic validation - check if file exists and is executable
      // More advanced validation would require actually running it
      return { valid: true, filePath };
    } catch (error) {
      console.error('Error validating FLIPS:', error);
      return { valid: false, error: error.message };
    }
  });

  /**
   * Validate directory path
   * Channel: file:validate-path
   */
  ipcMain.handle('file:validate-path', async (event, { filePath }) => {
    try {
      const fs = require('fs');
      
      if (!fs.existsSync(filePath)) {
        return { exists: false, isDirectory: false, error: 'Path not found' };
      }
      
      const stats = fs.statSync(filePath);
      return { exists: true, isDirectory: stats.isDirectory(), filePath };
    } catch (error) {
      console.error('Error validating path:', error);
      return { exists: false, isDirectory: false, error: error.message };
    }
  });

  /**
   * Validate ASAR executable
   * Channel: file:validate-asar
   */
  ipcMain.handle('file:validate-asar', async (event, { filePath }) => {
    try {
      const fs = require('fs');
      const path = require('path');
      
      if (!fs.existsSync(filePath)) {
        return { valid: false, error: 'File not found' };
      }
      
      // Check if file is executable
      const stats = fs.statSync(filePath);
      const isExecutable = (stats.mode & 0o111) !== 0 || path.extname(filePath).toLowerCase() === '.exe';
      
      if (!isExecutable) {
        return { valid: false, error: 'File is not executable' };
      }
      
      return { valid: true, filePath };
    } catch (error) {
      console.error('Error validating ASAR:', error);
      return { valid: false, error: error.message };
    }
  });
  /**
   * Validate UberASM executable
   * Channel: file:validate-uberasm
   */
  ipcMain.handle('file:validate-uberasm', async (event, { filePath }) => {
    try {
      const fs = require('fs');
      const path = require('path');
      
      if (!fs.existsSync(filePath)) {
        return { valid: false, error: 'File not found' };
      }
      
      // Check if file is executable
      const stats = fs.statSync(filePath);
      const isExecutable = (stats.mode & 0o111) !== 0 || path.extname(filePath).toLowerCase() === '.exe';
      
      if (!isExecutable) {
        return { valid: false, error: 'File is not executable' };
      }
      
      return { valid: true, filePath };
    } catch (error) {
      console.error('Error validating UberASM:', error);
      return { valid: false, error: error.message };
    }
  });

  // ===========================================================================
  // USB2SNES OPERATIONS
  // ===========================================================================

  const { SNESWrapper } = require('./main/usb2snes/SNESWrapper');
  
  // Global SNES wrapper instance (singleton pattern)
  let snesWrapper = null;
  
  /**
   * Get or create SNES wrapper instance
   * @private
   */
  function getSnesWrapper() {
    if (!snesWrapper) {
      snesWrapper = new SNESWrapper();
    }
    return snesWrapper;
  }

  /**
   * Connect to USB2SNES server
   * Channel: usb2snes:connect
   * @param {Object} options - Connection options (library, address, proxy)
   * @returns {Object} Connection info (device, firmware, etc.)
   */
  ipcMain.handle('usb2snes:connect', async (event, options = {}) => {
    try {
      const { library, proxyMode } = options;
      if (!library) {
        throw new Error('USB2SNES library not specified.');
      }

      if (proxyMode === 'ssh') {
        const sshStatus = sshManager.getStatus();
        if (!sshStatus.running) {
          throw new Error('SSH client is not running. Start the SSH client before connecting.');
        }
      }

      const wrapper = getSnesWrapper();
      const result = await wrapper.fullConnect(library, options);

      console.log('[USB2SNES] Connected successfully:', result);

      // Notify renderer that device is responding
      event.sender.send('usb2snes:operation-success');

      return {
        connected: true,
        device: result.device,
        devices: result.devices,
        firmwareVersion: result.info.firmwareversion || 'N/A',
        versionString: result.info.versionstring || 'N/A',
        romRunning: result.info.romrunning || 'N/A'
      };
    } catch (error) {
      console.error('[USB2SNES] Connection error:', error);
      throw error;
    }
  });

  ipcMain.handle('usb2snes:ssh-start', async (_event, config) => {
    try {
      const result = await sshManager.start(config || {});
      const status = sshManager.getStatus();
      broadcastUsb2snesSshStatus(status);

      if (result && result.manual) {
        dialog.showMessageBox({
          type: 'info',
          buttons: ['OK'],
          title: 'USB2SNES SSH Tunnel',
          message: 'SSH tunnel started',
          detail: 'Keep the SSH client terminal window open while the tunnel is active. Closing the window will stop the connection.'
        });
      }

      return { success: true, status };
    } catch (error) {
      console.error('[USB2SNES][SSH] Start error:', error);
      const status = sshManager.getStatus();
      broadcastUsb2snesSshStatus(status);
      return { success: false, error: error.message, status };
    }
  });

  ipcMain.handle('usb2snes:ssh-stop', async () => {
    try {
      const result = sshManager.stop();
      broadcastUsb2snesSshStatus(result.status);
      return result;
    } catch (error) {
      console.error('[USB2SNES][SSH] Stop error:', error);
      const status = sshManager.getStatus();
      broadcastUsb2snesSshStatus(status);
      return { success: false, error: error.message, status };
    }
  });

  ipcMain.handle('usb2snes:ssh-status', async () => {
    return sshManager.getStatus();
  });

  ipcMain.handle('usb2snes:ssh-console-history', async () => {
    return sshManager.getConsoleHistory();
  });
  // ===========================================================================
  // USB2SNES EMBEDDED SERVER (USBFXP) OPERATIONS
  // ===========================================================================

  ipcMain.handle('usb2snes:fxp-start', async (_event, config) => {
    try {
      const result = await usbfxpServer.start(config || {});
      const status = usbfxpServer.getStatus();
      broadcastUsb2snesFxpStatus(status);
      return { success: true, status };
    } catch (error) {
      console.error('[USB2SNES][FXP] Start error:', error);
      const status = usbfxpServer.getStatus();
      broadcastUsb2snesFxpStatus(status);
      return { success: false, error: error.message, status };
    }
  });

  ipcMain.handle('usb2snes:fxp-stop', async () => {
    try {
      const result = usbfxpServer.stop();
      broadcastUsb2snesFxpStatus(result.status);
      return result;
    } catch (error) {
      console.error('[USB2SNES][FXP] Stop error:', error);
      const status = usbfxpServer.getStatus();
      broadcastUsb2snesFxpStatus(status);
      return { success: false, error: error.message, status };
    }
  });
  ipcMain.handle('usb2snes:fxp-restart', async (_event, config) => {
    try {
      // Update config if provided
      if (config) {
        usbfxpServer.config = usbfxpServer._normalizeConfig(config);
      }
      const result = await usbfxpServer.restart();
      const status = usbfxpServer.getStatus();
      broadcastUsb2snesFxpStatus(status);
      return { success: true, status };
    } catch (error) {
      console.error('[USB2SNES][FXP] Restart error:', error);
      const status = usbfxpServer.getStatus();
      broadcastUsb2snesFxpStatus(status);
      return { success: false, error: error.message, status };
    }
  });

  ipcMain.handle('usb2snes:fxp-status', async () => {
    return usbfxpServer.getStatus();
  });
  ipcMain.handle('usb2snes:fxp-console-history', async () => {
    return usbfxpServer.getConsoleHistory();
  });

  /**
   * Check USB/serial device permissions
   * Channel: usb2snes:fxp-check-permissions
   * @returns {Promise<Object>} Permission check result
   */
  ipcMain.handle('usb2snes:fxp-check-permissions', async () => {
    const { checkUsbPermissions } = require('./main/usb2snes/usbPermissions');
    return await checkUsbPermissions();
  });

  /**
   * Grant dialout group permission using pkexec
   * Channel: usb2snes:fxp-grant-permission
   * @returns {Promise<{success: boolean, message: string, error?: string}>}
   */
  ipcMain.handle('usb2snes:fxp-grant-permission', async () => {
    const { grantDialoutPermission } = require('./main/usb2snes/usbPermissions');
    return await grantDialoutPermission();
  });
  /**
   * Disconnect from USB2SNES server
   * Channel: usb2snes:disconnect
   */
  ipcMain.handle('usb2snes:disconnect', async () => {
    try {
      const wrapper = getSnesWrapper();
      await wrapper.disconnect();
      
      console.log('[USB2SNES] Disconnected');
      
      return { connected: false };
    } catch (error) {
      console.error('[USB2SNES] Disconnect error:', error);
      throw error;
    }
  });
  /**
   * Get USB2SNES connection status
   * Channel: usb2snes:status
   */
  ipcMain.handle('usb2snes:status', async () => {
    try {
      const wrapper = getSnesWrapper();
      
      const status = {
        hasImplementation: wrapper.hasImplementation(),
        implementationType: wrapper.getImplementationType(),
        connected: wrapper.isConnected(),
        attached: wrapper.isAttached(),
        device: wrapper.getDevice(),
        state: wrapper.getState()
      };
      
      console.log('[USB2SNES] Status check:', status);
      return status;
    } catch (error) {
      console.error('[USB2SNES] Status error:', error);
      throw error;
    }
  });

  /**
   * Get SNES device information (firmware, ROM running, etc.)
   * Channel: usb2snes:info
   * @returns {Promise<Object|null>} Device info or null if not attached
   */
  ipcMain.handle('usb2snes:info', async () => {
    try {
      const wrapper = getSnesWrapper();
      
      if (!wrapper.isAttached()) {
        console.log('[USB2SNES] Info: Not attached');
        return null;
      }
      
      const info = await wrapper.Info();
      
      if (info) {
        console.log('[USB2SNES] Info:', {
          firmwareversion: info.firmwareversion,
          versionstring: info.versionstring,
          romrunning: info.romrunning
        });
      }
      
      return info;
    } catch (error) {
      console.error('[USB2SNES] Info error:', error);
      // Return null on error rather than throwing, to allow graceful handling
      return null;
    }
  });

  /**
   * Reset the console
   * Channel: usb2snes:reset
   */
  ipcMain.handle('usb2snes:reset', async (event) => {
    try {
      const wrapper = getSnesWrapper();
      await wrapper.Reset();
      
      console.log('[USB2SNES] Console reset');
      event.sender.send('usb2snes:operation-success');
      return { success: true };
    } catch (error) {
      console.error('[USB2SNES] Reset error:', error);
      throw error;
    }
  });

  /**
   * Return to menu
   * Channel: usb2snes:menu
   */
  ipcMain.handle('usb2snes:menu', async (event) => {
    try {
      const wrapper = getSnesWrapper();
      await wrapper.Menu();
      
      console.log('[USB2SNES] Returned to menu');
      event.sender.send('usb2snes:operation-success');
      return { success: true };
    } catch (error) {
      console.error('[USB2SNES] Menu error:', error);
      throw error;
    }
  });

  /**
   * Boot a ROM file
   * Channel: usb2snes:boot
   * @param {string} romPath - Path to ROM on console
   */
  ipcMain.handle('usb2snes:boot', async (event, romPath) => {
    try {
      const wrapper = getSnesWrapper();
      await wrapper.Boot(romPath);
      
      console.log('[USB2SNES] Booted ROM:', romPath);
      event.sender.send('usb2snes:operation-success');
      return { success: true };
    } catch (error) {
      console.error('[USB2SNES] Boot error:', error);
      throw error;
    }
  });

  /**
   * Show native file open dialog
   * Channel: dialog:showOpenDialog
   * @param {Object} options - Dialog options
   */
  ipcMain.handle('dialog:showOpenDialog', async (event, options) => {
    const { dialog } = require('electron');
    // Don't pass a parent window - this can cause freezing on some Linux systems
    return await dialog.showOpenDialog(options);
  });

  /**
   * Read directory contents
   * Channel: fs:readDirectory
   * @param {string} dirPath - Directory path
   */
  ipcMain.handle('fs:readDirectory', async (event, dirPath) => {
    const fs = require('fs').promises;
    try {
      const files = await fs.readdir(dirPath);
      return files;
    } catch (error) {
      console.error('[FS] Read directory error:', error);
      throw error;
    }
  });

  /**
   * Launch external program with file
   * Channel: fs:launchProgram
   * @param {string} program - Program path
   * @param {string} args - Arguments with %file placeholder
   * @param {string} filePath - File path to launch
   */
  ipcMain.handle('fs:launchProgram', async (event, program, args, filePath) => {
    const { spawn } = require('child_process');
    const path = require('path');
    
    try {
      console.log('[Launch] Program:', program);
      console.log('[Launch] Args template:', args);
      console.log('[Launch] File:', filePath);
      
      // Quote file path if it contains spaces
      const quotedPath = filePath.includes(' ') ? `"${filePath}"` : filePath;
      
      // Replace %file with the actual file path
      const processedArgs = args.replace(/%file/g, quotedPath);
      
      console.log('[Launch] Processed args:', processedArgs);
      
      // Parse arguments (respecting quotes)
      const argArray = [];
      let currentArg = '';
      let inQuotes = false;
      
      for (let i = 0; i < processedArgs.length; i++) {
        const char = processedArgs[i];
        
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === ' ' && !inQuotes) {
          if (currentArg) {
            argArray.push(currentArg);
            currentArg = '';
          }
        } else {
          currentArg += char;
        }
      }
      
      if (currentArg) {
        argArray.push(currentArg);
      }
      
      console.log('[Launch] Arg array:', argArray);
      
      // Launch the program
      const child = spawn(program, argArray, {
        detached: true,
        stdio: 'ignore'
      });
      
      child.unref();
      
      console.log('[Launch] Process started');
    } catch (error) {
      console.error('[Launch] Error:', error);
      throw error;
    }
  });
  /**
   * Upload ROM file to console
   * Channel: usb2snes:uploadRom
   * @param {string} srcPath - Source file path (local)
   * @param {string} dstPath - Destination path on console
   */
  ipcMain.handle('usb2snes:uploadRom', async (event, srcPath, dstPath) => {
    console.log('[USB2SNES IPC] uploadRom handler called');
    console.log('[USB2SNES IPC] srcPath:', srcPath);
    console.log('[USB2SNES IPC] dstPath:', dstPath);
    
    try {
      const wrapper = getSnesWrapper();
      console.log('[USB2SNES IPC] Wrapper obtained:', !!wrapper);
      
      if (!wrapper) {
        throw new Error('SNESWrapper not initialized');
      }
      
      // Check if file exists
      const fs = require('fs');
      if (!fs.existsSync(srcPath)) {
        throw new Error(`Source file does not exist: ${srcPath}`);
      }
      
      const stats = fs.statSync(srcPath);
      console.log('[USB2SNES IPC] File size:', stats.size, 'bytes');
      
      console.log('[USB2SNES IPC] Starting upload:', srcPath, '->', dstPath);
      
      // Progress callback
      const progressCallback = (transferred, total) => {
        const percent = Math.round((transferred / total) * 100);
        console.log(`[USB2SNES IPC] Upload progress: ${percent}% (${transferred}/${total} bytes)`);
        event.sender.send('usb2snes:upload-progress', { transferred, total, percent });
        // Progress updates mean device is responding - reset health timer
        event.sender.send('usb2snes:operation-success');
      };
      
      console.log('[USB2SNES IPC] Calling wrapper.PutFile()...');
      const success = await wrapper.PutFile(srcPath, dstPath, progressCallback);
      
      console.log('[USB2SNES IPC] PutFile returned:', success);
      console.log('[USB2SNES IPC] Upload complete:', success);
      
      // Notify renderer that USB2SNES operation succeeded (for health tracking)
      event.sender.send('usb2snes:operation-success');
      
      return { success };
    } catch (error) {
      console.error('[USB2SNES IPC] Upload error:', error);
      console.error('[USB2SNES IPC] Error stack:', error.stack);
      throw error;
    }
  });

  /**
   * Read memory from console
   * Channel: usb2snes:readMemory
   * @param {number} address - Memory address
   * @param {number} size - Number of bytes
   */
  ipcMain.handle('usb2snes:readMemory', async (event, address, size) => {
    try {
      const wrapper = getSnesWrapper();
      const data = await wrapper.GetAddress(address, size);
      
      // Handle null response (connection issues)
      if (!data) {
        throw new Error('USB2SNES not responding - connection may be down');
      }
      
      // Convert Buffer to array for IPC transfer
      // Notify renderer that operation succeeded (for health tracking)
      event.sender.send('usb2snes:operation-success');
      return { data: Array.from(data) };
    } catch (error) {
      console.error('[USB2SNES] Read memory error:', error);
      throw error;
    }
  });
  /**
   * Read multiple memory addresses in one call (batch operation)
   * Channel: usb2snes:readMemoryBatch
   * @param {Array<[number, number]>} addressList - Array of [address, size] tuples
   */
  ipcMain.handle('usb2snes:readMemoryBatch', async (event, addressList) => {
    try {
      const wrapper = getSnesWrapper();
      const results = await wrapper.GetAddresses(addressList);
      
      // Handle null response (connection issues)
      if (!results) {
        throw new Error('USB2SNES not responding - connection may be down');
      }
      
      // Convert each Buffer to array for IPC transfer
      const dataArrays = results.map(buffer => Array.from(buffer));
      
      console.log(`[USB2SNES] Batch read complete: ${addressList.length} addresses`);
      event.sender.send('usb2snes:operation-success');
      return { success: true, data: dataArrays };
    } catch (error) {
      console.error('[USB2SNES] Batch read memory error:', error);
      throw error;
    }
  });

  /**
   * Write memory to console
   * Channel: usb2snes:writeMemory
   * @param {Array} writeList - Array of [address, data] tuples
   */
  ipcMain.handle('usb2snes:writeMemory', async (event, writeList) => {
    try {
      const wrapper = getSnesWrapper();
      
      // Convert data arrays to Buffers
      const processedList = writeList.map(([addr, data]) => [
        addr,
        Buffer.from(data)
      ]);
      
      const success = await wrapper.PutAddress(processedList);
      event.sender.send('usb2snes:operation-success');
      return { success };
    } catch (error) {
      console.error('[USB2SNES] Write memory error:', error);
      throw error;
    }
  });

  /**
   * Download file from console
   * Channel: usb2snes:getFile
   * @param {string} filePath - File path on console
   */
  ipcMain.handle('usb2snes:getFile', async (event, filePath) => {
    try {
      const wrapper = getSnesWrapper();
      const data = await wrapper.GetFile(filePath, (received, total) => {
        // Send progress updates to renderer
        event.sender.send('usb2snes:download-progress', {
          filePath,
          received,
          total,
          percent: Math.round(received / total * 100)
        });
        // Progress updates mean device is responding - reset health timer
        event.sender.send('usb2snes:operation-success');
      });
      
      console.log('[USB2SNES] Downloaded file:', filePath, `(${data.length} bytes)`);
      event.sender.send('usb2snes:operation-success');
      return { success: true, data: Array.from(data), size: data.length };
    } catch (error) {
      console.error('[USB2SNES] Get file error:', error);
      throw error;
    }
  });

  /**
   * Blocking file download with timeout
   * Channel: usb2snes:getFileBlocking
   * @param {string} filePath - File path on console
   * @param {number|null} timeoutMs - Timeout in milliseconds
   */
  ipcMain.handle('usb2snes:getFileBlocking', async (event, filePath, timeoutMs = null) => {
    try {
      const wrapper = getSnesWrapper();
      const data = await wrapper.GetFileBlocking(filePath, timeoutMs, (received, total) => {
        // Send progress updates to renderer
        event.sender.send('usb2snes:download-progress', {
          filePath,
          received,
          total,
          percent: Math.round(received / total * 100)
        });
        // Progress updates mean device is responding - reset health timer
        event.sender.send('usb2snes:operation-success');
      });
      
      console.log('[USB2SNES] Downloaded file (blocking):', filePath, `(${data.length} bytes)`);
      event.sender.send('usb2snes:operation-success');
      return { success: true, data: Array.from(data), size: data.length };
    } catch (error) {
      console.error('[USB2SNES] Get file blocking error:', error);
      throw error;
    }
  });

  /**
   * List directory on console
   * Channel: usb2snes:listDir
   * @param {string} dirPath - Directory path
   */
  ipcMain.handle('usb2snes:listDir', async (event, dirPath) => {
    try {
      const wrapper = getSnesWrapper();
      const listing = await wrapper.List(dirPath);
      
      event.sender.send('usb2snes:operation-success');
      return { files: listing };
    } catch (error) {
      console.error('[USB2SNES] List directory error:', error);
      throw error;
    }
  });

  /**
   * Create directory on console
   * Channel: usb2snes:createDir
   * @param {string} dirPath - Directory path to create
   */
  ipcMain.handle('usb2snes:createDir', async (event, dirPath) => {
    try {
      const wrapper = getSnesWrapper();
      await wrapper.MakeDir(dirPath);
      
      console.log('[USB2SNES] Created directory:', dirPath);
      event.sender.send('usb2snes:operation-success');
      return { success: true };
    } catch (error) {
      console.error('[USB2SNES] Create directory error:', error);
      throw error;
    }
  });

  // ========================================
  // SMW-SPECIFIC OPERATIONS
  // ========================================

  /**
   * Grant cape powerup to player
   * Channel: usb2snes:smw:grantCape
   */
  ipcMain.handle('usb2snes:smw:grantCape', async (event) => {
    try {
      const wrapper = getSnesWrapper();
      // Set powerup status to cape (0x02)
      await wrapper.PutAddress([[0xF50019, Buffer.from([0x02])]]);
      
      console.log('[USB2SNES] Granted cape powerup');
      event.sender.send('usb2snes:operation-success');
      return { success: true };
    } catch (error) {
      console.error('[USB2SNES] Grant cape error:', error);
      throw error;
    }
  });

  /**
   * Check if player is in a level
   * Channel: usb2snes:smw:inLevel
   */
  ipcMain.handle('usb2snes:smw:inLevel', async (event) => {
    try {
      const wrapper = getSnesWrapper();
      
      // Use batch read for efficiency - single WebSocket call instead of 6!
      const results = await wrapper.GetAddresses([
        [0xF50010, 1],  // runGame
        [0xF513D4, 1],  // gameUnpaused
        [0xF50071, 1],  // noAnimation
        [0xF51434, 1],  // noEndlevelKeyhole
        [0xF51493, 1],  // noEndlevelTimer
        [0xF50D9B, 1]   // normalLevel
      ]);
      
      // Check all conditions
      const runGame = results[0][0] === 0x00;
      const gameUnpaused = results[1][0] === 0x00;
      const noAnimation = results[2][0] === 0x00;
      const noEndlevelKeyhole = results[3][0] === 0x00;
      const noEndlevelTimer = results[4][0] === 0x00;
      const normalLevel = results[5][0] === 0x00;
      
      const inLevel = runGame && gameUnpaused && noAnimation && 
                      noEndlevelKeyhole && noEndlevelTimer && normalLevel;
      
      event.sender.send('usb2snes:operation-success');
      return { inLevel };
    } catch (error) {
      console.error('[USB2SNES] Check in level error:', error);
      throw error;
    }
  });

  /**
   * Set game timer
   * Channel: usb2snes:smw:setTime
   * @param {number} seconds - Time in seconds
   */
  ipcMain.handle('usb2snes:smw:setTime', async (event, seconds) => {
    try {
      const wrapper = getSnesWrapper();
      
      // Break down time into hundreds, tens, ones (from smwusbtest.py settime())
      const hundreds = Math.floor(seconds / 100);
      const tens = Math.floor((seconds - hundreds * 100) / 10);
      const ones = (seconds - hundreds * 100 - tens * 10) % 10;
      
      await wrapper.PutAddress([
        [0xF50F31, Buffer.from([hundreds])],
        [0xF50F32, Buffer.from([tens])],
        [0xF50F33, Buffer.from([ones])]
      ]);
      
      console.log('[USB2SNES] Set time to:', seconds, 'seconds');
      event.sender.send('usb2snes:operation-success');
      return { success: true };
    } catch (error) {
      console.error('[USB2SNES] Set time error:', error);
      throw error;
    }
  });

  /**
   * Timer challenge: Wait for player to enter level, then set timer to 1 second
   * Channel: usb2snes:smw:timerChallenge
   */
  ipcMain.handle('usb2snes:smw:timerChallenge', async (event) => {
    try {
      const wrapper = getSnesWrapper();
      
      console.log('[USB2SNES] Starting timer challenge - waiting for level entry...');
      
      // Poll for 60 seconds using batch reads for efficiency
      for (let i = 0; i < 60; i++) {
        // Use batch read - 6x faster than individual calls!
        const results = await wrapper.GetAddresses([
          [0xF50010, 1],  // runGame
          [0xF513D4, 1],  // gameUnpaused
          [0xF50071, 1],  // noAnimation
          [0xF51434, 1],  // noEndlevelKeyhole
          [0xF51493, 1],  // noEndlevelTimer
          [0xF50D9B, 1]   // normalLevel
        ]);
        
        // Check all conditions
        const inLevel = results[0][0] === 0x00 &&  // runGame
                        results[1][0] === 0x00 &&  // gameUnpaused
                        results[2][0] === 0x00 &&  // noAnimation
                        results[3][0] === 0x00 &&  // noEndlevelKeyhole
                        results[4][0] === 0x00 &&  // noEndlevelTimer
                        results[5][0] === 0x00;    // normalLevel
        
        if (inLevel) {
          // Player entered level! Set timer to 1 second
          await wrapper.PutAddress([
            [0xF50F31, Buffer.from([0])],  // hundreds
            [0xF50F32, Buffer.from([0])],  // tens
            [0xF50F33, Buffer.from([1])]   // ones
          ]);
          
          console.log('[USB2SNES] Timer challenge complete - set timer to 1 second');
          event.sender.send('usb2snes:operation-success');
          return { success: true, message: 'Player entered level - timer set to 1 second!' };
        }
        
        // Wait 1 second before next check
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      // Timeout
      console.log('[USB2SNES] Timer challenge timeout - player did not enter level');
      return { success: false, message: 'Timeout: Player did not enter level within 60 seconds' };
    } catch (error) {
      console.error('[USB2SNES] Timer challenge error:', error);
      throw error;
    }
  });
  // ===========================================================================
  // CHAT COMMANDS SYSTEM
  // ===========================================================================
  /**
   * Execute chat command (Chat Hacks + CARL)
   * Channel: chat:executeCommand
   */
  ipcMain.handle('chat:executeCommand', async (event, command) => {
    try {
      const { SMWChatCommands } = require('./main/chat/SMWChatCommands');
      const CarlModuleLoader = require('./main/chat/CarlModuleLoader');
      
      const wrapper = getSnesWrapper();
      
      // Initialize chat commands if not exists
      if (!global.chatCommands) {
        global.chatCommands = new SMWChatCommands(wrapper);
      }
      
      // Initialize CARL loader if not exists
      if (!global.carlLoader) {
        global.carlLoader = new CarlModuleLoader(wrapper);
      }
      
      // Always refresh ASAR path from settings (in case it was updated)
      try {
        const db = dbManager.getConnection('clientdata');
        const asarPathRow = db.prepare(`
          SELECT csetting_value 
          FROM csettings 
          WHERE csetting_name = 'asarPath'
        `).get();
        
        if (asarPathRow && asarPathRow.csetting_value) {
          global.carlLoader.setAsarPath(asarPathRow.csetting_value);
          console.log(`[ChatCommands] ASAR path loaded from settings: ${asarPathRow.csetting_value}`);
        } else {
          console.log('[ChatCommands] No ASAR path found in settings - will use simple assembler fallback');
        }
      } catch (error) {
        console.error('[ChatCommands] Error loading ASAR path from settings:', error);
      }
      console.log(`[ChatCommands] Executing: ${command}`);
      
      // Check if this is a CARL command
      if (command.trim().toLowerCase().startsWith('!load ') ||
          command.trim().toLowerCase().startsWith('!unload ') ||
          command.trim().toLowerCase().startsWith('!reload ') ||
          command.trim().toLowerCase() === '!unloadall') {
        
        const result = await global.chatCommands.executeCommand(command);
        
        if (result.success && result.data) {
          // Handle CARL operations
          if (result.data.action === 'load') {
            // Load module from local /work/carl/ directory
            const modulePath = `carl_modules/${result.data.module}.asm`;
            const loadResult = await global.carlLoader.loadModule(result.data.module, modulePath);
            return loadResult;
          } else if (result.data.action === 'unload') {
            return await global.carlLoader.unloadModule(result.data.module);
          } else if (result.data.action === 'reload') {
            const modulePath = `carl_modules/${result.data.module}.asm`;
            return await global.carlLoader.reloadModule(result.data.module, modulePath);
          } else if (result.data.action === 'unloadall') {
            return await global.carlLoader.unloadAll();
          } else if (result.data.action === 'clearhook') {
            return await global.carlLoader.clearFrameHook();
          }
        }
        
        return result;
      }
      
      // Regular chat command
      return await global.chatCommands.executeCommand(command);
      
    } catch (error) {
      console.error('[ChatCommands] Error:', error);
      return { success: false, message: `Error: ${error.message}` };
    }
  });

  /**
   * Get chat command history
   * Channel: chat:getHistory
   */
  ipcMain.handle('chat:getHistory', async () => {
    try {
      if (!global.chatCommands) {
        return [];
      }
      return global.chatCommands.getHistory();
    } catch (error) {
      console.error('[ChatCommands] Get history error:', error);
      return [];
    }
  });

  /**
   * Get list of loaded CARL modules
   * Channel: chat:getLoadedModules
   */
  ipcMain.handle('chat:getLoadedModules', async () => {
    try {
      if (!global.carlLoader) {
        return [];
      }
      return global.carlLoader.getLoadedModules();
    } catch (error) {
      console.error('[ChatCommands] Get loaded modules error:', error);
      return [];
    }
  });

  /**
   * Get CARL memory statistics
   * Channel: chat:getMemoryStats
   */
  ipcMain.handle('chat:getMemoryStats', async () => {
    try {
      if (!global.carlLoader) {
        return null;
      }
      return global.carlLoader.getMemoryStats();
    } catch (error) {
      console.error('[ChatCommands] Get memory stats error:', error);
      return null;
    }
  });

  /**
   * Get list of available pseudocommands
   * Channel: chat:getPseudocommands
   */
  ipcMain.handle('chat:getPseudocommands', async () => {
    try {
      const { SMWChatCommands } = require('./main/chat/SMWChatCommands');
      const wrapper = getSnesWrapper();
      const chatCommands = new SMWChatCommands(wrapper);
      return chatCommands.getPseudocommands();
    } catch (error) {
      console.error('[ChatCommands] Get pseudocommands error:', error);
      return [];
    }
  });

  // ===========================================================================
  // SNES CONTENTS CACHE OPERATIONS
  // ===========================================================================
  
  /**
   * Sync SNES /work/ folder with cache
   * Channel: snesContents:sync
   * @param {Object} uploadedFile - File that was just uploaded (optional)
   */
  ipcMain.handle('snesContents:sync', async (event, uploadedFile = null) => {
    try {
      const wrapper = getSnesWrapper();
      
      const db = dbManager.getConnection('clientdata');
      const { SnesContentsManager } = require('./main/SnesContentsManager');
      const manager = new SnesContentsManager(db, wrapper);
      
      await manager.syncWorkFolder(uploadedFile);
      return { success: true };
    } catch (error) {
      console.error('[SnesContents] Sync error:', error);
      throw error;
    }
  });
  
  /**
   * Get list of files on SNES
   * Channel: snesContents:getList
   * @param {boolean} showAll - Include dismissed files
   */
  ipcMain.handle('snesContents:getList', async (event, showAll = false) => {
    try {
      const db = dbManager.getConnection('clientdata');
      const { SnesContentsManager } = require('./main/SnesContentsManager');
      const wrapper = getSnesWrapper();
      const manager = new SnesContentsManager(db, wrapper);
      
      return manager.getFileList(showAll);
    } catch (error) {
      console.error('[SnesContents] Get list error:', error);
      throw error;
    }
  });
  /**
   * Update file status (pin, dismiss, etc)
   * Channel: snesContents:updateStatus
   * @param {string} fullpath - File path on SNES
   * @param {Object} updates - Status updates
   */
  ipcMain.handle('snesContents:updateStatus', async (event, fullpath, updates) => {
    try {
      const db = dbManager.getConnection('clientdata');
      const { SnesContentsManager } = require('./main/SnesContentsManager');
      const wrapper = getSnesWrapper();
      const manager = new SnesContentsManager(db, wrapper);
      
      manager.updateStatus(fullpath, updates);
      return { success: true };
    } catch (error) {
      console.error('[SnesContents] Update status error:', error);
      throw error;
    }
  });
  /**
   * Delete file from cache
   * Channel: snesContents:delete
   * @param {string} fullpath - File path on SNES
   */
  ipcMain.handle('snesContents:delete', async (event, fullpath) => {
    try {
      const db = dbManager.getConnection('clientdata');
      const { SnesContentsManager } = require('./main/SnesContentsManager');
      const wrapper = getSnesWrapper();
      const manager = new SnesContentsManager(db, wrapper);
      
      manager.deleteFile(fullpath);
      return { success: true };
    } catch (error) {
      console.error('[SnesContents] Delete error:', error);
      throw error;
    }
  });
  
  /**
   * Record a recent boot/upload to recentboots table
   * Channel: recentboots:record
   * @param {Object} bootInfo - Boot information
   * @param {string} bootInfo.filename - Filename
   * @param {string} bootInfo.fullpath - Full path on SNES
   * @param {string} bootInfo.gameid - Game ID (optional)
   * @param {string} bootInfo.gamename - Game name (optional)
   * @param {string} bootInfo.levelnumber - Level number (optional)
   * @param {string} bootInfo.levelname - Level name (optional)
   * @param {boolean} bootInfo.booted - Whether the file was booted (optional)
   */
  ipcMain.handle('recentboots:record', async (event, bootInfo) => {
    try {
      const db = dbManager.getConnection('clientdata');
      
      const { filename, fullpath, gameid, gamename, levelnumber, levelname, booted } = bootInfo;
      
      if (!filename || !fullpath) {
        return { success: false, error: 'filename and fullpath are required' };
      }
      
      // Check if record already exists (by fullpath)
      const existing = db.prepare('SELECT id FROM recentboots WHERE fullpath = ?').get(fullpath);
      
      if (existing) {
        // Update existing record
        db.prepare(`
          UPDATE recentboots 
          SET filename = ?, gameid = ?, gamename = ?, levelnumber = ?, levelname = ?,
              uploaded_at = strftime('%s', 'now'),
              booted_at = CASE WHEN ? = 1 THEN strftime('%s', 'now') ELSE booted_at END
          WHERE id = ?
        `).run(
          filename,
          gameid || null,
          gamename || null,
          levelnumber || null,
          levelname || null,
          booted ? 1 : 0,
          existing.id
        );
      } else {
        // Insert new record
        db.prepare(`
          INSERT INTO recentboots (
            filename, fullpath, gameid, gamename, levelnumber, levelname,
            uploaded_at, booted_at
          ) VALUES (?, ?, ?, ?, ?, ?, strftime('%s', 'now'), ?)
        `).run(
          filename,
          fullpath,
          gameid || null,
          gamename || null,
          levelnumber || null,
          levelname || null,
          booted ? Date.now() / 1000 : null
        );
      }
      
      return { success: true };
    } catch (error) {
      console.error('[RecentBoots] Record error:', error);
      return { success: false, error: error.message };
    }
  });
  // ===========================================================================
  // PAST RUNS OPERATIONS
  // ===========================================================================
  /**
   * Get all runs from database
   * Channel: db:runs:get-all
   */
  ipcMain.handle('db:runs:get-all', async () => {
    try {
      const db = dbManager.getConnection('clientdata');
      
      const runs = db.prepare(`
        SELECT 
          run_uuid,
          run_name,
          run_description,
          status,
          created_at,
          created_at_ms,
          started_at,
          started_at_ms,
          completed_at,
          completed_at_ms,
          updated_at,
          updated_at_ms,
          total_challenges,
          completed_challenges,
          skipped_challenges,
          global_conditions,
          pause_seconds,
          pause_milliseconds,
          staging_folder
        FROM runs
        ORDER BY created_at DESC
      `).all();
      
      // Calculate elapsed time for each run
      const nowMs = Date.now();
      return runs.map(run => {
        let elapsedMilliseconds = 0;
        
        // Get pause time in milliseconds
        let pauseMilliseconds = 0;
        if (run.pause_milliseconds) {
          pauseMilliseconds = run.pause_milliseconds;
        } else if (run.pause_seconds) {
          pauseMilliseconds = run.pause_seconds * 1000;
        }
        
        // Calculate elapsed time based on status
        if (run.status === 'completed' && run.completed_at_ms && run.started_at_ms) {
          // Completed run: elapsed = (completed_at - started_at - pause_time)
          elapsedMilliseconds = run.completed_at_ms - run.started_at_ms - pauseMilliseconds;
        } else if (run.status === 'active' && run.started_at_ms) {
          // Active run: elapsed = (now - started_at - pause_time - pending_pause_time)
          elapsedMilliseconds = nowMs - run.started_at_ms - pauseMilliseconds;
          
          // If currently paused, subtract pending pause time
          if (run.pause_start_ms) {
            const pendingPauseMs = nowMs - run.pause_start_ms;
            elapsedMilliseconds -= pendingPauseMs;
          }
        } else if (run.started_at_ms && run.completed_at_ms) {
          // Fallback: use completed_at - started_at - pause_time
          elapsedMilliseconds = run.completed_at_ms - run.started_at_ms - pauseMilliseconds;
        }
        
        // Ensure non-negative
        elapsedMilliseconds = Math.max(0, elapsedMilliseconds);
        
        return {
          ...run,
          elapsed_milliseconds: elapsedMilliseconds,
          elapsed_seconds: Math.floor(elapsedMilliseconds / 1000)
        };
      });
    } catch (error) {
      console.error('Error getting all runs:', error);
      throw error;
    }
  });

  /**
   * Get a single run by UUID
   * Channel: db:runs:get
   */
  ipcMain.handle('db:runs:get', async (event, { runUuid }) => {
    try {
      const db = dbManager.getConnection('clientdata');
      
      const run = db.prepare(`
        SELECT 
          *,
          started_at_ms,
          completed_at_ms,
          pause_milliseconds,
          pause_start_ms,
          pause_end_ms,
          clock_offset_ms,
          clock_validated,
          network_time_ms,
          run_validity_status
        FROM runs
        WHERE run_uuid = ?
        LIMIT 1
      `).get(runUuid);
      
      if (!run) {
        return null;
      }
      
      // Calculate elapsed time
      const nowMs = Date.now();
      let elapsedMilliseconds = 0;
      
      // Get pause time in milliseconds
      let pauseMilliseconds = 0;
      if (run.pause_milliseconds) {
        pauseMilliseconds = run.pause_milliseconds;
      } else if (run.pause_seconds) {
        pauseMilliseconds = run.pause_seconds * 1000;
      }
      
      // Calculate elapsed time based on status
      if (run.status === 'completed' && run.completed_at_ms && run.started_at_ms) {
        // Completed run: elapsed = (completed_at - started_at - pause_time)
        elapsedMilliseconds = run.completed_at_ms - run.started_at_ms - pauseMilliseconds;
      } else if (run.status === 'active' && run.started_at_ms) {
        // Active run: elapsed = (now - started_at - pause_time - pending_pause_time)
        elapsedMilliseconds = nowMs - run.started_at_ms - pauseMilliseconds;
        
        // If currently paused, subtract pending pause time
        if (run.pause_start_ms) {
          const pendingPauseMs = nowMs - run.pause_start_ms;
          elapsedMilliseconds -= pendingPauseMs;
        }
      } else if (run.started_at_ms && run.completed_at_ms) {
        // Fallback: use completed_at - started_at - pause_time
        elapsedMilliseconds = run.completed_at_ms - run.started_at_ms - pauseMilliseconds;
      }
      
      // Ensure non-negative
      elapsedMilliseconds = Math.max(0, elapsedMilliseconds);
      
      return {
        ...run,
        elapsed_milliseconds: elapsedMilliseconds,
        elapsed_seconds: Math.floor(elapsedMilliseconds / 1000)
      };
    } catch (error) {
      console.error('Error getting run:', error);
      throw error;
    }
  });
  
  /**
   * Delete a run (cascade deletes results and plan entries)
   * Channel: db:runs:delete
   */
  ipcMain.handle('db:runs:delete', async (event, { runUuid }) => {
    try {
      const db = dbManager.getConnection('clientdata');
      
      // Delete run (CASCADE will handle run_results and run_plan_entries)
      db.prepare('DELETE FROM runs WHERE run_uuid = ?').run(runUuid);
      
      return { success: true };
    } catch (error) {
      console.error('Error deleting run:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Get stage info from gamestages table
   * Channel: db:stage:get-info
   */
  ipcMain.handle('db:stage:get-info', async (event, { gameid, levelnumber }) => {
    try {
      const rhdataDb = dbManager.getConnection('rhdata');
      
      const stage = rhdataDb.prepare(`
        SELECT * FROM gamestages
        WHERE gameid = ? AND levelnumber = ?
        LIMIT 1
      `).get(gameid, levelnumber);
      
      return stage || null;
    } catch (error) {
      console.error('Error getting stage info:', error);
      return null;
    }
  });

  /**
   * Get stage feedback for a specific gameid and levelnumber
   * Channel: db:stage:get-feedback
   */
  ipcMain.handle('db:stage:get-feedback', async (event, { gameid, levelnumber }) => {
    try {
      const db = dbManager.getConnection('clientdata');
      
      const feedback = db.prepare(`
        SELECT * FROM stage_feedback
        WHERE gameid = ? AND levelnumber = ?
        LIMIT 1
      `).get(gameid, levelnumber);
      
      return feedback || null;
    } catch (error) {
      console.error('Error getting stage feedback:', error);
      return null;
    }
  });

  /**
   * Save or update stage feedback
   * Channel: db:stage:save-feedback
   */
  ipcMain.handle('db:stage:save-feedback', async (event, {
    gameid,
    levelnumber,
    translevel,
    levelname,
    difficulty_feedback,
    comment,
    current_difficulty,
    flag_values,
    global_conditions,
    applied_patches,
    playlevel_patchcode
  }) => {
    try {
      const db = dbManager.getConnection('clientdata');
      
      // Check if feedback already exists
      const existing = db.prepare(`
        SELECT feedback_uuid FROM stage_feedback
        WHERE gameid = ? AND levelnumber = ?
      `).get(gameid, levelnumber);
      
      const feedbackUuid = existing?.feedback_uuid || crypto.randomUUID();
      
      if (existing) {
        // Update existing feedback
        db.prepare(`
          UPDATE stage_feedback
          SET translevel = ?,
              levelname = ?,
              difficulty_feedback = ?,
              comment = ?,
              current_difficulty = ?,
              flag_values = ?,
              global_conditions = ?,
              applied_patches = ?,
              playlevel_patchcode = ?,
              updated_at = strftime('%s', 'now')
          WHERE feedback_uuid = ?
        `).run(
          translevel || null,
          levelname || null,
          difficulty_feedback !== null && difficulty_feedback !== undefined ? difficulty_feedback : null,
          comment || null,
          current_difficulty !== null && current_difficulty !== undefined ? current_difficulty : null,
          flag_values || null,
          global_conditions || null,
          applied_patches || null,
          playlevel_patchcode || null,
          feedbackUuid
        );
      } else {
        // Insert new feedback
        db.prepare(`
          INSERT INTO stage_feedback
            (feedback_uuid, gameid, levelnumber, translevel, levelname,
             difficulty_feedback, comment, current_difficulty, flag_values,
             global_conditions, applied_patches, playlevel_patchcode,
             created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%s', 'now'), strftime('%s', 'now'))
        `).run(
          feedbackUuid,
          gameid,
          levelnumber,
          translevel || null,
          levelname || null,
          difficulty_feedback !== null && difficulty_feedback !== undefined ? difficulty_feedback : null,
          comment || null,
          current_difficulty !== null && current_difficulty !== undefined ? current_difficulty : null,
          flag_values || null,
          global_conditions || null,
          applied_patches || null,
          playlevel_patchcode || null
        );
      }
      
      return { success: true };
    } catch (error) {
      console.error('Error saving stage feedback:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Get all stage feedback entries
   * Channel: db:stage:get-all-feedback
   */
  ipcMain.handle('db:stage:get-all-feedback', async (event) => {
    try {
      const db = dbManager.getConnection('clientdata');
      const rhdataDb = dbManager.getConnection('rhdata');
      
      // Get all feedback entries
      const feedbackList = db.prepare(`
        SELECT * FROM stage_feedback
        ORDER BY created_at DESC
      `).all();
      
      // Enrich with game names from rhdata
      const enriched = feedbackList.map(feedback => {
        const game = rhdataDb.prepare(`
          SELECT name FROM gameversions
          WHERE gameid = ? AND version = (
            SELECT MAX(version) FROM gameversions WHERE gameid = ?
          )
          LIMIT 1
        `).get(feedback.gameid, feedback.gameid);
        
        return {
          ...feedback,
          gamename: game?.name || null
        };
      });
      
      return { success: true, feedback: enriched };
    } catch (error) {
      console.error('Error getting all stage feedback:', error);
      return { success: false, error: error.message, feedback: [] };
    }
  });

  // ===========================================================================
  // DIALOG OPERATIONS
  // ===========================================================================
  
  /**
   * Select directory dialog
   * Channel: dialog:selectDirectory
   */
  ipcMain.handle('dialog:selectDirectory', async (event, options) => {
    try {
      const result = await dialog.showOpenDialog({
        title: options.title || 'Select Directory',
        properties: options.properties || ['openDirectory'],
        defaultPath: options.defaultPath
      });
      return result;
    } catch (error) {
      console.error('Error in directory selection:', error);
      return { canceled: true };
    }
  });
  
  /**
   * Select files dialog
   * Channel: dialog:selectFiles
   */
  ipcMain.handle('dialog:selectFiles', async (event, options) => {
    try {
      const result = await dialog.showOpenDialog({
        title: options.title || 'Select Files',
        filters: options.filters || [],
        properties: options.properties || ['openFile'],
        defaultPath: options.defaultPath
      });
      return result;
    } catch (error) {
      console.error('Error in file selection:', error);
      return { canceled: true };
    }
  });

  ipcMain.handle('dialog:selectFile', async (event, options) => {
    try {
      const result = await dialog.showOpenDialog({
        title: options.title || 'Select File',
        filters: options.filters || [],
        properties: ['openFile'],
        defaultPath: options.defaultPath
      });
      if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
        return { canceled: true };
      }
      return { canceled: false, filePath: result.filePaths[0] };
    } catch (error) {
      console.error('Error in file selection:', error);
      return { canceled: true };
    }
  });

  /**
   * Read file content
   * Channel: dialog:readFile
   */
  ipcMain.handle('dialog:readFile', async (event, { filePath }) => {
    try {
      const fs = require('fs');
      const content = fs.readFileSync(filePath, 'utf8');
      return { success: true, content };
    } catch (error) {
      console.error('Error reading file:', error);
      return { success: false, error: error.message };
    }
  });
  // ===========================================================================
  // GAME EXPORT/IMPORT OPERATIONS
  // ===========================================================================
  /**
   * Export selected games to directory
   * Channel: db:games:export
   */
  ipcMain.handle('db:games:export', async (event, { gameIds, exportDirectory }) => {
    try {
      const fs = require('fs').promises;
      const path = require('path');
      const crypto = require('crypto');
      
      let exportedCount = 0;
      
      for (const gameId of gameIds) {
        try {
          // Create export data object
          const exportData = {
            gameid: gameId,
            exported_at: new Date().toISOString(),
            databases: {}
          };
          
          // Export from rhdata.db
          const rhdataDb = dbManager.getConnection('rhdata');
          
          // Get all gameversions for this gameid
          const gameversions = rhdataDb.prepare(`
            SELECT * FROM gameversions WHERE gameid = ?
          `).all(gameId);
          
          if (gameversions.length === 0) {
            console.warn(`No gameversions found for gameid ${gameId}`);
            continue;
          }
          
          exportData.databases.rhdata = {
            gameversions: gameversions,
            gameversion_stats: rhdataDb.prepare(`
              SELECT * FROM gameversion_stats WHERE gameid = ?
            `).all(gameId),
            rhpatches: rhdataDb.prepare(`
              SELECT * FROM rhpatches WHERE gameid = ?
            `).all(gameId)
          };
          
          // Get patchblobs referenced by gameversions
          const patchblobNames = new Set();
          for (const gv of gameversions) {
            if (gv.patchblob1_name) {
              patchblobNames.add(gv.patchblob1_name);
            }
          }
          
          if (patchblobNames.size > 0) {
            const patchblobNamesArray = Array.from(patchblobNames);
            const placeholders = patchblobNamesArray.map(() => '?').join(',');
            
            exportData.databases.rhdata.patchblobs = rhdataDb.prepare(`
              SELECT * FROM patchblobs WHERE patchblob1_name IN (${placeholders})
            `).all(...patchblobNamesArray);
            
            exportData.databases.rhdata.patchblobs_extended = rhdataDb.prepare(`
              SELECT * FROM patchblobs_extended WHERE pbuuid IN (
                SELECT pbuuid FROM patchblobs WHERE patchblob1_name IN (${placeholders})
              )
            `).all(...patchblobNamesArray);
          }
          
          // Export from clientdata.db
          const clientdataDb = dbManager.getConnection('clientdata');
          exportData.databases.clientdata = {
            user_game_annotations: clientdataDb.prepare(`
              SELECT * FROM user_game_annotations WHERE gameid = ?
            `).all(gameId)
          };
          
          // Export from patchbin.db
          const patchbinDb = dbManager.getConnection('patchbin');
          if (patchbinDb) {
            const attachments = [];
            const attachmentFiles = [];
            
            if (patchblobNames.size > 0) {
              // Get pbuuids from patchblobs table first
              const patchblobNamesArray = Array.from(patchblobNames);
              const placeholders = patchblobNamesArray.map(() => '?').join(',');
              
              const patchblobUuids = rhdataDb.prepare(`
                SELECT pbuuid FROM patchblobs WHERE patchblob1_name IN (${placeholders})
              `).all(...patchblobNamesArray).map(pb => pb.pbuuid);
              
              if (patchblobUuids.length > 0) {
                const uuidPlaceholders = patchblobUuids.map(() => '?').join(',');
                
                const attachmentRecords = patchbinDb.prepare(`
                  SELECT * FROM attachments WHERE pbuuid IN (${uuidPlaceholders})
                `).all(...patchblobUuids);
                
                for (const attachment of attachmentRecords) {
                  // Create attachment record without file_data
                  const attachmentRecord = { ...attachment };
                  delete attachmentRecord.file_data;
                  attachments.push(attachmentRecord);
                  
                  // Save file_data to separate file if it exists
                  if (attachment.file_data) {
                    const fileName = sanitizeFileName(attachment.file_name) || attachment.auuid;
                    const filePath = path.join(exportDirectory, fileName);
                    
                    // Convert base64 to buffer and save
                    const fileBuffer = Buffer.from(attachment.file_data, 'base64');
                    await fs.writeFile(filePath, fileBuffer);
                    
                    attachmentFiles.push({
                      auuid: attachment.auuid,
                      file_name: attachment.file_name,
                      saved_as: fileName,
                      file_hash_sha256: attachment.file_hash_sha256
                    });
                  }
                }
              }
            }
            
            exportData.databases.patchbin = {
              attachments: attachments,
              attachment_files: attachmentFiles
            };
          }
          
          // Write export file
          const exportFileName = `${gameId}_info.json`;
          const exportFilePath = path.join(exportDirectory, exportFileName);
          await fs.writeFile(exportFilePath, JSON.stringify(exportData, null, 2));
          
          exportedCount++;
          console.log(`Exported game ${gameId} to ${exportFilePath}`);
          
        } catch (gameError) {
          console.error(`Error exporting game ${gameId}:`, gameError);
        }
      }
      
      return { success: true, exportedCount };
    } catch (error) {
      console.error('Error in export operation:', error);
      return { success: false, error: error.message };
    }
  });
  
  /**
   * Import games from JSON files
   * Channel: db:games:import
   */
  ipcMain.handle('db:games:import', async (event, { filePaths }) => {
    try {
      const fs = require('fs').promises;
      const crypto = require('crypto');
      
      let importedCount = 0;
      const errors = [];
      
      // First pass: import JSON files
      for (const filePath of filePaths) {
        if (!filePath.endsWith('_info.json')) {
          continue; // Skip non-info files in first pass
        }
        
        try {
          const fileContent = await fs.readFile(filePath, 'utf8');
          const exportData = JSON.parse(fileContent);
          
          if (!exportData.gameid || !exportData.databases) {
            errors.push(`Invalid export file: ${filePath}`);
            continue;
          }
          
          const gameId = exportData.gameid;
          
          // Import rhdata.db tables
          if (exportData.databases.rhdata) {
            const rhdataDb = dbManager.getConnection('rhdata');
            
            // Import gameversions
            if (exportData.databases.rhdata.gameversions) {
              for (const gv of exportData.databases.rhdata.gameversions) {
                try {
                  rhdataDb.prepare(`
                    INSERT OR REPLACE INTO gameversions 
                    (gvuuid, section, gameid, version, removed, obsoleted, gametype, name, time, added, moderated, author, authors, submitter, demo, featured, length, difficulty, url, download_url, name_href, author_href, obsoleted_by, patchblob1_name, pat_sha224, size, description, gvjsondata, gvchange_attributes, gvchanges, tags, tags_href, fields_type, legacy_type, raw_difficulty, combinedtype, local_resource_etag, local_resource_lastmodified, local_resource_filename, gvimport_time, siglistuuid)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                  `).run(
                    gv.gvuuid, gv.section, gv.gameid, gv.version, gv.removed, gv.obsoleted, gv.gametype, gv.name, gv.time, gv.added, gv.moderated, gv.author, gv.authors, gv.submitter, gv.demo, gv.featured, gv.length, gv.difficulty, gv.url, gv.download_url, gv.name_href, gv.author_href, gv.obsoleted_by, gv.patchblob1_name, gv.pat_sha224, gv.size, gv.description, gv.gvjsondata, gv.gvchange_attributes, gv.gvchanges, gv.tags, gv.tags_href, gv.fields_type, gv.legacy_type, gv.raw_difficulty, gv.combinedtype, gv.local_resource_etag, gv.local_resource_lastmodified, gv.local_resource_filename, gv.gvimport_time, gv.siglistuuid
                  );
                } catch (insertError) {
                  console.warn(`Error inserting gameversion for ${gameId}:`, insertError);
                }
              }
            }
            
            // Import gameversion_stats
            if (exportData.databases.rhdata.gameversion_stats) {
              for (const gvs of exportData.databases.rhdata.gameversion_stats) {
                try {
                  rhdataDb.prepare(`
                    INSERT OR REPLACE INTO gameversion_stats 
                    (gameid, stat_name, stat_value, stat_type, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                  `).run(
                    gvs.gameid, gvs.stat_name, gvs.stat_value, gvs.stat_type, gvs.created_at, gvs.updated_at
                  );
                } catch (insertError) {
                  console.warn(`Error inserting gameversion_stats for ${gameId}:`, insertError);
                }
              }
            }
            
            // Import rhpatches
            if (exportData.databases.rhdata.rhpatches) {
              for (const rhp of exportData.databases.rhdata.rhpatches) {
                try {
                  rhdataDb.prepare(`
                    INSERT OR REPLACE INTO rhpatches 
                    (rhpuuid, gameid, patch_name, siglistuuid)
                    VALUES (?, ?, ?, ?)
                  `).run(
                    rhp.rhpuuid, rhp.gameid, rhp.patch_name, rhp.siglistuuid
                  );
                } catch (insertError) {
                  console.warn(`Error inserting rhpatches for ${gameId}:`, insertError);
                }
              }
            }
            
            // Import patchblobs
            if (exportData.databases.rhdata.patchblobs) {
              for (const pb of exportData.databases.rhdata.patchblobs) {
                try {
                  rhdataDb.prepare(`
                    INSERT OR REPLACE INTO patchblobs 
                    (pbuuid, gvuuid, patch_name, pat_sha1, pat_sha224, pat_shake_128, patchblob1_key, patchblob1_name, patchblob1_sha224, result_sha1, result_sha224, result_shake1, pbjsondata, pblobdata, pbimport_time, siglistuuid)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                  `).run(
                    pb.pbuuid, pb.gvuuid, pb.patch_name, pb.pat_sha1, pb.pat_sha224, pb.pat_shake_128, pb.patchblob1_key, pb.patchblob1_name, pb.patchblob1_sha224, pb.result_sha1, pb.result_sha224, pb.result_shake1, pb.pbjsondata, pb.pblobdata, pb.pbimport_time, pb.siglistuuid
                  );
                } catch (insertError) {
                  console.warn(`Error inserting patchblobs for ${gameId}:`, insertError);
                }
              }
            }
            
            // Import patchblobs_extended
            if (exportData.databases.rhdata.patchblobs_extended) {
              for (const pbe of exportData.databases.rhdata.patchblobs_extended) {
                try {
                  rhdataDb.prepare(`
                    INSERT OR REPLACE INTO patchblobs_extended 
                    (pbuuid, patch_filename, patch_type, is_primary, zip_source, created_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                  `).run(
                    pbe.pbuuid, pbe.patch_filename, pbe.patch_type, pbe.is_primary, pbe.zip_source, pbe.created_at
                  );
                } catch (insertError) {
                  console.warn(`Error inserting patchblobs_extended for ${gameId}:`, insertError);
                }
              }
            }
          }
          
          // Import clientdata.db tables
          if (exportData.databases.clientdata) {
            const clientdataDb = dbManager.getConnection('clientdata');
            
            if (exportData.databases.clientdata.user_game_annotations) {
              for (const uga of exportData.databases.clientdata.user_game_annotations) {
                try {
                  clientdataDb.prepare(`
                    INSERT OR REPLACE INTO user_game_annotations 
                    (gameid, status, user_difficulty_rating, user_review_rating, user_skill_rating, hidden, exclude_from_random, user_notes)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                  `).run(
                    uga.gameid, uga.status, uga.user_difficulty_rating, uga.user_review_rating,
                    uga.user_skill_rating, uga.hidden, uga.exclude_from_random, uga.user_notes
                  );
                } catch (insertError) {
                  console.warn(`Error inserting user_game_annotations for ${gameId}:`, insertError);
                }
              }
            }
          }
          
          // Import patchbin.db tables
          if (exportData.databases.patchbin) {
            const patchbinDb = dbManager.getConnection('patchbin');
            if (patchbinDb) {
              // Import attachments (metadata only)
              if (exportData.databases.patchbin.attachments) {
                for (const att of exportData.databases.patchbin.attachments) {
                  try {
                    patchbinDb.prepare(`
                      INSERT OR REPLACE INTO attachments 
                      (auuid, pbuuid, file_name, file_hash_sha224, file_hash_sha256, file_ipfs_cidv0, file_ipfs_cidv1, file_size, file_type, created_at, updated_at)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `).run(
                      att.auuid, att.pbuuid, att.file_name, att.file_hash_sha224, att.file_hash_sha256, att.file_ipfs_cidv0, att.file_ipfs_cidv1, att.file_size, att.file_type, att.created_at, att.updated_at
                    );
                  } catch (insertError) {
                    console.warn(`Error inserting attachments for ${gameId}:`, insertError);
                  }
                }
              }
            }
          }
          
          importedCount++;
          console.log(`Imported game ${gameId} from ${filePath}`);
          
        } catch (fileError) {
          errors.push(`Error importing ${filePath}: ${fileError.message}`);
        }
      }
      
      // Second pass: import attachment files (if they exist and match hash)
      for (const filePath of filePaths) {
        if (filePath.endsWith('_info.json')) {
          continue; // Skip info files in second pass
        }
        
        try {
          // This would need to be implemented based on the attachment file structure
          // For now, just log that we found attachment files
          console.log(`Found attachment file: ${filePath}`);
        } catch (fileError) {
          errors.push(`Error processing attachment ${filePath}: ${fileError.message}`);
        }
      }
      
      return { 
        success: true, 
        importedCount, 
        errors: errors.length > 0 ? errors : undefined 
      };
    } catch (error) {
      console.error('Error in import operation:', error);
      return { success: false, error: error.message };
    }
  });
  /**
   * List installed RHPAK packages
   */
  ipcMain.handle('rhpak:list', async () => {
    try {
      const rhdataDb = dbManager.getConnection('rhdata');
      const rows = rhdataDb.prepare(`
        SELECT rhpakuuid, jsfilename, name, created_at, updated_at
        FROM rhpaks
        ORDER BY COALESCE(updated_at, created_at) DESC
      `).all();
      return { success: true, rhpaks: rows };
    } catch (error) {
      console.error('[rhpak:list] Failed:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Import a RHPAK package via newgame.js
   */
  ipcMain.handle('rhpak:import', async (_event, { filePath, forceGameids, forceExtrapatches, trustPatches } = {}) => {
    try {
      if (!filePath) {
        return { success: false, error: 'filePath is required' };
      }
      const config = buildNewgameConfig({
        packageInput: filePath,
        packageBaseDir: path.dirname(path.resolve(filePath)),
        forceGameids: !!forceGameids,
        forceExtrapatches: !!forceExtrapatches,
        trustPatches: !!trustPatches
      });
      await newgameHandleImportPackage(config);
      return { success: true };
    } catch (error) {
      console.error('[rhpak:import] Failed:', error);
      // Return structured error info for validation failures
      if (error.validationType) {
        return {
          success: false,
          error: error.message,
          validationType: error.validationType,
          missingGameids: error.missingGameids,
          extraGameids: error.extraGameids,
          foundGameids: error.foundGameids,
          declaredGameids: error.declaredGameids,
          hasExtrapatches: error.hasExtrapatches
        };
      }
      return { success: false, error: error.message };
    }
  });

  /**
   * Uninstall an RHPAK from the databases by UUID
   */
  ipcMain.handle('rhpak:uninstall', async (_event, { rhpakuuid } = {}) => {
    try {
      if (!rhpakuuid) {
        return { success: false, error: 'rhpakuuid is required' };
      }
      const config = buildNewgameConfig({
        uninstallUuid: rhpakuuid,
      });
      await newgameHandleUninstall(config, null);
      return { success: true };
    } catch (error) {
      console.error('[rhpak:uninstall] Failed:', error);
      return { success: false, error: error.message };
    }
  });
  // ===========================================================================
  // ONLINE/NOSTR PROFILE OPERATIONS
  // ===========================================================================
  /**
   * Get online profile
   * Channel: online:profile:get
   */
  ipcMain.handle('online:profile:get', async (event) => {
    try {
      const keyguardKey = getKeyguardKey(event);
      const profileManager = new OnlineProfileManager(dbManager, keyguardKey);
      
      // Try to get from database first
      let profile = profileManager.getCurrentProfile();
      
      // If not in database, try to migrate from csettings
      if (!profile && keyguardKey) {
        const currentProfileId = profileManager.getCurrentProfileId();
        if (currentProfileId) {
          try {
            const migrationResult = profileManager.migrateProfileFromCsettings(currentProfileId);
            if (migrationResult.success && !migrationResult.alreadyMigrated) {
              profile = profileManager.getCurrentProfile();
            }
          } catch (migrationError) {
            console.error('Error migrating profile from csettings:', migrationError);
          }
        }
      }
      
      // Check if profile needs master seed generation (one-time upgrade)
      if (profile && keyguardKey) {
        const profileUuid = (profile._metadata && profile._metadata.profileUuid) || profile.profileId;
        if (profileUuid) {
          const { needsSeedGeneration, generateProfileSeedAndDidPkh } = require('./utils/ProfileSeedManager');
          const db = dbManager.getConnection('clientdata');
          
          if (needsSeedGeneration(db, profileUuid)) {
            try {
              console.log(`[online:profile:get] Profile ${profileUuid} needs seed generation, generating now...`);
              
              // Generate master seed, Ethereum wallet, and did:pkh
              const { 
                encryptedSeed, 
                encryptedEthereumPrivateKey, 
                ethereumAddress, 
                didPkh, 
                seedGeneratedAt 
              } = generateProfileSeedAndDidPkh(keyguardKey);
              
              // Verify seed is not null or zero
              if (encryptedSeed && encryptedSeed !== '0' && encryptedSeed !== '') {
                console.log(`[online:profile:get] Updating profile ${profileUuid} with master seed, Ethereum wallet, and did:pkh...`);
                
                // Update profile with master seed, Ethereum wallet, and did:pkh in database columns
                // PRIVATE: encrypted_master_seed, encrypted_ethereum_private_key (database columns only, NOT in profile_json)
                // PUBLIC: ethereum_address, did_pkh (database columns, can optionally be added to profile_json for publishing)
                db.prepare(`
                  UPDATE user_profiles 
                  SET encrypted_master_seed = ?, 
                      encrypted_ethereum_private_key = ?,
                      ethereum_address = ?,
                      did_pkh = ?, 
                      seed_generated_at = ?
                  WHERE profile_uuid = ?
                `).run(encryptedSeed, encryptedEthereumPrivateKey, ethereumAddress, didPkh, seedGeneratedAt, profileUuid);
                
                console.log(`[online:profile:get] Successfully updated profile ${profileUuid} with seed and wallet data`);
                
                // NOTE: We do NOT add Ethereum wallet data to profile JSON
                // because profile_json is published to Nostr (kind 0 event).
                // PRIVATE data (encrypted_ethereum_private_key) is stored in database column only.
                // PUBLIC data (ethereum_address, did_pkh) is stored in database columns.
                // If we want to publish did_pkh or ethereum_address to Nostr, we can add
                // them to profile_json later, but private keys must NEVER be in profile_json.
                
                // Reload profile to include new fields
                profile = profileManager.getCurrentProfile();
                
                // Return upgrade flag so UI can show alert
                if (profile) {
                  const metadata = profile._metadata || {};
                  const { _metadata, ...profileWithoutMetadata } = profile;
                  return { ...profileWithoutMetadata, _seedUpgraded: true };
                }
              } else {
                console.error(`[online:profile:get] Generated seed is null or zero for profile ${profileUuid}`);
              }
            } catch (seedError) {
              console.error(`[online:profile:get] Error generating master seed for existing profile ${profileUuid}:`, seedError);
              // Continue without seed generation if it fails
            }
          } else {
            console.log(`[online:profile:get] Profile ${profileUuid} already has a seed, skipping generation`);
          }
        } else {
          console.log(`[online:profile:get] Cannot determine profile UUID for seed generation`);
        }
      } else {
        if (!profile) {
          console.log(`[online:profile:get] No profile found, skipping seed generation`);
        } else if (!keyguardKey) {
          console.log(`[online:profile:get] Profile Guard not unlocked, skipping seed generation`);
        }
      }
      
      // Remove metadata before returning (for backward compatibility)
      if (profile && profile._metadata) {
        const { _metadata, ...profileWithoutMetadata } = profile;
        return profileWithoutMetadata;
      }
      
      return profile || null;
    } catch (error) {
      console.error('Error getting online profile:', error);
      return null;
    }
  });

  /**
   * List all profiles
   * Channel: online:profiles:list
   */
  ipcMain.handle('online:profiles:list', async (event) => {
    try {
      const keyguardKey = getKeyguardKey(event);
      const profileManager = new OnlineProfileManager(dbManager, keyguardKey);
      
      // Get profiles from database
      const profiles = profileManager.listProfiles();
      
      // Map to expected format (remove metadata, add isCurrent flag)
      return profiles.map(profile => {
        const { _metadata, ...profileWithoutMetadata } = profile;
        return {
          profileId: profile.profileId || _metadata?.profileUuid,
          username: profile.username || 'Unknown',
          displayName: profile.displayName || '',
          isCurrent: _metadata?.isCurrentProfile || false
        };
      });
    } catch (error) {
      console.error('Error listing profiles:', error);
      return [];
    }
  });

  /**
   * Get profile's did:pkh and Ethereum address
   * Channel: online:profile:get-did-ethereum
   */
  ipcMain.handle('online:profile:get-did-ethereum', async (event) => {
    try {
      const db = dbManager.getConnection('clientdata');
      const profileManager = new OnlineProfileManager(dbManager, null);
      const currentProfileId = profileManager.getCurrentProfileId();
      
      if (!currentProfileId) {
        return { success: false, error: 'No current profile' };
      }
      
      const row = db.prepare(`
        SELECT did_pkh, ethereum_address 
        FROM user_profiles 
        WHERE profile_uuid = ?
      `).get(currentProfileId);
      
      if (!row) {
        return { success: false, error: 'Profile not found' };
      }
      
      return {
        success: true,
        didPkh: row.did_pkh || null,
        ethereumAddress: row.ethereum_address || null
      };
    } catch (error) {
      console.error('Error getting did:pkh and Ethereum address:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Get master seed as Bip39 mnemonic (requires password verification)
   * Channel: online:profile:get-master-seed-mnemonic
   */
  ipcMain.handle('online:profile:get-master-seed-mnemonic', async (event, { password }) => {
    try {
      // First verify the password using the same logic as profile-guard:verify-password
      const crypto = require('crypto');
      const db = dbManager.getConnection('clientdata');
      
      const saltRow = db.prepare(`
        SELECT csetting_value FROM csettings WHERE csetting_name = ?
      `).get('keyguardsalt');
      
      const hashRow = db.prepare(`
        SELECT csetting_value FROM csettings WHERE csetting_name = ?
      `).get('keyguard_key_hash');
      
      if (!saltRow || !hashRow) {
        return { success: false, error: 'Profile Guard not set up' };
      }
      
      const salt = Buffer.from(saltRow.csetting_value, 'hex');
      const storedHash = hashRow.csetting_value;
      
      // Derive key from password
      const keyguardKey = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
      
      // Compute hash of derived key
      const computedHash = crypto.createHash('sha512').update(keyguardKey).digest('hex');
      
      // Verify against stored hash
      if (computedHash !== storedHash) {
        return { success: false, error: 'Invalid password' };
      }
      
      // Get current profile
      const profileManager = new OnlineProfileManager(dbManager, keyguardKey);
      const currentProfileId = profileManager.getCurrentProfileId();
      
      if (!currentProfileId) {
        return { success: false, error: 'No current profile' };
      }
      
      // Get encrypted master seed
      const row = db.prepare(`
        SELECT encrypted_master_seed 
        FROM user_profiles 
        WHERE profile_uuid = ?
      `).get(currentProfileId);
      
      if (!row || !row.encrypted_master_seed) {
        return { success: false, error: 'Master seed not found for this profile' };
      }
      
      // Decrypt master seed
      const { decryptMasterSeed } = require('./utils/ProfileSeedManager');
      const masterSeed = decryptMasterSeed(row.encrypted_master_seed, keyguardKey);
      
      // Convert to Bip39 mnemonic
      const { entropyToMnemonic } = require('@scure/bip39');
      const wordlistModule = require('@scure/bip39/wordlists/english.js');
      const wordlist = wordlistModule.wordlist; // The wordlist is in a .wordlist property
      
      // Convert 32-byte seed to mnemonic (24 words for 256 bits)
      const mnemonic = entropyToMnemonic(masterSeed, wordlist);
      
      return {
        success: true,
        mnemonic: mnemonic
      };
    } catch (error) {
      console.error('Error getting master seed mnemonic:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * List all profiles with primary keypair details
   * Channel: online:profiles:list-detailed
   */
  ipcMain.handle('online:profiles:list-detailed', async (event) => {
    try {
      const keyguardKey = getKeyguardKey(event);
      const profileManager = new OnlineProfileManager(dbManager, keyguardKey);
      const profiles = profileManager.listProfiles();

      return profiles.map((profile) => {
        const metadata = profile._metadata || {};
        // CRITICAL: Keypairs are NOT stored in profile_json - get from database table
        // Get primary keypair public details from profile_keypairs table
        let primaryKeypair = null;
        try {
          const keyguardKey = getKeyguardKey(event);
          if (keyguardKey) {
            const profileManager = new OnlineProfileManager(dbManager, keyguardKey);
            const primaryKp = profileManager.getProfileKeypairs(profile.profileId || metadata.profileUuid);
            const primaryKpRow = primaryKp.find(kp => kp.keyUsage === 'primary');
            if (primaryKpRow) {
              // Only include public key details (no private key)
              primaryKeypair = {
                canonicalName: primaryKpRow.canonicalName || primaryKpRow.publicKey || '',
                publicKey: primaryKpRow.publicKey || '',
                publicKeyHex: primaryKpRow.publicKeyHex || '',
                fingerprint: primaryKpRow.fingerprint || '',
                keypairType: primaryKpRow.type || '',
                keypairUuid: primaryKpRow.uuid || null
              };
            }
          }
        } catch (kpError) {
          console.error('Error getting primary keypair for profile list:', kpError);
        }

        return {
          profileId: profile.profileId || metadata.profileUuid,
          username: profile.username || '',
          displayName: profile.displayName || '',
          isCurrent: metadata.isCurrentProfile || false,
          primaryKeypair
        };
      });
    } catch (error) {
      console.error('Error listing detailed profiles:', error);
      return [];
    }
  });

  /**
   * Switch to a different profile
   * Channel: online:profile:switch
   */
  ipcMain.handle('online:profile:switch', async (event, { profileId }) => {
    try {
      console.log(`[Profile Switch] Switching to profile: ${profileId}`);
      
      // Get keyguard key for encryption
      const keyguardKey = getKeyguardKey(event);
      if (!keyguardKey) {
        console.log(`[Profile Switch] Profile Guard not unlocked, cannot switch`);
        return { success: false, error: 'Profile Guard must be unlocked to switch profiles' };
      }
      
      const profileManager = new OnlineProfileManager(dbManager, keyguardKey);
      const currentProfileId = profileManager.getCurrentProfileId();
      
      console.log(`[Profile Switch] Current profile ID: ${currentProfileId}, Target profile ID: ${profileId}`);
      
      // If switching to the same profile, do nothing
      if (profileId === currentProfileId) {
        console.log(`[Profile Switch] Already on target profile, skipping switch`);
        const profile = profileManager.getCurrentProfile();
        // Remove metadata before returning
        if (profile && profile._metadata) {
          const { _metadata, ...profileWithoutMetadata } = profile;
          return { success: true, profile: profileWithoutMetadata };
        }
        return { success: true, profile: profile };
      }
      
      // Save current profile to database if it exists (preserve any edits)
      if (currentProfileId) {
        const currentProfile = profileManager.getCurrentProfile();
        if (currentProfile) {
          // Save current profile to preserve any edits
          try {
            profileManager.saveProfile(currentProfile, false); // Don't mark as unpublished when switching
          } catch (saveError) {
            console.error('Error saving current profile before switch:', saveError);
          }
        }
      }
      
      // Load target profile from database
      let targetProfile = profileManager.getProfile(profileId);
      
      // If not in database, try to migrate from csettings
      if (!targetProfile) {
        try {
          const migrationResult = profileManager.migrateProfileFromCsettings(profileId);
          if (migrationResult.success && !migrationResult.alreadyMigrated) {
            targetProfile = profileManager.getProfile(profileId);
          }
        } catch (migrationError) {
          console.error('Error migrating target profile from csettings:', migrationError);
        }
      }
      
      if (!targetProfile) {
        return { success: false, error: 'Profile not found' };
      }
      
      // Set target profile as current
      profileManager.setCurrentProfileId(profileId);
      
      // Sync to csettings for backward compatibility
      profileManager.syncProfileToCsettings(profileId);
      
      console.log(`[Profile Switch] Updated online_current_profile_id to: ${profileId}`);
      
      // Remove metadata before returning
      if (targetProfile._metadata) {
        const { _metadata, ...profileWithoutMetadata } = targetProfile;
        return { success: true, profile: profileWithoutMetadata };
      }
      
      return { success: true, profile: targetProfile };
    } catch (error) {
      console.error('Error switching profile:', error);
      return { success: false, error: error.message };
    }
  });
  /**
   * Create a new profile (add to standby or make current if no current profile)
   * Channel: online:profile:create-new
   */
  ipcMain.handle('online:profile:create-new', async (event, { profileData }) => {
    try {
      // Get keyguard key for encryption
      const keyguardKey = getKeyguardKey(event);
      if (!keyguardKey) {
        return { success: false, error: 'Profile Guard must be unlocked to create profiles' };
      }
      
      // Generate profile ID if not present
      if (!profileData.profileId) {
        profileData.profileId = crypto.randomUUID();
      }
      
      // IMPORTANT: Generate master seed, Ethereum wallet, and did:pkh BEFORE creating keypairs
      // This ensures seed-based keypair generation is possible
      const { generateProfileSeedAndDidPkh } = require('./utils/ProfileSeedManager');
      const { 
        encryptedSeed, 
        encryptedEthereumPrivateKey, 
        ethereumAddress, 
        didPkh, 
        seedGeneratedAt 
      } = generateProfileSeedAndDidPkh(keyguardKey);
      
      // Verify seed is not null or zero
      if (!encryptedSeed || encryptedSeed === '0' || encryptedSeed === '') {
        throw new Error('Master seed generation failed: seed is null or zero');
      }
      
      // NOTE: Ethereum wallet data is NOT added to profileData.profile_json
      // because profile_json is published to Nostr (kind 0 event).
      // PRIVATE data (encrypted_ethereum_private_key) will be stored in database column.
      // PUBLIC data (ethereum_address, did_pkh) will be stored in database columns.
      // If we want to publish did_pkh or ethereum_address to Nostr, we can add
      // them to profile_json later, but private keys must NEVER be in profile_json.
      
      // Calculate and set fp attribute for the profile
      const profileFp = await calculateProfileFp(profileData.profileId);
      profileData.fp = profileFp;
      
      // Use OnlineProfileManager to save profile
      const profileManager = new OnlineProfileManager(dbManager, keyguardKey);
      
      // Check if there's a current profile
      const hasCurrentProfile = !!profileManager.getCurrentProfileId();
      
      // Save profile to database (automatically syncs to csettings)
      const result = profileManager.saveProfile(profileData, true); // Mark as having unpublished edits
      
      // Update profile with master seed, Ethereum wallet, and did:pkh in database columns
      // PRIVATE: encrypted_master_seed, encrypted_ethereum_private_key (database columns only, NOT in profile_json)
      // PUBLIC: ethereum_address, did_pkh (database columns, can optionally be added to profile_json for publishing)
      const db = dbManager.getConnection('clientdata');
      db.prepare(`
        UPDATE user_profiles 
        SET encrypted_master_seed = ?, 
            encrypted_ethereum_private_key = ?,
            ethereum_address = ?,
            did_pkh = ?, 
            seed_generated_at = ?
        WHERE profile_uuid = ?
      `).run(encryptedSeed, encryptedEthereumPrivateKey, ethereumAddress, didPkh, seedGeneratedAt, profileData.profileId);
      
      // Also save keypairs to database if they exist
      if (profileData.primaryKeypair) {
        try {
          profileManager.migrateKeypairToDatabase(profileData.profileId, profileData.primaryKeypair, 'primary');
        } catch (keypairError) {
          console.error('Error saving primary keypair:', keypairError);
        }
      }
      
      if (profileData.additionalKeypairs) {
        profileData.additionalKeypairs.forEach((kp) => {
          try {
            profileManager.migrateKeypairToDatabase(profileData.profileId, kp, 'additional');
          } catch (keypairError) {
            console.error('Error saving additional keypair:', keypairError);
          }
        });
      }
      
      // If no current profile, make this the current profile
      if (!hasCurrentProfile) {
        profileManager.setCurrentProfileId(profileData.profileId);
        return { success: true, profile: profileData, isCurrent: true };
      } else {
        return { success: true, profile: profileData, isCurrent: false };
      }
    } catch (error) {
      console.error('Error creating new profile:', error);
      return { success: false, error: error.message };
    }
  });
  /**
   * Delete a profile (remove from standby or current, if it's the current profile then switch to another or clear)
   * Channel: online:profile:delete
   */
  ipcMain.handle('online:profile:delete', async (event, { profileId }) => {
    try {
      // Get keyguard key for decryption
      const keyguardKey = getKeyguardKey(event);
      if (!keyguardKey) {
        return { success: false, error: 'Profile Guard must be unlocked to delete profiles' };
      }
      
      const profileManager = new OnlineProfileManager(dbManager, keyguardKey);
      const currentProfileId = profileManager.getCurrentProfileId();
      const isCurrentProfile = profileId === currentProfileId;
      
      // If it's the current profile, try to switch to another profile first
      if (isCurrentProfile) {
        const allProfiles = profileManager.listProfiles();
        const otherProfiles = allProfiles.filter(p => (p.profileId || p._metadata?.profileUuid) !== profileId);
        
        if (otherProfiles.length > 0) {
          // Switch to the first available profile
          const newCurrentProfile = otherProfiles[0];
          const newProfileId = newCurrentProfile.profileId || newCurrentProfile._metadata?.profileUuid;
          if (newProfileId) {
            profileManager.setCurrentProfileId(newProfileId);
            profileManager.syncProfileToCsettings(newProfileId);
          }
        } else {
          // No other profiles, clear current profile ID (managed by OnlineProfileManager)
          profileManager.setCurrentProfileId('');
        }
      }
      
      // Delete profile from database (cascade will delete keypairs)
      const result = profileManager.deleteProfile(profileId);
      
      return result;
    } catch (error) {
      console.error('Error deleting profile:', error);
      return { success: false, error: error.message };
    }
  });
  /**
   * Import profile from encrypted file
   * Channel: online:profile:import
   */
  ipcMain.handle('online:profile:import', async (event, { filePath, password, overwriteExisting }) => {
    try {
      const fs = require('fs');
      const crypto = require('crypto');
      
      // Read encrypted file
      const encryptedData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      
      // Derive key from password using PBKDF2
      const salt = Buffer.from(encryptedData.salt, 'hex');
      const key = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
      
      // Decrypt profile
      const iv = Buffer.from(encryptedData.iv, 'hex');
      const encrypted = Buffer.from(encryptedData.data, 'hex');
      
      const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
      let decrypted = decipher.update(encrypted);
      decrypted = Buffer.concat([decrypted, decipher.final()]);
      
      const importedProfile = JSON.parse(decrypted.toString('utf8'));
      
      // Get keyguard key for saving
      const keyguardKey = getKeyguardKey(event);
      if (!keyguardKey) {
        return { success: false, error: 'Profile Guard must be unlocked to import profiles' };
      }
      
      const profileManager = new OnlineProfileManager(dbManager, keyguardKey);
      
      // Check if profile already exists
      const existingProfile = profileManager.getProfile(importedProfile.profileId);
      const profileExists = !!existingProfile;
      
      if (profileExists && !overwriteExisting) {
        return { success: false, error: 'Profile already exists. Enable overwrite to replace it.' };
      }
      
      // Calculate and set fp attribute for the imported profile
      const profileFp = await calculateProfileFp(importedProfile.profileId);
      importedProfile.fp = profileFp;
      
      // Check if this is the current profile
      const currentProfileId = profileManager.getCurrentProfileId();
      const isCurrent = importedProfile.profileId === currentProfileId;
      
      // Save profile to database
      profileManager.saveProfile(importedProfile, false); // Don't mark as unpublished during import
      
      // Migrate keypairs if they exist
      if (importedProfile.primaryKeypair) {
        try {
          profileManager.migrateKeypairToDatabase(importedProfile.profileId, importedProfile.primaryKeypair, 'primary');
        } catch (keypairError) {
          console.error('Error saving primary keypair:', keypairError);
        }
      }
      
      if (importedProfile.additionalKeypairs) {
        importedProfile.additionalKeypairs.forEach((kp) => {
          try {
            profileManager.migrateKeypairToDatabase(importedProfile.profileId, kp, 'additional');
          } catch (keypairError) {
            console.error('Error saving additional keypair:', keypairError);
          }
        });
      }
      
      // If this is the current profile or there's no current profile, set it as current
      if (isCurrent || !currentProfileId) {
        profileManager.setCurrentProfileId(importedProfile.profileId);
        return { success: true, profile: importedProfile, isCurrent: true };
      } else {
        return { success: true, profile: importedProfile, isCurrent: false };
      }
    } catch (error) {
      console.error('Error importing profile:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Create new online profile (legacy - kept for compatibility)
   * Channel: online:profile:create
   */
  ipcMain.handle('online:profile:create', async (event, { keyType }) => {
    try {
      const keyguardKey = getKeyguardKey(event);
      if (!keyguardKey) {
        return { success: false, error: 'Profile Guard must be unlocked to create profiles' };
      }
      
      // Generate profile ID first
      const profileId = crypto.randomUUID();
      
      // IMPORTANT: Generate master seed, Ethereum wallet, and did:pkh BEFORE creating the first keypair
      // This ensures seed-based keypair generation is possible
      const { generateProfileSeedAndDidPkh } = require('./utils/ProfileSeedManager');
      const { 
        encryptedSeed, 
        encryptedEthereumPrivateKey, 
        ethereumAddress, 
        didPkh, 
        seedGeneratedAt 
      } = generateProfileSeedAndDidPkh(keyguardKey);
      
      // Verify seed is not null or zero
      if (!encryptedSeed || encryptedSeed === '0' || encryptedSeed === '') {
        throw new Error('Master seed generation failed: seed is null or zero');
      }
      
      // Verify Ethereum private key encryption succeeded
      if (!encryptedEthereumPrivateKey || encryptedEthereumPrivateKey === '0' || encryptedEthereumPrivateKey === '') {
        throw new Error('Ethereum private key encryption failed');
      }
      
      // Users' first profile key must be a Nostr key
      const actualKeyType = keyType || 'Nostr';
      
      // Generate the actual keypair (will be seed-based, but we need to implement that separately)
      // For now, generate normally - seed-based derivation will be added later
      const keypair = await generateKeypair(actualKeyType);
      
      const profile = {
        profileId,
        displayName: '',
        bio: '',
        primaryKeypair: {
          type: keypair.type,
          publicKey: keypair.publicKey,
          privateKey: keypair.privateKey, // Will be encrypted with Profile Guard
          publicKeyHex: keypair.publicKeyHex,
          fingerprint: keypair.fingerprint
        },
        additionalKeypairs: [],
        adminKeypairs: [],
        isAdmin: false
        // NOTE: Ethereum wallet data (ethereum_privkey, ethereum_address, did_pkh) 
        // is NOT stored in profile_json because profile_json is published to Nostr.
        // PRIVATE data (encrypted_ethereum_private_key) is stored in database column.
        // PUBLIC data (ethereum_address, did_pkh) is stored in database columns.
        // If we want to publish did_pkh or ethereum_address to Nostr, we can add
        // them to profile_json later, but private keys must NEVER be in profile_json.
      };
      
      const profileManager = new OnlineProfileManager(dbManager, keyguardKey);
      
      // Calculate and set fp attribute
      const profileFp = await calculateProfileFp(profile.profileId);
      profile.fp = profileFp;
      
      // Save profile to database - OnlineProfileManager.saveProfile will handle the profile_json
      // But we need to set encrypted_master_seed and did_pkh separately
      profileManager.saveProfile(profile, true);
      
      // Update profile with master seed, Ethereum wallet, and did:pkh in database columns
      // AFTER saving the profile record
      // PRIVATE: encrypted_master_seed, encrypted_ethereum_private_key (database columns only, NOT in profile_json)
      // PUBLIC: ethereum_address, did_pkh (database columns, can optionally be added to profile_json for publishing)
      const db = dbManager.getConnection('clientdata');
      db.prepare(`
        UPDATE user_profiles 
        SET encrypted_master_seed = ?, 
            encrypted_ethereum_private_key = ?,
            ethereum_address = ?,
            did_pkh = ?, 
            seed_generated_at = ?
        WHERE profile_uuid = ?
      `).run(encryptedSeed, encryptedEthereumPrivateKey, ethereumAddress, didPkh, seedGeneratedAt, profileId);
      
      // Save keypairs
      if (profile.primaryKeypair) {
        profileManager.migrateKeypairToDatabase(profile.profileId, profile.primaryKeypair, 'primary');
      }
      
      return { success: true, profile };
    } catch (error) {
      console.error('Error creating online profile:', error);
      return { success: false, error: error.message };
    }
  });
  /**
   * Save online profile
   * Channel: online:profile:save
   * Note: This saves the current profile. Private keys are stored encrypted in database.
   */
  ipcMain.handle('online:profile:save', async (event, profile) => {
    try {
      console.log('[online:profile:save] Received profile primaryKeypair privateKey length:', profile?.primaryKeypair?.privateKey ? String(profile.primaryKeypair.privateKey).length : 'none');
      console.log('[online:profile:save] Received profile primaryKeypair privateKey sample:', profile?.primaryKeypair?.privateKey ? String(profile.primaryKeypair.privateKey).substring(0, 20) : 'none');
      // Get keyguard key for encryption
      const keyguardKey = getKeyguardKey(event);
      if (!keyguardKey) {
        return { success: false, error: 'Profile Guard must be unlocked to save profiles' };
      }
      
      // Calculate and set fp attribute for the profile
      const profileFp = await calculateProfileFp(profile.profileId);
      profile.fp = profileFp;
      
      // Use OnlineProfileManager to save profile
      const profileManager = new OnlineProfileManager(dbManager, keyguardKey);
      
      // If this is the current profile, ensure it's set as current
      const currentProfileId = profileManager.getCurrentProfileId();
      if (!currentProfileId && profile.profileId) {
        profileManager.setCurrentProfileId(profile.profileId);
      }
      
      // Save profile to database (automatically syncs to csettings)
      const result = profileManager.saveProfile(profile, true); // Mark as having unpublished edits
      
      // Also save keypairs to database if they exist
      if (profile.primaryKeypair) {
        try {
          profileManager.migrateKeypairToDatabase(profile.profileId, profile.primaryKeypair, 'primary');
        } catch (keypairError) {
          console.error('Error saving primary keypair:', keypairError);
        }
      }
      
      if (profile.additionalKeypairs) {
        profile.additionalKeypairs.forEach((kp) => {
          try {
            profileManager.migrateKeypairToDatabase(profile.profileId, kp, 'additional');
          } catch (keypairError) {
            console.error('Error saving additional keypair:', keypairError);
          }
        });
      }
      
      return result;
    } catch (error) {
      console.error('Error saving online profile:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Get Profile Guard key for encryption
   * Helper function to get the keyguard key from session or storage
   */
  function getKeyguardKey(event) {
    // First try to get from session (if unlocked in high security mode)
    if (event.sender.session.keyguardKey) {
      return event.sender.session.keyguardKey;
    }
    
    // Otherwise try to get from safeStorage
    const { safeStorage } = require('electron');
    if (safeStorage.isEncryptionAvailable()) {
      const db = dbManager.getConnection('clientdata');
      const encryptedKeyRow = db.prepare(`
        SELECT csetting_value FROM csettings WHERE csetting_name = ?
      `).get('keyguard_key_encrypted');
      
      if (encryptedKeyRow) {
        try {
          const encryptedKey = Buffer.from(encryptedKeyRow.csetting_value, 'base64');
          const keyHex = safeStorage.decryptString(encryptedKey);
          return Buffer.from(keyHex, 'hex');
        } catch (error) {
          console.warn('Error decrypting keyguard key:', error);
        }
      }
    }
    
    return null;
  }

  /**
   * Calculate fingerprint for a profile
   * @param {string} profileUuid - Profile UUID
   * @returns {Promise<string>} Base64-encoded fingerprint
   */
  async function calculateProfileFp(profileUuid) {
    try {
      const db = dbManager.getConnection('clientdata');
      
      // Get keyguard_key_hash from csettings
      const keyHashRow = db.prepare(`
        SELECT csetting_value FROM csettings WHERE csetting_name = ?
      `).get('keyguard_key_hash');
      
      if (!keyHashRow || !keyHashRow.csetting_value) {
        // If no keyguard_key_hash, use empty string
        const hostFP = new HostFP();
        return await hostFP.getv(profileUuid || '', '');
      }
      
      // Get first 32 bytes (64 hex chars) of the keyguard_key_hash
      const keyHash = keyHashRow.csetting_value;
      const keyHashFirst32Bytes = keyHash.substring(0, 64);
      
      // Calculate fingerprint using HostFP
      const hostFP = new HostFP();
      return await hostFP.getv(profileUuid || '', keyHashFirst32Bytes);
    } catch (error) {
      console.error('Error calculating profile fingerprint:', error);
      // Fallback to empty fingerprint
      const hostFP = new HostFP();
      return await hostFP.getv(profileUuid || '', '');
    }
  }
  /**
   * Generate keypair based on type
   * @param {string} keyType - Nostr, ML-DSA-44, ML-DSA-87, ED25519, or RSA-2048
   * @returns {Promise<Object>} Keypair with publicKey, privateKey, and metadata
   */
  async function generateKeypair(keyType) {
    const crypto = require('crypto');
    
    switch (keyType) {
      case 'Nostr': {
        // Nostr uses secp256k1 elliptic curve with Schnorr signatures
        const { generateSecretKey, getPublicKey } = require('nostr-tools');
        const nip19 = require('nostr-tools/nip19');
        
        // Generate a 32-byte private key (secp256k1) - returns Uint8Array
        const privateKeyBytes = generateSecretKey();
        const privateKeyHex = Buffer.from(privateKeyBytes).toString('hex');
        console.log('[generateKeypair:Nostr] Generated private key hex length:', privateKeyHex.length);
        
        // Get public key in hex format (not npub format)
        const publicKeyHex = getPublicKey(privateKeyBytes);
        
        // Convert hex private key to Buffer for fingerprint calculation
        const privateKeyBuffer = Buffer.from(privateKeyHex, 'hex');
        console.log('[generateKeypair:Nostr] Private key buffer length:', privateKeyBuffer.length);
        const publicKeyBuffer = Buffer.from(publicKeyHex, 'hex');
        
        // Generate fingerprint from public key
        const fingerprint = crypto.createHash('sha256').update(publicKeyBuffer).digest('hex');
        
        // Convert to PEM-like format for consistency
        const privateKeyBase64 = privateKeyBuffer.toString('base64');
        const privateKeyWrapped = privateKeyBase64.match(/.{1,64}/g) ? privateKeyBase64.match(/.{1,64}/g).join('\n') : privateKeyBase64;
        const privateKeyPem = `-----BEGIN NOSTR PRIVATE KEY-----\n` +
          privateKeyWrapped + '\n' +
          `-----END NOSTR PRIVATE KEY-----`;
        
        // Convert public key to npub format for display
        const npub = nip19.npubEncode(publicKeyHex);
        console.log('[generateKeypair:Nostr] Private key hex sample:', privateKeyHex.substring(0, 20));
        
        return {
          type: 'Nostr',
          publicKey: npub, // Store as npub format for display
          privateKey: privateKeyPem,
          publicKeyHex: publicKeyHex, // Store hex for internal use
          privateKeyRaw: privateKeyHex, // Store raw hex for encryption
          fingerprint: fingerprint
        };
      }
      
      case 'ED25519': {
        const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
          publicKeyEncoding: {
            type: 'spki',
            format: 'pem'
          },
          privateKeyEncoding: {
            type: 'pkcs8',
            format: 'pem'
          }
        });
        
        // Convert to hex for fingerprint calculation
        const publicKeyDer = crypto.createPublicKey(publicKey).export({ type: 'spki', format: 'der' });
        const fingerprint = crypto.createHash('sha256').update(publicKeyDer).digest('hex');
        
        return {
          type: 'ED25519',
          publicKey: publicKey,
          privateKey: privateKey,
          publicKeyHex: publicKeyDer.toString('hex'),
          fingerprint: fingerprint
        };
      }
      
      case 'RSA-2048': {
        const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
          modulusLength: 2048,
          publicKeyEncoding: {
            type: 'spki',
            format: 'pem'
          },
          privateKeyEncoding: {
            type: 'pkcs8',
            format: 'pem'
          }
        });
        
        const publicKeyDer = crypto.createPublicKey(publicKey).export({ type: 'spki', format: 'der' });
        const fingerprint = crypto.createHash('sha256').update(publicKeyDer).digest('hex');
        
        return {
          type: 'RSA-2048',
          publicKey: publicKey,
          privateKey: privateKey,
          publicKeyHex: publicKeyDer.toString('hex'),
          fingerprint: fingerprint
        };
      }
      
      case 'ML-DSA-44': {
        // ML-DSA-44: Post-quantum algorithm (FIPS 204)
        // Use dynamic import since @noble/post-quantum is an ES module
        const mlDsaModule = await import('@noble/post-quantum/ml-dsa.js');
        const ml_dsa44 = mlDsaModule.ml_dsa44;
        
        // Generate keypair
        // Note: @noble/post-quantum uses 'secretKey' not 'privateKey'
        const { publicKey, secretKey } = ml_dsa44.keygen();
        
        // Convert Uint8Array to hex for storage (must convert immediately to avoid cloning issues)
        const publicKeyHex = Buffer.from(publicKey).toString('hex');
        const privateKeyHex = Buffer.from(secretKey).toString('hex');
        
        // Generate fingerprint from public key (must use Buffer, not Uint8Array directly)
        const fingerprint = crypto.createHash('sha256').update(Buffer.from(publicKey)).digest('hex');
        
        // Convert to PEM-like format for consistency with other key types
        const publicKeyBase64 = Buffer.from(publicKey).toString('base64');
        const publicKeyWrapped = publicKeyBase64.match(/.{1,64}/g) ? publicKeyBase64.match(/.{1,64}/g).join('\n') : publicKeyBase64;
        const publicKeyPem = `-----BEGIN ML-DSA-44 PUBLIC KEY-----\n` +
          publicKeyWrapped + '\n' +
          `-----END ML-DSA-44 PUBLIC KEY-----`;
        
        const privateKeyBase64 = Buffer.from(secretKey).toString('base64');
        const privateKeyWrapped = privateKeyBase64.match(/.{1,64}/g) ? privateKeyBase64.match(/.{1,64}/g).join('\n') : privateKeyBase64;
        const privateKeyPem = `-----BEGIN ML-DSA-44 PRIVATE KEY-----\n` +
          privateKeyWrapped + '\n' +
          `-----END ML-DSA-44 PRIVATE KEY-----`;
        
        return {
          type: 'ML-DSA-44',
          publicKey: publicKeyPem,
          privateKey: privateKeyPem,
          publicKeyHex: publicKeyHex,
          privateKeyRaw: privateKeyHex, // Store raw private key for encryption
          fingerprint: fingerprint
        };
      }
      
      case 'ML-DSA-87': {
        // ML-DSA-87: Post-quantum algorithm (FIPS 204) - higher security level
        // Use dynamic import since @noble/post-quantum is an ES module
        const mlDsaModule = await import('@noble/post-quantum/ml-dsa.js');
        const ml_dsa87 = mlDsaModule.ml_dsa87;
        
        // Generate keypair
        // Note: @noble/post-quantum uses 'secretKey' not 'privateKey'
        const { publicKey, secretKey } = ml_dsa87.keygen();
        
        // Convert Uint8Array to hex for storage (must convert immediately to avoid cloning issues)
        const publicKeyHex = Buffer.from(publicKey).toString('hex');
        const privateKeyHex = Buffer.from(secretKey).toString('hex');
        
        // Generate fingerprint from public key (must use Buffer, not Uint8Array directly)
        const fingerprint = crypto.createHash('sha256').update(Buffer.from(publicKey)).digest('hex');
        
        // Convert to PEM-like format for consistency with other key types
        const publicKeyBase64 = Buffer.from(publicKey).toString('base64');
        const publicKeyWrapped = publicKeyBase64.match(/.{1,64}/g) ? publicKeyBase64.match(/.{1,64}/g).join('\n') : publicKeyBase64;
        const publicKeyPem = `-----BEGIN ML-DSA-87 PUBLIC KEY-----\n` +
          publicKeyWrapped + '\n' +
          `-----END ML-DSA-87 PUBLIC KEY-----`;
        
        const privateKeyBase64 = Buffer.from(secretKey).toString('base64');
        const privateKeyWrapped = privateKeyBase64.match(/.{1,64}/g) ? privateKeyBase64.match(/.{1,64}/g).join('\n') : privateKeyBase64;
        const privateKeyPem = `-----BEGIN ML-DSA-87 PRIVATE KEY-----\n` +
          privateKeyWrapped + '\n' +
          `-----END ML-DSA-87 PRIVATE KEY-----`;
        
        return {
          type: 'ML-DSA-87',
          publicKey: publicKeyPem,
          privateKey: privateKeyPem,
          publicKeyHex: publicKeyHex,
          privateKeyRaw: privateKeyHex, // Store raw private key for encryption
          fingerprint: fingerprint
        };
      }
      
      default:
        throw new Error(`Unsupported key type: ${keyType}`);
    }
  }

  /**
   * Generate local name for keypair
   * Format: username_type_digits
   * @param {string} username - User's username
   * @param {string} keyType - Key type (ML-DSA-44, ED25519, etc.)
   * @param {string} fingerprint - SHA256 fingerprint
   * @returns {string} Local name
   */
  function generateLocalKeypairName(username, keyType, fingerprint, publicKey = null) {
    // For Nostr keys, use <username>_<public_key> format
    if (keyType === 'Nostr' && publicKey) {
      return `${username}_${publicKey}`;
    }
    
    // For other keys, use last 6 hex digits of fingerprint as distinguishing digits
    const digits = fingerprint.slice(-6);
    const typeNormalized = keyType.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    return `${username}_${typeNormalized}_${digits}`;
  }

  /**
   * Generate canonical remote name for keypair
   * Format: type_fingerprint or type_publickey
   * For Nostr keys: just the npub public key (Bech32 format)
   * @param {string} keyType - Key type
   * @param {string} fingerprint - SHA256 fingerprint
   * @param {string} publicKeyHex - Public key in hex format (optional)
   * @param {string} publicKey - Public key in display format (npub for Nostr, PEM for others)
   * @param {boolean} usePublicKey - If true, use full public key instead of fingerprint
   * @returns {string} Canonical remote name
   */
  function generateCanonicalKeypairName(keyType, fingerprint, publicKeyHex, publicKey = null, usePublicKey = false) {
    // For Nostr keys, canonical_name is just the public key in Bech32 format (npub...)
    if (keyType === 'Nostr' && publicKey) {
      return publicKey; // npub format
    }
    
    const typeNormalized = keyType.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    if (usePublicKey && publicKeyHex) {
      return `${typeNormalized}_${publicKeyHex}`;
    }
    return `${typeNormalized}_${fingerprint}`;
  }
  /**
   * Create online keypair
   * Channel: online:keypair:create
   */
  ipcMain.handle('online:keypair:create', async (event, { keyType, isPrimary, username }) => {
    try {
      const crypto = require('crypto');
      
      // Get username from profile if not provided
      let usernameForName = username;
      if (!usernameForName) {
        const keyguardKey = getKeyguardKey(event);
        if (keyguardKey) {
          const profileManager = new OnlineProfileManager(dbManager, keyguardKey);
          const currentProfile = profileManager.getCurrentProfile();
          if (currentProfile) {
            usernameForName = currentProfile.username || 'user';
          } else {
            usernameForName = 'user';
          }
        } else {
          usernameForName = 'user';
        }
      }
      
      // Generate actual keypair
      const keypairData = await generateKeypair(keyType || 'ML-DSA-44');
      
      // Generate names
      const localName = generateLocalKeypairName(usernameForName, keypairData.type, keypairData.fingerprint, keypairData.publicKey);
      const canonicalName = generateCanonicalKeypairName(keypairData.type, keypairData.fingerprint, keypairData.publicKeyHex, keypairData.publicKey);
      
      // Create keypair object with only serializable values (strings, numbers)
      // Ensure all values are plain JavaScript types for IPC serialization
      const keypair = {
        type: String(keypairData.type),
        publicKey: String(keypairData.publicKey),
        privateKey: String(keypairData.privateKey),
        publicKeyHex: String(keypairData.publicKeyHex),
        fingerprint: String(keypairData.fingerprint),
        localName: String(localName),
        canonicalName: String(canonicalName),
        createdAt: String(new Date().toISOString())
      };
      
      // Include privateKeyRaw if available (for ML-DSA encryption) - ensure it's a string
      if (keypairData.privateKeyRaw) {
        keypair.privateKeyRaw = String(keypairData.privateKeyRaw);
      }
      
      // Encrypt private key with Profile Guard if available
      const keyguardKey = getKeyguardKey(event);
      if (keyguardKey) {
        // Encrypt private key
        // For ML-DSA, use privateKeyRaw if available (hex format), otherwise use PEM format
        const keyToEncrypt = keypair.privateKeyRaw || keypair.privateKey;
        const keyData = keypair.privateKeyRaw ? Buffer.from(keyToEncrypt, 'hex') : Buffer.from(keyToEncrypt, 'utf8');
        
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv('aes-256-cbc', keyguardKey, iv);
        let encrypted = cipher.update(keyData);
        encrypted = Buffer.concat([encrypted, cipher.final()]);
        
        // Store encrypted private key as hex string
        keypair.privateKey = iv.toString('hex') + ':' + encrypted.toString('hex');
        console.log('[createOnlineKeypair] Encrypted private key length:', keypair.privateKey.length);
        console.log('[createOnlineKeypair] Plain key length (bytes):', keyData.length);
        // Store format indicator for decryption
        keypair.privateKeyFormat = keypair.privateKeyRaw ? 'hex' : 'pem';
        keypair.encrypted = true;
        // Remove raw private key from unencrypted output
        delete keypair.privateKeyRaw;
      } else {
        // Check if Profile Guard is enabled (user needs to unlock)
        const db = dbManager.getConnection('clientdata');
        const saltRow = db.prepare(`
          SELECT csetting_value FROM csettings WHERE csetting_name = ?
        `).get('keyguardsalt');
        
        if (saltRow) {
          return { success: false, error: 'Profile Guard is enabled but not unlocked. Please unlock Profile Guard first.' };
        }
      }
      
      return { success: true, keypair };
    } catch (error) {
      console.error('Error creating keypair:', error);
      return { success: false, error: error.message };
    }
  });
  /**
   * Regenerate online keypair
   * Channel: online:keypair:regenerate
   */
  ipcMain.handle('online:keypair:regenerate', async (event, { keyType, username }) => {
    try {
      // Get username from profile if not provided
      let usernameForName = username;
      if (!usernameForName) {
        const keyguardKey = getKeyguardKey(event);
        if (keyguardKey) {
          const profileManager = new OnlineProfileManager(dbManager, keyguardKey);
          const currentProfile = profileManager.getCurrentProfile();
          if (currentProfile) {
            usernameForName = currentProfile.username || 'user';
          } else {
            usernameForName = 'user';
          }
        } else {
          usernameForName = 'user';
        }
      }
      
      // Generate new keypair (same as create)
      const keypairData = await generateKeypair(keyType || 'ML-DSA-44');
      
      // Generate names
      const localName = generateLocalKeypairName(usernameForName, keypairData.type, keypairData.fingerprint, keypairData.publicKey);
      const canonicalName = generateCanonicalKeypairName(keypairData.type, keypairData.fingerprint, keypairData.publicKeyHex, keypairData.publicKey);
      
      // Create keypair object with only serializable values (strings, numbers)
      // Ensure all values are plain JavaScript types for IPC serialization
      const keypair = {
        type: String(keypairData.type),
        publicKey: String(keypairData.publicKey),
        privateKey: String(keypairData.privateKey),
        publicKeyHex: String(keypairData.publicKeyHex),
        fingerprint: String(keypairData.fingerprint),
        localName: String(localName),
        canonicalName: String(canonicalName),
        createdAt: String(new Date().toISOString())
      };
      
      // Include privateKeyRaw if available (for ML-DSA encryption) - ensure it's a string
      if (keypairData.privateKeyRaw) {
        keypair.privateKeyRaw = String(keypairData.privateKeyRaw);
      }
      
      // Encrypt private key with Profile Guard if available
      const keyguardKey = getKeyguardKey(event);
      if (keyguardKey) {
        const crypto = require('crypto');
        // Encrypt private key
        // For ML-DSA, use privateKeyRaw if available (hex format), otherwise use PEM format
        const keyToEncrypt = keypair.privateKeyRaw || keypair.privateKey;
        const keyData = keypair.privateKeyRaw ? Buffer.from(keyToEncrypt, 'hex') : Buffer.from(keyToEncrypt, 'utf8');
        
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv('aes-256-cbc', keyguardKey, iv);
        let encrypted = cipher.update(keyData);
        encrypted = Buffer.concat([encrypted, cipher.final()]);
        
        // Store encrypted private key as hex string
        keypair.privateKey = iv.toString('hex') + ':' + encrypted.toString('hex');
        // Store format indicator for decryption
        keypair.privateKeyFormat = keypair.privateKeyRaw ? 'hex' : 'pem';
        keypair.encrypted = true;
        // Remove raw private key from unencrypted output
        delete keypair.privateKeyRaw;
      } else {
        // Check if Profile Guard is enabled (user needs to unlock)
        const db = dbManager.getConnection('clientdata');
        const saltRow = db.prepare(`
          SELECT csetting_value FROM csettings WHERE csetting_name = ?
        `).get('keyguardsalt');
        
        if (saltRow) {
          return { success: false, error: 'Profile Guard is enabled but not unlocked. Please unlock Profile Guard first.' };
        }
      }
      
      return { success: true, keypair };
    } catch (error) {
      console.error('Error regenerating keypair:', error);
      return { success: false, error: error.message };
    }
  });

  // Note: Admin master keys are now stored in the admin_keypairs table with key_usage = 'master-admin-signing'
  // The old online:master-keys:get and online:master-keys:save handlers have been removed.

  /**
   * Copy text to clipboard
   * Channel: clipboard:write
   */
  ipcMain.handle('clipboard:write', async (event, text) => {
    try {
      const { clipboard } = require('electron');
      clipboard.writeText(text);
      return { success: true };
    } catch (error) {
      console.error('Error copying to clipboard:', error);
      return { success: false, error: error.message };
    }
  });

  // ===========================================================================
  // PROFILE GUARD OPERATIONS
  // ===========================================================================
  /**
   * Check Profile Guard status
   * Channel: profile-guard:check
   */
  ipcMain.handle('profile-guard:check', async () => {
    try {
      const db = dbManager.getConnection('clientdata');
      const { safeStorage } = require('electron');
      
      // Check if keyguard salt exists (indicates Profile Guard is set up)
      const saltRow = db.prepare(`
        SELECT csetting_value FROM csettings WHERE csetting_name = ?
      `).get('keyguardsalt');
      
      if (!saltRow) {
        return { enabled: false };
      }
      
      // Check high security mode setting
      const highSecurityRow = db.prepare(`
        SELECT csetting_value FROM csettings WHERE csetting_name = ?
      `).get('keyguard_high_security_mode');
      
      const highSecurityMode = highSecurityRow?.csetting_value === 'true';
      
      // Check if key is stored in safeStorage (only if not in high security mode)
      let keyStored = false;
      if (!highSecurityMode && safeStorage.isEncryptionAvailable()) {
        try {
          const stored = db.prepare(`
            SELECT csetting_value FROM csettings WHERE csetting_name = ?
          `).get('keyguard_key_stored');
          keyStored = stored !== null;
        } catch (error) {
          // Key not stored
        }
      }
      
      return { 
        enabled: true,
        highSecurityMode: highSecurityMode,
        keyStored: keyStored
      };
    } catch (error) {
      console.error('Error checking Profile Guard status:', error);
      return { enabled: false };
    }
  });
  /**
   * Set up Profile Guard
   * Channel: profile-guard:setup
   */
  /**
   * Set up Profile Guard
   * Channel: profile-guard:setup
   * 
   * If changePassword is true, this will:
   * 1. Verify the old password or use in-memory keyguard key (if unlocked and not in High Security Mode)
   * 2. Generate new keyguard key from new password
   * 3. Atomically re-encrypt ALL secrets with the new key in a single transaction
   * 4. Update Keyguard settings
   * 
   * The operation is fully atomic - either all secrets are re-encrypted or none are.
   */
  ipcMain.handle('profile-guard:setup', async (event, { password, highSecurityMode, changePassword, oldPassword }) => {
    try {
      const crypto = require('crypto');
      const { safeStorage } = require('electron');
      const db = dbManager.getConnection('clientdata');
      
      // Ensure WAL mode is enabled for transaction safety
      db.pragma('journal_mode = WAL');
      
      let oldKeyguardKey = null;
      
      // If changing password, get old keyguard key
      if (changePassword) {
        // Check High Security Mode and require_reauth setting
        const highSecurityRow = db.prepare(`
          SELECT csetting_value FROM csettings WHERE csetting_name = ?
        `).get('keyguard_high_security_mode');
        const isHighSecurityMode = highSecurityRow?.csetting_value === 'true';
        
        const requireReauthRow = db.prepare(`
          SELECT csetting_value FROM csettings WHERE csetting_name = ?
        `).get('require_reauth');
        const requireReauth = requireReauthRow?.csetting_value === '1';
        
        // Get stored hash for verification
        const oldHashRow = db.prepare(`
          SELECT csetting_value FROM csettings WHERE csetting_name = ?
        `).get('keyguard_key_hash');
        
        if (!oldHashRow) {
          return { success: false, error: 'Profile Guard not set up - cannot change password' };
        }
        
        const oldStoredHash = oldHashRow.csetting_value;
        
        // If old password provided, use it
        if (oldPassword) {
          const oldSaltRow = db.prepare(`
            SELECT csetting_value FROM csettings WHERE csetting_name = ?
          `).get('keyguardsalt');
          
          if (!oldSaltRow) {
            return { success: false, error: 'Profile Guard not set up - cannot change password' };
          }
          
          const oldSalt = Buffer.from(oldSaltRow.csetting_value, 'hex');
          oldKeyguardKey = crypto.pbkdf2Sync(oldPassword, oldSalt, 100000, 32, 'sha256');
          
          // Verify old password
          const oldComputedHash = crypto.createHash('sha512').update(oldKeyguardKey).digest('hex');
          if (oldComputedHash !== oldStoredHash) {
            return { success: false, error: 'Invalid old password' };
          }
        } 
        // If no old password provided, check if we can use in-memory keyguard key
        else {
          // Require password if in High Security Mode or require_reauth is set
          if (isHighSecurityMode || requireReauth) {
            return { success: false, error: 'Current password is required when changing password in High Security Mode or when require_reauth is enabled' };
          }
          
          // Try to get in-memory keyguard key from session
          const inMemoryKeyguardKey = getKeyguardKey(event);
          
          if (!inMemoryKeyguardKey) {
            return { success: false, error: 'Profile Guard is not unlocked. Please unlock it first or provide your current password.' };
          }
          
          // Verify the in-memory key matches the stored hash (same logic as unlock)
          const inMemoryKeyHash = crypto.createHash('sha512').update(inMemoryKeyguardKey).digest('hex');
          if (inMemoryKeyHash !== oldStoredHash) {
            return { success: false, error: 'In-memory keyguard key does not match stored key. Please unlock Profile Guard again or provide your current password.' };
          }
          
          // Use the verified in-memory key
          oldKeyguardKey = inMemoryKeyguardKey;
        }
      }
      
      // Generate new salt and key
      const newSalt = crypto.randomBytes(32);
      const newKeyguardKey = crypto.pbkdf2Sync(password, newSalt, 100000, 32, 'sha256');
      const newKeyHash = crypto.createHash('sha512').update(newKeyguardKey).digest('hex');
      
      // Prepare safeStorage key if not in high security mode
      let newEncryptedKey = null;
      if (!highSecurityMode && safeStorage.isEncryptionAvailable()) {
        try {
          newEncryptedKey = safeStorage.encryptString(newKeyguardKey.toString('hex')).toString('base64');
        } catch (error) {
          console.warn('Could not encrypt key for safeStorage:', error);
        }
      }
      
      // If changing password, re-encrypt all secrets atomically
      if (changePassword && oldKeyguardKey) {
        const { reencryptAllSecrets } = require('./utils/KeyguardReencryption');
        
        console.log('[profile-guard:setup] Re-encrypting all secrets with new keyguard key...');
        const reencryptResult = reencryptAllSecrets(
          db,
          oldKeyguardKey,
          newKeyguardKey,
          newSalt.toString('hex'),
          newKeyHash,
          highSecurityMode,
          newEncryptedKey
        );
        
        if (!reencryptResult.success) {
          console.error('[profile-guard:setup] Re-encryption failed:', reencryptResult.error);
          return { 
            success: false, 
            error: `Failed to re-encrypt secrets: ${reencryptResult.error}` 
          };
        }
        
        console.log(`[profile-guard:setup] Successfully re-encrypted ${reencryptResult.reencryptedCount} secret(s)`);
        
        // Verify re-encryption was successful
        const { verifyReencryption } = require('./utils/KeyguardReencryption');
        const verifyResult = verifyReencryption(db, newKeyguardKey);
        
        if (!verifyResult.success) {
          console.error('[profile-guard:setup] Verification failed after re-encryption:', verifyResult.errors);
          // This should never happen if transaction worked, but log it
          return {
            success: false,
            error: `Re-encryption completed but verification failed: ${verifyResult.errors.join('; ')}`
          };
        }
        
        console.log(`[profile-guard:setup] Verified ${verifyResult.verifiedCount} secret(s) can be decrypted with new key`);
        
        return { 
          success: true, 
          highSecurityMode: highSecurityMode,
          reencryptedCount: reencryptResult.reencryptedCount,
          verifiedCount: verifyResult.verifiedCount
        };
      }
      
      // New setup (not changing password) - just store settings
      // Store salt in database
      const uuid1 = crypto.randomUUID();
      db.prepare(`
        INSERT INTO csettings (csettinguid, csetting_name, csetting_value)
        VALUES (?, ?, ?)
        ON CONFLICT(csetting_name) DO UPDATE SET csetting_value = excluded.csetting_value
      `).run(uuid1, 'keyguardsalt', newSalt.toString('hex'));
      
      // Store SHA512 hash of key for verification
      const uuid2 = crypto.randomUUID();
      db.prepare(`
        INSERT INTO csettings (csettinguid, csetting_name, csetting_value)
        VALUES (?, ?, ?)
        ON CONFLICT(csetting_name) DO UPDATE SET csetting_value = excluded.csetting_value
      `).run(uuid2, 'keyguard_key_hash', newKeyHash);
      
      // Store high security mode setting
      const uuid3 = crypto.randomUUID();
      db.prepare(`
        INSERT INTO csettings (csettinguid, csetting_name, csetting_value)
        VALUES (?, ?, ?)
        ON CONFLICT(csetting_name) DO UPDATE SET csetting_value = excluded.csetting_value
      `).run(uuid3, 'keyguard_high_security_mode', highSecurityMode ? 'true' : 'false');
      
      // Store key in safeStorage if not in high security mode
      if (!highSecurityMode && newEncryptedKey) {
        const uuid4 = crypto.randomUUID();
        db.prepare(`
          INSERT INTO csettings (csettinguid, csetting_name, csetting_value)
          VALUES (?, ?, ?)
          ON CONFLICT(csetting_name) DO UPDATE SET csetting_value = excluded.csetting_value
        `).run(uuid4, 'keyguard_key_encrypted', newEncryptedKey);
        
        const uuid5 = crypto.randomUUID();
        db.prepare(`
          INSERT INTO csettings (csettinguid, csetting_name, csetting_value)
          VALUES (?, ?, ?)
          ON CONFLICT(csetting_name) DO UPDATE SET csetting_value = excluded.csetting_value
        `).run(uuid5, 'keyguard_key_stored', 'true');
      }
      
      return { success: true, highSecurityMode: highSecurityMode };
    } catch (error) {
      console.error('Error setting up Profile Guard:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Update Profile Guard security mode
   * Channel: profile-guard:update-security-mode
   */
  ipcMain.handle('profile-guard:update-security-mode', async (event, { highSecurityMode }) => {
    try {
      const { safeStorage } = require('electron');
      const crypto = require('crypto');
      const db = dbManager.getConnection('clientdata');
      
      // Update high security mode setting
      const uuid = crypto.randomUUID();
      db.prepare(`
        INSERT INTO csettings (csettinguid, csetting_name, csetting_value)
        VALUES (?, ?, ?)
        ON CONFLICT(csetting_name) DO UPDATE SET csetting_value = excluded.csetting_value
      `).run(uuid, 'keyguard_high_security_mode', highSecurityMode ? 'true' : 'false');
      
      if (highSecurityMode) {
        // Remove stored key if switching to high security mode
        db.prepare(`DELETE FROM csettings WHERE csetting_name = ?`).run('keyguard_key_encrypted');
        db.prepare(`DELETE FROM csettings WHERE csetting_name = ?`).run('keyguard_key_stored');
      } else {
        // Store key if switching away from high security mode
        // Need to get the key from password - but we can't do that without the password
        // So we'll just mark that it needs to be stored next time user unlocks
        // For now, we'll require user to change password to enable saving
        return { success: false, error: 'Please change your master password to enable key storage' };
      }
      
      return { success: true };
    } catch (error) {
      console.error('Error updating security mode:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Verify Profile Guard password (for High Security Mode)
   * Channel: profile-guard:verify-password
   */
  ipcMain.handle('profile-guard:verify-password', async (event, { password }) => {
    try {
      const crypto = require('crypto');
      const db = dbManager.getConnection('clientdata');
      
      // Get salt and stored hash
      const saltRow = db.prepare(`
        SELECT csetting_value FROM csettings WHERE csetting_name = ?
      `).get('keyguardsalt');
      
      const hashRow = db.prepare(`
        SELECT csetting_value FROM csettings WHERE csetting_name = ?
      `).get('keyguard_key_hash');
      
      if (!saltRow || !hashRow) {
        return { success: false, error: 'Profile Guard not set up' };
      }
      
      const salt = Buffer.from(saltRow.csetting_value, 'hex');
      const storedHash = hashRow.csetting_value;
      
      // Derive key from password
      const key = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
      
      // Compute hash of derived key
      const computedHash = crypto.createHash('sha512').update(key).digest('hex');
      
      // Verify against stored hash
      if (computedHash !== storedHash) {
        return { success: false, error: 'Invalid password' };
      }
      
      // Store key in memory for this session (not persisted)
      // This will be used for encrypting/decrypting keys
      event.sender.session.keyguardKey = key;
      
      return { success: true };
    } catch (error) {
      console.error('Error verifying password:', error);
      return { success: false, error: error.message };
    }
  });
  /**
   * Unlock Profile Guard (auto-unlock if not in high security mode)
   * Channel: profile-guard:unlock
   */
  ipcMain.handle('profile-guard:unlock', async (event) => {
    try {
      const { safeStorage } = require('electron');
      const crypto = require('crypto');
      const db = dbManager.getConnection('clientdata');
      
      // Check high security mode
      const highSecurityRow = db.prepare(`
        SELECT csetting_value FROM csettings WHERE csetting_name = ?
      `).get('keyguard_high_security_mode');
      
      const highSecurityMode = highSecurityRow?.csetting_value === 'true';
      
      if (highSecurityMode) {
        // Can't auto-unlock in high security mode
        return { success: false, error: 'Password required in high security mode' };
      }
      
      // Try to get key from safeStorage
      if (!safeStorage.isEncryptionAvailable()) {
        return { success: false, error: 'Encryption not available on this platform' };
      }
      
      const encryptedKeyRow = db.prepare(`
        SELECT csetting_value FROM csettings WHERE csetting_name = ?
      `).get('keyguard_key_encrypted');
      
      if (!encryptedKeyRow) {
        return { success: false, error: 'Key not stored' };
      }
      
      try {
        const encryptedKey = Buffer.from(encryptedKeyRow.csetting_value, 'base64');
        const keyHex = safeStorage.decryptString(encryptedKey);
        const key = Buffer.from(keyHex, 'hex');
        
        // Store key in memory for this session
        event.sender.session.keyguardKey = key;
        
        return { success: true };
      } catch (error) {
        console.error('Error decrypting key:', error);
        return { success: false, error: 'Failed to decrypt stored key' };
      }
    } catch (error) {
      console.error('Error unlocking Profile Guard:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Remove Profile Guard
   * Channel: profile-guard:remove
   */
  ipcMain.handle('profile-guard:remove', async () => {
    try {
      const db = dbManager.getConnection('clientdata');
      
      // Remove all Profile Guard settings
      db.prepare(`DELETE FROM csettings WHERE csetting_name = ?`).run('keyguardsalt');
      db.prepare(`DELETE FROM csettings WHERE csetting_name = ?`).run('keyguard_key_hash');
      db.prepare(`DELETE FROM csettings WHERE csetting_name = ?`).run('keyguard_key_encrypted');
      db.prepare(`DELETE FROM csettings WHERE csetting_name = ?`).run('keyguard_key_stored');
      db.prepare(`DELETE FROM csettings WHERE csetting_name = ?`).run('keyguard_high_security_mode');
      
      return { success: true };
    } catch (error) {
      console.error('Error removing Profile Guard:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Delete Profile Guard secrets (forgot password option)
   * Channel: profile-guard:delete-secrets
   * This deletes Profile Guard and all encrypted secret keys/keypairs
   */
  ipcMain.handle('profile-guard:delete-secrets', async () => {
    try {
      const db = dbManager.getConnection('clientdata');
      
      // Remove all Profile Guard settings
      db.prepare(`DELETE FROM csettings WHERE csetting_name = ?`).run('keyguardsalt');
      db.prepare(`DELETE FROM csettings WHERE csetting_name = ?`).run('keyguard_key_hash');
      db.prepare(`DELETE FROM csettings WHERE csetting_name = ?`).run('keyguard_key_encrypted');
      db.prepare(`DELETE FROM csettings WHERE csetting_name = ?`).run('keyguard_key_stored');
      db.prepare(`DELETE FROM csettings WHERE csetting_name = ?`).run('keyguard_high_security_mode');
      
      // Delete online profile (which contains encrypted keypairs)
      // Clear any session-stored keys
      // Note: This is per-session, so we can't clear it from here
      // But the profile deletion above will prevent access to encrypted data
      
      return { success: true };
    } catch (error) {
      console.error('Error deleting Profile Guard secrets:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Export online profile with password-based encryption
   * Channel: online:profile:export
   * Supports both legacy format ({profile, password}) and new format ({profileId, password, filePath})
   */
  ipcMain.handle('online:profile:export', async (event, params) => {
    try {
      const crypto = require('crypto');
      const { dialog } = require('electron');
      const fs = require('fs');
      const db = dbManager.getConnection('clientdata');
      
      let profileToExport = null;
      let filePath = null;
      let password = null;
      
      // Support both legacy and new formats
      if (params.profileId) {
        // New format: profileId, password, filePath
        profileToExport = null;
        password = params.password;
        filePath = params.filePath;
        
        // Get keyguard key for decryption
        const keyguardKey = getKeyguardKey(event);
        if (!keyguardKey) {
          return { success: false, error: 'Profile Guard must be unlocked to export profiles' };
        }
        
        const profileManager = new OnlineProfileManager(dbManager, keyguardKey);
        
        // Get profile from database
        profileToExport = profileManager.getProfile(params.profileId);
        
        // If profile not found, try to migrate from csettings
        if (!profileToExport) {
          try {
            const migrationResult = profileManager.migrateProfileFromCsettings(params.profileId);
            if (migrationResult.success && !migrationResult.alreadyMigrated) {
              profileToExport = profileManager.getProfile(params.profileId);
            }
          } catch (migrationError) {
            console.error('Error migrating profile from csettings:', migrationError);
          }
        }
        
        // If still not found, try to load keypairs and reconstruct profile
        if (!profileToExport) {
          // Try to get basic profile info from keypairs
          const keypairs = profileManager.getProfileKeypairs(params.profileId);
          if (keypairs.length > 0) {
            // Reconstruct minimal profile from keypairs
            const primaryKeypair = keypairs.find(kp => kp.keyUsage === 'primary');
            if (primaryKeypair) {
              profileToExport = {
                profileId: params.profileId,
                username: 'Unknown',
                displayName: '',
                bio: '',
                primaryKeypair: primaryKeypair,
                additionalKeypairs: keypairs.filter(kp => kp.keyUsage === 'additional'),
                adminKeypairs: []
              };
            }
          }
        }
        
        if (!profileToExport) {
          return { success: false, error: 'Profile not found' };
        }
        
        // If filePath not provided, show dialog
        if (!filePath) {
          const result = await dialog.showSaveDialog({
            title: 'Export Profile Backup',
            defaultPath: `rhtools-profile-${profileToExport.username || 'backup'}.json`,
            filters: [
              { name: 'JSON Files', extensions: ['json'] },
              { name: 'All Files', extensions: ['*'] }
            ]
          });
          
          if (result.canceled) {
            return { success: false, error: 'Export cancelled' };
          }
          
          filePath = result.filePath;
        }
      } else if (params.profile) {
        // Legacy format: profile, password
        profileToExport = params.profile;
        password = params.password;
        
        // Show save dialog
        const result = await dialog.showSaveDialog({
          title: 'Export Profile Backup',
          defaultPath: 'rhtools-profile-backup.json',
          filters: [
            { name: 'JSON Files', extensions: ['json'] },
            { name: 'All Files', extensions: ['*'] }
          ]
        });
        
        if (result.canceled) {
          return { success: false, error: 'Export cancelled' };
        }
        
        filePath = result.filePath;
      } else {
        return { success: false, error: 'Invalid parameters' };
      }
      
      if (!profileToExport || !password || !filePath) {
        return { success: false, error: 'Missing required parameters' };
      }
      
      // Derive key from password using PBKDF2
      const salt = crypto.randomBytes(32);
      const key = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
      
      // Encrypt profile
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
      const profileJson = JSON.stringify(profileToExport);
      let encrypted = cipher.update(profileJson, 'utf8');
      encrypted = Buffer.concat([encrypted, cipher.final()]);
      
      const exportData = {
        version: 1,
        salt: salt.toString('hex'),
        iv: iv.toString('hex'),
        data: encrypted.toString('hex')
      };
      
      // Write to file
      fs.writeFileSync(filePath, JSON.stringify(exportData, null, 2));
      
      return { success: true };
    } catch (error) {
      console.error('Error exporting profile:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Export keypair with password-based encryption
   * Channel: online:keypair:export
   */
  ipcMain.handle('online:keypair:export', async (event, { keypair, password }) => {
    try {
      const crypto = require('crypto');
      const { dialog } = require('electron');
      
      // Derive encryption key from password using PBKDF2
      const salt = crypto.randomBytes(32);
      const key = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
      
      // Encrypt keypair data
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
      let encrypted = cipher.update(JSON.stringify(keypair), 'utf8', 'hex');
      encrypted += cipher.final('hex');
      
      // Create export data structure
      const exportData = {
        version: '1.0',
        timestamp: new Date().toISOString(),
        type: 'keypair',
        salt: salt.toString('hex'),
        iv: iv.toString('hex'),
        encrypted: encrypted
      };
      
      // Show save dialog
      const result = await dialog.showSaveDialog({
        title: 'Export Keypair',
        defaultPath: `rhtools-keypair-${keypair.type}-${Date.now()}.json`,
        filters: [
          { name: 'JSON Files', extensions: ['json'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      });
      
      if (result.canceled) {
        return { success: false, error: 'Export cancelled' };
      }
      
      // Write to file
      const fs = require('fs');
      fs.writeFileSync(result.filePath, JSON.stringify(exportData, null, 2));
      
      return { success: true };
    } catch (error) {
      console.error('Error exporting keypair:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Import keypair with password-based decryption
   * Channel: online:keypair:import
   */
  ipcMain.handle('online:keypair:import', async (event, { encryptedData, password }) => {
    try {
      const crypto = require('crypto');
      
      // Parse export data
      const exportData = JSON.parse(encryptedData);
      
      if (exportData.version !== '1.0') {
        return { success: false, error: 'Unsupported export format version' };
      }
      
      // Derive decryption key from password using PBKDF2
      const salt = Buffer.from(exportData.salt, 'hex');
      const key = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
      
      // Decrypt keypair data
      const iv = Buffer.from(exportData.iv, 'hex');
      const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
      let decrypted = decipher.update(exportData.encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      const keypair = JSON.parse(decrypted);
      
      return { success: true, keypair };
    } catch (error) {
      console.error('Error importing keypair:', error);
      return { success: false, error: error.message || 'Invalid password or file format' };
    }
  });

  // ===========================================================================
  // ADMIN KEYPAIR OPERATIONS (clientdata.db - admin_keypairs table)
  // ===========================================================================
  /**
   * List all admin keypairs (public info only)
   * Channel: online:admin-keypairs:list
   */
  ipcMain.handle('online:admin-keypairs:list', async () => {
    try {
      const db = dbManager.getConnection('clientdata');
      
      const keypairs = db.prepare(`
        SELECT 
          keypair_uuid,
          keypair_type,
          key_usage,
          storage_status,
          public_key,
          public_key_hex,
          fingerprint,
          trust_level,
          local_name,
          canonical_name,
          name,
          label,
          comments,
          profile_uuid,
          created_at,
          nostr_status,
          nostr_event_id
        FROM admin_keypairs
        WHERE profile_uuid IS NULL
        ORDER BY COALESCE(name, local_name, canonical_name), created_at DESC
      `).all();
      
      return keypairs.map(kp => ({
        uuid: kp.keypair_uuid,
        type: kp.keypair_type,
        keyUsage: kp.key_usage,
        storageStatus: kp.storage_status || 'public-only',
        publicKey: kp.public_key,
        publicKeyHex: kp.public_key_hex,
        fingerprint: kp.fingerprint,
        trustLevel: kp.trust_level,
        localName: kp.local_name,
        canonicalName: kp.canonical_name,
        name: kp.name,
        label: kp.label,
        comments: kp.comments,
        profileUuid: kp.profile_uuid,
        createdAt: kp.created_at,
        nostrStatus: kp.nostr_status || 'pending',
        nostrEventId: kp.nostr_event_id
      }));
    } catch (error) {
      console.error('Error listing admin keypairs:', error);
      return [];
    }
  });

  /**
   * List user-op keypairs (admin keypairs bound to a specific profile)
   * Channel: online:user-op-keypairs:list
   */
  ipcMain.handle('online:user-op-keypairs:list', async (event, { profileUuid }) => {
    try {
      if (!profileUuid) {
        return [];
      }
      
      const db = dbManager.getConnection('clientdata');
      
      const keypairs = db.prepare(`
        SELECT 
          keypair_uuid,
          keypair_type,
          key_usage,
          storage_status,
          public_key,
          public_key_hex,
          fingerprint,
          trust_level,
          local_name,
          canonical_name,
          name,
          label,
          comments,
          profile_uuid,
          created_at,
          nostr_status,
          nostr_event_id
        FROM admin_keypairs
        WHERE profile_uuid = ?
        ORDER BY COALESCE(name, local_name, canonical_name), created_at DESC
      `).all(profileUuid);
      
      return keypairs.map(kp => ({
        uuid: kp.keypair_uuid,
        type: kp.keypair_type,
        keyUsage: kp.key_usage,
        storageStatus: kp.storage_status || 'public-only',
        publicKey: kp.public_key,
        publicKeyHex: kp.public_key_hex,
        fingerprint: kp.fingerprint,
        trustLevel: kp.trust_level,
        localName: kp.local_name,
        canonicalName: kp.canonical_name,
        name: kp.name,
        label: kp.label,
        comments: kp.comments,
        profileUuid: kp.profile_uuid,
        createdAt: kp.created_at,
        nostrStatus: kp.nostr_status || 'pending',
        nostrEventId: kp.nostr_event_id
      }));
    } catch (error) {
      console.error('Error listing user-op keypairs:', error);
      return [];
    }
  });

  /**
   * Get admin keypair (with decrypted secret key if Profile Guard is unlocked)
   * Channel: online:admin-keypair:get
   */
  ipcMain.handle('online:admin-keypair:get', async (event, { keypairUuid }) => {
    try {
      const db = dbManager.getConnection('clientdata');
      
      const keypair = db.prepare(`
        SELECT * FROM admin_keypairs WHERE keypair_uuid = ?
      `).get(keypairUuid);
      
      if (!keypair) {
        return { success: false, error: 'Keypair not found' };
      }
      
      const result = {
        uuid: keypair.keypair_uuid,
        type: keypair.keypair_type,
        keyUsage: keypair.key_usage,
        storageStatus: keypair.storage_status || 'public-only',
        publicKey: keypair.public_key,
        publicKeyHex: keypair.public_key_hex,
        fingerprint: keypair.fingerprint,
        trustLevel: keypair.trust_level,
        localName: keypair.local_name,
        canonicalName: keypair.canonical_name,
        name: keypair.name,
        label: keypair.label,
        comments: keypair.comments,
        profileUuid: keypair.profile_uuid,
        createdAt: keypair.created_at
      };
      
      // Decrypt private key if Profile Guard is unlocked and encrypted_private_key exists
      const keyguardKey = getKeyguardKey(event);
      if (keyguardKey && keypair.encrypted_private_key) {
        try {
          const parts = keypair.encrypted_private_key.split(':');
          if (parts.length === 2) {
            const iv = Buffer.from(parts[0], 'hex');
            const encrypted = Buffer.from(parts[1], 'hex');
            const decipher = crypto.createDecipheriv('aes-256-cbc', keyguardKey, iv);
            let decrypted = decipher.update(encrypted);
            decrypted = Buffer.concat([decrypted, decipher.final()]);
            
            // Convert back to original format
            if (keypair.private_key_format === 'hex') {
              result.privateKey = decrypted.toString('hex');
            } else {
              result.privateKey = decrypted.toString('utf8');
            }
          }
        } catch (error) {
          console.error('Error decrypting admin keypair:', error);
          return { success: false, error: 'Failed to decrypt private key' };
        }
      } else if (keypair.storage_status === 'full-offline') {
        // For offline storage, we don't have the private key stored
        result.privateKey = null;
      }
      
      return { success: true, keypair: result };
    } catch (error) {
      console.error('Error getting admin keypair:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Create admin keypair
   * Channel: online:admin-keypair:create
   */
  ipcMain.handle('online:admin-keypair:create', async (event, { keyType, keyUsage, trustLevel, username }) => {
    try {
      const crypto = require('crypto');
      const db = dbManager.getConnection('clientdata');
      
      // Get username from profile if not provided
      let usernameForName = username;
      if (!usernameForName) {
        const keyguardKey = getKeyguardKey(event);
        if (keyguardKey) {
          const profileManager = new OnlineProfileManager(dbManager, keyguardKey);
          const currentProfile = profileManager.getCurrentProfile();
          if (currentProfile) {
            usernameForName = currentProfile.username || 'admin';
          } else {
            usernameForName = 'admin';
          }
        } else {
          usernameForName = 'admin';
        }
      }
      
      // Generate actual keypair
      const keypairData = await generateKeypair(keyType || 'ML-DSA-44');
      
      // Generate names
      const localName = generateLocalKeypairName(usernameForName, keypairData.type, keypairData.fingerprint, keypairData.publicKey);
      const canonicalName = generateCanonicalKeypairName(keypairData.type, keypairData.fingerprint, keypairData.publicKeyHex, keypairData.publicKey);
      
      // Encrypt private key with Profile Guard
      const keyguardKey = getKeyguardKey(event);
      if (!keyguardKey) {
        return { success: false, error: 'Profile Guard must be unlocked to create admin keypairs' };
      }
      
      // Encrypt private key
      const keyToEncrypt = keypairData.privateKeyRaw || keypairData.privateKey;
      const keyData = keypairData.privateKeyRaw ? Buffer.from(keyToEncrypt, 'hex') : Buffer.from(keyToEncrypt, 'utf8');
      
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv('aes-256-cbc', keyguardKey, iv);
      let encrypted = cipher.update(keyData);
      encrypted = Buffer.concat([encrypted, cipher.final()]);
      
      const encryptedPrivateKey = iv.toString('hex') + ':' + encrypted.toString('hex');
      const privateKeyFormat = keypairData.privateKeyRaw ? 'hex' : 'pem';
      
      // Save to database
      const keypairUuid = crypto.randomUUID();
      db.prepare(`
        INSERT INTO admin_keypairs (
          keypair_uuid, keypair_type, key_usage, storage_status,
          public_key, public_key_hex, fingerprint,
          encrypted_private_key, private_key_format,
          trust_level, local_name, canonical_name,
          name, label, comments, profile_uuid
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        keypairUuid,
        keypairData.type,
        keyUsage || null,
        'full', // Generated keypairs have full storage by default
        String(keypairData.publicKey),
        String(keypairData.publicKeyHex),
        String(keypairData.fingerprint),
        encryptedPrivateKey,
        privateKeyFormat,
        trustLevel || 'Standard',
        localName,
        canonicalName,
        null, // name - can be set later
        null, // label - can be set later
        null, // comments - can be set later
        null  // profile_uuid - NULL for global admin keypairs
      );
      
      return {
        success: true,
        keypair: {
          uuid: keypairUuid,
          type: keypairData.type,
          keyUsage: keyUsage,
          storageStatus: 'full',
          publicKey: String(keypairData.publicKey),
          publicKeyHex: String(keypairData.publicKeyHex),
          fingerprint: String(keypairData.fingerprint),
          trustLevel: trustLevel || 'Standard',
          localName: localName,
          canonicalName: canonicalName,
          name: null,
          label: null,
          comments: null,
          profileUuid: null,
          createdAt: new Date().toISOString()
        }
      };
    } catch (error) {
      console.error('Error creating admin keypair:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Export admin keypair secret key in PKCS format
   * Channel: online:admin-keypair:export-secret-pkcs
   */
  ipcMain.handle('online:admin-keypair:export-secret-pkcs', async (event, { keypairUuid, password }) => {
    try {
      const db = dbManager.getConnection('clientdata');
      
      const keypair = db.prepare(`
        SELECT encrypted_private_key, private_key_format FROM admin_keypairs WHERE keypair_uuid = ?
      `).get(keypairUuid);
      
      if (!keypair || !keypair.encrypted_private_key) {
        return { success: false, error: 'Keypair not found or has no private key' };
      }
      
      // Decrypt private key
      const keyguardKey = getKeyguardKey(event);
      if (!keyguardKey) {
        return { success: false, error: 'Profile Guard must be unlocked to export secret keys' };
      }
      
      const parts = keypair.encrypted_private_key.split(':');
      if (parts.length !== 2) {
        return { success: false, error: 'Invalid encrypted private key format' };
      }
      
      const iv = Buffer.from(parts[0], 'hex');
      const encrypted = Buffer.from(parts[1], 'hex');
      const decipher = crypto.createDecipheriv('aes-256-cbc', keyguardKey, iv);
      let decrypted = decipher.update(encrypted);
      decrypted = Buffer.concat([decrypted, decipher.final()]);
      
      const privateKey = keypair.private_key_format === 'hex' ? decrypted.toString('hex') : decrypted.toString('utf8');
      
      // Encrypt with user-provided password using PBKDF2
      const salt = crypto.randomBytes(16);
      const key = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
      const exportIv = crypto.randomBytes(16);
      const exportCipher = crypto.createCipheriv('aes-256-cbc', key, exportIv);
      let passwordEncrypted = exportCipher.update(privateKey, 'utf8');
      passwordEncrypted = Buffer.concat([passwordEncrypted, exportCipher.final()]);
      
      // Create PKCS-like JSON format
      const pkcsData = {
        format: 'RHTools-PKCS-v1',
        keypairUuid: keypairUuid,
        privateKeyFormat: keypair.private_key_format,
        encryptedData: {
          iv: exportIv.toString('hex'),
          salt: salt.toString('hex'),
          data: passwordEncrypted.toString('hex')
        }
      };
      
      // Save to file
      const result = await dialog.showSaveDialog({
        title: 'Export Admin Keypair Secret Key',
        defaultPath: `admin-keypair-${keypairUuid.substring(0, 8)}.json`,
        filters: [
          { name: 'JSON Files', extensions: ['json'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      });
      
      if (result.canceled || !result.filePath) {
        return { success: false, error: 'Export cancelled' };
      }
      
      fs.writeFileSync(result.filePath, JSON.stringify(pkcsData, null, 2), 'utf8');
      
      return { success: true, filePath: result.filePath };
    } catch (error) {
      console.error('Error exporting admin keypair secret PKCS:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Add existing User Op keypair (public key only or full)
   * Channel: online:user-op-keypair:add
   */
  ipcMain.handle('online:user-op-keypair:add', async (event, { profileUuid, keyType, publicKey, publicKeyHex, privateKey, privateKeyFormat, keyUsage, storageStatus, trustLevel }) => {
    try {
      const crypto = require('crypto');
      const db = dbManager.getConnection('clientdata');
      
      if (!profileUuid) {
        return { success: false, error: 'Profile UUID is required for User Op keypairs' };
      }
      
      // Calculate fingerprint from public key
      const calculatedFingerprint = publicKeyHex ? crypto.createHash('sha256').update(Buffer.from(publicKeyHex, 'hex')).digest('hex').substring(0, 32) : null;
      
      // Generate names
      const localName = calculatedFingerprint ? generateLocalKeypairName('user', keyType, calculatedFingerprint) : null;
      const canonicalName = calculatedFingerprint ? generateCanonicalKeypairName(keyType, calculatedFingerprint, publicKeyHex) : null;
      
      // Encrypt private key if provided
      let encryptedPrivateKey = null;
      let privateKeyFormatValue = privateKeyFormat || 'pem';
      
      if (privateKey) {
        const keyguardKey = getKeyguardKey(event);
        if (!keyguardKey) {
          return { success: false, error: 'Profile Guard must be unlocked to add keypairs with private keys' };
        }
        
        const keyData = privateKeyFormatValue === 'hex' ? Buffer.from(privateKey, 'hex') : Buffer.from(privateKey, 'utf8');
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv('aes-256-cbc', keyguardKey, iv);
        let encrypted = cipher.update(keyData);
        encrypted = Buffer.concat([encrypted, cipher.final()]);
        encryptedPrivateKey = iv.toString('hex') + ':' + encrypted.toString('hex');
      }
      
      // Save to database
      const keypairUuid = crypto.randomUUID();
      db.prepare(`
        INSERT INTO admin_keypairs (
          keypair_uuid, keypair_type, key_usage, storage_status,
          public_key, public_key_hex, fingerprint,
          encrypted_private_key, private_key_format,
          trust_level, local_name, canonical_name,
          name, label, comments, profile_uuid
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        keypairUuid,
        keyType,
        keyUsage || null,
        storageStatus || 'public-only',
        publicKey,
        publicKeyHex || null,
        calculatedFingerprint || null,
        encryptedPrivateKey,
        privateKeyFormatValue,
        trustLevel || 'Standard',
        localName,
        canonicalName,
        null, // name - can be set later
        null, // label - can be set later
        null, // comments - can be set later
        profileUuid  // profile_uuid - set to profile UUID for User Op keypairs
      );
      
      return {
        success: true,
        keypair: {
          uuid: keypairUuid,
          type: keyType,
          keyUsage: keyUsage,
          storageStatus: storageStatus || 'public-only',
          publicKey: publicKey,
          publicKeyHex: publicKeyHex,
          fingerprint: calculatedFingerprint,
          trustLevel: trustLevel || 'Standard',
          localName: localName,
          canonicalName: canonicalName,
          name: null,
          label: null,
          comments: null,
          profileUuid: profileUuid,
          createdAt: new Date().toISOString()
        }
      };
    } catch (error) {
      console.error('Error adding User Op keypair:', error);
      return { success: false, error: error.message };
    }
  });
  /**
   * Update User Op keypair storage status
   * Channel: online:user-op-keypair:update-storage-status
   */
  ipcMain.handle('online:user-op-keypair:update-storage-status', async (event, { keypairUuid, storageStatus }) => {
    try {
      const crypto = require('crypto');
      const db = dbManager.getConnection('clientdata');
      
      const keypair = db.prepare(`
        SELECT encrypted_private_key, storage_status FROM admin_keypairs WHERE keypair_uuid = ?
      `).get(keypairUuid);
      
      if (!keypair) {
        return { success: false, error: 'Keypair not found' };
      }
      
      // If changing to public-only, remove encrypted private key
      if (storageStatus === 'public-only') {
        db.prepare(`
          UPDATE admin_keypairs 
          SET storage_status = ?, encrypted_private_key = NULL, private_key_format = NULL
          WHERE keypair_uuid = ?
        `).run(storageStatus, keypairUuid);
      } else if (storageStatus === 'full' && !keypair.encrypted_private_key) {
        // If changing to full but no private key, can't do that
        return { success: false, error: 'Cannot set storage status to full without a private key' };
      } else {
        // Just update storage status
        db.prepare(`
          UPDATE admin_keypairs 
          SET storage_status = ?
          WHERE keypair_uuid = ?
        `).run(storageStatus, keypairUuid);
      }
      
      return { success: true };
    } catch (error) {
      console.error('Error updating User Op keypair storage status:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Delete User Op keypair
   * Channel: online:user-op-keypair:delete
   */
  ipcMain.handle('online:user-op-keypair:delete', async (event, { keypairUuid }) => {
    try {
      const db = dbManager.getConnection('clientdata');
      
      db.prepare(`
        DELETE FROM admin_keypairs WHERE keypair_uuid = ?
      `).run(keypairUuid);
      
      return { success: true };
    } catch (error) {
      console.error('Error deleting User Op keypair:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Update User Op keypair metadata (name, label, comments)
   * Channel: online:user-op-keypair:update-metadata
   */
  ipcMain.handle('online:user-op-keypair:update-metadata', async (event, { keypairUuid, name, label, comments }) => {
    try {
      const db = dbManager.getConnection('clientdata');
      
      db.prepare(`
        UPDATE admin_keypairs 
        SET name = ?, label = ?, comments = ?
        WHERE keypair_uuid = ?
      `).run(name || null, label || null, comments || null, keypairUuid);
      
      return { success: true };
    } catch (error) {
      console.error('Error updating User Op keypair metadata:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Export User Op keypair secret key in PKCS format
   * Channel: online:user-op-keypair:export-secret-pkcs
   */
  ipcMain.handle('online:user-op-keypair:export-secret-pkcs', async (event, { keypairUuid, password }) => {
    try {
      const db = dbManager.getConnection('clientdata');
      
      const keypair = db.prepare(`
        SELECT encrypted_private_key, private_key_format FROM admin_keypairs WHERE keypair_uuid = ?
      `).get(keypairUuid);
      
      if (!keypair || !keypair.encrypted_private_key) {
        return { success: false, error: 'Keypair not found or has no private key' };
      }
      
      // Decrypt private key
      const keyguardKey = getKeyguardKey(event);
      if (!keyguardKey) {
        return { success: false, error: 'Profile Guard must be unlocked to export secret keys' };
      }
      
      const parts = keypair.encrypted_private_key.split(':');
      if (parts.length !== 2) {
        return { success: false, error: 'Invalid encrypted private key format' };
      }
      
      const iv = Buffer.from(parts[0], 'hex');
      const encrypted = Buffer.from(parts[1], 'hex');
      const decipher = crypto.createDecipheriv('aes-256-cbc', keyguardKey, iv);
      let decrypted = decipher.update(encrypted);
      decrypted = Buffer.concat([decrypted, decipher.final()]);
      
      const privateKey = keypair.private_key_format === 'hex' ? decrypted.toString('hex') : decrypted.toString('utf8');
      
      // Encrypt with user-provided password using PBKDF2
      const salt = crypto.randomBytes(16);
      const key = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
      const exportIv = crypto.randomBytes(16);
      const exportCipher = crypto.createCipheriv('aes-256-cbc', key, exportIv);
      let passwordEncrypted = exportCipher.update(privateKey, 'utf8');
      passwordEncrypted = Buffer.concat([passwordEncrypted, exportCipher.final()]);
      
      // Create PKCS-like JSON format
      const pkcsData = {
        format: 'RHTools-PKCS-v1',
        keypairUuid: keypairUuid,
        privateKeyFormat: keypair.private_key_format,
        encryptedData: {
          iv: exportIv.toString('hex'),
          salt: salt.toString('hex'),
          data: passwordEncrypted.toString('hex')
        }
      };
      
      return { success: true, pkcsData: JSON.stringify(pkcsData) };
    } catch (error) {
      console.error('Error exporting User Op keypair secret PKCS:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Import User Op keypair secret key from PKCS format
   * Channel: online:user-op-keypair:import-secret-pkcs
   */
  ipcMain.handle('online:user-op-keypair:import-secret-pkcs', async (event, { keypairUuid, pkcsDataJson, password }) => {
    try {
      const db = dbManager.getConnection('clientdata');
      
      const pkcsData = JSON.parse(pkcsDataJson);
      
      if (pkcsData.format !== 'RHTools-PKCS-v1') {
        return { success: false, error: 'Invalid PKCS format' };
      }
      
      // Decrypt with user-provided password
      const salt = Buffer.from(pkcsData.encryptedData.salt, 'hex');
      const key = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
      const iv = Buffer.from(pkcsData.encryptedData.iv, 'hex');
      const encrypted = Buffer.from(pkcsData.encryptedData.data, 'hex');
      const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
      let decrypted = decipher.update(encrypted);
      decrypted = Buffer.concat([decrypted, decipher.final()]);
      
      const privateKey = decrypted.toString('utf8');
      
      // Re-encrypt with Profile Guard key
      const keyguardKey = getKeyguardKey(event);
      if (!keyguardKey) {
        return { success: false, error: 'Profile Guard must be unlocked to import secret keys' };
      }
      
      const privateKeyData = pkcsData.privateKeyFormat === 'hex' ? Buffer.from(privateKey, 'hex') : Buffer.from(privateKey, 'utf8');
      const reencryptIv = crypto.randomBytes(16);
      const reencryptCipher = crypto.createCipheriv('aes-256-cbc', keyguardKey, reencryptIv);
      let reencrypted = reencryptCipher.update(privateKeyData);
      reencrypted = Buffer.concat([reencrypted, reencryptCipher.final()]);
      
      const encryptedPrivateKey = reencryptIv.toString('hex') + ':' + reencrypted.toString('hex');
      
      // Update database
      db.prepare(`
        UPDATE admin_keypairs 
        SET encrypted_private_key = ?, private_key_format = ?, storage_status = 'full'
        WHERE keypair_uuid = ?
      `).run(encryptedPrivateKey, pkcsData.privateKeyFormat, keypairUuid);
      
      return { success: true };
    } catch (error) {
      console.error('Error importing User Op keypair secret PKCS:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Remove User Op keypair secret key
   * Channel: online:user-op-keypair:remove-secret
   */
  ipcMain.handle('online:user-op-keypair:remove-secret', async (event, { keypairUuid }) => {
    try {
      const db = dbManager.getConnection('clientdata');
      
      db.prepare(`
        UPDATE admin_keypairs 
        SET encrypted_private_key = NULL, private_key_format = NULL, storage_status = 'public-only'
        WHERE keypair_uuid = ?
      `).run(keypairUuid);
      
      return { success: true };
    } catch (error) {
      console.error('Error removing User Op keypair secret:', error);
      return { success: false, error: error.message };
    }
  });

  // ===========================================================================
  // ENCRYPTION KEY OPERATIONS (clientdata.db - encryption_keys table)
  // ===========================================================================

  /**
   * List all encryption keys (public info only)
   * Channel: online:encryption-keys:list
   */
  ipcMain.handle('online:encryption-keys:list', async () => {
    try {
      const db = dbManager.getConnection('clientdata');
      
      const keys = db.prepare(`
        SELECT 
          key_uuid,
          name,
          label,
          algorithm,
          key_type,
          encrypted,
          keyguard_hash,
          hash_algorithm,
          hash_value,
          selection_identifier,
          description,
          start_date,
          end_date,
          created_at,
          updated_at
        FROM encryption_keys
        ORDER BY COALESCE(name, label), created_at DESC
      `).all();
      
      return keys.map(k => ({
        uuid: k.key_uuid,
        name: k.name,
        label: k.label,
        algorithm: k.algorithm,
        keyType: k.key_type,
        encrypted: Boolean(k.encrypted),
        keyguardHash: k.keyguard_hash,
        hashAlgorithm: k.hash_algorithm,
        hashValue: k.hash_value,
        selectionIdentifier: k.selection_identifier,
        description: k.description,
        startDate: k.start_date,
        endDate: k.end_date,
        createdAt: k.created_at,
        updatedAt: k.updated_at
      }));
    } catch (error) {
      console.error('Error listing encryption keys:', error);
      return [];
    }
  });

  /**
   * Get encryption key details (decrypts keydata if encrypted)
   * Channel: online:encryption-key:get
   */
  ipcMain.handle('online:encryption-key:get', async (event, { keyUuid }) => {
    try {
      const db = dbManager.getConnection('clientdata');
      const crypto = require('crypto');
      
      const key = db.prepare(`
        SELECT * FROM encryption_keys WHERE key_uuid = ?
      `).get(keyUuid);
      
      if (!key) {
        return { success: false, error: 'Encryption key not found' };
      }
      
      let decryptedKeydata = null;
      
      // If encrypted, decrypt the keydata
      if (key.encrypted === 1) {
        const keyguardKey = getKeyguardKey(event);
        if (!keyguardKey) {
          return { success: false, error: 'Profile Guard must be unlocked to view encrypted key data' };
        }
        
        // Verify keyguard hash if present
        if (key.keyguard_hash) {
          const keyguardHash = crypto.createHash('sha256').update(keyguardKey).digest('hex');
          if (keyguardHash !== key.keyguard_hash) {
            return { success: false, error: 'Keyguard hash mismatch - key may be encrypted with different profile guard' };
          }
        }
        
        // Decrypt keydata (format: iv:encrypted)
        const parts = key.keydata.split(':');
        if (parts.length !== 2) {
          return { success: false, error: 'Invalid encrypted key format' };
        }
        
        const iv = Buffer.from(parts[0], 'hex');
        const encrypted = Buffer.from(parts[1], 'hex');
        const decipher = crypto.createDecipheriv('aes-256-cbc', keyguardKey, iv);
        let decrypted = decipher.update(encrypted);
        decrypted = Buffer.concat([decrypted, decipher.final()]);
        decryptedKeydata = decrypted.toString('hex');
      } else {
        decryptedKeydata = key.keydata;
      }
      
      return {
        success: true,
        key: {
          uuid: key.key_uuid,
          name: key.name,
          label: key.label,
          algorithm: key.algorithm,
          keyType: key.key_type,
          encrypted: Boolean(key.encrypted),
          keyguardHash: key.keyguard_hash,
          hashAlgorithm: key.hash_algorithm,
          hashValue: key.hash_value,
          keydata: decryptedKeydata,
          selectionIdentifier: key.selection_identifier,
          description: key.description,
          startDate: key.start_date,
          endDate: key.end_date,
          createdAt: key.created_at,
          updatedAt: key.updated_at
        }
      };
    } catch (error) {
      console.error('Error getting encryption key:', error);
      return { success: false, error: error.message };
    }
  });
  /**
   * Create new encryption key
   * Channel: online:encryption-key:create
   */
  ipcMain.handle('online:encryption-key:create', async (event, { name, label, algorithm, keyType, encrypted, keydata, selectionIdentifier, description, startDate, endDate }) => {
    try {
      const db = dbManager.getConnection('clientdata');
      const crypto = require('crypto');
      
      // Validate algorithm
      if (algorithm !== 'AES256' && algorithm !== 'AES128') {
        return { success: false, error: 'Algorithm must be AES256 or AES128' };
      }
      
      // Validate key type
      const validKeyTypes = ['Shared Preinstalled', 'Shared General', 'Shared Selective', 'Group', 'Individual'];
      if (!validKeyTypes.includes(keyType)) {
        return { success: false, error: 'Invalid key type' };
      }
      
      // Generate UUID
      const keyUuid = crypto.randomUUID();
      
      // Generate hash of raw key value
      const rawKeyBuffer = Buffer.from(keydata, 'hex');
      const hashValue = crypto.createHash('sha256').update(rawKeyBuffer).digest('hex');
      
      let finalKeydata = keydata;
      let keyguardHash = null;
      
      // If encrypted flag is set, encrypt the keydata with Profile Guard key
      if (encrypted) {
        const keyguardKey = getKeyguardKey(event);
        if (!keyguardKey) {
          return { success: false, error: 'Profile Guard must be unlocked to create encrypted keys' };
        }
        
        // Create keyguard hash
        keyguardHash = crypto.createHash('sha256').update(keyguardKey).digest('hex');
        
        // Encrypt keydata
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv('aes-256-cbc', keyguardKey, iv);
        const keydataBuffer = Buffer.from(keydata, 'hex');
        let encrypted = cipher.update(keydataBuffer);
        encrypted = Buffer.concat([encrypted, cipher.final()]);
        
        finalKeydata = iv.toString('hex') + ':' + encrypted.toString('hex');
      }
      
      // Set start_date to current time if not provided
      const finalStartDate = startDate || new Date().toISOString();
      
      // Insert into database
      db.prepare(`
        INSERT INTO encryption_keys (
          key_uuid, name, label, algorithm, key_type, encrypted, keyguard_hash,
          hash_algorithm, hash_value, keydata, selection_identifier, description,
          start_date, end_date
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        keyUuid,
        name || null,
        label || null,
        algorithm,
        keyType,
        encrypted ? 1 : 0,
        keyguardHash,
        'SHA-256',
        hashValue,
        finalKeydata,
        selectionIdentifier || null,
        description || null,
        finalStartDate,
        endDate || null
      );
      
      return { success: true, keyUuid };
    } catch (error) {
      console.error('Error creating encryption key:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Update encryption key metadata
   * Channel: online:encryption-key:update-metadata
   */
  ipcMain.handle('online:encryption-key:update-metadata', async (event, { keyUuid, name, label, description, endDate }) => {
    try {
      const db = dbManager.getConnection('clientdata');
      
      db.prepare(`
        UPDATE encryption_keys 
        SET name = ?, label = ?, description = ?, end_date = ?
        WHERE key_uuid = ?
      `).run(
        name || null,
        label || null,
        description || null,
        endDate || null,
        keyUuid
      );
      
      return { success: true };
    } catch (error) {
      console.error('Error updating encryption key metadata:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Delete encryption key
   * Channel: online:encryption-key:delete
   */
  ipcMain.handle('online:encryption-key:delete', async (event, { keyUuid }) => {
    try {
      const db = dbManager.getConnection('clientdata');
      
      db.prepare(`DELETE FROM encryption_keys WHERE key_uuid = ?`).run(keyUuid);
      
      return { success: true };
    } catch (error) {
      console.error('Error deleting encryption key:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Channel: online:submission:enqueue
   * Enqueue a game submission event via OnlineProfileManager
   */
  ipcMain.handle('online:submission:enqueue', async (event, { submission } = {}) => {
    try {
      const keyguardKey = getKeyguardKey(event);
      if (!keyguardKey) {
        return { success: false, error: 'Profile Guard not unlocked' };
      }
      const profileManager = new OnlineProfileManager(dbManager, keyguardKey);
      const currentProfileId = profileManager.getCurrentProfileId();
      if (!currentProfileId) {
        return { success: false, error: 'No current profile found' };
      }
      const result = await profileManager.publishGameSubmission(currentProfileId, submission || {});
      return result;
    } catch (error) {
      console.error('Error enqueuing game submission:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Channel: online:submission:draft:save
   * Save a game submission draft to database
   */
  ipcMain.handle('online:submission:draft:save', async (event, { draftUuid, draftName, draftData } = {}) => {
    try {
      // Make Profile Guard optional for local draft saving; if unlocked, scope to current profile
      let submitterPubkey = null;
      try {
        const keyguardKey = getKeyguardKey(event);
        if (keyguardKey) {
          const profileManager = new OnlineProfileManager(dbManager, keyguardKey);
          const currentProfile = profileManager.getCurrentProfile();
          submitterPubkey = currentProfile?.npub || null;
        }
      } catch {}
      
      const db = dbManager.getConnection('clientdata');
      const now = Math.floor(Date.now() / 1000);
      const uuid = draftUuid || crypto.randomUUID();
      // Ensure draftData/meta shape and identifiers
      if (!draftData || typeof draftData !== 'object') {
        draftData = {};
      }
      if (!draftData.meta || typeof draftData.meta !== 'object') {
        draftData.meta = {};
      }
      // Ensure gameid per rule: newYYMMDDHH_<SHAKE128-8(npub)>
      const ensureStr = (v) => (v == null ? '' : String(v));
      if (!ensureStr(draftData.meta.gameid)) {
        const dt = new Date();
        const y = String(dt.getUTCFullYear()).slice(-2);
        const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
        const d = String(dt.getUTCDate()).padStart(2, '0');
        const h = String(dt.getUTCHours()).padStart(2, '0');
        const tsYYMMDDHH = `${y}${m}${d}${h}`;
        let h8 = '00000000';
        try {
          if (submitterPubkey) {
            if (crypto.getHashes().includes('shake128')) {
              h8 = crypto.createHash('shake128', { outputLength: 4 }).update(Buffer.from(submitterPubkey)).digest('hex');
            } else if (crypto.getHashes().includes('shake256')) {
              h8 = crypto.createHash('shake256', { outputLength: 4 }).update(Buffer.from(submitterPubkey)).digest('hex');
            } else {
              h8 = crypto.createHash('sha256').update(submitterPubkey).digest('hex').slice(0, 8);
            }
          }
        } catch {}
        draftData.meta.gameid = `new${tsYYMMDDHH}_${h8}`;
      }
      // Ensure gvuuid hashed from timestamp + submitter npub
      if (!ensureStr(draftData.meta.gvuuid)) {
        const seed = `${Date.now()}-${submitterPubkey || ''}`;
        draftData.meta.gvuuid = crypto.createHash('sha256').update(seed).digest('hex');
      }
      // Default section if missing
      if (!ensureStr(draftData.meta.section)) {
        draftData.meta.section = 'Game';
      }
      // Robust JSON serialization to satisfy NOT NULL constraint
      let json = (typeof draftData === 'string') ? draftData : JSON.stringify(draftData ?? {});
      if (json == null) json = '{}';
      if (typeof json !== 'string') {
        try { json = JSON.stringify(json); } catch { json = '{}'; }
      }
      if (json === 'null' || json.trim().length === 0) json = '{}';
      // Write
      const existing = db.prepare('SELECT draft_uuid FROM game_submission_drafts WHERE draft_uuid = ?').get(uuid);
      if (existing) {
        db.prepare(`
          UPDATE game_submission_drafts
          SET draft_name = ?, draft_data_json = ?, updated_at_utc = ?
          WHERE draft_uuid = ?
        `).run(draftName || 'Untitled Draft', json, now, uuid);
      } else {
        db.prepare(`
          INSERT INTO game_submission_drafts (draft_uuid, submitter_pubkey_npub, draft_name, draft_data_json, created_at_utc, updated_at_utc, state)
          VALUES (?, ?, ?, ?, ?, ?, 'draft')
        `).run(uuid, submitterPubkey, draftName || 'Untitled Draft', json, now, now);
      }
      
      return { success: true, draftUuid: uuid, gameid: draftData.meta.gameid, gvuuid: draftData.meta.gvuuid };
    } catch (error) {
      console.error('Error saving submission draft:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Channel: online:submission:draft:list
   * List all drafts for current user
   */
  ipcMain.handle('online:submission:draft:list', async (event) => {
    try {
      // Profile Guard optional for listing; if available, filter by current user, else list all
      let submitterPubkey = null;
      try {
        const keyguardKey = getKeyguardKey(event);
        if (keyguardKey) {
          const profileManager = new OnlineProfileManager(dbManager, keyguardKey);
          const currentProfile = profileManager.getCurrentProfile();
          submitterPubkey = currentProfile?.npub || null;
        }
      } catch {}
      const db = dbManager.getConnection('clientdata');
      const drafts = submitterPubkey
        ? db.prepare(`
            SELECT draft_uuid, draft_name, created_at_utc, updated_at_utc, prepared_at_utc, packaged_at_utc, state
            FROM game_submission_drafts
            WHERE submitter_pubkey_npub = ?
            ORDER BY updated_at_utc DESC
          `).all(submitterPubkey)
        : db.prepare(`
            SELECT draft_uuid, draft_name, created_at_utc, updated_at_utc, prepared_at_utc, packaged_at_utc, state
            FROM game_submission_drafts
            ORDER BY updated_at_utc DESC
          `).all();
      
      return { success: true, drafts };
    } catch (error) {
      console.error('Error listing submission drafts:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Channel: online:submission:draft:load
   * Load a specific draft by UUID
   */
  ipcMain.handle('online:submission:draft:load', async (event, { draftUuid } = {}) => {
    try {
      // Profile Guard optional for loading; if available, prefer scoped load, else load by uuid
      let submitterPubkey = null;
      try {
        const keyguardKey = getKeyguardKey(event);
        if (keyguardKey) {
          const profileManager = new OnlineProfileManager(dbManager, keyguardKey);
          const currentProfile = profileManager.getCurrentProfile();
          submitterPubkey = currentProfile?.npub || null;
        }
      } catch {}
      const db = dbManager.getConnection('clientdata');
      const draft = submitterPubkey
        ? db.prepare(`
            SELECT * FROM game_submission_drafts
            WHERE draft_uuid = ? AND submitter_pubkey_npub = ?
          `).get(draftUuid, submitterPubkey)
        : db.prepare(`SELECT * FROM game_submission_drafts WHERE draft_uuid = ?`).get(draftUuid);
      
      if (!draft) {
        return { success: false, error: 'Draft not found' };
      }
      
      return {
        success: true,
        draft: {
          ...draft,
          draftData: JSON.parse(draft.draft_data_json)
        }
      };
    } catch (error) {
      console.error('Error loading submission draft:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Channel: online:submission:draft:delete
   * Delete a draft by UUID
   */
  ipcMain.handle('online:submission:draft:delete', async (event, { draftUuid } = {}) => {
    try {
      const keyguardKey = getKeyguardKey(event);
      if (!keyguardKey) {
        return { success: false, error: 'Profile Guard not unlocked' };
      }
      const profileManager = new OnlineProfileManager(dbManager, keyguardKey);
      const currentProfile = profileManager.getCurrentProfile();
      if (!currentProfile) {
        return { success: false, error: 'No current profile found' };
      }
      const submitterPubkey = currentProfile.npub || null;
      
      const db = dbManager.getConnection('clientdata');
      const result = db.prepare(`
        DELETE FROM game_submission_drafts
        WHERE draft_uuid = ? AND submitter_pubkey_npub = ?
      `).run(draftUuid, submitterPubkey);
      
      if (result.changes === 0) {
        return { success: false, error: 'Draft not found or access denied' };
      }
      
      return { success: true };
    } catch (error) {
      console.error('Error deleting submission draft:', error);
      return { success: false, error: error.message };
    }
  });
  /**
   * Export encryption key (password-encrypted backup)
   * Channel: online:encryption-key:export
   */
  ipcMain.handle('online:encryption-key:export', async (event, { keyUuid, password }) => {
    try {
      const db = dbManager.getConnection('clientdata');
      const crypto = require('crypto');
      const { dialog } = require('electron');
      
      // Get key
      const key = db.prepare(`
        SELECT * FROM encryption_keys WHERE key_uuid = ?
      `).get(keyUuid);
      
      if (!key) {
        return { success: false, error: 'Encryption key not found' };
      }
      
      // Decrypt keydata if encrypted
      let decryptedKeydata = key.keydata;
      if (key.encrypted === 1) {
        const keyguardKey = getKeyguardKey(event);
        if (!keyguardKey) {
          return { success: false, error: 'Profile Guard must be unlocked to export encrypted keys' };
        }
        
        const parts = key.keydata.split(':');
        if (parts.length !== 2) {
          return { success: false, error: 'Invalid encrypted key format' };
        }
        
        const iv = Buffer.from(parts[0], 'hex');
        const encrypted = Buffer.from(parts[1], 'hex');
        const decipher = crypto.createDecipheriv('aes-256-cbc', keyguardKey, iv);
        let decrypted = decipher.update(encrypted);
        decrypted = Buffer.concat([decrypted, decipher.final()]);
        decryptedKeydata = decrypted.toString('hex');
      }
      
      // Create export data
      const exportData = {
        uuid: key.key_uuid,
        name: key.name,
        label: key.label,
        algorithm: key.algorithm,
        keyType: key.key_type,
        encrypted: Boolean(key.encrypted),
        hashAlgorithm: key.hash_algorithm,
        hashValue: key.hash_value,
        keydata: decryptedKeydata,
        selectionIdentifier: key.selection_identifier,
        description: key.description,
        startDate: key.start_date,
        endDate: key.end_date
      };
      
      // Encrypt with password
      const salt = crypto.randomBytes(32);
      const keyFromPassword = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv('aes-256-cbc', keyFromPassword, iv);
      const exportJson = JSON.stringify(exportData);
      let encrypted = cipher.update(exportJson, 'utf8');
      encrypted = Buffer.concat([encrypted, cipher.final()]);
      
      const finalExport = {
        version: '1.0',
        timestamp: new Date().toISOString(),
        type: 'encryption-key',
        salt: salt.toString('hex'),
        iv: iv.toString('hex'),
        encrypted: encrypted.toString('hex')
      };
      
      // Show save dialog
      const result = await dialog.showSaveDialog({
        title: 'Export Encryption Key',
        defaultPath: `rhtools-encryption-key-${key.name || keyUuid}.json`,
        filters: [
          { name: 'JSON Files', extensions: ['json'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      });
      
      if (result.canceled) {
        return { success: false, error: 'Export cancelled' };
      }
      
      // Write to file
      const fs = require('fs');
      fs.writeFileSync(result.filePath, JSON.stringify(finalExport, null, 2));
      
      return { success: true };
    } catch (error) {
      console.error('Error exporting encryption key:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Import encryption key (password-encrypted backup)
   * Channel: online:encryption-key:import
   */
  ipcMain.handle('online:encryption-key:import', async (event, { encryptedData, password, encrypted }) => {
    try {
      const db = dbManager.getConnection('clientdata');
      const crypto = require('crypto');
      
      // Parse export data
      const exportData = JSON.parse(encryptedData);
      
      if (exportData.version !== '1.0') {
        return { success: false, error: 'Unsupported export format version' };
      }
      
      // Decrypt with password
      const salt = Buffer.from(exportData.salt, 'hex');
      const keyFromPassword = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
      const iv = Buffer.from(exportData.iv, 'hex');
      const decipher = crypto.createDecipheriv('aes-256-cbc', keyFromPassword, iv);
      const encryptedBuffer = Buffer.from(exportData.encrypted, 'hex');
      let decrypted = decipher.update(encryptedBuffer);
      decrypted = Buffer.concat([decrypted, decipher.final()]);
      
      const keyData = JSON.parse(decrypted.toString('utf8'));
      
      // Generate new UUID for imported key
      const keyUuid = crypto.randomUUID();
      
      // Generate hash of raw key value
      const rawKeyBuffer = Buffer.from(keyData.keydata, 'hex');
      const hashValue = crypto.createHash('sha256').update(rawKeyBuffer).digest('hex');
      
      let finalKeydata = keyData.keydata;
      let keyguardHash = null;
      
      // If encrypted flag is set, encrypt with Profile Guard key
      if (encrypted) {
        const keyguardKey = getKeyguardKey(event);
        if (!keyguardKey) {
          return { success: false, error: 'Profile Guard must be unlocked to import encrypted keys' };
        }
        
        // Create keyguard hash
        keyguardHash = crypto.createHash('sha256').update(keyguardKey).digest('hex');
        
        // Encrypt keydata
        const encryptIv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv('aes-256-cbc', keyguardKey, encryptIv);
        const keydataBuffer = Buffer.from(keyData.keydata, 'hex');
        let encryptedKeydata = cipher.update(keydataBuffer);
        encryptedKeydata = Buffer.concat([encryptedKeydata, cipher.final()]);
        
        finalKeydata = encryptIv.toString('hex') + ':' + encryptedKeydata.toString('hex');
      }
      
      // Insert into database
      db.prepare(`
        INSERT INTO encryption_keys (
          key_uuid, name, label, algorithm, key_type, encrypted, keyguard_hash,
          hash_algorithm, hash_value, keydata, selection_identifier, description,
          start_date, end_date
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        keyUuid,
        keyData.name || null,
        keyData.label || null,
        keyData.algorithm,
        keyData.keyType,
        encrypted ? 1 : 0,
        keyguardHash,
        keyData.hashAlgorithm || 'SHA-256',
        hashValue,
        finalKeydata,
        keyData.selectionIdentifier || null,
        keyData.description || null,
        keyData.startDate || new Date().toISOString(),
        keyData.endDate || null
      );
      
      return { success: true, keyUuid };
    } catch (error) {
      console.error('Error importing encryption key:', error);
      return { success: false, error: error.message || 'Invalid password or file format' };
    }
  });

  // ===========================================================================
  // TRUST DECLARATIONS OPERATIONS (clientdata.db)
  // ===========================================================================

  /**
   * List all admin declarations (trust declarations)
   * Channel: online:trust-declarations:list
   */
  ipcMain.handle('online:trust-declarations:list', async (event) => {
    try {
      const db = dbManager.getConnection('clientdata');
      const declarations = db.prepare(`
        SELECT * FROM admindeclarations
        ORDER BY created_at DESC
      `).all();
      
      return declarations || [];
    } catch (error) {
      console.error('Error listing trust declarations:', error);
      return [];
    }
  });
  ipcMain.handle('online:trust-declarations:export-all', async () => {
    try {
      const { canceled, filePath } = await dialog.showSaveDialog({
        title: 'Export Trust Declarations',
        defaultPath: 'trust-declarations-export.json',
        filters: [{ name: 'JSON Files', extensions: ['json'] }]
      });
      if (canceled || !filePath) {
        return { success: false, canceled: true };
      }

      const fs = require('fs');
      const db = dbManager.getConnection('clientdata');
      const admindeclarations = db.prepare('SELECT * FROM admindeclarations').all();
      let trustDeclarations = [];
      try {
        trustDeclarations = db.prepare('SELECT * FROM trust_declarations').all();
      } catch (legacyError) {
        console.warn('Legacy trust_declarations table not found or inaccessible:', legacyError.message);
      }

      const exportData = {
        version: 1,
        exported_at: new Date().toISOString(),
        admindeclarations,
        trust_declarations: trustDeclarations
      };

      fs.writeFileSync(filePath, JSON.stringify(exportData, null, 2), 'utf8');

      return {
        success: true,
        filePath,
        adminCount: admindeclarations.length,
        trustCount: trustDeclarations.length
      };
    } catch (error) {
      console.error('Error exporting trust declarations:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('online:trust-declarations:import', async () => {
    try {
      const { canceled, filePaths } = await dialog.showOpenDialog({
        title: 'Import Trust Declarations',
        filters: [{ name: 'JSON Files', extensions: ['json'] }],
        properties: ['openFile']
      });

      if (canceled || !filePaths || filePaths.length === 0) {
        return { success: false, canceled: true };
      }

      const fs = require('fs');
      const filePath = filePaths[0];
      const content = fs.readFileSync(filePath, 'utf8');
      let data;
      try {
        data = JSON.parse(content);
      } catch (parseError) {
        return { success: false, error: 'Invalid JSON file' };
      }

      const result = dbManager.importTrustDeclarationsFromData(data, { source: filePath });
      return {
        success: true,
        filePath,
        adminCount: result.adminDeclarationsImported || 0,
        trustCount: result.trustDeclarationsImported || 0
      };
    } catch (error) {
      console.error('Error importing trust declarations:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('online:admin-public-keys:export', async () => {
    try {
      const { canceled, filePath } = await dialog.showSaveDialog({
        title: 'Export Admin Public Keys',
        defaultPath: 'adminkp_trust.json',
        filters: [{ name: 'JSON Files', extensions: ['json'] }]
      });
      if (canceled || !filePath) {
        return { success: false, canceled: true };
      }

      const fs = require('fs');
      const db = dbManager.getConnection('clientdata');

      const sanitizeAdminKeypairForExport = (kp) => {
        const copy = { ...kp };
        delete copy.encrypted_private_key;
        delete copy.private_key_format;
        delete copy.privateKey;
        delete copy.private_key;
        copy.storage_status = 'public-only';
        copy.profile_uuid = copy.profile_uuid || null;
        return copy;
      };

      const sanitizeUserOpKeypairForExport = (kp) => {
        const copy = { ...kp };
        delete copy.encrypted_private_key;
        delete copy.private_key_format;
        delete copy.privateKey;
        delete copy.private_key;
        copy.storage_status = 'public-only';
        return copy;
      };

      const sanitizeEncryptionKeyForExport = (key) => {
        const copy = { ...key };
        copy.encrypted = copy.encrypted ? 1 : 0;
        return copy;
      };

      const masterKeys = db.prepare(`
        SELECT * FROM admin_keypairs
        WHERE key_usage = 'master-admin-signing'
      `).all().map(sanitizeAdminKeypairForExport);

      const adminKeys = db.prepare(`
        SELECT * FROM admin_keypairs
        WHERE (key_usage IS NULL OR key_usage != 'master-admin-signing')
          AND (profile_uuid IS NULL OR profile_uuid = '')
      `).all().map(sanitizeAdminKeypairForExport);

      const userOpKeys = db.prepare(`
        SELECT * FROM profile_keypairs
      `).all().map(sanitizeUserOpKeypairForExport);

      const encryptionKeys = db.prepare(`
        SELECT * FROM encryption_keys
        WHERE key_type = 'Shared Preinstalled'
      `).all().map(sanitizeEncryptionKeyForExport);

      const exportData = {
        version: 1,
        exported_at: new Date().toISOString(),
        admin_master_keys: masterKeys,
        admin_keypairs: adminKeys,
        user_op_keypairs: userOpKeys,
        encryption_keys: encryptionKeys
      };

      fs.writeFileSync(filePath, JSON.stringify(exportData, null, 2), 'utf8');

      return {
        success: true,
        filePath,
        masterCount: masterKeys.length,
        adminCount: adminKeys.length,
        userOpCount: userOpKeys.length,
        encryptionCount: encryptionKeys.length
      };
    } catch (error) {
      console.error('Error exporting admin public keys:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('online:admin-public-keys:import', async () => {
    try {
      const { canceled, filePaths } = await dialog.showOpenDialog({
        title: 'Import Admin Public Keys',
        filters: [{ name: 'JSON Files', extensions: ['json'] }],
        properties: ['openFile']
      });

      if (canceled || !filePaths || filePaths.length === 0) {
        return { success: false, canceled: true };
      }

      const fs = require('fs');
      const filePath = filePaths[0];
      const content = fs.readFileSync(filePath, 'utf8');
      let data;
      try {
        data = JSON.parse(content);
      } catch (parseError) {
        return { success: false, error: 'Invalid JSON file' };
      }

      const result = dbManager.importAdminPublicKeysFromData(data, { source: filePath });
      return {
        success: true,
        filePath,
        masterCount: result.masterKeysImported || 0,
        adminCount: result.adminKeysImported || 0,
        userOpCount: result.userOpKeysImported || 0,
        encryptionCount: result.encryptionKeysImported || 0
      };
    } catch (error) {
      console.error('Error importing admin public keys:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Get a specific trust declaration
   * Channel: online:trust-declaration:get
   */
  ipcMain.handle('online:trust-declaration:get', async (event, { declarationUuid }) => {
    try {
      const db = dbManager.getConnection('clientdata');
      const declaration = db.prepare(`
        SELECT * FROM trust_declarations
        WHERE declaration_uuid = ?
      `).get(declarationUuid);
      
      if (!declaration) {
        return { success: false, error: 'Trust declaration not found' };
      }
      
      return { success: true, declaration };
    } catch (error) {
      console.error('Error getting trust declaration:', error);
      return { success: false, error: error.message };
    }
  });
  /**
   * Create a new trust declaration
   * Channel: online:trust-declaration:create
   */
  ipcMain.handle('online:trust-declaration:create', async (event, declarationData) => {
    try {
      const db = dbManager.getConnection('clientdata');
      const crypto = require('crypto');
      
      const declarationUuid = declarationData.declaration_uuid || crypto.randomUUID();
      const now = new Date().toISOString();
      
      db.prepare(`
        INSERT INTO trust_declarations (
          declaration_uuid,
          issuing_canonical_name,
          issuing_fingerprint,
          issued_at,
          updated_at,
          subject_canonical_name,
          subject_fingerprint,
          valid_starting,
          valid_ending,
          subject_trust_level,
          subject_usagetypes,
          subject_scopes,
          scope_permissions,
          signature_hash_algorithm,
          signature_hash_value,
          signature,
          countersignatures
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        declarationUuid,
        declarationData.issuing_canonical_name || null,
        declarationData.issuing_fingerprint,
        declarationData.issued_at || now,
        now,
        declarationData.subject_canonical_name || null,
        declarationData.subject_fingerprint,
        declarationData.valid_starting,
        declarationData.valid_ending || null,
        declarationData.subject_trust_level || null,
        declarationData.subject_usagetypes ? JSON.stringify(declarationData.subject_usagetypes) : null,
        declarationData.subject_scopes ? JSON.stringify(declarationData.subject_scopes) : null,
        declarationData.scope_permissions ? JSON.stringify(declarationData.scope_permissions) : null,
        declarationData.signature_hash_algorithm || null,
        declarationData.signature_hash_value || null,
        declarationData.signature ? JSON.stringify(declarationData.signature) : null,
        declarationData.countersignatures ? JSON.stringify(declarationData.countersignatures) : null
      );
      
      return { success: true, declarationUuid };
    } catch (error) {
      console.error('Error creating trust declaration:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Update trust declaration metadata
   * Channel: online:trust-declaration:update-metadata
   */
  ipcMain.handle('online:trust-declaration:update-metadata', async (event, { declarationUuid, updates }) => {
    try {
      const db = dbManager.getConnection('clientdata');
      const now = new Date().toISOString();
      
      const fields = [];
      const values = [];
      
      if (updates.valid_ending !== undefined) {
        fields.push('valid_ending = ?');
        values.push(updates.valid_ending || null);
      }
      
      if (updates.subject_trust_level !== undefined) {
        fields.push('subject_trust_level = ?');
        values.push(updates.subject_trust_level || null);
      }
      
      if (fields.length === 0) {
        return { success: false, error: 'No fields to update' };
      }
      
      fields.push('updated_at = ?');
      values.push(now);
      values.push(declarationUuid);
      
      db.prepare(`
        UPDATE trust_declarations
        SET ${fields.join(', ')}
        WHERE declaration_uuid = ?
      `).run(...values);
      
      return { success: true };
    } catch (error) {
      console.error('Error updating trust declaration metadata:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Delete a trust declaration
   * Channel: online:trust-declaration:delete
   */
  ipcMain.handle('online:trust-declaration:delete', async (event, { declarationUuid }) => {
    try {
      const db = dbManager.getConnection('clientdata');
      db.prepare(`
        DELETE FROM trust_declarations
        WHERE declaration_uuid = ?
      `).run(declarationUuid);

      db.prepare(`
        DELETE FROM admindeclarations
        WHERE declaration_uuid = ?
      `).run(declarationUuid);
      console.log(`[online:trust-declaration:delete] uuid=${declarationUuid}`)
     
      return { success: true };
    } catch (error) {
      console.error('Error deleting trust declaration:', error);
      return { success: false, error: error.message };
    }
  });
  /**
   * Create or update an admin declaration
   * Channel: online:admin-declaration:save
   */
  ipcMain.handle('online:admin-declaration:save', async (event, declarationData) => {
    try {
      const db = dbManager.getConnection('clientdata');
      const crypto = require('crypto');
      
      // Generate UUID if not provided
      if (!declarationData.declaration_uuid) {
        declarationData.declaration_uuid = crypto.randomUUID();
      }
      
      const now = new Date().toISOString();
      
      // Compute content hash
      const contentHash = crypto.createHash('sha256')
        .update(declarationData.content_json || '')
        .digest('hex');
      
      // Check if declaration already exists
      const existing = db.prepare(`
        SELECT declaration_uuid FROM admindeclarations
        WHERE declaration_uuid = ?
      `).get(declarationData.declaration_uuid);
      
      const actionType = existing ? 'update' : 'create';
      
      if (existing) {
        // Update existing declaration
        db.prepare(`
          UPDATE admindeclarations SET
            declaration_type = ?,
            content_json = ?,
            content_hash_sha256 = ?,
            status = ?,
            schema_version = ?,
            content_version = COALESCE(content_version, 1) + 1,
            signing_keypair_uuid = ?,
            signing_keypair_fingerprint = ?,
            target_keypair_uuid = ?,
            target_keypair_fingerprint = ?,
            target_keypair_canonical_name = ?,
            target_keypair_public_hex = ?,
            target_user_profile_id = ?,
            valid_from = ?,
            valid_until = ?,
            required_countersignatures = ?,
            retroactive_effect_enabled = ?,
            retroactive_effective_from = ?,
            updated_at = ?
          WHERE declaration_uuid = ?
        `).run(
          declarationData.declaration_type || 'trust-declaration',
          declarationData.content_json,
          contentHash,
          declarationData.status || 'Draft',
          declarationData.schema_version || '1.0',
          declarationData.signing_keypair_uuid || null,
          declarationData.signing_keypair_fingerprint || null,
          declarationData.target_keypair_uuid || null,
          declarationData.target_keypair_fingerprint || null,
          declarationData.target_keypair_canonical_name || null,
          declarationData.target_keypair_public_hex || null,
          declarationData.target_user_profile_id || null,
          declarationData.valid_from || null,
          declarationData.valid_until || null,
          declarationData.required_countersignatures || 0,
          declarationData.retroactive_effect_enabled ? 1 : 0,
          declarationData.retroactive_effective_from || null,
          now,
          declarationData.declaration_uuid
        );
      } else {
        // Insert new declaration
        db.prepare(`
          INSERT INTO admindeclarations (
            declaration_uuid,
            declaration_type,
            content_json,
            content_hash_sha256,
            digital_signature,
            status,
            schema_version,
            content_version,
            signing_keypair_uuid,
            signing_keypair_fingerprint,
            target_keypair_uuid,
            target_keypair_fingerprint,
            target_keypair_canonical_name,
            target_keypair_public_hex,
            target_user_profile_id,
            valid_from,
            valid_until,
            required_countersignatures,
            retroactive_effect_enabled,
            retroactive_effective_from,
            is_local,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          declarationData.declaration_uuid,
          declarationData.declaration_type || 'trust-declaration',
          declarationData.content_json,
          contentHash,
          declarationData.digital_signature || '',
          declarationData.status || 'Draft',
          declarationData.schema_version || '1.0',
          declarationData.content_version || 1,
          declarationData.signing_keypair_uuid || null,
          declarationData.signing_keypair_fingerprint || null,
          declarationData.target_keypair_uuid || null,
          declarationData.target_keypair_fingerprint || null,
          declarationData.target_keypair_canonical_name || null,
          declarationData.target_keypair_public_hex || null,
          declarationData.target_user_profile_id || null,
          declarationData.valid_from || null,
          declarationData.valid_until || null,
          declarationData.required_countersignatures || 0,
          declarationData.retroactive_effect_enabled ? 1 : 0,
          declarationData.retroactive_effective_from || null,
          1, // is_local
          now,
          now
        );
      }
      
      broadcastTrustChange({
        type: 'declaration',
        action: actionType,
        declarationUuid: declarationData.declaration_uuid,
        targetPubkey: declarationData.target_keypair_public_hex ||
          declarationData.target_keypair_fingerprint ||
          declarationData.target_keypair_canonical_name || null,
        status: declarationData.status || 'Draft'
      });
      return { success: true, declarationUuid: declarationData.declaration_uuid };
    } catch (error) {
      console.error('Error saving admin declaration:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Get a specific admin declaration
   * Channel: online:admin-declaration:get
   */
  ipcMain.handle('online:admin-declaration:get', async (event, { declarationUuid }) => {
    try {
      const db = dbManager.getConnection('clientdata');
      const declaration = db.prepare(`
        SELECT * FROM admindeclarations
        WHERE declaration_uuid = ?
      `).get(declarationUuid);
      
      if (!declaration) {
        return { success: false, error: 'Admin declaration not found' };
      }
      
      return { success: true, declaration };
    } catch (error) {
      console.error('Error getting admin declaration:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Update admin declaration status
   * Channel: online:admin-declaration:update-status
   */
  ipcMain.handle('online:admin-declaration:update-status', async (event, { declarationUuid, status }) => {
    try {
      const db = dbManager.getConnection('clientdata');
      const now = new Date().toISOString();
      
      db.prepare(`
        UPDATE admindeclarations
        SET status = ?, updated_at = ?
        WHERE declaration_uuid = ?
      `).run(status, now, declarationUuid);
      
      broadcastTrustChange({
        type: 'declaration',
        action: 'status',
        declarationUuid,
        status
      });
      return { success: true };
    } catch (error) {
      console.error('Error updating admin declaration status:', error);
      return { success: false, error: error.message };
    }
  });
  /**
   * Sign an admin declaration
   * Channel: online:admin-declaration:sign
   */
  ipcMain.handle('online:admin-declaration:sign', async (event, { declarationUuid, keypairUuid, keypairType }) => {
    try {
      const db = dbManager.getConnection('clientdata');
      const crypto = require('crypto');
      const AdminDeclaration = require('./utils/AdminDeclaration');
      
      // Get the declaration
      const declaration = db.prepare(`
        SELECT * FROM admindeclarations WHERE declaration_uuid = ?
      `).get(declarationUuid);
      
      if (!declaration) {
        return { success: false, error: 'Admin declaration not found' };
      }
      
      // Check if already signed
      if (declaration.digital_signature && declaration.status === 'Published') {
        return { success: false, error: 'Declaration is already signed and published' };
      }
      
      // Get the keypair (admin or user-op)
      let keypair = null;
      if (keypairType === 'admin' || !keypairType) {
        keypair = db.prepare(`
          SELECT * FROM admin_keypairs WHERE keypair_uuid = ? AND profile_uuid IS NULL
        `).get(keypairUuid);
      } else if (keypairType === 'user-op') {
        keypair = db.prepare(`
          SELECT * FROM admin_keypairs WHERE keypair_uuid = ? AND profile_uuid IS NOT NULL
        `).get(keypairUuid);
      }
      
      if (!keypair) {
        return { success: false, error: 'Keypair not found' };
      }
      
      // Check if private key is available
      const keyguardKey = getKeyguardKey(event);
      if (!keyguardKey) {
        return { success: false, error: 'Profile Guard must be unlocked to sign declarations' };
      }
      
      // Decrypt private key if encrypted
      let privateKey = null;
      if (keypair.encrypted_private_key) {
        try {
          const parts = keypair.encrypted_private_key.split(':');
          if (parts.length === 2) {
            const iv = Buffer.from(parts[0], 'hex');
            const encrypted = Buffer.from(parts[1], 'hex');
            const decipher = crypto.createDecipheriv('aes-256-cbc', keyguardKey, iv);
            let decrypted = decipher.update(encrypted);
            decrypted = Buffer.concat([decrypted, decipher.final()]);
            
            if (keypair.private_key_format === 'hex') {
              privateKey = decrypted.toString('hex');
            } else {
              privateKey = decrypted.toString('utf8');
            }
          }
        } catch (error) {
          return { success: false, error: 'Failed to decrypt private key' };
        }
      } else if (keypair.storage_status === 'full-offline') {
        return { success: false, error: 'Private key is stored offline and cannot be used for signing' };
      }
      
      if (!privateKey) {
        return { success: false, error: 'Private key not available' };
      }
      
      // Prepare signing keypair object
      const signingKeypair = {
        canonical_name: keypair.canonical_name,
        fingerprint: keypair.fingerprint,
        privateKey: privateKey,
        type: keypair.keypair_type,
        algorithm: keypair.keypair_type
      };
      
      // Sign the declaration
      const signResult = await AdminDeclaration.signDeclaration(declaration, signingKeypair);
      
      // Update the declaration in database
      const now = new Date().toISOString();
      
      // Check if this is a Nostr key (returns nostr_event_id and nostr_event)
      const isNostrKey = signResult.nostr_event_id !== undefined;
      
      let nostrQueued = false;
      if (isNostrKey) {
        // Nostr key: Update with Nostr event data including all serialization fields
        db.prepare(`
          UPDATE admindeclarations SET
            digital_signature = ?,
            signed_data = ?,
            signed_data_sha256 = ?,
            signing_timestamp = ?,
            signing_keypair_uuid = ?,
            signing_keypair_fingerprint = ?,
            signing_keypair_canonical_name = ?,
          nostr_event_id = ?,
          nostr_public_key = ?,
          nostr_created_at = ?,
          nostr_kind = ?,
          nostr_tags = ?,
          nostr_content = ?,
          status = CASE WHEN status = 'Finalized' THEN 'Signed' ELSE status END,
          updated_at = ?
          WHERE declaration_uuid = ?
        `).run(
          signResult.digital_signature,
          signResult.signed_data,
          signResult.signed_data_sha256,
          signResult.signing_timestamp,
          keypairUuid,
          signingKeypair.fingerprint,
          signingKeypair.canonical_name,
          signResult.nostr_event_id,
          signResult.nostr_public_key || null,
          signResult.nostr_created_at || null,
          signResult.nostr_kind || null,
          signResult.nostr_tags || null,
          signResult.nostr_content || null,
          now,
          declarationUuid
        );

        if (signResult.nostr_event) {
          try {
            const nostrEvent =
              typeof signResult.nostr_event === 'string'
                ? JSON.parse(signResult.nostr_event)
                : signResult.nostr_event;
            const nostrDBManager = new NostrLocalDBManager();
            try {
              await nostrDBManager.initialize();
              nostrQueued = nostrDBManager.addEvent(
                'cache_out',
                nostrEvent,
                0,
                null,
                'admindeclarations',
                declarationUuid,
                null
              );
            } finally {
              nostrDBManager.closeAll();
            }
          } catch (error) {
            console.error('[online:admin-declaration:sign] Failed to enqueue declaration for Nostr publish:', error);
          }
        }
      } else {
        // Non-Nostr key: Standard update
        db.prepare(`
          UPDATE admindeclarations SET
            digital_signature = ?,
            signed_data = ?,
            signed_data_sha256 = ?,
            signing_timestamp = ?,
            signing_keypair_uuid = ?,
            signing_keypair_fingerprint = ?,
            signing_keypair_canonical_name = ?,
            status = CASE WHEN status = 'Finalized' THEN 'Signed' ELSE status END,
            updated_at = ?
          WHERE declaration_uuid = ?
        `).run(
          signResult.digital_signature,
          signResult.signed_data,
          signResult.signed_data_sha256,
          signResult.signing_timestamp,
          keypairUuid,
          signingKeypair.fingerprint,
          signingKeypair.canonical_name,
          now,
          declarationUuid
        );
      }

      if (nostrQueued) {
        db.prepare(`
          UPDATE admindeclarations
          SET nostr_publish_status = 'queued',
              nostr_published_at = NULL,
              nostr_published_to_relays = NULL
          WHERE declaration_uuid = ?
        `).run(declarationUuid);
      }
      
      broadcastTrustChange({
        type: 'declaration',
        action: 'sign',
        declarationUuid,
        status: 'Signed'
      });
      
      return { success: true, signedData: signResult };
    } catch (error) {
      console.error('Error signing admin declaration:', error);
      return { success: false, error: error.message };
    }
  });
  /**
   * Channel: online:get-available-nostr-signing-keypairs
   * Get all Nostr keypairs that have private keys available for signing
   */
  ipcMain.handle('online:get-available-nostr-signing-keypairs', async (event) => {
    try {
      const db = dbManager.getConnection('clientdata');
      const keyguardKey = getKeyguardKey(event);
      
      if (!keyguardKey) {
        return { success: false, error: 'Profile Guard not unlocked' };
      }
      
      // Get all Nostr keypairs (admin, user-op, and user profile keypairs)
      // that have private keys (storage_status != 'public-only')
      const nostrKeypairs = [];
      
      // Admin keypairs - check for both 'Nostr' and 'Nostr%' patterns
      // Also check case-insensitive
      const adminKeypairs = db.prepare(`
        SELECT keypair_uuid, keypair_type, name, label, canonical_name, storage_status, encrypted_private_key
        FROM admin_keypairs
        WHERE (keypair_type LIKE 'Nostr%' OR keypair_type = 'Nostr' OR LOWER(keypair_type) LIKE '%nostr%')
          AND storage_status IN ('full', 'full-offline')
          AND encrypted_private_key IS NOT NULL
      `).all();
      
      console.log(`[getAvailableNostrSigningKeypairs] Found ${adminKeypairs.length} admin keypairs matching Nostr pattern`);
      
      for (const kp of adminKeypairs) {
        try {
          console.log(`[getAvailableNostrSigningKeypairs] Processing admin keypair ${kp.keypair_uuid}: type=${kp.keypair_type}, status=${kp.storage_status}`);
          
          // Try to decrypt to verify we have the key
          if (kp.storage_status === 'full' && kp.encrypted_private_key) {
            const parts = kp.encrypted_private_key.split(':');
            if (parts.length === 2) {
              const iv = Buffer.from(parts[0], 'hex');
              const encrypted = Buffer.from(parts[1], 'hex');
              const decipher = crypto.createDecipheriv('aes-256-cbc', keyguardKey, iv);
              let decrypted = decipher.update(encrypted);
              decrypted = Buffer.concat([decrypted, decipher.final()]);
              
              console.log(`[getAvailableNostrSigningKeypairs] Successfully decrypted admin keypair ${kp.keypair_uuid}`);
              
              // Successfully decrypted - add to list
              nostrKeypairs.push({
                uuid: kp.keypair_uuid,
                name: kp.name,
                label: kp.label,
                canonicalName: kp.canonical_name,
                type: kp.keypair_type,
                keyType: 'admin'
              });
            } else {
              console.warn(`[getAvailableNostrSigningKeypairs] Admin keypair ${kp.keypair_uuid} has invalid encrypted_private_key format (expected iv:encrypted)`);
            }
          } else {
            console.log(`[getAvailableNostrSigningKeypairs] Skipping admin keypair ${kp.keypair_uuid}: status=${kp.storage_status}, has_encrypted=${!!kp.encrypted_private_key}`);
          }
        } catch (err) {
          // Skip if can't decrypt
          console.warn(`[getAvailableNostrSigningKeypairs] Cannot decrypt admin keypair ${kp.keypair_uuid}:`, err.message);
        }
      }
      
      // User Op keypairs (for current profile)
      const userOpKeypairs = db.prepare(`
        SELECT keypair_uuid, keypair_type, name, label, canonical_name, storage_status, encrypted_private_key
        FROM admin_keypairs
        WHERE (keypair_type LIKE 'Nostr%' OR keypair_type = 'Nostr' OR LOWER(keypair_type) LIKE '%nostr%')
          AND profile_uuid IS NOT NULL
          AND storage_status IN ('full', 'full-offline')
          AND encrypted_private_key IS NOT NULL
      `).all();
      console.log(`[getAvailableNostrSigningKeypairs] Found ${userOpKeypairs.length} user-op keypairs matching Nostr pattern`);
      
      for (const kp of userOpKeypairs) {
        try {
          if (kp.storage_status === 'full' && kp.encrypted_private_key) {
            const parts = kp.encrypted_private_key.split(':');
            if (parts.length === 2) {
              const iv = Buffer.from(parts[0], 'hex');
              const encrypted = Buffer.from(parts[1], 'hex');
              const decipher = crypto.createDecipheriv('aes-256-cbc', keyguardKey, iv);
              let decrypted = decipher.update(encrypted);
              decrypted = Buffer.concat([decrypted, decipher.final()]);
              
              // Successfully decrypted - add to list
              nostrKeypairs.push({
                uuid: kp.keypair_uuid,
                name: kp.name,
                label: kp.label,
                canonicalName: kp.canonical_name,
                type: kp.keypair_type,
                keyType: 'user-op'
              });
            }
          }
        } catch (err) {
          console.warn(`Cannot decrypt user-op keypair ${kp.keypair_uuid}:`, err.message);
        }
      }
      
      // User profile keypairs (primary and additional)
      // Get from profile_keypairs table via OnlineProfileManager
      if (keyguardKey) {
        try {
          const profileManager = new OnlineProfileManager(dbManager, keyguardKey);
          const currentProfileId = profileManager.getCurrentProfileId();
          if (currentProfileId) {
            const profileKeypairs = profileManager.getProfileKeypairs(currentProfileId);
            profileKeypairs.forEach(kp => {
              if (kp.type && kp.type.toLowerCase().includes('nostr') && kp.encryptedPrivateKey) {
                nostrKeypairs.push({
                  uuid: kp.uuid,
                  name: kp.name || kp.localName || 'User Profile Key',
                  canonicalName: kp.canonicalName,
                  type: kp.type,
                  keyUsage: kp.keyUsage,
                  storageStatus: kp.storageStatus,
                  hasPrivateKey: !!kp.encryptedPrivateKey
                });
              }
            });
          }
        } catch (error) {
          console.error('Error loading profile keypairs for Nostr signing:', error);
        }
      }
      
      console.log(`[getAvailableNostrSigningKeypairs] Returning ${nostrKeypairs.length} available Nostr signing keypairs`);
      
      return { success: true, keypairs: nostrKeypairs };
    } catch (error) {
      console.error('Error getting available Nostr signing keypairs:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Channel: online:generate-keypair-publish-event-preview
   * Generate a Nostr event template for publishing a keypair (without signing)
   */
  ipcMain.handle('online:generate-keypair-publish-event-preview', async (event, { keypairType, keypairUuid, signingKeypairUuid, profileUuid }) => {
    try {
      const db = dbManager.getConnection('clientdata');
      
      // Get the keypair to publish
      let keypairRow;
      if (keypairType === 'master' || keypairType === 'admin') {
        keypairRow = db.prepare('SELECT * FROM admin_keypairs WHERE keypair_uuid = ?').get(keypairUuid);
      } else if (keypairType === 'user-op') {
        keypairRow = db.prepare('SELECT * FROM admin_keypairs WHERE keypair_uuid = ? AND profile_uuid = ?').get(keypairUuid, profileUuid);
      }
      
      if (!keypairRow) {
        return { success: false, error: 'Keypair not found' };
      }
      
      // Get the signing keypair
      const signingKeypair = db.prepare('SELECT * FROM admin_keypairs WHERE keypair_uuid = ?').get(signingKeypairUuid);
      if (!signingKeypair || !signingKeypair.canonical_name) {
        return { success: false, error: 'Signing keypair not found' };
      }
      
      // Build event content (JSON with all public keypair details)
      const eventContent = {
        keypair_uuid: keypairRow.keypair_uuid,
        keypair_type: keypairRow.keypair_type,
        key_usage: keypairRow.key_usage,
        trust_level: keypairRow.trust_level,
        public_key: keypairRow.public_key,
        public_key_hex: keypairRow.public_key_hex,
        fingerprint: keypairRow.fingerprint,
        canonical_name: keypairRow.canonical_name,
        local_name: keypairRow.local_name,
        name: keypairRow.name,
        label: keypairRow.label,
        comments: keypairRow.comments,
        created_at: keypairRow.created_at,
        updated_at: keypairRow.updated_at,
        profile_uuid: keypairRow.profile_uuid || null
      };
      
      // Add profile information for User Op keys
      if (keypairType === 'user-op' && profileUuid) {
        const profileRow = db.prepare('SELECT * FROM profiles WHERE profile_uuid = ?').get(profileUuid);
        if (profileRow) {
          eventContent.profile = {
            uuid: profileRow.profile_uuid,
            username: profileRow.username,
            displayname: profileRow.displayname
          };
        }
      }
      
      // Create event template
      // Kind 31107 for keypair publications (to be defined)
      const eventTemplate = {
        kind: 31107, // Keypair publication event kind
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['d', keypairRow.keypair_uuid], // Keypair UUID tag
          ['t', 'rhplay-keypair-publication'], // Type tag
          ['k', keypairType], // Keypair type (master/admin/user-op)
          ['p', signingKeypair.canonical_name] // Signing keypair canonical name
        ],
        content: JSON.stringify(eventContent)
      };
      
      return { success: true, eventTemplate };
    } catch (error) {
      console.error('Error generating keypair publish event preview:', error);
      return { success: false, error: error.message };
    }
  });
  /**
   * Channel: online:publish-keypair-to-nostr
   * Create and sign a Nostr event for publishing a keypair, add to cache_out
   */
  ipcMain.handle('online:publish-keypair-to-nostr', async (event, { keypairType, keypairUuid, signingKeypairUuid, profileUuid }) => {
    try {
      const { finalizeEvent } = require('nostr-tools');
      const db = dbManager.getConnection('clientdata');
      const keyguardKey = getKeyguardKey(event);
      
      if (!keyguardKey) {
        return { success: false, error: 'Profile Guard not unlocked' };
      }
      
      // Get the keypair to publish (same logic as preview)
      let keypairRow;
      if (keypairType === 'master' || keypairType === 'admin') {
        keypairRow = db.prepare('SELECT * FROM admin_keypairs WHERE keypair_uuid = ?').get(keypairUuid);
      } else if (keypairType === 'user-op') {
        keypairRow = db.prepare('SELECT * FROM admin_keypairs WHERE keypair_uuid = ? AND profile_uuid = ?').get(keypairUuid, profileUuid);
      }
      
      if (!keypairRow) {
        return { success: false, error: 'Keypair not found' };
      }
      
      // Get the signing keypair and decrypt its private key
      const signingKeypair = db.prepare('SELECT * FROM admin_keypairs WHERE keypair_uuid = ?').get(signingKeypairUuid);
      if (!signingKeypair || signingKeypair.storage_status === 'public-only') {
        return { success: false, error: 'Signing keypair not found or private key not available' };
      }
      
      // Decrypt signing keypair private key
      let privateKeyHex;
      try {
        const parts = signingKeypair.encrypted_private_key.split(':');
        if (parts.length !== 2) {
          return { success: false, error: 'Invalid encrypted private key format' };
        }
        
        const iv = Buffer.from(parts[0], 'hex');
        const encrypted = Buffer.from(parts[1], 'hex');
        const decipher = crypto.createDecipheriv('aes-256-cbc', keyguardKey, iv);
        let decrypted = decipher.update(encrypted);
        decrypted = Buffer.concat([decrypted, decipher.final()]);
        
        // For Nostr keys, private key is stored as hex
        privateKeyHex = decrypted.toString('hex');
      } catch (err) {
        return { success: false, error: `Cannot decrypt signing keypair: ${err.message}` };
      }
      
      // Generate event template (same as preview)
      const eventContent = {
        keypair_uuid: keypairRow.keypair_uuid,
        keypair_type: keypairRow.keypair_type,
        key_usage: keypairRow.key_usage,
        trust_level: keypairRow.trust_level,
        public_key: keypairRow.public_key,
        public_key_hex: keypairRow.public_key_hex,
        fingerprint: keypairRow.fingerprint,
        canonical_name: keypairRow.canonical_name,
        local_name: keypairRow.local_name,
        name: keypairRow.name,
        label: keypairRow.label,
        comments: keypairRow.comments,
        created_at: keypairRow.created_at,
        updated_at: keypairRow.updated_at,
        profile_uuid: keypairRow.profile_uuid || null
      };
      
      if (keypairType === 'user-op' && profileUuid) {
        const profileRow = db.prepare('SELECT * FROM profiles WHERE profile_uuid = ?').get(profileUuid);
        if (profileRow) {
          eventContent.profile = {
            uuid: profileRow.profile_uuid,
            username: profileRow.username,
            displayname: profileRow.displayname
          };
        }
      }
      
      const eventTemplate = {
        kind: 31107,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['d', keypairRow.keypair_uuid],
          ['t', 'rhplay-keypair-publication'],
          ['k', keypairType],
          ['p', signingKeypair.canonical_name]
        ],
        content: JSON.stringify(eventContent)
      };
      
      // Sign the event
      const privateKeyBytes = new Uint8Array(Buffer.from(privateKeyHex, 'hex'));
      const signedEvent = finalizeEvent(eventTemplate, privateKeyBytes);
      
      // Add to NostrLocalDBManager cache_out
      const nostrDBManager = new NostrLocalDBManager();
      await nostrDBManager.initialize();
      
      const success = nostrDBManager.addEvent(
        'cache_out',
        signedEvent,
        0, // proc_status: pending
        null, // keep_for
        'admin_keypairs', // table_name
        keypairRow.keypair_uuid, // record_uuid
        profileUuid || null // user_profile_uuid
      );
      
      if (!success) {
        return { success: false, error: 'Failed to add event to outgoing cache' };
      }
      
      // Update keypair status to 'pending'
      db.prepare(`
        UPDATE admin_keypairs 
        SET nostr_status = 'pending', nostr_event_id = ?
        WHERE keypair_uuid = ?
      `).run(signedEvent.id, keypairRow.keypair_uuid);
      
      nostrDBManager.closeAll();
      
      return { success: true, eventId: signedEvent.id };
    } catch (error) {
      console.error('Error publishing keypair to Nostr:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Channel: online:publish-profile-to-nostr
   * Create and sign a Nostr kind 0 event for user profile metadata (NIP-01)
   * Uses the user's primary Nostr keypair to sign the event
   */
  ipcMain.handle('online:publish-profile-to-nostr', async (event, { profileUuid }) => {
    try {
      const keyguardKey = getKeyguardKey(event);
      if (!keyguardKey) {
        return { success: false, error: 'Profile Guard not unlocked' };
      }
      
      const profileManager = new OnlineProfileManager(dbManager, keyguardKey);
      
      // Use provided profileUuid or get current profile
      const targetProfileUuid = profileUuid || profileManager.getCurrentProfileId();
      if (!targetProfileUuid) {
        return { success: false, error: 'No profile found to publish' };
      }
      
      // Publish profile using OnlineProfileManager
      const result = await profileManager.publishProfileToNostr(targetProfileUuid);
      
      return result;
    } catch (error) {
      console.error('Error publishing profile to Nostr:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Channel: online:check-profile-for-publishing
   * Check if user has an online profile with Nostr keypair for publishing
   */
  ipcMain.handle('online:check-profile-for-publishing', async (event) => {
    try {
      const keyguardKey = getKeyguardKey(event);
      const profileManager = new OnlineProfileManager(dbManager, keyguardKey);
      
      const profile = profileManager.getCurrentProfile();
      
      if (!profile) {
        return { hasProfile: false, hasNostrKeypair: false };
      }
      
      // CRITICAL: Keypairs are stored in profile_keypairs table, not profile_json
      // Check if profile has primary keypair and if it's Nostr type by querying the table
      let hasNostrKeypair = false;
      try {
        const keypairs = profileManager.getProfileKeypairs(profile.profileId || profile._metadata?.profileUuid);
        const primaryKp = keypairs.find(kp => kp.keyUsage === 'primary');
        if (primaryKp && primaryKp.type && primaryKp.type.toLowerCase().includes('nostr')) {
          hasNostrKeypair = true;
        }
      } catch (kpError) {
        console.error('Error checking primary keypair type:', kpError);
      }
      
      return { 
        hasProfile: true, 
        hasNostrKeypair: hasNostrKeypair || false 
      };
    } catch (error) {
      console.error('Error checking profile for publishing:', error);
      return { hasProfile: false, hasNostrKeypair: false };
    }
  });
  /**
   * Channel: online:publish-ratings-to-nostr
   * Create and sign a Nostr NIP-33 event (kind 31001) for publishing game ratings
   * Uses the user's primary Nostr keypair to sign the event
   */
  ipcMain.handle('online:publish-ratings-to-nostr', async (event, { gameId, gameName, gvUuid, version, status, ratings, comments, user_notes }) => {
    try {
      const keyguardKey = getKeyguardKey(event);
      if (!keyguardKey) {
        return { success: false, error: 'Profile Guard not unlocked' };
      }
      
      const profileManager = new OnlineProfileManager(dbManager, keyguardKey);
      
      // Get current profile ID
      const currentProfileId = profileManager.getCurrentProfileId();
      if (!currentProfileId) {
        return { success: false, error: 'No current profile found' };
      }
      
      // Prepare rating data
      const ratingData = {
        gameId,
        gameName,
        gvUuid,
        version,
        status,
        ratings,
        comments,
        user_notes
      };
      
      // Publish ratings using OnlineProfileManager
      const result = await profileManager.publishRatingsToNostr(currentProfileId, ratingData);
      
      return result;
    } catch (error) {
      console.error('Error publishing ratings to Nostr:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Channel: online:profile:publish-status
   * Get profile publishing status including last published time and queue status
   */
  ipcMain.handle('online:profile:publish-status', async (event) => {
    try {
      const keyguardKey = getKeyguardKey(event);
      const profileManager = new OnlineProfileManager(dbManager, keyguardKey);
      
      const profile = profileManager.getCurrentProfile();
      if (!profile) {
        return { success: true, status: null };
      }
      
      const profileUuid = profile.profileId || profile.uuid;
      if (!profileUuid) {
        return { success: true, status: null };
      }
      
      // Get queue summary for profile
      const nostrDb = new NostrLocalDBManager({ logger: console });
      await nostrDb.initialize();
      
      let queueStatus = null;
      let lastPublished = null;
      let eventId = null;
      
      try {
        const summary = nostrDb.getEventQueueSummary('user_profiles', profileUuid);
        if (summary && summary.attempts && summary.attempts.latest) {
          lastPublished = summary.attempts.latest.attemptAt;
          eventId = summary.attempts.latest.entries[0]?.eventId || null;
        }
        
        // Check queue status
        if (summary && summary.stages && summary.stages.length > 0) {
          const cacheOutStage = summary.stages.find(s => s.stage === 'cache_out');
          if (cacheOutStage && cacheOutStage.latest) {
            queueStatus = cacheOutStage.latest.statusLabel || null;
          }
        }
      } catch (error) {
        console.warn('[online:profile:publish-status] Failed to get queue summary:', error.message);
      } finally {
        nostrDb.closeAll();
      }
      
      return {
        success: true,
        status: {
          lastPublished,
          eventId,
          queueStatus
        }
      };
    } catch (error) {
      console.error('Error getting profile publish status:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Channel: online:ratings:list-for-publishing
   * Get list of user ratings with their publish status
   */
  ipcMain.handle('online:ratings:list-for-publishing', async (event) => {
    try {
      const clientdataDb = dbManager.getConnection('clientdata');
      const nostrDb = new NostrLocalDBManager({ logger: console });
      await nostrDb.initialize();
      
      // Get all user ratings
      const ratings = clientdataDb.prepare(`
        SELECT 
          uga.gameid,
          uga.user_difficulty_rating,
          uga.user_review_rating,
          uga.user_skill_rating,
          uga.status,
          uga.updated_at
        FROM user_game_annotations uga
        WHERE uga.user_difficulty_rating IS NOT NULL 
           OR uga.user_review_rating IS NOT NULL
           OR uga.user_skill_rating IS NOT NULL
        ORDER BY uga.updated_at DESC
      `).all();
      
      // Get game names from rhdata
      const rhdataDb = dbManager.getConnection('rhdata');
      const ratingsWithNames = ratings.map(rating => {
        const game = rhdataDb.prepare(`
          SELECT name FROM gameversions 
          WHERE gameid = ? AND version = (
            SELECT MAX(version) FROM gameversions WHERE gameid = ?
          )
        `).get(rating.gameid, rating.gameid);
        
        let queueStatus = null;
        let lastPublished = null;
        let eventId = null;
        
        try {
          const summary = nostrDb.getEventQueueSummary('user_game_annotations', rating.gameid);
          if (summary && summary.attempts && summary.attempts.latest) {
            lastPublished = summary.attempts.latest.attemptAt;
            eventId = summary.attempts.latest.entries[0]?.eventId || null;
          }
          
          if (summary && summary.stages && summary.stages.length > 0) {
            const cacheOutStage = summary.stages.find(s => s.stage === 'cache_out');
            if (cacheOutStage && cacheOutStage.latest) {
              queueStatus = cacheOutStage.latest.statusLabel || null;
            }
          }
        } catch (error) {
          // Ignore errors for individual ratings
        }
        
        return {
          gameid: rating.gameid,
          gameName: game?.name || null,
          user_difficulty_rating: rating.user_difficulty_rating,
          user_review_rating: rating.user_review_rating,
          user_skill_rating: rating.user_skill_rating,
          status: rating.status,
          lastPublished,
          queueStatus,
          eventId
        };
      });
      
      nostrDb.closeAll();
      
      return { success: true, ratings: ratingsWithNames };
    } catch (error) {
      console.error('Error listing ratings for publishing:', error);
      return { success: false, error: error.message };
    }
  });
  /**
   * Channel: online:ratings:publish-batch
   * Publish multiple ratings in batch
   */
  ipcMain.handle('online:ratings:publish-batch', async (event, { gameIds } = {}) => {
    try {
      if (!gameIds || !Array.isArray(gameIds) || gameIds.length === 0) {
        return { success: false, error: 'gameIds array is required' };
      }
      
      const keyguardKey = getKeyguardKey(event);
      if (!keyguardKey) {
        return { success: false, error: 'Profile Guard not unlocked' };
      }
      
      const profileManager = new OnlineProfileManager(dbManager, keyguardKey);
      const currentProfileId = profileManager.getCurrentProfileId();
      if (!currentProfileId) {
        return { success: false, error: 'No current profile found' };
      }
      
      const clientdataDb = dbManager.getConnection('clientdata');
      const rhdataDb = dbManager.getConnection('rhdata');
      
      const results = [];
      let successCount = 0;
      let errorCount = 0;
      
      for (const gameId of gameIds) {
        try {
          // Get rating data
          const rating = clientdataDb.prepare(`
            SELECT * FROM user_game_annotations WHERE gameid = ?
          `).get(gameId);
          
          if (!rating) {
            results.push({ gameId, success: false, error: 'Rating not found' });
            errorCount++;
            continue;
          }
          
          // Get game info
          const game = rhdataDb.prepare(`
            SELECT name, gvuuid, version FROM gameversions 
            WHERE gameid = ? AND version = (
              SELECT MAX(version) FROM gameversions WHERE gameid = ?
            )
          `).get(gameId, gameId);
          
          // Prepare rating data
          const ratingData = {
            gameId,
            gameName: game?.name || '',
            gvUuid: game?.gvuuid || null,
            version: game?.version || 1,
            status: rating.status || 'Default',
            ratings: {
              user_difficulty_rating: rating.user_difficulty_rating ?? null,
              user_review_rating: rating.user_review_rating ?? null,
              user_skill_rating: rating.user_skill_rating ?? null,
              user_skill_rating_when_beat: rating.user_skill_rating_when_beat ?? null,
              user_recommendation_rating: rating.user_recommendation_rating ?? null,
              user_importance_rating: rating.user_importance_rating ?? null,
              user_technical_quality_rating: rating.user_technical_quality_rating ?? null,
              user_gameplay_design_rating: rating.user_gameplay_design_rating ?? null,
              user_fairness_rating: rating.user_fairness_rating ?? null,
              user_challenge_quality_rating: rating.user_challenge_quality_rating ?? null,
              user_originality_rating: rating.user_originality_rating ?? null,
              user_visual_aesthetics_rating: rating.user_visual_aesthetics_rating ?? null,
              user_story_rating: rating.user_story_rating ?? null,
              user_soundtrack_graphics_rating: rating.user_soundtrack_graphics_rating ?? null
            },
            comments: {
              user_difficulty_comment: rating.user_difficulty_comment || null,
              user_skill_comment: rating.user_skill_comment || null,
              user_skill_comment_when_beat: rating.user_skill_comment_when_beat || null,
              user_review_comment: rating.user_review_comment || null,
              user_recommendation_comment: rating.user_recommendation_comment || null,
              user_importance_comment: rating.user_importance_comment || null,
              user_technical_quality_comment: rating.user_technical_quality_comment || null,
              user_gameplay_design_comment: rating.user_gameplay_design_comment || null,
              user_fairness_comment: rating.user_fairness_comment || null,
              user_challenge_quality_comment: rating.user_challenge_quality_comment || null,
              user_originality_comment: rating.user_originality_comment || null,
              user_visual_aesthetics_comment: rating.user_visual_aesthetics_comment || null,
              user_story_comment: rating.user_story_comment || null,
              user_soundtrack_graphics_comment: rating.user_soundtrack_graphics_comment || null
            },
            user_notes: rating.user_notes || null
          };
          
          // Publish rating
          const result = await profileManager.publishRatingsToNostr(currentProfileId, ratingData);
          
          if (result.success) {
            results.push({ gameId, success: true, eventId: result.eventId });
            successCount++;
          } else {
            results.push({ gameId, success: false, error: result.error });
            errorCount++;
          }
        } catch (error) {
          results.push({ gameId, success: false, error: error.message });
          errorCount++;
        }
      }
      
      return {
        success: true,
        results,
        summary: {
          total: gameIds.length,
          success: successCount,
          errors: errorCount
        }
      };
    } catch (error) {
      console.error('Error publishing ratings batch:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Channel: online:publish-history:get
   * Returns recent publish attempts grouped by attempt_batch_id; optional scope by table_name and record_uuid
   * Payload: { tableName?: string, recordUuid?: string, limit?: number }
   */
  ipcMain.handle('online:publish-history:get', async (_event, { tableName, recordUuid, limit } = {}) => {
    try {
      const manager = new NostrLocalDBManager({ logger: console });
      await manager.initialize();
      let history;
      if (tableName && recordUuid) {
        history = manager.getPublishAttempts(tableName, recordUuid, Math.max(1, Number(limit) || 20));
      } else {
        // Global: fetch latest batches across all records
        const db = manager.getConnection('cache_out');
        const batches = db.prepare(`
          SELECT attempt_batch_id, MAX(attempt_at) AS attempt_at
          FROM nostr_publish_attempts
          GROUP BY attempt_batch_id
          ORDER BY attempt_at DESC
          LIMIT ?
        `).all(Math.max(1, Number(limit) || 50));
        if (batches.length === 0) {
          history = [];
        } else {
          const ids = batches.map(b => b.attempt_batch_id);
          const placeholders = ids.map(() => '?').join(',');
          const rows = db.prepare(`
            SELECT attempt_batch_id, event_id, table_name, record_uuid, relay_url, success, message, attempt_at
            FROM nostr_publish_attempts
            WHERE attempt_batch_id IN (${placeholders})
            ORDER BY attempt_at DESC
          `).all(...ids);
          const toIso = (v) => {
            const n = Number(v); if (!Number.isFinite(n)) return null; const ms = n > 1e12 ? n : n * 1000; try { return new Date(ms).toISOString(); } catch { return null; }
          };
          history = batches.map(b => {
            const entries = rows.filter(r => r.attempt_batch_id === b.attempt_batch_id).map(r => ({
              tableName: r.table_name,
              recordUuid: r.record_uuid,
              eventId: r.event_id,
              relayUrl: r.relay_url || null,
              success: r.success === 1,
              message: r.message || null,
              attemptAt: r.attempt_at,
              attemptAtIso: toIso(r.attempt_at)
            }));
            const successes = entries.filter(e => e.success);
            const failures = entries.filter(e => !e.success);
            return {
              batchId: b.attempt_batch_id,
              attemptAt: b.attempt_at,
              attemptAtIso: toIso(b.attempt_at),
              entries,
              successCount: successes.length,
              failureCount: failures.length
            };
          });
        }
      }
      manager.closeAll();
      return { success: true, history };
    } catch (error) {
      console.error('Error getting publish history:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Channel: online:queue:clear-completed
   * Removes completed events from store_out (and optionally cache_out) for housekeeping
   * Payload: { stages?: ('store_out'|'cache_out')[], olderThanSeconds?: number }
   */
  ipcMain.handle('online:queue:clear-completed', async (_event, { stages, olderThanSeconds } = {}) => {
    try {
      const manager = new NostrLocalDBManager({ logger: console });
      await manager.initialize();
      const targetStages = Array.isArray(stages) && stages.length ? stages : ['store_out'];
      const cutoff = Number(olderThanSeconds);
      let total = 0;
      for (const stage of targetStages) {
        const db = manager.getConnection(stage);
        if (!db) continue;
        const whereAge = Number.isFinite(cutoff) && cutoff > 0 ? `AND proc_at IS NOT NULL AND proc_at < (strftime('%s','now') - ${cutoff})` : '';
        const res = db.prepare(`
          DELETE FROM nostr_raw_events
          WHERE proc_status = 2 /* completed */
          ${whereAge}
        `).run();
        total += res.changes || 0;
      }
      manager.closeAll();
      return { success: true, removed: total };
    } catch (error) {
      console.error('Error clearing completed queue:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('ratings:summaries:get', (_event, { gameId } = {}) => {
    if (!gameId) {
      return { success: false, error: 'gameId is required' };
    }

    try {
      const ratingsDb = dbManager.getConnection('ratings');
      const events = ratingsDb
        .prepare('SELECT rating_json, trust_tier FROM rating_events WHERE gameid = ?')
        .all(gameId);
      const updatedRow = ratingsDb
        .prepare('SELECT MAX(updated_at) AS updated_at FROM rating_summaries WHERE gameid = ?')
        .get(gameId);

      if (!events || events.length === 0) {
        return {
          success: true,
          gameId,
          updatedAt: updatedRow?.updated_at || null,
          totals: {
            totalEvents: 0,
            byTier: [],
            tierLabels: RATING_TIER_LABELS
          },
          categories: []
        };
      }

      const baseTiers = Array.isArray(TrustManager.TRUST_TIERS) ? TrustManager.TRUST_TIERS : ['restricted', 'unverified', 'verified', 'trusted'];
      const tierOrder = Array.from(new Set([...RATING_TIER_ORDER, ...baseTiers]));

      const countsByTier = tierOrder.reduce((acc, tier) => {
        if (tier !== 'all') {
          acc[tier] = 0;
        }
        return acc;
      }, {});

      const metricsByCategory = new Map();
      RATING_FIELD_METADATA.forEach((meta) => {
        const perTier = new Map();
        tierOrder.forEach((tier) => perTier.set(tier, []));
        metricsByCategory.set(meta.field, { meta, perTier });
      });

      events.forEach((row) => {
        let tier = (row.trust_tier || 'unverified').toLowerCase();
        if (!tierOrder.includes(tier)) {
          tier = 'unverified';
        }
        if (tier !== 'all') {
          countsByTier[tier] = (countsByTier[tier] || 0) + 1;
        }

        let payload = null;
        try {
          payload = row.rating_json ? JSON.parse(row.rating_json) : {};
        } catch (error) {
          console.warn('[ratings:summaries:get] Failed to parse rating_json:', error.message);
          payload = {};
        }

        metricsByCategory.forEach(({ perTier }, fieldKey) => {
          const candidate = payload ? payload[fieldKey] : null;
          const value = isFiniteNumber(candidate);
          if (value !== null) {
            perTier.get(tier).push(value);
            perTier.get('all').push(value);
          }
        });
      });

      const categories = [];
      const totalEvents = Object.values(countsByTier).reduce((sum, value) => sum + value, 0);

      metricsByCategory.forEach(({ meta, perTier }) => {
        const categoryEntry = {
          field: meta.field,
          label: meta.label,
          tiers: []
        };

        let hasData = false;
        tierOrder.forEach((tierKey) => {
          const values = perTier.get(tierKey) || [];
          const stats = computeRatingStats(values);
          if (stats.count > 0 || tierKey === 'all') {
            hasData = hasData || stats.count > 0;
            categoryEntry.tiers.push({
              key: tierKey,
              label: RATING_TIER_LABELS[tierKey] || tierKey,
              count: stats.count,
              average: stats.average,
              median: stats.median,
              stddev: stats.stddev
            });
          }
        });

        if (hasData) {
          categories.push(categoryEntry);
        }
      });

      const totalsByTier = tierOrder
        .filter((tierKey) => tierKey !== 'all')
        .map((tierKey) => ({
          key: tierKey,
          label: RATING_TIER_LABELS[tierKey] || tierKey,
          count: countsByTier[tierKey] || 0
        }));

      return {
        success: true,
        gameId,
        updatedAt: updatedRow?.updated_at || null,
        totals: {
          totalEvents,
          byTier: totalsByTier,
          tierLabels: RATING_TIER_LABELS
        },
        categories
      };
    } catch (error) {
      console.error('[ratings:summaries:get] Failed:', error);
      return { success: false, error: error.message };
    }
  });

  // ===========================================================================
  // PREDICTION MANAGEMENT STATE PERSISTENCE
  // ===========================================================================

  /**
   * Save prediction management state for a run
   * Channel: db:runs:save-prediction-state
   */
  ipcMain.handle('db:runs:save-prediction-state', async (event, { runUuid, enabled, operationalMode, activePredictionUuid }) => {
    try {
      const db = dbManager.getConnection('clientdata');
      
      // Get current config_json or initialize it
      const run = db.prepare('SELECT config_json FROM runs WHERE run_uuid = ?').get(runUuid);
      if (!run) {
        return { success: false, error: 'Run not found' };
      }
      
      let configJson = {};
      if (run.config_json) {
        try {
          configJson = JSON.parse(run.config_json);
        } catch (e) {
          console.warn('[save-prediction-state] Failed to parse existing config_json, initializing new:', e);
          configJson = {};
        }
      }
      
      // Update prediction management state
      configJson.predictionManagement = {
        enabled: enabled || false,
        operationalMode: operationalMode || null,
        activePredictionUuid: activePredictionUuid || null,
        updatedAt: Date.now()
      };
      
      // Save updated config_json
      db.prepare(`
        UPDATE runs
        SET config_json = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE run_uuid = ?
      `).run(JSON.stringify(configJson), runUuid);
      
      return { success: true };
    } catch (error) {
      console.error('[save-prediction-state] Error:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Load prediction management state for a run
   * Channel: db:runs:load-prediction-state
   */
  ipcMain.handle('db:runs:load-prediction-state', async (event, { runUuid }) => {
    try {
      const db = dbManager.getConnection('clientdata');
      
      const run = db.prepare('SELECT config_json FROM runs WHERE run_uuid = ?').get(runUuid);
      if (!run) {
        return { success: false, error: 'Run not found' };
      }
      
      if (!run.config_json) {
        return { success: true, state: null };
      }
      
      let configJson = {};
      try {
        configJson = JSON.parse(run.config_json);
      } catch (e) {
        console.warn('[load-prediction-state] Failed to parse config_json:', e);
        return { success: true, state: null };
      }
      
      const predictionState = configJson.predictionManagement || null;
      
      return { success: true, state: predictionState };
    } catch (error) {
      console.error('[load-prediction-state] Error:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Update run config_json field
   * Channel: db:runs:update-config
   */
  ipcMain.handle('db:runs:update-config', async (event, { runUuid, configJson }) => {
    try {
      const db = dbManager.getConnection('clientdata');
      
      // Validate run exists
      const run = db.prepare('SELECT run_uuid FROM runs WHERE run_uuid = ?').get(runUuid);
      if (!run) {
        return { success: false, error: 'Run not found' };
      }
      
      // Validate configJson is a string (should be JSON stringified)
      if (typeof configJson !== 'string') {
        return { success: false, error: 'configJson must be a JSON string' };
      }
      
      // Validate it's valid JSON
      try {
        JSON.parse(configJson);
      } catch (e) {
        return { success: false, error: 'configJson is not valid JSON: ' + e.message };
      }
      
      // Update config_json
      db.prepare(`
        UPDATE runs
        SET config_json = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE run_uuid = ?
      `).run(configJson, runUuid);
      
      return { success: true };
    } catch (error) {
      console.error('[update-config] Error:', error);
      return { success: false, error: error.message };
    }
  });

  // ===========================================================================
  // TWITCH INTEGRATION HANDLERS
  // ===========================================================================

  /**
   * Get Twitch client ID
   * Channel: get_twitch_client_id
   */
  ipcMain.handle('get_twitch_client_id', async () => {
    try {
      const clientId = getTwitchClientId();
      return clientId;
    } catch (error) {
      console.error('[get_twitch_client_id] Error:', error);
      return null;
    }
  });

  /**
   * Get Twitch integration status
   * Channel: get_twitch_integration_status
   */
  ipcMain.handle('get_twitch_integration_status', async (event, params = {}) => {
    try {
      // Get keyguard key for OnlineProfileManager
      const keyguardKey = getKeyguardKey(event);
      const profileManager = new OnlineProfileManager(dbManager, keyguardKey);
      const currentProfileId = profileManager.getCurrentProfileId();
      
      if (!currentProfileId) {
        return null;
      }
      
      const db = dbManager.getConnection('clientdata');
      
      const integration = db.prepare(`
        SELECT 
          integration_uuid,
          twitch_user_id,
          twitch_username,
          scopes,
          is_active,
          expires_in,
          obtainment_timestamp,
          last_validated_at,
          created_at,
          updated_at,
          last_used_at
        FROM twitch_integration
        WHERE profile_uuid = ?
      `).get(currentProfileId);
      
      if (!integration) {
        return null;
      }
      
      return {
        twitch_user_id: integration.twitch_user_id,
        twitch_username: integration.twitch_username,
        scopes: integration.scopes,
        is_active: Boolean(integration.is_active),
        expires_in: integration.expires_in || 0,
        obtainment_timestamp: integration.obtainment_timestamp || 0,
        last_validated_at: integration.last_validated_at || 0
      };
    } catch (error) {
      console.error('[get_twitch_integration_status] Error:', error);
      return null;
    }
  });

  /**
   * Validate Twitch token and check if re-authentication is needed
   * Channel: validate_twitch_token
   */
  ipcMain.handle('validate_twitch_token', async (event, params = {}) => {
    try {
      const keyguardKey = getKeyguardKey(event);
      if (!keyguardKey) {
        return { valid: false, needsReauth: true, reason: 'Profile Guard not unlocked' };
      }
      
      const profileManager = new OnlineProfileManager(dbManager, keyguardKey);
      const currentProfileId = profileManager.getCurrentProfileId();
      
      if (!currentProfileId) {
        return { valid: false, needsReauth: false, reason: 'No active profile' };
      }
      
      const db = dbManager.getConnection('clientdata');
      const integration = db.prepare(`
        SELECT 
          encrypted_access_token,
          expires_in,
          obtainment_timestamp,
          last_validated_at,
          is_active
        FROM twitch_integration
        WHERE profile_uuid = ? AND is_active = 1
      `).get(currentProfileId);
      
      if (!integration) {
        return { valid: false, needsReauth: false, reason: 'No Twitch integration found' };
      }
      
      const now = Date.now();
      const lastValidated = integration.last_validated_at || 0;
      const obtainmentTime = integration.obtainment_timestamp || 0;
      const expiresIn = integration.expires_in || 0;
      
      // Check if token has expired based on expiration time
      let tokenExpired = false;
      if (expiresIn > 0 && obtainmentTime > 0) {
        const expirationTime = obtainmentTime + (expiresIn * 1000);
        tokenExpired = now >= expirationTime;
      }
      
      // Check if validation is needed:
      // 1. Never validated this session (last_validated_at is 0 or very old)
      // 2. Not validated within past 24 hours
      // 3. Token has expired
      const twentyFourHoursAgo = now - (24 * 60 * 60 * 1000);
      const needsValidation = lastValidated === 0 || lastValidated < twentyFourHoursAgo || tokenExpired;
      
      if (!needsValidation) {
        // Token is still valid, no need to check with Twitch
        return { 
          valid: true, 
          needsReauth: false,
          lastValidated: lastValidated,
          expiresAt: expiresIn > 0 && obtainmentTime > 0 ? obtainmentTime + (expiresIn * 1000) : null
        };
      }
      
      // Need to validate with Twitch API
      try {
        const accessToken = decryptTwitchToken(integration.encrypted_access_token, keyguardKey);
        
        // Validate token with Twitch API
        const https = require('https');
        const validateUrl = 'https://id.twitch.tv/oauth2/validate';
        
        const validateResponse = await new Promise((resolve, reject) => {
          const req = https.request(validateUrl, {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${accessToken.trim()}`
            }
          }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
              if (res.statusCode === 200) {
                try {
                  resolve(JSON.parse(data));
                } catch (e) {
                  reject(new Error('Failed to parse validation response'));
                }
              } else {
                reject(new Error(`Token validation failed: ${res.statusCode}`));
              }
            });
          });
          
          req.on('error', reject);
          req.end();
        });
        
        // Token is valid - update last_validated_at
        db.prepare(`
          UPDATE twitch_integration
          SET last_validated_at = ?, last_used_at = CURRENT_TIMESTAMP
          WHERE profile_uuid = ?
        `).run(now, currentProfileId);
        
        return { 
          valid: true, 
          needsReauth: false,
          lastValidated: now,
          expiresAt: expiresIn > 0 && obtainmentTime > 0 ? obtainmentTime + (expiresIn * 1000) : null
        };
        
      } catch (error) {
        // Token validation failed - needs re-authentication
        console.error('[validate_twitch_token] Token validation failed:', error);
        
        // Mark integration as needing re-auth (but don't delete it)
        db.prepare(`
          UPDATE twitch_integration
          SET is_active = 0, last_used_at = CURRENT_TIMESTAMP
          WHERE profile_uuid = ?
        `).run(currentProfileId);
        
        return { 
          valid: false, 
          needsReauth: true, 
          reason: error.message || 'Token validation failed',
          lastValidated: lastValidated
        };
      }
      
    } catch (error) {
      console.error('[validate_twitch_token] Error:', error);
      return { valid: false, needsReauth: true, reason: error.message || 'Unknown error' };
    }
  });

  /**
   * Open Twitch OAuth window and handle callback
   * Channel: open_twitch_oauth_window
   */
  ipcMain.handle('open_twitch_oauth_window', async (event, { url, redirectUri, state }) => {
    return new Promise((resolve, reject) => {
      try {
        // Get current profile using OnlineProfileManager
        const keyguardKey = getKeyguardKey(event);
        const profileManager = new OnlineProfileManager(dbManager, keyguardKey);
        const currentProfileId = profileManager.getCurrentProfileId();
        
        if (!currentProfileId) {
          reject(new Error('No active profile found'));
          return;
        }
        
        const clientId = getTwitchClientId();
        if (!clientId) {
          reject(new Error('Twitch client ID not configured'));
          return;
        }
        
        // Create OAuth window
        const oauthWindow = new BrowserWindow({
          width: 500,
          height: 650,
          show: false,
          modal: true,
          parent: BrowserWindow.getFocusedWindow() || undefined,
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            webSecurity: true // Keep web security enabled
          }
        });
        
        let callbackHandled = false; // Prevent multiple callback handling
        let windowClosed = false; // Track if window was closed
        
        // Prevent navigation to redirect URI (we'll handle it manually)
        // This must be set BEFORE loadURL
        oauthWindow.webContents.on('will-navigate', (navEvent, navigationUrl) => {
          console.log('[Twitch OAuth] will-navigate:', navigationUrl);
          if (navigationUrl.startsWith(redirectUri)) {
            navEvent.preventDefault(); // Prevent actual navigation to localhost
            if (!callbackHandled && !windowClosed) {
              callbackHandled = true;
              console.log('[Twitch OAuth] Handling callback from will-navigate');
              handleOAuthCallback(navigationUrl, redirectUri, state, currentProfileId, oauthWindow, resolve, reject, event);
            }
          }
        });
        
        // Also prevent new window navigation to redirect URI
        oauthWindow.webContents.setWindowOpenHandler(({ url }) => {
          console.log('[Twitch OAuth] setWindowOpenHandler:', url);
          if (url.startsWith(redirectUri)) {
            if (!callbackHandled && !windowClosed) {
              callbackHandled = true;
              console.log('[Twitch OAuth] Handling callback from setWindowOpenHandler');
              handleOAuthCallback(url, redirectUri, state, currentProfileId, oauthWindow, resolve, reject, event);
            }
            return { action: 'deny' }; // Prevent opening new window
          }
          return { action: 'allow' };
        });
        
        // Listen for in-page navigation (for fragment-based redirects in implicit grant flow)
        // The fragment (#access_token=...) doesn't trigger did-navigate, so we need did-navigate-in-page
        // This is the primary handler for implicit grant flow
        oauthWindow.webContents.on('did-navigate-in-page', (navEvent, navigationUrl, isMainFrame) => {
          console.log('[Twitch OAuth] did-navigate-in-page:', navigationUrl, 'isMainFrame:', isMainFrame);
          if (isMainFrame && navigationUrl.startsWith(redirectUri) && !callbackHandled && !windowClosed) {
            callbackHandled = true;
            console.log('[Twitch OAuth] Handling callback from did-navigate-in-page');
            handleOAuthCallback(navigationUrl, redirectUri, state, currentProfileId, oauthWindow, resolve, reject, event);
          }
        });
        
        // Fallback: Listen for navigation (for redirect-based flows, though implicit grant uses fragments)
        oauthWindow.webContents.on('did-navigate', (navEvent, navigationUrl) => {
          console.log('[Twitch OAuth] did-navigate:', navigationUrl);
          if (navigationUrl.startsWith(redirectUri) && !callbackHandled && !windowClosed) {
            callbackHandled = true;
            console.log('[Twitch OAuth] Handling callback from did-navigate');
            handleOAuthCallback(navigationUrl, redirectUri, state, currentProfileId, oauthWindow, resolve, reject, event);
          }
        });
        
        // Monitor URL changes (for debugging and as additional fallback)
        oauthWindow.webContents.on('dom-ready', () => {
          const currentUrl = oauthWindow.webContents.getURL();
          console.log('[Twitch OAuth] dom-ready, current URL:', currentUrl);
          if (currentUrl.startsWith(redirectUri) && !callbackHandled && !windowClosed) {
            callbackHandled = true;
            console.log('[Twitch OAuth] Handling callback from dom-ready');
            handleOAuthCallback(currentUrl, redirectUri, state, currentProfileId, oauthWindow, resolve, reject, event);
          }
        });
        
        // Periodic check for URL changes (fallback for fragment-based redirects)
        // Fragment changes might not always trigger navigation events
        const urlCheckInterval = setInterval(() => {
          if (callbackHandled || windowClosed || oauthWindow.isDestroyed()) {
            clearInterval(urlCheckInterval);
            return;
          }
          
          try {
            const currentUrl = oauthWindow.webContents.getURL();
            if (currentUrl && currentUrl.startsWith(redirectUri) && currentUrl.includes('#')) {
              console.log('[Twitch OAuth] Periodic check found redirect URL:', currentUrl);
              if (!callbackHandled && !windowClosed) {
                callbackHandled = true;
                clearInterval(urlCheckInterval);
                console.log('[Twitch OAuth] Handling callback from periodic check');
                handleOAuthCallback(currentUrl, redirectUri, state, currentProfileId, oauthWindow, resolve, reject, event);
              }
            }
          } catch (error) {
            // Window might be destroyed, ignore
            if (!oauthWindow.isDestroyed()) {
              console.error('[Twitch OAuth] Error in periodic URL check:', error);
            }
          }
        }, 500); // Check every 500ms
        
        // Clean up interval when window closes
        oauthWindow.on('closed', () => {
          clearInterval(urlCheckInterval);
        });
        
        oauthWindow.loadURL(url);
        oauthWindow.show();
        
        // Handle window close - only reject if callback wasn't handled
        oauthWindow.on('closed', () => {
          windowClosed = true;
          if (!callbackHandled) {
            console.log('[Twitch OAuth] Window closed before callback was handled');
            reject(new Error('OAuth window closed by user'));
          } else {
            console.log('[Twitch OAuth] Window closed after callback was handled (this is normal)');
          }
        });
        
      } catch (error) {
        console.error('[open_twitch_oauth_window] Error:', error);
        reject(error);
      }
    });
  });

  /**
   * Handle OAuth callback (helper function)
   */
  function handleOAuthCallback(navigationUrl, redirectUri, expectedState, profileUuid, oauthWindow, resolve, reject, event) {
    try {
      // Check if this is the redirect URI
      if (!navigationUrl.startsWith(redirectUri)) {
        return; // Not our redirect
      }
      
      const url = new URL(navigationUrl);
      
      console.log('[handleOAuthCallback] Full navigation URL:', navigationUrl);
      console.log('[handleOAuthCallback] URL hash:', url.hash);
      
      // Extract access token from fragment (implicit grant flow)
      const hash = url.hash.substring(1); // Remove leading #
      const params = new URLSearchParams(hash);
      
      const accessToken = params.get('access_token');
      const tokenType = params.get('token_type');
      const state = params.get('state');
      const error = params.get('error');
      const errorDescription = params.get('error_description');
      
      console.log('[handleOAuthCallback] Extracted params:', {
        hasAccessToken: !!accessToken,
        accessTokenLength: accessToken ? accessToken.length : 0,
        tokenType: tokenType,
        hasState: !!state,
        hasError: !!error
      });
      
      if (error) {
        if (oauthWindow && !oauthWindow.isDestroyed()) {
          oauthWindow.close();
        }
        reject(new Error(`OAuth error: ${error} - ${errorDescription || 'Unknown error'}`));
        return;
      }
      
      // Verify state
      if (state !== expectedState) {
        if (oauthWindow && !oauthWindow.isDestroyed()) {
          oauthWindow.close();
        }
        reject(new Error('OAuth state mismatch - possible CSRF attack'));
        return;
      }
      
      if (!accessToken) {
        console.log('[Twitch OAuth] No access token found in callback URL');
        return; // Still waiting for token
      }
      
      console.log('[Twitch OAuth] Access token received, tokenType:', tokenType, 'token length:', accessToken ? accessToken.length : 0);
      // NEVER log the actual token value - it's sensitive
      
      // Close OAuth window
      if (oauthWindow && !oauthWindow.isDestroyed()) {
        oauthWindow.close();
      }
      
      // Get keyguard key for encryption (event is passed from handleOAuthCallback)
      const keyguardKey = event ? getKeyguardKey(event) : null;
      if (!keyguardKey) {
        reject(new Error('Profile Guard must be unlocked to store Twitch tokens'));
        return;
      }
      
      // Validate token and get user info
      validateAndStoreTwitchToken(accessToken, tokenType, profileUuid, keyguardKey)
        .then(result => {
          resolve(result);
        })
        .catch(err => {
          reject(err);
        });
        
    } catch (error) {
      console.error('[handleOAuthCallback] Error:', error);
      if (oauthWindow && !oauthWindow.isDestroyed()) {
        oauthWindow.close();
      }
      reject(error);
    }
  }

  /**
   * Validate Twitch token and store encrypted
   * @param {string} accessToken - OAuth access token
   * @param {string} tokenType - Token type (usually "bearer")
   * @param {string} profileUuid - Profile UUID
   * @param {Buffer} keyguardKey - Profile guard key for encryption
   */
  async function validateAndStoreTwitchToken(accessToken, tokenType, profileUuid, keyguardKey) {
    try {
      // Validate token and get user info
      const https = require('https');
      const validateUrl = 'https://id.twitch.tv/oauth2/validate';
      
      // Twitch OAuth2 validate endpoint expects "Bearer <token>" format (OAuth2 standard)
      // According to Twitch API docs: https://dev.twitch.tv/docs/authentication/#validating-requests
      const authHeader = accessToken ? `Bearer ${accessToken.trim()}` : null;
      
      if (!authHeader) {
        throw new Error('Access token is missing');
      }
      
      console.log('[validateAndStoreTwitchToken] Validating token, header format: Bearer <token>');
      console.log('[validateAndStoreTwitchToken] Token length:', accessToken ? accessToken.length : 0);
      // NEVER log the actual token value - it's sensitive
      
      const validateResponse = await new Promise((resolve, reject) => {
        const req = https.request(validateUrl, {
          method: 'GET',
          headers: {
            'Authorization': authHeader
          }
        }, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            console.log('[validateAndStoreTwitchToken] Validation response status:', res.statusCode);
            console.log('[validateAndStoreTwitchToken] Validation response body:', data.substring(0, 200));
            
            if (res.statusCode === 200) {
              try {
                const parsed = JSON.parse(data);
                console.log('[validateAndStoreTwitchToken] Token validated successfully, user_id:', parsed.user_id);
                resolve(parsed);
              } catch (e) {
                console.error('[validateAndStoreTwitchToken] Failed to parse response:', e);
                reject(new Error('Failed to parse validation response'));
              }
            } else {
              console.error('[validateAndStoreTwitchToken] Validation failed with status:', res.statusCode, 'body:', data);
              reject(new Error(`Token validation failed: ${res.statusCode} - ${data.substring(0, 100)}`));
            }
          });
        });
        
        req.on('error', (error) => {
          console.error('[validateAndStoreTwitchToken] Request error:', error);
          reject(error);
        });
        req.end();
      });
      
      const { client_id, login: username, user_id, scopes, expires_in } = validateResponse;
      
      if (!keyguardKey) {
        throw new Error('Profile Guard key is required to encrypt tokens');
      }
      
      // Encrypt access token using AES-256-CBC with profile guard key
      const accessTokenData = Buffer.from(accessToken, 'utf8');
      const accessTokenIv = crypto.randomBytes(16);
      const accessTokenCipher = crypto.createCipheriv('aes-256-cbc', keyguardKey, accessTokenIv);
      let accessTokenEncrypted = accessTokenCipher.update(accessTokenData);
      accessTokenEncrypted = Buffer.concat([accessTokenEncrypted, accessTokenCipher.final()]);
      const encryptedAccessToken = accessTokenIv.toString('hex') + ':' + accessTokenEncrypted.toString('hex');
      
      // Encrypt refresh token (empty for implicit grant, but still encrypt the empty string for consistency)
      const refreshToken = ''; // Implicit grant doesn't provide refresh token
      const refreshTokenData = Buffer.from(refreshToken, 'utf8');
      const refreshTokenIv = crypto.randomBytes(16);
      const refreshTokenCipher = crypto.createCipheriv('aes-256-cbc', keyguardKey, refreshTokenIv);
      let refreshTokenEncrypted = refreshTokenCipher.update(refreshTokenData);
      refreshTokenEncrypted = Buffer.concat([refreshTokenEncrypted, refreshTokenCipher.final()]);
      const encryptedRefreshToken = refreshTokenIv.toString('hex') + ':' + refreshTokenEncrypted.toString('hex');
      
      const db = dbManager.getConnection('clientdata');
      
      // Store integration with encrypted tokens
      const integrationUuid = crypto.randomUUID();
      
      const now = Date.now();
      
      db.prepare(`
        INSERT INTO twitch_integration (
          integration_uuid,
          profile_uuid,
          twitch_user_id,
          twitch_username,
          encrypted_access_token,
          encrypted_refresh_token,
          expires_in,
          obtainment_timestamp,
          last_validated_at,
          scopes,
          is_active
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
        ON CONFLICT(profile_uuid) DO UPDATE SET
          twitch_user_id = excluded.twitch_user_id,
          twitch_username = excluded.twitch_username,
          encrypted_access_token = excluded.encrypted_access_token,
          encrypted_refresh_token = excluded.encrypted_refresh_token,
          expires_in = excluded.expires_in,
          obtainment_timestamp = excluded.obtainment_timestamp,
          last_validated_at = excluded.last_validated_at,
          scopes = excluded.scopes,
          is_active = 1,
          updated_at = CURRENT_TIMESTAMP,
          last_used_at = CURRENT_TIMESTAMP
      `).run(
        integrationUuid,
        profileUuid,
        user_id,
        username,
        encryptedAccessToken,
        encryptedRefreshToken,
        expires_in || 0,
        now,
        now, // Set last_validated_at to now when token is first obtained
        Array.isArray(scopes) ? scopes.join(' ') : (scopes || '')
      );
      
      return {
        success: true,
        twitch_username: username,
        twitch_user_id: user_id
      };
      
    } catch (error) {
      console.error('[validateAndStoreTwitchToken] Error:', error);
      throw error;
    }
  }

  /**
   * Revoke Twitch integration
   * Channel: revoke_twitch_integration
   */
  ipcMain.handle('revoke_twitch_integration', async (event, params = {}) => {
    const forceDisconnect = params.force === true;
    try {
      // Get current profile using OnlineProfileManager
      const keyguardKey = getKeyguardKey(event);
      const profileManager = new OnlineProfileManager(dbManager, keyguardKey);
      const currentProfileId = profileManager.getCurrentProfileId();
      
      if (!currentProfileId) {
        return { success: false, error: 'No active profile found' };
      }
      
      const db = dbManager.getConnection('clientdata');
      
      let tokenWasValid = false;
      let revokeError = null;
      
      // Attempt to revoke token if we have one (unless force disconnect)
      if (!forceDisconnect) {
        // Get integration to check if we have a token to revoke
        const integration = db.prepare(`
          SELECT encrypted_access_token, is_active
          FROM twitch_integration
          WHERE profile_uuid = ? AND is_active = 1
        `).get(currentProfileId);
        
        if (integration && integration.encrypted_access_token) {
          try {
            // Decrypt token
            const accessToken = decryptTwitchToken(integration.encrypted_access_token, keyguardKey);
            
            if (accessToken) {
              // Validate token first to check if it's still valid
              const https = require('https');
              const validateUrl = 'https://id.twitch.tv/oauth2/validate';
              
              try {
                const validateResponse = await new Promise((resolve, reject) => {
                  const req = https.request(validateUrl, {
                    method: 'GET',
                    headers: {
                      'Authorization': `Bearer ${accessToken.trim()}`
                    }
                  }, (res) => {
                    let data = '';
                    res.on('data', (chunk) => { data += chunk; });
                    res.on('end', () => {
                      resolve({ statusCode: res.statusCode, data: data });
                    });
                  });
                  req.on('error', reject);
                  req.setTimeout(10000, () => {
                    req.destroy();
                    reject(new Error('Request timeout'));
                  });
                  req.end();
                });
                
                if (validateResponse.statusCode === 200) {
                  tokenWasValid = true;
                  
                  // Token is valid, attempt revocation
                  const clientId = getTwitchClientId();
                  if (!clientId) {
                    revokeError = 'Twitch client ID not configured';
                  } else {
                    const revokeUrl = 'https://id.twitch.tv/oauth2/revoke';
                    const revokeParams = new URLSearchParams({
                      client_id: clientId,
                      token: accessToken.trim()
                    });
                    
                    try {
                      const revokeResponse = await new Promise((resolve, reject) => {
                        const req = https.request(revokeUrl, {
                          method: 'POST',
                          headers: {
                            'Content-Type': 'application/x-www-form-urlencoded',
                            'Content-Length': revokeParams.toString().length
                          }
                        }, (res) => {
                          let data = '';
                          res.on('data', (chunk) => { data += chunk; });
                          res.on('end', () => {
                            resolve({ statusCode: res.statusCode, data: data });
                          });
                        });
                        req.on('error', reject);
                        req.setTimeout(10000, () => {
                          req.destroy();
                          reject(new Error('Request timeout'));
                        });
                        req.write(revokeParams.toString());
                        req.end();
                      });
                      
                      // Twitch returns 200 on success, even if token was already revoked
                      if (revokeResponse.statusCode !== 200) {
                        revokeError = `Revocation failed with status ${revokeResponse.statusCode}`;
                      }
                    } catch (revokeErr) {
                      revokeError = revokeErr.message || 'Revocation request failed';
                    }
                  }
                } else {
                  // Token is invalid/expired - that's okay, we can still disconnect
                  tokenWasValid = false;
                }
              } catch (validateErr) {
                // Validation failed - token might be expired, that's okay
                tokenWasValid = false;
              }
            }
          } catch (decryptErr) {
            // Could not decrypt token - might be corrupted, that's okay
            console.warn('[revoke_twitch_integration] Could not decrypt token:', decryptErr.message);
          }
        }
      }
      
      // If revocation failed but token was valid, return error info
      // The frontend will prompt user to confirm disconnect anyway
      // Unless force disconnect is requested
      if (!forceDisconnect && tokenWasValid && revokeError) {
        return { 
          success: false, 
          error: 'Token revocation failed',
          revokeError: revokeError,
          tokenWasValid: true
        };
      }
      
      // Delete integration from database
      db.prepare(`
        DELETE FROM twitch_integration
        WHERE profile_uuid = ?
      `).run(currentProfileId);
      
      return { success: true };
    } catch (error) {
      console.error('[revoke_twitch_integration] Error:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Save prediction template configuration
   * Channel: save_predictions_template
   */
  ipcMain.handle('save_predictions_template', async (event, { template }) => {
    try {
      // Get current profile using OnlineProfileManager
      const keyguardKey = getKeyguardKey(event);
      const profileManager = new OnlineProfileManager(dbManager, keyguardKey);
      const currentProfileId = profileManager.getCurrentProfileId();
      
      if (!currentProfileId) {
        return { success: false, error: 'No active profile found' };
      }
      
      const db = dbManager.getConnection('clientdata');
      
      // Save template to csettings
      const uuid = crypto.randomUUID();
      db.prepare(`
        INSERT INTO csettings (csettinguid, csetting_name, csetting_value)
        VALUES (?, ?, ?)
        ON CONFLICT(csetting_name) DO UPDATE SET csetting_value = excluded.csetting_value
      `).run(uuid, 'predictionsTemplate', template);
      
      return { success: true };
    } catch (error) {
      console.error('[save_predictions_template] Error:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Get prediction template configuration
   * Channel: get_predictions_template
   */
  ipcMain.handle('get_predictions_template', async (event) => {
    try {
      // Get current profile using OnlineProfileManager
      const keyguardKey = getKeyguardKey(event);
      const profileManager = new OnlineProfileManager(dbManager, keyguardKey);
      const currentProfileId = profileManager.getCurrentProfileId();
      
      if (!currentProfileId) {
        return null;
      }
      
      const db = dbManager.getConnection('clientdata');
      
      const row = db.prepare(`
        SELECT csetting_value FROM csettings WHERE csetting_name = ?
      `).get('predictionsTemplate');
      
      if (!row || !row.csetting_value) {
        return null;
      }
      
      try {
        return JSON.parse(row.csetting_value);
      } catch (e) {
        console.error('[get_predictions_template] Failed to parse template JSON:', e);
        return null;
      }
    } catch (error) {
      console.error('[get_predictions_template] Error:', error);
      return null;
    }
  });

  /**
   * Decrypt Twitch token from database
   * @param {string} encryptedToken - Encrypted token (format: iv:encrypted)
   * @param {Buffer} keyguardKey - Profile guard key
   * @returns {string} Decrypted token
   */
  function decryptTwitchToken(encryptedToken, keyguardKey) {
    if (!encryptedToken || !keyguardKey) {
      throw new Error('Missing token or keyguard key');
    }
    
    const parts = encryptedToken.split(':');
    if (parts.length !== 2) {
      throw new Error('Invalid encrypted token format');
    }
    
    const iv = Buffer.from(parts[0], 'hex');
    const encrypted = Buffer.from(parts[1], 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', keyguardKey, iv);
    let decrypted = decipher.update(encrypted);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString('utf8');
  }

  /**
   * Get decrypted Twitch tokens for current profile
   * @param {Object} event - IPC event
   * @returns {Promise<{accessToken: string, refreshToken: string|null}>}
   */
  async function getDecryptedTwitchTokens(event) {
    const keyguardKey = getKeyguardKey(event);
    if (!keyguardKey) {
      throw new Error('Profile Guard must be unlocked to access Twitch tokens');
    }
    
    const profileManager = new OnlineProfileManager(dbManager, keyguardKey);
    const currentProfileId = profileManager.getCurrentProfileId();
    
    if (!currentProfileId) {
      throw new Error('No active profile found');
    }
    
    const db = dbManager.getConnection('clientdata');
    const integration = db.prepare(`
      SELECT encrypted_access_token, encrypted_refresh_token
      FROM twitch_integration
      WHERE profile_uuid = ? AND is_active = 1
    `).get(currentProfileId);
    
    if (!integration) {
      throw new Error('Twitch integration not found or not active');
    }
    
    const accessToken = decryptTwitchToken(integration.encrypted_access_token, keyguardKey);
    const refreshToken = integration.encrypted_refresh_token 
      ? decryptTwitchToken(integration.encrypted_refresh_token, keyguardKey)
      : null;
    
    return { accessToken, refreshToken };
  }

  /**
   * Create Twitch API client using @twurple/api
   * @param {string} accessToken - Decrypted access token
   * @param {string} clientId - Twitch client ID
   * @returns {Object} Twitch API client
   */
  function createTwitchApiClient(accessToken, clientId) {
    try {
      const { StaticAuthProvider } = require('@twurple/auth');
      const { ApiClient } = require('@twurple/api');
      
      // Create static auth provider with access token (implicit grant flow)
      // StaticAuthProvider is for tokens that don't refresh (like implicit grant)
      const authProvider = new StaticAuthProvider(clientId, accessToken);
      
      // Create and return API client
      return new ApiClient({ authProvider });
    } catch (error) {
      console.error('[createTwitchApiClient] Error creating API client:', error);
      throw new Error(`Failed to create Twitch API client: ${error.message}`);
    }
  }

  // Import range calculation functions from centralized module
  const {
    calculateWholeChallengeRanges,
    calculateTimeRangeOutcomes
  } = require('./utils/twitch-prediction-ranges');

  /**
   * Create a Twitch prediction
   * Channel: twitch:prediction:create
   */
  ipcMain.handle('twitch:prediction:create', async (event, { template, runUuid, challengeSequenceNumber, totalChallenges, username, gameId, stageId }) => {
    try {
      // Get decrypted tokens
      const { accessToken } = await getDecryptedTwitchTokens(event);
      
      // Get profile info
      const keyguardKey = getKeyguardKey(event);
      const profileManager = new OnlineProfileManager(dbManager, keyguardKey);
      const currentProfileId = profileManager.getCurrentProfileId();
      
      const db = dbManager.getConnection('clientdata');
      const integration = db.prepare(`
        SELECT twitch_user_id, twitch_username
        FROM twitch_integration
        WHERE profile_uuid = ? AND is_active = 1
      `).get(currentProfileId);
      
      if (!integration) {
        return { success: false, error: 'Twitch integration not found' };
      }
      
      // Parse template
      const templateConfig = typeof template === 'string' ? JSON.parse(template) : template;
      
      // Build prediction title with variable substitution
      let title = '';
      let outcomes = [];
      let windowSeconds = 0;
      
      if (templateConfig.type === 'whole_challenge') {
        const config = templateConfig.wholeChallenge;
        if (!config) {
          console.error('[twitch:prediction:create] Missing wholeChallenge config');
          return { success: false, error: 'Missing wholeChallenge configuration' };
        }
        const parsedWindow = parseInt(config.predictionWindowSeconds);
        windowSeconds = Math.max(1, (isNaN(parsedWindow) || parsedWindow <= 0) ? 600 : parsedWindow);
        console.log('[twitch:prediction:create] whole_challenge windowSeconds:', windowSeconds, 'from config:', config.predictionWindowSeconds);
        
        // Build title with game/stage info if provided
        let baseTitle = config.customTitle || 'How many wins?';
        /*if (gameId) {
          baseTitle += ` (Game: ${gameId}`;
          if (stageId) {
            baseTitle += `, Stage: ${stageId}`;
          }
          baseTitle += ')';
        }*/
        title = baseTitle.replace(/\$username/g, integration.twitch_username || username || 'Player');
        
        // Build outcomes
        const outcomeCount = config.outcomeCount || 5;
        if (outcomeCount === 2) {
          // Less/More than half
          const half = Math.floor(totalChallenges / 2);
          outcomes = [
            { title: `Less than ${half + 1}`, points: 0 },
            { title: `${half + 1} or More`, points: 0 }
          ];
        } else {
          // Range outcomes - calculate ranges from 0 to totalChallenges
          const ranges = calculateWholeChallengeRanges(totalChallenges, outcomeCount);
          outcomes = ranges.map(range => ({
            title: range.title,
            points: 0
          }));
        }
      } else if (templateConfig.type === 'individual_item') {
        const config = templateConfig.individualItem;
        
        if (config.predictionType === 'yes_no') {
          const yesNoConfig = config.yesNo;
          if (!yesNoConfig) {
            console.error('[twitch:prediction:create] Missing yesNo config');
            return { success: false, error: 'Missing yesNo configuration' };
          }
          const parsedWindow = parseInt(yesNoConfig.windowSeconds);
          windowSeconds = Math.max(1, (isNaN(parsedWindow) || parsedWindow <= 0) ? 30 : parsedWindow);
          console.log('[twitch:prediction:create] yes_no windowSeconds:', windowSeconds, 'from config:', yesNoConfig.windowSeconds);
          // Build title with game/stage info
          let baseTitle = yesNoConfig.customTitle || 'Do we win?';
          if (challengeSequenceNumber) {
            baseTitle = baseTitle.replace('current', `${challengeSequenceNumber}`);
          }
          if (gameId) { /* (Game: ${gameId} */
            baseTitle += ` (${gameId}`;
            if (stageId) {
              baseTitle += `, ${stageId}`;
            }
            baseTitle += ')';
          }
          title = baseTitle.replace(/\$username/g, integration.twitch_username || username || 'Player');
          outcomes = [
            { title: yesNoConfig.yesOutcomeName || 'Yes', points: 0 },
            { title: yesNoConfig.noOutcomeName || 'No', points: 0 }
          ];
        } else if (config.predictionType === 'time_range') {
          const timeRangeConfig = config.timeRange;
          if (!timeRangeConfig) {
            console.error('[twitch:prediction:create] Missing timeRange config');
            return { success: false, error: 'Missing timeRange configuration' };
          }
          const parsedWindow = parseInt(timeRangeConfig.windowSeconds);
          windowSeconds = Math.max(1, (isNaN(parsedWindow) || parsedWindow <= 0) ? 45 : parsedWindow);
          console.log('[twitch:prediction:create] time_range windowSeconds:', windowSeconds, 'from config:', timeRangeConfig.windowSeconds);
          // Build title with game/stage info
          let baseTitle = timeRangeConfig.customTitle || 'How many minutes?';
          if (challengeSequenceNumber) {
            baseTitle = baseTitle.replace('current', `challenge item ${challengeSequenceNumber}`);
          }
          if (gameId) { /* (Game: ${gameId} */
            baseTitle += ` (${gameId}`;
            if (stageId) {
              baseTitle += `, ${stageId}`;
            }
            baseTitle += ')';
          }
          title = baseTitle.replace(/\$username/g, integration.twitch_username || username || 'Player');
          
          // Get max time from config, or calculate from win rules if available
          let maxTimeMinutes = timeRangeConfig.maxTimeMinutes || 60;
          const useTemplateMax = timeRangeConfig.useTemplateMaxEvenIfWinRulesAllowLess || false;
          const lowTimeRangesOnlyOnSuccess = timeRangeConfig.lowTimeRangesOnlyOnSuccess !== false; // Default true
          
          // If runUuid is provided, try to get win rules to determine actual max time
          if (runUuid && !useTemplateMax) {
            try {
              const db = dbManager.getConnection('clientdata');
              const run = db.prepare(`
                SELECT win_rules_json FROM runs WHERE run_uuid = ?
              `).get(runUuid);
              
              if (run && run.win_rules_json) {
                const winRules = JSON.parse(run.win_rules_json);
                if (winRules.challengeTime && winRules.challengeTime.enabled) {
                  const limitMinutes = winRules.challengeTime.minutes || 10;
                  const limitSeconds = limitMinutes * 60;
                  const rolloverMaxMinutes = winRules.challengeTime.rolloverMaxMinutes || 0;
                  const rolloverMaxSeconds = rolloverMaxMinutes * 60;
                  
                  // Calculate grace period in seconds, then convert to minutes and round UP
                  const graceSeconds = Math.min(
                    Math.max(
                      Math.floor((limitSeconds * (winRules.challengeTime.gracePeriodPercent || 1)) / 100),
                      winRules.challengeTime.gracePeriodMinSeconds || 2
                    ),
                    winRules.challengeTime.gracePeriodMaxSeconds || 60
                  );
                  
                  // Get actual accumulated rollover at start of this challenge from database
                  let accumulatedRolloverMinutes = 0;
                  if (challengeSequenceNumber) {
                    // Get the rollover_time_remaining_start_ms for this challenge
                    const challengeResult = db.prepare(`
                      SELECT rollover_time_remaining_start_ms
                      FROM run_results
                      WHERE run_uuid = ? AND sequence_number = ?
                    `).get(runUuid, challengeSequenceNumber);
                    
                    if (challengeResult && challengeResult.rollover_time_remaining_start_ms !== null && challengeResult.rollover_time_remaining_start_ms !== undefined) {
                      // Convert from milliseconds to minutes, rounded UP
                      accumulatedRolloverMinutes = Math.ceil(challengeResult.rollover_time_remaining_start_ms / 60000);
                    } else {
                      // Challenge hasn't started yet - calculate rollover from previous challenges
                      // This can happen when creating prediction for "next_item" mode
                      if (challengeSequenceNumber > 1) {
                        const previousResults = db.prepare(`
                          SELECT duration_seconds, status, sequence_number
                          FROM run_results
                          WHERE run_uuid = ? AND sequence_number < ?
                          ORDER BY sequence_number ASC
                        `).all(runUuid, challengeSequenceNumber);
                        
                        // Calculate rollover from each previous challenge
                        for (const result of previousResults) {
                          if (result.duration_seconds !== null && result.duration_seconds !== undefined) {
                            // If completed successfully and faster than limit, add rollover
                            if ((result.status === 'success' || result.status === 'ok') && result.duration_seconds < limitSeconds) {
                              const rolloverFromThis = limitSeconds - result.duration_seconds;
                              accumulatedRolloverMinutes += Math.ceil(rolloverFromThis / 60);
                            }
                            // Cap at maximum rollover allowed
                            const accumulatedRolloverSeconds = accumulatedRolloverMinutes * 60;
                            if (accumulatedRolloverSeconds > rolloverMaxSeconds) {
                              accumulatedRolloverMinutes = rolloverMaxMinutes;
                            }
                          }
                        }
                      }
                      // Also check for initial rollover from win rules
                      if (winRules.challengeTime.rolloverStartMinutes) {
                        accumulatedRolloverMinutes += winRules.challengeTime.rolloverStartMinutes;
                        if (accumulatedRolloverMinutes > rolloverMaxMinutes) {
                          accumulatedRolloverMinutes = rolloverMaxMinutes;
                        }
                      }
                    }
                  }
                  
                  // Max time = limit + actual accumulated rollover + grace, all rounded UP to nearest minute
                  const graceMinutes = Math.ceil(graceSeconds / 60);
                  const calculatedMax = limitMinutes + accumulatedRolloverMinutes + graceMinutes;
                  
                  if (calculatedMax > 0) {
                    // If win rule allows more than template max, win rule takes priority
                    if (calculatedMax > maxTimeMinutes) {
                      maxTimeMinutes = calculatedMax;
                    } else {
                      maxTimeMinutes = calculatedMax;
                    }
                  }
                  
                  console.log(`[twitch:prediction:create] time_range: limit=${limitMinutes}, rollover=${accumulatedRolloverMinutes}, grace=${graceMinutes}, max=${maxTimeMinutes}`);
                }
              }
            } catch (error) {
              console.error('[twitch:prediction:create] Error getting win rules for max time:', error);
              // Fall back to config value
            }
          }
          
          // Store the options in template config for later use during resolution
          if (!templateConfig.individualItem.timeRange) {
            templateConfig.individualItem.timeRange = {};
          }
          templateConfig.individualItem.timeRange.lowTimeRangesOnlyOnSuccess = lowTimeRangesOnlyOnSuccess;
          
          // Calculate time ranges
          const outcomeCount = timeRangeConfig.outcomeCount || 5;
          // Get prediction window and exclude setting from template
          const predictionWindowSeconds = config.windowSeconds || 45;
          const excludePredictionWindow = config.excludePredictionWindow !== false; // Default true
          const ranges = calculateTimeRangeOutcomes(maxTimeMinutes, outcomeCount, predictionWindowSeconds, excludePredictionWindow);
          outcomes = ranges.map(range => ({
            title: range.title,
            points: 0
          }));
        } else {
          // Unknown prediction type for individual_item
          console.error('[twitch:prediction:create] Unknown prediction type for individual_item:', config.predictionType);
          return { 
            success: false, 
            error: `Unknown prediction type for individual_item: ${config.predictionType}` 
          };
        }
      } else {
        // Unknown template type
        console.error('[twitch:prediction:create] Unknown template type:', templateConfig.type);
        return { 
          success: false, 
          error: `Unknown prediction template type: ${templateConfig.type}` 
        };
      }
      
      // Validate windowSeconds before creating prediction
      if (!windowSeconds || windowSeconds < 1 || isNaN(windowSeconds)) {
        console.error('[twitch:prediction:create] Invalid windowSeconds:', windowSeconds, 'Template type:', templateConfig.type, 'Template config:', JSON.stringify(templateConfig, null, 2));
        return { 
          success: false, 
          error: `Invalid prediction window: ${windowSeconds}. Must be at least 1 second. Template type: ${templateConfig.type}` 
        };
      }
      
      // Ensure windowSeconds is an integer
      windowSeconds = Math.floor(windowSeconds);
      
      // Double-check after floor
      if (windowSeconds < 1) {
        console.error('[twitch:prediction:create] windowSeconds < 1 after floor:', windowSeconds);
        return { 
          success: false, 
          error: `Invalid prediction window: ${windowSeconds}. Must be at least 1 second.` 
        };
      }
      
      // Validate that we have outcomes
      if (!outcomes || outcomes.length < 2) {
        console.error('[twitch:prediction:create] Invalid outcomes:', outcomes);
        return { 
          success: false, 
          error: `Invalid prediction: must have at least 2 outcomes, got ${outcomes?.length || 0}` 
        };
      }
      
      // Validate title
      if (!title || title.trim().length === 0) {
        console.error('[twitch:prediction:create] Invalid title:', title);
        return { 
          success: false, 
          error: 'Invalid prediction: title cannot be empty' 
        };
      }
      
      // Get client ID and create API client
      const clientId = getTwitchClientId();
      if (!clientId) {
        return { success: false, error: 'Twitch client ID not configured' };
      }
      
      const apiClient = createTwitchApiClient(accessToken, clientId);
      
      // Log the values being sent (for debugging)
      console.log('[twitch:prediction:create] Creating prediction with:', {
        title: title.trim(),
        outcomesCount: outcomes.length,
        predictionWindowSeconds: windowSeconds,
        windowSecondsType: typeof windowSeconds
      });
      
      // Create prediction using @twurple/api
      // Note: @twurple/api expects 'autoLockAfter' (not 'predictionWindowSeconds')
      // The library maps autoLockAfter to prediction_window in the API request
      // Also, outcomes should be string[] (array of titles), not objects
      const outcomeTitles = outcomes.map(outcome => {
        const titleStr = typeof outcome === 'string' ? outcome : outcome.title;
        if (!titleStr || titleStr.trim().length === 0) {
          throw new Error(`Invalid outcome title: ${JSON.stringify(outcome)}`);
        }
        return titleStr.trim();
      });
      
      const prediction = await apiClient.predictions.createPrediction(
        integration.twitch_user_id,
        {
          title: title.trim(),
          outcomes: outcomeTitles,
          autoLockAfter: windowSeconds
        }
      );
      
      // Store outcomes with their Twitch IDs
      const outcomesWithIds = prediction.outcomes.map((outcome, index) => ({
        id: outcome.id,
        title: outcome.title,
        color: outcome.color || null,
        users: outcome.users || 0,
        channelPoints: outcome.channelPoints || 0
      }));
      
      // Store in database
      const predictionUuid = crypto.randomUUID();
      // Use Twitch's creation timestamp if available, otherwise use current time
      // The Twitch API returns created_at as a Date object or timestamp
      // This is more accurate than our local time since it's when Twitch actually created it
      let now = Date.now();

      //uncomment this later to try using Twitch timestamps
      //if (prediction.createdAt) {
      //  // If createdAt is a Date object, convert to milliseconds
      //  now = prediction.createdAt instanceof Date ? prediction.createdAt.getTime() : prediction.createdAt;
      //} else if (prediction.created_at) {
      //  // Some APIs return created_at as a string or number
      //  now = typeof prediction.created_at === 'string' ? new Date(prediction.created_at).getTime() : prediction.created_at;
      // }
      // If neither exists, fall back to current time (shouldn't happen, but be safe)
      
      db.prepare(`
        INSERT INTO twitch_predictions (
          prediction_uuid, profile_uuid, twitch_prediction_id, twitch_broadcaster_id,
          prediction_type, prediction_subtype, template_config_json,
          title, outcomes_json, prediction_window_seconds,
          local_status, twitch_status, created_at_ms,
          run_uuid, challenge_sequence_number, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `).run(
        predictionUuid,
        currentProfileId,
        prediction.id,
        integration.twitch_user_id,
        templateConfig.type,
        templateConfig.individualItem?.predictionType || null,
        JSON.stringify(templateConfig),
        title,
        JSON.stringify(outcomesWithIds),
        windowSeconds,
        'created',
        prediction.status,
        now,
        runUuid || null,
        challengeSequenceNumber || null
      );
      
      return { 
        success: true, 
        predictionId: prediction.id, 
        predictionUuid: predictionUuid 
      };
    } catch (error) {
      console.error('[twitch:prediction:create] Error:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Check for active predictions on Twitch (managed or unmanaged)
   * Channel: twitch:prediction:check-active
   */
  ipcMain.handle('twitch:prediction:check-active', async (event) => {
    try {
      // Get decrypted tokens
      const { accessToken } = await getDecryptedTwitchTokens(event);
      
      // Get profile info
      const keyguardKey = getKeyguardKey(event);
      const profileManager = new OnlineProfileManager(dbManager, keyguardKey);
      const currentProfileId = profileManager.getCurrentProfileId();
      
      if (!currentProfileId) {
        return { success: false, error: 'No active profile found' };
      }
      
      const db = dbManager.getConnection('clientdata');
      const integration = db.prepare(`
        SELECT twitch_user_id, twitch_username
        FROM twitch_integration
        WHERE profile_uuid = ? AND is_active = 1
      `).get(currentProfileId);
      
      if (!integration) {
        return { success: false, error: 'Twitch integration not found' };
      }
      
      // Get client ID and create API client
      const clientId = getTwitchClientId();
      if (!clientId) {
        return { success: false, error: 'Twitch client ID not configured' };
      }
      
      const apiClient = createTwitchApiClient(accessToken, clientId);
      
      // Get list of predictions from Twitch API (returns most recent first)
      // Since Twitch only allows one active prediction at a time, the first result
      // will be the active one if it exists
      // @twurple/api structure: apiClient.predictions.getPredictions()
      const predictionsResult = await apiClient.predictions.getPredictions(integration.twitch_user_id);
      const allPredictions = predictionsResult.data; // Extract data array from paginated result
      
      // Find active predictions (ACTIVE or LOCKED status)
      const activeTwitchPredictions = allPredictions.filter(p => 
        p.status === 'ACTIVE' || p.status === 'LOCKED'
      );
      
      // Check our database for managed predictions
      const localPredictions = db.prepare(`
        SELECT 
          prediction_uuid,
          twitch_prediction_id,
          twitch_broadcaster_id,
          prediction_type,
          local_status,
          twitch_status,
          run_uuid,
          challenge_sequence_number
        FROM twitch_predictions
        WHERE profile_uuid = ?
          AND local_status IN ('created', 'locked')
        ORDER BY created_at_ms DESC
      `).all(currentProfileId);
      
      // Match Twitch predictions with our local records
      const verifiedPredictions = [];
      let hasUnmanagedPredictions = false;
      
      for (const twitchPred of activeTwitchPredictions) {
        // Find matching local prediction
        // @twurple/api HelixPrediction uses .id property
        const twitchPredId = twitchPred.id;
        const localMatch = localPredictions.find(lp => 
          lp.twitch_prediction_id === twitchPredId
        );
        
        if (localMatch) {
          // This is a managed prediction
          verifiedPredictions.push({
            prediction_uuid: localMatch.prediction_uuid,
            twitch_prediction_id: twitchPredId,
            twitch_broadcaster_id: localMatch.twitch_broadcaster_id,
            prediction_type: localMatch.prediction_type,
            local_status: localMatch.local_status,
            twitch_status: twitchPred.status,
            run_uuid: localMatch.run_uuid,
            challenge_sequence_number: localMatch.challenge_sequence_number,
            isManaged: true
          });
        } else {
          // This is an unmanaged prediction (created outside our system)
          hasUnmanagedPredictions = true;
          verifiedPredictions.push({
            prediction_uuid: null,
            twitch_prediction_id: twitchPredId,
            twitch_broadcaster_id: integration.twitch_user_id,
            prediction_type: null,
            local_status: null,
            twitch_status: twitchPred.status,
            run_uuid: null,
            challenge_sequence_number: null,
            isManaged: false,
            title: twitchPred.title
          });
        }
      }
      
      return {
        success: true,
        activePredictions: verifiedPredictions,
        hasActivePredictions: activeTwitchPredictions.length > 0,
        hasUnmanagedPredictions: hasUnmanagedPredictions
      };
    } catch (error) {
      console.error('[twitch:prediction:check-active] Error:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Get prediction status (local and Twitch)
   * Channel: twitch:prediction:get-status
   */
  ipcMain.handle('twitch:prediction:get-status', async (event, { predictionUuid }) => {
    try {
      const db = dbManager.getConnection('clientdata');
      const prediction = db.prepare(`
        SELECT * FROM twitch_predictions WHERE prediction_uuid = ?
      `).get(predictionUuid);
      
      if (!prediction) {
        return { success: false, error: 'Prediction not found' };
      }
      
      // Query Twitch API for current status
      const { accessToken } = await getDecryptedTwitchTokens(event);
      const clientId = getTwitchClientId();
      if (!clientId) {
        return { success: false, error: 'Twitch client ID not configured' };
      }
      
      const apiClient = createTwitchApiClient(accessToken, clientId);
      const twitchPrediction = await apiClient.predictions.getPredictionById(
        prediction.twitch_broadcaster_id,
        prediction.twitch_prediction_id
      );
      
      // Update local status if Twitch status changed
      if (twitchPrediction && twitchPrediction.status !== prediction.twitch_status) {
        let localStatus = prediction.local_status;
        if (twitchPrediction.status === 'LOCKED' && prediction.local_status === 'created') {
          localStatus = 'locked';
        } else if (twitchPrediction.status === 'RESOLVED' && prediction.local_status !== 'resolved') {
          localStatus = 'resolved';
        } else if (twitchPrediction.status === 'CANCELED' && prediction.local_status !== 'cancelled') {
          localStatus = 'cancelled';
        }
        
        const db = dbManager.getConnection('clientdata');
        db.prepare(`
          UPDATE twitch_predictions
          SET local_status = ?, twitch_status = ?, updated_at = CURRENT_TIMESTAMP
          WHERE prediction_uuid = ?
        `).run(localStatus, twitchPrediction.status, predictionUuid);
        
        prediction.local_status = localStatus;
        prediction.twitch_status = twitchPrediction.status;
      }
      
      return {
        success: true,
        localStatus: prediction.local_status,
        twitchStatus: twitchPrediction?.status || prediction.twitch_status,
        prediction: {
          uuid: prediction.prediction_uuid,
          twitchId: prediction.twitch_prediction_id,
          title: prediction.title,
          type: prediction.prediction_type,
          subtype: prediction.prediction_subtype,
          outcomes_json: prediction.outcomes_json, // Include outcomes for outcome resolution
          challenge_sequence_number: prediction.challenge_sequence_number, // Include sequence number for resolution
          created_at_ms: prediction.created_at_ms // Include creation timestamp for cancellation checks
        }
      };
    } catch (error) {
      console.error('[twitch:prediction:get-status] Error:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Lock a prediction (close it early)
   * Channel: twitch:prediction:lock
   */
  ipcMain.handle('twitch:prediction:lock', async (event, { predictionUuid }) => {
    try {
      const db = dbManager.getConnection('clientdata');
      const prediction = db.prepare(`
        SELECT twitch_prediction_id, twitch_broadcaster_id
        FROM twitch_predictions
        WHERE prediction_uuid = ?
      `).get(predictionUuid);
      
      if (!prediction) {
         console.log(`[twitch:prediction:lock] Prediction not found predictionUuid=${predictionUuid}`)
        return { success: false, error: 'Prediction not found' };
      }
      console.log(`[twitch:prediction:lock] predictionUuid=${predictionUuid}`)

      // Get decrypted tokens and create API client
      const { accessToken } = await getDecryptedTwitchTokens(event);
      const clientId = getTwitchClientId();
      if (!clientId) {
        return { success: false, error: 'Twitch client ID not configured' };
      }
      
      const apiClient = createTwitchApiClient(accessToken, clientId);
      
      // Lock prediction using @twurple/api
      await apiClient.predictions.lockPrediction(
        prediction.twitch_broadcaster_id,
        prediction.twitch_prediction_id
      );
      
      // Update database
      const now = Date.now();
      db.prepare(`
        UPDATE twitch_predictions
        SET local_status = 'locked',
            twitch_status = 'LOCKED',
            locked_at = datetime(?, 'unixepoch'),
            locked_at_ms = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE prediction_uuid = ?
      `).run(Math.floor(now / 1000), now, predictionUuid);
      
      return { success: true };
    } catch (error) {
      console.error('[twitch:prediction:lock] Error:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Resolve a prediction to an outcome
   * Channel: twitch:prediction:resolve
   */
  ipcMain.handle('twitch:prediction:resolve', async (event, { predictionUuid, winningOutcomeId, resolutionMethod = 'automatic' }) => {
    try {
      const db = dbManager.getConnection('clientdata');
      const prediction = db.prepare(`
        SELECT twitch_prediction_id, twitch_broadcaster_id, outcomes_json
        FROM twitch_predictions
        WHERE prediction_uuid = ?
      `).get(predictionUuid);

      console.log(`[twitch:prediction:resolve] prediction=${prediction} winningOutcomeId=${winningOutcomeId}`)
      if (!prediction) {
        return { success: false, error: 'Prediction not found' };
      }
      
      if (!winningOutcomeId) {
        return { success: false, error: 'winningOutcomeId is required' };
      }
      
      // Get decrypted tokens and create API client
      const { accessToken } = await getDecryptedTwitchTokens(event);
      const clientId = getTwitchClientId();
      if (!clientId) {
        return { success: false, error: 'Twitch client ID not configured' };
      }
      
      const apiClient = createTwitchApiClient(accessToken, clientId);
      
      // Resolve prediction using @twurple/api
      await apiClient.predictions.resolvePrediction(
        prediction.twitch_broadcaster_id,
        prediction.twitch_prediction_id,
        winningOutcomeId
      );
      
      // Update database
      const now = Date.now();
      db.prepare(`
        UPDATE twitch_predictions
        SET local_status = 'resolved',
            twitch_status = 'RESOLVED',
            winning_outcome_id = ?,
            resolution_method = ?,
            resolved_at = datetime(?, 'unixepoch'),
            resolved_at_ms = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE prediction_uuid = ?
      `).run(winningOutcomeId, resolutionMethod, Math.floor(now / 1000), now, predictionUuid);
      
      return { success: true };
    } catch (error) {
      console.error('[twitch:prediction:resolve] Error:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Cancel and refund a prediction
   * Channel: twitch:prediction:cancel
   */
  ipcMain.handle('twitch:prediction:cancel', async (event, { predictionUuid }) => {
    try {
      const db = dbManager.getConnection('clientdata');
      const prediction = db.prepare(`
        SELECT twitch_prediction_id, twitch_broadcaster_id
        FROM twitch_predictions
        WHERE prediction_uuid = ?
      `).get(predictionUuid);
      
      console.log(`[twitch:prediction:cancel] Prediction not found predictionUuid=${predictionUuid}`)
      if (!prediction) {
        console.log(`[twitch:prediction:cancel] Prediction not found predictionUuid=${predictionUuid}`)
        return { success: false, error: 'Prediction not found' };
      }
      
      // Get decrypted tokens and create API client
      const { accessToken } = await getDecryptedTwitchTokens(event);
      const clientId = getTwitchClientId();
      if (!clientId) {
        return { success: false, error: 'Twitch client ID not configured' };
      }
      
      const apiClient = createTwitchApiClient(accessToken, clientId);
      
      // Cancel prediction using @twurple/api (cancels and refunds)
      await apiClient.predictions.cancelPrediction(
        prediction.twitch_broadcaster_id,
        prediction.twitch_prediction_id
      );
      
      // Update database
      const now = Date.now();
      db.prepare(`
        UPDATE twitch_predictions
        SET local_status = 'cancelled',
            twitch_status = 'CANCELED',
            cancelled_at = datetime(?, 'unixepoch'),
            cancelled_at_ms = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE prediction_uuid = ?
      `).run(Math.floor(now / 1000), now, predictionUuid);
      
      return { success: true };
    } catch (error) {
      console.error('[twitch:prediction:cancel] Error:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Cancel a prediction by Twitch ID (for unmanaged predictions)
   * Channel: twitch:prediction:cancel-by-twitch-id
   */
  ipcMain.handle('twitch:prediction:cancel-by-twitch-id', async (event, { twitchPredictionId, twitchBroadcasterId }) => {
    try {
      console.log(`[twitch:prediction:cancel-by-twitch-id] twitchPredictionId=${twitchPredictionId} twitchBroadcasterId=${twitchBroadcasterId}`)
      if (!twitchPredictionId || !twitchBroadcasterId) {
        return { success: false, error: 'Twitch prediction ID and broadcaster ID are required' };
      }
      
      // Get decrypted tokens and create API client
      const { accessToken } = await getDecryptedTwitchTokens(event);
      const clientId = getTwitchClientId();
      if (!clientId) {
        return { success: false, error: 'Twitch client ID not configured' };
      }
      
      const apiClient = createTwitchApiClient(accessToken, clientId);
      
      // Cancel prediction using @twurple/api (cancels and refunds)
      await apiClient.predictions.cancelPrediction(
        twitchBroadcasterId,
        twitchPredictionId
      );
      
      return { success: true };
    } catch (error) {
      console.error('[twitch:prediction:cancel-by-twitch-id] Error:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Release a prediction (stop managing it, let user manage)
   * Channel: twitch:prediction:release
   */
  ipcMain.handle('twitch:prediction:release', async (event, { predictionUuid }) => {
    try {
      const db = dbManager.getConnection('clientdata');
      db.prepare(`
        UPDATE twitch_predictions
        SET local_status = 'released', updated_at = CURRENT_TIMESTAMP
        WHERE prediction_uuid = ?
      `).run(predictionUuid);
      
      return { success: true };
    } catch (error) {
      console.error('[twitch:prediction:release] Error:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Get screenshots for a game
   * Channel: db:screenshots:get
   */
  ipcMain.handle('db:screenshots:get', async (_event, { gameid }) => {
    try {
      if (!gameid) {
        return { success: false, error: 'gameid is required' };
      }
      
      const Database = require('better-sqlite3');
      const screenshotDbPath = getScreenshotDbPath();
      const fs = require('fs');
      
      if (!fs.existsSync(screenshotDbPath)) {
        return { success: true, screenshots: [] };
      }
      
      const screenshotDb = new Database(screenshotDbPath);
      
      // Check if junction table exists (new schema)
      const hasJunctionTable = screenshotDb.prepare(`
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name='gameversion_screenshots'
      `).get();
      
      let screenshots;
      if (hasJunctionTable) {
        // Use junction table to get screenshots for this gameid
        screenshots = screenshotDb.prepare(`
          SELECT 
            rs.rsuuid, 
            gvs.gameid,
            rs.gvuuid, 
            rs.rhpakuuid,
            COALESCE(gvs.file_name, rs.file_name) as file_name,
            rs.file_ext, 
            COALESCE(gvs.source_url, rs.source_url) as source_url, 
            rs.screenshot_type,
            rs.encrypted_data, 
            rs.fernet_key, 
            rs.kind,
            gvs.sequence_no
          FROM gameversion_screenshots gvs
          INNER JOIN res_screenshots rs ON gvs.rsuuid = rs.rsuuid
          WHERE gvs.gameid = ?
          ORDER BY gvs.sequence_no ASC NULLS LAST, rs.created_at ASC
        `).all(gameid);
      } else {
        // Fallback to old schema (direct gameid in res_screenshots)
        screenshots = screenshotDb.prepare(`
          SELECT rsuuid, gameid, gvuuid, rhpakuuid,
                 file_name, file_ext, source_url, screenshot_type,
                 encrypted_data, fernet_key, kind, sequence_no
          FROM res_screenshots
          WHERE gameid = ?
          ORDER BY sequence_no ASC NULLS LAST, created_at ASC
        `).all(gameid);
      }
      
      screenshotDb.close();
      
      return { success: true, screenshots };
    } catch (error) {
      console.error('[db:screenshots:get] Error:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Get game links (URLs, download links, patchblob links, etc.)
   * Channel: db:game:get-links
   */
  ipcMain.handle('db:game:get-links', async (_event, { gameid, version }) => {
    try {
      if (!gameid) {
        return { success: false, error: 'gameid is required' };
      }
      
      const rhdataDb = dbManager.getConnection('rhdata');
      const patchbinDbPath = dbManager.paths?.patchbin;
      
      // If version not specified, get the latest version
      let targetVersion = version;
      if (!targetVersion) {
        const latestVersion = rhdataDb.prepare(`
          SELECT MAX(version) as max_version
          FROM gameversions
          WHERE gameid = ?
        `).get(gameid);
        targetVersion = latestVersion?.max_version || 1;
      }
      
      // Get gameversion record
      const gameVersion = rhdataDb.prepare(`
        SELECT url, download_url, patchblob1_name
        FROM gameversions
        WHERE gameid = ? AND version = ?
      `).get(gameid, targetVersion);
      
      if (!gameVersion) {
        return { success: true, links: [], metadata: {} };
      }
      
      const links = [];
      const metadata = {};
      
      // Add main URL (first link)
      if (gameVersion.url && gameVersion.url.trim()) {
        links.push({
          label: 'Game Page',
          url: gameVersion.url.trim(),
          type: 'main'
        });
      }
      
      // Add download_url from gameversions
      if (gameVersion.download_url && gameVersion.download_url.trim()) {
        links.push({
          label: 'Download',
          url: gameVersion.download_url.trim(),
          type: 'download'
        });
      }
      
      // Check for patchblob
      let patchblob = null;
      let attachment = null;
      
      if (gameVersion.patchblob1_name && gameVersion.patchblob1_name.trim()) {
        patchblob = rhdataDb.prepare(`
          SELECT result_sha1
          FROM patchblobs
          WHERE patchblob1_name = ?
        `).get(gameVersion.patchblob1_name.trim());
        
        if (patchblob && patchblob.result_sha1) {
          metadata.patchedSha1 = patchblob.result_sha1;
          
          // Create smwdb.me link
          const hash = patchblob.result_sha1;
          const shard = hash.charAt(0);
          const smwdbUrl = `https://smwdb.me/db/${shard}/${hash}/`;
          
          // If no main URL, this becomes the first link
          if (!gameVersion.url || !gameVersion.url.trim()) {
            links.unshift({
              label: 'SMWDB Link',
              url: smwdbUrl,
              type: 'smwdb'
            });
          } else {
            links.push({
              label: 'SMWDB Link',
              url: smwdbUrl,
              type: 'smwdb'
            });
          }
          
          // Check for attachment in patchbin.db
          if (patchbinDbPath && require('fs').existsSync(patchbinDbPath)) {
            try {
              const Database = require('better-sqlite3');
              const patchbinDb = new Database(patchbinDbPath);
              
              attachment = patchbinDb.prepare(`
                SELECT file_name, filekey, decoded_hash_sha1, download_urls
                FROM attachments
                WHERE file_name = ?
              `).get(gameVersion.patchblob1_name.trim());
              
              if (attachment) {
                if (attachment.file_name) metadata.fileName = attachment.file_name;
                if (attachment.filekey) metadata.fileKey = attachment.filekey;
                if (attachment.decoded_hash_sha1) metadata.bpsSha1 = attachment.decoded_hash_sha1;
                
                // Add download_urls from attachment if not blank
                if (attachment.download_urls && attachment.download_urls.trim()) {
                  links.push({
                    label: 'Attachment Download',
                    url: attachment.download_urls.trim(),
                    type: 'attachment-download'
                  });
                }
              }
              
              patchbinDb.close();
            } catch (error) {
              console.warn('[db:game:get-links] Error accessing patchbin.db:', error.message);
            }
          }
        }
      }
      
      return { 
        success: true, 
        links,
        metadata,
        hasLinks: links.length > 0
      };
    } catch (error) {
      console.error('[db:game:get-links] Error:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Decrypt a screenshot
   * Channel: db:screenshots:decrypt
   */
  ipcMain.handle('db:screenshots:decrypt', async (_event, { encryptedData, fernetKey, screenshotType }) => {
    try {
      if (!encryptedData || !fernetKey) {
        return { success: false, error: 'encryptedData and fernetKey are required' };
      }
      
      const fernet = require('fernet');
      const UrlBase64 = require('urlsafe-base64');
      
      // Convert encrypted data to Buffer if it's a string, Uint8Array, or other type
      let encryptedBuffer;
      if (Buffer.isBuffer(encryptedData)) {
        encryptedBuffer = encryptedData;
      } else if (encryptedData instanceof Uint8Array) {
        encryptedBuffer = Buffer.from(encryptedData);
      } else if (typeof encryptedData === 'string') {
        // Try to decode as base64
        encryptedBuffer = Buffer.from(encryptedData, 'base64');
      } else if (Array.isArray(encryptedData)) {
        // Handle array of numbers
        encryptedBuffer = Buffer.from(encryptedData);
      } else {
        console.error(`db:screenshots:decrypt:Error:Invalid encryptedData format: ${Object.prototype.toString.call(encryptedData)}`)
        return { success: false, error: 'Invalid encryptedData format' };
      }
      
      // Convert fernet key from base64 if needed
      let fernetKeyString = fernetKey;
      if (Buffer.isBuffer(fernetKey)) {
        fernetKeyString = fernetKey.toString('utf8');
      } else if (typeof fernetKey === 'string') {
        // Check if it's base64 encoded
        try {
          const decoded = Buffer.from(fernetKey, 'base64').toString('utf8');
          // If decoded looks like a valid fernet key (32 bytes base64 = 44 chars)
          if (decoded.length === 44 && /^[A-Za-z0-9+/_-]+=*$/.test(decoded)) {
            fernetKeyString = decoded;
          }
        } catch (e) {
          // Use as-is
        }
      }
      
      // Decrypt using Fernet
      const secret = new fernet.Secret(fernetKeyString);
      const token = new fernet.Token({
        secret: secret,
        ttl: 0,
        token: encryptedBuffer.toString('base64')
      });
      
      const decrypted = token.decode();
      const decryptedBuffer = Buffer.from(decrypted, 'base64');
      
      // Create data URL for display
      const mimeType = screenshotType || 'image/png';
      const dataUrl = `data:${mimeType};base64,${decryptedBuffer.toString('base64')}`;
      
      return { success: true, dataUrl, buffer: decryptedBuffer };
    } catch (error) {
      console.error('[db:screenshots:decrypt] Error:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Get thumbnail from cache
   * Channel: db:thumbnail:get
   */
  ipcMain.handle('db:thumbnail:get', async (_event, { gameid }) => {
    try {
      const thumbnailCacheDb = dbManager.getConnection('thumbnail_cache');
      
      // Ensure gameid is treated as TEXT
      const gameidStr = String(gameid);
      const cached = thumbnailCacheDb.prepare(`
        SELECT thumbnail_data_url, screenshot_rsuuid, screenshot_decoded_sha256
        FROM thumbnail_cache
        WHERE gameid = ?
      `).get(gameidStr);
      
      if (cached) {
        return { success: true, dataUrl: cached.thumbnail_data_url, rsuuid: cached.screenshot_rsuuid, sha256: cached.screenshot_decoded_sha256 };
      }
      
      return { success: false, error: 'Not cached' };
    } catch (error) {
      console.error('[db:thumbnail:get] Error:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Cache thumbnail for a gameid
   * Channel: db:thumbnail:set
   */
  ipcMain.handle('db:thumbnail:set', async (_event, { gameid, dataUrl, screenshotRsuuid, screenshotSha256 }) => {
    try {
      const thumbnailCacheDb = dbManager.getConnection('thumbnail_cache');
      
      // Ensure gameid is treated as TEXT
      const gameidStr = String(gameid);
      thumbnailCacheDb.prepare(`
        INSERT OR REPLACE INTO thumbnail_cache (gameid, thumbnail_data_url, screenshot_rsuuid, screenshot_decoded_sha256, cached_at, updated_at)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).run(gameidStr, dataUrl, screenshotRsuuid || null, screenshotSha256 || null);
      
      return { success: true };
    } catch (error) {
      console.error('[db:thumbnail:set] Error:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Get title screenshot for a gameid (lowest sequence_no or title_screenshot_sha256 override)
   * Channel: db:thumbnail:get-title-screenshot
   */
  ipcMain.handle('db:thumbnail:get-title-screenshot', async (_event, { gameid }) => {
    try {
      const rhdataDb = dbManager.getConnection('rhdata');
      const screenshotDb = dbManager.getConnection('screenshot');
      
      // Check if junction table exists (new schema)
      const hasJunctionTable = screenshotDb.prepare(`
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name='gameversion_screenshots'
      `).get();
      
      // Check for manual override
      const gameVersion = rhdataDb.prepare(`
        SELECT title_screenshot_sha256, gvuuid
        FROM gameversions
        WHERE gameid = ?
        ORDER BY version DESC
        LIMIT 1
      `).get(gameid);
      
      let screenshot = null;
      
      if (gameVersion?.title_screenshot_sha256) {
        // Use manual override
        if (hasJunctionTable) {
          screenshot = screenshotDb.prepare(`
            SELECT rs.rsuuid, rs.encrypted_data, rs.fernet_key, rs.screenshot_type, rs.decoded_sha256
            FROM gameversion_screenshots gvs
            INNER JOIN res_screenshots rs ON gvs.rsuuid = rs.rsuuid
            WHERE gvs.gameid = ? AND rs.decoded_sha256 = ?
            LIMIT 1
          `).get(gameid, gameVersion.title_screenshot_sha256);
        } else {
          screenshot = screenshotDb.prepare(`
            SELECT rsuuid, encrypted_data, fernet_key, screenshot_type, decoded_sha256
            FROM res_screenshots
            WHERE gameid = ? AND decoded_sha256 = ?
            LIMIT 1
          `).get(gameid, gameVersion.title_screenshot_sha256);
        }
      }
      
      if (!screenshot) {
        // Use screenshot with lowest sequence_no
        if (hasJunctionTable) {
          screenshot = screenshotDb.prepare(`
            SELECT rs.rsuuid, rs.encrypted_data, rs.fernet_key, rs.screenshot_type, rs.decoded_sha256
            FROM gameversion_screenshots gvs
            INNER JOIN res_screenshots rs ON gvs.rsuuid = rs.rsuuid
            WHERE gvs.gameid = ? AND rs.kind = 'file'
            ORDER BY gvs.sequence_no ASC NULLS LAST, rs.created_at ASC
            LIMIT 1
          `).get(gameid);
        } else {
          screenshot = screenshotDb.prepare(`
            SELECT rsuuid, encrypted_data, fernet_key, screenshot_type, decoded_sha256
            FROM res_screenshots
            WHERE gameid = ? AND kind = 'file'
            ORDER BY sequence_no ASC NULLS LAST, created_at ASC
            LIMIT 1
          `).get(gameid);
        }
      }
      
      if (!screenshot) {
        return { success: false, error: 'No screenshot found' };
      }
      
      return {
        success: true,
        rsuuid: screenshot.rsuuid,
        encryptedData: screenshot.encrypted_data,
        fernetKey: screenshot.fernet_key,
        screenshotType: screenshot.screenshot_type,
        decodedSha256: screenshot.decoded_sha256
      };
    } catch (error) {
      console.error('[db:thumbnail:get-title-screenshot] Error:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Scan all gameids and precache thumbnails
   * Channel: db:thumbnail:scan-all
   */
  ipcMain.handle('db:thumbnail:scan-all', async (_event) => {
    try {
      const rhdataDb = dbManager.getConnection('rhdata');
      const screenshotDb = dbManager.getConnection('screenshot');
      const thumbnailCacheDb = dbManager.getConnection('thumbnail_cache');
      
      // Get all gameids
      const gameids = rhdataDb.prepare(`
        SELECT DISTINCT gameid FROM gameversions ORDER BY gameid
      `).all();
      
      const fernet = require('fernet');
      let cached = 0;
      let skipped = 0;
      let errors = 0;
      
      for (const { gameid } of gameids) {
        try {
          // Ensure gameid is treated as TEXT
          const gameidStr = String(gameid);
          
          // Check if already cached
          const existing = thumbnailCacheDb.prepare(`
            SELECT gameid FROM thumbnail_cache WHERE gameid = ?
          `).get(gameidStr);
          
          if (existing) {
            skipped++;
            continue;
          }
          
          // Get title screenshot
          const gameVersion = rhdataDb.prepare(`
            SELECT title_screenshot_sha256, gvuuid
            FROM gameversions
            WHERE gameid = ?
            ORDER BY version DESC
            LIMIT 1
          `).get(gameidStr);
          
          let screenshot = null;
          
          // Check if junction table exists (new schema)
          const hasJunctionTable = screenshotDb.prepare(`
            SELECT name FROM sqlite_master 
            WHERE type='table' AND name='gameversion_screenshots'
          `).get();
          
          if (gameVersion?.title_screenshot_sha256) {
            if (hasJunctionTable) {
              screenshot = screenshotDb.prepare(`
                SELECT rs.rsuuid, rs.encrypted_data, rs.fernet_key, rs.screenshot_type, rs.decoded_sha256
                FROM gameversion_screenshots gvs
                INNER JOIN res_screenshots rs ON gvs.rsuuid = rs.rsuuid
                WHERE gvs.gameid = ? AND rs.decoded_sha256 = ?
                LIMIT 1
              `).get(gameidStr, gameVersion.title_screenshot_sha256);
            } else {
              screenshot = screenshotDb.prepare(`
                SELECT rsuuid, encrypted_data, fernet_key, screenshot_type, decoded_sha256
                FROM res_screenshots
                WHERE gameid = ? AND decoded_sha256 = ?
                LIMIT 1
              `).get(gameidStr, gameVersion.title_screenshot_sha256);
            }
          }
          
          if (!screenshot) {
            if (hasJunctionTable) {
              screenshot = screenshotDb.prepare(`
                SELECT rs.rsuuid, rs.encrypted_data, rs.fernet_key, rs.screenshot_type, rs.decoded_sha256
                FROM gameversion_screenshots gvs
                INNER JOIN res_screenshots rs ON gvs.rsuuid = rs.rsuuid
                WHERE gvs.gameid = ? AND rs.kind = 'file'
                ORDER BY gvs.sequence_no ASC NULLS LAST, rs.created_at ASC
                LIMIT 1
              `).get(gameidStr);
            } else {
              screenshot = screenshotDb.prepare(`
                SELECT rsuuid, encrypted_data, fernet_key, screenshot_type, decoded_sha256
                FROM res_screenshots
                WHERE gameid = ? AND kind = 'file'
                ORDER BY sequence_no ASC NULLS LAST, created_at ASC
                LIMIT 1
              `).get(gameidStr);
            }
          }
          
          if (!screenshot || !screenshot.encrypted_data || !screenshot.fernet_key) {
            skipped++;
            continue;
          }
          
          // Decrypt screenshot
          let encryptedBuffer = screenshot.encrypted_data;
          if (encryptedBuffer instanceof Uint8Array) {
            encryptedBuffer = Buffer.from(encryptedBuffer);
          } else if (typeof encryptedBuffer === 'string') {
            encryptedBuffer = Buffer.from(encryptedBuffer, 'base64');
          }
          
          let fernetKeyString = screenshot.fernet_key;
          if (Buffer.isBuffer(fernetKeyString)) {
            fernetKeyString = fernetKeyString.toString('utf8');
          } else if (typeof fernetKeyString === 'string') {
            try {
              const decoded = Buffer.from(fernetKeyString, 'base64').toString('utf8');
              if (decoded.length === 44 && /^[A-Za-z0-9+/_-]+=*$/.test(decoded)) {
                fernetKeyString = decoded;
              }
            } catch (e) {
              // Use as-is
            }
          }
          
          const secret = new fernet.Secret(fernetKeyString);
          const token = new fernet.Token({
            secret: secret,
            ttl: 0,
            token: encryptedBuffer.toString('base64')
          });
          
          const decrypted = token.decode();
          const decryptedBuffer = Buffer.from(decrypted, 'base64');
          
          // Create data URL
          const mimeType = screenshot.screenshot_type || 'image/png';
          const dataUrl = `data:${mimeType};base64,${decryptedBuffer.toString('base64')}`;
          
          // Cache it (gameid already converted to string above)
          thumbnailCacheDb.prepare(`
            INSERT OR REPLACE INTO thumbnail_cache (gameid, thumbnail_data_url, screenshot_rsuuid, screenshot_decoded_sha256, cached_at, updated_at)
            VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          `).run(gameidStr, dataUrl, screenshot.rsuuid, screenshot.decoded_sha256);
          
          cached++;
        } catch (error) {
          console.error(`[db:thumbnail:scan-all] Error processing gameid ${gameid}:`, error.message);
          errors++;
        }
      }
      
      return { success: true, cached, skipped, errors, total: gameids.length };
    } catch (error) {
      console.error('[db:thumbnail:scan-all] Error:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Channel: online:social-id:verify
   * Verify a social ID by checking if the verification code is present on the profile
   * Uses Electron BrowserWindow for rendering SPA content (Twitch, YouTube, etc.)
   */
  ipcMain.handle('online:social-id:verify', async (event, { socialIdType, socialIdValue, verificationCode }) => {
    const { BrowserWindow } = require('electron');
    
    try {
      if (!socialIdType || !socialIdValue || !verificationCode) {
        return { success: false, error: 'Missing required parameters' };
      }

      let verified = false;
      let error = null;
      let url = '';
      let renderedText = '';

      if (socialIdType === 'twitch') {
        url = `https://m.twitch.tv/${encodeURIComponent(socialIdValue)}/about`;
      } else if (socialIdType === 'youtube') {
        // Extract channel ID or username from URL if provided
        if (socialIdValue.includes('youtube.com') || socialIdValue.includes('youtu.be')) {
          // Try to extract channel ID from URL
          const urlMatch = socialIdValue.match(/(?:channel\/|@)([^\/\?]+)/);
          const channelId = urlMatch ? urlMatch[1] : socialIdValue;
          url = `https://www.youtube.com/@${channelId}/about`;
        } else {
          url = `https://www.youtube.com/@${socialIdValue}/about`;
        }
      } else {
        return {
          success: false,
          error: `Verification not yet supported for ${socialIdType}`,
          verified: false
        };
      }

      // Extract npub from verification code (simplified extraction per spec)
      // The spec says we just need to find the npub substring anywhere in the text
      const npubMatch = verificationCode.match(/npub1[a-z0-9]+/i);
      const targetNpub = npubMatch ? npubMatch[0] : null;

      if (!targetNpub) {
        return {
          success: false,
          error: 'Verification code must contain an npub (npub1...)',
          verified: false
        };
      }

      // Create offscreen BrowserWindow for rendering
      const win = new BrowserWindow({
        show: false,
        webPreferences: {
          offscreen: true,
          contextIsolation: true,
          nodeIntegration: false
        }
      });

      try {
        console.log(`[online:social-id:verify] Loading ${socialIdType} profile: ${url}`);
        
        // Load the URL
        await win.loadURL(url);
        
        // Wait for DOM hydration (React SPA needs time to render)
        // Per spec: wait ~4 seconds for Twitch/YouTube
        await new Promise(resolve => setTimeout(resolve, 4000));
        
        // Extract rendered text
        renderedText = await win.webContents.executeJavaScript(`
          (function() {
            return document.body.innerHTML || '';
          })()
        `);
        
        console.log(`[online:social-id:verify] Extracted ${renderedText.length} characters of text`);
	console.log(`templog=${renderedText}`)
        
        // Check if npub appears in the rendered text (case-insensitive)
        // Per unified scraper spec: just check for substring match
        const normalizedText = renderedText.replace(/\s+/g, ' ').toLowerCase();
        const normalizedNpub = targetNpub.toLowerCase();
        
        verified = normalizedText.includes(normalizedNpub);
        
        if (!verified) {
          error = `Verification code (npub) not found on ${socialIdType} profile. Please ensure you have saved your changes and the code is visible on your profile.`;
        } else {
          console.log(`[online:social-id:verify] ✓ Found npub in ${socialIdType} profile`);
        }
      } catch (renderError) {
        console.error(`[online:social-id:verify] Rendering error:`, renderError);
        return {
          success: false,
          error: `Failed to render ${socialIdType} profile: ${renderError.message}`,
          verified: false
        };
      } finally {
        // Clean up BrowserWindow
        win.destroy();
      }

      return {
        success: verified,
        verified: verified,
        error: error,
        rawTextLength: renderedText.length
      };
    } catch (error) {
      console.error('[online:social-id:verify] Error:', error);
      return { 
        success: false, 
        error: error.message || 'Unknown error during verification',
        verified: false
      };
    }
  });

  // Catalog search handlers
  ipcMain.handle('catalog:check-availability', async (_event) => {
    try {
      const { app } = require('electron');
      const basePath = app.getPath('userData');
      const dbPath = path.join(basePath, 'rhsearch_cat.db');
      const zipPath = path.join(basePath, 'rhsearch.zip');
      
      const missingFiles = [];
      if (!fs.existsSync(dbPath)) {
        missingFiles.push('rhsearch_cat.db');
      }
      if (!fs.existsSync(zipPath)) {
        missingFiles.push('rhsearch.zip');
      }
      
      return {
        available: missingFiles.length === 0,
        missingFiles,
        dbPath,
        zipPath
      };
    } catch (error) {
      console.error('[catalog:check-availability] Error:', error);
      return {
        available: false,
        missingFiles: ['rhsearch_cat.db', 'rhsearch.zip'],
        error: error.message
      };
    }
  });

  ipcMain.handle('catalog:choose-db-file', async (_event) => {
    try {
      const result = await dialog.showOpenDialog({
        title: 'Select Search Catalog Database',
        filters: [
          { name: 'Database Files', extensions: ['db'] },
          { name: 'All Files', extensions: ['*'] }
        ],
        properties: ['openFile']
      });
      
      if (result.canceled) {
        return { canceled: true };
      }
      
      return {
        canceled: false,
        filePath: result.filePaths[0]
      };
    } catch (error) {
      console.error('[catalog:choose-db-file] Error:', error);
      throw error;
    }
  });

  ipcMain.handle('catalog:choose-zip-file', async (_event) => {
    try {
      const result = await dialog.showOpenDialog({
        title: 'Select Search Catalog ZIP Archive',
        filters: [
          { name: 'ZIP Files', extensions: ['zip'] },
          { name: 'All Files', extensions: ['*'] }
        ],
        properties: ['openFile']
      });
      
      if (result.canceled) {
        return { canceled: true };
      }
      
      return {
        canceled: false,
        filePath: result.filePaths[0]
      };
    } catch (error) {
      console.error('[catalog:choose-zip-file] Error:', error);
      throw error;
    }
  });

  ipcMain.handle('catalog:copy-files', async (_event, { dbPath, zipPath }) => {
    try {
      const { app } = require('electron');
      const basePath = app.getPath('userData');
      const targetDbPath = path.join(basePath, 'rhsearch_cat.db');
      const targetZipPath = path.join(basePath, 'rhsearch.zip');
      
      // Ensure directory exists
      if (!fs.existsSync(basePath)) {
        fs.mkdirSync(basePath, { recursive: true });
      }
      
      // Copy files
      fs.copyFileSync(dbPath, targetDbPath);
      fs.copyFileSync(zipPath, targetZipPath);
      
      return {
        success: true,
        dbPath: targetDbPath,
        zipPath: targetZipPath
      };
    } catch (error) {
      console.error('[catalog:copy-files] Error:', error);
      return {
        success: false,
        error: error.message || 'Failed to copy files'
      };
    }
  });

  ipcMain.handle('catalog:search', async (_event, { query }) => {
    try {
      const { app } = require('electron');
      const Database = require('better-sqlite3');
      const basePath = app.getPath('userData');
      const dbPath = path.join(basePath, 'rhsearch_cat.db');
      
      if (!fs.existsSync(dbPath)) {
        throw new Error('Search catalog database not found');
      }
      
      const db = new Database(dbPath, { readonly: true });
      
      // Build FTS5 query
      const queryTerms = query.split(/\s+/).map(term => {
        if (term.includes(' ')) {
          return `"${term}"`;
        } else {
          return `${term}*`;
        }
      }).join(' AND ');
      
      const ftsQuery = queryTerms;
      
      // Check if FTS5 table exists
      const ftsExists = db.prepare(`
        SELECT name FROM sqlite_master WHERE type='table' AND name='items_fts'
      `).get();
      
      if (!ftsExists) {
        throw new Error('FTS5 index not found. Run Stage 2 (search_build2.js) first.');
      }
      
      // Check which columns exist in the items table
      const tableInfo = db.prepare(`PRAGMA table_info(items)`).all();
      const existingColumns = new Set(tableInfo.map(col => col.name));
      
      // Build SELECT list with only existing columns
      const selectColumns = [
        'i.item_id',
        'i.title',
        'i.author',
        'i.versioninfo',
        'i.brief',
        'i.tags',
        'i.sfc_rom_sha1_hash',
        'i.sfc_rom_sha256_hash',
        'i.bps_sha1_hash',
        'i.bps_sha256_hash',
        'i.bps_filename'
      ];
      
      // Add optional columns if they exist
      if (existingColumns.has('index7z_name')) selectColumns.push('i.index7z_name');
      if (existingColumns.has('indexbps_name')) selectColumns.push('i.indexbps_name');
      if (existingColumns.has('index7z_ipfs_cidv1')) selectColumns.push('i.index7z_ipfs_cidv1');
      if (existingColumns.has('index7z_ardrive_file_id')) selectColumns.push('i.index7z_ardrive_file_id');
      
      selectColumns.push(
        'i.has_screenshots',
        'i.screenshot_count',
        'i.has_levelnames',
        'i.has_lmfilter',
        'ig.group_id',
        'g.canonical_title',
        'g.canonical_author',
        'g.version_count'
      );
      
      // Execute search
      const results = db.prepare(`
        SELECT 
          ${selectColumns.join(',\n          ')}
        FROM items_fts
        JOIN items i ON items_fts.item_id = i.item_id
        LEFT JOIN items_groups ig ON i.item_id = ig.item_id
        LEFT JOIN groups g ON ig.group_id = g.group_id
        WHERE items_fts MATCH ?
        ORDER BY i.title
        LIMIT 200
      `).all(ftsQuery);
      
      db.close();
      
      return results;
    } catch (error) {
      console.error('[catalog:search] Error:', error);
      throw error;
    }
  });

  // Catalog game existence check
  ipcMain.handle('catalog:check-game-exists', async (_event, { bpsSha256 }) => {
    try {
      const patchbinDb = dbManager.getConnection('patchbin');
      
      // Check attachments table for matching decoded_hash_sha256
      const attachment = patchbinDb.prepare(`
        SELECT auuid, gvuuid, file_name, decoded_hash_sha256
        FROM attachments
        WHERE decoded_hash_sha256 = ?
        LIMIT 1
      `).get(bpsSha256);
      
      if (!attachment) {
        return { exists: false };
      }
      
      // Get gameid from gameversions table using gvuuid
      const rhdataDb = dbManager.getConnection('rhdata');
      const gameversion = rhdataDb.prepare(`
        SELECT gameid, gvuuid
        FROM gameversions
        WHERE gvuuid = ?
        LIMIT 1
      `).get(attachment.gvuuid);
      
      return {
        exists: true,
        gameid: gameversion?.gameid || null,
        gvuuid: attachment.gvuuid
      };
    } catch (error) {
      console.error('[catalog:check-game-exists] Error:', error);
      return { exists: false, error: error.message };
    }
  });

  // Get item JSON from catalog ZIP
  ipcMain.handle('catalog:get-item-json', async (_event, { itemId }) => {
    try {
      const { app } = require('electron');
      const AdmZip = require('adm-zip');
      const basePath = app.getPath('userData');
      const zipPath = path.join(basePath, 'rhsearch.zip');
      
      if (!fs.existsSync(zipPath)) {
        throw new Error('Search catalog ZIP not found');
      }
      
      const zip = new AdmZip(zipPath);
      const jsonPath = `${itemId}.json`;
      const entry = zip.getEntry(jsonPath);
      
      if (!entry) {
        throw new Error(`JSON file not found in catalog: ${jsonPath}`);
      }
      
      const jsonContent = entry.getData().toString('utf8');
      return JSON.parse(jsonContent);
    } catch (error) {
      console.error('[catalog:get-item-json] Error:', error);
      throw error;
    }
  });

  // Find BPS/7z files for catalog item
  ipcMain.handle('catalog:find-files', async (event, { itemId, index7zName, indexBpsName, bpsSha256 }) => {
    const sendProgress = (message) => {
      if (event.sender && !event.sender.isDestroyed()) {
        event.sender.send('catalog:find-files:progress', { message });
      }
    };
    
    try {
      const { app } = require('electron');
      const os = require('os');
      const userDataDir = app.getPath('userData');
      
      sendProgress('Searching for files locally...');
      
      // Possible locations to search (program data downloads directory and user Downloads)
      const downloadsDir = path.join(userDataDir, 'downloads');
      const searchPaths = [
        downloadsDir, // Program data downloads directory
        path.join(os.homedir(), 'Downloads'), // User Downloads folder
      ];
      
      let bpsPath = null;
      let sevenZPath = null;
      const missingFiles = [];
      
      // Only check the 7z archive specified in index7zName from JSON
      if (index7zName) {
        sendProgress(`Looking for ${index7zName} in local directories...`);
        for (const searchPath of searchPaths) {
          const candidate7z = path.join(searchPath, index7zName);
          if (fs.existsSync(candidate7z)) {
            sevenZPath = candidate7z;
            sendProgress(`✓ Found ${index7zName} locally`);
            console.log(`[catalog:find-files] Found 7z archive from JSON index7z_name: ${sevenZPath}`);
            break;
          }
        }
        
        if (!sevenZPath) {
          missingFiles.push(`7z archive: ${index7zName}`);
          sendProgress(`✗ ${index7zName} not found locally`);
          console.warn(`[catalog:find-files] 7z archive not found: ${index7zName}`);
        }
      } else {
        sendProgress('⚠ No 7z archive name specified');
        console.warn(`[catalog:find-files] No index7z_name specified in JSON, cannot locate 7z archive`);
      }
      
      // Try to find standalone BPS file (only if not using 7z)
      if (indexBpsName && !sevenZPath) {
        for (const searchPath of searchPaths) {
          const candidateBps = path.join(searchPath, indexBpsName);
          if (fs.existsSync(candidateBps)) {
            bpsPath = candidateBps;
            console.log(`[catalog:find-files] Found standalone BPS file: ${bpsPath}`);
            break;
          }
        }
      }
      
      // If files are missing, try to download them
      if (!bpsPath && !sevenZPath && index7zName) {
        // Try to download from manifest
        try {
          sendProgress(`Attempting to download ${index7zName}...`);
          const catalogManifestUtils = require('./utils/catalog-manifest-utils');
          const catalogDownloadManager = require('./utils/catalog-download-manager');
          const manifest = catalogManifestUtils.loadBpsArchivesManifest();
          
          if (manifest && manifest[index7zName]) {
            const manifestEntry = manifest[index7zName];
            if (manifestEntry.base) {
              const downloadsDir = path.join(userDataDir, 'downloads');
              fs.mkdirSync(downloadsDir, { recursive: true });
              
              // Create download tracker that reports progress
              const downloadTracker = catalogDownloadManager.createDownloadTracker();
              
              // Helper function to format bytes
              function formatBytes(bytes) {
                if (bytes === 0) return '0 B';
                const k = 1024;
                const sizes = ['B', 'KB', 'MB', 'GB'];
                const i = Math.floor(Math.log(bytes) / Math.log(k));
                return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
              }
              
              // Override progress method to send updates to renderer
              const originalProgress = downloadTracker.progress;
              downloadTracker.progress = (spec, downloaded, total) => {
                if (originalProgress) originalProgress(spec, downloaded, total);
                const percent = total > 0 ? Math.round((downloaded / total) * 100) : 0;
                sendProgress(`Downloading ${spec.file_name}: ${percent}% (${formatBytes(downloaded)} / ${formatBytes(total)})`);
                if (event.sender && !event.sender.isDestroyed()) {
                  event.sender.send('catalog:find-files:progress', {
                    message: `Downloading ${spec.file_name}...`,
                    filename: spec.file_name,
                    downloaded,
                    total,
                    percent
                  });
                }
              };
              
              // Override start method
              const originalStart = downloadTracker.start;
              downloadTracker.start = (spec, total) => {
                if (originalStart) originalStart(spec, total);
                sendProgress(`Starting download: ${spec.file_name} (${formatBytes(total)})`);
                if (event.sender && !event.sender.isDestroyed()) {
                  event.sender.send('catalog:find-files:progress', {
                    message: `Starting download: ${spec.file_name}...`,
                    filename: spec.file_name,
                    downloaded: 0,
                    total,
                    percent: 0
                  });
                }
              };
              
              // Override register method to show IPFS gateway testing and other status messages
              const originalRegister = downloadTracker.register;
              downloadTracker.register = (spec) => {
                if (originalRegister) originalRegister(spec);
                // Check if this is a progress message (from IPFS gateway testing, etc.)
                if (spec._progressMessage) {
                  sendProgress(spec._progressMessage);
                  if (event.sender && !event.sender.isDestroyed()) {
                    event.sender.send('catalog:find-files:progress', {
                      message: spec._progressMessage,
                      filename: spec.file_name
                    });
                  }
                } else {
                  sendProgress(`Preparing to download ${spec.file_name}...`);
                  if (event.sender && !event.sender.isDestroyed()) {
                    event.sender.send('catalog:find-files:progress', {
                      message: `Preparing to download ${spec.file_name}...`,
                      filename: spec.file_name
                    });
                  }
                }
              };
              
              // Create progress callback for IPFS gateway testing
              const ipfsProgressCallback = (message) => {
                sendProgress(message);
                if (event.sender && !event.sender.isDestroyed()) {
                  event.sender.send('catalog:find-files:progress', { message });
                }
              };
              
              // Attach progress callback to spec so it gets passed through
              manifestEntry.base._ipfsProgressCallback = ipfsProgressCallback;
              
              // Download directly to program data downloads directory
              const downloadedPath = await catalogDownloadManager.ensureArtifact(
                manifestEntry.base,
                path.join(userDataDir, 'CatalogTemp'), // workingDir for temp operations
                downloadTracker,
                userDataDir,
                20,
                downloadsDir // finalDestinationDir - download directly here
              );
              
              sevenZPath = downloadedPath;
              sendProgress(`✓ Download completed: ${index7zName}`);
              console.log(`[catalog:find-files] Downloaded and installed ${index7zName} to ${downloadedPath}`);
            } else {
              sendProgress(`✗ No download source available for ${index7zName}`);
            }
          } else {
            sendProgress(`✗ ${index7zName} not found in manifest`);
          }
        } catch (downloadError) {
          sendProgress(`✗ Download failed: ${downloadError.message}`);
          console.warn(`[catalog:find-files] Failed to download ${index7zName}:`, downloadError.message);
        }
      }
      
      
      // If 7z found (from index7z_name), extract ONLY the specific BPS file by name
      if (!bpsPath && sevenZPath && indexBpsName) {
        try {
            sendProgress(`Extracting ${indexBpsName} from archive...`);
            const sevenZip = require('7zip-min');
            const tempDir = path.join(os.tmpdir(), `catalog-extract-${Date.now()}`);
            fs.mkdirSync(tempDir, { recursive: true });
            
            console.log(`[catalog:find-files] Extracting ${indexBpsName} from ${sevenZPath} to ${tempDir}`);
            
            // Extract only the specific BPS file by name
            const crypto = require('crypto');
            const extractedBpsPath = path.join(tempDir, indexBpsName);
            
            // Use 7zip-min to extract specific file
            // Note: 7zip-min doesn't support extracting single files directly, so we extract all and then find the specific one
            sevenZip.unpack(sevenZPath, tempDir);
            
            // Wait a moment for extraction to complete
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Look for the exact filename (may be in subdirectory)
            const findExactBpsFile = (dir, targetName, depth = 0) => {
              if (depth > 10) return null; // Prevent infinite recursion
              try {
                const entries = fs.readdirSync(dir, { withFileTypes: true });
                for (const entry of entries) {
                  const fullPath = path.join(dir, entry.name);
                  if (entry.isDirectory()) {
                    const found = findExactBpsFile(fullPath, targetName, depth + 1);
                    if (found) return found;
                  } else if (entry.name === targetName) {
                    return fullPath;
                  }
                }
              } catch (err) {
                console.warn(`[catalog:find-files] Error reading directory ${dir}:`, err.message);
              }
              return null;
            };
            
            bpsPath = findExactBpsFile(tempDir, indexBpsName);
            
            if (bpsPath) {
              sendProgress(`✓ Found ${indexBpsName} in archive`);
              console.log(`[catalog:find-files] Found exact BPS file: ${bpsPath}`);
              
              // Verify SHA256 if provided
              if (bpsSha256) {
                sendProgress('Verifying file integrity (SHA256)...');
                try {
                  const fileData = fs.readFileSync(bpsPath);
                  const hash = crypto.createHash('sha256').update(fileData).digest('hex');
                  if (hash.toLowerCase() !== bpsSha256.toLowerCase()) {
                    console.error(`[catalog:find-files] ✗ SHA256 mismatch! Expected: ${bpsSha256.substring(0, 16)}..., Got: ${hash.substring(0, 16)}...`);
                    bpsPath = null;
                    throw new Error(`SHA256 hash mismatch for ${indexBpsName}. Expected ${bpsSha256.substring(0, 16)}..., got ${hash.substring(0, 16)}...`);
                  } else {
                    sendProgress('✓ SHA256 verification passed');
                    console.log(`[catalog:find-files] ✓ SHA256 verified: ${hash.substring(0, 16)}...`);
                  }
                } catch (err) {
                  sendProgress(`✗ SHA256 verification failed: ${err.message}`);
                  console.error(`[catalog:find-files] Failed to verify SHA256:`, err.message);
                  bpsPath = null;
                  throw err;
                }
              }
            } else {
              throw new Error(`BPS file ${indexBpsName} not found in 7z archive ${path.basename(sevenZPath)}`);
            }
            
            // If BPS found, copy it to a more permanent location for RHPAK creation
            if (bpsPath) {
              sendProgress('Preparing BPS file...');
              const bpsFileName = path.basename(bpsPath);
              const permanentBpsPath = path.join(os.tmpdir(), `catalog-bps-${bpsSha256 ? bpsSha256.substring(0, 16) : Date.now()}-${bpsFileName}`);
              fs.copyFileSync(bpsPath, permanentBpsPath);
              sendProgress('✓ BPS file ready');
              console.log(`[catalog:find-files] ✓ Copied BPS to permanent location: ${permanentBpsPath}`);
              bpsPath = permanentBpsPath;
            }
          } catch (error) {
            console.error('[catalog:find-files] Failed to extract from 7z:', error);
            throw error; // Re-throw to propagate the error
          }
        }
        
      if (!bpsPath && indexBpsName) {
        missingFiles.push(`BPS file: ${indexBpsName}`);
      }
      
      // If we have 7z but no BPS yet, we can still extract it later
      const filesFound = !!(bpsPath || (sevenZPath && indexBpsName));
      
      return {
        filesFound,
        bpsPath,
        sevenZPath,
        missingFiles: missingFiles.length > 0 ? missingFiles : undefined
      };
    } catch (error) {
      console.error('[catalog:find-files] Error:', error);
      return {
        filesFound: false,
        error: error.message
      };
    }
  });

  // Download files from IPFS/ArDrive
  ipcMain.handle('catalog:download-files', async (_event, { itemId, index7zName, index7zIpfsCidv1, index7zArdriveFileId }) => {
    try {
      const { app } = require('electron');
      const catalogDownloadManager = require('./utils/catalog-download-manager');
      const catalogManifestUtils = require('./utils/catalog-manifest-utils');
      
      // Load bpsarchives.json manifest
      const manifest = catalogManifestUtils.loadBpsArchivesManifest();
      if (!manifest) {
        return {
          success: false,
          error: 'bpsarchives.json manifest not found'
        };
      }
      
      // Find the 7z archive entry in manifest
      if (!index7zName || !manifest[index7zName]) {
        return {
          success: false,
          error: `Archive ${index7zName} not found in bpsarchives.json manifest`
        };
      }
      
      const manifestEntry = manifest[index7zName];
      if (!manifestEntry.base) {
        return {
          success: false,
          error: `Manifest entry for ${index7zName} has no base file specified`
        };
      }
      
      // Set up download paths (use program data directory)
      const userDataDir = app.getPath('userData');
      const workingDir = path.join(userDataDir, 'CatalogTemp');
      fs.mkdirSync(workingDir, { recursive: true });
      
      // Download directly to program data downloads directory if it's a bpsarchive
      let finalDestinationDir = null;
      if (manifestEntry.type === 'bpsarchive') {
        finalDestinationDir = path.join(userDataDir, 'downloads');
        fs.mkdirSync(finalDestinationDir, { recursive: true });
      }
      
      // Download the file
      const downloadTracker = catalogDownloadManager.createDownloadTracker();
      const downloadedPath = await catalogDownloadManager.ensureArtifact(
        manifestEntry.base,
        workingDir,
        downloadTracker,
        userDataDir,
        20, // ipfsTimeout
        finalDestinationDir // Download directly to downloads directory if specified
      );
      
      if (manifestEntry.type === 'bpsarchive') {
        console.log(`[catalog:download-files] Downloaded ${index7zName} to ${downloadedPath}`);
      }
      
      return {
        success: true,
        downloadedPath: downloadedPath
      };
    } catch (error) {
      console.error('[catalog:download-files] Error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  });
  
  // Check for catalog updates
  ipcMain.handle('catalog:check-updates', async () => {
    try {
      const catalogManifestUtils = require('./utils/catalog-manifest-utils');
      const updates = catalogManifestUtils.checkCatalogUpdates();
      return updates;
    } catch (error) {
      console.error('[catalog:check-updates] Error:', error);
      return {
        available: false,
        updates: [],
        error: error.message
      };
    }
  });
  
  // Apply catalog update (download and install)
  ipcMain.handle('catalog:apply-update', async (_event, { update }) => {
    try {
      const { app } = require('electron');
      const catalogDownloadManager = require('./utils/catalog-download-manager');
      const catalogManifestUtils = require('./utils/catalog-manifest-utils');
      const searchBuild1 = require('../jstools/search_build1.js');
      const searchBuild2 = require('../jstools/search_build2.js');
      const crypto = require('crypto');
      
      const userDataDir = app.getPath('userData');
      const workingDir = path.join(userDataDir, 'CatalogTemp');
      fs.mkdirSync(workingDir, { recursive: true });
      
      // Download the file (catalog files go to CatalogTemp, bpsarchives go to downloads)
      const downloadTracker = catalogDownloadManager.createDownloadTracker();
      const downloadedPath = await catalogDownloadManager.ensureArtifact(
        update.entry,
        workingDir,
        downloadTracker,
        userDataDir,
        20,
        null // Catalog updates stay in workingDir for processing
      );
      
      // Verify SHA256
      const fileData = fs.readFileSync(downloadedPath);
      const sha256 = crypto.createHash('sha256').update(fileData).digest('hex');
      if (sha256 !== update.availableSha256) {
        throw new Error(`SHA256 mismatch: expected ${update.availableSha256}, got ${sha256}`);
      }
      
      // Install based on type
      if (update.type === 'catalog-base' || update.type === 'catalog-additional') {
        // For catalog ZIP files, extract and add to catalog
        const AdmZip = require('adm-zip');
        const zip = new AdmZip(downloadedPath);
        const zipEntries = zip.getEntries();
        
        const catalogDbPath = path.join(userDataDir, 'rhsearch_cat.db');
        const catalogZipPath = path.join(userDataDir, 'rhsearch.zip');
        
        // Extract JSON files and add to catalog
        for (const entry of zipEntries) {
          if (entry.entryName.endsWith('.json')) {
            const jsonContent = entry.getData().toString('utf8');
            const tempJsonPath = path.join(workingDir, entry.entryName);
            fs.writeFileSync(tempJsonPath, jsonContent, 'utf8');
            
            // Add to catalog using incremental build
            await searchBuild1.buildSearchCatalog1Incremental(tempJsonPath, {
              rhsearchdb: catalogDbPath,
              rhsearchzip: catalogZipPath
            });
            
            // Update FTS5 index
            const json = JSON.parse(jsonContent);
            const itemId = json.sfc_rom_sha1_hash || path.basename(entry.entryName, '.json');
            await searchBuild2.buildSearchCatalog2Incremental([itemId], {
              rhsearchdb: catalogDbPath,
              rhsearchzip: catalogZipPath
            });
          }
        }
        
        // Update searchdat.json
        const version = update.entry.searchdb_version || update.availableVersion || '1';
        catalogManifestUtils.updateSearchDatCatalog(
          update.type === 'catalog-additional' ? 'catalog-additional' : 'catalog',
          version,
          sha256,
          downloadedPath
        );
      } else if (update.type === 'catalogdb-base') {
        // For catalog database, replace the existing one
        const catalogDbPath = path.join(userDataDir, 'rhsearch_cat.db');
        
        // If it's a 7z archive, extract it first
        if (downloadedPath.endsWith('.7z')) {
          const sevenZip = require('7zip-min');
          const extractDir = path.join(workingDir, 'extract');
          fs.mkdirSync(extractDir, { recursive: true });
          sevenZip.unpack(downloadedPath, extractDir);
          await new Promise(resolve => setTimeout(resolve, 1000));
          
          // Find the .db file
          const findDbFile = (dir) => {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
              const fullPath = path.join(dir, entry.name);
              if (entry.isDirectory()) {
                const found = findDbFile(fullPath);
                if (found) return found;
              } else if (entry.name.endsWith('.db')) {
                return fullPath;
              }
            }
            return null;
          };
          
          const extractedDb = findDbFile(extractDir);
          if (extractedDb) {
            fs.copyFileSync(extractedDb, catalogDbPath);
          } else {
            throw new Error('Database file not found in archive');
          }
        } else {
          fs.copyFileSync(downloadedPath, catalogDbPath);
        }
        
        // Update searchdat.json
        const version = update.entry.searchdb_version || update.availableVersion || '1';
        catalogManifestUtils.updateSearchDatCatalog('catalogdb', version, sha256, catalogDbPath);
      }
      
      return {
        success: true,
        message: `Successfully installed ${update.name}`
      };
    } catch (error) {
      console.error('[catalog:apply-update] Error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  });

  // Download catalog base files (rhsearch_cat.db and rhsearch.zip)
  // This handler downloads and installs base catalog files without requiring search_build1
  ipcMain.handle('catalog:download-base-files', async (event, { fileNames }) => {
    try {
      const { app } = require('electron');
      const catalogDownloadManager = require('./utils/catalog-download-manager');
      const catalogManifestUtils = require('./utils/catalog-manifest-utils');
      const crypto = require('crypto');
      const lzma = require('lzma-native');
      const { pipeline } = require('stream/promises');
      const fs = require('fs');
      
      const userDataDir = app.getPath('userData');
      const workingDir = path.join(userDataDir, 'CatalogTemp');
      fs.mkdirSync(workingDir, { recursive: true });
      
      // Load manifest
      const manifest = catalogManifestUtils.loadBpsArchivesManifest();
      if (!manifest) {
        throw new Error('Failed to load bpsarchives.json manifest');
      }
      
      const results = [];
      const filesToDownload = Array.isArray(fileNames) ? fileNames : ['rhsearch_cat.db', 'rhsearch.zip'];
      
      // Helper function to format bytes
      function formatBytes(bytes) {
        if (!Number.isFinite(bytes) || bytes < 0) return 'unknown';
        const units = ['B', 'KB', 'MB', 'GB'];
        let idx = 0;
        let value = bytes;
        while (value >= 1024 && idx < units.length - 1) {
          value /= 1024;
          idx += 1;
        }
        return `${value.toFixed(idx === 0 ? 0 : 1)}${units[idx]}`;
      }
      
      // Helper function to send progress events
      function sendProgress(data) {
        event.sender.send('catalog:download-base-files:progress', data);
      }
      
      // Create download tracker with progress events
      const downloadTracker = catalogDownloadManager.createDownloadTracker();
      
      // Override download tracker methods to send progress events
      const originalStart = downloadTracker.start;
      const originalProgress = downloadTracker.progress;
      const originalComplete = downloadTracker.complete;
      
      downloadTracker.start = (spec, totalBytes) => {
        originalStart.call(downloadTracker, spec, totalBytes);
        sendProgress({
          message: `Starting download: ${spec.file_name} (${formatBytes(totalBytes)})`,
          filename: spec.file_name,
          downloaded: 0,
          total: totalBytes,
          percent: 0
        });
      };
      
      downloadTracker.progress = (spec, downloaded, total) => {
        originalProgress.call(downloadTracker, spec, downloaded, total);
        const percent = total > 0 ? Math.floor((downloaded / total) * 100) : 0;
        sendProgress({
          message: `Downloading ${spec.file_name}: ${percent}%`,
          filename: spec.file_name,
          downloaded,
          total,
          percent
        });
      };
      
      downloadTracker.complete = (spec) => {
        originalComplete.call(downloadTracker, spec);
        sendProgress({
          message: `Download completed: ${spec.file_name}`,
          filename: spec.file_name,
          downloaded: spec.__downloadBytesTotal || 0,
          total: spec.__downloadBytesTotal || 0,
          percent: 100
        });
      };
      
      // Helper function to format bytes
      function formatBytes(bytes) {
        if (!Number.isFinite(bytes) || bytes < 0) return 'unknown';
        const units = ['B', 'KB', 'MB', 'GB'];
        let idx = 0;
        let value = bytes;
        while (value >= 1024 && idx < units.length - 1) {
          value /= 1024;
          idx += 1;
        }
        return `${value.toFixed(idx === 0 ? 0 : 1)}${units[idx]}`;
      }
      
      // Helper function to decompress xz file
      async function decompressXz(sourcePath, destPath) {
        await pipeline(
          fs.createReadStream(sourcePath),
          lzma.createDecompressor(),
          fs.createWriteStream(destPath)
        );
      }
      
      for (const fileName of filesToDownload) {
        try {
          sendProgress({
            message: `Preparing to download ${fileName}...`,
            filename: fileName
          });
          
          // Get manifest entry
          const manifestEntry = manifest[fileName];
          if (!manifestEntry || !manifestEntry.base) {
            throw new Error(`Manifest entry not found for ${fileName}`);
          }
          
          const baseSpec = manifestEntry.base;
          
          // Download the file
          sendProgress({
            message: `Downloading ${fileName}...`,
            filename: fileName
          });
          
          const downloadedPath = await catalogDownloadManager.ensureArtifact(
            baseSpec,
            workingDir,
            downloadTracker,
            userDataDir,
            20, // IPFS timeout
            null // Stay in workingDir for processing
          );
          
          // Verify SHA256
          sendProgress({
            message: `Verifying ${fileName}...`,
            filename: fileName
          });
          
          const fileData = fs.readFileSync(downloadedPath);
          const actualSha256 = crypto.createHash('sha256').update(fileData).digest('hex');
          if (baseSpec.sha256 && actualSha256 !== baseSpec.sha256) {
            throw new Error(`SHA256 mismatch for ${fileName}: expected ${baseSpec.sha256}, got ${actualSha256}`);
          }
          
          // Determine target path
          const targetPath = path.join(userDataDir, fileName);
          const tempTargetPath = `${targetPath}.tmp`;
          
          // Process based on format
          if (baseSpec.format === 'xz') {
            // Decompress xz file
            sendProgress({
              message: `Decompressing ${fileName}...`,
              filename: fileName
            });
            
            await decompressXz(downloadedPath, tempTargetPath);
            
            // Verify decompressed file exists
            if (!fs.existsSync(tempTargetPath)) {
              throw new Error(`Decompression failed: ${fileName}`);
            }
          } else {
            // Direct copy (no decompression needed)
            fs.copyFileSync(downloadedPath, tempTargetPath);
          }
          
          // Atomic install: rename temp file to final location
          sendProgress({
            message: `Installing ${fileName}...`,
            filename: fileName
          });
          
          // Remove old file if it exists
          if (fs.existsSync(targetPath)) {
            fs.unlinkSync(targetPath);
          }
          
          // Atomic rename
          fs.renameSync(tempTargetPath, targetPath);
          
          // Update searchdat.json
          const version = manifestEntry.version || '1';
          catalogManifestUtils.updateSearchDatCatalog(
            fileName === 'rhsearch_cat.db' ? 'catalogdb' : 'catalog',
            version,
            actualSha256,
            targetPath
          );
          
          // Clean up downloaded archive
          if (fs.existsSync(downloadedPath)) {
            fs.unlinkSync(downloadedPath);
          }
          
          results.push({
            fileName,
            success: true,
            path: targetPath,
            sha256: actualSha256
          });
          
          sendProgress({
            message: `Successfully installed ${fileName}`,
            filename: fileName
          });
        } catch (error) {
          console.error(`[catalog:download-base-files] Error downloading ${fileName}:`, error);
          results.push({
            fileName,
            success: false,
            error: error.message
          });
        }
      }
      
      const allSuccess = results.every(r => r.success);
      return {
        success: allSuccess,
        results,
        error: allSuccess ? null : 'Some files failed to download'
      };
    } catch (error) {
      console.error('[catalog:download-base-files] Error:', error);
      return {
        success: false,
        results: [],
        error: error.message
      };
    }
  });

  // Create temporary RHPAK from catalog item
  ipcMain.handle('catalog:create-rhpak', async (_event, { itemId, bpsPath, sfcSha256, itemJson }) => {
    try {
      const os = require('os');
      const crypto = require('crypto');
      const tempDir = path.join(os.tmpdir(), `catalog-rhpak-${Date.now()}`);
      fs.mkdirSync(tempDir, { recursive: true });
      
      // Generate deterministic UUID from SFC SHA256
      // Use first 32 characters of SHA256 to create a UUID-like string
      const uuidFromSha256 = (sha256) => {
        const hex = sha256.substring(0, 32);
        return `${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20, 32)}`;
      };
      
      const deterministicUuid = uuidFromSha256(sfcSha256);
      
      // Generate deterministic gvuuid from SFC SHA256 if not present
      const generateGvuuidFromSha256 = (sha256) => {
        if (!sha256 || sha256.length < 32) {
          return crypto.randomUUID();
        }
        const hex = sha256.substring(0, 32);
        return `${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20, 32)}`;
      };
      
      const deterministicGvuuid = itemJson.gameversion?.gvuuid || generateGvuuidFromSha256(sfcSha256);
      
      // Copy BPS file to temp directory first (before creating skeleton)
      const bpsFileName = path.basename(bpsPath);
      const bpsDestPath = path.join(tempDir, bpsFileName);
      fs.copyFileSync(bpsPath, bpsDestPath);
      const bpsRelativePath = bpsFileName; // Relative to skeleton directory
      
      // Extract meaningful title, version, and author from JSON
      // Priority: title/name fields, then filename fields, then fallback
      const title = itemJson.title || 
                   itemJson.gameversion?.name || 
                   itemJson.sfc_filename_title || 
                   itemJson['7z_filename_title'] || 
                   null;
      
      const versionInfo = itemJson.versioninfo || 
                         itemJson.gameversion?.version || 
                         itemJson.sfc_filename_versioninfo || 
                         itemJson['7z_filename_versioninfo'] || 
                         null;
      
      const author = itemJson.author || 
                    itemJson.gameversion?.author || 
                    itemJson.sfc_filename_author || 
                    itemJson['7z_filename_author'] || 
                    null;
      
      // Build game name: "Title Version catalog_xxxxx" (only if we have a title)
      const catalogPrefix = `catalog_${itemId.substring(0, 8)}`;
      let gameName;
      if (title) {
        if (versionInfo) {
          gameName = `${title} ${versionInfo} ${catalogPrefix}`;
        } else {
          gameName = `${title} ${catalogPrefix}`;
        }
      } else {
        // Fallback: use catalog prefix as name if no title found
        gameName = catalogPrefix;
      }
      
      // Ensure we have at least some author (fallback to Unknown only if truly missing)
      const finalAuthor = author || 'Unknown';
      
      // Determine type/gametype from folder_categories
      const folderCategories = itemJson.folder_categories || [];
      const hasKaizo = Array.isArray(folderCategories) && folderCategories.includes('Kaizo');
      const inferredType = itemJson.gameversion?.type || 
                          itemJson.gameversion?.gametype || 
                          itemJson.type || 
                          (hasKaizo ? 'Kaizo' : 'Standard');
      
      // Create RHPAK skeleton JSON
      const skeleton = {
        metadata: {
          rhpakuuid: deterministicUuid,
          rhpakname: `${title}${versionInfo ? ` ${versionInfo}` : ''} - ${author}`,
          version: '0.1.1',
          gameids: itemJson.gameversion?.gameid ? [itemJson.gameversion.gameid] : [sfcSha256 ? sfcSha256.substring(0, 32) : catalogPrefix]
        },
        gameversion: {
          ...(itemJson.gameversion || {}),
          gvuuid: deterministicGvuuid,
          gameid: itemJson.gameversion?.gameid || catalogPrefix,
          name: gameName,
          author: author,
          version: itemJson.gameversion?.version || (versionInfo ? parseInt(String(versionInfo).replace(/[^0-9]/g, '')) || 1 : 1),
          difficulty: itemJson.gameversion?.difficulty || itemJson.difficulty || 'Intermediate',
          gametype: itemJson.gameversion?.gametype || inferredType,
          type: itemJson.gameversion?.type || inferredType,
          fields_type: itemJson.gameversion?.fields_type || (hasKaizo ? 'Kaizo' : inferredType),
          // Reference the BPS file - newgame.js expects patch_local_path (relative to baseDir)
          patch: bpsRelativePath,
          patch_relative_path: bpsRelativePath,
          patch_filename: bpsFileName,
          patch_local_path: bpsRelativePath // Relative to tempDir (baseDir)
        },
        patchblob: itemJson.patchblob || {},
        attachments: itemJson.attachments || [],
        screenshots: itemJson.screenshots || [],
        res_attachments: itemJson.res_attachments || []
      };
      
      // Write skeleton JSON
      const skeletonPath = path.join(tempDir, 'skeleton.json');
      fs.writeFileSync(skeletonPath, JSON.stringify(skeleton, null, 2));
      
      // Use newgame.js functions directly (not via shell)
      const newgame = require(path.join(__dirname, '..', 'jstools', 'newgame.js'));
      
      // Prepare the skeleton (this will modify it, so reload after)
      try {
        await newgame.handlePrepare(skeletonPath);
      } catch (error) {
        throw new Error(`Failed to prepare RHPAK: ${error.message}`);
      }
      
      // Reload skeleton after prepare to ensure our gameversion data is preserved
      let preparedSkeleton = JSON.parse(fs.readFileSync(skeletonPath, 'utf8'));
      
      // Ensure our gameversion data is preserved (prepare might have modified it)
      // This is critical - the name and author must be set correctly for the database
      if (preparedSkeleton.gameversion) {
        // Preserve all our carefully extracted values
        preparedSkeleton.gameversion.name = gameName; // "Invictus V1.1 catalog_4cea8e79"
        preparedSkeleton.gameversion.author = finalAuthor; // "juzcook"
        preparedSkeleton.gameversion.authors = finalAuthor; // Also set authors field
        preparedSkeleton.gameversion.gvuuid = deterministicGvuuid;
        preparedSkeleton.gameversion.difficulty = itemJson.gameversion?.difficulty || itemJson.difficulty || 'Intermediate';
        preparedSkeleton.gameversion.gametype = itemJson.gameversion?.gametype || inferredType;
        preparedSkeleton.gameversion.type = itemJson.gameversion?.type || inferredType;
        preparedSkeleton.gameversion.fields_type = itemJson.gameversion?.fields_type || (hasKaizo ? 'Kaizo' : inferredType);
      }
      
      // Save the skeleton with preserved data before packaging
      fs.writeFileSync(skeletonPath, JSON.stringify(preparedSkeleton, null, 2));
      
      // Package the RHPAK
      const rhpakFileName = `${deterministicUuid}.rhpak`;
      const rhpakPath = path.join(tempDir, rhpakFileName);
      
      try {
        await newgame.handlePackage(skeletonPath, rhpakPath);
      } catch (error) {
        throw new Error(`Failed to package RHPAK: ${error.message}`);
      }
      
      if (!fs.existsSync(rhpakPath)) {
        throw new Error('RHPAK file was not created');
      }
      
      return {
        success: true,
        rhpakPath
      };
    } catch (error) {
      console.error('[catalog:create-rhpak] Error:', error);
      return {
        success: false,
        error: error.message || 'Failed to create RHPAK'
      };
    }
  });

  console.log('IPC handlers registered successfully');
}
// Helper function to sanitize file names
function sanitizeFileName(fileName) {
  if (!fileName) return null;
  
  // Only allow alphanumeric characters, hyphens, and underscores
  const sanitized = fileName.replace(/[^a-zA-Z0-9\-_]/g, '_');
  
  // Ensure it's not empty and not just underscores
  if (sanitized.length === 0 || sanitized.match(/^_+$/)) {
    return null;
  }
  
  return sanitized;
}

/**
 * Check and populate createdfp in csettings if it doesn't exist
 * @param {DatabaseManager} dbManager - Database manager instance
 */
async function ensureCreatedFp(dbManager) {
  try {
    const db = dbManager.getConnection('clientdata');
    
    // Check if createdfp exists
    const createdFpRow = db.prepare(`
      SELECT csetting_value FROM csettings WHERE csetting_name = ?
    `).get('createdfp');
    
    if (!createdFpRow || !createdFpRow.csetting_value) {
      // Calculate createdfp using getv("","")
      const { HostFP } = require('./main/HostFP');
      const hostFP = new HostFP();
      const createdFp = await hostFP.getv('', '');
      
      // Save to database
      const crypto = require('crypto');
      const uuid = crypto.randomUUID();
      db.prepare(`
        INSERT INTO csettings (csettinguid, csetting_name, csetting_value)
        VALUES (?, ?, ?)
        ON CONFLICT(csetting_name) DO UPDATE SET csetting_value = excluded.csetting_value
      `).run(uuid, 'createdfp', createdFp);
      
      console.log('Created and saved createdfp:', createdFp);
    }
  } catch (error) {
    console.error('Error ensuring createdfp:', error);
  }
}

module.exports = { registerDatabaseHandlers, ensureCreatedFp };
