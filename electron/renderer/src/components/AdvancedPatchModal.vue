<template>
  <div v-if="isOpen" class="modal-backdrop" @click.self="close">
    <div class="modal large-modal advanced-patch-modal">
      <header class="modal-header">
        <h3>Advanced Patch and Start</h3>
        <button class="close" @click="close">✕</button>
      </header>

      <!-- Tab Navigation -->
      <div class="tab-navigation">
        <button 
          :class="['tab-button', { active: activeTab === 'apply' }]"
          @click="activeTab = 'apply'"
        >
          Apply Extra Patches
        </button>
        <button 
          :class="['tab-button', { active: activeTab === 'edit' }]"
          @click="activeTab = 'edit'"
        >
          Edit System Patch Definitions
        </button>
      </div>

      <section class="modal-body">
        <!-- Apply Extra Patches Tab -->
        <div v-if="activeTab === 'apply'">
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
                maxlength="3"
                pattern="[0-9A-Fa-f]{0,3}"
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
            <div class="section-header-with-button">
              <h4>Available Custom Patches</h4>
              <button @click="presetsDropdownOpen = !presetsDropdownOpen" class="btn-secondary btn-small">Presets</button>
              <div v-if="presetsDropdownOpen" class="presets-dropdown">
                <div class="presets-dropdown-header">
                  <strong>Presets</strong>
                  <button @click="presetsDropdownOpen = false" class="close-small">✕</button>
                </div>
                <div class="presets-list">
                  <div v-if="loadingPresets" class="loading-message">Loading presets...</div>
                  <div v-else>
                    <div v-if="systemPresets.length > 0" class="presets-group">
                      <div class="presets-group-label">System Presets</div>
                      <div 
                        v-for="preset in systemPresets" 
                        :key="preset.preset_uuid"
                        class="preset-item"
                        @click="loadPreset(preset)"
                      >
                        <span class="preset-name">{{ preset.preset_name }}</span>
                        <span class="preset-badge system">System</span>
                      </div>
                    </div>
                    <div v-if="userPresets.length > 0" class="presets-group">
                      <div class="presets-group-label">User Presets</div>
                      <div 
                        v-for="preset in userPresets" 
                        :key="preset.preset_uuid"
                        class="preset-item"
                      >
                        <span class="preset-name" @click="loadPreset(preset)">{{ preset.preset_name }}</span>
                        <div class="preset-actions">
                          <button @click.stop="deletePreset(preset)" class="btn-link-small btn-danger">Delete</button>
                        </div>
                      </div>
                    </div>
                    <div v-if="systemPresets.length === 0 && userPresets.length === 0" class="empty-message">
                      No presets available
                    </div>
                  </div>
                </div>
                <div class="presets-dropdown-footer">
                  <button @click="showSavePresetDialog = true" class="btn-primary btn-small">Save Current as Preset</button>
                </div>
              </div>
              <!-- Save Preset Dialog -->
              <div v-if="showSavePresetDialog" class="preset-save-dialog">
                <div class="preset-save-backdrop" @click="showSavePresetDialog = false"></div>
                <div class="preset-save-content">
                  <div class="preset-save-header">
                    <h4>Save Preset</h4>
                    <button @click="showSavePresetDialog = false" class="close-small">✕</button>
                  </div>
                  <div class="preset-save-body">
                    <div class="form-field">
                      <label>Preset Name *</label>
                      <input 
                        v-model="newPresetName" 
                        type="text" 
                        class="input" 
                        placeholder="My Preset"
                        @keydown.enter="savePreset"
                        @keydown.esc="showSavePresetDialog = false"
                      />
                    </div>
                  </div>
                  <div class="preset-save-footer">
                    <button @click="showSavePresetDialog = false" class="btn-secondary btn-small">Cancel</button>
                    <button @click="savePreset" class="btn-primary btn-small" :disabled="!newPresetName.trim()">Save</button>
                  </div>
                </div>
              </div>
            </div>
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
                      v-for="(mapping, placeholder) in getParameterMappings(patch)" 
                      :key="placeholder"
                      class="param-field"
                      v-if="mapping && mapping.input && mapping.input !== 'rom_file'"
                    >
                      <label>{{ mapping.description || mapping.input || placeholder }}:</label>
                      <input 
                        v-if="mapping.input.startsWith('local1') || mapping.input.startsWith('local2') || mapping.input.startsWith('local3') || mapping.input.startsWith('local4')"
                        type="text" 
                        class="input hex-input" 
                        v-model="localParams[patch.epuuid][mapping.input]"
                        @input="localParams[patch.epuuid][mapping.input] = $event.target.value.toUpperCase().replace(/[^0-9A-F]/g, '').slice(0, 2)"
                        placeholder="00"
                        maxlength="2"
                      />
                      <input 
                        v-else-if="mapping.input === 'local11' || mapping.input === 'local12'"
                        type="text" 
                        class="input hex-input" 
                        v-model="localParams[patch.epuuid][mapping.input]"
                        @input="localParams[patch.epuuid][mapping.input] = $event.target.value.toUpperCase().replace(/[^0-9A-F]/g, '').slice(0, 4)"
                        placeholder="0000"
                        maxlength="4"
                      />
                      <div 
                        v-else-if="mapping.input.startsWith('local5') || mapping.input.startsWith('local6') || mapping.input.startsWith('local7') || mapping.input.startsWith('local8') || mapping.input === 'local9' || mapping.input === 'local10'"
                        class="checkbox-group compact-checkbox-group"
                      >
                        <label v-for="bit in 8" :key="bit" class="checkbox-label compact-checkbox-label">
                          <input 
                            type="checkbox" 
                            :checked="Array.isArray(localParams[patch.epuuid][mapping.input]) && localParams[patch.epuuid][mapping.input].includes(bit-1)"
                            @change="handleBitChange(patch.epuuid, mapping.input, bit-1, $event.target.checked)"
                          />
                          <span class="bit-number">{{ bit }}</span>
                        </label>
                      </div>
                      <input 
                        v-else
                        type="text" 
                        class="input" 
                        v-model="localParams[patch.epuuid][mapping.input]"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </template>
        </div>

        <!-- Edit System Patch Definitions Tab -->
        <div v-if="activeTab === 'edit'" class="patch-editor-tab">
          <div class="editor-header">
            <button @click="showAddPatchForm = true" class="btn-primary btn-small">+ Add New Patch</button>
            <button @click="loadAllPatches" class="btn-secondary btn-small" :disabled="loadingPatches">Refresh</button>
          </div>

          <div v-if="loadingPatches" class="loading-message">Loading patches...</div>
          
          <div v-else class="patches-editor-list">
            <div 
              v-for="patch in allPatches" 
              :key="patch.epuuid"
              class="patch-editor-item"
            >
              <div class="patch-editor-header">
                <div class="patch-editor-info">
                  <span class="patch-editor-name">{{ patch.name }}</span>
                  <span class="patch-editor-code">{{ patch.patch_code }}</span>
                  <span class="patch-editor-type">{{ patch.patch_type.toUpperCase() }}</span>
                </div>
                <div class="patch-editor-actions">
                  <span v-if="patch.is_system" class="system-badge">System</span>
                  <button @click="editPatch(patch)" class="btn-link-small" :disabled="patch.is_system && !isDevAdmin.value">Edit</button>
                  <button @click="deletePatch(patch)" class="btn-link-small btn-danger" :disabled="patch.is_system && !isDevAdmin.value">Delete</button>
                </div>
              </div>
              <div v-if="patch.description" class="patch-editor-description">{{ patch.description }}</div>
            </div>
            
            <div v-if="allPatches.length === 0" class="empty-message">
              No patches defined. Click "Add New Patch" to create one.
            </div>
          </div>

          <!-- Add/Edit Patch Form Modal -->
          <div v-if="showAddPatchForm || editingPatch" class="patch-form-modal">
            <div class="patch-form-backdrop" @click="closePatchForm"></div>
            <div class="patch-form-content">
              <div class="patch-form-header">
                <h4>{{ editingPatch ? 'Edit Patch' : 'Add New Patch' }}</h4>
                <button @click="closePatchForm" class="close-small">✕</button>
              </div>
              
              <div class="patch-form-body">
                <div class="form-field">
                  <label>Patch Code * <span class="hint">(short unique code like "cc" or "blu1")</span></label>
                  <input 
                    v-model="patchForm.patch_code" 
                    type="text" 
                    class="input" 
                    :disabled="!!editingPatch"
                    placeholder="cc"
                  />
                </div>

                <div class="form-field">
                  <label>Name *</label>
                  <input 
                    v-model="patchForm.name" 
                    type="text" 
                    class="input" 
                    placeholder="Infinite Lives"
                  />
                </div>

                <div class="form-field">
                  <label>Description</label>
                  <textarea 
                    v-model="patchForm.description" 
                    class="textarea" 
                    rows="2"
                    placeholder="Optional description"
                  ></textarea>
                </div>

                <div class="form-field">
                  <label>Patch Type *</label>
                  <select v-model="patchForm.patch_type" class="input">
                    <option value="ips">IPS</option>
                    <option value="bps">BPS</option>
                    <option value="asar">ASAR</option>
                    <option value="uberasmtree">UberASMTree</option>
                  </select>
                </div>

                <div class="form-field">
                  <label>Priority</label>
                  <input 
                    v-model.number="patchForm.priority" 
                    type="number" 
                    class="input" 
                    placeholder="100"
                  />
                  <span class="hint">Lower numbers are applied first</span>
                </div>

                <!-- File-based patches (IPS, BPS, UberASMTree) -->
                <div v-if="patchForm.patch_type === 'ips' || patchForm.patch_type === 'bps' || patchForm.patch_type === 'uberasmtree'" class="form-field">
                  <label>Patch File <span v-if="editingPatch" class="hint">(leave empty to keep existing file)</span></label>
                  <div class="file-upload-area">
                    <input 
                      type="file" 
                      ref="fileInputRef"
                      @change="handleFileSelect"
                      :accept="patchForm.patch_type === 'uberasmtree' ? '.7z' : `.${patchForm.patch_type}`"
                      style="display: none"
                    />
                    <button @click="fileInputRef?.click()" class="btn-secondary btn-small">Choose File</button>
                    <span v-if="patchForm.fileName" class="file-name">{{ patchForm.fileName }}</span>
                    <span v-else-if="editingPatch" class="hint">Existing file will be kept</span>
                    <span v-else class="hint">No file selected (required for new patches)</span>
                  </div>
                </div>

                <!-- ASAR template text -->
                <div v-if="patchForm.patch_type === 'asar'" class="form-field">
                  <label>ASAR Template Text</label>
                  <textarea 
                    v-model="patchForm.template_text" 
                    class="textarea code-textarea" 
                    rows="10"
                    placeholder="ASAR assembly code with template variables like ${level_number}"
                  ></textarea>
                </div>

                <div class="form-field">
                  <label>
                    <input type="checkbox" v-model="patchForm.requires_parameters" />
                    Requires Parameters
                  </label>
                </div>

                <div v-if="isDevAdmin.value" class="form-field">
                  <label>
                    <input type="checkbox" v-model="patchForm.is_system" />
                    System Patch (read-only for users)
                  </label>
                  <span class="hint">System patches can only be edited/deleted when DEVADMIN=1</span>
                </div>

                <div v-if="patchForm.requires_parameters" class="form-field">
                  <label>Parameter Mappings (JSON)</label>
                  <div class="parameter-mappings-editor">
                    <div class="quick-insert-buttons">
                      <button 
                        type="button" 
                        class="btn-link-small"
                        @click="insertParameterMapping('glevelnum')"
                        title="Insert glevelnum mapping"
                      >
                        + glevelnum
                      </button>
                      <button 
                        type="button" 
                        class="btn-link-small"
                        @click="insertParameterMapping('rom_file')"
                        title="Insert rom_file mapping"
                      >
                        + rom_file
                      </button>
                    </div>
                    <div class="textarea-wrapper">
                      <textarea 
                        v-model="patchForm.parameter_mappings_json" 
                        :class="['textarea', 'code-textarea', { 'invalid': !parameterMappingsValid, 'valid': parameterMappingsValid && patchForm.parameter_mappings_json }]"
                        rows="6"
                        placeholder='{"PLACEHOLDER": {"input": "inputvar", "expression": "inputvar", "description": "..."}}'
                        @input="validateParameterMappings"
                      ></textarea>
                      <div v-if="patchForm.parameter_mappings_json" class="validation-indicator">
                        <span v-if="parameterMappingsValid" class="valid-indicator">✓ Valid</span>
                        <span v-else class="invalid-indicator">✗ {{ parameterMappingsError }}</span>
                      </div>
                    </div>
                    <span class="hint">JSON object mapping placeholder names to input parameters. Format: {"PLACEHOLDER": {"input": "inputvar", "expression": "inputvar", "description": "..."}}</span>
                  </div>
                </div>

                <div class="form-field">
                  <label>Restrictions (JSON)</label>
                  <textarea 
                    v-model="patchForm.restrictions_json" 
                    class="textarea code-textarea" 
                    rows="4"
                    placeholder='{"allowed_games": ["gameid1"], "required_tags": ["tag1"], "excluded_tags": ["tag2"]}'
                  ></textarea>
                  <span class="hint">Optional: JSON object for game/tag filtering</span>
                </div>

                <div class="form-field">
                  <label>Conflicts (JSON Array)</label>
                  <textarea 
                    v-model="patchForm.conflicts_json" 
                    class="textarea code-textarea" 
                    rows="2"
                    placeholder='["conflict1", "conflict2"]'
                  ></textarea>
                  <span class="hint">Optional: Array of patch codes that conflict with this patch</span>
                </div>

                <div class="form-field">
                  <label>Dependencies (JSON Array)</label>
                  <textarea 
                    v-model="patchForm.dependencies_json" 
                    class="textarea code-textarea" 
                    rows="2"
                    placeholder='["dep1", "dep2"]'
                  ></textarea>
                  <span class="hint">Optional: Array of patch codes that must be applied before this one</span>
                </div>
              </div>

              <div class="patch-form-footer">
                <button @click="savePatch" class="btn-primary" :disabled="!canSavePatch">Save</button>
                <button @click="closePatchForm" class="btn-secondary">Cancel</button>
              </div>
            </div>
          </div>
        </div>
      </section>

      <footer v-if="activeTab === 'apply'" class="modal-footer">
        <div class="modal-actions">
          <button 
            @click="resetToDefaults" 
            class="btn-secondary"
          >
            Reset
          </button>
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
            :disabled="loading || selectedPatches.length === 0 || !usb2snesEnabled"
          >
            Build Plus and Boot on USB2SNES
          </button>
          <button @click="close" class="btn-secondary">Cancel</button>
        </div>
      </footer>
      <footer v-else class="modal-footer">
        <div class="modal-actions">
          <button @click="close" class="btn-secondary">Close</button>
        </div>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';

interface ParameterMapping {
  input: string; // Input parameter name (glevelnum, local1, rom_file, etc.)
  expression?: string; // Optional expression (defaults to input variable name)
  description?: string; // Optional description
}

interface ExtraPatch {
  epuuid: string;
  patch_code: string;
  name: string;
  description?: string;
  patch_type: 'ips' | 'bps' | 'asar' | 'uberasmtree';
  template_text?: string;
  parameter_mappings?: string; // JSON string
  restrictions?: string; // JSON string
  conflicts?: string; // JSON string
  dependencies?: string; // JSON string
  priority?: number;
  requires_parameters: number;
  is_system?: number; // 0 = user patch, 1 = system patch
}

interface Preset {
  preset_uuid: string;
  preset_name: string;
  is_system: number; // 0 = user preset, 1 = system preset
  selected_patches: string; // JSON array
  global_onoffv: string; // JSON array
  patch_variables: string; // JSON object
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

const activeTab = ref<'apply' | 'edit'>('apply');
const loading = ref(false);
const availablePatches = ref<ExtraPatch[]>([]);
const selectedPatches = ref<string[]>([]);
const globalParams = ref({
  glevelnum: '',
  gonoffv: [] as number[],
});
const localParams = ref<Record<string, Record<string, any>>>({});

// Presets state
const presetsDropdownOpen = ref(false);
const loadingPresets = ref(false);
const allPresets = ref<Preset[]>([]);
const showSavePresetDialog = ref(false);
const newPresetName = ref('');
const isDevAdmin = ref(false);

// Editor tab state
const loadingPatches = ref(false);
const allPatches = ref<ExtraPatch[]>([]);
const showAddPatchForm = ref(false);
const editingPatch = ref<ExtraPatch | null>(null);
const fileInputRef = ref<HTMLInputElement | null>(null);
const parameterMappingsValid = ref(true);
const parameterMappingsError = ref('');

// Known valid input parameter names
const VALID_INPUT_PARAMS = [
  'glevelnum', 'gonoffv',
  'local1', 'local2', 'local3', 'local4',
  'local5', 'local6', 'local7', 'local8',
  'local9', 'local10',
  'local11', 'local12',
  'rom_file' // Special parameter
];

const patchForm = ref({
  patch_code: '',
  name: '',
  description: '',
  patch_type: 'ips' as 'ips' | 'bps' | 'asar' | 'uberasmtree',
  priority: 100,
  requires_parameters: false,
  is_system: false,
  template_text: '',
  parameter_mappings_json: '',
  restrictions_json: '',
  conflicts_json: '',
  dependencies_json: '',
  fileData: null as ArrayBuffer | null,
  fileName: '',
});

// Computed properties for presets
const systemPresets = computed(() => allPresets.value.filter(p => p.is_system === 1));
const userPresets = computed(() => allPresets.value.filter(p => p.is_system === 0));

// Get localStorage key for this game
function getStorageKey() {
  return `extrapatch_state_${props.gameId}_v${props.gameVersion}`;
}

// Save state to localStorage
function saveState() {
  const state = {
    selectedPatches: selectedPatches.value,
    globalParams: {
      gonoffv: globalParams.value.gonoffv,
      // Note: glevelnum is NOT saved per user request
    },
    localParams: localParams.value,
  };
  localStorage.setItem(getStorageKey(), JSON.stringify(state));
}

// Load state from localStorage
function loadState() {
  try {
    const stored = localStorage.getItem(getStorageKey());
    if (stored) {
      const state = JSON.parse(stored);
      selectedPatches.value = state.selectedPatches || [];
      globalParams.value.gonoffv = state.globalParams?.gonoffv || [];
      localParams.value = state.localParams || {};
      // Note: glevelnum is NOT loaded (always starts empty)
    }
  } catch (e) {
    console.error('Error loading state:', e);
  }
}

// Reset to defaults
function resetToDefaults() {
  selectedPatches.value = [];
  globalParams.value = { glevelnum: '', gonoffv: [] };
  localParams.value = {};
  localStorage.removeItem(getStorageKey());
}

// Watch for changes and save state
watch([selectedPatches, () => globalParams.value.gonoffv, localParams], () => {
  if (props.isOpen && activeTab.value === 'apply') {
    saveState();
  }
}, { deep: true });

// Load available patches when modal opens
watch(() => props.isOpen, async (newVal) => {
  if (newVal) {
    // Check DEVADMIN status
    const api = (window as any)?.electronAPI;
    if (api?.isDevAdmin) {
      const result = await api.isDevAdmin();
      isDevAdmin.value = result?.isDevAdmin || false;
    }
    
    if (activeTab.value === 'apply') {
      await loadAvailablePatches();
      loadState(); // Load saved state
    } else {
      await loadAllPatches();
    }
    await loadPresets();
  } else {
    // Save state when closing
    if (activeTab.value === 'apply') {
      saveState();
    }
    // Reset UI state
    activeTab.value = 'apply';
    showAddPatchForm.value = false;
    editingPatch.value = null;
    presetsDropdownOpen.value = false;
    showSavePresetDialog.value = false;
  }
});

// Load patches when switching tabs
watch(activeTab, async (newTab) => {
  if (props.isOpen) {
    if (newTab === 'apply') {
      await loadAvailablePatches();
    } else {
      await loadAllPatches();
    }
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
    
    if (!props.gameId || !props.gameVersion) {
      console.warn('Cannot load patches: missing gameId or gameVersion', { gameId: props.gameId, gameVersion: props.gameVersion });
      availablePatches.value = [];
      return;
    }
    
    console.log(`[AdvancedPatchModal] Loading available patches for game ${props.gameId} v${props.gameVersion}`);
    
    const result = await api.getAvailableExtraPatches({
      gameId: props.gameId,
      gameVersion: props.gameVersion,
    });
    
    if (result?.success) {
      console.log(`[AdvancedPatchModal] Loaded ${result.patches?.length || 0} available patches`);
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
    const parsed = JSON.parse(patch.parameter_mappings);
    // Filter out any invalid entries (null, undefined, or missing 'input' field)
    const valid: Record<string, ParameterMapping> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (value && typeof value === 'object' && 'input' in value && value.input) {
        valid[key] = value as ParameterMapping;
      }
    }
    return valid;
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
      // New format: key is placeholder, value has "input" field
      for (const [placeholder, mapping] of Object.entries(mappings)) {
        const inputVar = mapping.input;
        if (!inputVar || inputVar === 'rom_file') continue; // Skip special params
        
        if (inputVar.startsWith('local5') || inputVar.startsWith('local6') || 
            inputVar.startsWith('local7') || inputVar.startsWith('local8') ||
            inputVar === 'local9' || inputVar === 'local10') {
          localParams.value[patch.epuuid][inputVar] = [];
        } else {
          localParams.value[patch.epuuid][inputVar] = '';
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

// Helper function to serialize reactive objects to plain objects for IPC
// Uses JSON parse/stringify to remove Vue reactivity proxies
function serializeForIPC(obj: any): any {
  try {
    return JSON.parse(JSON.stringify(obj));
  } catch (e) {
    // If JSON serialization fails, try manual conversion
    console.warn('JSON serialization failed, using manual conversion:', e);
    if (obj === null || obj === undefined) {
      return obj;
    }
    if (Array.isArray(obj)) {
      return obj.map(item => serializeForIPC(item));
    }
    if (typeof obj === 'object') {
      const result: any = {};
      for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
          result[key] = serializeForIPC(obj[key]);
        }
      }
      return result;
    }
    return obj;
  }
}

function buildPlus() {
  emit('build', {
    gameId: props.gameId,
    gameVersion: props.gameVersion,
    selectedPatches: serializeForIPC(selectedPatches.value),
    globalParams: serializeForIPC(globalParams.value),
    localParams: serializeForIPC(localParams.value),
    action: 'build',
  });
}

function buildPlusAndUpload() {
  emit('build', {
    gameId: props.gameId,
    gameVersion: props.gameVersion,
    selectedPatches: serializeForIPC(selectedPatches.value),
    globalParams: serializeForIPC(globalParams.value),
    localParams: serializeForIPC(localParams.value),
    action: 'upload',
  });
}

function buildPlusAndBoot() {
  emit('build', {
    gameId: props.gameId,
    gameVersion: props.gameVersion,
    selectedPatches: serializeForIPC(selectedPatches.value),
    globalParams: serializeForIPC(globalParams.value),
    localParams: serializeForIPC(localParams.value),
    action: 'boot',
  });
}

// Editor tab functions
async function loadAllPatches() {
  loadingPatches.value = true;
  try {
    const api = (window as any)?.electronAPI;
    if (!api?.getAllExtraPatches) {
      console.error('getAllExtraPatches IPC not available');
      allPatches.value = [];
      return;
    }
    
    const result = await api.getAllExtraPatches();
    
    if (result?.success) {
      allPatches.value = result.patches || [];
    } else {
      console.error('Failed to load patches:', result?.error);
      allPatches.value = [];
    }
  } catch (error) {
    console.error('Error loading patches:', error);
    allPatches.value = [];
  } finally {
    loadingPatches.value = false;
  }
}

function editPatch(patch: ExtraPatch) {
  editingPatch.value = patch;
  patchForm.value = {
    patch_code: patch.patch_code,
    name: patch.name,
    description: patch.description || '',
    patch_type: patch.patch_type,
    priority: patch.priority || 100,
    requires_parameters: patch.requires_parameters ? true : false,
    is_system: patch.is_system ? true : false,
    template_text: patch.template_text || '',
    parameter_mappings_json: patch.parameter_mappings ? JSON.stringify(JSON.parse(patch.parameter_mappings), null, 2) : '',
    restrictions_json: patch.restrictions ? JSON.stringify(JSON.parse(patch.restrictions), null, 2) : '',
    conflicts_json: patch.conflicts ? JSON.stringify(JSON.parse(patch.conflicts), null, 2) : '',
    dependencies_json: patch.dependencies ? JSON.stringify(JSON.parse(patch.dependencies), null, 2) : '',
    fileData: null,
    fileName: '',
  };
  // Validate on load
  validateParameterMappings();
}

async function deletePatch(patch: ExtraPatch) {
  if (!confirm(`Are you sure you want to delete patch "${patch.name}" (${patch.patch_code})?`)) {
    return;
  }
  
  try {
    const api = (window as any)?.electronAPI;
    if (!api?.deleteExtraPatch) {
      alert('Delete functionality not available');
      return;
    }
    
    const result = await api.deleteExtraPatch({ epuuid: patch.epuuid });
    
    if (result?.success) {
      await loadAllPatches();
      // Also reload available patches if on apply tab
      if (activeTab.value === 'apply') {
        await loadAvailablePatches();
      }
      // Also reload if we're currently viewing the apply tab
      if (props.isOpen && activeTab.value === 'apply') {
        await loadAvailablePatches();
      }
    } else {
      alert(`Failed to delete patch: ${result?.error || 'Unknown error'}`);
    }
  } catch (error: any) {
    alert(`Error deleting patch: ${error?.message || String(error)}`);
  }
}

function closePatchForm() {
  showAddPatchForm.value = false;
  editingPatch.value = null;
  parameterMappingsValid.value = true;
  parameterMappingsError.value = '';
  patchForm.value = {
    patch_code: '',
    name: '',
    description: '',
    patch_type: 'ips',
    priority: 100,
    requires_parameters: false,
    is_system: false,
    template_text: '',
    parameter_mappings_json: '',
    restrictions_json: '',
    conflicts_json: '',
    dependencies_json: '',
    fileData: null,
    fileName: '',
  };
}

async function handleFileSelect(event: Event) {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;
  
  try {
    const arrayBuffer = await file.arrayBuffer();
    patchForm.value.fileData = arrayBuffer;
    patchForm.value.fileName = file.name;
  } catch (error: any) {
    alert(`Error reading file: ${error?.message || String(error)}`);
  }
}

const canSavePatch = computed(() => {
  return !!(patchForm.value.patch_code && patchForm.value.name && patchForm.value.patch_type);
});

function insertParameterMapping(inputVar: string) {
  const textarea = document.querySelector('.parameter-mappings-editor textarea') as HTMLTextAreaElement;
  if (!textarea) return;
  
  const cursorPos = textarea.selectionStart;
  const textBefore = patchForm.value.parameter_mappings_json.substring(0, cursorPos);
  const textAfter = patchForm.value.parameter_mappings_json.substring(cursorPos);
  
  // Determine placeholder name (default to input variable name in uppercase)
  const placeholderName = inputVar.toUpperCase().replace(/_/g, '');
  
  // Build the mapping entry
  let newEntry = `"${placeholderName}": {\n    "input": "${inputVar}"\n  }`;
  
  // If there's existing content, add comma and newline
  if (textBefore.trim() && !textBefore.trim().endsWith('{') && !textBefore.trim().endsWith('[')) {
    newEntry = ',\n  ' + newEntry;
  } else if (textBefore.trim() && !textBefore.trim().endsWith('{')) {
    newEntry = '\n  ' + newEntry;
  }
  
  // Check if we're inside an existing object
  const lastOpenBrace = textBefore.lastIndexOf('{');
  const lastCloseBrace = textBefore.lastIndexOf('}');
  if (lastOpenBrace > lastCloseBrace && textBefore.trim().endsWith('{')) {
    newEntry = '\n  ' + newEntry;
  }
  
  const newText = textBefore + newEntry + textAfter;
  patchForm.value.parameter_mappings_json = newText;
  
  // Set cursor position after the new entry
  const newCursorPos = cursorPos + newEntry.length;
  setTimeout(() => {
    textarea.setSelectionRange(newCursorPos, newCursorPos);
    textarea.focus();
    validateParameterMappings();
  }, 0);
}

function validateParameterMappings() {
  const jsonText = patchForm.value.parameter_mappings_json?.trim();
  if (!jsonText) {
    parameterMappingsValid.value = true;
    parameterMappingsError.value = '';
    return;
  }
  
  try {
    const parsed = JSON.parse(jsonText);
    
    // Must be an object
    if (typeof parsed !== 'object' || Array.isArray(parsed)) {
      parameterMappingsValid.value = false;
      parameterMappingsError.value = 'Must be a JSON object';
      return;
    }
    
    // Validate each entry
    for (const [placeholder, mapping] of Object.entries(parsed)) {
      // Mapping must be an object
      if (typeof mapping !== 'object' || Array.isArray(mapping) || mapping === null) {
        parameterMappingsValid.value = false;
        parameterMappingsError.value = `"${placeholder}": mapping must be an object`;
        return;
      }
      
      // Must have "input" field
      if (!mapping.input || typeof mapping.input !== 'string') {
        parameterMappingsValid.value = false;
        parameterMappingsError.value = `"${placeholder}": missing or invalid "input" field`;
        return;
      }
      
      // Input must be a valid parameter name
      if (!VALID_INPUT_PARAMS.includes(mapping.input)) {
        parameterMappingsValid.value = false;
        parameterMappingsError.value = `"${placeholder}": invalid input "${mapping.input}". Must be one of: ${VALID_INPUT_PARAMS.join(', ')}`;
        return;
      }
      
      // Optional "expression" field must be a string if present
      if (mapping.expression !== undefined && typeof mapping.expression !== 'string') {
        parameterMappingsValid.value = false;
        parameterMappingsError.value = `"${placeholder}": "expression" must be a string`;
        return;
      }
      
      // Optional "description" field must be a string if present
      if (mapping.description !== undefined && typeof mapping.description !== 'string') {
        parameterMappingsValid.value = false;
        parameterMappingsError.value = `"${placeholder}": "description" must be a string`;
        return;
      }
    }
    
    parameterMappingsValid.value = true;
    parameterMappingsError.value = '';
  } catch (e: any) {
    parameterMappingsValid.value = false;
    parameterMappingsError.value = `Invalid JSON: ${e.message}`;
  }
}

async function savePatch() {
  if (!canSavePatch.value) {
    alert('Please fill in required fields (Patch Code, Name, Patch Type)');
    return;
  }
  
  // Validate parameter mappings format
  if (patchForm.value.parameter_mappings_json && !parameterMappingsValid.value) {
    alert(`Invalid Parameter Mappings: ${parameterMappingsError.value}`);
    return;
  }
  
  try {
    // Validate JSON fields
    let parameterMappings = null;
    let restrictions = null;
    let conflicts = null;
    let dependencies = null;
    
    if (patchForm.value.parameter_mappings_json) {
      try {
        parameterMappings = JSON.parse(patchForm.value.parameter_mappings_json);
      } catch (e) {
        alert('Invalid JSON in Parameter Mappings');
        return;
      }
    }
    
    if (patchForm.value.restrictions_json) {
      try {
        restrictions = JSON.parse(patchForm.value.restrictions_json);
      } catch (e) {
        alert('Invalid JSON in Restrictions');
        return;
      }
    }
    
    if (patchForm.value.conflicts_json) {
      try {
        conflicts = JSON.parse(patchForm.value.conflicts_json);
      } catch (e) {
        alert('Invalid JSON in Conflicts');
        return;
      }
    }
    
    if (patchForm.value.dependencies_json) {
      try {
        dependencies = JSON.parse(patchForm.value.dependencies_json);
      } catch (e) {
        alert('Invalid JSON in Dependencies');
        return;
      }
    }
    
    // Validate file data for file-based patches (only required for new patches)
    if ((patchForm.value.patch_type === 'ips' || patchForm.value.patch_type === 'bps' || patchForm.value.patch_type === 'uberasmtree') && !editingPatch.value && !patchForm.value.fileData) {
      alert('Please select a patch file');
      return;
    }
    
    // Validate template text for ASAR
    if (patchForm.value.patch_type === 'asar' && !patchForm.value.template_text) {
      alert('Please provide ASAR template text');
      return;
    }
    
    const api = (window as any)?.electronAPI;
    if (!api?.saveExtraPatch) {
      alert('Save functionality not available');
      return;
    }
    
    const result = await api.saveExtraPatch({
      epuuid: editingPatch.value?.epuuid || null,
      patch_code: patchForm.value.patch_code,
      name: patchForm.value.name,
      description: patchForm.value.description || null,
      patch_type: patchForm.value.patch_type,
      priority: patchForm.value.priority || 100,
      requires_parameters: patchForm.value.requires_parameters ? 1 : 0,
      is_system: patchForm.value.is_system,
      template_text: patchForm.value.patch_type === 'asar' ? patchForm.value.template_text : null,
      file_data: patchForm.value.fileData ? Array.from(new Uint8Array(patchForm.value.fileData)) : null,
      parameter_mappings: parameterMappings ? JSON.stringify(parameterMappings) : null,
      restrictions: restrictions ? JSON.stringify(restrictions) : null,
      conflicts: conflicts ? JSON.stringify(conflicts) : null,
      dependencies: dependencies ? JSON.stringify(dependencies) : null,
    });
    
    if (result?.success) {
      closePatchForm();
      await loadAllPatches();
      // Always reload available patches when saving/editing, in case restrictions changed
      if (props.isOpen && activeTab.value === 'apply') {
        await loadAvailablePatches();
      }
    } else {
      alert(`Failed to save patch: ${result?.error || 'Unknown error'}`);
    }
  } catch (error: any) {
    alert(`Error saving patch: ${error?.message || String(error)}`);
  }
}

// Preset functions
async function loadPresets() {
  loadingPresets.value = true;
  try {
    const api = (window as any)?.electronAPI;
    if (!api?.getPresets) {
      allPresets.value = [];
      return;
    }
    
    const result = await api.getPresets();
    if (result?.success) {
      allPresets.value = result.presets || [];
    } else {
      console.error('Failed to load presets:', result?.error);
      allPresets.value = [];
    }
  } catch (error) {
    console.error('Error loading presets:', error);
    allPresets.value = [];
  } finally {
    loadingPresets.value = false;
  }
}

function loadPreset(preset: Preset) {
  try {
    selectedPatches.value = JSON.parse(preset.selected_patches || '[]');
    globalParams.value.gonoffv = JSON.parse(preset.global_onoffv || '[]');
    localParams.value = JSON.parse(preset.patch_variables || '{}');
    presetsDropdownOpen.value = false;
    saveState(); // Save the loaded preset state
  } catch (error) {
    alert(`Error loading preset: ${error}`);
  }
}

async function savePreset() {
  if (!newPresetName.value.trim()) {
    alert('Please enter a preset name');
    return;
  }
  
  try {
    const api = (window as any)?.electronAPI;
    if (!api?.savePreset) {
      alert('Save preset functionality not available');
      return;
    }
    
    const result = await api.savePreset({
      preset_name: newPresetName.value.trim(),
      selected_patches: selectedPatches.value,
      global_onoffv: globalParams.value.gonoffv,
      patch_variables: localParams.value,
      is_system: false, // User presets are never system
    });
    
    if (result?.success) {
      newPresetName.value = '';
      showSavePresetDialog.value = false;
      await loadPresets();
    } else {
      alert(`Failed to save preset: ${result?.error || 'Unknown error'}`);
    }
  } catch (error: any) {
    alert(`Error saving preset: ${error?.message || String(error)}`);
  }
}

async function deletePreset(preset: Preset) {
  if (!confirm(`Are you sure you want to delete preset "${preset.preset_name}"?`)) {
    return;
  }
  
  try {
    const api = (window as any)?.electronAPI;
    if (!api?.deletePreset) {
      alert('Delete preset functionality not available');
      return;
    }
    
    const result = await api.deletePreset({ preset_uuid: preset.preset_uuid });
    
    if (result?.success) {
      await loadPresets();
    } else {
      alert(`Failed to delete preset: ${result?.error || 'Unknown error'}`);
    }
  } catch (error: any) {
    alert(`Error deleting preset: ${error?.message || String(error)}`);
  }
}
</script>


<style scoped>
.advanced-patch-modal {
  max-width: 1000px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
}

.tab-navigation {
  display: flex;
  border-bottom: 1px solid var(--border-primary);
  background: var(--bg-secondary);
}

.tab-button {
  padding: var(--button-padding);
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: var(--base-font-size);
  border-bottom: 2px solid transparent;
  color: var(--text-secondary);
}

.tab-button:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.tab-button.active {
  color: var(--accent-primary);
  border-bottom-color: var(--accent-primary);
  background: var(--bg-primary);
  font-weight: 500;
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
  font-size: var(--large-font-size);
  font-weight: 600;
}

.game-info {
  padding: var(--input-padding);
  background: var(--bg-secondary);
  border-radius: 4px;
  font-size: var(--small-font-size);
  color: var(--text-primary);
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
  font-size: var(--small-font-size);
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
  font-size: var(--small-font-size);
  font-weight: 500;
  white-space: nowrap;
}

.input {
  padding: var(--input-padding);
  border: 1px solid var(--border-primary);
  border-radius: 4px;
  font-size: var(--base-font-size);
  font-family: inherit;
  background: var(--bg-primary);
  color: var(--text-primary);
}

.input:focus {
  outline: none;
  border-color: var(--accent-primary);
}

.hex-input {
  width: 60px;
  font-family: monospace;
  font-size: var(--small-font-size);
  padding: var(--input-padding);
  border: 1px solid var(--border-primary);
  border-radius: 4px;
  background: var(--bg-primary);
  color: var(--text-primary);
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
  font-size: var(--small-font-size);
  cursor: pointer;
}

.checkbox-label.compact-checkbox-label {
  display: inline-flex;
  gap: 2px;
  margin: 0;
  padding: 2px 4px;
  border: 1px solid var(--border-primary);
  border-radius: 3px;
  background: var(--bg-secondary);
  font-size: var(--small-font-size);
  min-width: 24px;
  width: auto;
  justify-content: center;
  flex-shrink: 0;
}

.checkbox-label.compact-checkbox-label:hover {
  background: var(--bg-hover);
  border-color: var(--border-secondary);
}

.checkbox-label.compact-checkbox-label input[type="checkbox"] {
  margin: 0;
  cursor: pointer;
}

.checkbox-label.compact-checkbox-label input[type="checkbox"]:checked + .bit-number {
  font-weight: 600;
  color: var(--accent-primary);
}

.bit-number {
  font-family: monospace;
  font-size: var(--small-font-size);
  min-width: 14px;
  text-align: center;
}

.patches-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.patch-item {
  border: 1px solid var(--border-primary);
  border-radius: 4px;
  padding: 8px 10px;
  background: var(--bg-primary);
  color: var(--text-primary);
}

.patch-item.has-params {
  border-color: var(--accent-primary);
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
  font-size: var(--medium-font-size);
}

.patch-code {
  font-family: monospace;
  font-size: var(--small-font-size);
  color: var(--text-secondary);
  background: var(--bg-secondary);
  padding: 2px 6px;
  border-radius: 3px;
}

.patch-description {
  font-size: var(--small-font-size);
  color: var(--text-secondary);
  margin-bottom: 4px;
  line-height: 1.3;
}

.patch-params {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--border-primary);
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
  font-size: var(--small-font-size);
  font-weight: 500;
}

.loading-message {
  text-align: center;
  padding: 40px;
  color: var(--text-secondary);
}

.empty-message {
  text-align: center;
  padding: 20px;
  color: var(--text-secondary);
  font-style: italic;
}

.modal-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.btn-primary {
  padding: var(--button-padding);
  background: var(--accent-primary);
  color: var(--button-text);
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: var(--base-font-size);
}

.btn-primary:hover:not(:disabled) {
  background: var(--accent-hover);
}

.btn-primary:disabled {
  background: var(--bg-tertiary);
  color: var(--disabled-text);
  cursor: not-allowed;
}

.btn-secondary {
  padding: var(--button-padding);
  background: var(--button-bg);
  color: var(--button-text);
  border: 1px solid var(--border-primary);
  border-radius: 4px;
  cursor: pointer;
  font-size: var(--base-font-size);
}

.btn-secondary:hover {
  background: var(--button-hover-bg);
}

.btn-small {
  padding: var(--input-padding);
  font-size: var(--small-font-size);
}

.btn-link-small {
  background: none;
  border: none;
  color: var(--accent-primary);
  cursor: pointer;
  text-decoration: underline;
  font-size: var(--small-font-size);
  padding: 2px 4px;
}

.btn-link-small:hover {
  color: var(--accent-hover);
}

.btn-link-small.btn-danger {
  color: var(--error-color);
}

/* Editor tab styles */
.patch-editor-tab {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.editor-header {
  display: flex;
  gap: 8px;
  justify-content: space-between;
  align-items: center;
}

.patches-editor-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 500px;
  overflow-y: auto;
}

.patch-editor-item {
  border: 1px solid var(--border-primary);
  border-radius: 4px;
  padding: 10px;
  background: var(--bg-primary);
  color: var(--text-primary);
}

.patch-editor-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}

.patch-editor-info {
  display: flex;
  gap: 12px;
  align-items: center;
  flex: 1;
}

.patch-editor-name {
  font-weight: 500;
  font-size: var(--medium-font-size);
}

.patch-editor-code {
  font-family: monospace;
  font-size: var(--small-font-size);
  color: var(--text-secondary);
  background: var(--bg-secondary);
  padding: 2px 6px;
  border-radius: 3px;
}

.patch-editor-type {
  font-size: var(--small-font-size);
  color: var(--accent-primary);
  background: var(--selected-bg);
  padding: 2px 6px;
  border-radius: 3px;
  font-weight: 500;
}

.patch-editor-actions {
  display: flex;
  gap: 8px;
}

.patch-editor-description {
  font-size: var(--small-font-size);
  color: var(--text-secondary);
  margin-top: 4px;
}

/* Patch form modal */
.patch-form-modal {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
}

.patch-form-backdrop {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: var(--modal-overlay);
}

.patch-form-content {
  position: relative;
  background: var(--modal-bg);
  border-radius: 8px;
  max-width: none;
  max-height: 90vh;
  width: 90%;
  display: flex;
  flex-direction: column;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
  z-index: 1001;
  color: var(--text-primary);
}

.patch-form-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  border-bottom: 1px solid var(--border-primary);
}

.patch-form-header h4 {
  margin: 0;
  font-size: var(--large-font-size);
  color: var(--text-primary);
}

.close-small {
  background: none;
  border: none;
  font-size: var(--large-font-size);
  cursor: pointer;
  color: var(--text-secondary);
  padding: 0;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.close-small:hover {
  color: var(--text-primary);
}

.patch-form-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.patch-form-footer {
  padding: 12px 16px;
  border-top: 1px solid var(--border-primary);
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.form-field label {
  font-size: var(--small-font-size);
  font-weight: 500;
  color: var(--text-primary);
}

.form-field .hint {
  font-size: var(--small-font-size);
  color: var(--text-tertiary);
  font-weight: normal;
  font-style: italic;
}

.textarea {
  padding: var(--input-padding);
  border: 1px solid var(--border-primary);
  border-radius: 4px;
  font-size: var(--base-font-size);
  font-family: inherit;
  resize: vertical;
  width: 100%;
  box-sizing: border-box;
  background: var(--bg-primary);
  color: var(--text-primary);
}

.code-textarea {
  font-family: monospace;
  font-size: var(--small-font-size);
}

.code-textarea.valid {
  border-color: var(--success-color);
}

.code-textarea.invalid {
  border-color: var(--error-color);
}

.parameter-mappings-editor {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.quick-insert-buttons {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.quick-insert-buttons button {
  font-size: var(--small-font-size);
  padding: var(--input-padding);
}

.textarea-wrapper {
  position: relative;
  width: 100%;
}

.textarea-wrapper .code-textarea {
  width: 100%;
  min-width: 100%;
  box-sizing: border-box;
}

.validation-indicator {
  position: absolute;
  top: 4px;
  right: 8px;
  font-size: var(--small-font-size);
  pointer-events: none;
}

.valid-indicator {
  color: var(--success-color);
  font-weight: 500;
}

.invalid-indicator {
  color: var(--error-color);
  font-weight: 500;
}

.file-upload-area {
  display: flex;
  gap: 8px;
  align-items: center;
}

.file-name {
  font-size: var(--small-font-size);
  color: var(--text-primary);
  font-family: monospace;
}

.section-header-with-button {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.section-header-with-button h4 {
  margin: 0;
}

.presets-dropdown {
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: 4px;
  background: var(--modal-bg);
  border: 1px solid var(--border-primary);
  border-radius: 4px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  z-index: 1000;
  min-width: 300px;
  max-width: 400px;
  max-height: 500px;
  display: flex;
  flex-direction: column;
}

.presets-dropdown-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-primary);
}

.presets-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.presets-group {
  margin-bottom: 16px;
}

.presets-group:last-child {
  margin-bottom: 0;
}

.presets-group-label {
  font-size: var(--small-font-size);
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: 8px;
  text-transform: uppercase;
}

.preset-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px;
  border: 1px solid var(--border-primary);
  border-radius: 4px;
  margin-bottom: 4px;
  cursor: pointer;
  background: var(--bg-primary);
}

.preset-item:hover {
  background: var(--bg-hover);
}

.preset-name {
  flex: 1;
  font-size: var(--small-font-size);
  color: var(--text-primary);
}

.preset-badge {
  font-size: var(--small-font-size);
  padding: 2px 6px;
  border-radius: 3px;
  background: var(--bg-secondary);
  color: var(--text-secondary);
}

.preset-badge.system {
  background: var(--accent-primary);
  color: var(--button-text);
}

.preset-actions {
  display: flex;
  gap: 4px;
}

.presets-dropdown-footer {
  padding: 8px;
  border-top: 1px solid var(--border-primary);
}

.system-badge {
  font-size: var(--small-font-size);
  padding: 2px 6px;
  border-radius: 3px;
  background: var(--accent-primary);
  color: var(--button-text);
  margin-right: 8px;
}

.preset-save-dialog {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
}

.preset-save-backdrop {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: var(--modal-overlay);
}

.preset-save-content {
  position: relative;
  background: var(--modal-bg);
  border-radius: 8px;
  min-width: 300px;
  max-width: 500px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
  z-index: 2001;
  display: flex;
  flex-direction: column;
}

.preset-save-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  border-bottom: 1px solid var(--border-primary);
}

.preset-save-header h4 {
  margin: 0;
  font-size: var(--large-font-size);
  color: var(--text-primary);
}

.preset-save-body {
  padding: 16px;
}

.preset-save-footer {
  padding: 12px 16px;
  border-top: 1px solid var(--border-primary);
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
</style>

