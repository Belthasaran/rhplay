<template>
  <div v-if="isOpen" class="modal-backdrop" @click.self="close">
    <div class="modal large-modal advanced-patch-modal">
      <header class="modal-header">
        <h3>Advanced Patch and Start</h3>
        <button class="close" @click="close">✕</button>
      </header>

      <section class="modal-body">
        <div v-if="loading" class="loading-message">Loading available patches...</div>
        
        <template v-else>
          <!-- Game Info -->
          <div class="patch-section">
            <h4>Game: {{ gameName }}</h4>
            <div class="game-info">
              <div><strong>Game ID:</strong> {{ gameId }}</div>
              <div><strong>Version:</strong> {{ gameVersion }}</div>
            </div>
          </div>

          <!-- Global Parameters Section -->
          <div class="patch-section compact-section">
            <h4>Global Input Parameters</h4>
            <div class="parameter-group compact-group">
              <label class="inline-label">Level Number:</label>
              <input 
                v-model="globalParams.glevelnum" 
                type="text" 
                class="input hex-input" 
                placeholder="00"
                maxlength="2"
                pattern="[0-9A-Fa-f]{0,2}"
              />
              
              <label class="inline-label">On/Off Switches:</label>
              <div class="checkbox-group compact-checkbox-group">
                <label v-for="i in 8" :key="i" class="checkbox-label compact-checkbox-label">
                  <input 
                    type="checkbox" 
                    v-model="globalParams.gonoffv" 
                    :value="i-1"
                  />
                  <span class="bit-number">{{ i }}</span>
                </label>
              </div>
            </div>
          </div>

          <!-- Available Patches Section -->
          <div class="patch-section">
            <h4>Available Custom Patches</h4>
            <div v-if="availablePatches.length === 0" class="empty-message">
              No patches available for this game.
            </div>
            <div v-else class="patches-list">
              <div 
                v-for="patch in availablePatches" 
                :key="patch.epuuid"
                class="patch-item"
                :class="{ 'has-params': patch.requires_parameters }"
              >
                <div class="patch-header">
                  <label class="patch-checkbox">
                    <input 
                      type="checkbox" 
                      v-model="selectedPatches" 
                      :value="patch.epuuid"
                      @change="onPatchSelectionChange(patch)"
                    />
                    <span class="patch-name">{{ patch.name }}</span>
                  </label>
                  <span class="patch-code">{{ patch.patch_code }}</span>
                </div>
                
                <div v-if="patch.description" class="patch-description">
                  {{ patch.description }}
                </div>

                <!-- Local Parameters for this patch -->
                <div v-if="selectedPatches.includes(patch.epuuid) && patch.requires_parameters" class="patch-params">
                  <div class="param-mappings">
                    <div 
                      v-for="(mapping, paramName) in getParameterMappings(patch)" 
                      :key="paramName"
                      class="param-field"
                    >
                      <label>{{ mapping.description || paramName }}:</label>
                      <input 
                        v-if="paramName.startsWith('local1') || paramName.startsWith('local2') || paramName.startsWith('local3') || paramName.startsWith('local4')"
                        type="text" 
                        class="input hex-input" 
                        v-model="localParams[patch.epuuid][paramName]"
                        @input="localParams[patch.epuuid][paramName] = $event.target.value.toUpperCase().replace(/[^0-9A-F]/g, '').slice(0, 2)"
                        placeholder="00"
                        maxlength="2"
                      />
                      <input 
                        v-else-if="paramName.startsWith('local11') || paramName.startsWith('local12')"
                        type="text" 
                        class="input hex-input" 
                        v-model="localParams[patch.epuuid][paramName]"
                        @input="localParams[patch.epuuid][paramName] = $event.target.value.toUpperCase().replace(/[^0-9A-F]/g, '').slice(0, 4)"
                        placeholder="0000"
                        maxlength="4"
                      />
                      <div 
                        v-else-if="paramName.startsWith('local5') || paramName.startsWith('local6') || paramName.startsWith('local7') || paramName.startsWith('local8') || paramName.startsWith('local9') || paramName.startsWith('local10')"
                        class="checkbox-group compact-checkbox-group"
                      >
                        <label v-for="bit in 8" :key="bit" class="checkbox-label compact-checkbox-label">
                          <input 
                            type="checkbox" 
                            :checked="Array.isArray(localParams[patch.epuuid][paramName]) && localParams[patch.epuuid][paramName].includes(bit-1)"
                            @change="handleBitChange(patch.epuuid, paramName, bit-1, $event.target.checked)"
                          />
                          <span class="bit-number">{{ bit }}</span>
                        </label>
                      </div>
                      <input 
                        v-else
                        type="text" 
                        class="input" 
                        v-model="localParams[patch.epuuid][paramName]"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </template>
      </section>

      <footer class="modal-footer">
        <div class="modal-actions">
          <button 
            @click="buildPlus" 
            class="btn-primary"
            :disabled="loading || selectedPatches.length === 0"
          >
            Build Plus
          </button>
          <button 
            @click="buildPlusAndUpload" 
            class="btn-primary"
            :disabled="loading || selectedPatches.length === 0 || !usb2snesEnabled"
          >
            Build Plus and Upload USB2SNES
          </button>
          <button 
            @click="buildPlusAndBoot" 
            class="btn-primary"
            :disabled="loading || selectedPatches.length === 0 || !usb2snesEnabled || !usb2snesConnected"
          >
            Build Plus and Boot on USB2SNES
          </button>
          <button @click="close" class="btn-secondary">Cancel</button>
        </div>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';

interface ParameterMapping {
  output: string;
  description?: string;
}

interface ExtraPatch {
  epuuid: string;
  patch_code: string;
  name: string;
  description?: string;
  patch_type: 'ips' | 'bps' | 'asar' | 'uberasmtree';
  parameter_mappings?: string; // JSON string
  requires_parameters: number;
}

interface Props {
  isOpen: boolean;
  gameId: string;
  gameVersion: number;
  gameName: string;
  usb2snesEnabled?: boolean;
  usb2snesConnected?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  usb2snesEnabled: false,
  usb2snesConnected: false,
});

const emit = defineEmits<{
  close: [];
  build: [options: {
    gameId: string;
    gameVersion: number;
    selectedPatches: string[];
    globalParams: Record<string, any>;
    localParams: Record<string, Record<string, any>>;
    action: 'build' | 'upload' | 'boot';
  }];
}>();

const loading = ref(false);
const availablePatches = ref<ExtraPatch[]>([]);
const selectedPatches = ref<string[]>([]);
const globalParams = ref({
  glevelnum: '',
  gonoffv: [] as number[],
});
const localParams = ref<Record<string, Record<string, any>>>({});

// Load available patches when modal opens
watch(() => props.isOpen, async (newVal) => {
  if (newVal) {
    await loadAvailablePatches();
  } else {
    // Reset state when closing
    selectedPatches.value = [];
    globalParams.value = { glevelnum: '', gonoffv: [] };
    localParams.value = {};
  }
});

async function loadAvailablePatches() {
  loading.value = true;
  try {
    const api = (window as any)?.electronAPI;
    if (!api?.getAvailableExtraPatches) {
      console.error('getAvailableExtraPatches IPC not available');
      availablePatches.value = [];
      return;
    }
    
    const result = await api.getAvailableExtraPatches({
      gameId: props.gameId,
      gameVersion: props.gameVersion,
    });
    
    if (result?.success) {
      availablePatches.value = result.patches || [];
    } else {
      console.error('Failed to load patches:', result?.error);
      availablePatches.value = [];
    }
  } catch (error) {
    console.error('Error loading patches:', error);
    availablePatches.value = [];
  } finally {
    loading.value = false;
  }
}

function getParameterMappings(patch: ExtraPatch): Record<string, ParameterMapping> {
  if (!patch.parameter_mappings) return {};
  try {
    return JSON.parse(patch.parameter_mappings);
  } catch {
    return {};
  }
}

function handleBitChange(patchUuid: string, paramName: string, bit: number, checked: boolean) {
  if (!localParams.value[patchUuid]) {
    localParams.value[patchUuid] = {};
  }
  if (!Array.isArray(localParams.value[patchUuid][paramName])) {
    localParams.value[patchUuid][paramName] = [];
  }
  const current = [...localParams.value[patchUuid][paramName]];
  if (checked) {
    if (!current.includes(bit)) current.push(bit);
  } else {
    const index = current.indexOf(bit);
    if (index >= 0) current.splice(index, 1);
  }
  localParams.value[patchUuid][paramName] = current;
}

function onPatchSelectionChange(patch: ExtraPatch) {
  const isSelected = selectedPatches.value.includes(patch.epuuid);
  if (isSelected && patch.requires_parameters) {
    // Initialize local params for this patch
    if (!localParams.value[patch.epuuid]) {
      localParams.value[patch.epuuid] = {};
      const mappings = getParameterMappings(patch);
      for (const paramName of Object.keys(mappings)) {
        if (paramName.startsWith('local5') || paramName.startsWith('local6') || 
            paramName.startsWith('local7') || paramName.startsWith('local8') ||
            paramName.startsWith('local9') || paramName.startsWith('local10')) {
          localParams.value[patch.epuuid][paramName] = [];
        } else {
          localParams.value[patch.epuuid][paramName] = '';
        }
      }
    }
  } else if (!isSelected) {
    // Clean up local params when deselected
    delete localParams.value[patch.epuuid];
  }
}

function close() {
  emit('close');
}

function buildPlus() {
  emit('build', {
    gameId: props.gameId,
    gameVersion: props.gameVersion,
    selectedPatches: selectedPatches.value,
    globalParams: globalParams.value,
    localParams: localParams.value,
    action: 'build',
  });
}

function buildPlusAndUpload() {
  emit('build', {
    gameId: props.gameId,
    gameVersion: props.gameVersion,
    selectedPatches: selectedPatches.value,
    globalParams: globalParams.value,
    localParams: localParams.value,
    action: 'upload',
  });
}

function buildPlusAndBoot() {
  emit('build', {
    gameId: props.gameId,
    gameVersion: props.gameVersion,
    selectedPatches: selectedPatches.value,
    globalParams: globalParams.value,
    localParams: localParams.value,
    action: 'boot',
  });
}
</script>


<style scoped>
.advanced-patch-modal {
  max-width: 900px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
}

.modal-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

.patch-section {
  margin-bottom: 16px;
}

.patch-section.compact-section {
  margin-bottom: 12px;
}

.patch-section h4 {
  margin: 0 0 8px 0;
  font-size: 15px;
  font-weight: 600;
}

.game-info {
  padding: 6px 8px;
  background: #f5f5f5;
  border-radius: 4px;
  font-size: 12px;
}

.parameter-group {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.parameter-group.compact-group {
  display: flex;
  flex-direction: row;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}

.inline-label {
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
  margin: 0;
}

.parameter-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.parameter-field.compact-field {
  gap: 4px;
}

.parameter-field label {
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
}

.hex-input {
  width: 60px;
  font-family: monospace;
  font-size: 12px;
  padding: 4px 6px;
}

.checkbox-group {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.checkbox-group.compact-checkbox-group {
  display: inline-flex;
  flex-direction: row;
  flex-wrap: nowrap;
  gap: 2px;
  align-items: center;
  margin: 0;
  padding: 0;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  cursor: pointer;
}

.checkbox-label.compact-checkbox-label {
  display: inline-flex;
  gap: 2px;
  margin: 0;
  padding: 2px 4px;
  border: 1px solid #ddd;
  border-radius: 3px;
  background: #fafafa;
  font-size: 11px;
  min-width: 24px;
  width: auto;
  justify-content: center;
  flex-shrink: 0;
}

.checkbox-label.compact-checkbox-label:hover {
  background: #f0f0f0;
  border-color: #bbb;
}

.checkbox-label.compact-checkbox-label input[type="checkbox"] {
  margin: 0;
  cursor: pointer;
}

.checkbox-label.compact-checkbox-label input[type="checkbox"]:checked + .bit-number {
  font-weight: 600;
  color: #1976d2;
}

.bit-number {
  font-family: monospace;
  font-size: 11px;
  min-width: 14px;
  text-align: center;
}

.patches-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.patch-item {
  border: 1px solid #ddd;
  border-radius: 4px;
  padding: 8px 10px;
  background: #fff;
}

.patch-item.has-params {
  border-color: #1976d2;
}

.patch-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}

.patch-checkbox {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  flex: 1;
}

.patch-name {
  font-weight: 500;
  font-size: 14px;
}

.patch-code {
  font-family: monospace;
  font-size: 12px;
  color: #666;
  background: #f5f5f5;
  padding: 2px 6px;
  border-radius: 3px;
}

.patch-description {
  font-size: 11px;
  color: #666;
  margin-bottom: 4px;
  line-height: 1.3;
}

.patch-params {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid #eee;
}

.param-mappings {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.param-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.param-field label {
  font-size: 11px;
  font-weight: 500;
}

.loading-message {
  text-align: center;
  padding: 40px;
  color: #666;
}

.empty-message {
  text-align: center;
  padding: 20px;
  color: #666;
  font-style: italic;
}

.modal-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.btn-primary {
  padding: 8px 16px;
  background: #1976d2;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
}

.btn-primary:disabled {
  background: #ccc;
  cursor: not-allowed;
}

.btn-secondary {
  padding: 8px 16px;
  background: #f5f5f5;
  color: #333;
  border: 1px solid #ddd;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
}
</style>

