<template>
  <div class="moderator-dashboard" v-if="isModerator">
    <header class="moderator-header">
      <h2>Moderator Dashboard</h2>
      <div class="trust-status">
        <span>Trust Level: {{ trustInfo.trust_level ?? 'n/a' }}</span>
        <span>Trust Tier: {{ trustInfo.trust_tier ?? 'n/a' }}</span>
      </div>
      <div class="scope-summary" v-if="scopeSummary.length">
        <strong>Current Scopes:</strong>
        <ul>
          <li v-for="scope in scopeSummary" :key="scope.scope">
            {{ scope.scope }} — Actions: {{ scope.actions.join(', ') || 'view only' }}
          </li>
        </ul>
      </div>
    </header>

    <section class="moderator-actions">
      <h3>Actions</h3>
      <div class="action-controls">
        <label>Scope Type
          <select v-model="actionScope.type">
            <option value="global">Global</option>
            <option value="section">Section</option>
            <option value="channel">Channel</option>
            <option value="forum">Forum</option>
            <option value="game">Game</option>
            <option value="user">User</option>
          </select>
        </label>
        <label>Scope Target
          <input v-model="actionScope.target" placeholder="e.g. kaizo, channel:help" />
        </label>
        <label>Action Type
          <select v-model="actionType">
            <option value="block-user">Block User</option>
            <option value="mute-user">Mute User</option>
            <option value="freeze-channel">Freeze Channel</option>
            <option value="warn-user">Warn User</option>
          </select>
        </label>
        <label>Target Identifier
          <input v-model="targetIdentifier" placeholder="e.g. npub..., channel id" />
        </label>
        <label>Reason
          <input v-model="reason" placeholder="Reason for action" />
        </label>
        <label>Duration
          <select v-model="selectedDuration">
            <option v-for="option in durationOptions" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </select>
        </label>
        <label>Cleanup Interval
          <select v-model="selectedCleanupInterval">
            <option v-for="option in cleanupOptions" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </select>
          <small class="hint">Applies action retroactively to posts made within this window.</small>
        </label>
      </div>
      <button class="btn" :disabled="isActionPending" @click="performAction">Execute Action</button>
      <div v-if="actionResult" class="action-result" :class="{ success: actionResult.success, error: !actionResult.success }">
        <pre>{{ actionResultMessage }}</pre>
      </div>
    </section>

    <section class="moderation-queue">
      <header>
        <h3>Recent Moderation Actions</h3>
        <div class="filters">
          <label>Status
            <select v-model="listStatus" @change="loadActions">
              <option value="active">Active</option>
              <option value="revoked">Revoked</option>
              <option value="all">All</option>
            </select>
          </label>
        </div>
      </header>
      <div v-if="isLoadingActions" class="loading">Loading moderation actions…</div>
      <div v-else-if="moderationActions.length === 0" class="empty">
        No moderation actions for the selected filters.
      </div>
      <table v-else class="moderation-table">
        <thead>
          <tr>
            <th>Action</th>
            <th>Target</th>
            <th>Scope</th>
            <th>Issued By</th>
            <th>Issued At</th>
            <th>Ends At</th>
            <th>Status</th>
            <th v-if="listStatus !== 'revoked'">Revoke</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="entry in moderationActions" :key="entry.action_id">
            <td>{{ entry.action_type }}</td>
            <td>{{ entry.target_type }}: {{ entry.target_identifier }}</td>
            <td>{{ entry.scope_type }}: {{ entry.scope_identifier }}</td>
            <td>{{ entry.issued_by_pubkey }}</td>
            <td>{{ formatTimestamp(entry.issued_at) }}</td>
            <td>{{ entry.expires_at ? formatTimestamp(entry.expires_at) : 'Indefinite' }}</td>
            <td>{{ entry.status }}</td>
            <td v-if="entry.status === 'active'">
              <button class="btn" @click="revokeAction(entry.action_id)">Revoke</button>
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
  <div v-else class="moderator-dashboard">
    <p>You do not have moderator permissions. If this is unexpected, contact an admin.</p>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';

type ScopeOption = { type: string; target?: string };
type ModerationActionRow = {
  action_id: string;
  action_type: string;
  target_type: string;
  target_identifier: string;
  scope_type: string;
  scope_identifier: string;
  issued_by_pubkey: string;
  issued_at: number;
  status: string;
};
type DurationOption = { value: string; label: string; seconds: number | null };

const props = defineProps<{
  actorPubkey?: string | null;
}>();

const trustInfo = ref<{ trust_level: number | null; trust_tier: string | null }>({
  trust_level: null,
  trust_tier: null
});
const permissions = ref<Array<Record<string, any>>>([]);
const actionScope = ref<ScopeOption>({ type: 'section', target: '' });
const actionType = ref('block-user');
const targetIdentifier = ref('');
const reason = ref('');
const durationOptions: DurationOption[] = [
  { value: '1h', label: '1 Hour', seconds: 60 * 60 },
  { value: '12h', label: '12 Hours', seconds: 12 * 60 * 60 },
  { value: '24h', label: '24 Hours', seconds: 24 * 60 * 60 },
  { value: '7d', label: '7 Days', seconds: 7 * 24 * 60 * 60 },
  { value: '30d', label: '30 Days', seconds: 30 * 24 * 60 * 60 },
  { value: '90d', label: '90 Days', seconds: 90 * 24 * 60 * 60 },
  { value: '6m', label: '6 Months', seconds: 182 * 24 * 60 * 60 },
  { value: 'indefinite', label: 'Indefinite', seconds: null }
];
const cleanupOptions: DurationOption[] = [
  { value: 'none', label: 'No Cleanup', seconds: 0 },
  { value: '1h', label: 'Past 1 Hour', seconds: 60 * 60 },
  { value: '12h', label: 'Past 12 Hours', seconds: 12 * 60 * 60 },
  { value: '24h', label: 'Past 24 Hours', seconds: 24 * 60 * 60 },
  { value: '7d', label: 'Past 7 Days', seconds: 7 * 24 * 60 * 60 },
  { value: '30d', label: 'Past 30 Days', seconds: 30 * 24 * 60 * 60 },
  { value: '90d', label: 'Past 90 Days', seconds: 90 * 24 * 60 * 60 },
  { value: '6m', label: 'Past 6 Months', seconds: 182 * 24 * 60 * 60 },
  { value: 'indefinite', label: 'All History', seconds: null }
];
const selectedDuration = ref<string>('indefinite');
const selectedCleanupInterval = ref<string>('none');
const actionResult = ref<any>(null);
const isActionPending = ref(false);

const moderationActions = ref<ModerationActionRow[]>([]);
const listStatus = ref<'active' | 'revoked' | 'all'>('active');
const isLoadingActions = ref(false);

const resolvedActorPubkey = computed(() => props.actorPubkey || null);
const minimumModerationLevel = 7;

const scopeSummary = computed(() => {
  const map = new Map<string, { scope: string; actions: Set<string> }>();
  permissions.value.forEach((perm) => {
    if (!perm || !perm.scope) {
      return;
    }
    const scopeType = perm.scope.type || 'global';
    const scopeTargets = Array.isArray(perm.scope.targets) ? perm.scope.targets : [];
    const primaryTarget = perm.scope.target || scopeTargets[0] || '*';
    const scopeKey = `${scopeType}:${primaryTarget}`;
    const entry = map.get(scopeKey) || { scope: scopeKey, actions: new Set<string>() };
    const permEntries = perm.permissions ? Object.entries(perm.permissions) : [];
    permEntries.forEach(([key, value]) => {
      if (value) {
        entry.actions.add(key);
      }
    });
    map.set(scopeKey, entry);
  });
  return Array.from(map.values()).map((entry) => ({
    scope: entry.scope,
    actions: Array.from(entry.actions)
  }));
});

const isModerator = computed(() => {
  const trustLevel = trustInfo.value.trust_level ?? 0;
  return trustLevel >= minimumModerationLevel || (permissions.value?.length ?? 0) > 0;
});

async function loadTrustInfo(pubkey: string | null) {
  if (!pubkey || !window?.electronAPI?.getTrustPermissions) {
    trustInfo.value = { trust_level: null, trust_tier: null };
    permissions.value = [];
    return;
  }
  try {
    const response = await window.electronAPI.getTrustPermissions(pubkey);
    if (response.success) {
      trustInfo.value = { trust_level: response.trust_level ?? null, trust_tier: response.trust_tier ?? null };
      permissions.value = Array.isArray(response.permissions) ? response.permissions : [];
    } else {
      console.warn('Failed to load trust permissions:', response.error);
      trustInfo.value = { trust_level: null, trust_tier: null };
      permissions.value = [];
    }
  } catch (error: any) {
    console.error('Error loading trust permissions:', error);
    trustInfo.value = { trust_level: null, trust_tier: null };
    permissions.value = [];
  }
}

async function performAction() {
  const pubkey = resolvedActorPubkey.value;
  if (!pubkey) {
    actionResult.value = { success: false, error: 'Missing actor pubkey' };
    return;
  }
  if (!targetIdentifier.value) {
    actionResult.value = { success: false, error: 'Please provide a target identifier' };
    return;
  }
  if (!window?.electronAPI?.moderationBlockTarget) {
    actionResult.value = { success: false, error: 'Moderation APIs unavailable' };
    return;
  }

  isActionPending.value = true;
  try {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const durationOption = durationOptions.find((option) => option.value === selectedDuration.value) || durationOptions[durationOptions.length - 1];
    const cleanupOption = cleanupOptions.find((option) => option.value === selectedCleanupInterval.value) || cleanupOptions[0];
    const durationSeconds = durationOption?.seconds ?? null;
    const cleanupSeconds = cleanupOption?.seconds ?? 0;
    const expiresAt = durationSeconds ? nowSeconds + durationSeconds : null;
    const cleanupMode = cleanupOption?.value || 'none';
    const cleanupSince =
      cleanupMode === 'none'
        ? null
        : cleanupSeconds
          ? nowSeconds - cleanupSeconds
          : null;

    const content = {
      starts_at: nowSeconds,
      starts_at_iso: new Date(nowSeconds * 1000).toISOString(),
      duration_seconds: durationSeconds,
      duration_label: durationOption?.label ?? null,
      expires_at: expiresAt,
      expires_at_iso: expiresAt ? new Date(expiresAt * 1000).toISOString() : null,
      cleanup_mode: cleanupMode,
      cleanup_interval_seconds: cleanupMode === 'none' ? null : cleanupSeconds,
      cleanup_interval_label: cleanupMode === 'none' ? null : cleanupOption?.label ?? null,
      cleanup_since: cleanupSince,
      cleanup_since_iso: cleanupSince ? new Date(cleanupSince * 1000).toISOString() : null,
      cleanup_cover_entire_history: cleanupMode === 'indefinite'
    };

    const payload = {
      actorPubkey: pubkey,
      actionType: actionType.value,
      target: { type: actionScope.value.type === 'user' ? 'user' : actionScope.value.type, identifier: targetIdentifier.value },
      scope: { type: actionScope.value.type, target: actionScope.value.target || '*' },
      reason: reason.value,
      content
    };
    const response = await window.electronAPI.moderationBlockTarget(payload);
    actionResult.value = response;
    if (response.success) {
      targetIdentifier.value = '';
      reason.value = '';
      await loadActions();
    }
  } catch (error: any) {
    actionResult.value = { success: false, error: error?.message || String(error) };
  } finally {
    isActionPending.value = false;
  }
}

async function loadActions() {
  if (!window?.electronAPI?.moderationListActions) {
    return;
  }
  isLoadingActions.value = true;
  try {
    const payload: Record<string, string> = {};
    if (listStatus.value !== 'all') {
      payload.status = listStatus.value;
    }
    const response = await window.electronAPI.moderationListActions(payload);
    if (response.success) {
      moderationActions.value = response.actions || [];
    } else {
      console.warn('Failed to load moderation actions:', response.error);
      moderationActions.value = [];
    }
  } catch (error) {
    console.error('Error loading moderation actions:', error);
    moderationActions.value = [];
  } finally {
    isLoadingActions.value = false;
  }
}

async function revokeAction(actionId: string) {
  const pubkey = resolvedActorPubkey.value;
  if (!pubkey || !window?.electronAPI?.moderationRevokeAction) {
    return;
  }
  try {
    const response = await window.electronAPI.moderationRevokeAction({ actorPubkey: pubkey, actionId });
    actionResult.value = response;
    if (response.success) {
      await loadActions();
    }
  } catch (error: any) {
    actionResult.value = { success: false, error: error?.message || String(error) };
  }
}

function formatTimestamp(ts: number | null | undefined) {
  if (!ts) {
    return 'n/a';
  }
  const date = new Date(ts * 1000);
  return date.toLocaleString();
}

const actionResultMessage = computed(() => {
  if (!actionResult.value) {
    return '';
  }
  if (actionResult.value.success) {
    return JSON.stringify(actionResult.value, null, 2);
  }
  return actionResult.value.error || 'Unknown error';
});

watch(
  resolvedActorPubkey,
  async (pubkey) => {
    await loadTrustInfo(pubkey);
  },
  { immediate: true }
);

onMounted(() => {
  if (!resolvedActorPubkey.value) {
    return;
  }
  loadTrustInfo(resolvedActorPubkey.value);
  loadActions();

  if (window?.electronAPI?.onTrustChanged) {
    removeTrustChangedListener = window.electronAPI.onTrustChanged((payload: any) => {
      const actor = resolvedActorPubkey.value;
      if (!actor) {
        return;
      }
      if (!payload || (payload.pubkey && payload.pubkey !== actor) || (payload.targetPubkey && payload.targetPubkey !== actor)) {
        return;
      }
      loadTrustInfo(actor);
    });
  }
});

onUnmounted(() => {
  if (removeTrustChangedListener) {
    removeTrustChangedListener();
    removeTrustChangedListener = null;
  }
});

defineExpose({
  reloadActions: loadActions
});
</script>

<style scoped>
.moderator-dashboard {
  padding: 16px;
  background: var(--color-surface);
  border-radius: 8px;
  border: 1px solid var(--color-border);
  margin-bottom: 16px;
}

.moderator-header {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 16px;
}

.trust-status span {
  margin-right: 16px;
}

.scope-summary ul {
  margin: 0;
  padding-left: 20px;
}

.moderator-actions {
  margin-bottom: 24px;
}

.action-controls {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 12px;
  margin-bottom: 12px;
}

.action-controls label {
  display: flex;
  flex-direction: column;
  font-size: 0.9rem;
}

.btn {
  background: var(--color-primary);
  color: var(--color-on-primary);
  border: none;
  padding: 8px 16px;
  border-radius: 4px;
  cursor: pointer;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.action-result {
  margin-top: 12px;
  padding: 8px;
  border-radius: 4px;
  font-size: 0.85rem;
  background: var(--color-surface-variant);
}

.action-result.success {
  border-left: 4px solid var(--color-success);
}

.action-result.error {
  border-left: 4px solid var(--color-error);
}

.action-controls .hint {
  margin-top: 4px;
  font-size: 0.75rem;
  color: var(--color-text-muted);
}

.moderation-table {
  width: 100%;
  border-collapse: collapse;
}

.moderation-table th,
.moderation-table td {
  padding: 8px;
  border-bottom: 1px solid var(--color-border);
  text-align: left;
}

.loading,
.empty {
  padding: 12px;
  color: var(--color-text-muted);
}
</style>
