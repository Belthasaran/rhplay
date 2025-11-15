<template>
  <div class="profile-publishing-dashboard">
    <div class="dashboard-header">
      <h4>Profile Publishing</h4>
      <div class="header-actions">
        <button class="btn-primary" @click="publishProfile" :disabled="loading || !canPublish">
          {{ loading ? 'Publishing...' : 'Publish Profile' }}
        </button>
        <button class="btn-secondary" @click="refreshStatus" :disabled="loading">
          {{ loading ? 'Refreshing...' : 'Refresh' }}
        </button>
      </div>
    </div>

    <!-- Profile Status -->
    <div v-if="profileInfo" class="profile-status-section">
      <div class="status-card">
        <div class="status-header">
          <h5>Current Profile</h5>
          <span :class="['status-badge', `status-${profileStatus}`]">
            {{ profileStatusLabel }}
          </span>
        </div>
        
        <div class="profile-details">
          <div class="detail-row">
            <label>Profile ID:</label>
            <code class="mono">{{ profileInfo.profileId || 'N/A' }}</code>
          </div>
          <div class="detail-row">
            <label>Username:</label>
            <span>{{ profileInfo.username || 'Not set' }}</span>
          </div>
          <div class="detail-row">
            <label>Display Name:</label>
            <span>{{ profileInfo.displayName || 'Not set' }}</span>
          </div>
          <div class="detail-row">
            <label>Public Key:</label>
            <code class="mono">{{ formatPubkey(profileInfo.publicKey) }}</code>
            <button class="btn-link-small" @click="copyToClipboard(profileInfo.publicKey)">Copy</button>
          </div>
          <div v-if="profileInfo.hasNostrKeypair" class="detail-row">
            <label>Keypair Type:</label>
            <span>{{ profileInfo.keypairType || 'N/A' }}</span>
          </div>
        </div>
      </div>

      <!-- Publish Status -->
      <div v-if="publishStatus" class="status-card">
        <div class="status-header">
          <h5>Publish Status</h5>
        </div>
        <div class="publish-details">
          <div class="detail-row">
            <label>Last Published:</label>
            <span>{{ formatTimestamp(publishStatus.lastPublished) || 'Never' }}</span>
          </div>
          <div v-if="publishStatus.eventId" class="detail-row">
            <label>Event ID:</label>
            <code class="mono">{{ formatEventId(publishStatus.eventId) }}</code>
            <button class="btn-link-small" @click="copyToClipboard(publishStatus.eventId)">Copy</button>
          </div>
          <div v-if="publishStatus.queueStatus" class="detail-row">
            <label>Queue Status:</label>
            <span :class="['queue-status', `status-${publishStatus.queueStatus}`]">
              {{ formatQueueStatus(publishStatus.queueStatus) }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- No Profile Message -->
    <div v-else class="no-profile-message">
      <p>No profile configured. Please create a profile with a Nostr keypair to publish.</p>
      <button class="btn-primary" @click="$emit('create-profile')">
        Create Profile
      </button>
    </div>

    <!-- Publishing Preferences -->
    <div class="preferences-section">
      <h5>Publishing Preferences</h5>
      <div class="preferences-grid">
        <label class="preference-item">
          <input
            v-model="preferences.autoPublishProfile"
            type="checkbox"
          />
          <span>Auto-publish profile changes</span>
        </label>
        <label class="preference-item">
          <input
            v-model="preferences.includePicture"
            type="checkbox"
          />
          <span>Include profile picture</span>
        </label>
        <label class="preference-item">
          <input
            v-model="preferences.includeBanner"
            type="checkbox"
          />
          <span>Include banner image</span>
        </label>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';

type ProfileInfo = {
  profileId?: string;
  username?: string;
  displayName?: string;
  publicKey?: string;
  hasNostrKeypair?: boolean;
  keypairType?: string;
};

type PublishStatus = {
  lastPublished?: number;
  eventId?: string;
  queueStatus?: string;
};

const props = defineProps<{
  profileInfo?: ProfileInfo | null;
  publishStatus?: PublishStatus | null;
}>();

const emit = defineEmits<{
  'create-profile': [];
  'publish-profile': [];
  'refresh-status': [];
  'update-publish-status': [status: any];
}>();

const loading = ref(false);
const preferences = ref({
  autoPublishProfile: false,
  includePicture: true,
  includeBanner: true
});

const profileStatus = computed(() => {
  if (!props.profileInfo) return 'none';
  if (!props.profileInfo.hasNostrKeypair) return 'no-keypair';
  if (props.publishStatus?.queueStatus === 'completed') return 'published';
  if (props.publishStatus?.queueStatus === 'pending' || props.publishStatus?.queueStatus === 'processing') return 'publishing';
  if (props.publishStatus?.lastPublished) return 'published';
  return 'ready';
});

const profileStatusLabel = computed(() => {
  const status = profileStatus.value;
  const labels: Record<string, string> = {
    'none': 'No Profile',
    'no-keypair': 'No Nostr Keypair',
    'ready': 'Ready to Publish',
    'publishing': 'Publishing...',
    'published': 'Published'
  };
  return labels[status] || 'Unknown';
});

const canPublish = computed(() => {
  return props.profileInfo?.hasNostrKeypair && profileStatus.value !== 'publishing';
});

async function publishProfile() {
  loading.value = true;
  try {
    const api = (window as any)?.electronAPI;
    if (!api) return;

    const result = await api.publishProfileToNostr({
      profileUuid: props.profileInfo?.profileId,
      includePicture: preferences.value.includePicture,
      includeBanner: preferences.value.includeBanner
    });

    if (result?.success) {
      alert('Profile published successfully!');
      await refreshStatus();
    } else {
      alert(`Failed to publish profile: ${result?.error || 'Unknown error'}`);
    }
  } catch (error: any) {
    console.error('Failed to publish profile:', error);
    alert(`Error: ${error?.message || String(error)}`);
  } finally {
    loading.value = false;
  }
}

async function refreshStatus() {
  loading.value = true;
  try {
    const api = (window as any)?.electronAPI;
    if (!api) return;

    // Emit event to parent to refresh profile info
    emit('refresh-status');
    
    // Also refresh publish status
    const statusResult = await api.getProfilePublishStatus();
    if (statusResult?.success) {
      // Update publish status via emit or props update
      emit('update-publish-status', statusResult.status);
    }
  } finally {
    loading.value = false;
  }
}

function formatPubkey(pubkey: string | undefined): string {
  if (!pubkey) return 'N/A';
  if (pubkey.length > 16) {
    return pubkey.substring(0, 8) + '…' + pubkey.substring(pubkey.length - 8);
  }
  return pubkey;
}

function formatEventId(eventId: string | undefined): string {
  if (!eventId) return 'N/A';
  if (eventId.length > 16) {
    return eventId.substring(0, 8) + '…' + eventId.substring(eventId.length - 8);
  }
  return eventId;
}

function formatTimestamp(timestamp: number | undefined): string {
  if (!timestamp) return '';
  const date = new Date(timestamp * 1000);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
  if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
  if (seconds > 0) return `${seconds} second${seconds > 1 ? 's' : ''} ago`;
  return 'Just now';
}

function formatQueueStatus(status: string | undefined): string {
  if (!status) return 'Unknown';
  const statusMap: Record<string, string> = {
    'pending': 'Pending',
    'processing': 'Processing',
    'completed': 'Completed',
    'failed': 'Failed'
  };
  return statusMap[status] || status;
}

async function copyToClipboard(text: string | undefined) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    // Could show a toast notification here
  } catch (error) {
    console.error('Failed to copy to clipboard:', error);
  }
}

onMounted(() => {
  // Load preferences from storage and apply
  (async () => {
    try {
      const api = (window as any)?.electronAPI;
      if (!api) return;
      const res = await api.getProfilePublishingPreferences();
      if (res?.success && res.preferences) {
        preferences.value = {
          autoPublishProfile: !!res.preferences.autoPublishProfile,
          includePicture: res.preferences.includePicture !== false,
          includeBanner: res.preferences.includeBanner !== false
        };
      }
    } catch (e) {
      console.warn('[ProfilePublishing] Failed to load preferences');
    }
  })();
});

// Persist preferences when changed (debounced)
let _prefSaveTimeout: any = null;
watch(preferences, (val) => {
  const api = (window as any)?.electronAPI;
  if (!api) return;
  if (_prefSaveTimeout) clearTimeout(_prefSaveTimeout);
  _prefSaveTimeout = setTimeout(() => {
    api.setProfilePublishingPreferences({
      autoPublishProfile: !!val.autoPublishProfile,
      includePicture: !!val.includePicture,
      includeBanner: !!val.includeBanner,
    }).catch(() => {});
  }, 300);
}, { deep: true });
</script>

<style scoped>
.profile-publishing-dashboard {
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

.profile-status-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.status-card {
  padding: 16px;
  background: var(--bg-secondary, #f5f5f5);
  border-radius: 4px;
  border: 1px solid var(--border-color, #ddd);
}

.status-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.status-header h5 {
  margin: 0;
}

.status-badge {
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 600;
}

.status-badge.status-none {
  background: #f5f5f5;
  color: #757575;
}

.status-badge.status-no-keypair {
  background: #fff3e0;
  color: #f57c00;
}

.status-badge.status-ready {
  background: #e3f2fd;
  color: #1976d2;
}

.status-badge.status-publishing {
  background: #fff3e0;
  color: #f57c00;
}

.status-badge.status-published {
  background: #e8f5e9;
  color: #2e7d32;
}

.profile-details,
.publish-details {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.detail-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}

.detail-row label {
  font-weight: 600;
  min-width: 120px;
  color: var(--text-secondary, #666);
}

.mono {
  font-family: monospace;
  font-size: 11px;
  background: var(--bg-primary, white);
  padding: 2px 6px;
  border-radius: 3px;
}

.btn-link-small {
  background: none;
  border: none;
  color: var(--color-primary, #1976d2);
  cursor: pointer;
  text-decoration: underline;
  font-size: 11px;
  padding: 0;
}

.btn-link-small:hover {
  opacity: 0.8;
}

.queue-status {
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 600;
}

.queue-status.status-pending {
  background: #fff3e0;
  color: #f57c00;
}

.queue-status.status-processing {
  background: #e3f2fd;
  color: #1976d2;
}

.queue-status.status-completed {
  background: #e8f5e9;
  color: #2e7d32;
}

.queue-status.status-failed {
  background: #ffebee;
  color: #c62828;
}

.no-profile-message {
  padding: 24px;
  text-align: center;
  background: var(--bg-secondary, #f5f5f5);
  border-radius: 4px;
  border: 1px solid var(--border-color, #ddd);
}

.preferences-section {
  padding: 16px;
  background: var(--bg-secondary, #f5f5f5);
  border-radius: 4px;
  border: 1px solid var(--border-color, #ddd);
}

.preferences-section h5 {
  margin: 0 0 12px;
}

.preferences-grid {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.preference-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  cursor: pointer;
}

.btn-primary,
.btn-secondary {
  padding: 8px 16px;
  border-radius: 4px;
  border: 1px solid var(--border-color, #ddd);
  cursor: pointer;
  font-size: 13px;
}

.btn-primary {
  background: var(--color-primary, #1976d2);
  color: white;
  border-color: var(--color-primary, #1976d2);
}

.btn-secondary {
  background: var(--bg-primary, white);
}

.btn-primary:hover:not(:disabled),
.btn-secondary:hover:not(:disabled) {
  opacity: 0.9;
}

.btn-primary:disabled,
.btn-secondary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>

