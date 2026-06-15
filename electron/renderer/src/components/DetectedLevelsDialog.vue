<template>
  <div v-if="props.isOpen" class="modal-backdrop detected-levels-backdrop" @click.self="close">
    <div class="modal large-modal">
      <header class="modal-header">
        <h3>Detected Levels - {{ gameName || gameId }}</h3>
        <button class="close" @click="close">✕</button>
      </header>
      <section class="modal-body">
        <div v-if="loading" class="loading-message">
          {{ progressMessage || 'Loading detected levels...' }}
        </div>
        
        <template v-else>
          <!-- Source Filters -->
          <div class="filter-section">
            <h4>Show Sources:</h4>
            <div class="filter-checkboxes">
              <label>
                <input type="checkbox" v-model="showSources.lmlevels" /> LMLevels
              </label>
              <label>
                <input type="checkbox" v-model="showSources.detect" /> Detect
              </label>
              <label>
                <input type="checkbox" v-model="showSources.trans" /> Trans
              </label>
              <label>
                <input type="checkbox" v-model="showSources.levelnames" /> Levelnames
              </label>
              <label>
                <input type="checkbox" v-model="showSources.jitnames" /> JITNames
              </label>
              <label>
                <input type="checkbox" v-model="showSources.jittrans" /> JIT.Trans
              </label>
              <label>
                <input type="checkbox" v-model="showSources.jitlmfilter" /> JIT.LMFilter
              </label>
              <label>
                <input type="checkbox" v-model="showSources.jitlevelinfo" /> JIT.LevelInfo
              </label>
              <label>
                <input type="checkbox" v-model="showSources.jitscore" /> JIT.Score
              </label>
              <label>
                <input type="checkbox" v-model="hideExisting" /> Hide Already Added
              </label>
              <label>
                <input type="checkbox" v-model="showScoreColumns" /> Show Scores
              </label>
            </div>
            <div class="filter-control">
              <label for="min-source-count">Minimum sources:</label>
              <select id="min-source-count" v-model.number="minSourceCount" class="source-count-select">
                <option v-for="n in 9" :key="n" :value="n">{{ n }}</option>
              </select>
            </div>
          </div>

          <!-- Detected Levels Table -->
          <div class="table-wrapper">
            <table class="detected-levels-table">
              <thead>
                <tr>
                  <th class="checkbox-cell">
                    <input 
                      type="checkbox" 
                      :checked="allSelected"
                      :indeterminate="someSelected"
                      @change="toggleSelectAll"
                      title="Select/Deselect all visible levels"
                    />
                  </th>
                  <th>Lev#</th>
                  <th>L.Name</th>
                  <th>Trans</th>
                  <th>Sub</th>
                  <th>X</th>
                  <th>Y</th>
                  <th>Tile</th>
                  <th v-if="showScoreColumns">Orig</th>
                  <th v-if="showScoreColumns">Int</th>
                  <th v-if="showScoreColumns">Comp</th>
                  <th>Sources</th>
                </tr>
              </thead>
              <tbody>
                <tr 
                  v-for="level in filteredLevels" 
                  :key="level.levelnumber"
                  :class="{
                    'confirmed': level.sourceCount >= 2,
                    'lmlevels-found': level.sources.includes('lmlevels')
                  }"
                  @click="toggleLevelSelection(level)"
                >
                  <td class="checkbox-cell">
                    <input 
                      type="checkbox" 
                      :checked="selectedLevels.has(level.levelnumber)"
                      @change.stop="toggleLevelSelection(level)"
                    />
                  </td>
                  <td class="monospace">{{ level.levelnumber }}</td>
                  <td>{{ level.levelname || '-' }}</td>
                  <td class="monospace">{{ level.translevel || '-' }}</td>
                  <td class="monospace">{{ level.submapid || '-' }}</td>
                  <td class="monospace">{{ level.tile_x || '-' }}</td>
                  <td class="monospace">{{ level.tile_y || '-' }}</td>
                  <td class="monospace">{{ level.tile_value || '-' }}</td>
                  <td v-if="showScoreColumns" class="monospace">{{ level.scores?.originality ?? '-' }}</td>
                  <td v-if="showScoreColumns" class="monospace">{{ level.scores?.internalSimilarity ?? '-' }}</td>
                  <td v-if="showScoreColumns" class="monospace">{{ level.scores?.completeness ?? '-' }}</td>
                  <td class="sources-cell">
                    <span 
                      v-for="source in level.sources" 
                      :key="source"
                      :class="'source-badge source-' + source"
                      :title="getSourceName(source)"
                    >
                      {{ getSourceInitial(source) }}
                    </span>
                  </td>
                </tr>
                <tr v-if="filteredLevels.length === 0">
                  <td :colspan="showScoreColumns ? 12 : 9" class="empty-message">No detected levels found</td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>
      </section>
      <footer class="modal-footer">
        <button 
          @click="addSelected" 
          class="btn-primary"
          :disabled="selectedLevels.size === 0"
        >
          Add Selected ({{ selectedLevels.size }})
        </button>
        <button @click="close" class="btn-secondary">Cancel</button>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onUpdated, nextTick, onUnmounted } from 'vue';
import { showAlert, showPrompt } from '@/utils/dialogs';

interface Props {
  isOpen: boolean;
  gameId: string;
  gameVersion?: number | null;
  existingLevelNumbers?: string[];
}

const props = withDefaults(defineProps<Props>(), {
  gameVersion: null,
  existingLevelNumbers: () => [],
});

const emit = defineEmits<{
  close: [];
  levelsSelected: [levels: any[]];
}>();

interface DetectedLevel {
  levelnumber: string;
  levelname?: string | null;
  translevel?: string | null;
  submapid?: string | null;
  tile_x?: string | null;
  tile_y?: string | null;
  tile_value?: string | null;
  sources: string[];
  sourceCount: number;
  scores?: {
    originality?: number;
    internalSimilarity?: number;
    completeness?: number;
  };
  levelInfo?: any;
  suggestedTags?: string[];
  water?: number;
  ghouse?: number;
  spalace?: number;
  castle?: number;
  boss?: number;
  mainexit?: number;
  keyhole?: number;
  credits?: number;
  stagetags?: string;
  difficulty?: number;
  extradescription?: string | null;
}

const loading = ref(false);
const progressMessage = ref('');
const detectedLevels = ref<DetectedLevel[]>([]);
const selectedLevels = ref<Set<string>>(new Set());
const showScoreColumns = ref(true);
const showSources = ref({
  lmlevels: true,
  detect: true,
  trans: true,
  levelnames: true,
  jitnames: true,
  jittrans: true,
  jitlmfilter: true,
  jitlevelinfo: true,
  jitscore: true,
});
const hideExisting = ref(true);
const minSourceCount = ref<number>(1); // Minimum number of sources required (1, 2, or 3)
const gameName = ref<string>('');

// Filter levels based on sources, existing levels, and minimum source count
const filteredLevels = computed(() => {
  return detectedLevels.value.filter(level => {
    // Filter by source visibility
    const visibleSources = level.sources.filter(source => {
      if (source === 'lmlevels') return showSources.value.lmlevels;
      if (source === 'detect') return showSources.value.detect;
      if (source === 'trans') return showSources.value.trans;
      if (source === 'levelnames') return showSources.value.levelnames;
      if (source === 'jitnames') return showSources.value.jitnames;
      if (source === 'jittrans') return showSources.value.jittrans;
      if (source === 'jitlmfilter') return showSources.value.jitlmfilter;
      if (source === 'jitlevelinfo') return showSources.value.jitlevelinfo;
      if (source === 'jitscore') return showSources.value.jitscore;
      return false;
    });
    
    if (visibleSources.length === 0) return false;
    
    // Filter by minimum source count (only count visible sources)
    if (visibleSources.length < minSourceCount.value) {
      return false;
    }
    
    // Filter by existing levels
    if (hideExisting.value && props.existingLevelNumbers?.includes(level.levelnumber)) {
      return false;
    }
    
    return true;
  }).sort((a, b) => {
    const compA = a.scores?.completeness ?? 0;
    const compB = b.scores?.completeness ?? 0;
    if (compB !== compA) return compB - compA;
    return b.sourceCount - a.sourceCount;
  });
});

// Computed properties for select all checkbox
const allSelected = computed(() => {
  if (filteredLevels.value.length === 0) return false;
  return filteredLevels.value.every(level => selectedLevels.value.has(level.levelnumber));
});

const someSelected = computed(() => {
  if (filteredLevels.value.length === 0) return false;
  const selectedCount = filteredLevels.value.filter(level => selectedLevels.value.has(level.levelnumber)).length;
  return selectedCount > 0 && selectedCount < filteredLevels.value.length;
});

function toggleSelectAll(event: Event) {
  const target = event.target as HTMLInputElement;
  if (target.checked) {
    // Select all filtered levels
    filteredLevels.value.forEach(level => {
      selectedLevels.value.add(level.levelnumber);
    });
  } else {
    // Deselect all filtered levels
    filteredLevels.value.forEach(level => {
      selectedLevels.value.delete(level.levelnumber);
    });
  }
}

async function loadDetectedLevels(runCalisto = false) {
  if (!props.isOpen || !props.gameId) return;

  loading.value = true;
  progressMessage.value = 'Building ROM…';
  let removeProgressListener: (() => void) | null = null;

  try {
    const api = (window as any)?.electronAPI;
    if (!api?.runJitLevelDetection) {
      if (api?.getDetectedLevels) {
        const result = await api.getDetectedLevels({
          gameid: props.gameId,
          version: props.gameVersion || null,
        });
        if (result?.success) {
          detectedLevels.value = result.levels || [];
          gameName.value = result.gameName || '';
        }
      }
      return;
    }

    if (api.onJitDetectionProgress) {
      removeProgressListener = api.onJitDetectionProgress((payload: any) => {
        progressMessage.value = payload?.message || payload?.phase || 'Analyzing…';
      });
    }

    let currentSettings: any = {};
    if (api.getSettings) {
      const settingsResult = await api.getSettings();
      if (settingsResult && typeof settingsResult === 'object') {
        currentSettings = settingsResult;
      }
    }

    const result = await api.runJitLevelDetection({
      gameid: props.gameId,
      version: props.gameVersion || null,
      runCalisto,
      includeDbSources: true,
      tempDirOverride: currentSettings.tempDirOverride || '',
      vanillaRomPath: currentSettings.vanillaRomPath || '',
      flipsPath: currentSettings.flipsPath || '',
    });

    if (result?.success) {
      detectedLevels.value = result.levels || [];
      gameName.value = result.gameName || '';

      if (result.calistoNeeded && !runCalisto) {
        const answer = await showPrompt(
          'LMFilter data not found. Would you like to launch Lunar Magic (jitlevels/lm363.exe) and Calisto to attempt a definitive level list?\n\nRequires Wine on Linux.',
          '',
          'LMFilter Not Found',
          'Run Calisto export?'
        );
        if (answer && String(answer).trim().toLowerCase() !== 'cancel') {
          await loadDetectedLevels(true);
          return;
        }
      }

      if (result.warnings?.length) {
        console.warn('[DetectedLevels] JIT warnings:', result.warnings);
      }
    } else {
      await showAlert(result?.error || 'JIT detection failed', 'Detected Levels');
      detectedLevels.value = [];
    }
  } catch (error: any) {
    console.error('Error loading detected levels:', error);
    await showAlert(error?.message || String(error), 'Detected Levels Error');
    detectedLevels.value = [];
  } finally {
    if (removeProgressListener) removeProgressListener();
    loading.value = false;
    progressMessage.value = '';
  }
}

function getSourceName(source: string): string {
  if (source === 'lmlevels') return 'LMLevels';
  if (source === 'detect') return 'Detect';
  if (source === 'trans') return 'Trans';
  if (source === 'levelnames') return 'Levelnames';
  if (source === 'jitnames') return 'JITNames';
  if (source === 'jittrans') return 'JIT.Trans';
  if (source === 'jitlmfilter') return 'JIT.LMFilter';
  if (source === 'jitlevelinfo') return 'JIT.LevelInfo';
  if (source === 'jitscore') return 'JIT.Score';
  return source;
}

function getSourceInitial(source: string): string {
  if (source === 'lmlevels') return 'L';
  if (source === 'detect') return 'D';
  if (source === 'trans') return 'T';
  if (source === 'levelnames') return 'N';
  if (source === 'jitnames') return 'N';
  if (source === 'jittrans') return 'T';
  if (source === 'jitlmfilter') return 'F';
  if (source === 'jitlevelinfo') return 'I';
  if (source === 'jitscore') return 'S';
  return source.charAt(0).toUpperCase();
}

function toggleLevelSelection(level: DetectedLevel) {
  if (selectedLevels.value.has(level.levelnumber)) {
    selectedLevels.value.delete(level.levelnumber);
  } else {
    selectedLevels.value.add(level.levelnumber);
  }
}

function addSelected() {
  const selected = filteredLevels.value.filter(level => selectedLevels.value.has(level.levelnumber));
  emit('levelsSelected', selected);
  selectedLevels.value.clear();
}

function close() {
  selectedLevels.value.clear();
  emit('close');
}

watch(() => props.isOpen, async (newVal) => {
  if (newVal) {
    await loadDetectedLevels();
  }
});

watch(() => props.gameId, async () => {
  if (props.isOpen) {
    await loadDetectedLevels();
  }
});

onUpdated(() => {
  if (!props.isOpen) return;
  
  const backdrop = document.querySelector('.detected-levels-backdrop') as HTMLElement;
  if (backdrop) {
    // Force visibility - must be higher than parent modal (20000)
    backdrop.style.zIndex = '25000';
    backdrop.style.display = 'flex';
    backdrop.style.visibility = 'visible';
    backdrop.style.opacity = '1';
  }
  
  // Update indeterminate state of select all checkbox
  nextTick(() => {
    const selectAllCheckbox = document.querySelector('.detected-levels-table thead input[type="checkbox"]') as HTMLInputElement;
    if (selectAllCheckbox) {
      selectAllCheckbox.indeterminate = someSelected.value;
    }
  });
});
</script>

<style scoped>
.modal-backdrop {
  position: fixed !important;
  top: 0 !important;
  left: 0 !important;
  right: 0 !important;
  bottom: 0 !important;
  background: rgba(0, 0, 0, 0.7) !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  z-index: 2000 !important;
}

.detected-levels-backdrop {
  z-index: 25000 !important;
  background: rgba(0, 0, 0, 0.85) !important;
}

.modal {
  background: var(--bg-primary);
  border-radius: 8px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
  max-width: 90vw;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
}

.large-modal {
  width: 90vw;
  max-width: 1200px;
}

.modal-header {
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-primary);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.modal-header h3 {
  margin: 0;
  font-size: var(--medium-font-size);
  color: var(--text-primary);
}

.modal-header .close {
  background: none;
  border: none;
  font-size: 24px;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 0;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.modal-header .close:hover {
  color: var(--text-primary);
}

.modal-body {
  padding: 20px;
  overflow-y: auto;
  flex: 1;
}

.modal-footer {
  padding: 16px 20px;
  border-top: 1px solid var(--border-primary);
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

.loading-message {
  text-align: center;
  padding: 40px;
  color: var(--text-secondary);
}

.filter-section {
  margin-bottom: 20px;
  padding: 12px;
  background: var(--bg-secondary);
  border-radius: 4px;
}

.filter-section h4 {
  margin: 0 0 8px 0;
  font-size: var(--small-font-size);
  color: var(--text-primary);
}

.filter-checkboxes {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
}

.filter-checkboxes label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--small-font-size);
  color: var(--text-primary);
  cursor: pointer;
}

.filter-control {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
}

.filter-control label {
  font-weight: 500;
  font-size: var(--small-font-size);
  color: var(--text-primary);
}

.source-count-select {
  padding: 4px 8px;
  border: 1px solid var(--border-primary);
  border-radius: 4px;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: var(--base-font-size);
  cursor: pointer;
}

.source-count-select:hover {
  border-color: var(--border-hover);
}

.table-wrapper {
  overflow-x: auto;
  max-height: 60vh;
  border: 1px solid var(--border-primary);
  border-radius: 4px;
}

.detected-levels-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--small-font-size);
  background: var(--bg-primary);
}

.detected-levels-table thead {
  position: sticky;
  top: 0;
  background: var(--bg-secondary);
  z-index: 10;
}

.detected-levels-table th {
  padding: 8px;
  text-align: left;
  font-weight: 600;
  border-bottom: 2px solid var(--border-primary);
  color: var(--text-primary);
  white-space: nowrap;
}

.detected-levels-table td {
  padding: 6px 8px;
  border-bottom: 1px solid var(--border-primary);
  color: var(--text-primary);
}

.detected-levels-table tr:hover {
  background: var(--bg-hover);
  cursor: pointer;
}

.detected-levels-table tr.confirmed {
  font-weight: 600;
  background: var(--bg-secondary);
}

.detected-levels-table tr.confirmed.lmlevels-found {
  background: var(--accent-primary);
  color: var(--button-text);
}

.detected-levels-table tr.lmlevels-found:not(.confirmed) {
  font-style: italic;
  background: var(--bg-hover);
}

.checkbox-cell {
  text-align: center;
  width: 40px;
}

.monospace {
  font-family: monospace;
}

.sources-cell {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.source-badge {
  display: inline-block;
  padding: 2px 6px;
  border-radius: 3px;
  font-size: var(--small-font-size);
  font-weight: 600;
  font-family: monospace;
}

.source-lmlevels {
  background: var(--accent-primary);
  color: var(--button-text);
}

.source-detect {
  background: var(--bg-secondary);
  color: var(--text-primary);
  border: 1px solid var(--border-primary);
}

.source-trans {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.source-levelnames {
  background: var(--bg-secondary);
  color: var(--text-primary);
}

.source-jitnames { background: #4a90d9; color: #fff; }
.source-jittrans { background: #6a5acd; color: #fff; }
.source-jitlmfilter { background: #2e8b57; color: #fff; }
.source-jitlevelinfo { background: #c17817; color: #fff; }
.source-jitscore { background: #8b4513; color: #fff; }

.empty-message {
  text-align: center;
  padding: 24px;
  color: var(--text-tertiary);
  font-style: italic;
}

.btn-primary,
.btn-secondary {
  padding: 8px 16px;
  font-size: var(--small-font-size);
  border-radius: 4px;
  border: 1px solid var(--border-primary);
  cursor: pointer;
}

.btn-primary {
  background: var(--accent-primary);
  color: var(--button-text);
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-secondary {
  background: var(--bg-secondary);
  color: var(--text-primary);
}

.btn-primary:hover:not(:disabled),
.btn-secondary:hover {
  opacity: 0.9;
}
</style>

