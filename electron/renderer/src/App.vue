<template>
  <main class="layout">
    <header class="toolbar">
      <div class="left-controls">
        <button @click="openSettings">Open settings</button>
        
        <!-- USB2SNES Dropdown Button -->
        <div v-if="settings.usb2snesEnabled === 'yes'" class="usb2snes-dropdown-container">
          <button @click="toggleUsb2snesDropdown" class="usb2snes-dropdown-btn">
            <span class="dropdown-icon">🎮</span>
            <span>USB2SNES</span>
            <span class="health-indicator-mini" :class="connectionHealth"></span>
            <span class="dropdown-arrow">▼</span>
          </button>

          <div v-if="usb2snesDropdownOpen" class="usb2snes-dropdown" @click.stop>
            <!-- Status Section -->
            <div class="usb2snes-dropdown-header">
              <div class="status-indicators">
                <div class="status-item">
                  <span class="status-label">Connection:</span>
                  <span class="status-indicator" :class="usb2snesStatus.connected ? 'connected' : 'disconnected'">
                    {{ usb2snesStatus.connected ? '● Connected' : '○ Disconnected' }}
                  </span>
                </div>
                <div class="status-item">
                  <span class="status-label">Health:</span>
                  <span class="health-indicator" :class="connectionHealth">
                    {{ connectionHealth === 'green' ? '● Healthy' : connectionHealth === 'yellow' ? '● Slow' : '● Down' }}
                  </span>
                </div>
              </div>
              
              <div v-if="usb2snesStatus.connected" class="connection-info">
                <span class="info-item">{{ usb2snesStatus.device }}</span>
                <span class="info-separator">|</span>
                <span class="info-item">FW {{ usb2snesStatus.firmwareVersion }}</span>
                <span class="info-separator">|</span>
                <span class="info-item">{{ usb2snesStatus.romRunning }}</span>
              </div>
              
              <div class="dropdown-header-actions">
                <button 
                  v-if="!usb2snesStatus.connected" 
                  @click="connectUsb2snes" 
                  class="btn-primary-small">
                  Connect
                </button>
                <button 
                  v-if="usb2snesStatus.connected" 
                  @click="disconnectUsb2snes" 
                  class="btn-danger-small">
                  Disconnect
                </button>
                <button @click="openUsb2snesTools" class="btn-secondary-small">
                  USB2SNES Diagnostics
                </button>
              </div>
              
              <!-- Action Status Display -->
              <div v-if="dropdownActionStatus" class="action-status-display">
                {{ dropdownActionStatus }}
              </div>
            </div>

            <!-- Quick Actions Section -->
            <div class="usb2snes-dropdown-actions">
              <h4>Quick Actions</h4>
              <div class="action-grid">
                <button @click="reconnectUsb2snes" class="action-btn">
                  🔌 Reconnect
                </button>
                <button @click="rebootSnes" :disabled="!usb2snesStatus.connected" class="action-btn">
                  🔄 Reboot
                </button>
                <button @click="returnToMenu" :disabled="!usb2snesStatus.connected" class="action-btn">
                  🏠 Menu
                </button>
                <button @click="openUploadFileModal" class="action-btn">
                  📤 Upload
                </button>
                <button @click="openCheatsModal" :disabled="!usb2snesStatus.connected" class="action-btn">
                  ⭐ Cheats
                </button>
                <button @click="openChallengesModal" :disabled="!usb2snesStatus.connected" class="action-btn">
                  🏆 Challenges
                </button>
              </div>
            </div>

            <!-- Mini Chat Section -->
            <div class="usb2snes-dropdown-chat">
              <div class="minichat-header">
                <h4>Quick Chat</h4>
                <button @click="openFullChatModal" class="btn-link-small">Open Full Chat →</button>
              </div>
              
              <div class="minichat-log">
                <div v-for="(entry, index) in miniChatLog" :key="index" :class="['chat-entry-mini', entry.type]">
                  <span class="chat-message-mini">{{ entry.message }}</span>
                </div>
                <div v-if="miniChatLog.length === 0" class="minichat-empty">
                  Commands will appear here
                </div>
              </div>
              
              <div class="minichat-input-row">
                <input 
                  ref="miniChatInputField"
                  v-model="miniChatInput"
                  @keydown="handleMiniChatKeydown"
                  placeholder="Enter command (e.g., !lives 0x63)"
                  class="minichat-input"
                  :disabled="!usb2snesStatus.connected"
                />
                <button 
                  @click="sendMiniChatCommand" 
                  :disabled="!miniChatInput.trim() || !usb2snesStatus.connected"
                  class="btn-primary-small">
                  Go
                </button>
              </div>
            </div>
          </div>
        </div>

        <div class="filter-dropdown-container">
          <button @click="toggleFilterDropdown" class="filter-dropdown-btn" :class="{ 'has-active-filter': hasActiveFilters }">
            <span>Search/Filters</span>
            <span class="dropdown-arrow">▼</span>
            <span v-if="hasActiveFilters" class="filter-indicator">●</span>
          </button>

          <div v-if="filterDropdownOpen" class="filter-dropdown" @click.stop>
            <div class="filter-header">
              <h3>Search & Filters</h3>
              <button @click="closeFilterDropdown" class="close">✕</button>
            </div>

            <div class="filter-body">
              <div class="filter-search-row">
                <input
                  ref="filterSearchInput"
                  v-model="searchQuery"
                  type="text"
                  placeholder="Search or filter... (try: rating:>3, added:2025, Kaizo)"
                  class="filter-search-input"
                  @keydown.esc="closeFilterDropdown"
                />
                <button @click="clearFilters" :disabled="!hasActiveFilters" class="btn-clear-filter">Clear</button>
              </div>

              <div class="common-filters">
                <div class="filter-section-label">Common Filters:</div>
                <div class="filter-tags">
                  <button @click="addFilterTag('Kaizo')" class="filter-tag">Kaizo</button>
                  <button @click="addFilterTag('Standard')" class="filter-tag">Standard</button>
                  <button @click="addFilterTag('Puzzle')" class="filter-tag">Puzzle</button>
                  <button @click="addFilterTag('Troll')" class="filter-tag">Troll</button>
                  <button @click="addFilterTag('Vanilla')" class="filter-tag">Vanilla</button>
                  <button @click="addFilterTag('added:2025')" class="filter-tag">Added: 2025</button>
                  <button @click="addFilterTag('added:2024')" class="filter-tag">Added: 2024</button>
                  <button @click="addFilterTag('rating:>3')" class="filter-tag">Rating > 3</button>
                  <button @click="addFilterTag('rating:5')" class="filter-tag">Rating: 5</button>
                  <button @click="addFilterTag('rating:4')" class="filter-tag">Rating: 4</button>
                </div>
              </div>

              <div class="filter-help">
                <details>
                  <summary>Filter Syntax Guide</summary>
                  <div class="filter-help-content">
                    <p><strong>Attribute Search:</strong> <code>&lt;attribute&gt;:&lt;value&gt;</code></p>
                    <p>Examples: <code>added:2025</code>, <code>author:FuSoYa</code>, <code>name:Cave</code></p>
                    <p><strong>Rating Filters:</strong> <code>rating:5</code>, <code>rating:>3</code>, <code>rating:&lt;4</code></p>
                    <p><strong>Version Filters:</strong> <code>version:1</code> (specific), <code>version:*</code> (all versions)</p>
                    <p><em>By default, only the highest version of each game is searched.</em></p>
                  </div>
                </details>
              </div>
            </div>
          </div>
        </div>

        <div class="filter-dropdown-container">
          <button @click="toggleIgnoreDropdown" class="filter-dropdown-btn">
            <span>Ignore</span>
            <span class="dropdown-arrow">▼</span>
          </button>

          <div v-if="ignoreDropdownOpen" class="filter-dropdown simple-dropdown" @click.stop>
            <div class="simple-dropdown-body">
              <button @click="hideChecked(); closeIgnoreDropdown()" :disabled="numChecked === 0" class="dropdown-action-btn">Hide checked</button>
              <button @click="unhideChecked(); closeIgnoreDropdown()" :disabled="numChecked === 0" class="dropdown-action-btn">Unhide checked</button>
            </div>
          </div>
        </div>

        <div class="filter-dropdown-container">
          <button @click="toggleSelectDropdown" class="filter-dropdown-btn">
            <span>Select</span>
            <span class="dropdown-arrow">▼</span>
          </button>

          <div v-if="selectDropdownOpen" class="filter-dropdown simple-dropdown" @click.stop>
            <div class="simple-dropdown-body">
              <button @click="checkAllVisible(); closeSelectDropdown()" :disabled="filteredItems.length === 0" class="dropdown-action-btn">Check all</button>
              <button @click="uncheckAll(); closeSelectDropdown()" class="dropdown-action-btn">Uncheck all</button>
              <button @click="checkRandom(); closeSelectDropdown()" :disabled="filteredItems.length === 0" class="dropdown-action-btn">Check random</button>
            </div>
          </div>
        </div>

        <button @click="addSelectedToRun" :disabled="numChecked === 0">Add to Run</button>

        <label class="status-setter">
          Status for checked:
          <select v-model="bulkStatus" @change="applyBulkStatus" :disabled="numChecked === 0">
            <option value="">Select…</option>
            <option value="Default">Default</option>
            <option value="In Progress">In Progress</option>
            <option value="Finished">Finished</option>
          </select>
        </label>

        <label class="toggle">
          <input type="checkbox" v-model="showHidden" /> Show hidden
        </label>
        <label class="toggle">
          <input type="checkbox" v-model="hideFinished" /> Hide finished
        </label>
      </div>

      <div class="right-actions">
        <button @click="openRunModal">Prepare Run</button>
        <button @click="startSelected" :disabled="!canStartGames">Start</button>
        <button @click="editNotes" :disabled="!exactlyOneSelected">Edit notes</button>
        <button @click="setMyRating" :disabled="!exactlyOneSelected">My rating</button>
        
        <!-- SNES Contents Dropdown -->
        <div v-if="settings.usb2snesEnabled === 'yes'" class="snes-contents-dropdown-container">
          <button @click="toggleSnesContentsDropdown" class="snes-contents-dropdown-btn">
            📁 SNES Files
          </button>
          
          <div v-if="snesContentsDropdownOpen" class="snes-contents-dropdown" @click.stop>
            <div class="snes-contents-header">
              <h4>Files on SNES</h4>
              <label class="show-all-checkbox">
                <input type="checkbox" v-model="snesContentsShowAll" @change="refreshSnesContentsList" />
                Show All
              </label>
            </div>
            
            <div class="snes-contents-list">
              <div v-if="snesContentsList.length === 0" class="snes-contents-empty">
                No files found on SNES /work/ folder
              </div>
              
              <div 
                v-for="file in snesContentsList" 
                :key="file.id"
                :class="['snes-file-item', { 'pinned': file.pinned, 'dismissed': file.dismissed, 'launched': file.launched_yet }]"
              >
                <div class="snes-file-info">
                  <div class="snes-file-name">
                    <span class="pin-indicator" v-if="file.pinned">📌</span>
                    {{ file.filename }}
                  </div>
                  <div class="snes-file-meta">
                    <span v-if="file.gamename" class="game-name">{{ file.gamename }}</span>
                    <span v-else-if="file.gameid" class="game-id">ID: {{ file.gameid }}</span>
                    <span v-else class="unknown-file">Unknown file</span>
                    
                    <span v-if="file.upload_timestamp" class="upload-time">
                      {{ new Date(file.upload_timestamp * 1000).toLocaleString() }}
                    </span>
                  </div>
                </div>
                
                <div class="snes-file-actions">
                  <button @click="launchSnesFile(file)" class="snes-action-btn launch-btn" title="Launch">
                    🚀
                  </button>
                  <button @click="pinSnesFile(file)" :class="['snes-action-btn', 'pin-btn', { 'active': file.pinned }]" title="Pin">
                    📌
                  </button>
                  <button @click="dismissSnesFile(file)" class="snes-action-btn dismiss-btn" title="Dismiss">
                    ✖
                  </button>
                  <button 
                    v-if="file.gameid" 
                    @click="findGameInList(file)" 
                    class="snes-action-btn find-btn" 
                    title="Find Game">
                    🔍
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </header>

    <section class="content">
      <div class="table-wrapper">
        <!-- Loading indicator -->
        <div v-if="isLoading" class="loading-overlay">
          <div class="loading-spinner"></div>
          <div>Loading games from database...</div>
        </div>
        
        <!-- Error message -->
        <div v-if="loadError" class="error-message">
          <strong>Error:</strong> {{ loadError }}
          <button @click="loadGames">Retry</button>
        </div>
        
        <table class="data-table">
          <thead>
            <tr>
              <th class="col-check">
                <input type="checkbox" :checked="allVisibleChecked" @change="toggleCheckAll($event)" />
              </th>
              <th>Action</th>
              <th>Id</th>
              <th>Name</th>
              <th>Type</th>
              <th>Author</th>
              <th>Length</th>
              <th>Status</th>
              <th>My Ratings</th>
              <th>Public</th>
              <th>Hidden</th>
              <th>My notes</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in filteredItems"
              :key="row.Id"
              :class="{ hidden: row.Hidden, finished: row.Status === 'Finished' }"
              @click="rowClick(row)"
            >
              <td class="col-check">
                <input type="checkbox" :checked="selectedIds.has(row.Id)" @change="toggleMainSelection(row.Id, $event)" @click.stop />
              </td>
              <td class="action">{{ isInRun(row.Id) ? '*' : '' }}</td>
              <td>{{ row.Id }}</td>
              <td class="name" :class="{ 'in-run': isInRun(row.Id) }">{{ row.Name }}</td>
              <td>{{ row.Type }}</td>
              <td>{{ row.Author }}</td>
              <td>{{ row.Length }}</td>
              <td>{{ row.Status }}</td>
              <td>{{ formatRatings(row.MyDifficultyRating, row.MyReviewRating) }}</td>
              <td>{{ row.Publicrating ?? '' }}</td>
              <td>{{ row.Hidden ? 'Yes' : 'No' }}</td>
              <td class="notes">{{ row.Mynotes ?? '' }}</td>
            </tr>
            <tr v-if="filteredItems.length === 0">
              <td class="empty" colspan="11">No items match your filters.</td>
            </tr>
          </tbody>
        </table>
      </div>

      <aside class="sidebar">
        <div class="panel" v-if="exactlyOneSelected && selectedItem">
          <h3>Details</h3>
          <div class="panel-body details">
            <table class="kv-table">
              <tbody>
                <!-- Version Selector -->
                <tr>
                  <th>Version</th>
                  <td>
                    <select v-model="selectedVersion">
                      <option v-for="v in availableVersions" :key="v" :value="v">
                        Version {{ v }}{{ v === latestVersion ? ' (Latest)' : '' }}
                      </option>
                    </select>
                  </td>
                </tr>
                
                <!-- Official Fields (READ-ONLY) -->
                <tr><th>Id</th><td class="readonly-field">{{ selectedItem.Id }}</td></tr>
                <tr><th>Name</th><td class="readonly-field">{{ selectedItem.Name }}</td></tr>
                <tr><th>Type</th><td class="readonly-field">{{ selectedItem.Type }}</td></tr>
                <tr v-if="selectedItem.LegacyType"><th>Legacy Type</th><td class="readonly-field">{{ selectedItem.LegacyType }}</td></tr>
                <tr><th>Author</th><td class="readonly-field">{{ selectedItem.Author }}</td></tr>
                <tr><th>Length</th><td class="readonly-field">{{ selectedItem.Length }}</td></tr>
                <tr><th>Public Difficulty</th><td class="readonly-field">{{ selectedItem.PublicDifficulty || '—' }}</td></tr>
                <tr><th>Public Rating</th><td class="readonly-field">{{ selectedItem.Publicrating || '—' }}</td></tr>
                
                <!-- User-Editable Fields -->
                <tr>
                  <th>Status</th>
                  <td>
                    <select v-model="selectedItem.Status">
                      <option value="Default">Default</option>
                      <option value="In Progress">In Progress</option>
                      <option value="Finished">Finished</option>
                    </select>
                  </td>
                </tr>
                
                <!-- Dual Ratings with Star Picker (0-5 scale) -->
                <tr>
                  <th>My Difficulty</th>
                  <td>
                    <div class="star-rating">
                      <span 
                        v-for="n in 6" 
                        :key="'diff-' + (n-1)"
                        @click="selectedItem.MyDifficultyRating = n - 1"
                        :class="{ filled: (n - 1) <= (selectedItem.MyDifficultyRating ?? -1) }"
                        class="star"
                      >★</span>
                      <button @click="selectedItem.MyDifficultyRating = null" class="btn-clear-rating">✕</button>
                      <span class="rating-label">{{ difficultyLabel(selectedItem.MyDifficultyRating) }}</span>
                    </div>
                  </td>
                </tr>
                <tr>
                  <th>My Review</th>
                  <td>
                    <div class="star-rating">
                      <span 
                        v-for="n in 6" 
                        :key="'rev-' + (n-1)"
                        @click="selectedItem.MyReviewRating = n - 1"
                        :class="{ filled: (n - 1) <= (selectedItem.MyReviewRating ?? -1) }"
                        class="star"
                      >★</span>
                      <button @click="selectedItem.MyReviewRating = null" class="btn-clear-rating">✕</button>
                      <span class="rating-label">{{ reviewLabel(selectedItem.MyReviewRating) }}</span>
                    </div>
                  </td>
                </tr>
                <tr>
                  <th>My Skill Level</th>
                  <td>
                    <div class="skill-rating-container">
                      <div class="star-rating skill-rating">
                        <span 
                          v-for="n in 11" 
                          :key="'skill-' + (n-1)"
                          @click="selectedItem.MySkillRating = n - 1"
                          :class="{ filled: (n - 1) <= (selectedItem.MySkillRating ?? -1) }"
                          :title="skillRatingHoverText(n - 1)"
                          class="star star-small"
                        >★</span>
                        <button @click="selectedItem.MySkillRating = null" class="btn-clear-rating">✕</button>
                        <span class="rating-label">{{ skillLabel(selectedItem.MySkillRating) }}</span>
                      </div>
                      <div class="skill-caption" v-if="selectedItem.MySkillRating !== null && selectedItem.MySkillRating !== undefined">
                        {{ skillRatingHoverText(selectedItem.MySkillRating) }}
                      </div>
                    </div>
                  </td>
                </tr>
                
                <tr>
                  <th>Hidden</th>
                  <td><input type="checkbox" v-model="selectedItem.Hidden" /></td>
                </tr>
                <tr>
                  <th>Exclude from Random</th>
                  <td><input type="checkbox" v-model="selectedItem.ExcludeFromRandom" /></td>
                </tr>
                <tr>
                  <th>My notes</th>
                  <td><textarea v-model="selectedItem.Mynotes" rows="4"></textarea></td>
                </tr>
                
                <!-- Action Buttons -->
                <tr>
                  <td colspan="2" style="padding-top: 12px;">
                    <div class="detail-actions">
                      <button @click="setVersionSpecificRating" :disabled="isVersionSpecific">
                        {{ isVersionSpecific ? '✓ Version-Specific' : 'Set Version-Specific Rating' }}
                      </button>
                      <button @click="viewJsonDetails">View Details (JSON)</button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="panel" v-if="exactlyOneSelected && selectedItem">
          <h3>Stages</h3>
          <div class="panel-actions">
            <button @click="addStagesToRun" :disabled="selectedStageIds.size === 0">Add chosen stages to run</button>
            <button @click="editStageNotes" :disabled="selectedStageIds.size === 0">Edit notes</button>
            <button @click="setStageRating('difficulty')" :disabled="selectedStageIds.size === 0">Set Difficulty</button>
            <button @click="setStageRating('review')" :disabled="selectedStageIds.size === 0">Set Review</button>
          </div>
          <div class="panel-body stages">
            <table class="data-table">
              <thead>
                <tr>
                  <th class="col-check">
                    <input type="checkbox" :checked="allStagesChecked" @change="toggleCheckAllStages($event)" />
                  </th>
                  <th>Parent ID</th>
                  <th>Exit #</th>
                  <th>Description</th>
                  <th>Public</th>
                  <th>My Ratings</th>
                  <th>My notes</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="st in currentStages" :key="st.key">
                  <td class="col-check"><input type="checkbox" :checked="selectedStageIds.has(st.key)" @change="toggleStageSelection(st.key, $event)" /></td>
                  <td>{{ st.parentId }}</td>
                  <td>{{ st.exitNumber }}</td>
                  <td>{{ st.description }}</td>
                  <td>{{ st.publicRating ?? '' }}</td>
                  <td>{{ formatRatings(st.myDifficultyRating, st.myReviewRating) }}</td>
                  <td>{{ st.myNotes ?? '' }}</td>
                </tr>
                <tr v-if="currentStages.length === 0">
                  <td class="empty" colspan="7">No stages.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="panel" v-if="!exactlyOneSelected">
          <h3>Details</h3>
          <div class="panel-body">Select a single item to view details and stages.</div>
        </div>
      </aside>
    </section>
  </main>
  
  <!-- Prepare Run Modal -->
  <div v-if="runModalOpen" class="modal-backdrop" @click.self="closeRunModal">
    <div class="modal">
      <header class="modal-header">
        <h3>{{ isRunActive ? 'Active Run' : 'Prepare Run' }}{{ currentRunName ? ': ' + currentRunName : '' }}</h3>
        <div class="modal-header-actions">
          <!-- Preparing state -->
          <template v-if="!isRunActive">
            <button @click="editGlobalConditions" class="btn-conditions-header" :title="`Global Conditions: ${globalRunConditions.length > 0 ? globalRunConditions.join(', ') : 'None'}`">
              {{ globalRunConditions.length > 0 ? `✓ Global Conditions (${globalRunConditions.length})` : 'Set Global Conditions' }}
            </button>
            <button @click="exportRunToFile" :disabled="!isRunSaved">📤 Export</button>
            <button @click="importRunFromFile">📥 Import</button>
            <button @click="stageRun('save')" :disabled="runEntries.length === 0">Stage and Save</button>
            <button @click="startRun" :disabled="!isRunSaved" class="btn-start-run">▶ Start Run</button>
          </template>
          <!-- Active state -->
          <template v-if="isRunActive">
            <span class="run-timer">⏱ {{ formatTime(runElapsedSeconds) }}</span>
            <span class="pause-time" v-if="runPauseSeconds > 0">⏸ {{ formatTime(runPauseSeconds) }}</span>
            <span class="run-progress">Challenge {{ currentChallengeIndex + 1 }} / {{ runEntries.length }}</span>
            <button @click="pauseRun" v-if="!isRunPaused" class="btn-pause">⏸ Pause</button>
            <button @click="unpauseRun" v-if="isRunPaused" class="btn-unpause">▶ Unpause</button>
            <button @click="undoChallenge" :disabled="!canUndo || isRunPaused" class="btn-back">↶ Back</button>
            <button @click="nextChallenge" :disabled="!currentChallenge || isRunPaused" class="btn-next">✓ Done</button>
            <button @click="launchCurrentChallenge" v-if="currentChallenge && currentChallengeSfcPath" :disabled="isRunPaused" class="btn-launch" :title="`Launch challenge ${String(currentChallengeIndex + 1).padStart(2, '0')} on USB2SNES`">🚀 Launch {{ String(currentChallengeIndex + 1).padStart(2, '0') }}</button>
            <button @click="skipChallenge" :disabled="!currentChallenge || isRunPaused" class="btn-skip">⏭ Skip</button>
            <button @click="cancelRun" class="btn-cancel-run">✕ Cancel Run</button>
          </template>
          <button class="close" @click="closeRunModal">✕</button>
        </div>
      </header>

      <!-- Toolbar only shown when preparing -->
      <section v-if="!isRunActive" class="modal-toolbar">
        <div class="left">
          <button @click="checkAllRun">Check All</button>
          <button @click="uncheckAllRun">Uncheck All</button>
          <button @click="removeCheckedRun" :disabled="checkedRunCount === 0">Remove</button>
          <button @click="moveCheckedUp" :disabled="!canMoveCheckedUp">↑ Move Up</button>
          <button @click="moveCheckedDown" :disabled="!canMoveCheckedDown">↓ Move Down</button>
        </div>
        <div class="right add-random">
          <label>
            Filter Type
            <select v-model="randomFilter.type">
              <option value="any">Any</option>
              <option v-for="type in randomFilterValues.types" :key="type" :value="type">{{ type }}</option>
            </select>
          </label>
          <label>
            Difficulty
            <select v-model="randomFilter.difficulty">
              <option value="any">Any</option>
              <option v-for="diff in randomFilterValues.difficulties" :key="diff" :value="diff">{{ diff }}</option>
            </select>
          </label>
          <input class="pattern" v-model="randomFilter.pattern" type="text" placeholder="Optional filter pattern" />
          <label>
            Count
            <input class="count" v-model.number="randomFilter.count" type="number" min="1" max="100" />
          </label>
          <label>
            Seed
            <input class="seed" v-model="randomFilter.seed" type="text" placeholder="Auto-generated" />
          </label>
          <button @click="regenerateSeed" title="Generate new random seed">🎲</button>
          <button @click="addRandomGameToRun" :disabled="!isRandomAddValid">Add Random Game</button>
          <span v-if="randomMatchCount !== null" class="match-count-indicator" :class="{ 'insufficient': randomMatchCountError }">
            {{ randomMatchCount }} games match
            <span v-if="randomMatchCountError" class="error-text"> (need {{ (randomFilter.count || 0) + 2 }}+)</span>
          </span>
        </div>
      </section>

      <section class="modal-body">
        <div class="table-wrapper">
          <table class="data-table">
            <thead>
              <tr>
                <th class="col-check">
                  <input type="checkbox" :checked="allRunChecked" @change="toggleCheckAllRun($event)" />
                </th>
                <th class="col-seq">#</th>
                <th v-if="isRunActive" class="col-status">Status</th>
                <th v-if="isRunActive" class="col-duration">Time</th>
                <th class="col-actions">Actions</th>
                <th>ID</th>
                <th>Entry Type</th>
                <th>Name</th>
                <th>Stage #</th>
                <th>Stage name</th>
                <th class="col-count">Count</th>
                <th>Filter difficulty</th>
                <th>Filter type</th>
              <th class="col-pattern">Filter pattern</th>
              <th class="col-matches">Matches</th>
              <th class="col-seed">Seed</th>
              <th class="col-conditions">Conditions</th>
            </tr>
          </thead>
          <tbody>
              <tr 
                v-for="(entry, idx) in runEntries" 
                :key="entry.key"
                :draggable="!isRunActive"
                @dragstart="handleDragStart(idx, $event)"
                @dragover.prevent="handleDragOver(idx, $event)"
                @drop="handleDrop(idx, $event)"
                @dragend="handleDragEnd"
                :class="{ 
                  'dragging': draggedIndex === idx,
                  'current-challenge': isRunActive && idx === currentChallengeIndex
                }"
              >
                <td class="col-check">
                  <input type="checkbox" :checked="checkedRun.has(entry.key)" @change="toggleRunEntrySelection(entry.key, $event)" :disabled="isRunActive" />
                </td>
                <td class="col-seq">{{ idx + 1 }}</td>
                <td v-if="isRunActive" class="col-status" :class="getChallengeStatusClass(idx)">
                  <span class="status-icon">{{ getChallengeStatusIcon(idx) }}</span>
                </td>
                <td v-if="isRunActive" class="col-duration">
                  {{ getChallengeDuration(idx) }}
                </td>
                <td class="col-actions">
                  <button class="btn-mini" @click="moveRowUp(idx)" :disabled="isRunActive || idx === 0" title="Move up">↑</button>
                  <button class="btn-mini" @click="moveRowDown(idx)" :disabled="isRunActive || idx === runEntries.length - 1" title="Move down">↓</button>
                </td>
                <td>{{ entry.id }}</td>
                <td>
                  <span class="readonly-text">
                    {{ entry.entryType === 'game' ? 'Game' : 
                       entry.entryType === 'stage' ? 'Stage' : 
                       entry.entryType === 'random_game' ? 'Random Game' : 
                       entry.entryType === 'random_stage' ? 'Random Stage' : entry.entryType }}
                  </span>
                </td>
                <td>{{ entry.name }}</td>
                <td>{{ entry.stageNumber ?? '' }}</td>
                <td>{{ entry.stageName ?? '' }}</td>
                <td class="col-count">
                  <input 
                    type="number" 
                    min="1" 
                    :max="isRandomEntry(entry) && entry.matchCount ? entry.matchCount - 2 : undefined"
                    v-model.number="entry.count" 
                    :disabled="isRunActive" 
                    :title="isRandomEntry(entry) && entry.matchCount ? `Max: ${entry.matchCount - 2} (${entry.matchCount} matches - 2)` : ''"
                  />
                </td>
                <td v-if="isRandomEntry(entry)">
                  <span class="readonly-text">{{ entry.filterDifficulty || '—' }}</span>
                </td>
                <td v-else>—</td>
                <td v-if="isRandomEntry(entry)">
                  <span class="readonly-text">{{ entry.filterType || '—' }}</span>
                </td>
                <td v-else>—</td>
                <td class="col-pattern" v-if="isRandomEntry(entry)">
                  <span class="readonly-text">{{ entry.filterPattern || '—' }}</span>
                </td>
                <td class="col-pattern" v-else>—</td>
                <td class="col-matches" v-if="isRandomEntry(entry)">
                  <span class="match-count-display" :class="{ 'insufficient': entry.matchCount && entry.matchCount < (entry.count || 0) + 2 }">
                    {{ entry.matchCount !== null && entry.matchCount !== undefined ? entry.matchCount : '?' }}
                  </span>
                </td>
                <td class="col-matches" v-else>—</td>
                <td class="col-seed" v-if="isRandomEntry(entry)"><input v-model="entry.seed" :disabled="isRunActive" /></td>
                <td class="col-seed" v-else>—</td>
                <td class="col-conditions">
                  <button @click="editConditions(entry)" class="btn-mini btn-conditions" :disabled="isRunActive" :title="`Conditions: ${Array.isArray(entry.conditions) && entry.conditions.length > 0 ? entry.conditions.join(', ') : 'None'}`">
                    {{ Array.isArray(entry.conditions) && entry.conditions.length > 0 ? `✓ (${entry.conditions.length})` : 'Set' }}
                  </button>
                </td>
              </tr>
              <tr v-if="runEntries.length === 0">
                <td class="empty" colspan="14">Run is empty. Add entries or use Add Random Game.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  </div>

  <!-- JSON Details Modal -->
  <div v-if="jsonModalOpen" class="modal-backdrop" @click.self="closeJsonModal">
    <div class="modal json-modal">
      <header class="modal-header">
        <h3>Game Details (JSON)</h3>
        <button class="close" @click="closeJsonModal">✕</button>
      </header>
      <section class="modal-body json-body">
        <pre>{{ jsonDetailsContent }}</pre>
      </section>
      <footer class="modal-footer">
        <button @click="closeJsonModal">Close</button>
      </footer>
    </div>
  </div>

  <!-- Settings Modal -->
  <div v-if="settingsModalOpen" class="modal-backdrop" @click.self="closeSettings">
    <div class="modal settings-modal">
      <header class="modal-header">
        <h3>Settings</h3>
        <button class="close" @click="closeSettings">✕</button>
      </header>

      <section class="modal-body settings-body">
        <!-- Theme Setting -->
        <div class="settings-section">
          <div class="setting-row">
            <label class="setting-label">
              Theme
            </label>
            <div class="setting-control">
              <select v-model="settings.theme" @change="onThemeChange">
                <option value="light">Light Theme</option>
                <option value="dark">Dark</option>
                <option value="onyx">Onyx (Black & Gray)</option>
                <option value="ash">Ash (Mid-Gray)</option>
              </select>
            </div>
          </div>
          <div class="setting-caption">
            Choose your preferred color scheme. Changes apply immediately.
          </div>
        </div>

        <!-- Text Size Setting -->
        <div class="settings-section">
          <div class="setting-row">
            <label class="setting-label">
              Text Size
            </label>
            <div class="setting-control">
              <input 
                type="range" 
                v-model.number="textSizeSliderValue" 
                @input="onTextSizeChange"
                min="0" 
                max="3" 
                step="1" 
                class="text-size-slider"
              />
              <span class="text-size-label">{{ getTextSizeDisplayName(settings.textSize) }}</span>
            </div>
          </div>
          <div class="setting-caption">
            Adjust the text size throughout the application.
          </div>
        </div>

        <div class="settings-section">
          <div class="setting-row">
            <label class="setting-label">
              <span class="status-icon">{{ settings.vanillaRomValid ? '✓' : '' }}</span>
              Import required Vanilla SMW ROM
            </label>
            <div class="setting-control">
              <div 
                class="drop-zone"
                @dragover.prevent
                @drop.prevent="handleRomDrop"
              >
                Drag ROM file here
              </div>
              <button @click="browseRomFile">Browse</button>
            </div>
          </div>
          <div v-if="settings.vanillaRomPath" class="setting-current-path">
            Current: <code>{{ settings.vanillaRomPath }}</code>
          </div>
          <div class="setting-caption">
            You must have a legally-obtained SMW SFC file that you are authorized to play with, required to proceed.<br>
            The acceptable file has a sha224 sum of <code>fdc4c00e09a8e08d395003e9c8a747f45a9e5e94cbfedc508458eb08</code><br>
            OR sha-1: <code>6b47bb75d16514b6a476aa0c73a683a2a4c18765</code>, Or Md5: <code>cdd3c8c37322978ca8669b34bc89c804</code>
          </div>
        </div>

        <div class="settings-section">
          <div class="setting-row">
            <label class="setting-label">
              <span class="status-icon">{{ settings.flipsValid ? '✓' : '' }}</span>
              Import FLIPS executable
            </label>
            <div class="setting-control">
              <div 
                class="drop-zone"
                @dragover.prevent
                @drop.prevent="handleFlipsDrop"
              >
                Drag FLIPS file here
              </div>
              <button @click="browseFlipsFile">Browse</button>
            </div>
          </div>
          <div v-if="settings.flipsPath" class="setting-current-path">
            Current: <code>{{ settings.flipsPath }}</code>
          </div>
          <div class="setting-caption">
            Floating IPS <a href="https://www.gamebrew.org/wiki/Floating_IPS" target="_blank">https://www.gamebrew.org/wiki/Floating_IPS</a>
          </div>
        </div>

        <div class="settings-section">
          <div class="setting-row">
            <label class="setting-label">Game launch method</label>
            <div class="setting-control">
              <select v-model="settings.launchMethod">
                <option value="manual">Launch Manually</option>
                <option value="program">Run Launch Program</option>
                <option value="usb2snes">Launch from USB2Snes</option>
              </select>
            </div>
          </div>
        </div>

        <div class="settings-section">
          <div class="setting-row">
            <label class="setting-label">Launch Program</label>
            <div class="setting-control">
              <div 
                class="drop-zone"
                @dragover.prevent
                @drop.prevent="handleLaunchProgramDrop"
              >
                Drag program file here
              </div>
              <button @click="browseLaunchProgram">Browse</button>
            </div>
          </div>
          <div v-if="settings.launchProgram" class="setting-current-path">
            Current: <code>{{ settings.launchProgram }}</code>
          </div>
        </div>

        <div class="settings-section">
          <div class="setting-row">
            <label class="setting-label">Launch Program Arguments</label>
            <div class="setting-control">
              <input type="text" v-model="settings.launchProgramArgs" />
            </div>
          </div>
        </div>

        <div class="settings-section">
          <div class="setting-row">
            <label class="setting-label">Default usb2snes library</label>
            <div class="setting-control">
              <select v-model="settings.usb2snesLibrary">
                <option value="usb2snes_a">usb2snes_a (Type A - Python port)</option>
                <option value="usb2snes_b">usb2snes_b (Type B - 3rd party JS)</option>
                <option value="qusb2snes">Qusb2snes (Local server)</option>
                <option value="node-usb">node-usb (Direct hardware)</option>
              </select>
            </div>
          </div>
        </div>

        <div class="settings-section">
          <div class="setting-row">
            <label class="setting-label">USB2snes Websocket address</label>
            <div class="setting-control">
              <input type="text" v-model="settings.usb2snesAddress" />
            </div>
          </div>
          <div class="setting-caption warning">
            ⚠ USB2SNES launch requires a USB2SNES server running. <a href="https://usb2snes.com/" target="_blank">https://usb2snes.com/</a>
          </div>
        </div>

        <div class="settings-section">
          <div class="setting-row">
            <label class="setting-label">USB2SNES Enabled</label>
            <div class="setting-control">
              <select v-model="settings.usb2snesEnabled">
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </div>
          </div>
        </div>

        <div class="settings-section">
          <div class="setting-row">
            <label class="setting-label">USB2SNES Launch Preference</label>
            <div class="setting-control">
              <select v-model="settings.usb2snesLaunchPref">
                <option value="auto">Launch Automatically</option>
                <option value="manual">Manual Launch (Do nothing)</option>
                <option value="reset">Manual Launch (Reset console)</option>
              </select>
            </div>
          </div>
        </div>

        <div class="settings-section">
          <div class="setting-row">
            <label class="setting-label">USB2SNES Upload Preference</label>
            <div class="setting-control">
              <select v-model="settings.usb2snesUploadPref">
                <option value="manual">Manual Transfer (do not upload)</option>
                <option value="check">Check first and Upload</option>
                <option value="always">Always Upload</option>
              </select>
            </div>
          </div>
        </div>

        <div class="settings-section">
          <div class="setting-row">
            <label class="setting-label">USB2SNES Upload Directory</label>
            <div class="setting-control">
              <input type="text" v-model="settings.usb2snesUploadDir" />
            </div>
          </div>
        </div>

        <div class="settings-section">
          <div class="setting-row">
            <label class="setting-label">
              <span class="status-icon">{{ settings.asarValid ? '✓' : '' }}</span>
              Import ASAR executable
            </label>
            <div class="setting-control">
              <div 
                class="drop-zone"
                @dragover.prevent
                @drop.prevent="handleAsarDrop"
              >
                Drag ASAR file here
              </div>
              <button @click="browseAsarFile">Browse</button>
            </div>
          </div>
          <div v-if="settings.asarPath" class="setting-current-path">
            Current: <code>{{ settings.asarPath }}</code>
          </div>
          <div class="setting-caption">
            Download ASAR from <a href="https://smwc.me/s/37443" target="_blank">https://smwc.me/s/37443</a>
          </div>
        </div>

        <div class="settings-section">
          <div class="setting-row">
            <label class="setting-label">
              <span class="status-icon">{{ settings.uberAsmValid ? '✓' : '' }}</span>
              Import UberASM executable
            </label>
            <div class="setting-control">
              <div 
                class="drop-zone"
                @dragover.prevent
                @drop.prevent="handleUberAsmDrop"
              >
                Drag UberASM file here
              </div>
              <button @click="browseUberAsmFile">Browse</button>
            </div>
          </div>
          <div v-if="settings.uberAsmPath" class="setting-current-path">
            Current: <code>{{ settings.uberAsmPath }}</code>
          </div>
          <div class="setting-caption">
            Download UberASM from <a href="https://smwc.me/s/39036" target="_blank">https://smwc.me/s/39036</a>
          </div>
        </div>

        <div class="settings-section">
          <div class="setting-row">
            <label class="setting-label">
              <span class="status-icon">{{ settings.tempDirValid ? '✓' : '✗' }}</span>
              Temporary Directory Override
            </label>
            <div class="setting-control">
              <input type="text" v-model="settings.tempDirOverride" placeholder="Leave blank for OS default temp dir" />
            </div>
          </div>
          <div v-if="settings.tempDirOverride" class="setting-current-path">
            Current: <code>{{ settings.tempDirOverride }}</code>
          </div>
          <div class="setting-caption">
            Optional: Override the base path for temporary directories used by RHTools.<br>
            Leave blank to use the OS-specific temporary directory. If specified, the path must exist.
          </div>
        </div>
      </section>

      <footer class="modal-footer">
        <button @click="saveSettings" class="btn-primary">Save Changes and Close</button>
      </footer>
    </div>
  </div>

  <!-- USB2SNES Tools Modal -->
  <div v-if="usb2snesToolsModalOpen" class="modal-backdrop" @click.self="closeUsb2snesTools">
    <div class="modal usb2snes-tools-modal">
      <header class="modal-header">
        <h3>USB2SNES Tools & Diagnostics</h3>
        <button class="close" @click="closeUsb2snesTools">✕</button>
      </header>

      <div class="modal-body">
        <div class="usb2snes-section">
          <h4>USB2SNES Implementation</h4>
          <div class="status-row">
            <label>USB2SNES Library:</label>
            <select v-model="usb2snesCurrentLibrary" :disabled="usb2snesStatus.connected" class="usb2snes-library-select">
              <option value="usb2snes_a">usb2snes_a (Type A - Python port)</option>
              <option value="usb2snes_b">usb2snes_b (Type B - 3rd party JS)</option>
              <option value="qusb2snes">Qusb2snes (Local server)</option>
              <option value="node-usb">node-usb (Direct hardware)</option>
            </select>
          </div>
          <div v-if="usb2snesStatus.connected" class="setting-caption warning">
            ⚠ Disconnect to change library implementation
          </div>
        </div>

        <div class="usb2snes-section">
          <h4>Connection Status</h4>
          <div class="status-row">
            <label>WebSocket Address:</label>
            <code>{{ settings.usb2snesAddress }}</code>
          </div>
          <div class="status-row">
            <label>Connection Status:</label>
            <span :class="['status-indicator', usb2snesStatus.connected ? 'connected' : 'disconnected']">
              {{ usb2snesStatus.connected ? '✓ Connected' : '✗ Disconnected' }}
            </span>
          </div>
          <div class="status-row">
            <label>Device:</label>
            <span>{{ usb2snesStatus.device || 'N/A' }}</span>
          </div>
          <div v-if="usb2snesStatus.connected" class="status-row">
            <label>Firmware:</label>
            <span>{{ usb2snesStatus.firmwareVersion || 'N/A' }}</span>
          </div>
          <div v-if="usb2snesStatus.connected" class="status-row">
            <label>Version String:</label>
            <span>{{ usb2snesStatus.versionString || 'N/A' }}</span>
          </div>
          <div v-if="usb2snesStatus.connected" class="status-row">
            <label>ROM Running:</label>
            <span>{{ usb2snesStatus.romRunning || 'N/A' }}</span>
          </div>
          <div class="action-buttons">
            <button v-if="!usb2snesStatus.connected" @click="connectUsb2snes" class="btn-primary">Connect</button>
            <button v-if="usb2snesStatus.connected" @click="disconnectUsb2snes" class="btn-danger">Disconnect</button>
          </div>
          <div v-if="usb2snesStatus.connected" class="create-dir-row">
            <button @click="createUploadDirectory" class="btn-secondary">Create Required Upload Directory</button>
            <span class="dir-caption">Will create: <code>{{ settings.usb2snesUploadDir }}</code></span>
          </div>
        </div>

        <div class="usb2snes-section">
          <h4>Upload Settings</h4>
          <div class="status-row">
            <label>Upload Directory:</label>
            <code>{{ settings.usb2snesUploadDir }}</code>
          </div>
          <div class="status-row">
            <label>Upload Preference:</label>
            <span>{{ settings.usb2snesUploadPref }}</span>
          </div>
          <div class="status-row">
            <label>Launch Preference:</label>
            <span>{{ settings.usb2snesLaunchPref }}</span>
          </div>
        </div>

        <div class="usb2snes-section">
          <h4>Diagnostics</h4>
          <div class="diagnostic-info">
            <p><strong>Last Connection Attempt:</strong> {{ usb2snesStatus.lastAttempt || 'Never' }}</p>
            <p><strong>Last Error:</strong> {{ usb2snesStatus.lastError || 'None' }}</p>
          </div>
          <button @click="clearUsb2snesErrors" class="btn-secondary">Clear Error Log</button>
        </div>

        <div class="usb2snes-section">
          <h4>Console Control</h4>
          <div class="debug-status" style="padding: 8px; background: #2a2a2a; border: 1px solid #444; border-radius: 4px; margin-bottom: 12px; font-family: monospace; font-size: 12px;">
            <strong>Debug Status:</strong> connected={{ usb2snesStatus.connected }}, device={{ usb2snesStatus.device }}
          </div>
          <div class="action-buttons">
            <button @click="rebootSnes" :disabled="!usb2snesStatus.connected" class="btn-secondary">Reboot SNES</button>
            <button @click="returnToMenu" :disabled="!usb2snesStatus.connected" class="btn-secondary">Return to Menu</button>
          </div>
        </div>

        <div class="usb2snes-section">
          <h4>SMW Quick Actions</h4>
          <div class="action-buttons">
            <button @click="grantCape" :disabled="!usb2snesStatus.connected" class="btn-secondary">Grant Cape</button>
            <button @click="startTimerChallenge" :disabled="!usb2snesStatus.connected" class="btn-secondary">Timer Challenge (60s)</button>
          </div>
        </div>

        <div class="usb2snes-section">
          <h4>File Upload</h4>
          <div class="file-upload-section">
            <input 
              type="file" 
              ref="usb2snesFileInput" 
              @change="handleFileSelect"
              accept=".sfc,.smc,.bin"
              style="display: none"
            />
            <div class="file-upload-row">
              <button @click="selectFileToUpload" class="btn-secondary">Select File</button>
              <span v-if="selectedFile" class="selected-file">{{ selectedFile.name }} ({{ formatFileSize(selectedFile.size) }})</span>
              <span v-else class="no-file">No file selected</span>
            </div>
            <button 
              @click="uploadFile" 
              :disabled="!usb2snesStatus.connected || !selectedFile || selectedFile.size > 15 * 1024 * 1024" 
              class="btn-primary"
            >
              Upload to /work
            </button>
            <div v-if="selectedFile && selectedFile.size > 15 * 1024 * 1024" class="setting-caption warning">
              ⚠ File too large (max 15 MB)
            </div>
          </div>
        </div>

        <div class="usb2snes-section">
          <h4>Chat Commands (Chat Hacks + CARL)</h4>
          <div class="chat-section">
            <!-- Chat Log -->
            <div class="chat-log" ref="chatLogContainer">
              <div v-for="(entry, index) in chatLog" :key="index" :class="['chat-entry', entry.type]">
                <span class="chat-timestamp">{{ entry.timestamp }}</span>
                <span class="chat-message">{{ entry.message }}</span>
              </div>
              <div v-if="chatLog.length === 0" class="chat-empty">
                Chat command log will appear here
              </div>
            </div>
            
            <!-- Chat Input -->
            <div class="chat-input-row">
              <input 
                type="text" 
                v-model="chatInput" 
                @keydown="handleChatKeydown"
                @keydown.enter="sendChatCommand"
                placeholder="Enter chat command (e.g., !powerup 0x02, !w 0x7E0DBE 0x63)"
                class="chat-input"
                ref="chatInputField"
              />
              <button @click="sendChatCommand" :disabled="!chatInput.trim()" class="btn-primary">Go</button>
            </div>
            
            <!-- Quick Help -->
            <div class="chat-help">
              <button @click="showCommandHelp = true" class="btn-secondary" style="width: 100%;">
                📖 Show All Commands
              </button>
              <p style="font-size: 11px; color: #888; margin-top: 4px; text-align: center;">
                <em>Press Up/Down arrows to navigate command history</em>
              </p>
            </div>
            
            <!-- Loaded Modules -->
            <div v-if="loadedModules.length > 0" class="loaded-modules">
              <strong>Loaded CARL Modules ({{ loadedModules.length }}):</strong>
              <div class="module-list">
                <div v-for="mod in loadedModules" :key="mod.name" class="module-item">
                  {{ mod.name }} <span class="module-addr">({{ mod.addressHex }}, {{ mod.size }}B)</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="usb2snes-section">
          <h4>Diagnostics</h4>
          <div class="action-buttons">
            <button @click="resetUsb2snesConnection" class="btn-secondary">Reset Connection</button>
            <button @click="openUsb2snesWebsite" class="btn-secondary">Open USB2SNES Website</button>
          </div>
        </div>
      </div>

      <footer class="modal-footer">
        <button @click="closeUsb2snesTools" class="btn-primary">Close</button>
      </footer>
    </div>
  </div>

  <!-- Command Help Modal -->
  <div v-if="showCommandHelp" class="modal-backdrop" @click.self="showCommandHelp = false">
    <div class="modal command-help-modal">
      <header class="modal-header">
        <h3>📖 Chat Commands Reference</h3>
        <button @click="showCommandHelp = false" class="btn-close">×</button>
      </header>

      <div class="modal-body">
        <div class="command-help-content">
          <!-- General Commands -->
          <section class="help-section">
            <h4>🔧 General Commands</h4>
            <div class="command-list">
              <div class="command-item">
                <code>!w ADDRESS VALUE [ADDRESS VALUE ...]</code>
                <p>Write byte value(s) to memory address(es)</p>
                <p class="example">Example: <code>!w 0x7E0DBE 0x63</code> - Set lives to 99</p>
              </div>
              <div class="command-item">
                <code>!r ADDRESS [ADDRESS ...]</code>
                <p>Read byte value(s) from memory address(es)</p>
                <p class="example">Example: <code>!r 0x7E0019</code> - Read powerup status</p>
              </div>
              <div class="command-item">
                <code>!read ADDRESS</code>
                <p>Alias for !r - Read from memory</p>
              </div>
            </div>
          </section>

          <!-- CARL Module Commands -->
          <section class="help-section">
            <h4>📦 CARL Module Commands</h4>
            <div class="command-list">
              <div class="command-item">
                <code>!load MODULE_NAME</code>
                <p>Load an ASM module from /work/carl/</p>
                <p class="example">Example: <code>!load moonjump</code></p>
              </div>
              <div class="command-item">
                <code>!unload MODULE_NAME</code>
                <p>Unload a loaded ASM module</p>
              </div>
              <div class="command-item">
                <code>!reload MODULE_NAME</code>
                <p>Reload an ASM module (unload + load)</p>
              </div>
            </div>
          </section>

          <!-- Pseudocommands / Aliases -->
          <section class="help-section">
            <h4>⚡ Pseudocommands (Quick Aliases)</h4>
            <p class="section-description">These are shortcuts for common memory addresses. Format: <code>!command VALUE</code></p>
            
            <div class="help-subsection">
              <h5>👤 Player Status</h5>
              <div class="command-grid">
                <div class="command-item-compact">
                  <code>!powerup</code>
                  <span>0x7E0019 - Powerup (0=small, 1=big, 2=cape, 3=fire)</span>
                </div>
                <div class="command-item-compact">
                  <code>!lives</code>
                  <span>0x7E0DBE - Number of lives</span>
                </div>
                <div class="command-item-compact">
                  <code>!coins</code>
                  <span>0x7E0DBF - Coin count</span>
                </div>
                <div class="command-item-compact">
                  <code>!reserve_item</code>
                  <span>0x7E0DC2 - Item in reserve box</span>
                </div>
                <div class="command-item-compact">
                  <code>!vx</code>
                  <span>0x7E007B - Mario velocity X</span>
                </div>
                <div class="command-item-compact">
                  <code>!vy</code>
                  <span>0x7E007D - Mario velocity Y</span>
                </div>
              </div>
            </div>

            <div class="help-subsection">
              <h5>⏱️ Timers</h5>
              <div class="command-grid">
                <div class="command-item-compact">
                  <code>!star_timer</code>
                  <span>0x7E1490 - Star invincibility timer</span>
                </div>
                <div class="command-item-compact">
                  <code>!keyhole_timer</code>
                  <span>0x7E1434 - Keyhole entry timer</span>
                </div>
                <div class="command-item-compact">
                  <code>!end_level_timer</code>
                  <span>0x7E1493 - Level end sequence timer</span>
                </div>
                <div class="command-item-compact">
                  <code>!pswitch_blue_timer</code>
                  <span>0x7E14AD - Blue P-switch timer</span>
                </div>
                <div class="command-item-compact">
                  <code>!invulnerability_timer</code>
                  <span>0x7E1497 - Post-damage invulnerability</span>
                </div>
                <div class="command-item-compact">
                  <code>!sparkle_timer</code>
                  <span>0x7E18D3 - Sparkle animation timer</span>
                </div>
              </div>
            </div>

            <div class="help-subsection">
              <h5>🦖 Yoshi</h5>
              <div class="command-grid">
                <div class="command-item-compact">
                  <code>!yoshi_color</code>
                  <span>0x7E13C7 - Yoshi color</span>
                </div>
                <div class="command-item-compact">
                  <code>!is_riding_yoshi</code>
                  <span>0x7E187A - Riding Yoshi flag</span>
                </div>
                <div class="command-item-compact">
                  <code>!yoshi_egg_sprite</code>
                  <span>0x7E18DA - Yoshi egg sprite slot</span>
                </div>
                <div class="command-item-compact">
                  <code>!yoshi_egg_timer</code>
                  <span>0x7E18DE - Yoshi egg hatch timer</span>
                </div>
              </div>
            </div>

            <div class="help-subsection">
              <h5>🎮 Control & Effects</h5>
              <div class="command-grid">
                <div class="command-item-compact">
                  <code>!freeze_everything</code>
                  <span>0x7E13FD - Freeze all sprites (1=freeze, 0=unfreeze)</span>
                </div>
                <div class="command-item-compact">
                  <code>!is_paused</code>
                  <span>0x7E13D4 - Pause game flag</span>
                </div>
                <div class="command-item-compact">
                  <code>!p_meter</code>
                  <span>0x7E13E4 - P-meter value</span>
                </div>
                <div class="command-item-compact">
                  <code>!mode</code>
                  <span>0x7E0100 - Game mode</span>
                </div>
                <div class="command-item-compact">
                  <code>!can_climb_on_air</code>
                  <span>0x7E18BE - Air climbing flag</span>
                </div>
                <div class="command-item-compact">
                  <code>!disable_ground_collision</code>
                  <span>0x7E185C - Walk through ground</span>
                </div>
              </div>
            </div>

            <div class="help-subsection">
              <h5>🗺️ Level Properties</h5>
              <div class="command-grid">
                <div class="command-item-compact">
                  <code>!is_water_level</code>
                  <span>0x7E0085 - Water level flag</span>
                </div>
                <div class="command-item-compact">
                  <code>!slippery_amount</code>
                  <span>0x7E0086 - Floor slipperiness</span>
                </div>
                <div class="command-item-compact">
                  <code>!scroll_mode</code>
                  <span>0x7E143E - Camera scroll mode</span>
                </div>
                <div class="command-item-compact">
                  <code>!can_scroll</code>
                  <span>0x7E1411 - Enable/disable scrolling</span>
                </div>
              </div>
            </div>

            <div class="help-subsection">
              <h5>🎨 Visual Effects</h5>
              <div class="command-grid">
                <div class="command-item-compact">
                  <code>!screen_display_value</code>
                  <span>0x7E0DAE - Screen brightness</span>
                </div>
                <div class="command-item-compact">
                  <code>!mosaic_value</code>
                  <span>0x7E0DB0 - Mosaic effect intensity</span>
                </div>
                <div class="command-item-compact">
                  <code>!layer_1_shake_timer</code>
                  <span>0x7E1887 - Screen shake timer</span>
                </div>
                <div class="command-item-compact">
                  <code>!transition_stars</code>
                  <span>0x7E13CB - Star transition count</span>
                </div>
              </div>
            </div>

            <div class="help-subsection">
              <h5>🎵 Multiplayer & Misc</h5>
              <div class="command-grid">
                <div class="command-item-compact">
                  <code>!is_multiplayer</code>
                  <span>0x7E0DB2 - Multiplayer mode flag</span>
                </div>
                <div class="command-item-compact">
                  <code>!is_player2</code>
                  <span>0x7E0DB3 - Player 2 active flag</span>
                </div>
                <div class="command-item-compact">
                  <code>!music_dispatch</code>
                  <span>0x7E1DFB - Music track selector</span>
                </div>
                <div class="command-item-compact">
                  <code>!message_box_dispatch</code>
                  <span>0x7E1426 - Message box trigger</span>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>

      <footer class="modal-footer">
        <button @click="showCommandHelp = false" class="btn-primary">Close</button>
      </footer>
    </div>
  </div>

  <!-- Upload Progress Modal -->
  <div v-if="uploadProgressModalOpen" class="modal-backdrop upload-progress-backdrop">
    <div class="modal upload-progress-modal">
      <header class="modal-header">
        <h3>Uploading File</h3>
      </header>

      <div class="modal-body">
        <div class="upload-progress-content">
          <div class="upload-file-info">
            <strong>Destination:</strong> {{ uploadedFilePath }}
          </div>
          
          <div class="progress-bar-container">
            <div class="progress-bar-fill" :style="{ width: uploadProgressPercent + '%' }"></div>
            <div class="progress-bar-text">{{ uploadProgressPercent }}%</div>
          </div>
          
          <div class="upload-status" :class="{ 'success': uploadSuccess, 'error': !uploadSuccess && uploadProgressStatus.includes('failed') }">
            {{ uploadProgressStatus }}
          </div>
        </div>
      </div>

      <footer class="modal-footer">
        <button @click="closeUploadProgress" class="btn-secondary">Close</button>
        <button 
          v-if="uploadSuccess" 
          @click="launchUploadedFile" 
          class="btn-primary"
        >
          Launch File on SNES
        </button>
      </footer>
    </div>
  </div>

  <!-- Upload File Modal (standalone) -->
  <div v-if="uploadFileModalOpen" class="modal-backdrop" @click.self="closeUploadFileModal">
    <div class="modal upload-file-modal">
      <header class="modal-header">
        <h3>📤 Upload File to SNES</h3>
        <button @click="closeUploadFileModal" class="btn-close">×</button>
      </header>

      <div class="modal-body">
        <div class="upload-file-content">
          <div class="file-selector">
            <input 
              type="file" 
              ref="usb2snesFileInput"
              @change="handleFileSelect"
              accept=".sfc,.smc,.bin"
              style="display: none;"
            />
            <button @click="selectFileToUpload" class="btn-secondary">
              Browse Files
            </button>
            <div v-if="selectedFile" class="selected-file-info">
              <p><strong>Selected:</strong> {{ selectedFile.name }}</p>
              <p v-if="selectedFile.size > 0"><strong>Size:</strong> {{ formatFileSize(selectedFile.size) }}</p>
            </div>
          </div>

          <div v-if="selectedFile" class="upload-actions">
            <button @click="uploadFile" class="btn-primary">
              Upload to /work/ on SNES
            </button>
          </div>
        </div>
      </div>

      <footer class="modal-footer">
        <button @click="closeUploadFileModal" class="btn-secondary">Close</button>
      </footer>
    </div>
  </div>

  <!-- Cheats Modal -->
  <div v-if="cheatsModalOpen" class="modal-backdrop" @click.self="closeCheatsModal">
    <div class="modal cheats-modal">
      <header class="modal-header">
        <h3>⭐ Cheats & Power-ups</h3>
        <button @click="closeCheatsModal" class="btn-close">×</button>
      </header>

      <div class="modal-body">
        <div class="cheats-content">
          <div class="cheat-buttons">
            <button @click="grantCape" class="cheat-btn">
              <span class="cheat-icon">🦸</span>
              <span class="cheat-name">Grant Cape</span>
              <span class="cheat-desc">Powerup = 0x02</span>
            </button>
            
            <button @click="grantOneUp" class="cheat-btn">
              <span class="cheat-icon">🍄</span>
              <span class="cheat-name">Grant 1-Up</span>
              <span class="cheat-desc">Lives++</span>
            </button>
            
            <button @click="grantStar" class="cheat-btn">
              <span class="cheat-icon">⭐</span>
              <span class="cheat-name">Grant Star</span>
              <span class="cheat-desc">Star Timer = 0xFF</span>
            </button>
          </div>
          
          <!-- Status Display -->
          <div v-if="cheatsActionStatus" class="action-status-display cheat-status">
            {{ cheatsActionStatus }}
          </div>
        </div>
      </div>

      <footer class="modal-footer">
        <button @click="closeCheatsModal" class="btn-secondary">Close</button>
      </footer>
    </div>
  </div>

  <!-- Challenges Modal -->
  <div v-if="challengesModalOpen" class="modal-backdrop" @click.self="closeChallengesModal">
    <div class="modal challenges-modal">
      <header class="modal-header">
        <h3>🏆 Challenges</h3>
        <button @click="closeChallengesModal" class="btn-close">×</button>
      </header>

      <div class="modal-body">
        <div class="challenges-content">
          <div class="challenge-buttons">
            <button @click="startTimerChallenge" class="challenge-btn">
              <span class="challenge-icon">⏱️</span>
              <span class="challenge-name">Timer Challenge</span>
              <span class="challenge-desc">Race against the clock</span>
            </button>
            
            <div class="challenge-btn disabled">
              <span class="challenge-icon">🎯</span>
              <span class="challenge-name">More Coming Soon</span>
              <span class="challenge-desc">Future challenges...</span>
            </div>
          </div>
          
          <!-- Status Display -->
          <div v-if="challengesActionStatus" class="action-status-display challenge-status">
            {{ challengesActionStatus }}
          </div>
        </div>
      </div>

      <footer class="modal-footer">
        <button @click="closeChallengesModal" class="btn-secondary">Close</button>
      </footer>
    </div>
  </div>

  <!-- Full Chat Modal -->
  <div v-if="fullChatModalOpen" class="modal-backdrop" @click.self="closeFullChatModal">
    <div class="modal full-chat-modal">
      <header class="modal-header">
        <h3>💬 Chat Commands</h3>
        <button @click="closeFullChatModal" class="btn-close">×</button>
      </header>

      <div class="modal-body">
        <div class="full-chat-content">
          <!-- Status Bar -->
          <div class="chat-status-bar">
            <div class="status-item-inline">
              <span class="status-indicator" :class="usb2snesStatus.connected ? 'connected' : 'disconnected'">
                {{ usb2snesStatus.connected ? '● Connected' : '○ Disconnected' }}
              </span>
              <span class="health-indicator" :class="connectionHealth">
                {{ connectionHealth === 'green' ? '● Healthy' : connectionHealth === 'yellow' ? '● Slow' : '● Down' }}
              </span>
              <span v-if="usb2snesStatus.romRunning" class="rom-name">
                {{ usb2snesStatus.romRunning }}
              </span>
            </div>
          </div>

          <!-- Quick Command Buttons -->
          <div class="quick-commands">
            <button @click="insertQuickCommand('!r')" class="quick-cmd-btn">!r</button>
            <button @click="insertQuickCommand('!w')" class="quick-cmd-btn">!w</button>
            <button @click="insertQuickCommand('!powerup')" class="quick-cmd-btn">!powerup</button>
            <button @click="insertQuickCommand('!lives')" class="quick-cmd-btn">!lives</button>
            <button @click="insertQuickCommand('!freeze_everything')" class="quick-cmd-btn">!freeze</button>
          </div>

          <!-- Chat Log -->
          <div class="chat-log-fullsize" ref="chatLogContainer">
            <div v-for="(entry, index) in chatLog" :key="index" :class="['chat-entry', entry.type]">
              <span class="chat-timestamp">{{ entry.timestamp }}</span>
              <span class="chat-message">{{ entry.message }}</span>
            </div>
            <div v-if="chatLog.length === 0" class="chat-empty">
              Chat command log will appear here
            </div>
          </div>

          <!-- Chat Input -->
          <div class="chat-input-row-fullsize">
            <input 
              v-model="chatInput" 
              @keydown="handleChatKeydown"
              @keydown.enter="sendChatCommand"
              placeholder="Enter chat command (e.g., !powerup 0x02, !w 0x7E0DBE 0x63)"
              class="chat-input"
              ref="chatInputField"
            />
            <button @click="sendChatCommand" :disabled="!chatInput.trim()" class="btn-primary">Go</button>
          </div>

          <!-- Command Help Button -->
          <div class="chat-help-section">
            <button @click="showCommandHelp = true" class="btn-secondary" style="width: 100%;">
              📖 Show All Commands
            </button>
          </div>

          <!-- Loaded Modules -->
          <div v-if="loadedModules.length > 0" class="loaded-modules-fullchat">
            <strong>Loaded CARL Modules ({{ loadedModules.length }}):</strong>
            <div class="module-list-inline">
              <span v-for="mod in loadedModules" :key="mod.name" class="module-chip">
                {{ mod.name }}
              </span>
            </div>
          </div>
        </div>
      </div>

      <footer class="modal-footer">
        <button @click="closeFullChatModal" class="btn-secondary">Close</button>
      </footer>
    </div>
  </div>

  <!-- Run Name Input Modal -->
  <div v-if="runNameModalOpen" class="modal-backdrop" @click.self="cancelRunName">
    <div class="modal run-name-modal">
      <header class="modal-header">
        <h3>Enter Run Name</h3>
        <button class="close" @click="cancelRunName">✕</button>
      </header>
      <section class="modal-body run-name-body">
        <label for="run-name-input">Run Name:</label>
        <input 
          id="run-name-input"
          type="text" 
          v-model="runNameInput" 
          placeholder="My Challenge Run"
          @keyup.enter="confirmRunName"
          autofocus
        />
      </section>
      <footer class="modal-footer">
        <button @click="confirmRunName" class="btn-primary">Save Run</button>
        <button @click="cancelRunName">Cancel</button>
      </footer>
    </div>
  </div>

  <!-- Resume Run Modal (on app startup) -->
  <div v-if="resumeRunModalOpen" class="modal-backdrop">
    <div class="modal resume-run-modal">
      <header class="modal-header">
        <h3>⚠ Active Run Found</h3>
      </header>
      <section class="modal-body resume-run-body">
        <p class="resume-message">You have an active run in progress:</p>
        <div class="run-info">
          <div class="run-info-row">
            <span class="label">Run Name:</span>
            <span class="value">{{ resumeRunData?.run_name }}</span>
          </div>
          <div class="run-info-row">
            <span class="label">Status:</span>
            <span class="value">{{ resumeRunData?.isPaused ? '⏸ Paused' : '▶ Running' }}</span>
          </div>
          <div class="run-info-row">
            <span class="label">Elapsed Time:</span>
            <span class="value">⏱ {{ formatTime(resumeRunData?.elapsedSeconds || 0) }}</span>
          </div>
          <div class="run-info-row" v-if="resumeRunData?.pause_seconds > 0">
            <span class="label">Paused Time:</span>
            <span class="value pause-time">⏸ {{ formatTime(resumeRunData?.pause_seconds || 0) }}</span>
          </div>
        </div>
        <p class="resume-prompt">What would you like to do?</p>
      </section>
      <footer class="modal-footer resume-run-footer">
        <button @click="resumeRunFromStartup" class="btn-primary btn-large">▶ Resume Run</button>
        <button @click="pauseRunFromStartup" class="btn-secondary btn-large">⏸ View (Paused)</button>
        <button @click="cancelRunFromStartup" class="btn-danger btn-large">✕ Cancel Run</button>
      </footer>
    </div>
  </div>

  <!-- Staging Progress Modal -->
  <div v-if="stagingProgressModalOpen" class="modal-backdrop">
    <div class="modal staging-progress-modal">
      <header class="modal-header">
        <h3>🎮 Staging Run Games...</h3>
      </header>
      <section class="modal-body">
        <div class="progress-info">
          <div class="progress-bar">
            <div class="progress-fill" :style="{ width: (stagingProgressCurrent / stagingProgressTotal * 100) + '%' }"></div>
          </div>
          <p class="progress-text">{{ stagingProgressCurrent }} / {{ stagingProgressTotal }}</p>
          <p class="progress-game">{{ stagingProgressGameName }}</p>
        </div>
      </section>
    </div>
  </div>

  <!-- Run Upload Progress Modal -->
  <div v-if="runUploadProgressModalOpen" class="modal-backdrop">
    <div class="modal run-upload-progress-modal">
      <header class="modal-header">
        <h3>📤 Uploading Run to USB2SNES...</h3>
      </header>
      <section class="modal-body">
        <div class="progress-info">
          <!-- Overall progress -->
          <label class="progress-label">Overall Progress:</label>
          <div class="progress-bar">
            <div class="progress-fill" :style="{ width: (runUploadOverallCurrent / runUploadOverallTotal * 100) + '%' }"></div>
          </div>
          <p class="progress-text">{{ runUploadOverallCurrent }} / {{ runUploadOverallTotal }} files uploaded</p>
          
          <!-- Current file progress -->
          <label class="progress-label" style="margin-top: 20px;">Current File:</label>
          <div class="progress-bar">
            <div class="progress-fill" :style="{ width: runUploadFilePercent + '%' }"></div>
          </div>
          <p class="progress-text">{{ runUploadFileName }} - {{ runUploadFilePercent }}%</p>
          
          <!-- Status log -->
          <div class="status-log-container">
            <label class="progress-label">Status Log:</label>
            <textarea 
              readonly 
              :value="runUploadStatusLog" 
              class="status-log"
              ref="runUploadStatusLogTextarea"
            ></textarea>
          </div>
        </div>
      </section>
      <footer class="modal-footer">
        <button 
          v-if="runUploadInProgress" 
          @click="cancelRunUpload" 
          class="btn-secondary">
          Cancel
        </button>
        <button 
          v-else 
          @click="closeRunUploadProgress" 
          class="btn-primary">
          Close
        </button>
      </footer>
    </div>
  </div>

  <!-- Staging Success Modal -->
  <div v-if="stagingSuccessModalOpen" class="modal-backdrop">
    <div class="modal staging-success-modal">
      <header class="modal-header">
        <h3>✅ Run Staged Successfully!</h3>
      </header>
      <section class="modal-body">
        <div class="success-info">
          <p class="success-message">
            <strong>{{ stagingSfcCount }}</strong> game file{{ stagingSfcCount === 1 ? '' : 's' }} {{ stagingSfcCount === 1 ? 'has' : 'have' }} been prepared for your run.
          </p>
          <div class="folder-info">
            <label class="folder-label">Run Folder:</label>
            <div class="folder-path">
              <input type="text" readonly :value="stagingFolderPath" class="folder-path-input" />
              <button @click="openStagingFolder" class="btn-open-folder" title="Open Folder">📁</button>
            </div>
          </div>

          <div class="launch-instructions">
            <h4>🚀 Quick Actions:</h4>
            
            <div class="quick-actions-buttons">
              <!-- Launch Program Action -->
              <div v-if="settings.launchProgram && settings.launchProgram.trim()" class="action-group">
                <button @click="launchRunGame(1)" class="btn-action">
                  🎮 Launch Game 1
                </button>
              </div>
              
              <!-- USB2SNES Actions -->
              <div v-if="settings.usb2snesEnabled === 'yes'" class="action-group">
                <button @click="uploadRunToSnes" class="btn-action">
                  📤 Upload to USB2SNES
                </button>
              </div>
            </div>
            
            <!-- Status Display -->
            <div v-if="runStagingActionStatus" class="action-status-display">
              {{ runStagingActionStatus }}
            </div>
            
            <p class="tip">💡 <strong>Tip:</strong> Game files are numbered sequentially in the folder above</p>
          </div>
        </div>
      </section>
      <footer class="modal-footer">
        <button @click="closeStagingSuccess" class="btn-primary">Close</button>
      </footer>
    </div>
  </div>

  <!-- Quick Launch Progress Modal -->
  <div v-if="quickLaunchProgressModalOpen" class="modal-backdrop">
    <div class="modal staging-progress-modal">
      <header class="modal-header">
        <h3>🎮 Staging Games for Quick Launch...</h3>
      </header>
      <section class="modal-body">
        <div class="progress-info">
          <div class="progress-bar">
            <div class="progress-fill" :style="{ width: (quickLaunchProgressCurrent / quickLaunchProgressTotal * 100) + '%' }"></div>
          </div>
          <p class="progress-text">{{ quickLaunchProgressCurrent }} / {{ quickLaunchProgressTotal }}</p>
          <p class="progress-game">{{ quickLaunchProgressGameName }}</p>
        </div>
      </section>
    </div>
  </div>

  <!-- Quick Launch Success Modal -->
  <div v-if="quickLaunchSuccessModalOpen" class="modal-backdrop">
    <div class="modal staging-success-modal">
      <header class="modal-header">
        <h3>✅ Games Staged Successfully!</h3>
      </header>
      <section class="modal-body">
        <div class="success-info">
          <p class="success-message">
            <strong>{{ quickLaunchSfcCount }}</strong> game file{{ quickLaunchSfcCount === 1 ? '' : 's' }} {{ quickLaunchSfcCount === 1 ? 'has' : 'have' }} been prepared for quick launch.
          </p>
          <div class="folder-info">
            <label class="folder-label">Staged Games Folder:</label>
            <div class="folder-path">
              <input type="text" readonly :value="quickLaunchFolderPath" class="folder-path-input" />
              <button @click="openQuickLaunchFolder" class="btn-open-folder" title="Open Folder">📁</button>
            </div>
          </div>

          <div class="launch-instructions">
            <h4>🚀 Quick Actions:</h4>
            
            <div class="quick-actions-buttons">
              <!-- USB2SNES Actions -->
              <div v-if="settings.usb2snesEnabled === 'yes'" class="action-group">
                <button @click="uploadStagedToSnes(false)" class="btn-action">
                  📤 Upload to SNES
                </button>
                <button @click="uploadStagedToSnes(true)" class="btn-action">
                  🚀 Upload and Boot
                </button>
              </div>
              
              <!-- Launch Program Action -->
              <div v-if="settings.launchProgram && settings.launchProgram.trim()" class="action-group">
                <button @click="launchWithProgram" class="btn-action">
                  🎮 Launch with Program
                </button>
              </div>
            </div>
            
            <!-- Status Display -->
            <div v-if="quickLaunchActionStatus" class="action-status-display quick-launch-status">
              {{ quickLaunchActionStatus }}
            </div>
            
            <p class="tip">💡 <strong>Tip:</strong> Game files are in the folder above: <code>smw&lt;GAMEID&gt;_&lt;VERSION&gt;.sfc</code></p>
          </div>
        </div>
      </section>
      <footer class="modal-footer">
        <button @click="closeQuickLaunchSuccess" class="btn-primary">Close</button>
      </footer>
    </div>
  </div>
  
</template>

<script setup lang="ts">
import { computed, reactive, ref, onMounted, onUnmounted, watch, nextTick } from 'vue';
import { 
  DEFAULT_THEME, 
  DEFAULT_TEXT_SIZE, 
  applyTheme, 
  applyTextSize,
  getThemeDisplayName,
  getTextSizeDisplayName,
  type ThemeName,
  type TextSize 
} from './themeConfig';

// Debounce utility
function debounce<T extends (...args: any[]) => any>(func: T, wait: number): T {
  let timeout: NodeJS.Timeout | null = null;
  return ((...args: any[]) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  }) as T;
}

type ItemStatus = 'Default' | 'In Progress' | 'Finished';

type Item = {
  Id: string;
  Name: string;
  Type: string;
  LegacyType?: string;
  Author: string;
  Length: string;
  PublicDifficulty?: string;
  Status: ItemStatus;
  MyDifficultyRating?: number | null;  // 0-5
  MyReviewRating?: number | null;      // 0-5
  MySkillRating?: number | null;       // 0-10
  Publicrating?: number;
  Hidden: boolean;
  ExcludeFromRandom?: boolean;
  Mynotes?: string;
  JsonData?: any;
  AvailableVersions?: number[];
  CurrentVersion?: number;
};

// Loading and error states
const isLoading = ref(false);
const loadError = ref<string | null>(null);

// Main data (will be loaded from database)
const items = reactive<Item[]>([]);

const selectedIds = ref<Set<string>>(new Set());
const searchQuery = ref('');
const showHidden = ref(false);
const hideFinished = ref(false);
const bulkStatus = ref('');

// Filter dropdown state
const filterDropdownOpen = ref(false);
const filterSearchInput = ref<HTMLInputElement | null>(null);

// Select dropdown state
const selectDropdownOpen = ref(false);

// Ignore dropdown state
const ignoreDropdownOpen = ref(false);

// USB2SNES Tools modal state
const usb2snesToolsModalOpen = ref(false);
const usb2snesCurrentLibrary = ref('usb2snes_a' as 'usb2snes_a' | 'usb2snes_b' | 'qusb2snes' | 'node-usb');
const usb2snesStatus = reactive({
  connected: false,
  device: '',
  lastAttempt: '',
  lastError: '',
  firmwareVersion: '',
  versionString: '',
  romRunning: ''
});

// Version management (must be declared before watchers use it)
const selectedVersion = ref<number>(1);

const normalized = (s: string) => s.toLowerCase();

/**
 * Parse and apply advanced filter query
 */
function matchesFilter(item: Item, query: string): boolean {
  if (!query) return true;
  
  const q = query.trim().toLowerCase();
  
  // Check for attribute:value pattern
  const attributeMatch = q.match(/^(\w+):(>|<|>=|<=)?(.+)$/);
  
  if (attributeMatch) {
    const [, attr, operator, value] = attributeMatch;
    
    // Handle rating filters with operators
    if (attr === 'rating') {
      const rating = item.Publicrating ?? 0;
      const targetValue = parseFloat(value);
      
      if (isNaN(targetValue)) return false;
      
      if (operator === '>') return rating > targetValue;
      if (operator === '<') return rating < targetValue;
      if (operator === '>=') return rating >= targetValue;
      if (operator === '<=') return rating <= targetValue;
      return rating === targetValue;
    }
    
    // Handle version filters (not implemented for filtering yet, but reserved)
    if (attr === 'version') {
      // For now, we always search latest version unless specified
      // This is a placeholder for future version-specific filtering
      return true;
    }
    
    // Handle other attribute searches
    const itemValue = getItemAttribute(item, attr);
    if (itemValue === null) return false;
    
    return itemValue.toLowerCase().includes(value.toLowerCase());
  }
  
  // Default: search across all fields
  const haystack = [
    item.Id,
    item.Name,
    item.Type,
    item.Author,
    item.Length,
    item.Status,
    String(item.MyDifficultyRating ?? ''),
    String(item.MyReviewRating ?? ''),
    String(item.Publicrating ?? ''),
    String(item.Mynotes ?? ''),
    // Include JSON data if available
    item.JsonData?.added ? String(item.JsonData.added) : '',
    item.JsonData?.difficulty ? String(item.JsonData.difficulty) : '',
  ].join(' ').toLowerCase();
  
  return haystack.includes(q);
}

/**
 * Get attribute value from item or its JSON data
 */
function getItemAttribute(item: Item, attr: string): string | null {
  // Direct properties
  const directProps: Record<string, any> = {
    id: item.Id,
    name: item.Name,
    type: item.Type,
    author: item.Author,
    length: item.Length,
    status: item.Status,
    rating: item.Publicrating,
    notes: item.Mynotes,
  };
  
  if (directProps[attr] !== undefined) {
    return String(directProps[attr] ?? '');
  }
  
  // Check JSON data attributes
  if (item.JsonData && item.JsonData[attr] !== undefined) {
    return String(item.JsonData[attr]);
  }
  
  return null;
}

const filteredItems = computed(() => {
  const q = searchQuery.value.trim();
  return items.filter((it) => {
    if (!showHidden.value && it.Hidden) return false;
    if (hideFinished.value && it.Status === 'Finished') return false;
    return matchesFilter(it, q);
  });
});

const hasActiveFilters = computed(() => searchQuery.value.trim().length > 0 || hideFinished.value || showHidden.value);

const numChecked = computed(() => selectedIds.value.size);
const exactlyOneSelected = computed(() => selectedIds.value.size === 1);
const canStartGames = computed(() => selectedIds.value.size >= 1 && selectedIds.value.size <= 21);

const allVisibleChecked = computed(() => {
  if (filteredItems.value.length === 0) return false;
  return filteredItems.value.every((it) => selectedIds.value.has(it.Id));
});

function toggleCheckAll(e: Event) {
  const target = e.target as HTMLInputElement;
  if (target.checked) {
    for (const it of filteredItems.value) selectedIds.value.add(it.Id);
  } else {
    for (const it of filteredItems.value) selectedIds.value.delete(it.Id);
  }
}

function rowClick(row: Item) {
  const has = selectedIds.value.has(row.Id);
  selectedIds.value.clear();
  if (!has) selectedIds.value.add(row.Id);
}

function toggleMainSelection(id: string, e: Event) {
  const checked = (e.target as HTMLInputElement).checked;
  if (checked) {
    selectedIds.value.add(id);
  } else {
    selectedIds.value.delete(id);
  }
}

function isInRun(gameId: string): boolean {
  return runEntries.some(entry => entry.entryType === 'game' && entry.id === gameId);
}

function addSelectedToRun() {
  const selectedGames = items.filter(item => selectedIds.value.has(item.Id));
  let addedCount = 0;
  
  for (const game of selectedGames) {
    // Skip if already in run
    if (isInRun(game.Id)) continue;
    
    const key = `game-${game.Id}-${Date.now()}-${addedCount}`;
    runEntries.push({
      key,
      id: game.Id,
      entryType: 'game',  // Locked as 'game' type
      name: game.Name,
      stageNumber: '',
      stageName: '',
      count: 1,
      // No filter fields for specific games
      filterDifficulty: '',
      filterType: '',
      filterPattern: '',
      seed: '',
      isLocked: true,  // Mark as locked (can't change type)
      conditions: [],  // Challenge conditions
    });
    addedCount++;
  }
  
  // Uncheck all games after adding
  selectedIds.value.clear();
  
  console.log(`Added ${addedCount} games to run`);
}

function clearFilters() {
  searchQuery.value = '';
  hideFinished.value = false;
  showHidden.value = false;
}

// Filter dropdown functions
function toggleFilterDropdown() {
  filterDropdownOpen.value = !filterDropdownOpen.value;
  if (filterDropdownOpen.value) {
    // Focus input after dropdown opens
    setTimeout(() => {
      filterSearchInput.value?.focus();
    }, 100);
  }
}

function closeFilterDropdown() {
  filterDropdownOpen.value = false;
}

function addFilterTag(tag: string) {
  // Append tag to search query
  const current = searchQuery.value.trim();
  if (current) {
    searchQuery.value = current + ' ' + tag;
  } else {
    searchQuery.value = tag;
  }
  // Keep dropdown open and refocus input
  setTimeout(() => {
    filterSearchInput.value?.focus();
  }, 50);
}

// Select dropdown functions
function toggleSelectDropdown() {
  selectDropdownOpen.value = !selectDropdownOpen.value;
}

function closeSelectDropdown() {
  selectDropdownOpen.value = false;
}

// Ignore dropdown functions
function toggleIgnoreDropdown() {
  ignoreDropdownOpen.value = !ignoreDropdownOpen.value;
}

function closeIgnoreDropdown() {
  ignoreDropdownOpen.value = false;
}

// USB2SNES Tools modal functions
async function openUsb2snesTools() {
  // Set current library to the default from settings when opening modal
  usb2snesCurrentLibrary.value = settings.usb2snesLibrary;
  usb2snesDropdownOpen.value = false;
  usb2snesToolsModalOpen.value = true;
  
  // Refresh connection status from backend
  await refreshUsb2snesStatus();
}

async function refreshUsb2snesStatus() {
  try {
    const status = await (window as any).electronAPI.usb2snesStatus();
    console.log('[USB2SNES] Refreshed status:', status);
    console.log('[USB2SNES] Before update - usb2snesStatus.connected:', usb2snesStatus.connected);
    
    if (status.connected) {
      usb2snesStatus.connected = true;
      usb2snesStatus.device = status.device || 'Connected';
      console.log('[USB2SNES] Set connected to TRUE');
    } else {
      usb2snesStatus.connected = false;
      usb2snesStatus.device = 'Not connected';
      console.log('[USB2SNES] Set connected to FALSE');
    }
    
    console.log('[USB2SNES] After update - usb2snesStatus.connected:', usb2snesStatus.connected);
  } catch (error) {
    console.error('Failed to refresh USB2SNES status:', error);
    // Don't change status on error
  }
}

function closeUsb2snesTools() {
  usb2snesToolsModalOpen.value = false;
}

async function connectUsb2snes() {
  usb2snesStatus.lastAttempt = new Date().toLocaleString();
  dropdownActionStatus.value = 'Connecting...';
  
  try {
    // Refresh status first to check if already connected
    await refreshUsb2snesStatus();
    
    if (usb2snesStatus.connected) {
      dropdownActionStatus.value = '✓ Already connected';
      return;
    }
    
    const library = usb2snesCurrentLibrary.value;
    const address = settings.usb2snesAddress;
    
    const result = await (window as any).electronAPI.usb2snesConnect(library, address);
    
    usb2snesStatus.connected = true;
    usb2snesStatus.device = result.device;
    usb2snesStatus.firmwareVersion = result.firmwareVersion || 'N/A';
    usb2snesStatus.versionString = result.versionString || 'N/A';
    usb2snesStatus.romRunning = result.romRunning || 'N/A';
    usb2snesStatus.lastError = '';
    
    // Start health monitoring
    startHealthMonitoring();
    
    dropdownActionStatus.value = `✓ Connected: ${result.device}`;
  } catch (error) {
    usb2snesStatus.lastError = String(error);
    usb2snesStatus.connected = false;
    stopHealthMonitoring();
    dropdownActionStatus.value = `✗ Connection failed: ${error}`;
  }
}

async function disconnectUsb2snes() {
  dropdownActionStatus.value = 'Disconnecting...';
  
  try {
    // Refresh status first
    await refreshUsb2snesStatus();
    
    if (!usb2snesStatus.connected) {
      dropdownActionStatus.value = '✓ Already disconnected';
      return;
    }
    
    await (window as any).electronAPI.usb2snesDisconnect();
    
    usb2snesStatus.connected = false;
    usb2snesStatus.device = '';
    usb2snesStatus.firmwareVersion = '';
    usb2snesStatus.versionString = '';
    usb2snesStatus.romRunning = '';
    
    // Stop health monitoring
    stopHealthMonitoring();
    
    dropdownActionStatus.value = '✓ Disconnected successfully';
  } catch (error) {
    usb2snesStatus.lastError = String(error);
    dropdownActionStatus.value = `✗ Disconnection error: ${error}`;
  }
}

async function reconnectUsb2snes() {
  dropdownActionStatus.value = 'Reconnecting...';
  
  try {
    // Refresh status first
    await refreshUsb2snesStatus();
    
    // If connected, disconnect first
    if (usb2snesStatus.connected) {
      await (window as any).electronAPI.usb2snesDisconnect();
      usb2snesStatus.connected = false;
      usb2snesStatus.device = '';
      usb2snesStatus.firmwareVersion = '';
      usb2snesStatus.versionString = '';
      usb2snesStatus.romRunning = '';
      stopHealthMonitoring();
      
      // Small delay to ensure clean disconnect
    await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    // Now connect
    const library = usb2snesCurrentLibrary.value;
    const address = settings.usb2snesAddress;
    
    const result = await (window as any).electronAPI.usb2snesConnect(library, address);
    
    usb2snesStatus.connected = true;
    usb2snesStatus.device = result.device;
    usb2snesStatus.firmwareVersion = result.firmwareVersion || 'N/A';
    usb2snesStatus.versionString = result.versionString || 'N/A';
    usb2snesStatus.romRunning = result.romRunning || 'N/A';
    usb2snesStatus.lastError = '';
    
    // Start health monitoring
    startHealthMonitoring();
    
    dropdownActionStatus.value = `✓ Reconnected: ${result.device}`;
  } catch (error) {
    usb2snesStatus.lastError = String(error);
    usb2snesStatus.connected = false;
    stopHealthMonitoring();
    dropdownActionStatus.value = `✗ Reconnection failed: ${error}`;
  }
}

function clearUsb2snesErrors() {
  usb2snesStatus.lastError = '';
  usb2snesStatus.lastAttempt = '';
}

function resetUsb2snesConnection() {
  usb2snesStatus.connected = false;
  usb2snesStatus.device = '';
  usb2snesStatus.firmwareVersion = '';
  usb2snesStatus.versionString = '';
  usb2snesStatus.romRunning = '';
  usb2snesStatus.lastError = '';
  usb2snesStatus.lastAttempt = '';
  alert('USB2SNES connection reset');
}

function openUsb2snesWebsite() {
  window.open('https://usb2snes.com/', '_blank');
}

// Console control functions
async function createUploadDirectory() {
  try {
    const dirPath = settings.usb2snesUploadDir;
    await (window as any).electronAPI.usb2snesCreateDir(dirPath);
    alert(`Directory created successfully: ${dirPath}`);
  } catch (error) {
    // Directory might already exist, which is fine
    const errorMsg = String(error);
    if (errorMsg.includes('exist')) {
      alert(`Directory ${settings.usb2snesUploadDir} already exists (this is fine)`);
    } else {
      alert(`Create directory failed: ${error}`);
    }
  }
}

async function rebootSnes() {
  dropdownActionStatus.value = 'Rebooting SNES...';
  
  try {
    await (window as any).electronAPI.usb2snesReset();
    dropdownActionStatus.value = '✓ SNES rebooted';
  } catch (error) {
    dropdownActionStatus.value = `✗ Reboot failed: ${error}`;
  }
}

async function returnToMenu() {
  dropdownActionStatus.value = 'Returning to menu...';
  
  try {
    await (window as any).electronAPI.usb2snesMenu();
    dropdownActionStatus.value = '✓ Returned to menu';
  } catch (error) {
    dropdownActionStatus.value = `✗ Menu command failed: ${error}`;
  }
}

// SMW quick actions
async function grantCape() {
  cheatsActionStatus.value = 'Granting cape...';
  
  try {
    trackCommand();
    const result = await (window as any).electronAPI.chatExecuteCommand('!powerup 0x02');
    trackResponse();
    if (result && result.success) {
      cheatsActionStatus.value = '✓ Cape granted!';
    } else {
      cheatsActionStatus.value = '✗ Failed to grant cape';
    }
  } catch (error) {
    cheatsActionStatus.value = `✗ Failed: ${error}`;
  }
}

async function grantOneUp() {
  cheatsActionStatus.value = 'Granting 1-Up...';
  
  try {
    trackCommand();
    // Read current lives, add 1
    const readResult = await (window as any).electronAPI.usb2snesReadMemory(0xF50DBE, 1);
    const currentLives = readResult.data[0];
    const newLives = Math.min(currentLives + 1, 99);
    
    await (window as any).electronAPI.chatExecuteCommand(`!lives 0x${newLives.toString(16).padStart(2, '0')}`);
    trackResponse();
    cheatsActionStatus.value = `✓ 1-Up! Lives: ${newLives}`;
  } catch (error) {
    cheatsActionStatus.value = `✗ Failed: ${error}`;
  }
}

async function grantStar() {
  cheatsActionStatus.value = 'Granting star...';
  
  try {
    trackCommand();
    const result = await (window as any).electronAPI.chatExecuteCommand('!star_timer 0xFF');
    trackResponse();
    if (result && result.success) {
      cheatsActionStatus.value = '✓ Star invincibility granted!';
    } else {
      cheatsActionStatus.value = '✗ Failed to grant star';
    }
  } catch (error) {
    cheatsActionStatus.value = `✗ Failed: ${error}`;
  }
}

async function startTimerChallenge() {
  challengesActionStatus.value = 'Starting timer challenge...';
  
  try {
    const result = await (window as any).electronAPI.usb2snesTimerChallenge();
    challengesActionStatus.value = `✓ ${result.message}`;
  } catch (error) {
    challengesActionStatus.value = `✗ Timer challenge failed: ${error}`;
  }
}

// File upload
const selectedFile = ref(null as File | null);
const usb2snesFileInput = ref(null as HTMLInputElement | null);

// Chat Commands state
const chatInput = ref('');
const chatLog = ref([] as Array<{timestamp: string, message: string, type: string}>);
const chatHistory = ref([] as string[]);
const chatHistoryIndex = ref(-1);
const loadedModules = ref([] as Array<{name: string, address: number, addressHex: string, size: number}>);
const chatInputField = ref(null as HTMLInputElement | null);
const showCommandHelp = ref(false);

// File upload progress
const uploadProgressModalOpen = ref(false);
const uploadProgressPercent = ref(0);
const uploadProgressStatus = ref('');
const uploadedFilePath = ref('');
const uploadSuccess = ref(false);

// USB2SNES Dropdown state
const usb2snesDropdownOpen = ref(false);

// Connection Health Monitoring
const connectionHealth = ref<'green' | 'yellow' | 'red'>('red');
const lastCommandTime = ref(0);
const lastResponseTime = ref(0);
const healthCheckInterval = ref<NodeJS.Timeout | null>(null);
const isPinging = ref(false);

// New Modal States
const uploadFileModalOpen = ref(false);
const cheatsModalOpen = ref(false);
const challengesModalOpen = ref(false);
const fullChatModalOpen = ref(false);

// Mini Chat State (for dropdown)
const miniChatLog = ref([] as Array<{timestamp: string, message: string, type: string}>);
const miniChatInput = ref('');
const miniChatHistory = ref([] as string[]);
const miniChatHistoryIndex = ref(-1);
const miniChatInputField = ref<HTMLInputElement | null>(null);

// Action Status Messages
const dropdownActionStatus = ref('');
const cheatsActionStatus = ref('');
const challengesActionStatus = ref('');

// SNES Contents Cache
const snesContentsDropdownOpen = ref(false);
const snesContentsList = ref([] as any[]);
const snesContentsShowAll = ref(false);

async function selectFileToUpload() {
  try {
    const result = await (window as any).electronAPI.showOpenDialog({
      title: 'Select ROM File',
      filters: [
        { name: 'ROM Files', extensions: ['sfc', 'smc', 'bin'] },
        { name: 'All Files', extensions: ['*'] }
      ],
      properties: ['openFile']
    });
    
    if (!result.canceled && result.filePaths.length > 0) {
      const filePath = result.filePaths[0];
      console.log('[File Select] Selected file:', filePath);
      
      // Store file info as an object with path property
      // Size will be checked by backend during upload
      selectedFile.value = {
        path: filePath,
        name: filePath.split(/[\\/]/).pop() || 'unknown',
        size: 0  // Size check happens in backend
      } as any;
      
      console.log('[File Select] Stored file info:', selectedFile.value);
    }
  } catch (error) {
    console.error('[File Select] Error:', error);
    alert(`File selection error: ${error}`);
  }
}

function handleFileSelect(event: Event) {
  // Legacy HTML file input handler (kept for compatibility)
  const input = event.target as HTMLInputElement;
  if (input.files && input.files.length > 0) {
    selectedFile.value = input.files[0];
  }
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

async function uploadFile() {
  if (!selectedFile.value) {
    alert('No file selected');
    return;
  }

  try {
    const fileName = selectedFile.value.name;
    const dstPath = `/work/${fileName}`;
    
    // Get the file path
    const filePath = (selectedFile.value as any).path;
    
    console.log('[Upload] File object:', selectedFile.value);
    console.log('[Upload] Extracted path:', filePath);
    
    if (!filePath) {
      alert('Could not get file path. Please select the file using the Browse button.');
      return;
    }
    
    // Close file selection modal, open progress modal
    uploadFileModalOpen.value = false;
    uploadProgressModalOpen.value = true;
    uploadProgressPercent.value = 0;
    uploadProgressStatus.value = 'Uploading...';
    uploadedFilePath.value = dstPath;
    uploadSuccess.value = false;
    
    // Set up progress listener BEFORE starting upload
    let progressListenerActive = true;
    const removeProgressListener = (window as any).electronAPI.onUploadProgress((transferred: number, total: number, percent: number) => {
      if (progressListenerActive) {
        console.log('[Upload] Progress event:', percent, '%', `(${transferred}/${total} bytes)`);
        uploadProgressPercent.value = percent;
      }
    });
    
    console.log('[Upload] Starting upload:', filePath, '->', dstPath);
    console.log('[Upload] About to call electronAPI.usb2snesUploadRom...');
    
    let result;
    try {
      result = await (window as any).electronAPI.usb2snesUploadRom(filePath, dstPath);
      console.log('[Upload] Upload finished successfully:', result);
    } catch (uploadError) {
      console.error('[Upload] Upload threw error:', uploadError);
      throw uploadError;
    }
    
    // Clean up listener
    progressListenerActive = false;
    removeProgressListener();
    
    uploadProgressPercent.value = 100;
    
    if (result.success) {
      uploadProgressStatus.value = 'Upload complete!';
      uploadSuccess.value = true;
      
      // Sync SNES contents cache
      try {
        const uploadedFileInfo = {
          fullpath: dstPath,
          filename: fileName,
          gameid: null,
          version: null,
          metadata: {},
          part_of_a_run: false
        };
        
        // Try to extract game ID and version from filename (smw12345_1.sfc)
        const match = fileName.match(/^smw(\d+)_(\d+)\.sfc$/i);
        if (match) {
          uploadedFileInfo.gameid = match[1];
          uploadedFileInfo.version = parseInt(match[2]);
          
          // Try to get game metadata from main list
          const gameItem = items.find(item => item.Id === match[1]);
          if (gameItem) {
            uploadedFileInfo.metadata = {
              gamename: gameItem.Name,
              gametype: gameItem.Type,
              difficulty: gameItem.PublicDifficulty,
              combinedtype: gameItem.Type
            };
          }
        }
        
        await (window as any).electronAPI.snesContentsSync(uploadedFileInfo);
        console.log('[Upload] SNES contents cache synced');
      } catch (syncError) {
        console.warn('[Upload] Cache sync failed:', syncError);
      }
      
      // Clear file selection
      selectedFile.value = null;
      if (usb2snesFileInput.value) {
        usb2snesFileInput.value.value = '';
      }
    } else {
      uploadProgressStatus.value = 'Upload failed!';
      uploadSuccess.value = false;
    }
  } catch (error) {
    uploadProgressStatus.value = `Upload failed: ${error}`;
    uploadSuccess.value = false;
    uploadProgressPercent.value = 0;
  }
}

function closeUploadProgress() {
  uploadProgressModalOpen.value = false;
}

async function launchUploadedFile() {
  try {
    uploadProgressStatus.value = 'Launching file...';
    await (window as any).electronAPI.usb2snesBoot(uploadedFilePath.value);
    uploadProgressStatus.value = 'File launched!';
    
    // Close after short delay
    setTimeout(() => {
      uploadProgressModalOpen.value = false;
    }, 1500);
  } catch (error) {
    uploadProgressStatus.value = `Launch failed: ${error}`;
  }
}

// ===========================================================================
// CHAT COMMANDS SYSTEM
// ===========================================================================

async function sendChatCommand() {
  const command = chatInput.value.trim();
  if (!command) return;
  
  // Add to chat log (command)
  addToChatLog(command, 'command');
  
  // Add to history
  chatHistory.value.push(command);
  chatHistoryIndex.value = chatHistory.value.length;
  
  // Clear input
  chatInput.value = '';
  
  try {
    // Execute command
    console.log('[Chat] Sending command:', command);
    const result = await (window as any).electronAPI.chatExecuteCommand(command);
    console.log('[Chat] Received result:', result);
    
    // Add response to chat log
    if (result && result.message) {
      if (result.success) {
        addToChatLog(result.message, 'response-success');
      } else {
        addToChatLog(result.message, 'response-error');
      }
    } else {
      console.error('[Chat] Invalid result format:', result);
      addToChatLog('Command sent but no response received', 'response-error');
    }
    
    // Update loaded modules if CARL command
    if (command.toLowerCase().startsWith('!load') || 
        command.toLowerCase().startsWith('!unload') || 
        command.toLowerCase().startsWith('!reload')) {
      await updateLoadedModules();
    }
    
  } catch (error) {
    addToChatLog(`Error: ${error}`, 'response-error');
  }
  
  // Scroll chat log to bottom
  scrollChatLog();
}

function addToChatLog(message: string, type: string) {
  const timestamp = new Date().toLocaleTimeString();
  chatLog.value.push({ timestamp, message, type });
  
  // Limit chat log size
  if (chatLog.value.length > 100) {
    chatLog.value.shift();
  }
}

function handleChatKeydown(event: KeyboardEvent) {
  // Up arrow - previous command
  if (event.key === 'ArrowUp') {
    event.preventDefault();
    if (chatHistory.value.length === 0) return;
    
    if (chatHistoryIndex.value > 0) {
      chatHistoryIndex.value--;
      chatInput.value = chatHistory.value[chatHistoryIndex.value];
    }
  }
  
  // Down arrow - next command
  else if (event.key === 'ArrowDown') {
    event.preventDefault();
    if (chatHistory.value.length === 0) return;
    
    if (chatHistoryIndex.value < chatHistory.value.length - 1) {
      chatHistoryIndex.value++;
      chatInput.value = chatHistory.value[chatHistoryIndex.value];
    } else {
      chatHistoryIndex.value = chatHistory.value.length;
      chatInput.value = '';
    }
  }
}

async function updateLoadedModules() {
  try {
    const modules = await (window as any).electronAPI.chatGetLoadedModules();
    loadedModules.value = modules;
  } catch (error) {
    console.error('Failed to update loaded modules:', error);
  }
}

function scrollChatLog() {
  nextTick(() => {
    const logElement = (chatLogContainer as any)?.value;
    if (logElement) {
      logElement.scrollTop = logElement.scrollHeight;
    }
  });
}

// Ref for chat log container
const chatLogContainer = ref(null as HTMLElement | null);

// ===========================================================================
// USB2SNES DROPDOWN & HEALTH MONITORING
// ===========================================================================

async function toggleUsb2snesDropdown() {
  usb2snesDropdownOpen.value = !usb2snesDropdownOpen.value;
  
  // Refresh status when opening dropdown
  if (usb2snesDropdownOpen.value) {
    await refreshUsb2snesStatus();
  }
}

function closeUsb2snesDropdown() {
  usb2snesDropdownOpen.value = false;
}

// Health Monitoring System
// Timing: Ping every 2s when idle, Yellow at 3s delay, Red at 7s delay
function startHealthMonitoring() {
  if (healthCheckInterval.value) {
    clearInterval(healthCheckInterval.value);
  }
  
  lastResponseTime.value = Date.now();
  lastCommandTime.value = Date.now();
  connectionHealth.value = 'green';
  
  healthCheckInterval.value = setInterval(() => {
    updateHealthIndicator();
    checkAndSendPing();
  }, 1000); // Check every second
}

function stopHealthMonitoring() {
  if (healthCheckInterval.value) {
    clearInterval(healthCheckInterval.value);
    healthCheckInterval.value = null;
  }
  connectionHealth.value = 'red';
}

function updateHealthIndicator() {
  if (!usb2snesStatus.connected) {
    connectionHealth.value = 'red';
    return;
  }
  
  const now = Date.now();
  const responseDelay = now - lastResponseTime.value;
  
  if (responseDelay < 7000) {
    connectionHealth.value = 'green';
  } else if (responseDelay < 15000) {
    connectionHealth.value = 'yellow';
  } else {
    connectionHealth.value = 'red';
  }
}

async function checkAndSendPing() {
  if (!usb2snesStatus.connected || isPinging.value) {
    return;
  }
  
  const now = Date.now();
  const timeSinceLastResponse = now - lastResponseTime.value;
  
  // Only ping if device truly non-responsive for 15+ seconds
  // If commands are working, lastResponseTime gets updated and ping won't fire
  if (timeSinceLastResponse > 15000) {
    await sendHealthPing();
  }
}

async function sendHealthPing() {
  if (isPinging.value) return;
  
  try {
    isPinging.value = true;
    lastCommandTime.value = Date.now();
    
    // Send a simple read to check connection
    await (window as any).electronAPI.usb2snesReadMemory(0xF50000, 1);
    
    lastResponseTime.value = Date.now();
  } catch (error) {
    console.error('[Health] Ping failed:', error);
  } finally {
    isPinging.value = false;
  }
}

// Update command tracking for health monitoring
function trackCommand() {
  lastCommandTime.value = Date.now();
}

function trackResponse() {
  lastResponseTime.value = Date.now();
}

// ===========================================================================
// NEW MODAL FUNCTIONS
// ===========================================================================

function openUploadFileModal() {
  usb2snesDropdownOpen.value = false;
  uploadFileModalOpen.value = true;
}

function closeUploadFileModal() {
  uploadFileModalOpen.value = false;
}

function openCheatsModal() {
  usb2snesDropdownOpen.value = false;
  cheatsModalOpen.value = true;
}

function closeCheatsModal() {
  cheatsModalOpen.value = false;
}

function openChallengesModal() {
  usb2snesDropdownOpen.value = false;
  challengesModalOpen.value = true;
}

function closeChallengesModal() {
  challengesModalOpen.value = false;
}

function openFullChatModal() {
  usb2snesDropdownOpen.value = false;
  fullChatModalOpen.value = true;
}

function closeFullChatModal() {
  fullChatModalOpen.value = false;
}

// Mini Chat Functions
async function sendMiniChatCommand() {
  const command = miniChatInput.value.trim();
  if (!command) return;
  
  // Add to mini chat history
  miniChatHistory.value.push(command);
  if (miniChatHistory.value.length > 50) {
    miniChatHistory.value.shift();
  }
  miniChatHistoryIndex.value = -1;
  
  // Add to mini chat log
  addToMiniChatLog(command, 'command');
  
  // Also add to main chat log
  addToChatLog(command, 'command');
  
  // Clear input
  miniChatInput.value = '';
  
  try {
    trackCommand();
    const result = await (window as any).electronAPI.chatExecuteCommand(command);
    trackResponse();
    
    if (result && result.message) {
      const type = result.success ? 'response-success' : 'response-error';
      addToMiniChatLog(result.message, type);
      addToChatLog(result.message, type);
    }
  } catch (error) {
    console.error('[MiniChat] Command error:', error);
    addToMiniChatLog(`Error: ${error}`, 'response-error');
  }
}

function handleMiniChatKeydown(e: KeyboardEvent) {
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (miniChatHistory.value.length === 0) return;
    
    if (miniChatHistoryIndex.value === -1) {
      miniChatHistoryIndex.value = miniChatHistory.value.length - 1;
    } else if (miniChatHistoryIndex.value > 0) {
      miniChatHistoryIndex.value--;
    }
    
    miniChatInput.value = miniChatHistory.value[miniChatHistoryIndex.value];
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (miniChatHistoryIndex.value === -1) return;
    
    if (miniChatHistoryIndex.value < miniChatHistory.value.length - 1) {
      miniChatHistoryIndex.value++;
      miniChatInput.value = miniChatHistory.value[miniChatHistoryIndex.value];
    } else {
      miniChatHistoryIndex.value = -1;
      miniChatInput.value = '';
    }
  } else if (e.key === 'Enter') {
    e.preventDefault();
    sendMiniChatCommand();
  }
}

function addToMiniChatLog(message: string, type: string) {
  const timestamp = new Date().toLocaleTimeString();
  miniChatLog.value.push({ timestamp, message, type });
  
  // Keep only last 5 entries
  if (miniChatLog.value.length > 5) {
    miniChatLog.value.shift();
  }
}

// Quick Command Insertion
function insertQuickCommand(command: string) {
  if (fullChatModalOpen.value) {
    chatInput.value = command + ' ';
    nextTick(() => {
      chatInputField.value?.focus();
    });
  }
}

// Global keyboard shortcut handler
function handleGlobalKeydown(e: KeyboardEvent) {
    const target = e.target as HTMLElement;
  const isInputField = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
    
  // Check if "/" key is pressed and not in an input field
  if (e.key === '/' && !filterDropdownOpen.value && !isInputField) {
    e.preventDefault();
    filterDropdownOpen.value = true;
    setTimeout(() => {
      filterSearchInput.value?.focus();
    }, 100);
  }
  
  // Check if "!" key is pressed - open USB2SNES dropdown and focus chat
  if (e.key === '!' && !usb2snesDropdownOpen.value && !isInputField) {
    e.preventDefault();
    usb2snesDropdownOpen.value = true;
    setTimeout(() => {
      miniChatInputField.value?.focus();
    }, 100);
  }
  
  // Close dropdown on Escape
  if (e.key === 'Escape' && filterDropdownOpen.value) {
    closeFilterDropdown();
  }
  if (e.key === 'Escape' && selectDropdownOpen.value) {
    closeSelectDropdown();
  }
  if (e.key === 'Escape' && ignoreDropdownOpen.value) {
    closeIgnoreDropdown();
  }
  if (e.key === 'Escape' && usb2snesDropdownOpen.value) {
    closeUsb2snesDropdown();
  }
  if (e.key === 'Escape' && snesContentsDropdownOpen.value) {
    closeSnesContentsDropdown();
  }
}

// Close dropdown when clicking outside
function handleGlobalClick(e: MouseEvent) {
  const target = e.target as HTMLElement;
  
  // Close all dropdowns unless clicking inside them
  const allDropdowns = document.querySelectorAll('.filter-dropdown-container, .snes-contents-dropdown-container');
  
  let clickedInsideAnyDropdown = false;
  allDropdowns.forEach(dropdown => {
    if (dropdown.contains(target)) {
      clickedInsideAnyDropdown = true;
    }
  });
  
  // Check USB2SNES dropdown separately
  const usb2snesDropdown = document.querySelector('.usb2snes-dropdown-container');
  if (usb2snesDropdown && usb2snesDropdown.contains(target)) {
    clickedInsideAnyDropdown = true;
  }
  
  if (!clickedInsideAnyDropdown) {
    closeFilterDropdown();
    closeSelectDropdown();
    closeIgnoreDropdown();
    closeSnesContentsDropdown();
  }
}

function checkAllVisible() {
  for (const it of filteredItems.value) selectedIds.value.add(it.Id);
}

function uncheckAll() {
  selectedIds.value.clear();
}

function checkRandom() {
  if (filteredItems.value.length === 0) return;
  const randomIndex = Math.floor(Math.random() * filteredItems.value.length);
  const randomItem = filteredItems.value[randomIndex];
  selectedIds.value.clear();
  selectedIds.value.add(randomItem.Id);
}

function hideChecked() {
  for (const it of items) if (selectedIds.value.has(it.Id)) it.Hidden = true;
}

function unhideChecked() {
  for (const it of items) if (selectedIds.value.has(it.Id)) it.Hidden = false;
}

function applyBulkStatus() {
  const status = bulkStatus.value as ItemStatus | '';
  if (!status) return;
  for (const it of items) if (selectedIds.value.has(it.Id)) it.Status = status;
  bulkStatus.value = '';
}

function getSingleSelected(): Item | null {
  if (selectedIds.value.size !== 1) return null;
  const id = Array.from(selectedIds.value)[0];
  return items.find((it) => it.Id === id) ?? null;
}

async function startSelected() {
  // Get selected game IDs
  const selectedGameIds = Array.from(selectedIds.value);
  
  console.log('[QuickLaunch] Selected game IDs:', selectedGameIds);
  console.log('[QuickLaunch] Number of selected games:', selectedGameIds.length);
  
  if (selectedGameIds.length === 0 || selectedGameIds.length > 21) {
    alert('Please select between 1 and 21 games to launch.');
    return;
  }
  
  if (!isElectronAvailable()) {
    alert('Quick launch requires Electron environment');
    return;
  }
  
  // Validate settings
  if (!settings.vanillaRomPath || !settings.vanillaRomValid) {
    alert('Please configure a valid vanilla SMW ROM in Settings before staging games.');
    openSettings();
    return;
  }
  
  if (!settings.flipsPath || !settings.flipsValid) {
    alert('Please configure FLIPS executable in Settings before staging games.');
    openSettings();
    return;
  }
  
  try {
    // Show progress modal
    quickLaunchProgressModalOpen.value = true;
    quickLaunchProgressCurrent.value = 0;
    quickLaunchProgressTotal.value = selectedGameIds.length;
    quickLaunchProgressGameName.value = 'Preparing games...';
    
    // Listen for progress updates
    const ipcRenderer = (window as any).electronAPI.ipcRenderer;
    if (ipcRenderer) {
      ipcRenderer.on('quick-launch-progress', (_event: any, data: any) => {
        quickLaunchProgressCurrent.value = data.current;
        quickLaunchProgressTotal.value = data.total;
        quickLaunchProgressGameName.value = data.gameName || 'Processing...';
      });
    }
    
    // Stage games for quick launch
    console.log('[QuickLaunch] Calling stageQuickLaunchGames with:', {
      gameIds: selectedGameIds,
      vanillaRomPath: settings.vanillaRomPath,
      flipsPath: settings.flipsPath
    });
    
    const stagingResult = await (window as any).electronAPI.stageQuickLaunchGames({
      gameIds: selectedGameIds,
      vanillaRomPath: settings.vanillaRomPath,
      flipsPath: settings.flipsPath,
      tempDirOverride: settings.tempDirOverride || ''
    });
    
    console.log('[QuickLaunch] Staging result:', stagingResult);
    
    // Clean up progress listener
    if (ipcRenderer) {
      ipcRenderer.removeAllListeners('quick-launch-progress');
    }
    
    // Hide progress modal
    quickLaunchProgressModalOpen.value = false;
    
    console.log('Quick launch staging result:', stagingResult);
    
    if (!stagingResult.success) {
      alert('Failed to stage games: ' + stagingResult.error);
      return;
    }
    
    // Show success modal
    console.log('[QuickLaunch] Setting quickLaunchFolderPath to:', stagingResult.folderPath);
    console.log('[QuickLaunch] Games staged:', stagingResult.gamesStaged);
    console.log('[QuickLaunch] Staged files:', stagingResult.stagedFiles);
    quickLaunchFolderPath.value = stagingResult.folderPath;
    quickLaunchSfcCount.value = stagingResult.gamesStaged;
    quickLaunchStagedFiles.value = stagingResult.stagedFiles || []; // Store list of staged files
    quickLaunchSuccessModalOpen.value = true;
    
  } catch (error) {
    console.error('Error staging games for quick launch:', error);
    quickLaunchProgressModalOpen.value = false;
    alert('Error staging games: ' + error.message);
  }
}

function editNotes() {
  const it = getSingleSelected();
  if (!it) return;
  const current = it.Mynotes ?? '';
  const next = window.prompt('Edit notes:', current);
  if (next !== null) it.Mynotes = next;
}

function setMyRating() {
  const it = getSingleSelected();
  if (!it) return;
  const current = it.Myrating ?? '';
  const next = window.prompt('Set My rating (0-5):', String(current));
  if (next === null) return;
  const n = Number(next);
  if (!Number.isNaN(n) && n >= 0 && n <= 5) it.Myrating = n;
}

// Settings modal state and logic
const settingsModalOpen = ref(false);
const settings = reactive({
  theme: DEFAULT_THEME as ThemeName,
  textSize: DEFAULT_TEXT_SIZE as TextSize,
  vanillaRomPath: '',
  vanillaRomValid: false,
  flipsPath: '',
  flipsValid: false,
  asarPath: '',
  asarValid: false,
  uberAsmPath: '',
  uberAsmValid: false,
  launchMethod: 'manual' as 'manual' | 'program' | 'usb2snes',
  launchProgram: '',
  launchProgramArgs: '%file',
  usb2snesAddress: 'ws://localhost:64213',
  usb2snesEnabled: 'no' as 'yes' | 'no',
  usb2snesLibrary: 'usb2snes_a' as 'usb2snes_a' | 'usb2snes_b' | 'qusb2snes' | 'node-usb',
  usb2snesLaunchPref: 'auto' as 'auto' | 'manual' | 'reset',
  usb2snesUploadPref: 'manual' as 'manual' | 'check' | 'always',
  usb2snesUploadDir: '/work',
  tempDirOverride: '',
  tempDirValid: true,
});

function openSettings() {
  settingsModalOpen.value = true;
}

function closeSettings() {
  settingsModalOpen.value = false;
}

// Text size slider mapping (0-3 to text sizes)
const textSizeOptions: TextSize[] = ['small', 'medium', 'large', 'xlarge'];
const textSizeSliderValue = ref(textSizeOptions.indexOf(settings.textSize));

// Theme change handler
function onThemeChange() {
  applyTheme(settings.theme);
}

// Text size change handler
function onTextSizeChange() {
  settings.textSize = textSizeOptions[textSizeSliderValue.value];
  applyTextSize(settings.textSize);
}

async function saveSettings() {
  console.log('Saving settings:', settings);
  
  if (!isElectronAvailable()) {
    console.warn('Mock mode: Settings not saved (Electron not available)');
    closeSettings();
    return;
  }
  
  // Validate tempDirOverride if set
  if (settings.tempDirOverride && settings.tempDirOverride.trim() !== '') {
    try {
      const validation = await (window as any).electronAPI.validatePath(settings.tempDirOverride);
      if (!validation.exists || !validation.isDirectory) {
        alert('Temporary directory override path does not exist or is not a directory. Please provide a valid path or leave blank.');
        settings.tempDirValid = false;
        return;
      }
      settings.tempDirValid = true;
    } catch (error) {
      alert('Error validating temporary directory path: ' + error.message);
      settings.tempDirValid = false;
      return;
    }
  } else {
    settings.tempDirValid = true;
  }
  
  try {
    // Convert settings to object with string values
    const settingsToSave = {
      theme: settings.theme,
      textSize: settings.textSize,
      vanillaRomPath: settings.vanillaRomPath,
      vanillaRomValid: String(settings.vanillaRomValid),
      flipsPath: settings.flipsPath,
      flipsValid: String(settings.flipsValid),
      asarPath: settings.asarPath,
      asarValid: String(settings.asarValid),
      uberAsmPath: settings.uberAsmPath,
      uberAsmValid: String(settings.uberAsmValid),
      launchMethod: settings.launchMethod,
      launchProgram: settings.launchProgram,
      launchProgramArgs: settings.launchProgramArgs,
      usb2snesAddress: settings.usb2snesAddress,
      usb2snesEnabled: settings.usb2snesEnabled,
      usb2snesLaunchPref: settings.usb2snesLaunchPref,
      usb2snesUploadPref: settings.usb2snesUploadPref,
      usb2snesUploadDir: settings.usb2snesUploadDir,
      tempDirOverride: settings.tempDirOverride,
      tempDirValid: String(settings.tempDirValid),
    };
    
    const result = await (window as any).electronAPI.saveSettings(settingsToSave);
    if (result.success) {
      console.log('Settings saved successfully');
    } else {
      console.error('Failed to save settings:', result.error);
      alert(`Error saving settings: ${result.error}`);
    }
  } catch (error: any) {
    console.error('Error saving settings:', error);
    alert(`Error saving settings: ${error.message}`);
  }
  
  closeSettings();
}

// File import handlers
async function handleRomDrop(e: DragEvent) {
  e.preventDefault();
  const files = e.dataTransfer?.files;
  if (files && files.length > 0) {
    const filePath = files[0].path;
    await validateAndSetRom(filePath);
  }
}

async function browseRomFile() {
  if (!isElectronAvailable()) {
    alert('File selection requires Electron environment');
    return;
  }
  
  try {
    // Use the same dialog method as USB2SNES file upload (which works)
    const result = await (window as any).electronAPI.showOpenDialog({
      title: 'Select Vanilla SMW ROM',
      filters: [
        { name: 'SNES ROM Files', extensions: ['sfc', 'smc'] },
        { name: 'All Files', extensions: ['*'] }
      ],
      properties: ['openFile']
    });
    
    if (!result.canceled && result.filePaths && result.filePaths.length > 0) {
      const filePath = result.filePaths[0];
      await validateAndSetRom(filePath);
    }
  } catch (error: any) {
    console.error('Error browsing ROM file:', error);
    alert('Error selecting ROM file: ' + error.message);
  }
}

async function validateAndSetRom(filePath: string) {
  if (!isElectronAvailable()) return;
  
  try {
    const validation = await (window as any).electronAPI.validateRomFile(filePath);
    
    if (validation.valid) {
      settings.vanillaRomPath = filePath;
      settings.vanillaRomValid = true;
      console.log('✓ Valid ROM file set:', filePath);
    } else {
      settings.vanillaRomValid = false;
      alert('Invalid ROM file: ' + validation.error);
    }
  } catch (error: any) {
    console.error('Error validating ROM:', error);
    settings.vanillaRomValid = false;
    alert('Error validating ROM: ' + error.message);
  }
}

async function handleFlipsDrop(e: DragEvent) {
  e.preventDefault();
  const files = e.dataTransfer?.files;
  if (files && files.length > 0) {
    const filePath = files[0].path;
    await validateAndSetFlips(filePath);
  }
}

async function browseFlipsFile() {
  if (!isElectronAvailable()) {
    alert('File selection requires Electron environment');
    return;
  }
  
  try {
    const result = await (window as any).electronAPI.showOpenDialog({
      title: 'Select FLIPS Executable',
      filters: [
        { name: 'Executable Files', extensions: ['exe', '*'] },
        { name: 'All Files', extensions: ['*'] }
      ],
      properties: ['openFile']
    });
    
    if (!result.canceled && result.filePaths && result.filePaths.length > 0) {
      await validateAndSetFlips(result.filePaths[0]);
    }
  } catch (error: any) {
    console.error('Error browsing FLIPS file:', error);
    alert('Error selecting FLIPS file: ' + error.message);
  }
}

async function validateAndSetFlips(filePath: string) {
  if (!isElectronAvailable()) return;
  
  try {
    const validation = await (window as any).electronAPI.validateFlipsFile(filePath);
    
    if (validation.valid) {
      settings.flipsPath = filePath;
      settings.flipsValid = true;
      console.log('✓ Valid FLIPS file set:', filePath);
    } else {
      settings.flipsValid = false;
      alert('Invalid FLIPS file: ' + validation.error);
    }
  } catch (error: any) {
    console.error('Error validating FLIPS:', error);
    settings.flipsValid = false;
    alert('Error validating FLIPS: ' + error.message);
  }
}

async function handleAsarDrop(e: DragEvent) {
  e.preventDefault();
  const files = e.dataTransfer?.files;
  if (files && files.length > 0) {
    const filePath = files[0].path;
    await validateAndSetAsar(filePath);
  }
}

async function handleLaunchProgramDrop(e: DragEvent) {
  e.preventDefault();
  const files = e.dataTransfer?.files;
  if (files && files.length > 0) {
    const filePath = files[0].path;
    settings.launchProgram = filePath;
    console.log('✓ Launch program path set:', filePath);
  }
}

async function browseAsarFile() {
  if (!isElectronAvailable()) {
    alert('File selection requires Electron environment');
    return;
  }
  
  try {
    const result = await (window as any).electronAPI.showOpenDialog({
      title: 'Select ASAR Executable',
      filters: [
        { name: 'Executable Files', extensions: ['exe', '*'] },
        { name: 'All Files', extensions: ['*'] }
      ],
      properties: ['openFile']
    });
    
    if (!result.canceled && result.filePaths && result.filePaths.length > 0) {
      await validateAndSetAsar(result.filePaths[0]);
    }
  } catch (error: any) {
    console.error('Error browsing ASAR file:', error);
    alert('Error selecting ASAR file: ' + error.message);
  }
}

async function browseLaunchProgram() {
  if (!isElectronAvailable()) {
    alert('File selection requires Electron environment');
    return;
  }
  
  try {
    const result = await (window as any).electronAPI.showOpenDialog({
      title: 'Select Launch Program',
      filters: [
        { name: 'Executable Files', extensions: ['exe', 'sh', 'bat', 'cmd', '*'] },
        { name: 'All Files', extensions: ['*'] }
      ],
      properties: ['openFile']
    });
    
    if (!result.canceled && result.filePaths && result.filePaths.length > 0) {
      settings.launchProgram = result.filePaths[0];
      console.log('✓ Launch program path set:', result.filePaths[0]);
    }
  } catch (error: any) {
    console.error('Error browsing launch program:', error);
    alert('Error selecting launch program: ' + error.message);
  }
}

async function validateAndSetAsar(filePath: string) {
  if (!isElectronAvailable()) return;
  
  try {
    const validation = await (window as any).electronAPI.validateAsarFile(filePath);
    
    if (validation.valid) {
      settings.asarPath = filePath;
      settings.asarValid = true;
      console.log('✓ Valid ASAR file set:', filePath);
    } else {
      settings.asarValid = false;
      alert('Invalid ASAR file: ' + validation.error);
    }
  } catch (error: any) {
    console.error('Error validating ASAR:', error);
    settings.asarValid = false;
    alert('Error validating ASAR: ' + error.message);
  }
}

async function handleUberAsmDrop(e: DragEvent) {
  e.preventDefault();
  const files = e.dataTransfer?.files;
  if (files && files.length > 0) {
    const filePath = files[0].path;
    await validateAndSetUberAsm(filePath);
  }
}

async function browseUberAsmFile() {
  if (!isElectronAvailable()) {
    alert('File selection requires Electron environment');
    return;
  }
  
  try {
    const result = await (window as any).electronAPI.showOpenDialog({
      title: 'Select UberASM Executable',
      filters: [
        { name: 'Executable Files', extensions: ['exe', '*'] },
        { name: 'All Files', extensions: ['*'] }
      ],
      properties: ['openFile']
    });
    
    if (!result.canceled && result.filePaths && result.filePaths.length > 0) {
      await validateAndSetUberAsm(result.filePaths[0]);
    }
  } catch (error: any) {
    console.error('Error browsing UberASM file:', error);
    alert('Error selecting UberASM file: ' + error.message);
  }
}

async function validateAndSetUberAsm(filePath: string) {
  if (!isElectronAvailable()) return;
  
  try {
    const validation = await (window as any).electronAPI.validateUberAsmFile(filePath);
    
    if (validation.valid) {
      settings.uberAsmPath = filePath;
      settings.uberAsmValid = true;
      console.log('✓ Valid UberASM file set:', filePath);
    } else {
      settings.uberAsmValid = false;
      alert('Invalid UberASM file: ' + validation.error);
    }
  } catch (error: any) {
    console.error('Error validating UberASM:', error);
    settings.uberAsmValid = false;
    alert('Error validating UberASM: ' + error.message);
  }
}

// Right-side panels state and helpers
type Stage = {
  key: string; // unique key: `${parentId}-${exitNumber}`
  parentId: string;
  exitNumber: string;
  description: string;
  publicRating?: number;
  myNotes?: string;
  myDifficultyRating?: number | null;
  myReviewRating?: number | null;
};

// Demo stage data per item id
const stagesByItemId = reactive<Record<string, Stage[]>>({
  '11374': [
    { key: '11374-1', parentId: '11374', exitNumber: '1', description: 'Intro stage', publicRating: 4.2, myNotes: '', myDifficultyRating: 3, myReviewRating: 4 },
    { key: '11374-2', parentId: '11374', exitNumber: '2', description: 'Shell level', publicRating: 4.5, myNotes: 'practice', myDifficultyRating: 5, myReviewRating: 5 },
  ],
  '17289': [
    { key: '17289-0x0F', parentId: '17289', exitNumber: '0x0F', description: 'Custom level jump', publicRating: 4.6, myNotes: 'good practice', myDifficultyRating: 5, myReviewRating: 4 },
  ],
  '20091': [],
});

const selectedItem = computed(() => {
  const id = Array.from(selectedIds.value)[0];
  return items.find((it) => it.Id === id) ?? null;
});

const currentStages = computed<Stage[]>(() => {
  if (!selectedItem.value) return [];
  return stagesByItemId[selectedItem.value.Id] ?? [];
});

const selectedStageIds = ref<Set<string>>(new Set());

const allStagesChecked = computed(() => {
  const list = currentStages.value;
  if (list.length === 0) return false;
  return list.every((s) => selectedStageIds.value.has(s.key));
});

function toggleCheckAllStages(e: Event) {
  const target = e.target as HTMLInputElement;
  if (target.checked) {
    for (const st of currentStages.value) selectedStageIds.value.add(st.key);
  } else {
    for (const st of currentStages.value) selectedStageIds.value.delete(st.key);
  }
}

function toggleStageSelection(key: string, e: Event) {
  const checked = (e.target as HTMLInputElement).checked;
  if (checked) selectedStageIds.value.add(key);
  else selectedStageIds.value.delete(key);
}

function addStagesToRun() {
  const ids = Array.from(selectedStageIds.value.values());
  if (ids.length === 0) return;
  
  let addedCount = 0;
  for (const stageKey of ids) {
    const stage = currentStages.value.find(s => s.key === stageKey);
    if (!stage) continue;
    
    const key = `stage-${stage.key}-${Date.now()}-${addedCount}`;
    runEntries.push({
      key,
      id: stage.parentId,
      entryType: 'stage',  // Locked as 'stage' type
      name: selectedItem.value?.Name || '',
      stageNumber: stage.exitNumber,
      stageName: stage.description,
      count: 1,
      // No filter fields for specific stages
      filterDifficulty: '',
      filterType: '',
      filterPattern: '',
      seed: '',
      isLocked: true,  // Mark as locked (can't change type)
      conditions: [],  // Challenge conditions
    });
    addedCount++;
  }
  
  selectedStageIds.value.clear();
  console.log(`Added ${addedCount} stages to run`);
}

function editStageNotes() {
  const ids = Array.from(selectedStageIds.value.values());
  if (ids.length === 0) return;
  const next = window.prompt('Set notes for selected stages:');
  if (next === null) return;
  for (const st of currentStages.value) if (selectedStageIds.value.has(st.key)) st.myNotes = next;
}

function setStageRating(type: 'difficulty' | 'review') {
  const ids = Array.from(selectedStageIds.value.values());
  if (ids.length === 0) return;
  const label = type === 'difficulty' ? 'Difficulty' : 'Review';
  const next = window.prompt(`Set ${label} rating (1-5) for selected stages:`);
  if (next === null) return;
  const n = Number(next);
  if (Number.isNaN(n) || n < 1 || n > 5) return;
  for (const st of currentStages.value) {
    if (selectedStageIds.value.has(st.key)) {
      if (type === 'difficulty') {
        st.myDifficultyRating = n;
      } else {
        st.myReviewRating = n;
      }
    }
  }
}

// Prepare Run modal state and logic
type ChallengeCondition = 'Hitless' | 'Deathless' | 'No Coins' | 'No Powerups' | 'No Midway';

type RunEntry = {
  key: string;
  id: string;
  entryType: 'game' | 'stage' | 'random_game' | 'random_stage';
  name: string;
  stageNumber?: string;
  stageName?: string;
  count: number;
  filterDifficulty?: '' | 'beginner' | 'intermediate' | 'expert';
  filterType?: '' | 'standard' | 'kaizo' | 'traditional';
  filterPattern?: string;
  seed?: string;
  isLocked?: boolean;  // If true, entry type cannot be changed
  conditions: ChallengeCondition[];  // Challenge conditions for this entry
};

const runModalOpen = ref(false);
const runEntries = reactive<RunEntry[]>([]);
const checkedRun = ref<Set<string>>(new Set());
const globalRunConditions = ref<ChallengeCondition[]>([]);  // Global conditions for entire run

// Run execution state
const currentRunUuid = ref<string | null>(null);
const currentRunStatus = ref<'preparing' | 'active' | 'completed' | 'cancelled'>('preparing');
const currentRunName = ref<string>('');
const currentChallengeIndex = ref<number>(0);
const runStartTime = ref<number | null>(null);
const runElapsedSeconds = ref<number>(0);
const runPauseSeconds = ref<number>(0);
const isRunPaused = ref<boolean>(false);
const runTimerInterval = ref<number | null>(null);

// Challenge results tracking
type ChallengeResult = {
  index: number;
  status: 'pending' | 'success' | 'skipped' | 'ok';
  durationSeconds: number;
  revealedEarly: boolean;
};
const challengeResults = ref<ChallengeResult[]>([]);
const undoStack = ref<ChallengeResult[]>([]);

// Run name input modal
const runNameModalOpen = ref(false);
const runNameInput = ref<string>('My Challenge Run');

// Resume run modal
const resumeRunModalOpen = ref(false);
const resumeRunData = ref<any>(null);

// Staging progress modal
const stagingProgressModalOpen = ref(false);
const stagingProgressCurrent = ref(0);
const stagingProgressTotal = ref(0);
const stagingProgressGameName = ref('');

// Staging success modal
const stagingSuccessModalOpen = ref(false);
const stagingFolderPath = ref('');
const stagingSfcCount = ref(0);
const runStagingActionStatus = ref('');

// Run upload progress modal
const runUploadProgressModalOpen = ref(false);
const runUploadOverallCurrent = ref(0);
const runUploadOverallTotal = ref(0);
const runUploadFileName = ref('');
const runUploadFilePercent = ref(0);
const runUploadStatusLog = ref('');
const runUploadInProgress = ref(false);
const runUploadStatusLogTextarea = ref(null as HTMLTextAreaElement | null);
let runUploadCancelRequested = false;

// Quick launch progress modal
const quickLaunchProgressModalOpen = ref(false);
const quickLaunchProgressCurrent = ref(0);
const quickLaunchProgressTotal = ref(0);
const quickLaunchProgressGameName = ref('');

// Quick launch success modal
const quickLaunchSuccessModalOpen = ref(false);
const quickLaunchFolderPath = ref('');
const quickLaunchSfcCount = ref(0);
const quickLaunchStagedFiles = ref<string[]>([]); // List of files from most recent staging
const quickLaunchActionStatus = ref('');
const quickLaunchSelectedFile = ref('');

const allRunChecked = computed(() => runEntries.length > 0 && runEntries.every((e) => checkedRun.value.has(e.key)));
const checkedRunCount = computed(() => checkedRun.value.size);
const isRunSaved = computed(() => currentRunUuid.value !== null && currentRunStatus.value === 'preparing');
const isRunActive = computed(() => currentRunStatus.value === 'active');
const currentChallenge = computed(() => {
  if (!isRunActive.value || currentChallengeIndex.value >= runEntries.length) return null;
  return runEntries[currentChallengeIndex.value];
});
const currentChallengeSfcPath = computed(() => {
  if (!currentChallenge.value) return null;
  // Get sfcpath from the entry if it has been uploaded to USB2SNES
  return (currentChallenge.value as any).sfcpath || null;
});
const canUndo = computed(() => undoStack.value.length > 0);

// Watch for current challenge changes to reveal random challenges
watch(currentChallengeIndex, async (newIndex, oldIndex) => {
  console.log('[watch:currentChallengeIndex] Changed from', oldIndex, 'to', newIndex);
  
  if (!isRunActive.value || newIndex >= runEntries.length) {
    console.log('[watch:currentChallengeIndex] Not active or out of bounds, returning');
    return;
  }
  
  const challenge = runEntries[newIndex];
  console.log('[watch:currentChallengeIndex] Challenge:', newIndex, 'id:', challenge.id, 'name:', challenge.name);
  
  // Check if this is an unrevealed random challenge
  if (challenge.id === '(random)' && challenge.name === '???') {
    console.log('[watch:currentChallengeIndex] Unrevealed random challenge detected, revealing...');
    await revealCurrentChallenge(false);  // Not revealed early (normal reveal)
  } else {
    console.log('[watch:currentChallengeIndex] Challenge already revealed or not random');
  }
});

async function openRunModal() {
  if (!randomFilter.count) randomFilter.count = 1;
  
  // Load filter values if not already loaded
  if (randomFilterValues.value.difficulties.length === 0 || randomFilterValues.value.types.length === 0) {
    await loadRandomFilterValues();
  }
  
  // Generate a new seed if not set
  if (!randomFilter.seed && isElectronAvailable()) {
    try {
      const result = await (window as any).electronAPI.generateSeed();
      if (result.success) {
        randomFilter.seed = result.seed;
        console.log(`Generated seed: ${result.seed} (mapping ${result.mapId}, ${result.gameCount} games)`);
      }
    } catch (error) {
      console.error('Error generating seed:', error);
      // Fallback
      randomFilter.seed = 'ERROR-' + Math.random().toString(36).slice(2, 7);
    }
  }
  
  runModalOpen.value = true;
}
function closeRunModal() {
  runModalOpen.value = false;
}
function toggleCheckAllRun(e: Event) {
  const target = e.target as HTMLInputElement;
  if (target.checked) {
    for (const e of runEntries) checkedRun.value.add(e.key);
  } else {
    for (const e of runEntries) checkedRun.value.delete(e.key);
  }
}
function checkAllRun() {
  for (const e of runEntries) checkedRun.value.add(e.key);
}
function uncheckAllRun() {
  checkedRun.value.clear();
}
function removeCheckedRun() {
  if (checkedRun.value.size === 0) return;
  const keep = runEntries.filter((e) => !checkedRun.value.has(e.key));
  runEntries.splice(0, runEntries.length, ...keep);
  checkedRun.value.clear();
}

function toggleRunEntrySelection(key: string, e: Event) {
  const checked = (e.target as HTMLInputElement).checked;
  if (checked) {
    checkedRun.value.add(key);
  } else {
    checkedRun.value.delete(key);
  }
}

// Row reordering
const draggedIndex = ref<number | null>(null);

function moveRowUp(index: number) {
  if (index === 0) return;
  const temp = runEntries[index];
  runEntries[index] = runEntries[index - 1];
  runEntries[index - 1] = temp;
}

function moveRowDown(index: number) {
  if (index >= runEntries.length - 1) return;
  const temp = runEntries[index];
  runEntries[index] = runEntries[index + 1];
  runEntries[index + 1] = temp;
}

function handleDragStart(index: number, e: DragEvent) {
  draggedIndex.value = index;
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(index));
  }
}

function handleDragOver(index: number, e: DragEvent) {
  e.preventDefault();
  if (e.dataTransfer) {
    e.dataTransfer.dropEffect = 'move';
  }
}

function handleDrop(dropIndex: number, e: DragEvent) {
  e.preventDefault();
  if (draggedIndex.value === null || draggedIndex.value === dropIndex) return;
  
  const dragIdx = draggedIndex.value;
  const item = runEntries[dragIdx];
  runEntries.splice(dragIdx, 1);
  runEntries.splice(dropIndex, 0, item);
}

function handleDragEnd() {
  draggedIndex.value = null;
}

// Bulk move operations
const canMoveCheckedUp = computed(() => {
  if (checkedRun.value.size === 0) return false;
  // Can't move up if first item is checked
  const firstCheckedIndex = runEntries.findIndex(e => checkedRun.value.has(e.key));
  return firstCheckedIndex > 0;
});

const canMoveCheckedDown = computed(() => {
  if (checkedRun.value.size === 0) return false;
  // Can't move down if last item is checked
  const lastCheckedIndex = runEntries.map((e, i) => checkedRun.value.has(e.key) ? i : -1)
    .reduce((max, val) => Math.max(max, val), -1);
  return lastCheckedIndex < runEntries.length - 1;
});

function moveCheckedUp() {
  if (!canMoveCheckedUp.value) return;
  
  // Move from top to bottom to preserve relative order
  for (let i = 1; i < runEntries.length; i++) {
    if (checkedRun.value.has(runEntries[i].key) && !checkedRun.value.has(runEntries[i - 1].key)) {
      const temp = runEntries[i];
      runEntries[i] = runEntries[i - 1];
      runEntries[i - 1] = temp;
    }
  }
}

function moveCheckedDown() {
  if (!canMoveCheckedDown.value) return;
  
  // Move from bottom to top to preserve relative order
  for (let i = runEntries.length - 2; i >= 0; i--) {
    if (checkedRun.value.has(runEntries[i].key) && !checkedRun.value.has(runEntries[i + 1].key)) {
      const temp = runEntries[i];
      runEntries[i] = runEntries[i + 1];
      runEntries[i + 1] = temp;
    }
  }
}

const randomFilter = reactive({ type: 'any', difficulty: 'any', pattern: '', count: 1 as number | null, seed: '' });
const randomFilterValues = ref<{difficulties: string[], types: string[]}>({ difficulties: [], types: [] });
const randomMatchCount = ref<number | null>(null);
const randomMatchCountError = ref<string>('');
const isRandomAddValid = computed(() => {
  const validCount = typeof randomFilter.count === 'number' && randomFilter.count >= 1 && randomFilter.count <= 100;
  // If we have a match count, ensure it's sufficient (count + 2)
  if (randomMatchCount.value !== null) {
    const requiredCount = (randomFilter.count || 0) + 2;
    return validCount && randomMatchCount.value >= requiredCount;
  }
  return validCount;
});

// Watch for random filter changes to update match count
watch(() => [randomFilter.type, randomFilter.difficulty, randomFilter.pattern, randomFilter.count], async () => {
  // Only update if we have filter values
  if (randomFilter.type !== 'any' || randomFilter.difficulty !== 'any' || randomFilter.pattern) {
    try {
      const result = await (window as any).electronAPI.countRandomMatches({
        filterType: randomFilter.type === 'any' ? '' : randomFilter.type,
        filterDifficulty: randomFilter.difficulty === 'any' ? '' : randomFilter.difficulty,
        filterPattern: randomFilter.pattern || ''
      });
      
      if (result.success) {
        randomMatchCount.value = result.count;
        const requiredCount = (randomFilter.count || 0) + 2;
        
        if (result.count < requiredCount) {
          randomMatchCountError.value = `Insufficient games: ${result.count} match filters, but need at least ${requiredCount} (count + 2)`;
        } else {
          randomMatchCountError.value = '';
        }
      }
    } catch (error) {
      console.error('Error counting random matches:', error);
    }
  } else {
    // Reset if all filters are "any" and pattern is empty
    randomMatchCount.value = null;
    randomMatchCountError.value = '';
  }
}, { deep: true });

async function loadRandomFilterValues() {
  if (!isElectronAvailable()) {
    console.warn('Electron not available, using default filter values');
    return;
  }
  
  try {
    const result = await (window as any).electronAPI.getRandomFilterValues();
    if (result.success) {
      randomFilterValues.value = {
        difficulties: result.difficulties || [],
        types: result.types || []
      };
      console.log('Loaded filter values:', randomFilterValues.value);
    }
  } catch (error) {
    console.error('Error loading random filter values:', error);
  }
}

async function regenerateSeed() {
  if (!isElectronAvailable()) {
    randomFilter.seed = 'MOCK-' + Math.random().toString(36).slice(2, 7);
    return;
  }
  
  try {
    const result = await (window as any).electronAPI.generateSeed();
    if (result.success) {
      randomFilter.seed = result.seed;
      console.log(`Generated seed: ${result.seed} (${result.gameCount} games)`);
    } else {
      alert('Failed to generate seed: ' + result.error);
    }
  } catch (error) {
    console.error('Error generating seed:', error);
    alert('Error generating seed');
  }
}

async function addRandomGameToRun() {
  if (!isRandomAddValid.value) return;
  
  // Count matching games
  try {
    const result = await (window as any).electronAPI.countRandomMatches({
      filterType: randomFilter.type === 'any' ? '' : randomFilter.type,
      filterDifficulty: randomFilter.difficulty === 'any' ? '' : randomFilter.difficulty,
      filterPattern: randomFilter.pattern || ''
    });
    
    if (result.success) {
      randomMatchCount.value = result.count;
      const requiredCount = (randomFilter.count || 0) + 2;
      
      if (result.count < requiredCount) {
        randomMatchCountError.value = `Insufficient games: ${result.count} match filters, but need at least ${requiredCount} (count + 2)`;
        alert(`Cannot add random game:\n\n${randomMatchCountError.value}\n\nPlease adjust your filters to match more games.`);
        return;
      }
      
      randomMatchCountError.value = '';
    }
  } catch (error) {
    console.error('Error counting random matches:', error);
    randomMatchCount.value = null;
    randomMatchCountError.value = 'Failed to validate filters';
  }
  
  const key = `rand-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const seed = (randomFilter.seed && randomFilter.seed.trim().length > 0)
    ? randomFilter.seed.trim()
    : '';
  
  if (!seed) {
    alert('Seed is required for random challenges. Please wait for seed generation or enter manually.');
    return;
  }
  
  runEntries.push({
    key,
    id: '(random)',
    entryType: 'random_game',  // Default to random_game
    name: 'Random Game',
    stageNumber: '',
    stageName: '',
    count: (randomFilter.count as number) || 1,
    filterDifficulty: randomFilter.difficulty === 'any' ? '' : (randomFilter.difficulty as any),
    filterType: randomFilter.type === 'any' ? '' : (randomFilter.type as any),
    filterPattern: randomFilter.pattern || '',
    seed,
    matchCount: randomMatchCount.value,  // Store the match count for display
    isLocked: false,  // Can change between random_game and random_stage
    conditions: [],  // Challenge conditions
  });
  
  // Generate new seed for next entry
  regenerateSeed();
}

function stageRun(mode: 'save' | 'upload') {
  console.log('Stage run', mode, runEntries);
  
  // If no name yet, open name input modal
  if (!currentRunName.value) {
    runNameInput.value = 'My Challenge Run';
    runNameModalOpen.value = true;
  } else {
    // Already have name, just save
    saveRunToDatabase();
  }
}

async function saveRunToDatabase() {
  if (!isElectronAvailable()) {
    alert('Run saving requires Electron environment');
    return;
  }
  
  try {
    const runName = currentRunName.value;
    if (!runName) {
      alert('Run name is required');
      return;
    }
    
    // Validate all random entries have sufficient matching games based on stored matchCount
    const randomEntries = runEntries.filter(entry => entry.entryType === 'random_game' || entry.entryType === 'random_stage');
    for (const entry of randomEntries) {
      const matchCount = entry.matchCount;
      const requiredCount = (entry.count || 1) + 2;
      
      if (matchCount === null || matchCount === undefined) {
        alert(`Cannot stage run:\n\nRandom entry "${entry.name}" has no match count.\nThis entry may have been added before the match counting feature was implemented.\n\nPlease remove and re-add this entry.`);
        return;
      }
      
      if (matchCount < requiredCount) {
        alert(`Cannot stage run:\n\nRandom entry "${entry.name}" has insufficient matching games:\n${matchCount} games match the filters, but need at least ${requiredCount} (count + 2).\n\nPlease reduce the count or remove this entry.`);
        return;
      }
    }
    
    // Convert reactive objects to plain objects for IPC
    const plainGlobalConditions = JSON.parse(JSON.stringify(globalRunConditions.value));
    const plainRunEntries = JSON.parse(JSON.stringify(runEntries));
    
    // Create run in database
    const result = await (window as any).electronAPI.createRun(
      runName,
      '',  // runDescription
      plainGlobalConditions
    );
    
    if (!result.success) {
      alert('Failed to create run: ' + result.error);
      return;
    }
    
    // Save run plan
    const planResult = await (window as any).electronAPI.saveRunPlan(
      result.runUuid,
      plainRunEntries
    );
    
    if (!planResult.success) {
      alert('Failed to save run plan: ' + planResult.error);
      return;
    }
    
    currentRunUuid.value = result.runUuid;
    currentRunStatus.value = 'preparing';
    console.log('Run saved with UUID:', result.runUuid);
    
    // Now stage the run (generate SFC files)
    await stageRunGames(result.runUuid, runName);
    
  } catch (error) {
    console.error('Error saving run:', error);
    alert('Error saving run: ' + error.message);
  }
}

async function stageRunGames(runUuid: string, runName: string) {
  try {
    // Show progress modal
    stagingProgressModalOpen.value = true;
    stagingProgressCurrent.value = 0;
    stagingProgressTotal.value = runEntries.length;
    stagingProgressGameName.value = 'Expanding run plan...';
    
    // Step 1: Expand plan and select all random games
    const expandResult = await (window as any).electronAPI.expandAndStageRun({ runUuid });
    
    if (!expandResult.success) {
      stagingProgressModalOpen.value = false;
      alert('Failed to expand run plan: ' + expandResult.error);
      return;
    }
    
    // Listen for progress updates
    const ipcRenderer = (window as any).electronAPI.ipcRenderer;
    if (ipcRenderer) {
      ipcRenderer.on('staging-progress', (_event: any, data: any) => {
        stagingProgressCurrent.value = data.current;
        stagingProgressTotal.value = data.total;
        stagingProgressGameName.value = data.gameName || 'Processing...';
      });
    }
    
    // Step 2: Stage games (create SFC files)
    stagingProgressGameName.value = 'Creating game files...';
    const stagingResult = await (window as any).electronAPI.stageRunGames({
      runUuid,
      vanillaRomPath: settings.vanillaRomPath,
      flipsPath: settings.flipsPath
    });
    
    // Clean up progress listener
    if (ipcRenderer) {
      ipcRenderer.removeAllListeners('staging-progress');
    }
    
    // Hide progress modal
    stagingProgressModalOpen.value = false;
    
    console.log('Staging result:', stagingResult);
    
    if (!stagingResult.success) {
      alert('Failed to stage run games: ' + stagingResult.error);
      return;
    }
    
    // Show success modal
    console.log('Setting folder path:', stagingResult.folderPath);
    console.log('Setting games staged:', stagingResult.gamesStaged);
    stagingFolderPath.value = stagingResult.folderPath;
    stagingSfcCount.value = stagingResult.gamesStaged;
    stagingSuccessModalOpen.value = true;
    
  } catch (error) {
    console.error('Error staging run games:', error);
    stagingProgressModalOpen.value = false;
    alert('Error staging run games: ' + error.message);
  }
}

function confirmRunName() {
  if (!runNameInput.value || runNameInput.value.trim() === '') {
    alert('Please enter a run name');
    return;
  }
  currentRunName.value = runNameInput.value;
  runNameModalOpen.value = false;
  saveRunToDatabase();
}

function cancelRunName() {
  runNameModalOpen.value = false;
}

function closeStagingSuccess() {
  stagingSuccessModalOpen.value = false;
  runStagingActionStatus.value = '';
}

function openStagingFolder() {
  if (stagingFolderPath.value) {
    // Use shell to open folder
    const shell = (window as any).electronAPI.shell;
    if (shell && shell.openPath) {
      shell.openPath(stagingFolderPath.value);
    }
  }
}

async function launchRunGame(gameNumber: number) {
  if (!stagingFolderPath.value) {
    runStagingActionStatus.value = '✗ No run folder available';
    return;
  }
  
  try {
    // Get list of SFC files in the run folder
    const folderContents = await (window as any).electronAPI.readDirectory(stagingFolderPath.value);
    const sfcFiles = folderContents.filter((f: string) => f.endsWith('.sfc')).sort();
    
    if (sfcFiles.length === 0) {
      runStagingActionStatus.value = '✗ No .sfc files found in run folder';
      return;
    }
    
    if (gameNumber < 1 || gameNumber > sfcFiles.length) {
      runStagingActionStatus.value = `✗ Game ${gameNumber} not found (only ${sfcFiles.length} games staged)`;
      return;
    }
    
    const fileToLaunch = sfcFiles[gameNumber - 1];
    const filePath = `${stagingFolderPath.value}/${fileToLaunch}`;
    
    runStagingActionStatus.value = `Launching game ${gameNumber}: ${fileToLaunch}...`;
    
    // Get launch program from settings
    const launchProgram = settings.launchProgram || '';
    const launchArgs = settings.launchProgramArgs || '';
    
    if (!launchProgram) {
      runStagingActionStatus.value = '✗ No launch program configured in settings';
      return;
    }
    
    // Use IPC to launch program with arguments
    await (window as any).electronAPI.launchProgram(launchProgram, launchArgs, filePath);
    
    runStagingActionStatus.value = `✓ Launched game ${gameNumber}: ${fileToLaunch}`;
  } catch (error) {
    runStagingActionStatus.value = `✗ Launch error: ${error}`;
  }
}

async function uploadRunToSnes() {
  if (!stagingFolderPath.value || !currentRunUuid.value) {
    runStagingActionStatus.value = '✗ No run staged';
    return;
  }
  
  // Reset state and show progress modal
  runUploadCancelRequested = false;
  runUploadProgressModalOpen.value = true;
  runUploadInProgress.value = true;
  runUploadOverallCurrent.value = 0;
  runUploadOverallTotal.value = 0;
  runUploadFileName.value = '';
  runUploadFilePercent.value = 0;
  runUploadStatusLog.value = '';
  
  // Helper to add to status log
  const addToLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    runUploadStatusLog.value += `[${timestamp}] ${message}\n`;
    // Auto-scroll to bottom
    nextTick(() => {
      const textarea = runUploadStatusLogTextarea.value;
      if (textarea) {
        textarea.scrollTop = textarea.scrollHeight;
      }
    });
  };
  
  addToLog('Starting upload to USB2SNES...');
  
  // Check USB2SNES connection and auto-connect if needed
  addToLog('Checking USB2SNES connection...');
  if (!usb2snesStatus.connected) {
    addToLog('USB2SNES not connected');
    
    // Check if USB2SNES is enabled in settings
    if (settings.usb2snesEnabled) {
      addToLog('USB2SNES is enabled in settings, attempting to connect...');
      
      try {
        await connectUsb2snes();
        
        // Wait a moment for connection to establish
        await new Promise(resolve => setTimeout(resolve, 500));
        
        if (usb2snesStatus.connected) {
          addToLog('✓ USB2SNES connected successfully');
        } else {
          addToLog('✗ Failed to connect to USB2SNES');
          runUploadInProgress.value = false;
          runStagingActionStatus.value = '✗ Upload failed: Could not connect to USB2SNES';
          return;
        }
      } catch (connectError) {
        addToLog(`✗ Connection error: ${connectError}`);
        runUploadInProgress.value = false;
        runStagingActionStatus.value = `✗ Upload failed: ${connectError}`;
        return;
      }
    } else {
      addToLog('✗ USB2SNES is disabled in settings');
      runUploadInProgress.value = false;
      runStagingActionStatus.value = '✗ Upload failed: USB2SNES is disabled in settings';
      return;
    }
  } else {
    addToLog('✓ USB2SNES already connected');
  }
  
  // Listen for progress events
  const ipcRenderer = (window as any).electronAPI.ipcRenderer;
  if (ipcRenderer) {
    ipcRenderer.on('run-upload-progress', (_event: any, data: any) => {
      runUploadOverallCurrent.value = data.current;
      runUploadOverallTotal.value = data.total;
      runUploadFileName.value = data.filename;
      runUploadFilePercent.value = 0;
      addToLog(`Uploading ${data.current}/${data.total}: ${data.filename}`);
    });
    
    // Also listen for individual file progress from usb2snes:uploadProgress
    ipcRenderer.on('usb2snes:uploadProgress', (_event: any, data: any) => {
      runUploadFilePercent.value = data.percent;
    });
  }
  
  try {
    const result = await (window as any).electronAPI.uploadRunToSnes({
      runUuid: currentRunUuid.value,
      runFolderPath: stagingFolderPath.value
    });
    
    // Clean up listeners
    if (ipcRenderer) {
      ipcRenderer.removeAllListeners('run-upload-progress');
      ipcRenderer.removeAllListeners('usb2snes:uploadProgress');
    }
    
    runUploadInProgress.value = false;
    
    if (result.success) {
      addToLog(`✓ Upload complete: ${result.filesUploaded} files uploaded to ${result.snesPath}`);
      runStagingActionStatus.value = `✓ Uploaded ${result.filesUploaded} files to ${result.snesPath}`;
      
      // Auto-close on success after 2 seconds
      setTimeout(() => {
        if (runUploadProgressModalOpen.value && !runUploadInProgress.value) {
          runUploadProgressModalOpen.value = false;
        }
      }, 2000);
    } else {
      addToLog(`✗ Upload failed: ${result.error}`);
      runStagingActionStatus.value = `✗ Upload failed: ${result.error}`;
      // Keep modal open on error so user can see the log
    }
  } catch (error) {
    // Clean up listeners
    if (ipcRenderer) {
      ipcRenderer.removeAllListeners('run-upload-progress');
      ipcRenderer.removeAllListeners('usb2snes:uploadProgress');
    }
    
    runUploadInProgress.value = false;
    addToLog(`✗ Upload error: ${error}`);
    runStagingActionStatus.value = `✗ Upload error: ${error}`;
    // Keep modal open on error
  }
}

function cancelRunUpload() {
  runUploadCancelRequested = true;
  runUploadInProgress.value = false;
  addToLog('Upload cancelled by user');
  // Note: Actual cancellation would need to be implemented in the backend
}

function closeRunUploadProgress() {
  runUploadProgressModalOpen.value = false;
}

function addToLog(message: string) {
  const timestamp = new Date().toLocaleTimeString();
  runUploadStatusLog.value += `[${timestamp}] ${message}\n`;
  // Auto-scroll to bottom
  nextTick(() => {
    const textarea = runUploadStatusLogTextarea.value;
    if (textarea) {
      textarea.scrollTop = textarea.scrollHeight;
    }
  });
}

function closeQuickLaunchSuccess() {
  quickLaunchSuccessModalOpen.value = false;
  // Clear folder path and staged files list to prevent uploading stale games
  // User must click Start again to stage different games
  quickLaunchFolderPath.value = '';
  quickLaunchStagedFiles.value = [];
  quickLaunchActionStatus.value = '';
}

function openQuickLaunchFolder() {
  if (quickLaunchFolderPath.value) {
    // Use shell to open folder
    const shell = (window as any).electronAPI.shell;
    if (shell && shell.openPath) {
      shell.openPath(quickLaunchFolderPath.value);
    }
  }
}

async function uploadStagedToSnes(andBoot: boolean = false) {
  // Check if games are staged
  if (!quickLaunchFolderPath.value || quickLaunchStagedFiles.value.length === 0) {
    quickLaunchActionStatus.value = '✗ No games staged. Click Start first to stage games.';
    return;
  }
  
  // Use the list of files we actually staged (not all files in directory!)
  const sfcFiles = quickLaunchStagedFiles.value;
  console.log(`[Upload] Uploading ${sfcFiles.length} staged file(s):`, sfcFiles);
  
  if (sfcFiles.length === 0) {
    quickLaunchActionStatus.value = '✗ No .sfc files found in staging list';
    return;
  }
  
  try {
    // Check if USB2SNES is connected, auto-connect if not
    quickLaunchActionStatus.value = 'Checking USB2SNES connection...';
    await refreshUsb2snesStatus();
    
    if (!usb2snesStatus.connected) {
      quickLaunchActionStatus.value = 'Connecting to USB2SNES...';
      
      try {
        const library = usb2snesCurrentLibrary.value;
        const address = settings.usb2snesAddress;
        const result = await (window as any).electronAPI.usb2snesConnect(library, address);
        
        usb2snesStatus.connected = true;
        usb2snesStatus.device = result.device;
        usb2snesStatus.firmwareVersion = result.firmwareVersion || 'N/A';
        usb2snesStatus.versionString = result.versionString || 'N/A';
        usb2snesStatus.romRunning = result.romRunning || 'N/A';
        startHealthMonitoring();
      } catch (connectError) {
        quickLaunchActionStatus.value = `✗ Connection failed: ${connectError}`;
        return;
      }
    }
    
    // Upload ALL staged files
    let uploadedCount = 0;
    let lastUploadedFile = '';
    
    for (let i = 0; i < sfcFiles.length; i++) {
      const fileToUpload = sfcFiles[i];
      const srcPath = `${quickLaunchFolderPath.value}/${fileToUpload}`;
      const dstPath = `/work/${fileToUpload}`;
      
      quickLaunchActionStatus.value = `Uploading ${i + 1}/${sfcFiles.length}: ${fileToUpload}...`;
      console.log(`[Upload] Uploading file ${i + 1}/${sfcFiles.length}: ${srcPath} -> ${dstPath}`);
      
      // Listen for upload progress
      let progressListenerActive = true;
      const removeProgressListener = (window as any).electronAPI.onUploadProgress((transferred: number, total: number, percent: number) => {
        if (progressListenerActive) {
          quickLaunchActionStatus.value = `Uploading ${i + 1}/${sfcFiles.length}: ${fileToUpload}... ${percent}%`;
        }
      });
      
      try {
        const result = await (window as any).electronAPI.usb2snesUploadRom(srcPath, dstPath);
        
        progressListenerActive = false;
        removeProgressListener();
        
        if (!result.success) {
          quickLaunchActionStatus.value = `✗ Upload ${i + 1}/${sfcFiles.length} failed: ${fileToUpload}`;
          return;
        }
        
        uploadedCount++;
        lastUploadedFile = fileToUpload;
        console.log(`[Upload] Successfully uploaded ${fileToUpload} (${uploadedCount}/${sfcFiles.length})`);
        
        // Sync SNES contents cache with uploaded file info
        try {
          const uploadedFileInfo = {
            fullpath: dstPath,
            filename: fileToUpload,
            gameid: null,
            version: null,
            metadata: {},
            part_of_a_run: false
          };
          
          // Try to extract game ID and version from filename (smw12345_1.sfc)
          const match = fileToUpload.match(/^smw(\d+)_(\d+)\.sfc$/i);
          if (match) {
            uploadedFileInfo.gameid = match[1];
            uploadedFileInfo.version = parseInt(match[2]);
            
            // Try to get game metadata from main list
            const gameItem = items.find(item => item.Id === match[1]);
            if (gameItem) {
              uploadedFileInfo.metadata = {
                gamename: gameItem.Name,
                gametype: gameItem.Type,
                difficulty: gameItem.PublicDifficulty,
                combinedtype: gameItem.Type
              };
            }
          }
          
          await (window as any).electronAPI.snesContentsSync(uploadedFileInfo);
          console.log(`[Upload] SNES contents cache synced for ${fileToUpload}`);
        } catch (syncError) {
          console.warn(`[Upload] Cache sync failed for ${fileToUpload}:`, syncError);
        }
        
      } catch (uploadError) {
        progressListenerActive = false;
        removeProgressListener();
        quickLaunchActionStatus.value = `✗ Upload error for ${fileToUpload}: ${uploadError}`;
        console.error(`[Upload] Error uploading ${fileToUpload}:`, uploadError);
        return;
      }
    }
    
    // All files uploaded successfully
    quickLaunchActionStatus.value = `✓ Uploaded ${uploadedCount} file${uploadedCount > 1 ? 's' : ''}`;
    
    // Boot the last uploaded file if requested
    if (andBoot && lastUploadedFile) {
      const bootPath = `/work/${lastUploadedFile}`;
      quickLaunchActionStatus.value = `Booting ${lastUploadedFile}...`;
      try {
        await (window as any).electronAPI.usb2snesBoot(bootPath);
        quickLaunchActionStatus.value = `✓ Uploaded ${uploadedCount} files and booted ${lastUploadedFile}`;
      } catch (bootError) {
        quickLaunchActionStatus.value = `✓ Uploaded ${uploadedCount} files (Boot failed: ${bootError})`;
      }
    }
    
  } catch (error) {
    quickLaunchActionStatus.value = `✗ Error: ${error}`;
  }
}

async function launchWithProgram() {
  quickLaunchActionStatus.value = 'Scanning for game files...';
  
  try {
    // Get list of .sfc files in the folder
    const folderContents = await (window as any).electronAPI.readDirectory(quickLaunchFolderPath.value);
    const sfcFiles = folderContents.filter((f: string) => f.endsWith('.sfc'));
    
    if (sfcFiles.length === 0) {
      quickLaunchActionStatus.value = '✗ No .sfc files found in folder';
      return;
    }
    
    // If multiple files, use the selected one or first one
    let fileToLaunch = sfcFiles[0];
    if (quickLaunchSelectedFile.value && sfcFiles.includes(quickLaunchSelectedFile.value)) {
      fileToLaunch = quickLaunchSelectedFile.value;
    }
    
    const filePath = `${quickLaunchFolderPath.value}/${fileToLaunch}`;
    
    quickLaunchActionStatus.value = `Launching ${fileToLaunch} with program...`;
    
    // Get launch program from settings
    const launchProgram = settings.launchProgram || '';
    const launchArgs = settings.launchProgramArgs || '';
    
    if (!launchProgram) {
      quickLaunchActionStatus.value = '✗ No launch program configured in settings';
      return;
    }
    
    // Use IPC to launch program with arguments
    await (window as any).electronAPI.launchProgram(launchProgram, launchArgs, filePath);
    
    quickLaunchActionStatus.value = `✓ Launched ${fileToLaunch}`;
  } catch (error) {
    quickLaunchActionStatus.value = `✗ Launch error: ${error}`;
  }
}

function launchGameProgram() {
  // TODO: Implement launching the configured game program with first SFC file
  alert('Launch game program - to be implemented');
  // This will be implemented in a later phase
}

// ===========================================================================
// SNES CONTENTS CACHE FUNCTIONS
// ===========================================================================

async function toggleSnesContentsDropdown() {
  snesContentsDropdownOpen.value = !snesContentsDropdownOpen.value;
  
  if (snesContentsDropdownOpen.value) {
    await refreshSnesContentsList();
  }
}

function closeSnesContentsDropdown() {
  snesContentsDropdownOpen.value = false;
}

async function refreshSnesContentsList() {
  try {
    snesContentsList.value = await (window as any).electronAPI.snesContentsGetList(snesContentsShowAll.value);
    console.log('[SnesContents] Loaded', snesContentsList.value.length, 'files');
  } catch (error) {
    console.error('[SnesContents] Failed to load list:', error);
    snesContentsList.value = [];
  }
}

async function launchSnesFile(file: any) {
  try {
    await (window as any).electronAPI.usb2snesBoot(file.fullpath);
    
    // Mark as launched
    await (window as any).electronAPI.snesContentsUpdateStatus(file.fullpath, { launched_yet: true });
    
    // Refresh list
    await refreshSnesContentsList();
    
    console.log('[SnesContents] Launched:', file.filename);
  } catch (error) {
    console.error('[SnesContents] Launch error:', error);
    alert(`Launch failed: ${error}`);
  }
}

async function pinSnesFile(file: any) {
  try {
    await (window as any).electronAPI.snesContentsUpdateStatus(file.fullpath, { pinned: !file.pinned });
    await refreshSnesContentsList();
    console.log('[SnesContents] Pinned status toggled:', file.filename);
  } catch (error) {
    console.error('[SnesContents] Pin error:', error);
  }
}

async function dismissSnesFile(file: any) {
  try {
    await (window as any).electronAPI.snesContentsUpdateStatus(file.fullpath, { dismissed: true });
    await refreshSnesContentsList();
    console.log('[SnesContents] Dismissed:', file.filename);
  } catch (error) {
    console.error('[SnesContents] Dismiss error:', error);
  }
}

function findGameInList(file: any) {
  if (!file.gameid) {
    return;
  }
  
  // Uncheck all games first
  checkedGameIds.value.clear();
  
  // Find and select the game
  const gameItem = items.find(item => item.Id === file.gameid);
  if (gameItem) {
    checkedGameIds.value.add(file.gameid);
    selectedItem.value = gameItem;
    
    // Close dropdown
    closeSnesContentsDropdown();
    
    console.log('[SnesContents] Found and selected game:', gameItem.Name);
  }
}

function uploadToUsb2Snes() {
  // TODO: Implement USB2SNES upload
  alert('USB2SNES upload - to be implemented');
  // This will be implemented in a later phase
}

function manuallyUploadedConfirm() {
  // TODO: Implement USB2SNES launch after manual upload
  alert('USB2SNES launch - to be implemented');
  // This will be implemented in a later phase
}

async function startRun() {
  if (!currentRunUuid.value) {
    alert('No run saved. Please save the run first.');
    return;
  }
  
  if (!isElectronAvailable()) {
    alert('Run execution requires Electron environment');
    return;
  }
  
  const confirmed = confirm(
    `Start run "${currentRunName.value}"?\n\n` +
    `${runEntries.length} plan entries\n` +
    `Global conditions: ${globalRunConditions.value.length > 0 ? globalRunConditions.value.join(', ') : 'None'}\n\n` +
    `Once started, the run cannot be edited.`
  );
  
  if (!confirmed) return;
  
  try {
    console.log('[startRun] Starting run:', currentRunUuid.value);
    const result = await (window as any).electronAPI.startRun({
      runUuid: currentRunUuid.value
    });
    
    console.log('[startRun] Start result:', result);
    
    if (result.success) {
      // Fetch the expanded run results from database
      console.log('[startRun] Fetching run results...');
      const expandedResults = await (window as any).electronAPI.getRunResults({
        runUuid: currentRunUuid.value
      });
      
      console.log('[startRun] Expanded results:', expandedResults);
      
      if (!expandedResults || expandedResults.length === 0) {
        alert('Failed to load run results - no challenges found');
        return;
      }
      
      // Replace runEntries with expanded results
      // Build new entries array first, then replace atomically
      const newEntries = expandedResults.map((res: any, idx: number) => {
        // Mask random games that haven't been revealed yet
        // After staging, all games have gameid/name set in database
        // Only reveal if: not random, OR it's a completed challenge, OR revealed_early
        // Current challenge will be revealed by the watcher after we set currentChallengeIndex
        const isPastChallenge = res.status === 'success' || res.status === 'skipped' || res.status === 'ok';
        const shouldReveal = !res.was_random || isPastChallenge || res.revealed_early;
        
        // Parse conditions safely - handle both string and array
        let parsedConditions: any[] = [];
        if (res.conditions) {
          if (typeof res.conditions === 'string') {
            try {
              parsedConditions = JSON.parse(res.conditions);
              if (!Array.isArray(parsedConditions)) {
                parsedConditions = [];
              }
            } catch (e) {
              console.warn('Failed to parse conditions:', res.conditions);
              parsedConditions = [];
            }
          } else if (Array.isArray(res.conditions)) {
            parsedConditions = res.conditions;
          }
        }
        
        return {
          key: res.result_uuid,
          id: shouldReveal ? (res.gameid || '(random)') : '(random)',
          entryType: res.was_random ? 'random_game' : 'game',
          name: shouldReveal ? (res.game_name || '???') : '???',
          stageNumber: res.exit_number,
          stageName: shouldReveal ? res.stage_description : null,
          count: 1,  // Each result is now a single challenge
          isLocked: true,  // All entries locked during active run
          conditions: parsedConditions,
          sfcpath: res.sfcpath || null  // USB2SNES path if uploaded
        };
      });
      
      // Replace array contents atomically
      runEntries.splice(0, runEntries.length, ...newEntries);
      
      console.log('[startRun] Setting run status to active, entries:', runEntries.length);
      currentRunStatus.value = 'active';
      currentChallengeIndex.value = 0;
      runStartTime.value = Date.now();
      runElapsedSeconds.value = 0;
      console.log('[startRun] Run status set. isRunActive should now be true');
      
      // Initialize challenge results tracking
      challengeResults.value = runEntries.map((_, idx) => ({
        index: idx,
        status: 'pending',
        durationSeconds: 0,
        revealedEarly: false
      }));
      undoStack.value = [];
      
      // Start timer for first challenge
      if (challengeResults.value.length > 0) {
        challengeResults.value[0].durationSeconds = 0;
      }
      
      // Start timer
      runTimerInterval.value = window.setInterval(() => {
        if (runStartTime.value) {
          runElapsedSeconds.value = Math.floor((Date.now() - runStartTime.value) / 1000);
          // Update current challenge duration
          if (currentChallengeIndex.value < challengeResults.value.length) {
            const current = challengeResults.value[currentChallengeIndex.value];
            if (current.status === 'pending') {
              // Calculate duration since this challenge started
              const prevDuration = challengeResults.value
                .slice(0, currentChallengeIndex.value)
                .reduce((sum, r) => sum + r.durationSeconds, 0);
              current.durationSeconds = runElapsedSeconds.value - prevDuration;
            }
          }
        }
      }, 1000);
      
      console.log(`[startRun] Run started with ${runEntries.length} challenges`);
      console.log('[startRun] First challenge:', runEntries[0]);
      
      // Reveal first challenge if it's random (watcher won't trigger for initial index=0)
      if (runEntries.length > 0) {
        const firstChallenge = runEntries[0];
        console.log('[startRun] Checking first challenge:', firstChallenge.entryType, firstChallenge.name);
        if ((firstChallenge.entryType === 'random_game' || firstChallenge.entryType === 'random_stage') && firstChallenge.name === '???') {
          console.log('[startRun] First challenge is unrevealed random, revealing now...');
          await revealCurrentChallenge(false);
        } else {
          console.log('[startRun] First challenge is not masked or not random');
        }
      }
    } else {
      alert('Failed to start run: ' + result.error);
    }
  } catch (error) {
    console.error('Error starting run:', error);
    alert('Error starting run');
  }
}

async function launchCurrentChallenge() {
  if (!currentChallenge.value || !currentChallengeSfcPath.value) return;
  
  try {
    const sfcpath = currentChallengeSfcPath.value;
    const fullPath = `/work/${sfcpath}`;
    
    console.log('[launchCurrentChallenge] Booting:', fullPath);
    
    await (window as any).electronAPI.usb2snesBoot(fullPath);
    
    console.log(`✓ Launched challenge ${currentChallengeIndex.value + 1}`);
  } catch (error) {
    console.error('Error launching challenge:', error);
    alert(`Error launching game: ${error}`);
  }
}

async function pauseRun() {
  if (!currentRunUuid.value || isRunPaused.value) return;
  
  try {
    if (isElectronAvailable()) {
      await (window as any).electronAPI.pauseRun(currentRunUuid.value);
    }
    
    isRunPaused.value = true;
    console.log('Run paused');
  } catch (error) {
    console.error('Error pausing run:', error);
    alert('Error pausing run');
  }
}

async function unpauseRun() {
  if (!currentRunUuid.value || !isRunPaused.value) return;
  
  try {
    if (isElectronAvailable()) {
      const result = await (window as any).electronAPI.unpauseRun(currentRunUuid.value);
      console.log('Unpause result:', result);
      
      if (result && result.success) {
        // Update pause time with the returned value
        runPauseSeconds.value = result.pauseSeconds || 0;
        isRunPaused.value = false;
        console.log('Run unpaused, total pause time:', runPauseSeconds.value);
      } else {
        console.error('Unpause failed:', result);
        alert('Failed to unpause run: ' + (result?.error || 'Unknown error'));
      }
    } else {
      // If not in Electron, just update state
      isRunPaused.value = false;
    }
  } catch (error) {
    console.error('Error unpausing run:', error);
    alert('Error unpausing run: ' + error);
  }
}

async function cancelRun() {
  const confirmed = confirm(
    `Cancel run "${currentRunName.value}"?\n\n` +
    `This will mark the run as cancelled. You can view it later but cannot continue it.`
  );
  
  if (!confirmed) return;
  
  try {
    if (isElectronAvailable()) {
      await (window as any).electronAPI.cancelRun({
        runUuid: currentRunUuid.value
      });
    }
    
    // Stop timer
    if (runTimerInterval.value) {
      clearInterval(runTimerInterval.value);
      runTimerInterval.value = null;
    }
    
    currentRunStatus.value = 'cancelled';
    console.log('Run cancelled');
    alert('Run cancelled');
    closeRunModal();
  } catch (error) {
    console.error('Error cancelling run:', error);
    alert('Error cancelling run');
  }
}

async function nextChallenge() {
  if (!currentChallenge.value) return;
  
  const idx = currentChallengeIndex.value;
  const result = challengeResults.value[idx];
  
  // Determine status: 'success' if not revealed early, 'ok' if revealed early
  const finalStatus = result.revealedEarly ? 'ok' : 'success';
  
  // Save current state to undo stack
  undoStack.value.push({
    index: idx,
    status: result.status,
    durationSeconds: result.durationSeconds,
    revealedEarly: result.revealedEarly
  });
  
  // Mark as success or ok
  result.status = finalStatus;
  
  try {
    if (isElectronAvailable()) {
      await (window as any).electronAPI.recordChallengeResult({
        runUuid: currentRunUuid.value,
        challengeIndex: idx,
        status: finalStatus
      });
    }
    
    console.log(`Challenge ${idx + 1} completed (${finalStatus})`);
    
    // Move to next challenge
    if (idx < runEntries.length - 1) {
      currentChallengeIndex.value++;
      // Start timing next challenge
      if (idx + 1 < challengeResults.value.length) {
        challengeResults.value[idx + 1].durationSeconds = 0;
      }
    } else {
      // Run completed
      completeRun();
    }
  } catch (error) {
    console.error('Error recording challenge result:', error);
    alert('Error recording result');
  }
}

async function skipChallenge() {
  if (!currentChallenge.value) return;
  
  const idx = currentChallengeIndex.value;
  const entry = runEntries[idx];
  
  // If this is a random challenge, reveal it first (so user sees what they're skipping)
  if ((entry.entryType === 'random_game' || entry.entryType === 'random_stage') && entry.name === '???') {
    await revealCurrentChallenge(false);  // Normal reveal (not early)
  }
  
  const confirmed = confirm(`Skip challenge ${idx + 1}: ${entry.name}?`);
  if (!confirmed) return;
  
  const result = challengeResults.value[idx];
  
  // Save current state to undo stack
  undoStack.value.push({
    index: idx,
    status: result.status,
    durationSeconds: result.durationSeconds,
    revealedEarly: result.revealedEarly
  });
  
  // Mark as skipped
  result.status = 'skipped';
  
  try {
    if (isElectronAvailable()) {
      await (window as any).electronAPI.recordChallengeResult({
        runUuid: currentRunUuid.value,
        challengeIndex: idx,
        status: 'skipped'
      });
    }
    
    console.log(`Challenge ${idx + 1} skipped`);
    
    // Move to next challenge
    if (idx < runEntries.length - 1) {
      currentChallengeIndex.value++;
      // Start timing next challenge
      if (idx + 1 < challengeResults.value.length) {
        challengeResults.value[idx + 1].durationSeconds = 0;
      }
    } else {
      // Run completed
      completeRun();
    }
  } catch (error) {
    console.error('Error recording skip:', error);
    alert('Error recording skip');
  }
}

async function undoChallenge() {
  if (undoStack.value.length === 0) return;
  
  const previousState = undoStack.value.pop()!;
  const idx = previousState.index;
  
  // Before going back, mark any challenges AFTER this point as revealed_early
  // because the user has already seen them
  for (let i = idx + 1; i < challengeResults.value.length; i++) {
    const result = challengeResults.value[i];
    const entry = runEntries[i];
    
    // If it's a random challenge that's been revealed, mark it as revealed early
    if ((entry.entryType === 'random_game' || entry.entryType === 'random_stage') && 
        entry.name !== '???' && 
        result.status !== 'pending') {
      result.revealedEarly = true;
      challengeResults.value[i] = { ...result, revealedEarly: true };
      
      // Update in database
      try {
        if (isElectronAvailable()) {
          await (window as any).electronAPI.markChallengeRevealedEarly({
            runUuid: currentRunUuid.value,
            challengeIndex: i,
            revealedEarly: true
          });
        }
      } catch (error) {
        console.error('Error marking challenge as revealed early:', error);
      }
    }
  }
  
  // Restore previous state
  challengeResults.value[idx] = { ...previousState };
  
  // Go back to that challenge
  currentChallengeIndex.value = idx;
  
  try {
    if (isElectronAvailable()) {
      // Undo the database record
      await (window as any).electronAPI.recordChallengeResult({
        runUuid: currentRunUuid.value,
        challengeIndex: idx,
        status: 'pending'  // Reset to pending
      });
    }
    
    console.log(`Undone: Challenge ${idx + 1} back to pending`);
  } catch (error) {
    console.error('Error undoing challenge:', error);
    alert('Error undoing challenge');
  }
}

async function revealCurrentChallenge(revealedEarly: boolean = false) {
  if (!isElectronAvailable()) return;
  if (!currentChallenge.value) return;
  
  const challenge = currentChallenge.value;
  const idx = currentChallengeIndex.value;
  
  console.log('[revealCurrentChallenge] Challenge:', idx, 'id:', challenge.id, 'name:', challenge.name, 'type:', challenge.entryType);
  
  // Only reveal if it's a random challenge that hasn't been revealed
  if (challenge.id !== '(random)' || challenge.name !== '???') {
    console.log('[revealCurrentChallenge] Already revealed or not random, skipping');
    return;  // Already revealed or not random
  }
  
  try {
    console.log('[revealCurrentChallenge] Calling revealChallenge API...');
    const result = await (window as any).electronAPI.revealChallenge({
      runUuid: currentRunUuid.value,
      resultUuid: challenge.key,  // result_uuid
      revealedEarly
    });
    
    console.log('[revealCurrentChallenge] Result:', result);
    
    if (result.success) {
      // Update UI with revealed game
      // Do this even if alreadyRevealed=true (game was selected during staging)
      // because the UI starts with it masked as '???'
      console.log('[revealCurrentChallenge] Full result object:', JSON.stringify(result, null, 2));
      console.log('[revealCurrentChallenge] result.gameid:', result.gameid, 'type:', typeof result.gameid);
      console.log('[revealCurrentChallenge] result.gameName:', result.gameName, 'type:', typeof result.gameName);
      
      if (result.gameid && result.gameName) {
        console.log('[revealCurrentChallenge] Before update - entry.id:', challenge.id, 'entry.name:', challenge.name);
        
        // Create completely new object without spreading old challenge
        const updatedEntry = {
          key: challenge.key,
          id: result.gameid,
          entryType: challenge.entryType,
          name: result.gameName,
          stageNumber: challenge.stageNumber,
          stageName: result.gameType || challenge.stageName,
          count: challenge.count,
          isLocked: challenge.isLocked,
          conditions: challenge.conditions,
          sfcpath: (challenge as any).sfcpath || null,  // Preserve USB2SNES path
          filterDifficulty: challenge.filterDifficulty,
          filterType: challenge.filterType,
          filterPattern: challenge.filterPattern,
          seed: challenge.seed
        };
        
        console.log('[revealCurrentChallenge] New entry object - id:', updatedEntry.id, 'name:', updatedEntry.name);
        
        // Replace in array using splice to trigger reactivity
        runEntries.splice(idx, 1, updatedEntry);
        
        console.log('[revealCurrentChallenge] After splice - entry at idx', idx, 'id:', runEntries[idx].id, 'name:', runEntries[idx].name);
      } else {
        console.error('[revealCurrentChallenge] Missing gameid or gameName in result!');
        console.error('[revealCurrentChallenge] result.gameid:', result.gameid);
        console.error('[revealCurrentChallenge] result.gameName:', result.gameName);
        console.error('[revealCurrentChallenge] Full result:', result);
      }
      
      // Mark as revealed early if skipped/peeked
      if (revealedEarly) {
        challengeResults.value[idx].revealedEarly = true;
      }
    } else {
      console.warn('[revealCurrentChallenge] Reveal failed:', result.error);
    }
  } catch (error) {
    console.error('[revealCurrentChallenge] Error revealing challenge:', error);
    // Continue anyway - show error but don't block gameplay
  }
}

function completeRun() {
  // Stop timer
  if (runTimerInterval.value) {
    clearInterval(runTimerInterval.value);
    runTimerInterval.value = null;
  }
  
  currentRunStatus.value = 'completed';
  
  alert(
    `Run "${currentRunName.value}" completed!\n\n` +
    `Total time: ${formatTime(runElapsedSeconds.value)}\n` +
    `Challenges: ${runEntries.length}`
  );
  
  closeRunModal();
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  
  if (h > 0) {
    return `${h}h ${m}m ${s}s`;
  } else if (m > 0) {
    return `${m}m ${s}s`;
  } else {
    return `${s}s`;
  }
}

function getChallengeStatusIcon(index: number): string {
  if (index >= challengeResults.value.length) return '';
  const result = challengeResults.value[index];
  
  switch (result.status) {
    case 'success':
      return '✓';  // Green checkmark - Perfect completion
    case 'ok':
      return '⚠';  // Warning triangle - Completed but revealed early
    case 'skipped':
      return '✗';  // Red X - Skipped
    case 'pending':
    default:
      return '';
  }
}

function getChallengeStatusClass(index: number): string {
  if (index >= challengeResults.value.length) return '';
  const result = challengeResults.value[index];
  
  switch (result.status) {
    case 'success':
      return 'status-success';
    case 'ok':
      return 'status-ok';
    case 'skipped':
      return 'status-skipped';
    case 'pending':
    default:
      return '';
  }
}

function getChallengeDuration(index: number): string {
  if (index >= challengeResults.value.length) return '';
  const result = challengeResults.value[index];
  
  // Only show duration for current and completed challenges
  if (index > currentChallengeIndex.value) return '';
  if (result.durationSeconds === 0 && result.status === 'pending') return '';
  
  return formatTime(result.durationSeconds);
}

// Helper: Check if entry is random type
function isRandomEntry(entry: RunEntry): boolean {
  return entry.entryType === 'random_game' || entry.entryType === 'random_stage';
}

// Challenge conditions management
const allConditions: ChallengeCondition[] = [
  'Hitless',
  'Deathless', 
  'No Coins',
  'No Powerups',
  'No Midway'
];

function editConditions(entry: RunEntry) {
  const current = entry.conditions || [];
  const message = 'Select challenge conditions for this entry:\n\n' +
    allConditions.map((c, i) => `${i + 1}. ${c} ${current.includes(c) ? '✓' : ''}`).join('\n') +
    '\n\nEnter numbers to toggle (e.g., "1,3,5" or "all" or "none"):';
  
  const input = window.prompt(message, current.length === 0 ? '' : 'current');
  if (input === null) return;
  
  const inputLower = input.toLowerCase().trim();
  
  if (inputLower === 'none' || inputLower === '') {
    entry.conditions = [];
    return;
  }
  
  if (inputLower === 'all') {
    entry.conditions = [...allConditions];
    return;
  }
  
  // Parse numbers
  const numbers = inputLower.split(',').map(n => parseInt(n.trim())).filter(n => !isNaN(n) && n >= 1 && n <= allConditions.length);
  if (numbers.length > 0) {
    const newConditions = numbers.map(n => allConditions[n - 1]);
    entry.conditions = [...new Set(newConditions)];  // Remove duplicates
  }
}

function editGlobalConditions() {
  const current = globalRunConditions.value || [];
  const message = 'Select global challenge conditions for entire run:\n\n' +
    allConditions.map((c, i) => `${i + 1}. ${c} ${current.includes(c) ? '✓' : ''}`).join('\n') +
    '\n\nEnter numbers to toggle (e.g., "1,3,5" or "all" or "none"):';
  
  const input = window.prompt(message, current.length === 0 ? '' : 'current');
  if (input === null) return;
  
  const inputLower = input.toLowerCase().trim();
  
  if (inputLower === 'none' || inputLower === '') {
    globalRunConditions.value = [];
    return;
  }
  
  if (inputLower === 'all') {
    globalRunConditions.value = [...allConditions];
    return;
  }
  
  // Parse numbers
  const numbers = inputLower.split(',').map(n => parseInt(n.trim())).filter(n => !isNaN(n) && n >= 1 && n <= allConditions.length);
  if (numbers.length > 0) {
    const newConditions = numbers.map(n => allConditions[n - 1]);
    globalRunConditions.value = [...new Set(newConditions)];  // Remove duplicates
  }
}

// ===========================================================================
// DATABASE INTEGRATION
// ===========================================================================

/**
 * Check if running in Electron or standalone browser
 */
const isElectronAvailable = () => {
  return typeof (window as any).electronAPI !== 'undefined';
};

/**
 * Get mock data for development mode (Vite only, no Electron)
 */
function getMockGames(): Item[] {
  return [
    { 
      Id: '11374', 
      Name: 'Super Dram World', 
      Type: 'Kaizo: Intermediate', 
      Author: 'Panga', 
      Length: '18 exits', 
      PublicDifficulty: 'Advanced',
      Status: 'Default', 
      MyDifficultyRating: 4, 
      MyReviewRating: 5,
      MySkillRating: 5,
      Publicrating: 4.3, 
      Hidden: false, 
      ExcludeFromRandom: false,
      Mynotes: '',
      AvailableVersions: [1, 2, 3],
      CurrentVersion: 3,
      JsonData: { gameid: '11374', name: 'Super Dram World', version: 3 }
    },
    { 
      Id: '17289', 
      Name: 'Storks, Apes, and Crocodiles', 
      Type: 'Standard', 
      LegacyType: 'Standard: Hard',
      Author: 'Morsel', 
      Length: 'unknown', 
      PublicDifficulty: 'Moderate',
      Status: 'In Progress', 
      MyDifficultyRating: 5, 
      MyReviewRating: 4,
      MySkillRating: 3,
      Publicrating: 4.6, 
      Hidden: false, 
      ExcludeFromRandom: false,
      Mynotes: 'Practice level 0x0F',
      AvailableVersions: [1, 2],
      CurrentVersion: 2,
      JsonData: { gameid: '17289', name: 'Storks, Apes, and Crocodiles', version: 2 }
    },
    { 
      Id: '20091', 
      Name: 'Example Hack', 
      Type: 'Traditional', 
      Author: 'Someone', 
      Length: '5 exits', 
      PublicDifficulty: 'Easy',
      Status: 'Finished', 
      MyDifficultyRating: 2, 
      MyReviewRating: 2,
      MySkillRating: 1,
      Publicrating: 3.8, 
      Hidden: false, 
      ExcludeFromRandom: true,
      Mynotes: '',
      AvailableVersions: [1],
      CurrentVersion: 1,
      JsonData: { gameid: '20091', name: 'Example Hack', version: 1 }
    },
  ];
}

/**
 * Load all games from database
 */
async function loadGames() {
  isLoading.value = true;
  loadError.value = null;
  
  try {
    if (!isElectronAvailable()) {
      // Development mode without Electron - use mock data
      console.warn('Electron not available, using mock data');
      const mockGames = getMockGames();
      items.splice(0, items.length, ...mockGames);
      isLoading.value = false;
      return;
    }
    
    const games = await (window as any).electronAPI.getGames();
    
    // Get available versions for each game
    for (const game of games) {
      try {
        const versions = await (window as any).electronAPI.getVersions(game.Id);
        game.AvailableVersions = versions;
      } catch (error) {
        console.error(`Error getting versions for ${game.Id}:`, error);
        game.AvailableVersions = [game.CurrentVersion];
      }
    }
    
    items.splice(0, items.length, ...games);
    console.log(`Loaded ${games.length} games from database`);
  } catch (error: any) {
    console.error('Failed to load games:', error);
    loadError.value = error.message || 'Failed to load games';
  } finally {
    isLoading.value = false;
  }
}

/**
 * Load stages for currently selected game
 */
async function loadStages(gameid: string) {
  if (!isElectronAvailable()) {
    // Mock stages data
    const mockStages: Record<string, Stage[]> = {
      '11374': [
        { key: '11374-1', parentId: '11374', exitNumber: '1', description: 'Intro stage', publicRating: 4.2, myNotes: '', myDifficultyRating: 3, myReviewRating: 4 },
        { key: '11374-2', parentId: '11374', exitNumber: '2', description: 'Shell level', publicRating: 4.5, myNotes: 'practice', myDifficultyRating: 5, myReviewRating: 5 },
      ],
      '17289': [
        { key: '17289-0x0F', parentId: '17289', exitNumber: '0x0F', description: 'Custom level jump', publicRating: 4.6, myNotes: 'good practice', myDifficultyRating: 5, myReviewRating: 4 },
      ],
    };
    stagesByItemId[gameid] = mockStages[gameid] || [];
    return mockStages[gameid] || [];
  }
  
  try {
    const stages = await (window as any).electronAPI.getStages(gameid);
    stagesByItemId[gameid] = stages;
    return stages;
  } catch (error) {
    console.error(`Error loading stages for ${gameid}:`, error);
    return [];
  }
}

/**
 * Load settings from database
 */
async function loadSettings() {
  if (!isElectronAvailable()) {
    console.warn('Electron not available, using default settings');
    // Apply defaults even in mock mode
    applyTheme(DEFAULT_THEME);
    applyTextSize(DEFAULT_TEXT_SIZE);
    return;
  }
  
  try {
    const savedSettings = await (window as any).electronAPI.getSettings();
    
    // Apply saved settings to reactive state
    if (savedSettings.theme) {
      settings.theme = savedSettings.theme as ThemeName;
      applyTheme(settings.theme);
    } else {
      applyTheme(DEFAULT_THEME);
    }
    
    if (savedSettings.textSize) {
      settings.textSize = savedSettings.textSize as TextSize;
      textSizeSliderValue.value = textSizeOptions.indexOf(settings.textSize);
      applyTextSize(settings.textSize);
    } else {
      applyTextSize(DEFAULT_TEXT_SIZE);
    }
    
    if (savedSettings.vanillaRomPath) settings.vanillaRomPath = savedSettings.vanillaRomPath;
    if (savedSettings.vanillaRomValid) settings.vanillaRomValid = savedSettings.vanillaRomValid === 'true';
    if (savedSettings.flipsPath) settings.flipsPath = savedSettings.flipsPath;
    if (savedSettings.flipsValid) settings.flipsValid = savedSettings.flipsValid === 'true';
    if (savedSettings.asarPath) settings.asarPath = savedSettings.asarPath;
    if (savedSettings.asarValid) settings.asarValid = savedSettings.asarValid === 'true';
    if (savedSettings.uberAsmPath) settings.uberAsmPath = savedSettings.uberAsmPath;
    if (savedSettings.uberAsmValid) settings.uberAsmValid = savedSettings.uberAsmValid === 'true';
    if (savedSettings.launchMethod) settings.launchMethod = savedSettings.launchMethod as any;
    if (savedSettings.launchProgram) settings.launchProgram = savedSettings.launchProgram;
    if (savedSettings.launchProgramArgs) settings.launchProgramArgs = savedSettings.launchProgramArgs;
    if (savedSettings.usb2snesAddress) settings.usb2snesAddress = savedSettings.usb2snesAddress;
    if (savedSettings.usb2snesEnabled) settings.usb2snesEnabled = savedSettings.usb2snesEnabled as any;
    if (savedSettings.usb2snesLaunchPref) settings.usb2snesLaunchPref = savedSettings.usb2snesLaunchPref as any;
    if (savedSettings.usb2snesUploadPref) settings.usb2snesUploadPref = savedSettings.usb2snesUploadPref as any;
    if (savedSettings.usb2snesUploadDir) settings.usb2snesUploadDir = savedSettings.usb2snesUploadDir;
    if (savedSettings.tempDirOverride !== undefined) settings.tempDirOverride = savedSettings.tempDirOverride;
    if (savedSettings.tempDirValid) settings.tempDirValid = savedSettings.tempDirValid === 'true';
    
    console.log('Settings loaded from database');
  } catch (error) {
    console.error('Error loading settings:', error);
  }
}

/**
 * Save annotation to database (debounced)
 */
const debouncedSaveAnnotation = debounce(async (item: Item) => {
  if (!isElectronAvailable()) {
    console.log('Mock mode: Would save annotation for', item.Id);
    return;
  }
  
  try {
    const annotation = {
      gameid: item.Id,
      status: item.Status,
      myDifficultyRating: item.MyDifficultyRating,
      myReviewRating: item.MyReviewRating,
      mySkillRating: item.MySkillRating,
      hidden: item.Hidden,
      excludeFromRandom: item.ExcludeFromRandom,
      mynotes: item.Mynotes
    };
    
    const result = await (window as any).electronAPI.saveAnnotation(annotation);
    if (!result.success) {
      console.error('Failed to save annotation:', result.error);
    }
  } catch (error) {
    console.error('Error saving annotation:', error);
  }
}, 500);

/**
 * Load specific game version
 */
async function loadGameVersion(gameid: string, version: number) {
  if (!isElectronAvailable()) {
    console.log(`Mock mode: Would load game ${gameid} version ${version}`);
    return;
  }
  
  try {
    const game = await (window as any).electronAPI.getGame(gameid, version);
    if (game) {
      // Update the item in the list
      const index = items.findIndex(it => it.Id === gameid);
      if (index >= 0) {
        // Preserve AvailableVersions
        game.AvailableVersions = items[index].AvailableVersions;
        Object.assign(items[index], game);
      }
    }
  } catch (error) {
    console.error(`Error loading game ${gameid} version ${version}:`, error);
  }
}

/**
 * Initialize on mount
 */
onMounted(async () => {
  console.log('=== APP MOUNTED ===');
  console.log('Electron API available:', isElectronAvailable());
  
  // Add global event listeners for filter shortcuts
  window.addEventListener('keydown', handleGlobalKeydown);
  window.addEventListener('click', handleGlobalClick);
  
  // Listen for USB2SNES operation success events to update health tracking
  if (isElectronAvailable()) {
    const ipcRenderer = (window as any).electronAPI.ipcRenderer;
    if (ipcRenderer) {
      ipcRenderer.on('usb2snes:operation-success', () => {
        // Update health tracking - device is responding
        trackResponse();
      });
    }
  }
  
  // Check for active run first
  if (isElectronAvailable()) {
    try {
      const activeRun = await (window as any).electronAPI.getActiveRun();
      if (activeRun) {
        resumeRunData.value = activeRun;
        resumeRunModalOpen.value = true;
        console.log('Active run found:', activeRun.run_name);
      }
    } catch (error) {
      console.error('Error checking for active run:', error);
    }
  }
  
  console.log('Starting data load...');
  
  try {
    await loadGames();
    console.log('Games loaded, count:', items.length);
  } catch (error) {
    console.error('Error loading games:', error);
  }
  
  try {
    await loadSettings();
    console.log('Settings loaded');
  } catch (error) {
    console.error('Error loading settings:', error);
  }
  
  // Refresh USB2SNES status on app load
  if (isElectronAvailable() && settings.usb2snesEnabled === 'yes') {
    try {
      await refreshUsb2snesStatus();
      console.log('USB2SNES status refreshed on startup');
    } catch (error) {
      console.error('Error refreshing USB2SNES status:', error);
    }
  }
  
  console.log('=== INITIALIZATION COMPLETE ===');
});

/**
 * Cleanup on unmount
 */
onUnmounted(() => {
  window.removeEventListener('keydown', handleGlobalKeydown);
  window.removeEventListener('click', handleGlobalClick);
});

/**
 * Watch for item changes and auto-save
 */
watch(items, () => {
  // Auto-save when items change
  for (const item of items) {
    debouncedSaveAnnotation(item);
  }
}, { deep: true });

/**
 * Watch for version changes
 */
watch(selectedVersion, async (newVersion) => {
  if (selectedItem.value && newVersion) {
    await loadGameVersion(selectedItem.value.Id, newVersion);
  }
});

/**
 * Watch for selected item changes to load stages
 */
watch(selectedItem, async (newItem, oldItem) => {
  if (newItem && newItem.Id !== oldItem?.Id) {
    // Load stages for this game if not already loaded
    if (!stagesByItemId[newItem.Id]) {
      await loadStages(newItem.Id);
    }
    
    // Set selected version to current version
    selectedVersion.value = newItem.CurrentVersion || 1;
  }
});

// Version management computed properties
const availableVersions = computed(() => {
  return selectedItem.value?.AvailableVersions || [1];
});
const latestVersion = computed(() => {
  const versions = availableVersions.value;
  return versions.length > 0 ? Math.max(...versions) : 1;
});
const isVersionSpecific = computed(() => {
  // Check if current selection has version-specific annotations
  // For now, just check if not latest version
  return selectedVersion.value !== latestVersion.value;
});

// Rating display helpers
function formatRatings(difficulty?: number | null, review?: number | null): string {
  const d = difficulty ? `D:${difficulty}` : 'D:—';
  const r = review ? `R:${review}` : 'R:—';
  return `${d} ${r}`;
}

function difficultyLabel(rating?: number | null): string {
  if (rating === null || rating === undefined) return '';
  const labels = ['Super Easy', 'Very Easy', 'Easy', 'Normal', 'Hard', 'Very Hard'];
  return labels[rating] || '';
}

function reviewLabel(rating?: number | null): string {
  if (rating === null || rating === undefined) return '';
  const labels = ['Terrible', 'Not Recommended', 'Below Average', 'Average', 'Good', 'Excellent'];
  return labels[rating] || '';
}

function skillLabel(rating?: number | null): string {
  if (rating === null || rating === undefined) return '';
  const labels = [
    'Observer',      // 0
    'Casual',        // 1
    'Apprentice',    // 2
    'Advanced',      // 3
    'Expert',        // 4
    'Master',        // 5
    'Legend',        // 6
    'Champion',      // 7
    'Deity',         // 8
    'Speedrunner',   // 9
    'Pro Speedrunner' // 10
  ];
  return labels[rating] || '';
}

function skillRatingHoverText(rating: number): string {
  const texts = [
    'I saw someone play Mario once - "Will you play my level?"',  // 0
    'Casual',                     // 1
    'Apprentice',                 // 2
    'Advanced',                   // 3
    'Expert',                     // 4
    'Master',                     // 5
    'I am one of the greats: Glitchcat7, jaku, shovda, juzcook, MrMightymouse, Panga, Stew_, Calco, Noblet, MitchFlowerPower, GPB, Aurateur, Pmiller, Barb, ThaBeast, DaWildGrim, or have world record, etc', // 6
    'I beat Hackers Dragon or JUMP, Responsible World 1.0, Casio, and Fruit Dealer RTA', // 7
    'I would run several of these again, back-to-back',  // 8
    'I thought of speedrunning more than a few hacks like these', // 9
    'I speedran many of them'       // 10
  ];
  return texts[rating] || '';
}

// JSON Details Modal
const jsonModalOpen = ref(false);
const jsonDetailsContent = computed(() => {
  if (!selectedItem.value) return '';
  return JSON.stringify(selectedItem.value.JsonData || selectedItem.value, null, 2);
});

function viewJsonDetails() {
  jsonModalOpen.value = true;
}

function closeJsonModal() {
  jsonModalOpen.value = false;
}

// Version-specific rating
function setVersionSpecificRating() {
  if (isVersionSpecific.value) {
    alert('This version already has version-specific ratings.');
    return;
  }
  
  const confirmed = confirm(
    `Set ratings specifically for version ${selectedVersion.value}?\n\n` +
    'This will create a separate rating for this version only, ' +
    'overriding the game-wide rating when viewing this version.'
  );
  
  if (confirmed) {
    // In real implementation, this would create a version-specific annotation
    alert(`Version-specific rating enabled for version ${selectedVersion.value}`);
  }
}

// Export/Import Run
async function exportRunToFile() {
  if (!currentRunUuid.value) {
    alert('No run to export. Please save the run first.');
    return;
  }
  
  if (!isElectronAvailable()) {
    alert('Export requires Electron environment');
    return;
  }
  
  try {
    const result = await (window as any).electronAPI.exportRun(currentRunUuid.value);
    
    if (result.success) {
      const exportJson = JSON.stringify(result.data, null, 2);
      const blob = new Blob([exportJson], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `run-${currentRunName.value.replace(/[^a-z0-9]/gi, '_')}-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      
      console.log('Run exported successfully');
    } else {
      alert('Failed to export run: ' + result.error);
    }
  } catch (error) {
    console.error('Error exporting run:', error);
    alert('Error exporting run');
  }
}

async function importRunFromFile() {
  if (!isElectronAvailable()) {
    alert('Import requires Electron environment');
    return;
  }
  
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  
  input.onchange = async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    
    try {
      const text = await file.text();
      const importData = JSON.parse(text);
      
      const result = await (window as any).electronAPI.importRun(importData);
      
      if (result.success) {
        let message = `Run imported successfully!`;
        if (result.warnings && result.warnings.length > 0) {
          message += `\n\nWarnings:\n${result.warnings.join('\n')}`;
        }
        alert(message);
        
        // Close modal and reload (could load the imported run)
        closeRunModal();
      } else {
        alert('Failed to import run: ' + result.error);
      }
    } catch (error) {
      console.error('Error importing run:', error);
      alert('Error importing run: Invalid file or format');
    }
  };
  
  input.click();
}

// Resume run from startup
async function resumeRunFromStartup() {
  if (!resumeRunData.value) {
    console.error('No resume run data available');
    return;
  }
  
  console.log('Resuming run:', resumeRunData.value);
  
  try {
    // Close resume modal first
    resumeRunModalOpen.value = false;
    
    // Load the run
    currentRunUuid.value = resumeRunData.value.run_uuid;
    currentRunName.value = resumeRunData.value.run_name;
    currentRunStatus.value = 'active';
    runPauseSeconds.value = resumeRunData.value.pause_seconds || 0;
    isRunPaused.value = resumeRunData.value.isPaused;
    
    console.log('Loading run results for:', currentRunUuid.value);
    
    // Check if electronAPI exists
    if (!isElectronAvailable()) {
      throw new Error('Electron API not available');
    }
    
    // Fetch expanded results
    const expandedResults = await (window as any).electronAPI.getRunResults({
      runUuid: currentRunUuid.value
    });
    
    console.log('Fetched run results:', expandedResults);
    
    if (!expandedResults || expandedResults.length === 0) {
      // The run is marked as active but has no results - this is a corrupted run
      // Offer to cancel it
      if (confirm('This run appears to be corrupted (no results found). Would you like to cancel it and start fresh?')) {
        try {
          await (window as any).electronAPI.cancelRun({ runUuid: currentRunUuid.value });
          alert('Run cancelled. You can now create a new run.');
          resumeRunModalOpen.value = false;
          return;
        } catch (cancelError) {
          console.error('Error cancelling corrupted run:', cancelError);
          throw new Error('Could not cancel corrupted run. Please contact support.');
        }
      } else {
        resumeRunModalOpen.value = false;
        return;
      }
    }
    
    // Load run entries
    // Build new entries array first, then replace atomically
    const newEntries = expandedResults.map((res: any, idx: number) => {
      // Mask random games that haven't been revealed yet
      // After staging, all games have gameid/name set in database
      // Only reveal if: not random, OR it's a completed challenge, OR revealed_early
      // Current challenge will be revealed by the watcher
      const isPastChallenge = res.status === 'success' || res.status === 'skipped' || res.status === 'ok';
      const shouldReveal = !res.was_random || isPastChallenge || res.revealed_early;
      
      // Parse conditions safely - handle both string and array
      let parsedConditions: any[] = [];
      if (res.conditions) {
        if (typeof res.conditions === 'string') {
          try {
            parsedConditions = JSON.parse(res.conditions);
            if (!Array.isArray(parsedConditions)) {
              parsedConditions = [];
            }
          } catch (e) {
            console.warn('Failed to parse conditions:', res.conditions);
            parsedConditions = [];
          }
        } else if (Array.isArray(res.conditions)) {
          parsedConditions = res.conditions;
        }
      }
      
      return {
        key: res.result_uuid,
        id: shouldReveal ? (res.gameid || '(random)') : '(random)',
        entryType: res.was_random ? 'random_game' : 'game',
        name: shouldReveal ? (res.game_name || '???') : '???',
        stageNumber: res.exit_number,
        stageName: shouldReveal ? res.stage_description : null,
        count: 1,
        isLocked: true,
        conditions: parsedConditions,
        sfcpath: res.sfcpath || null  // USB2SNES path if uploaded
      };
    });
    
    // Replace array contents atomically
    runEntries.splice(0, runEntries.length, ...newEntries);
    
    console.log('Loaded run entries:', runEntries.length);
    
    // Find current challenge index (first pending)
    currentChallengeIndex.value = expandedResults.findIndex((r: any) => r.status === 'pending');
    if (currentChallengeIndex.value === -1) {
      currentChallengeIndex.value = expandedResults.length - 1;  // All complete, show last
    }
    
    console.log('Current challenge index:', currentChallengeIndex.value);
    
    // Initialize challenge results
    challengeResults.value = expandedResults.map((res: any, idx: number) => ({
      index: idx,
      status: res.status || 'pending',
      durationSeconds: res.duration_seconds || 0,
      revealedEarly: res.revealed_early || false
    }));
    
    // Populate undo stack with completed challenges (for Back button)
    undoStack.value = challengeResults.value
      .filter(r => r.status === 'success' || r.status === 'skipped' || r.status === 'ok')
      .map(r => ({
        index: r.index,
        status: r.status,
        durationSeconds: r.durationSeconds,
        revealedEarly: r.revealedEarly
      }));
    
    console.log('Initialized undo stack with', undoStack.value.length, 'completed challenges');
    
    // Use the original started_at timestamp from database
    const startedAtString = resumeRunData.value.started_at;
    console.log('DEBUG: started_at from DB:', startedAtString);
    console.log('DEBUG: type:', typeof startedAtString);
    
    // Parse the timestamp (SQLite returns UTC strings, need to handle properly)
    const originalStartTime = new Date(startedAtString + 'Z').getTime(); // Add 'Z' to treat as UTC
    const now = Date.now();
    
    console.log('DEBUG: originalStartTime (ms):', originalStartTime);
    console.log('DEBUG: now (ms):', now);
    console.log('DEBUG: difference (ms):', now - originalStartTime);
    
    runStartTime.value = originalStartTime;
    
    // Calculate current elapsed time (don't use pre-calculated value from backend)
    const totalElapsed = Math.floor((now - originalStartTime) / 1000);
    runElapsedSeconds.value = totalElapsed - runPauseSeconds.value;
    
    console.log('Resuming run. Started at:', startedAtString, 
                'Total elapsed:', totalElapsed, 'Pause seconds:', runPauseSeconds.value, 
                'Net active:', runElapsedSeconds.value, 'Is paused:', isRunPaused.value);
    
    // Start timer (will not update if paused)
    console.log('Starting timer');
    runTimerInterval.value = window.setInterval(() => {
      if (runStartTime.value && !isRunPaused.value) {
        // Calculate from original start time
        const now = Date.now();
        const totalElapsed = Math.floor((now - runStartTime.value) / 1000);
        runElapsedSeconds.value = totalElapsed - runPauseSeconds.value;
        
        // Update current challenge duration
        if (currentChallengeIndex.value < challengeResults.value.length) {
          const current = challengeResults.value[currentChallengeIndex.value];
          if (current.status === 'pending') {
            const prevDuration = challengeResults.value
              .slice(0, currentChallengeIndex.value)
              .reduce((sum, r) => sum + r.durationSeconds, 0);
            current.durationSeconds = runElapsedSeconds.value - prevDuration;
          }
        }
      }
    }, 1000);
    
    // Reveal current challenge if it's random and masked
    if (currentChallengeIndex.value >= 0 && currentChallengeIndex.value < runEntries.length) {
      const currentEntry = runEntries[currentChallengeIndex.value];
      console.log('[resumeRun] Current challenge:', currentChallengeIndex.value, currentEntry);
      if ((currentEntry.entryType === 'random_game' || currentEntry.entryType === 'random_stage') && currentEntry.name === '???') {
        console.log('[resumeRun] Current challenge is unrevealed random, revealing now...');
        await revealCurrentChallenge(false);
      }
    }
    
    // Open run modal
    runModalOpen.value = true;
    
    console.log('Run modal opened, resume complete');
  } catch (error) {
    console.error('Error resuming run:', error);
    alert(`Error resuming run: ${error.message}`);
    resumeRunModalOpen.value = false;
  }
}

async function pauseRunFromStartup() {
  if (!resumeRunData.value) return;
  
  resumeRunModalOpen.value = false;
  
  // Load run in paused state
  await resumeRunFromStartup();
  
  // Pause it
  if (currentRunUuid.value) {
    await pauseRun();
  }
}

async function cancelRunFromStartup() {
  if (!resumeRunData.value) return;
  
  const confirmed = confirm(`Cancel run "${resumeRunData.value.run_name}"?`);
  if (!confirmed) {
    resumeRunModalOpen.value = false;
    return;
  }
  
  try {
    if (isElectronAvailable()) {
      await (window as any).electronAPI.cancelRun({
        runUuid: resumeRunData.value.run_uuid
      });
    }
    
    resumeRunModalOpen.value = false;
    console.log('Run cancelled from startup');
  } catch (error) {
    console.error('Error cancelling run:', error);
    alert('Error cancelling run');
  }
}
</script>

<style>
/* Root variables - these will be overridden by theme */
:root {
  /* Default theme colors (Light) */
  --bg-primary: #ffffff;
  --bg-secondary: #fafafa;
  --bg-tertiary: #f3f4f6;
  --bg-hover: #f9fafb;
  --text-primary: #111827;
  --text-secondary: #374151;
  --text-tertiary: #6b7280;
  --border-primary: #e5e7eb;
  --border-secondary: #d1d5db;
  --accent-primary: #3b82f6;
  --accent-hover: #2563eb;
  --button-bg: #f3f4f6;
  --button-text: #111827;
  --button-hover-bg: #e5e7eb;
  --selected-bg: #dbeafe;
  --selected-text: #1e40af;
  --disabled-text: #9ca3af;
  --success-color: #10b981;
  --warning-color: #f59e0b;
  --error-color: #ef4444;
  --modal-bg: #ffffff;
  --modal-overlay: rgba(0, 0, 0, 0.4);
  --modal-border: #d1d5db;
  --scrollbar-track: #f3f4f6;
  --scrollbar-thumb: #d1d5db;
  --scrollbar-thumb-hover: #9ca3af;
  
  /* Default text sizes (Medium) */
  --base-font-size: 14px;
  --small-font-size: 12px;
  --medium-font-size: 14px;
  --large-font-size: 16px;
  --input-padding: 6px 8px;
  --button-padding: 6px 10px;
}

html, body, #app { 
  height: 100%; 
  margin: 0;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: var(--base-font-size);
}

/* Custom Scrollbar Styling */
* {
  scrollbar-width: thin;
  scrollbar-color: var(--scrollbar-thumb) var(--scrollbar-track);
}

*::-webkit-scrollbar {
  width: 12px;
  height: 12px;
}

*::-webkit-scrollbar-track {
  background: var(--scrollbar-track);
}

*::-webkit-scrollbar-thumb {
  background: var(--scrollbar-thumb);
  border-radius: 6px;
  border: 2px solid var(--scrollbar-track);
}

*::-webkit-scrollbar-thumb:hover {
  background: var(--scrollbar-thumb-hover);
}

.layout { 
  display: flex; 
  flex-direction: column; 
  height: 100%; 
  font-family: system-ui, sans-serif;
  background: var(--bg-primary);
  color: var(--text-primary);
}

.toolbar { 
  display: flex; 
  align-items: center; 
  justify-content: space-between; 
  gap: 12px; 
  padding: 10px; 
  border-bottom: 1px solid var(--border-primary); 
  background: var(--bg-secondary); 
  position: relative;
  z-index: 10000;
}

.left-controls { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; position: relative; z-index: 10001; }
.right-actions { display: flex; align-items: center; gap: 8px; }
.search { 
  min-width: 240px; 
  padding: var(--input-padding);
  background: var(--bg-primary);
  color: var(--text-primary);
  border: 1px solid var(--border-secondary);
}
.status-setter select { 
  margin-left: 6px;
  background: var(--bg-primary);
  color: var(--text-primary);
  border: 1px solid var(--border-secondary);
}
.toggle { 
  display: inline-flex; 
  align-items: center; 
  gap: 6px; 
  margin-left: 8px;
  color: var(--text-primary);
}

.content { flex: 1; display: flex; min-height: 0; }
.table-wrapper { flex: 1; overflow: auto; background: var(--bg-primary); }
.sidebar { 
  width: 360px; 
  border-left: 1px solid var(--border-primary); 
  padding: 10px; 
  display: flex; 
  flex-direction: column; 
  gap: 10px; 
  overflow: auto; 
  background: var(--bg-primary); 
}
.panel { 
  border: 1px solid var(--border-primary); 
  border-radius: 6px; 
  background: var(--bg-secondary); 
}
.panel > h3 { 
  margin: 0; 
  padding: 8px 10px; 
  border-bottom: 1px solid var(--border-primary); 
  font-size: var(--medium-font-size);
  color: var(--text-primary);
}
.panel-body { 
  padding: 10px;
  color: var(--text-primary);
}
.panel-actions { 
  display: flex; 
  gap: 8px; 
  padding: 8px 10px; 
  border-bottom: 1px solid var(--border-primary); 
  background: var(--bg-hover); 
}
.kv-table { width: 100%; border-collapse: collapse; }
.kv-table th { 
  text-align: left; 
  width: 110px; 
  vertical-align: top; 
  padding: 6px; 
  color: var(--text-secondary); 
}
.kv-table td { 
  padding: 6px;
  color: var(--text-primary);
}
.kv-table input[type="text"], .kv-table input[type="number"], .kv-table textarea, .kv-table select { 
  width: 100%; 
  box-sizing: border-box; 
  padding: var(--input-padding);
  background: var(--bg-primary);
  color: var(--text-primary);
  border: 1px solid var(--border-secondary);
}
.data-table { 
  width: 100%; 
  border-collapse: collapse; 
  font-size: var(--base-font-size); 
}
.data-table thead th { 
  position: sticky; 
  top: 0; 
  background: var(--bg-tertiary); 
  z-index: 10; 
  text-align: left; 
  padding: 8px; 
  border-bottom: 1px solid var(--border-primary);
  color: var(--text-primary);
}
.data-table tbody td { 
  padding: 8px; 
  border-bottom: 1px solid var(--border-primary); 
  vertical-align: top;
  color: var(--text-primary);
}
.data-table tbody tr:hover { background: var(--bg-hover); }
.data-table .col-check { width: 36px; text-align: center; }
.data-table .action { width: 40px; text-align: center; font-weight: bold; }
.data-table .name { font-weight: 600; color: var(--text-primary); }
.data-table .name.in-run { font-weight: 700; }
.data-table .notes { color: var(--text-secondary); }
.data-table tbody tr.hidden { opacity: 0.6; }
.data-table tbody tr.finished .name { text-decoration: line-through; color: var(--text-tertiary); }
.empty { text-align: center; color: var(--text-tertiary); padding: 16px; }

button { 
  padding: var(--button-padding);
  background: var(--button-bg);
  color: var(--button-text);
  border: 1px solid var(--border-secondary);
  border-radius: 4px;
  cursor: pointer;
  font-size: var(--base-font-size);
}

button:hover:not(:disabled) {
  background: var(--button-hover-bg);
}

button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* Modal */
.modal-backdrop { 
  position: fixed; 
  inset: 0; 
  background: var(--modal-overlay); 
  display: flex; 
  align-items: center; 
  justify-content: center; 
  z-index: 20000; 
}
.modal { 
  width: 1200px; 
  max-width: 98vw; 
  max-height: 90vh; 
  background: var(--modal-bg); 
  border-radius: 8px; 
  border: 2px solid var(--modal-border);
  overflow: hidden; 
  display: flex; 
  flex-direction: column; 
}
.modal-header { 
  display: flex; 
  align-items: center; 
  justify-content: space-between; 
  gap: 8px; 
  padding: 10px; 
  background: var(--bg-tertiary); 
  border-bottom: 1px solid var(--border-primary);
  color: var(--text-primary);
}
.modal-header-actions { display: flex; gap: 8px; align-items: center; }
.modal-header .close { font-size: 16px; }
.modal-toolbar { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 10px; border-bottom: 1px solid #e5e7eb; flex-wrap: wrap; }
.modal-toolbar .add-random { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.modal-toolbar .add-random > * { flex: 0 0 auto; }
.modal-toolbar label { display: inline-flex; align-items: center; gap: 6px; }
.modal-toolbar .pattern { min-width: 220px; padding: 6px 8px; }
.match-count-indicator {
  padding: 6px 12px;
  background-color: var(--bg-tertiary);
  border: 1px solid var(--border-primary);
  border-radius: 4px;
  font-size: 13px;
  color: var(--text-primary);
}
.match-count-indicator.insufficient {
  background-color: #fee;
  border-color: #f88;
  color: #c00;
}
.match-count-indicator .error-text {
  font-weight: 600;
}
.modal-toolbar .count { width: 80px; padding: 6px 8px; }
.modal-toolbar .seed { min-width: 160px; padding: 6px 8px; }
.modal-body { padding: 0; overflow: auto; }

/* Column sizing in modal table */
.data-table th.col-seq, .data-table td.col-seq { width: 40px; text-align: center; font-weight: bold; color: #6b7280; }
.data-table th.col-actions, .data-table td.col-actions { width: 70px; text-align: center; }
.data-table th.col-count, .data-table td.col-count { width: 72px; }
.data-table th.col-matches, .data-table td.col-matches { width: 70px; text-align: center; }
.data-table th.col-seed, .data-table td.col-seed { width: 100px; }
.data-table th.col-pattern, .data-table td.col-pattern { width: 220px; }
.data-table td.col-count input { width: 60px; }
.data-table td.col-seed input { width: 90px; }
.data-table td.col-pattern input { width: 200px; }
.data-table .readonly-text {
  display: inline-block;
  padding: 4px 8px;
  background-color: var(--bg-tertiary);
  border: 1px solid var(--border-secondary);
  border-radius: 4px;
  color: var(--text-secondary);
  font-size: 13px;
  min-width: 60px;
  text-align: center;
}
.data-table .match-count-display {
  display: inline-block;
  padding: 4px 8px;
  background-color: #e8f5e9;
  border: 1px solid #81c784;
  border-radius: 4px;
  color: #2e7d32;
  font-size: 13px;
  font-weight: 600;
  min-width: 40px;
  text-align: center;
}
.data-table .match-count-display.insufficient {
  background-color: #ffebee;
  border-color: #e57373;
  color: #c62828;
}

/* Row reordering */
.btn-mini { padding: 2px 6px; font-size: 12px; margin: 0 2px; }
.data-table tbody tr[draggable="true"] { cursor: move; }
.data-table tbody tr.dragging { opacity: 0.5; background: #e0e7ff; }

/* Run execution */
.btn-start-run { background: #10b981; color: white; font-weight: bold; }
.btn-start-run:hover:not(:disabled) { background: #059669; }
.btn-start-run:disabled { background: #d1d5db; color: #9ca3af; cursor: not-allowed; }
.btn-cancel-run { background: #ef4444; color: white; }
.btn-cancel-run:hover { background: #dc2626; }
.btn-back { background: #6b7280; color: white; }
.btn-back:hover:not(:disabled) { background: #4b5563; }
.btn-back:disabled { background: #d1d5db; color: #9ca3af; cursor: not-allowed; }
.btn-next { background: #10b981; color: white; }
.btn-next:hover:not(:disabled) { background: #059669; }
.btn-skip { background: #f59e0b; color: white; }
.btn-skip:hover:not(:disabled) { background: #d97706; }
.btn-pause { background: #6b7280; color: white; }
.btn-pause:hover { background: #4b5563; }
.btn-unpause { background: #10b981; color: white; font-weight: bold; }
.btn-unpause:hover { background: #059669; }
.run-timer { font-weight: bold; color: #059669; font-size: 16px; padding: 0 8px; }
.pause-time { font-weight: bold; color: #ef4444; font-size: 16px; padding: 0 8px; }
.run-progress { color: #6b7280; padding: 0 8px; }
.data-table tbody tr.current-challenge { background: #dbeafe !important; border-left: 4px solid #3b82f6; font-weight: 600; }
.data-table tbody tr.current-challenge td { background: #dbeafe; }

/* Challenge status */
.col-status { width: 50px; text-align: center; font-size: 20px; }
.col-duration { width: 80px; text-align: right; font-family: monospace; }
.status-icon { font-weight: bold; }
.status-success .status-icon { color: #10b981; }  /* Green checkmark */
.status-ok .status-icon { color: #f59e0b; }  /* Orange warning - revealed early */
.status-skipped .status-icon { color: #ef4444; }  /* Red X */

/* Settings Modal */
.settings-modal { width: 800px; max-width: 95vw; }
.settings-body { 
  padding: 20px; 
  max-height: 70vh; 
  overflow-y: auto;
  background: var(--modal-bg);
}
.settings-section { 
  margin-bottom: 24px; 
  padding-bottom: 16px; 
  border-bottom: 1px solid var(--border-primary); 
}
.settings-section:last-child { border-bottom: none; }
.setting-row { 
  display: flex; 
  align-items: center; 
  justify-content: space-between; 
  gap: 16px; 
  margin-bottom: 8px; 
}
.setting-label { 
  flex: 0 0 280px; 
  font-weight: 500; 
  display: flex; 
  align-items: center; 
  gap: 8px;
  color: var(--text-primary);
}
.status-icon { color: var(--success-color); font-weight: bold; font-size: 18px; width: 20px; }
.setting-control { flex: 1; display: flex; gap: 8px; align-items: center; }
.setting-control input[type="text"], .setting-control select { 
  flex: 1; 
  padding: var(--input-padding); 
  border: 1px solid var(--border-secondary); 
  border-radius: 4px;
  background: var(--bg-primary);
  color: var(--text-primary);
}
.setting-caption { 
  font-size: var(--small-font-size); 
  color: var(--text-tertiary); 
  margin-top: 4px; 
  margin-left: 300px; 
  line-height: 1.5; 
}
.setting-caption.warning { color: var(--warning-color); }
.setting-caption code { 
  background: var(--bg-tertiary); 
  padding: 2px 4px; 
  border-radius: 2px; 
  font-size: 11px;
  color: var(--text-secondary);
}
.setting-caption a { color: var(--accent-primary); text-decoration: none; }
.setting-caption a:hover { text-decoration: underline; }
.setting-current-path { 
  font-size: var(--small-font-size); 
  color: var(--success-color); 
  margin-top: 4px; 
  margin-left: 300px; 
  font-weight: 500; 
}
.setting-current-path code { 
  background: var(--bg-tertiary); 
  padding: 2px 6px; 
  border-radius: 2px; 
  font-size: 11px; 
  color: var(--text-secondary); 
  word-break: break-all; 
}
.drop-zone { 
  flex: 1; 
  border: 2px dashed var(--border-secondary); 
  border-radius: 4px; 
  padding: 12px; 
  text-align: center; 
  color: var(--text-tertiary); 
  background: var(--bg-hover); 
  cursor: pointer; 
  transition: all 0.2s; 
}
.drop-zone:hover { 
  border-color: var(--accent-primary); 
  background: var(--bg-tertiary); 
  color: var(--accent-primary); 
}
.modal-footer { 
  padding: 12px 20px; 
  border-top: 1px solid var(--border-primary); 
  display: flex; 
  justify-content: flex-end; 
  gap: 8px; 
  background: var(--bg-hover); 
}
.btn-primary { 
  padding: 8px 16px; 
  background: var(--accent-primary); 
  color: white; 
  border: none; 
  border-radius: 4px; 
  font-weight: 500; 
  cursor: pointer; 
}
.btn-primary:hover { background: var(--accent-hover); }

/* Text Size Slider */
.text-size-slider {
  flex: 1;
  height: 6px;
  -webkit-appearance: none;
  appearance: none;
  background: var(--bg-tertiary);
  border-radius: 3px;
  outline: none;
}

.text-size-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 18px;
  height: 18px;
  background: var(--accent-primary);
  border-radius: 50%;
  cursor: pointer;
}

.text-size-slider::-moz-range-thumb {
  width: 18px;
  height: 18px;
  background: var(--accent-primary);
  border-radius: 50%;
  cursor: pointer;
  border: none;
}

.text-size-slider:hover::-webkit-slider-thumb {
  background: var(--accent-hover);
}

.text-size-slider:hover::-moz-range-thumb {
  background: var(--accent-hover);
}

.text-size-label {
  min-width: 100px;
  text-align: right;
  font-weight: 500;
  color: var(--text-primary);
}

/* Filter Dropdown */
.filter-dropdown-container {
  position: relative;
  display: inline-block;
}

.filter-dropdown-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  position: relative;
}

.filter-dropdown-btn.has-active-filter {
  background: var(--accent-primary);
  color: white;
  border-color: var(--accent-primary);
}

.filter-dropdown-btn.has-active-filter:hover:not(:disabled) {
  background: var(--accent-hover);
  border-color: var(--accent-hover);
}

.dropdown-arrow {
  font-size: 10px;
  opacity: 0.7;
}

.filter-indicator {
  position: absolute;
  top: -4px;
  right: -4px;
  width: 10px;
  height: 10px;
  background: var(--warning-color);
  border-radius: 50%;
  font-size: 10px;
  color: var(--warning-color);
}

.filter-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  min-width: 500px;
  max-width: 600px;
  background: var(--modal-bg);
  border: 2px solid var(--border-primary);
  border-radius: 8px;
  box-shadow: 0 4px 12px var(--modal-overlay);
  z-index: 100;
  display: flex;
  flex-direction: column;
}

.filter-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-primary);
  background: var(--bg-tertiary);
}

.filter-header h3 {
  margin: 0;
  font-size: var(--medium-font-size);
  color: var(--text-primary);
}

.filter-header .close {
  background: transparent;
  border: none;
  font-size: 18px;
  cursor: pointer;
  color: var(--text-secondary);
  padding: 0;
  width: 24px;
  height: 24px;
}

.filter-header .close:hover {
  color: var(--text-primary);
  background: var(--bg-hover);
}

.filter-body {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.filter-search-row {
  display: flex;
  gap: 8px;
}

.filter-search-input {
  flex: 1;
  padding: var(--input-padding);
  border: 1px solid var(--border-secondary);
  border-radius: 4px;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: var(--base-font-size);
}

.filter-search-input:focus {
  outline: none;
  border-color: var(--accent-primary);
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2);
}

.btn-clear-filter {
  padding: var(--button-padding);
  white-space: nowrap;
}

.common-filters {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.filter-section-label {
  font-size: var(--small-font-size);
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: 4px;
}

.filter-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.filter-tag {
  padding: 4px 10px;
  font-size: var(--small-font-size);
  background: var(--bg-tertiary);
  border: 1px solid var(--border-primary);
  border-radius: 16px;
  color: var(--text-primary);
  cursor: pointer;
  transition: all 0.2s;
}

.filter-tag:hover {
  background: var(--accent-primary);
  border-color: var(--accent-primary);
  color: white;
  transform: translateY(-1px);
}

.filter-help {
  margin-top: 8px;
}

.filter-help details {
  background: var(--bg-tertiary);
  border: 1px solid var(--border-primary);
  border-radius: 4px;
  padding: 8px 12px;
}

.filter-help summary {
  cursor: pointer;
  font-weight: 600;
  font-size: var(--small-font-size);
  color: var(--text-secondary);
  user-select: none;
}

.filter-help summary:hover {
  color: var(--accent-primary);
}

.filter-help-content {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--border-primary);
}

.filter-help-content p {
  margin: 6px 0;
  font-size: var(--small-font-size);
  color: var(--text-secondary);
  line-height: 1.5;
}

.filter-help-content code {
  background: var(--bg-hover);
  padding: 2px 6px;
  border-radius: 3px;
  font-family: monospace;
  font-size: 11px;
  color: var(--accent-primary);
}

.filter-help-content em {
  color: var(--text-tertiary);
  font-style: italic;
}

/* Simple Dropdown Styles */
.simple-dropdown {
  min-width: 180px;
  max-width: 220px;
}

.simple-dropdown-body {
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.dropdown-action-btn {
  width: 100%;
  text-align: left;
  padding: 8px 12px;
  background: transparent;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  color: var(--text-primary);
  font-size: var(--small-font-size);
  transition: background 0.2s;
}

.dropdown-action-btn:hover:not(:disabled) {
  background: var(--bg-hover);
}

.dropdown-action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  color: var(--text-tertiary);
}

/* USB2SNES Tools Modal */
.usb2snes-tools-modal {
  width: 95vw;
  max-width: 1200px;
  height: 90vh;
  max-height: 900px;
  overflow-y: auto;
}

.usb2snes-section {
  margin-bottom: 24px;
  padding-bottom: 24px;
  border-bottom: 1px solid var(--border-primary);
}

.usb2snes-section:last-child {
  border-bottom: none;
  margin-bottom: 0;
  padding-bottom: 0;
}

.usb2snes-section h4 {
  margin: 0 0 16px 0;
  color: var(--text-primary);
  font-size: var(--medium-font-size);
  font-weight: 600;
}

.usb2snes-library-select {
  flex: 1;
  padding: 8px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  border: 1px solid var(--border-primary);
  border-radius: 4px;
  font-size: var(--small-font-size);
}

.usb2snes-library-select:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-danger {
  background: #ef4444;
  color: white;
  padding: 8px 16px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: var(--small-font-size);
  font-weight: 600;
  transition: background 0.2s;
}

.btn-danger:hover {
  background: #dc2626;
}

.file-upload-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.file-upload-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.selected-file {
  color: var(--text-primary);
  font-size: var(--small-font-size);
  font-family: monospace;
}

.no-file {
  color: var(--text-tertiary);
  font-size: var(--small-font-size);
  font-style: italic;
}

.create-dir-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--border-primary);
}

.dir-caption {
  font-size: var(--small-font-size);
  color: var(--text-secondary);
}

.dir-caption code {
  background: var(--bg-tertiary);
  padding: 2px 6px;
  border-radius: 3px;
  font-family: monospace;
  color: var(--text-primary);
}

.status-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.status-row label {
  font-weight: 600;
  color: var(--text-secondary);
  min-width: 140px;
}

.status-row code {
  background: var(--bg-tertiary);
  padding: 4px 8px;
  border-radius: 4px;
  font-family: monospace;
  font-size: var(--small-font-size);
  color: var(--text-primary);
}

.status-indicator {
  padding: 4px 12px;
  border-radius: 4px;
  font-size: var(--small-font-size);
  font-weight: 600;
}

.status-indicator.connected {
  background: #10b981;
  color: white;
}

.status-indicator.disconnected {
  background: #ef4444;
  color: white;
}

.diagnostic-info {
  background: var(--bg-tertiary);
  padding: 12px;
  border-radius: 4px;
  margin-bottom: 12px;
}

.diagnostic-info p {
  margin: 8px 0;
  font-size: var(--small-font-size);
  color: var(--text-secondary);
}

.diagnostic-info strong {
  color: var(--text-primary);
  font-weight: 600;
}

.action-buttons {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.btn-secondary {
  background: var(--bg-tertiary);
  border: 1px solid var(--border-primary);
  padding: 8px 16px;
  border-radius: 4px;
  cursor: pointer;
  font-size: var(--small-font-size);
  color: var(--text-primary);
  transition: all 0.2s;
}

.btn-secondary:hover {
  background: var(--bg-hover);
  border-color: var(--accent-primary);
}

/* Run Name Modal */
.run-name-modal { width: 500px; max-width: 95vw; }
.run-name-body { padding: 20px; }
.run-name-body label { display: block; font-weight: 600; margin-bottom: 8px; color: #374151; }
.run-name-body input[type="text"] { width: 100%; padding: 10px 12px; font-size: 16px; border: 1px solid #d1d5db; border-radius: 4px; box-sizing: border-box; }
.run-name-body input[type="text"]:focus { outline: none; border-color: #3b82f6; box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1); }

/* Resume Run Modal */
.resume-run-modal { width: 600px; max-width: 95vw; }
.resume-run-body { padding: 24px; }
.resume-message { font-size: 16px; margin-bottom: 16px; color: #374151; }
.resume-prompt { font-size: 16px; margin-top: 20px; margin-bottom: 0; font-weight: 600; color: #374151; }
.run-info { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; padding: 16px; margin: 16px 0; }
.run-info-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #e5e7eb; }
.run-info-row:last-child { border-bottom: none; }
.run-info-row .label { font-weight: 600; color: #6b7280; }
.run-info-row .value { font-weight: 500; color: #111827; }
.resume-run-footer { display: flex; gap: 12px; justify-content: center; }
.btn-large { padding: 12px 24px; font-size: 16px; font-weight: 600; }
.btn-secondary { background: #6b7280; color: white; border: none; border-radius: 4px; cursor: pointer; }
.btn-secondary:hover { background: #4b5563; }
.btn-danger { background: #ef4444; color: white; border: none; border-radius: 4px; cursor: pointer; }
.btn-danger:hover { background: #dc2626; }

/* Staging Progress Modal */
.staging-progress-modal { width: 500px; max-width: 90vw; }
.progress-info { padding: 24px; }
.progress-bar { 
  width: 100%; 
  height: 30px; 
  background: #e5e7eb; 
  border-radius: 15px; 
  overflow: hidden;
  margin-bottom: 16px;
}
.progress-fill { 
  height: 100%; 
  background: linear-gradient(90deg, #3b82f6, #2563eb); 
  transition: width 0.3s ease;
}
.progress-text { 
  text-align: center; 
  font-size: 18px; 
  font-weight: 600; 
  color: #1f2937;
  margin: 8px 0;
}
.progress-game { 
  text-align: center; 
  font-size: 14px; 
  color: #6b7280;
  margin: 8px 0;
  min-height: 20px;
}

/* Run Upload Progress Modal */
.modal-backdrop:has(.run-upload-progress-modal) {
  z-index: 30000; /* Higher than staging modal (20000) */
}
.run-upload-progress-modal { 
  width: 600px; 
  max-width: 90vw; 
}
.progress-label {
  display: block;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 8px;
}
.status-log-container {
  margin-top: 20px;
}
.status-log {
  width: 100%;
  height: 200px;
  padding: 12px;
  font-family: 'Courier New', Courier, monospace;
  font-size: 12px;
  background-color: var(--bg-tertiary);
  color: var(--text-primary);
  border: 1px solid var(--border-primary);
  border-radius: 4px;
  resize: none;
  overflow-y: auto;
}

/* Staging Success Modal */
.staging-success-modal { width: 700px; max-width: 95vw; }
.success-info { padding: 24px; }
.success-message { 
  font-size: 18px; 
  margin-bottom: 24px; 
  text-align: center;
  color: #059669;
  font-weight: 600;
}
.folder-info { 
  margin: 24px 0; 
  padding: 16px;
  background: #f0f9ff;
  border: 2px solid #0ea5e9;
  border-radius: 8px;
}
.folder-label { 
  display: block; 
  font-weight: 700; 
  margin-bottom: 10px; 
  color: #0c4a6e;
  font-size: 15px;
}
.folder-path { 
  display: flex; 
  gap: 8px; 
  align-items: center;
}
.folder-path-input { 
  flex: 1; 
  padding: 10px 14px; 
  border: 2px solid #0ea5e9; 
  border-radius: 6px;
  background: white;
  font-family: 'Courier New', monospace;
  font-size: 14px;
  font-weight: 600;
  color: #0c4a6e;
  cursor: text;
  user-select: all;
}
.folder-path-input:focus {
  outline: none;
  border-color: #0284c7;
  box-shadow: 0 0 0 3px rgba(14, 165, 233, 0.1);
}
.btn-open-folder { 
  padding: 10px 18px; 
  background: #0ea5e9; 
  color: white; 
  border: none; 
  border-radius: 6px;
  cursor: pointer;
  font-size: 20px;
  transition: all 0.2s;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}
.btn-open-folder:hover { 
  background: #0284c7;
  transform: translateY(-1px);
  box-shadow: 0 4px 6px rgba(0,0,0,0.15);
}
.btn-open-folder:active {
  transform: translateY(0);
}
.staging-actions { 
  margin-top: 24px; 
  display: flex; 
  flex-direction: column;
  gap: 12px;
  align-items: center;
}
.btn-action { 
  padding: 12px 24px; 
  font-size: 16px; 
  font-weight: 600;
  border: none; 
  border-radius: 6px;
  cursor: pointer;
  min-width: 200px;
}
.btn-launch { 
  background: #10b981; 
  color: white;
}
.btn-launch:hover { background: #059669; }
.btn-upload { 
  background: #8b5cf6; 
  color: white;
}
.btn-upload:hover { background: #7c3aed; }
.btn-manual-confirm { 
  background: #f59e0b; 
  color: white;
  margin-top: 12px;
}
.btn-manual-confirm:hover { background: #d97706; }
.manual-upload-instructions { 
  background: #fef3c7; 
  border: 2px solid #fbbf24;
  border-radius: 8px;
  padding: 16px;
  text-align: center;
  width: 100%;
}
.instruction-text { 
  margin: 0 0 12px 0; 
  color: #92400e;
  line-height: 1.6;
}
.instruction-text code { 
  background: #fef3c7; 
  padding: 2px 6px; 
  border-radius: 3px;
  font-weight: 600;
  color: #92400e;
}

.launch-instructions {
  margin-top: 20px;
  padding: 16px;
  background: #f3f4f6;
  border-radius: 8px;
}

.launch-instructions h4 {
  margin: 0 0 12px 0;
  color: #374151;
  font-size: 16px;
}

.quick-actions-buttons {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin: 16px 0;
}

.action-group {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.btn-action {
  flex: 1;
  min-width: 200px;
  padding: 12px 16px;
  font-size: 14px;
  font-weight: 600;
  background: linear-gradient(135deg, var(--accent-primary) 0%, #1976D2 100%);
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-action:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.4);
}

.btn-action:active {
  transform: translateY(0);
}

.quick-launch-status {
  margin-top: 16px;
  font-size: 14px;
}

/* ===========================================================================
   SNES CONTENTS DROPDOWN STYLING
   =========================================================================== */

.snes-contents-dropdown-container {
  position: relative;
  display: inline-block;
  z-index: 9000;
}

.snes-contents-dropdown-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background-color: var(--bg-secondary);
  border: 1px solid var(--border-primary);
  border-radius: 4px;
  font-size: 13px;
  cursor: pointer;
  transition: background-color 0.2s;
}

.snes-contents-dropdown-btn:hover {
  background-color: var(--bg-hover);
}

.snes-contents-dropdown {
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: 4px;
  width: 450px;
  max-height: 500px;
  overflow-y: auto;
  background-color: var(--bg-primary);
  border: 2px solid var(--border-primary);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
  z-index: 9001;
}

.snes-contents-header {
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-primary);
  background-color: var(--bg-secondary);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.snes-contents-header h4 {
  margin: 0;
  font-size: 14px;
  color: var(--text-primary);
}

.show-all-checkbox {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-secondary);
  cursor: pointer;
}

.snes-contents-list {
  max-height: 400px;
  overflow-y: auto;
}

.snes-contents-empty {
  padding: 20px;
  text-align: center;
  color: var(--text-secondary);
  font-style: italic;
}

.snes-file-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border-secondary);
  transition: background-color 0.2s;
}

.snes-file-item:hover {
  background-color: var(--bg-hover);
}

.snes-file-item.pinned {
  background-color: #fef3c7;
  border-left: 4px solid #f59e0b;
}

.snes-file-item.dismissed {
  opacity: 0.6;
}

.snes-file-item.launched {
  background-color: #d1fae5;
}

.snes-file-info {
  flex: 1;
  min-width: 0;
}

.snes-file-name {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 500;
  color: var(--text-primary);
  margin-bottom: 4px;
}

.pin-indicator {
  font-size: 12px;
}

.snes-file-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 12px;
  color: var(--text-secondary);
}

.game-name {
  color: var(--accent-primary);
  font-weight: 500;
}

.game-id {
  color: var(--text-tertiary);
}

.unknown-file {
  color: var(--text-tertiary);
  font-style: italic;
}

.upload-time {
  color: var(--text-tertiary);
  font-size: 11px;
}

.snes-file-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

.snes-action-btn {
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
}

.launch-btn {
  background-color: var(--success-color);
  color: white;
}

.launch-btn:hover {
  background-color: #059669;
}

.pin-btn {
  background-color: var(--warning-color);
  color: white;
}

.pin-btn.active {
  background-color: #d97706;
}

.pin-btn:hover {
  background-color: #d97706;
}

.dismiss-btn {
  background-color: var(--error-color);
  color: white;
}

.dismiss-btn:hover {
  background-color: #dc2626;
}

.find-btn {
  background-color: var(--accent-primary);
  color: white;
}

.find-btn:hover {
  background-color: var(--accent-hover);
}

.launch-instructions ol {
  margin: 0 0 12px 0;
  padding-left: 24px;
  color: #4b5563;
  line-height: 1.8;
}

.launch-instructions li {
  margin-bottom: 8px;
}

.launch-instructions code {
  background: #e5e7eb;
  padding: 2px 6px;
  border-radius: 3px;
  font-weight: 600;
  color: #1f2937;
  font-size: 0.9em;
}

.launch-instructions .tip {
  margin: 12px 0 0 0;
  padding: 12px;
  background: #dbeafe;
  border-left: 4px solid #3b82f6;
  border-radius: 4px;
  color: #1e40af;
  font-size: 14px;
}

.launch-instructions .tip strong {
  font-weight: 600;
}

/* New UI Components */

/* Read-only fields */
.readonly-field { 
  color: var(--text-secondary); 
  background: var(--bg-tertiary); 
  padding: 6px 8px; 
  border-radius: 4px;
  border: 1px solid var(--border-primary);
}

/* Star rating component */
.star-rating { 
  display: flex; 
  align-items: center; 
  gap: 4px; 
}

.star { 
  font-size: 24px; 
  cursor: pointer; 
  color: #d1d5db; 
  user-select: none;
  transition: all 0.2s;
}

.star:hover { 
  color: #fbbf24;
  transform: scale(1.1);
}

.star.filled { 
  color: #f59e0b;
}

.btn-clear-rating {
  padding: 2px 6px;
  font-size: 12px;
  margin-left: 4px;
  background: #f3f4f6;
  border: 1px solid #d1d5db;
  border-radius: 3px;
  cursor: pointer;
}

.btn-clear-rating:hover {
  background: #fee2e2;
  border-color: #fca5a5;
  color: #dc2626;
}

.rating-label {
  margin-left: 8px;
  font-size: 13px;
  color: #6b7280;
  font-style: italic;
  min-width: 100px;
}

/* Detail action buttons */
.detail-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.detail-actions button {
  flex: 1;
  min-width: 150px;
  padding: 6px 10px;
  font-size: 13px;
}

/* JSON Modal */
.json-modal {
  width: 900px;
  max-width: 95vw;
}

.json-body {
  padding: 20px;
  max-height: 70vh;
  overflow: auto;
  background: #1f2937;
}

.json-body pre {
  margin: 0;
  font-family: 'Courier New', Courier, monospace;
  font-size: 13px;
  line-height: 1.5;
  color: #e5e7eb;
  white-space: pre-wrap;
  word-wrap: break-word;
}

/* Skill Rating (smaller stars for 0-10 scale) */
.star-small {
  font-size: 18px;
}

/* Conditions column */
.col-conditions {
  width: 80px;
  text-align: center;
}

.btn-conditions {
  padding: 4px 8px;
  font-size: 11px;
  background: #f3f4f6;
  border: 1px solid #d1d5db;
  border-radius: 3px;
  cursor: pointer;
  white-space: nowrap;
}

.btn-conditions:hover {
  background: #e0e7ff;
  border-color: #818cf8;
}

.btn-conditions-header {
  padding: 6px 10px;
  font-size: 12px;
  background: #eff6ff;
  border: 1px solid #93c5fd;
  border-radius: 4px;
  cursor: pointer;
}

.btn-conditions-header:hover {
  background: #dbeafe;
  border-color: #60a5fa;
}

/* Skill rating caption */
.skill-rating-container {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.skill-caption {
  font-size: 12px;
  color: #059669;
  font-style: italic;
  line-height: 1.4;
  padding: 6px 8px;
  background: #f0fdf4;
  border-left: 3px solid #10b981;
  border-radius: 3px;
}

/* Loading overlay */
.loading-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(255, 255, 255, 0.9);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  z-index: 100;
  font-size: 16px;
  color: #374151;
}

.loading-spinner {
  width: 48px;
  height: 48px;
  border: 4px solid #e5e7eb;
  border-top-color: #3b82f6;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.error-message {
  padding: 12px 16px;
  margin: 16px;
  background: #fee2e2;
  border: 1px solid #fca5a5;
  border-radius: 6px;
  color: #991b1b;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.error-message button {
  background: #dc2626;
  color: white;
  border: none;
  padding: 6px 12px;
  border-radius: 4px;
  cursor: pointer;
}

.error-message button:hover {
  background: #b91c1c;
}

/* Chat Commands UI */
.chat-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
  pointer-events: auto;
  position: relative;
  z-index: 100;
}

.chat-log {
  background-color: #1a1a1a;
  border: 2px solid #4CAF50;
  border-radius: 4px;
  padding: 12px;
  height: 200px;
  overflow-y: auto;
  font-family: monospace;
  font-size: 12px;
}

.chat-entry {
  margin-bottom: 8px;
  line-height: 1.4;
}

.chat-entry.command {
  color: var(--accent-primary);
  font-weight: 600;
}

.chat-entry.response-success {
  color: #4CAF50;
}

.chat-entry.response-error {
  color: #F44336;
}

.chat-timestamp {
  color: var(--text-tertiary);
  margin-right: 8px;
  font-size: 11px;
}

.chat-empty {
  color: var(--text-tertiary);
  font-style: italic;
  text-align: center;
  padding: 40px;
}

.chat-input-row {
  display: flex;
  gap: 8px;
  position: relative;
  z-index: 999;
}

.chat-input {
  flex: 1;
  padding: 8px 12px;
  border: 3px solid #2196F3 !important;
  border-radius: 4px;
  background-color: #ffffff !important;
  color: #000000 !important;
  font-family: monospace;
  font-size: 13px;
  pointer-events: auto !important;
  z-index: 1000;
  position: relative;
}

.chat-input:focus {
  outline: none;
  border-color: #4CAF50 !important;
  box-shadow: 0 0 5px #4CAF50;
}

.chat-help {
  margin-top: 8px;
}

.chat-help summary {
  cursor: pointer;
  color: var(--accent-primary);
  font-size: 12px;
  user-select: none;
}

.chat-help summary:hover {
  text-decoration: underline;
}

.chat-help-content {
  margin-top: 8px;
  padding: 12px;
  background-color: var(--bg-secondary);
  border-radius: 4px;
  font-size: 12px;
}

.chat-help-content p {
  margin: 4px 0;
}

.chat-help-content code {
  background-color: var(--bg-primary);
  padding: 2px 6px;
  border-radius: 3px;
  font-family: monospace;
  color: var(--accent-primary);
}

.loaded-modules {
  margin-top: 12px;
  padding: 12px;
  background-color: var(--bg-secondary);
  border-radius: 4px;
  font-size: 12px;
}

.module-list {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.module-item {
  padding: 4px 8px;
  background-color: var(--bg-primary);
  border-radius: 3px;
  font-family: monospace;
}

.module-addr {
  color: var(--text-tertiary);
  font-size: 11px;
}

/* Command Help Modal */
.command-help-modal {
  width: 900px;
  max-width: 95vw;
  max-height: 85vh;
}

.command-help-modal .modal-body {
  max-height: 70vh;
  overflow-y: auto;
  padding: 0;
}

.command-help-content {
  padding: 20px;
}

.help-section {
  margin-bottom: 32px;
}

.help-section h4 {
  font-size: 18px;
  margin-bottom: 16px;
  color: var(--accent-primary);
  border-bottom: 2px solid var(--accent-primary);
  padding-bottom: 8px;
}

.section-description {
  color: #aaa;
  margin-bottom: 16px;
  font-size: 14px;
}

.help-subsection {
  margin: 24px 0;
  padding-left: 12px;
  border-left: 3px solid #444;
}

.help-subsection h5 {
  font-size: 15px;
  margin-bottom: 12px;
  color: #ddd;
}

.command-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.command-item {
  background: #1a1a1a;
  padding: 12px;
  border-radius: 6px;
  border-left: 3px solid var(--accent-primary);
}

.command-item code {
  font-size: 14px;
  color: #4CAF50;
  display: block;
  margin-bottom: 8px;
  font-weight: 600;
}

.command-item p {
  margin: 4px 0;
  color: #ccc;
  font-size: 13px;
}

.command-item .example {
  color: #888;
  font-style: italic;
  margin-top: 8px;
}

.command-item .example code {
  display: inline;
  color: #2196F3;
  font-size: 12px;
}

.command-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(400px, 1fr));
  gap: 10px;
}

.command-item-compact {
  background: #1a1a1a;
  padding: 8px 12px;
  border-radius: 4px;
  border-left: 2px solid #555;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.command-item-compact code {
  font-size: 13px;
  color: #4CAF50;
  font-weight: 600;
}

.command-item-compact span {
  font-size: 11px;
  color: #999;
  line-height: 1.4;
}

.btn-close {
  background: none;
  border: none;
  color: #ccc;
  font-size: 28px;
  line-height: 1;
  padding: 0;
  width: 32px;
  height: 32px;
  cursor: pointer;
  transition: color 0.2s;
}

.btn-close:hover {
  color: #f44336;
}

/* Upload Progress Modal */
.upload-progress-backdrop {
  z-index: 25000 !important;
}

.upload-progress-modal {
  width: 500px;
  max-width: 90vw;
}

.upload-progress-content {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 10px 0;
}

.upload-file-info {
  font-size: 14px;
  word-break: break-all;
}

.progress-bar-container {
  position: relative;
  width: 100%;
  height: 30px;
  background-color: var(--bg-secondary);
  border: 2px solid var(--border-primary);
  border-radius: 4px;
  overflow: hidden;
}

.progress-bar-fill {
  height: 100%;
  background-color: var(--accent-primary);
  transition: width 0.3s ease;
}

.progress-bar-text {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  font-weight: 600;
  font-size: 14px;
  color: var(--text-primary);
  text-shadow: 0 0 3px rgba(0, 0, 0, 0.5);
}

.upload-status {
  text-align: center;
  font-size: 14px;
  font-weight: 500;
}

.upload-status.success {
  color: #4CAF50;
}

.upload-status.error {
  color: #F44336;
}

/* ===========================================================================
   USB2SNES DROPDOWN STYLING
   =========================================================================== */

.usb2snes-dropdown-container {
  position: relative;
  display: inline-block;
  z-index: 10002;
}

.usb2snes-dropdown-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  background-color: var(--bg-secondary);
  border: 1px solid var(--border-primary);
  border-radius: 4px;
  color: var(--text-primary);
  cursor: pointer;
  font-size: 14px;
  transition: background-color 0.2s;
}

.usb2snes-dropdown-btn:hover {
  background-color: var(--bg-hover);
}

.dropdown-icon {
  font-size: 18px;
}

.health-indicator-mini {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
}

.health-indicator-mini.green {
  background-color: #4CAF50;
  box-shadow: 0 0 6px #4CAF50;
}

.health-indicator-mini.yellow {
  background-color: #FFC107;
  box-shadow: 0 0 6px #FFC107;
}

.health-indicator-mini.red {
  background-color: #F44336;
  box-shadow: 0 0 6px #F44336;
}

.usb2snes-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  margin-top: 4px;
  width: 450px;
  max-height: 600px;
  overflow-y: auto;
  background-color: var(--bg-secondary) !important;
  border: 2px solid var(--border-primary);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
  z-index: 10003;
}

.usb2snes-dropdown-header {
  padding: 16px;
  border-bottom: 1px solid var(--border-primary);
  background-color: var(--bg-secondary);
}

.action-status-display {
  margin-top: 12px;
  padding: 8px 12px;
  border-radius: 4px;
  font-size: 13px;
  font-weight: 500;
  text-align: center;
  background-color: var(--bg-primary);
  border: 1px solid var(--border-primary);
  min-height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.cheat-status,
.challenge-status {
  margin-top: 20px;
  font-size: 14px;
}

.status-indicators {
  display: flex;
  gap: 20px;
  margin-bottom: 12px;
}

.status-item {
  display: flex;
  align-items: center;
  gap: 8px;
}

.status-label {
  font-size: 12px;
  color: var(--text-secondary);
}

.status-indicator {
  font-size: 13px;
  font-weight: 600;
}

.status-indicator.connected {
  color: #4CAF50;
}

.status-indicator.disconnected {
  color: #F44336;
}

.health-indicator {
  font-size: 13px;
  font-weight: 600;
}

.health-indicator.green {
  color: #4CAF50;
}

.health-indicator.yellow {
  color: #FFC107;
}

.health-indicator.red {
  color: #F44336;
}

.connection-info {
  display: flex;
  gap: 8px;
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.info-item {
  font-family: monospace;
}

.info-separator {
  color: var(--text-tertiary);
}

.dropdown-header-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.btn-primary-small,
.btn-secondary-small,
.btn-danger-small {
  padding: 6px 12px;
  font-size: 12px;
  border-radius: 4px;
  border: none;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-primary-small {
  background-color: var(--accent-primary);
  color: white;
}

.btn-primary-small:hover {
  filter: brightness(1.1);
}

.btn-secondary-small {
  background-color: var(--bg-tertiary);
  color: var(--text-primary);
}

.btn-secondary-small:hover {
  background-color: var(--bg-hover);
}

.btn-danger-small {
  background-color: #F44336;
  color: white;
}

.btn-danger-small:hover {
  background-color: #D32F2F;
}

.usb2snes-dropdown-actions {
  padding: 16px;
  border-bottom: 1px solid var(--border-primary);
}

.usb2snes-dropdown-actions h4 {
  margin: 0 0 12px 0;
  font-size: 14px;
  color: var(--text-primary);
}

.action-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.action-btn {
  padding: 10px 12px;
  background-color: var(--bg-tertiary);
  border: 1px solid var(--border-primary);
  border-radius: 4px;
  color: var(--text-primary);
  cursor: pointer;
  font-size: 13px;
  text-align: center;
  transition: all 0.2s;
}

.action-btn:hover:not(:disabled) {
  background-color: var(--bg-hover);
  border-color: var(--accent-primary);
}

.action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.usb2snes-dropdown-chat {
  padding: 16px;
}

.minichat-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.minichat-header h4 {
  margin: 0;
  font-size: 14px;
  color: var(--text-primary);
}

.btn-link-small {
  background: none;
  border: none;
  color: var(--accent-primary);
  font-size: 12px;
  cursor: pointer;
  padding: 0;
}

.btn-link-small:hover {
  text-decoration: underline;
}

.minichat-log {
  background-color: var(--bg-secondary);
  border: 1px solid var(--border-primary);
  border-radius: 4px;
  padding: 8px;
  height: 80px;
  overflow-y: auto;
  margin-bottom: 8px;
  font-size: 11px;
  font-family: monospace;
}

.chat-entry-mini {
  margin-bottom: 4px;
  line-height: 1.3;
}

.chat-entry-mini.command {
  color: var(--accent-primary);
}

.chat-entry-mini.response-success {
  color: #4CAF50;
}

.chat-entry-mini.response-error {
  color: #F44336;
}

.chat-message-mini {
  word-break: break-word;
}

.minichat-empty {
  color: var(--text-tertiary);
  font-style: italic;
  text-align: center;
  padding: 20px 0;
}

.minichat-input-row {
  display: flex;
  gap: 6px;
}

.minichat-input {
  flex: 1;
  padding: 6px 10px;
  background-color: var(--bg-primary);
  border: 1px solid var(--border-primary);
  border-radius: 4px;
  color: var(--text-primary);
  font-size: 12px;
  font-family: monospace;
}

.minichat-input:focus {
  outline: none;
  border-color: var(--accent-primary);
}

.minichat-input:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* ===========================================================================
   FULL CHAT MODAL STYLING
   =========================================================================== */

.full-chat-modal {
  width: 800px;
  max-width: 95vw;
  max-height: 90vh;
}

.full-chat-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.chat-status-bar {
  background-color: var(--bg-secondary);
  padding: 12px;
  border-radius: 6px;
  border: 1px solid var(--border-primary);
}

.status-item-inline {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}

.rom-name {
  font-family: monospace;
  font-size: 13px;
  color: var(--accent-primary);
  font-weight: 600;
}

.quick-commands {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.quick-cmd-btn {
  padding: 6px 12px;
  background-color: var(--accent-primary);
  border: none;
  border-radius: 4px;
  color: white;
  font-family: monospace;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s;
}

.quick-cmd-btn:hover {
  filter: brightness(1.2);
  transform: translateY(-1px);
}

.chat-log-fullsize {
  background-color: var(--bg-secondary);
  border: 2px solid var(--border-primary);
  border-radius: 6px;
  padding: 12px;
  height: 300px;
  overflow-y: auto;
  font-family: monospace;
  font-size: 12px;
}

.chat-input-row-fullsize {
  display: flex;
  gap: 8px;
}

.chat-help-section {
  margin-top: 8px;
}

.loaded-modules-fullchat {
  background-color: var(--bg-secondary);
  padding: 10px;
  border-radius: 4px;
  font-size: 12px;
}

.module-list-inline {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 6px;
}

.module-chip {
  background-color: var(--accent-primary);
  color: white;
  padding: 4px 8px;
  border-radius: 12px;
  font-size: 11px;
  font-family: monospace;
}

/* ===========================================================================
   UPLOAD FILE MODAL STYLING
   =========================================================================== */

.upload-file-modal {
  width: 500px;
  max-width: 90vw;
}

.upload-file-content {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 10px 0;
}

.file-selector {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.selected-file-info {
  background-color: var(--bg-secondary);
  padding: 12px;
  border-radius: 6px;
  border: 1px solid var(--border-primary);
}

.selected-file-info p {
  margin: 4px 0;
  font-size: 13px;
}

.upload-actions {
  display: flex;
  justify-content: center;
}

/* ===========================================================================
   CHEATS MODAL STYLING
   =========================================================================== */

.cheats-modal {
  width: 500px;
  max-width: 90vw;
}

.cheats-content {
  padding: 10px 0;
}

.cheat-buttons {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.cheat-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 20px;
  background: linear-gradient(135deg, var(--bg-tertiary) 0%, var(--bg-secondary) 100%);
  border: 2px solid var(--border-primary);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.3s;
}

.cheat-btn:hover {
  border-color: var(--accent-primary);
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(76, 175, 80, 0.3);
}

.cheat-icon {
  font-size: 48px;
  margin-bottom: 8px;
}

.cheat-name {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 4px;
}

.cheat-desc {
  font-size: 12px;
  color: var(--text-secondary);
  font-family: monospace;
}

/* ===========================================================================
   CHALLENGES MODAL STYLING
   =========================================================================== */

.challenges-modal {
  width: 500px;
  max-width: 90vw;
}

.challenges-content {
  padding: 10px 0;
}

.challenge-buttons {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.challenge-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 20px;
  background: linear-gradient(135deg, var(--accent-primary) 0%, #1976D2 100%);
  border: 2px solid var(--accent-primary);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.3s;
  color: white;
}

.challenge-btn:hover:not(.disabled) {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(33, 150, 243, 0.5);
}

.challenge-btn.disabled {
  opacity: 0.5;
  cursor: not-allowed;
  background: var(--bg-tertiary);
  color: var(--text-secondary);
}

.challenge-icon {
  font-size: 48px;
  margin-bottom: 8px;
}

.challenge-name {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 4px;
}

.challenge-desc {
  font-size: 12px;
  opacity: 0.9;
}

</style>

