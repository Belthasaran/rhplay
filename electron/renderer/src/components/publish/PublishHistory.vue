<template>
  <div class="publish-history">
    <div class="history-header">
      <h4>Publish History</h4>
      <div class="controls">
        <select v-model="filterStatus" class="ctrl">
          <option value="all">All</option>
          <option value="success">Success</option>
          <option value="failure">Failure</option>
        </select>
        <input v-model.trim="search" type="text" class="ctrl" placeholder="Search table/record/event/relay" />
        <button class="btn" @click="refresh" :disabled="loading">{{ loading ? 'Refreshing…' : 'Refresh' }}</button>
      </div>
    </div>

    <div v-if="loading" class="state">Loading…</div>
    <div v-else-if="groups.length === 0" class="state">No publish attempts found.</div>

    <div v-else class="groups">
      <div v-for="group in filteredGroups" :key="group.batchId" class="group">
        <div class="group-summary">
          <div class="left">
            <div class="batch">Batch: <code class="mono">{{ group.batchId }}</code></div>
            <div class="time">{{ group.attemptAtIso || group.attemptAt }}</div>
          </div>
          <div class="right">
            <span class="pill success">{{ group.successCount }} ok</span>
            <span class="pill failure">{{ group.failureCount }} fail</span>
          </div>
        </div>
        <table class="entries">
          <thead>
            <tr>
              <th>Table</th>
              <th>Record</th>
              <th>Event</th>
              <th>Relay</th>
              <th>Status</th>
              <th>Message</th>
              <th>Time</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="e in group.entries" :key="e.eventId + (e.relayUrl||'')">
              <td><code class="mono">{{ e.tableName }}</code></td>
              <td><code class="mono">{{ e.recordUuid }}</code></td>
              <td><code class="mono">{{ e.eventId }}</code></td>
              <td class="relay">{{ e.relayUrl || '—' }}</td>
              <td>
                <span :class="['status', e.success ? 'ok' : 'fail']">{{ e.success ? 'Success' : 'Failure' }}</span>
              </td>
              <td class="msg">{{ e.message || '' }}</td>
              <td>{{ e.attemptAtIso || e.attemptAt }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';

type AttemptEntry = {
  tableName: string;
  recordUuid: string;
  eventId: string;
  relayUrl: string | null;
  success: boolean;
  message: string | null;
  attemptAt: number;
  attemptAtIso?: string | null;
};

type AttemptGroup = {
  batchId: string;
  attemptAt: number;
  attemptAtIso?: string | null;
  entries: AttemptEntry[];
  successCount: number;
  failureCount: number;
};

const props = defineProps<{ tableName?: string; recordUuid?: string; limit?: number }>();

const loading = ref(false);
const groups = ref<AttemptGroup[]>([]);
const filterStatus = ref<'all' | 'success' | 'failure'>('all');
const search = ref('');

async function refresh() {
  loading.value = true;
  try {
    const api = (window as any)?.electronAPI;
    if (!api) return;
    const res = await api.getPublishHistory({ tableName: props.tableName, recordUuid: props.recordUuid, limit: props.limit || 50 });
    if (res?.success) {
      groups.value = res.history || [];
    }
  } finally {
    loading.value = false;
  }
}

const filteredGroups = computed(() => {
  const q = search.value.trim().toLowerCase();
  const mode = filterStatus.value;
  return groups.value.map(g => {
    let entries = g.entries;
    if (mode !== 'all') {
      const want = mode === 'success';
      entries = entries.filter(e => e.success === want);
    }
    if (q) {
      entries = entries.filter(e =>
        (e.tableName || '').toLowerCase().includes(q) ||
        (e.recordUuid || '').toLowerCase().includes(q) ||
        (e.eventId || '').toLowerCase().includes(q) ||
        (e.relayUrl || '').toLowerCase().includes(q) ||
        (e.message || '').toLowerCase().includes(q)
      );
    }
    return { ...g, entries } as AttemptGroup;
  }).filter(g => g.entries.length > 0 || q === '' && mode === 'all');
});

onMounted(() => refresh());
watch(() => [props.tableName, props.recordUuid, props.limit], () => refresh());
</script>

<style scoped>
.publish-history { display: flex; flex-direction: column; gap: 12px; }
.history-header { display: flex; justify-content: space-between; align-items: center; }
.controls { display: flex; gap: 8px; }
.ctrl { padding: 6px 10px; border: 1px solid var(--border-color,#ddd); border-radius: 4px; font-size: 12px; }
.btn { padding: 6px 12px; border: 1px solid var(--border-color,#ddd); border-radius: 4px; background: var(--bg-primary, #fff); cursor: pointer; }
.state { color: var(--text-secondary,#666); font-size: 13px; padding: 8px; }
.groups { display: flex; flex-direction: column; gap: 12px; }
.group { border: 1px solid var(--border-color,#ddd); border-radius: 6px; background: var(--bg-primary,#fff); }
.group-summary { display: flex; justify-content: space-between; align-items: center; padding: 8px 10px; background: var(--bg-secondary,#f5f5f5); border-bottom: 1px solid var(--border-color,#ddd); }
.mono { font-family: monospace; font-size: 11px; }
.pill { padding: 2px 8px; border-radius: 12px; font-size: 11px; margin-left: 6px; }
.pill.success { background: #e8f5e9; color: #2e7d32; }
.pill.failure { background: #ffebee; color: #c62828; }
.entries { width: 100%; border-collapse: collapse; }
.entries th, .entries td { font-size: 12px; border-top: 1px solid var(--border-color,#eee); padding: 6px 8px; text-align: left; }
.entries thead th { background: var(--bg-secondary,#f5f5f5); }
.status.ok { color: #2e7d32; }
.status.fail { color: #c62828; }
.relay { max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.msg { max-width: 380px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
