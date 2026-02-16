<template>
  <div v-if="visible" class="modal-backdrop" @click.self.prevent>
    <div class="modal software-update-dialog">
      <header class="modal-header">
        <h3>Software Update</h3>
        <button v-if="!isBlocking" class="close" @click="handleCancel">✕</button>
      </header>
      <section class="modal-body">
        <!-- Version Info -->
        <div class="version-info">
          <div class="version-current">
            <strong>Current Version:</strong> {{ updateInfo.currentVersion || 'Unknown' }}
          </div>
          <div class="version-available">
            <strong>Available Version:</strong> {{ updateInfo.availableVersion || 'Unknown' }}
          </div>
        </div>

        <!-- Old Version Warning -->
        <div v-if="updateInfo.localVersionExists && updateInfo.localVersionMatches" class="warning-box">
          <p>The file you just launched is an old version of this program (current version).</p>
          <p>You already have the new version.</p>
        </div>

        <!-- Update Message -->
        <div v-if="updateInfo.entry?.message" class="message-box">
          <h4>Message:</h4>
          <p>{{ parseMessage(updateInfo.entry.message) }}</p>
        </div>

        <!-- Update Details -->
        <div class="update-details">
          <h4>Update Details:</h4>
          
          <!-- Pointer -->
          <div v-if="updateInfo.entry?.pointer" class="detail-row">
            <label>Arbitrum One Pointer:</label>
            <a @click="openPointer" class="clickable-link">{{ updateInfo.entry.pointer }}</a>
          </div>

          <!-- Source Filename -->
          <div v-if="updateInfo.entry?.source_filename" class="detail-row">
            <label>Source Filename:</label>
            <span>{{ updateInfo.entry.source_filename }}</span>
          </div>

          <!-- Version -->
          <div v-if="updateInfo.entry?.version" class="detail-row">
            <label>Version:</label>
            <span>{{ updateInfo.entry.version }}</span>
          </div>

          <!-- Updated -->
          <div v-if="updateInfo.entry?.updated" class="detail-row">
            <label>Updated:</label>
            <span>{{ updateInfo.entry.updated }} ({{ formatTimestamp(updateInfo.entry.updated) }})</span>
          </div>

          <!-- SHA256 -->
          <div v-if="updateInfo.entry?.sha256" class="detail-row">
            <label>SHA256:</label>
            <span class="hash-value">{{ updateInfo.entry.sha256 }}</span>
          </div>

          <!-- File URL (addr) -->
          <div v-if="updateInfo.entry?.addr" class="detail-row">
            <label>File URL:</label>
            <div class="link-list">
              <a 
                v-for="(url, idx) in parseLinks(updateInfo.entry.addr)" 
                :key="idx"
                @click="openUrl(url)"
                class="clickable-link"
              >
                [Announcement Link {{ idx + 1 }}]
              </a>
            </div>
          </div>

          <!-- Base64 URL (baddr) -->
          <div v-if="updateInfo.entry?.baddr" class="detail-row">
            <label>Base64 URL:</label>
            <span class="b64-value">{{ updateInfo.entry.baddr }}</span>
          </div>

          <!-- IPFS CID -->
          <div v-if="updateInfo.entry?.ipfs_cidv1" class="detail-row">
            <label>IPFS CID:</label>
            <div class="link-with-dropdown">
              <a @click="openIPFS(updateInfo.entry.ipfs_cidv1, selectedIPFSGateway)" class="clickable-link">
                {{ updateInfo.entry.ipfs_cidv1 }}
              </a>
              <select v-model="selectedIPFSGateway" class="gateway-dropdown">
                <option v-for="gateway in ipfsGateways" :key="gateway" :value="gateway">
                  {{ gateway }}
                </option>
              </select>
            </div>
          </div>

          <!-- ArWeave Data TXID -->
          <div v-if="updateInfo.entry?.data_txid" class="detail-row">
            <label>ArWeave Data TXID:</label>
            <div class="link-with-dropdown">
              <a @click="openArWeave(updateInfo.entry.data_txid, selectedArWeaveGateway)" class="clickable-link">
                ar://{{ updateInfo.entry.data_txid }}
              </a>
              <select v-model="selectedArWeaveGateway" class="gateway-dropdown">
                <option v-for="gateway in arweaveGateways" :key="gateway" :value="gateway">
                  {{ gateway }}
                </option>
              </select>
            </div>
          </div>

          <!-- Links (announcement) -->
          <div v-if="updateInfo.entry?.link" class="detail-row">
            <label>Announcement Links:</label>
            <div class="link-list">
              <a 
                v-for="(link, idx) in parseLinks(updateInfo.entry.link)" 
                :key="idx"
                @click="openUrl(link)"
                class="clickable-link"
              >
                [Announcement Link {{ idx + 1 }}]
              </a>
            </div>
          </div>
        </div>

        <!-- Progress Indicator -->
        <div v-if="updateInfo.updateState === 'downloading' || updateInfo.updateState === 'verifying'" class="progress-section">
          <div class="progress-bar-container">
            <div class="progress-bar" :style="{ width: progressPercent + '%' }"></div>
          </div>
          <div class="progress-text">{{ updateInfo.progress?.message || 'Processing...' }}</div>
          <div v-if="updateInfo.progress?.total > 0" class="progress-details">
            {{ formatBytes(updateInfo.progress.current) }} / {{ formatBytes(updateInfo.progress.total) }}
            ({{ progressPercent }}%)
          </div>
        </div>

        <!-- Error Message -->
        <div v-if="updateInfo.updateState === 'error'" class="error-box">
          <p><strong>Error:</strong> {{ updateInfo.error || 'Unknown error occurred' }}</p>
        </div>

        <!-- Success Message -->
        <div v-if="updateInfo.updateState === 'completed'" class="success-box">
          <p><strong>Update completed successfully!</strong></p>
          <p>The new version has been downloaded and verified.</p>
        </div>
      </section>
      <footer class="modal-footer">
        <!-- Old Version Dialog Buttons -->
        <template v-if="updateInfo.localVersionExists && updateInfo.localVersionMatches">
          <button @click="handleExit" class="btn-primary">Exit now</button>
          <button @click="handleSkip" class="btn-secondary">Launch old version anyway</button>
        </template>
        
        <!-- Update Completed Buttons -->
        <template v-else-if="updateInfo.updateState === 'completed'">
          <button @click="handleLaunchNew" class="btn-primary" autofocus>Launch new version</button>
          <button @click="handleCancel" class="btn-secondary">Cancel</button>
        </template>
        
        <!-- Initial/Idle State Buttons -->
        <template v-else-if="updateInfo.updateState === 'idle' || !updateInfo.updateState">
          <button @click="handleUpdate" class="btn-primary" autofocus :disabled="isProcessing">
            Yes, update now
          </button>
          <button @click="handleSkip" class="btn-secondary" :disabled="isProcessing">
            No, continue with current version
          </button>
        </template>
        
        <!-- Processing State (buttons disabled) -->
        <template v-else>
          <button disabled class="btn-primary">Processing...</button>
        </template>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';

const props = defineProps<{
  visible: boolean;
  updateInfo: {
    currentVersion?: string;
    availableVersion?: string;
    entry?: any;
    localVersionExists?: boolean;
    localVersionMatches?: boolean;
    updateState?: 'idle' | 'downloading' | 'verifying' | 'completed' | 'error';
    newExecutablePath?: string;
    progress?: {
      current: number;
      total: number;
      message: string;
    };
    error?: string;
  };
  isBlocking?: boolean;
}>();

const emit = defineEmits<{
  (e: 'update'): void;
  (e: 'skip'): void;
  (e: 'exit'): void;
  (e: 'launch-new'): void;
  (e: 'cancel'): void;
}>();

const ipfsGateways = ref<string[]>([]);
const arweaveGateways = ref<string[]>([]);
const selectedIPFSGateway = ref<string>('');
const selectedArWeaveGateway = ref<string>('');

const isProcessing = computed(() => {
  return props.updateInfo.updateState === 'downloading' || 
         props.updateInfo.updateState === 'verifying';
});

const progressPercent = computed(() => {
  if (!props.updateInfo.progress || props.updateInfo.progress.total === 0) {
    return 0;
  }
  return Math.round((props.updateInfo.progress.current / props.updateInfo.progress.total) * 100);
});

function parseMessage(message: string | any): string {
  if (typeof message === 'string') {
    try {
      const parsed = JSON.parse(message);
      return typeof parsed === 'string' ? parsed : JSON.stringify(parsed);
    } catch {
      return message;
    }
  }
  return String(message);
}

function parseLinks(links: string | string[] | any): string[] {
  if (Array.isArray(links)) {
    return links;
  }
  if (typeof links === 'string') {
    try {
      const parsed = JSON.parse(links);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      return [links];
    }
  }
  return [];
}

function formatTimestamp(timestamp: number): string {
  if (!timestamp) return 'Unknown';
  const date = new Date(timestamp * 1000);
  return date.toLocaleString();
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

function handleUpdate() {
  emit('update');
}

function handleSkip() {
  emit('skip');
}

function handleExit() {
  emit('exit');
}

function handleLaunchNew() {
  emit('launch-new');
}

function handleCancel() {
  if (!props.isBlocking) {
    emit('cancel');
  }
}

function openUrl(url: string) {
  const api = (window as any).electronAPI;
  if (api && api.openExternal) {
    api.openExternal(url);
  } else {
    window.open(url, '_blank');
  }
}

function openPointer() {
  if (props.updateInfo.entry?.pointer) {
    const url = `https://arbiscan.io/address/${props.updateInfo.entry.pointer}`;
    openUrl(url);
  }
}

function openIPFS(cid: string, gateway: string) {
  if (!cid || !gateway) return;
  const api = (window as any).electronAPI;
  if (api && api.softwareUpdateOpenIPFS) {
    api.softwareUpdateOpenIPFS(cid, gateway);
  } else {
    const url = `https://check.ipfs.network/?cid=${cid}`;
    openUrl(url);
  }
}

function openArWeave(txid: string, gateway: string) {
  if (!txid || !gateway) return;
  const api = (window as any).electronAPI;
  if (api && api.softwareUpdateOpenArWeave) {
    api.softwareUpdateOpenArWeave(txid, gateway);
  } else {
    const url = `${gateway}/${txid}`;
    openUrl(url);
  }
}

// Load gateways on mount
onMounted(async () => {
  const api = (window as any).electronAPI;
  if (api && api.softwareUpdateGetIPFSGateways) {
    ipfsGateways.value = await api.softwareUpdateGetIPFSGateways() || [];
    if (ipfsGateways.value.length > 0) {
      selectedIPFSGateway.value = ipfsGateways.value[0];
    }
  }
  if (api && api.softwareUpdateGetArWeaveGateways) {
    arweaveGateways.value = await api.softwareUpdateGetArWeaveGateways() || [];
    if (arweaveGateways.value.length > 0) {
      selectedArWeaveGateway.value = arweaveGateways.value[0];
    }
  }
});

// Handle Escape key
function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && props.visible && !props.isBlocking) {
    handleCancel();
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeydown);
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown);
});
</script>

<style scoped>
.software-update-dialog {
  max-width: 800px;
  width: 90%;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
}

.modal-body {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}

.version-info {
  margin-bottom: 20px;
  padding: 15px;
  background: var(--bg-secondary, #f5f5f5);
  border-radius: 4px;
}

.version-current,
.version-available {
  margin: 5px 0;
}

.warning-box {
  margin-bottom: 20px;
  padding: 15px;
  background: #fff3cd;
  border: 1px solid #ffc107;
  border-radius: 4px;
  color: #856404;
}

.message-box {
  margin-bottom: 20px;
  padding: 15px;
  background: var(--bg-secondary, #f5f5f5);
  border-radius: 4px;
}

.update-details {
  margin-bottom: 20px;
}

.update-details h4 {
  margin-bottom: 15px;
  font-size: 16px;
}

.detail-row {
  margin: 10px 0;
  display: flex;
  align-items: flex-start;
  gap: 10px;
}

.detail-row label {
  min-width: 150px;
  font-weight: bold;
}

.detail-row span,
.detail-row div {
  flex: 1;
  word-break: break-all;
}

.hash-value,
.b64-value {
  font-family: monospace;
  font-size: 12px;
}

.clickable-link {
  color: #007bff;
  cursor: pointer;
  text-decoration: underline;
}

.clickable-link:hover {
  color: #0056b3;
}

.link-list {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.link-with-dropdown {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
}

.gateway-dropdown {
  padding: 4px 8px;
  border: 1px solid #ccc;
  border-radius: 4px;
  background: white;
  font-size: 12px;
}

.progress-section {
  margin: 20px 0;
  padding: 15px;
  background: var(--bg-secondary, #f5f5f5);
  border-radius: 4px;
}

.progress-bar-container {
  width: 100%;
  height: 20px;
  background: #e0e0e0;
  border-radius: 10px;
  overflow: hidden;
  margin-bottom: 10px;
}

.progress-bar {
  height: 100%;
  background: #007bff;
  transition: width 0.3s ease;
}

.progress-text {
  margin-bottom: 5px;
  font-weight: bold;
}

.progress-details {
  font-size: 12px;
  color: #666;
}

.error-box {
  margin: 20px 0;
  padding: 15px;
  background: #f8d7da;
  border: 1px solid #f5c6cb;
  border-radius: 4px;
  color: #721c24;
}

.success-box {
  margin: 20px 0;
  padding: 15px;
  background: #d4edda;
  border: 1px solid #c3e6cb;
  border-radius: 4px;
  color: #155724;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 15px 20px;
  border-top: 1px solid #e0e0e0;
}

.btn-primary,
.btn-secondary {
  padding: 8px 16px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
}

.btn-primary {
  background: #007bff;
  color: white;
}

.btn-primary:hover:not(:disabled) {
  background: #0056b3;
}

.btn-primary:disabled {
  background: #ccc;
  cursor: not-allowed;
}

.btn-secondary {
  background: #6c757d;
  color: white;
}

.btn-secondary:hover:not(:disabled) {
  background: #5a6268;
}

.btn-secondary:disabled {
  background: #ccc;
  cursor: not-allowed;
}
</style>
