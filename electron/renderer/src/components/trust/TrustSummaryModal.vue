<template>
  <div v-if="visible" class="modal-backdrop" @click.self="emitClose">
    <div class="modal trust-summary-modal">
      <header class="modal-header">
        <h3>Trust Summary</h3>
        <div class="header-actions">
          <button class="btn-secondary" @click="copySummary" :disabled="copying || !summary">
            {{ copying ? 'Copied!' : 'Copy JSON' }}
          </button>
          <button class="btn-secondary" @click="refresh" :disabled="loading">
            {{ loading ? 'Refreshing…' : 'Refresh' }}
          </button>
          <button class="btn-close" @click="emitClose">×</button>
        </div>
      </header>

      <div class="modal-body">
        <div v-if="!pubkey" class="info-block">
          <p>Select a profile with an active Nostr key to view trust details.</p>
        </div>

        <div v-else-if="error" class="error-block">
          <p>{{ error }}</p>
        </div>

        <div v-else-if="loading" class="loading-block">
          <p>Loading trust summary…</p>
        </div>

        <div v-else-if="summary" class="trust-summary-content">
          <section class="summary-section">
            <h4>Overview</h4>
            <div class="overview-grid">
              <div>
                <label>Subject Pubkey</label>
                <code class="mono">{{ summary.pubkey }}</code>
              </div>
              <div>
                <label>Trust Level</label>
                <span class="trust-value">{{ summary.trust_level ?? 'n/a' }}</span>
              </div>
              <div>
                <label>Trust Tier</label>
                <span :class="['trust-badge', `tier-${(summary.trust_tier || 'unknown').toLowerCase()}`]">
                  {{ (summary.trust_tier || 'unknown').toUpperCase() }}
                </span>
              </div>
              <div>
                <label>Admin Level</label>
                <span class="trust-value">{{ summary.admin_level ?? 'n/a' }}</span>
              </div>
              <div>
                <label>Declaration Level</label>
                <span class="trust-value">
                  {{ summary.declaration_level ?? 'n/a' }}
                  <span v-if="summary.declaration_trust_limit !== null">
                    (limit {{ summary.declaration_trust_limit }})
                  </span>
                </span>
              </div>
            </div>
          </section>

          <section v-if="summary.assignments?.length" class="summary-section">
            <h4>Manual Assignments</h4>
            <table class="summary-table">
              <thead>
                <tr>
                  <th>Assigned Level</th>
                  <th>Trust Limit</th>
                  <th>Scope</th>
                  <th>Assigned By</th>
                  <th>Reason</th>
                  <th>Expires</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in summary.assignments" :key="row.assignment_id">
                  <td>{{ row.assigned_trust_level ?? '—' }}</td>
                  <td>{{ row.trust_limit ?? '—' }}</td>
                  <td>{{ describeScope(row.scope) }}</td>
                  <td><code class="mono">{{ row.assigned_by_pubkey || '—' }}</code></td>
                  <td>{{ row.reason || '—' }}</td>
                  <td>{{ formatTimestamp(row.expires_at) }}</td>
                </tr>
              </tbody>
            </table>
          </section>

          <section v-if="declarations.length" class="summary-section">
            <h4>Trust Declarations</h4>
            <details v-for="decl in declarations" :key="decl.declaration_uuid" class="declaration-item" open>
              <summary>
                <strong>{{ decl.declaration_uuid }}</strong>
                <span class="status-chip">{{ decl.status || 'Draft' }}</span>
              </summary>
              <div class="declaration-grid">
                <div>
                  <label>Trust Level</label>
                  <span>{{ decl.contentSummary.trustLevel ?? '—' }}</span>
                </div>
                <div>
                  <label>Trust Limit</label>
                  <span>{{ decl.contentSummary.trustLimit ?? '—' }}</span>
                </div>
                <div>
                  <label>Scopes</label>
                  <ul class="bullet-list">
                    <li v-for="scope in decl.contentSummary.scopes" :key="scope">{{ scope }}</li>
                    <li v-if="decl.contentSummary.scopes.length === 0">Global</li>
                  </ul>
                </div>
                <div>
                  <label>Permissions</label>
                  <ul class="bullet-list">
                    <li v-for="perm in decl.contentSummary.permissions" :key="perm">{{ perm }}</li>
                    <li v-if="decl.contentSummary.permissions.length === 0">—</li>
                  </ul>
                </div>
                <div v-if="decl.required_countersignatures">
                  <label>Countersignatures</label>
                  <span>
                    {{ decl.current_countersignatures || 0 }}/{{ decl.required_countersignatures }}
                  </span>
                </div>
              </div>
            </details>
          </section>

          <section v-if="permissions.length" class="summary-section">
            <h4>Effective Permissions</h4>
            <div class="permissions-list">
              <div v-for="entry in permissions" :key="entry.key" class="permission-block">
                <strong>{{ entry.label }}</strong>
                <div class="permission-scope" v-if="entry.scopeLabel">
                  Scope: {{ entry.scopeLabel }}
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>

      <footer class="modal-footer">
        <button class="btn-secondary" @click="emitClose">Close</button>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';

type TrustSummaryResponse = {
  success?: boolean;
  error?: string;
  pubkey: string;
  trust_level: number | null;
  trust_tier: string | null;
  admin_level?: number | null;
  declaration_level?: number | null;
  declaration_trust_limit?: number | null;
  declarations?: Array<any>;
  assignments?: Array<any>;
  permissions?: Array<any>;
};

const props = defineProps<{
  visible: boolean;
  pubkey: string | null;
}>();

const emit = defineEmits<{
  (event: 'close'): void;
}>();

const state = reactive<{
  loading: boolean;
  error: string | null;
  summary: TrustSummaryResponse | null;
  requestId: number;
}>({
  loading: false,
  error: null,
  summary: null,
  requestId: 0
});

const copying = ref(false);

const summary = computed(() => state.summary);
const loading = computed(() => state.loading);
const error = computed(() => state.error);

const declarations = computed(() => {
  const list = summary.value?.declarations;
  if (!Array.isArray(list)) {
    return [];
  }
  return list.map((decl) => {
    const content = parseDeclarationContent(decl?.content);
    return {
      ...decl,
      contentSummary: content
    };
  });
});

const permissions = computed(() => {
  const list = summary.value?.permissions;
  if (!Array.isArray(list)) {
    return [];
  }
  return list
    .map((entry) => {
      const key = entry?.permissions ? Object.keys(entry.permissions).find((k) => entry.permissions[k]) : null;
      const label = buildPermissionLabel(entry?.permissions);
      const scopeLabel = describeScope(entry?.scope);
      return {
        key: key || JSON.stringify(entry?.scope || entry?.permissions || ''),
        label,
        scopeLabel
      };
    })
    .filter((entry) => entry.label);
});

function emitClose() {
  emit('close');
}

function buildPermissionLabel(permissions: any): string {
  if (!permissions || typeof permissions !== 'object') {
    return '';
  }
  const labels: Record<string, string> = {
    can_sign_trust_declarations: 'Can sign trust declarations',
    can_sign_operational_admins: 'Can sign operating admins',
    can_moderate: 'Can moderate',
    can_update_metadata: 'Can update metadata',
    can_delegate_moderators: 'Can delegate moderators',
    can_delegate_updaters: 'Can delegate updaters',
    max_delegation_duration: 'Max delegation duration',
    max_block_duration: 'Max block duration'
  };
  const entries = Object.entries(permissions).filter(([_, value]) => Boolean(value));
  if (!entries.length) {
    return '';
  }
  return entries
    .map(([key, value]) => {
      const base = labels[key] || key.replace(/_/g, ' ');
      if (typeof value === 'boolean') {
        return base;
      }
      if (typeof value === 'number') {
        return `${base}: ${value}`;
      }
      return `${base}: ${JSON.stringify(value)}`;
    })
    .join(', ');
}

function parseDeclarationContent(raw: any) {
  if (!raw) {
    return {
      trustLevel: null,
      trustLimit: null,
      scopes: [] as string[],
      permissions: [] as string[]
    };
  }
  const content = raw.content ?? raw;
  const scopesRaw = Array.isArray(content.scopes)
    ? content.scopes
    : content.scopes
    ? [content.scopes]
    : [];
  const scopes = scopesRaw.map((scope: any, index: number) => describeScope(scope, index));
  const perms: string[] = [];
  if (content.permissions && typeof content.permissions === 'object') {
    Object.entries(content.permissions).forEach(([key, value]) => {
      if (value) {
        perms.push(buildPermissionLabel({ [key]: value }));
      }
    });
  }
  return {
    trustLevel: content.trust_level ?? null,
    trustLimit: content.trust_limit ?? null,
    scopes,
    permissions: perms.filter(Boolean)
  };
}

function describeScope(scope: any, index?: number): string {
  if (!scope || typeof scope !== 'object') {
    return 'Global';
  }
  const type = scope.type || 'global';
  const targets = Array.isArray(scope.targets)
    ? scope.targets
    : scope.target
    ? [scope.target]
    : [];
  const exclude = Array.isArray(scope.exclude) ? scope.exclude : [];
  let label =
    type === 'global'
      ? 'Global'
      : `${type}: ${targets.length ? targets.join(', ') : '*'}`;
  if (exclude.length) {
    label += ` (excluding ${exclude.join(', ')})`;
  }
  return label;
}

function formatTimestamp(timestamp?: number | null) {
  if (!timestamp) {
    return '—';
  }
  const date = new Date(timestamp * 1000);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  return date.toLocaleString();
}

async function copySummary() {
  if (!summary.value) {
    return;
  }
  try {
    copying.value = true;
    const text = JSON.stringify(summary.value, null, 2);
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    setTimeout(() => {
      copying.value = false;
    }, 1500);
  } catch (error) {
    console.error('Failed to copy trust summary:', error);
    copying.value = false;
  }
}

async function loadTrustSummary(force = false) {
  if (!props.visible || !props.pubkey) {
    return;
  }
  if (!force && state.loading) {
    return;
  }
  const requestId = ++state.requestId;
  state.loading = true;
  state.error = null;
  try {
    const api = (window as any)?.electronAPI;
    if (!api?.getTrustPermissions) {
      throw new Error('Trust permissions API not available in this environment.');
    }
    const response = await api.getTrustPermissions(props.pubkey);
    if (requestId !== state.requestId) {
      return;
    }
    if (!response || response.success === false) {
      throw new Error(response?.error || 'Failed to load trust summary.');
    }
    state.summary = response as TrustSummaryResponse;
  } catch (error: any) {
    if (requestId !== state.requestId) {
      return;
    }
    state.summary = null;
    state.error = error?.message || String(error);
  } finally {
    if (requestId === state.requestId) {
      state.loading = false;
    }
  }
}

function refresh() {
  loadTrustSummary(true);
}

defineExpose({
  refresh
});

watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      loadTrustSummary(true);
    } else {
      state.error = null;
      state.summary = null;
      state.loading = false;
    }
  }
);

watch(
  () => props.pubkey,
  (pubkey) => {
    if (props.visible && pubkey) {
      loadTrustSummary(true);
    }
  }
);
</script>

<style scoped>
.modal {
  max-width: 960px;
  width: 90vw;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
}

.header-actions {
  margin-left: auto;
  display: flex;
  gap: 8px;
}

.modal-body {
  overflow-y: auto;
  padding: 16px;
}

.info-block,
.error-block,
.loading-block {
  padding: 24px;
  text-align: center;
  color: var(--text-secondary);
}

.error-block {
  color: var(--color-error, #d32f2f);
}

.trust-summary-content {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.summary-section h4 {
  margin: 0 0 8px;
}

.overview-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
}

.overview-grid label {
  display: block;
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 4px;
}

.trust-value {
  font-weight: 600;
}

.trust-badge {
  display: inline-block;
  padding: 4px 10px;
  border-radius: 16px;
  font-weight: 600;
  font-size: 12px;
  background: var(--bg-secondary);
  color: var(--text-primary);
}

.trust-badge.tier-trusted {
  background: #2e7d32;
  color: #fff;
}

.trust-badge.tier-verified {
  background: #1565c0;
  color: #fff;
}

.trust-badge.tier-unverified,
.trust-badge.tier-restricted {
  background: #f57c00;
  color: #fff;
}

.summary-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.summary-table th,
.summary-table td {
  border: 1px solid var(--border-color);
  padding: 6px 8px;
  text-align: left;
}

.summary-table th {
  background: var(--bg-secondary);
}

.bullet-list {
  list-style: disc;
  padding-left: 18px;
  margin: 4px 0;
}

.mono {
  font-family: var(--font-mono, monospace);
  font-size: 12px;
  word-break: break-all;
}

.declaration-item {
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 8px 12px;
  background: var(--bg-secondary);
}

.declaration-item summary {
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}

.status-chip {
  padding: 2px 8px;
  border-radius: 12px;
  background: var(--bg-primary);
  font-size: 11px;
}

.declaration-grid {
  margin-top: 8px;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
}

.declaration-grid label {
  display: block;
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 4px;
}

.permissions-list {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 10px;
}

.permission-block {
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 10px;
  background: var(--bg-secondary);
  font-size: 13px;
}

.permission-scope {
  margin-top: 6px;
  color: var(--text-secondary);
  font-size: 12px;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>

