<template>
  <div class="relay-health-dashboard">
    <div class="dashboard-header">
      <h4>Relay Health Dashboard</h4>
      <div class="header-actions">
        <button class="btn-secondary" @click="refreshHealth" :disabled="loading">
          {{ loading ? 'Refreshing...' : 'Refresh' }}
        </button>
        <button class="btn-secondary" @click="connectAll" :disabled="loading || !canConnect">
          Connect All
        </button>
        <button class="btn-secondary" @click="disconnectAll" :disabled="loading || !canDisconnect">
          Disconnect All
        </button>
      </div>
    </div>

    <!-- Overview Metrics -->
    <div class="metrics-grid">
      <div class="metric-card">
        <div class="metric-label">Total Relays</div>
        <div class="metric-value">{{ totalRelays }}</div>
      </div>
      <div class="metric-card healthy">
        <div class="metric-label">Healthy</div>
        <div class="metric-value">{{ healthyCount }}</div>
      </div>
      <div class="metric-card connecting">
        <div class="metric-label">Connecting</div>
        <div class="metric-value">{{ connectingCount }}</div>
      </div>
      <div class="metric-card cooldown">
        <div class="metric-label">In Cooldown</div>
        <div class="metric-value">{{ cooldownCount }}</div>
      </div>
      <div class="metric-card unknown">
        <div class="metric-label">Unknown</div>
        <div class="metric-value">{{ unknownCount }}</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Success Rate</div>
        <div class="metric-value">{{ successRate }}%</div>
      </div>
    </div>

    <!-- Relay Status List -->
    <RelayStatusList
      :relays="relays"
      :health="health"
      :loading="loading"
      @connect="handleConnect"
      @disconnect="handleDisconnect"
      @retry="handleRetry"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import RelayStatusList from './RelayStatusList.vue';

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

const loading = ref(false);
const relays = ref<Relay[]>([]);
const health = ref<RelayHealth[]>([]);
const runtimeStatus = ref<any>(null);

const totalRelays = computed(() => relays.value.length);
const healthyCount = computed(() => health.value.filter(h => h.status === 'healthy').length);
const connectingCount = computed(() => health.value.filter(h => h.status === 'connecting').length);
const cooldownCount = computed(() => health.value.filter(h => h.status === 'cooldown').length);
const unknownCount = computed(() => health.value.filter(h => h.status === 'unknown').length);

const successRate = computed(() => {
  const total = health.value.reduce((sum, h) => sum + h.successCount + h.failureCount, 0);
  if (total === 0) return 0;
  const successes = health.value.reduce((sum, h) => sum + h.successCount, 0);
  return Math.round((successes / total) * 100);
});

const canConnect = computed(() => {
  // Can connect if we have relays and service is available
  return relays.value.length > 0;
});

const canDisconnect = computed(() => {
  // Can disconnect if we have any healthy or connecting relays
  return health.value.some(h => h.status === 'healthy' || h.status === 'connecting');
});

async function refreshHealth() {
  loading.value = true;
  try {
    const api = (window as any)?.electronAPI;
    if (!api) return;

    const [relaysResponse, healthResponse] = await Promise.all([
      api.invoke('nostr:nrs:relays:list'),
      api.invoke('nostr:nrs:relay-health:get')
    ]);

    if (relaysResponse?.success) {
      relays.value = relaysResponse.relays || [];
    }
    if (healthResponse?.success) {
      health.value = healthResponse.health || [];
    }
  } catch (error) {
    console.error('Failed to refresh relay health:', error);
  } finally {
    loading.value = false;
  }
}

async function connectAll() {
  loading.value = true;
  try {
    const api = (window as any)?.electronAPI;
    if (!api) return;

    const response = await api.invoke('nostr:nrs:relay:connect', {});
    if (response?.success) {
      await refreshHealth();
    } else {
      alert(`Failed to connect: ${response?.error || 'Unknown error'}`);
    }
  } catch (error: any) {
    console.error('Failed to connect all relays:', error);
    alert(`Error: ${error?.message || String(error)}`);
  } finally {
    loading.value = false;
  }
}

async function disconnectAll() {
  loading.value = true;
  try {
    const api = (window as any)?.electronAPI;
    if (!api) return;

    const response = await api.invoke('nostr:nrs:relay:disconnect', {});
    if (response?.success) {
      await refreshHealth();
    } else {
      alert(`Failed to disconnect: ${response?.error || 'Unknown error'}`);
    }
  } catch (error: any) {
    console.error('Failed to disconnect all relays:', error);
    alert(`Error: ${error?.message || String(error)}`);
  } finally {
    loading.value = false;
  }
}

async function handleConnect(relayUrl: string) {
  loading.value = true;
  try {
    const api = (window as any)?.electronAPI;
    if (!api) return;

    const response = await api.invoke('nostr:nrs:relay:connect', { relayUrl });
    if (response?.success) {
      await refreshHealth();
    } else {
      alert(`Failed to connect relay: ${response?.error || 'Unknown error'}`);
    }
  } catch (error: any) {
    console.error('Failed to connect relay:', error);
    alert(`Error: ${error?.message || String(error)}`);
  } finally {
    loading.value = false;
  }
}

async function handleDisconnect(relayUrl: string) {
  loading.value = true;
  try {
    const api = (window as any)?.electronAPI;
    if (!api) return;

    const response = await api.invoke('nostr:nrs:relay:disconnect', { relayUrl });
    if (response?.success) {
      await refreshHealth();
    } else {
      alert(`Failed to disconnect relay: ${response?.error || 'Unknown error'}`);
    }
  } catch (error: any) {
    console.error('Failed to disconnect relay:', error);
    alert(`Error: ${error?.message || String(error)}`);
  } finally {
    loading.value = false;
  }
}

async function handleRetry(relayUrl: string) {
  loading.value = true;
  try {
    const api = (window as any)?.electronAPI;
    if (!api) return;

    const response = await api.invoke('nostr:nrs:relay:retry', { relayUrl });
    if (response?.success) {
      await refreshHealth();
    } else {
      alert(`Failed to retry relay: ${response?.error || 'Unknown error'}`);
    }
  } catch (error: any) {
    console.error('Failed to retry relay:', error);
    alert(`Error: ${error?.message || String(error)}`);
  } finally {
    loading.value = false;
  }
}

function handleStatusUpdate(status: any) {
  runtimeStatus.value = status;
  if (status?.relayHealth) {
    health.value = status.relayHealth;
  }
  if (status?.relays) {
    relays.value = status.relays;
  }
}

onMounted(() => {
  refreshHealth();
  
  // Listen for status updates from IPC
  const api = (window as any)?.electronAPI;
  if (api) {
    // Use ipcRenderer.on if available
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
.relay-health-dashboard {
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

.metric-card.healthy {
  border-color: #2e7d32;
  background: #e8f5e9;
}

.metric-card.connecting {
  border-color: #f57c00;
  background: #fff3e0;
}

.metric-card.cooldown {
  border-color: #c62828;
  background: #ffebee;
}

.metric-card.unknown {
  border-color: #757575;
  background: #f5f5f5;
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

