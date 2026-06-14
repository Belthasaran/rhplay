<template>
  <div v-if="isOpen" class="search-modal-backdrop" @click.self="close">
    <div class="search-modal">
      <header class="search-modal-header">
        <h3>{{ modalTitle }}</h3>
        <button type="button" class="close" @click="close">✕</button>
      </header>

      <section class="search-modal-body">
        <p v-if="loading" class="status-text">Searching standard paths...</p>
        <p v-else-if="installing" class="status-text">{{ installStatus }}</p>
        <p v-else-if="statusMessage" class="status-text" :class="{ error: statusIsError }">{{ statusMessage }}</p>

        <div v-if="!loading && foundPaths.length > 0" class="path-list">
          <button
            v-for="p in foundPaths"
            :key="p"
            type="button"
            class="path-row"
            :class="{ selected: selectedPath === p }"
            @click="selectPath(p)"
            @dblclick="usePath(p)"
          >
            {{ p }}
          </button>
        </div>

        <div v-else-if="!loading && !installing" class="empty-state">
          <p class="empty-message">No matching files were found at standard installation paths.</p>
          <button
            v-if="helpDocId"
            type="button"
            class="help-link"
            @click="openSetupHelp"
          >
            {{ helpLinkLabel }}
          </button>
          <p v-if="showRetroarchCoreNote" class="hint">
            On Windows, install RetroArch first, then use RetroArch Online Updater to install the SNES9x core.
          </p>
          <div v-if="showInstallButtons" class="install-actions">
            <button
              v-if="capabilities.apt"
              type="button"
              class="btn-primary"
              :disabled="installing"
              @click="runInstall"
            >
              Install using APT
            </button>
            <button
              v-if="capabilities.winget"
              type="button"
              class="btn-primary"
              :disabled="installing"
              @click="runInstall"
            >
              Install using Winget
            </button>
          </div>
        </div>
      </section>

      <footer class="search-modal-footer">
        <button
          type="button"
          class="btn-primary"
          :disabled="!selectedPath"
          @click="confirmSelection"
        >
          Use Selected
        </button>
        <button type="button" class="btn-secondary" @click="close">Cancel</button>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';

export type EmulatorSearchKind = 'retroarch_exe' | 'retroarch_core' | 'bizhawk_exe';

const props = defineProps<{
  isOpen: boolean;
  kind: EmulatorSearchKind;
  retroarch_path?: string;
}>();

const emit = defineEmits<{
  close: [];
  select: [path: string];
}>();

const loading = ref(false);
const installing = ref(false);
const installStatus = ref('');
const statusMessage = ref('');
const statusIsError = ref(false);
const foundPaths = ref<string[]>([]);
const selectedPath = ref('');
const capabilities = ref({ apt: false, winget: false });

const modalTitle = computed(() => {
  if (props.kind === 'retroarch_exe') return 'Search RetroArch Executable';
  if (props.kind === 'retroarch_core') return 'Search RetroArch SNES Core';
  return 'Search BizHawk Executable';
});

const helpDocId = computed(() => {
  if (props.kind === 'bizhawk_exe') return 'bizhawk';
  if (props.kind === 'retroarch_exe' || props.kind === 'retroarch_core') return 'retroarch';
  return null;
});

const helpLinkLabel = computed(() => {
  if (props.kind === 'bizhawk_exe') return 'BizHawk Download / Setup Instructions';
  return 'RetroArch Download / Setup Instructions';
});

const showInstallButtons = computed(() => {
  return props.kind === 'retroarch_exe' || props.kind === 'retroarch_core';
});

const showRetroarchCoreNote = computed(() => {
  return props.kind === 'retroarch_core' && capabilities.value.winget;
});

function api() {
  return (window as any)?.electronAPI;
}

async function loadCapabilities() {
  const res = await api()?.getEmulatorInstallCapabilities?.();
  if (res?.success !== false) {
    capabilities.value = { apt: !!res?.apt, winget: !!res?.winget };
  }
}

async function runSearch() {
  loading.value = true;
  statusMessage.value = '';
  statusIsError.value = false;
  selectedPath.value = '';
  foundPaths.value = [];
  try {
    const res = await api()?.searchEmulatorPaths?.({
      kind: props.kind,
      retroarch_path: props.retroarch_path || '',
    });
    if (res?.success === false) {
      statusMessage.value = res.error || 'Search failed';
      statusIsError.value = true;
      return;
    }
    foundPaths.value = res?.found || [];
    if (foundPaths.value.length === 1) {
      selectedPath.value = foundPaths.value[0];
    }
  } catch (err: any) {
    statusMessage.value = err?.message || String(err);
    statusIsError.value = true;
  } finally {
    loading.value = false;
  }
}

async function runInstall() {
  installing.value = true;
  installStatus.value = 'Running install (elevation may be required)...';
  statusMessage.value = '';
  statusIsError.value = false;
  try {
    const res = await api()?.installRetroarch?.();
    if (!res?.success) {
      statusMessage.value = res?.error || 'Install failed';
      statusIsError.value = true;
      return;
    }
    statusMessage.value = res.message || 'Install completed. Searching again...';
    await runSearch();
  } catch (err: any) {
    statusMessage.value = err?.message || String(err);
    statusIsError.value = true;
  } finally {
    installing.value = false;
    installStatus.value = '';
  }
}

function selectPath(p: string) {
  selectedPath.value = p;
}

function usePath(p: string) {
  emit('select', p);
  emit('close');
}

function confirmSelection() {
  if (!selectedPath.value) return;
  emit('select', selectedPath.value);
  emit('close');
}

function close() {
  emit('close');
}

async function openSetupHelp() {
  const docId = helpDocId.value;
  if (docId) {
    await api()?.openSetupHelpDoc?.(docId);
  }
}

watch(() => props.isOpen, async (open) => {
  if (open) {
    await loadCapabilities();
    await runSearch();
  } else {
    foundPaths.value = [];
    selectedPath.value = '';
    statusMessage.value = '';
    statusIsError.value = false;
  }
});
</script>

<style scoped>
.search-modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 12000;
}

.search-modal {
  width: min(640px, 94vw);
  max-height: 85vh;
  background: var(--bg-secondary, #fff);
  border-radius: 8px;
  border: 1px solid var(--border-primary, #ccc);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.search-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-primary, #ddd);
}

.search-modal-header h3 {
  margin: 0;
  font-size: 1.1rem;
}

.search-modal-body {
  padding: 16px;
  overflow-y: auto;
  flex: 1;
}

.path-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.path-row {
  text-align: left;
  padding: 10px 12px;
  border: 1px solid var(--border-primary, #ccc);
  border-radius: 4px;
  background: var(--bg-primary, #fafafa);
  cursor: pointer;
  font-family: monospace;
  font-size: 13px;
  word-break: break-all;
}

.path-row.selected {
  border-color: #0b57d0;
  background: rgba(11, 87, 208, 0.1);
}

.empty-state {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.empty-message {
  margin: 0;
  color: var(--text-secondary, #666);
}

.help-link {
  background: none;
  border: none;
  color: var(--link-color, #0b57d0);
  cursor: pointer;
  padding: 0;
  text-decoration: underline;
  font-size: 20px;
  text-align: left;
}

.hint {
  margin: 0;
  font-size: 13px;
  color: var(--text-secondary, #666);
}

.install-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.status-text {
  margin: 0 0 12px;
  font-size: 14px;
}

.status-text.error {
  color: #c62828;
}

.search-modal-footer {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  padding: 12px 16px;
  border-top: 1px solid var(--border-primary, #ddd);
}

.btn-primary,
.btn-secondary {
  padding: 8px 14px;
  border-radius: 4px;
  cursor: pointer;
}

.btn-primary {
  background: var(--accent-primary, #0b57d0);
  color: var(--button-text, #fff);
  border: none;
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-secondary {
  background: var(--bg-primary, #eee);
  border: 1px solid var(--border-primary, #ccc);
}

.close {
  background: none;
  border: none;
  font-size: 18px;
  cursor: pointer;
}
</style>
