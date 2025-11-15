<template>
  <div class="publishing-queue-dashboard">
    <div class="dashboard-header">
      <h4>Publishing Queue Dashboard</h4>
      <div class="header-actions">
        <button class="btn-secondary" @click="refreshStatus" :disabled="loading">
          {{ loading ? 'Refreshing...' : 'Refresh' }}
        </button>
        <button class="btn-secondary" @click="retryAllFailed" :disabled="loading || stats.failed === 0">
          Retry All Failed
        </button>
        <button class="btn-secondary" @click="clearCompleted" :disabled="loading || stats.completed === 0">
          Clear Completed
        </button>
        <button class="btn-secondary" @click="openHistory">
          View Publish History
        </button>
      </div>
    </div>

    <!-- Overview Metrics -->
    <div class="metrics-grid">
      <div class="metric-card">
        <div class="metric-label">Pending</div>
        <div class="metric-value">{{ queueStats.outgoingPending || 0 }}</div>
      </div>
      <div class="metric-card processing">
        <div class="metric-label">Processing</div>
        <div class="metric-value">{{ queueStats.outgoingProcessing || 0 }}</div>
      </div>
      <div class="metric-card completed">
        <div class="metric-label">Completed</div>
        <div class="metric-value">{{ queueStats.outgoingCompleted || 0 }}</div>
      </div>
      <div class="metric-card failed">
        <div class="metric-label">Failed</div>
        <div class="metric-value">{{ queueStats.outgoingFailed || 0 }}</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Sent (Last Min)</div>
        <div class="metric-value">{{ queueStats.outgoingSentLastMinute || 0 }}</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Incoming Backlog</div>
        <div class="metric-value">{{ queueStats.incomingBacklog || 0 }}</div>
      </div>
    </div>

    <!-- Priority Bucket Summary -->
    <div v-if="prioritySummary && prioritySummary.total > 0" class="priority-summary">
      <h5>Priority Distribution</h5>
      <div class="priority-buckets">
        <div
          v-for="(count, bucket) in prioritySummary.buckets"
          :key="bucket"
          class="priority-bucket-card"
          :class="`bucket-${bucket.toLowerCase()}`"
        >
          <div class="bucket-label">{{ formatBucketName(bucket) }}</div>
          <div class="bucket-count">{{ count }}</div>
          <div class="bucket-percentage">
            {{ Math.round((count / prioritySummary.total) * 100) }}%
          </div>
        </div>
      </div>
    </div>

    <!-- Queue Tabs -->
    <div class="queue-tabs">
      <button
        :class="['tab-button', { active: activeTab === 'pending' }]"
        @click="activeTab = 'pending'"
      >
        Pending ({{ queueData.outgoing?.pending?.length || 0 }})
      </button>
      <button
        :class="['tab-button', { active: activeTab === 'processing' }]"
        @click="activeTab = 'processing'"
      >
        Processing ({{ queueData.outgoing?.processing?.length || 0 }})
      </button>
      <button
        :class="['tab-button', { active: activeTab === 'completed' }]"
        @click="activeTab = 'completed'"
      >
        Completed ({{ queueData.outgoing?.completed?.length || 0 }})
      </button>
      <button
        :class="['tab-button', { active: activeTab === 'failed' }]"
        @click="activeTab = 'failed'"
      >
        Failed ({{ queueData.outgoing?.failed?.length || 0 }})
      </button>
    </div>

    <!-- Queue List -->
    <PublishingQueueList
      :entries="getActiveEntries()"
      :loading="loading"
      @retry="handleRetry"
      @view-details="handleViewDetails"
      @view-history="handleViewHistory"
    />
  </div>
  <div v-if="historyOpen" class="modal-backdrop" @click.self="historyOpen = false">
    <div class="modal">
      <header class="modal-header">
        <h3>Publish History</h3>
        <button class="close" @click="historyOpen = false">✕</button>
      </header>
      <section class="modal-body">
        <PublishHistory :limit="50" :table-name="historyScope?.tableName" :record-uuid="historyScope?.recordUuid" />
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import PublishingQueueList from './PublishingQueueList.vue';
import PublishHistory from './PublishHistory.vue';

type QueueEntry = {
  id: string;
  kind: number;
  pubkey: string;
  createdAt: number;
  tableName: string;
  recordUuid: string;
  userProfileUuid?: string;
  procStatus: number;
  processedAt?: number;
  signature?: string;
};

type QueueData = {
  outgoing: {
    pending: QueueEntry[];
    processing: QueueEntry[];
    completed: QueueEntry[];
    failed: QueueEntry[];
  };
  incoming: {
    pending: QueueEntry[];
  };
  generatedAt: number;
};

type QueueStats = {
  outgoingPending: number;
  outgoingProcessing: number;
  outgoingCompleted: number;
  outgoingFailed: number;
  outgoingSentLastMinute: number;
  incomingBacklog: number;
  outgoingPrioritySummary?: {
    total: number;
    buckets: Record<string, number>;
  };
};

const loading = ref(false);
const queueData = ref<QueueData>({
  outgoing: { pending: [], processing: [], completed: [], failed: [] },
  incoming: { pending: [] },
  generatedAt: 0
});
const queueStats = ref<QueueStats>({
  outgoingPending: 0,
  outgoingProcessing: 0,
  outgoingCompleted: 0,
  outgoingFailed: 0,
  outgoingSentLastMinute: 0,
  incomingBacklog: 0
});
const activeTab = ref<'pending' | 'processing' | 'completed' | 'failed'>('pending');
const historyOpen = ref(false);
const historyScope = ref<{ tableName: string; recordUuid: string } | null>(null);

const prioritySummary = computed(() => queueStats.value.outgoingPrioritySummary);

const hasFailed = computed(() => (queueStats.value.outgoingFailed || 0) > 0);
const hasCompleted = computed(() => (queueStats.value.outgoingCompleted || 0) > 0);

function getActiveEntries(): QueueEntry[] {
  switch (activeTab.value) {
    case 'pending':
      return queueData.value.outgoing.pending || [];
    case 'processing':
      return queueData.value.outgoing.processing || [];
    case 'completed':
      return queueData.value.outgoing.completed || [];
    case 'failed':
      return queueData.value.outgoing.failed || [];
    default:
      return [];
  }
}

function formatBucketName(bucket: string): string {
  const names: Record<string, string> = {
    'critical': 'Critical',
    'elevated': 'Elevated',
    'normal': 'Normal',
    'bulk': 'Bulk'
  };
  return names[bucket.toLowerCase()] || bucket;
}

async function refreshQueue() {
  loading.value = true;
  try {
    const api = (window as any)?.electronAPI;
    if (!api) return;

    const [queueResponse, statusResponse] = await Promise.all([
      api.invoke('nostr:nrs:queue:list'),
      api.invoke('nostr:nrs:init', {})
    ]);

    if (queueResponse?.success) {
      queueData.value = queueResponse.queue;
    }
    if (statusResponse?.success && statusResponse.status?.queueStats) {
      queueStats.value = statusResponse.status.queueStats;
    }
  } catch (error) {
    console.error('Failed to refresh queue:', error);
  } finally {
    loading.value = false;
  }
}

async function retryFailed() {
  if (!confirm('Retry all failed queue entries?')) return;
  
  loading.value = true;
  try {
    const failed = queueData.value.outgoing.failed || [];
    const api = (window as any)?.electronAPI;
    if (!api) return;

    let successCount = 0;
    let errorCount = 0;

    for (const entry of failed) {
      try {
        const response = await api.invoke('nostr:queue:retry', {
          tableName: entry.tableName,
          recordUuid: entry.recordUuid
        });
        if (response?.success) {
          successCount++;
        } else {
          errorCount++;
        }
      } catch (error) {
        errorCount++;
      }
    }

    if (errorCount > 0) {
      alert(`Retried ${successCount} entries. ${errorCount} failed.`);
    } else {
      alert(`Successfully retried ${successCount} entries.`);
    }

    await refreshQueue();
  } catch (error: any) {
    console.error('Failed to retry failed entries:', error);
    alert(`Error: ${error?.message || String(error)}`);
  } finally {
    loading.value = false;
  }
}

async function clearCompleted() {
  if (!confirm('Clear completed published events from the store?')) return;
  loading.value = true;
  try {
    const api = (window as any)?.electronAPI;
    if (!api) return;
    const res = await api.clearCompletedQueue({ stages: ['store_out'], olderThanSeconds: 0 });
    if (res?.success) {
      await refreshQueue();
      alert(`Removed ${res.removed} completed event(s).`);
    } else {
      alert(`Failed to clear: ${res?.error || 'Unknown error'}`);
    }
  } catch (e: any) {
    alert(`Error clearing: ${e?.message || String(e)}`);
  } finally {
    loading.value = false;
  }
}

function openHistory() {
  historyScope.value = null;
  historyOpen.value = true;
}

function handleViewHistory(payload: { tableName: string; recordUuid: string }) {
  historyScope.value = { tableName: payload.tableName, recordUuid: payload.recordUuid };
  historyOpen.value = true;
}

async function handleRetry(entry: QueueEntry) {
  loading.value = true;
  try {
    const api = (window as any)?.electronAPI;
    if (!api) return;

    const response = await api.invoke('nostr:queue:retry', {
      tableName: entry.tableName,
      recordUuid: entry.recordUuid
    });

    if (response?.success) {
      await refreshQueue();
    } else {
      alert(`Failed to retry: ${response?.error || 'Unknown error'}`);
    }
  } catch (error: any) {
    console.error('Failed to retry entry:', error);
    alert(`Error: ${error?.message || String(error)}`);
  } finally {
    loading.value = false;
  }
}

function handleViewDetails(entry: QueueEntry) {
  // TODO: Open details modal
  console.log('View details for entry:', entry);
}

function handleStatusUpdate(status: any) {
  if (status?.queueStats) {
    queueStats.value = status.queueStats;
  }
}

onMounted(() => {
  refreshQueue();
  
  // Listen for status updates
  const api = (window as any)?.electronAPI;
  if (api) {
    if (typeof api.on === 'function') {
      api.on('nostr:nrs:status', handleStatusUpdate);
    } else if (window.ipcRenderer) {
      window.ipcRenderer.on('nostr:nrs:status', (_event: any, status: any) => {
        handleStatusUpdate(status);
      });
    }
  }
});

onUnmounted(() => {
  const api = (window as any)?.electronAPI;
  if (api && typeof api.removeListener === 'function') {
    api.removeListener('nostr:nrs:status', handleStatusUpdate);
  } else if (window.ipcRenderer) {
    window.ipcRenderer.removeAllListeners('nostr:nrs:status');
  }
});
</script>

<style scoped>
.publishing-queue-dashboard {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.dashboard-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.dashboard-header h4 {
  margin: 0;
}

.header-actions {
  display: flex;
  gap: 8px;
}

.metrics-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 12px;
}

.metric-card {
  padding: 16px;
  background: var(--bg-secondary, #f5f5f5);
  border-radius: 4px;
  border: 1px solid var(--border-color, #ddd);
  text-align: center;
}

.metric-card.processing {
  border-color: #f57c00;
  background: #fff3e0;
}

.metric-card.completed {
  border-color: #2e7d32;
  background: #e8f5e9;
}

.metric-card.failed {
  border-color: #c62828;
  background: #ffebee;
}

.metric-label {
  font-size: 12px;
  color: var(--text-secondary, #666);
  margin-bottom: 8px;
}

.metric-value {
  font-size: 24px;
  font-weight: 600;
  color: var(--text-primary, #000);
}

.priority-summary {
  padding: 16px;
  background: var(--bg-secondary, #f5f5f5);
  border-radius: 4px;
  border: 1px solid var(--border-color, #ddd);
}

.priority-summary h5 {
  margin: 0 0 12px;
}

.priority-buckets {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 12px;
}

.priority-bucket-card {
  padding: 12px;
  background: white;
  border-radius: 4px;
  border: 2px solid var(--border-color, #ddd);
  text-align: center;
}

.priority-bucket-card.bucket-critical {
  border-color: #c62828;
  background: #ffebee;
}

.priority-bucket-card.bucket-elevated {
  border-color: #f57c00;
  background: #fff3e0;
}

.priority-bucket-card.bucket-normal {
  border-color: #1976d2;
  background: #e3f2fd;
}

.priority-bucket-card.bucket-bulk {
  border-color: #757575;
  background: #f5f5f5;
}

.bucket-label {
  font-size: 11px;
  color: var(--text-secondary, #666);
  margin-bottom: 4px;
}

.bucket-count {
  font-size: 20px;
  font-weight: 600;
  color: var(--text-primary, #000);
}

.bucket-percentage {
  font-size: 10px;
  color: var(--text-secondary, #666);
  margin-top: 4px;
}

.queue-tabs {
  display: flex;
  gap: 8px;
  border-bottom: 1px solid var(--border-color, #ddd);
}

.tab-button {
  padding: 8px 16px;
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  font-size: 13px;
  color: var(--text-secondary, #666);
}

.tab-button.active {
  color: var(--color-primary, #1976d2);
  border-bottom-color: var(--color-primary, #1976d2);
}

.btn-secondary {
  padding: 8px 16px;
  border-radius: 4px;
  border: 1px solid var(--border-color, #ddd);
  background: var(--bg-primary, white);
  cursor: pointer;
  font-size: 13px;
}

.btn-secondary:hover:not(:disabled) {
  opacity: 0.9;
}

.btn-secondary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>

