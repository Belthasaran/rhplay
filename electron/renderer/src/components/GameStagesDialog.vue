<template>
  <div v-if="isOpen" class="modal-backdrop" @click.self="close">
    <div class="modal large-modal game-stages-dialog">
      <header class="modal-header">
        <h3>{{ currentMode === 'select' ? 'Select Game Stage' : (isDevAdmin ? 'Edit Game Stages' : 'Game Stages') }}</h3>
        <button class="close" @click="close">✕</button>
      </header>

      <section class="modal-body">
        <div v-if="loading" class="loading-message">Loading game stages...</div>
        
        <div v-else>
          <!-- Game Info -->
          <div class="game-info-section">
            <div><strong>Game ID:</strong> {{ gameId }}</div>
            <div v-if="gameVersion !== null"><strong>Version:</strong> {{ gameVersion }}</div>
          </div>

          <!-- Action Buttons (DEVADMIN only) -->
          <div v-if="isDevAdmin && currentMode === 'edit'" class="action-buttons">
            <button @click="addNewStage" class="btn-primary btn-small">+ New Stage</button>
          </div>

          <!-- Stages Table -->
          <div class="stages-table-wrapper">
            <table class="stages-table">
              <thead>
                <tr>
                  <th v-if="currentMode === 'select'"></th>
                  <th>Lev#</th>
                  <th>L.Name</th>
                  <th>Trans</th>
                  <th>Sub</th>
                  <th>Req</th>
                  <th>Diff</th>
                  <th>P</th>
                  <th>R</th>
                  <th>M</th>
                  <th>K</th>
                  <th>C</th>
                  <th>G</th>
                  <th>S</th>
                  <th>Ca</th>
                  <th>Bo</th>
                  <th>Se</th>
                  <th>T</th>
                  <th>F</th>
                  <th v-if="isDevAdmin && currentMode === 'edit'">Actions</th>
                </tr>
              </thead>
              <tbody>
                <tr 
                  v-for="stage in stages" 
                  :key="stage.stage_uuid"
                  :class="{ 'selected': selectedStageUuid === stage.stage_uuid }"
                  @click="selectStage(stage)"
                >
                  <td v-if="currentMode === 'select'" class="checkbox-cell">
                    <input 
                      type="checkbox" 
                      :checked="selectedStageUuid === stage.stage_uuid"
                      @change.stop="selectStage(stage)"
                    />
                  </td>
                  <td>
                    <input 
                      v-if="isDevAdmin && currentMode === 'edit'"
                      v-model="stage.levelnumber" 
                      type="number"
                      class="input-small"
                      @input="updateTranslevel(stage)"
                    />
                    <span v-else>{{ stage.levelnumber || '-' }}</span>
                  </td>
                  <td>
                    <input 
                      v-if="isDevAdmin && currentMode === 'edit'"
                      v-model="stage.levelname" 
                      type="text"
                      class="input-medium"
                    />
                    <span v-else>{{ stage.levelname }}</span>
                  </td>
                  <td class="readonly-cell">{{ calculateTranslevel(stage) || '-' }}</td>
                  <td>
                    <input 
                      v-if="isDevAdmin && currentMode === 'edit'"
                      v-model="stage.submapid" 
                      type="text"
                      class="input-small"
                      placeholder="00"
                      maxlength="2"
                      pattern="[0-9A-Fa-f]{0,2}"
                    />
                    <span v-else>{{ stage.submapid || '-' }}</span>
                  </td>
                  <td>
                    <div v-if="isDevAdmin && currentMode === 'edit'" class="requisites-tag-selector">
                      <div class="selected-tags" v-if="getRequisiteTags(stage).length > 0">
                        <span 
                          v-for="tag in getRequisiteTags(stage)" 
                          :key="tag"
                          class="tag-badge"
                        >
                          {{ tag }}
                          <button @click.stop="removeRequisiteTag(stage, tag)" class="tag-remove">×</button>
                        </span>
                      </div>
                      <div class="tag-input-row">
                        <input 
                          v-model="newRequisiteTag"
                          type="text"
                          class="tag-input"
                          placeholder="Type patch code..."
                          @keydown.enter.prevent="addRequisiteTag(stage)"
                          @focus="editingRequisitesForStage = stage.stage_uuid"
                          @blur="setTimeout(() => editingRequisitesForStage = null, 200)"
                        />
                        <select 
                          v-if="availablePatches.length > 0"
                          @change="if ($event.target.value) { newRequisiteTag = $event.target.value; addRequisiteTag(stage); $event.target.value = ''; }"
                          class="tag-select"
                        >
                          <option value="">Add patch...</option>
                          <option 
                            v-for="patch in availablePatches" 
                            :key="patch.epuuid"
                            :value="patch.patch_code"
                            :disabled="getRequisiteTags(stage).includes(patch.patch_code)"
                          >
                            {{ patch.patch_code }} - {{ patch.name }}
                          </option>
                        </select>
                      </div>
                    </div>
                    <span v-else>{{ formatRequisites(stage.requisites) || '-' }}</span>
                  </td>
                  <td>
                    <input 
                      v-if="isDevAdmin && currentMode === 'edit'"
                      v-model.number="stage.difficulty" 
                      type="number"
                      min="0"
                      max="10"
                      class="input-tiny"
                    />
                    <span v-else>{{ stage.difficulty ?? 0 }}</span>
                  </td>
                  <td class="checkbox-cell">
                    <input 
                      type="checkbox" 
                      :checked="stage.playable === 1"
                      :disabled="!(isDevAdmin && currentMode === 'edit')"
                      @change="stage.playable = $event.target.checked ? 1 : 0"
                    />
                  </td>
                  <td class="checkbox-cell">
                    <input 
                      type="checkbox" 
                      :checked="stage.rando === 1"
                      :disabled="!(isDevAdmin && currentMode === 'edit')"
                      @change="stage.rando = $event.target.checked ? 1 : 0"
                    />
                  </td>
                  <td class="checkbox-cell">
                    <input 
                      type="checkbox" 
                      :checked="stage.mainexit === 1"
                      :disabled="!(isDevAdmin && currentMode === 'edit')"
                      @change="stage.mainexit = $event.target.checked ? 1 : 0"
                    />
                  </td>
                  <td class="checkbox-cell">
                    <input 
                      type="checkbox" 
                      :checked="stage.keyhole === 1"
                      :disabled="!(isDevAdmin && currentMode === 'edit')"
                      @change="stage.keyhole = $event.target.checked ? 1 : 0"
                    />
                  </td>
                  <td class="checkbox-cell">
                    <input 
                      type="checkbox" 
                      :checked="stage.credits === 1"
                      :disabled="!(isDevAdmin && currentMode === 'edit')"
                      @change="stage.credits = $event.target.checked ? 1 : 0"
                    />
                  </td>
                  <td class="checkbox-cell">
                    <input 
                      type="checkbox" 
                      :checked="stage.ghouse === 1"
                      :disabled="!(isDevAdmin && currentMode === 'edit')"
                      @change="stage.ghouse = $event.target.checked ? 1 : 0"
                    />
                  </td>
                  <td class="checkbox-cell">
                    <input 
                      type="checkbox" 
                      :checked="stage.spalace === 1"
                      :disabled="!(isDevAdmin && currentMode === 'edit')"
                      @change="stage.spalace = $event.target.checked ? 1 : 0"
                    />
                  </td>
                  <td class="checkbox-cell">
                    <input 
                      type="checkbox" 
                      :checked="stage.castle === 1"
                      :disabled="!(isDevAdmin && currentMode === 'edit')"
                      @change="stage.castle = $event.target.checked ? 1 : 0"
                    />
                  </td>
                  <td class="checkbox-cell">
                    <input 
                      type="checkbox" 
                      :checked="stage.boss === 1"
                      :disabled="!(isDevAdmin && currentMode === 'edit')"
                      @change="stage.boss = $event.target.checked ? 1 : 0"
                    />
                  </td>
                  <td class="checkbox-cell">
                    <input 
                      type="checkbox" 
                      :checked="stage.secret === 1"
                      :disabled="!(isDevAdmin && currentMode === 'edit')"
                      @change="stage.secret = $event.target.checked ? 1 : 0"
                    />
                  </td>
                  <td class="checkbox-cell">
                    <input 
                      type="checkbox" 
                      :checked="stage.troll === 1"
                      :disabled="!(isDevAdmin && currentMode === 'edit')"
                      @change="stage.troll = $event.target.checked ? 1 : 0"
                    />
                  </td>
                  <td class="checkbox-cell">
                    <input 
                      type="checkbox" 
                      :checked="stage.final === 1"
                      :disabled="!(isDevAdmin && currentMode === 'edit')"
                      @change="stage.final = $event.target.checked ? 1 : 0"
                    />
                  </td>
                  <td v-if="isDevAdmin && currentMode === 'edit'" class="actions-cell">
                    <button @click.stop="deleteStage(stage)" class="btn-link-small btn-danger">Delete</button>
                  </td>
                </tr>
                <tr v-if="stages.length === 0">
                  <td :colspan="isDevAdmin && currentMode === 'edit' ? 20 : 19" class="empty-message">
                    No stages found for this game
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <footer class="modal-footer">
        <div class="modal-actions">
          <button 
            v-if="isDevAdmin && currentMode === 'edit'" 
            @click="saveAll" 
            class="btn-primary"
            :disabled="saving"
          >
            {{ saving ? 'Saving...' : 'Save All' }}
          </button>
          <button 
            v-if="currentMode === 'select' && selectedStageUuid" 
            @click="confirmSelection" 
            class="btn-primary"
          >
            Select
          </button>
          <button 
            v-if="isDevAdmin && currentMode !== 'edit'" 
            @click="currentMode = 'edit'" 
            class="btn-primary"
          >
            Edit
          </button>
          <button @click="close" class="btn-secondary">{{ currentMode === 'edit' && isDevAdmin ? 'Cancel' : 'Close' }}</button>
        </div>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';

interface GameStage {
  stage_uuid?: string;
  gameid: string;
  levelnumber?: number | null;
  levelname: string;
  versions?: string;
  submapid?: string | null;
  translevel_13bf?: number | null;
  requisites?: string | null;
  playable: number;
  rando: number;
  difficulty: number;
  mainexit: number;
  keyhole: number;
  credits: number;
  ghouse: number;
  spalace: number;
  castle: number;
  boss: number;
  secret: number;
  troll: number;
  final: number;
}

interface Props {
  isOpen: boolean;
  gameId: string;
  gameVersion?: number | null;
  mode?: 'select' | 'edit'; // 'select' for selecting a level, 'edit' for editing stages
  initialLevelNumber?: number | null; // For selecting a specific level when opening
}

const props = withDefaults(defineProps<Props>(), {
  gameVersion: null,
  mode: 'select',
  initialLevelNumber: null,
});

// Make mode reactive so we can switch it
const currentMode = ref<'select' | 'edit'>(props.mode || 'select');

const emit = defineEmits<{
  close: [];
  select: [stage: GameStage];
  saved: [];
}>();

const loading = ref(false);
const saving = ref(false);
const stages = ref<GameStage[]>([]);
const selectedStageUuid = ref<string | null>(null);
const isDevAdmin = ref(false);
const availablePatches = ref<Array<{epuuid: string, patch_code: string, name: string}>>([]);
const loadingPatches = ref(false);
const editingRequisitesForStage = ref<string | null>(null); // stage_uuid being edited
const newRequisiteTag = ref('');

// Get requisites as array of tags
function getRequisiteTags(stage: GameStage): string[] {
  if (!stage.requisites) return [];
  return stage.requisites.split(',').map(t => t.trim()).filter(t => t.length > 0);
}

// Set requisites from array of tags
function setRequisiteTags(stage: GameStage, tags: string[]) {
  stage.requisites = tags.filter(t => t.trim().length > 0).join(',') || null;
}

// Add a tag to requisites
function addRequisiteTag(stage: GameStage) {
  const tag = newRequisiteTag.value.trim();
  if (!tag) return;
  
  const currentTags = getRequisiteTags(stage);
  if (!currentTags.includes(tag)) {
    currentTags.push(tag);
    setRequisiteTags(stage, currentTags);
  }
  newRequisiteTag.value = '';
}

// Remove a tag from requisites
function removeRequisiteTag(stage: GameStage, tag: string) {
  const currentTags = getRequisiteTags(stage);
  const index = currentTags.indexOf(tag);
  if (index >= 0) {
    currentTags.splice(index, 1);
    setRequisiteTags(stage, currentTags);
  }
}

function formatRequisites(requisites: string | null | undefined): string {
  if (!requisites) return '';
  const tags = requisites.split(',').map(r => r.trim()).filter(r => r.length > 0);
  return tags.join(', ');
}

function calculateTranslevel(stage: GameStage): number | null {
  if (stage.translevel_13bf !== null && stage.translevel_13bf !== undefined) {
    return stage.translevel_13bf;
  }
  if (stage.levelnumber !== null && stage.levelnumber !== undefined) {
    // Simplified calculation: if levelnumber > 0x24, then levelnumber - 0x24, else levelnumber
    return stage.levelnumber > 0x24 ? stage.levelnumber - 0x24 : stage.levelnumber;
  }
  return null;
}

function updateTranslevel(stage: GameStage) {
  stage.translevel_13bf = calculateTranslevel(stage);
}

async function loadAvailablePatches() {
  if (loadingPatches.value) return;
  
  loadingPatches.value = true;
  try {
    const api = (window as any)?.electronAPI;
    if (!api?.getAllExtraPatches) {
      console.error('getAllExtraPatches IPC not available');
      availablePatches.value = [];
      return;
    }
    
    const result = await api.getAllExtraPatches();
    
    if (result?.success) {
      availablePatches.value = (result.patches || []).map((patch: any) => ({
        epuuid: patch.epuuid,
        patch_code: patch.patch_code,
        name: patch.name,
      }));
    } else {
      console.error('Failed to load patches:', result?.error);
      availablePatches.value = [];
    }
  } catch (error) {
    console.error('Error loading patches:', error);
    availablePatches.value = [];
  } finally {
    loadingPatches.value = false;
  }
}

async function loadStages() {
  if (!props.isOpen || !props.gameId) return;
  
  loading.value = true;
  try {
    const api = (window as any)?.electronAPI;
    if (!api?.getGameStages) {
      console.error('getGameStages IPC not available');
      stages.value = [];
      return;
    }
    
    const result = await api.getGameStages({
      gameid: props.gameId,
      version: props.gameVersion || null,
    });
    
    if (result?.success) {
      stages.value = result.stages || [];
      
      // Select initial level if provided
      if (props.initialLevelNumber !== null && props.initialLevelNumber !== undefined) {
        const matchingStage = stages.value.find(s => s.levelnumber === props.initialLevelNumber);
        if (matchingStage) {
          selectedStageUuid.value = matchingStage.stage_uuid || null;
        }
      }
    } else {
      console.error('Failed to load stages:', result?.error);
      stages.value = [];
    }
  } catch (error) {
    console.error('Error loading stages:', error);
    stages.value = [];
  } finally {
    loading.value = false;
  }
}

async function checkDevAdmin() {
  try {
    const api = (window as any)?.electronAPI;
    if (api?.isDevAdmin) {
      const result = await api.isDevAdmin();
      isDevAdmin.value = result?.isDevAdmin || false;
      console.log('[GameStagesDialog] DEVADMIN check result:', result, 'isDevAdmin.value:', isDevAdmin.value);
    } else {
      console.warn('[GameStagesDialog] isDevAdmin IPC not available');
      isDevAdmin.value = false;
    }
  } catch (error) {
    console.error('Error checking DEVADMIN:', error);
    isDevAdmin.value = false;
  }
}

function selectStage(stage: GameStage) {
  if (currentMode.value === 'select') {
    selectedStageUuid.value = stage.stage_uuid || null;
  }
}

function confirmSelection() {
  if (selectedStageUuid.value) {
    const stage = stages.value.find(s => s.stage_uuid === selectedStageUuid.value);
    if (stage) {
      emit('select', stage);
      close();
    }
  }
}

function addNewStage() {
  const newStage: GameStage = {
    stage_uuid: undefined,
    gameid: props.gameId,
    levelnumber: null,
    levelname: 'New Stage',
    versions: '*',
    submapid: null,
    translevel_13bf: null,
    requisites: null,
    playable: 1,
    rando: 1,
    difficulty: 0,
    mainexit: 1,
    keyhole: 0,
    credits: 0,
    ghouse: 0,
    spalace: 0,
    castle: 0,
    boss: 0,
    secret: 0,
    troll: 0,
    final: 0,
  };
  stages.value.push(newStage);
}

async function deleteStage(stage: GameStage) {
  if (!stage.stage_uuid) {
    // Remove from local array if it's a new stage
    const index = stages.value.indexOf(stage);
    if (index >= 0) {
      stages.value.splice(index, 1);
    }
    return;
  }
  
  if (!confirm(`Are you sure you want to delete stage "${stage.levelname}" (Level ${stage.levelnumber})?`)) {
    return;
  }
  
  try {
    const api = (window as any)?.electronAPI;
    if (!api?.deleteGameStage) {
      alert('Delete functionality not available');
      return;
    }
    
    const result = await api.deleteGameStage({ stage_uuid: stage.stage_uuid });
    
    if (result?.success) {
      await loadStages();
    } else {
      alert(`Failed to delete stage: ${result?.error || 'Unknown error'}`);
    }
  } catch (error: any) {
    alert(`Error deleting stage: ${error?.message || String(error)}`);
  }
}

async function saveAll() {
  if (!isDevAdmin.value || currentMode.value !== 'edit') return;
  
  saving.value = true;
  try {
    const api = (window as any)?.electronAPI;
    if (!api?.saveGameStage) {
      alert('Save functionality not available');
      return;
    }
    
    const errors: string[] = [];
    
    for (const stage of stages.value) {
      // Requisites are already formatted as comma-separated tags
      // Calculate translevel
      stage.translevel_13bf = calculateTranslevel(stage);
      
      const result = await api.saveGameStage({
        stage_uuid: stage.stage_uuid || null,
        gameid: stage.gameid,
        levelnumber: stage.levelnumber,
        levelname: stage.levelname,
        versions: stage.versions || '*',
        submapid: stage.submapid,
        translevel_13bf: stage.translevel_13bf,
        requisites: stage.requisites || null,
        playable: stage.playable,
        rando: stage.rando,
        difficulty: stage.difficulty,
        mainexit: stage.mainexit,
        keyhole: stage.keyhole,
        credits: stage.credits,
        ghouse: stage.ghouse,
        spalace: stage.spalace,
        castle: stage.castle,
        boss: stage.boss,
        secret: stage.secret,
        troll: stage.troll,
        final: stage.final,
      });
      
      if (!result?.success) {
        errors.push(`Failed to save "${stage.levelname}": ${result?.error || 'Unknown error'}`);
      }
    }
    
    if (errors.length > 0) {
      alert(`Some stages failed to save:\n${errors.join('\n')}`);
    } else {
      emit('saved');
      await loadStages();
    }
  } catch (error: any) {
    alert(`Error saving stages: ${error?.message || String(error)}`);
  } finally {
    saving.value = false;
  }
}

function close() {
  emit('close');
}

watch(() => props.isOpen, async (newVal) => {
  if (newVal) {
    currentMode.value = props.mode || 'select';
    await checkDevAdmin();
    await loadAvailablePatches(); // Load patches for tag selector
    await loadStages();
    // If DEVADMIN is enabled and mode is select, default to edit mode
    if (isDevAdmin.value && currentMode.value === 'select') {
      // Keep select mode but allow switching to edit
    }
  }
});

watch(() => props.mode, (newMode) => {
  if (props.isOpen) {
    currentMode.value = newMode || 'select';
  }
});

watch(() => props.gameId, async () => {
  if (props.isOpen) {
    await loadStages();
  }
});

watch(() => props.initialLevelNumber, () => {
  if (props.isOpen && props.initialLevelNumber !== null && props.initialLevelNumber !== undefined) {
    const matchingStage = stages.value.find(s => s.levelnumber === props.initialLevelNumber);
    if (matchingStage) {
      selectedStageUuid.value = matchingStage.stage_uuid || null;
    }
  }
});
</script>

<style scoped>
.game-stages-dialog {
  max-width: 95vw;
  width: 95vw;
}

.game-info-section {
  padding: 12px;
  margin-bottom: 16px;
  background: var(--bg-secondary);
  border-radius: 4px;
  display: flex;
  gap: 16px;
  font-size: var(--small-font-size);
}

.action-buttons {
  margin-bottom: 12px;
  display: flex;
  gap: 8px;
}

.stages-table-wrapper {
  overflow-x: auto;
  max-height: 60vh;
  border: 1px solid var(--border-primary);
  border-radius: 4px;
}

.stages-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--small-font-size);
  background: var(--bg-primary);
}

.stages-table thead {
  position: sticky;
  top: 0;
  background: var(--bg-secondary);
  z-index: 10;
}

.stages-table th {
  padding: 8px 4px;
  text-align: left;
  font-weight: 600;
  border-bottom: 2px solid var(--border-primary);
  color: var(--text-primary);
  white-space: nowrap;
}

.stages-table td {
  padding: 6px 4px;
  border-bottom: 1px solid var(--border-primary);
  color: var(--text-primary);
}

.stages-table tr:hover {
  background: var(--bg-hover);
}

.stages-table tr.selected {
  background: var(--accent-primary);
  color: var(--button-text);
}

.checkbox-cell {
  text-align: center;
  width: 30px;
}

.readonly-cell {
  color: var(--text-tertiary);
  font-family: monospace;
}

.actions-cell {
  white-space: nowrap;
}

.input-small {
  width: 60px;
  padding: 4px;
  font-size: var(--small-font-size);
  border: 1px solid var(--border-primary);
  border-radius: 3px;
  background: var(--bg-primary);
  color: var(--text-primary);
}

.input-medium {
  width: 150px;
  padding: 4px;
  font-size: var(--small-font-size);
  border: 1px solid var(--border-primary);
  border-radius: 3px;
  background: var(--bg-primary);
  color: var(--text-primary);
}

.input-tiny {
  width: 40px;
  padding: 4px;
  font-size: var(--small-font-size);
  border: 1px solid var(--border-primary);
  border-radius: 3px;
  background: var(--bg-primary);
  color: var(--text-primary);
}

.requisites-selector {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.requisites-selector label {
  display: flex;
  align-items: center;
  gap: 2px;
  font-size: var(--small-font-size);
  cursor: pointer;
}

.empty-message {
  text-align: center;
  padding: 24px;
  color: var(--text-tertiary);
  font-style: italic;
}

.loading-message {
  text-align: center;
  padding: 24px;
  color: var(--text-secondary);
}

.requisites-tag-selector {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 200px;
}

.selected-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  min-height: 20px;
}

.tag-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px;
  background: var(--accent-primary);
  color: var(--button-text);
  border-radius: 3px;
  font-size: var(--small-font-size);
  font-family: monospace;
}

.tag-remove {
  background: none;
  border: none;
  color: var(--button-text);
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
  padding: 0;
  margin: 0;
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.tag-remove:hover {
  background: rgba(0, 0, 0, 0.2);
  border-radius: 50%;
}

.tag-input-row {
  display: flex;
  gap: 4px;
  align-items: center;
}

.tag-input {
  flex: 1;
  padding: 4px 6px;
  font-size: var(--small-font-size);
  font-family: monospace;
  border: 1px solid var(--border-primary);
  border-radius: 3px;
  background: var(--bg-primary);
  color: var(--text-primary);
  min-width: 80px;
}

.tag-select {
  padding: 4px 6px;
  font-size: var(--small-font-size);
  border: 1px solid var(--border-primary);
  border-radius: 3px;
  background: var(--bg-primary);
  color: var(--text-primary);
  cursor: pointer;
}
</style>

