<template>
  <div class="provisioner">
    <header class="header">
      <h1>RHTools Database Provisioner</h1>
      <p>
        Required databases are missing or need updates. This assistant will download archives,
        apply SQL patches, and place the finished databases in your RHTools data directory.
      </p>
    </header>

    <section class="status-panel">
      <div class="status-block">
        <h2>Current Status</h2>
        <p v-if="statusMessage">{{ statusMessage }}</p>
        <p v-else>Idle.</p>
        <ul>
          <li>User data directory: <code>{{ provisionerState.userDataDir }}</code></li>
          <li>Working directory: <code>{{ provisionerState.workingDir }}</code></li>
        </ul>
        <p class="manual-download">
          Manual Download:
          <a href="#" @click.prevent="openArDrive">Open ArDrive db/ Folder</a>
        </p>
        <div v-if="missingDatabases.length" class="missing">
          <strong>Missing databases:</strong>
          <span>{{ missingDatabases.join(', ') }}</span>
        </div>
        <div v-else class="missing ok">All databases are present. Exit this program and restart when ready.</div>
      </div>
      <div class="status-block downloads">
        <h2>Download Progress</h2>
        <p>Total archives: {{ totalDownloadCount }}</p>
        <p>Completed: {{ completedDownloads }} • Remaining: {{ downloadsRemaining }}</p>
        <div v-if="activeDownload" class="progress">
          <div class="label">
            Downloading {{ activeDownload.index }} / {{ activeDownload.total }}:
            <span class="filename">{{ activeDownload.name }}</span>
          </div>
          <div class="bar">
            <div class="fill" :style="{ width: activeDownload.percent + '%' }"></div>
          </div>
          <div class="details">
            {{ activeDownload.percent }}%
            <span v-if="activeDownload.downloaded && activeDownload.totalSize">
              ({{ activeDownload.downloaded }} / {{ activeDownload.totalSize }})
            </span>
          </div>
        </div>
        <div v-else class="progress idle">No active download.</div>
        <div v-if="currentTask" class="task">Current task: {{ currentTask }}</div>
      </div>
    </section>

    <section class="controls">
      <button :disabled="isLoadingPlan || isProvisioning" @click="refreshPlan">
        {{ isLoadingPlan ? 'Refreshing…' : 'Refresh Plan' }}
      </button>
      <button :disabled="isProvisioning" @click="openDownloadFolder">
        Download Folder
      </button>
      <button
        class="primary"
        :disabled="isProvisioning || !provisionRequired"
        @click="startProvision"
      >
        {{ isProvisioning ? 'Provisioning…' : 'Run Automatic Provisioning' }}
      </button>
    </section>

    <section class="plan" v-if="planDatabases.length">
      <h2>Provisioning Plan</h2>
      <table>
        <thead>
          <tr>
            <th>Database</th>
            <th>Action</th>
            <th>Base Archive</th>
            <th>Patches</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="db in planDatabases" :key="db.name">
            <td>{{ db.name }}</td>
            <td>
              <span :class="['badge', `action-${db.action}`]">{{ formatAction(db.action) }}</span>
            </td>
            <td>
              <div v-if="db.manifestSummary?.base">
                <div>{{ db.manifestSummary.base.file_name }}</div>
                <small v-if="db.manifestSummary.base.size">
                  {{ formatBytes(db.manifestSummary.base.size) }}
                </small>
              </div>
              <div v-else>Embedded / not required</div>
            </td>
            <td>{{ db.manifestSummary?.base?.patchCount ?? 0 }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="logs">
      <h2>Provisioning Output</h2>
      <textarea ref="logView" readonly :value="logText" spellcheck="false"></textarea>
    </section>

    <section class="results" v-if="provisionComplete && !isProvisioning">
      <div class="success">Provisioning completed successfully. All databases are ready.</div>
      <button class="primary" @click="launchMainApp">Launch RHTools</button>
    </section>

    <section class="errors" v-if="errorMessage">
      <div class="error">{{ errorMessage }}</div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';

interface ProvisionerState {
  userDataDir: string;
  workingDir: string;
  manifestPath?: string;
  missingDatabases: string[];
}

interface PlanDatabase {
  name: string;
  action: string;
  exists?: boolean;
  embedded?: boolean;
  overwrite?: boolean;
  manifestSummary?: {
    base?: {
      file_name: string;
      sha256?: string;
      size?: number;
      patchCount?: number;
    };
  };
}

interface ProvisionerPlan {
  databases?: PlanDatabase[];
}

const provisionerApi = window.electronAPI?.provisioner;

const provisionerState = ref<ProvisionerState>({
  userDataDir: '',
  workingDir: '',
  missingDatabases: [],
});
const missingDatabases = ref<string[]>([]);
const plan = ref<ProvisionerPlan | null>(null);
const logLines = ref<string[]>([]);
const statusMessage = ref('');
const isLoadingPlan = ref(false);
const isProvisioning = ref(false);
const provisionComplete = ref(false);
const errorMessage = ref<string | null>(null);
const activeDownload = ref<{ name: string; index: number; total: number; percent: number; downloaded?: string; totalSize?: string } | null>(null);
const completedDownloads = ref(0);
const currentTask = ref<string | null>(null);
const logView = ref<HTMLTextAreaElement | null>(null);
let unsubscribeLog: (() => void) | null = null;
let unsubscribeStatus: (() => void) | null = null;
let currentOperation: 'idle' | 'plan' | 'provision' = 'idle';

const planDatabases = computed(() => plan.value?.databases ?? []);

const provisionRequired = computed(() =>
  planDatabases.value.some((db) => db.action !== 'skip')
);

const totalDownloadCount = computed(() => {
  return planDatabases.value.reduce((sum, db) => {
    if (db.action === 'provision-from-manifest' && db.manifestSummary?.base) {
      const patchCount = db.manifestSummary.base.patchCount ?? 0;
      return sum + 1 + patchCount;
    }
    return sum;
  }, 0);
});

const downloadsRemaining = computed(() => {
  return Math.max(totalDownloadCount.value - completedDownloads.value, 0);
});

const logText = computed(() => logLines.value.join('\n'));

function formatBytes(bytes?: number) {
  if (!bytes || bytes <= 0) {
    return 'unknown size';
  }
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatAction(action: string) {
  switch (action) {
    case 'skip':
      return 'Already Present';
    case 'copy-embedded':
      return 'Copy Embedded Seed';
    case 'provision-from-manifest':
      return 'Download & Patch';
    default:
      return action;
  }
}

function appendLog(line: string) {
  if (!line) return;
  logLines.value.push(line);
  if (logLines.value.length > 1000) {
    logLines.value.shift();
  }

  if (line.startsWith('[download-start]')) {
    const match = line.match(/\[download-start] (\d+)\/(\d+)\s+([^\s]+) size=(.+)$/);
    if (match) {
      activeDownload.value = {
        index: Number(match[1]),
        total: Number(match[2]),
        name: match[3],
        percent: 0,
        totalSize: match[4],
      };
    }
  } else if (line.startsWith('[download-progress]')) {
    const match = line.match(/\[download-progress] ([^\s]+) (\d+)% \(([^/]+)\/(.+)\)/);
    if (match && activeDownload.value) {
      activeDownload.value = {
        ...activeDownload.value,
        name: match[1],
        percent: Number(match[2]),
        downloaded: match[3],
        totalSize: match[4],
      };
    }
  } else if (line.startsWith('[download-complete]')) {
    completedDownloads.value += 1;
    activeDownload.value = null;
    if (completedDownloads.value > totalDownloadCount.value) {
      completedDownloads.value = totalDownloadCount.value;
    }
  } else if (line.startsWith('[download-skip]')) {
    completedDownloads.value += 1;
    activeDownload.value = null;
    if (completedDownloads.value > totalDownloadCount.value) {
      completedDownloads.value = totalDownloadCount.value;
    }
  } else if (line.startsWith('[extract]')) {
    const match = line.match(/\[extract] ([^:]+): (.+)$/);
    currentTask.value = match ? `${match[1]} — ${match[2]}` : 'Extracting files';
  } else if (line.startsWith('[patch-start]')) {
    const match = line.match(/\[patch-start] ([^:]+): applying (.+)$/);
    currentTask.value = match ? `${match[1]} — Applying ${match[2]}` : 'Applying SQL patch';
  } else if (line.startsWith('[patch-complete]')) {
    const match = line.match(/\[patch-complete] ([^:]+): applied (.+)$/);
    currentTask.value = match ? `${match[1]} — Applied ${match[2]}` : 'Patch applied';
  } else if (line.startsWith('[provision]')) {
    const match = line.match(/\[provision] ([^:]+): (.+)$/);
    currentTask.value = match ? `${match[1]} — ${match[2]}` : 'Provisioning';
  }

  nextTick(() => {
    const element = logView.value;
    if (element) {
      element.scrollTop = element.scrollHeight;
    }
  });
}

async function loadInitialState() {
  if (!provisionerApi) return;
  try {
    const state = await provisionerApi.getState();
    provisionerState.value = state;
    missingDatabases.value = state.missingDatabases || [];
  } catch (err) {
    errorMessage.value = err instanceof Error ? err.message : String(err);
  }
}

async function refreshPlan() {
  if (!provisionerApi) return;
  isLoadingPlan.value = true;
  errorMessage.value = null;
  currentOperation = 'plan';
  statusMessage.value = 'Generating provisioning plan…';
  try {
    const response = await provisionerApi.runPlan();
    if (response.success) {
      plan.value = response.plan ?? null;
      missingDatabases.value = response.missingDatabases ?? missingDatabases.value;
      completedDownloads.value = 0;
      activeDownload.value = null;
      currentTask.value = null;
      provisionComplete.value = false;
      statusMessage.value = 'Plan updated.';
    } else {
      errorMessage.value = response.error || 'Failed to generate provisioning plan.';
      statusMessage.value = 'Plan generation failed.';
    }
  } catch (err) {
    errorMessage.value = err instanceof Error ? err.message : String(err);
    statusMessage.value = 'Plan generation failed.';
  } finally {
    isLoadingPlan.value = false;
    currentOperation = 'idle';
  }
}

async function startProvision() {
  if (!provisionerApi || isProvisioning.value) return;
  if (!window.confirm('Run automatic provisioning now? This will download required archives.')) {
    return;
  }
  errorMessage.value = null;
  isProvisioning.value = true;
  provisionComplete.value = false;
  completedDownloads.value = 0;
  activeDownload.value = null;
  currentTask.value = 'Preparing to provision…';
  logLines.value = [];
  currentOperation = 'provision';
  statusMessage.value = 'Launching provisioning…';
  try {
    const response = await provisionerApi.runProvision();
    if (response.success) {
      provisionComplete.value = true;
      missingDatabases.value = response.missingDatabases ?? [];
      await refreshPlan();
      statusMessage.value = 'Provisioning finished successfully. Exit this program and restart when ready.';
    } else {
      errorMessage.value = response.error || 'Provisioning did not complete successfully.';
      missingDatabases.value = response.missingDatabases ?? missingDatabases.value;
      await refreshPlan();
      statusMessage.value = 'Provisioning finished with issues.';
    }
  } catch (err) {
    errorMessage.value = err instanceof Error ? err.message : String(err);
    await refreshPlan();
    statusMessage.value = 'Provisioning failed.';
  } finally {
    isProvisioning.value = false;
    currentOperation = 'idle';
  }
}

async function launchMainApp() {
  if (!provisionerApi) return;
  try {
    const result = await provisionerApi.launchMain();
    if (!result.success) {
      errorMessage.value = 'Databases are still missing: ' + (result.missing || []).join(', ');
      provisionComplete.value = false;
      await refreshPlan();
    }
  } catch (err) {
    errorMessage.value = err instanceof Error ? err.message : String(err);
  }
}

function openArDrive() {
  provisionerApi?.openArDrive();
}

function openDownloadFolder() {
  if (!provisionerState.value.workingDir) return;
  window.electronAPI?.shell?.openPath(provisionerState.value.workingDir);
}

function handleStatus(payload: { state: string; provision?: boolean; missing?: string[] | undefined }) {
  switch (payload.state) {
    case 'starting':
      statusMessage.value = payload.provision ? 'Starting provisioning…' : 'Generating plan…';
      break;
    case 'plan':
      if (currentOperation === 'plan') {
        statusMessage.value = 'Plan generated.';
      }
      break;
    case 'complete':
      statusMessage.value = 'Provisioning completed successfully.';
      provisionComplete.value = true;
      break;
    case 'needs-attention':
      statusMessage.value = 'Provisioning completed but some databases still need attention.';
      provisionComplete.value = false;
      if (payload.missing && payload.missing.length) {
        missingDatabases.value = payload.missing;
      }
      break;
    case 'error':
      statusMessage.value = 'Provisioning encountered an error.';
      provisionComplete.value = false;
      if (payload.missing && payload.missing.length) {
        missingDatabases.value = payload.missing;
      }
      break;
    default:
      break;
  }
}

onMounted(async () => {
  await loadInitialState();
  await refreshPlan();

  if (provisionerApi) {
    unsubscribeLog = provisionerApi.onLog((line: string) => {
      appendLog(line);
    });
    unsubscribeStatus = provisionerApi.onStatus((payload: { state: string; provision?: boolean; missing?: string[] }) => {
      handleStatus(payload);
    });
  }
});

onBeforeUnmount(() => {
  if (unsubscribeLog) {
    unsubscribeLog();
    unsubscribeLog = null;
  }
  if (unsubscribeStatus) {
    unsubscribeStatus();
    unsubscribeStatus = null;
  }
});
</script>

<style scoped>
.provisioner {
  max-width: 1100px;
  margin: 0 auto;
  padding: 32px;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  color: #1f2933;
}

.header h1 {
  margin: 0 0 12px;
  font-size: 28px;
}

.header p {
  margin: 0;
  color: #52606d;
}

.status-panel {
  display: flex;
  flex-wrap: wrap;
  gap: 24px;
  margin-top: 24px;
}

.status-block {
  flex: 1 1 320px;
  border: 1px solid #d9e2ec;
  border-radius: 8px;
  padding: 16px;
  background: #f8fafc;
}

.status-block ul {
  margin: 8px 0 0;
  padding-left: 18px;
  color: #52606d;
}

.status-block code {
  background: #e4ecf4;
  padding: 2px 4px;
  border-radius: 4px;
  font-size: 13px;
}

.manual-download {
  margin-top: 12px;
  font-size: 14px;
}

.manual-download a {
  color: #2563eb;
  text-decoration: underline;
  cursor: pointer;
}

.status-block.downloads {
  background: #f0f4f8;
}

.missing {
  margin-top: 12px;
  padding: 8px 12px;
  border-radius: 6px;
  background: #fff4f4;
  color: #b21632;
  font-weight: 500;
}

.missing.ok {
  background: #f1fbf7;
  color: #0f8b3d;
}

.controls {
  display: flex;
  gap: 16px;
  margin: 32px 0;
}

.controls button {
  padding: 10px 18px;
  border: 1px solid #3e4c59;
  border-radius: 6px;
  background: white;
  cursor: pointer;
  font-size: 15px;
}

.controls button[disabled] {
  cursor: not-allowed;
  opacity: 0.6;
}

.controls .primary {
  background: #2563eb;
  color: white;
  border-color: #1d4ed8;
}

.plan table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 12px;
}

.plan th,
.plan td {
  padding: 10px;
  border: 1px solid #d9e2ec;
  text-align: left;
}

.badge {
  display: inline-block;
  padding: 4px 8px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
}

.action-skip {
  background: #e6fffa;
  color: #0b7285;
}

.action-copy-embedded {
  background: #fef3c7;
  color: #92400e;
}

.action-provision-from-manifest {
  background: #dbeafe;
  color: #1d4ed8;
}

.logs textarea {
  width: 100%;
  min-height: 240px;
  margin-top: 12px;
  border-radius: 6px;
  border: 1px solid #cbd2d9;
  padding: 12px;
  font-family: 'Fira Code', 'SFMono-Regular', Consolas, 'Liberation Mono', monospace;
  font-size: 13px;
  color: #102a43;
  background: #f8fafc;
  resize: vertical;
}

.progress {
  margin-top: 12px;
}

.progress.idle {
  color: #52606d;
}

.progress .label {
  font-weight: 600;
  margin-bottom: 6px;
}

.progress .filename {
  font-family: 'Fira Code', monospace;
  color: #1d4ed8;
}

.progress .bar {
  width: 100%;
  height: 10px;
  background: #e4ecf4;
  border-radius: 999px;
  overflow: hidden;
}

.progress .fill {
  height: 100%;
  background: #2563eb;
  transition: width 0.2s ease;
}

.progress .details {
  margin-top: 6px;
  font-size: 13px;
  color: #52606d;
}

.task {
  margin-top: 12px;
  font-size: 14px;
  color: #1d4ed8;
  font-weight: 600;
}

.results {
  margin-top: 24px;
  display: flex;
  align-items: center;
  gap: 16px;
}

.results .success {
  padding: 10px 14px;
  border-radius: 6px;
  background: #dcfce7;
  color: #166534;
  font-weight: 600;
}

.errors {
  margin-top: 16px;
}

.errors .error {
  padding: 10px 14px;
  border-radius: 6px;
  background: #fee2e2;
  color: #b91c1c;
  font-weight: 600;
}

@media (max-width: 768px) {
  .controls {
    flex-direction: column;
    align-items: stretch;
  }

  .status-panel {
    flex-direction: column;
  }
}
</style>
