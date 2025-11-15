<template>
  <div class="trust-assignments-list">
    <div class="list-header">
      <h4>Manual Trust Assignments</h4>
      <p class="admin-note">
        Manual assignments can immediately adjust or cap a subject's verification level within a scope. They complement trust declarations for emergency actions or temporary limits.
      </p>
    </div>

    <div class="trust-assignments-toolbar">
      <div class="toolbar-group">
        <label>
          Filter by pubkey
          <input
            v-model.trim="localFilter.pubkey"
            type="text"
            placeholder="npub… or hex"
            @keyup.enter="handleRefresh"
          />
        </label>
        <label>
          Scope
          <select v-model="localFilter.scopeType">
            <option value="all">All</option>
            <option value="global">Global</option>
            <option value="section">Section</option>
            <option value="channel">Channel</option>
            <option value="forum">Forum</option>
            <option value="game">Game</option>
            <option value="user">User</option>
          </select>
        </label>
      </div>
      <div class="toolbar-actions">
        <button class="btn-secondary" :disabled="loading" @click="handleRefresh">
          {{ loading ? 'Loading…' : 'Refresh' }}
        </button>
        <button
          class="btn-primary"
          :disabled="!canManage"
          @click="handleAction('create')"
          title="Requires a profile with an active Nostr key"
        >
          New Assignment
        </button>
      </div>
    </div>

    <div v-if="error" class="error-message">
      {{ error }}
    </div>

    <p v-if="!canManage" class="info-message">
      Select a profile with an active Nostr key to issue or revoke manual assignments.
    </p>

    <div v-if="showCreateForm" class="trust-assignment-form">
      <h5>Create Assignment</h5>
      <div class="form-grid">
        <label>
          Subject Public Key
          <input v-model.trim="form.subjectPubkey" type="text" placeholder="npub… or hex" />
        </label>
        <label>
          Assigned Trust Level
          <input v-model.trim="form.assignedLevel" type="number" min="-2" max="30" />
        </label>
        <label>
          Trust Limit (optional)
          <input v-model.trim="form.trustLimit" type="number" min="-2" max="30" />
        </label>
        <label>
          Scope Type
          <select v-model="form.scopeType">
            <option value="global">Global</option>
            <option value="section">Section</option>
            <option value="channel">Channel</option>
            <option value="forum">Forum</option>
            <option value="game">Game</option>
            <option value="user">User</option>
          </select>
        </label>
        <label v-if="form.scopeType !== 'global'">
          Scope Target
          <input v-model.trim="form.scopeTarget" type="text" placeholder="e.g. kaizo" />
        </label>
        <label>
          Reason (optional)
          <input v-model.trim="form.reason" type="text" placeholder="Internal note" />
        </label>
        <label>
          Expires At (optional)
          <input v-model="form.expiresAt" type="datetime-local" />
        </label>
      </div>
      <div class="form-actions">
        <button class="btn-secondary" @click="handleCancelForm" :disabled="submitting">
          Cancel
        </button>
        <button class="btn-primary" @click="handleSubmitForm" :disabled="submitting">
          {{ submitting ? 'Saving…' : 'Save Assignment' }}
        </button>
      </div>
    </div>

    <div class="trust-assignments-table-wrapper">
      <table class="trust-assignments-table">
        <thead>
          <tr>
            <th>Subject</th>
            <th>Level</th>
            <th>Limit</th>
            <th>Scope</th>
            <th>Assigned By</th>
            <th>Expires</th>
            <th>Source</th>
            <th>Reason</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loading">
            <td colspan="9" class="empty-message">Loading assignments…</td>
          </tr>
          <tr v-else-if="filteredAssignments.length === 0">
            <td colspan="9" class="empty-message">No assignments found.</td>
          </tr>
          <tr v-else v-for="row in filteredAssignments" :key="row.assignment_id">
            <td><code class="mono">{{ row.pubkey }}</code></td>
            <td>{{ row.assigned_trust_level ?? '—' }}</td>
            <td>{{ row.trust_limit ?? '—' }}</td>
            <td>{{ formatAssignmentScope(row.scope) }}</td>
            <td><code class="mono">{{ row.assigned_by_pubkey || '—' }}</code></td>
            <td>{{ formatUnixTimestamp(row.expires_at) }}</td>
            <td>{{ row.source || 'manual' }}</td>
            <td>{{ row.reason || '—' }}</td>
            <td class="actions">
              <button
                class="btn-link danger"
                :disabled="deletingIds.has(row.assignment_id) || !canManage"
                @click="handleDelete(row.assignment_id)"
              >
                {{ deletingIds.has(row.assignment_id) ? 'Removing…' : 'Revoke' }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';

type TrustAssignmentRow = {
  assignment_id: number;
  pubkey: string;
  assigned_trust_level?: number | null;
  trust_limit?: number | null;
  scope?: string | null;
  assigned_by_pubkey?: string | null;
  expires_at?: number | null;
  source?: string | null;
  reason?: string | null;
};

const props = defineProps<{
  assignments: TrustAssignmentRow[];
  loading?: boolean;
  error?: string | null;
  canManage?: boolean;
  filter?: {
    pubkey?: string;
    scopeType?: 'all' | 'global' | 'section' | 'channel' | 'forum' | 'game' | 'user';
  };
}>();

const emit = defineEmits<{
  (event: 'refresh'): void;
  (event: 'action', action: string, data?: any): void;
  (event: 'update-filter', filter: { pubkey?: string; scopeType?: string }): void;
}>();

const localFilter = reactive({
  pubkey: props.filter?.pubkey || '',
  scopeType: (props.filter?.scopeType || 'all') as 'all' | 'global' | 'section' | 'channel' | 'forum' | 'game' | 'user'
});

const showCreateForm = ref(false);
const submitting = ref(false);
const deletingIds = reactive(new Set<number>());

const form = reactive({
  subjectPubkey: '',
  assignedLevel: '',
  trustLimit: '',
  scopeType: 'global' as 'global' | 'section' | 'channel' | 'forum' | 'game' | 'user',
  scopeTarget: '',
  reason: '',
  expiresAt: ''
});

const filteredAssignments = computed(() => {
  const rows = props.assignments || [];
  const pubkeyFilter = localFilter.pubkey.trim().toLowerCase();
  const scopeTypeFilter = localFilter.scopeType;
  return rows.filter((row) => {
    let matches = true;
    if (pubkeyFilter) {
      const targets = [
        row.pubkey?.toLowerCase() || '',
        row.assigned_by_pubkey?.toLowerCase() || ''
      ];
      matches = targets.some((value) => value.includes(pubkeyFilter));
    }
    if (!matches) {
      return false;
    }
    if (scopeTypeFilter !== 'all') {
      if (!row.scope) {
        return scopeTypeFilter === 'global';
      }
      try {
        const parsed = JSON.parse(row.scope);
        const type = parsed?.type || 'global';
        return type === scopeTypeFilter;
      } catch {
        return false;
      }
    }
    return true;
  });
});

watch(() => props.filter, (newFilter) => {
  if (newFilter) {
    localFilter.pubkey = newFilter.pubkey || '';
    localFilter.scopeType = newFilter.scopeType || 'all';
  }
}, { deep: true });

watch(localFilter, (newFilter) => {
  emit('update-filter', { ...newFilter });
}, { deep: true });

function handleRefresh() {
  emit('refresh');
}

function handleAction(action: string, data?: any) {
  if (action === 'create') {
    showCreateForm.value = true;
  } else {
    emit('action', action, data);
  }
}

function handleCancelForm() {
  showCreateForm.value = false;
  resetForm();
}

function resetForm() {
  form.subjectPubkey = '';
  form.assignedLevel = '';
  form.trustLimit = '';
  form.scopeType = 'global';
  form.scopeTarget = '';
  form.reason = '';
  form.expiresAt = '';
}

function handleSubmitForm() {
  emit('action', 'submit', { ...form });
}

function handleDelete(assignmentId: number) {
  emit('action', 'delete', assignmentId);
}

function formatAssignmentScope(scope: string | null | undefined): string {
  if (!scope) {
    return 'Global';
  }
  try {
    const parsed = JSON.parse(scope);
    const type = parsed?.type || 'global';
    const target = parsed?.target || '';
    if (type === 'global') {
      return 'Global';
    }
    return `${type}: ${target || '*'}`;
  } catch {
    return scope;
  }
}

function formatUnixTimestamp(timestamp: number | null | undefined): string {
  if (!timestamp) {
    return '—';
  }
  try {
    const date = new Date(timestamp * 1000);
    return date.toLocaleString();
  } catch {
    return '—';
  }
}

// Expose method to reset form after successful submission
defineExpose({
  resetForm: () => {
    showCreateForm.value = false;
    resetForm();
  }
});
</script>

<style scoped>
.trust-assignments-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.list-header h4 {
  margin: 0 0 8px;
}

.admin-note {
  color: var(--text-secondary, #666);
  font-size: 13px;
  margin: 0 0 16px;
}

.trust-assignments-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 16px;
  padding: 12px;
  background: var(--bg-secondary, #f5f5f5);
  border-radius: 4px;
}

.toolbar-group {
  display: flex;
  gap: 16px;
  flex: 1;
}

.toolbar-group label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--text-secondary, #666);
}

.toolbar-group input,
.toolbar-group select {
  padding: 6px 8px;
  border: 1px solid var(--border-color, #ddd);
  border-radius: 4px;
  font-size: 13px;
}

.toolbar-actions {
  display: flex;
  gap: 8px;
}

.error-message {
  padding: 12px;
  background: #ffebee;
  color: #c62828;
  border-radius: 4px;
  font-size: 13px;
}

.info-message {
  padding: 12px;
  background: #e3f2fd;
  color: #1565c0;
  border-radius: 4px;
  font-size: 13px;
}

.trust-assignment-form {
  padding: 16px;
  background: var(--bg-secondary, #f5f5f5);
  border-radius: 4px;
  border: 1px solid var(--border-color, #ddd);
}

.trust-assignment-form h5 {
  margin: 0 0 16px;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}

.form-grid label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
}

.form-grid input,
.form-grid select {
  padding: 6px 8px;
  border: 1px solid var(--border-color, #ddd);
  border-radius: 4px;
  font-size: 13px;
}

.form-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.trust-assignments-table-wrapper {
  overflow-x: auto;
}

.trust-assignments-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.trust-assignments-table th,
.trust-assignments-table td {
  padding: 8px 12px;
  text-align: left;
  border-bottom: 1px solid var(--border-color, #ddd);
}

.trust-assignments-table th {
  background: var(--bg-secondary, #f5f5f5);
  font-weight: 600;
  position: sticky;
  top: 0;
  z-index: 1;
}

.empty-message {
  text-align: center;
  color: var(--text-secondary, #666);
  padding: 24px;
}

.mono {
  font-family: monospace;
  font-size: 11px;
}

.actions {
  white-space: nowrap;
}

.btn-link {
  background: none;
  border: none;
  color: var(--color-primary, #1976d2);
  cursor: pointer;
  text-decoration: underline;
  font-size: 13px;
  padding: 0;
}

.btn-link:hover:not(:disabled) {
  opacity: 0.8;
}

.btn-link.danger {
  color: #c62828;
}

.btn-link:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-secondary,
.btn-primary {
  padding: 8px 16px;
  border-radius: 4px;
  border: 1px solid var(--border-color, #ddd);
  background: var(--bg-primary, white);
  cursor: pointer;
  font-size: 13px;
}

.btn-primary {
  background: var(--color-primary, #1976d2);
  color: white;
  border-color: var(--color-primary, #1976d2);
}

.btn-secondary:disabled,
.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-secondary:hover:not(:disabled),
.btn-primary:hover:not(:disabled) {
  opacity: 0.9;
}
</style>

