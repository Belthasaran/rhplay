<template>
  <div class="launcher">
    <header class="header">
      <h1>RHTools Launcher</h1>
      <p class="sub">
        Download RHPlay, manage databases, and launch verified builds from your program data folder.
      </p>
    </header>

    <!-- ROM modal (same copy as Database provisioner) -->
    <div v-if="romCheckModalOpen" class="modal-backdrop">
      <div class="modal-content rom-check-modal">
        <h2>Super Mario World ROM Required</h2>
        <div class="rom-check-explanation">
          <p>
            This software requires a valid Super Mario World ROM file (smw.sfc) to function.
            The ROM file is used as a base for applying patches to create playable ROM hacks.
            By proceeding you agree to the following conditions and disclaimer of warranty:
          </p>
          <p><strong>Important Legal Notice:</strong></p>
          <ul>
            <li>You must already have your own legally acquired copy of Super Mario World</li>
            <li>Do not distribute commercial ROM files</li>
            <li>Do not request commercial ROM files from others</li>
            <li>This software does not distribute commercial base ROM data</li>
            <li>This software does not distribute standalone games based on commercial ROMs</li>
          </ul>
          <p>
            <strong>This software will not function after provisioning if you fail to complete this step successfully.</strong>
          </p>
          <p class="warranty">
            THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
          </p>
        </div>
        <div v-if="romValidationError" class="rom-error">{{ romValidationError }}</div>
        <div class="rom-check-actions">
          <button type="button" class="primary" @click="browseRomFile">Browse Files</button>
        </div>
      </div>
    </div>

    <section class="card">
      <h2>Channel</h2>
      <p class="hint">Only the beta channel is available today; stable can be selected for future use.</p>
      <div class="row">
        <label>
          <input v-model="channel" type="radio" value="beta" @change="applyChannel" />
          Beta
        </label>
        <label>
          <input v-model="channel" type="radio" value="stable" @change="applyChannel" />
          Stable
        </label>
      </div>
    </section>

    <section class="card">
      <h2>RHPlay</h2>
      <p v-if="entryError" class="error">{{ entryError }}</p>
      <p v-if="manifestLoaded && coreManifest" class="meta core-manifest-active">
        <span class="core-mf-label">Active core manifest</span>
        <strong class="core-mf-ver">{{ coreManifestVersionLabel }}</strong>
        <span v-if="coreManifest.lastupdated != null" class="core-mf-ts">
          · lastupdated <code>{{ coreManifest.lastupdated }}</code>
          <span v-if="coreManifestLastUpdatedLocal">({{ coreManifestLastUpdatedLocal }})</span>
        </span>
      </p>
      <p v-else-if="!manifestLoaded" class="meta hint">Core manifest not loaded.</p>
      <p v-if="rhplayEntry" class="meta">
        Manifest entry version: <strong>{{ rhplayEntry.version }}</strong>
        <span v-if="rhplayEntry.sha256" class="hash">SHA256: {{ rhplayEntry.sha256.slice(0, 16) }}…</span>
      </p>
      <div class="actions">
        <button
          v-if="bestLaunchCandidate"
          type="button"
          class="primary"
          :disabled="busy || launching"
          @click="launch(bestLaunchCandidate.path)"
        >
          {{ launching && launchingPath === bestLaunchCandidate.path ? 'Launching…' : 'Launch' }}
        </button>
        <button type="button" class="primary" :disabled="busy || !rhplayEntry" @click="downloadRhplay">
          {{ busy ? 'Working…' : 'Download / update RHPlay' }}
        </button>
        <button type="button" @click="refreshManifest" :disabled="busy">Refresh core manifest</button>
        <button type="button" @click="fetchSettingsOpen = true" :disabled="busy">Change Download Settings</button>
        <button type="button" @click="openReleasesFolder">Open releases folder</button>
      </div>
      <p v-if="downloadMsg" class="log">{{ downloadMsg }}</p>
    </section>

    <section class="card">
      <h2>Installed builds</h2>
      <p v-if="!installedRhplay.length" class="hint">No RHPlay builds in releases yet.</p>
      <ul v-else class="install-list">
        <li v-for="(it, idx) in installedRhplay" :key="idx + it.path">
          <span class="ver">{{ it.version }}</span>
          <span class="fname">{{ it.filename }}</span>
          <button type="button" class="small" :disabled="busy || launching" @click="launch(it.path)">
            {{ launching && launchingPath === it.path ? 'Launching…' : 'Launch' }}
          </button>
        </li>
      </ul>
      <details class="advanced">
        <summary>Advanced — pick a specific file</summary>
        <p class="hint">Only launches if SHA256 matches the manifest entry or launcher_allowlist.</p>
        <button type="button" @click="pickExecutable">Choose executable…</button>
      </details>
    </section>

    <section class="card">
      <h2>Databases</h2>
      <p v-if="dbmanifestError" class="error">dbmanifest: {{ dbmanifestError }}</p>
      <p v-else-if="dbmanifestPath" class="meta hint">
        Manifest file: <code>{{ dbmanifestPath }}</code>
        <span v-if="dbmanifestSource"> ({{ dbmanifestSource }})</span>
      </p>
      <p v-if="databaseDir" class="meta hint">
        Database folder: <code>{{ databaseDir }}</code>
        <span class="db-path-note"> — RHTools stores <code>*.db</code> and <code>provisioned.json</code> here (same as program data).</span>
      </p>
      <p v-if="provisionedJsonPath" class="meta hint provisioned-line">
        <code>{{ provisionedJsonPath }}</code>
        <span v-if="provisionedJsonExists" class="st-ok"> — found</span>
        <span v-else class="st-warn"> — not found (not provisioned in this folder)</span>
      </p>
      <p v-if="dbStatus?.error" class="error">{{ dbStatus.error }}</p>
      <div v-else-if="dbStatus?.rows?.length" class="db-table-wrap">
        <table class="db-table">
          <thead>
            <tr>
              <th>Database</th>
              <th>Installed</th>
              <th>Target</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, idx) in dbStatus.rows" :key="idx">
              <td class="db-name">{{ row.dbName }}</td>
              <td>{{ row.currentVersion }}</td>
              <td>{{ row.targetVersion }}</td>
              <td :class="statusClass(row.status)">{{ formatDbStatus(row.status) }}</td>
            </tr>
          </tbody>
        </table>
        <p v-if="dbStatus.updatesAvailable" class="hint warn">One or more databases need an update or provisioning.</p>
      </div>
      <div class="actions">
        <button type="button" @click="doProvision" :disabled="busy">Provision databases</button>
        <button type="button" @click="doDbUpdate" :disabled="busy">Apply database updates</button>
        <button type="button" @click="doReprovision" :disabled="busy">Re-provision all databases</button>
      </div>
      <p v-if="dbMsg" class="log">{{ dbMsg }}</p>
    </section>

    <footer class="footer">
      <span>Program data: {{ userDataDir }}</span>
    </footer>

    <div v-if="fetchSettingsOpen" class="fetch-settings-overlay">
      <FetchSettingsDialog
        :visible="true"
        :is-blocking="false"
        :standalone="false"
        @close="fetchSettingsOpen = false"
        @saved="fetchSettingsOpen = false"
      />
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import FetchSettingsDialog from './components/FetchSettingsDialog.vue';

const api = window.launcherAPI;

const romCheckModalOpen = ref(false);
const romValidationError = ref(null);
const channel = ref('beta');
const manifestLoaded = ref(false);
const coreManifest = ref(null);
const userDataDir = ref('');
const releasesDir = ref('');
const rhplayEntry = ref(null);
const entryError = ref(null);
const installedRhplay = ref([]);
const bestLaunchCandidate = ref(null);
const busy = ref(false);
const downloadMsg = ref('');
const dbMsg = ref('');
const dbmanifestPath = ref('');
const dbmanifestSource = ref('');
const dbmanifestError = ref(null);
const databaseDir = ref('');
const provisionedJsonPath = ref('');
const provisionedJsonExists = ref(false);
const dbStatus = ref(null);
const fetchSettingsOpen = ref(false);
const launching = ref(false);
const launchingPath = ref('');
let launchFeedbackTimer = null;

const coreManifestVersionLabel = computed(() => {
  const c = coreManifest.value;
  if (!c) return '—';
  const vs = c.versionString;
  const vid = c.versionid;
  if (vs && vid != null) return `${vs} (versionid ${vid})`;
  if (vs) return vs;
  if (vid != null) return `versionid ${vid}`;
  return '—';
});

const coreManifestLastUpdatedLocal = computed(() => {
  const c = coreManifest.value;
  if (!c || c.lastupdated == null || !Number.isFinite(c.lastupdated)) return '';
  try {
    return new Date(c.lastupdated * 1000).toLocaleString();
  } catch (_e) {
    return '';
  }
});

function setLaunchFeedback(path, message) {
  launching.value = true;
  launchingPath.value = path || '';
  if (message) {
    downloadMsg.value = message;
  }
  if (launchFeedbackTimer) {
    clearTimeout(launchFeedbackTimer);
  }
  launchFeedbackTimer = setTimeout(() => {
    launching.value = false;
    launchingPath.value = '';
  }, 4000);
}

function formatDbStatus(status) {
  switch (status) {
    case 'up-to-date':
      return 'Up to date';
    case 'update-available':
      return 'Update available';
    case 'not-provisioned':
      return 'Not provisioned';
    case 'unknown':
      return 'Unknown';
    default:
      return status || '—';
  }
}

function statusClass(status) {
  return {
    'st-ok': status === 'up-to-date',
    'st-warn': status === 'update-available' || status === 'not-provisioned',
    'st-muted': status === 'unknown'
  };
}

function dbNeedsMaintenance(status) {
  if (!status) return false;
  if (status.error) return true;
  return !!status.updatesAvailable;
}

/**
 * After a successful RHPlay download, offer database updates / provisioning if the manifest reports work is needed.
 */
async function maybePromptDatabaseMaintenance() {
  await refreshState();
  const s = await api.getState();
  const st = s.dbStatus;
  if (!dbNeedsMaintenance(st)) return;

  const lines = (st.rows || [])
    .filter((r) => r.status === 'update-available' || r.status === 'not-provisioned')
    .map(
      (r) =>
        `${r.dbName}: ${formatDbStatus(r.status)} (installed ${r.currentVersion} → target ${r.targetVersion})`
    );
  const errLine = st.error ? `Note: ${st.error}\n\n` : '';
  const msg =
    errLine +
    'Your databases need provisioning or updates for RHTools to work correctly.\n\n' +
    (lines.length ? lines.join('\n') : 'Action recommended.') +
    '\n\nRun database updates and provisioning now?';
  if (!window.confirm(msg)) return;

  if (!(await ensureRom())) return;

  busy.value = true;
  dbMsg.value = '';
  try {
    const chk = await api.checkDbUpdates();
    if (chk.success && chk.updatesAvailable && chk.updates?.length) {
      const r = await api.runDbUpdate();
      if (!r.success) {
        dbMsg.value = r.error || 'Database update failed.';
        window.alert(dbMsg.value);
        await refreshState();
        return;
      }
    }
    await refreshState();
    const s2 = await api.getState();
    if (dbNeedsMaintenance(s2.dbStatus)) {
      const r2 = await api.provisionDatabases();
      dbMsg.value = r2.success
        ? 'Database provisioning finished.'
        : r2.error || 'Provisioning failed.';
      if (!r2.success && r2.error) {
        window.alert(r2.error);
      }
    } else {
      dbMsg.value = 'Database maintenance finished.';
    }
    await refreshState();
  } finally {
    busy.value = false;
  }
}

async function refreshState() {
  const s = await api.getState();
  userDataDir.value = s.userDataDir || '';
  releasesDir.value = s.releasesDir || '';
  channel.value = s.channel || 'beta';
  manifestLoaded.value = !!s.manifestLoaded;
  coreManifest.value = s.coreManifest || null;
  rhplayEntry.value = s.rhplayEntry || null;
  entryError.value = s.entryError || null;
  installedRhplay.value = s.installedRhplay || [];
  bestLaunchCandidate.value = s.bestLaunchCandidate || null;
  dbmanifestPath.value = s.dbmanifestPath || '';
  dbmanifestSource.value = s.dbmanifestSource || '';
  dbmanifestError.value = s.dbmanifestError || null;
  databaseDir.value = s.databaseDir || s.userDataDir || '';
  provisionedJsonPath.value = s.provisionedJsonPath || '';
  provisionedJsonExists.value = !!s.provisionedJsonExists;
  dbStatus.value = s.dbStatus || null;
}

async function ensureRom() {
  const r = await api.checkRom();
  if (r.found || r.skipped) {
    romCheckModalOpen.value = false;
    return true;
  }
  romCheckModalOpen.value = true;
  return false;
}

async function browseRomFile() {
  romValidationError.value = null;
  const result = await api.selectRomFile();
  if (result.canceled) return;
  if (!result.success) {
    romValidationError.value = result.error || 'Validation failed';
    return;
  }
  const copy = await api.copyRom(result.path);
  if (!copy.success) {
    romValidationError.value = copy.error || 'Copy failed';
    return;
  }
  romCheckModalOpen.value = false;
}

onMounted(async () => {
  await refreshState();
  api.onOperationProgress((p) => {
    if (p.kind === 'download' && p.message) {
      downloadMsg.value = p.message;
    }
  });
  await ensureRom();
});

async function applyChannel() {
  await api.setChannel(channel.value);
  await refreshState();
}

async function refreshManifest() {
  busy.value = true;
  downloadMsg.value = '';
  try {
    const r = await api.refreshCoreManifest();
    downloadMsg.value = r.success ? 'Core manifest refreshed.' : r.error || 'Failed';
    await refreshState();
  } finally {
    busy.value = false;
  }
}

async function downloadRhplay() {
  if (!(await ensureRom())) return;
  busy.value = true;
  downloadMsg.value = '';
  try {
    const r = await api.downloadRhplay();
    downloadMsg.value = r.success ? `Saved: ${r.path}` : r.error || 'Failed';
    await refreshState();
    if (r.success) {
      await maybePromptDatabaseMaintenance();
    }
  } finally {
    busy.value = false;
  }
}

async function launch(exePath) {
  if (!(await ensureRom())) return;
  setLaunchFeedback(exePath, 'Launching RHPlay… (this can take a while on Windows)');
  const r = await api.launchRhplay(exePath);
  if (!r.success) {
    launching.value = false;
    launchingPath.value = '';
    alert(r.error || 'Launch failed');
    return;
  }
  setLaunchFeedback(exePath, 'Launch requested. If the window does not appear, check your releases build and logs.');
}

async function pickExecutable() {
  if (!(await ensureRom())) return;
  const r = await api.pickExecutable();
  if (r.canceled || !r.path) return;
  await launch(r.path);
}

function openReleasesFolder() {
  if (releasesDir.value) {
    api.openPath(releasesDir.value);
  }
}

async function doProvision() {
  if (!(await ensureRom())) return;
  busy.value = true;
  dbMsg.value = '';
  try {
    const r = await api.provisionDatabases();
    dbMsg.value = r.success ? 'Provision finished.' : r.error || JSON.stringify(r);
    await refreshState();
  } finally {
    busy.value = false;
  }
}

async function doDbUpdate() {
  if (!(await ensureRom())) return;
  busy.value = true;
  dbMsg.value = '';
  try {
    const r = await api.runDbUpdate();
    dbMsg.value =
      r.success === false ? r.error || JSON.stringify(r) : r.message || JSON.stringify(r);
    await refreshState();
  } finally {
    busy.value = false;
  }
}

async function doReprovision() {
  if (!(await ensureRom())) return;
  if (!window.confirm('Re-provision all databases? This may download large files.')) return;
  busy.value = true;
  dbMsg.value = '';
  try {
    const r = await api.reprovisionDatabases();
    dbMsg.value = r.success ? 'Re-provision finished.' : r.error || JSON.stringify(r);
    await refreshState();
  } finally {
    busy.value = false;
  }
}
</script>

<style>
:root {
  font-family: system-ui, sans-serif;
  color: #e8e8e8;
  background: #1a1d23;
}
.launcher {
  max-width: 880px;
  margin: 0 auto;
  padding: 1.25rem;
}
.header h1 {
  margin: 0 0 0.25rem;
  font-size: 1.5rem;
}
.sub {
  color: #9aa;
  margin: 0 0 1rem;
}
.card {
  background: #252830;
  border-radius: 8px;
  padding: 1rem 1.25rem;
  margin-bottom: 1rem;
  border: 1px solid #333a;
}
.card h2 {
  margin: 0 0 0.5rem;
  font-size: 1.1rem;
}
.hint {
  color: #9aa;
  font-size: 0.9rem;
}
.error {
  color: #f88;
}
.meta {
  font-size: 0.9rem;
}
.db-path-note {
  color: #8a9;
  font-size: 0.85rem;
}
.provisioned-line {
  font-size: 0.82rem;
}
.core-manifest-active {
  margin-bottom: 0.5rem;
  padding: 0.45rem 0.6rem;
  background: #1e222a;
  border-radius: 6px;
  border: 1px solid #3a4150;
}
.core-mf-label {
  color: #9aa;
  margin-right: 0.35rem;
}
.core-mf-ver {
  color: #cfe;
}
.core-mf-ts {
  color: #9aa;
  font-size: 0.85rem;
}
.core-mf-ts code {
  font-size: 0.82rem;
  color: #bdc;
}

.hash {
  display: block;
  font-family: ui-monospace, monospace;
  font-size: 0.8rem;
  color: #8a8;
  margin-top: 0.25rem;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 0.5rem;
}
button {
  cursor: pointer;
  padding: 0.45rem 0.85rem;
  border-radius: 6px;
  border: 1px solid #444;
  background: #333;
  color: #eee;
}
button.primary {
  background: #2d6a4f;
  border-color: #40916c;
}
button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
button.small {
  padding: 0.25rem 0.5rem;
  font-size: 0.85rem;
}
.log {
  font-family: ui-monospace, monospace;
  font-size: 0.8rem;
  white-space: pre-wrap;
  margin-top: 0.5rem;
  color: #bdc;
}
.db-table-wrap {
  margin: 0.75rem 0 1rem;
  overflow-x: auto;
}
.db-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.88rem;
}
.db-table th,
.db-table td {
  text-align: left;
  padding: 0.35rem 0.5rem;
  border-bottom: 1px solid #2a3140;
}
.db-table th {
  color: #9aa;
  font-weight: 600;
}
.db-name {
  font-family: ui-monospace, monospace;
  font-size: 0.82rem;
}
.st-ok {
  color: #8dcf8d;
}
.st-warn {
  color: #e8c070;
}
.st-muted {
  color: #778;
}
.warn {
  color: #e8c070;
  margin-top: 0.5rem;
}
.install-list {
  list-style: none;
  padding: 0;
  margin: 0;
}
.install-list li {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.35rem 0;
  border-bottom: 1px solid #333;
}
.ver {
  font-weight: 600;
  min-width: 5rem;
}
.fname {
  flex: 1;
  font-size: 0.85rem;
  color: #bbb;
  overflow: hidden;
  text-overflow: ellipsis;
}
.advanced {
  margin-top: 0.75rem;
}
.row label {
  margin-right: 1rem;
}
.footer {
  font-size: 0.75rem;
  color: #666;
  word-break: break-all;
}
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.65);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 1rem;
}
.modal-content {
  background: #252830;
  border: 1px solid #444;
  border-radius: 8px;
  max-width: 560px;
  max-height: 90vh;
  overflow: auto;
  padding: 1.25rem;
}
.rom-check-modal h2 {
  margin-top: 0;
}
.rom-check-explanation {
  font-size: 0.9rem;
  line-height: 1.45;
}
.rom-check-explanation ul {
  padding-left: 1.25rem;
}
.warranty {
  font-size: 0.72rem;
  line-height: 1.35;
}
.rom-error {
  color: #f88;
  margin: 0.5rem 0;
}
.rom-check-actions {
  margin-top: 1rem;
}
.fetch-settings-overlay {
  position: fixed;
  inset: 0;
  z-index: 1100;
}
</style>
