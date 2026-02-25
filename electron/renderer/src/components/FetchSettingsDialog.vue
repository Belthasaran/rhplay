<template>
  <div v-if="visible" class="modal-backdrop" @click.self="handleBackdropClick">
    <div class="modal fetch-settings-dialog">
      <header class="modal-header">
        <h3>File Transfer and Peer-to-Peer Settings</h3>
        <button v-if="!isBlocking" class="close" @click="handleClose">✕</button>
      </header>
      <section class="modal-body">
        <p class="dialog-description">
          File download method settings for Software Updates & SMW Romhack Resource Files.
        </p>

        <div class="settings-section">
          <h4>IPFS Settings</h4>

          <div class="radio-group">
            <label class="radio-option">
              <input
                v-model="ipfsOption"
                type="radio"
                value="helia-http" disabled
              />
              <span class="radio-label">Helia IPFS Fetch (EXPERIMENTAL)</span>
            </label>
            <div class="radio-suboptions">
              <label class="radio-option indent">
                <input
                  v-model="heliaMode"
                  type="radio"
                  value="http"
                  :disabled="ipfsOption !== 'helia-http' && ipfsOption !== 'helia-rpc'"
                />
                <span class="radio-label">HTTP-only Verified Fetch using web-based gateways</span>
              </label>
              <label class="radio-option indent">
                <input
                  v-model="heliaMode"
                  type="radio"
                  value="rpc"
                  :disabled="ipfsOption !== 'helia-http' && ipfsOption !== 'helia-rpc'"
                />
                <span class="radio-label">RPC – Launch a local Helia node with direct peer-to-peer retrieval</span>
              </label>
            </div>

            <label class="radio-option">
              <input v-model="ipfsOption" type="radio" value="basic" />
              <span class="radio-label">Basic IPFS Fetch using HTTP Only (default, Recommended for now)</span>
            </label>

            <label class="radio-option">
              <input v-model="ipfsOption" type="radio" value="manual" disabled />
              <span class="radio-label">(Not yet available) I will manually launch a local IPFS server (e.g. IPFS Desktop or Kubo) before using this program</span>
            </label>
          </div>
        </div>

        <div class="settings-section">
          <label class="checkbox-option">
            <input v-model="p2pOptIn" type="checkbox" />
            <span class="checkbox-label">
              Enable Faster Romhack loading/download, Game Reviews/Rating sharing, and Chat features.
              This option is required for Online communication features.
              This option enables Peer-to-Peer based networking.
              Peer-to-Peer based file transfer Opt-In.
              This option enables a server on your computer that can accept connections from other peers over the internet, such as IPFS.
              Future versions that add these features may require you to manually create port forwarding arrangements/access rules on your router or firewall.
            </span>
          </label>
          <div class="setting-caption">
            Note: This functionality has not been built yet and does not exist in the current version.
            This opt-in is for future versions.
          </div>
        </div>
      </section>
      <footer class="modal-footer">
        <button @click="handleSave" class="btn-primary" :disabled="saving">
          {{ isBlocking ? 'Save and Continue' : 'Save' }}
        </button>
        <button v-if="!isBlocking" @click="handleClose" class="btn-secondary">Cancel</button>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';

const props = defineProps<{
  visible: boolean;
  isBlocking?: boolean;
  /** When true, we are in the standalone fetch-settings window (not Settings overlay) */
  standalone?: boolean;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'saved'): void;
}>();

const ipfsOption = ref<'helia-http' | 'helia-rpc' | 'basic' | 'manual'>('basic');
const heliaMode = ref<'http' | 'rpc'>('http');
const p2pOptIn = ref(false);
const saving = ref(false);

watch(ipfsOption, (val) => {
  if (val === 'helia-http' || val === 'helia-rpc') {
    heliaMode.value = val === 'helia-http' ? 'http' : 'rpc';
  }
});

watch(heliaMode, (val) => {
  if (val === 'http') {
    ipfsOption.value = 'helia-http';
  } else if (val === 'rpc') {
    ipfsOption.value = 'helia-rpc';
  }
});

function buildConfig() {
  let fetch_mode: 'helia' | 'basic' | 'manual' = 'helia';
  let helia_mode: 'http' | 'rpc' = 'http';

  if (ipfsOption.value === 'basic') {
    fetch_mode = 'basic';
  } else if (ipfsOption.value === 'manual') {
    fetch_mode = 'manual';
  } else {
    fetch_mode = 'helia';
    helia_mode = ipfsOption.value === 'helia-rpc' ? 'rpc' : 'http';
  }

  return {
    ipfs: {
      fetch_mode,
      helia_mode,
      parallel: 5,
      gateway_selection: 'standard' as const,
      gateway_list: [] as string[],
    },
    p2p_opt_in: p2pOptIn.value,
  };
}

async function handleSave() {
  if (saving.value) return;
  saving.value = true;
  try {
    const config = buildConfig();
    const api = (window as any).electronAPI;
    if (api?.fetchSettingsSave) {
      const result = await api.fetchSettingsSave(config);
      if (result?.success) {
        if (props.standalone) {
          // Window will close via main process
        } else {
          emit('saved');
          emit('close');
        }
      }
    }
  } finally {
    saving.value = false;
  }
}

function handleClose() {
  if (!props.isBlocking) {
    emit('close');
  }
}

function handleBackdropClick() {
  if (!props.isBlocking) {
    emit('close');
  }
}

async function loadConfig() {
  const api = (window as any).electronAPI;
  if (!api?.fetchSettingsGetConfig) return;
  const config = await api.fetchSettingsGetConfig();
  if (config?.ipfs) {
    const fm = config.ipfs.fetch_mode;
    const hm = config.ipfs.helia_mode;
    if (fm === 'basic') {
      ipfsOption.value = 'basic';
    } else if (fm === 'manual') {
      ipfsOption.value = 'manual';
    } else if (fm === 'helia') {
      ipfsOption.value = hm === 'rpc' ? 'helia-rpc' : 'helia-http';
      heliaMode.value = hm || 'http';
    }
    if (typeof config.p2p_opt_in === 'boolean') {
      p2pOptIn.value = config.p2p_opt_in;
    }
  }
}

onMounted(() => {
  if (props.visible) {
    loadConfig();
  }
});

watch(() => props.visible, (v) => {
  if (v) {
    loadConfig();
  }
});
</script>

<style scoped>
.fetch-settings-dialog {
  max-width: 580px;
  width: 90%;
}

.modal-body {
  padding: 20px;
}

.dialog-description {
  margin-bottom: 16px;
  color: var(--color-text-secondary, #666);
}

.settings-section {
  margin-bottom: 20px;
}

.settings-section h4 {
  margin: 0 0 12px 0;
  font-size: 1rem;
}

.radio-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.radio-option {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  cursor: pointer;
}

.radio-option.indent {
  margin-left: 24px;
}

.radio-option input[type='radio'] {
  margin-top: 3px;
  flex-shrink: 0;
}

.radio-option input[type='radio']:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.radio-option:has(input:disabled) {
  cursor: default;
  opacity: 0.7;
}

.radio-label {
  flex: 1;
}

.radio-suboptions {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.checkbox-option {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  cursor: pointer;
}

.checkbox-option input[type='checkbox'] {
  margin-top: 3px;
  flex-shrink: 0;
}

.checkbox-label {
  flex: 1;
}

.setting-caption {
  margin-top: 8px;
  font-size: 0.85rem;
  color: var(--color-text-secondary, #666);
}

.modal-footer {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
  padding: 16px 20px;
  border-top: 1px solid var(--color-border, #ddd);
}

.btn-primary,
.btn-secondary {
  padding: 8px 16px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.95rem;
}

.btn-primary {
  background: var(--color-primary, #2563eb);
  color: var(--color-on-primary, #fff);
  border: none;
}

.btn-primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-secondary {
  background: var(--color-surface-variant, #e5e7eb);
  color: var(--color-text, #333);
  border: 1px solid var(--color-border, #ccc);
}
</style>
