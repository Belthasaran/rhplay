<template>
  <div v-if="visible" class="modal-backdrop" @click.self="$emit('close')">
    <div class="modal maps-reference-modal large-modal">
      <header class="modal-header">
        <h3>Maps Reference</h3>
        <button class="close" @click="$emit('close')">✕</button>
      </header>

      <section class="modal-body">
        <div v-if="loading" class="loading-message">Loading maps...</div>
        <div v-else-if="error" class="inline-status error">
          {{ error }}
          <button @click="loadMaps" class="btn-secondary btn-small" style="margin-top: 8px;">Retry</button>
        </div>
        <template v-else>
          <div class="tab-navigation">
            <button
              v-for="tab in tabs"
              :key="tab.id"
              :class="['tab-button', { active: activeTab === tab.id }]"
              @click="activeTab = tab.id"
            >
              {{ tab.label }}
            </button>
          </div>

          <div class="maps-filter-row">
            <input
              v-model="filterText"
              type="text"
              placeholder="Filter by address, size, type, context, or description..."
              class="filter-input"
            />
            <button @click="filterText = ''" :disabled="!filterText.trim()" class="btn-clear-filter">Clear Filter</button>
          </div>

          <div v-if="filteredRows.length === 0" class="empty-message">
            {{ currentData.length === 0 ? 'No entries in this map.' : 'No entries match your filter.' }}
          </div>
          <div v-else class="maps-table-wrapper">
            <table class="data-table maps-table">
              <thead>
                <tr>
                  <th>Address</th>
                  <th>Size</th>
                  <th>Type</th>
                  <th>Context</th>
                  <th>Details</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, idx) in filteredRows" :key="row.address + '-' + idx">
                  <td class="mono">{{ row.address || '—' }}</td>
                  <td>{{ row.size ?? '—' }}</td>
                  <td>{{ row.type ?? '—' }}</td>
                  <td>{{ row.context ?? '—' }}</td>
                  <td class="details-cell">
                    <template v-if="row.details && typeof row.details === 'object'">
                      <button
                        v-for="(label, key) in row.details"
                        :key="key"
                        class="btn-link-small"
                        @click="openDetailPopup(key, label)"
                      >
                        {{ label }}
                      </button>
                    </template>
                    <span v-else>—</span>
                  </td>
                  <td class="description-cell" v-html="row.description || '—'"></td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>
      </section>

      <footer class="modal-footer">
        <button @click="$emit('close')" class="btn-secondary">Close</button>
      </footer>
    </div>

    <!-- Detail Popup -->
    <div v-if="detailPopupKey" class="detail-popup-backdrop" @click="detailPopupKey = null">
      <div class="detail-popup" @click.stop>
        <div class="detail-popup-header">
          <h4>{{ detailPopupLabel }}</h4>
          <button class="close-small" @click="detailPopupKey = null">✕</button>
        </div>
        <div class="detail-popup-body" v-html="detailPopupContent"></div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';

const props = defineProps<{
  visible: boolean;
}>();

defineEmits<{
  close: [];
}>();

const TABS = [
  { id: 'ram', label: 'RAM Map', key: 'smwrammap' },
  { id: 'rom', label: 'ROM Map', key: 'smwrommap' },
  { id: 'regs', label: 'Registers', key: 'smwregs' },
  { id: 'sram', label: 'SRAM', key: 'smwsram' },
  { id: 'hijacks', label: 'SMWhijacks', key: 'smwhijacks' },
];

const tabs = TABS;
const activeTab = ref('ram');
const loading = ref(false);
const error = ref<string | null>(null);
const filterText = ref('');
const mapsData = ref<Record<string, any>>({});
const detailPopupKey = ref<string | null>(null);
const detailPopupLabel = ref('');

const currentData = computed(() => {
  const tab = TABS.find((t) => t.id === activeTab.value);
  if (!tab) return [];
  const arr = mapsData.value[tab.key];
  return Array.isArray(arr) ? arr : [];
});

const filteredRows = computed(() => {
  const q = filterText.value.trim().toLowerCase();
  if (!q) return currentData.value;
  return currentData.value.filter((row) => {
    const addr = (row.address ?? '').toString().toLowerCase();
    const size = (row.size ?? '').toString().toLowerCase();
    const type = (row.type ?? '').toString().toLowerCase();
    const ctx = (row.context ?? '').toString().toLowerCase();
    const desc = stripHtml((row.description ?? '').toString()).toLowerCase();
    return addr.includes(q) || size.includes(q) || type.includes(q) || ctx.includes(q) || desc.includes(q);
  });
});

const detailPopupContent = computed(() => {
  const key = detailPopupKey.value;
  if (!key) return '';
  const tables = mapsData.value.smwtables;
  if (!tables || typeof tables !== 'object') return '';
  const val = tables[key];
  if (val === undefined || val === null) return '(Not found)';
  if (typeof val === 'string') return val;
  if (Array.isArray(val)) return arrayToHtmlTable(val);
  return String(val);
});

function stripHtml(html: string): string {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div.textContent || div.innerText || '';
}

function arrayToHtmlTable(rows: any[][]): string {
  if (!rows.length) return '';
  const header = rows[0];
  let html = '<table class="table"><thead><tr>';
  for (const h of header) {
    html += `<th>${escapeHtml(String(h ?? ''))}</th>`;
  }
  html += '</tr></thead><tbody>';
  for (let i = 1; i < rows.length; i++) {
    html += '<tr>';
    for (const cell of rows[i]) {
      html += `<td>${escapeHtml(String(cell ?? ''))}</td>`;
    }
    html += '</tr>';
  }
  html += '</tbody></table>';
  return html;
}

function escapeHtml(s: string): string {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function openDetailPopup(key: string, label: string) {
  detailPopupKey.value = key;
  detailPopupLabel.value = label;
}

async function loadMaps() {
  loading.value = true;
  error.value = null;
  try {
    const api = (window as any)?.electronAPI;
    if (!api?.smwcmapsEnsure) {
      error.value = 'Maps Reference is not available.';
      return;
    }
    const result = await api.smwcmapsEnsure();
    if (result?.success && result.files) {
      mapsData.value = result.files;
    } else {
      error.value = result?.error || 'Failed to load maps.';
    }
  } catch (e: any) {
    error.value = e?.message || 'Failed to load maps.';
  } finally {
    loading.value = false;
  }
}

watch(
  () => props.visible,
  (v) => {
    if (v) {
      loadMaps();
      filterText.value = '';
      detailPopupKey.value = null;
    }
  }
);
</script>

<style scoped>
.maps-reference-modal {
  max-width: 1200px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
}

.tab-navigation {
  display: flex;
  border-bottom: 1px solid var(--border-primary);
  background: var(--bg-secondary);
  flex-wrap: wrap;
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

.maps-filter-row {
  display: flex;
  gap: 8px;
  margin: 12px 0;
}

.filter-input {
  flex: 1;
  padding: var(--input-padding);
  border: 1px solid var(--border-primary);
  border-radius: 4px;
  font-size: var(--base-font-size);
  background: var(--bg-primary);
  color: var(--text-primary);
}

.filter-input:focus {
  outline: none;
  border-color: var(--accent-primary);
}

.btn-clear-filter {
  padding: var(--button-padding);
  white-space: nowrap;
}

.maps-table-wrapper {
  max-height: 500px;
  overflow: auto;
  flex: 1;
}

.maps-table {
  width: 100%;
  border-collapse: collapse;
}

.maps-table th,
.maps-table td {
  padding: 8px 10px;
  text-align: left;
  border-bottom: 1px solid var(--border-primary);
}

.maps-table th {
  background: var(--bg-secondary);
  font-weight: 600;
}

.maps-table .mono {
  font-family: monospace;
  font-size: 0.9rem;
}

.maps-table .details-cell {
  white-space: nowrap;
}

.maps-table .details-cell .btn-link-small {
  margin-right: 8px;
}

.maps-table .description-cell {
  max-width: 400px;
  font-size: 0.9rem;
  line-height: 1.4;
}

.loading-message,
.empty-message {
  padding: 40px;
  text-align: center;
  color: var(--text-secondary);
}

.inline-status.error {
  color: var(--error-color);
}

.detail-popup-backdrop {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 3000;
  display: flex;
  align-items: center;
  justify-content: center;
}

.detail-popup {
  background: var(--modal-bg);
  border-radius: 8px;
  max-width: 600px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
}

.detail-popup-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-primary);
}

.detail-popup-header h4 {
  margin: 0;
}

.close-small {
  background: none;
  border: none;
  font-size: 1.2rem;
  cursor: pointer;
  color: var(--text-secondary);
}

.detail-popup-body {
  padding: 16px;
  overflow: auto;
  font-size: 0.9rem;
}

.detail-popup-body :deep(table) {
  border-collapse: collapse;
  width: 100%;
}

.detail-popup-body :deep(th),
.detail-popup-body :deep(td) {
  padding: 6px 10px;
  text-align: left;
  border: 1px solid var(--border-primary);
}

.detail-popup-body :deep(th) {
  background: var(--bg-secondary);
}
</style>
