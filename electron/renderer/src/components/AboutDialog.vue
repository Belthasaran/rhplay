<template>
  <div v-if="visible" class="modal-backdrop" @click.self="handleClose">
    <div class="modal about-dialog">
      <header class="modal-header">
        <h3>About RHTools</h3>
        <button class="close" @click="handleClose">✕</button>
      </header>
      <section class="modal-body">
        <div v-if="loading" class="about-loading">Loading...</div>
        <div v-else-if="error" class="about-error">{{ error }}</div>
        <div v-else class="about-content">
          <!-- Program version -->
          <div class="about-section">
            <h4>Program Version</h4>
            <div class="about-row">
              <span class="about-label">Current:</span>
              <span class="about-value">{{ info.currentVersion || '—' }}</span>
            </div>
            <div class="about-row">
              <span class="about-label">Available:</span>
              <span class="about-value">{{ info.availableVersion || '—' }}</span>
            </div>
            <div class="about-actions">
              <button @click="$emit('check-updates')" class="btn-primary-small">
                Check for Updates
              </button>
            </div>
          </div>

          <!-- Core manifest -->
          <div class="about-section">
            <h4>Currently in Use: Coremanifest</h4>
            <div class="about-row" v-if="info.coremanifest">
              <span class="about-label">versionid:</span>
              <span class="about-value">{{ info.coremanifest.versionid ?? '—' }}</span>
            </div>
            <div class="about-row" v-if="info.coremanifest">
              <span class="about-label">lastupdated:</span>
              <span class="about-value">{{ info.coremanifest.lastupdated ?? '—' }} ({{ info.coremanifest.lastupdatedHuman || '—' }})</span>
            </div>
            <div class="about-row" v-if="info.coremanifest">
              <span class="about-label">version_string:</span>
              <span class="about-value">{{ info.coremanifest.version_string ?? '—' }}</span>
            </div>
            <div class="about-row" v-if="info.coremanifest?.coremanifestDatSha256">
              <span class="about-label">coremanifest.dat SHA256:</span>
              <span class="about-value about-monospace">{{ info.coremanifest.coremanifestDatSha256 }}</span>
            </div>
            <div class="about-row" v-if="info.channelPlatformKey">
              <span class="about-label">Channel & Platform:</span>
              <span class="about-value">{{ info.channelPlatformKey }}</span>
            </div>
            <div class="about-row" v-if="info.coremanifest?.pointer">
              <span class="about-label">pointer:</span>
              <span class="about-value about-monospace">{{ info.coremanifest.pointer }}</span>
            </div>
          </div>

          <!-- dbmanifest.json -->
          <div class="about-section">
            <h4>dbmanifest.json</h4>
            <div v-if="info.dbmanifest?.coreEntry" class="about-subsection">
              <div class="about-subtitle">{{ info.dbmanifest.coreEntry.key }}:</div>
              <div class="about-row">
                <span class="about-label">version:</span>
                <span class="about-value">{{ info.dbmanifest.coreEntry.version ?? '—' }}</span>
              </div>
              <div class="about-row">
                <span class="about-label">updated:</span>
                <span class="about-value">{{ info.dbmanifest.coreEntry.updated ?? '—' }} ({{ info.dbmanifest.coreEntry.updatedHuman || '—' }})</span>
              </div>
            </div>
            <div v-if="info.dbmanifest?.active" class="about-subsection">
              <div class="about-subtitle">Currently active dbmanifest (dbmanifest_latest.json)</div>
              <div class="about-row">
                <span class="about-label">sha256:</span>
                <span class="about-value about-monospace">{{ info.dbmanifest.active.sha256 || '—' }}</span>
              </div>
              <div class="about-row">
                <span class="about-label">lastupdated:</span>
                <span class="about-value">{{ info.dbmanifest.active.lastupdated ?? '—' }} ({{ info.dbmanifest.active.lastupdatedHuman || '—' }})</span>
              </div>
              <div v-if="info.dbmanifest.active.files?.length" class="about-file-list">
                <div v-for="f in info.dbmanifest.active.files" :key="f.name" class="about-file-row">
                  <span class="about-file-name">{{ f.name }}</span>
                  <span class="about-file-version">version: {{ f.version }}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- bpsarchives.json -->
          <div class="about-section">
            <h4>bpsarchives.json</h4>
            <div v-if="info.bpsarchives?.coreEntry" class="about-subsection">
              <div class="about-subtitle">{{ info.bpsarchives.coreEntry.key }}:</div>
              <div class="about-row">
                <span class="about-label">version:</span>
                <span class="about-value">{{ info.bpsarchives.coreEntry.version ?? '—' }}</span>
              </div>
              <div class="about-row">
                <span class="about-label">updated:</span>
                <span class="about-value">{{ info.bpsarchives.coreEntry.updated ?? '—' }} ({{ info.bpsarchives.coreEntry.updatedHuman || '—' }})</span>
              </div>
            </div>
            <div v-if="info.bpsarchives?.active" class="about-subsection">
              <div class="about-subtitle">Currently active bpsarchives (bpsarchives_latest.json)</div>
              <div class="about-row">
                <span class="about-label">sha256:</span>
                <span class="about-value about-monospace">{{ info.bpsarchives.active.sha256 || '—' }}</span>
              </div>
              <div class="about-row">
                <span class="about-label">lastupdated:</span>
                <span class="about-value">{{ info.bpsarchives.active.lastupdated ?? '—' }} ({{ info.bpsarchives.active.lastupdatedHuman || '—' }})</span>
              </div>
              <div v-if="info.bpsarchives.active.files?.length" class="about-file-list">
                <div v-for="f in info.bpsarchives.active.files" :key="f.name" class="about-file-row">
                  <span class="about-file-name">{{ f.name }}</span>
                  <span class="about-file-version">version: {{ f.version }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
      <footer class="modal-footer">
        <button @click="handleClose" class="btn-primary">Close</button>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';

const props = defineProps<{
  visible: boolean;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'check-updates'): void;
}>();

const loading = ref(false);
const error = ref<string | null>(null);
const info = ref<Record<string, any>>({});

async function loadInfo() {
  const api = (window as any).electronAPI;
  if (!api?.aboutGetInfo) {
    error.value = 'About info not available';
    return;
  }
  loading.value = true;
  error.value = null;
  try {
    const data = await api.aboutGetInfo();
    if (data?.error) {
      error.value = data.error;
    } else {
      info.value = data;
    }
  } catch (e: any) {
    error.value = e?.message || 'Failed to load about info';
  } finally {
    loading.value = false;
  }
}

watch(() => props.visible, (v) => {
  if (v) loadInfo();
});

function handleClose() {
  emit('close');
}
</script>

<style scoped>
.about-dialog {
  max-width: 640px;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
}

.about-dialog .modal-body {
  overflow-y: auto;
  flex: 1;
}

.about-loading,
.about-error {
  padding: 1rem;
}

.about-error {
  color: #c00;
}

.about-content {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.about-section {
  border: 1px solid var(--border-color, #ccc);
  border-radius: 6px;
  padding: 0.75rem 1rem;
}

.about-section h4 {
  margin: 0 0 0.5rem 0;
  font-size: 1rem;
}

.about-subsection {
  margin-top: 0.5rem;
  padding-top: 0.5rem;
  border-top: 1px dashed var(--border-color, #ddd);
}

.about-subtitle {
  font-weight: 600;
  font-size: 0.9rem;
  margin-bottom: 0.25rem;
}

.about-row {
  margin: 0.2rem 0;
  font-size: 0.9rem;
}

.about-label {
  display: inline-block;
  min-width: 10rem;
  color: var(--muted-color, #666);
}

.about-value {
  word-break: break-all;
}

.about-monospace {
  font-family: monospace;
  font-size: 0.85em;
}

.about-actions {
  margin-top: 0.5rem;
}

.about-file-list {
  margin-top: 0.25rem;
  font-size: 0.85rem;
}

.about-file-row {
  display: flex;
  justify-content: space-between;
  padding: 0.1rem 0;
}

.about-file-name {
  font-family: monospace;
}

.about-file-version {
  color: var(--muted-color, #666);
  margin-left: 0.5rem;
}

.about-dialog .modal-footer {
  display: flex;
  justify-content: flex-end;
  padding: 0.75rem 1rem;
  border-top: 1px solid var(--border-color, #ccc);
}
</style>
