<template>
  <div class="publishing-queue-list">
    <div v-if="loading && entries.length === 0" class="loading-message">
      Loading queue entries...
    </div>

    <div v-else-if="entries.length === 0" class="empty-message">
      No entries in this queue
    </div>

    <div v-else class="queue-table-container">
      <table class="queue-table">
        <thead>
          <tr>
            <th>Event ID</th>
            <th>Kind</th>
            <th>Table</th>
            <th>Record UUID</th>
            <th>Created</th>
            <th>Processed</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="entry in entries"
            :key="entry.id"
            class="queue-row"
          >
            <td>
              <code class="event-id">{{ formatEventId(entry.id) }}</code>
            </td>
            <td>
              <span class="kind-badge">{{ entry.kind }}</span>
              <span class="kind-name">{{ getKindName(entry.kind) }}</span>
            </td>
            <td>
              <code class="table-name">{{ entry.tableName }}</code>
            </td>
            <td>
              <code class="record-uuid">{{ formatUuid(entry.recordUuid) }}</code>
            </td>
            <td>
              <div class="timestamp">{{ formatTimestamp(entry.createdAt) }}</div>
            </td>
            <td>
              <div v-if="entry.processedAt" class="timestamp">
                {{ formatTimestamp(entry.processedAt) }}
              </div>
              <span v-else class="no-timestamp">-</span>
            </td>
            <td>
              <span :class="['status-badge', `status-${getStatusClass(entry.procStatus)}`]">
                {{ getStatusLabel(entry.procStatus) }}
              </span>
            </td>
            <td>
              <div class="action-buttons">
                <button
                  v-if="entry.procStatus < 0"
                  class="btn-action btn-retry"
                  @click="$emit('retry', entry)"
                  title="Retry this entry"
                >
                  Retry
                </button>
                <button
                  class="btn-action btn-view"
                  @click="$emit('view-details', entry)"
                  title="View details"
                >
                  Details
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
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

const props = defineProps<{
  entries: QueueEntry[];
  loading?: boolean;
}>();

defineEmits<{
  retry: [entry: QueueEntry];
  'view-details': [entry: QueueEntry];
}>();

function formatEventId(id: string): string {
  if (!id) return 'N/A';
  if (id.length > 16) {
    return id.substring(0, 8) + '…' + id.substring(id.length - 8);
  }
  return id;
}

function formatUuid(uuid: string): string {
  if (!uuid) return 'N/A';
  if (uuid.length > 16) {
    return uuid.substring(0, 8) + '…' + uuid.substring(uuid.length - 8);
  }
  return uuid;
}

function formatTimestamp(timestamp: number): string {
  if (!timestamp) return '-';
  const date = new Date(timestamp * 1000);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  if (seconds > 0) return `${seconds}s ago`;
  return 'Just now';
}

function getKindName(kind: number): string {
  const kindNames: Record<number, string> = {
    0: 'Profile',
    3: 'Contacts',
    31001: 'Rating',
    31106: 'Admin Declaration',
    31107: 'Trust Assignment'
  };
  return kindNames[kind] || 'Unknown';
}

function getStatusLabel(procStatus: number): string {
  if (procStatus === 0) return 'Pending';
  if (procStatus === 1) return 'Processing';
  if (procStatus === 2) return 'Completed';
  if (procStatus < 0) return 'Failed';
  return 'Unknown';
}

function getStatusClass(procStatus: number): string {
  if (procStatus === 0) return 'pending';
  if (procStatus === 1) return 'processing';
  if (procStatus === 2) return 'completed';
  if (procStatus < 0) return 'failed';
  return 'unknown';
}
</script>

<style scoped>
.publishing-queue-list {
  display: flex;
  flex-direction: column;
}

.loading-message,
.empty-message {
  padding: 24px;
  text-align: center;
  color: var(--text-secondary, #666);
}

.queue-table-container {
  overflow-x: auto;
  border: 1px solid var(--border-color, #ddd);
  border-radius: 4px;
}

.queue-table {
  width: 100%;
  border-collapse: collapse;
  background: white;
}

.queue-table thead {
  background: var(--bg-secondary, #f5f5f5);
}

.queue-table th {
  padding: 12px;
  text-align: left;
  font-weight: 600;
  font-size: 12px;
  color: var(--text-secondary, #666);
  border-bottom: 2px solid var(--border-color, #ddd);
}

.queue-table td {
  padding: 12px;
  border-bottom: 1px solid var(--border-color, #ddd);
  font-size: 13px;
}

.queue-row:hover {
  background: var(--bg-secondary, #f5f5f5);
}

.event-id,
.table-name,
.record-uuid {
  font-family: monospace;
  font-size: 11px;
  background: var(--bg-secondary, #f5f5f5);
  padding: 2px 6px;
  border-radius: 3px;
}

.kind-badge {
  display: inline-block;
  padding: 2px 6px;
  background: var(--bg-secondary, #f5f5f5);
  border-radius: 12px;
  font-size: 11px;
  font-weight: 600;
  margin-right: 6px;
}

.kind-name {
  font-size: 12px;
  color: var(--text-secondary, #666);
}

.timestamp {
  font-size: 12px;
  color: var(--text-primary, #000);
}

.no-timestamp {
  color: var(--text-secondary, #666);
  font-style: italic;
}

.status-badge {
  display: inline-block;
  padding: 4px 8px;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 600;
}

.status-badge.status-pending {
  background: #fff3e0;
  color: #f57c00;
}

.status-badge.status-processing {
  background: #e3f2fd;
  color: #1976d2;
}

.status-badge.status-completed {
  background: #e8f5e9;
  color: #2e7d32;
}

.status-badge.status-failed {
  background: #ffebee;
  color: #c62828;
}

.status-badge.status-unknown {
  background: #f5f5f5;
  color: #757575;
}

.action-buttons {
  display: flex;
  gap: 4px;
}

.btn-action {
  padding: 4px 8px;
  border-radius: 3px;
  border: 1px solid var(--border-color, #ddd);
  background: var(--bg-primary, white);
  cursor: pointer;
  font-size: 11px;
  white-space: nowrap;
}

.btn-action:hover {
  opacity: 0.9;
}

.btn-retry {
  color: #f57c00;
  border-color: #f57c00;
}

.btn-view {
  color: #1976d2;
  border-color: #1976d2;
}
</style>

