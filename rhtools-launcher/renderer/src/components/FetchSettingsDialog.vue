<template>
  <div v-if="visible" class="modal-backdrop" @click.self="handleBackdropClick">
    <div class="modal fetch-settings-dialog">
      <header class="modal-header">
        <h3>File Transfer and Peer-to-Peer Settings</h3>
        <button v-if="!isBlocking" class="close" type="button" @click="handleClose">✕</button>
      </header>
      <section class="modal-body">
        <p class="dialog-description">
          File download method settings for Software Updates & SMW Romhack Resource Files (shared with RHTools / RHPlay).
        </p>

        <div class="settings-section">
          <h4>IPFS Settings</h4>

          <div class="radio-group">
            <label class="radio-option">
              <input v-model="ipfsOption" type="radio" value="helia-http" disabled />
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
          <h4>Arweave / ArDrive fetch</h4>
          <div class="radio-group">
            <label class="radio-option">
              <input v-model="arweaveOption" type="radio" value="legacy" />
              <span class="radio-label">Legacy ArDrive fetch (fixed gateway)</span>
            </label>
            <div class="radio-suboptions">
              <label class="radio-option indent">
                <select v-model="arweaveLegacyGateway" :disabled="arweaveOption !== 'legacy'" class="gateway-select">
                  <option value="https://arweave.net:443">https://arweave.net:443</option>
                  <option value="https://ardrive.net:443">https://ardrive.net:443</option>
                </select>
              </label>
            </div>
            <label class="radio-option">
              <input v-model="arweaveOption" type="radio" value="wayfinder" />
              <span class="radio-label">Fetch using Wayfinder client (dynamic gateways, recommended)</span>
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
        <button type="button" class="btn-primary" :disabled="saving" @click="handleSave">
          {{ isBlocking ? 'Save and Continue' : 'Save' }}
        </button>
        <button v-if="!isBlocking" type="button" class="btn-secondary" @click="handleClose">Cancel</button>
      </footer>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, onMounted } from 'vue';

const props = defineProps({
  visible: { type: Boolean, required: true },
  isBlocking: { type: Boolean, default: false },
  standalone: { type: Boolean, default: false }
});

const emit = defineEmits(['close', 'saved']);

function getFetchApi() {
  const w = typeof window !== 'undefined' ? window : {};
  if (w.launcherAPI?.fetchSettingsGetConfig) return w.launcherAPI;
  if (w.electronAPI?.fetchSettingsGetConfig) return w.electronAPI;
  return null;
}

const ipfsOption = ref('basic');
const heliaMode = ref('http');
const arweaveOption = ref('legacy');
const arweaveLegacyGateway = ref('https://arweave.net:443');
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
  let fetch_mode = 'helia';
  let helia_mode = 'http';

  if (ipfsOption.value === 'basic') {
    fetch_mode = 'basic';
  } else if (ipfsOption.value === 'manual') {
    fetch_mode = 'manual';
  } else {
    fetch_mode = 'helia';
    helia_mode = ipfsOption.value === 'helia-rpc' ? 'rpc' : 'http';
  }

  const arweaveFetchMode = arweaveOption.value === 'wayfinder' ? 'wayfinder' : 'legacy';
  const arweaveLegacy = arweaveLegacyGateway.value || 'https://arweave.net:443';

  return {
    ipfs: {
      fetch_mode,
      helia_mode,
      parallel: 5,
      gateway_selection: 'standard',
      gateway_list: []
    },
    arweave: {
      fetch_mode: arweaveFetchMode,
      legacy_gateway: arweaveLegacy
    },
    p2p_opt_in: p2pOptIn.value
  };
}

async function handleSave() {
  if (saving.value) return;
  const api = getFetchApi();
  if (!api?.fetchSettingsSave) {
    window.alert('Fetch settings API is not available.');
    return;
  }
  saving.value = true;
  try {
    const config = buildConfig();
    const result = await api.fetchSettingsSave(config);
    if (result?.success) {
      if (!props.standalone) {
        emit('saved');
        emit('close');
      }
    } else if (result?.error) {
      window.alert(`Failed to save: ${result.error}`);
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
  const api = getFetchApi();
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
  if (config?.arweave && typeof config.arweave === 'object') {
    const am = config.arweave.fetch_mode;
    if (am === 'wayfinder') {
      arweaveOption.value = 'wayfinder';
    } else {
      arweaveOption.value = 'legacy';
    }
    if (config.arweave.legacy_gateway) {
      arweaveLegacyGateway.value = config.arweave.legacy_gateway;
    }
  }
}

onMounted(() => {
  if (props.visible) {
    loadConfig();
  }
});

watch(
  () => props.visible,
  (v) => {
    if (v) {
      loadConfig();
    }
  }
);
</script>

<style scoped>
.fetch-settings-dialog {
  max-width: 580px;
  width: 90%;
  background: #252830;
  border: 1px solid #444;
  border-radius: 8px;
  color: #eee;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid #3a4150;
}

.modal-header h3 {
  margin: 0;
  font-size: 1.05rem;
}

.modal-header .close {
  background: transparent;
  border: none;
  color: #9aa;
  cursor: pointer;
  font-size: 1.2rem;
  line-height: 1;
  padding: 4px 8px;
}

.modal-body {
  padding: 20px;
}

.dialog-description {
  margin-bottom: 16px;
  color: #9aa;
  font-size: 0.9rem;
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

.gateway-select {
  margin-left: 24px;
  padding: 4px 8px;
  font-size: 0.9rem;
  min-width: 220px;
  background: #1a1d24;
  color: #eee;
  border: 1px solid #444;
  border-radius: 4px;
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
  font-size: 0.88rem;
}

.setting-caption {
  margin-top: 8px;
  font-size: 0.85rem;
  color: #8a9;
}

.modal-footer {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
  padding: 16px 20px;
  border-top: 1px solid #3a4150;
}

.btn-primary,
.btn-secondary {
  padding: 8px 16px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.95rem;
}

.btn-primary {
  background: #2d6a4f;
  color: #fff;
  border: 1px solid #40916c;
}

.btn-primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-secondary {
  background: #333;
  color: #eee;
  border: 1px solid #444;
}
</style>
