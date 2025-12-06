<template>
  <div class="panel" v-if="game">
    <div class="panel-header">
      <h3>Details</h3>
      <button @click="openPopoutModal" class="popout-icon" title="Pop out details">🔍</button>
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
          <tr><th>Name</th><td class="readonly-field">{{ game.Name }}</td></tr>
          <tr><th>Type</th><td class="readonly-field">{{ game.Type }}</td></tr>
          <tr v-if="game.LegacyType"><th>Legacy Type</th><td class="readonly-field">{{ game.LegacyType }}</td></tr>
          <tr><th>Author</th><td class="readonly-field">{{ game.Author }}</td></tr>
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
                <tr><th>Name</th><td class="readonly-field">{{ game?.Name }}</td></tr>
                <tr><th>Type</th><td class="readonly-field">{{ game?.Type }}</td></tr>
                <tr v-if="game?.LegacyType"><th>Legacy Type</th><td class="readonly-field">{{ game.LegacyType }}</td></tr>
                <tr><th>Author</th><td class="readonly-field">{{ game?.Author }}</td></tr>
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
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { Teleport } from 'vue';
import ScreenshotGallery from './ScreenshotGallery.vue';

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
  }
}, { immediate: true });

watch(() => props.selectedVersion, () => {
  if (props.game?.Id) {
    loadGameStages();
  }
});

onMounted(() => {
  if (props.game?.Id) {
    loadGameStages();
    checkScreenshots();
  }
});

const popoutModalOpen = ref(false);
const screenshotGalleryVisible = ref(false);
const hasScreenshots = ref(false);

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

function openScreenshotGallery() {
  screenshotGalleryVisible.value = true;
}

function closeScreenshotGallery() {
  screenshotGalleryVisible.value = false;
}

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
</script>

<style scoped>
.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.popout-icon {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 16px;
  padding: 4px 8px;
  opacity: 0.7;
  transition: opacity 0.2s;
}

.popout-icon:hover {
  opacity: 1;
}

.avail-stages-link {
  color: var(--accent-primary, #4CAF50);
  cursor: pointer;
  text-decoration: underline;
}

.avail-stages-link:hover {
  color: var(--accent-hover, #45a049);
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
</style>

