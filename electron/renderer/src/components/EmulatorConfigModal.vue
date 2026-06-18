<template>
  <div v-if="isOpen" class="modal-backdrop" @click.self="cancel">
    <div class="modal emulator-config-modal">
      <header class="modal-header">
        <h3>Emulator Config</h3>
        <button class="close" @click="cancel">✕</button>
      </header>

      <section class="modal-body">
        <div class="form-field">
          <label>Launch Program Preset</label>
          <select v-model="draft.launchProgramPreset" class="input">
            <option value="other">Other</option>
            <option value="retroarch">Retroarch</option>
            <option value="bizhawk">Bizhawk</option>
          </select>
        </div>

        <template v-if="draft.launchProgramPreset === 'other'">
          <div class="form-field">
            <label>Launch Program</label>
            <div class="file-row">
              <div
                class="drop-zone"
                @dragover.prevent
                @drop.prevent="handleLaunchProgramDrop"
              >
                Drag program file here
              </div>
              <button type="button" class="btn-secondary" @click="browseLaunchProgram">Browse</button>
            </div>
            <div v-if="draft.launchProgram" class="hint">
              Current: <code>{{ draft.launchProgram }}</code>
            </div>
          </div>
          <div class="form-field">
            <label>Launch Program Arguments</label>
            <input v-model="draft.launchProgramArgs" type="text" class="input" placeholder="%file" />
            <span class="hint">Use %file as placeholder for the ROM path</span>
          </div>
        </template>

        <template v-else-if="draft.launchProgramPreset === 'retroarch'">
          <p class="help-link-row">
            <button type="button" class="link-button" @click="openSetupHelp('retroarch')">
              RetroArch Download / Setup Instructions
            </button>
          </p>
          <div class="form-field">
            <label>RetroArch executable path</label>
            <div class="file-row">
              <input v-model="draft.retroarch_path" type="text" class="input path-input" />
              <button type="button" class="btn-secondary" @click="browseRetroarchExe">Browse</button>
              <button type="button" class="btn-secondary" @click="openSearch('retroarch_exe')">Search</button>
            </div>
          </div>
          <div class="form-field">
            <label>RetroArch SNES Core Path</label>
            <div class="file-row">
              <input v-model="draft.retroarch_core_path" type="text" class="input path-input" />
              <button type="button" class="btn-secondary" @click="browseRetroarchCore">Browse</button>
              <button type="button" class="btn-secondary" @click="openSearch('retroarch_core')">Search</button>
            </div>
          </div>
          <div class="form-field">
            <label>RetroArch append.cfg</label>
            <div v-if="appendConfigPath" class="hint">
              Path: <code>{{ appendConfigPath }}</code>
            </div>
            <div class="append-config-actions">
              <button type="button" class="btn-secondary" @click="toggleAppendEditor">
                {{ appendEditorOpen ? 'Hide Editor' : 'View / Edit' }}
              </button>
              <button type="button" class="btn-secondary" @click="restoreAppendConfigDefault">Restore Default</button>
            </div>
            <div v-if="appendEditorOpen" class="append-config-editor">
              <textarea
                v-model="appendConfigContent"
                class="input append-config-textarea"
                rows="12"
                spellcheck="false"
              />
              <button type="button" class="btn-secondary" @click="saveAppendConfig">Save append.cfg</button>
            </div>
          </div>
        </template>

        <template v-else-if="draft.launchProgramPreset === 'bizhawk'">
          <p class="help-link-row">
            <button type="button" class="link-button" @click="openSetupHelp('bizhawk')">
              BizHawk Download / Setup Instructions
            </button>
          </p>
          <div class="form-field">
            <label>BizHawk executable path</label>
            <div class="file-row">
              <input v-model="draft.bizhawk_path" type="text" class="input path-input" />
              <button type="button" class="btn-secondary" @click="browseBizhawkExe">Browse</button>
              <button type="button" class="btn-secondary" @click="openSearch('bizhawk_exe')">Search</button>
            </div>
          </div>
        </template>
      </section>

      <footer class="modal-footer">
        <button type="button" class="btn-primary" @click="save">Save</button>
        <button type="button" class="btn-secondary" @click="cancel">Cancel</button>
      </footer>
    </div>

    <EmulatorPathSearchModal
      :is-open="searchModalOpen"
      :kind="searchKind"
      :retroarch_path="draft.retroarch_path"
      @close="searchModalOpen = false"
      @select="handleSearchSelect"
    />
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, watch } from 'vue';
import EmulatorPathSearchModal, { type EmulatorSearchKind } from './EmulatorPathSearchModal.vue';
import { showAlert } from '../utils/dialogs';

export interface EmulatorConfigDraft {
  launchProgramPreset: 'other' | 'retroarch' | 'bizhawk';
  launchProgram: string;
  launchProgramArgs: string;
  retroarch_path: string;
  retroarch_core_path: string;
  bizhawk_path: string;
}

const props = defineProps<{
  isOpen: boolean;
  settings: EmulatorConfigDraft;
}>();

const emit = defineEmits<{
  close: [];
  save: [draft: EmulatorConfigDraft];
}>();

const draft = reactive<EmulatorConfigDraft>({
  launchProgramPreset: 'other',
  launchProgram: '',
  launchProgramArgs: '%file',
  retroarch_path: '',
  retroarch_core_path: '',
  bizhawk_path: '',
});

const searchModalOpen = ref(false);
const searchKind = ref<EmulatorSearchKind>('retroarch_exe');
const appendConfigPath = ref('');
const appendConfigContent = ref('');
const appendEditorOpen = ref(false);

function openSearch(kind: EmulatorSearchKind) {
  searchKind.value = kind;
  searchModalOpen.value = true;
}

function handleSearchSelect(path: string) {
  if (searchKind.value === 'retroarch_exe') {
    draft.retroarch_path = path;
  } else if (searchKind.value === 'retroarch_core') {
    draft.retroarch_core_path = path;
  } else if (searchKind.value === 'bizhawk_exe') {
    draft.bizhawk_path = path;
  }
  searchModalOpen.value = false;
}

function copyFromSettings() {
  draft.launchProgramPreset = props.settings.launchProgramPreset || 'other';
  draft.launchProgram = props.settings.launchProgram || '';
  draft.launchProgramArgs = props.settings.launchProgramArgs || '%file';
  draft.retroarch_path = props.settings.retroarch_path || '';
  draft.retroarch_core_path = props.settings.retroarch_core_path || '';
  draft.bizhawk_path = props.settings.bizhawk_path || '';
}

watch(() => props.isOpen, async (open) => {
  if (open) {
    copyFromSettings();
    await detectPathsIfNeeded();
    await loadAppendConfigMeta();
  } else {
    appendEditorOpen.value = false;
  }
});

async function loadAppendConfigMeta() {
  const api = (window as any)?.electronAPI;
  if (!api?.getRetroarchAppendConfigPath) {
    await showAlert('RetroArch append.cfg is unavailable in this build. Restart the app after updating.', 'Append Config Unavailable');
    return;
  }
  try {
    const pathResult = await api.getRetroarchAppendConfigPath();
    if (pathResult?.success && pathResult.path) {
      appendConfigPath.value = pathResult.path;
    } else {
      await showAlert(pathResult?.error || 'Could not resolve append.cfg path.', 'Append Config Error');
    }
  } catch (err) {
    console.warn('[EmulatorConfigModal] getRetroarchAppendConfigPath failed:', err);
    await showAlert(String((err as Error)?.message || err), 'Append Config Error');
  }
}

async function loadAppendConfigContent() {
  const api = (window as any)?.electronAPI;
  if (!api?.readRetroarchAppendConfig) {
    await showAlert('RetroArch append.cfg is unavailable in this build. Restart the app after updating.', 'Append Config Unavailable');
    return;
  }
  const result = await api.readRetroarchAppendConfig();
  if (result?.success) {
    appendConfigPath.value = result.path || appendConfigPath.value;
    appendConfigContent.value = result.content || '';
    if (!appendConfigContent.value.trim()) {
      await showAlert('append.cfg is empty. Use Restore Default to load the bundled template.', 'Append Config Empty');
    }
  } else {
    await showAlert(result?.error || 'Could not read append.cfg.', 'Append Config Error');
  }
}

async function toggleAppendEditor() {
  appendEditorOpen.value = !appendEditorOpen.value;
  if (appendEditorOpen.value) {
    await loadAppendConfigContent();
  }
}

async function saveAppendConfig() {
  const api = (window as any)?.electronAPI;
  if (!api?.writeRetroarchAppendConfig) return;
  const result = await api.writeRetroarchAppendConfig(appendConfigContent.value);
  if (!result?.success) {
    console.warn('[EmulatorConfigModal] writeRetroarchAppendConfig failed:', result?.error);
  } else if (result.path) {
    appendConfigPath.value = result.path;
  }
}

async function restoreAppendConfigDefault() {
  const api = (window as any)?.electronAPI;
  if (!api?.restoreRetroarchAppendConfig) {
    await showAlert('RetroArch append.cfg is unavailable in this build. Restart the app after updating.', 'Append Config Unavailable');
    return;
  }
  const result = await api.restoreRetroarchAppendConfig();
  if (result?.success) {
    appendConfigPath.value = result.path || appendConfigPath.value;
    appendConfigContent.value = result.content || '';
    appendEditorOpen.value = true;
    if (!appendConfigContent.value.trim()) {
      await showAlert('Restore completed but append.cfg is still empty. The bundled template may be missing from this install.', 'Append Config Empty');
    }
  } else {
    await showAlert(result?.error || 'Could not restore append.cfg default.', 'Append Config Error');
  }
}

async function detectPathsIfNeeded() {
  const api = (window as any)?.electronAPI;
  if (!api?.detectEmulatorPaths) return;
  try {
    const detected = await api.detectEmulatorPaths({
      retroarch_path: draft.retroarch_path,
      retroarch_core_path: draft.retroarch_core_path,
      bizhawk_path: draft.bizhawk_path,
    });
    if (!draft.retroarch_path && detected.retroarch_path) draft.retroarch_path = detected.retroarch_path;
    if (!draft.retroarch_core_path && detected.retroarch_core_path) draft.retroarch_core_path = detected.retroarch_core_path;
    if (!draft.bizhawk_path && detected.bizhawk_path) draft.bizhawk_path = detected.bizhawk_path;
  } catch (err) {
    console.warn('[EmulatorConfigModal] detectEmulatorPaths failed:', err);
  }
}

function isElectronAvailable() {
  return typeof window !== 'undefined' && !!(window as any).electronAPI;
}

async function showOpenDialog(options: Record<string, unknown>) {
  if (!isElectronAvailable()) return null;
  return (window as any).electronAPI.showOpenDialog(options);
}

async function browseLaunchProgram() {
  const result = await showOpenDialog({
    title: 'Select Launch Program',
    filters: [
      { name: 'Executable Files', extensions: ['exe', 'sh', 'bat', 'cmd', '*'] },
      { name: 'All Files', extensions: ['*'] },
    ],
    properties: ['openFile'],
  });
  if (result && !result.canceled && result.filePaths?.length) {
    draft.launchProgram = result.filePaths[0];
  }
}

async function browseRetroarchExe() {
  const result = await showOpenDialog({
    title: 'Select RetroArch Executable',
    filters: [{ name: 'All Files', extensions: ['*'] }],
    properties: ['openFile'],
  });
  if (result && !result.canceled && result.filePaths?.length) {
    draft.retroarch_path = result.filePaths[0];
  }
}

async function browseRetroarchCore() {
  const result = await showOpenDialog({
    title: 'Select RetroArch SNES Core',
    filters: [{ name: 'All Files', extensions: ['*'] }],
    properties: ['openFile'],
  });
  if (result && !result.canceled && result.filePaths?.length) {
    draft.retroarch_core_path = result.filePaths[0];
  }
}

async function browseBizhawkExe() {
  const result = await showOpenDialog({
    title: 'Select BizHawk Executable',
    filters: [{ name: 'All Files', extensions: ['*'] }],
    properties: ['openFile'],
  });
  if (result && !result.canceled && result.filePaths?.length) {
    draft.bizhawk_path = result.filePaths[0];
  }
}

function handleLaunchProgramDrop(e: DragEvent) {
  const files = e.dataTransfer?.files;
  if (files && files.length > 0 && (files[0] as any).path) {
    draft.launchProgram = (files[0] as any).path;
  }
}

async function openSetupHelp(docId: 'retroarch' | 'bizhawk') {
  const api = (window as any)?.electronAPI;
  if (api?.openSetupHelpDoc) {
    await api.openSetupHelpDoc(docId);
  }
}

async function save() {
  const api = (window as any)?.electronAPI;
  let payload = { ...draft };
  if (api?.applyEmulatorPreset) {
    const applied = await api.applyEmulatorPreset(draft.launchProgramPreset, {
      launchProgram: draft.launchProgram,
      launchProgramArgs: draft.launchProgramArgs,
      retroarch_path: draft.retroarch_path,
      retroarch_core_path: draft.retroarch_core_path,
      bizhawk_path: draft.bizhawk_path,
    });
    if (applied?.success && applied.settings) {
      payload = { ...draft, ...applied.settings };
    }
  }
  emit('save', payload);
}

function cancel() {
  emit('close');
}
</script>

<style scoped>
.emulator-config-modal {
  width: min(560px, 92vw);
  max-height: 90vh;
  overflow: auto;
}

.form-field {
  margin-bottom: 16px;
}

.form-field label {
  display: block;
  font-weight: 600;
  margin-bottom: 6px;
}

.file-row {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  flex-wrap: wrap;
}

.path-input {
  flex: 1;
  min-width: 180px;
}

.drop-zone {
  flex: 1;
  border: 1px dashed var(--border-primary, #ccc);
  border-radius: 4px;
  padding: 10px;
  font-size: 13px;
  color: var(--text-secondary, #666);
}

.input {
  width: 100%;
  padding: 8px;
  box-sizing: border-box;
}

.hint {
  display: block;
  font-size: 12px;
  color: var(--text-secondary, #666);
  margin-top: 4px;
}

.help-link-row {
  margin: 0 0 12px;
}

.link-button {
  background: none;
  border: none;
  color: var(--link-color, #0b57d0);
  cursor: pointer;
  padding: 0;
  text-decoration: underline;
  font-size: 20px;
}

.modal-footer {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  padding: 12px 16px;
  border-top: 1px solid var(--border-primary, #ddd);
}

.append-config-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 6px;
}

.append-config-editor {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.append-config-textarea {
  font-family: ui-monospace, monospace;
  font-size: 12px;
  min-height: 200px;
}
</style>
