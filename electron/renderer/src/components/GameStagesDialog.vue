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
            <button @click="openDetectedLevelsDialog" class="btn-secondary btn-small">Detected Levels</button>
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
                  <th>X</th>
                  <th>Y</th>
                  <th>Req</th>
                  <th>Diff</th>
                  <th class="col-playable" title="Playable level (Excludes cusscenes, Invalid, or Auto win/lose levels)">P</th>
                  <th class="col-rando" title="Rando level (Playable levels suitable for use in randomizers)">R</th>
                  <th class="col-mainexit" title="Levels with a main exit (Primary exit used in overworld)">M</th>
                  <th class="col-keyhole" title="Levels with a keydoor exit used in overworld">K</th>
                  <th class="col-credits" title="Credits level (Level used to show in-game credits)">C</th>
                  <th class="col-ghouse" title="Ghost House Level">G</th>
                  <th class="col-spalace" title="Switch Palace Level">S</th>
                  <th class="col-castle" title="Castle Level">Ca</th>
                  <th class="col-boss" title="Level goes straight to a boss">Bo</th>
                  <th class="col-secret" title="Secret level">Se</th>
                  <th>T</th>
                  <th class="col-final" title="Final level. This generally designates the last level of a game.">F</th>
                  <th v-if="isDevAdmin && currentMode === 'edit'">Actions</th>
                </tr>
              </thead>
              <tbody>
                <tr 
                  v-for="stage in stages" 
                  :key="stage.stage_uuid"
                  :class="{ 
                    'selected': selectedStageUuid === stage.stage_uuid,
                    'secret-level': stage.secret === 1 && currentMode !== 'edit'
                  }"
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
                      @input="handleLevelNumberInput($event, stage)"
                      @blur="handleLevelNumberBlur($event, stage)"
                      type="text"
                      class="input-small"
                      placeholder="000"
                      maxlength="3"
                      pattern="[0-9A-Fa-f]{0,3}"
                    />
                    <span v-else-if="stage.secret !== 1 || currentMode === 'edit'">{{ formatLevelNumberHex(stage.levelnumber) || '-' }}</span>
                    <span v-else>-</span>
                  </td>
                  <td>
                    <input 
                      v-if="isDevAdmin && currentMode === 'edit'"
                      v-model="stage.levelname" 
                      type="text"
                      class="input-medium"
                    />
                    <span v-else-if="stage.secret !== 1 || currentMode === 'edit'">{{ stage.levelname }}</span>
                    <span v-else>-</span>
                  </td>
                  <td class="readonly-cell">
                    <span v-if="stage.secret !== 1 || currentMode === 'edit'">{{ calculateTranslevel(stage) || '-' }}</span>
                    <span v-else>-</span>
                  </td>
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
                    <span v-else-if="stage.secret !== 1 || currentMode === 'edit'">{{ stage.submapid || '-' }}</span>
                    <span v-else>-</span>
                  </td>
                  <td>
                    <input 
                      v-if="isDevAdmin && currentMode === 'edit'"
                      v-model="stage.tile_x" 
                      type="text"
                      class="input-tiny"
                      placeholder="-"
                      pattern="[0-9]*"
                      @input="validateIntegerInput($event, stage, 'tile_x')"
                    />
                    <span v-else-if="stage.secret !== 1 || currentMode === 'edit'">{{ stage.tile_x || '-' }}</span>
                    <span v-else>-</span>
                  </td>
                  <td>
                    <input 
                      v-if="isDevAdmin && currentMode === 'edit'"
                      v-model="stage.tile_y" 
                      type="text"
                      class="input-tiny"
                      placeholder="-"
                      pattern="[0-9]*"
                      @input="validateIntegerInput($event, stage, 'tile_y')"
                    />
                    <span v-else-if="stage.secret !== 1 || currentMode === 'edit'">{{ stage.tile_y || '-' }}</span>
                    <span v-else>-</span>
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
                          :title="patch.patch_code + ' - ' + patch.name"
                        >
                          {{ abbreviatePatchName(patch.patch_code, patch.name) }}
                        </option>
                      </select>
                    </div>
                    <span v-else-if="stage.secret !== 1 || currentMode === 'edit'">{{ formatRequisites(stage.requisites) || '-' }}</span>
                    <span v-else>-</span>
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
                    <span v-else-if="stage.secret !== 1 || currentMode === 'edit'">{{ stage.difficulty ?? 0 }}</span>
                    <span v-else>-</span>
                  </td>
                  <td class="checkbox-cell col-playable">
                    <input 
                      type="checkbox" 
                      :checked="stage.playable === 1"
                      :disabled="!(isDevAdmin && currentMode === 'edit')"
                      @change="stage.playable = $event.target.checked ? 1 : 0"
                    />
                  </td>
                  <td class="checkbox-cell col-rando">
                    <input 
                      type="checkbox" 
                      :checked="stage.rando === 1"
                      :disabled="!(isDevAdmin && currentMode === 'edit')"
                      @change="stage.rando = $event.target.checked ? 1 : 0"
                    />
                  </td>
                  <td class="checkbox-cell col-mainexit">
                    <input 
                      type="checkbox" 
                      :checked="stage.mainexit === 1"
                      :disabled="!(isDevAdmin && currentMode === 'edit')"
                      @change="stage.mainexit = $event.target.checked ? 1 : 0"
                    />
                  </td>
                  <td class="checkbox-cell col-keyhole">
                    <input 
                      type="checkbox" 
                      :checked="stage.keyhole === 1"
                      :disabled="!(isDevAdmin && currentMode === 'edit')"
                      @change="stage.keyhole = $event.target.checked ? 1 : 0"
                    />
                  </td>
                  <td class="checkbox-cell col-credits">
                    <input 
                      type="checkbox" 
                      :checked="stage.credits === 1"
                      :disabled="!(isDevAdmin && currentMode === 'edit')"
                      @change="stage.credits = $event.target.checked ? 1 : 0"
                    />
                  </td>
                  <td class="checkbox-cell col-ghouse">
                    <input 
                      type="checkbox" 
                      :checked="stage.ghouse === 1"
                      :disabled="!(isDevAdmin && currentMode === 'edit')"
                      @change="stage.ghouse = $event.target.checked ? 1 : 0"
                    />
                  </td>
                  <td class="checkbox-cell col-spalace">
                    <input 
                      type="checkbox" 
                      :checked="stage.spalace === 1"
                      :disabled="!(isDevAdmin && currentMode === 'edit')"
                      @change="stage.spalace = $event.target.checked ? 1 : 0"
                    />
                  </td>
                  <td class="checkbox-cell col-castle">
                    <input 
                      type="checkbox" 
                      :checked="stage.castle === 1"
                      :disabled="!(isDevAdmin && currentMode === 'edit')"
                      @change="stage.castle = $event.target.checked ? 1 : 0"
                    />
                  </td>
                  <td class="checkbox-cell col-boss">
                    <input 
                      type="checkbox" 
                      :checked="stage.boss === 1"
                      :disabled="!(isDevAdmin && currentMode === 'edit')"
                      @change="stage.boss = $event.target.checked ? 1 : 0"
                    />
                  </td>
                  <td class="checkbox-cell col-secret">
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
                  <td class="checkbox-cell col-final">
                    <input 
                      type="checkbox" 
                      :checked="stage.final === 1"
                      :disabled="!(isDevAdmin && currentMode === 'edit')"
                      @change="stage.final = $event.target.checked ? 1 : 0"
                    />
                  </td>
                  <td v-if="isDevAdmin && currentMode === 'edit'" class="actions-cell">
                    <button 
                      @click.stop="testLevel(stage)" 
                      class="btn-icon btn-test"
                      title="Test level - Build and Boot with 1lvno patch"
                      :disabled="testingLevel || !stage.levelnumber"
                    >
                      🧪
                    </button>
                    <button 
                      @click.stop="deleteStage(stage)" 
                      class="btn-icon btn-delete"
                      title="Delete stage"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
                <tr v-if="stages.length === 0">
                  <td :colspan="isDevAdmin && currentMode === 'edit' ? 22 : 21" class="empty-message">
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

  <!-- Level Patch Test Progress Dialog -->
  <Teleport to="body">
    <div v-if="testProgressDialogOpen" class="modal-backdrop" @click.self.prevent>
      <div class="modal test-progress-modal">
        <header class="modal-header">
          <h3>🧪 Level Patch Test</h3>
        </header>
        <section class="modal-body">
          <div class="test-progress-content">
            <div class="test-progress-message" v-if="testProgressMessage">
              {{ testProgressMessage }}
            </div>
            <div v-if="testingLevel" class="loading-spinner"></div>
          </div>
        </section>
        <footer class="modal-footer">
          <button @click="testProgressDialogOpen = false; testingLevel = false" class="btn-secondary">Close</button>
        </footer>
      </div>
    </div>
  </Teleport>

  <!-- Detected Levels Dialog - Rendered outside parent modal -->
  <Teleport to="body">
    <DetectedLevelsDialog
      :isOpen="showDetectedLevelsDialog"
      :gameId="gameId"
      :gameVersion="gameVersion || null"
      :existingLevelNumbers="stages.map(s => s.levelnumber).filter(n => n) as string[]"
      @close="closeDetectedLevelsDialog"
      @levels-selected="handleDetectedLevelsSelected"
    />
  </Teleport>

  <!-- Level Patch Test Progress Dialog -->
  <Teleport to="body">
    <div v-if="testProgressDialogOpen" class="modal-backdrop" @click.self.prevent>
      <div class="modal test-progress-modal">
        <header class="modal-header">
          <h3>🧪 Level Patch Test</h3>
        </header>
        <section class="modal-body">
          <div class="test-progress-content">
            <div class="test-progress-message" v-if="testProgressMessage">
              {{ testProgressMessage }}
            </div>
            <div v-if="testingLevel" class="loading-spinner"></div>
          </div>
        </section>
        <footer class="modal-footer">
          <button @click="testProgressDialogOpen = false; testingLevel = false" class="btn-secondary">Close</button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, nextTick, Teleport } from 'vue';
import DetectedLevelsDialog from './DetectedLevelsDialog.vue';

interface GameStage {
  stage_uuid?: string;
  gameid: string;
  levelnumber?: string | null; // 3-digit hex string (000-13C)
  levelname: string;
  versions?: string;
  submapid?: string | null;
  translevel_13bf?: string | null; // Hex string
  tile_x?: string | null; // Integer string
  tile_y?: string | null; // Integer string
  tile_value?: string | null; // Internal attribute, not displayed
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
const testingLevel = ref(false);
const testProgressDialogOpen = ref(false);
const testProgressMessage = ref('');
const stages = ref<GameStage[]>([]);
const selectedStageUuid = ref<string | null>(null);
const isDevAdmin = ref(false);
const availablePatches = ref<Array<{epuuid: string, patch_code: string, name: string}>>([]);
const loadingPatches = ref(false);
const editingRequisitesForStage = ref<string | null>(null); // stage_uuid being edited
const newRequisiteTag = ref('');
const showDetectedLevelsDialog = ref(false);

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

// Validate integer input for tile_x and tile_y
function validateIntegerInput(event: Event, stage: GameStage, field: 'tile_x' | 'tile_y') {
  const target = event.target as HTMLInputElement;
  const value = target.value.trim();
  
  // Allow empty or integer string
  if (value === '') {
    stage[field] = null;
    return;
  }
  
  // Check if it's a valid integer
  if (/^\d+$/.test(value)) {
    stage[field] = value;
  } else {
    // Revert to previous value if invalid
    target.value = stage[field] || '';
  }
}

// Abbreviate patch name for dropdown display (max 20 characters)
function abbreviatePatchName(patchCode: string, patchName: string): string {
  const fullText = `${patchCode} - ${patchName}`;
  if (fullText.length <= 20) return fullText;
  
  // Try to fit code and abbreviated name
  const codePart = patchCode + ' - ';
  const availableSpace = 20 - codePart.length;
  
  if (availableSpace > 0) {
    return codePart + patchName.substring(0, availableSpace - 1) + '…';
  }
  
  // If code itself is too long, just show code
  return patchCode.length <= 20 ? patchCode : patchCode.substring(0, 19) + '…';
}

// Format levelnumber as hex string (000-13C) - normalizes and validates
function formatLevelNumberHex(levelnumber: string | null | undefined): string {
  if (!levelnumber || levelnumber.trim() === '') return '';
  // Parse hex string to number for validation
  const num = parseInt(levelnumber.trim(), 16);
  if (isNaN(num)) return '';
  // Clamp to valid range 0-0x13C (0-316 decimal)
  const clamped = Math.max(0, Math.min(0x13C, num));
  return clamped.toString(16).toUpperCase().padStart(3, '0');
}

// Validate and normalize hex string input
function normalizeHexInput(hexStr: string): string | null {
  if (!hexStr || hexStr.trim() === '') return null;
  const trimmed = hexStr.trim().toUpperCase();
  // Parse to validate
  const num = parseInt(trimmed, 16);
  if (isNaN(num)) return null;
  // Clamp to valid range 0-0x13C (0-316 decimal)
  const clamped = Math.max(0, Math.min(0x13C, num));
  return clamped.toString(16).toUpperCase().padStart(3, '0');
}

// Validate hex input (only allow 0-9, A-F, a-f, up to 3 characters)
function isValidHexInput(value: string): boolean {
  if (value === '') return true; // Allow empty
  if (value.length > 3) return false;
  return /^[0-9A-Fa-f]{0,3}$/.test(value);
}

// Handle levelnumber input - allow free typing, only validate format
function handleLevelNumberInput(event: Event, stage: GameStage) {
  const target = event.target as HTMLInputElement;
  let value = target.value.trim().toUpperCase();
  
  // Validate input format (allow empty for editing)
  if (value !== '' && !isValidHexInput(value)) {
    // Revert to previous value if invalid
    target.value = stage.levelnumber || '';
    return;
  }
  
  // Store raw input value (user can type freely)
  // Don't format/pad during typing - only on blur
  stage.levelnumber = value === '' ? null : value;
  
  // Immediately calculate and update translevel if we have a valid value
  if (value !== '') {
    const parsed = parseInt(value, 16);
    if (!isNaN(parsed)) {
      // Validate range
      const clamped = Math.max(0, Math.min(0x13C, parsed));
      if (clamped !== parsed) {
        // Value is out of range, but don't change it during typing
        // User can fix it or we'll clamp on blur
        return;
      }
      
      // Calculate translevel from current value
      stage.translevel_13bf = null;
      const newTranslevel = calculateTranslevel(stage);
      stage.translevel_13bf = newTranslevel;
    }
  } else {
    // Empty input - clear translevel
    stage.translevel_13bf = null;
  }
}

// Handle levelnumber blur - format and pad the value when user finishes editing
function handleLevelNumberBlur(event: Event, stage: GameStage) {
  const target = event.target as HTMLInputElement;
  const value = target.value.trim().toUpperCase();
  
  if (value === '') {
    // Empty - allow it, don't format
    stage.levelnumber = null;
    stage.translevel_13bf = null;
    return;
  }
  
  // Validate and normalize the value
  if (!isValidHexInput(value)) {
    // Invalid - revert to previous valid value
    target.value = formatLevelNumberHex(stage.levelnumber) || '';
    return;
  }
  
  // Normalize and pad to 3 hex digits
  const normalizedHex = normalizeHexInput(value);
  if (normalizedHex === null) {
    // Couldn't parse - revert
    target.value = formatLevelNumberHex(stage.levelnumber) || '';
    return;
  }
  
  // Update with formatted value
  stage.levelnumber = normalizedHex;
  target.value = normalizedHex;
  
  // Recalculate translevel with formatted value
  stage.translevel_13bf = null;
  const newTranslevel = calculateTranslevel(stage);
  stage.translevel_13bf = newTranslevel;
}

function calculateTranslevel(stage: GameStage): string | null {
  // Always calculate from levelnumber if available (don't use cached translevel_13bf)
  // This ensures the display updates when levelnumber changes
  if (stage.levelnumber !== null && stage.levelnumber !== undefined && stage.levelnumber !== '') {
    // Parse hex string to number
    const levelnum = parseInt(stage.levelnumber.trim(), 16);
    if (isNaN(levelnum)) return null;
    
    let translevel: number;
    if (levelnum <= 0x24) {
      // Level number <= 0x24: translevel = level number
      translevel = levelnum;
    } else if (levelnum >= 0x101) {
      // Level number >= 0x101: translevel = level number - 0xDC
      translevel = levelnum - 0xDC;
      // Ensure translevel is valid (0x25 to 0xFF)
      if (translevel < 0x25 || translevel > 0xFF) {
        // Invalid mapping, return null or use closest valid value
        return null;
      }
    } else {
      // Level numbers 0x25-0x100 are in the gap and don't map to valid translevels
      // Return null to indicate invalid mapping
      return null;
    }
    
    // Return as hex string, padded to 2 digits (translevels are 0x00-0xFF)
    return translevel.toString(16).toUpperCase().padStart(2, '0');
  }
  
  // If no levelnumber, return stored translevel if available
  if (stage.translevel_13bf !== null && stage.translevel_13bf !== undefined && stage.translevel_13bf !== '') {
    // Normalize translevel hex string (pad to 2 digits)
    const parsed = parseInt(stage.translevel_13bf.trim(), 16);
    if (isNaN(parsed)) return null;
    return parsed.toString(16).toUpperCase().padStart(2, '0');
  }
  
  return null;
}

function updateTranslevel(stage: GameStage) {
  // Always recalculate and update the stored value
  const calculated = calculateTranslevel(stage);
  stage.translevel_13bf = calculated;
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
      
      // Select initial level if provided (initialLevelNumber is expected as decimal number from AdvancedPatchModal)
      if (props.initialLevelNumber !== null && props.initialLevelNumber !== undefined) {
        // Convert decimal to hex for matching
        const initialHex = props.initialLevelNumber.toString(16).toUpperCase().padStart(3, '0');
        const matchingStage = stages.value.find(s => {
          if (!s.levelnumber) return false;
          const stageHex = formatLevelNumberHex(s.levelnumber);
          return stageHex === initialHex;
        });
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
    levelnumber: null, // Will be stored as hex string
    levelname: 'New Stage',
    versions: '*',
    submapid: null,
    translevel_13bf: null, // Will be stored as hex string
    tile_x: null,
    tile_y: null,
    tile_value: null,
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

async function testLevel(stage: GameStage) {
  if (!stage.levelnumber) {
    alert('Level number is required to test this level');
    return;
  }
  
  if (testingLevel.value) {
    return; // Already testing
  }
  
  try {
    testingLevel.value = true;
    testProgressDialogOpen.value = true;
    testProgressMessage.value = 'Preparing test build...';
    
    const api = (window as any)?.electronAPI;
    if (!api?.buildPlusPatchedGame || !api?.getAllExtraPatches) {
      testProgressMessage.value = 'Error: Test functionality not available';
      return;
    }
    
    // Get all patches to find the "1lvno" patch
    testProgressMessage.value = 'Finding 1lvno patch...';
    const patchesResult = await api.getAllExtraPatches();
    
    if (!patchesResult?.success) {
      testProgressMessage.value = `Error: Failed to load patches - ${patchesResult?.error || 'Unknown error'}`;
      return;
    }
    
    const allPatches = patchesResult.patches || [];
    const lvnoPatch = allPatches.find((p: any) => p.patch_code === '1lvno');
    
    if (!lvnoPatch) {
      testProgressMessage.value = 'Error: 1lvno patch not found. Please ensure the patch is defined in the system.';
      return;
    }
    
    // Collect patches from requisites
    const selectedPatchUuids: string[] = [lvnoPatch.epuuid]; // Always include 1lvno
    
    // Get requisite tags from stage and find matching patches
    const requisiteTags = getRequisiteTags(stage);
    if (requisiteTags.length > 0) {
      for (const tag of requisiteTags) {
        // Find patch with matching patch_code
        const matchingPatch = allPatches.find((p: any) => p.patch_code === tag);
        if (matchingPatch && !selectedPatchUuids.includes(matchingPatch.epuuid)) {
          selectedPatchUuids.push(matchingPatch.epuuid);
        }
      }
    }
    
    // Get settings for paths
    testProgressMessage.value = 'Loading settings...';
    let currentSettings: any = {};
    if (api.getSettings) {
      const settingsResult = await api.getSettings();
      if (settingsResult && typeof settingsResult === 'object') {
        currentSettings = settingsResult;
      }
    }
    
    // Prepare build parameters
    testProgressMessage.value = 'Starting build...';
    const levelHex = formatLevelNumberHex(stage.levelnumber);
    
    const buildParams = {
      gameId: props.gameId,
      gameVersion: props.gameVersion || 1,
      selectedPatches: selectedPatchUuids,
      globalParams: {
        glevelnum: levelHex,
        gonoffv: []
      },
      localParams: {},
      action: 'boot' as const,
      vanillaRomPath: currentSettings.vanillaRomPath || '',
      flipsPath: currentSettings.flipsPath || '',
      asarPath: currentSettings.asarPath || '',
    };
    
    testProgressMessage.value = `Building with level number ${levelHex}...`;
    
    const result = await api.buildPlusPatchedGame(buildParams);
    
    if (!result?.success) {
      testProgressMessage.value = `Build failed: ${result?.error || 'Unknown error'}`;
      testingLevel.value = false;
      return;
    }
    
    testProgressMessage.value = 'Build complete! Connecting to USB2SNES...';
    
    // Check USB2SNES connection and upload/boot if needed
    if (buildParams.action === 'boot' && api.usb2snesConnect && api.usb2snesUploadRom && api.usb2snesBoot) {
      // Refresh USB2SNES status first
      if (api.refreshUsb2snesStatus) {
        await api.refreshUsb2snesStatus();
      }
      
      // Check if we need to connect (we'll assume it's already connected or auto-connect)
      // For now, just try to upload and boot
      const filename = result.filename;
      const srcPath = result.outputPath;
      const dstPath = `/work/${filename}`;
      
      testProgressMessage.value = `Uploading ${filename} to USB2SNES...`;
      
      try {
        // Setup progress listener if available
        let uploadPercent = 0;
        const removeProgressListener = api.onUploadProgress?.((transferred: number, total: number, percent: number) => {
          uploadPercent = percent;
          testProgressMessage.value = `Uploading ${filename}... ${percent}%`;
        });
        
        // Upload file
        const uploadResult = await api.usb2snesUploadRom(srcPath, dstPath);
        
        if (removeProgressListener) {
          removeProgressListener();
        }
        
        if (!uploadResult?.success) {
          testProgressMessage.value = `Upload failed: ${uploadResult?.error || 'Unknown error'}`;
          testingLevel.value = false;
          return;
        }
        
        testProgressMessage.value = `Upload complete! Booting ${filename}...`;
        
        // Boot the file
        try {
          await api.usb2snesBoot(dstPath);
          testProgressMessage.value = `✓ Test complete! Level ${levelHex} - ${stage.levelname} is now running on SNES`;
        } catch (bootError: any) {
          testProgressMessage.value = `Uploaded but boot failed: ${bootError?.message || String(bootError)}`;
          testingLevel.value = false;
          return;
        }
        
      } catch (uploadError: any) {
        testProgressMessage.value = `Upload failed: ${uploadError?.message || String(uploadError)}`;
        testingLevel.value = false;
        return;
      }
    } else {
      // Just report build success
      testProgressMessage.value = `✓ Build complete! Level ${levelHex} - ${stage.levelname}`;
    }
    
    // Close dialog after a delay
    setTimeout(() => {
      testProgressDialogOpen.value = false;
      testingLevel.value = false;
      testProgressMessage.value = '';
    }, 3000);
    
  } catch (error: any) {
    console.error('Error testing level:', error);
    testProgressMessage.value = `Error: ${error?.message || String(error)}`;
    testingLevel.value = false;
  }
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
  
  const levelHex = formatLevelNumberHex(stage.levelnumber);
  if (!confirm(`Are you sure you want to delete stage "${stage.levelname}" (Level ${levelHex})?`)) {
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
        tile_x: stage.tile_x || null,
        tile_y: stage.tile_y || null,
        tile_value: stage.tile_value || null,
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

function openDetectedLevelsDialog() {
  showDetectedLevelsDialog.value = true;
}

function closeDetectedLevelsDialog() {
  showDetectedLevelsDialog.value = false;
}

function handleDetectedLevelsSelected(selectedLevels: any[]) {
  // Add selected detected levels as new stages
  for (const level of selectedLevels) {
    const newStage: GameStage = {
      stage_uuid: undefined,
      gameid: props.gameId,
      levelnumber: level.levelnumber || null,
      levelname: level.levelname || 'New Stage',
      versions: '*',
      submapid: level.submapid || null,
      translevel_13bf: level.translevel || null,
      tile_x: level.tile_x || null,
      tile_y: level.tile_y || null,
      tile_value: level.tile_value || null,
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
  showDetectedLevelsDialog.value = false;
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
    // Convert decimal to hex for matching
    const initialHex = props.initialLevelNumber.toString(16).toUpperCase().padStart(3, '0');
    const matchingStage = stages.value.find(s => {
      if (!s.levelnumber) return false;
      const stageHex = formatLevelNumberHex(s.levelnumber);
      return stageHex === initialHex;
    });
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
  cursor: help;
}

/* Background colors for checkbox columns */
.stages-table th.col-playable,
.stages-table td.col-playable {
  background-color: rgba(76, 175, 80, 0.2); /* Light green */
}

.stages-table th.col-rando,
.stages-table td.col-rando {
  background-color: rgba(156, 39, 176, 0.2); /* Light purple */
}

.stages-table th.col-mainexit,
.stages-table td.col-mainexit {
  background-color: rgba(33, 150, 243, 0.2); /* Light blue */
}

.stages-table th.col-keyhole,
.stages-table td.col-keyhole {
  background-color: rgba(255, 152, 0, 0.2); /* Light orange */
}

.stages-table th.col-credits,
.stages-table td.col-credits {
  background-color: rgba(255, 193, 7, 0.2); /* Light yellow */
}

.stages-table th.col-ghouse,
.stages-table td.col-ghouse {
  background-color: rgba(158, 158, 158, 0.2); /* Light gray */
}

.stages-table th.col-spalace,
.stages-table td.col-spalace {
  background-color: rgba(0, 188, 212, 0.2); /* Light cyan */
}

.stages-table th.col-castle,
.stages-table td.col-castle {
  background-color: rgba(121, 85, 72, 0.2); /* Light brown */
}

.stages-table th.col-boss,
.stages-table td.col-boss {
  background-color: rgba(244, 67, 54, 0.2); /* Light red */
}

.stages-table th.col-secret,
.stages-table td.col-secret {
  background-color: rgba(63, 81, 181, 0.2); /* Light indigo */
}

.stages-table th.col-final,
.stages-table td.col-final {
  background-color: rgba(233, 30, 99, 0.2); /* Light pink */
}

/* Brighten table cells when checkbox is checked */
.stages-table td.col-playable:has(input[type="checkbox"]:checked) {
  background-color: rgba(76, 175, 80, 0.4) !important;
  filter: brightness(1.2);
}

.stages-table td.col-rando:has(input[type="checkbox"]:checked) {
  background-color: rgba(156, 39, 176, 0.4) !important;
  filter: brightness(1.2);
}

.stages-table td.col-mainexit:has(input[type="checkbox"]:checked) {
  background-color: rgba(33, 150, 243, 0.4) !important;
  filter: brightness(1.2);
}

.stages-table td.col-keyhole:has(input[type="checkbox"]:checked) {
  background-color: rgba(255, 152, 0, 0.4) !important;
  filter: brightness(1.2);
}

.stages-table td.col-credits:has(input[type="checkbox"]:checked) {
  background-color: rgba(255, 193, 7, 0.4) !important;
  filter: brightness(1.2);
}

.stages-table td.col-ghouse:has(input[type="checkbox"]:checked) {
  background-color: rgba(158, 158, 158, 0.4) !important;
  filter: brightness(1.2);
}

.stages-table td.col-spalace:has(input[type="checkbox"]:checked) {
  background-color: rgba(0, 188, 212, 0.4) !important;
  filter: brightness(1.2);
}

.stages-table td.col-castle:has(input[type="checkbox"]:checked) {
  background-color: rgba(121, 85, 72, 0.4) !important;
  filter: brightness(1.2);
}

.stages-table td.col-boss:has(input[type="checkbox"]:checked) {
  background-color: rgba(244, 67, 54, 0.4) !important;
  filter: brightness(1.2);
}

.stages-table td.col-secret:has(input[type="checkbox"]:checked) {
  background-color: rgba(63, 81, 181, 0.4) !important;
  filter: brightness(1.2);
}

.stages-table td.col-final:has(input[type="checkbox"]:checked) {
  background-color: rgba(233, 30, 99, 0.4) !important;
  filter: brightness(1.2);
}

/* Secret level rows - hide data when not in edit mode */
.stages-table tr.secret-level td:not(.col-secret) {
  color: var(--text-disabled, #999);
}

.stages-table tr.secret-level:hover td {
  background-color: var(--bg-hover);
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

/* Improve checkbox visibility across all themes */
.stages-table input[type="checkbox"] {
  width: 20px;
  height: 20px;
  min-width: 20px;
  min-height: 20px;
  cursor: pointer;
  /* Use accent-color for modern browsers - ensures checkmark is visible */
  accent-color: var(--accent-primary, #4CAF50);
  /* Dark background for unchecked state ensures visibility */
  background-color: var(--bg-secondary, #f5f5f5);
  border: 2px solid var(--border-primary, #ccc);
  border-radius: 4px;
  /* Make checkmark larger and bolder */
  appearance: checkbox;
  -webkit-appearance: checkbox;
  /* Increase checkmark size */
  transform: scale(1.1);
}

/* Enhanced visibility for checked checkboxes - use high contrast colors */
.stages-table input[type="checkbox"]:checked {
  /* Use accent color with high contrast */
  accent-color: var(--accent-primary, #4CAF50);
  background-color: var(--accent-primary, #4CAF50);
  border-color: var(--accent-primary, #4CAF50);
  /* Add a subtle shadow to make checked state stand out */
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2), inset 0 1px 2px rgba(255, 255, 255, 0.3);
}

/* Ensure checkmark is visible - use filter to increase contrast */
.stages-table input[type="checkbox"]:checked {
  filter: contrast(1.2) brightness(0.95);
}

/* Disabled checkbox styling - still visible */
.stages-table input[type="checkbox"]:disabled {
  opacity: 0.7;
  cursor: not-allowed;
  filter: grayscale(0.3);
}

/* Disabled checked checkbox - ensure checkmark is still visible */
.stages-table input[type="checkbox"]:disabled:checked {
  opacity: 0.8;
  filter: contrast(1.3) brightness(0.9);
}

/* Hover state for enabled checkboxes */
.stages-table input[type="checkbox"]:not(:disabled):hover {
  border-color: var(--accent-primary, #4CAF50);
  box-shadow: 0 0 0 3px rgba(76, 175, 80, 0.15);
  transform: scale(1.15);
}

/* Focus state for accessibility */
.stages-table input[type="checkbox"]:focus {
  outline: 2px solid var(--accent-primary, #4CAF50);
  outline-offset: 2px;
}

.readonly-cell {
  color: var(--text-tertiary);
  font-family: monospace;
}

.actions-cell {
  white-space: nowrap;
  display: flex;
  gap: 8px;
  justify-content: center;
  align-items: center;
}

.btn-icon {
  width: 28px;
  height: 28px;
  padding: 0;
  border: 1px solid var(--border-primary);
  border-radius: 4px;
  background: var(--bg-primary);
  color: var(--text-primary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  transition: all 0.2s;
}

.btn-icon:hover:not(:disabled) {
  background: var(--bg-hover);
  border-color: var(--border-hover);
  transform: scale(1.1);
}

.btn-icon:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-test {
  background: var(--bg-primary);
  border-color: var(--accent-primary, #4CAF50);
}

.btn-test:hover:not(:disabled) {
  background: var(--accent-primary, #4CAF50);
  color: white;
}

.btn-delete {
  background: var(--bg-primary);
  border-color: #f44336;
  color: #f44336;
}

.btn-delete:hover:not(:disabled) {
  background: #f44336;
  color: white;
}

/* Test Progress Dialog */
.test-progress-modal {
  max-width: 400px;
}

.test-progress-content {
  padding: 20px;
  text-align: center;
}

.test-progress-message {
  font-size: var(--base-font-size);
  color: var(--text-primary);
  margin-bottom: 16px;
  min-height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.loading-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid var(--border-primary);
  border-top-color: var(--accent-primary, #4CAF50);
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin: 0 auto;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
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

.input-small[type="text"] {
  font-family: monospace;
  text-transform: uppercase;
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

.tag-input {
  width: 100%;
  padding: 4px 6px;
  font-size: var(--small-font-size);
  font-family: monospace;
  border: 1px solid var(--border-primary);
  border-radius: 3px;
  background: var(--bg-primary);
  color: var(--text-primary);
  min-width: 80px;
  margin-bottom: 4px;
}

.tag-select {
  width: 100%;
  max-width: 200px;
  padding: 4px 6px;
  font-size: var(--small-font-size);
  border: 1px solid var(--border-primary);
  border-radius: 3px;
  background: var(--bg-primary);
  color: var(--text-primary);
  cursor: pointer;
}
</style>

