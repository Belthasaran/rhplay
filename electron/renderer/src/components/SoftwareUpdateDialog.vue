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
          <p v-if="updateInfo.localVersionPath" class="local-version-path">
            <span>Found at: {{ updateInfo.localVersionPath }}</span>
            <button type="button" class="btn-open-folder" title="Open folder containing file" @click="openLocalVersionFolder">&#128193;</button>
          </p>
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
        <div v-if="currentUpdateState === 'downloading' || currentUpdateState === 'verifying' || currentUpdateState === 'loading'" class="progress-section">
          <h4>Update Progress</h4>
          <div class="progress-bar-container">
            <div class="progress-bar" :style="{ width: Math.max(0, Math.min(100, progressPercent)) + '%' }"></div>
          </div>
          <div class="progress-text">
            <strong>{{ updateInfo.progress?.message || 'Processing...' }}</strong>
          </div>
          <div v-if="updateInfo.progress?.filename" class="progress-filename">
            <strong>File:</strong> {{ updateInfo.progress.filename }}
          </div>
          <div v-if="updateInfo.progress?.total > 0" class="progress-details">
            <strong>Progress:</strong> {{ formatBytes(updateInfo.progress.current) }} / {{ formatBytes(updateInfo.progress.total) }}
            ({{ progressPercent }}%)
          </div>
          <div v-else-if="updateInfo.progress?.message" class="progress-details">
            {{ updateInfo.progress.message }}
          </div>
        </div>

        <!-- Error Message -->
        <div v-if="currentUpdateState === 'error'" class="error-box">
          <p><strong>Error:</strong> {{ updateInfo.error || 'Unknown error occurred' }}</p>
        </div>

        <!-- Success Message -->
        <div v-if="currentUpdateState === 'completed'" class="success-box">
          <p><strong>Update completed successfully!</strong></p>
          <p>The new version has been downloaded and verified.</p>
        </div>
        
        <!-- Progress History (collapsible) -->
        <div class="progress-history-section">
          <button 
            @click="showProgressHistory = !showProgressHistory" 
            class="history-toggle-btn"
            :class="{ expanded: showProgressHistory }"
          >
            {{ showProgressHistory ? '▼' : '▶' }} Progress History
          </button>
          <div v-if="showProgressHistory" class="progress-history">
            <div 
              v-for="(entry, index) in progressHistory" 
              :key="index" 
              class="history-entry"
              :class="entry.type"
            >
              <span class="history-time">{{ entry.time }}</span>
              <span class="history-message">{{ entry.message }}</span>
              <span v-if="entry.filename" class="history-filename">{{ entry.filename }}</span>
              <span v-if="entry.percent !== undefined && entry.percent > 0" class="history-percent">{{ entry.percent }}%</span>
            </div>
            <div v-if="progressHistory.length === 0" class="history-empty">No progress entries yet.</div>
          </div>
        </div>
      </section>
      <footer class="modal-footer">
        <!-- Old Version Dialog Buttons -->
        <template v-if="updateInfo.localVersionExists && updateInfo.localVersionMatches">
          <button @click="handleExit" class="btn-primary">Exit now</button>
          <button @click="handleSkip" class="btn-secondary">Launch old version anyway</button>
        </template>
        
        <!-- Update Completed Buttons -->
        <template v-else-if="currentUpdateState === 'completed'">
          <button @click="handleLaunchNew" class="btn-primary" autofocus>Exit and Relaunch</button>
          <button @click="handleCancel" class="btn-secondary">Cancel</button>
        </template>
        
        <!-- Initial/Idle State Buttons -->
        <template v-else-if="currentUpdateState === 'idle' || !currentUpdateState">
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
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';

// Internal state to track update state (since props are read-only)
const internalUpdateState = ref<string | undefined>(undefined);

const props = defineProps<{
  visible: boolean;
  updateInfo: {
    currentVersion?: string;
    availableVersion?: string;
    entry?: any;
    localVersionExists?: boolean;
    localVersionMatches?: boolean;
    localVersionPath?: string;
    updateState?: 'idle' | 'downloading' | 'verifying' | 'completed' | 'error';
    newExecutablePath?: string;
    progress?: {
      current: number;
      total: number;
      message: string;
      filename?: string;
      percent?: number;
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
const showProgressHistory = ref(false);
const progressHistory = ref<Array<{
  time: string;
  message: string;
  filename?: string;
  percent?: number;
  type: 'info' | 'progress' | 'success' | 'error';
}>>([]);

// Use internal state if available, otherwise fall back to prop
const currentUpdateState = computed(() => {
  return internalUpdateState.value !== undefined ? internalUpdateState.value : props.updateInfo.updateState;
});

const isProcessing = computed(() => {
  const state = currentUpdateState.value;
  return state === 'downloading' || state === 'verifying' || state === 'loading';
});

const progressPercent = computed(() => {
  if (!props.updateInfo.progress) {
    return 0;
  }
  // Use percent if available, otherwise calculate from current/total
  if (props.updateInfo.progress.percent !== undefined) {
    return props.updateInfo.progress.percent;
  }
  if (props.updateInfo.progress.total === 0 || !props.updateInfo.progress.total) {
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

function openLocalVersionFolder() {
  const p = props.updateInfo.localVersionPath || '';
  if (!p) return;
  const parentDir = p.replace(/[/\\][^/\\]*$/, '') || p;
  const api = (window as any).electronAPI;
  if (api?.shell?.openPath) {
    api.shell.openPath(parentDir);
  }
}

// Watch updateInfo.progress to add entries to history and update internal state
watch(() => props.updateInfo.progress, (newProgress) => {
  if (newProgress && newProgress.message) {
    const entry = {
      time: new Date().toLocaleTimeString(),
      message: newProgress.message,
      filename: newProgress.filename,
      percent: newProgress.percent,
      type: (newProgress.message.includes('completed') || newProgress.message.includes('success')) ? 'success' :
            (newProgress.message.includes('failed') || newProgress.message.includes('error')) ? 'error' :
            (newProgress.percent !== undefined && newProgress.percent > 0) ? 'progress' : 'info'
    };
    progressHistory.value.push(entry);
    // Keep only last 100 entries
    if (progressHistory.value.length > 100) {
      progressHistory.value.shift();
    }
    
    // Update internal state based on progress message
    if (newProgress.message.includes('completed successfully') || newProgress.message.includes('Update verified successfully')) {
      internalUpdateState.value = 'completed';
    } else if (newProgress.message.includes('Downloading') || newProgress.message.includes('Starting download')) {
      internalUpdateState.value = 'downloading';
    } else if (newProgress.message.includes('Verifying') || newProgress.message.includes('Performing') || newProgress.message.includes('Moving')) {
      internalUpdateState.value = 'verifying';
    }
  }
}, { deep: true });

// Watch updateState to add state changes to history and sync internal state
watch(() => props.updateInfo.updateState, (newState, oldState) => {
  if (newState && newState !== oldState) {
    internalUpdateState.value = newState;
    const entry = {
      time: new Date().toLocaleTimeString(),
      message: `State changed to: ${newState}`,
      type: newState === 'completed' ? 'success' : 
            newState === 'error' ? 'error' : 'info'
    };
    progressHistory.value.push(entry);
    if (progressHistory.value.length > 100) {
      progressHistory.value.shift();
    }
  }
}, { immediate: true });

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

// Load gateways on mount and set up state update listener
onMounted(async () => {
  const api = (window as any).electronAPI;
  
  // Listen for state updates (e.g., when update completes)
  if (api && api.onSoftwareUpdateStateUpdate) {
    api.onSoftwareUpdateStateUpdate((stateUpdate: any) => {
      console.log('[SoftwareUpdateDialog] State update received:', stateUpdate);
      if (stateUpdate.updateState) {
        internalUpdateState.value = stateUpdate.updateState;
        // Add to history
        const entry = {
          time: new Date().toLocaleTimeString(),
          message: `State update: ${stateUpdate.updateState}`,
          type: stateUpdate.updateState === 'completed' ? 'success' : 'info'
        };
        progressHistory.value.push(entry);
        if (progressHistory.value.length > 100) {
          progressHistory.value.shift();
        }
      }
    });
  }
  
  // Listen for progress updates and add to history
  if (api && api.onSoftwareUpdateProgress) {
    api.onSoftwareUpdateProgress((progress: any) => {
      console.log('[SoftwareUpdateDialog] Progress received:', progress);
      if (progress && progress.message) {
        const entry = {
          time: new Date().toLocaleTimeString(),
          message: progress.message,
          filename: progress.filename,
          percent: progress.percent,
          type: (progress.message.includes('completed') || progress.message.includes('success')) ? 'success' :
                (progress.message.includes('failed') || progress.message.includes('error')) ? 'error' :
                (progress.percent !== undefined && progress.percent > 0) ? 'progress' : 'info'
        };
        progressHistory.value.push(entry);
        if (progressHistory.value.length > 100) {
          progressHistory.value.shift();
        }
        
        // Update internal state based on progress message
        if (progress.message.includes('completed successfully') || progress.message.includes('Update verified successfully')) {
          internalUpdateState.value = 'completed';
        } else if (progress.message.includes('Downloading') || progress.message.includes('Starting download')) {
          internalUpdateState.value = 'downloading';
        } else if (progress.message.includes('Verifying') || progress.message.includes('Performing') || progress.message.includes('Moving')) {
          internalUpdateState.value = 'verifying';
        }
      }
    });
  }
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

.local-version-path {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
  font-size: 13px;
  word-break: break-all;
}

.btn-open-folder {
  flex-shrink: 0;
  padding: 4px 8px;
  background: #856404;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
}

.btn-open-folder:hover {
  background: #6b5103;
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

.progress-history-section {
  margin-top: 20px;
  border-top: 1px solid #444;
  padding-top: 15px;
}

.history-toggle-btn {
  background: transparent;
  border: 1px solid #555;
  color: #e0e0e0;
  padding: 8px 12px;
  cursor: pointer;
  border-radius: 4px;
  font-size: 14px;
  width: 100%;
  text-align: left;
  display: flex;
  align-items: center;
  gap: 8px;
}

.history-toggle-btn:hover {
  background: #3d3d3d;
  border-color: #666;
}

.history-toggle-btn.expanded {
  border-bottom-left-radius: 0;
  border-bottom-right-radius: 0;
  border-bottom: none;
}

.progress-history {
  border: 1px solid #555;
  border-top: none;
  border-radius: 0 0 4px 4px;
  max-height: 300px;
  overflow-y: auto;
  background: #2a2a2a;
  padding: 10px;
}

.history-entry {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 6px 0;
  border-bottom: 1px solid #333;
  font-size: 12px;
  align-items: center;
}

.history-entry:last-child {
  border-bottom: none;
}

.history-entry.success {
  color: #4caf50;
}

.history-entry.error {
  color: #f44336;
}

.history-entry.progress {
  color: #2196f3;
}

.history-entry.info {
  color: #e0e0e0;
}

.history-time {
  color: #888;
  min-width: 80px;
  font-family: monospace;
}

.history-message {
  flex: 1;
  min-width: 200px;
}

.history-filename {
  color: #aaa;
  font-family: monospace;
  font-size: 11px;
}

.history-percent {
  color: #4caf50;
  font-weight: bold;
  min-width: 50px;
  text-align: right;
}

.history-empty {
  color: #888;
  font-style: italic;
  padding: 20px;
  text-align: center;
}
</style>
