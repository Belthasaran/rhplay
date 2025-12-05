<template>
  <div v-if="isOpen" class="modal-backdrop" @click.self="close">
    <div class="modal large-modal game-stages-dialog">
      <header class="modal-header">
        <h3>{{ dialogTitle }}</h3>
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

          <!-- Action Buttons (Author mode only) -->
          <div v-if="canEdit" class="action-buttons">
            <button @click="addNewStage" class="btn-primary btn-small">+ New Stage</button>
            <button @click="openDetectedLevelsDialog" class="btn-secondary btn-small">Detected Levels</button>
            <button @click="openSetPlaylevelPatchDialog" class="btn-secondary btn-small">Set Playlevel Patch</button>
            <button @click="exportStagesToCSV" class="btn-secondary btn-small">CSV: Export</button>
            <button @click="importStagesFromCSV" class="btn-secondary btn-small">CSV: Import</button>
          </div>

          <!-- Stages Table -->
          <div class="stages-table-wrapper" ref="stagesTableWrapper">
            <table class="stages-table">
              <thead>
                <tr>
                  <th v-if="currentMode === 'select'" class="checkbox-cell">
                    <input 
                      type="checkbox" 
                      :checked="allStagesSelected"
                      :indeterminate="someStagesSelected && !allStagesSelected"
                      @change="toggleSelectAllStages"
                      title="Select/Deselect all stages"
                    />
                  </th>
                  <th>Lev#</th>
                  <th>L.Name</th>
                  <th>Trans</th>
                  <th>Sub</th>
                  <th>X</th>
                  <th>Y</th>
                  <th>Req</th>
                  <th>LvlPat</th>
                  <th>Excl</th>
                  <th>Diff</th>
                  <th class="col-playable" title="Playable level (Excludes cusscenes, Invalid, or Auto win/lose levels)">P</th>
                  <th class="col-rando" title="Rando level (Playable levels suitable for use in randomizers)">R</th>
                  <th class="col-mainexit" title="Levels with a main exit (Primary exit used in overworld)">M</th>
                  <th class="col-keyhole" title="Levels with a keydoor exit used in overworld">K</th>
                  <th class="col-credits" title="Credits level (Level used to show in-game credits)">C</th>
                  <th class="col-water" title="Water Level">W</th>
                  <th class="col-ghouse" title="Ghost House Level">G</th>
                  <th class="col-spalace" title="Switch Palace Level">S</th>
                  <th class="col-castle" title="Castle Level">Ca</th>
                  <th class="col-boss" title="Level goes straight to a boss">Bo</th>
                  <th class="col-secret" title="Secret level">Se</th>
                  <th>T</th>
                  <th class="col-final" title="Final level. This generally designates the last level of a game.">F</th>
                  <th class="col-lock" title="Lock - Level only accessible in Edit mode">L</th>
                  <th v-if="canEdit || currentMode === 'select'">Actions</th>
                </tr>
              </thead>
              <tbody>
                <tr 
                  v-for="stage in filteredStages" 
                  :key="stage.stage_uuid"
                  :class="{ 
                    'selected': selectedStageUuid === stage.stage_uuid,
                    'secret-level': stage.secret === 1 && currentMode !== 'edit',
                    'locked-level': stage.lock === 1 && currentMode !== 'edit'
                  }"
                  @click="selectStage(stage)"
                >
                  <td v-if="currentMode === 'select'" class="checkbox-cell" @click.stop>
                    <input 
                      type="checkbox" 
                      :checked="selectedStageUuids.has(stage.stage_uuid || '')"
                      :disabled="stage.lock === 1 && currentMode !== 'edit'"
                      @change.stop="toggleStageSelection(stage)"
                      @click.stop
                    />
                  </td>
                  <td>
                    <input 
                      v-if="canEdit"
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
                      v-if="canEdit"
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
                      v-if="canEdit"
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
                      v-if="canEdit"
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
                      v-if="canEdit"
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
                    <div v-if="canEdit" class="requisites-tag-selector">
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
                  <td class="playlevel-patch-cell">
                    <span v-if="stage.secret !== 1 || currentMode === 'edit'">{{ getActivePlaylevelPatch(stage) }}</span>
                    <span v-else>-</span>
                  </td>
                  <td>
                    <div v-if="canEdit" class="excluded-patchcodes-tag-selector">
                      <div class="selected-tags" v-if="getExcludedPatchCodes(stage).length > 0">
                        <span 
                          v-for="code in getExcludedPatchCodes(stage)" 
                          :key="code"
                          class="tag-badge excluded-tag"
                        >
                          {{ code }}
                          <button @click.stop="removeExcludedPatchCode(stage, code)" class="tag-remove">×</button>
                        </span>
                      </div>
                      <input 
                        v-model="newExcludedPatchCode"
                        type="text"
                        class="tag-input"
                        placeholder="Type patch code or tag..."
                        @keydown.enter.prevent="addExcludedPatchCode(stage)"
                        @focus="editingExcludedForStage = stage.stage_uuid"
                        @blur="setTimeout(() => editingExcludedForStage = null, 200)"
                      />
                      <select 
                        v-if="availablePatches.length > 0"
                        @change="if ($event.target.value) { newExcludedPatchCode = $event.target.value; addExcludedPatchCode(stage); $event.target.value = ''; }"
                        class="tag-select"
                      >
                        <option value="">Add patch...</option>
                        <option 
                          v-for="patch in availablePatches" 
                          :key="patch.epuuid"
                          :value="patch.patch_code"
                          :disabled="getExcludedPatchCodes(stage).includes(patch.patch_code)"
                          :title="patch.patch_code + ' - ' + patch.name"
                        >
                          {{ abbreviatePatchName(patch.patch_code, patch.name) }}
                        </option>
                      </select>
                    </div>
                    <span v-else-if="stage.secret !== 1 || currentMode === 'edit'">{{ formatExcludedPatchCodes(stage.excluded_patchcodes) || '-' }}</span>
                    <span v-else>-</span>
                  </td>
                  <td>
                    <input 
                      v-if="canEdit"
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
                      :disabled="!canEdit"
                      @change="stage.playable = $event.target.checked ? 1 : 0"
                    />
                  </td>
                  <td class="checkbox-cell col-rando">
                    <input 
                      type="checkbox" 
                      :checked="stage.rando === 1"
                      :disabled="!canEdit"
                      @change="stage.rando = $event.target.checked ? 1 : 0"
                    />
                  </td>
                  <td class="checkbox-cell col-mainexit">
                    <input 
                      type="checkbox" 
                      :checked="stage.mainexit === 1"
                      :disabled="!canEdit"
                      @change="stage.mainexit = $event.target.checked ? 1 : 0"
                    />
                  </td>
                  <td class="checkbox-cell col-keyhole">
                    <input 
                      type="checkbox" 
                      :checked="stage.keyhole === 1"
                      :disabled="!canEdit"
                      @change="stage.keyhole = $event.target.checked ? 1 : 0"
                    />
                  </td>
                  <td class="checkbox-cell col-credits">
                    <input 
                      type="checkbox" 
                      :checked="stage.credits === 1"
                      :disabled="!canEdit"
                      @change="stage.credits = $event.target.checked ? 1 : 0"
                    />
                  </td>
                  <td class="checkbox-cell col-water">
                    <input 
                      type="checkbox" 
                      :checked="stage.water === 1"
                      :disabled="!canEdit"
                      @change="stage.water = $event.target.checked ? 1 : 0"
                    />
                  </td>
                  <td class="checkbox-cell col-ghouse">
                    <input 
                      type="checkbox" 
                      :checked="stage.ghouse === 1"
                      :disabled="!canEdit"
                      @change="stage.ghouse = $event.target.checked ? 1 : 0"
                    />
                  </td>
                  <td class="checkbox-cell col-spalace">
                    <input 
                      type="checkbox" 
                      :checked="stage.spalace === 1"
                      :disabled="!canEdit"
                      @change="stage.spalace = $event.target.checked ? 1 : 0"
                    />
                  </td>
                  <td class="checkbox-cell col-castle">
                    <input 
                      type="checkbox" 
                      :checked="stage.castle === 1"
                      :disabled="!canEdit"
                      @change="stage.castle = $event.target.checked ? 1 : 0"
                    />
                  </td>
                  <td class="checkbox-cell col-boss">
                    <input 
                      type="checkbox" 
                      :checked="stage.boss === 1"
                      :disabled="!canEdit"
                      @change="stage.boss = $event.target.checked ? 1 : 0"
                    />
                  </td>
                  <td class="checkbox-cell col-secret">
                    <input 
                      type="checkbox" 
                      :checked="stage.secret === 1"
                      :disabled="!canEdit"
                      @change="stage.secret = $event.target.checked ? 1 : 0"
                    />
                  </td>
                  <td class="checkbox-cell">
                    <input 
                      type="checkbox" 
                      :checked="stage.troll === 1"
                      :disabled="!canEdit"
                      @change="stage.troll = $event.target.checked ? 1 : 0"
                    />
                  </td>
                  <td class="checkbox-cell col-final">
                    <input 
                      type="checkbox" 
                      :checked="stage.final === 1"
                      :disabled="!canEdit"
                      @change="stage.final = $event.target.checked ? 1 : 0"
                    />
                  </td>
                  <td class="checkbox-cell col-lock">
                    <input 
                      type="checkbox" 
                      :checked="stage.lock === 1"
                      :disabled="!canEdit"
                      @change="stage.lock = $event.target.checked ? 1 : 0"
                    />
                  </td>
                  <td v-if="canEdit || (currentMode === 'select' && canTestStage(stage))" class="actions-cell">
                    <button 
                      v-if="canEdit || (currentMode === 'select' && canTestStage(stage))"
                      @click.stop="testLevel(stage)" 
                      class="btn-icon btn-test"
                      title="Test level - Build and Boot with 2lvno patch"
                      :disabled="testingLevel || !stage.levelnumber || !canTestStage(stage)"
                    >
                      🧪
                    </button>
                    <button 
                      @click.stop="openExtraDescriptionDialog(stage)" 
                      class="btn-icon btn-memo"
                      title="Edit/View Extra Description"
                    >
                      📝
                    </button>
                    <button 
                      @click.stop="openTagsDialog(stage)" 
                      class="btn-icon btn-tags"
                      title="Edit/View Stage Tags"
                    >
                      🏷️
                    </button>
                    <button 
                      v-if="canEdit"
                      @click.stop="deleteStage(stage)" 
                      class="btn-icon btn-delete"
                      title="Delete stage"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
                <tr v-if="stages.length === 0">
                  <td :colspan="canEdit ? 22 : 21" class="empty-message">
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
            v-if="canEdit" 
            @click="saveAll" 
            class="btn-primary"
            :disabled="saving"
          >
            {{ saving ? 'Saving...' : 'Save All' }}
          </button>
          <button 
            v-if="currentMode === 'select' && props.showAddToRunButton" 
            @click="addStagesToRun" 
            class="btn-primary"
            :disabled="selectedStageUuids.size === 0"
          >
            {{ selectedStageUuids.size === 1 ? 'Add Stage to Run' : `Add Stages to Run (${selectedStageUuids.size})` }}
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
          <button @click="close" class="btn-secondary">{{ canEdit ? 'Cancel' : 'Close' }}</button>
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

  <!-- Set Playlevel Patch Dialog -->
  <Teleport to="body">
    <div v-if="showSetPlaylevelPatchDialog" class="modal-backdrop" @click.self="closeSetPlaylevelPatchDialog" style="z-index: 25000;">
      <div class="modal" style="max-width: 600px; width: 90%;">
        <header class="modal-header">
          <h3>Set Playlevel Patch</h3>
          <button class="close" @click="closeSetPlaylevelPatchDialog">✕</button>
        </header>
        <section class="modal-body">
          <div class="modal-field">
            <label>Patch Code:</label>
            <input 
              v-model="newPlaylevelPatchCode" 
              type="text"
              class="modal-input"
              placeholder="2lvno"
              list="playlevel-patch-list"
            />
            <datalist id="playlevel-patch-list">
              <option v-for="patch in playlevelPatches" :key="patch.epuuid" :value="patch.patch_code">
                {{ patch.patch_code }} - {{ patch.name }}
              </option>
            </datalist>
            <p class="field-hint">Enter the patch code to use for level selection/testing. Default is "2lvno".</p>
          </div>

          <div class="modal-field">
            <label>Apply to:</label>
            <div class="selection-controls">
              <button @click="selectAllStagesForPlaylevelPatch" class="btn-small btn-secondary">Select All</button>
              <button @click="deselectAllStagesForPlaylevelPatch" class="btn-small btn-secondary">Deselect All</button>
            </div>
            <div class="stages-selection-list">
              <div 
                v-for="(stage, index) in stages" 
                :key="getStageIdentifier(stage, index)"
                class="stage-selection-item"
              >
                <label>
                  <input 
                    type="checkbox"
                    :checked="selectedStagesForPlaylevelPatch.has(getStageIdentifier(stage, index))"
                    @change="toggleStageForPlaylevelPatch(stage, index)"
                  />
                  <span class="stage-selection-label">
                    {{ formatLevelNumberHex(stage.levelnumber) || '?' }} - {{ stage.levelname }}
                    <span class="current-patch-hint">(current: {{ getActivePlaylevelPatch(stage) }})</span>
                  </span>
                </label>
              </div>
            </div>
            <p class="field-hint">
              Selected: {{ selectedStagesForPlaylevelPatch.size }} of {{ stages.length }} stages
            </p>
          </div>
        </section>
        <footer class="modal-footer">
          <button @click="applyPlaylevelPatch" class="btn-primary" :disabled="selectedStagesForPlaylevelPatch.size === 0 || !newPlaylevelPatchCode.trim()">
            Apply
          </button>
          <button @click="closeSetPlaylevelPatchDialog" class="btn-secondary">Cancel</button>
        </footer>
      </div>
    </div>
  </Teleport>

  <!-- Extra Description Dialog -->
  <Teleport to="body">
    <div v-if="showExtraDescriptionDialog" class="modal-backdrop" @click.self="closeExtraDescriptionDialog" style="z-index: 25000;">
      <div class="modal" style="max-width: 600px; width: 90%;">
        <header class="modal-header">
          <h3>Extra Description - {{ editingExtraDescriptionStage?.levelname || 'Stage' }}</h3>
          <button class="close" @click="closeExtraDescriptionDialog">✕</button>
        </header>
        <section class="modal-body">
          <div class="field">
            <label>Extra Description</label>
            <textarea 
              v-model="editingExtraDescriptionText" 
              class="textarea" 
              rows="8" 
              placeholder="Enter optional free-form description for this stage..."
              :readonly="!canEdit"
            />
            <div class="hint" v-if="!canEdit">
              This field is read-only in view mode. Switch to edit mode to modify.
            </div>
          </div>
        </section>
        <footer class="modal-footer">
          <button 
            v-if="canEdit"
            @click="saveExtraDescription" 
            class="btn-primary"
          >
            Save
          </button>
          <button @click="closeExtraDescriptionDialog" class="btn-secondary">Close</button>
        </footer>
      </div>
    </div>
  </Teleport>

  <!-- Tags Dialog -->
  <Teleport to="body">
    <div v-if="showTagsDialog" class="modal-backdrop" @click.self="closeTagsDialog" style="z-index: 25000;">
      <div class="modal" style="max-width: 600px; width: 90%;">
        <header class="modal-header">
          <h3>Stage Tags - {{ editingTagsStage?.levelname || 'Stage' }}</h3>
          <button class="close" @click="closeTagsDialog">✕</button>
        </header>
        <section class="modal-body">
          <div class="field">
            <label>Tags (comma-separated)</label>
            <input 
              v-model="editingTagsText" 
              type="text"
              class="input" 
              placeholder="e.g., cape, autoscroller"
              :readonly="!canEdit"
            />
            <div class="hint">
              Enter comma-separated tags for this stage (e.g., "cape", "autoscroller", "cape,autoscroller").
              Tags are case-sensitive and should be lowercase for consistency.
            </div>
            <div class="hint" v-if="!canEdit" style="color: var(--text-secondary); margin-top: 8px;">
              This field is read-only in view mode. Switch to edit mode to modify.
            </div>
          </div>
        </section>
        <footer class="modal-footer">
          <button 
            v-if="canEdit"
            @click="saveTags" 
            class="btn-primary"
          >
            Save
          </button>
          <button @click="closeTagsDialog" class="btn-secondary">Close</button>
        </footer>
      </div>
    </div>
  </Teleport>

  <!-- CSV Import Dialog -->
  <Teleport to="body">
    <div v-if="showCSVImportDialog" class="modal-backdrop csv-import-backdrop" @click.self="closeCSVImportDialog" style="z-index: 25000;">
      <div class="modal large-modal csv-import-modal">
        <header class="modal-header">
          <h3>Import Stages from CSV - {{ gameId }}</h3>
          <button class="close" @click="closeCSVImportDialog">✕</button>
        </header>
        <section class="modal-body">
          <div v-if="csvImportLoading" class="loading-message">Loading CSV file...</div>
          
          <template v-else-if="csvImportStages.length > 0">
            <!-- Import Options -->
            <div class="csv-import-options">
              <div class="option-group">
                <label>
                  <input 
                    type="checkbox" 
                    v-model="csvImportOptions.unselectExisting"
                    @change="updateCSVImportSelection"
                  />
                  Unselect Stages whose stage id is already in use
                </label>
              </div>
              
              <div class="option-group">
                <label><strong>Duplicates:</strong></label>
                <div class="radio-group">
                  <label>
                    <input 
                      type="radio" 
                      v-model="csvImportOptions.duplicateMode" 
                      value="update"
                      @change="updateCSVImportSelection"
                    />
                    Option 1 (default): If stage levelnumber already exists for this gameid, update its data to match the row from the CSV
                  </label>
                  <label>
                    <input 
                      type="radio" 
                      v-model="csvImportOptions.duplicateMode" 
                      value="import"
                      @change="updateCSVImportSelection"
                    />
                    Option 2: Import with Duplicates (may create temporary duplicates)
                  </label>
                </div>
              </div>
              
              <div class="option-group">
                <label>
                  <input 
                    type="checkbox" 
                    v-model="csvImportOptions.includeUuid"
                  />
                  Include UUID: Process stage_uuid from CSV when updating a duplicate record
                </label>
                <label>
                  <input 
                    type="checkbox" 
                    v-model="csvImportOptions.ignoreUuid"
                  />
                  Ignore UUID: Generate new UUIDs as required during import (keep existing UUID if updating)
                </label>
              </div>
            </div>

            <!-- CSV Stages Table -->
            <div class="table-wrapper">
              <table class="csv-import-table">
                <thead>
                  <tr>
                    <th class="checkbox-cell">
                      <input 
                        type="checkbox" 
                        :checked="allCSVStagesSelected"
                        :indeterminate="someCSVStagesSelected"
                        @change="toggleSelectAllCSVStages"
                        title="Select/Deselect all visible stages"
                      />
                    </th>
                    <th>Lev#</th>
                    <th>L.Name</th>
                    <th>Status</th>
                    <th>Trans</th>
                    <th>Sub</th>
                    <th>X</th>
                    <th>Y</th>
                    <th>Diff</th>
                    <th>P</th>
                    <th>R</th>
                  </tr>
                </thead>
                <tbody>
                  <tr 
                    v-for="stage in csvImportStages" 
                    :key="stage._rowIndex"
                    :class="{
                      'locked': stage._isLocked,
                      'exists': stage._exists && !stage._isLocked,
                      'new': !stage._exists
                    }"
                    @click="!stage._isLocked && toggleCSVStageSelection(stage)"
                  >
                    <td class="checkbox-cell">
                      <input 
                        type="checkbox" 
                        :checked="selectedCSVStages.has(stage._rowIndex)"
                        :disabled="stage._isLocked"
                        @change.stop="!stage._isLocked && toggleCSVStageSelection(stage)"
                      />
                    </td>
                    <td class="monospace">{{ stage.levelnumber || '-' }}</td>
                    <td>{{ stage.levelname || '-' }}</td>
                    <td>
                      <span v-if="stage._isLocked" class="status-badge locked-badge">Locked</span>
                      <span v-else-if="stage._exists" class="status-badge exists-badge">Exists</span>
                      <span v-else class="status-badge new-badge">New</span>
                    </td>
                    <td class="monospace">{{ stage.translevel_13bf || '-' }}</td>
                    <td class="monospace">{{ stage.submapid || '-' }}</td>
                    <td class="monospace">{{ stage.tile_x || '-' }}</td>
                    <td class="monospace">{{ stage.tile_y || '-' }}</td>
                    <td>{{ stage.difficulty ?? '-' }}</td>
                    <td>{{ stage.playable ?? 0 }}</td>
                    <td>{{ stage.rando ?? 0 }}</td>
                  </tr>
                  <tr v-if="csvImportStages.length === 0">
                    <td :colspan="11" class="empty-message">No stages found in CSV</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </template>
          
          <div v-else-if="!csvImportLoading" class="empty-message">
            No stages loaded. Please select a CSV file to import.
          </div>
        </section>
        <footer class="modal-footer">
          <button 
            @click="addSelectedCSVStages" 
            class="btn-primary"
            :disabled="selectedCSVStages.size === 0"
          >
            Add Selected ({{ selectedCSVStages.size }})
          </button>
          <button @click="closeCSVImportDialog" class="btn-secondary">Cancel</button>
        </footer>
      </div>
    </div>
  </Teleport>

  <!-- Toast Notification - Teleported outside modal, always rendered -->
  <Teleport to="body">
    <ToastNotification ref="toastNotificationRef" />
  </Teleport>

  <!-- Custom Modal Dialogs -->
  <Teleport to="body">
    <AlertDialog
      :visible="alertDialogVisible"
      :title="alertDialogTitle"
      :message="alertDialogMessage"
      @confirm="handleAlertConfirm"
      @cancel="handleAlertCancel"
    />
    <ConfirmDialog
      :visible="confirmDialogVisible"
      :title="confirmDialogTitle"
      :message="confirmDialogMessage"
      :confirm-text="confirmDialogConfirmText"
      :cancel-text="confirmDialogCancelText"
      @confirm="handleConfirmConfirm"
      @cancel="handleConfirmCancel"
    />
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, nextTick, Teleport } from 'vue';
import Papa from 'papaparse';
import DetectedLevelsDialog from './DetectedLevelsDialog.vue';
import ToastNotification from './ToastNotification.vue';
import AlertDialog from './AlertDialog.vue';
import ConfirmDialog from './ConfirmDialog.vue';
import {
  showAlert,
  showConfirm,
  alertDialogVisible,
  alertDialogTitle,
  alertDialogMessage,
  handleAlertConfirm,
  handleAlertCancel,
  confirmDialogVisible,
  confirmDialogTitle,
  confirmDialogMessage,
  confirmDialogConfirmText,
  confirmDialogCancelText,
  handleConfirmConfirm,
  handleConfirmCancel,
} from '@/utils/dialogs';

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
  water: number;
  ghouse: number;
  spalace: number;
  castle: number;
  boss: number;
  secret: number;
  troll: number;
  final: number;
  lock?: number; // Lock flag - level only accessible in Edit mode
  playlevel_patch_code?: string | null; // Playlevel patch code (defaults to '2lvno')
  excluded_patchcodes?: string | null; // JSON array of patch codes or declarative tags to exclude
  extradescription?: string | null; // Optional free-form description
  stagetags?: string | null; // Comma-separated list of arbitrary tags (e.g., "cape", "autoscroller")
}

interface Props {
  isOpen: boolean;
  gameId: string;
  gameName?: string;
  gameVersion?: number | null;
  mode?: 'select' | 'edit'; // 'select' for selecting a level, 'edit' for editing stages
  initialLevelNumber?: string | null; // For selecting a specific level when opening (hex string)
  showAddToRunButton?: boolean;  // Show "Add Stage to Run" button in footer
  forceAuthorMode?: boolean; // Force author/edit mode even without DEVADMIN (e.g., when editing from submission draft)
  draftStages?: GameStage[] | null; // Draft stages for submission authoring (when forceAuthorMode is true, stages come from here instead of database)
}

const props = withDefaults(defineProps<Props>(), {
  gameVersion: null,
  mode: 'select',
  initialLevelNumber: null,
  showAddToRunButton: false,
  forceAuthorMode: false,
  draftStages: null,
});

// Make mode reactive so we can switch it
const currentMode = ref<'select' | 'edit'>(props.mode || 'select');

// Computed property to determine if we should allow editing
// Allow editing if: DEVADMIN is enabled OR forceAuthorMode is true AND mode is edit
const canEdit = computed(() => {
  return (isDevAdmin.value || props.forceAuthorMode) && currentMode.value === 'edit';
});

// Computed property for dialog title that shows the current mode
const dialogTitle = computed(() => {
  if (currentMode.value === 'select') {
    return 'Select Game Stage';
  }
  if (canEdit.value) {
    if (props.forceAuthorMode) {
      return 'Edit Game Stages (Submission Draft Mode)';
    } else if (isDevAdmin.value) {
      return 'Edit Game Stages (Database Admin Mode)';
    }
    return 'Edit Game Stages';
  }
  return 'Game Stages';
});

const emit = defineEmits<{
  close: [];
  select: [stage: GameStage];
  saved: [];
  'add-to-run': [stage: GameStage];
  'draft-stages-saved': [stages: GameStage[]]; // Emit draft stages when saving in submission author mode
}>();

const loading = ref(false);
const saving = ref(false);
const testingLevel = ref(false);
const stagesTableWrapper = ref<HTMLElement | null>(null);
const savedScrollPosition = ref<number>(0);
const testProgressDialogOpen = ref(false);
const testProgressMessage = ref('');
const stages = ref<GameStage[]>([]);
const selectedStageUuid = ref<string | null>(null);
const selectedStageUuids = ref<Set<string>>(new Set()); // Multiple selected stages for "Add to Run"
const isDevAdmin = ref(false);
const availablePatches = ref<Array<{epuuid: string, patch_code: string, name: string, is_playlevel?: number}>>([]);
const playlevelPatches = ref<Array<{epuuid: string, patch_code: string, name: string}>>([]);
const loadingPatches = ref(false);
const editingRequisitesForStage = ref<string | null>(null); // stage_uuid being edited
const newRequisiteTag = ref('');
const editingExcludedForStage = ref<string | null>(null); // stage_uuid being edited
const newExcludedPatchCode = ref('');
const showDetectedLevelsDialog = ref(false);
const showSetPlaylevelPatchDialog = ref(false);
const selectedStagesForPlaylevelPatch = ref<Set<string>>(new Set()); // stage identifier (stage_uuid or index-based key)
const newPlaylevelPatchCode = ref('2lvno');
const showExtraDescriptionDialog = ref(false);
const editingExtraDescriptionStage = ref<GameStage | null>(null);
const editingExtraDescriptionText = ref<string>('');

const showTagsDialog = ref(false);
const editingTagsStage = ref<GameStage | null>(null);
const editingTagsText = ref<string>('');

// CSV Import state
const showCSVImportDialog = ref(false);
const csvImportLoading = ref(false);
const csvImportStages = ref<any[]>([]);
const selectedCSVStages = ref<Set<number>>(new Set());
const csvImportOptions = ref({
  unselectExisting: false,
  duplicateMode: 'update' as 'update' | 'import',
  includeUuid: false,
  ignoreUuid: true
});

const toastNotificationRef = ref<InstanceType<typeof ToastNotification> | null>(null);

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

// Format requisites for display
function formatRequisites(requisites: string | null | undefined): string {
  if (!requisites) return '';
  const tags = requisites.split(',').map(r => r.trim()).filter(r => r.length > 0);
  return tags.join(', ');
}

// Get excluded patch codes as array
function getExcludedPatchCodes(stage: GameStage): string[] {
  if (!stage.excluded_patchcodes) return [];
  try {
    const excluded = JSON.parse(stage.excluded_patchcodes);
    return Array.isArray(excluded) ? excluded : [];
  } catch (e) {
    console.warn('Error parsing excluded_patchcodes:', e);
    return [];
  }
}

// Set excluded patch codes from array
function setExcludedPatchCodes(stage: GameStage, codes: string[]) {
  if (codes.length === 0) {
    stage.excluded_patchcodes = null;
  } else {
    stage.excluded_patchcodes = JSON.stringify(codes);
  }
}

// Add a patch code or tag to excluded list
function addExcludedPatchCode(stage: GameStage) {
  const code = newExcludedPatchCode.value.trim();
  if (!code) return;
  
  const currentCodes = getExcludedPatchCodes(stage);
  if (!currentCodes.includes(code)) {
    currentCodes.push(code);
    setExcludedPatchCodes(stage, currentCodes);
  }
  newExcludedPatchCode.value = '';
}

// Remove a patch code or tag from excluded list
function removeExcludedPatchCode(stage: GameStage, code: string) {
  const currentCodes = getExcludedPatchCodes(stage);
  const index = currentCodes.indexOf(code);
  if (index >= 0) {
    currentCodes.splice(index, 1);
    setExcludedPatchCodes(stage, currentCodes);
  }
}

// Format excluded patch codes for display
function formatExcludedPatchCodes(excludedPatchcodes: string | null | undefined): string {
  if (!excludedPatchcodes) return '';
  try {
    const codes = JSON.parse(excludedPatchcodes);
    return Array.isArray(codes) ? codes.join(', ') : '';
  } catch (e) {
    return '';
  }
}

// Get active playlevel patch for a stage
// Priority: 1) Playlevel patch in requisites, 2) playlevel_patch_code, 3) default '2lvno'
function getActivePlaylevelPatch(stage: GameStage): string {
  // First, check if any playlevel patch is in requisites
  const requisiteTags = getRequisiteTags(stage);
  for (const tag of requisiteTags) {
    const playlevelPatch = playlevelPatches.value.find(p => p.patch_code === tag);
    if (playlevelPatch) {
      return tag; // Found a playlevel patch in requisites
    }
  }
  
  // Second, check playlevel_patch_code
  if (stage.playlevel_patch_code && stage.playlevel_patch_code.trim()) {
    return stage.playlevel_patch_code.trim();
  }
  
  // Default to '2lvno'
  return '2lvno';
}

// Get playlevel patch code for a stage (for use in testLevel)
function getPlaylevelPatchCode(stage: GameStage): string {
  return getActivePlaylevelPatch(stage);
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
      const allPatches = (result.patches || []).map((patch: any) => ({
        epuuid: patch.epuuid,
        patch_code: patch.patch_code,
        name: patch.name,
        is_playlevel: patch.is_playlevel || 0,
      }));
      availablePatches.value = allPatches;
      // Filter playlevel patches
      playlevelPatches.value = allPatches.filter((p: any) => p.is_playlevel === 1);
    } else {
      console.error('Failed to load patches:', result?.error);
      availablePatches.value = [];
      playlevelPatches.value = [];
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
    // When in submission author mode, use draft stages from prop (no database interaction)
    if (props.forceAuthorMode) {
      stages.value = JSON.parse(JSON.stringify(props.draftStages || [])) || []; // Deep copy
      
      // Select initial level if provided
      if (props.initialLevelNumber !== null && props.initialLevelNumber !== undefined) {
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
      
      // Restore scroll position
      await nextTick();
      await nextTick();
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (stagesTableWrapper.value && savedScrollPosition.value > 0) {
            stagesTableWrapper.value.scrollTop = savedScrollPosition.value;
          }
          setTimeout(() => {
            if (stagesTableWrapper.value && savedScrollPosition.value > 0) {
              stagesTableWrapper.value.scrollTop = savedScrollPosition.value;
            }
          }, 100);
        });
      });
      
      loading.value = false;
      return;
    }
    
    // Otherwise, load from database (normal mode)
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
      
      // Restore scroll position after stages load
      // Use multiple nextTick calls and requestAnimationFrame to ensure DOM is fully updated
      await nextTick();
      await nextTick();
      // Use requestAnimationFrame to wait for next paint, then restore scroll
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (stagesTableWrapper.value && savedScrollPosition.value > 0) {
            stagesTableWrapper.value.scrollTop = savedScrollPosition.value;
          }
          // Additional fallback after a short delay to handle alert dialogs
          setTimeout(() => {
            if (stagesTableWrapper.value && savedScrollPosition.value > 0) {
              stagesTableWrapper.value.scrollTop = savedScrollPosition.value;
            }
          }, 100);
        });
      });
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

// Filter stages based on mode - only hide stages that are both locked AND secret
const filteredStages = computed(() => {
  if (currentMode.value === 'edit' || canEdit.value) {
    // In edit mode or if dev admin, show all stages
    return stages.value;
  }
  // In view-only mode:
  // - Locked-only stages should be visible (just disabled for selection/testing)
  // - Secret-only stages should be visible (show "-" for values)
  // - Only hide stages that are BOTH locked AND secret
  return stages.value.filter(stage => {
    // Hide only if it's both locked AND secret
    if (stage.lock === 1 && stage.secret === 1) {
      return false;
    }
    // Show all other stages
    return true;
  });
});

// Check if a stage can be tested (available in view-only mode)
function canTestStage(stage: GameStage): boolean {
  // Can't test if secret, locked, or difficulty > 8
  if (stage.secret === 1) return false;
  if (stage.lock === 1 && currentMode.value !== 'edit') return false;
  if ((stage.difficulty || 0) > 8) return false;
  return true;
}

function selectStage(stage: GameStage) {
  if (currentMode.value === 'select') {
    // Don't allow selection of locked stages in view-only mode (not in edit mode)
    if (stage.lock === 1 && currentMode.value !== 'edit') {
      // If already selected, unselect it
      const stageUuid = stage.stage_uuid || '';
      if (selectedStageUuids.value.has(stageUuid)) {
        selectedStageUuids.value.delete(stageUuid);
      }
      // Clear highlighted stage if it's this locked stage
      if (selectedStageUuid.value === stage.stage_uuid) {
        selectedStageUuid.value = null;
      }
      return;
    }
    // Toggle selection in the set (for "Add Stages to Run" button)
    const stageUuid = stage.stage_uuid || '';
    if (selectedStageUuids.value.has(stageUuid)) {
      selectedStageUuids.value.delete(stageUuid);
    } else {
      selectedStageUuids.value.add(stageUuid);
    }
    // Set highlighted stage (for "Select" button)
    selectedStageUuid.value = stage.stage_uuid || null;
  }
}

function toggleStageSelection(stage: GameStage) {
  if (currentMode.value === 'select') {
    // Don't allow selection of locked stages in view-only mode (not in edit mode)
    if (stage.lock === 1 && currentMode.value !== 'edit') {
      // If already selected, unselect it
      const stageUuid = stage.stage_uuid || '';
      if (selectedStageUuids.value.has(stageUuid)) {
        selectedStageUuids.value.delete(stageUuid);
      }
      // Clear highlighted stage if it's this locked stage
      if (selectedStageUuid.value === stage.stage_uuid) {
        selectedStageUuid.value = null;
      }
      return;
    }
    const stageUuid = stage.stage_uuid || '';
    if (selectedStageUuids.value.has(stageUuid)) {
      selectedStageUuids.value.delete(stageUuid);
    } else {
      selectedStageUuids.value.add(stageUuid);
    }
    // Also update highlighted stage
    selectedStageUuid.value = stage.stage_uuid || null;
  }
}

// Get filtered stages (used in template)
// Computed properties for select all checkbox
const allStagesSelected = computed(() => {
  const selectableStages = filteredStages.value.filter(s => !(s.lock === 1 && !isDevAdmin.value));
  if (selectableStages.length === 0) return false;
  return selectableStages.every(stage => selectedStageUuids.value.has(stage.stage_uuid || ''));
});

const someStagesSelected = computed(() => {
  const selectableStages = filteredStages.value.filter(s => !(s.lock === 1 && !isDevAdmin.value));
  if (selectableStages.length === 0) return false;
  const selectedCount = selectableStages.filter(stage => selectedStageUuids.value.has(stage.stage_uuid || '')).length;
  return selectedCount > 0 && selectedCount < selectableStages.length;
});

function toggleSelectAllStages(event: Event) {
  const target = event.target as HTMLInputElement;
  const selectableStages = filteredStages.value.filter(s => !(s.lock === 1 && !isDevAdmin.value));
  
  if (target.checked) {
    // Select all selectable stages
    selectableStages.forEach(stage => {
      if (stage.stage_uuid) {
        selectedStageUuids.value.add(stage.stage_uuid);
      }
    });
  } else {
    // Deselect all
    selectableStages.forEach(stage => {
      if (stage.stage_uuid) {
        selectedStageUuids.value.delete(stage.stage_uuid);
      }
    });
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

function addStageToRun() {
  if (selectedStageUuid.value) {
    const stage = stages.value.find(s => s.stage_uuid === selectedStageUuid.value);
    if (stage) {
      emit('add-to-run', stage);
      close();
    }
  }
}

function addStagesToRun() {
  if (selectedStageUuids.value.size === 0) {
    return;
  }
  
  // Emit all selected stages
  const selectedStages = stages.value.filter(s => s.stage_uuid && selectedStageUuids.value.has(s.stage_uuid));
  for (const stage of selectedStages) {
    emit('add-to-run', stage);
  }
  close();
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
    water: 0,
    ghouse: 0,
    spalace: 0,
    castle: 0,
    boss: 0,
    secret: 0,
    troll: 0,
    final: 0,
    lock: 0,
    playlevel_patch_code: null, // null means use default '2lvno'
  };
  stages.value.push(newStage);
}

async function testLevel(stage: GameStage) {
  if (!stage.levelnumber) {
    await showAlert('Level number is required to test this level', 'Test Level');
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
    
    // Get all patches to find the "2lvno" patch
    testProgressMessage.value = 'Finding 2lvno patch...';
    const patchesResult = await api.getAllExtraPatches();
    
    if (!patchesResult?.success) {
      testProgressMessage.value = `Error: Failed to load patches - ${patchesResult?.error || 'Unknown error'}`;
      return;
    }
    
    const allPatches = patchesResult.patches || [];
    // Get the playlevel patch code for this stage
    const playlevelPatchCode = getPlaylevelPatchCode(stage);
    const playlevelPatch = allPatches.find((p: any) => p.patch_code === playlevelPatchCode);
    
    if (!playlevelPatch) {
      testProgressMessage.value = `Error: Playlevel patch "${playlevelPatchCode}" not found. Please ensure the patch is defined in the system.`;
      return;
    }
    
    // Collect patches from requisites
    const selectedPatchUuids: string[] = [];
    
    // Add playlevel patch if not already in requisites
    const requisiteTags = getRequisiteTags(stage);
    const playlevelInRequisites = requisiteTags.includes(playlevelPatchCode);
    if (!playlevelInRequisites) {
      selectedPatchUuids.push(playlevelPatch.epuuid);
    }
    
    // Get requisite tags from stage and find matching patches
    if (requisiteTags.length > 0) {
      for (const tag of requisiteTags) {
        // Find patch with matching patch_code
        const matchingPatch = allPatches.find((p: any) => p.patch_code === tag);
        if (matchingPatch && !selectedPatchUuids.includes(matchingPatch.epuuid)) {
          selectedPatchUuids.push(matchingPatch.epuuid);
        }
      }
    }
    
    // If playlevel patch was in requisites, make sure it's included
    if (playlevelInRequisites) {
      if (!selectedPatchUuids.includes(playlevelPatch.epuuid)) {
        selectedPatchUuids.push(playlevelPatch.epuuid);
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
      // Check if USB2SNES is configured
      if (currentSettings.usb2snesEnabled !== 'yes') {
        testProgressMessage.value = 'Error: USB2SNES is not enabled. Please enable it in Settings first.';
        testingLevel.value = false;
        return;
      }
      
      // Get USB2SNES connection status
      testProgressMessage.value = 'Checking USB2SNES connection...';
      let usb2snesConnected = false;
      
      try {
        const statusResult = await api.usb2snesStatus?.();
        if (statusResult && statusResult.connected) {
          usb2snesConnected = true;
        }
      } catch (statusError) {
        console.warn('Failed to get USB2SNES status:', statusError);
      }
      
        // Auto-connect if configured but not connected
        if (!usb2snesConnected) {
          testProgressMessage.value = 'Connecting to USB2SNES...';
          try {
            // Build connection options from settings
            // Library must be one of: usb2snes_a, usb2snes_b, qusb2snes, node-usb
            const library = currentSettings.usb2snesLibrary || 'usb2snes_a';
            if (!['usb2snes_a', 'usb2snes_b', 'qusb2snes', 'node-usb'].includes(library)) {
              throw new Error(`Invalid USB2SNES library setting: ${library}. Must be one of: usb2snes_a, usb2snes_b, qusb2snes, node-usb`);
            }
            
            const connectOptions: any = {
              library: library,
              address: currentSettings.usb2snesAddress || 'ws://localhost:64213',
              hostingMethod: currentSettings.usb2snesHostingMethod || 'external',
              proxyMode: currentSettings.usb2snesProxyMode || 'direct'
            };
          
          if (currentSettings.usb2snesProxyMode === 'socks' && currentSettings.usb2snesSocksProxyUrl) {
            connectOptions.socksProxyUrl = currentSettings.usb2snesSocksProxyUrl;
          }
          
          if (currentSettings.usb2snesProxyMode === 'ssh' || currentSettings.usb2snesProxyMode === 'direct-with-ssh') {
            connectOptions.ssh = {
              host: currentSettings.usb2snesSshHost,
              username: currentSettings.usb2snesSshUsername,
              localPort: currentSettings.usb2snesSshLocalPort || 64213,
              remotePort: currentSettings.usb2snesSshRemotePort || 64213,
              identityFile: currentSettings.usb2snesSshIdentityFile
            };
          }
          
          const connectResult = await api.usb2snesConnect(connectOptions);
          usb2snesConnected = true;
          console.log('[TestLevel] USB2SNES connected:', connectResult);
        } catch (connectError: any) {
          testProgressMessage.value = `Failed to connect to USB2SNES: ${connectError?.message || String(connectError)}`;
          testingLevel.value = false;
          return;
        }
      }
      
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
        
        // Record upload to snes_contents
        try {
          const uploadedFileInfo = {
            fullpath: dstPath,
            filename: filename,
            gameid: props.gameId,
            version: props.gameVersion || 1,
            levelnumber: stage.levelnumber || null,
            levelname: stage.levelname || null,
            metadata: {
              gamename: props.gameName || null
            },
            part_of_a_run: false
          };
          
          if (api.snesContentsSync) {
            await api.snesContentsSync(uploadedFileInfo);
            console.log('[TestLevel] SNES contents cache synced');
          }
        } catch (syncError: any) {
          console.warn('[TestLevel] Cache sync failed:', syncError);
          // Don't fail the upload if sync fails
        }
        
        // Record to recentboots
        try {
          if (api.recordRecentBoot) {
            await api.recordRecentBoot({
              filename: filename,
              fullpath: dstPath,
              gameid: props.gameId,
              gamename: props.gameName || null,
              levelnumber: stage.levelnumber || null,
              levelname: stage.levelname || null
            });
            console.log('[TestLevel] Recent boot recorded');
          }
        } catch (recordError: any) {
          console.warn('[TestLevel] Recent boot recording failed:', recordError);
          // Don't fail the upload if recording fails
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
  // When in submission author mode, just remove from local array (no database interaction)
  if (props.forceAuthorMode) {
    const index = stages.value.indexOf(stage);
    if (index >= 0) {
      stages.value.splice(index, 1);
    }
    return;
  }
  
  // Normal mode: remove from local array if it's a new stage (no stage_uuid)
  if (!stage.stage_uuid) {
    const index = stages.value.indexOf(stage);
    if (index >= 0) {
      stages.value.splice(index, 1);
    }
    return;
  }
  
  const levelHex = formatLevelNumberHex(stage.levelnumber);

  /* Disable confirm prompt for now.
   * Confirm prompts get very annoying here, since often people want to delete several stages at once.
   * It doubles work and causes fatigue, irritation to repeatedly answer Are you sure prompts.
   *
   * if (!confirm(`Are you sure you want to delete stage "${stage.levelname}" (Level ${levelHex})?`)) {
   *   return;
   * }
   */
  
  try {
    const api = (window as any)?.electronAPI;
    if (!api?.deleteGameStage) {
      await showAlert('Delete functionality not available', 'Error');
      return;
    }
    
    const result = await api.deleteGameStage({ stage_uuid: stage.stage_uuid });
    
    if (result?.success) {
      await loadStages();
    } else {
      await showAlert(`Failed to delete stage: ${result?.error || 'Unknown error'}`, 'Delete Failed');
    }
  } catch (error: any) {
    await showAlert(`Error deleting stage: ${error?.message || String(error)}`, 'Error');
  }
}

async function saveAll() {
  if (!canEdit.value) return;
  
  // Save current scroll position before saving
  if (stagesTableWrapper.value) {
    savedScrollPosition.value = stagesTableWrapper.value.scrollTop;
  }
  
  saving.value = true;
  try {
    // When in submission author mode, save to draft only (no database interaction)
    if (props.forceAuthorMode) {
      // Calculate translevel for all stages
      const draftStages = stages.value.map(stage => {
        const stageCopy = { ...stage };
        stageCopy.translevel_13bf = calculateTranslevel(stageCopy);
        // Remove stage_uuid and other database-only fields for draft
        const { stage_uuid, rhpakuuid, ...draftStage } = stageCopy;
        return draftStage;
      });
      
      // Emit stages back to parent to save in draft
      emit('draft-stages-saved', draftStages);
      emit('saved');
      
      // Restore scroll position
      await nextTick();
      setTimeout(() => {
        if (stagesTableWrapper.value && savedScrollPosition.value > 0) {
          stagesTableWrapper.value.scrollTop = savedScrollPosition.value;
        }
      }, 100);
      
      saving.value = false;
      return;
    }
    
    // Otherwise, save to database (normal mode)
    const api = (window as any)?.electronAPI;
    if (!api?.saveGameStage) {
      await showAlert('Save functionality not available', 'Error');
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
        water: stage.water ?? 0,
        ghouse: stage.ghouse,
        spalace: stage.spalace,
        castle: stage.castle,
        boss: stage.boss,
        secret: stage.secret,
        troll: stage.troll,
        final: stage.final,
        lock: stage.lock || 0,
        playlevel_patch_code: stage.playlevel_patch_code || '2lvno',
        extradescription: stage.extradescription || null,
        stagetags: stage.stagetags || null,
      });
      
      if (!result?.success) {
        errors.push(`Failed to save "${stage.levelname}": ${result?.error || 'Unknown error'}`);
      }
    }
    
    if (errors.length > 0) {
      await showAlert(`Some stages failed to save:\n${errors.join('\n')}`, 'Save Warning');
      // Restore scroll after alert is dismissed
      await nextTick();
      setTimeout(() => {
        if (stagesTableWrapper.value && savedScrollPosition.value > 0) {
          stagesTableWrapper.value.scrollTop = savedScrollPosition.value;
        }
      }, 100);
    } else {
      emit('saved');
      await loadStages(); // This will restore scroll position
      // Also restore scroll after a longer delay to handle alert dialog from parent
      // The parent's handleStagesSaved will show an alert, so we wait for that
      // Use multiple timeouts to catch scroll reset at different points
      setTimeout(() => {
        if (stagesTableWrapper.value && savedScrollPosition.value > 0) {
          stagesTableWrapper.value.scrollTop = savedScrollPosition.value;
        }
      }, 300);
      setTimeout(() => {
        if (stagesTableWrapper.value && savedScrollPosition.value > 0) {
          stagesTableWrapper.value.scrollTop = savedScrollPosition.value;
        }
      }, 600);
      setTimeout(() => {
        if (stagesTableWrapper.value && savedScrollPosition.value > 0) {
          stagesTableWrapper.value.scrollTop = savedScrollPosition.value;
        }
      }, 1000);
    }
  } catch (error: any) {
    await showAlert(`Error saving stages: ${error?.message || String(error)}`, 'Error');
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

function openExtraDescriptionDialog(stage: GameStage) {
  editingExtraDescriptionStage.value = stage;
  editingExtraDescriptionText.value = stage.extradescription || '';
  showExtraDescriptionDialog.value = true;
}

function closeExtraDescriptionDialog() {
  showExtraDescriptionDialog.value = false;
  editingExtraDescriptionStage.value = null;
  editingExtraDescriptionText.value = '';
}

function saveExtraDescription() {
  if (!editingExtraDescriptionStage.value) return;
  editingExtraDescriptionStage.value.extradescription = editingExtraDescriptionText.value.trim() || null;
  closeExtraDescriptionDialog();
}

function openTagsDialog(stage: GameStage) {
  editingTagsStage.value = stage;
  editingTagsText.value = stage.stagetags || '';
  showTagsDialog.value = true;
}

function closeTagsDialog() {
  showTagsDialog.value = false;
  editingTagsStage.value = null;
  editingTagsText.value = '';
}

function saveTags() {
  if (!editingTagsStage.value) return;
  // Trim and normalize: remove extra spaces, but keep tags as-is
  const tags = editingTagsText.value.trim();
  editingTagsStage.value.stagetags = tags || null;
  closeTagsDialog();
}

// CSV column headers as defined in GAMESTAGES.md
const CSV_COLUMNS = [
  'stage_uuid', 'gameid', 'levelnumber', 'levelname', 'versions', 'submapid', 'translevel_13bf',
  'tile_x', 'tile_y', 'tile_value', 'requisites', 'playable', 'rando', 'difficulty',
  'mainexit', 'keyhole', 'credits', 'ghouse', 'spalace', 'castle', 'water', 'boss',
  'secret', 'troll', 'final', 'lock', 'playlevel_patch_code', 'excluded_patchcodes',
  'stagetags', 'rhpakuuid', 'extradescription'
];

async function exportStagesToCSV() {
  if (!props.gameId || stages.value.length === 0) {
    await showAlert('No stages to export', 'Export Error');
    return;
  }
  
  try {
    const api = (window as any)?.electronAPI;
    if (!api?.chooseSavePath) {
      await showAlert('File save functionality not available', 'Error');
      return;
    }
    
    // Default filename: (gameid)_stages.csv
    const defaultFilename = `${props.gameId}_stages.csv`;
    
    // Prompt for save location
    const saveResult = await api.chooseSavePath({
      title: 'Export Stages to CSV',
      defaultPath: defaultFilename,
      filters: [
        { name: 'CSV Files', extensions: ['csv'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });
    
    if (!saveResult || saveResult.canceled || !saveResult.filePath) {
      return; // User cancelled
    }
    
    // Build data array for papaparse
    const csvData: any[] = [];
    
    // Add data rows
    for (const stage of stages.value) {
      const row: any = {};
      for (const col of CSV_COLUMNS) {
        let value: string | number | null | undefined;
        
        switch (col) {
          case 'stage_uuid':
            value = stage.stage_uuid || '';
            break;
          case 'gameid':
            value = stage.gameid || props.gameId;
            break;
          case 'levelnumber':
            value = stage.levelnumber || '';
            break;
          case 'levelname':
            value = stage.levelname || '';
            break;
          case 'versions':
            value = stage.versions || '*';
            break;
          case 'submapid':
            value = stage.submapid || '';
            break;
          case 'translevel_13bf':
            value = stage.translevel_13bf || calculateTranslevel(stage) || '';
            break;
          case 'tile_x':
            value = stage.tile_x || '';
            break;
          case 'tile_y':
            value = stage.tile_y || '';
            break;
          case 'tile_value':
            value = stage.tile_value || '';
            break;
          case 'requisites':
            value = stage.requisites || '';
            break;
          case 'playable':
            value = stage.playable ?? 0;
            break;
          case 'rando':
            value = stage.rando ?? 0;
            break;
          case 'difficulty':
            value = stage.difficulty ?? 0;
            break;
          case 'mainexit':
            value = stage.mainexit ?? 0;
            break;
          case 'keyhole':
            value = stage.keyhole ?? 0;
            break;
          case 'credits':
            value = stage.credits ?? 0;
            break;
          case 'ghouse':
            value = stage.ghouse ?? 0;
            break;
          case 'spalace':
            value = stage.spalace ?? 0;
            break;
          case 'castle':
            value = stage.castle ?? 0;
            break;
          case 'water':
            value = stage.water ?? 0;
            break;
          case 'boss':
            value = stage.boss ?? 0;
            break;
          case 'secret':
            value = stage.secret ?? 0;
            break;
          case 'troll':
            value = stage.troll ?? 0;
            break;
          case 'final':
            value = stage.final ?? 0;
            break;
          case 'lock':
            value = stage.lock ?? 0;
            break;
          case 'playlevel_patch_code':
            value = stage.playlevel_patch_code || '';
            break;
          case 'excluded_patchcodes':
            value = stage.excluded_patchcodes || '';
            break;
          case 'stagetags':
            value = stage.stagetags || '';
            break;
          case 'rhpakuuid':
            value = stage.rhpakuuid || '';
            break;
          case 'extradescription':
            value = stage.extradescription || '';
            break;
          default:
            value = '';
        }
        
        // Convert to string, handling null/undefined
        row[col] = value === null || value === undefined ? '' : String(value);
      }
      csvData.push(row);
    }
    
    // Generate CSV using papaparse with proper formatting for Excel compatibility
    const csvContent = Papa.unparse(csvData, {
      columns: CSV_COLUMNS,
      header: true,
      quotes: true, // Quote all fields
      quoteChar: '"',
      escapeChar: '"',
      delimiter: ',',
      newline: '\n',
      skipEmptyLines: false
    });
    
    // Ensure file ends with a newline
    const csvContentWithNewline = csvContent.endsWith('\n') ? csvContent : csvContent + '\n';
    
    // Write file directly (chooseSavePath already showed the dialog)
    if (!api.writeFile) {
      await showAlert('File write functionality not available', 'Error');
      return;
    }
    
    const writeResult = await api.writeFile({
      filePath: saveResult.filePath,
      content: csvContentWithNewline
    });
    
    if (!writeResult?.success) {
      await showAlert(`Error writing file: ${writeResult?.error || 'Unknown error'}`, 'File Error');
      return;
    }
    
    // Show toast notification
    await nextTick();
    await nextTick(); // Double nextTick for Teleport
    
    if (toastNotificationRef.value && typeof toastNotificationRef.value.showToast === 'function') {
      toastNotificationRef.value.showToast(
        `Successfully exported ${stages.value.length} stage(s) to CSV`,
        'success'
      );
    } else {
      // Fallback to alert if toast not available
      await showAlert(`Successfully exported ${stages.value.length} stage(s) to CSV`, 'Export Success');
    }
  } catch (error: any) {
    await showAlert(`Error exporting CSV: ${error?.message || String(error)}`, 'Error');
  }
}

// Computed properties for CSV import selection
const allCSVStagesSelected = computed(() => {
  const selectableStages = csvImportStages.value.filter(s => !s._isLocked);
  if (selectableStages.length === 0) return false;
  return selectableStages.every(stage => selectedCSVStages.value.has(stage._rowIndex));
});

const someCSVStagesSelected = computed(() => {
  const selectableStages = csvImportStages.value.filter(s => !s._isLocked);
  if (selectableStages.length === 0) return false;
  const selectedCount = selectableStages.filter(stage => selectedCSVStages.value.has(stage._rowIndex)).length;
  return selectedCount > 0 && selectedCount < selectableStages.length;
});

async function importStagesFromCSV() {
  if (!props.gameId) {
    await showAlert('No game selected', 'Import Error');
    return;
  }
  
  try {
    const api = (window as any)?.electronAPI;
    if (!api?.selectFile || !api?.readFile) {
      await showAlert('File selection functionality not available', 'Error');
      return;
    }
    
    // Prompt for CSV file
    const selectResult = await api.selectFile({
      title: 'Import Stages from CSV',
      filters: [
        { name: 'CSV Files', extensions: ['csv'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });
    
    if (selectResult.canceled || !selectResult.filePath) {
      return; // User cancelled
    }
    
    // Read CSV file
    csvImportLoading.value = true;
    showCSVImportDialog.value = true;
    
    const readResult = await api.readFile({ filePath: selectResult.filePath });
    
    if (!readResult?.success) {
      await showAlert(`Error reading CSV file: ${readResult?.error || 'Unknown error'}`, 'File Error');
      csvImportLoading.value = false;
      return;
    }
    
    // Parse CSV using papaparse
    const parseResult = Papa.parse(readResult.content, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header: string) => header.trim()
    });
    
    if (parseResult.errors && parseResult.errors.length > 0) {
      console.warn('CSV parse errors:', parseResult.errors);
    }
    
    // Get existing stages to check for duplicates and locked stages
    const existingStages = await api.getGameStages({ gameid: props.gameId });
    const existingLevelNumbers = new Set(existingStages?.stages?.map((s: GameStage) => s.levelnumber) || []);
    const existingStagesByLevel = new Map<string, GameStage>();
    (existingStages?.stages || []).forEach((s: GameStage) => {
      if (s.levelnumber) {
        existingStagesByLevel.set(s.levelnumber, s);
      }
    });
    
    // Process parsed CSV rows
    const processedStages: any[] = [];
    parseResult.data.forEach((row: any, index: number) => {
      // Skip rows without levelnumber
      if (!row.levelnumber) return;
      
      const levelnumber = String(row.levelnumber).trim();
      const existingStage = existingStagesByLevel.get(levelnumber);
      const exists = !!existingStage;
      const isLocked = exists && existingStage.lock === 1;
      
      // Convert string values to appropriate types
      const processedStage: any = {
        _rowIndex: index,
        _exists: exists,
        _isLocked: isLocked,
        _existingStage: existingStage || null,
        stage_uuid: row.stage_uuid?.trim() || '',
        gameid: row.gameid?.trim() || props.gameId,
        levelnumber: levelnumber,
        levelname: row.levelname?.trim() || '',
        versions: row.versions?.trim() || '*',
        submapid: row.submapid?.trim() || '',
        translevel_13bf: row.translevel_13bf?.trim() || '',
        tile_x: row.tile_x?.trim() || '',
        tile_y: row.tile_y?.trim() || '',
        tile_value: row.tile_value?.trim() || '',
        requisites: row.requisites?.trim() || '',
        playable: row.playable === '1' || row.playable === 1 ? 1 : 0,
        rando: row.rando === '1' || row.rando === 1 ? 1 : 0,
        difficulty: row.difficulty ? parseInt(String(row.difficulty), 10) : 0,
        mainexit: row.mainexit === '1' || row.mainexit === 1 ? 1 : 0,
        keyhole: row.keyhole === '1' || row.keyhole === 1 ? 1 : 0,
        credits: row.credits === '1' || row.credits === 1 ? 1 : 0,
        ghouse: row.ghouse === '1' || row.ghouse === 1 ? 1 : 0,
        spalace: row.spalace === '1' || row.spalace === 1 ? 1 : 0,
        castle: row.castle === '1' || row.castle === 1 ? 1 : 0,
        water: row.water === '1' || row.water === 1 ? 1 : 0,
        boss: row.boss === '1' || row.boss === 1 ? 1 : 0,
        secret: row.secret === '1' || row.secret === 1 ? 1 : 0,
        troll: row.troll === '1' || row.troll === 1 ? 1 : 0,
        final: row.final === '1' || row.final === 1 ? 1 : 0,
        lock: row.lock === '1' || row.lock === 1 ? 1 : 0,
        playlevel_patch_code: row.playlevel_patch_code?.trim() || '',
        excluded_patchcodes: row.excluded_patchcodes?.trim() || '',
        stagetags: row.stagetags?.trim() || '',
        rhpakuuid: row.rhpakuuid?.trim() || '',
        extradescription: row.extradescription?.trim() || ''
      };
      
      processedStages.push(processedStage);
    });
    
    csvImportStages.value = processedStages;
    selectedCSVStages.value.clear();
    
    // By default, select all stages for levelnumbers that don't exist
    processedStages.forEach(stage => {
      if (!stage._exists && !stage._isLocked) {
        selectedCSVStages.value.add(stage._rowIndex);
      }
    });
    
    csvImportLoading.value = false;
  } catch (error: any) {
    console.error('Error importing CSV:', error);
    await showAlert(`Error importing CSV: ${error?.message || String(error)}`, 'Error');
    csvImportLoading.value = false;
  }
}

function closeCSVImportDialog() {
  showCSVImportDialog.value = false;
  csvImportStages.value = [];
  selectedCSVStages.value.clear();
  csvImportOptions.value = {
    unselectExisting: false,
    duplicateMode: 'update',
    includeUuid: false,
    ignoreUuid: true
  };
}

function updateCSVImportSelection() {
  if (csvImportOptions.value.unselectExisting) {
    // Unselect all stages that already exist
    csvImportStages.value.forEach(stage => {
      if (stage._exists) {
        selectedCSVStages.value.delete(stage._rowIndex);
      }
    });
  }
}

function toggleSelectAllCSVStages(event: Event) {
  const target = event.target as HTMLInputElement;
  const selectableStages = csvImportStages.value.filter(s => !s._isLocked);
  
  if (target.checked) {
    // Select all selectable stages
    selectableStages.forEach(stage => {
      selectedCSVStages.value.add(stage._rowIndex);
    });
  } else {
    // Deselect all
    selectableStages.forEach(stage => {
      selectedCSVStages.value.delete(stage._rowIndex);
    });
  }
}

function toggleCSVStageSelection(stage: any) {
  if (stage._isLocked) return;
  
  if (selectedCSVStages.value.has(stage._rowIndex)) {
    selectedCSVStages.value.delete(stage._rowIndex);
  } else {
    selectedCSVStages.value.add(stage._rowIndex);
  }
}

async function addSelectedCSVStages() {
  if (selectedCSVStages.value.size === 0) {
    await showAlert('No stages selected', 'Validation Error');
    return;
  }
  
  const selectedStages = csvImportStages.value.filter(s => selectedCSVStages.value.has(s._rowIndex));
  let addedCount = 0;
  let updatedCount = 0;
  
  for (const csvStage of selectedStages) {
    // Check if stage already exists in the current stages array
    const existingStageIndex = stages.value.findIndex(s => 
      s.levelnumber === csvStage.levelnumber && s.gameid === props.gameId
    );
    
    // Handle UUID based on options
    let stageUuid: string | undefined = undefined;
    
    if (existingStageIndex >= 0 && csvImportOptions.value.duplicateMode === 'update') {
      // Update existing stage in the array
        const existingStage = stages.value[existingStageIndex];
        
        // Handle UUID based on options
        if (csvImportOptions.value.ignoreUuid) {
          // Keep existing UUID
          stageUuid = existingStage.stage_uuid;
        } else if (csvImportOptions.value.includeUuid && csvStage.stage_uuid) {
          // Use UUID from CSV
          stageUuid = csvStage.stage_uuid;
        } else {
          // Default: keep existing UUID
          stageUuid = existingStage.stage_uuid;
        }
        
        // Update the existing stage with CSV data
        const updatedStage: GameStage = {
          ...existingStage,
          stage_uuid: stageUuid,
          levelname: csvStage.levelname || existingStage.levelname,
          versions: csvStage.versions || existingStage.versions || '*',
          submapid: csvStage.submapid || existingStage.submapid || null,
          translevel_13bf: csvStage.translevel_13bf || existingStage.translevel_13bf || null,
          tile_x: csvStage.tile_x || existingStage.tile_x || null,
          tile_y: csvStage.tile_y || existingStage.tile_y || null,
          tile_value: csvStage.tile_value || existingStage.tile_value || null,
          requisites: csvStage.requisites || existingStage.requisites || null,
          playable: csvStage.playable,
          rando: csvStage.rando,
          difficulty: csvStage.difficulty,
          mainexit: csvStage.mainexit,
          keyhole: csvStage.keyhole,
          credits: csvStage.credits,
          ghouse: csvStage.ghouse,
          spalace: csvStage.spalace,
          castle: csvStage.castle,
          water: csvStage.water,
          boss: csvStage.boss,
          secret: csvStage.secret,
          troll: csvStage.troll,
          final: csvStage.final,
          lock: csvStage.lock,
          playlevel_patch_code: csvStage.playlevel_patch_code || existingStage.playlevel_patch_code || null,
          excluded_patchcodes: csvStage.excluded_patchcodes || existingStage.excluded_patchcodes || null,
          stagetags: csvStage.stagetags || existingStage.stagetags || null,
          rhpakuuid: csvStage.rhpakuuid || existingStage.rhpakuuid || null,
          extradescription: csvStage.extradescription || existingStage.extradescription || null
        };
        
        stages.value[existingStageIndex] = updatedStage;
        updatedCount++;
    } else {
      // Add as new stage (either doesn't exist, or duplicate mode is 'import')
      // Handle UUID for new stages
      if (csvImportOptions.value.ignoreUuid) {
        // Ignore UUID from CSV - will be generated on save
        stageUuid = undefined;
      } else if (csvStage.stage_uuid) {
        // Use UUID from CSV if provided
        stageUuid = csvStage.stage_uuid;
      } else {
        // No UUID in CSV - will be generated on save
        stageUuid = undefined;
      }
      
      const newStage: GameStage = {
        stage_uuid: stageUuid,
        gameid: props.gameId,
        levelnumber: csvStage.levelnumber || null,
        levelname: csvStage.levelname || 'New Stage',
        versions: csvStage.versions || '*',
        submapid: csvStage.submapid || null,
        translevel_13bf: csvStage.translevel_13bf || null,
        tile_x: csvStage.tile_x || null,
        tile_y: csvStage.tile_y || null,
        tile_value: csvStage.tile_value || null,
        requisites: csvStage.requisites || null,
        playable: csvStage.playable,
        rando: csvStage.rando,
        difficulty: csvStage.difficulty,
        mainexit: csvStage.mainexit,
        keyhole: csvStage.keyhole,
        credits: csvStage.credits,
        ghouse: csvStage.ghouse,
        spalace: csvStage.spalace,
        castle: csvStage.castle,
        water: csvStage.water,
        boss: csvStage.boss,
        secret: csvStage.secret,
        troll: csvStage.troll,
        final: csvStage.final,
        lock: csvStage.lock,
        playlevel_patch_code: csvStage.playlevel_patch_code || null,
        excluded_patchcodes: csvStage.excluded_patchcodes || null,
        stagetags: csvStage.stagetags || null,
        rhpakuuid: csvStage.rhpakuuid || null,
        extradescription: csvStage.extradescription || null
      };
      
      stages.value.push(newStage);
      addedCount++;
    }
  }
  
  // Show result and close dialog
  closeCSVImportDialog();
  
  // Show toast notification
  nextTick().then(() => {
    nextTick().then(() => {
      if (toastNotificationRef.value && typeof toastNotificationRef.value.showToast === 'function') {
        const message = updatedCount > 0 
          ? `Added ${addedCount} stage(s), updated ${updatedCount} stage(s)`
          : `Added ${addedCount} stage(s)`;
        toastNotificationRef.value.showToast(message, 'success');
      }
    });
  });
}

// Helper function to get a unique identifier for a stage
function getStageIdentifier(stage: GameStage, index: number): string {
  if (stage.stage_uuid) {
    return stage.stage_uuid;
  }
  // For draft stages without stage_uuid, use a combination of levelname and levelnumber
  return `${stage.levelname || 'stage'}_${stage.levelnumber || index}`;
}

function openSetPlaylevelPatchDialog() {
  // Initialize with all stages selected
  // Use a unique identifier that works for both database and draft stages
  selectedStagesForPlaylevelPatch.value = new Set(
    stages.value.map((s, index) => getStageIdentifier(s, index))
  );
  newPlaylevelPatchCode.value = '2lvno';
  showSetPlaylevelPatchDialog.value = true;
}

function closeSetPlaylevelPatchDialog() {
  showSetPlaylevelPatchDialog.value = false;
  selectedStagesForPlaylevelPatch.value.clear();
}

function toggleStageForPlaylevelPatch(stage: GameStage, index: number) {
  const identifier = getStageIdentifier(stage, index);
  if (selectedStagesForPlaylevelPatch.value.has(identifier)) {
    selectedStagesForPlaylevelPatch.value.delete(identifier);
  } else {
    selectedStagesForPlaylevelPatch.value.add(identifier);
  }
}

function selectAllStagesForPlaylevelPatch() {
  selectedStagesForPlaylevelPatch.value = new Set(
    stages.value.map((s, index) => getStageIdentifier(s, index))
  );
}

function deselectAllStagesForPlaylevelPatch() {
  selectedStagesForPlaylevelPatch.value.clear();
}

async function applyPlaylevelPatch() {
  const patchCode = newPlaylevelPatchCode.value.trim();
  if (!patchCode) {
    await showAlert('Please enter a patch code', 'Validation Error');
    return;
  }
  
  // Verify it's a valid playlevel patch or allow '2lvno' as default
  const isValidPlaylevel = playlevelPatches.value.some(p => p.patch_code === patchCode);
  if (!isValidPlaylevel && patchCode !== '2lvno') {
    // Allow '2lvno' as default even if not marked as playlevel
    const exists = availablePatches.value.some(p => p.patch_code === patchCode);
    if (!exists) {
      await showAlert(`Patch code "${patchCode}" not found. Please enter a valid patch code.`, 'Validation Error');
      return;
    }
  }
  
  // Apply to selected stages
  for (const stageIdentifier of selectedStagesForPlaylevelPatch.value) {
    const stage = stages.value.find((s, index) => getStageIdentifier(s, index) === stageIdentifier);
    if (stage) {
      // Set to null if defaulting to '2lvno', otherwise set the patch code
      stage.playlevel_patch_code = patchCode === '2lvno' ? null : patchCode;
    }
  }
  
  // When in draft mode, don't save to database - just update local stages
  // The changes will be saved to the draft when the main "Save" button is clicked
  if (props.forceAuthorMode) {
    closeSetPlaylevelPatchDialog();
    return;
  }
  
  // Save all modified stages to database (normal mode only)
  try {
    const api = (window as any)?.electronAPI;
    if (api?.saveGameStage) {
      for (const stageIdentifier of selectedStagesForPlaylevelPatch.value) {
        const stage = stages.value.find((s, index) => getStageIdentifier(s, index) === stageIdentifier);
        if (stage && stage.stage_uuid) {
          await api.saveGameStage({
            stage_uuid: stage.stage_uuid,
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
            lock: stage.lock || 0,
            playlevel_patch_code: stage.playlevel_patch_code,
          });
        }
      }
    }
  } catch (error) {
    console.error('Error saving playlevel patch codes:', error);
    await showAlert('Error saving playlevel patch codes. Some changes may not have been saved.', 'Save Error');
  }
  
  closeSetPlaylevelPatchDialog();
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
      playable: 0,
      rando: 0,
      difficulty: 2,
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
    lock: 0,
    playlevel_patch_code: null,
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

watch(() => props.draftStages, () => {
  // Reload stages when draftStages prop changes (e.g., after parent saves draft)
  if (props.isOpen && props.forceAuthorMode) {
    loadStages();
  }
}, { deep: true });

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

.stages-table th.col-water,
.stages-table td.col-water {
  background-color: rgba(0, 150, 255, 0.2); /* Light blue (water) */
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

.stages-table th.col-lock,
.stages-table td.col-lock {
  background-color: rgba(255, 152, 0, 0.2); /* Light orange */
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

.stages-table td.col-water:has(input[type="checkbox"]:checked) {
  background-color: rgba(0, 150, 255, 0.4) !important;
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

.stages-table td.col-lock:has(input[type="checkbox"]:checked) {
  background-color: rgba(255, 152, 0, 0.4) !important;
  filter: brightness(1.2);
}

/* Secret level rows - hide data when not in edit mode */
.stages-table tr.secret-level td:not(.col-secret) {
  color: var(--text-disabled, #999);
}

.stages-table tr.secret-level:hover td {
  background-color: var(--bg-hover);
}

/* Locked level rows - similar styling to secret levels */
.stages-table tr.locked-level td:not(.col-lock) {
  color: var(--text-disabled, #999);
}

.stages-table tr.locked-level:hover td {
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

.btn-icon.btn-memo {
  font-size: 16px;
  padding: 4px 8px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-primary);
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-icon.btn-memo:hover {
  background: var(--bg-tertiary);
  transform: scale(1.1);
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

/* Playlevel patch cell */
.playlevel-patch-cell {
  font-family: monospace;
  font-size: var(--small-font-size);
  color: var(--text-primary);
}

/* Set Playlevel Patch Dialog Styles */
.modal-field {
  margin-bottom: 20px;
}

.modal-field label {
  display: block;
  margin-bottom: 8px;
  font-weight: 600;
  font-size: var(--base-font-size);
  color: var(--text-primary);
}

.modal-input {
  width: 100%;
  padding: var(--input-padding);
  font-size: var(--base-font-size);
  border: 1px solid var(--border-primary);
  border-radius: 4px;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-family: monospace;
}

.modal-input:focus {
  outline: none;
  border-color: var(--accent-primary, #4CAF50);
  box-shadow: 0 0 0 2px rgba(76, 175, 80, 0.2);
}

.field-hint {
  margin-top: 6px;
  font-size: var(--small-font-size);
  color: var(--text-secondary);
}

.selection-controls {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}

.stages-selection-list {
  max-height: 300px;
  overflow-y: auto;
  border: 1px solid var(--border-primary);
  border-radius: 4px;
  background: var(--bg-secondary);
  padding: 8px;
}

.stage-selection-item {
  padding: 6px 0;
  border-bottom: 1px solid var(--border-primary);
}

.stage-selection-item:last-child {
  border-bottom: none;
}

.stage-selection-item label {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-weight: normal;
  margin: 0;
}

.stage-selection-item input[type="checkbox"] {
  cursor: pointer;
}

.stage-selection-label {
  flex: 1;
  font-size: var(--base-font-size);
  color: var(--text-primary);
}

.current-patch-hint {
  font-size: var(--small-font-size);
  color: var(--text-secondary);
  font-style: italic;
  margin-left: 8px;
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
  max-width: 200px;
  min-width: 200px;
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
/* CSV Import Dialog Styles */
.csv-import-backdrop {
  z-index: 25000 !important;
  background: rgba(0, 0, 0, 0.85) !important;
}

.csv-import-modal {
  width: 90vw;
  max-width: 1200px;
}

.csv-import-options {
  margin-bottom: 20px;
  padding: 16px;
  background: var(--bg-secondary);
  border-radius: 4px;
}

.option-group {
  margin-bottom: 16px;
}

.option-group:last-child {
  margin-bottom: 0;
}

.option-group label {
  display: block;
  margin-bottom: 8px;
  font-size: var(--small-font-size);
  color: var(--text-primary);
  cursor: pointer;
}

.option-group label strong {
  font-weight: 600;
}

.radio-group {
  margin-left: 20px;
  margin-top: 8px;
}

.radio-group label {
  display: block;
  margin-bottom: 8px;
  font-size: var(--small-font-size);
  color: var(--text-primary);
  cursor: pointer;
}

.radio-group label:last-child {
  margin-bottom: 0;
}

.csv-import-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--small-font-size);
  background: var(--bg-primary);
}

.csv-import-table thead {
  position: sticky;
  top: 0;
  background: var(--bg-secondary);
  z-index: 10;
}

.csv-import-table th {
  padding: 8px;
  text-align: left;
  font-weight: 600;
  border-bottom: 2px solid var(--border-primary);
  color: var(--text-primary);
  white-space: nowrap;
}

.csv-import-table td {
  padding: 6px 8px;
  border-bottom: 1px solid var(--border-primary);
  color: var(--text-primary);
}

.csv-import-table tr:hover:not(.locked) {
  background: var(--bg-hover);
  cursor: pointer;
}

.csv-import-table tr.locked {
  opacity: 0.5;
  background: var(--bg-secondary);
  cursor: not-allowed;
}

.csv-import-table tr.exists:not(.locked) {
  background: var(--bg-secondary);
}

.csv-import-table tr.new {
  background: var(--bg-primary);
}

.status-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 3px;
  font-size: var(--small-font-size);
  font-weight: 600;
  font-family: monospace;
}

.locked-badge {
  background: #f44336;
  color: white;
}

.exists-badge {
  background: #ff9800;
  color: white;
}

.new-badge {
  background: #4caf50;
  color: white;
}

</style>

