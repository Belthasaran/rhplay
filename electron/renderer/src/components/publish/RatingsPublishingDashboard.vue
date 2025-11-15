<template>
  <div class="ratings-publishing-dashboard">
    <div class="dashboard-header">
      <h4>Ratings Publishing</h4>
      <div class="header-actions">
        <button class="btn-secondary" @click="refreshRatings" :disabled="loading">
          {{ loading ? 'Refreshing...' : 'Refresh' }}
        </button>
        <button 
          class="btn-primary" 
          @click="publishSelected" 
          :disabled="loading || selectedRatings.length === 0"
        >
          Publish Selected ({{ selectedRatings.length }})
        </button>
        <button 
          class="btn-secondary" 
          @click="publishAll" 
          :disabled="loading || unpublishedRatings.length === 0"
        >
          Publish All ({{ unpublishedRatings.length }})
        </button>
      </div>
    </div>

    <!-- Statistics -->
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-label">Total Ratings</div>
        <div class="stat-value">{{ totalRatings }}</div>
      </div>
      <div class="stat-card published">
        <div class="stat-label">Published</div>
        <div class="stat-value">{{ publishedCount }}</div>
      </div>
      <div class="stat-card unpublished">
        <div class="stat-label">Unpublished</div>
        <div class="stat-value">{{ unpublishedRatings.length }}</div>
      </div>
      <div class="stat-card pending">
        <div class="stat-label">Pending</div>
        <div class="stat-value">{{ pendingCount }}</div>
      </div>
    </div>

    <!-- Filters -->
    <div class="filters-section">
      <div class="filter-group">
        <label>
          <input
            v-model="filters.showOnlyUnpublished"
            type="checkbox"
          />
          Show Only Unpublished
        </label>
        <label>
          <input
            v-model="filters.showOnlyPublished"
            type="checkbox"
          />
          Show Only Published
        </label>
      </div>
      <div class="filter-group">
        <input
          v-model.trim="filters.search"
          type="text"
          placeholder="Search by game name..."
          class="search-input"
        />
      </div>
    </div>

    <!-- Ratings List -->
    <div class="ratings-list-container">
      <div v-if="loading && filteredRatings.length === 0" class="loading-message">
        Loading ratings...
      </div>

      <div v-else-if="filteredRatings.length === 0" class="empty-message">
        No ratings found
      </div>

      <div v-else class="ratings-table-container">
        <table class="ratings-table">
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  :checked="allSelected"
                  @change="toggleSelectAll"
                />
              </th>
              <th>Game Name</th>
              <th>Game ID</th>
              <th>Difficulty</th>
              <th>Review</th>
              <th>Status</th>
              <th>Last Published</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="rating in filteredRatings"
              :key="rating.gameid"
              class="rating-row"
              :class="{ 'selected': selectedRatings.includes(rating.gameid) }"
            >
              <td>
                <input
                  type="checkbox"
                  :checked="selectedRatings.includes(rating.gameid)"
                  @change="toggleSelect(rating.gameid)"
                />
              </td>
              <td>
                <div class="game-name">{{ rating.gameName || 'Unknown' }}</div>
              </td>
              <td>
                <code class="mono">{{ rating.gameid }}</code>
              </td>
              <td>
                <div v-if="rating.user_difficulty_rating !== null && rating.user_difficulty_rating !== undefined" class="rating-stars">
                  <span
                    v-for="n in 6"
                    :key="n"
                    :class="['star', { 'filled': (n - 1) <= rating.user_difficulty_rating }]"
                  >★</span>
                </div>
                <span v-else class="no-rating">-</span>
              </td>
              <td>
                <div v-if="rating.user_review_rating !== null && rating.user_review_rating !== undefined" class="rating-stars">
                  <span
                    v-for="n in 6"
                    :key="n"
                    :class="['star', { 'filled': (n - 1) <= rating.user_review_rating }]"
                  >★</span>
                </div>
                <span v-else class="no-rating">-</span>
              </td>
              <td>
                <span :class="['publish-status', `status-${getPublishStatus(rating)}`]">
                  {{ getPublishStatusLabel(rating) }}
                </span>
              </td>
              <td>
                <div v-if="rating.lastPublished" class="timestamp">
                  {{ formatTimestamp(rating.lastPublished) }}
                </div>
                <span v-else class="no-timestamp">Never</span>
              </td>
              <td>
                <div class="action-buttons">
                  <button
                    v-if="getPublishStatus(rating) !== 'published'"
                    class="btn-action btn-publish"
                    @click="publishRating(rating)"
                    :disabled="loading"
                  >
                    Publish
                  </button>
                  <button
                    v-if="getPublishStatus(rating) === 'published'"
                    class="btn-action btn-update"
                    @click="publishRating(rating)"
                    :disabled="loading"
                  >
                    Update
                  </button>
                  <button
                    class="btn-action btn-view"
                    @click="viewRatingDetails(rating)"
                  >
                    Details
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';

type Rating = {
  gameid: string;
  gameName?: string;
  user_difficulty_rating?: number | null;
  user_review_rating?: number | null;
  user_skill_rating?: number | null;
  status?: string;
  lastPublished?: number;
  queueStatus?: string;
  eventId?: string;
};

const props = defineProps<{
  ratings?: Rating[];
  loading?: boolean;
}>();

// emit is defined later as a single const emit = defineEmits<...>()

const loading = ref(props.loading || false);
const ratings = ref<Rating[]>(props.ratings || []);
const selectedRatings = ref<string[]>([]);
const filters = ref({
  showOnlyUnpublished: false,
  showOnlyPublished: false,
  search: ''
});

const totalRatings = computed(() => ratings.value.length);
const publishedCount = computed(() => ratings.value.filter(r => getPublishStatus(r) === 'published').length);
const pendingCount = computed(() => ratings.value.filter(r => getPublishStatus(r) === 'pending' || getPublishStatus(r) === 'processing').length);

const unpublishedRatings = computed(() => {
  return ratings.value.filter(r => {
    const status = getPublishStatus(r);
    return status !== 'published' && status !== 'pending' && status !== 'processing';
  });
});

const filteredRatings = computed(() => {
  let filtered = [...ratings.value];
  
  if (filters.value.showOnlyUnpublished) {
    filtered = filtered.filter(r => {
      const status = getPublishStatus(r);
      return status !== 'published';
    });
  }
  
  if (filters.value.showOnlyPublished) {
    filtered = filtered.filter(r => getPublishStatus(r) === 'published');
  }
  
  if (filters.value.search) {
    const search = filters.value.search.toLowerCase();
    filtered = filtered.filter(r => 
      (r.gameName || '').toLowerCase().includes(search) ||
      (r.gameid || '').toLowerCase().includes(search)
    );
  }
  
  return filtered;
});

const allSelected = computed(() => {
  return filteredRatings.value.length > 0 && 
         filteredRatings.value.every(r => selectedRatings.value.includes(r.gameid));
});

function getPublishStatus(rating: Rating): string {
  if (rating.queueStatus === 'completed' || rating.lastPublished) {
    return 'published';
  }
  if (rating.queueStatus === 'pending' || rating.queueStatus === 'processing') {
    return rating.queueStatus;
  }
  return 'unpublished';
}

function getPublishStatusLabel(rating: Rating): string {
  const status = getPublishStatus(rating);
  const labels: Record<string, string> = {
    'published': 'Published',
    'pending': 'Pending',
    'processing': 'Processing',
    'unpublished': 'Unpublished'
  };
  return labels[status] || 'Unknown';
}

function toggleSelect(gameid: string) {
  const index = selectedRatings.value.indexOf(gameid);
  if (index >= 0) {
    selectedRatings.value.splice(index, 1);
  } else {
    selectedRatings.value.push(gameid);
  }
}

function toggleSelectAll() {
  if (allSelected.value) {
    selectedRatings.value = selectedRatings.value.filter(
      id => !filteredRatings.value.some(r => r.gameid === id)
    );
  } else {
    filteredRatings.value.forEach(r => {
      if (!selectedRatings.value.includes(r.gameid)) {
        selectedRatings.value.push(r.gameid);
      }
    });
  }
}

async function publishRating(rating: Rating) {
  loading.value = true;
  try {
    emit('publish-rating', rating);
  } finally {
    loading.value = false;
  }
}

async function publishSelected() {
  if (selectedRatings.value.length === 0) return;
  loading.value = true;
  try {
    emit('publish-selected', [...selectedRatings.value]);
  } finally {
    loading.value = false;
  }
}

async function publishAll() {
  if (unpublishedRatings.value.length === 0) return;
  loading.value = true;
  try {
    emit('publish-all');
  } finally {
    loading.value = false;
  }
}

function viewRatingDetails(rating: Rating) {
  emit('view-details', rating);
}

async function refreshRatings() {
  loading.value = true;
  try {
    const api = (window as any)?.electronAPI;
    if (!api) return;

    const result = await api.getRatingsForPublishing();
    if (result?.success) {
      ratings.value = result.ratings || [];
    }
  } catch (error) {
    console.error('Failed to refresh ratings:', error);
  } finally {
    loading.value = false;
  }
}

function formatTimestamp(timestamp: number | undefined): string {
  if (!timestamp) return '';
  const date = new Date(timestamp * 1000);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  if (seconds > 0) return `${seconds}s ago`;
  return 'Just now';
}

const emit = defineEmits<{
  'publish-rating': [rating: Rating];
  'publish-selected': [gameIds: string[]];
  'publish-all': [];
  'view-details': [rating: Rating];
}>();

onMounted(() => {
  // Component mounted
});
</script>

<style scoped>
.ratings-publishing-dashboard {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.dashboard-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.dashboard-header h4 {
  margin: 0;
}

.header-actions {
  display: flex;
  gap: 8px;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 12px;
}

.stat-card {
  padding: 16px;
  background: var(--bg-secondary, #f5f5f5);
  border-radius: 4px;
  border: 1px solid var(--border-color, #ddd);
  text-align: center;
}

.stat-card.published {
  border-color: #2e7d32;
  background: #e8f5e9;
}

.stat-card.unpublished {
  border-color: #f57c00;
  background: #fff3e0;
}

.stat-card.pending {
  border-color: #1976d2;
  background: #e3f2fd;
}

.stat-label {
  font-size: 12px;
  color: var(--text-secondary, #666);
  margin-bottom: 8px;
}

.stat-value {
  font-size: 24px;
  font-weight: 600;
  color: var(--text-primary, #000);
}

.filters-section {
  padding: 12px;
  background: var(--bg-secondary, #f5f5f5);
  border-radius: 4px;
  border: 1px solid var(--border-color, #ddd);
  display: flex;
  gap: 16px;
  align-items: center;
  flex-wrap: wrap;
}

.filter-group {
  display: flex;
  gap: 12px;
  align-items: center;
}

.filter-group label {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  cursor: pointer;
}

.search-input {
  padding: 6px 10px;
  border: 1px solid var(--border-color, #ddd);
  border-radius: 4px;
  font-size: 13px;
  min-width: 200px;
}

.ratings-list-container {
  display: flex;
  flex-direction: column;
}

.loading-message,
.empty-message {
  padding: 24px;
  text-align: center;
  color: var(--text-secondary, #666);
}

.ratings-table-container {
  overflow-x: auto;
  border: 1px solid var(--border-color, #ddd);
  border-radius: 4px;
}

.ratings-table {
  width: 100%;
  border-collapse: collapse;
  background: white;
}

.ratings-table thead {
  background: var(--bg-secondary, #f5f5f5);
}

.ratings-table th {
  padding: 12px;
  text-align: left;
  font-weight: 600;
  font-size: 12px;
  color: var(--text-secondary, #666);
  border-bottom: 2px solid var(--border-color, #ddd);
}

.ratings-table td {
  padding: 12px;
  border-bottom: 1px solid var(--border-color, #ddd);
  font-size: 13px;
}

.rating-row:hover {
  background: var(--bg-secondary, #f5f5f5);
}

.rating-row.selected {
  background: #e3f2fd;
}

.game-name {
  font-weight: 500;
}

.mono {
  font-family: monospace;
  font-size: 11px;
  background: var(--bg-secondary, #f5f5f5);
  padding: 2px 6px;
  border-radius: 3px;
}

.rating-stars {
  display: inline-flex;
  gap: 2px;
}

.rating-stars .star {
  color: #ddd;
  font-size: 14px;
}

.rating-stars .star.filled {
  color: #f57c00;
}

.no-rating {
  color: var(--text-secondary, #666);
  font-style: italic;
}

.publish-status {
  padding: 4px 8px;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 600;
}

.publish-status.status-published {
  background: #e8f5e9;
  color: #2e7d32;
}

.publish-status.status-pending {
  background: #fff3e0;
  color: #f57c00;
}

.publish-status.status-processing {
  background: #e3f2fd;
  color: #1976d2;
}

.publish-status.status-unpublished {
  background: #f5f5f5;
  color: #757575;
}

.timestamp {
  font-size: 12px;
  color: var(--text-primary, #000);
}

.no-timestamp {
  color: var(--text-secondary, #666);
  font-style: italic;
}

.action-buttons {
  display: flex;
  gap: 4px;
}

.btn-action {
  padding: 4px 8px;
  border-radius: 3px;
  border: 1px solid var(--border-color, #ddd);
  background: var(--bg-primary, white);
  cursor: pointer;
  font-size: 11px;
  white-space: nowrap;
}

.btn-action:hover:not(:disabled) {
  opacity: 0.9;
}

.btn-action:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-publish {
  color: #2e7d32;
  border-color: #2e7d32;
}

.btn-update {
  color: #1976d2;
  border-color: #1976d2;
}

.btn-view {
  color: #757575;
  border-color: #757575;
}

.btn-primary,
.btn-secondary {
  padding: 8px 16px;
  border-radius: 4px;
  border: 1px solid var(--border-color, #ddd);
  cursor: pointer;
  font-size: 13px;
}

.btn-primary {
  background: var(--color-primary, #1976d2);
  color: white;
  border-color: var(--color-primary, #1976d2);
}

.btn-secondary {
  background: var(--bg-primary, white);
}

.btn-primary:hover:not(:disabled),
.btn-secondary:hover:not(:disabled) {
  opacity: 0.9;
}

.btn-primary:disabled,
.btn-secondary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>

