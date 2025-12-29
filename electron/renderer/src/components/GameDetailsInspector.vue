<template>
  <div class="panel" v-if="game">
    <div class="panel-header">
      <h3>Details</h3>
      <div class="header-actions">
        <button 
          v-if="hasGameLinks" 
          @click="openLinksModal" 
          class="globe-icon" 
          title="View Links"
        >
          🌐
        </button>
        <button @click="openPopoutModal" class="popout-icon" title="Pop out details">🔍</button>
      </div>
    </div>
    <div class="panel-body details">
      <table class="kv-table">
        <tbody>
          <!-- Id / Version combined (compact view only) -->
          <tr>
            <th>Id / Version</th>
            <td class="readonly-field">
              ({{ game.Id }}) / ({{ selectedVersion }}{{ selectedVersion === latestVersion ? ' (Latest)' : '' }})
            </td>
          </tr>
          
          <!-- Official Fields (READ-ONLY) -->
          <tr>
            <th 
              :class="{ 'clickable-name': hasGameLinks && mainLink }" 
              @click="hasGameLinks && mainLink ? openMainLink() : null"
              :title="hasGameLinks && mainLink ? 'Click to open main link' : ''"
            >
              Name
            </th>
            <td class="readonly-field">{{ game.Name }}</td>
          </tr>
          <tr><th>Type</th><td class="readonly-field">{{ game.Type }}</td></tr>
          <tr v-if="game.LegacyType"><th>Legacy Type</th><td class="readonly-field">{{ game.LegacyType }}</td></tr>
          <tr><th>Author</th><td class="readonly-field">{{ game.Author }}</td></tr>
          
          <!-- Ban Details Row -->
          <tr v-if="hasBans">
            <th>Bans</th>
            <td class="readonly-field">
              <span class="ban-details-link" @click="openBanDetailsModal">
                click for block details
              </span>
            </td>
          </tr>
          
          <tr>
            <th>Length</th>
            <td class="readonly-field">
              {{ game.Length }}
              <button
                v-if="hasScreenshots"
                @click="openScreenshotGallery"
                class="screenshot-icon-btn"
                title="View Screenshots"
              >
                🖼️
              </button>
            </td>
          </tr>
          
          <!-- Public Difficulty / Rating on same row -->
          <tr>
            <th>Difficulty / Rating</th>
            <td class="readonly-field">
              ({{ game.PublicDifficulty || '—' }}) / ({{ game.Publicrating || '—' }})
            </td>
          </tr>
          
          <!-- Avail Stages -->
          <tr v-if="availStagesCount > 0 || availStagesText">
            <th>Avail Stages</th>
            <td>
              <span v-if="availStagesText" class="clickable avail-stages-link" @click="$emit('open-stages-dialog')">
                {{ availStagesText }}
              </span>
              <span v-else class="readonly-field">None</span>
            </td>
          </tr>
          
          <tr v-if="game.Demo && game.Demo.toLowerCase() === 'yes'"><th>Demo</th><td class="readonly-field">{{ game.Demo }}</td></tr>
          <tr v-if="game.Contest"><th>Contest</th><td class="readonly-field">{{ game.Contest }}</td></tr>
          <tr v-if="game.Racelevel"><th>Race Level</th><td class="readonly-field">{{ game.Racelevel }}</td></tr>
          
          <!-- Tags Row -->
          <tr v-if="game.Tags && (Array.isArray(game.Tags) ? game.Tags.length > 0 : game.Tags)">
            <th>Tags</th>
            <td class="readonly-field">
              <div class="tags-container">
                <span 
                  v-if="Array.isArray(game.Tags)"
                  class="tags-display"
                  @click="$emit('open-tags-modal')"
                  :title="formatTagsForTooltip(game.Tags)"
                >
                  {{ formatTagsShort(game.Tags) }}
                </span>
                <span 
                  v-else
                  class="tags-display"
                  @click="$emit('open-tags-modal')"
                  :title="game.Tags"
                >
                  {{ truncateText(game.Tags, 60) }}
                </span>
              </div>
            </td>
          </tr>
          
          <!-- Description Row -->
          <tr v-if="game.Description">
            <th>Description</th>
            <td class="readonly-field">
              <div class="description-container">
                <span
                  class="description-display"
                  @click="$emit('open-description-modal')"
                  :title="game.Description"
                >
                  {{ truncateText(game.Description, 60) }}
                  <span v-if="game.Description && game.Description.length > 60" class="ellipsis-indicator clickable" @click.stop="$emit('open-description-modal')" title="Click to view full description">...</span>
                </span>
              </div>
            </td>
          </tr>
          
          <!-- User-Editable Fields -->
          <tr>
            <th>Status</th>
            <td>
              <select :value="game.Status" @change="$emit('status-changed', ($event.target as HTMLSelectElement).value)">
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
              <div class="star-rating clickable" @click="handleOpenRatingSheet">
                <span 
                  v-for="n in 6" 
                  :key="'diff-' + (n-1)"
                  :class="{ filled: (n - 1) <= (game.MyDifficultyRating ?? -1) }"
                  class="star"
                >★</span>
                <button @click.stop="handleClearDifficulty" class="btn-clear-rating">✕</button>
                <span class="rating-label">{{ difficultyLabel(game.MyDifficultyRating) }}</span>
                <span class="click-hint">(Click to open rating sheet)</span>
              </div>
            </td>
          </tr>
          <tr>
            <th>My Review</th>
            <td>
              <div class="star-rating clickable" @click="handleOpenRatingSheet">
                <span 
                  v-for="n in 6" 
                  :key="'rev-' + (n-1)"
                  :class="{ filled: (n - 1) <= (game.MyReviewRating ?? -1) }"
                  class="star"
                >★</span>
                <button @click.stop="handleClearReview" class="btn-clear-rating">✕</button>
                <span class="rating-label">{{ reviewLabel(game.MyReviewRating) }}</span>
                <span class="click-hint">(Click to open rating sheet)</span>
              </div>
            </td>
          </tr>
          
          <tr>
            <th>Hidden</th>
            <td><input type="checkbox" :checked="game.Hidden" @change="$emit('hidden-changed', ($event.target as HTMLInputElement).checked)" /></td>
          </tr>
          <tr>
            <th>Exclude from Random</th>
            <td><input type="checkbox" :checked="game.ExcludeFromRandom" @change="$emit('exclude-changed', ($event.target as HTMLInputElement).checked)" /></td>
          </tr>
          <tr>
            <th>My notes</th>
            <td><textarea :value="game.Mynotes" rows="4" @input="$emit('notes-changed', ($event.target as HTMLTextAreaElement).value)" @blur="$emit('save-non-rating-fields')"></textarea></td>
          </tr>
          
          <!-- Action Buttons -->
          <tr>
            <td colspan="2" style="padding-top: 12px;">
              <div class="detail-actions">
                <button @click="$emit('set-version-specific-rating')" :disabled="isVersionSpecific">
                  {{ isVersionSpecific ? '✓ Version-Specific' : 'Set Version-Specific Rating' }}
                </button>
                <button @click="$emit('view-json-details')">View Details (JSON)</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>

      <div v-if="ratingSummaryPanelVisible" class="ratings-summary-panel">
        <header class="ratings-summary-header">
          <h4>Community Ratings (Nostr)</h4>
          <button
            class="btn-refresh"
            :disabled="ratingSummaryState.loading"
            @click="$emit('refresh-rating-summaries')"
          >
            {{ ratingSummaryState.loading ? 'Refreshing…' : 'Refresh' }}
          </button>
        </header>

        <div v-if="ratingSummaryState.loading" class="ratings-summary-loading">
          Fetching latest aggregated ratings…
        </div>

        <div v-else-if="ratingSummaryState.error" class="ratings-summary-error">
          {{ ratingSummaryState.error }}
        </div>

        <div v-else-if="ratingSummaryDisplay" class="ratings-summary-content">
          <p class="ratings-summary-meta">
            <strong>{{ ratingSummaryDisplay.totalEvents }}</strong>
            total rating{{ ratingSummaryDisplay.totalEvents === 1 ? '' : 's' }}
            <span v-if="ratingSummaryDisplay.updatedAtLabel" class="meta-updated">
              (updated {{ ratingSummaryDisplay.updatedAtLabel }})
            </span>
          </p>

          <div v-if="ratingSummaryDisplay.tiers.length" class="ratings-summary-tiers">
            <div class="tier" v-for="tier in ratingSummaryDisplay.tiers" :key="tier.key">
              <span class="tier-label">{{ tier.label }}</span>
              <span class="tier-count">{{ tier.count }}</span>
            </div>
          </div>

          <div v-if="ratingSummaryDisplay.hasCategoryData" class="ratings-summary-categories">
            <div class="category" v-for="category in ratingSummaryDisplay.categories" :key="category.field">
              <h5>{{ category.label }}</h5>
              <table class="category-table">
                <thead>
                  <tr>
                    <th>Tier</th>
                    <th>Count</th>
                    <th>Avg</th>
                    <th>Median</th>
                    <th>Std Dev</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="tier in category.tiers" :key="tier.key">
                    <td>{{ tier.label }}</td>
                    <td>{{ tier.count }}</td>
                    <td>{{ formatRatingStat(tier.average) }}</td>
                    <td>{{ formatRatingStat(tier.median) }}</td>
                    <td>{{ formatRatingStat(tier.stddev) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <p v-else class="ratings-summary-empty">
            No community ratings (kind 31001) available yet.
          </p>
        </div>
      </div>
    </div>
  </div>

  <!-- Stages Action Button -->
  <div class="panel" v-if="game">
    <div class="panel-header">
      <h3>Stages</h3>
    </div>
    <div class="panel-body stages-actions">
      <button @click="$emit('add-stage-to-run')" class="btn-add-stage" title="Add stage to run">
        <span class="add-icon">+</span> Add stage to run
      </button>
    </div>
  </div>

  <!-- Popout Modal - Full Screen Details View -->
  <Teleport to="body">
    <div v-if="popoutModalOpen" class="modal-backdrop" @click.self="closePopoutModal" style="z-index: 20000;">
      <div class="modal details-popout-modal">
        <header class="modal-header">
          <h3>Details - {{ game?.Name }}</h3>
          <button @click="closePopoutModal" class="close">✕</button>
        </header>
        <section class="modal-body details-popout-body">
          <!-- Expanded view with same content but more detail -->
          <div class="details-expanded">
            <table class="kv-table">
              <tbody>
                <!-- Same content as main view but with more space -->
                <tr>
                  <th>Version</th>
                  <td>
                    <select :value="selectedVersion" @change="$emit('version-changed', parseInt(($event.target as HTMLSelectElement).value))">
                      <option v-for="v in availableVersions" :key="v" :value="v">
                        Version {{ v }}{{ v === latestVersion ? ' (Latest)' : '' }}
                      </option>
                    </select>
                  </td>
                </tr>
                
                <tr><th>Id</th><td class="readonly-field">{{ game?.Id }}</td></tr>
                <tr>
                  <th 
                    :class="{ 'clickable-name': hasGameLinks && mainLink }" 
                    @click="hasGameLinks && mainLink ? openMainLink() : null"
                    :title="hasGameLinks && mainLink ? 'Click to open main link' : ''"
                  >
                    Name
                  </th>
                  <td class="readonly-field">{{ game?.Name }}</td>
                </tr>
                <tr><th>Type</th><td class="readonly-field">{{ game?.Type }}</td></tr>
                <tr v-if="game?.LegacyType"><th>Legacy Type</th><td class="readonly-field">{{ game.LegacyType }}</td></tr>
                <tr><th>Author</th><td class="readonly-field">{{ game?.Author }}</td></tr>
                
                <!-- Ban Details Row (Popout) -->
                <tr v-if="hasBans">
                  <th>Bans</th>
                  <td class="readonly-field">
                    <span class="ban-details-link" @click="openBanDetailsModal">
                      click for block details
                    </span>
                  </td>
                </tr>
                
                <tr>
                  <th>Length</th>
                  <td class="readonly-field">
                    {{ game?.Length }}
                    <button
                      v-if="hasScreenshots"
                      @click="openScreenshotGallery"
                      class="screenshot-icon-btn"
                      title="View Screenshots"
                    >
                      🖼️
                    </button>
                  </td>
                </tr>
                
                <tr>
                  <th>Difficulty / Rating</th>
                  <td class="readonly-field">
                    ({{ game?.PublicDifficulty || '—' }}) / ({{ game?.Publicrating || '—' }})
                  </td>
                </tr>
                
                <tr v-if="availStagesCount > 0 || availStagesText">
                  <th>Avail Stages</th>
                  <td>
                    <span v-if="availStagesText" class="clickable avail-stages-link" @click="closePopoutModal; $emit('open-stages-dialog')">
                      {{ availStagesText }}
                    </span>
                    <span v-else class="readonly-field">None</span>
                  </td>
                </tr>
                
                <tr v-if="game?.Demo && game.Demo.toLowerCase() === 'yes'"><th>Demo</th><td class="readonly-field">{{ game.Demo }}</td></tr>
                <tr v-if="game?.Contest"><th>Contest</th><td class="readonly-field">{{ game.Contest }}</td></tr>
                <tr v-if="game?.Racelevel"><th>Race Level</th><td class="readonly-field">{{ game.Racelevel }}</td></tr>
                
                <!-- Tags Row -->
                <tr v-if="game?.Tags && (Array.isArray(game.Tags) ? game.Tags.length > 0 : game.Tags)">
                  <th>Tags</th>
                  <td class="readonly-field">
                    <div class="tags-container">
                      <span 
                        v-if="Array.isArray(game.Tags)"
                        class="tags-display"
                        @click="$emit('open-tags-modal')"
                        :title="formatTagsForTooltip(game.Tags)"
                      >
                        {{ formatTagsShort(game.Tags) }}
                      </span>
                      <span 
                        v-else
                        class="tags-display"
                        @click="$emit('open-tags-modal')"
                        :title="game.Tags"
                      >
                        {{ truncateText(game.Tags, 60) }}
                      </span>
                    </div>
                  </td>
                </tr>
                
                <!-- Description Row -->
                <tr v-if="game?.Description">
                  <th>Description</th>
                  <td class="readonly-field">
                    <div class="description-container">
                      <span
                        class="description-display"
                        @click="$emit('open-description-modal')"
                        :title="game.Description"
                      >
                        {{ game.Description }}
                      </span>
                    </div>
                  </td>
                </tr>
                
                <!-- User-Editable Fields -->
                <tr>
                  <th>Status</th>
                  <td>
                    <select :value="game?.Status" @change="$emit('status-changed', ($event.target as HTMLSelectElement).value)">
                      <option value="Default">Default</option>
                      <option value="In Progress">In Progress</option>
                      <option value="Finished">Finished</option>
                    </select>
                  </td>
                </tr>
                
                <!-- Dual Ratings -->
                <tr>
                  <th>My Difficulty</th>
                  <td>
                    <div class="star-rating clickable" @click="handleOpenRatingSheet">
                      <span 
                        v-for="n in 6" 
                        :key="'diff-' + (n-1)"
                        :class="{ filled: (n - 1) <= (game?.MyDifficultyRating ?? -1) }"
                        class="star"
                      >★</span>
                      <button @click.stop="handleClearDifficulty" class="btn-clear-rating">✕</button>
                      <span class="rating-label">{{ difficultyLabel(game?.MyDifficultyRating) }}</span>
                    </div>
                  </td>
                </tr>
                <tr>
                  <th>My Review</th>
                  <td>
                    <div class="star-rating clickable" @click="handleOpenRatingSheet">
                      <span 
                        v-for="n in 6" 
                        :key="'rev-' + (n-1)"
                        :class="{ filled: (n - 1) <= (game?.MyReviewRating ?? -1) }"
                        class="star"
                      >★</span>
                      <button @click.stop="handleClearReview" class="btn-clear-rating">✕</button>
                      <span class="rating-label">{{ reviewLabel(game?.MyReviewRating) }}</span>
                    </div>
                  </td>
                </tr>
                
                <tr>
                  <th>Hidden</th>
                  <td><input type="checkbox" :checked="game?.Hidden" @change="$emit('hidden-changed', ($event.target as HTMLInputElement).checked)" /></td>
                </tr>
                <tr>
                  <th>Exclude from Random</th>
                  <td><input type="checkbox" :checked="game?.ExcludeFromRandom" @change="$emit('exclude-changed', ($event.target as HTMLInputElement).checked)" /></td>
                </tr>
                <tr>
                  <th>My notes</th>
                  <td><textarea :value="game?.Mynotes" rows="6" @input="$emit('notes-changed', ($event.target as HTMLTextAreaElement).value)" @blur="$emit('save-non-rating-fields')"></textarea></td>
                </tr>
                
                <!-- Action Buttons -->
                <tr>
                  <td colspan="2" style="padding-top: 12px;">
                    <div class="detail-actions">
                      <button @click="$emit('set-version-specific-rating')" :disabled="isVersionSpecific">
                        {{ isVersionSpecific ? '✓ Version-Specific' : 'Set Version-Specific Rating' }}
                      </button>
                      <button @click="$emit('view-json-details')">View Details (JSON)</button>
                    </div>
                  </td>
                </tr>
                
                <!-- Community Ratings -->
                <tr v-if="ratingSummaryPanelVisible">
                  <td colspan="2">
                    <div class="ratings-summary-panel">
                      <header class="ratings-summary-header">
                        <h4>Community Ratings (Nostr)</h4>
                        <button
                          class="btn-refresh"
                          :disabled="ratingSummaryState.loading"
                          @click="$emit('refresh-rating-summaries')"
                        >
                          {{ ratingSummaryState.loading ? 'Refreshing…' : 'Refresh' }}
                        </button>
                      </header>
                      
                      <div v-if="ratingSummaryState.loading" class="ratings-summary-loading">
                        Fetching latest aggregated ratings…
                      </div>
                      
                      <div v-else-if="ratingSummaryState.error" class="ratings-summary-error">
                        {{ ratingSummaryState.error }}
                      </div>
                      
                      <div v-else-if="ratingSummaryDisplay" class="ratings-summary-content">
                        <p class="ratings-summary-meta">
                          <strong>{{ ratingSummaryDisplay.totalEvents }}</strong>
                          total rating{{ ratingSummaryDisplay.totalEvents === 1 ? '' : 's' }}
                          <span v-if="ratingSummaryDisplay.updatedAtLabel" class="meta-updated">
                            (updated {{ ratingSummaryDisplay.updatedAtLabel }})
                          </span>
                        </p>
                        
                        <div v-if="ratingSummaryDisplay.tiers.length" class="ratings-summary-tiers">
                          <div class="tier" v-for="tier in ratingSummaryDisplay.tiers" :key="tier.key">
                            <span class="tier-label">{{ tier.label }}</span>
                            <span class="tier-count">{{ tier.count }}</span>
                          </div>
                        </div>
                        
                        <div v-if="ratingSummaryDisplay.hasCategoryData" class="ratings-summary-categories">
                          <div class="category" v-for="category in ratingSummaryDisplay.categories" :key="category.field">
                            <h5>{{ category.label }}</h5>
                            <table class="category-table">
                              <thead>
                                <tr>
                                  <th>Tier</th>
                                  <th>Count</th>
                                  <th>Avg</th>
                                  <th>Median</th>
                                  <th>Std Dev</th>
                                </tr>
                              </thead>
                              <tbody>
                                <tr v-for="tier in category.tiers" :key="tier.key">
                                  <td>{{ tier.label }}</td>
                                  <td>{{ tier.count }}</td>
                                  <td>{{ formatRatingStat(tier.average) }}</td>
                                  <td>{{ formatRatingStat(tier.median) }}</td>
                                  <td>{{ formatRatingStat(tier.stddev) }}</td>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        </div>
                        
                        <p v-else class="ratings-summary-empty">
                          No community ratings (kind 31001) available yet.
                        </p>
                      </div>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
        <footer class="modal-footer">
          <button @click="closePopoutModal" class="btn-secondary">Close</button>
        </footer>
      </div>
    </div>
  </Teleport>
  
  <!-- Screenshot Gallery Modal -->
  <ScreenshotGallery
    :visible="screenshotGalleryVisible"
    :game-id="game?.Id"
    :game-name="game?.Name"
    @close="closeScreenshotGallery"
  />
  
  <!-- Acknowledgment Dialog -->
  <AcknowledgmentDialog
    :visible="acknowledgmentDialogVisible"
    :title="acknowledgmentDialogTitle"
    :game-id="game?.Id || ''"
    :game-name="game?.Name || ''"
    :game-author="game?.Author"
    :warning-text="acknowledgmentDialogWarning"
    :reason="acknowledgmentDialogReason"
    :required-acknowledgments="acknowledgmentDialogRequired"
    :hard-block="acknowledgmentDialogHardBlock"
    @confirm="handleAcknowledgmentConfirm"
    @cancel="handleAcknowledgmentCancel"
  />
  
  <!-- Links Modal -->
  <Teleport to="body">
    <div v-if="linksModalOpen" class="modal-backdrop" @click.self="closeLinksModal" style="z-index: 20001;">
      <div class="modal links-modal">
        <header class="modal-header">
          <h3>Links - {{ game?.Name }}</h3>
          <button @click="closeLinksModal" class="close">✕</button>
        </header>
        <section class="modal-body links-body">
          <div v-if="linksLoading" class="loading">Loading links...</div>
          <div v-else-if="linksError" class="error">{{ linksError }}</div>
          <div v-else-if="!gameLinks || gameLinks.length === 0" class="no-links">No links available for this game.</div>
          <div v-else class="links-content">
            <div class="links-list">
              <div 
                v-for="(link, index) in gameLinks" 
                :key="index" 
                class="link-item"
              >
                <a 
                  @click.prevent="openLink(link.url)" 
                  href="#" 
                  class="link-url"
                  :title="link.url"
                >
                  {{ link.label }}
                </a>
                <span class="link-type">{{ link.type }}</span>
              </div>
            </div>
            
            <div v-if="linksMetadata && Object.keys(linksMetadata).length > 0" class="links-metadata">
              <h4>Metadata</h4>
              <div v-if="linksMetadata.patchedSha1" class="metadata-item">
                <strong>Patched SHA1:</strong> {{ linksMetadata.patchedSha1 }}
              </div>
              <div v-if="linksMetadata.fileName" class="metadata-item">
                <strong>File Name:</strong> {{ linksMetadata.fileName }}
              </div>
              <div v-if="linksMetadata.fileKey" class="metadata-item">
                <strong>File Key:</strong> {{ linksMetadata.fileKey }}
              </div>
              <div v-if="linksMetadata.bpsSha1" class="metadata-item">
                <strong>BPS SHA1:</strong> {{ linksMetadata.bpsSha1 }}
              </div>
            </div>
          </div>
        </section>
        <footer class="modal-footer">
          <button @click="closeLinksModal" class="btn-secondary">Close</button>
        </footer>
      </div>
    </div>
  </Teleport>
  
  <!-- Ban Details Modal -->
  <Teleport to="body">
    <div v-if="banDetailsModalOpen" class="modal-backdrop" @click.self="closeBanDetailsModal" style="z-index: 25000;">
      <div class="modal ban-details-modal">
        <header class="modal-header">
          <h3>Ban Details</h3>
          <button @click="closeBanDetailsModal" class="close">✕</button>
        </header>
        <section class="modal-body ban-details-body">
          <div v-if="banDetailsLoading" class="loading">Loading ban details...</div>
          <div v-else-if="banDetailsError" class="error">{{ banDetailsError }}</div>
          <div v-else-if="banDetailsList.length === 0" class="no-bans">No active bans found for this game.</div>
          <div v-else class="ban-details-content">
            <div v-for="(banDetail, index) in banDetailsList" :key="index" class="ban-entry">
              <div v-if="banDetail.starting_at" class="ban-start-time">
                <strong>Ban of given features for game starts at:</strong> {{ formatTimestamp(banDetail.starting_at) }}
              </div>
              <div v-else class="ban-start-time">
                <strong>Ban of given features for game is active.</strong>
              </div>
              
              <div v-if="banDetail.warningtext" class="ban-warning">
                <strong>Warning:</strong> {{ banDetail.warningtext }}
              </div>
              
              <div v-if="banDetail.reason" class="ban-reason">
                <strong>Reason:</strong> {{ banDetail.reason }}
              </div>
              
              <div v-if="banDetail.required_acknowledgments" class="ban-acknowledgments">
                <strong>Require acknowledgments:</strong>
                <ul class="acknowledgment-list">
                  <li v-for="ack in parseAcknowledgments(banDetail.required_acknowledgments)" :key="ack.name">
                    {{ ack.name }}{{ ack.alwaysRequired ? '*' : '' }} - {{ ack.description }}
                  </li>
                </ul>
              </div>
              
              <div class="ban-matches">
                <strong>Matches</strong>
                <div class="match-details">
                  <div v-for="match in parseMatchPattern(banDetail.match_column, banDetail.match_pattern)" :key="match.key" class="match-item">
                    <div class="match-column"><strong>Column:</strong> {{ match.column }}</div>
                    <div class="match-rule"><strong>Rule:</strong> {{ match.rule }}</div>
                  </div>
                </div>
              </div>
              
              <div class="ban-senses">
                <strong>Sense</strong>
                <ul class="sense-list">
                  <li v-for="sense in parseSenses(banDetail.sense)" :key="sense.key">
                    <strong>{{ sense.name }}:</strong> {{ sense.description }}
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </section>
        <footer class="modal-footer">
          <button @click="closeBanDetailsModal" class="btn-secondary">Close</button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { Teleport } from 'vue';
import ScreenshotGallery from './ScreenshotGallery.vue';
import AcknowledgmentDialog from './AcknowledgmentDialog.vue';

interface Props {
  game: any;
  selectedVersion: number;
  availableVersions: number[];
  latestVersion: number;
  isVersionSpecific: boolean;
  ratingSummaryPanelVisible: boolean;
  ratingSummaryState: any;
  ratingSummaryDisplay: any;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  'version-changed': [version: number];
  'status-changed': [status: string];
  'hidden-changed': [hidden: boolean];
  'exclude-changed': [exclude: boolean];
  'notes-changed': [notes: string];
  'save-non-rating-fields': [];
  'open-rating-sheet': [];
  'clear-difficulty': [];
  'clear-review': [];
  'set-version-specific-rating': [];
  'view-json-details': [];
  'open-tags-modal': [];
  'open-description-modal': [];
  'open-stages-dialog': [];
  'refresh-rating-summaries': [];
  'add-stage-to-run': [];
}>();

// Game stages counting
const stagesCounts = ref({
  P: 0,  // Playable
  R: 0,  // Rando
  G: 0,  // Ghost House
  S: 0,  // Switch Palace
  Ca: 0, // Castle
  Bo: 0, // Boss
  Se: 0, // Secret
});

const availStagesText = computed(() => {
  const parts: string[] = [];
  if (stagesCounts.value.P > 0) parts.push(`P=${stagesCounts.value.P}`);
  if (stagesCounts.value.R > 0) parts.push(`R=${stagesCounts.value.R}`);
  if (stagesCounts.value.G > 0) parts.push(`G=${stagesCounts.value.G}`);
  if (stagesCounts.value.S > 0) parts.push(`S=${stagesCounts.value.S}`);
  if (stagesCounts.value.Ca > 0) parts.push(`Ca=${stagesCounts.value.Ca}`);
  if (stagesCounts.value.Bo > 0) parts.push(`Bo=${stagesCounts.value.Bo}`);
  if (stagesCounts.value.Se > 0) parts.push(`Se=${stagesCounts.value.Se}`);
  return parts.length > 0 ? parts.join(', ') : '';
});

const availStagesCount = computed(() => {
  return stagesCounts.value.P;
});

async function loadGameStages() {
  if (!props.game?.Id) return;
  
  try {
    const api = (window as any)?.electronAPI;
    if (!api?.getGameStages) return;
    
    const result = await api.getGameStages({
      gameid: props.game.Id,
      gameVersion: props.selectedVersion,
    });
    
    if (result?.success && Array.isArray(result.stages)) {
      // Count stages by flags
      stagesCounts.value = {
        P: 0,
        R: 0,
        G: 0,
        S: 0,
        Ca: 0,
        Bo: 0,
        Se: 0,
      };
      
      for (const stage of result.stages) {
        if (stage.playable === 1) stagesCounts.value.P++;
        if (stage.rando === 1) stagesCounts.value.R++;
        if (stage.ghouse === 1) stagesCounts.value.G++;
        if (stage.spalace === 1) stagesCounts.value.S++;
        if (stage.castle === 1) stagesCounts.value.Ca++;
        if (stage.boss === 1) stagesCounts.value.Bo++;
        if (stage.secret === 1) stagesCounts.value.Se++;
      }
    }
  } catch (error) {
    console.error('Error loading game stages:', error);
  }
}

watch(() => props.game?.Id, () => {
  if (props.game?.Id) {
    loadGameStages();
    checkScreenshots();
    checkForBans();
    loadGameLinks();
  }
}, { immediate: true });

watch(() => props.selectedVersion, () => {
  if (props.game?.Id) {
    loadGameStages();
    loadGameLinks();
  }
});

watch(() => props.selectedVersion, () => {
  if (props.game?.Id) {
    loadGameStages();
  }
});

onMounted(() => {
  if (props.game?.Id) {
    loadGameStages();
    checkScreenshots();
    checkForBans();
    loadGameLinks();
  }
});

const popoutModalOpen = ref(false);
const screenshotGalleryVisible = ref(false);
const hasScreenshots = ref(false);

// Links modal state
const linksModalOpen = ref(false);
const gameLinks = ref<any[]>([]);
const linksMetadata = ref<any>({});
const linksLoading = ref(false);
const linksError = ref<string | null>(null);
const hasGameLinks = ref(false);
const mainLink = ref<string | null>(null);

// Acknowledgment dialog state
const acknowledgmentDialogVisible = ref(false);
const acknowledgmentDialogTitle = ref('Content Warning');
const acknowledgmentDialogWarning = ref('');
const acknowledgmentDialogReason = ref('');
const acknowledgmentDialogRequired = ref<string | null>(null);
const acknowledgmentDialogHardBlock = ref(false);
const pendingScreenshotAction = ref<(() => void) | null>(null);

async function checkScreenshots() {
  if (!props.game?.Id) {
    hasScreenshots.value = false;
    return;
  }
  
  try {
    const api = (window as any)?.electronAPI;
    if (!api?.getGameScreenshots) {
      hasScreenshots.value = false;
      return;
    }
    
    const result = await api.getGameScreenshots({
      gameid: String(props.game.Id),
    });
    
    hasScreenshots.value = result?.success && Array.isArray(result.screenshots) && result.screenshots.length > 0;
  } catch (error) {
    console.error('Error checking screenshots:', error);
    hasScreenshots.value = false;
  }
}

function openPopoutModal() {
  popoutModalOpen.value = true;
}

function closePopoutModal() {
  popoutModalOpen.value = false;
}

async function openScreenshotGallery() {
  if (!props.game?.Id) return;
  
  // Check for image_show_soft or image_show_hard bans
  try {
    const api = (window as any)?.electronAPI;
    if (!api?.getBanDetails) {
      // No API available, proceed directly
      screenshotGalleryVisible.value = true;
      return;
    }
    
    const gameidStr = String(props.game.Id);
    const gameData = {
      gameid: gameidStr,
      Id: gameidStr,
      Name: props.game.Name,
      Author: props.game.Author,
      Tags: props.game.Tags,
      Type: props.game.Type
    };
    
    // Check for image_show_hard first (hard ban)
    const hardBanResult = await api.getBanDetails(gameidStr, 'image_show_hard', gameData);
    
    if (hardBanResult.success && hardBanResult.banDetails) {
      // Hard ban - show dialog in hard block mode
      const ban = hardBanResult.banDetails;
      acknowledgmentDialogTitle.value = 'Image Gallery Blocked';
      acknowledgmentDialogWarning.value = ban.warningtext || '';
      acknowledgmentDialogReason.value = ban.reason || '';
      acknowledgmentDialogRequired.value = ban.required_acknowledgments;
      acknowledgmentDialogHardBlock.value = true;
      acknowledgmentDialogVisible.value = true;
      pendingScreenshotAction.value = null; // Don't open gallery for hard ban
      return;
    }
    
    // Check for image_show_soft (soft ban)
    const softBanResult = await api.getBanDetails(gameidStr, 'image_show_soft', gameData);
    
    if (softBanResult.success && softBanResult.banDetails) {
      // Soft ban - show dialog requiring acknowledgment
      const ban = softBanResult.banDetails;
      acknowledgmentDialogTitle.value = 'Content Warning';
      acknowledgmentDialogWarning.value = ban.warningtext || '';
      acknowledgmentDialogReason.value = ban.reason || '';
      acknowledgmentDialogRequired.value = ban.required_acknowledgments;
      acknowledgmentDialogHardBlock.value = false;
      acknowledgmentDialogVisible.value = true;
      pendingScreenshotAction.value = () => {
        screenshotGalleryVisible.value = true;
      };
      return;
    }
    
    // No ban - proceed directly
    screenshotGalleryVisible.value = true;
  } catch (error) {
    console.error('[GameDetailsInspector] Error checking image bans:', error);
    // On error, proceed anyway
    screenshotGalleryVisible.value = true;
  }
}

function closeScreenshotGallery() {
  screenshotGalleryVisible.value = false;
}

function handleAcknowledgmentConfirm() {
  acknowledgmentDialogVisible.value = false;
  
  // Execute pending action if any (for soft bans)
  if (pendingScreenshotAction.value) {
    pendingScreenshotAction.value();
    pendingScreenshotAction.value = null;
  }
}

function handleAcknowledgmentCancel() {
  acknowledgmentDialogVisible.value = false;
  pendingScreenshotAction.value = null;
}

// Ban checking
const banDetailsModalOpen = ref(false);
const hasBans = ref(false);
const banDetailsList = ref<any[]>([]);
const banDetailsLoading = ref(false);
const banDetailsError = ref<string | null>(null);

async function checkForBans() {
  if (!props.game?.Id) {
    hasBans.value = false;
    return;
  }
  
  try {
    const api = (window as any)?.electronAPI;
    if (!api?.isGameBanned) {
      hasBans.value = false;
      return;
    }
    
    const gameidStr = String(props.game.Id);
    const gameData = {
      gameid: gameidStr,
      Id: gameidStr,
      Name: props.game.Name,
      Author: props.game.Author,
      Tags: props.game.Tags,
      Type: props.game.Type
    };
    
    // Check if game has any ban (we'll check a few common senses)
    const checks = await Promise.all([
      api.isGameBanned(gameidStr, '', gameData),
      //api.isGameBanned(gameidStr, 'image_title', gameData),
      //api.isGameBanned(gameidStr, 'list_any', gameData),
      //api.isGameBanned(gameidStr, 'details_hard', gameData)
    ]);
    
    hasBans.value = checks.some(result => result.success && result.isBanned);
  } catch (error) {
    console.warn('[GameDetailsInspector] Error checking bans:', error);
    hasBans.value = false;
  }
}

async function openBanDetailsModal() {
  banDetailsModalOpen.value = true;
  banDetailsLoading.value = true;
  banDetailsError.value = null;
  banDetailsList.value = [];
  
  try {
    const api = (window as any)?.electronAPI;
    if (!api?.getBanDetails) {
      banDetailsError.value = 'Ban details API not available';
      return;
    }
    
    const gameidStr = String(props.game.Id);
    const gameData = {
      gameid: gameidStr,
      Id: gameidStr,
      Name: props.game.Name,
      Author: props.game.Author,
      Tags: props.game.Tags,
      Type: props.game.Type,
      FieldsType: props.game.FieldsType,
      GameType: props.game.GameType,
      CombinedType: props.game.CombinedType,
      LegacyType: props.game.LegacyType
    };
    
    // Get ban details for all possible senses
    const allSenses = [
      'image_title', 'image_preview', 'image_show_soft', 'image_show_hard',
      'run_random_game', 'run_random_stage', 'check_random',
      'run_pick_game', 'run_pick_stage',
      'details_stages_soft', 'details_stages_hard', 'details_soft', 'details_hard',
      'list_title', 'list_any',
      'start_multi', 'start_patchplus', 'start_single'
    ];
    
    const banChecks = await Promise.all(
      allSenses.map(sense => api.getBanDetails(gameidStr, sense, gameData))
    );
    
    // Collect unique bans (by banuuid or by matching all fields)
    const banMap = new Map<string, any>();
    
    for (const result of banChecks) {
      if (result.success && result.banDetails) {
        const ban = result.banDetails;
        const key = ban.banuuid || `${ban.match_column}_${ban.match_pattern}_${ban.sense}`;
        
        if (!banMap.has(key)) {
          banMap.set(key, ban);
        }
      }
    }
    
    banDetailsList.value = Array.from(banMap.values());
  } catch (error) {
    console.error('[GameDetailsInspector] Error loading ban details:', error);
    banDetailsError.value = error instanceof Error ? error.message : 'Unknown error';
  } finally {
    banDetailsLoading.value = false;
  }
}

function closeBanDetailsModal() {
  banDetailsModalOpen.value = false;
}

function formatTimestamp(timestamp: string | null): string {
  if (!timestamp) return 'Immediately';
  try {
    const date = new Date(timestamp);
    return date.toLocaleString();
  } catch {
    return timestamp;
  }
}

function parseAcknowledgments(ackStr: string | null): Array<{name: string, alwaysRequired: boolean, description: string}> {
  if (!ackStr) return [];
  
  const ackMap: Record<string, string> = {
    'Photosensitivity_Triggers': 'Content may contain flashing lights, rapid color changes, or other visual effects that could trigger photosensitive epilepsy or seizures',
    'Mature_Content': 'Content is intended for mature audiences and may contain adult themes',
    'Violence': 'Content contains depictions of violence, combat, or graphic imagery',
    'Suggestive_Content': 'Content contains suggestive themes, innuendo, or mild sexual references',
    'Crude_Content_or_Language': 'Content contains crude humor, profanity, or offensive language',
    'Sexual_Content': 'Content contains sexual themes, imagery, or explicit content',
    'Extreme_Frustration_Warning': 'Game contains trolls or extreme time-consuming or frustrating content even for players of a grandmaster+ skill level',
    'Extreme_Difficulty': 'Contains difficulty extremely higher than expected for its type/rating'
  };
  
  return ackStr.split(',').map(a => a.trim()).filter(a => a).map(ack => {
    const alwaysRequired = ack.endsWith('*');
    const name = alwaysRequired ? ack.slice(0, -1) : ack;
    return {
      name,
      alwaysRequired,
      description: ackMap[name] || 'Content warning'
    };
  });
}

function parseMatchPattern(column: string, pattern: string): Array<{key: string, column: string, rule: string}> {
  if (!pattern) return [];
  
  // Handle comma-separated list
  if (pattern.includes(',') && !pattern.startsWith('exact:') && !pattern.startsWith('substring:') && !pattern.startsWith('regex:')) {
    const items = pattern.split(',').map(p => p.trim());
    return items.map((item, idx) => ({
      key: `${column}_${idx}`,
      column,
      rule: item
    }));
  }
  
  // Handle prefixed patterns
  if (pattern.startsWith('exact:')) {
    return [{
      key: `${column}_exact`,
      column,
      rule: `exact:${pattern.slice(6).trim()}`
    }];
  }
  
  if (pattern.startsWith('substring:')) {
    return [{
      key: `${column}_substring`,
      column,
      rule: `substring:${pattern.slice(10).trim()}`
    }];
  }
  
  if (pattern.startsWith('regex:')) {
    return [{
      key: `${column}_regex`,
      column,
      rule: `regex:${pattern.slice(6).trim()}`
    }];
  }
  
  // Default: exact match
  return [{
    key: `${column}_default`,
    column,
    rule: pattern
  }];
}

function parseSenses(senseStr: string | null): Array<{key: string, name: string, description: string}> {
  if (!senseStr) return [];
  
  const senseMap: Record<string, string> = {
    'image_title': 'Title images are blocked from view',
    'image_preview': 'Block game image content from previews',
    'image_show_soft': 'Block game images without acknowledging warning',
    'image_show_hard': "The game's images or screenshots are blocked from the UI",
    'run_random_game': 'Game will not be chosen for random runs',
    'run_random_stage': 'Game stages will not be used in random runs',
    'check_random': 'Excluded from "check random" feature',
    'run_pick_game': 'Game banned from manual add to a challenge run.',
    'run_pick_stage': 'Game banned from manual stage selection.',
    'details_stages_soft': 'Game stages page locked behind warning.',
    'details_stages_hard': 'Game stages page banned.',
    'details_soft': 'Game details page locked behind warning. If you do not acknowledge: you can only see gameid, name, author, and ban status. The gameid detail and ban attributes will always be accessible, so the game details panel is mostly masked but not completely blocked.',
    'details_hard': 'Game details page limited. Only gameid, name, author, and ban status will display on details page. Full details cannot be displayed and cannot be overridden. The gameid detail and ban attributes will always be accessible, so the game details panel is mostly masked but not completely blocked.',
    'list_title': 'Game title will be suppressed from list and shown as "<Blocked name>"',
    'start_multi': 'Game is banned from Start" or "+Patch" button with multiple games. The game can only be staged individually.',
    'start_patchplus': 'Game is banned from the "+Patch" button. You can only launch the game using Start. The game is excluded from runs that have any global conditions enabled.',
    'start_single': 'Prevents use of the Start button with the game selected at all. This also blocks access to test stages on the matching games\' gameid from the Select Game Stage dialog in view mode.',
    'list_any': 'The game will not show up in the main list view at all'
  };
  
  return senseStr.split(',').map(s => s.trim()).filter(s => s).map((sense, idx) => {
    // Handle wildcards
    if (sense.endsWith('*')) {
      const prefix = sense.slice(0, -1);
      const matchingSenses = Object.keys(senseMap).filter(k => k.startsWith(prefix));
      return matchingSenses.map((matchSense, matchIdx) => ({
        key: `${sense}_${matchIdx}`,
        name: matchSense,
        description: senseMap[matchSense] || 'Banned action'
      }));
    }
    
    return {
      key: `${sense}_${idx}`,
      name: sense,
      description: senseMap[sense] || 'Banned action'
    };
  }).flat();
}

// Watch for game changes to check bans
watch(() => props.game?.Id, () => {
  checkForBans();
}, { immediate: true });

function handleOpenRatingSheet() {
  // Close popout modal if open, so the ratecard modal is visible
  if (popoutModalOpen.value) {
    closePopoutModal();
  }
  // Emit event to open rating sheet
  emit('open-rating-sheet');
}

function handleClearDifficulty() {
  // Close popout modal if open, so the ratecard modal is visible
  if (popoutModalOpen.value) {
    closePopoutModal();
  }
  // Emit event to clear difficulty
  emit('clear-difficulty');
}

function handleClearReview() {
  // Close popout modal if open, so the ratecard modal is visible
  if (popoutModalOpen.value) {
    closePopoutModal();
  }
  // Emit event to clear review
  emit('clear-review');
}

// Helper functions
function formatTagsForTooltip(tags: string[]): string {
  return tags.join(', ');
}

function formatTagsShort(tags: string[]): string {
  if (tags.length <= 3) return tags.join(', ');
  return tags.slice(0, 3).join(', ') + '...';
}

function truncateText(text: string, maxLength: number): string {
  if (!text || text.length <= maxLength) return text;
  return text.substring(0, maxLength);
}

function difficultyLabel(rating: number | null | undefined): string {
  if (rating === null || rating === undefined || rating < 0) return 'Not rated';
  const labels = ['Very Easy', 'Easy', 'Normal', 'Hard', 'Very Hard'];
  return labels[rating] || 'Unknown';
}

function reviewLabel(rating: number | null | undefined): string {
  if (rating === null || rating === undefined || rating < 0) return 'Not rated';
  const labels = ['Not Recommended', 'Below Average', 'Average', 'Good', 'Excellent'];
  return labels[rating] || 'Unknown';
}

function formatRatingStat(value: number | null | undefined): string {
  if (value === null || value === undefined || isNaN(value)) return '—';
  return value.toFixed(2);
}

// Links modal functions
async function loadGameLinks() {
  if (!props.game?.Id) {
    hasGameLinks.value = false;
    mainLink.value = null;
    return;
  }
  
  try {
    const api = (window as any)?.electronAPI;
    if (!api?.getGameLinks) {
      hasGameLinks.value = false;
      mainLink.value = null;
      return;
    }
    
    const result = await api.getGameLinks({
      gameid: String(props.game.Id),
      version: props.selectedVersion
    });
    
    if (result?.success) {
      gameLinks.value = result.links || [];
      linksMetadata.value = result.metadata || {};
      hasGameLinks.value = result.hasLinks || false;
      
      // Find main link (first link with type 'main' or first link if no main)
      const mainLinkItem = gameLinks.value.find(l => l.type === 'main') || gameLinks.value[0];
      mainLink.value = mainLinkItem?.url || null;
    } else {
      hasGameLinks.value = false;
      mainLink.value = null;
    }
  } catch (error) {
    console.error('Error loading game links:', error);
    hasGameLinks.value = false;
    mainLink.value = null;
  }
}

function openLinksModal() {
  linksModalOpen.value = true;
  linksLoading.value = false;
  linksError.value = null;
  
  // Reload links when opening modal
  if (props.game?.Id) {
    loadGameLinks();
  }
}

function closeLinksModal() {
  linksModalOpen.value = false;
}

async function openLink(url: string) {
  if (!url) return;
  
  try {
    const api = (window as any)?.electronAPI;
    if (!api?.shell?.openExternal) {
      console.warn('openExternal API not available');
      return;
    }
    
    await api.shell.openExternal(url);
  } catch (error) {
    console.error('Error opening link:', error);
  }
}

async function openMainLink() {
  if (mainLink.value) {
    await openLink(mainLink.value);
  }
}
</script>

<style scoped>
.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.header-actions {
  display: flex;
  gap: 4px;
  align-items: center;
}

.popout-icon,
.globe-icon {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 16px;
  padding: 4px 8px;
  opacity: 0.7;
  transition: opacity 0.2s;
}

.popout-icon:hover,
.globe-icon:hover {
  opacity: 1;
}

.clickable-name {
  cursor: pointer;
  color: var(--accent-primary, #4CAF50);
  text-decoration: underline;
  transition: color 0.2s;
}

.clickable-name:hover {
  color: var(--accent-hover, #45a049);
}

.avail-stages-link {
  color: var(--accent-primary, #4CAF50);
  cursor: pointer;
  text-decoration: underline;
}

.avail-stages-link:hover {
  color: var(--accent-hover, #45a049);
}

/* Ban details link styling */
.ban-details-link {
  color: #ff6b6b;
  font-weight: 700;
  text-decoration: underline;
  cursor: pointer;
  background-color: rgba(0, 0, 0, 0.7);
  padding: 2px 6px;
  border-radius: 3px;
  transition: color 0.2s, background-color 0.2s;
}

.ban-details-link:hover {
  color: #ff9999;
  background-color: rgba(0, 0, 0, 0.9);
}

/* Ban details modal */
.ban-details-modal {
  max-width: 90vw;
  width: 800px;
  max-height: 90vh;
}

.ban-details-body {
  max-height: calc(90vh - 120px);
  overflow-y: auto;
  padding: 20px;
}

.ban-details-content {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.ban-entry {
  border: 1px solid var(--border-primary, #ccc);
  border-radius: 6px;
  padding: 16px;
  background: var(--bg-secondary, #f9f9f9);
}

.ban-start-time,
.ban-warning,
.ban-reason {
  margin-bottom: 12px;
  line-height: 1.6;
}

.ban-acknowledgments {
  margin-bottom: 12px;
}

.acknowledgment-list {
  margin: 8px 0 0 20px;
  padding: 0;
  list-style-type: disc;
}

.acknowledgment-list li {
  margin-bottom: 6px;
  line-height: 1.5;
}

.ban-matches {
  margin-bottom: 12px;
}

.match-details {
  margin-top: 8px;
  margin-left: 20px;
}

.match-item {
  margin-bottom: 8px;
  padding: 8px;
  background: var(--bg-primary, #fff);
  border: 1px solid var(--border-secondary, #e0e0e0);
  border-radius: 4px;
}

.match-column,
.match-rule {
  margin-bottom: 4px;
}

.ban-senses {
  margin-bottom: 12px;
}

.sense-list {
  margin: 8px 0 0 20px;
  padding: 0;
  list-style-type: disc;
}

.sense-list li {
  margin-bottom: 8px;
  line-height: 1.6;
}

.loading,
.error,
.no-bans {
  padding: 20px;
  text-align: center;
}

.error {
  color: #d32f2f;
}

.stages-actions {
  padding: 12px;
}

.btn-add-stage {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  background-color: var(--accent-primary, #4CAF50);
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: var(--base-font-size);
  transition: background-color 0.2s;
}

.btn-add-stage:hover {
  background-color: var(--accent-hover, #45a049);
}

.add-icon {
  font-size: 18px;
  font-weight: bold;
  line-height: 1;
}

.details-popout-modal {
  max-width: 95vw;
  width: 1400px;
  max-height: 95vh;
}

.details-popout-modal .modal-body {
  max-height: calc(95vh - 120px);
  overflow-y: auto;
  padding: 20px;
}

.details-expanded {
  font-size: var(--medium-font-size, 14px);
}

.details-expanded .kv-table {
  width: 100%;
}

.details-expanded .kv-table th {
  width: 200px;
  padding: 12px;
  font-weight: 600;
}

.details-expanded .kv-table td {
  padding: 12px;
}

/* Inherit styles from App.vue - these will need to be scoped properly */
.clickable {
  cursor: pointer;
}

.screenshot-icon-btn {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 16px;
  padding: 4px 8px;
  margin-left: 8px;
  opacity: 0.7;
  transition: opacity 0.2s, transform 0.2s;
  vertical-align: middle;
}

.screenshot-icon-btn:hover {
  opacity: 1;
  transform: scale(1.1);
}

/* Links Modal */
.links-modal {
  max-width: 90vw;
  width: 600px;
  max-height: 90vh;
}

.links-body {
  max-height: calc(90vh - 120px);
  overflow-y: auto;
  padding: 20px;
}

.links-content {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.links-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.link-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px;
  border: 1px solid var(--border-primary, #ccc);
  border-radius: 4px;
  background: var(--bg-secondary, #f9f9f9);
  transition: background-color 0.2s;
}

.link-item:hover {
  background: var(--bg-hover, #f0f0f0);
}

.link-url {
  flex: 1;
  color: var(--accent-primary, #4CAF50);
  text-decoration: none;
  font-weight: 500;
  cursor: pointer;
  transition: color 0.2s;
}

.link-url:hover {
  color: var(--accent-hover, #45a049);
  text-decoration: underline;
}

.link-type {
  font-size: 12px;
  color: var(--text-secondary, #666);
  padding: 4px 8px;
  background: var(--bg-primary, #fff);
  border-radius: 3px;
  border: 1px solid var(--border-secondary, #e0e0e0);
}

.links-metadata {
  margin-top: 20px;
  padding-top: 20px;
  border-top: 1px solid var(--border-primary, #ccc);
}

.links-metadata h4 {
  margin: 0 0 12px 0;
  font-size: 16px;
  font-weight: 600;
}

.metadata-item {
  margin-bottom: 8px;
  padding: 8px;
  background: var(--bg-secondary, #f9f9f9);
  border-radius: 4px;
  font-size: 14px;
  line-height: 1.5;
}

.metadata-item strong {
  display: inline-block;
  min-width: 120px;
  color: var(--text-primary, #333);
}

.loading,
.error,
.no-links {
  padding: 20px;
  text-align: center;
}

.error {
  color: #d32f2f;
}
</style>

