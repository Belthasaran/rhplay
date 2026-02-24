<template>
  <div v-if="visible" class="modal-backdrop" @click.self="handleClose">
    <div class="modal load-manual-dialog">
      <header class="modal-header">
        <h3>Load Manual</h3>
        <button class="close" @click="handleClose">✕</button>
      </header>

      <div class="load-manual-tabs">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          :class="['tab-btn', { active: activeTab === tab.id }]"
          @click="activeTab = tab.id"
        >
          {{ tab.label }}
        </button>
      </div>

      <section class="modal-body">
        <!-- From File -->
        <div v-if="activeTab === 'file'" class="load-manual-mode">
          <div class="mode-controls">
            <div class="file-path-row">
              <input type="text" readonly :value="filePath" class="file-path-input" placeholder="No file selected" />
              <button class="btn-secondary" @click="browseFile">Browse</button>
            </div>
          </div>
        </div>

        <!-- Load Raw URL -->
        <div v-if="activeTab === 'url'" class="load-manual-mode">
          <div class="mode-controls">
            <input
              v-model="url"
              type="text"
              class="url-input"
              placeholder="https://example.com/game.zip"
            />
          </div>
        </div>

        <!-- From Page / From SMWC -->
        <div v-if="activeTab === 'page' || activeTab === 'smwc'" class="load-manual-mode">
          <div class="mode-controls">
            <input
              v-if="activeTab === 'smwc'"
              v-model="smwcGameId"
              type="text"
              class="smwc-id-input"
              placeholder="SMWC Game ID (e.g. 41560)"
            />
            <input
              v-else
              v-model="pageUrl"
              type="text"
              class="url-input"
              placeholder="Page URL"
            />
          </div>
          <div class="page-actions">
            <button class="btn-secondary" @click="openBrowserPage">
              Open Page
            </button>
            <template v-if="activeTab === 'page'">
              <button
                v-for="chip in pageQuickChips"
                :key="chip.label"
                class="page-quick-chip"
                @click="openQuickChip(chip)"
              >
                {{ chip.label }}
              </button>
            </template>
          </div>
          <p v-if="downloadFeedback" class="download-feedback">
            {{ downloadFeedback }}
          </p>
          <p v-if="downloadedFilePath" class="download-status">
            {{ getFileNameFromPath(downloadedFilePath) }} – ready for Add Test Pack
          </p>
        </div>

        <!-- BPS selection (when multiple BPS in archive) -->
        <div v-if="bpsEntries.length > 1" class="bps-select-section">
          <label>Select BPS file to use:</label>
          <select v-model="selectedBpsPath" class="bps-select">
            <option value="" disabled>Choose one...</option>
            <option v-for="e in bpsEntries" :key="e.path" :value="e.path">
              {{ e.path }}
            </option>
          </select>
        </div>

        <!-- Common metadata fields -->
        <div class="metadata-section">
          <h4>Metadata</h4>
          <div class="metadata-grid">
            <label>
              Game ID
              <input v-model="gameid" type="text" placeholder="Optional (auto-generated if empty)" />
            </label>
            <label>
              Name
              <input v-model="name" type="text" placeholder="Game name" />
            </label>
            <label>
              Author
              <input v-model="author" type="text" placeholder="Author" />
            </label>
            <label>
              Difficulty
              <input v-model="difficulty" type="text" placeholder="e.g. Intermediate" />
            </label>
            <label>
              Type
              <input v-model="type" type="text" placeholder="e.g. Standard" />
            </label>
          </div>
        </div>

        <div v-if="error" class="load-manual-error">{{ error }}</div>
        <div v-if="success" class="load-manual-success">{{ success }}</div>
      </section>

      <footer class="modal-footer">
        <button
          class="btn-primary"
          :disabled="adding || !canAdd"
          @click="addTestPack"
        >
          {{ adding ? 'Adding…' : 'Add Test Pack' }}
        </button>
        <button class="btn-secondary" @click="handleClose">Close</button>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';

const props = defineProps<{
  visible: boolean;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'added', gameid: string | null): void;
}>();

const activeTab = ref<'file' | 'url' | 'page' | 'smwc'>('file');
const tabs = [
  { id: 'file' as const, label: 'From File' },
  { id: 'url' as const, label: 'Load Raw URL' },
  { id: 'page' as const, label: 'From Page' },
  { id: 'smwc' as const, label: 'From SMWC Game ID' },
];

const pageQuickChips: { label: string; url: string }[] = [
  { label: 'SMWC', url: 'https://www.smwcentral.net/?p=section&s=smwhacks' },
  { label: 'RHDN', url: 'https://www.romhacking.net/?page=hacks&category=&platform=&game=714&order=&perpage=20&dir=&title=&search=Go' },
  { label: 'SMWC_W', url: 'https://smwcworld.com/' },
  { label: 'SMWDB', url: 'https://smwdb.me/' },
  { label: 'RHR', url: 'https://www.romhackraces.com/eventlevels.php' },
];

const filePath = ref('');
const url = ref('');
const pageUrl = ref('');
const smwcGameId = ref('');
const gameid = ref('');
const name = ref('');
const author = ref('');
const difficulty = ref('');
const type = ref('');

const bpsEntries = ref<{ path: string; baseName: string }[]>([]);
const selectedBpsPath = ref('');
const metadataByBps = ref<Record<string, { gameid?: string; name?: string; author?: string; difficulty?: string; type?: string }>>({});

const downloadedFilePath = ref('');
const browserWebContentsId = ref<number | null>(null);
const downloadFeedback = ref('');

const error = ref('');
const success = ref('');
const adding = ref(false);

const api = computed(() => (window as any).electronAPI);

const canAdd = computed(() => {
  if (activeTab.value === 'file') return !!filePath.value;
  if (activeTab.value === 'url') return !!url.value.trim();
  if (activeTab.value === 'page' || activeTab.value === 'smwc') return !!downloadedFilePath.value;
  return false;
});

watch(() => props.visible, (v) => {
  if (v) reset();
});

let unsubscribeDownloadComplete: (() => void) | null = null;
onMounted(() => {
  const electronAPI = (window as any).electronAPI;
  unsubscribeDownloadComplete = electronAPI?.onLoadManualDownloadComplete?.(async (data: {
    tempPath: string;
    suggestedFilename?: string;
    webContentsId?: number | null;
  }) => {
    error.value = '';
    downloadedFilePath.value = data.tempPath;
    filePath.value = data.tempPath;
    downloadFeedback.value = 'Download successful.';

    const wcId = data.webContentsId;
    if (wcId != null) {
      downloadFeedback.value = 'Download successful. Scraping metadata...';
      try {
        const scraped = await electronAPI.loadManualScrapePage({ webContentsId: wcId });
        if (scraped && !scraped.error) {
          if (scraped.name) name.value = scraped.name;
          if (scraped.authors) author.value = scraped.authors;
          if (scraped.difficulty) difficulty.value = scraped.difficulty;
          if (scraped.type) type.value = scraped.type;
          downloadFeedback.value = 'Download successful. Metadata scraped from page.';
        } else {
          downloadFeedback.value = 'Download successful. (Metadata scrape skipped.)';
        }
      } catch {
        downloadFeedback.value = 'Download successful. (Metadata scrape skipped.)';
      }
      electronAPI.loadManualCloseBrowserWindow?.();
      browserWebContentsId.value = null;
    }

    await inspectSelectedFile(data.tempPath);
  }) ?? null;
});
onUnmounted(() => {
  unsubscribeDownloadComplete?.();
});

watch(selectedBpsPath, (path) => {
  if (!path) return;
  const meta = metadataByBps.value[path];
  if (meta) {
    if (meta.gameid) gameid.value = meta.gameid;
    if (meta.name) name.value = meta.name;
    if (meta.author) author.value = meta.author;
    if (meta.difficulty) difficulty.value = meta.difficulty;
    if (meta.type) type.value = meta.type;
  }
});

async function browseFile() {
  error.value = '';
  const result = await api.value.selectFiles({
    title: 'Select BPS, ZIP, 7z, or RHPAK file',
    filters: [
      { name: 'Game files', extensions: ['bps', 'zip', '7z', 'rhpak'] },
      { name: 'All files', extensions: ['*'] },
    ],
    properties: ['openFile'],
  });
  if (result.canceled || !result.filePaths?.length) return;
  filePath.value = result.filePaths[0];
  await inspectSelectedFile(filePath.value);
}

async function inspectSelectedFile(path: string) {
  if (!path) return;
  const ext = (path.split('.').pop() || '').toLowerCase();
  if (ext === 'rhpak') {
    try {
      const meta = await api.value.loadManualInspectRhpak({ filePath: path });
      if (meta && !meta.error) {
        if (meta.gameid) gameid.value = meta.gameid;
        if (meta.name) name.value = meta.name;
        if (meta.author) author.value = meta.author;
        if (meta.difficulty) difficulty.value = meta.difficulty;
        if (meta.type) type.value = meta.type;
      }
      bpsEntries.value = [];
      selectedBpsPath.value = '';
    } catch (e) {
      console.warn('[LoadManual] inspect-rhpak failed:', e);
    }
    return;
  }
  if (ext === 'zip' || ext === '7z') {
    try {
      const result = await api.value.loadManualInspectArchive({ filePath: path });
      if (result?.error) {
        error.value = result.error;
        bpsEntries.value = [];
        selectedBpsPath.value = '';
        metadataByBps.value = {};
        return;
      }
      bpsEntries.value = result.bpsEntries || [];
      metadataByBps.value = result.metadataByBps || {};
      if (bpsEntries.value.length === 1) {
        selectedBpsPath.value = bpsEntries.value[0].path;
        const meta = metadataByBps.value[bpsEntries.value[0].path];
        if (meta) {
          if (meta.gameid) gameid.value = meta.gameid;
          if (meta.name) name.value = meta.name;
          if (meta.author) author.value = meta.author;
          if (meta.difficulty) difficulty.value = meta.difficulty;
          if (meta.type) type.value = meta.type;
        }
      } else {
        selectedBpsPath.value = '';
      }
    } catch (e) {
      console.warn('[LoadManual] inspect-archive failed:', e);
      bpsEntries.value = [];
      selectedBpsPath.value = '';
      metadataByBps.value = {};
    }
    return;
  }
  bpsEntries.value = [];
  selectedBpsPath.value = '';
  metadataByBps.value = {};
}

function getFileNameFromPath(p: string) {
  if (!p) return '';
  const parts = p.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || p;
}

async function openBrowserPage() {
  let targetUrl = '';
  if (activeTab.value === 'smwc') {
    const id = smwcGameId.value.trim();
    //if (!id) { error.value = 'Enter SMWC Game ID'; return; }
    if (id) { 
        targetUrl = `https://www.smwcentral.net/?p=section&a=details&id=${id}`;
    } else {
        targetUrl = 'https://www.smwcentral.net/?p=section&s=smwhacks';
    }
  } else {
    targetUrl = pageUrl.value.trim();
    if (!targetUrl) { error.value = 'Enter page URL'; return; }
    if (!targetUrl.startsWith('http')) targetUrl = 'https://' + targetUrl;
  }
  error.value = '';
  try {
    const res = await api.value.loadManualCreateBrowserWindow({ url: targetUrl });
    if (res?.success && res.webContentsId) {
      browserWebContentsId.value = res.webContentsId;
    }
  } catch (e: any) {
    error.value = e?.message || 'Failed to open browser';
  }
}

function openQuickChip(chip: { label: string; url: string }) {
  pageUrl.value = chip.url;
  openBrowserPage();
}

async function addTestPack() {
  error.value = '';
  success.value = '';
  adding.value = true;
  try {
    let result: { success: boolean; gameid?: string | null; error?: string };
    const targetPath = (activeTab.value === 'page' || activeTab.value === 'smwc') ? downloadedFilePath.value : filePath.value;
    if (activeTab.value === 'file' || activeTab.value === 'page' || activeTab.value === 'smwc') {
      if (!targetPath) throw new Error(activeTab.value === 'file' ? 'No file selected' : 'Download a file from the browser first');
      if (bpsEntries.value.length > 1 && !selectedBpsPath.value) {
        throw new Error('Please select a BPS file from the list');
      }
      result = await api.value.loadManualCreateFromFile({
        filePath: targetPath,
        selectedBpsPath: bpsEntries.value.length > 1 ? selectedBpsPath.value : undefined,
        gameid: gameid.value || undefined,
        name: name.value || undefined,
        author: author.value || undefined,
        difficulty: difficulty.value || undefined,
        type: type.value || undefined,
      });
    } else if (activeTab.value === 'url') {
      if (!url.value.trim()) throw new Error('No URL entered');
      result = await api.value.loadManualCreateFromUrl({
        url: url.value.trim(),
        selectedBpsPath: bpsEntries.value.length > 1 ? selectedBpsPath.value : undefined,
        gameid: gameid.value || undefined,
        name: name.value || undefined,
        author: author.value || undefined,
        difficulty: difficulty.value || undefined,
        type: type.value || undefined,
      });
    } else {
      throw new Error('Unknown mode');
    }
    if (result?.success) {
      success.value = 'Game added successfully.';
      emit('added', result.gameid ?? null);
      setTimeout(() => handleClose(), 800);
    } else {
      error.value = result?.error || 'Failed to add game';
    }
  } catch (e: any) {
    error.value = e?.message || 'Failed to add game';
  } finally {
    adding.value = false;
  }
}

function handleClose() {
  emit('close');
}

function reset() {
  filePath.value = '';
  url.value = '';
  pageUrl.value = '';
  smwcGameId.value = '';
  gameid.value = '';
  name.value = '';
  author.value = '';
  difficulty.value = '';
  type.value = '';
  bpsEntries.value = [];
  selectedBpsPath.value = '';
  metadataByBps.value = {};
  downloadedFilePath.value = '';
  browserWebContentsId.value = null;
  downloadFeedback.value = '';
  error.value = '';
  success.value = '';
  activeTab.value = 'file';
}

defineExpose({ reset });
</script>

<style scoped>
.load-manual-dialog {
  max-width: 600px;
}
.load-manual-tabs {
  display: flex;
  gap: 4px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--border-primary);
}
.tab-btn {
  padding: 8px 16px;
  border: none;
  background: var(--bg-secondary);
  color: var(--text-primary);
  cursor: pointer;
  border-radius: 4px;
}
.tab-btn.active {
  background: var(--accent-primary);
  color: var(--button-text);
}
.load-manual-mode {
  margin-bottom: 16px;
}
.mode-controls {
  display: flex;
  flex-direction: column;
  font-size: 24px;
  gap: 8px;
}
.file-path-row {
  display: flex;
  gap: 8px;
}
.file-path-input {
  flex: 1;
  padding: 8px;
  border: 1px solid #ccc;
  border-radius: 4px;
}
.url-input,
.smwc-id-input {
  width: 100%;
  padding: 8px;
  border: 1px solid #ccc;
  border-radius: 4px;
}
.bps-select-section {
  margin: 16px 0;
  padding: 12px;
  background: #f5f5f5;
  border-radius: 4px;
}
.bps-select-section label {
  display: block;
  margin-bottom: 8px;
  font-weight: 500;
}
.bps-select {
  width: 100%;
  padding: 8px;
  border: 1px solid #ccc;
  border-radius: 4px;
}
.metadata-section {
  margin-top: 16px;
}
.metadata-section h4 {
  margin: 0 0 12px 0;
}
.metadata-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.metadata-grid label {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.metadata-grid input {
  padding: 8px;
  border: 1px solid #ccc;
  border-radius: 4px;
}
.load-manual-error {
  color: #d32f2f;
  margin-top: 22px;
}
.load-manual-success {
  color: #2e7d32;
  margin-top: 22px;
}
.page-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
  flex-wrap: wrap;
  align-items: center;
}
.page-quick-chip {
  padding: 6px 12px;
  font-size: 0.85rem;
  border-radius: 16px;
  border: 1px solid var(--border-primary);
  background: var(--bg-secondary);
  color: var(--text-primary);
  cursor: pointer;
}
.page-quick-chip:hover {
  background: var(--bg-hover);
  border-color: var(--border-secondary);
}
.download-feedback {
  color: #1565c0;
  font-size: 24px;
  margin-top: 12px;
  font-weight: 500;
}
.download-status {
  color: #2e7d32;
  font-size: 24px;
  margin-top: 8px;
}
.mode-controls input, .url-input {
  height: 30px;
  font-size: 24px;
}
.metadata-grid input {
  height: 25px;
  font-size: 24px;
}
</style>
