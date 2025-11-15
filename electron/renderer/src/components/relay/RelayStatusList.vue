<template>
  <div class="relay-status-list">
    <div class="list-header">
      <h5>Relay Status</h5>
      <div class="list-controls">
        <label>
          <input
            v-model="showOnlyActive"
            type="checkbox"
          />
          Show Only Active
        </label>
        <label>
          <input
            v-model="sortByStatus"
            type="checkbox"
          />
          Sort by Status
        </label>
      </div>
    </div>

    <div v-if="loading && filteredRelays.length === 0" class="loading-message">
      Loading relay status...
    </div>

    <div v-else-if="filteredRelays.length === 0" class="empty-message">
      No relays found
    </div>

    <div v-else class="relay-table-container">
      <table class="relay-table">
        <thead>
          <tr>
            <th>Status</th>
            <th>Relay URL</th>
            <th>Label</th>
            <th>Categories</th>
            <th>Success/Fail</th>
            <th>Last Activity</th>
            <th>Cooldown</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="relay in filteredRelays"
            :key="relay.relayUrl"
            :class="['relay-row', `status-${getRelayStatus(relay.relayUrl)}`]"
          >
            <td>
              <div class="status-indicator">
                <span :class="['status-dot', `status-${getRelayStatus(relay.relayUrl)}`]"></span>
                <span class="status-text">{{ formatStatus(getRelayStatus(relay.relayUrl)) }}</span>
              </div>
            </td>
            <td>
              <code class="relay-url">{{ relay.relayUrl }}</code>
            </td>
            <td>{{ relay.label || '-' }}</td>
            <td>
              <div class="categories">
                <span
                  v-for="cat in (relay.categories || [])"
                  :key="cat"
                  class="category-badge"
                >
                  {{ cat }}
                </span>
              </div>
            </td>
            <td>
              <div class="success-fail">
                <span class="success-count">{{ getHealthInfo(relay.relayUrl)?.successCount || 0 }}</span>
                /
                <span class="fail-count">{{ getHealthInfo(relay.relayUrl)?.failureCount || 0 }}</span>
              </div>
            </td>
            <td>
              <div class="last-activity">
                <div v-if="getLastSuccess(relay.relayUrl)" class="last-success">
                  ✓ {{ formatTime(getLastSuccess(relay.relayUrl)) }}
                </div>
                <div v-if="getLastFailure(relay.relayUrl)" class="last-failure">
                  ✗ {{ formatTime(getLastFailure(relay.relayUrl)) }}
                </div>
                <div v-if="!getLastSuccess(relay.relayUrl) && !getLastFailure(relay.relayUrl)">
                  Never
                </div>
              </div>
            </td>
            <td>
              <div v-if="getCooldownUntil(relay.relayUrl)" class="cooldown-info">
                <div class="cooldown-time">{{ formatCooldown(getCooldownUntil(relay.relayUrl)) }}</div>
                <div v-if="getHealthInfo(relay.relayUrl)?.lastError" class="cooldown-error" :title="getHealthInfo(relay.relayUrl)?.lastError">
                  {{ truncateError(getHealthInfo(relay.relayUrl)?.lastError) }}
                </div>
              </div>
              <span v-else>-</span>
            </td>
            <td>
              <div class="action-buttons">
                <button
                  v-if="getRelayStatus(relay.relayUrl) !== 'healthy'"
                  class="btn-action btn-connect"
                  @click="$emit('connect', relay.relayUrl)"
                  :title="'Connect to ' + relay.relayUrl"
                >
                  Connect
                </button>
                <button
                  v-if="getRelayStatus(relay.relayUrl) === 'healthy' || getRelayStatus(relay.relayUrl) === 'connecting'"
                  class="btn-action btn-disconnect"
                  @click="$emit('disconnect', relay.relayUrl)"
                  :title="'Disconnect from ' + relay.relayUrl"
                >
                  Disconnect
                </button>
                <button
                  v-if="getRelayStatus(relay.relayUrl) === 'cooldown'"
                  class="btn-action btn-retry"
                  @click="$emit('retry', relay.relayUrl)"
                  :title="'Retry connection to ' + relay.relayUrl"
                >
                  Retry
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
import { computed, ref } from 'vue';

type RelayHealth = {
  relayUrl: string;
  status: 'unknown' | 'connecting' | 'healthy' | 'cooldown';
  failureCount: number;
  successCount: number;
  lastFailure: number | null;
  lastSuccess: number | null;
  cooldownUntil: number | null;
  backoffMs: number;
  lastError: string | null;
};

type Relay = {
  relayUrl: string;
  label?: string;
  categories?: string[];
  priority?: number;
  read?: number;
  write?: number;
  addedBy?: string;
};

const props = defineProps<{
  relays: Relay[];
  health: RelayHealth[];
  loading?: boolean;
}>();

defineEmits<{
  connect: [relayUrl: string];
  disconnect: [relayUrl: string];
  retry: [relayUrl: string];
}>();

const showOnlyActive = ref(false);
const sortByStatus = ref(true);

const healthMap = computed(() => {
  const map = new Map<string, RelayHealth>();
  props.health.forEach(h => {
    map.set(h.relayUrl, h);
  });
  return map;
});

function getHealthInfo(relayUrl: string): RelayHealth | undefined {
  return healthMap.value.get(relayUrl);
}

function getRelayStatus(relayUrl: string): string {
  const health = getHealthInfo(relayUrl);
  return health?.status || 'unknown';
}

function getLastSuccess(relayUrl: string): number | null {
  return getHealthInfo(relayUrl)?.lastSuccess || null;
}

function getLastFailure(relayUrl: string): number | null {
  return getHealthInfo(relayUrl)?.lastFailure || null;
}

function getCooldownUntil(relayUrl: string): number | null {
  return getHealthInfo(relayUrl)?.cooldownUntil || null;
}

const filteredRelays = computed(() => {
  let filtered = [...props.relays];
  
  if (showOnlyActive.value) {
    filtered = filtered.filter(r => {
      const status = getRelayStatus(r.relayUrl);
      return status === 'healthy' || status === 'connecting';
    });
  }
  
  if (sortByStatus.value) {
    const statusOrder = { 'healthy': 0, 'connecting': 1, 'unknown': 2, 'cooldown': 3 };
    filtered.sort((a, b) => {
      const statusA = getRelayStatus(a.relayUrl);
      const statusB = getRelayStatus(b.relayUrl);
      return (statusOrder[statusA as keyof typeof statusOrder] || 99) - 
             (statusOrder[statusB as keyof typeof statusOrder] || 99);
    });
  }
  
  return filtered;
});

function formatStatus(status: string): string {
  const statusMap: Record<string, string> = {
    'healthy': 'Healthy',
    'connecting': 'Connecting',
    'cooldown': 'Cooldown',
    'unknown': 'Unknown'
  };
  return statusMap[status] || status;
}

function formatTime(timestamp: number | null): string {
  if (!timestamp) return 'Never';
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return `${seconds}s ago`;
}

function formatCooldown(cooldownUntil: number | null): string {
  if (!cooldownUntil) return '';
  const now = Date.now();
  const diff = cooldownUntil - now;
  if (diff <= 0) return 'Ready';
  
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

function truncateError(error: string | null): string {
  if (!error) return '';
  if (error.length <= 40) return error;
  return error.substring(0, 37) + '...';
}
</script>

<style scoped>
.relay-status-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.list-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.list-header h5 {
  margin: 0;
}

.list-controls {
  display: flex;
  gap: 16px;
}

.list-controls label {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  cursor: pointer;
}

.loading-message,
.empty-message {
  padding: 24px;
  text-align: center;
  color: var(--text-secondary, #666);
}

.relay-table-container {
  overflow-x: auto;
  border: 1px solid var(--border-color, #ddd);
  border-radius: 4px;
}

.relay-table {
  width: 100%;
  border-collapse: collapse;
  background: white;
}

.relay-table thead {
  background: var(--bg-secondary, #f5f5f5);
}

.relay-table th {
  padding: 12px;
  text-align: left;
  font-weight: 600;
  font-size: 12px;
  color: var(--text-secondary, #666);
  border-bottom: 2px solid var(--border-color, #ddd);
}

.relay-table td {
  padding: 12px;
  border-bottom: 1px solid var(--border-color, #ddd);
  font-size: 13px;
}

.relay-row:hover {
  background: var(--bg-secondary, #f5f5f5);
}

.relay-row.status-healthy {
  background: #e8f5e9;
}

.relay-row.status-connecting {
  background: #fff3e0;
}

.relay-row.status-cooldown {
  background: #ffebee;
}

.status-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
}

.status-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  display: inline-block;
}

.status-dot.status-healthy {
  background: #2e7d32;
}

.status-dot.status-connecting {
  background: #f57c00;
}

.status-dot.status-cooldown {
  background: #c62828;
}

.status-dot.status-unknown {
  background: #757575;
}

.status-text {
  font-weight: 500;
}

.relay-url {
  font-family: monospace;
  font-size: 11px;
  background: var(--bg-secondary, #f5f5f5);
  padding: 2px 6px;
  border-radius: 3px;
}

.categories {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.category-badge {
  padding: 2px 6px;
  background: var(--bg-secondary, #f5f5f5);
  border-radius: 12px;
  font-size: 11px;
  color: var(--text-secondary, #666);
}

.success-fail {
  font-family: monospace;
  font-size: 12px;
}

.success-count {
  color: #2e7d32;
  font-weight: 600;
}

.fail-count {
  color: #c62828;
  font-weight: 600;
}

.last-activity {
  font-size: 12px;
}

.last-success {
  color: #2e7d32;
}

.last-failure {
  color: #c62828;
}

.cooldown-info {
  font-size: 12px;
}

.cooldown-time {
  color: #c62828;
  font-weight: 600;
}

.cooldown-error {
  color: var(--text-secondary, #666);
  font-size: 11px;
  margin-top: 2px;
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

.btn-connect {
  color: #2e7d32;
  border-color: #2e7d32;
}

.btn-disconnect {
  color: #c62828;
  border-color: #c62828;
}

.btn-retry {
  color: #f57c00;
  border-color: #f57c00;
}
</style>

